(function (global) {
    'use strict';
    if (global.YODAWY_API_ENGINE) return;
    const context = () => global.YODAWY_CLOUD_CONTEXT;
    const fail = (message, status = 0, data = null) => {
        const error = new Error(message);
        error.status = status;
        error.data = data;
        return error;
    };
    const request = async (path, options = {}) => {
        const ctx = context();
        if (!ctx?.request) throw fail('Cloud authentication is unavailable');
        const method = String(options.method || 'GET').toUpperCase();
        const body = options.body;
        const result = await ctx.request(path, { method, body });
        return { ok: true, status: 200, data: result, headers: new Headers() };
    };
    const get = (path, options = {}) => request(path, { ...options, method: 'GET' });
    const post = (path, body, options = {}) => request(path, { ...options, method: 'POST', body });
    const put = (path, body, options = {}) => request(path, { ...options, method: 'PUT', body });
    const patch = (path, body, options = {}) => request(path, { ...options, method: 'PATCH', body });
    const remove = (path, options = {}) => request(path, { ...options, method: 'DELETE' });
    const decode = value => {
        const binary = atob(String(value || '').replace(/\\s/g, ''));
        return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
    };
    const snapshot = () => context()?.data || {};
    const readVirtualFile = async path => {
        const data = snapshot();
        if (path === 'CONFIG/users.json') return JSON.stringify({ users: (data.users || []).map(user => ({ ...user, id: user.id, repository: user.repository })) });
        if (path === 'CONFIG/tools-permissions.json') {
            const output = {};
            for (const [userId, tools] of Object.entries(data.permissions || {})) {
                output[userId] = Object.fromEntries(Object.entries(tools).map(([toolId, state]) => [toolId, { granted: Boolean(state.enabled), forcedState: Boolean(state.forced), type: state.type || null }]));
            }
            return JSON.stringify(output);
        }
        if (path === 'CONFIG/tools-visibility.json') return JSON.stringify(data.visibility || {});
        if (path === 'CONFIG/announcements.json') return JSON.stringify({ posts: (data.announcements || []).map(item => ({ id: item.id, body: item.body, createdBy: item.author_name, createdById: item.author_id, createdAt: item.created_at, updatedAt: item.updated_at, cycle: item.cycle || '' })) });
        if (path === 'NETWORK/network-logs.json') return JSON.stringify({ transactions: Object.fromEntries((data.transactions || []).map(item => [item.request_id, { ...item, requestId: item.request_id, requestType: item.request_type, createdAt: item.created_at, updatedAt: item.updated_at, payload: item.payload || {}, result: item.result || {} }])) });
        if (path === 'TOOLS_CACHE/tools-manifest.json') return JSON.stringify({ tools: (data.tools || []).map(tool => ({ id: tool.id, name: tool.name, description: tool.description || '', version: tool.version || '1', path: tool.path, sha256: tool.sha256 })) });
        if (path === 'DASHBOARD/dashboard-settings.json') return JSON.stringify(data.settings || { userId: data.user?.id, tools: {}, startPage: 'tools' });
        throw fail('Cloud virtual file not found: ' + path, 404);
    };
    const getFileContent = async path => readVirtualFile(String(path || '').replace(/^\\/+/, ''));
    const getFile = async path => {
        const content = await getFileContent(path);
        return { content: btoa(unescape(encodeURIComponent(content))), sha: 'cloud-managed' };
    };
    const getRepository = async () => ({ default_branch: 'cloudflare' });
    const getConfig = () => Object.freeze({ owner: 'cloudflare', repo: 'yodawy-dashboard', branch: 'cloudflare', configured: true });
    global.YODAWY_API_ENGINE = Object.freeze({ version: 2, configure: () => true, request, get, post, put, patch, delete: remove, getFile, getFileContent, getRepository, clearToken: () => true, getConfig });
})(window);
