// ==UserScript==
// @name         YODAWY CLOUD LOADER
// @namespace    https://github.com/m-saleh-yodawy
// @version      1
// @description  Yodawy Cloudflare Dashboard Loader
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/*
// @match        https://portal.yodawy.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      yodawy-dashboard.m-saleh-yodawy.workers.dev
// @run-at       document-end
// ==/UserScript==

(async () => {
    'use strict';
    if (window.__YD_CLOUD_LOADER__) return;
    window.__YD_CLOUD_LOADER__ = true;
    const API = 'https://yodawy-dashboard.m-saleh-yodawy.workers.dev';
    const fail = () => {
        if (document.getElementById('yd-cloud-unavailable')) return;
        const node = document.createElement('div');
        node.id = 'yd-cloud-unavailable';
        node.textContent = 'CANNOT REACH SYSTEM';
        node.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#17131a;color:#fff;font:700 16px Arial,sans-serif;letter-spacing:1px';
        document.documentElement.append(node);
    };
    try {
        const source = await new Promise((resolve, reject) => GM_xmlhttpRequest({
            method: 'GET',
            url: API + '/cloud-bootstrap.js',
            headers: { 'Cache-Control': 'no-cache' },
            onload: response => response.status === 200 ? resolve(response.responseText) : reject(new Error('UNAVAILABLE')),
            onerror: () => reject(new Error('UNAVAILABLE')),
            ontimeout: () => reject(new Error('UNAVAILABLE')),
            timeout: 12000
        }));
        await new Function('PAGE', 'STORE', source)(typeof unsafeWindow === 'undefined' ? window : unsafeWindow, {
            get: key => GM_getValue(key, ''),
            set: (key, value) => GM_setValue(key, value),
            remove: key => GM_deleteValue(key)
        });
    } catch {
        fail();
    }
})();