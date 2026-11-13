(() => {
    'use strict';
    if (window.YODAWYCloudAuth) return;
    const create = options => {
        const baseUrl = String(options?.baseUrl || '').replace(/\/+$/, '');
        const storage = options?.storage;
        if (!baseUrl || !storage?.get || !storage?.set || !storage?.remove) throw new Error('Cloud authentication configuration is incomplete');
        const key = 'yd-cloud-refresh-v1';
        let accessToken = '';
        let refreshTask = null;
        let user = null;
        const readRefresh = async () => String(await storage.get(key) || '');
        const saveRefresh = async value => value ? storage.set(key, value) : storage.remove(key);
        const call = async (path, payload, token = '') => {
            const response = await fetch(baseUrl + path, {
                method: payload === undefined ? 'GET' : 'POST',
                headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
                body: payload === undefined ? undefined : JSON.stringify(payload),
                credentials: 'omit',
                cache: 'no-store'
            });
            let data = {};
            try { data = await response.json(); } catch {}
            if (!response.ok) {
                const error = new Error(data.error || 'REQUEST_FAILED');
                error.status = response.status;
                error.code = data.error || 'REQUEST_FAILED';
                throw error;
            }
            return data;
        };
        const apply = async data => {
            if (!data?.accessToken || !data?.refreshToken || !data?.user?.id) throw new Error('Invalid authentication response');
            accessToken = data.accessToken;
            user = Object.freeze({ ...data.user });
            await saveRefresh(data.refreshToken);
            return user;
        };
        const refresh = async () => {
            if (refreshTask) return refreshTask;
            refreshTask = (async () => {
                const token = await readRefresh();
                if (!token) return null;
                try {
                    const data = await call('/api/auth/refresh', { refreshToken: token });
                    return await apply(data);
                } catch (error) {
                    accessToken = '';
                    user = null;
                    await saveRefresh('');
                    if (error.status === 401) return null;
                    throw error;
                } finally {
                    refreshTask = null;
                }
            })();
            return refreshTask;
        };
        const login = async (username, password) => {
            const data = await call('/api/auth/login', { username: String(username || '').trim().toUpperCase(), password: String(password || '') });
            return apply(data);
        };
        const restore = async () => refresh();
        const getAccessToken = async () => {
            if (accessToken) return accessToken;
            if (!await refresh()) throw new Error('AUTH_REQUIRED');
            return accessToken;
        };
        const request = async (path, options = {}) => {
            const token = await getAccessToken();
            const execute = async current => {
                const response = await fetch(baseUrl + path, {
                    method: options.method || 'GET',
                    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + current, ...(options.headers || {}) },
                    body: options.body === undefined ? undefined : JSON.stringify(options.body),
                    credentials: 'omit',
                    cache: 'no-store'
                });
                let data = {};
                try { data = await response.json(); } catch {}
                if (!response.ok) {
                    const error = new Error(data.error || 'REQUEST_FAILED');
                    error.status = response.status;
                    error.code = data.error || 'REQUEST_FAILED';
                    throw error;
                }
                return data;
            };
            try { return await execute(token); }
            catch (error) {
                if (error.status !== 401) throw error;
                accessToken = '';
                if (!await refresh()) throw error;
                return execute(accessToken);
            }
        };
        const changePassword = async (currentPassword, newPassword) => {
            const result = await request('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
            accessToken = '';
            user = null;
            await saveRefresh('');
            return result;
        };
        const logout = async () => {
            try { if (accessToken) await request('/api/auth/logout', { method: 'POST', body: {} }); }
            finally {
                accessToken = '';
                user = null;
                await saveRefresh('');
            }
            return true;
        };
        return Object.freeze({ login, restore, request, changePassword, logout, getUser: () => user, isAuthenticated: () => Boolean(accessToken && user), getAccessToken });
    };
    Object.defineProperty(window, 'YODAWYCloudAuth', { value: Object.freeze({ create }), configurable: false, writable: false });
})();