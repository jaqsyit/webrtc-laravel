// Требование: Echo настроен (broadcaster: 'reverb')
// В Blade: meta[name=csrf-token], meta[name=user-id], meta[name=peer-id]
// Элементы: <video id="local" autoplay playsinline muted></video>
//           <video id="remote" autoplay playsinline></video>
// Кнопки: #btnInit, #btnCall, #btnAnswer, #btnHangup, #btnMic, #btnCam
// Статус: #status

const $ = (s) => document.querySelector(s);
const csrf   = document.querySelector('meta[name="csrf-token"]')?.content || '';
const me     = Number(document.querySelector('meta[name="user-id"]')?.content || 0);
const peerId = Number(document.querySelector('meta[name="peer-id"]')?.content || 0);

const elLocal  = $("#local");
const elRemote = $("#remote");
const statusEl = $("#status");
const btnInit  = $("#btnInit");
const btnCall  = $("#btnCall");
const btnAnswer= $("#btnAnswer");
const btnHangup= $("#btnHangup");
const btnMic   = $("#btnMic");
const btnCam   = $("#btnCam");

let pc = null;
let localStream = null;
let remoteStream = null;

let micEnabled = true;
let camEnabled = true;

let subscribed = false;
let inCall = false;

let pendingOffer = null;     // SDP from caller
let incomingFrom = null;     // userId of caller
let targetUserId = null;     // куда шлем сигналы в текущем вызове

let canSendCandidates = false;     // шлём ICE только когда есть локальное SDP и targetUserId
let remoteCandQueue = [];          // входящие кандидаты до setRemoteDescription

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }] // в проде добавь TURN
};

function setStatus(t){ statusEl && (statusEl.textContent = "Статус: " + t); }
function sdpToJSON(desc){ return desc ? { type: desc.type, sdp: desc.sdp } : null; }
async function postJSON(url, body){
    return fetch(url, {
        method: "POST",
        headers: { "Content-Type":"application/json", "X-CSRF-TOKEN": csrf, "X-Requested-With":"XMLHttpRequest" },
        body: JSON.stringify(body)
    });
}

function enableControls(init = false){
    if(!btnInit) return;
    btnInit.disabled  = true;
    btnCall && (btnCall.disabled   = !init);
    btnAnswer && (btnAnswer.disabled = true);     // включим, когда придёт OFFER
    btnHangup && (btnHangup.disabled = !init);
    btnMic && (btnMic.disabled   = !init, btnMic.textContent = "Микрофон выкл");
    btnCam && (btnCam.disabled   = !init, btnCam.textContent = "Камера выкл");
}

async function getLocalStream(){
    if (location.protocol !== 'https:' &&
        !['localhost','127.0.0.1'].includes(location.hostname)) {
        setStatus('Нужен HTTPS для камеры/мика');
        alert('Включи HTTPS на домене.');
        return;
    }
    const constraints = { audio: true, video: { width: 1280, height: 720 } };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStream = stream;
    if (elLocal) {
        elLocal.muted = true;
        elLocal.srcObject = stream;
        elLocal.onloadedmetadata = () => { elLocal.play?.(); };
    }
    setStatus("камера/микрофон готовы");
    enableControls(true);
}

