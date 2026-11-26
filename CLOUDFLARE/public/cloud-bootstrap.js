return (async function (PAGE, STORE) {
    'use strict';
    try { PAGE.YODAWY_INPUT_TYPOGRAPHY?.destroy?.(); } catch {}
const API = 'https://yodawy-dashboard.m-saleh-yodawy.workers.dev';
    const runtime = API + '/runtime/';
    const ASSET_VERSION = '20261126-destroy-lifecycle-v3';
    const installToolBoxSizing = () => {
        const id = 'yd-tools-box-sizing';
        if (PAGE.document.getElementById(id)) return;
        const scope = ':where([id^="yd"],[id^="tm"],[id^="ms-"],[id^="noitems"],[id^="ordered"],[class*="yd-"],[class*="yds-"],[class*="tm-"],[class*="ms-"],[class*="noitems-"],[class*="ordered-"])';
        const style = PAGE.document.createElement('style');
        style.id = id;
        style.textContent = scope + ',' + scope + ' *,' + scope + '::before,' + scope + '::after,' + scope + ' *::before,' + scope + ' *::after{box-sizing:border-box!important}';
        (PAGE.document.head || PAGE.document.documentElement).appendChild(style);
    };
    installToolBoxSizing();
    const messages = await fetch(API + '/system-messages.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : { messages: {} }).then(data => data.messages || {}).catch(() => ({}));
    const showError = failure => {
        if (PAGE.document.getElementById('yd-cloud-error')) return;
        const detail = String(failure?.message || failure || '').trim();
        const code = String(failure?.code || (messages[detail] ? detail : 'UNKNOWN_ERROR')).trim();
        const item = messages[code] || messages.UNKNOWN_ERROR || { title: 'SYSTEM ERROR', message: 'AN UNEXPECTED ERROR OCCURRED.' };
        const root = PAGE.document.createElement('div');
        root.id = 'yd-cloud-error';
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#17131acc;font:14px Arial,sans-serif';
        const card = PAGE.document.createElement('section');
        card.style.cssText = 'width:min(420px,calc(100% - 32px));padding:26px;border-radius:14px;background:#fff;color:#302833;border-top:5px solid #875A7B;box-shadow:0 18px 60px #0005';
        const title = PAGE.document.createElement('h3');
        title.textContent = item.title || 'SYSTEM ERROR';
        const message = PAGE.document.createElement('p');
        message.style.whiteSpace = 'pre-wrap';
        message.textContent = (item.message || 'AN UNEXPECTED ERROR OCCURRED.') + (detail && detail !== code && detail !== item.message ? '\n\nDETAIL: ' + detail : '') + '\nERROR CODE: ' + code;
        const button = PAGE.document.createElement('button');
        button.textContent = 'CLOSE';
        button.style.cssText = 'padding:10px 22px;border:0;border-radius:7px;background:#875A7B;color:#fff;cursor:pointer';
        button.onclick = () => root.remove();
        card.append(title, message, button);
        root.append(card);
        PAGE.document.body.append(root);
    };
    const request = async (path, options = {}) => {
        let response;
        try {
            response = await fetch(API + path, {
                method: options.method || 'GET',
                headers: { 'content-type': 'application/json', ...(options.token ? { authorization: 'Bearer ' + options.token } : {}) },
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                cache: 'no-store',
                credentials: 'omit'
            });
        } catch (cause) {
            const error = new Error('NETWORK_REQUEST_FAILED: ' + path + ' (' + String(cause?.message || cause || 'Network request failed') + ')');
            error.code = 'NETWORK_ERROR';
            error.status = 0;
            throw error;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.error || 'REQUEST_FAILED');
            error.code = data.error || 'REQUEST_FAILED';
            error.status = response.status;
            error.data = data;
            throw error;
        }
        return data;
    };
    const loadStyle = path => new Promise(resolve => {
        const id = 'yd-fa-icons-style';
        const href = runtime + path + '?v=' + ASSET_VERSION;
        const existing = PAGE.document.getElementById(id);
        if (existing?.href === href && existing.sheet) return resolve(true);
        const link = existing || PAGE.document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.crossOrigin = 'anonymous';
        link.href = href;
        link.onload = () => resolve(true);
        link.onerror = () => resolve(false);
        if (!existing) (PAGE.document.head || PAGE.document.documentElement).append(link);
    });
    const loadScript = path => new Promise((resolve, reject) => {
        const script = PAGE.document.createElement('script');
        script.src = runtime + path + '?v=' + ASSET_VERSION;
        script.async = false;
        script.onload = () => { script.remove(); resolve(true); };
        script.onerror = () => { script.remove(); reject(new Error('RUNTIME_ASSET_FAILED: ' + path)); };
        (PAGE.document.head || PAGE.document.documentElement).append(script);
    });
    let accessToken = '';
    let user = null;
    let context = null;
    const save = async token => token ? STORE.set('yd-cloud-refresh-v1', token) : STORE.remove('yd-cloud-refresh-v1');
    const apply = async data => {
        accessToken = data.accessToken;
        user = Object.freeze(data.user);
        await save(data.refreshToken);
    };
    let refreshTask = null;
    const refresh = async () => {
        if (refreshTask) return refreshTask;
        refreshTask = (async () => {
            const token = await STORE.get('yd-cloud-refresh-v1');
            if (!token) return false;
            try {
                await apply(await request('/api/auth/refresh', { method: 'POST', body: { refreshToken: token } }));
                return true;
            } catch (error) {
                await save('');
                if (error.status === 401) return false;
                throw error;
            }
        })();
        try { return await refreshTask; }
        finally { refreshTask = null; }
    };
    const authorizedRequest = async (path, options = {}) => {
        try {
            return await request(path, { ...options, token: accessToken });
        } catch (error) {
            if (error.status !== 401 || !await refresh()) throw error;
            return request(path, { ...options, token: accessToken });
        }
    };
    const mountLogin = () => new Promise(resolve => {
        const root = PAGE.document.createElement('div');
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#17131acc;font:14px Arial,sans-serif';
        const form = PAGE.document.createElement('form');
        form.style.cssText = 'width:min(380px,calc(100% - 32px));padding:28px;border-radius:16px;background:#fff;color:#302833;display:grid;gap:14px;box-shadow:0 18px 60px #0005';
        const heading = PAGE.document.createElement('h2');
        heading.textContent = 'YODAWY Dashboard';
        const username = PAGE.document.createElement('input');
        username.placeholder = 'User ID';
        username.autocomplete = 'username';
        username.required = true;
        const password = PAGE.document.createElement('input');
        password.placeholder = 'Password';
        password.type = 'password';
        password.autocomplete = 'current-password';
        password.required = true;
        const button = PAGE.document.createElement('button');
        button.textContent = 'SIGN IN';
        button.style.cssText = 'padding:12px;border:0;border-radius:7px;background:#875A7B;color:#fff;font-weight:700;cursor:pointer';
        const error = PAGE.document.createElement('p');
        error.style.cssText = 'margin:0;color:#a22;min-height:18px';
        form.append(heading, username, password, button, error);
        root.append(form);
        PAGE.document.body.append(root);
        form.onsubmit = async event => {
            event.preventDefault();
            button.disabled = true;
            error.textContent = '';
            try {
                await apply(await request('/api/auth/login', { method: 'POST', body: { username: username.value, password: password.value } }));
                password.value = '';
                root.remove();
                resolve(true);
            } catch (failure) {
                error.textContent = (messages[failure.code] || messages.UNKNOWN_ERROR || {}).message || 'LOGIN FAILED';
            } finally {
                button.disabled = false;
            }
        };
    });
    try {
        if (!await refresh()) await mountLogin();
        const data = await request('/api/dashboard/bootstrap', { token: accessToken });
        context = Object.freeze({
            user,
            data,
            assetVersion: ASSET_VERSION,
            request: authorizedRequest,
            logout: async () => {
                try { await request('/api/auth/logout', { method: 'POST', token: accessToken }); }
                finally { accessToken = ''; user = null; await save(''); PAGE.location.reload(); }
            },
            changePassword: async (currentPassword, newPassword) => {
                const result = await request('/api/auth/change-password', { method: 'POST', token: accessToken, body: { currentPassword, newPassword } });
                accessToken = '';
                user = null;
                await save('');
                return result;
            }
        });
        Object.defineProperty(PAGE, 'YODAWY_CLOUD_CONTEXT', { value: context, configurable: true });
        if (!await loadStyle('fa-icons.css')) {
            const error = new Error('FONT_AWESOME_STYLESHEET_UNAVAILABLE: ' + runtime + 'fa-icons.css');
            error.code = 'FONT_AWESOME_STYLESHEET_UNAVAILABLE';
            throw error;
        }
        const fontAssets = [
            { path: 'webfonts/6.7.2/fa-solid-900.woff2', family: 'YD Font Awesome 6 Free', weight: '900' },
            { path: 'webfonts/6.7.2/fa-regular-400.woff2', family: 'YD Font Awesome 6 Free', weight: '400' },
            { path: 'webfonts/6.7.2/fa-brands-400.woff2', family: 'YD Font Awesome 6 Brands', weight: '400' }
        ];
        await Promise.all(fontAssets.map(async asset => {
            try {
                const response = await PAGE.fetch(runtime + asset.path + '?v=' + ASSET_VERSION, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.arrayBuffer();
                const signature = new Uint8Array(data).slice(0, 4).reduce((value, byte) => value + byte.toString(16).padStart(2, '0'), '');
                if (signature !== '774f4632') throw new Error('INVALID_WOFF2_SIGNATURE');
                const face = new PAGE.FontFace(asset.family, data, { weight: asset.weight, style: 'normal' });
                const loadedFace = await face.load();
                if (loadedFace.status !== 'loaded') throw new Error('FONT_FACE_NOT_LOADED');
                PAGE.document.fonts.add(loadedFace);
                await PAGE.document.fonts.load(asset.weight + ' 16px "' + asset.family + '"');
                if (!PAGE.document.fonts.check(asset.weight + ' 16px "' + asset.family + '"')) throw new Error('FONT_FACE_NOT_REGISTERED');
            } catch (cause) {
                const error = new Error('FONT_ASSET_LOAD_FAILED: ' + runtime + asset.path + ' (' + String(cause?.message || cause) + ')');
                error.code = 'FONT_ASSET_LOAD_FAILED';
                throw error;
            }
        }));
        const assets = [
            'cloud-api-engine.js',
            'core-auth-engine.js',
            'core-permissions-engine.js',
            'core-visibility-engine.js',
            'core-module-loader.js',
            'core-tools-manager.js',
            'core-settings-engine.js',
            'core-announcements-engine.js',
            'dashboard-ui.js'
        ];
        for (const asset of assets) await loadScript(asset);
        const dashboardUI = PAGE.YODAWY_DASHBOARD_UI || PAGE.document.defaultView?.YODAWY_DASHBOARD_UI;
        if (!dashboardUI || typeof dashboardUI.init !== 'function') {
            const error = new Error('Dashboard UI runtime did not register an init function. Asset version: ' + ASSET_VERSION);
            error.code = 'DASHBOARD_UI_NOT_REGISTERED';
            throw error;
        }
        const YODAWY = {
            api: PAGE.YODAWY_API_ENGINE,
            auth: PAGE.YODAWY_AUTH_ENGINE,
            permissions: PAGE.YODAWY_PERMISSIONS_ENGINE,
            visibility: PAGE.YODAWY_VISIBILITY_ENGINE,
            settings: PAGE.YODAWY_SETTINGS_ENGINE,
            cloudAuth: { changePassword: context.changePassword, logout: context.logout },
            tools: PAGE.YODAWY_TOOLS_MANAGER,
            announcements: PAGE.YODAWY_ANNOUNCEMENTS_ENGINE,
            ui: dashboardUI,
            user,
            userId: user.id,
            userRole: user.role,
            get users() { return Array.isArray(data.users) ? data.users : []; },
            get userSettings() { return data.userSettings || {}; },
            authenticated: false
        };
        Object.defineProperty(PAGE, 'YODAWY', { value: YODAWY, configurable: true });
        YODAWY.auth.initialize({ authenticated: true, user, role: user.role, permissions: [] });
        YODAWY.settings.configure();
        await Promise.all([
            YODAWY.settings.load(),
            YODAWY.permissions.load(),
            YODAWY.visibility.load(),
            YODAWY.tools.loadManifest(),
            YODAWY.announcements.load()
        ]);
        const roleAsset = user.role === 'SUPER_ADMIN' ? 'super-admin-engine.js' : user.role === 'ADMIN' ? 'admin-engine.js' : 'user-engine.js';
        await loadScript(roleAsset);
        const engine = user.role === 'SUPER_ADMIN' ? PAGE.YODAWY_SUPER_ADMIN_ENGINE : user.role === 'ADMIN' ? PAGE.YODAWY_ADMIN_ENGINE : PAGE.YODAWY_USER_ENGINE;
        if (!engine || typeof YODAWY.init !== 'function') throw new Error('ROLE_ENGINE_UNAVAILABLE');
        await YODAWY.init();
        await YODAWY.tools.sync();
        await loadScript('live-update-engine.js');
        await PAGE.YODAWY_LIVE_UPDATE_ENGINE?.start?.();
        const toolSyncFailures = YODAWY.tools.getSyncFailures?.() || [];
        if (toolSyncFailures.length) PAGE.dispatchEvent(new PAGE.CustomEvent('yodawy-tools-sync-error', { detail: { failures: toolSyncFailures } }));
        PAGE.dispatchEvent(new PAGE.CustomEvent('yodawy-cloud-ready', { detail: { user, data } }));
    } catch (error) {
        showError(error);
        throw error;
    }
})(PAGE, STORE);