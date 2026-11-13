return (async function (PAGE, STORE) {
    'use strict';
    const API = 'https://yodawy-dashboard.m-saleh-yodawy.workers.dev';
    const messages = await fetch(API + '/system-messages.json', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('MESSAGE_SOURCE_UNAVAILABLE');
        return response.json();
    }).then(data => data.messages || {});
    const showError = code => {
        const item = messages[code] || messages.UNKNOWN_ERROR || { title: 'SYSTEM ERROR', message: 'AN UNEXPECTED ERROR OCCURRED.' };
        const root = PAGE.document.createElement('div');
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#17131acc;font:14px Arial,sans-serif';
        const card = PAGE.document.createElement('section');
        card.style.cssText = 'width:min(420px,calc(100% - 32px));padding:26px;border-radius:14px;background:#fff;color:#302833;border-top:5px solid #875A7B;box-shadow:0 18px 60px #0005';
        const title = PAGE.document.createElement('h3');
        title.textContent = item.title || 'SYSTEM ERROR';
        const message = PAGE.document.createElement('p');
        message.textContent = item.message || 'AN UNEXPECTED ERROR OCCURRED.';
        const button = PAGE.document.createElement('button');
        button.textContent = 'CLOSE';
        button.style.cssText = 'padding:10px 22px;border:0;border-radius:7px;background:#875A7B;color:#fff;cursor:pointer';
        button.onclick = () => root.remove();
        card.append(title, message, button);
        root.append(card);
        PAGE.document.body.append(root);
    };
    const request = async (path, options = {}) => {
        const response = await fetch(API + path, {
            method: options.method || 'GET',
            headers: { 'content-type': 'application/json', ...(options.token ? { authorization: 'Bearer ' + options.token } : {}) },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            cache: 'no-store',
            credentials: 'omit'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.error || 'REQUEST_FAILED');
            error.code = data.error || 'REQUEST_FAILED';
            error.status = response.status;
            throw error;
        }
        return data;
    };
    let accessToken = '';
    let user = null;
    const save = async token => token ? STORE.set('yd-cloud-refresh-v1', token) : STORE.remove('yd-cloud-refresh-v1');
    const apply = async data => {
        accessToken = data.accessToken;
        user = Object.freeze(data.user);
        await save(data.refreshToken);
    };
    const refresh = async () => {
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
    };
    const getDashboard = async () => request('/api/dashboard/bootstrap', { token: accessToken });
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
        const health = await request('/api/health');
        if (health.status !== 'online') throw new Error('SYSTEM_UNAVAILABLE');
        if (!await refresh()) await mountLogin();
        const data = await getDashboard();
        const context = Object.freeze({
            user,
            data,
            request: (path, options = {}) => request(path, { ...options, token: accessToken }),
            logout: async () => { try { await request('/api/auth/logout', { method: 'POST', token: accessToken }); } finally { accessToken = ''; user = null; await save(''); PAGE.location.reload(); } },
            changePassword: async (currentPassword, newPassword) => {
                const result = await request('/api/auth/change-password', { method: 'POST', token: accessToken, body: { currentPassword, newPassword } });
                accessToken = '';
                user = null;
                await save('');
                return result;
            }
        });
        Object.defineProperty(PAGE, 'YODAWY_CLOUD_CONTEXT', { value: context, configurable: true });
        PAGE.dispatchEvent(new PAGE.CustomEvent('yodawy-cloud-ready', { detail: { user, data } }));
    } catch (error) {
        showError(error.code || 'UNKNOWN_ERROR');
    }
})(PAGE, STORE);