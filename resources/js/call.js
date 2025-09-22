// Требование: window.Echo уже сконфигурирован в app.js/bootstrap.js (broadcaster: 'reverb').

const $ = (s)=>document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const me = Number(document.querySelector('meta[name="user-id"]').content);
const peerId = Number(document.querySelector('meta[name="peer-id"]').content);

const elLocal = $("#local");
const elRemote = $("#remote");
const statusEl = $("#status");
const btnInit = $("#btnInit");
const btnCall = $("#btnCall");
const btnAnswer = $("#btnAnswer");
const btnHangup = $("#btnHangup");
const btnMic = $("#btnMic");
const btnCam = $("#btnCam");
const btnShare = $("#btnShare");

let pc = null;
let localStream = null;
let remoteStream = null;
let screenTrack = null; // для шэра
let micEnabled = true;
let camEnabled = true;
let echoSub = null;

const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        // ⚠️ В проде обязателен TURN (coturn или облачный TURN).
    ]
};

function setStatus(t){ statusEl.textContent = "Статус: " + t; }

function enableControls(init = false){
    btnInit.disabled = true;
    btnCall.disabled = !init;
    btnAnswer.disabled = !init;
    btnHangup.disabled = !init;
    btnMic.disabled = !init;
    btnCam.disabled = !init;
    btnShare.disabled = !init;
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

async function initLocal(){
    try{
        const camId = selCam?.value || undefined;
        const micId = selMic?.value || undefined;

        const video = camId ? { deviceId: { exact: camId } } : true;
        const audio = micId ? { deviceId: { exact: micId } } : true;

        // мягкий TRY → если упадёт, попробуем проще
        try{
            localStream = await navigator.mediaDevices.getUserMedia({ video, audio });
        }catch(e){
            if(e.name==='OverconstrainedError' || e.name==='NotFoundError'){
                localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
            } else { throw e; }
        }

        elLocal.srcObject = localStream;
        enableControls(true);
        setStatus('Камера/микрофон готовы');
    }catch(e){
        console.error(e);
        if(e.name==='NotAllowedError'){ setStatus('Доступ запрещён в браузере/Windows. Разреши и обнови.'); return; }
        if(e.name==='NotFoundError'){ setStatus('Устройства не найдены. Выбери камеру/микрофон в селекторах.'); return; }
        setStatus(`ошибка ${e.name}: ${e.message}`);
    }

    try{
        setStatus('Запрашиваем доступ к камере/микрофону…');
        // мягкие, без exact — чтобы избежать OverconstrainedError
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
            audio: true
        });
        elLocal.srcObject = localStream;
        setStatus('Камера/микрофон разрешены');
        enableControls(true);
    }catch(e){
        console.error(e);
        if (e.name === 'NotAllowedError') {
            setStatus('Доступ запрещён. Разреши в настройках сайта/Windows.');
        } else if (e.name === 'NotFoundError') {
            setStatus('Устройства не найдены. Проверь выбор устройства в браузере.');
        } else if (e.name === 'OverconstrainedError') {
            // фоллбэк на самые простые
            try{
                localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
                elLocal.srcObject = localStream; enableControls(true);
                setStatus('Разрешено (упростили настройки)');
                return;
            }catch(e2){ setStatus(`ошибка ${e2.name}: ${e2.message}`); }
        } else {
            setStatus(`ошибка ${e.name}: ${e.message}`);
        }
    }
}

// Авто-запрос при открытии страницы
document.addEventListener('DOMContentLoaded', async ()=>{
    // если доступ заранее запрещён — покажем подсказку
    try{
        if (navigator.permissions) {
            const [cam, mic] = await Promise.allSettled([
                navigator.permissions.query({name:'camera'}),
                navigator.permissions.query({name:'microphone'})
            ]);
            if (cam.value?.state === 'denied' || mic.value?.state === 'denied') {
                setStatus('Доступ запрещён. Разреши в настройках сайта, потом обнови страницу.');
            }
        }
    }catch{}
    await initLocal();
    if (localStream) { createPeer(); subscribeEcho(); }
});



function createPeer(){
    if(!localStream){ setStatus('Нет локального стрима — нажми «Инициализировать»'); return; }
    pc = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    if(pc) pc.close();
    pc = new RTCPeerConnection(rtcConfig);

    // Локальные треки в PC
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    // Приходящие треки
    remoteStream = new MediaStream();
    elRemote.srcObject = remoteStream;
    pc.ontrack = (ev) => {
        ev.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
    };

    // ICE кандидаты наружу
    pc.onicecandidate = (ev) => {
        if(ev.candidate){
            postJSON("/call/candidate", { to: peerId, candidate: ev.candidate });
        }
    };

    pc.onconnectionstatechange = () => {
        setStatus("conn: " + pc.connectionState);
        if(pc.connectionState === "failed"){
            // Проба ICE restart
            pc.restartIce?.();
            setStatus("ICE restart…");
        }
    };
}

