// Echo настроен (broadcaster: 'reverb')
// В Blade: meta[name=csrf-token], meta[name=user-id], meta[name=peer-id]
// Элементы: <video id="local" autoplay playsinline muted></video>
//           <video id="remote" autoplay playsinline></video>

const $ = (selector) => document.querySelector(selector);

const csrf = $('meta[name="csrf-token"]')?.content || '';
const me = Number($('meta[name="user-id"]')?.content || 0);
const peerId = Number($('meta[name="peer-id"]')?.content || 0);
const appEnv = $('meta[name="app-env"]')?.content || 'production';
const incomingCallStorageKey = 'incoming-call';

const elLocal = $('#local');
const elRemote = $('#remote');
const elLocalAudio = $('#localAudio');
const elRemoteAudio = $('#remoteAudio');
const localPlaceholder = $('#localPlaceholder');
const remotePlaceholder = $('#remotePlaceholder');
const statusEl = $('#status');
const activityLogEl = $('#activityLog');
const modeBadgeEl = $('#modeBadge');
const modeValueEl = $('#modeValue');
const modeHintEl = $('#modeHint');
const sentValueEl = $('#sentValue');
const sentMetaEl = $('#sentMeta');
const receivedValueEl = $('#receivedValue');
const receivedMetaEl = $('#receivedMeta');

const btnInit = $('#btnInit');
const btnCall = $('#btnCall');
const btnAnswer = $('#btnAnswer');
const btnHangup = $('#btnHangup');
const btnMic = $('#btnMic');
const btnCam = $('#btnCam');
const btnShare = $('#btnShare');

const isLocalEnvironment = appEnv === 'local';
const canUseSecureMedia = window.isSecureContext && location.protocol === 'https:';
const isMockMode = isLocalEnvironment || !canUseSecureMedia;

let pc = null;
let localStream = null;
let remoteStream = null;
let originalVideoTrack = null;
let dataChannel = null;
let randomNumberInterval = null;
let screenShareActive = false;
let subscribed = false;
let inCall = false;
let pendingOffer = null;
let incomingFrom = null;
let targetUserId = null;
let canSendCandidates = false;
let remoteCandQueue = [];

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

// ===== утилиты =====
function setStatus(text) {
    if (statusEl) {
        statusEl.textContent = `Статус: ${text}`;
    }
}

function appendActivity(text, type = 'info') {
    if (!activityLogEl) return;

    const item = document.createElement('li');
    item.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    if (type === 'error') {
        item.style.borderColor = 'rgba(248,113,113,.35)';
        item.style.color = '#fecaca';
    }

    activityLogEl.prepend(item);

    while (activityLogEl.children.length > 12) {
        activityLogEl.removeChild(activityLogEl.lastElementChild);
    }
}

function setValue(el, value) {
    if (el) {
        el.textContent = value;
    }
}

function setMeta(el, value) {
    if (el) {
        el.textContent = value;
    }
}

function syncPlaceholders() {
    const hasLocalVideo = Boolean(localStream?.getVideoTracks()?.length);
    const hasRemoteVideo = Boolean(remoteStream?.getVideoTracks()?.length);

    if (localPlaceholder) {
        localPlaceholder.style.display = isMockMode || !hasLocalVideo ? 'block' : 'none';
    }

    if (remotePlaceholder) {
        remotePlaceholder.style.display = isMockMode || !hasRemoteVideo ? 'block' : 'none';
    }
}

