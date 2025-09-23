// Требование: window.Echo настроен (broadcaster: 'reverb'), в Blade есть
// <meta name="csrf-token">, <meta name="user-id">, <meta name="peer-id">

const $ = (s) => document.querySelector(s);
const csrf   = document.querySelector('meta[name="csrf-token"]')?.content || '';
const me     = Number(document.querySelector('meta[name="user-id"]')?.content || 0);
const peerId = Number(document.querySelector('meta[name="peer-id"]')?.content || 0);

const elLocalAudio  = $("#localAudio");
const elRemoteAudio = $("#remoteAudio");
const statusEl = $("#status");
const btnInit  = $("#btnInit");
const btnCall  = $("#btnCall");
const btnAnswer= $("#btnAnswer");
const btnHangup= $("#btnHangup");
const btnMic   = $("#btnMic");

let pc = null;
let localStream = null;
let remoteStream = null;
let micEnabled = true;
let subscribed = false;

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    // В проде добавь TURN
};

function setStatus(t){ if(statusEl) statusEl.textContent = "Статус: " + t; }

function enableControls(init = false){
    if(!btnInit) return;
    btnInit.disabled  = true;
    btnCall.disabled  = !init;
    btnAnswer.disabled= !init;
    btnHangup.disabled= !init;
    btnMic.disabled   = !init;
    if (btnMic) btnMic.textContent = "Микрофон выкл";
}

async function postJSON(url, body){
    return fetch(url, {
        method: "POST",
        headers: {"Content-Type":"application/json","X-CSRF-TOKEN":csrf,"X-Requested-With":"XMLHttpRequest"},
        body: JSON.stringify(body),
    });
}

function sdpToJSON(desc){ return desc ? { type: desc.type, sdp: desc.sdp } : null; }

// ======== ТВОЙ ВАРИАНТ: только аудио ========
async function getLocalStream(){
    // HTTPS обязателен, кроме localhost/127.0.0.1
    if (location.protocol !== 'https:' &&
        !['localhost','127.0.0.1'].includes(location.hostname)) {
        setStatus('Нужен HTTPS для микрофона');
        alert('Включите HTTPS на домене.');
        return;
    }

    try{
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
        localStream = stream;
        if (elLocalAudio) {
            // чтобы не слышать себя — заглушаем
            elLocalAudio.srcObject = stream;
            elLocalAudio.muted = true;
            elLocalAudio.autoplay = true;
            elLocalAudio.volume = 0;
        }
        setStatus("микрофон готов");
        enableControls(true);
    }catch(err){
        console.error('getUserMedia error:', err);
        setStatus('ошибка доступа: ' + (err.name || err.message));
        if (err.name === 'NotAllowedError') alert('Доступ запрещён. Разреши микрофон в настройках сайта.');
        if (err.name === 'NotFoundError')   alert('Микрофон не найден.');
        throw err;
    }
}

function createPeer(){
    if(pc) try{ pc.close(); }catch{}
    pc = new RTCPeerConnection(rtcConfig);

    // Локальные АУДИО-треки
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    // Приходящий удалённый аудио-поток
    remoteStream = new MediaStream();
    if (elRemoteAudio) elRemoteAudio.srcObject = remoteStream;
    pc.ontrack = (ev) => {
        ev.streams[0]?.getTracks().forEach(t => remoteStream.addTrack(t));
    };

    pc.onicecandidate = (ev) => {
        if(ev.candidate){
            postJSON("/call/candidate", { to: peerId, candidate: ev.candidate })
                .catch(err => console.warn("candidate send failed", err));
        }
    };

    pc.onconnectionstatechange = () => {
        setStatus("conn: " + pc.connectionState);
        if(pc.connectionState === "failed"){
            pc.restartIce?.();
            setStatus("ICE restart…");
        }
    };
}

function subscribeEcho(){
    if (subscribed || !window.Echo || !me) return;

    window.Echo.private('call.' + me)
        .listen('.call.offer', async (e) => {
            setStatus("получен OFFER от " + e.from);
            await ensureReady();
            await pc.setRemoteDescription(new RTCSessionDescription(e.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await postJSON("/call/answer", { to: e.from, sdp: sdpToJSON(pc.localDescription) });
            setStatus("ANSWER отправлен");
        })
        .listen('.call.answer', async (e) => {
            setStatus("получен ANSWER");
            await pc.setRemoteDescription(new RTCSessionDescription(e.sdp));
        })
        .listen('.call.candidate', async (e) => {
            try{ await pc.addIceCandidate(new RTCIceCandidate(e.candidate)); }
            catch(err){ console.warn("addIceCandidate error", err); }
        });

    subscribed = true;
}

async function ensureReady(){
    if(!localStream) await getLocalStream();
    if(!pc) createPeer();
    if(!subscribed) subscribeEcho();
}

async function startCall(){
    await ensureReady();
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    await postJSON("/call/offer", { to: peerId, sdp: sdpToJSON(pc.localDescription) });
    setStatus("OFFER отправлен");
}

async function answerManually(){
    await ensureReady();
    setStatus("готов к ответу (ждём OFFER)");
}

function hangup(){
    if(pc){
        try{
            pc.getSenders().forEach(s => s.track && s.track.stop());
            pc.ontrack = null;
            pc.onicecandidate = null;
            pc.close();
        }catch{}
        pc = null;
    }
    if(localStream){ try{ localStream.getTracks().forEach(t => t.stop()); }catch{} localStream = null; }
    if(remoteStream){ try{ remoteStream.getTracks().forEach(t => t.stop()); }catch{} remoteStream = null; }

    if (elLocalAudio)  elLocalAudio.srcObject  = null;
    if (elRemoteAudio) elRemoteAudio.srcObject = null;

    try{
        if (window.Echo) {
            window.Echo.leave('call.' + me);
            window.Echo.leave('private-call.' + me);
        }
    }catch{}

    setStatus("вызов завершён");
    if(btnInit) btnInit.disabled = false;
    if(btnCall) btnCall.disabled = true;
    if(btnAnswer) btnAnswer.disabled = true;
    if(btnHangup) btnHangup.disabled = true;
    if(btnMic) btnMic.disabled = true;
}

function toggleMic(){
    micEnabled = !micEnabled;
    localStream?.getAudioTracks().forEach(t => t.enabled = micEnabled);
    if (btnMic) btnMic.textContent = micEnabled ? "Микрофон выкл" : "Микрофон вкл";
}

// Кнопки
btnInit?.addEventListener("click", async ()=>{
    await getLocalStream();        // ← твой вызов (только аудио)
    if (!localStream) return;
    createPeer();
    subscribeEcho();
});

btnCall?.addEventListener("click", startCall);
btnAnswer?.addEventListener("click", answerManually);
btnHangup?.addEventListener("click", hangup);
btnMic?.addEventListener("click", toggleMic);

// Аварийное завершение при закрытии вкладки
window.addEventListener("beforeunload", () => { try{ hangup(); }catch{} });

// Статус при загрузке
document.addEventListener("DOMContentLoaded", ()=> setStatus("готов"));