function createPeer(){
    if(pc) try{ pc.close(); }catch{}

    pc = new RTCPeerConnection(rtcConfig);

    // local tracks
    if (localStream){
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    // remote tracks
    remoteStream = new MediaStream();
    if (elRemote) {
        elRemote.srcObject = remoteStream;
        elRemote.onloadedmetadata = () => { elRemote.play?.(); };
    }
    pc.ontrack = (ev) => {
        ev.streams[0]?.getTracks().forEach(t => remoteStream.addTrack(t));
    };

    pc.onicecandidate = (ev) => {
        // кандидаты приходят пачкой — шлём только когда есть цель и локальное SDP
        if (!ev.candidate || !canSendCandidates || !targetUserId) return;
        postJSON("/call/candidate", { to: targetUserId, candidate: ev.candidate })
            .catch(err => console.warn("candidate send failed", err));
    };

    pc.onconnectionstatechange = () => {
        setStatus("conn: " + pc.connectionState);
        if (pc.connectionState === "connected") inCall = true;
        if (pc.connectionState === "failed") {
            pc.restartIce?.();
            setStatus("ICE restart…");
        }
    };
}

function subscribeEcho(){
    if (subscribed || !window.Echo || !me) return;

    window.Echo.private('call.' + me)
        // ВХОДЯЩИЙ OFFER — НЕ отвечаем автоматически!
        .listen('.call.offer', async (e) => {
            pendingOffer = e.sdp;
            incomingFrom = e.from;
            setStatus("Входящий звонок от " + e.from);
            btnAnswer && (btnAnswer.disabled = false);
            btnCall && (btnCall.disabled = true);
        })
        // ВХОДЯЩИЙ ANSWER — завершаем установку соединения
        .listen('.call.answer', async (e) => {
            setStatus("получен ANSWER");
            await pc.setRemoteDescription(new RTCSessionDescription(e.sdp));
            // теперь можно безопасно применять отложенные кандидаты
            await flushRemoteCandidates();
            inCall = true;
            btnHangup && (btnHangup.disabled = false);
        })
        // ВХОДЯЩИЕ КАНДИДАТЫ — либо сразу добавляем, либо буферим
        .listen('.call.candidate', async (e) => {
            if (!pc) return;
            const cand = new RTCIceCandidate(e.candidate);
            if (pc.remoteDescription) {
                try { await pc.addIceCandidate(cand); } catch (err){ console.warn("addIceCandidate error", err); }
            } else {
                remoteCandQueue.push(cand);
            }
        });

    subscribed = true;
}

async function flushRemoteCandidates(){
    if (!pc || !pc.remoteDescription) return;
    while (remoteCandQueue.length) {
        const cand = remoteCandQueue.shift();
        try { await pc.addIceCandidate(cand); } catch (e) { console.warn('flush ICE err', e); }
    }
}

async function ensureReady(){
    if(!localStream) await getLocalStream();
    if(!pc) createPeer();
    if(!subscribed) subscribeEcho();
}

// === Caller: «Позвонить» ===
async function startCall(){
    await ensureReady();

    // фиксируем цель
    targetUserId = peerId;

    // создаём оффер
    const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
    await pc.setLocalDescription(offer);

    // теперь можно слать кандидаты
    canSendCandidates = true;

    // отправляем оффер
    await postJSON("/call/offer", { to: targetUserId, sdp: sdpToJSON(pc.localDescription) });
    setStatus("OFFER отправлен, дозвон…");
    btnCall && (btnCall.disabled = true);
    btnHangup && (btnHangup.disabled = false);
}

// === Callee: «Ответить» ===
async function answerManually(){
    if (!pendingOffer || !incomingFrom){
        setStatus("Нет входящего предложения");
        return;
    }

    await ensureReady();

    // цель — тот, кто звонил
    targetUserId = incomingFrom;

    // применяем удалённый оффер
    await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));

    // формируем/ставим локальный answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // теперь можно слать кандидаты
    canSendCandidates = true;

    // отправляем answer
    await postJSON("/call/answer", { to: targetUserId, sdp: sdpToJSON(pc.localDescription) });
    setStatus("ANSWER отправлен, соединение устанавливается…");

    // очищаем входящее состояние
    pendingOffer = null;
    incomingFrom = null;

    // применим буфер кандидатов
    await flushRemoteCandidates();

    btnAnswer && (btnAnswer.disabled = true);
    btnHangup && (btnHangup.disabled = false);
}

function hangup(){
    canSendCandidates = false;
    targetUserId = null;
    pendingOffer = null;
    incomingFrom = null;
    inCall = false;
    remoteCandQueue = [];

    if(pc){
        try{
            pc.getSenders().forEach(s => s.track && s.track.stop());
            pc.ontrack = null; pc.onicecandidate = null; pc.close();
        }catch{}
        pc = null;
    }
    if(localStream){ try{ localStream.getTracks().forEach(t => t.stop()); }catch{} localStream = null; }
    if(remoteStream){ try{ remoteStream.getTracks().forEach(t => t.stop()); }catch{} remoteStream = null; }

    if (elLocal)  elLocal.srcObject  = null;
    if (elRemote) elRemote.srcObject = null;

    try{
        if (window.Echo) { window.Echo.leave('call.' + me); window.Echo.leave('private-call.' + me); }
    }catch{}

    setStatus("вызов завершён");
    btnInit  && (btnInit.disabled  = false);
    btnCall  && (btnCall.disabled  = false);
    btnAnswer&& (btnAnswer.disabled= true);
    btnHangup&& (btnHangup.disabled= true);
    btnMic   && (btnMic.disabled   = true);
    btnCam   && (btnCam.disabled   = true);
}

function toggleMic(){
    micEnabled = !micEnabled;
    localStream?.getAudioTracks().forEach(t => t.enabled = micEnabled);
    if (btnMic) btnMic.textContent = micEnabled ? "Микрофон выкл" : "Микрофон вкл";
}
function toggleCam(){
    camEnabled = !camEnabled;
    localStream?.getVideoTracks().forEach(t => t.enabled = camEnabled);
    if (btnCam) btnCam.textContent = camEnabled ? "Камера выкл" : "Камера вкл";
}

// Кнопки
btnInit?.addEventListener("click", async ()=>{
    try{
        await getLocalStream();
        if (!localStream) return;
        createPeer();
        subscribeEcho();
    }catch{}
});
btnCall?.addEventListener("click", startCall);
btnAnswer?.addEventListener("click", answerManually);
btnHangup?.addEventListener("click", hangup);
btnMic?.addEventListener("click", toggleMic);
btnCam?.addEventListener("click", toggleCam);

document.addEventListener("DOMContentLoaded", ()=> setStatus("готов"));
window.addEventListener("beforeunload", () => { try{ hangup(); }catch{} });