function syncControls() {
    const ready = isMockMode ? Boolean(pc) : Boolean(localStream && pc);
    const canManageMedia = !isMockMode && Boolean(localStream);

    if (btnCall) btnCall.disabled = !ready || !peerId;
    if (btnAnswer) btnAnswer.disabled = !(ready && pendingOffer && incomingFrom);
    if (btnHangup) btnHangup.disabled = !(pc || localStream || dataChannel || inCall);
    if (btnMic) btnMic.disabled = !canManageMedia;
    if (btnCam) btnCam.disabled = !canManageMedia;
    if (btnShare) btnShare.disabled = !canManageMedia || !pc;

    if (btnMic && canManageMedia) {
        const audioTrack = localStream?.getAudioTracks?.()[0];
        btnMic.textContent = audioTrack?.enabled ? 'Микрофон выкл' : 'Микрофон вкл';
    }

    if (btnCam && canManageMedia) {
        const videoTrack = localStream?.getVideoTracks?.()[0];
        btnCam.textContent = videoTrack?.enabled ? 'Камера выкл' : 'Камера вкл';
    }

    if (btnShare && !screenShareActive) {
        btnShare.textContent = 'Шэр экрана';
    }
}

function updateModeUi() {
    if (isMockMode) {
        setValue(modeBadgeEl, 'LOCAL · DATA CHANNEL');
        setValue(modeValueEl, 'Локальный режим');
        setMeta(modeHintEl, 'Камера и микрофон отключены. Вместо них отправляются случайные двузначные числа каждые 2 секунды.');
        appendActivity('Обнаружен local/insecure режим: включён обмен числами через data-channel.');
        return;
    }

    setValue(modeBadgeEl, 'PROD · MEDIA');
    setValue(modeValueEl, 'Media mode');
    setMeta(modeHintEl, 'HTTPS + secure context доступны: используется реальный аудио/видеопоток.');
    appendActivity('Обнаружен production HTTPS режим: будут использованы реальные аудио и видео.');
}

function sdpToJSON(desc) {
    return desc ? { type: desc.type, sdp: desc.sdp } : null;
}

function normalizeSDP(payload) {
    if (!payload) return null;
    if (typeof payload.type === 'string' && typeof payload.sdp === 'string') return payload;
    if (payload.sdp && typeof payload.sdp.type === 'string') return payload.sdp;
    return payload;
}

function updateNumberBoard(kind, value, meta) {
    const targetValueEl = kind === 'sent' ? sentValueEl : receivedValueEl;
    const targetMetaEl = kind === 'sent' ? sentMetaEl : receivedMetaEl;

    setValue(targetValueEl, String(value).padStart(2, '0'));
    setMeta(targetMetaEl, meta);
}

function resetNumberBoard() {
    setValue(sentValueEl, '--');
    setMeta(sentMetaEl, 'Нет данных');
    setValue(receivedValueEl, '--');
    setMeta(receivedMetaEl, 'Нет данных');
}

function restorePendingIncomingCall() {
    try {
        const raw = sessionStorage.getItem(incomingCallStorageKey);
        if (!raw) return;

        const payload = JSON.parse(raw);
        if (!payload?.from || !payload?.sdp) return;
        if (Number(payload.from) !== peerId) return;

        pendingOffer = normalizeSDP(payload.sdp);
        incomingFrom = Number(payload.from);
        targetUserId = incomingFrom;
        remoteCandQueue = Array.isArray(payload.candidates)
            ? payload.candidates.map((candidate) => new RTCIceCandidate(candidate))
            : [];

        setStatus(`Входящий звонок от #${incomingFrom}`);
        appendActivity(`Восстановлен входящий offer от пользователя #${incomingFrom}.`);
        if (remoteCandQueue.length) {
            appendActivity(`Восстановлено ${remoteCandQueue.length} ранних ICE candidate из sessionStorage.`);
        }
        sessionStorage.removeItem(incomingCallStorageKey);
        syncControls();
    } catch (error) {
        console.warn('failed to restore incoming call', error);
        appendActivity('Не удалось восстановить входящий звонок из sessionStorage.', 'error');
    }
}

