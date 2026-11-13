(function (YODAWY, global) {
    'use strict';

    if (global.YODAWY_USER_ENGINE) return;

    const CONFIG = Object.freeze({
        LOGS_PATH: 'NETWORK/network-logs.json',
        FINAL_STATUSES: ['COMPLETED', 'FAILED', 'REJECTED']
    });

    let snapshot = null;
    let initialized = false;

    const createError = message => {
        const error = new Error(message);
        error.code = 'USER_ENGINE_ERROR';
        return error;
    };

    const clone = value => JSON.parse(JSON.stringify(value));
    const normalizeId = value => String(value || '').trim().toUpperCase();
    const normalizeText = value => String(value || '').trim();

    const getDependencies = () => {
        const API = YODAWY.api;
        const AUTH = YODAWY.auth;
        const PERMISSIONS = YODAWY.permissions;
        const VISIBILITY = YODAWY.visibility;
        const TOOLS = YODAWY.tools;

        if (!API || !AUTH || !PERMISSIONS || !VISIBILITY || !TOOLS) {
            throw createError('Required engines are unavailable');
        }

        if (!AUTH.isAuthenticated() || AUTH.getRole() !== 'USER') {
            throw createError('USER authentication is required');
        }

        return { API, AUTH, PERMISSIONS, VISIBILITY, TOOLS };
    };

    const readJSON = async path => {
        const { API } = getDependencies();
        const data = JSON.parse(await API.getFileContent(path));

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw createError('Invalid JSON structure: ' + path);
        }

        return data;
    };

    const getCurrentUserId = () => {
        const { AUTH } = getDependencies();
        return normalizeId(AUTH.getUserId());
    };

    const getCurrentUser = () => {
        const { AUTH } = getDependencies();
        const user = YODAWY.user || AUTH.getUser();
        const userId = getCurrentUserId();

        if (!user || normalizeId(user.id || user.userId) !== userId) {
            throw createError('Authenticated USER profile is unavailable');
        }

        return clone(user);
    };

    const refresh = async () => {
        const { AUTH, PERMISSIONS, VISIBILITY, TOOLS } = getDependencies();
        const userId = normalizeId(AUTH.getUserId());

        if (!PERMISSIONS.isLoaded()) await PERMISSIONS.load();
        if (!VISIBILITY.isLoaded()) await VISIBILITY.load();

        const user = getCurrentUser();
        const permissions = PERMISSIONS.getUserPermissions(userId);
        const manifest = TOOLS.getManifest();
        const visibleTools = manifest.filter(tool =>
            VISIBILITY.isVisible(tool.id, tool) === true
        );
        const allowedTools = visibleTools.filter(tool =>
            PERMISSIONS.canUse(userId, tool.id) === true
        );

        let logs = { transactions: {} };

        try {
            logs = await readJSON(CONFIG.LOGS_PATH);
        } catch {
            logs = { transactions: {} };
        }

        const transactions = Object.values(logs.transactions || {})
            .filter(transaction =>
                normalizeId(transaction?.actorId || transaction?.actor?.id) === userId
            )
            .map(clone)
            .sort((a, b) =>
                normalizeText(b.updatedAt || b.createdAt).localeCompare(
                    normalizeText(a.updatedAt || a.createdAt)
                )
            );

        snapshot = {
            user,
            permissions: clone(permissions),
            visibleTools: clone(visibleTools),
            tools: clone(allowedTools),
            transactions,
            updatedAt: logs.updatedAt || null
        };

        return clone(snapshot);
    };

    const ensureLoaded = () => {
        if (!initialized || !snapshot) {
            throw createError('USER engine has not been initialized');
        }
    };

    const getSnapshot = () => {
        ensureLoaded();
        return clone(snapshot);
    };

    const getUser = userId => {
        ensureLoaded();
        const id = normalizeId(userId || snapshot.user.id || snapshot.user.userId);
        const currentId = normalizeId(snapshot.user.id || snapshot.user.userId);
        return id === currentId ? clone(snapshot.user) : null;
    };

    const getUsers = () => {
        ensureLoaded();
        return [clone(snapshot.user)];
    };

    const getPermissions = () => {
        ensureLoaded();
        const userId = normalizeId(snapshot.user.id || snapshot.user.userId);
        return { [userId]: clone(snapshot.permissions) };
    };

    const getUserPermissions = () => {
        ensureLoaded();
        return clone(snapshot.permissions);
    };

    const getTools = () => {
        ensureLoaded();
        return clone(snapshot.tools);
    };

    const getVisibleTools = () => {
        ensureLoaded();
        return clone(snapshot.visibleTools);
    };

    const getTransaction = async requestId => {
        const id = normalizeText(requestId);
        const userId = getCurrentUserId();

        if (!id) throw createError('Invalid transaction ID');

        const logs = await readJSON(CONFIG.LOGS_PATH);
        const transaction = logs.transactions?.[id];

        if (
            !transaction ||
            normalizeId(transaction.actorId || transaction.actor?.id) !== userId
        ) {
            return null;
        }

        return clone(transaction);
    };

    const waitForTransaction = async (requestId, options = {}) => {
        const timeout = Math.max(10000, Number(options.timeout) || 180000);
        const interval = Math.max(1000, Number(options.interval) || 3000);
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeout) {
            const transaction = await getTransaction(requestId);

            if (
                transaction &&
                CONFIG.FINAL_STATUSES.includes(
                    normalizeText(transaction.status).toUpperCase()
                )
            ) {
                if (transaction.status === 'COMPLETED' && options.refresh !== false) {
                    await refresh();
                }

                return transaction;
            }

            await new Promise(resolve => setTimeout(resolve, interval));
        }

        return {
            requestId,
            status: 'TIMEOUT',
            message: 'Transaction is still being processed'
        };
    };

    const submit = async () => {
        throw createError('USER accounts cannot submit administrative NETWORK requests');
    };

    const initialize = async () => {
        getDependencies();
        await refresh();
        initialized = true;
        return true;
    };

    const API = Object.freeze({
        version: 1,
        initialize,
        refresh,
        getSnapshot,
        getUser,
        getUsers,
        getPermissions,
        getUserPermissions,
        getTools,
        getVisibleTools,
        getTransaction,
        waitForTransaction,
        getTransactionHistory: () => {
            ensureLoaded();
            return clone(snapshot.transactions);
        },
        submit,
        isInitialized: () => initialized,
        isSubmitting: () => false
    });

    global.YODAWY_USER_ENGINE = API;
    YODAWY.userEngine = API;

    YODAWY.init = async () => {
        await API.initialize();
        YODAWY.authenticated = true;

        if (typeof YODAWY.ui?.init !== 'function') {
            const error = new Error('Dashboard UI engine is unavailable');
            error.code = 'ENGINE_INIT_FAILED';
            throw error;
        }

        try {
            const initialized = await YODAWY.ui.init(YODAWY);
            if (initialized !== true) throw new Error('Dashboard UI initialization failed');
        } catch (cause) {
            const error = new Error(cause?.message || 'Dashboard UI initialization failed');
            error.code = 'ENGINE_INIT_FAILED';
            throw error;
        }

        return true;
    };

})(YODAWY, window);