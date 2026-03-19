import './bootstrap';

import Alpine from 'alpinejs';
import { initIncomingCallListener } from './incoming-call';

const isCallPage = Boolean(document.querySelector('#local') && document.querySelector('#remote'));

if (isCallPage) {
    import('./call.js').catch((error) => {
        console.error('failed to load call page module', error);
        const status = document.querySelector('#status');
        if (status) {
            status.textContent = 'Статус: не удалось загрузить модуль звонка';
        }
    });
} else {
    initIncomingCallListener();
}

window.Alpine = Alpine;

Alpine.start();
