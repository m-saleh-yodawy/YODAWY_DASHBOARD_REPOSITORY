(function (global) {
    'use strict';

    if (global.YODAWY_TOOLS_MANAGER) return;

    const CONFIG = {
        MANIFEST_PATH: 'TOOLS_CACHE/tools-manifest.json',
        REGISTRY_NAME: 'YODAWY_TOOL_INSTANCES'
    };

    let manifest = [];
    let initialized = false;
    let syncing = false;

    const loadedTools = new Map();
    const pendingTools = new Map();

    const createError = message => {
        const error = new Error(message);
        error.code = 'TOOLS_MANAGER_ERROR';
        return error;
    };

    const getDependencies = () => {
        const API = global.YODAWY_API_ENGINE;
        const AUTH = global.YODAWY_AUTH_ENGINE;
        const LOADER = global.YODAWY_MODULE_LOADER;
        const PERMISSIONS = global.YODAWY_PERMISSIONS_ENGINE;
        const SETTINGS = global.YODAWY_SETTINGS_ENGINE;
        const VISIBILITY = global.YODAWY_VISIBILITY_ENGINE;

        if (!API || !AUTH || !LOADER || !PERMISSIONS || !SETTINGS || !VISIBILITY) {
            throw createError('Required engines are unavailable');
        }

        return { API, AUTH, LOADER, PERMISSIONS, SETTINGS, VISIBILITY };
    };

    const normalizePath = path => {
        if (typeof path !== 'string' || !path.trim()) {
            throw createError('Invalid tool path');
        }

        let normalized = path.trim().replace(/\\/g, '/').replace(/^\/+/, '');

        if (normalized.startsWith('TOOLS_CACHE/')) {
            normalized = normalized;
        } else if (normalized.startsWith('TOOLS/')) {
            normalized = `TOOLS_CACHE/${normalized}`;
        } else {
            normalized = `TOOLS_CACHE/TOOLS/${normalized.split('/').pop()}`;
        }

        const parts = normalized.split('/');

        if (
            parts.some(part => !part || part === '.' || part === '..') ||
            !/\.js$/i.test(normalized) ||
            /\.min\.js$/i.test(normalized)
        ) {
            throw createError('Invalid or unsupported tool path');
        }

        return normalized;
    };

    const validateManifest = data => {
        if (!data || !Array.isArray(data.tools)) {
            throw createError('Invalid tools manifest structure');
        }

        const ids = new Set();
        const paths = new Set();

        return data.tools.map(tool => {
            if (!tool || typeof tool !== 'object') {
                throw createError('Invalid tool manifest entry');
            }

            const id = String(tool.id || '').trim();
            const name = String(tool.name || '').trim();
            const path = normalizePath(tool.path || tool.file);

            if (!id || !name || ids.has(id) || paths.has(path)) {
                throw createError('Missing or duplicate tool ID, name, or path');
            }

            ids.add(id);
            paths.add(path);

            return Object.freeze({
                ...tool,
                id,
                name,
                path
            });
        });
    };

    const loadManifest = async () => {
        const { API } = getDependencies();
        const content = await API.getFileContent(CONFIG.MANIFEST_PATH);
        const data = JSON.parse(content);

        manifest = validateManifest(data);
        initialized = true;

        return getManifest();
    };

    const ensureInitialized = () => {
        if (!initialized) {
            throw createError('Tools manager has not been initialized');
        }
    };

    const getTool = toolId => {
        ensureInitialized();

        const tool = manifest.find(item => item.id === toolId);

        if (!tool) {
            throw createError(`Tool not found: ${toolId}`);
        }

        return tool;
    };

    const canLoad = (tool, dependencies) => {
        const { AUTH, PERMISSIONS, SETTINGS, VISIBILITY } = dependencies;
        const userId = AUTH.getUserId();

        if (!AUTH.isAuthenticated() || !userId) return false;
        if (!PERMISSIONS.isLoaded() || !SETTINGS.isLoaded()) return false;

        return (
            PERMISSIONS.canUse(userId, tool.id) &&
            SETTINGS.isEnabled(tool.id) &&
            VISIBILITY.isVisible(tool.id, tool) === true
        );
    };

    const getRegistry = () => {
        const registry = global[CONFIG.REGISTRY_NAME];

        if (!registry || typeof registry !== 'object') {
            return null;
        }

        return registry;
    };

    const stop = async toolId => {
        const instance = loadedTools.get(toolId);

        if (!instance) return false;

        const registry = getRegistry();
        const registered = registry?.[toolId];

        try {
            if (typeof registered?.destroy === 'function') {
                await registered.destroy();
            }
        } finally {
            loadedTools.delete(toolId);
        }

        return true;
    };

    const start = async tool => {
        if (loadedTools.has(tool.id)) return true;

        if (pendingTools.has(tool.id)) {
            return pendingTools.get(tool.id);
        }

        const task = (async () => {
            const dependencies = getDependencies();

            if (!canLoad(tool, dependencies)) return false;

            await dependencies.LOADER.load(tool.path);

            loadedTools.set(tool.id, {
                id: tool.id,
                path: tool.path,
                loadedAt: Date.now()
            });

            return true;
        })();

        pendingTools.set(tool.id, task);

        try {
            return await task;
        } finally {
            pendingTools.delete(tool.id);
        }
    };

    const syncTool = async toolId => {
        const tool = getTool(toolId);
        const dependencies = getDependencies();

        if (canLoad(tool, dependencies)) {
            return start(tool);
        }

        await stop(toolId);
        return false;
    };

    const sync = async () => {
        ensureInitialized();

        if (syncing) {
            throw createError('Tools synchronization is already running');
        }

        syncing = true;

        try {
            const dependencies = getDependencies();
            const results = [];

            for (const tool of manifest) {
                if (canLoad(tool, dependencies)) {
                    results.push(await start(tool));
                } else {
                    await stop(tool.id);
                    results.push(false);
                }
            }

            return getLoadedTools();
        } finally {
            syncing = false;
        }
    };

    const stopAll = async () => {
        const ids = [...loadedTools.keys()];
        const results = await Promise.allSettled(ids.map(stop));

        return results.every(result => result.status === 'fulfilled');
    };

    const getManifest = () => {
        ensureInitialized();
        return manifest.map(tool => ({ ...tool }));
    };

    const getLoadedTools = () =>
        [...loadedTools.values()].map(tool => ({ ...tool }));

    const isLoaded = toolId =>
        loadedTools.has(toolId);

    const getStatus = toolId => {
        const tool = getTool(toolId);

        return Object.freeze({
            id: tool.id,
            name: tool.name,
            loaded: loadedTools.has(toolId),
            path: tool.path
        });
    };

    const API = Object.freeze({
        version: 1,
        loadManifest,
        sync,
        syncTool,
        stop,
        stopAll,
        getManifest,
        getLoadedTools,
        getStatus,
        isLoaded,
        isInitialized: () => initialized
    });

    global.YODAWY_TOOLS_MANAGER = API;

})(window);
