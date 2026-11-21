// ==UserScript==
// @name         YODAWY CLOUD DASHBOARD LOADER
// @namespace    https://github.com/m-saleh-yodawy
// @version      1
// @description  Authenticated Yodawy Cloudflare Dashboard Loader
// @author       Mohamed Saleh
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      yodawy-dashboard.m-saleh-yodawy.workers.dev
// @run-at       document-end
// @noframes
// ==/UserScript==

(async () => {
    'use strict';

    const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const API = 'https://yodawy-dashboard.m-saleh-yodawy.workers.dev';
    if (window.__YD_CLOUD_LOADER__ || PAGE.__YD_CLOUD_LOADER__) return;

    const release = () => {
        delete window.__YD_CLOUD_LOADER__;
        delete PAGE.__YD_CLOUD_LOADER__;
    };
    const get = url => new Promise((resolve, reject) => GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: true,
        nocache: true,
        timeout: 8000,
        onload: response => response.status === 200 && typeof response.responseText === 'string' && response.responseText.trim() ? resolve(response.responseText) : reject(new Error('REMOTE_CONFIG_UNAVAILABLE')),
        onerror: reject,
        ontimeout: reject,
        onabort: reject
    }));
    const matches = (pattern, value) => {
        const parts = String(pattern).split('*');
        if (parts.length === 1) return value === pattern;
        let position = 0;
        for (let index = 0; index < parts.length; index++) {
            const part = parts[index];
            if (!part) continue;
            const found = value.indexOf(part, position);
            if (found < 0 || (index === 0 && found !== 0)) return false;
            if (index === parts.length - 1 && found + part.length !== value.length) return false;
            position = found + part.length;
        }
        return true;
    };

    window.__YD_CLOUD_LOADER__ = true;
    PAGE.__YD_CLOUD_LOADER__ = true;

    try {
        const config = JSON.parse(await get(API + '/site-access.json?v=' + Date.now()));
        const hostname = String(PAGE.location.hostname || '').toLowerCase();
        const protocol = PAGE.location.protocol;
        const pathname = PAGE.location.pathname || '/';
        const enabled = config?.enabled === true && Array.isArray(config.sites) && config.sites.some(site => {
            const host = String(site?.host || '').toLowerCase();
            const protocols = Array.isArray(site?.protocols) ? site.protocols : ['https:'];
            return site?.enabled === true &&
                (host === hostname || (host.startsWith('*.') && hostname.endsWith(host.slice(1)))) &&
                protocols.includes(protocol) &&
                Array.isArray(site.paths) &&
                site.paths.some(path => matches(path, pathname));
        });
        if (!enabled) return release();

        const source = await get(API + '/cloud-bootstrap.js?v=' + Date.now());
        await new Function('PAGE', 'STORE', source)(PAGE, {
            get: key => GM_getValue(key, ''),
            set: (key, value) => GM_setValue(key, value),
            remove: key => GM_deleteValue(key)
        });
    } catch {
        release();
    }
})();