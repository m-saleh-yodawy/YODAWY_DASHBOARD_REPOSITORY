(() => {
    'use strict';

    if (window.YODAWYSystemAuth) return;

    const API = 'https://api.github.com';
    const OWNER = 'm-saleh-yodawy';
    const REPO = 'YODAWY_DASHBOARD_REPOSITORY';
    const BRANCH = 'main';

    const PATHS = {
        config: 'AUTH/auth-config.json',
        users: 'CONFIG/users.json',
        messages: 'AUTH/auth-messages.json'
    };

    const FALLBACK_MESSAGES = {
        WRONG_SYSTEM: {
            title: 'SYSTEM ERROR',
            message: 'WRONG SYSTEM'
        },
        NETWORK_ERROR: {
            title: 'CONNECTION ERROR',
            message: 'UNABLE TO CONNECT. PLEASE TRY AGAIN.'
        },
        UNKNOWN_ERROR: {
            title: 'ERROR',
            message: 'AN UNEXPECTED ERROR OCCURRED.'
        }
    };

    async function readFile(path, token) {
        const url =
            `${API}/repos/${OWNER}/${REPO}/contents/` +
            `${path.split('/').map(encodeURIComponent).join('/')}` +
            `?ref=${encodeURIComponent(BRANCH)}`;

        let response;

        try {
            response = await fetch(url, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                credentials: 'omit',
                cache: 'no-store'
            });
        } catch {
            throw Object.assign(new Error('Network error'), {
                code: 'NETWORK_ERROR'
            });
        }

        if (!response.ok) {
            throw Object.assign(new Error(`GitHub ${response.status}`), {
                code: [401, 403, 404].includes(response.status)
                    ? 'WRONG_SYSTEM'
                    : 'NETWORK_ERROR',
                status: response.status
            });
        }

        try {
            const file = await response.json();

            if (file.encoding !== 'base64' || !file.content) {
                throw new Error('Invalid file content');
            }

            const binary = atob(file.content.replace(/\s/g, ''));
            const bytes = Uint8Array.from(
                binary,
                char => char.charCodeAt(0)
            );

            return JSON.parse(
                new TextDecoder().decode(bytes)
            );
        } catch {
            throw Object.assign(new Error('Invalid JSON file'), {
                code: 'UNKNOWN_ERROR'
            });
        }
    }

    async function authenticate({ userId, systemToken } = {}) {
        const id = String(userId || '').trim().toUpperCase();
        const token = String(systemToken || '').trim();

        if (!id || !token) {
            return {
                ok: false,
                code: 'WRONG_SYSTEM',
                message: FALLBACK_MESSAGES.WRONG_SYSTEM
            };
        }

        let messages = FALLBACK_MESSAGES;

        try {
            try {
                const data = await readFile(PATHS.messages, token);
                messages = data?.messages || data;
            } catch {
                messages = FALLBACK_MESSAGES;
            }

            const config = await readFile(PATHS.config, token);

            if (
                config.provider !== 'github' ||
                config.owner !== OWNER ||
                config.branch !== BRANCH ||
                config.userRegistry?.repository !== REPO ||
                config.userRegistry?.path !== PATHS.users
            ) {
                return {
                    ok: false,
                    code: 'UNKNOWN_ERROR',
                    message: messages.UNKNOWN_ERROR ||
                        FALLBACK_MESSAGES.UNKNOWN_ERROR
                };
            }

            const registry = await readFile(
                config.userRegistry.path,
                token
            );

            if (!Array.isArray(registry.users)) {
                return {
                    ok: false,
                    code: 'UNKNOWN_ERROR',
                    message: messages.UNKNOWN_ERROR ||
                        FALLBACK_MESSAGES.UNKNOWN_ERROR
                };
            }

            const user = registry.users.find(
                item =>
                    String(item?.id || '').trim().toUpperCase() === id
            );

            if (!user) {
                return {
                    ok: false,
                    code: 'INVALID_CREDENTIALS',
                    message: messages.INVALID_CREDENTIALS ||
                        FALLBACK_MESSAGES.UNKNOWN_ERROR
                };
            }

            if (
                String(user.status || '').trim().toLowerCase() !== 'active'
            ) {
                return {
                    ok: false,
                    code: 'USER_INACTIVE',
                    message: messages.USER_INACTIVE ||
                        FALLBACK_MESSAGES.UNKNOWN_ERROR
                };
            }

            if (!user.repository) {
                return {
                    ok: false,
                    code: 'UNKNOWN_ERROR',
                    message: messages.UNKNOWN_ERROR ||
                        FALLBACK_MESSAGES.UNKNOWN_ERROR
                };
            }

            return {
                ok: true,
                user: {
                    id: user.id,
                    name: user.name,
                    repository: user.repository,
                    role: user.role,
                    status: user.status
                },
                config,
                messages
            };

        } catch (error) {
            const code = error?.code === 'NETWORK_ERROR'
                ? 'NETWORK_ERROR'
                : error?.code === 'UNKNOWN_ERROR'
                    ? 'UNKNOWN_ERROR'
                    : 'WRONG_SYSTEM';

            return {
                ok: false,
                code,
                message: messages[code] ||
                    FALLBACK_MESSAGES[code] ||
                    FALLBACK_MESSAGES.UNKNOWN_ERROR
            };
        }
    }

    window.YODAWYSystemAuth = Object.freeze({
        authenticate
    });
})();
