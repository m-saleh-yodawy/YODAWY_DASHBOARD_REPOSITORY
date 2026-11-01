(function (global) {
    'use strict';

    if (global.YODAWY_SETTINGS_ENGINE) return;

    const CONFIG = {
        PATH: 'DASHBOARD/dashboard-settings.json'
    };

    let settings = null;
    let fileSha = null;
    let loaded = false;
    let saving = false;

    let connection = {
        owner: '',
        repository: '',
        branch: 'main',
        userId: '',
        token: ''
    };

    const createError = message => {
        const error = new Error(message);
        error.code = 'SETTINGS_ENGINE_ERROR';
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

    const configure = options => {
        if (!options || typeof options !== 'object') {
            throw createError('Invalid settings configuration');
        }

        const AUTH = global.YODAWY_AUTH_ENGINE;
        const user = AUTH?.getUser();

        connection = {
            owner: String(options.owner || '').trim(),
            repository: String(options.repository || user?.repository || '').trim(),
            branch: String(options.branch || 'main').trim(),
            userId: String(options.userId || AUTH?.getUserId() || '').trim(),
            token: String(options.token || '').trim()
        };

        if (
            !connection.owner ||
            !connection.repository ||
            !connection.branch ||
            !connection.userId ||
            !connection.token
        ) {
            throw createError('Personal repository configuration is incomplete');
        }

        if (connection.userId !== AUTH?.getUserId()) {
            throw createError('Settings user does not match authenticated user');
        }

        loaded = false;
        settings = null;
        fileSha = null;

        return true;
    };

    const getEndpoint = () =>
        `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repository)}/contents/${CONFIG.PATH}`;

    const decodeContent = content => {
        const binary = atob(content.replace(/\s/g, ''));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
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

    const validateSettings = data => {
        if (
            !data ||
            typeof data !== 'object' ||
            Array.isArray(data) ||
            typeof data.tools !== 'object' ||
            !data.tools ||
            Array.isArray(data.tools)
        ) {
            throw createError('Invalid personal settings structure');
        }

        if (
            data.userId &&
            String(data.userId) !== connection.userId
        ) {
            throw createError('Settings belong to another user');
        }

        for (const [toolId, state] of Object.entries(data.tools)) {
            if (
                !toolId.trim() ||
                !['ENABLED', 'DISABLED'].includes(state)
            ) {
                throw createError(`Invalid tool setting: ${toolId}`);
            }
        }

        return data;
    };

    const load = async () => {
        const { API } = getDependencies();

        if (!connection.repository || !connection.token) {
            throw createError('Settings engine is not configured');
        }

        const response = await API.get(
            `${getEndpoint()}?ref=${encodeURIComponent(connection.branch)}`,
            { token: connection.token }
        );

        const file = response.data;

        if (!file?.content || !file?.sha) {
            throw createError('Personal settings file is unavailable');
        }

        const parsed = JSON.parse(decodeContent(file.content));

        settings = validateSettings(parsed);
        fileSha = file.sha;
        loaded = true;

        return getSettings();
    };

    const ensureLoaded = () => {
        if (!loaded || !settings || !fileSha) {
            throw createError('Personal settings have not been loaded');
        }
    };

    const getSettings = () => {
        ensureLoaded();
        return JSON.parse(JSON.stringify(settings));
    };

    const getToolState = toolId => {
        if (typeof toolId !== 'string' || !toolId.trim()) {
            throw createError('Invalid tool ID');
        }

        ensureLoaded();

        return settings.tools[toolId] || 'DISABLED';
    };

    const isEnabled = toolId =>
        getToolState(toolId) === 'ENABLED';

    const save = async updatedSettings => {
        const { API } = getDependencies();

        ensureLoaded();

        if (saving) {
            throw createError('Another settings update is in progress');
        }

        const updated = validateSettings(updatedSettings);

        if (String(updated.userId || '') !== connection.userId) {
            throw createError('Cannot modify another user settings');
        }

        saving = true;

        try {
            const response = await API.put(getEndpoint(), {
                message: 'Update personal dashboard settings',
                content: encodeContent(updated),
                sha: fileSha,
                branch: connection.branch
            }, {
                token: connection.token
            });

            if (!response.data?.content?.sha) {
                throw createError('Settings update was not confirmed');
            }

            settings = updated;
            fileSha = response.data.content.sha;

            return getSettings();
        } finally {
            saving = false;
        }
    };

    const setToolState = async (toolId, state) => {
        if (typeof toolId !== 'string' || !toolId.trim()) {
            throw createError('Invalid tool ID');
        }

        if (!['ENABLED', 'DISABLED'].includes(state)) {
            throw createError('Invalid tool state');
        }

        ensureLoaded();

        const { AUTH } = getDependencies();
        const userId = AUTH.getUserId();
        const permissions = global.YODAWY_PERMISSIONS_ENGINE;

        if (!permissions?.isLoaded()) {
            throw createError('Permissions have not been loaded');
        }

        if (!permissions.canUse(userId, toolId)) {
            throw createError('Tool permission is not granted');
        }

        const updated = getSettings();
        updated.tools[toolId] = state;

        await save(updated);

        return getToolState(toolId);
    };

    const enableTool = toolId =>
        setToolState(toolId, 'ENABLED');

    const disableTool = toolId =>
        setToolState(toolId, 'DISABLED');

    const getAllToolStates = () => {
        ensureLoaded();
        return { ...settings.tools };
    };

    const API = Object.freeze({
        version: 1,
        configure,
        load,
        save,
        getSettings,
        getToolState,
        getAllToolStates,
        isEnabled,
        setToolState,
        enableTool,
        disableTool,
        isLoaded: () => loaded
    });

    global.YODAWY_SETTINGS_ENGINE = API;

})(window);
