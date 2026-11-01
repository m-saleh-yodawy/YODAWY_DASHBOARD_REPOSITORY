 (async function () {
    'use strict';

    const API = C.API || 'https://api.github.com';
    const OWNER = C.OWNER;
    const REPO = C.REPO;
    const BRANCH = C.BRANCH;
    const SYSTEM = C.SYSTEM_TOKEN;
    const PERSONAL = C.PERSONAL_TOKEN;
    const USER_ID = C.USER_ID;
    const W = typeof window !== 'undefined' ? window : null;
    const P = typeof unsafeWindow !== 'undefined' ? unsafeWindow : W;

    const PATHS = {
        config: 'AUTH/auth-config.json',
        messages: 'AUTH/auth-messages.json',
        systemAuth: 'AUTH/system-auth.js',
        personalAuth: 'AUTH/personal-auth.js',
        errorEngine: 'UI/error-message-engine.js'
    };

    const FALLBACK_MESSAGES = {
        WRONG_SYSTEM: {
            title: 'SYSTEM ERROR',
            message: 'INVALID OR DISABLED SYSTEM CONFIGURATION.'
        },
        NETWORK_ERROR: {
            title: 'CONNECTION ERROR',
            message: 'UNABLE TO CONNECT. CHECK YOUR NETWORK AND TRY AGAIN.'
        },
        ERROR_ENGINE_LOAD_FAILED: {
            title: 'SYSTEM ERROR',
            message: 'THE CENTRAL ERROR MESSAGE ENGINE COULD NOT BE LOADED.'
        },
        ENGINE_LOAD_FAILED: {
            title: 'SYSTEM ERROR',
            message: 'THE DASHBOARD ENGINE COULD NOT BE LOADED.'
        },
        ENGINE_INIT_FAILED: {
            title: 'SYSTEM ERROR',
            message: 'THE DASHBOARD ENGINE FAILED TO INITIALIZE.'
        },
        UNKNOWN_ERROR: {
            title: 'SYSTEM ERROR',
            message: 'AN UNEXPECTED ERROR OCCURRED.'
        }
    };

    let messages = {};
    let centralError;

    const request = async (url, token) => {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28'
            },
            credentials: 'omit',
            cache: 'no-store'
        });

        if (!response.ok) {
            throw Object.assign(new Error(`GitHub ${response.status}`), {
                status: response.status,
                code: response.status === 401 || response.status === 403 ||
                    response.status === 404
                    ? 'WRONG_SYSTEM'
                    : 'NETWORK_ERROR'
            });
        }

        return response.json();
    };

    const decode = content => new TextDecoder().decode(
        Uint8Array.from(
            atob(content.replace(/\s/g, '')),
            char => char.charCodeAt(0)
        )
    );

    const readText = async (repo, path, token, branch = BRANCH) => {
        const encoded = path.split('/').map(encodeURIComponent).join('/');
        const data = await request(
            `${API}/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(repo)}/contents/${encoded}?ref=${encodeURIComponent(branch)}`,
            token
        );

        if (typeof data.content !== 'string') {
            throw Object.assign(new Error(`Missing file: ${path}`), {
                code: 'UNKNOWN_ERROR'
            });
        }

        return decode(data.content);
    };

    const readJSON = async (repo, path, token, branch = BRANCH) =>
        JSON.parse(await readText(repo, path, token, branch));

    const getMessage = (code, fallback) => {
        const entry = messages[code];

        return {
            code,
            title: entry?.title || fallback?.title || 'SYSTEM ERROR',
            message: entry?.message ||
                (typeof entry === 'string' ? entry : fallback?.message) ||
                FALLBACK_MESSAGES.UNKNOWN_ERROR.message
        };
    };

    const showError = (code, title, message) => {
        const error = getMessage(code, { title, message });

        if (centralError && typeof centralError.show === 'function') {
            centralError.show(error);
        } else {
            alert(`${error.title}\n\n${error.message}`);
        }
    };

    const stop = (code, title, message) => {
        showError(code, title, message);
    };

    const loadScript = async (path) => {
        const source = await readText(REPO, path, SYSTEM);
        new Function('window', source)(W);
    };

    const resolveRole = role => {
        const normalized = String(role || 'USER')
            .trim()
            .toUpperCase()
            .replace(/[\s-]+/g, '_');

        if (['SUPERADMIN', 'SUPER_ADMIN'].includes(normalized)) {
            return 'SUPER_ADMIN';
        }

        if (['ADMIN', 'ADMINISTRATOR'].includes(normalized)) {
            return 'ADMIN';
        }

        return 'USER';
    };

    try {
        if (
            !W ||
            !OWNER ||
            !REPO ||
            !BRANCH ||
            !USER_ID ||
            !SYSTEM ||
            SYSTEM.includes('PASTE_')
        ) {
            throw Object.assign(new Error('WRONG_SYSTEM'), {
                code: 'WRONG_SYSTEM'
            });
        }

        const authConfig = await readJSON(
            REPO,
            PATHS.config,
            SYSTEM
        );

        if (
            authConfig.provider !== 'github' ||
            authConfig.owner !== OWNER ||
            authConfig.branch !== BRANCH ||
            authConfig.userRegistry?.repository !== REPO ||
            authConfig.userRegistry?.path !== 'CONFIG/users.json'
        ) {
            throw Object.assign(new Error('WRONG_SYSTEM'), {
                code: 'WRONG_SYSTEM'
            });
        }

        try {
            const data = await readJSON(
                REPO,
                PATHS.messages,
                SYSTEM
            );

            messages = data?.messages || data || {};
        } catch {
            messages = {};
        }

        const errorPath =
            authConfig.dashboard?.errorMessageEngine?.path ||
            authConfig.dashboard?.errorMessageEnginePath ||
            PATHS.errorEngine;

        try {
            const source = await readText(REPO, errorPath, SYSTEM);
            new Function('window', source)(W);

            centralError = W.YODAWY_ERROR_ENGINE;

            if (!centralError || typeof centralError.show !== 'function') {
                throw new Error('Error engine unavailable');
            }

            centralError.configure?.({ messages });
        } catch {
            throw Object.assign(new Error('ERROR_ENGINE_LOAD_FAILED'), {
                code: 'ERROR_ENGINE_LOAD_FAILED'
            });
        }

        await loadScript(PATHS.systemAuth);

        if (
            !W.YODAWYSystemAuth ||
            typeof W.YODAWYSystemAuth.authenticate !== 'function'
        ) {
            throw Object.assign(new Error('SYSTEM_AUTH_LOAD_FAILED'), {
                code: 'UNKNOWN_ERROR'
            });
        }

        const systemAuth = await W.YODAWYSystemAuth.authenticate({
            userId: USER_ID,
            systemToken: SYSTEM
        });

        if (!systemAuth?.ok) {
            const message = systemAuth?.message || {};
            stop(
                systemAuth?.code || 'UNKNOWN_ERROR',
                message.title || 'SYSTEM AUTHENTICATION FAILED',
                message.message || 'SYSTEM AUTHENTICATION FAILED.'
            );
            return;
        }

        await loadScript(PATHS.personalAuth);

        if (
            !W.YODAWYPersonalAuth ||
            typeof W.YODAWYPersonalAuth.authenticate !== 'function'
        ) {
            throw Object.assign(new Error('PERSONAL_AUTH_LOAD_FAILED'), {
                code: 'UNKNOWN_ERROR'
            });
        }

        const personalAuth = await W.YODAWYPersonalAuth.authenticate({
            systemAuth,
            personalToken: PERSONAL
        });

        if (!personalAuth?.ok) {
            const message = personalAuth?.message || {};
            stop(
                personalAuth?.code || 'UNKNOWN_ERROR',
                message.title || 'PERSONAL AUTHENTICATION FAILED',
                message.message || 'PERSONAL AUTHENTICATION FAILED.'
            );
            return;
        }

        const user = systemAuth.user;
        const personalRepository = personalAuth.repository.name;
        const resolvedRole = resolveRole(user.role);

        const engines =
            authConfig.dashboard?.engines ||
            authConfig.dashboard?.roleEngines ||
            {};

        const roleEnginePaths = {
            USER: 'ENGINES/user-engine.js',
            ADMIN: 'ENGINES/admin-engine.js',
            SUPER_ADMIN: 'ENGINES/super-admin-engine.js'
        };

        const enginePath =
            engines[resolvedRole] ||
            engines[resolvedRole.toLowerCase()] ||
            roleEnginePaths[resolvedRole] ||
            authConfig.dashboard?.enginePath;

        if (!enginePath) {
            throw Object.assign(new Error('ENGINE_LOAD_FAILED'), {
                code: 'ENGINE_LOAD_FAILED'
            });
        }

        const YODAWY = {
            userId: user.id,
            personalToken: PERSONAL,
            registryToken: SYSTEM,
            personalRepository,
            owner: OWNER,
            dashboardRepository: REPO,
            usersRepository: 'YODAWY_USERS_REPOSITORY',
            branch: BRANCH,
            apiBase: API,
            authConfig,
            authMessages: messages,
            userRole: resolvedRole,
            dashboardVariant: resolvedRole,
            authenticated: true,
            request: (url, token) => request(url, token || SYSTEM),
            readJSON: (repo, path, token, branch) =>
                readJSON(repo, path, token || SYSTEM, branch),
            readText: (repo, path, token, branch) =>
                readText(repo, path, token || SYSTEM, branch),
            showError,
            verifyPersonalRepository: (repo, token) =>
                request(
                    `${API}/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(repo)}`,
                    token
                )
        };

        W.YODAWY = YODAWY;

        if (P) {
            P.YODAWY = YODAWY;
        }

        let engineSource;

        try {
            engineSource = await readText(
                REPO,
                enginePath,
                SYSTEM
            );
        } catch {
            throw Object.assign(new Error('ENGINE_LOAD_FAILED'), {
                code: 'ENGINE_LOAD_FAILED'
            });
        }

        new Function('YODAWY', 'window', engineSource)(
            YODAWY,
            W
        );

        if (typeof YODAWY.init !== 'function') {
            throw Object.assign(new Error('ENGINE_INIT_FAILED'), {
                code: 'ENGINE_INIT_FAILED'
            });
        }

        const initialized = await YODAWY.init();

        if (
            initialized !== true ||
            YODAWY.authenticated !== true
        ) {
            throw Object.assign(new Error('ENGINE_INIT_FAILED'), {
                code: 'ENGINE_INIT_FAILED'
            });
        }

    } catch (error) {
        const code = error?.code ||
            (error?.message === 'WRONG_SYSTEM'
                ? 'WRONG_SYSTEM'
                : error?.message === 'ERROR_ENGINE_LOAD_FAILED'
                    ? 'ERROR_ENGINE_LOAD_FAILED'
                    : error?.message === 'ENGINE_LOAD_FAILED'
                        ? 'ENGINE_LOAD_FAILED'
                        : error?.message === 'ENGINE_INIT_FAILED'
                            ? 'ENGINE_INIT_FAILED'
                            : error?.status
                                ? 'NETWORK_ERROR'
                                : 'UNKNOWN_ERROR');

        const fallback = FALLBACK_MESSAGES[code] ||
            FALLBACK_MESSAGES.UNKNOWN_ERROR;

        stop(code, fallback.title, fallback.message);
    }
})();
