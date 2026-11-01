(function (global) {
    'use strict';

    if (global.YODAWY_API_ENGINE) return;

    const CONFIG = {
        BASE_URL: 'https://api.github.com',
        API_VERSION: '2022-11-28',
        TIMEOUT: 20000
    };

    let settings = {
        owner: '',
        repo: '',
        branch: 'main',
        token: ''
    };

    const createError = (message, status = 0, data = null, headers = null) => {
        const error = new Error(message);
        error.status = status;
        error.data = data;
        error.headers = headers;
        error.rateLimitRemaining = Number(headers?.get('x-ratelimit-remaining') ?? -1);
        error.rateLimitReset = Number(headers?.get('x-ratelimit-reset') ?? 0);
        return error;
    };

    const configure = options => {
        if (!options || typeof options !== 'object') {
            throw createError('Invalid API configuration');
        }

        if (options.owner !== undefined) settings.owner = String(options.owner).trim();
        if (options.repo !== undefined) settings.repo = String(options.repo).trim();
        if (options.branch !== undefined) settings.branch = String(options.branch).trim();
        if (options.token !== undefined) settings.token = String(options.token).trim();

        return true;
    };

    const request = async (path, options = {}) => {
        if (typeof path !== 'string' || !path.trim()) {
            throw createError('Invalid API endpoint');
        }

        const endpoint = path.startsWith('/')
            ? `${CONFIG.BASE_URL}${path}`
            : `${CONFIG.BASE_URL}/${path}`;

        const url = new URL(endpoint);

        if (url.origin !== CONFIG.BASE_URL) {
            throw createError('Invalid API origin');
        }

        const method = String(options.method || 'GET').toUpperCase();
        const token = options.token || settings.token;

        const headers = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': CONFIG.API_VERSION,
            ...options.headers
        };

        if (token) headers.Authorization = `Bearer ${token}`;

        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeout || CONFIG.TIMEOUT);

        try {
            const response = await fetch(url.href, {
                method,
                headers,
                body: options.body === undefined
                    ? undefined
                    : JSON.stringify(options.body),
                signal: controller.signal,
                cache: 'no-store',
                credentials: 'omit'
            });

            const contentType = response.headers.get('content-type') || '';
            const data = contentType.includes('application/json')
                ? await response.json()
                : await response.text();

            if (!response.ok) {
                throw createError(
                    data?.message || `GitHub API request failed: ${response.status}`,
                    response.status,
                    data,
                    response.headers
                );
            }

            return {
                ok: true,
                status: response.status,
                data,
                headers: response.headers
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw createError('GitHub API request timed out');
            }

            if (error.status !== undefined) throw error;

            throw createError(error.message || 'GitHub API network error');
        } finally {
            clearTimeout(timeout);
        }
    };

    const get = (path, options = {}) =>
        request(path, { ...options, method: 'GET' });

    const post = (path, body, options = {}) =>
        request(path, { ...options, method: 'POST', body });

    const put = (path, body, options = {}) =>
        request(path, { ...options, method: 'PUT', body });

    const patch = (path, body, options = {}) =>
        request(path, { ...options, method: 'PATCH', body });

    const remove = (path, options = {}) =>
        request(path, { ...options, method: 'DELETE' });

    const repositoryPath = path => {
        const { owner, repo } = settings;

        if (!owner || !repo) {
            throw createError('Repository configuration is missing');
        }

        const cleanPath = String(path || '').replace(/^\/+/, '');

        return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${cleanPath}`;
    };

    const getFile = async (path, options = {}) => {
        const response = await get(repositoryPath(path), {
            ...options,
            headers: {
                Accept: 'application/vnd.github+json',
                ...options.headers
            }
        });

        return response.data;
    };

    const getFileContent = async (path, options = {}) => {
        const response = await get(repositoryPath(path), options);
        const content = response.data?.content;

        if (typeof content !== 'string') {
            throw createError('Repository file content is unavailable');
        }

        try {
            const binary = atob(content.replace(/\s/g, ''));
            const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
            return new TextDecoder('utf-8').decode(bytes);
        } catch {
            throw createError('Failed to decode repository file');
        }
    };

    const getRepository = async options => {
        const { owner, repo } = settings;

        if (!owner || !repo) {
            throw createError('Repository configuration is missing');
        }

        const response = await get(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
            options
        );

        return response.data;
    };

    const clearToken = () => {
        settings.token = '';
        return true;
    };

    const getConfig = () => Object.freeze({
        owner: settings.owner,
        repo: settings.repo,
        branch: settings.branch,
        configured: Boolean(settings.owner && settings.repo)
    });

    global.YODAWY_API_ENGINE = Object.freeze({
        version: 1,
        configure,
        request,
        get,
        post,
        put,
        patch,
        delete: remove,
        getFile,
        getFileContent,
        getRepository,
        clearToken,
        getConfig
    });

})(window);
