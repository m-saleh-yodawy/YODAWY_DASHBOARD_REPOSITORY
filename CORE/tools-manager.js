(function (global) {
    'use strict';

    if (global.YODAWY_TOOLS_MANAGER) return;

    const CONFIG = Object.freeze({
        MANIFEST_PATH: 'TOOLS_CACHE/tools-manifest.json',
        REGISTRY_NAME: 'YODAWY_TOOL_INSTANCES'
    });

    const page = document.defaultView || global;
    const loadedTools = new Map();
    const pendingTools = new Map();

    let manifest = [];
    let initialized = false;
    let syncing = false;

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

    const normalizeHash = hash => {
        const value = String(hash || '').trim().toLowerCase().replace(/^sha256-/, '');

        if (!/^[a-f0-9]{64}$/.test(value)) {
            throw createError('Tool manifest contains an invalid SHA-256 hash');
        }

        return value;
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
            const sha256 = normalizeHash(tool.sha256);

            if (!id || !name || ids.has(id) || paths.has(path)) {
                throw createError('Missing or duplicate tool ID, name, or path');
            }

            ids.add(id);
            paths.add(path);

            return Object.freeze({
                ...tool,
                id,
                name,
                path,
                sha256
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

    const getRegistry = () => {
        const registry = page[CONFIG.REGISTRY_NAME];

        return registry && typeof registry === 'object'
            ? registry
            : null;
    };

    const canLoad = (tool, dependencies) => {
        const { AUTH, PERMISSIONS, SETTINGS, VISIBILITY } = dependencies;
        const userId = AUTH.getUserId();

        if (!AUTH.isAuthenticated() || !userId) return false;
        if (!SETTINGS.isLoaded() || !VISIBILITY.isLoaded()) return false;
        if (!PERMISSIONS.isLoaded()) return false;

        const permitted = AUTH.getRole() === 'SUPER_ADMIN'
            ? true
            : PERMISSIONS.canUse(userId, tool.id);

        return (
            permitted &&
            SETTINGS.isEnabled(tool.id) &&
            VISIBILITY.isVisible(tool.id, tool) === true
        );
    };

    const stop = async toolId => {
        const instance = loadedTools.get(toolId);

        if (!instance) return false;

        const registry = getRegistry();
        const registered = registry?.[toolId];

        if (typeof registered?.destroy !== 'function') {
            instance.destroyable = false;
            return false;
        }

        const { LOADER } = getDependencies();

        try {
            const destroyed = await registered.destroy();
            if (destroyed === false) return false;

            if (registry[toolId] === registered) {
                delete registry[toolId];
            }

            LOADER.clear(instance.path);
            loadedTools.delete(toolId);
            return true;
        } catch (error) {
            throw createError(`Failed to stop tool ${toolId}: ${error.message}`);
        }
    };

    const start = async tool => {
        const existing = loadedTools.get(tool.id);
        if (existing && existing.path === tool.path && existing.sha256 === tool.sha256) return true;
        if (existing && !await stop(tool.id)) return false;

        if (pendingTools.has(tool.id)) {
            return pendingTools.get(tool.id);
        }

        const task = (async () => {
            const dependencies = getDependencies();
            if (!canLoad(tool, dependencies)) return false;

            const result = await dependencies.LOADER.load(tool.path, {
                toolId: tool.id,
                sha256: tool.sha256
            });

            if (!result.registered || !result.destroyable) {
                dependencies.LOADER.clear(tool.path, { destroy: true });
                throw createError('Tool ' + tool.id + ' must register an instance with destroy().');
            }

            loadedTools.set(tool.id, {
                id: tool.id,
                name: tool.name,
                path: tool.path,
                sha256: tool.sha256,
                loadedAt: result.loadedAt,
                registered: true,
                destroyable: true
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

        return stop(toolId);
    };

    const sync = async () => {
        ensureInitialized();

        if (syncing) {
            throw createError('Tools synchronization is already running');
        }

        syncing = true;

        try {
            const dependencies = getDependencies();

            for (const tool of manifest) {
                if (canLoad(tool, dependencies)) {
                    await start(tool);
                } else {
                    await stop(tool.id);
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

        return results.every(result =>
            result.status === 'fulfilled' && result.value === true
        );
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
        const loaded = loadedTools.get(toolId);

        return Object.freeze({
            id: tool.id,
            name: tool.name,
            loaded: Boolean(loaded),
            registered: loaded?.registered || false,
            destroyable: loaded?.destroyable || false,
            path: tool.path
        });
    };

    global.YODAWY_TOOLS_MANAGER = Object.freeze({
        version: 2,
        loadManifest,
        sync,
        syncTool,
        start: async toolId => start(getTool(toolId)),
        stop,
        stopAll,
        getManifest,
        getLoadedTools,
        getStatus,
        isLoaded,
        isInitialized: () => initialized
    });

})(window);
