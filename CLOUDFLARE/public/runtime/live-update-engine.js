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
    const refreshData = async () => {
        const app = global.YODAWY;
        if (!app?.api || document.visibilityState === 'hidden') return false;
        await app.api.refresh();
        const engine = app.userRole === 'SUPER_ADMIN' ? global.YODAWY_SUPER_ADMIN_ENGINE : app.userRole === 'ADMIN' ? global.YODAWY_ADMIN_ENGINE : global.YODAWY_USER_ENGINE;
        await Promise.all([app.permissions?.load?.(), app.visibility?.load?.(), app.settings?.load?.(), app.announcements?.load?.(), engine?.refresh?.()]);
        await app.tools.loadManifest();
        await app.tools.sync();
        await app.ui.refresh();
        global.dispatchEvent(new CustomEvent('yodawy-live-updated', { detail: { type: 'data-tools' } }));
        return true;
    };
    const check = async () => {
        if (running || document.visibilityState === 'hidden') return;
        running = true;
        try {
            const current = await request('/api/version');
            if (current.success && current.version && current.version !== 'unversioned') {
                if (!version) version = current.version;
                else if (version !== current.version) {
                    version = current.version;
                    global.dispatchEvent(new CustomEvent('yodawy-deployment-detected', { detail: { version } }));
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