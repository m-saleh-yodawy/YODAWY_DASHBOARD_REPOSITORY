(async function () {
    'use strict';

    const API = C.API;
    const OWNER = C.OWNER;
    const REPO = C.REPO;
    const BRANCH = C.BRANCH;
    const SYSTEM = C.SYSTEM_TOKEN;
    const PERSONAL = C.PERSONAL_TOKEN;

    let messages = {};
    let centralError;

    const request = async (url, token) => {
        const r = await fetch(url, {
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28'
            },
            cache: 'no-store'
        });

        if (!r.ok) {
            const e = Error(`GitHub ${r.status}`);
            e.status = r.status;
            throw e;
        }

        return r.json();
    };

    const decode = content => new TextDecoder().decode(
        Uint8Array.from(
            atob(content.replace(/\s/g, '')),
            c => c.charCodeAt(0)
        )
    );

    const readText = async (repo, path, token, branch = BRANCH) => {
        const encoded = path.split('/').map(encodeURIComponent).join('/');
        const data = await request(
            `${API}/repos/${OWNER}/${repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`,
            token
        );

        if (typeof data.content !== 'string') {
            throw Error(`Missing file: ${path}`);
        }

        return decode(data.content);
    };

    const readJSON = async (repo, path, token, branch = BRANCH) =>
        JSON.parse(await readText(repo, path, token, branch));

    const error = (code, title, message) => {
        const entry = messages[code];

        return {
            code,
            title: entry?.title || title,
            message: entry?.message ||
                (typeof entry === 'string' ? entry : message)
        };
    };

    const showError = (code, title, message) => {
        const e = error(code, title, message);

        if (centralError && typeof centralError.show === 'function') {
            centralError.show(e);
        } else {
            alert(`${e.title}\n\n${e.message}`);
        }
    };

    const stop = (code, title, message) => {
        showError(code, title, message);
    };

    try {
        if (A?.provider !== 'github' || A?.enabled === false) {
            throw Error('WRONG_SYSTEM');
        }

        try {
            const data = await readJSON(
                REPO, 'CONFIG/auth-messages.json', SYSTEM
            );

            messages = data?.messages || data || {};
        } catch {
            messages = {};
        }

        const errorPath =
            A?.errorMessageEngine?.path ||
            A?.errorMessages?.enginePath ||
            A?.dashboard?.errorMessageEnginePath ||
            'error-message-engine.js';

        try {
            const source = await readText(REPO, errorPath, SYSTEM);

            new Function('window', source)(W);

            centralError = W.YODAWY_ERROR_ENGINE;

            if (!centralError || typeof centralError.show !== 'function') {
                throw Error('Error engine unavailable');
            }

            centralError.configure?.({ messages });
        } catch {
            throw Error('ERROR_ENGINE_LOAD_FAILED');
        }

        const registryRepo =
            A?.userRegistry?.repository || REPO;

        const registryPath =
            A?.userRegistry?.path || 'CONFIG/auth-users.json';

        const registry = await readJSON(
            registryRepo, registryPath, SYSTEM
        );

        const users = Array.isArray(registry)
            ? registry
            : registry?.users || [];

        const user = users.find(u =>
            String(u?.id || u?.userId || u?.username || '')
                .trim().toUpperCase() ===
            String(C.USER_ID).trim().toUpperCase()
        );

        if (!user) {
            stop('INVALID_CREDENTIALS', 'LOGIN FAILED',
                'INVALID USER ID OR ACCOUNT REGISTRATION.');
            return;
        }

        if (String(user.status || '').toLowerCase() !== 'active') {
            stop('USER_INACTIVE', 'ACCOUNT INACTIVE',
                'YOUR ACCOUNT IS INACTIVE. CONTACT YOUR ADMINISTRATOR.');
            return;
        }

        const personalRepository = String(
            user.repository ||
            user.personalRepository ||
            user.personal_repository ||
            ''
        ).trim();

        if (!personalRepository || !PERSONAL ||
            PERSONAL.includes('PASTE_')) {
            stop('TOKEN_INVALID', 'AUTHENTICATION FAILED',
                'THE PERSONAL TOKEN IS INVALID OR CANNOT ACCESS THE REQUIRED REPOSITORY.');
            return;
        }

        try {
            const repo = await request(
                `${API}/repos/${OWNER}/${encodeURIComponent(personalRepository)}`,
                PERSONAL
            );

            if (
                String(repo?.owner?.login).toLowerCase() !== OWNER.toLowerCase() ||
                String(repo?.name).toLowerCase() !== personalRepository.toLowerCase()
            ) {
                throw Error('Wrong repository');
            }
        } catch {
            stop('TOKEN_INVALID', 'AUTHENTICATION FAILED',
                'THE PERSONAL TOKEN IS INVALID OR CANNOT ACCESS THE REQUIRED REPOSITORY.');
            return;
        }

        const role = String(user.role || 'USER')
            .trim().toUpperCase().replace(/[\s-]+/g, '_');

        const resolvedRole =
            role === 'SUPERADMIN' ? 'SUPER_ADMIN' :
            role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' :
            role === 'ADMIN' || role === 'ADMINISTRATOR' ? 'ADMIN' :
            'USER';

        const YODAWY = {
            userId: C.USER_ID,
            personalToken: PERSONAL,
            personalRepository,
            owner: OWNER,
            dashboardRepository: REPO,
            usersRepository: 'YODAWY_USERS_REPOSITORY',
            branch: BRANCH,
            apiBase: API,
            authConfig: A,
            authMessages: messages,
            userRole: resolvedRole,
            dashboardVariant: resolvedRole,
            authenticated: true,

            request: (url, token) => request(url, token),

readJSON: (repo, path, token, branch) =>
    readJSON(repo, path, token ?? SYSTEM, branch),

readText: (repo, path, token, branch) =>
    readText(repo, path, token ?? SYSTEM, branch),

            showError: showError,

            verifyPersonalRepository: (repo, token) =>
                request(`${API}/repos/${OWNER}/${encodeURIComponent(repo)}`, token)
        };

        W.YODAWY = YODAWY;
        P.YODAWY = YODAWY;

        const engines =
            A?.dashboard?.engines ||
            A?.dashboard?.roleEngines ||
            A?.engines ||
            A?.roleEngines ||
            {};

        const enginePath =
            engines[resolvedRole] ||
            engines[resolvedRole.toLowerCase()] ||
            engines.default ||
            A?.dashboard?.enginePath ||
            A?.enginePath ||
            'dashboard-engine.js';

        const engineSource = await readText(REPO, enginePath, SYSTEM);

        new Function('YODAWY', 'window', engineSource)(YODAWY, W);

        if (typeof YODAWY.init !== 'function') {
            throw Error('ENGINE_INIT_FAILED');
        }

        const initialized = await YODAWY.init();

        if (initialized !== true || YODAWY.authenticated !== true) {
            throw Error('ENGINE_INIT_FAILED');
        }
    } catch (e) {
        console.error('[YODAWY] Bootstrap stopped:', e);

        const code = e.message === 'WRONG_SYSTEM'
            ? 'WRONG_SYSTEM'
            : e.message === 'ERROR_ENGINE_LOAD_FAILED'
                ? 'ERROR_ENGINE_LOAD_FAILED'
                : e.message === 'ENGINE_INIT_FAILED'
                    ? 'ENGINE_INIT_FAILED'
                    : e.status === 0
                        ? 'NETWORK_ERROR'
                        : 'UNKNOWN_ERROR';

        const defaults = {
            WRONG_SYSTEM: ['SYSTEM ERROR', 'INVALID OR DISABLED SYSTEM CONFIGURATION.'],
            ERROR_ENGINE_LOAD_FAILED: ['SYSTEM ERROR', 'THE CENTRAL ERROR MESSAGE ENGINE COULD NOT BE LOADED.'],
            ENGINE_INIT_FAILED: ['SYSTEM ERROR', 'THE DASHBOARD ENGINE FAILED TO INITIALIZE.'],
            NETWORK_ERROR: ['CONNECTION ERROR', 'UNABLE TO CONNECT. CHECK YOUR NETWORK AND TRY AGAIN.'],
            UNKNOWN_ERROR: ['SYSTEM ERROR', 'AN UNEXPECTED ERROR OCCURRED.']
        };

        const pair = defaults[code];
        stop(code, pair[0], pair[1]);
    }
})();
