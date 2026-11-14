(function (global) {
    'use strict';

    if (global.YODAWY_VISIBILITY_ENGINE) return;

    const CONFIG = {
        PATH: 'CONFIG/tools-visibility.json',
        VISIBILITY_TYPES: ['PRIVATE', 'PUBLIC', 'SELECTED_USERS']
    };

    let visibility = {};
    let loaded = false;

    const createError = message => {
        const error = new Error(message);
        error.code = 'VISIBILITY_ENGINE_ERROR';
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

    const normalizeUserId = userId =>
        String(userId || '').trim().toUpperCase();

    const validateRecord = (toolId, record) => {
        if (
            !toolId ||
            !record ||
            typeof record !== 'object' ||
            Array.isArray(record)
        ) {
            throw createError(`Invalid visibility record: ${toolId}`);
        }

        if (!CONFIG.VISIBILITY_TYPES.includes(record.visibility)) {
            throw createError(`Invalid visibility type: ${toolId}`);
        }

        if (!Array.isArray(record.allowedUsers)) {
            throw createError(`Invalid allowedUsers: ${toolId}`);
        }

        return Object.freeze({
            visibility: record.visibility,
            allowedUsers: Object.freeze(
                [...new Set(
                    record.allowedUsers
                        .map(normalizeUserId)
                        .filter(Boolean)
                )]
            )
        });
    };

    const load = async () => {
        const { API } = getDependencies();

        const content = await API.getFileContent(CONFIG.PATH);
        const data = JSON.parse(content);

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw createError('Invalid visibility configuration');
        }

        const validated = {};

        for (const [toolId, record] of Object.entries(data)) {
            validated[toolId] = validateRecord(toolId, record);
        }

        visibility = validated;
        loaded = true;

        return getAll();
    };

    const ensureLoaded = () => {
        if (!loaded) {
            throw createError('Visibility configuration has not been loaded');
        }
    };

    const getRecord = toolId => {
        if (typeof toolId !== 'string' || !toolId.trim()) {
            throw createError('Invalid tool ID');
        }

        ensureLoaded();

        return visibility[toolId] || null;
    };

    const isSuperAdmin = () => {
        const { AUTH } = getDependencies();

        return AUTH.isAuthenticated() && AUTH.getRole() === 'SUPER_ADMIN';
    };

    const canManage = () =>
        isSuperAdmin();

    const isVisible = (toolId, tool = null) => {
        const { AUTH } = getDependencies();

        if (!AUTH.isAuthenticated()) return false;

        if (isSuperAdmin()) return true;

        const record = getRecord(toolId);

        if (!record) return false;

        if (record.visibility === 'PUBLIC') return true;

        if (record.visibility === 'PRIVATE') return false;

        if (record.visibility === 'SELECTED_USERS') {
            const userId = normalizeUserId(AUTH.getUserId());

            return record.allowedUsers.includes(userId);
        }

        return false;
    };

    const getVisibility = toolId => {
        const record = getRecord(toolId);

        if (!record) {
            return Object.freeze({
                visibility: 'PRIVATE',
                allowedUsers: []
            });
        }

        return Object.freeze({
            ...record,
            allowedUsers: [...record.allowedUsers]
        });
    };

    const getAll = () => {
        ensureLoaded();

        return Object.fromEntries(
            Object.entries(visibility).map(([toolId, record]) => [
                toolId,
                {
                    ...record,
                    allowedUsers: [...record.allowedUsers]
                }
            ])
        );
    };

    const getVisibleTools = tools => {
        if (!Array.isArray(tools)) {
            throw createError('Tools must be an array');
        }

        return tools.filter(tool =>
            tool &&
            typeof tool.id === 'string' &&
            isVisible(tool.id, tool)
        );
    };

    const API = Object.freeze({
        version: 1,
        load,
        isVisible,
        canManage,
        isSuperAdmin,
        getVisibility,
        getVisibleTools,
        getAll,
        isLoaded: () => loaded
    });

    global.YODAWY_VISIBILITY_ENGINE = API;

})(window);
