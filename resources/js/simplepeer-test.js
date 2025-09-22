import Peer from 'simple-peer';

const $ = s => document.querySelector(s);
const vLocal = $('#local');
const vRemote = $('#remote');

async function getStream() {
    // сразу спросим разрешение
    try {
        // мягкие constraints
        const s = await navigator.mediaDevices.getUserMedia({
            video: true, // без exact и без размеров, чтобы не ловить Overconstrained
            audio: true,
        });
        return s;
    } catch (e) {
        console.error('getUserMedia error:', e);
        if (e.name === 'NotFoundError') {
            // пробуем хотя бы аудио
            try { return await navigator.mediaDevices.getUserMedia({ audio: true }); }
            catch {}
        }
        throw e;
    }
}

function attachStream(el, stream) { el.srcObject = stream; }

async function start() {
    // полезно глянуть, что видит браузер
    try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        console.table(devs.map(d => ({kind:d.kind, label:d.label, id:d.deviceId})));
    } catch {}

    let stream;
    try {
        stream = await getStream();
    } catch (e) {
        const tip = (location.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(location.hostname))
            ? ' Открой по https ИЛИ по http://localhost.'
            : '';
        alert(`Ошибка доступа к устройствам: ${e.name}. ${tip}`);
        return;
    }

    // покажем локальное
    attachStream(vLocal, stream);

    // два пира на одной странице (loopback)
    const peer1 = new Peer({ initiator: true, trickle: false, stream });
    const peer2 = new Peer({ initiator: false, trickle: false });

    peer1.on('signal', data => peer2.signal(data));
    peer2.on('signal', data => peer1.signal(data));

    peer2.on('stream', remoteStream => {
        // получили удалённый — показываем
        attachStream(vRemote, remoteStream);
    });

    // отладка
    peer1.on('error', e => console.error('peer1 error', e));
    peer2.on('error', e => console.error('peer2 error', e));
}

document.addEventListener('DOMContentLoaded', start);
