(function (global) {
    'use strict';
    if (global.YODAWY_LIVE_UPDATE_ENGINE) return;
    const API = 'https://yodawy-dashboard.m-saleh-yodawy.workers.dev';
    const INTERVAL = 15000;
    let timer = null;
    let running = false;
    let version = '';
    let failures = 0;
    const request = async path => {
        const response = await fetch(API + path, { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw new Error('LIVE_UPDATE_REQUEST_FAILED');
        return response.json();
    };
    const hasActiveWork = () => {
        const root = document.getElementById('yd-dashboard-root');
        const active = document.activeElement;
        return Boolean(root && ((active && root.contains(active) && active.matches('input,textarea,select,[contenteditable="true"]')) || root.querySelector('.yd-modal-backdrop')));
    };
    const refreshData = async () => {
        const app = global.YODAWY;
        if (!app?.api || document.visibilityState === 'hidden' || hasActiveWork()) return false;
        const previous = JSON.stringify(global.YODAWY_CLOUD_CONTEXT?.data || {});
        await app.api.refresh();
        const current = JSON.stringify(global.YODAWY_CLOUD_CONTEXT?.data || {});
        if (previous === current) return false;
        const engine = app.userRole === 'SUPER_ADMIN' ? global.YODAWY_SUPER_ADMIN_ENGINE : app.userRole === 'ADMIN' ? global.YODAWY_ADMIN_ENGINE : global.YODAWY_USER_ENGINE;
        await Promise.all([app.permissions?.load?.(), app.visibility?.load?.(), app.settings?.load?.(), app.announcements?.load?.(), engine?.refresh?.()]);
        await app.tools.loadManifest();
        await app.tools.sync();
        await app.ui.refresh();
        global.dispatchEvent(new CustomEvent('yodawy-live-updated', { detail: { type: 'data-tools' } }));
        return true;
    };
    const loadUI = version => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = API + '/runtime/dashboard-ui.js?v=' + encodeURIComponent(version);
        script.async = false;
        script.onload = () => { script.remove(); resolve(global.YODAWY_DASHBOARD_UI); };
        script.onerror = () => { script.remove(); reject(new Error('DASHBOARD_UI_UPDATE_FAILED')); };
        (document.head || document.documentElement).append(script);
    });
    const hotSwapUI = async nextVersion => {
        const app = global.YODAWY;
        const previous = app?.ui;
        if (!app || !previous || typeof previous.getHotState !== 'function' || typeof previous.destroy !== 'function' || hasActiveWork()) return false;
        const state = previous.getHotState();
        await previous.destroy();
        delete global.YODAWY_DASHBOARD_UI;
        try {
            const next = await loadUI(nextVersion);
            if (!next || typeof next.init !== 'function') throw new Error('DASHBOARD_UI_UPDATE_FAILED');
            app.ui = next;
            await next.init({ ...app, uiState: state });
            global.dispatchEvent(new CustomEvent('yodawy-live-updated', { detail: { type: 'dashboard-ui', version: nextVersion } }));
            return true;
        } catch (error) {
            delete global.YODAWY_DASHBOARD_UI;
            global.YODAWY_DASHBOARD_UI = previous;
            app.ui = previous;
            await previous.init({ ...app, uiState: state });
            throw error;
        }
    };
    const check = async () => {
        if (running || document.visibilityState === 'hidden') return;
        running = true;
        try {
            const current = await request('/api/version');
            if (current.success && current.version && current.version !== 'unversioned') {
                if (!version) version = current.version;
                else if (version !== current.version) {
                    const nextVersion = current.version;
                    if (await hotSwapUI(nextVersion)) {
                        version = nextVersion;
                        await refreshData();
                    }
                }
            }
            await refreshData();
            failures = 0;
        } catch { failures = Math.min(failures + 1, 8); }
        finally { running = false; }
    };
    const start = async () => {
        if (timer) return true;
        await check();
        timer = setInterval(check, Math.min(INTERVAL * (2 ** failures), 120000));
        global.addEventListener('online', check);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
        return true;
    };
    const stop = () => { if (timer) clearInterval(timer); timer = null; global.removeEventListener('online', check); return true; };
    global.YODAWY_LIVE_UPDATE_ENGINE = Object.freeze({ version: 1, start, stop, check });
})(window);