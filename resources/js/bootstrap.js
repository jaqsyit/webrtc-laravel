import axios from 'axios';
window.axios = axios;

window.axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

/**
 * Echo exposes an expressive API for subscribing to channels and listening
 * for events that are broadcast by Laravel. Echo and event broadcasting
 * allow your team to quickly build robust real-time web applications.
 */

import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
window.Pusher = Pusher;

const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
const reverbHost = import.meta.env.VITE_REVERB_HOST;
const reverbPort = Number(import.meta.env.VITE_REVERB_PORT || 443);
const reverbScheme = import.meta.env.VITE_REVERB_SCHEME || 'https';
const useTls = reverbScheme === 'https';

window.Echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: reverbHost,
    wsPort: reverbPort,
    wssPort: reverbPort,
    forceTLS: useTls,
    enabledTransports: useTls ? ['wss'] : ['ws', 'wss'],

    authEndpoint: '/broadcasting/auth',
    auth: {
        headers: {
            'X-CSRF-TOKEN': csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
        },
    },
});
