(() => {
    'use strict';

    if (window.YODAWYPersonalAuth) return;

    const API = 'https://api.github.com';

    const FALLBACK_MESSAGES = {
        SYSTEM_AUTH_REQUIRED: {
            title: 'SYSTEM ERROR',
            message: 'SYSTEM AUTHENTICATION REQUIRED'
        },
        TOKEN_INVALID: {
            title: 'AUTHENTICATION FAILED',
            message: 'THE PERSONAL TOKEN IS INVALID OR CANNOT ACCESS THE REQUIRED REPOSITORY.'
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

    const result = (systemAuth, code) => ({
        ok: false,
        code,
        message: systemAuth?.messages?.[code] ||
            FALLBACK_MESSAGES[code] ||
            FALLBACK_MESSAGES.UNKNOWN_ERROR
    });

    async function authenticate({ systemAuth, personalToken } = {}) {
        if (!systemAuth?.ok || !systemAuth.user) {
            return result(systemAuth, 'SYSTEM_AUTH_REQUIRED');
        }

        const token = String(personalToken || '').trim();
        const owner = String(systemAuth.config?.owner || '').trim();
        const repository = String(systemAuth.user.repository || '').trim();

        if (!token || token.includes('PASTE_')) {
            return result(systemAuth, 'TOKEN_INVALID');
        }

        if (
            !/^[A-Za-z0-9_.-]+$/.test(owner) ||
            !/^[A-Za-z0-9_.-]+$/.test(repository)
        ) {
            return result(systemAuth, 'UNKNOWN_ERROR');
        }

        try {
            const response = await fetch(
                `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
                {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28'
                    },
                    credentials: 'omit',
                    cache: 'no-store'
                }
            );

            if (
                response.headers.get('x-ratelimit-remaining') === '0' ||
                response.status >= 500
            ) {
                return result(systemAuth, 'NETWORK_ERROR');
            }

            if ([401, 403, 404].includes(response.status)) {
                return result(systemAuth, 'TOKEN_INVALID');
            }

            if (!response.ok) {
                return result(systemAuth, 'NETWORK_ERROR');
            }

            const repoData = await response.json();

            if (
                String(repoData?.name || '').toLowerCase() !== repository.toLowerCase() ||
                String(repoData?.owner?.login || '').toLowerCase() !== owner.toLowerCase()
            ) {
                return result(systemAuth, 'TOKEN_INVALID');
            }

            return {
                ok: true,
                user: systemAuth.user,
                repository: {
                    name: repoData.name,
                    owner: repoData.owner.login,
                    private: repoData.private,
                    url: repoData.html_url
                }
            };
        } catch {
            return result(systemAuth, 'NETWORK_ERROR');
        }
    }

    window.YODAWYPersonalAuth = Object.freeze({
        authenticate
    });
})();
