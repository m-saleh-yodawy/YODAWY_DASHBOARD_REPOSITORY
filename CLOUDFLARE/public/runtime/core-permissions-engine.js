(function (global) {
    'use strict';

    if (global.YODAWY_PERMISSIONS_ENGINE) return;

    const CONFIG = { PATH: 'CONFIG/tools-permissions.json' };

    let permissions = {};
    let loaded = false;

    const createError = message => {
        const error = new Error(message);
        error.code = 'PERMISSIONS_ENGINE_ERROR';
        return error;
    };

    const getDependencies = () => {
        const API = global.YODAWY_API_ENGINE;
        const AUTH = global.YODAWY_AUTH_ENGINE;

        if (!API || !AUTH || !AUTH.isAuthenticated()) {
            throw createError('Required authenticated engines are unavailable');
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

    const clone = value => JSON.parse(JSON.stringify(value));

    const load = async (options = {}) => {
        const { API } = getDependencies();

        if (getRole() === 'SUPER_ADMIN') {
            permissions = {};
            loaded = true;
            return {};
        }

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
            permissions = {};
            throw error;
        }
    };

    const ensureLoaded = () => {
        if (!loaded) throw createError('Permissions have not been loaded');
    };

    const getPermission = (userId, toolId) => {
        validateIds(userId, toolId);
        ensureLoaded();

        const { AUTH } = getDependencies();

        if (
            AUTH.getRole() === 'SUPER_ADMIN' &&
            String(AUTH.getUserId()).trim().toUpperCase() === userId.trim().toUpperCase()
        ) {
            return Object.freeze({
                granted: true,
                forcedState: false,
                type: null,
                implicit: true
            });
        }

        const record = permissions[userId]?.[toolId];

        return record
            ? Object.freeze({
                ...record,
                granted: record.granted === true,
                forcedState: record.forcedState === true,
                implicit: false
            })
            : Object.freeze({
                granted: false,
                type: null,
                forcedState: false,
                implicit: false
            });
    };

    const isGranted = (userId, toolId) => {
        validateIds(userId, toolId);
        ensureLoaded();

        const { AUTH } = getDependencies();

        if (
            AUTH.getRole() === 'SUPER_ADMIN' &&
            String(AUTH.getUserId()).trim().toUpperCase() === userId.trim().toUpperCase()
        ) {
            return true;
        }

        return permissions[userId]?.[toolId]?.granted === true;
    };

    const isForced = (userId, toolId) =>
        getPermission(userId, toolId).forcedState;

    const canUse = (userId, toolId) => {
        validateIds(userId, toolId);
        ensureLoaded();

        const { AUTH } = getDependencies();

        if (!AUTH.isAuthenticated()) return false;

        if (
            AUTH.getRole() === 'SUPER_ADMIN' &&
            String(AUTH.getUserId()).trim().toUpperCase() === userId.trim().toUpperCase()
        ) {
            return true;
        }

        return permissions[userId]?.[toolId]?.granted === true;
    };

    const canManage = (userId, toolId) => {
        validateIds(userId, toolId);
        ensureLoaded();

        const { AUTH } = getDependencies();
        const role = AUTH.getRole();

        if (role === 'SUPER_ADMIN') return true;
        if (role !== 'ADMIN') return false;

        return permissions[userId]?.[toolId]?.forcedState !== true;
    };

    const save = async () => {
        throw createError('Permission changes must be submitted through NETWORK');
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

    global.YODAWY_PERMISSIONS_ENGINE = Object.freeze({
        version: 2,
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

})(window);
