(function (global) {
    'use strict';
    if (global.YODAWY_LIVE_UPDATE_ENGINE?.version >= 3) return;
    const API = 'https://yodawy-dashboard.m-saleh-yodawy.workers.dev';
    const INTERVAL = 15000;
    const MAX_INTERVAL = 120000;
    const MANIFEST_INTERVAL = 60000;
    let timer = null;
    let running = false;
    let stopped = true;
    let version = '';
    let pendingToolsVersion = '';
    let pendingUIVersion = '';
    let failures = 0;
    let lastCheck = 0;
    let lastManifestCheck = 0;
    let lastToolUpdate = 0;
    let lastUIUpdate = 0;
    let lastError = '';
    const emit = (name, detail = {}) => global.dispatchEvent(new CustomEvent(name, { detail }));
    const request = async path => {
        const response = await fetch(API + path, { cache: 'no-store', credentials: 'omit' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data || typeof data !== 'object') {
            const error = new Error(data.error || 'LIVE_UPDATE_REQUEST_FAILED');
            error.status = response.status;
            throw error;
        }
        return data;
    };
    const hasActiveWork = () => {
        const root = document.getElementById('yd-dashboard-root');
        const active = document.activeElement;
        const modal = document.querySelector('body > .yd-modal-backdrop, .yd-modal-backdrop[aria-modal="true"]');
        const editing = active?.matches?.('input,textarea,select,[contenteditable="true"]');
        return Boolean(modal || (editing && (root?.contains(active) || modal?.contains(active))));
    };
    const getRoleEngine = app => app.userRole === 'SUPER_ADMIN'
        ? global.YODAWY_SUPER_ADMIN_ENGINE
        : app.userRole === 'ADMIN'
            ? global.YODAWY_ADMIN_ENGINE
            : global.YODAWY_USER_ENGINE;
    const syncTools = async sourceVersion => {
        const app = global.YODAWY;
        if (!app?.tools?.loadManifest || !app?.tools?.sync) return false;
        lastManifestCheck = Date.now();
        const previousManifest = JSON.stringify(app.tools.getManifest?.() || []);
        const previousLoaded = new Map((app.tools.getLoadedTools?.() || []).map(tool => [tool.id, tool.sha256]));
        await app.tools.loadManifest();
        const nextManifest = JSON.stringify(app.tools.getManifest?.() || []);
        await app.tools.sync();
        const loaded = app.tools.getLoadedTools?.() || [];
        const nextLoaded = new Map(loaded.map(tool => [tool.id, tool.sha256]));
        const updated = loaded.filter(tool => previousLoaded.get(tool.id) !== tool.sha256).map(tool => tool.id);
        const removed = [...previousLoaded.keys()].filter(id => !nextLoaded.has(id));
        const syncFailures = app.tools.getSyncFailures?.() || [];
        const unavailable = app.tools.getUnavailableTools?.() || [];
        if (previousManifest !== nextManifest || updated.length || removed.length || unavailable.length) {
            lastToolUpdate = Date.now();
            emit('yodawy-live-updated', { type: 'tools', version: sourceVersion || version, updated, removed, unavailable, failures: syncFailures });
        }
        if (syncFailures.length) {
            lastError = syncFailures[0].message || 'TOOL_SYNC_FAILED';
            emit('yodawy-tools-sync-error', { failures: syncFailures, version: sourceVersion || version });
            return false;
        }
        return true;
    };
    const refreshData = async () => {
        const app = global.YODAWY;
        if (!app?.api || document.visibilityState === 'hidden' || hasActiveWork()) return false;
        const previous = JSON.stringify(global.YODAWY_CLOUD_CONTEXT?.data || {});
        await app.api.refresh();
        const current = JSON.stringify(global.YODAWY_CLOUD_CONTEXT?.data || {});
        if (previous === current) return false;
        const engine = getRoleEngine(app);
        await Promise.all([
            app.permissions?.load?.(),
            app.visibility?.load?.(),
            app.settings?.load?.(),
            app.announcements?.load?.(),
            engine?.refresh?.()
        ]);
        await syncTools(version);
        await app.ui?.refresh?.();
        emit('yodawy-live-updated', { type: 'data', version });
        return true;
    };
    const loadUI = nextVersion => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = API + '/runtime/dashboard-ui.js?v=' + encodeURIComponent(nextVersion) + '&t=' + Date.now();
        script.async = true;
        script.onload = () => {
            script.remove();
            resolve(global.YODAWY_DASHBOARD_UI);
        };
        script.onerror = () => {
            script.remove();
            reject(new Error('DASHBOARD_UI_UPDATE_FAILED'));
        };
        (document.head || document.documentElement).append(script);
    });
    const hotSwapUI = async nextVersion => {
        const app = global.YODAWY;
        const previous = app?.ui;
        if (!app || !previous || typeof previous.getHotState !== 'function' || typeof previous.destroy !== 'function' || hasActiveWork()) return false;
        const state = previous.getHotState();
        const stoppedUI = await previous.destroy();
        if (stoppedUI === false) return false;
        delete global.YODAWY_DASHBOARD_UI;
        try {
            const next = await loadUI(nextVersion);
            if (!next || next === previous || typeof next.init !== 'function') throw new Error('DASHBOARD_UI_UPDATE_FAILED');
            app.ui = next;
            await next.init({ ...app, uiState: state });
            lastUIUpdate = Date.now();
            emit('yodawy-live-updated', { type: 'dashboard-ui', version: nextVersion });
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
        if (running || stopped || document.visibilityState === 'hidden') return false;
        running = true;
        try {
            const current = await request('/api/version');
            const currentVersion = String(current.version || '');
            if (current.success && currentVersion && currentVersion !== 'unversioned') {
                if (!version) version = currentVersion;
                else if (version !== currentVersion) {
                    version = currentVersion;
                    pendingToolsVersion = currentVersion;
                    pendingUIVersion = currentVersion;
                }
                if (!pendingToolsVersion && Date.now() - lastManifestCheck >= MANIFEST_INTERVAL) pendingToolsVersion = currentVersion;
            } else if (Date.now() - lastManifestCheck >= MANIFEST_INTERVAL) {
                pendingToolsVersion = currentVersion || 'unversioned';
            }
            if (pendingToolsVersion) {
                if (await syncTools(pendingToolsVersion)) pendingToolsVersion = '';
            }
            if (pendingUIVersion && await hotSwapUI(pendingUIVersion)) pendingUIVersion = '';
            await refreshData();
            lastCheck = Date.now();
            failures = 0;
            if (!lastError || !pendingToolsVersion) lastError = '';
            emit('yodawy-live-update-status', getStatus());
            return true;
        } catch (error) {
            failures = Math.min(failures + 1, 8);
            lastError = error?.message || 'LIVE_UPDATE_FAILED';
            emit('yodawy-live-update-error', { message: lastError, failures });
            if (!version) lastManifestCheck = 0;
            return false;
        } finally {
            running = false;
        }
    };
    const nextDelay = () => Math.min(INTERVAL * (2 ** failures), MAX_INTERVAL);
    const scheduleNext = () => {
        if (stopped) return;
        clearTimeout(timer);
        timer = setTimeout(async () => {
            timer = null;
            await check();
            scheduleNext();
        }, nextDelay());
    };
    const onOnline = () => { check(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') check(); };
    const start = async () => {
        if (!stopped) return true;
        stopped = false;
        global.addEventListener('online', onOnline);
        document.addEventListener('visibilitychange', onVisibility);
        await check();
        scheduleNext();
        return true;
    };
    const stop = () => {
        stopped = true;
        clearTimeout(timer);
        timer = null;
        global.removeEventListener('online', onOnline);
        document.removeEventListener('visibilitychange', onVisibility);
        return true;
    };
    function getStatus() {
        return {
            running: !stopped,
            checking: running,
            version,
            pendingToolsVersion,
            pendingUIVersion,
            failures,
            lastCheck,
            lastManifestCheck,
            lastToolUpdate,
            lastUIUpdate,
            lastError
        };
    }
    global.YODAWY_LIVE_UPDATE_ENGINE = Object.freeze({ version: 3, start, stop, check, getStatus });
})(window);
