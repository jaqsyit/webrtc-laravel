// Echo настроен (broadcaster: 'reverb')
// В Blade: meta[name=csrf-token], meta[name=user-id], meta[name=peer-id]
// Элементы: <video id="local" autoplay playsinline muted></video>
//           <video id="remote" autoplay playsinline></video>

const $ = (s) => document.querySelector(s);
const csrf   = document.querySelector('meta[name="csrf-token"]')?.content || '';
const me     = Number(document.querySelector('meta[name="user-id"]')?.content || 0);
const peerId = Number(document.querySelector('meta[name="peer-id"]')?.content || 0);

const elLocal  = $("#local");
const elRemote = $("#remote");
const elLocalAudio = $("#localAudio");
const elRemoteAudio = $("#remoteAudio");
const statusEl = $("#status");
const btnInit  = $("#btnInit");
const btnCall  = $("#btnCall");
const btnAnswer= $("#btnAnswer");
const btnHangup= $("#btnHangup");
const btnMic   = $("#btnMic");
const btnCam   = $("#btnCam");
const btnShare = $("#btnShare");

let pc = null;
let localStream = null;
let remoteStream = null;
let originalVideoTrack = null;
let screenShareActive = false;

let subscribed = false;
let inCall = false;

// входящий звонок
let pendingOffer = null;     // RTCSessionDescriptionInit (offer)
let incomingFrom = null;     // userId звонящего

// текущая цель (кому шлём сигналы) и флаги ICE
let targetUserId = null;
let canSendCandidates = false;
let remoteCandQueue = [];

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }] // добавь TURN в проде
};

