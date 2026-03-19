const me = Number(document.querySelector('meta[name="user-id"]')?.content || 0);
const isCallPage = Boolean(document.querySelector('#local') && document.querySelector('#remote'));
const pendingKey = 'incoming-call';

function getStoredIncomingCall() {
    try {
        const raw = sessionStorage.getItem(pendingKey);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('failed to read pending incoming call', error);
        return null;
    }
}

function saveIncomingCall(payload) {
    try {
        const existing = getStoredIncomingCall();
        sessionStorage.setItem(pendingKey, JSON.stringify({
            ...existing,
            ...payload,
            candidates: payload.candidates ?? existing?.candidates ?? [],
            receivedAt: Date.now(),
        }));
    } catch (error) {
        console.warn('failed to store incoming call', error);
    }
}

function appendIncomingCandidate(payload) {
    try {
        const existing = getStoredIncomingCall();
        if (!existing?.from || Number(existing.from) !== Number(payload.from)) return;

        saveIncomingCall({
            ...existing,
            candidates: [...(existing.candidates || []), payload.candidate],
        });
    } catch (error) {
        console.warn('failed to store incoming candidate', error);
    }
}

function redirectToCall(fromUserId) {
    window.location.href = `/video/${fromUserId}`;
}

export const initIncomingCallListener = () => {
    if (!me || isCallPage || !window.Echo) return;

    window.Echo.private('call.' + me)
        .subscribed(() => console.log('✅ global incoming listener subscribed to call.' + me))
        .error((error) => console.error('❌ global incoming listener error', error))
        .listen('.call.offer', (event) => {
            if (!event?.from || !event?.sdp) return;

            saveIncomingCall({
                from: event.from,
                sdp: event.sdp,
                candidates: [],
            });

            const accepted = window.confirm(`Входящий звонок от пользователя #${event.from}. Перейти к звонку?`);
            if (accepted) {
                redirectToCall(event.from);
            }
        })
        .listen('.call.candidate', (event) => {
            if (!event?.from || !event?.candidate) return;
            appendIncomingCandidate({
                from: event.from,
                candidate: event.candidate,
            });
        });
};

void initIncomingCallListener;
