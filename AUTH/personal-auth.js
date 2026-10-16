(() => {
    'use strict';

    if (window.YODAWYPersonalAuth) return;

    const API = 'https://api.github.com';

    async function authenticate({ systemAuth, personalToken }) {
        const token = String(personalToken || '').trim();

        if (!systemAuth?.ok || !systemAuth.user) {
            return {
                ok: false,
                code: 'SYSTEM_AUTH_REQUIRED',
                message: systemAuth?.messages?.UNKNOWN_ERROR || {
                    title: 'SYSTEM ERROR',
                    message: 'SYSTEM AUTHENTICATION REQUIRED'
                }
            };
        }

        if (!token) {
            return {
                ok: false,
                code: 'INVALID_CREDENTIALS',
                message: systemAuth.messages?.INVALID_CREDENTIALS || {
                    title: 'LOGIN FAILED',
                    message: 'INVALID ID OR PASSWORD'
                }
            };
        }

        const user = systemAuth.user;
        const owner = systemAuth.config?.owner;
        const repository = user.repository;

        if (
            !owner ||
            !repository ||
            !/^[A-Za-z0-9_.-]+$/.test(repository)
        ) {
            return {
                ok: false,
                code: 'UNKNOWN_ERROR',
                message: systemAuth.messages?.UNKNOWN_ERROR || {
                    title: 'ERROR',
                    message: 'AN UNEXPECTED ERROR OCCURRED.'
                }
            };
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
                return {
                    ok: false,
                    code: 'INVALID_CREDENTIALS',
                    message: systemAuth.messages?.INVALID_CREDENTIALS || {
                        title: 'LOGIN FAILED',
                        message: 'INVALID ID OR PASSWORD'
                    }
                };
            }

            if (response.status === 403) {
                return {
                    ok: false,
                    code: 'PERSONAL_ACCESS_DENIED',
                    message: systemAuth.messages?.TOKEN_INVALID || {
                        title: 'AUTHENTICATION FAILED',
                        message: 'INVALID OR EXPIRED TOKEN'
                    }
                };
            }

            if (!response.ok) {
                return {
                    ok: false,
                    code: 'NETWORK_ERROR',
                    message: systemAuth.messages?.NETWORK_ERROR || {
                        title: 'CONNECTION ERROR',
                        message: 'UNABLE TO CONNECT. PLEASE TRY AGAIN.'
                    }
                };
            }

            const repoData = await response.json();

            if (
                repoData.name?.toLowerCase() !==
                repository.toLowerCase() ||
                repoData.owner?.login?.toLowerCase() !==
                owner.toLowerCase()
            ) {
                return {
                    ok: false,
                    code: 'INVALID_CREDENTIALS',
                    message: systemAuth.messages?.INVALID_CREDENTIALS || {
                        title: 'LOGIN FAILED',
                        message: 'INVALID ID OR PASSWORD'
                    }
                };
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
            return {
                ok: false,
                code: 'NETWORK_ERROR',
                message: systemAuth.messages?.NETWORK_ERROR || {
                    title: 'CONNECTION ERROR',
                    message: 'UNABLE TO CONNECT. PLEASE TRY AGAIN.'
                }
            };
        }
    }

    window.YODAWYPersonalAuth = Object.freeze({
        authenticate
    });
})();
