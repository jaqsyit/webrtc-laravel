// Требование: window.Echo настроен (broadcaster: 'reverb') и в Blade есть
// <meta name="csrf-token">, <meta name="user-id">, <meta name="peer-id">

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
const btnShare = $("#btnShare");

let pc = null;
let localStream = null;
let remoteStream = null;
let screenTrack = null;
let micEnabled = true;
let camEnabled = true;
let echoChannel = null; // объект канала Echo
let subscribed = false;

const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        // В проде ОБЯЗАТЕЛЬНО добавьте TURN
    ]
};

function setStatus(t){ if(statusEl) statusEl.textContent = "Статус: " + t; }

function enableControls(init = false){
    if(!btnInit) return;
    btnInit.disabled  = true;
    btnCall.disabled  = !init;
    btnAnswer.disabled= !init;
    btnHangup.disabled= !init;
    btnMic.disabled   = !init;
    btnCam.disabled   = !init;
    btnShare.disabled = !init;
    if (btnMic) btnMic.textContent = "Микрофон выкл";
    if (btnCam) btnCam.textContent = "Камера выкл";
    if (btnShare) btnShare.textContent = "Шэр экрана";
}

async function postJSON(url, body){
    return fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-TOKEN": csrf,
            "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify(body)
    });
}

function sdpToJSON(desc){
    if (!desc) return null;
    return { type: desc.type, sdp: desc.sdp };
}

async function initLocal(){
    if(localStream) return;
    try{
        if (elLocal) elLocal.muted = true; // автоплей без клика
        const constraints = { video: true, audio: true };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (elLocal) elLocal.srcObject = localStream;
        setStatus("камера/микрофон готовы");
        enableControls(true);
    }catch(e){
        console.error(e);
        setStatus("ошибка доступа к камере/микрофону (" + (e.name||e.message) + ")");
        throw e;
    }
}

function createPeer(){
    if(pc) try{ pc.close(); }catch{}

    pc = new RTCPeerConnection(rtcConfig);

    // Локальные треки
    if (localStream){
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    // Входящие треки
    remoteStream = new MediaStream();
    if (elRemote) elRemote.srcObject = remoteStream;
    pc.ontrack = (ev) => {
        ev.streams[0]?.getTracks().forEach(t => remoteStream.addTrack(t));
    };

    // Кандидаты наружу
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

    echoChannel = window.Echo.private('call.' + me);

    echoChannel
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
            try{
                await pc.addIceCandidate(new RTCIceCandidate(e.candidate));
            }catch(err){
                console.warn("addIceCandidate error", err);
            }
        });

    subscribed = true;
}

async function ensureReady(){
    if(!localStream) await initLocal();
    if(!pc) createPeer();
    if(!subscribed) subscribeEcho();
}

async function startCall(){
    await ensureReady();
    const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
    await pc.setLocalDescription(offer);
    await postJSON("/call/offer", { to: peerId, sdp: sdpToJSON(pc.localDescription) });
    setStatus("OFFER отправлен");
}

async function answerManually(){
    await ensureReady();
    setStatus("готов к ответу (ждём OFFER)");
}

function leaveEcho(){
    try{
        if (window.Echo && subscribed){
            window.Echo.leave('private-call.' + me); // совместимость
            window.Echo.leave('call.' + me);
        }
    }catch{}
    subscribed = false;
    echoChannel = null;
}

function hangup(){
    if(screenTrack){ try{ screenTrack.stop(); }catch{} screenTrack = null; }

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

    if (elLocal)  elLocal.srcObject  = null;
    if (elRemote) elRemote.srcObject = null;

    leaveEcho();
    setStatus("вызов завершён");
    enableControls(false);
    if (btnInit) btnInit.disabled = false;
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

async function shareScreen(){
    if(!pc) return;
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");

    if(screenTrack){
        // вернуть камеру
        const camTrack = localStream?.getVideoTracks()?.[0];
        if(sender && camTrack){
            await sender.replaceTrack(camTrack);
        } else if (camTrack){
            pc.addTrack(camTrack, localStream);
        }
        try{ screenTrack.stop(); }catch{}
        screenTrack = null;
        if (btnShare) btnShare.textContent = "Шэр экрана";
        return;
    }

    try{
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:false });
        screenTrack = screenStream.getVideoTracks()[0];
        if(sender){
            await sender.replaceTrack(screenTrack);
        }else{
            pc.addTrack(screenTrack, screenStream);
        }
        if (btnShare) btnShare.textContent = "Стоп шэр";
        screenTrack.onended = async () => {
            const camTrack = localStream?.getVideoTracks()?.[0];
            if(sender && camTrack){
                await sender.replaceTrack(camTrack);
            }
            screenTrack = null;
            if (btnShare) btnShare.textContent = "Шэр экрана";
        };
    }catch(e){
        console.warn("share error", e);
    }
}

// Кнопки
btnInit?.addEventListener("click", async ()=>{
    try{
        await initLocal();
        createPeer();
        subscribeEcho();
        if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
            setStatus("внимание: нужен HTTPS для камеры/мика и WSS для сокетов");
        }
    }catch{}
});
btnCall?.addEventListener("click", startCall);
btnAnswer?.addEventListener("click", answerManually);
btnHangup?.addEventListener("click", hangup);
btnMic?.addEventListener("click", toggleMic);
btnCam?.addEventListener("click", toggleCam);
btnShare?.addEventListener("click", shareScreen);

// Завершать при закрытии вкладки
window.addEventListener("beforeunload", () => {
    try{ hangup(); }catch{}
});

// Авто-статус
document.addEventListener("DOMContentLoaded", ()=>{
    setStatus("готов");
});