async function postJSON(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': csrf,
            'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'same-origin',
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed: ${response.status}`);
    }

    return response;
}

async function getLocalStream() {
    if (isMockMode) {
        appendActivity('Локальный режим активен: камера и микрофон не запрашиваются.');
        setStatus('Сессия готова без камеры/микрофона');
        syncPlaceholders();
        return null;
    }

    if (localStream) {
        return localStream;
    }

    const constraints = {
        audio: true,
        video: { width: 1280, height: 720 },
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    originalVideoTrack = localStream.getVideoTracks()[0] || null;

    if (elLocal) {
        elLocal.muted = true;
        elLocal.srcObject = localStream;
        elLocal.onloadedmetadata = () => elLocal.play?.().catch(() => {});
    }

    if (elLocalAudio) {
        elLocalAudio.muted = true;
        elLocalAudio.srcObject = localStream;
        elLocalAudio.onloadedmetadata = () => elLocalAudio.play?.().catch(() => {});
    }

    appendActivity('Камера и микрофон успешно инициализированы.');
    setStatus('Камера и микрофон готовы');
    syncPlaceholders();
    syncControls();

    return localStream;
}

function stopRandomNumbers() {
    if (randomNumberInterval) {
        window.clearInterval(randomNumberInterval);
        randomNumberInterval = null;
    }
}

function sendRandomNumber() {
    if (!isMockMode || !dataChannel || dataChannel.readyState !== 'open') return;

    const value = Math.floor(Math.random() * 90) + 10;
    const payload = {
        type: 'random-number',
        value,
        from: me,
        sentAt: new Date().toISOString(),
    };

    dataChannel.send(JSON.stringify(payload));
    updateNumberBoard('sent', value, `Отправлено в ${new Date().toLocaleTimeString()} пользователю #${targetUserId || peerId}`);
    appendActivity(`Отправлено число ${value} пользователю #${targetUserId || peerId}.`);
}

function startRandomNumbers() {
    if (!isMockMode || randomNumberInterval || !dataChannel || dataChannel.readyState !== 'open') return;

    sendRandomNumber();
    randomNumberInterval = window.setInterval(sendRandomNumber, 2000);
    appendActivity('Запущен обмен случайными двузначными числами каждые 2 секунды.');
}

function attachDataChannel(channel) {
    if (!channel) return;

    dataChannel = channel;

    dataChannel.onopen = () => {
        setStatus('Data-channel открыт');
        appendActivity(`Data-channel \"${channel.label}\" открыт.`);
        startRandomNumbers();
        syncControls();
    };

    dataChannel.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data);
            if (payload?.type !== 'random-number') return;

            updateNumberBoard('received', payload.value, `Получено в ${new Date().toLocaleTimeString()} от пользователя #${payload.from || targetUserId || peerId}`);
            appendActivity(`Получено число ${payload.value} от пользователя #${payload.from || targetUserId || peerId}.`);
        } catch (error) {
            console.warn('data channel message parse failed', error);
            appendActivity('Не удалось разобрать входящее сообщение data-channel.', 'error');
        }
    };

    dataChannel.onerror = (error) => {
        console.warn('data channel error', error);
        appendActivity('Ошибка data-channel.', 'error');
    };

    dataChannel.onclose = () => {
        stopRandomNumbers();
        appendActivity(`Data-channel \"${channel.label}\" закрыт.`);
        syncControls();
    };
}

function bindRemoteMediaTrack(event) {
    if (!remoteStream) {
        remoteStream = new MediaStream();
    }

    event.streams[0]?.getTracks().forEach((track) => {
        const exists = remoteStream.getTracks().some((item) => item.id === track.id);
        if (!exists) {
            remoteStream.addTrack(track);
        }
    });

    if (elRemote) {
        elRemote.srcObject = remoteStream;
        elRemote.onloadedmetadata = () => elRemote.play?.().catch(() => {});
    }

    if (elRemoteAudio) {
        elRemoteAudio.srcObject = remoteStream;
        elRemoteAudio.onloadedmetadata = () => elRemoteAudio.play?.().catch(() => {});
    }

    syncPlaceholders();
}

