(() => {
    'use strict';

    if (window.YODAWYPersonalAuth) return;

    const API = 'https://api.github.com';

    const FALLBACK_MESSAGES = {
        SYSTEM_AUTH_REQUIRED: {
            title: 'SYSTEM ERROR',
            message: 'SYSTEM AUTHENTICATION REQUIRED'
        },
        INVALID_CREDENTIALS: {
            title: 'LOGIN FAILED',
            message: 'INVALID ID OR PASSWORD'
        },
        PERSONAL_ACCESS_DENIED: {
            title: 'AUTHENTICATION FAILED',
            message: 'INVALID OR EXPIRED TOKEN'
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

    function result(systemAuth, code) {
        return {
            ok: false,
            code,
            message: systemAuth?.messages?.[code] ||
                FALLBACK_MESSAGES[code] ||
                FALLBACK_MESSAGES.UNKNOWN_ERROR
        };
    }

    async function authenticate({ systemAuth, personalToken } = {}) {
        if (!systemAuth?.ok || !systemAuth.user) {
            return result(systemAuth, 'SYSTEM_AUTH_REQUIRED');
        }

        const token = String(personalToken || '').trim();
        const owner = String(systemAuth.config?.owner || '').trim();
        const repository = String(systemAuth.user.repository || '').trim();

        if (!token) {
            return result(systemAuth, 'INVALID_CREDENTIALS');
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

            if (response.status === 401 || response.status === 404) {
                return result(systemAuth, 'INVALID_CREDENTIALS');
            }

            if (response.status === 403) {
                return result(systemAuth, 'PERSONAL_ACCESS_DENIED');
            }

            if (!response.ok) {
                return result(systemAuth, 'NETWORK_ERROR');
            }

            const repoData = await response.json();

            if (
                String(repoData?.name || '').toLowerCase() !== repository.toLowerCase() ||
                String(repoData?.owner?.login || '').toLowerCase() !== owner.toLowerCase()
            ) {
                return result(systemAuth, 'INVALID_CREDENTIALS');
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
