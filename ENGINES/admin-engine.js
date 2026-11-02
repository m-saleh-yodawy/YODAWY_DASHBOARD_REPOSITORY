(function (YODAWY, global) {
    'use strict';

    if (global.YODAWY_ADMIN_ENGINE) return;

    const CONFIG = Object.freeze({
        LOGS_PATH: 'NETWORK/network-logs.json',
        USERS_PATH: 'CONFIG/users.json',
        PERMISSIONS_PATH: 'CONFIG/tools-permissions.json',
        REQUEST_TYPE: 'DASHBOARD_USERS_SYNC',
        FINAL_STATUSES: ['COMPLETED', 'FAILED', 'REJECTED']
    });

    let snapshot = null;
    let initialized = false;
    let submitting = false;

    const createError = message => {
        const error = new Error(message);
        error.code = 'ADMIN_ENGINE_ERROR';
        return error;
    };

    const clone = value => JSON.parse(JSON.stringify(value));
    const normalizeId = value => String(value || '').trim().toUpperCase();
    const normalizeText = value => String(value || '').trim();

    const getDependencies = () => {
        const API = YODAWY.api;
        const AUTH = YODAWY.auth;

        if (!API || !AUTH) throw createError('Required engines are unavailable');

        if (!AUTH.isAuthenticated() || AUTH.getRole() !== 'ADMIN') {
            throw createError('ADMIN authentication is required');
        }

        return { API, AUTH };
    };

    const encodeContent = value => {
        const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
        let binary = '';

        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }

        return btoa(binary);
    };

    const createId = () => global.crypto?.randomUUID
        ? global.crypto.randomUUID().toUpperCase()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 12).toUpperCase()}`;

    const createSequence = () =>
        `${Date.now()}${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`;

    const readJSON = async path => {
        const { API } = getDependencies();
        const content = await API.getFileContent(path);
        const data = JSON.parse(content);

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw createError(`Invalid JSON structure: ${path}`);
        }

        return data;
    };

    const getRepositoryEndpoint = path => {
        const { API } = getDependencies();
        const config = API.getConfig();

        if (!config.owner || !config.repo || !config.branch) {
            throw createError('Dashboard repository configuration is incomplete');
        }

        return {
            API,
            config,
            endpoint: `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}`
        };
    };

    const refresh = async () => {
        getDependencies();

        const [users, permissions, logs] = await Promise.all([
            readJSON(CONFIG.USERS_PATH),
            readJSON(CONFIG.PERMISSIONS_PATH),
            readJSON(CONFIG.LOGS_PATH)
        ]);

        if (!Array.isArray(users.users)) {
            throw createError('Invalid users registry');
        }

        if (!permissions || Array.isArray(permissions)) {
            throw createError('Invalid permissions registry');
        }

        const eligibleUsers = users.users.filter(user =>
            normalizeText(user.role).toUpperCase() === 'USER'
        );
        const eligibleIds = new Set(eligibleUsers.map(user => normalizeId(user.id)));
        const eligiblePermissions = Object.fromEntries(
            Object.entries(permissions).filter(([userId]) => eligibleIds.has(normalizeId(userId)))
        );

        snapshot = {
            users: clone(eligibleUsers),
            permissions: clone(eligiblePermissions),
            transactions: clone(logs.transactions || {}),
            updatedAt: logs.updatedAt || null
        };

        return clone(snapshot);
    };

    const ensureLoaded = () => {
        if (!initialized || !snapshot) {
            throw createError('ADMIN engine has not been initialized');
        }
    };

    const getSnapshot = () => {
        ensureLoaded();
        return clone(snapshot);
    };

    const getUsers = () => {
        ensureLoaded();
        return clone(snapshot.users);
    };

    const getUser = userId => {
        ensureLoaded();
        const id = normalizeId(userId);

        return clone(
            snapshot.users.find(user => normalizeId(user.id) === id) || null
        );
    };

    const getPermissions = () => {
        ensureLoaded();
        return clone(snapshot.permissions);
    };

    const getTools = () => {
        const tools = YODAWY.tools?.getManifest?.();

        if (!Array.isArray(tools)) {
            throw createError('Tools manifest is unavailable');
        }

        return clone(tools.filter(tool =>
            YODAWY.visibility?.isVisible?.(tool.id, tool) === true
        ));
    };

    const createRequest = async (action, payload) => {
        const { API, AUTH } = getDependencies();

        if (submitting) {
            throw createError('Another NETWORK transaction is being submitted');
        }

        const user = AUTH.getUser();
        const actorId = normalizeId(user?.userId || user?.id);
        const actorName = normalizeText(user?.name);

        if (!actorId || !actorName) {
            throw createError('Authenticated actor information is incomplete');
        }

        const requestId = `DASH-ADMIN-${createId()}`;
        const sequence = createSequence();
        const path = `NETWORK/dashboard-users-request-${sequence}.json`;
        const { endpoint, config } = getRepositoryEndpoint(path);

        const request = {
            protocolVersion: 1,
            requestId,
            transactionId: requestId,
            sequence,
            requestType: CONFIG.REQUEST_TYPE,
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            actor: {
                id: actorId,
                userId: actorId,
                name: actorName,
                username: actorName,
                role: 'ADMIN'
            },
            source: {
                owner: config.owner,
                repository: config.repo,
                branch: config.branch
            },
            destination: {
                owner: config.owner,
                repository: config.repo,
                branch: config.branch
            },
            action,
            payload: {
                ...clone(payload),
                action
            }
        };

        submitting = true;

        try {
            const response = await API.put(endpoint, {
                message: `Submit ADMIN ${action} transaction ${requestId}`,
                content: encodeContent(request),
                branch: config.branch
            });

            if (!response.data?.content?.sha) {
                throw createError('NETWORK request creation was not confirmed');
            }

            return {
                requestId,
                sequence,
                path,
                status: 'PENDING',
                createdAt: request.createdAt
            };
        } finally {
            submitting = false;
        }
    };

    const getTransaction = async requestId => {
        const id = normalizeText(requestId);

        if (!id) throw createError('Invalid transaction ID');

        const logs = await readJSON(CONFIG.LOGS_PATH);
        const transaction = logs.transactions?.[id];

        return transaction ? clone(transaction) : null;
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
                if (transaction.status === 'COMPLETED') await refresh();
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

    const submit = async (action, payload, options = {}) => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw createError('Invalid transaction payload');
        }

        const request = await createRequest(action, payload);

        if (options.wait === true) {
            const transaction = await waitForTransaction(request.requestId, options);
            return { ...request, transaction };
        }

        return request;
    };

    const addUser = async data => {
        ensureLoaded();

        const name = normalizeText(data?.name);
        const status = normalizeText(data?.status || 'Active');
        const id = normalizeId(data?.id);

        if (!name) throw createError('User name is required');

        if (!['ACTIVE', 'INACTIVE'].includes(status.toUpperCase())) {
            throw createError('Invalid user status');
        }

        if (snapshot.users.some(user => normalizeText(user.name).toLowerCase() === name.toLowerCase())) {
            throw createError('A USER with this name already exists');
        }

        if (id && getUser(id)) {
            throw createError('User ID already exists');
        }

        return submit('ADD_USER', {
            name,
            role: 'USER',
            status,
            ...(id ? { id } : {})
        });
    };

    const editUser = async (userId, changes) => {
        ensureLoaded();

        const id = normalizeId(userId);
        const current = getUser(id);

        if (!id || !current) throw createError('Target USER was not found');

        if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
            throw createError('Invalid user update');
        }

        if (changes.role !== undefined) {
            throw createError('ADMIN cannot change user roles');
        }

        const update = {};

        if (changes.name !== undefined) {
            update.name = normalizeText(changes.name);
            if (!update.name) throw createError('User name cannot be empty');
        }

        if (changes.status !== undefined) {
            update.status = normalizeText(changes.status);
            if (!['ACTIVE', 'INACTIVE'].includes(update.status.toUpperCase())) {
                throw createError('Invalid user status');
            }
        }

        if (!Object.keys(update).length) {
            throw createError('No supported user changes supplied');
        }

        return submit('EDIT_USER', { id, ...update });
    };

    const deleteUser = async () => {
        throw createError('ADMIN cannot delete users');
    };

    const setToolPermission = async (userId, toolId, changes) => {
        ensureLoaded();

        const targetUserId = normalizeId(userId);
        const targetToolId = normalizeText(toolId);
        const target = getUser(targetUserId);

        if (!target) throw createError('Only USER accounts can receive ADMIN permissions');

        if (!getTools().some(tool => tool.id === targetToolId)) {
            throw createError('Target tool is not visible or does not exist');
        }

        if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
            throw createError('Invalid permission changes');
        }

        if (
            Object.keys(changes).some(key => key !== 'granted') ||
            typeof changes.granted !== 'boolean'
        ) {
            throw createError('ADMIN can only grant or revoke USER permissions');
        }

        const current = snapshot.permissions[targetUserId]?.[targetToolId];

        if (current?.forcedState === true) {
            throw createError('Permission is protected by SUPER_ADMIN Forced State');
        }

        return submit('MODIFY_TOOL_PERMISSION', {
            targetUserId,
            targetToolId,
            granted: changes.granted
        });
    };

    const getTransactionHistory = () => {
        ensureLoaded();

        return Object.values(snapshot.transactions)
            .map(clone)
            .sort((a, b) =>
                String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
            );
    };

    const initialize = async () => {
        const { AUTH } = getDependencies();

        if (AUTH.getRole() !== 'ADMIN') {
            throw createError('ADMIN role is required');
        }

        await refresh();
        initialized = true;
        return true;
    };

    const API = Object.freeze({
        version: 1,
        initialize,
        refresh,
        getSnapshot,
        getUsers,
        getUser,
        getPermissions,
        getTools,
        addUser,
        editUser,
        deleteUser,
        setToolPermission,
        submit,
        getTransaction,
        waitForTransaction,
        getTransactionHistory,
        isInitialized: () => initialized,
        isSubmitting: () => submitting
    });

    global.YODAWY_ADMIN_ENGINE = API;
    YODAWY.admin = API;

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
