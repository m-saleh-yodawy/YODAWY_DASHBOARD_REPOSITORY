(function (global) {
    'use strict';

    if (global.YODAWY_MODULE_LOADER) return;

    const loadedModules = new Map();
    const pendingModules = new Map();
    const page = document.defaultView || global;

    const createError = (message, cause = null) => {
        const error = new Error(message);
        error.code = 'MODULE_LOADER_ERROR';
        if (cause) error.cause = cause;
        return error;
    };

    const getRegistry = () => {
        if (!page.YODAWY_TOOL_INSTANCES || typeof page.YODAWY_TOOL_INSTANCES !== 'object') {
            Object.defineProperty(page, 'YODAWY_TOOL_INSTANCES', {
                value: Object.create(null),
                configurable: true
            });
        }

        return page.YODAWY_TOOL_INSTANCES;
    };

    const normalizePath = path => {
        if (typeof path !== 'string' || !path.trim()) {
            throw createError('Invalid module path');
        }

        const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+/, '');

        if (
            normalized.split('/').some(part => !part || part === '.' || part === '..') ||
            !/\.js$/i.test(normalized)
        ) {
            throw createError('Invalid JavaScript module path');
        }

        return normalized;
    };

    const normalizeHash = hash => {
        const value = String(hash || '').trim().toLowerCase().replace(/^sha256-/, '');

        if (!/^[a-f0-9]{64}$/.test(value)) {
            throw createError('A valid SHA-256 hash is required');
        }

        return value;
    };

    const calculateHash = async source => {
        if (!page.crypto?.subtle) {
            throw createError('SHA-256 verification is unavailable');
        }

        const bytes = new TextEncoder().encode(source);
        const digest = await page.crypto.subtle.digest('SHA-256', bytes);

        return Array.from(new Uint8Array(digest))
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
    };

    const verifyHash = async (source, expectedHash) => {
        const expected = normalizeHash(expectedHash);
        const actual = await calculateHash(source);

        if (actual !== expected) {
            throw createError('Module SHA-256 verification failed');
        }

        return true;
    };

    const load = async (path, options = {}) => {
        const modulePath = normalizePath(path);
        const toolId = String(options.toolId || '').trim();

        if (!toolId) {
            throw createError('Tool ID is required');
        }

        const cached = loadedModules.get(modulePath);

        if (cached) {
            if (cached.toolId !== toolId) {
                throw createError('Module is already assigned to another tool');
            }

            return cached;
        }

        if (pendingModules.has(modulePath)) {
            return pendingModules.get(modulePath);
        }

        const task = (async () => {
            const API = global.YODAWY_API_ENGINE;

            if (!API?.getFileContent) {
                throw createError('API Engine is unavailable');
            }

            const source = await API.getFileContent(modulePath, {
                token: options.token,
                timeout: options.timeout
            });

            if (typeof source !== 'string' || !source.trim()) {
                throw createError(`Module source is empty: ${modulePath}`);
            }

            await verifyHash(source, options.sha256);

            const registry = getRegistry();

            if (registry[toolId]) {
                throw createError(`Tool is already registered: ${toolId}`);
            }

            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.textContent = source;

            try {
                (document.head || document.documentElement).appendChild(script);
            } catch (error) {
                delete registry[toolId];
                throw createError(`Module execution failed: ${modulePath}`, error);
            } finally {
                script.remove();
            }

            const instance = registry[toolId] || null;

            const result = Object.freeze({
                toolId,
                path: modulePath,
                loadedAt: Date.now(),
                registered: Boolean(instance),
                destroyable: typeof instance?.destroy === 'function' || typeof instance?.suspend === 'function'
            });

            loadedModules.set(modulePath, result);

            return result;
        })();

        pendingModules.set(modulePath, task);

        try {
            return await task;
        } finally {
            pendingModules.delete(modulePath);
        }
    };

    const loadMany = async (items, options = {}) => {
        if (!Array.isArray(items)) {
            throw createError('Module list must be an array');
        }

        return Promise.all(
            items.map(item => {
                if (typeof item === 'string') {
                    return load(item, options);
                }

                if (!item || typeof item !== 'object') {
                    throw createError('Invalid module entry');
                }

                return load(item.path, {
                    ...options,
                    ...item
                });
            })
        );
    };

    const isLoaded = path =>
        loadedModules.has(normalizePath(path));

    const getLoaded = () =>
        [...loadedModules.values()];

    const getInstance = toolId => {
        const id = String(toolId || '').trim();
        return id ? getRegistry()[id] || null : null;
    };

    const clear = (path, options = {}) => {
        if (path === undefined) {
            if (loadedModules.size) {
                throw createError('Individual modules must be stopped before clearing the cache');
            }

            return true;
        }

        const modulePath = normalizePath(path);
        const cached = loadedModules.get(modulePath);

        if (!cached) return false;

        const instance = getInstance(cached.toolId);

        if (typeof instance?.destroy === 'function' && options.destroy !== true) {
            throw createError('Tool must be destroyed before clearing its module');
        }

        if (options.destroy === true) {
            delete getRegistry()[cached.toolId];
        }

        return loadedModules.delete(modulePath);
    };

    global.YODAWY_MODULE_LOADER = Object.freeze({
        version: 2,
        load,
        loadMany,
        isLoaded,
        getLoaded,
        getInstance,
        clear
    });

})(window);
