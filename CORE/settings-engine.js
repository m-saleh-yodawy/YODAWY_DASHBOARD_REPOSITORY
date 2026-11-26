(function (global) {
    'use strict';

    if (global.YODAWY_SETTINGS_ENGINE) return;

    let settings = null;
    let loaded = false;
    let saving = false;
    let userId = '';

    const createError = message => {
        const error = new Error(message);
        error.code = 'SETTINGS_ENGINE_ERROR';
        return error;
    };

    const getDependencies = () => {
        const API = global.YODAWY_API_ENGINE;
        const AUTH = global.YODAWY_AUTH_ENGINE;
        if (!API || !AUTH) throw createError('Required engines are unavailable');
        return { API, AUTH };
    };

    const configure = () => {
        const { AUTH } = getDependencies();
        const currentUserId = String(AUTH.getUserId() || '').trim();
        if (!currentUserId) throw createError('Authenticated user is unavailable');
        if (userId !== currentUserId) {
            userId = currentUserId;
            settings = null;
            loaded = false;
        }
        return true;
    };

    const validateSettings = value => {
        if (!value || typeof value !== 'object' || Array.isArray(value) || !value.tools || typeof value.tools !== 'object' || Array.isArray(value.tools)) {
            throw createError('Invalid personal settings structure');
        }
        if (value.userId && String(value.userId) !== userId) throw createError('Settings belong to another user');
        const tools = {};
        for (const [toolId, state] of Object.entries(value.tools)) {
            if (!toolId.trim() || !['ENABLED', 'DISABLED'].includes(state)) throw createError('Invalid tool setting: ' + toolId);
            tools[toolId] = state;
        }
        return { ...value, userId, tools, startPage: ['overview', 'tools'].includes(String(value.startPage || '').toLowerCase()) ? String(value.startPage).toLowerCase() : 'tools' };
    };

    const load = async () => {
        const { API } = getDependencies();
        configure();
        const response = await API.get('/api/dashboard/settings');
        if (response?.success !== true) throw createError(response?.error || 'Personal settings could not be loaded');
        settings = validateSettings(response.settings || { userId, tools: {}, startPage: 'tools' });
        loaded = true;
        return getSettings();
    };

    const ensureLoaded = () => {
        configure();
        if (!loaded || !settings) throw createError('Personal settings have not been loaded');
    };

    const getSettings = () => {
        ensureLoaded();
        return JSON.parse(JSON.stringify(settings));
    };

    const getToolState = toolId => {
        if (typeof toolId !== 'string' || !toolId.trim()) throw createError('Invalid tool ID');
        ensureLoaded();
        return settings.tools[toolId] || (toolId === 'TOOL-019' ? 'ENABLED' : 'DISABLED');
    };

    const isEnabled = toolId => getToolState(toolId) === 'ENABLED';

    const save = async value => {
        const { API } = getDependencies();
        ensureLoaded();
        if (saving) throw createError('Another settings update is in progress');
        const updated = validateSettings(value);
        saving = true;
        try {
            const response = await API.put('/api/dashboard/settings', { settings: updated });
            const result = response?.data || response;
            if (result?.success !== true || !result.settings) throw createError(result?.error || 'Settings update was not confirmed');
            settings = validateSettings(result.settings);
            return getSettings();
        } finally {
            saving = false;
        }
    };

    const setToolState = async (toolId, state) => {
        if (typeof toolId !== 'string' || !toolId.trim() || !['ENABLED', 'DISABLED'].includes(state)) throw createError('Invalid tool setting');
        ensureLoaded();
        const { AUTH } = getDependencies();
        const permissions = global.YODAWY_PERMISSIONS_ENGINE;
        if (!permissions?.isLoaded()) throw createError('Permissions have not been loaded');
        if (!permissions.canUse(AUTH.getUserId(), toolId)) throw createError('Tool permission is not granted');
        const updated = getSettings();
        updated.tools[toolId] = state;
        await save(updated);
        return getToolState(toolId);
    };

    global.YODAWY_SETTINGS_ENGINE = Object.freeze({
        version: 2,
        configure,
        load,
        save,
        getSettings,
        getToolState,
        getAllToolStates: () => { ensureLoaded(); return { ...settings.tools }; },
        isEnabled,
        setToolState,
        enableTool: toolId => setToolState(toolId, 'ENABLED'),
        disableTool: toolId => setToolState(toolId, 'DISABLED'),
        isLoaded: () => loaded && userId === String(global.YODAWY_AUTH_ENGINE?.getUserId() || '')
    });
})(window);