// ===== утилиты =====
function setStatus(t){ statusEl && (statusEl.textContent = "Статус: " + t); }
function sdpToJSON(desc){ return desc ? { type: desc.type, sdp: desc.sdp } : null; }
function normalizeSDP(x){
    // принимаем как {type,sdp} или {sdp:{type,sdp}}
    if (!x) return null;
    if (typeof x.type === 'string' && typeof x.sdp === 'string') return x;
    if (x.sdp && typeof x.sdp.type === 'string') return x.sdp;
    return x; // на всякий
}
async function postJSON(url, body){
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type":"application/json", "X-CSRF-TOKEN": csrf, "X-Requested-With":"XMLHttpRequest" },
        credentials: 'same-origin',
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed: ${response.status}`);
    }

    return response;
}

function enableControls(init = false){
    if(!btnInit) return;
    btnInit.disabled = true;
    if (btnCall) btnCall.disabled = !init;
    if (btnAnswer) btnAnswer.disabled = true;
    if (btnHangup) btnHangup.disabled = !init;
    if (btnMic) {
        btnMic.disabled = !init;
        btnMic.textContent = "Микрофон выкл";
    }
    if (btnCam) {
        btnCam.disabled = !init;
        btnCam.textContent = "Камера выкл";
    }
    if (btnShare) {
        btnShare.disabled = !init;
        btnShare.textContent = 'Шэр экрана';
    }
}

// ===== медиа =====
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
    if (elLocalAudio) {
        elLocalAudio.muted = true;
        elLocalAudio.srcObject = stream;
        elLocalAudio.onloadedmetadata = () => { elLocalAudio.play?.().catch(() => {}); };
    }
    originalVideoTrack = stream.getVideoTracks()[0] || null;
    setStatus("камера/микрофон готовы");
    enableControls(true);
}

// ===== RTCPeerConnection =====
function createPeer(){
    if(pc) try{ pc.close(); }catch{}

    pc = new RTCPeerConnection(rtcConfig);

    // локальные треки
    if (localStream){
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    // удалённые треки
    remoteStream = new MediaStream();
    if (elRemote) {
        elRemote.srcObject = remoteStream;
        elRemote.onloadedmetadata = () => { elRemote.play?.(); };
    }
    if (elRemoteAudio) {
        elRemoteAudio.srcObject = remoteStream;
        elRemoteAudio.onloadedmetadata = () => { elRemoteAudio.play?.().catch(() => {}); };
    }
    pc.ontrack = (ev) => {
        ev.streams[0]?.getTracks().forEach(t => {
            const exists = remoteStream.getTracks().some(track => track.id === t.id);
            if (!exists) remoteStream.addTrack(t);
        });
        elRemote?.play?.().catch(() => {});
        elRemoteAudio?.play?.().catch(() => {});
    };

    // исходящие ICE — только когда можно
    pc.onicecandidate = (ev) => {
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

// ===== сигналинг (Echo) =====
function subscribeEcho(){
    console.log("subscribeEcho", { subscribed, Echo: !!window.Echo, me });
    if (subscribed || !window.Echo || !me) {
        console.log("Echo not ready or already subscribed");
        return;
    }

    window.Echo.private('call.' + me)
        .subscribed(() => console.log('✅ subscribed to call.' + me))
        .error(err => console.error('❌ subscription error call.' + me, err))
        // входящий OFFER => активируем кнопку «Ответить»
        .listen('.call.offer', async (e) => {
            pendingOffer = normalizeSDP(e.sdp);
            incomingFrom = e.from;
            setStatus("Входящий звонок от " + e.from);
            btnAnswer && (btnAnswer.disabled = false);
            btnCall && (btnCall.disabled = true);
        })
        // входящий ANSWER => завершаем соединение
        .listen('.call.answer', async (e) => {
            if (!pc) return;
            setStatus("получен ANSWER");
            await pc.setRemoteDescription(new RTCSessionDescription(normalizeSDP(e.sdp)));
            await flushRemoteCandidates();
            inCall = true;
            btnHangup && (btnHangup.disabled = false);
        })
        // входящие ICE
        .listen('.call.candidate', async (e) => {
            if (!pc || !e?.candidate) return;
            const cand = new RTCIceCandidate(e.candidate);
            if (pc.remoteDescription) {
                try { await pc.addIceCandidate(cand); } catch (err){ console.warn("addIceCandidate error", err); }
            } else {
                remoteCandQueue.push(cand);
            }
        });

    subscribed = true;
}
window.Pusher && (window.Pusher.logToConsole = true);
if (window.Echo?.connector?.pusher?.connection) {
    window.Echo.connector.pusher.connection.bind('state_change', s => console.log('WS state:', s));
    window.Echo.connector.pusher.connection.bind('error', e => console.error('WS error:', e));
}

// ===== кнопки =====

// Caller: «Позвонить»
async function startCall(){
    await ensureReady();

    targetUserId = peerId;

    const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
    await pc.setLocalDescription(offer);

    // теперь можем слать свои ICE
    canSendCandidates = true;

    await postJSON("/call/offer", { to: targetUserId, sdp: sdpToJSON(pc.localDescription) });
    setStatus("OFFER отправлен, дозвон…");
    btnCall && (btnCall.disabled = true);
    btnHangup && (btnHangup.disabled = false);
}

// Callee: «Ответить»
async function answerManually(){
    if (!pendingOffer || !incomingFrom){
        setStatus("Нет входящего предложения");
        return;
    }

    await ensureReady();

    // защита: если мы уже Caller с локальным оффером, запрещаем отвечать
    if (pc.signalingState === 'have-local-offer') {
        setStatus('Вы инициатор — «Ответить» не требуется');
        return;
    }

    targetUserId = incomingFrom;

    // применяем удалённый оффер
    await pc.setRemoteDescription(new RTCSessionDescription(normalizeSDP(pendingOffer)));

    // формируем answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // можно слать ICE
    canSendCandidates = true;

    // ответ серверу
    await postJSON("/call/answer", { to: targetUserId, sdp: sdpToJSON(pc.localDescription) });
    setStatus("ANSWER отправлен, соединение устанавливается…");

    // очищаем входящее
    pendingOffer = null;
    incomingFrom = null;

    // добавим отложенные ICE
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
    screenShareActive = false;

    if(pc){
        try{
            pc.getSenders().forEach(s => s.track && s.track.stop());
            pc.ontrack = null; pc.onicecandidate = null; pc.close();
        }catch{}
        pc = null;
    }
    const shouldStopOriginalTrack = !!originalVideoTrack && !localStream?.getTracks().some((track) => track.id === originalVideoTrack.id);
    if(localStream){ try{ localStream.getTracks().forEach(t => t.stop()); }catch{} localStream = null; }
    if (shouldStopOriginalTrack) {
        try { originalVideoTrack.stop(); } catch {}
    }
    if(remoteStream){ try{ remoteStream.getTracks().forEach(t => t.stop()); }catch{} remoteStream = null; }
    originalVideoTrack = null;

    if (elLocal)  elLocal.srcObject  = null;
    if (elRemote) elRemote.srcObject = null;
    if (elLocalAudio) elLocalAudio.srcObject = null;
    if (elRemoteAudio) elRemoteAudio.srcObject = null;

    try{
        if (window.Echo) { window.Echo.leave('call.' + me); window.Echo.leave('private-call.' + me); }
    }catch{}
    subscribed = false;

    setStatus("вызов завершён");
    btnInit  && (btnInit.disabled  = false);
    btnCall  && (btnCall.disabled  = false);
    btnAnswer&& (btnAnswer.disabled= true);
    btnHangup&& (btnHangup.disabled= true);
    btnMic   && (btnMic.disabled   = true);
    btnCam   && (btnCam.disabled   = true);
    if (btnShare) {
        btnShare.disabled = true;
        btnShare.textContent = 'Шэр экрана';
    }
}

async function toggleScreenShare(){
    if (!localStream || !pc) return;

    const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
    if (!sender) return;

    if (!screenShareActive) {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const displayTrack = displayStream.getVideoTracks()[0];
        if (!displayTrack) return;

        displayTrack.onended = () => {
            if (screenShareActive) {
                toggleScreenShare().catch((error) => console.warn('screen share reset failed', error));
            }
        };

        const currentTrack = localStream.getVideoTracks()[0];
        await sender.replaceTrack(displayTrack);
        if (currentTrack) localStream.removeTrack(currentTrack);
        localStream.addTrack(displayTrack);
        if (elLocal) elLocal.srcObject = localStream;
        screenShareActive = true;
        if (btnShare) btnShare.textContent = 'Остановить шаринг';
        return;
    }

    if (!originalVideoTrack) return;

    const activeTrack = localStream.getVideoTracks()[0];
    await sender.replaceTrack(originalVideoTrack);
    if (activeTrack && activeTrack.id !== originalVideoTrack.id) {
        localStream.removeTrack(activeTrack);
        activeTrack.stop();
    }
    if (!localStream.getVideoTracks().some((track) => track.id === originalVideoTrack.id)) {
        localStream.addTrack(originalVideoTrack);
    }
    if (elLocal) elLocal.srcObject = localStream;
    screenShareActive = false;
    if (btnShare) btnShare.textContent = 'Шэр экрана';
}

// привязки
btnInit?.addEventListener("click", async ()=>{
    try{
        await getLocalStream();
        if (!localStream) return;
        createPeer();
        subscribeEcho();
    }catch(error){
        console.warn('init failed', error);
        setStatus('Не удалось инициализировать камеру/микрофон');
    }
});
btnCall?.addEventListener("click", () => {
    startCall().catch((error) => {
        console.warn('call start failed', error);
        setStatus('Не удалось начать звонок');
    });
});
btnAnswer?.addEventListener("click", () => {
    answerManually().catch((error) => {
        console.warn('answer failed', error);
        setStatus('Не удалось ответить на звонок');
    });
});
btnHangup?.addEventListener("click", hangup);
btnMic?.addEventListener("click", toggleMic);
btnCam?.addEventListener("click", toggleCam);
btnShare?.addEventListener("click", () => {
    toggleScreenShare().catch((error) => {
        console.warn('screen share failed', error);
        setStatus('Не удалось включить шаринг экрана');
    });
});

document.addEventListener("DOMContentLoaded", ()=> {
    setStatus("готов");
    subscribeEcho();
});
window.addEventListener("beforeunload", () => { try{ hangup(); }catch{} });
