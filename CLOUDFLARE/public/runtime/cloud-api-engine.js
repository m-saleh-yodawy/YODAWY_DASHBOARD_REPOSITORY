(function (global) {
    'use strict';
    if (global.YODAWY_API_ENGINE) return;
    const context = () => global.YODAWY_CLOUD_CONTEXT;
    const transactions = new Map();
    const fail = (message, status = 0, data = null) => {
        const error = new Error(message);
        error.status = status;
        error.data = data;
        return error;
    };
    const call = async (path, method = 'GET', body) => {
        const ctx = context();
        if (!ctx?.request) throw fail('Cloud authentication is unavailable');
        return ctx.request(path, { method, body });
    };
    const refresh = async () => {
        const ctx = context();
        const fresh = await call('/api/dashboard/bootstrap');
        if (!fresh || fresh.success !== true || !ctx?.data) throw fail('Dashboard refresh failed');
        Object.assign(ctx.data, fresh);
        return ctx.data;
    };
    const get = (path, options = {}) => call(path, 'GET');
    const post = (path, body) => call(path, 'POST', body);
    const patch = (path, body) => call(path, 'PATCH', body);
    const remove = path => call(path, 'DELETE');
    const decode = value => {
        const binary = atob(String(value || '').replace(/\s/g, ''));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    };
    const encode = value => btoa(unescape(encodeURIComponent(String(value))));
    const snapshot = () => context()?.data || {};
    const remember = (requestId, requestType, payload, result, status = 'COMPLETED') => {
        const actor = context()?.user || {};
        const timestamp = new Date().toISOString();
        const transaction = { requestId, request_id: requestId, requestType, request_type: requestType, status, actorId: actor.id || '', actorName: actor.name || '', actorRole: actor.role || '', actor: { id: actor.id || '', userId: actor.id || '', name: actor.name || '', role: actor.role || '' }, payload, result, createdAt: timestamp, updatedAt: timestamp, ...(status === 'FAILED' ? { error: result?.error || 'REQUEST_FAILED' } : {}) };
        transactions.set(requestId, transaction);
        return transaction;
    };
    const applyTransaction = async input => {
        const action = String(input.action || input.payload?.action || '').toUpperCase();
        const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
        const requestId = String(input.requestId || input.transactionId || '');
        const type = String(input.requestType || (action.includes('ANNOUNCEMENT') ? 'DASHBOARD_ANNOUNCEMENTS_SYNC' : 'DASHBOARD_USERS_SYNC'));
        if (!requestId || !action) throw fail('Invalid legacy transaction request', 400);
        try {
            let result;
            if (action === 'ADD_USER') {
                result = await post('/api/dashboard/users', { name: payload.name, role: payload.role, status: payload.status });
            } else if (action === 'EDIT_USER') {
                const { id, ...changes } = payload;
                result = await patch('/api/dashboard/users/' + encodeURIComponent(id), changes);
            } else if (action === 'DELETE_USER') {
                result = await remove('/api/dashboard/users/' + encodeURIComponent(payload.id));
            } else if (action === 'MODIFY_TOOL_PERMISSION') {
                const permissions = payload.permissions || {
                    [payload.targetUserId]: {
                        [payload.targetToolId]: {
                            granted: Boolean(payload.granted),
                            forcedState: Boolean(payload.forcedState)
                        }
                    }
                };
                result = await call('/api/dashboard/permissions', 'PUT', { permissions });
            } else if (action === 'UPDATE_VISIBILITY') {
                result = await call('/api/dashboard/visibility', 'PUT', { visibility: payload.visibility || {} });
            } else if (action === 'CREATE_ANNOUNCEMENT') {
                result = await post('/api/dashboard/announcements', { id: payload.id, body: payload.body, cycle: payload.cycle });
            } else if (action === 'UPDATE_ANNOUNCEMENT') {
                result = await patch('/api/dashboard/announcements/' + encodeURIComponent(payload.id), { body: payload.body, cycle: payload.cycle });
            } else if (action === 'DELETE_ANNOUNCEMENT') {
                result = await remove('/api/dashboard/announcements/' + encodeURIComponent(payload.id));
            } else {
                throw fail('Unsupported dashboard action: ' + action, 400);
            }
            const transaction = remember(requestId, type, payload, result);
            try { await refresh(); } catch {}
            return transaction;
        } catch (error) {
            remember(requestId, type, payload, { error: error.message, status: error.status || 0 }, 'FAILED');
            throw error;
        }
    };
    const request = async (path, options = {}) => {
        const method = String(options.method || 'GET').toUpperCase();
        const body = options.body;
        const endpoint = String(path || '');
        const legacyNetwork = endpoint.match(/\/contents\/NETWORK\/(?:dashboard-users-request-|announcements-request-)[^/?]+\.json(?:\?.*)?$/);
        if (method === 'PUT' && legacyNetwork && body?.content) {
            const legacy = JSON.parse(decode(body.content));
            const result = await applyTransaction(legacy);
            return { ok: true, status: 201, data: { content: { sha: 'cloud-d1-' + legacy.requestId }, transaction: result }, headers: new Headers() };
        }
        const settingsPath = endpoint.match(/\/contents\/DASHBOARD\/dashboard-settings\.json(?:\?.*)?$/);
        if (method === 'PUT' && settingsPath && body?.content) {
            const settings = JSON.parse(decode(body.content));
            const result = await call('/api/dashboard/settings', 'PUT', { settings });
            await refresh();
            return { ok: true, status: 200, data: { content: { sha: 'cloud-d1-settings' }, settings: result.settings }, headers: new Headers() };
        }
        const result = await call(endpoint, method, body);
        return { ok: true, status: 200, data: result, headers: new Headers() };
    };
    const put = (path, body, options = {}) => request(path, { ...options, method: 'PUT', body });
    const getFileContent = async path => {
        const clean = String(path || '').replace(/^\/+/, '');
        const data = snapshot();
        if (clean.startsWith('TOOLS_CACHE/TOOLS/') || clean.startsWith('TOOLS/')) {
            const name = clean.split('/').pop();
            if (!/^[a-z0-9-]+\\.js$/i.test(name)) throw fail('Invalid tool asset path', 400);
            const response = await fetch('https://yodawy-dashboard.m-saleh-yodawy.workers.dev/tools/' + encodeURIComponent(name), { cache: 'no-store', credentials: 'omit' });
            if (!response.ok) throw fail('Tool asset unavailable: ' + name, response.status);
            return response.text();
        }
        if (clean === 'CONFIG/users.json') return JSON.stringify({ users: data.users || [] });
        if (clean === 'CONFIG/tools-permissions.json') {
            const output = {};
            for (const [userId, tools] of Object.entries(data.permissions || {})) output[userId] = Object.fromEntries(Object.entries(tools).map(([toolId, state]) => [toolId, { granted: Boolean(state.enabled), forcedState: Boolean(state.forced), type: state.type || null }]));
            return JSON.stringify(output);
        }
        if (clean === 'CONFIG/tools-visibility.json') return JSON.stringify(data.visibility || {});
        if (clean === 'CONFIG/announcements.json') return JSON.stringify({ posts: (data.announcements || []).map(item => ({ id: item.id, body: item.body, createdBy: item.author_name, createdById: item.author_id, createdAt: item.created_at, updatedAt: item.updated_at, cycle: item.cycle || '' })) });
        if (clean === 'NETWORK/network-logs.json') {
            const records = [...(data.transactions || []).map(item => [item.request_id || item.requestId, { ...item, requestId: item.request_id || item.requestId, requestType: item.request_type || item.requestType, createdAt: item.created_at || item.createdAt, updatedAt: item.updated_at || item.updatedAt, payload: item.payload || {}, result: item.result || {} }]), ...transactions.entries()];
            return JSON.stringify({ transactions: Object.fromEntries(records.filter(([id]) => id)) });
        }
        if (clean === 'TOOLS_CACHE/tools-manifest.json') return JSON.stringify({ tools: (data.tools || []).map(tool => ({ ...tool })) });
        if (clean === 'DASHBOARD/dashboard-settings.json') return JSON.stringify(data.settings || { userId: data.user?.id, tools: {}, startPage: 'tools' });
        throw fail('Cloud virtual file not found: ' + clean, 404);
    };
    const getFile = async path => ({ content: encode(await getFileContent(path)), sha: 'cloud-managed' });
    const getRepository = async () => ({ default_branch: 'cloudflare' });
    const getConfig = () => Object.freeze({ owner: 'cloudflare', repo: 'yodawy-dashboard', branch: 'cloudflare', configured: true });
    global.YODAWY_API_ENGINE = Object.freeze({ version: 3, configure: () => true, request, get, post, put, patch, delete: remove, getFile, getFileContent, getRepository, refresh, clearToken: () => true, getConfig });
})(window);
