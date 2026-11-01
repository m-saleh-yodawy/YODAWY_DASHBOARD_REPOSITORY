(function (global) {
    'use strict';

    if (global.YODAWY_MODULE_LOADER) return;

    const loadedModules = new Map();
    const pendingModules = new Map();

    const createError = (message, cause = null) => {
        const error = new Error(message);
        error.code = 'MODULE_LOADER_ERROR';
        if (cause) error.cause = cause;
        return error;
    };

    const normalizePath = path => {
        if (typeof path !== 'string' || !path.trim()) {
            throw createError('Invalid module path');
        }

        const normalized = path.trim().replace(/^\/+/, '');

        if (
            normalized.split('/').some(part => !part || part === '.' || part === '..') ||
            !/\.js$/i.test(normalized)
        ) {
            throw createError('Invalid JavaScript module path');
        }

        return normalized;
    };

    const load = async (path, options = {}) => {
        const modulePath = normalizePath(path);

        if (loadedModules.has(modulePath)) {
            return loadedModules.get(modulePath);
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

            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.textContent = source;

            try {
                (document.head || document.documentElement).appendChild(script);
            } catch (error) {
                throw createError(`Module execution failed: ${modulePath}`, error);
            } finally {
                script.remove();
            }

            const result = Object.freeze({
                path: modulePath,
                loadedAt: Date.now()
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

    const loadMany = async (paths, options = {}) => {
        if (!Array.isArray(paths)) {
            throw createError('Module paths must be an array');
        }

        const uniquePaths = [...new Set(paths.map(normalizePath))];

        return Promise.all(
            uniquePaths.map(path => load(path, options))
        );
    };

    const isLoaded = path =>
        loadedModules.has(normalizePath(path));

    const getLoaded = () =>
        [...loadedModules.values()];

    const clear = path => {
        if (path === undefined) {
            loadedModules.clear();
            return true;
        }

        return loadedModules.delete(normalizePath(path));
    };

    const API = Object.freeze({
        version: 1,
        load,
        loadMany,
        isLoaded,
        getLoaded,
        clear
    });

    global.YODAWY_MODULE_LOADER = API;

})(window);
