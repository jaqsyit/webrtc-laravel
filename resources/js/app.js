import './bootstrap';

import Alpine from 'alpinejs';
import { initIncomingCallListener } from './incoming-call';

if (document.querySelector('#local') && document.querySelector('#remote')) {
    import('./call.js');
} else {
    initIncomingCallListener();
}

window.Alpine = Alpine;

Alpine.start();
