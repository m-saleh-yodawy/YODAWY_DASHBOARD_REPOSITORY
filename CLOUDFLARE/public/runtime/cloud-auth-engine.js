(function (global) {
    'use strict';
    if (global.YODAWY_AUTH_ENGINE) return;
    const ctx = () => global.YODAWY_CLOUD_CONTEXT;
    let session = null;
    const normalize = user => {
        if (!user?.id || !['USER', 'ADMIN', 'SUPER_ADMIN'].includes(String(user.role || '').toUpperCase())) throw new Error('Invalid cloud user session');
        return Object.freeze({ ...user, id: String(user.id), userId: String(user.id), role: String(user.role).toUpperCase() });
    };
    const initialize = data => {
        const source = data?.user || ctx()?.user;
        const user = normalize(source);
        session = Object.freeze({ authenticated: true, user, userId: user.id, role: user.role, permissions: Object.freeze([]), authenticatedAt: Date.now() });
        return getContext();
    };
    const getContext = () => session ? Object.freeze({ ...session, user: Object.freeze({ ...session.user }), permissions: [] }) : null;
    const isAuthenticated = () => Boolean(session?.authenticated && ctx()?.user);
    const requireAuth = () => { if (!isAuthenticated()) throw new Error('Authentication required'); return getContext(); };
    const getUser = () => getContext()?.user || null;
    const getUserId = () => session?.userId || null;
    const getRole = () => session?.role || null;
    const hasRole = role => isAuthenticated() && session.role === String(role || '').toUpperCase();
    const hasAnyRole = roles => Array.isArray(roles) && roles.some(hasRole);
    const hasPermission = () => false;
    const subscribe = () => () => {};
    const logout = async () => { session = null; await ctx()?.logout?.(); return true; };
    global.YODAWY_AUTH_ENGINE = Object.freeze({ version: 2, initialize, isAuthenticated, requireAuth, getContext, getUser, getUserId, getRole, hasRole, hasAnyRole, hasPermission, subscribe, logout });
})(window);