function createPeer() {
    if (pc) {
        try {
            pc.close();
        } catch {}
    }

    pc = new RTCPeerConnection(rtcConfig);
    canSendCandidates = false;

    if (!isMockMode && localStream) {
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    remoteStream = new MediaStream();
    if (elRemote) elRemote.srcObject = remoteStream;
    if (elRemoteAudio) elRemoteAudio.srcObject = remoteStream;

    pc.ontrack = (event) => {
        bindRemoteMediaTrack(event);
        appendActivity(`Получен удалённый ${event.track.kind}-track.`);
        setStatus(`Получен ${event.track.kind}-поток собеседника`);
    };

    pc.ondatachannel = (event) => {
        appendActivity(`Получен входящий data-channel \"${event.channel.label}\".`);
        attachDataChannel(event.channel);
    };

    pc.onicecandidate = (event) => {
        if (!event.candidate || !canSendCandidates || !targetUserId) return;

        postJSON('/call/candidate', { to: targetUserId, candidate: event.candidate.toJSON() })
            .catch((error) => {
                console.warn('candidate send failed', error);
                appendActivity('Не удалось отправить ICE candidate.', 'error');
            });
    };

    pc.oniceconnectionstatechange = () => {
        appendActivity(`ICE state: ${pc.iceConnectionState}`);
    };

    pc.onconnectionstatechange = () => {
        setStatus(`conn: ${pc.connectionState}`);
        appendActivity(`Connection state: ${pc.connectionState}`);

        if (pc.connectionState === 'connected') {
            inCall = true;
            startRandomNumbers();
        }

        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
            stopRandomNumbers();
        }

        syncControls();
    };

    syncControls();
    syncPlaceholders();
}

async function flushRemoteCandidates() {
    if (!pc?.remoteDescription) return;

    while (remoteCandQueue.length) {
        const candidate = remoteCandQueue.shift();
        try {
            await pc.addIceCandidate(candidate);
            appendActivity('Добавлен отложенный ICE candidate.');
        } catch (error) {
            console.warn('flush ICE error', error);
            appendActivity('Ошибка добавления отложенного ICE candidate.', 'error');
        }
    }
}

async function ensureReady() {
    if (!subscribed) {
        subscribeEcho();
    }

    if (!isMockMode && !localStream) {
        await getLocalStream();
    }

    if (!pc) {
        createPeer();
    }

    syncControls();
}

function subscribeEcho() {
    if (subscribed || !window.Echo || !me) {
        return;
    }

    window.Echo.private(`call.${me}`)
        .subscribed(() => {
            appendActivity(`Подписка на private channel call.${me} активна.`);
            setStatus('Ожидание сигналинга');
        })
        .error((error) => {
            console.error('subscription error', error);
            appendActivity('Ошибка подписки на приватный канал.', 'error');
            setStatus('Ошибка подписки на канал');
        })
        .listen('.call.offer', async (event) => {
            pendingOffer = normalizeSDP(event.sdp);
            incomingFrom = Number(event.from);
            remoteCandQueue = [];
            targetUserId = incomingFrom;

            appendActivity(`Получен OFFER от пользователя #${incomingFrom}.`);
            setStatus(`Входящий звонок от #${incomingFrom}`);
            syncControls();
        })
        .listen('.call.answer', async (event) => {
            if (!pc) {
                appendActivity('ANSWER получен до инициализации peer connection.', 'error');
                return;
            }

            try {
                await pc.setRemoteDescription(new RTCSessionDescription(normalizeSDP(event.sdp)));
                await flushRemoteCandidates();
                inCall = true;
                appendActivity(`Получен ANSWER от пользователя #${event.from}.`);
                setStatus('Получен ANSWER, соединение устанавливается');
                syncControls();
            } catch (error) {
                console.warn('setRemoteDescription(answer) failed', error);
                appendActivity('Не удалось применить ANSWER.', 'error');
            }
        })
        .listen('.call.candidate', async (event) => {
            if (!event?.candidate) {
                return;
            }

            const candidate = new RTCIceCandidate(event.candidate);

            if (!pc || !pc.remoteDescription) {
                remoteCandQueue.push(candidate);
                appendActivity(`ICE candidate от #${event.from} поставлен в очередь.`);
                return;
            }

            try {
                await pc.addIceCandidate(candidate);
                appendActivity(`Получен и применён ICE candidate от #${event.from}.`);
            } catch (error) {
                console.warn('addIceCandidate failed', error);
                appendActivity('Не удалось применить входящий ICE candidate.', 'error');
            }
        });

    subscribed = true;

    if (window.Echo?.connector?.pusher?.connection) {
        window.Echo.connector.pusher.connection.bind('state_change', (state) => {
            appendActivity(`WebSocket state: ${state.current}`);
        });
        window.Echo.connector.pusher.connection.bind('error', (error) => {
            console.error('ws error', error);
            appendActivity('Ошибка WebSocket соединения.', 'error');
        });
    }
}

