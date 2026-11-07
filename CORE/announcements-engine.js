(function (global) {
    'use strict';

    if (global.YODAWY_ANNOUNCEMENTS_ENGINE) return;

    const CONFIG = Object.freeze({
        PATH: 'CONFIG/announcements.json',
        LOGS_PATH: 'NETWORK/network-logs.json',
        REQUEST_TYPE: 'DASHBOARD_ANNOUNCEMENTS_SYNC',
        MAX_BODY: 6000,
        CYCLES: Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']),
        FINAL_STATUSES: ['COMPLETED', 'FAILED', 'REJECTED']
    });

    let posts = [];
    let loaded = false;
    let saving = false;
    let submitting = false;

    const createError = message => {
        const error = new Error(message);
        error.code = 'ANNOUNCEMENTS_ENGINE_ERROR';
        return error;
    };

    const clone = value => JSON.parse(JSON.stringify(value));
    const normalizeText = value => String(value || '').trim();
    const normalizeId = value => normalizeText(value).toUpperCase();

    const normalizeCycle = (value, fallbackDate) => {
        const selected = normalizeText(value).toLowerCase();
        const match = CONFIG.CYCLES.find(cycle => cycle.toLowerCase() === selected);
        if (match) return match;
        const date = new Date(fallbackDate || Date.now());
        const month = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date);
        return CONFIG.CYCLES.find(cycle => cycle.toLowerCase() === month.toLowerCase()) || CONFIG.CYCLES[0];
    };

    const getDependencies = () => {
        const API = global.YODAWY_API_ENGINE;
        const AUTH = global.YODAWY_AUTH_ENGINE;
        if (!API || !AUTH || !AUTH.isAuthenticated()) throw createError('Authenticated dashboard engines are unavailable');
        return { API, AUTH };
    };

    const getActor = () => {
        const { AUTH } = getDependencies();
        const role = AUTH.getRole();
        if (!['ADMIN', 'SUPER_ADMIN'].includes(role)) throw createError('Only ADMIN or SUPER ADMIN can manage announcements');
        const user = AUTH.getUser() || {};
        const actorId = normalizeId(user.userId || user.id);
        const actorName = normalizeText(user.name || actorId);
        if (!actorId || !actorName) throw createError('Authenticated publisher information is incomplete');
        return { id: actorId, userId: actorId, name: actorName, username: actorName, role };
    };

    const validateDocument = data => {
        if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.posts)) throw createError('Invalid announcements registry');
        const ids = new Set();
        return data.posts.map(post => {
            if (!post || typeof post !== 'object' || Array.isArray(post)) throw createError('Invalid announcement record');
            const id = normalizeText(post.id);
            const body = normalizeText(post.body);
            if (!id || !body || ids.has(id)) throw createError('Announcement contains missing or duplicate fields');
            if (body.length > CONFIG.MAX_BODY) throw createError('Announcement message exceeds the allowed length');
            ids.add(id);
            return {
                ...post,
                id,
                body,
                createdBy: normalizeText(post.createdBy) || 'Unknown',
                createdById: normalizeId(post.createdById),
                createdAt: normalizeText(post.createdAt),
                updatedAt: normalizeText(post.updatedAt || post.createdAt),
                cycle: normalizeCycle(post.cycle, post.createdAt)
            };
        }).sort((a, b) => normalizeText(b.updatedAt).localeCompare(normalizeText(a.updatedAt)));
    };

    const readJSON = async path => {
        const { API } = getDependencies();
        const data = JSON.parse(await API.getFileContent(path));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw createError('Invalid JSON structure: ' + path);
        return data;
    };

    const load = async () => {
        const data = await readJSON(CONFIG.PATH);
        posts = validateDocument(data);
        loaded = true;
        return getPosts();
    };

    const ensureLoaded = () => {
        if (!loaded) throw createError('Announcements have not been loaded');
    };

    const getPosts = () => {
        ensureLoaded();
        return clone(posts);
    };

    const encodeContent = value => {
        const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        return btoa(binary);
    };

    const createId = () => global.crypto?.randomUUID
        ? global.crypto.randomUUID().toUpperCase()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 12).toUpperCase();

    const createSequence = () => String(Date.now()) + String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

    const createRequest = async (action, payload) => {
        const { API } = getDependencies();
        const actor = getActor();
        const config = API.getConfig();
        if (!config?.owner || !config?.repo || !config?.branch) throw createError('Dashboard repository configuration is incomplete');
        if (submitting) throw createError('Another announcement request is being submitted');
        submitting = true;
        try {
            let lastError = null;
            for (let attempt = 0; attempt < 6; attempt++) {
                const sequence = createSequence();
                const requestId = 'ANNOUNCEMENT-' + createId();
                const path = 'NETWORK/announcements-request-' + sequence + '.json';
                const endpoint = '/repos/' + encodeURIComponent(config.owner) + '/' + encodeURIComponent(config.repo) + '/contents/' + path;
                const createdAt = new Date().toISOString();
                const request = {
                    protocolVersion: 1,
                    requestId,
                    sequence,
                    requestType: CONFIG.REQUEST_TYPE,
                    status: 'PENDING',
                    createdAt,
                    actor,
                    action,
                    payload: { ...clone(payload), action }
                };
                try {
                    const response = await API.put(endpoint, {
                        message: 'Submit ' + action + ' ' + requestId,
                        content: encodeContent(request),
                        branch: config.branch
                    });
                    if (!response.data?.content?.sha) throw createError('Announcement request was not confirmed');
                    return { requestId, sequence, path, status: 'PENDING', createdAt };
                } catch (error) {
                    lastError = error;
                    if (![409, 422].includes(Number(error?.status)) || attempt === 5) throw error;
                    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
                }
            }
            throw lastError || createError('Unable to submit announcement request');
        } finally {
            submitting = false;
        }
    };

    const getTransaction = async requestId => {
        const id = normalizeText(requestId);
        if (!id) throw createError('Invalid transaction ID');
        const logs = await readJSON(CONFIG.LOGS_PATH);
        const transaction = logs.transactions?.[id];
        return transaction ? clone(transaction) : null;
    };

    const waitForTransaction = async (requestId, options = {}) => {
        const timeout = Math.max(10000, Number(options.timeout) || 600000);
        const interval = Math.max(1000, Number(options.interval) || 4000);
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeout) {
            let transaction = null;
            try {
                transaction = await getTransaction(requestId);
            } catch {}
            if (transaction && CONFIG.FINAL_STATUSES.includes(normalizeText(transaction.status).toUpperCase())) {
                if (transaction.status === 'COMPLETED' && options.refresh !== false) {
                    await load();
                    const roleEngine = global.YODAWY_SUPER_ADMIN_ENGINE || global.YODAWY_ADMIN_ENGINE;
                    try {
                        await roleEngine?.refresh?.();
                    } catch {}
                }
                return transaction;
            }
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        return { requestId, status: 'TIMEOUT', message: 'Announcement request is still being processed' };
    };

    const submit = async (action, payload) => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw createError('Invalid announcement payload');
        if (saving) throw createError('Another announcement update is in progress');
        saving = true;
        try {
            const request = await createRequest(action, payload);
            const transaction = await waitForTransaction(request.requestId, { timeout: 600000, interval: 4000 });
            if (transaction.status === 'TIMEOUT') throw createError('Announcement is still processing. Reference: ' + request.requestId);
            if (transaction.status !== 'COMPLETED') throw createError(transaction.error || transaction.message || 'Announcement request was rejected');
            return transaction;
        } finally {
            saving = false;
        }
    };

    const createPost = async input => {
        getActor();
        const body = normalizeText(input?.body);
        if (!body) throw createError('Announcement message is required');
        if (body.length > CONFIG.MAX_BODY) throw createError('Announcement message is too long');
        const id = createId();
        const cycle = normalizeCycle(input?.cycle, new Date());
        await submit('CREATE_ANNOUNCEMENT', { id, body, cycle });
        return clone(posts.find(post => post.id === id) || null);
    };

    const updatePost = async (postId, input) => {
        getActor();
        const id = normalizeText(postId);
        const body = normalizeText(input?.body);
        if (!id || !body) throw createError('Announcement message is required');
        if (body.length > CONFIG.MAX_BODY) throw createError('Announcement message is too long');
        const existing = posts.find(post => post.id === id);
        const cycle = normalizeCycle(input?.cycle ?? existing?.cycle, existing?.createdAt || new Date());
        await submit('UPDATE_ANNOUNCEMENT', { id, body, cycle });
        return clone(posts.find(post => post.id === id) || null);
    };

    const deletePost = async postId => {
        getActor();
        const id = normalizeText(postId);
        if (!id) throw createError('Invalid announcement ID');
        await submit('DELETE_ANNOUNCEMENT', { id });
        return true;
    };

    global.YODAWY_ANNOUNCEMENTS_ENGINE = Object.freeze({
        version: 3,
        load,
        getPosts,
        createPost,
        updatePost,
        deletePost,
        getTransaction,
        waitForTransaction,
        isLoaded: () => loaded,
        isSaving: () => saving,
        isSubmitting: () => submitting
    });

})(window);