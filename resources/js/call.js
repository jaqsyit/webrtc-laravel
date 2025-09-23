// Требование: window.Echo настроен (broadcaster: 'reverb')
// В Blade: meta[name=csrf-token], meta[name=user-id], meta[name=peer-id]
// И элементы: <video id="local" autoplay playsinline muted></video>
//             <video id="remote" autoplay playsinline></video>
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

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }] // добавь TURN в проде
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
    if (btnCall)   btnCall.disabled   = !init;
    if (btnAnswer) btnAnswer.disabled = !init;
    if (btnHangup) btnHangup.disabled = !init;
    if (btnMic)    { btnMic.disabled = !init; btnMic.textContent = "Микрофон выкл"; }
    if (btnCam)    { btnCam.disabled = !init; btnCam.textContent = "Камера выкл"; }
}

// ====== ЛОКАЛЬНЫЙ МЕДИА-ПОТОК (ТВОЙ ВАРИАНТ) ======
async function getLocalStream(){
    // HTTPS обязателен, кроме localhost/127.0.0.1
    if (location.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(location.hostname)) {
        setStatus('Нужен HTTPS для камеры/мика'); alert('Включи HTTPS на домене.'); return;
    }

    const constraints = { audio: true, video: false };
    console.log("Запрашиваем медиа с constraints", constraints);

    try{
        console.log("Ожидаем разрешения…");
        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("Разрешение получено");
        localStream = mediaStream;
        console.log("Получен локальный медиа-поток", mediaStream);

        if (elLocal) {
            elLocal.muted = true; // чтобы не слышать себя
            elLocal.srcObject = mediaStream;
            elLocal.onloadedmetadata = () => { elLocal.play?.(); };
        }

        setStatus("камера/микрофон готовы");
        enableControls(true);
    }catch(err){
        console.error(`${err.name}: ${err.message}`);
        setStatus('ошибка доступа: ' + (err.name || err.message));
        throw err;
    }
}

function createPeer(){
    if(pc) try{ pc.close(); }catch{}
    pc = new RTCPeerConnection(rtcConfig);

    // Локальные треки
    if (localStream){
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    // Удалённые треки
    remoteStream = new MediaStream();
    if (elRemote) {
        elRemote.srcObject = remoteStream;
        elRemote.onloadedmetadata = () => { elRemote.play?.(); };
    }
    pc.ontrack = (ev) => {
        ev.streams[0]?.getTracks().forEach(t => remoteStream.addTrack(t));
    };

    // ICE наружу
    pc.onicecandidate = (ev) => {
        if(ev.candidate){
            postJSON("/call/candidate", { to: peerId, candidate: ev.candidate })
                .catch(err => console.warn("candidate send failed", err));
        }
    };

    pc.onconnectionstatechange = () => {
        setStatus("conn: " + pc.connectionState);
        if(pc.connectionState === "failed"){
            pc.restartIce?.(); setStatus("ICE restart…");
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
    const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
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
    if(btnInit)  btnInit.disabled  = false;
    if(btnCall)  btnCall.disabled  = true;
    if(btnAnswer)btnAnswer.disabled= true;
    if(btnHangup)btnHangup.disabled= true;
    if(btnMic)   btnMic.disabled   = true;
    if(btnCam)   btnCam.disabled   = true;
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
    await getLocalStream();          // ← твой способ запроса
    if (!localStream) return;
    createPeer();
    subscribeEcho();
});
btnCall?.addEventListener("click", startCall);
btnAnswer?.addEventListener("click", answerManually);
btnHangup?.addEventListener("click", hangup);
btnMic?.addEventListener("click", toggleMic);
btnCam?.addEventListener("click", toggleCam);

// Без лишних слов — просто статус
document.addEventListener("DOMContentLoaded", ()=> setStatus("готов"));
window.addEventListener("beforeunload", () => { try{ hangup(); }catch{} });
