(function (global) {
    'use strict';

    if (global.YODAWY_AUTH_ENGINE) return;

    const ROLES = Object.freeze([
        'USER',
        'ADMIN',
        'SUPER_ADMIN'
    ]);

    let session = null;
    const listeners = new Set();

    const createError = message => {
        const error = new Error(message);
        error.code = 'AUTH_ENGINE_ERROR';
        return error;
    };

    const normalizeRole = role => {
        const normalized = String(role || '').trim().toUpperCase();

        if (!ROLES.includes(normalized)) {
            throw createError('Invalid user role');
        }

        return normalized;
    };

    const normalizeUser = user => {
        if (!user || typeof user !== 'object' || Array.isArray(user)) {
            throw createError('Invalid user data');
        }

        const userId = String(user.userId || user.id || '').trim();

        if (!userId) {
            throw createError('User ID is missing');
        }

        return Object.freeze({
            ...user,
            userId
        });
    };

    const notify = () => {
        const context = getContext();

        for (const listener of listeners) {
            try {
                listener(context);
            } catch {}
        }
    };

    const initialize = data => {
        if (!data || typeof data !== 'object') {
            throw createError('Invalid authentication result');
        }

        if (data.authenticated !== true) {
            throw createError('User authentication was not successful');
        }

        const user = normalizeUser(data.user);
        const role = normalizeRole(data.role);

        session = Object.freeze({
            authenticated: true,
            user,
            userId: user.userId,
            role,
            permissions: Object.freeze(
                Array.isArray(data.permissions)
                    ? [...new Set(data.permissions.map(String))]
                    : []
            ),
            authenticatedAt: Date.now()
        });

        notify();

        return getContext();
    };

    const isAuthenticated = () =>
        Boolean(session?.authenticated);

    const requireAuth = () => {
        if (!isAuthenticated()) {
            throw createError('Authentication required');
        }

        return getContext();
    };

    const getContext = () => {
        if (!session) return null;

        return Object.freeze({
            ...session,
            user: Object.freeze({ ...session.user }),
            permissions: Object.freeze([...session.permissions])
        });
    };

    const getUser = () =>
        getContext()?.user || null;

    const getUserId = () =>
        session?.userId || null;

    const getRole = () =>
        session?.role || null;

    const hasRole = role => {
        if (!isAuthenticated()) return false;

        try {
            return session.role === normalizeRole(role);
        } catch {
            return false;
        }
    };

    const hasAnyRole = roles => {
        if (!Array.isArray(roles)) return false;

        return roles.some(hasRole);
    };

    const hasPermission = permission => {
        if (!isAuthenticated() || !permission) return false;

        return session.permissions.includes(String(permission));
    };

    const subscribe = callback => {
        if (typeof callback !== 'function') {
            throw createError('Listener must be a function');
        }

        listeners.add(callback);

        return () => listeners.delete(callback);
    };

    const logout = () => {
        session = null;
        notify();
        return true;
    };

    const API = Object.freeze({
        version: 1,
        initialize,
        isAuthenticated,
        requireAuth,
        getContext,
        getUser,
        getUserId,
        getRole,
        hasRole,
        hasAnyRole,
        hasPermission,
        subscribe,
        logout
    });

    global.YODAWY_AUTH_ENGINE = API;

})(window);
