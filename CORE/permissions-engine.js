(function (global) {
    'use strict';

    if (global.YODAWY_PERMISSIONS_ENGINE) return;

    const CONFIG = {
        PATH: 'CONFIG/tools-permissions.json'
    };

    let permissions = {};
    let loaded = false;
    let saving = false;

    const createError = message => {
        const error = new Error(message);
        error.code = 'PERMISSIONS_ENGINE_ERROR';
        return error;
    };

    const getDependencies = () => {
        const API = global.YODAWY_API_ENGINE;
        const AUTH = global.YODAWY_AUTH_ENGINE;

        if (!API || !AUTH) {
            throw createError('Required engines are unavailable');
        }

        return { API, AUTH };
    };

    const getRole = () => {
        const { AUTH } = getDependencies();
        const role = AUTH.getRole();

        if (!['USER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
            throw createError('Invalid authentication role');
        }

        return role;
    };

    const validateIds = (userId, toolId) => {
        if (
            typeof userId !== 'string' ||
            typeof toolId !== 'string' ||
            !userId.trim() ||
            !toolId.trim()
        ) {
            throw createError('Invalid user or tool ID');
        }
    };

    const clone = value =>
        JSON.parse(JSON.stringify(value));

    const load = async (options = {}) => {
        const { API } = getDependencies();

        try {
            const content = await API.getFileContent(CONFIG.PATH, options);
            const data = JSON.parse(content);

            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw createError('Invalid permissions file structure');
            }

            permissions = data;
            loaded = true;

            return getAll();
        } catch (error) {
            loaded = false;
            throw error;
        }
    };

    const ensureLoaded = () => {
        if (!loaded) {
            throw createError('Permissions have not been loaded');
        }
    };

    const getPermission = (userId, toolId) => {
        validateIds(userId, toolId);
        ensureLoaded();

        const record = permissions[userId]?.[toolId];

        return record
            ? Object.freeze({
                ...record,
                granted: record.granted === true,
                forcedState: record.forcedState === true
            })
            : Object.freeze({
                granted: false,
                type: null,
                forcedState: false
            });
    };

    const isGranted = (userId, toolId) =>
        getPermission(userId, toolId).granted;

    const isForced = (userId, toolId) =>
        getPermission(userId, toolId).forcedState;

    const canUse = (userId, toolId) =>
        isGranted(userId, toolId);

    const canManage = (userId, toolId) => {
        validateIds(userId, toolId);
        ensureLoaded();

        const role = getRole();
        const record = permissions[userId]?.[toolId];

        if (role === 'SUPER_ADMIN') return true;

        if (role === 'ADMIN') {
            return record?.forcedState !== true;
        }

        return false;
    };

    const encodeContent = value => {
        const bytes = new TextEncoder().encode(
            JSON.stringify(value, null, 2)
        );

        let binary = '';

        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }

        return btoa(binary);
    };

    const save = async (userId, toolId, changes) => {
        validateIds(userId, toolId);
        ensureLoaded();

        if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
            throw createError('Invalid permission changes');
        }

        if (saving) {
            throw createError('Another permission update is in progress');
        }

        const role = getRole();
        const current = getPermission(userId, toolId);

        if (role === 'USER') {
            throw createError('Users cannot modify permissions');
        }

        if (role === 'ADMIN' && current.forcedState) {
            throw createError('Permission is protected by Forced State');
        }

        const keys = Object.keys(changes);

        if (!keys.length || keys.some(key =>
            !['granted', 'forcedState'].includes(key)
        )) {
            throw createError('Unsupported permission field');
        }

        if (typeof changes.granted === 'undefined' &&
            typeof changes.forcedState === 'undefined') {
            throw createError('No permission changes supplied');
        }

        if (
            changes.granted !== undefined &&
            typeof changes.granted !== 'boolean'
        ) {
            throw createError('Invalid granted value');
        }

        if (
            changes.forcedState !== undefined &&
            typeof changes.forcedState !== 'boolean'
        ) {
            throw createError('Invalid Forced State value');
        }

        if (role !== 'SUPER_ADMIN' && changes.forcedState !== undefined) {
            throw createError('Only SUPER_ADMIN can modify Forced State');
        }

        const updated = clone(permissions);
        const previous = updated[userId]?.[toolId] || {
            granted: false,
            type: null,
            forcedState: false
        };

        updated[userId] ||= {};
        updated[userId][toolId] = {
            ...previous,
            ...(changes.granted !== undefined
                ? { granted: changes.granted, type: role }
                : {}),
            ...(changes.forcedState !== undefined
                ? { forcedState: changes.forcedState }
                : {})
        };

        const { API } = getDependencies();
        const config = API.getConfig();

        if (!config.owner || !config.repo || !config.branch) {
            throw createError('Repository configuration is incomplete');
        }

        saving = true;

        try {
            const file = await API.getFile(CONFIG.PATH);

            if (!file?.sha) {
                throw createError('Permissions file SHA is unavailable');
            }

            await API.put(
                `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${CONFIG.PATH}`,
                {
                    message: `Update permission ${userId}/${toolId}`,
                    content: encodeContent(updated),
                    sha: file.sha,
                    branch: config.branch
                }
            );

            permissions = updated;

            return getPermission(userId, toolId);
        } finally {
            saving = false;
        }
    };

    const getAll = () => {
        ensureLoaded();
        return clone(permissions);
    };

    const getUserPermissions = userId => {
        if (typeof userId !== 'string' || !userId.trim()) {
            throw createError('Invalid user ID');
        }

        ensureLoaded();

        return clone(permissions[userId] || {});
    };

    const API = Object.freeze({
        version: 1,
        load,
        getPermission,
        getUserPermissions,
        getAll,
        isGranted,
        isForced,
        canUse,
        canManage,
        save,
        isLoaded: () => loaded
    });

    global.YODAWY_PERMISSIONS_ENGINE = API;

})(window);
