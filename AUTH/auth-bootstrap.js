(async function () {
    'use strict';

    const API_BASE = C.API || 'https://api.github.com';
    const OWNER = C.OWNER;
    const REPO = C.REPO;
    const BRANCH = C.BRANCH;
    const SYSTEM_TOKEN = C.SYSTEM_TOKEN;
    const PERSONAL_TOKEN = C.PERSONAL_TOKEN;
    const USER_ID = C.USER_ID;

    const PAGE = window;
    const RUNTIME = Object.create(null);

    const PATHS = {
        config: 'AUTH/auth-config.json',
        messages: 'AUTH/auth-messages.json',
        errorEngine: 'UI/error-message-engine.js',
        systemAuth: 'AUTH/system-auth.js',
        personalAuth: 'AUTH/personal-auth.js',
        core: [
            'CORE/api-engine.js',
            'CORE/auth-engine.js',
            'CORE/module-loader.js',
            'CORE/permissions-engine.js',
            'CORE/settings-engine.js',
            'CORE/visibility-engine.js',
            'CORE/tools-manager.js'
        ],
        ui: 'UI/dashboard-ui.js',
        roles: {
            USER: 'ENGINES/user-engine.js',
            ADMIN: 'ENGINES/admin-engine.js',
            SUPER_ADMIN: 'ENGINES/super-admin-engine.js'
        }
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
    let centralError = null;

    const createError = (message, code = 'UNKNOWN_ERROR') =>
        Object.assign(new Error(message), { code });

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
            throw createError(
                `GitHub API request failed: ${response.status}`,
                [401, 403, 404].includes(response.status)
                    ? 'WRONG_SYSTEM'
                    : 'NETWORK_ERROR'
            );
        }

        return response.json();
    };

    const decode = content => {
        const binary = atob(content.replace(/\s/g, ''));
        const bytes = Uint8Array.from(
            binary,
            char => char.charCodeAt(0)
        );

        return new TextDecoder('utf-8').decode(bytes);
    };

    const readText = async (
        repository,
        path,
        token,
        branch = BRANCH
    ) => {
        const encodedPath = path
            .split('/')
            .map(encodeURIComponent)
            .join('/');

        const data = await request(
            `${API_BASE}/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(repository)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
            token
        );

        if (typeof data.content !== 'string') {
            throw createError(`File unavailable: ${path}`);
        }

        return decode(data.content);
    };

    const readJSON = async (
        repository,
        path,
        token,
        branch = BRANCH
    ) => JSON.parse(
        await readText(repository, path, token, branch)
    );

    const getMessage = (code, fallback) => {
        const entry = messages[code];

        return {
            code,
            title: entry?.title || fallback?.title || 'SYSTEM ERROR',
            message: entry?.message ||
                (typeof entry === 'string' ? entry : '') ||
                fallback?.message ||
                FALLBACK_MESSAGES.UNKNOWN_ERROR.message
        };
    };

    const showError = (code, title, message) => {
        const error = getMessage(code, { title, message });

        if (typeof centralError?.show === 'function') {
            centralError.show(error);
            return;
        }

        alert(`${error.title}\n\n${error.message}`);
    };

    const stop = (code, title, message) => {
        showError(code, title, message);
    };

    const execute = (source, name) => {
        if (typeof source !== 'string' || !source.trim()) {
            throw createError(`Empty engine: ${name}`);
        }

        new Function('window', 'document', source)(
            RUNTIME,
            document
        );
    };

    const loadScript = async path => {
        const source = await readText(
            REPO,
            path,
            SYSTEM_TOKEN
        );

        execute(source, path);

        return true;
    };

    const loadCore = async () => {
        for (const path of PATHS.core) {
            await loadScript(path);
        }

        const required = [
            'YODAWY_API_ENGINE',
            'YODAWY_AUTH_ENGINE',
            'YODAWY_MODULE_LOADER',
            'YODAWY_PERMISSIONS_ENGINE',
            'YODAWY_SETTINGS_ENGINE',
            'YODAWY_VISIBILITY_ENGINE',
            'YODAWY_TOOLS_MANAGER'
        ];

        for (const name of required) {
            if (!RUNTIME[name]) {
                throw createError(`CORE engine unavailable: ${name}`);
            }
        }

        return true;
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

    const initializeCore = async (
        user,
        role,
        personalRepository
    ) => {
        const API = RUNTIME.YODAWY_API_ENGINE;
        const AUTH = RUNTIME.YODAWY_AUTH_ENGINE;
        const SETTINGS = RUNTIME.YODAWY_SETTINGS_ENGINE;
        const PERMISSIONS = RUNTIME.YODAWY_PERMISSIONS_ENGINE;
        const VISIBILITY = RUNTIME.YODAWY_VISIBILITY_ENGINE;
        const TOOLS = RUNTIME.YODAWY_TOOLS_MANAGER;

        API.configure({
            owner: OWNER,
            repo: REPO,
            branch: BRANCH,
            token: SYSTEM_TOKEN
        });

        AUTH.initialize({
            authenticated: true,
            user,
            role,
            permissions: []
        });

        SETTINGS.configure({
            owner: OWNER,
            repository: personalRepository,
            branch: BRANCH,
            userId: user.id,
            token: PERSONAL_TOKEN
        });

        await SETTINGS.load();
        await PERMISSIONS.load();
        await VISIBILITY.load();
        await TOOLS.loadManifest();

        return true;
    };

    const initializeTools = async () => {
        const TOOLS = RUNTIME.YODAWY_TOOLS_MANAGER;

        await TOOLS.sync();

        return TOOLS.getLoadedTools();
    };

    const initializeRole = async (
        user,
        role,
        authConfig,
        personalRepository
    ) => {
        const configuredEngines =
            authConfig.dashboard?.engines ||
            authConfig.dashboard?.roleEngines ||
            {};

        const enginePath =
            configuredEngines[role] ||
            configuredEngines[role.toLowerCase()] ||
            PATHS.roles[role];

        if (!enginePath) {
            throw createError('Role engine path is missing', 'ENGINE_LOAD_FAILED');
        }

        await loadScript(PATHS.ui);

        const engineSource = await readText(
            REPO,
            enginePath,
            SYSTEM_TOKEN
        );

        const YODAWY = {
            authenticated: true,
            userId: user.id,
            user: Object.freeze({ ...user }),
            userRole: role,
            dashboardVariant: role,
            personalRepository,
            owner: OWNER,
            dashboardRepository: REPO,
            usersRepository: 'YODAWY_USERS_REPOSITORY',
            branch: BRANCH,
            apiBase: API_BASE,
            authConfig,
            authMessages: messages,
            api: RUNTIME.YODAWY_API_ENGINE,
            auth: RUNTIME.YODAWY_AUTH_ENGINE,
            settings: RUNTIME.YODAWY_SETTINGS_ENGINE,
            permissions: RUNTIME.YODAWY_PERMISSIONS_ENGINE,
            visibility: RUNTIME.YODAWY_VISIBILITY_ENGINE,
            moduleLoader: RUNTIME.YODAWY_MODULE_LOADER,
            tools: RUNTIME.YODAWY_TOOLS_MANAGER,
            ui: RUNTIME.YODAWY_DASHBOARD_UI || null,
            request: (url, options) =>
                RUNTIME.YODAWY_API_ENGINE.request(url, options),
            readJSON: async (repository, path, token, branch) =>
                JSON.parse(
                    await readText(
                        repository,
                        path,
                        token || SYSTEM_TOKEN,
                        branch || BRANCH
                    )
                ),
            readText: (repository, path, token, branch) =>
                readText(
                    repository,
                    path,
                    token || SYSTEM_TOKEN,
                    branch || BRANCH
                ),
            showError
        };

        RUNTIME.YODAWY = YODAWY;

        execute(
            `(${function (YODAWY, window, document, source) {
                return new Function(
                    'YODAWY',
                    'window',
                    'document',
                    source
                )(YODAWY, window, document);
            }.toString()})(YODAWY, window, document, ${JSON.stringify(engineSource)});`,
            enginePath
        );

        if (typeof YODAWY.init !== 'function') {
            throw createError(
                'Role engine must define YODAWY.init()',
                'ENGINE_INIT_FAILED'
            );
        }

        const initialized = await YODAWY.init();

        if (initialized !== true || YODAWY.authenticated !== true) {
            throw createError(
                'Role engine initialization failed',
                'ENGINE_INIT_FAILED'
            );
        }

        return true;
    };

    try {
        if (
            !PAGE ||
            !OWNER ||
            !REPO ||
            !BRANCH ||
            !USER_ID ||
            !SYSTEM_TOKEN ||
            SYSTEM_TOKEN.includes('PASTE_')
        ) {
            throw createError('Invalid bootstrap configuration', 'WRONG_SYSTEM');
        }

        const authConfig = await readJSON(
            REPO,
            PATHS.config,
            SYSTEM_TOKEN
        );

        if (
            authConfig.provider !== 'github' ||
            authConfig.owner !== OWNER ||
            authConfig.branch !== BRANCH ||
            authConfig.userRegistry?.repository !== REPO ||
            authConfig.userRegistry?.path !== 'CONFIG/users.json'
        ) {
            throw createError('Invalid authentication configuration', 'WRONG_SYSTEM');
        }

        try {
            const data = await readJSON(
                REPO,
                PATHS.messages,
                SYSTEM_TOKEN
            );

            messages = data?.messages || data || {};
        } catch {
            messages = {};
        }

        try {
            const source = await readText(
                REPO,
                authConfig.dashboard?.errorMessageEngine?.path ||
                    PATHS.errorEngine,
                SYSTEM_TOKEN
            );

            execute(source, PATHS.errorEngine);

            centralError = RUNTIME.YODAWY_ERROR_ENGINE;

            if (typeof centralError?.show !== 'function') {
                throw new Error('Error engine unavailable');
            }

            centralError.configure({ messages });
        } catch {
            throw createError(
                'Error engine loading failed',
                'ERROR_ENGINE_LOAD_FAILED'
            );
        }

        await loadScript(PATHS.systemAuth);

        const systemAuth = await RUNTIME.YODAWYSystemAuth.authenticate({
            userId: USER_ID,
            systemToken: SYSTEM_TOKEN
        });

        if (!systemAuth?.ok) {
            const message = systemAuth?.message || {};

            stop(
                systemAuth?.code || 'UNKNOWN_ERROR',
                message.title,
                message.message
            );

            return;
        }

        await loadScript(PATHS.personalAuth);

        const personalAuth = await RUNTIME.YODAWYPersonalAuth.authenticate({
            systemAuth,
            personalToken: PERSONAL_TOKEN
        });

        if (!personalAuth?.ok) {
            const message = personalAuth?.message || {};

            stop(
                personalAuth?.code || 'UNKNOWN_ERROR',
                message.title,
                message.message
            );

            return;
        }

        const user = systemAuth.user;
        const role = resolveRole(user.role);
        const personalRepository = personalAuth.repository.name;

        await loadCore();

        await initializeCore(
            user,
            role,
            personalRepository
        );

        await initializeTools();

        await initializeRole(
            user,
            role,
            authConfig,
            personalRepository
        );

    } catch (error) {
        const code = error?.code ||
            (error?.status ? 'NETWORK_ERROR' : 'UNKNOWN_ERROR');

        const fallback = FALLBACK_MESSAGES[code] ||
            FALLBACK_MESSAGES.UNKNOWN_ERROR;

        stop(
            code,
            fallback.title,
            fallback.message
        );
    }
})();
