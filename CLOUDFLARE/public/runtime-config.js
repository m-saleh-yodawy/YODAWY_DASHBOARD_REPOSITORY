(() => {
    'use strict';
    const config = Object.freeze({
        API_BASE: 'https://yodawy-dashboard.m-saleh-yodawy.workers.dev',
        AUTH_PATH: '/api/auth',
        VERSION: 1
    });
    Object.defineProperty(window, 'YODAWY_CLOUDFLARE_CONFIG', {
        value: config,
        configurable: false,
        enumerable: false,
        writable: false
    });
})();