async function initSession() {
    await ensureReady();
    setStatus(isMockMode ? 'Сессия data-channel готова' : 'Media-сессия готова');
    appendActivity(isMockMode
        ? 'Сессия data-channel готова: можно звонить и обмениваться числами.'
        : 'Media-сессия готова: можно звонить с аудио/видео.');
    syncControls();
}

// ===== кнопки =====

// Caller: «Позвонить»
async function startCall() {
    await ensureReady();

    targetUserId = peerId;

    if (isMockMode && (!dataChannel || dataChannel.readyState === 'closed')) {
        attachDataChannel(pc.createDataChannel('random-numbers'));
        appendActivity('Создан исходящий data-channel для локального режима.');
    }

    const offer = await pc.createOffer(isMockMode ? undefined : { offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    canSendCandidates = true;

    await postJSON('/call/offer', { to: targetUserId, sdp: sdpToJSON(pc.localDescription) });

    appendActivity(`Отправлен OFFER пользователю #${targetUserId}.`);
    setStatus('OFFER отправлен, ожидаем ответ');
    syncControls();
}

// Callee: «Ответить»
async function answerManually() {
    if (!pendingOffer || !incomingFrom) {
        setStatus('Нет входящего предложения');
        appendActivity('Нажатие на «Ответить» без pending offer.', 'error');
        return;
    }

    await ensureReady();

    if (pc.signalingState === 'have-local-offer') {
        setStatus('Вы уже инициировали звонок');
        appendActivity('Ответ отклонён: локальный offer уже создан.');
        return;
    }

    targetUserId = incomingFrom;

    await pc.setRemoteDescription(new RTCSessionDescription(normalizeSDP(pendingOffer)));
    await flushRemoteCandidates();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    canSendCandidates = true;

    await postJSON('/call/answer', { to: targetUserId, sdp: sdpToJSON(pc.localDescription) });

    appendActivity(`Отправлен ANSWER пользователю #${targetUserId}.`);
    setStatus('ANSWER отправлен, завершаем соединение');

    pendingOffer = null;
    incomingFrom = null;
    syncControls();
}

function stopStream(stream) {
    try {
        stream?.getTracks?.().forEach((track) => track.stop());
    } catch {}
}

function hangup() {
    stopRandomNumbers();

    canSendCandidates = false;
    targetUserId = null;
    pendingOffer = null;
    incomingFrom = null;
    inCall = false;
    remoteCandQueue = [];
    screenShareActive = false;

    if (dataChannel) {
        try {
            dataChannel.onopen = null;
            dataChannel.onmessage = null;
            dataChannel.onclose = null;
            dataChannel.onerror = null;
            dataChannel.close();
        } catch {}
        dataChannel = null;
    }

    if (pc) {
        try {
            pc.ontrack = null;
            pc.onicecandidate = null;
            pc.ondatachannel = null;
            pc.close();
        } catch {}
        pc = null;
    }

    stopStream(localStream);
    stopStream(remoteStream);

    if (originalVideoTrack && originalVideoTrack.readyState !== 'ended') {
        try {
            originalVideoTrack.stop();
        } catch {}
    }

    localStream = null;
    remoteStream = null;
    originalVideoTrack = null;

    if (elLocal) elLocal.srcObject = null;
    if (elRemote) elRemote.srcObject = null;
    if (elLocalAudio) elLocalAudio.srcObject = null;
    if (elRemoteAudio) elRemoteAudio.srcObject = null;

    resetNumberBoard();
    syncPlaceholders();
    syncControls();
    setStatus('Вызов завершён');
    appendActivity('Текущая сессия завершена.');
}

function toggleMic() {
    if (isMockMode || !localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    audioTrack.enabled = !audioTrack.enabled;
    appendActivity(audioTrack.enabled ? 'Микрофон включён.' : 'Микрофон выключен.');
    syncControls();
}

function toggleCam() {
    if (isMockMode || !localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    videoTrack.enabled = !videoTrack.enabled;
    appendActivity(videoTrack.enabled ? 'Камера включена.' : 'Камера выключена.');
    syncControls();
}

async function toggleScreenShare() {
    if (isMockMode || !localStream || !pc) return;

    const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
    if (!sender) return;

    if (!screenShareActive) {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const displayTrack = displayStream.getVideoTracks()[0];
        if (!displayTrack) return;

        displayTrack.onended = () => {
            if (screenShareActive) {
                toggleScreenShare().catch((error) => {
                    console.warn('screen share reset failed', error);
                    appendActivity('Не удалось вернуть камеру после шэра экрана.', 'error');
                });
            }
        };

        const currentTrack = localStream.getVideoTracks()[0];
        await sender.replaceTrack(displayTrack);
        if (currentTrack) {
            localStream.removeTrack(currentTrack);
        }
        localStream.addTrack(displayTrack);
        if (elLocal) elLocal.srcObject = localStream;
        screenShareActive = true;
        if (btnShare) btnShare.textContent = 'Остановить шаринг';
        appendActivity('Шэр экрана включён.');
        syncControls();
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
    appendActivity('Шэр экрана выключен, камера возвращена.');
    syncControls();
}

btnInit?.addEventListener('click', () => {
    initSession().catch((error) => {
        console.warn('init failed', error);
        appendActivity('Не удалось открыть сессию.', 'error');
        setStatus('Не удалось открыть сессию');
    });
});

btnCall?.addEventListener('click', () => {
    startCall().catch((error) => {
        console.warn('call start failed', error);
        appendActivity('Не удалось отправить offer.', 'error');
        setStatus('Не удалось начать звонок');
    });
});

btnAnswer?.addEventListener('click', () => {
    answerManually().catch((error) => {
        console.warn('answer failed', error);
        appendActivity('Не удалось ответить на звонок.', 'error');
        setStatus('Не удалось ответить');
    });
});

btnHangup?.addEventListener('click', hangup);
btnMic?.addEventListener('click', toggleMic);
btnCam?.addEventListener('click', toggleCam);
btnShare?.addEventListener('click', () => {
    toggleScreenShare().catch((error) => {
        console.warn('screen share failed', error);
        appendActivity('Не удалось включить шэр экрана.', 'error');
        setStatus('Ошибка шэра экрана');
    });
});

let pageInitialized = false;

function initCallPage() {
    if (pageInitialized) return;
    pageInitialized = true;

    resetNumberBoard();
    updateModeUi();
    syncPlaceholders();
    syncControls();
    subscribeEcho();
    restorePendingIncomingCall();
    setStatus(isMockMode ? 'Локальный режим готов к data-channel соединению' : 'Готов к инициализации media-сессии');

    if (isMockMode) {
        initSession().catch((error) => {
            console.warn('auto init failed', error);
            appendActivity('Автоинициализация local-режима не удалась.', 'error');
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCallPage, { once: true });
} else {
    initCallPage();
}

window.addEventListener('beforeunload', () => {
    stopRandomNumbers();
    try {
        dataChannel?.close();
        pc?.close();
    } catch {}
});
