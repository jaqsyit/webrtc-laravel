const me = Number(document.querySelector('meta[name="user-id"]')?.content || 0);
const isCallPage = Boolean(document.querySelector('#local') && document.querySelector('#remote'));
const pendingKey = 'incoming-call';

function saveIncomingCall(payload) {
    try {
        sessionStorage.setItem(pendingKey, JSON.stringify({
            ...payload,
            receivedAt: Date.now(),
        }));
    } catch (error) {
        console.warn('failed to store incoming call', error);
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
            });

            const accepted = window.confirm(`Входящий звонок от пользователя #${event.from}. Перейти к звонку?`);
            if (accepted) {
                redirectToCall(event.from);
            }
        });
};

void initIncomingCallListener;
