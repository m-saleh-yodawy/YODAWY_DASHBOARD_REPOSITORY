(function (YODAWY, global) {
    'use strict';

    if (global.YODAWY_SUPER_ADMIN_ENGINE) return;

    const CONFIG = Object.freeze({
        LOGS_PATH: 'NETWORK/network-logs.json',
        USERS_PATH: 'CONFIG/users.json',
        PERMISSIONS_PATH: 'CONFIG/tools-permissions.json',
        VISIBILITY_PATH: 'CONFIG/tools-visibility.json',
        REQUEST_TYPE: 'DASHBOARD_USERS_SYNC',
        FINAL_STATUSES: ['COMPLETED', 'FAILED', 'REJECTED'],
        VISIBILITY_TYPES: ['PRIVATE', 'PUBLIC', 'SELECTED_USERS']
    });

    let snapshot = null;
    let initialized = false;

    const createError = message => {
        const error = new Error(message);
        error.code = 'SUPER_ADMIN_ENGINE_ERROR';
        return error;
    };

    const clone = value =>
        JSON.parse(JSON.stringify(value));

    const getDependencies = () => {
        const API = YODAWY.api;
        const AUTH = YODAWY.auth;

        if (!API || !AUTH) {
            throw createError('Required engines are unavailable');
        }

        if (!AUTH.isAuthenticated() || AUTH.getRole() !== 'SUPER_ADMIN') {
            throw createError('SUPER_ADMIN authentication is required');
        }

        return { API, AUTH };
    };

    const normalizeId = value =>
        String(value || '').trim().toUpperCase();

    const normalizeText = value =>
        String(value || '').trim();

    const encodeContent = value => {
        const bytes = new TextEncoder().encode(
            JSON.stringify(value, null, 2)
        );

        let binary = '';

        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(
                ...bytes.subarray(i, i + 0x8000)
            );
        }

        return btoa(binary);
    };

    const createId = () => {
        if (global.crypto?.randomUUID) {
            return global.crypto.randomUUID().toUpperCase();
        }

        return `${Date.now()}-${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
    };

    const createSequence = () =>
        `${Date.now()}${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`;

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

    const readJSON = async path => {
        const { API } = getDependencies();
        const content = await API.getFileContent(path);
        const data = JSON.parse(content);

        if (!data || typeof data !== 'object') {
            throw createError(`Invalid JSON structure: ${path}`);
        }

        return data;
    };

    const validateVisibility = data => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw createError('Invalid visibility configuration');
        }

        const result = {};

        for (const [toolId, record] of Object.entries(data)) {
            if (
                !toolId.trim() ||
                !record ||
                typeof record !== 'object' ||
                Array.isArray(record) ||
                !CONFIG.VISIBILITY_TYPES.includes(record.visibility) ||
                !Array.isArray(record.allowedUsers)
            ) {
                throw createError(`Invalid visibility record: ${toolId}`);
            }

            result[toolId] = {
                visibility: record.visibility,
                allowedUsers: [
                    ...new Set(record.allowedUsers.map(normalizeId).filter(Boolean))
                ]
            };
        }

        return result;
    };

    const refresh = async () => {
        getDependencies();

        const [users, permissions, visibility, logs] = await Promise.all([
            readJSON(CONFIG.USERS_PATH),
            readJSON(CONFIG.PERMISSIONS_PATH),
            readJSON(CONFIG.VISIBILITY_PATH),
            readJSON(CONFIG.LOGS_PATH)
        ]);

        if (!Array.isArray(users.users)) {
            throw createError('Invalid users registry');
        }

        if (!permissions || Array.isArray(permissions)) {
            throw createError('Invalid permissions registry');
        }

        const eligibleIds = new Set(
            users.users
                .filter(user => ['ADMIN', 'USER'].includes(normalizeText(user.role).toUpperCase()))
                .map(user => normalizeId(user.id))
        );
        const eligiblePermissions = Object.fromEntries(
            Object.entries(permissions).filter(([userId]) => eligibleIds.has(normalizeId(userId)))
        );

        snapshot = {
            users: clone(users.users),
            permissions: clone(eligiblePermissions),
            visibility: validateVisibility(visibility),
            transactions: clone(logs.transactions || {}),
            updatedAt: logs.updatedAt || null
        };

        return clone(snapshot);
    };

    const ensureLoaded = () => {
        if (!initialized || !snapshot) {
            throw createError('SUPER_ADMIN engine has not been initialized');
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

    const getVisibility = () => {
        ensureLoaded();
        return clone(snapshot.visibility);
    };

    const getTools = () => {
        const tools = YODAWY.tools?.getManifest?.();

        if (!Array.isArray(tools)) {
            throw createError('Tools manifest is unavailable');
        }

        return clone(tools);
    };

    const validateLastSuperAdmin = (userId, changes = {}) => {
        ensureLoaded();

        const id = normalizeId(userId);
        const target = snapshot.users.find(
            user => normalizeId(user.id) === id
        );

        if (!target) {
            throw createError('Target user was not found');
        }

        const isActiveSuperAdmin =
            normalizeText(target.role).toUpperCase() === 'SUPER_ADMIN' &&
            normalizeText(target.status).toLowerCase() === 'active';

        if (!isActiveSuperAdmin) return true;

        const removesSuperAdmin =
            changes.delete === true ||
            (
                changes.role !== undefined &&
                normalizeText(changes.role).toUpperCase() !== 'SUPER_ADMIN'
            ) ||
            (
                changes.status !== undefined &&
                normalizeText(changes.status).toLowerCase() !== 'active'
            );

        if (!removesSuperAdmin) return true;

        const activeSuperAdmins = snapshot.users.filter(user =>
            normalizeText(user.role).toUpperCase() === 'SUPER_ADMIN' &&
            normalizeText(user.status).toLowerCase() === 'active'
        );

        if (activeSuperAdmins.length <= 1) {
            throw createError('The last active SUPER_ADMIN cannot be removed or deactivated');
        }

        return true;
    };

    const createRequest = async (action, payload) => {
        const { API, AUTH } = getDependencies();

        const user = AUTH.getUser();

        if (!user?.userId && !user?.id) {
            throw createError('Authenticated actor ID is unavailable');
        }

        const actorId = normalizeId(user.userId || user.id);
        const actorName = normalizeText(user.name);

        if (!actorId || !actorName) {
            throw createError('Authenticated actor information is incomplete');
        }

        const requestId = `DASH-USERS-${createId()}`;
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
                role: 'SUPER_ADMIN'
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

        const response = await API.put(endpoint, {
        message: `Submit ${action} transaction ${requestId}`,
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
    };

    const getTransaction = async requestId => {
        const id = normalizeText(requestId);

        if (!id) {
            throw createError('Invalid transaction ID');
        }

        const logs = await readJSON(CONFIG.LOGS_PATH);
        const transaction = logs.transactions?.[id];

        return transaction ? clone(transaction) : null;
    };

    const waitForTransaction = async (
        requestId,
        options = {}
    ) => {
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

    const submit = async (action, payload, options = {}) => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw createError('Invalid transaction payload');
        }

        const request = await createRequest(action, payload);

        if (options.wait === true) {
            const transaction = await waitForTransaction(
                request.requestId,
                options
            );

            return {
                ...request,
                transaction
            };
        }

        return request;
    };

    const addUser = async data => {
        ensureLoaded();

        const name = normalizeText(data?.name);
        const role = normalizeText(data?.role || 'USER').toUpperCase();
        const status = normalizeText(data?.status || 'Active');
        const password = String(data?.password || '');

        if (!name) {
            throw createError('User name is required');
        }
        if (password.length < 10 || password.length > 128) throw createError('Initial password must be between 10 and 128 characters');

        if (!['USER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
            throw createError('Invalid user role');
        }

        if (!['ACTIVE', 'INACTIVE'].includes(status.toUpperCase())) {
            throw createError('Invalid user status');
        }

        return submit('ADD_USER', {
            name,
            role,
            status,
            password,
            ...(data?.id ? { id: normalizeId(data.id) } : {})
        });
    };

    const editUser = async (userId, changes) => {
        ensureLoaded();

        const id = normalizeId(userId);

        if (!id || !changes || typeof changes !== 'object' || Array.isArray(changes)) {
            throw createError('Invalid user update');
        }

        const allowed = ['name', 'role', 'status'];
        const update = {};

        for (const key of allowed) {
            if (changes[key] !== undefined) {
                update[key] = changes[key];
            }
        }

        if (!Object.keys(update).length) {
            throw createError('No supported user changes supplied');
        }

        const current = getUser(id);

        if (!current) {
            throw createError('Target user was not found');
        }

        if (update.name !== undefined) {
            update.name = normalizeText(update.name);

            if (!update.name) {
                throw createError('User name cannot be empty');
            }
        }

        if (update.role !== undefined) {
            update.role = normalizeText(update.role).toUpperCase();

            if (!['USER', 'ADMIN', 'SUPER_ADMIN'].includes(update.role)) {
                throw createError('Invalid user role');
            }
        }

        if (update.status !== undefined) {
            update.status = normalizeText(update.status);

            if (!['ACTIVE', 'INACTIVE'].includes(update.status.toUpperCase())) {
                throw createError('Invalid user status');
            }
        }

        validateLastSuperAdmin(id, update);

        return submit('EDIT_USER', {
            id,
            ...update
        });
    };

    const deleteUser = async userId => {
        ensureLoaded();

        const id = normalizeId(userId);

        if (!id || !getUser(id)) {
            throw createError('Target user was not found');
        }

        validateLastSuperAdmin(id, { delete: true });

        return submit('DELETE_USER', { id });
    };

    const setToolPermission = async (
        userId,
        toolId,
        changes
    ) => {
        ensureLoaded();

        const targetUserId = normalizeId(userId);
        const targetToolId = normalizeText(toolId);

        const targetUser = getUser(targetUserId);

        if (!targetUser) {
            throw createError('Target user was not found');
        }

        if (!['ADMIN', 'USER'].includes(normalizeText(targetUser.role).toUpperCase())) {
            throw createError('SUPER_ADMIN accounts do not receive tool permission records');
        }

        if (!getTools().some(tool => tool.id === targetToolId)) {
            throw createError('Target tool was not found');
        }

        if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
            throw createError('Invalid permission changes');
        }

        const update = {};

        if (changes.granted !== undefined) {
            if (typeof changes.granted !== 'boolean') {
                throw createError('Granted must be a boolean value');
            }

            update.granted = changes.granted;
        }

        if (changes.forcedState !== undefined) {
            if (typeof changes.forcedState !== 'boolean') {
                throw createError('Forced State must be a boolean value');
            }

            update.forcedState = changes.forcedState;
        }

        if (!Object.keys(update).length) {
            throw createError('No permission changes supplied');
        }

        return submit('MODIFY_TOOL_PERMISSION', {
            targetUserId,
            targetToolId,
            ...update
        });
    };

    const updatePermissions = async permissions => {
        ensureLoaded();

        if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
            throw createError('Invalid permissions configuration');
        }

        const eligible = {};

        for (const [userId, tools] of Object.entries(permissions)) {
            const user = getUser(userId);

            if (!user || !['ADMIN', 'USER'].includes(normalizeText(user.role).toUpperCase())) {
                throw createError(`Permission records are not allowed for user ${userId}`);
            }

            if (!tools || typeof tools !== 'object' || Array.isArray(tools)) {
                throw createError(`Invalid tool permissions for user ${userId}`);
            }

            eligible[normalizeId(userId)] = {};

            for (const [toolId, value] of Object.entries(tools)) {
                if (!getTools().some(tool => tool.id === toolId)) {
                    throw createError(`Unknown tool: ${toolId}`);
                }

                const record = typeof value === 'boolean'
                    ? { granted: value }
                    : value;

                if (
                    !record ||
                    typeof record !== 'object' ||
                    Array.isArray(record) ||
                    typeof record.granted !== 'boolean' ||
                    (record.forcedState !== undefined && typeof record.forcedState !== 'boolean')
                ) {
                    throw createError(`Invalid permission record for ${userId}/${toolId}`);
                }

                eligible[normalizeId(userId)][toolId] = {
                    granted: record.granted,
                    forcedState: record.forcedState === true
                };
            }
        }

        return submit('MODIFY_TOOL_PERMISSION', {
            permissions: eligible
        });
    };

    const updateVisibility = async (changes, metadata = {}) => {
        ensureLoaded();

        if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
            throw createError('Invalid visibility changes');
        }

        const updated = {
            ...clone(snapshot.visibility),
            ...clone(changes)
        };

        const validated = validateVisibility(updated);
        const targetToolIds = Array.isArray(metadata.targetToolIds)
            ? [...new Set(metadata.targetToolIds.map(normalizeText).filter(id => getTools().some(tool => tool.id === id)))]
            : [];

        return submit('UPDATE_VISIBILITY', {
            visibility: validated,
            ...(targetToolIds.length ? { targetToolIds } : {})
        });
    };

    const setToolVisibility = async (toolId, record) => {
        ensureLoaded();

        const id = normalizeText(toolId);

        if (!getTools().some(tool => tool.id === id)) {
            throw createError('Target tool was not found');
        }

        const updated = validateVisibility({
            [id]: record
        });

        return updateVisibility(updated, { targetToolIds: [id] });
    };

    const getTransactionHistory = () => {
        ensureLoaded();

        return Object.values(snapshot.transactions)
            .map(clone)
            .sort((a, b) =>
                String(b.updatedAt || '').localeCompare(
                    String(a.updatedAt || '')
                )
            );
    };

    const initialize = async () => {
        const { AUTH } = getDependencies();

        if (AUTH.getRole() !== 'SUPER_ADMIN') {
            throw createError('SUPER_ADMIN role is required');
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
        getVisibility,
        getTools,
        addUser,
        editUser,
        deleteUser,
        setToolPermission,
        updatePermissions,
        updateVisibility,
        setToolVisibility,
        submit,
        getTransaction,
        waitForTransaction,
        getTransactionHistory,
        isInitialized: () => initialized,
        isSubmitting: () => false
    });

    global.YODAWY_SUPER_ADMIN_ENGINE = API;
    YODAWY.superAdminEngine = API;
    YODAWY.superAdmin = API;

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

            if (initialized !== true) {
                throw new Error('Dashboard UI initialization failed');
            }
        } catch (cause) {
            const error = new Error(cause?.message || 'Dashboard UI initialization failed');
            error.code = 'ENGINE_INIT_FAILED';
            throw error;
        }

        return true;
    };

})(YODAWY, window);
