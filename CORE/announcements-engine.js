(function (global) {
    'use strict';

    if (global.YODAWY_ANNOUNCEMENTS_ENGINE) return;

    const CONFIG = Object.freeze({ PATH: 'CONFIG/announcements.json', MAX_TITLE: 140, MAX_BODY: 6000 });
    let posts = [];
    let loaded = false;
    let saving = false;

    const createError = message => {
        const error = new Error(message);
        error.code = 'ANNOUNCEMENTS_ENGINE_ERROR';
        return error;
    };
    const clone = value => JSON.parse(JSON.stringify(value));
    const text = value => String(value || '').trim();
    const id = value => text(value).toUpperCase();

    const dependencies = () => {
        const API = global.YODAWY_API_ENGINE;
        const AUTH = global.YODAWY_AUTH_ENGINE;
        if (!API || !AUTH || !AUTH.isAuthenticated()) throw createError('Authenticated dashboard engines are unavailable');
        return { API, AUTH };
    };

    const config = () => {
        const { API } = dependencies();
        const value = API.getConfig();
        if (!value?.owner || !value?.repo || !value?.branch) throw createError('Dashboard repository configuration is incomplete');
        return { ...value, endpoint: '/repos/' + encodeURIComponent(value.owner) + '/' + encodeURIComponent(value.repo) + '/contents/' + CONFIG.PATH };
    };

    const decode = value => {
        const binary = atob(String(value || '').replace(/\s/g, ''));
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    };

    const encode = value => {
        const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        return btoa(binary);
    };

    const validate = data => {
        if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.posts)) throw createError('Invalid announcements registry');
        const ids = new Set();
        return data.posts.map(post => {
            if (!post || typeof post !== 'object' || Array.isArray(post)) throw createError('Invalid announcement record');
            const postId = text(post.id);
            const title = text(post.title);
            const body = text(post.body);
            if (!postId || !title || !body || ids.has(postId)) throw createError('Announcement contains missing or duplicate fields');
            if (title.length > CONFIG.MAX_TITLE || body.length > CONFIG.MAX_BODY) throw createError('Announcement exceeds the allowed length');
            ids.add(postId);
            return { ...post, id: postId, title, body, createdBy: text(post.createdBy) || 'Unknown', createdById: id(post.createdById), createdAt: text(post.createdAt), updatedAt: text(post.updatedAt || post.createdAt) };
        }).sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)));
    };

    const readDocument = async () => {
        const { API } = dependencies();
        const repository = config();
        const response = await API.get(repository.endpoint + '?ref=' + encodeURIComponent(repository.branch));
        const file = response.data;
        if (!file?.sha || typeof file.content !== 'string') throw createError('Announcements file is unavailable');
        const data = decode(file.content);
        if (!data || typeof data !== 'object' || !Array.isArray(data.posts)) throw createError('Announcements file has an invalid structure');
        return { repository, sha: file.sha, document: { protocolVersion: 1, updatedAt: text(data.updatedAt) || null, posts: validate(data) } };
    };

    const load = async () => {
        const result = await readDocument();
        posts = result.document.posts;
        loaded = true;
        return getPosts();
    };
    const ensureLoaded = () => { if (!loaded) throw createError('Announcements have not been loaded'); };
    const getPosts = () => { ensureLoaded(); return clone(posts); };

    const manager = () => {
        const { AUTH } = dependencies();
        const role = AUTH.getRole();
        if (!['ADMIN', 'SUPER_ADMIN'].includes(role)) throw createError('Only ADMIN or SUPER ADMIN can manage announcements');
        const user = AUTH.getUser() || {};
        const actorId = id(user.userId || user.id);
        const actorName = text(user.name || actorId);
        if (!actorId || !actorName) throw createError('Authenticated publisher information is incomplete');
        return { role, actorId, actorName };
    };

    const mutate = async mutator => {
        manager();
        if (saving) throw createError('Another announcement update is in progress');
        saving = true;
        try {
            let lastError = null;
            for (let attempt = 0; attempt < 6; attempt++) {
                const current = await readDocument();
                const updated = mutator(clone(current.document));
                updated.updatedAt = new Date().toISOString();
                updated.posts = validate(updated);
                try {
                    const { API } = dependencies();
                    const response = await API.put(current.repository.endpoint, { message: 'Update dashboard announcements', content: encode(updated), sha: current.sha, branch: current.repository.branch });
                    if (!response.data?.content?.sha) throw createError('Announcement update was not confirmed');
                    posts = updated.posts;
                    loaded = true;
                    return clone(updated);
                } catch (error) {
                    lastError = error;
                    if (![409, 422].includes(Number(error?.status)) || attempt === 5) throw error;
                    await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
                }
            }
            throw lastError || createError('Unable to update announcements');
        } finally {
            saving = false;
        }
    };

    const createPost = async input => {
        const actor = manager();
        const title = text(input?.title);
        const body = text(input?.body);
        if (!title || !body) throw createError('Announcement title and message are required');
        if (title.length > CONFIG.MAX_TITLE || body.length > CONFIG.MAX_BODY) throw createError('Announcement exceeds the allowed length');
        const now = new Date().toISOString();
        const post = { id: global.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2), title, body, createdBy: actor.actorName, createdById: actor.actorId, createdByRole: actor.role, createdAt: now, updatedAt: now };
        await mutate(document => {
            if (document.posts.some(item => item.id === post.id)) throw createError('Announcement ID already exists');
            document.posts.push(post);
            return document;
        });
        return clone(post);
    };

    const updatePost = async (postId, input) => {
        const actor = manager();
        const postIdValue = text(postId);
        const title = text(input?.title);
        const body = text(input?.body);
        if (!postIdValue || !title || !body) throw createError('Announcement title and message are required');
        if (title.length > CONFIG.MAX_TITLE || body.length > CONFIG.MAX_BODY) throw createError('Announcement exceeds the allowed length');
        const now = new Date().toISOString();
        let updatedPost = null;
        await mutate(document => {
            const index = document.posts.findIndex(item => item.id === postIdValue);
            if (index < 0) throw createError('Announcement was not found');
            updatedPost = { ...document.posts[index], title, body, updatedBy: actor.actorName, updatedById: actor.actorId, updatedAt: now };
            document.posts[index] = updatedPost;
            return document;
        });
        return clone(updatedPost);
    };

    const deletePost = async postId => {
        const postIdValue = text(postId);
        if (!postIdValue) throw createError('Invalid announcement ID');
        await mutate(document => {
            const count = document.posts.length;
            document.posts = document.posts.filter(item => item.id !== postIdValue);
            if (document.posts.length === count) throw createError('Announcement was not found');
            return document;
        });
        return true;
    };

    global.YODAWY_ANNOUNCEMENTS_ENGINE = Object.freeze({ version: 1, load, getPosts, createPost, updatePost, deletePost, isLoaded: () => loaded, isSaving: () => saving });
})(window);