function subscribeEcho(){
    if(echoSub) return;
    echoSub = window.Echo.private('call.' + me)
        .listen('.call.offer', async (e) => {
            setStatus("получен OFFER от " + e.from);
            await ensureReady();
            await pc.setRemoteDescription(new RTCSessionDescription(e.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await postJSON("/call/answer", { to: e.from, sdp: pc.localDescription });
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
}

async function ensureReady(){
    if(!localStream) await initLocal();
    if(!pc) createPeer();
}

async function startCall(){
    await ensureReady();
    const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
    await pc.setLocalDescription(offer);
    await postJSON("/call/offer", { to: peerId, sdp: pc.localDescription });
    setStatus("OFFER отправлен");
}

async function answerManually(){
    // Нажимает тот, кто получил входящий звонок, но OFFER ловится слушателем — тут просто гарантируем готовность.
    await ensureReady();
    setStatus("готов к ответу (ожидаем OFFER)");
}

function hangup(){
    if(screenTrack){
        try{ screenTrack.stop(); }catch{}
        screenTrack = null;
    }
    if(pc){
        pc.getSenders().forEach(s => s.track && s.track.stop());
        pc.ontrack = null;
        pc.onicecandidate = null;
        try{ pc.close(); }catch{}
        pc = null;
    }
    if(localStream){
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    if(remoteStream){
        remoteStream.getTracks().forEach(t => t.stop());
        remoteStream = null;
    }
    elLocal.srcObject = null;
    elRemote.srcObject = null;
    setStatus("вызов завершён");
    enableControls(false);
    btnInit.disabled = false; // можно заново
}

function toggleMic(){
    micEnabled = !micEnabled;
    localStream?.getAudioTracks().forEach(t => t.enabled = micEnabled);
    btnMic.textContent = micEnabled ? "Микрофон выкл" : "Микрофон вкл";
}

function toggleCam(){
    camEnabled = !camEnabled;
    localStream?.getVideoTracks().forEach(t => t.enabled = camEnabled);
    btnCam.textContent = camEnabled ? "Камера выкл" : "Камера вкл";
}

async function shareScreen(){
    if(screenTrack){
        // стоп шэр и вернуть камеру
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        const camTrack = localStream.getVideoTracks()[0];
        if(sender && camTrack){
            await sender.replaceTrack(camTrack);
        }
        try{ screenTrack.stop(); }catch{}
        screenTrack = null;
        btnShare.textContent = "Шэр экрана";
        return;
    }
    try{
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:false });
        screenTrack = screenStream.getVideoTracks()[0];
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if(sender && screenTrack){
            await sender.replaceTrack(screenTrack);
            btnShare.textContent = "Стоп шэр";
            screenTrack.onended = () => {
                // вернуть камеру при завершении пользователем
                if(localStream){
                    const camTrack = localStream.getVideoTracks()[0];
                    sender.replaceTrack(camTrack);
                }
                screenTrack = null;
                btnShare.textContent = "Шэр экрана";
            };
        }
    }catch(e){
        console.warn("share error", e);
    }
}

// Кнопки
btnInit.addEventListener("click", async ()=>{
    await initLocal();
    if(!localStream) return;
    createPeer();
    subscribeEcho();
});
btnCall.addEventListener("click", startCall);
btnAnswer.addEventListener("click", answerManually);
btnHangup.addEventListener("click", hangup);
btnMic.addEventListener("click", toggleMic);
btnCam.addEventListener("click", toggleCam);
btnShare.addEventListener("click", shareScreen);

// Мелкие улучшения UX
window.addEventListener("beforeunload", () => {
    try{ hangup(); }catch{}
});

// Автоинициализация (можно выключить, если мешает)
document.addEventListener("DOMContentLoaded", ()=>{
    setStatus("готов");
});

const selCam = document.querySelector('#selCam');
const selMic = document.querySelector('#selMic');
const btnPerms = document.querySelector('#btnPerms');

async function listDevices(){
    const devs = await navigator.mediaDevices.enumerateDevices();
    const cams = devs.filter(d=>d.kind==='videoinput');
    const mics = devs.filter(d=>d.kind==='audioinput');

    selCam.innerHTML = cams.map(d=>`<option value="${d.deviceId}">${d.label||'Камера'}</option>`).join('') || '<option>Камера не найдена</option>';
    selMic.innerHTML = mics.map(d=>`<option value="${d.deviceId}">${d.label||'Микрофон'}</option>`).join('') || '<option>Микрофон не найден</option>';
}

async function requestPerms(){
    // Явно просим разрешение, чтобы появились названия устройств
    try{
        const tmp = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
        tmp.getTracks().forEach(t=>t.stop());
    }catch(e){
        // даже если отказали — покажем причину
        console.warn('perm probe', e);
        if(e.name==='NotAllowedError'){ setStatus('Разреши доступ в настройках сайта, затем заново.'); }
    }
    await listDevices();
}

// Авто при открытии: запросить разрешения и заполнить селекты
document.addEventListener('DOMContentLoaded', async ()=>{
    await requestPerms();
    await initLocal().catch(()=>{ /* статус уже показан */ });
    if(localStream){ createPeer(); subscribeEcho(); }
});

// Кнопки/селекты
btnPerms.addEventListener('click', requestPerms);
selCam.addEventListener('change', ()=>initLocal());
selMic.addEventListener('change', ()=>initLocal());
