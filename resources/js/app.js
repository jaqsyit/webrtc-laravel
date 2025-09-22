import './bootstrap';

import Alpine from 'alpinejs';

if (document.querySelector('#local') && document.querySelector('#remote')) {
    import('./call.js');
}

window.Alpine = Alpine;

Alpine.start();
