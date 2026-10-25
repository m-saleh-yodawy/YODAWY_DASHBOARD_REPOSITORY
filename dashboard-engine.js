YODAWY.init = async function () {
    'use strict';

    if (window.__YODAWY_DASHBOARD_RUNNING__) {
        return Boolean(YODAWY.authenticated);
    }

    window.__YODAWY_DASHBOARD_RUNNING__ = true;

    const CONFIG = {
        userId: String(YODAWY.userId || '').trim(),
        manifestPath: 'TOOLS_CACHE/tools-manifest.json',
        toolsDirectory: 'TOOLS_CACHE/TOOLS',
        settingsPath: 'DASHBOARD/dashboard-settings.json',
        permissionsPath: 'CONFIG/tools-permissions.json',
        visibilityPath: 'CONFIG/tools-visibility.json',
        usersRepository: YODAWY.usersRepository || 'YODAWY_USERS_REPOSITORY'
    };

    const PURPLE = '#875A7B';
    const DARK = '#68465f';
    const LIGHT_BG = '#f8f5f7';
    const SOFT_BG = '#eee7ed';
    const API = YODAWY.apiBase;
    const OWNER = YODAWY.owner;

    const DEFAULT_AUTH_MESSAGES = {
        INVALID_CREDENTIALS: {
            title: 'LOGIN FAILED',
            message: 'INVALID ID OR PASSWORD'
        },
        WRONG_SYSTEM: {
            title: 'SYSTEM ERROR',
            message: 'WRONG SYSTEM'
        },
        USER_INACTIVE: {
            title: 'ACCOUNT INACTIVE',
            message: 'YOUR ACCOUNT IS INACTIVE'
        },
        TOKEN_INVALID: {
            title: 'AUTHENTICATION FAILED',
            message: 'INVALID OR EXPIRED TOKEN'
        },
        NETWORK_ERROR: {
            title: 'CONNECTION ERROR',
            message: 'UNABLE TO CONNECT. PLEASE TRY AGAIN.'
        },
        UNKNOWN_ERROR: {
            title: 'ERROR',
            message: 'AN UNEXPECTED ERROR OCCURRED. PLEASE TRY AGAIN.'
        }
    };

    const state = {
        section: 'overview',
        status: 'unConnected',
        user: null,
        userRole: 'NONE',
        dashboardVariant: 'NONE',
        users: [],
        userFormOpen: false,
        userFormId: '',
        userFormDraft: null,
        userSaving: false,
        userSavingTargetId: '',
        personalToken: '',
        personalRepoVerified: false,
        settings: {},
        messages: {
            ...DEFAULT_AUTH_MESSAGES,
            ...(YODAWY.authMessages || {})
        },
        permissions: {},
        permissionsRawWrapper: false,
        permissionsSelectedUser: '',
        permissionSavingKey: '',
        visibility: {},
        visibilitySelectedUser: 'ALL',
        visibilityDirty: false,
        tools: [],
        logs: [],
        error: '',
        errorTitle: '',
        notice: '',
        noticeTitle: '',
        loading: false,
        authenticated: false,
        initialized: false
    };

    const $ = (selector, root = document) =>
        root.querySelector(selector);

    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);

    // =========================================================
    // SVG ICONS
    // =========================================================

    const ICONS = {
        brand: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`,
        overview: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect></svg>`,
        tools: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`,
        sync: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
        unlocked: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`,
        lock: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
        bolt: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
        cloud: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>`,
        user: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
        plus: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
        edit: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
        trash: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
        close: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
        alertBadge: `<svg viewBox="0 0 14 14" width="10" height="10" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="7" fill="#c94b58"></circle><path fill="#fff" d="M6 10H8V12H6V10ZM6 2H8V8H6V2Z"></path></svg>`,
        okBadge: `<svg viewBox="0 0 14 14" width="10" height="10" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="7" fill="#39865b"></circle><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 7.2L6.1 9.3L10.2 4.8"></path></svg>`
    };

    function log(message, type = 'info') {
        state.logs.unshift({
            message: String(message),
            type,
            time: new Date().toLocaleTimeString()
        });

        state.logs.length = Math.min(state.logs.length, 50);
    }

    function notify(message, title = '') {
        state.notice = '';
        state.noticeTitle = '';
        state.errorTitle = String(title || '');
        state.error = String(message || '');
        log(state.errorTitle ? `${state.errorTitle}: ${state.error}` : state.error, 'error');
        render();
    }

    function notifySuccess(message, title = 'SAVED') {
        state.error = '';
        state.errorTitle = '';
        state.noticeTitle = String(title || '');
        state.notice = String(message || '');
        log(state.noticeTitle ? `${state.noticeTitle}: ${state.notice}` : state.notice, 'success');
        render();
    }

    function repositoryUrl(repository, path = '') {
        const base =
            `${API}/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(repository)}`;

        return path
            ? `${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`
            : base;
    }

    async function readJson(
        repository,
        path,
        token,
        branch = YODAWY.branch
    ) {
        return YODAWY.readJSON(repository, path, token, branch);
    }

    async function readText(
        repository,
        path,
        token,
        branch = YODAWY.branch
    ) {
        return YODAWY.readText(repository, path, token, branch);
    }

    // =========================================================
    // AUTHORITATIVE REPOSITORY & PATH RESOLVERS
    // =========================================================

    function getUserRegistryRepository() {
        const authConfig = YODAWY.authConfig || {};
        const registryConfig = authConfig.userRegistry || {};
        return String(
            registryConfig.repository ||
            YODAWY.dashboardRepository ||
            ''
        ).trim();
    }

    function getUserRegistryPath() {
        const authConfig = YODAWY.authConfig || {};
        const registryConfig = authConfig.userRegistry || {};
        return String(
            registryConfig.path ||
            'CONFIG/auth-users.json'
        ).trim();
    }

    function getPermissionsRepository() {
        const authConfig = YODAWY.authConfig || {};
        return String(
            authConfig.permissions?.repository ||
            authConfig.permissionsRepository ||
            YODAWY.dashboardRepository ||
            ''
        ).trim();
    }

    function getPermissionsPath() {
        const authConfig = YODAWY.authConfig || {};
        return String(
            authConfig.permissions?.path ||
            authConfig.permissionsPath ||
            CONFIG.permissionsPath
        ).trim();
    }

    function getVisibilityRepository() {
        const authConfig = YODAWY.authConfig || {};
        return String(
            authConfig.visibility?.repository ||
            authConfig.visibilityRepository ||
            YODAWY.dashboardRepository ||
            ''
        ).trim();
    }

    function getVisibilityPath() {
        const authConfig = YODAWY.authConfig || {};
        return String(
            authConfig.visibility?.path ||
            authConfig.visibilityPath ||
            CONFIG.visibilityPath
        ).trim();
    }

    function getUsers(data) {
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.users)) return data.users;
        return [];
    }

    function resolveCanonicalToolKey(rawKey, toolsList = state.tools) {
        const trimmed = String(rawKey || '').trim();
        if (!trimmed) return '';

        if (Array.isArray(toolsList) && toolsList.length > 0) {
            const matchedTool = toolsList.find(tool => {
                const key = permissionKey(tool);
                return (
                    key.toUpperCase() === trimmed.toUpperCase() ||
                    String(tool.path || '').trim() === trimmed ||
                    String(tool.name || '').trim() === trimmed
                );
            });

            if (matchedTool) {
                return permissionKey(matchedTool);
            }
        }

        return trimmed;
    }

    function normalizeSinglePermissionEntry(rawEntry, contextLabel = '') {
        if (typeof rawEntry === 'boolean') {
            return {
                granted: rawEntry,
                forcedState: false,
                type: 'ADMIN'
            };
        }

        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
            if (rawEntry !== undefined && rawEntry !== null) {
                log(
                    `Skipped malformed permission record (${contextLabel}): unsupported value type.`,
                    'warning'
                );
            }
            return null;
        }

        const hasExplicitGranted = typeof rawEntry.granted === 'boolean';
        const hasLegacyEnabled = typeof rawEntry.enabled === 'boolean';

        if (!hasExplicitGranted && !hasLegacyEnabled) {
            log(
                `Malformed permission record (${contextLabel}): missing boolean granted/enabled; defaulting granted to false.`,
                'warning'
            );
        }

        const normalized = {
            ...rawEntry,
            granted: hasExplicitGranted
                ? rawEntry.granted
                : rawEntry.enabled === true,
            forcedState: rawEntry.forcedState === true,
            type: rawEntry.type === 'SUPER_ADMIN'
                ? 'SUPER_ADMIN'
                : 'ADMIN'
        };

        delete normalized.enabled;
        return normalized;
    }

    function getPermissions(data, toolsList = state.tools) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return {};
        }

        const sourceMap =
            data.users && typeof data.users === 'object' && !Array.isArray(data.users)
                ? data.users
                : data;

        const normalizedUsers = {};

        for (const [rawUserId, rawUserPerms] of Object.entries(sourceMap)) {
            const userId = normalizePermissionUserId(rawUserId);
            if (!userId) continue;

            if (!rawUserPerms || typeof rawUserPerms !== 'object' || Array.isArray(rawUserPerms)) {
                log(
                    `Skipped malformed user permission block for "${rawUserId}".`,
                    'warning'
                );
                continue;
            }

            if (!normalizedUsers[userId]) {
                normalizedUsers[userId] = {};
            }

            for (const [rawToolKey, rawEntry] of Object.entries(rawUserPerms)) {
                const canonicalKey = resolveCanonicalToolKey(rawToolKey, toolsList);
                if (!canonicalKey) continue;

                const normalizedEntry = normalizeSinglePermissionEntry(
                    rawEntry,
                    `${userId}/${rawToolKey}`
                );

                if (!normalizedEntry) continue;

                const existing = normalizedUsers[userId][canonicalKey];
                const isCanonicalMatch = canonicalKey === String(rawToolKey).trim();

                if (!existing || isCanonicalMatch) {
                    normalizedUsers[userId][canonicalKey] = normalizedEntry;
                }
            }
        }

        return normalizedUsers;
    }

    function isPlaceholderToken(token) {
        const value = String(token || '').trim();
        if (!value || value.length < 10) return true;

        const upper = value.toUpperCase();
        const placeholders = [
            'YOUR_PERSONAL_TOKEN',
            'YOUR_TOKEN',
            'PERSONAL_TOKEN',
            'SYSTEM_TOKEN',
            'PUT_YOUR_TOKEN_HERE',
            'REPLACE_ME',
            'INSERT_TOKEN',
            'TOKEN_HERE',
            'GH_TOKEN_PLACEHOLDER',
            'NULL',
            'UNDEFINED'
        ];

        return placeholders.some(pattern => upper === pattern || upper.includes(pattern));
    }

    function getAuthMessageEntry(key, fallbackTitle = 'ERROR', fallbackMessage = '') {
        const aliasMap = {
            INVALID_ID: 'INVALID_CREDENTIALS',
            ACCOUNT_DISABLED: 'USER_INACTIVE'
        };

        const resolvedKey = state.messages?.[key]
            ? key
            : (aliasMap[key] || key);

        const raw = state.messages?.[resolvedKey] ?? DEFAULT_AUTH_MESSAGES[resolvedKey];

        if (raw && typeof raw === 'object') {
            const title = String(raw.title || fallbackTitle || 'ERROR').trim();
            const message = String(raw.message || fallbackMessage || resolvedKey).trim();
            return {
                title,
                message,
                formatted: title ? `${title}: ${message}` : message
            };
        }

        if (typeof raw === 'string' && raw.trim()) {
            return {
                title: fallbackTitle || 'ERROR',
                message: raw.trim(),
                formatted: raw.trim()
            };
        }

        const title = String(fallbackTitle || 'ERROR').trim();
        const message = String(fallbackMessage || key).trim();
        return {
            title,
            message,
            formatted: title ? `${title}: ${message}` : message
        };
    }

    function getMessage(key, fallback) {
        const entry = getAuthMessageEntry(key, '', fallback);
        return entry.formatted || fallback;
    }

    function throwAuthError(code, fallbackMessage = '') {
        const entry = getAuthMessageEntry(code, '', fallbackMessage);
        const err = new Error(entry.formatted);
        err.code = code;
        err.title = entry.title;
        err.userMessage = entry.message;
        throw err;
    }

    function permissionKey(tool) {
        if (!tool || typeof tool !== 'object') {
            return String(tool || '').trim();
        }

        if (tool.id) {
            return String(tool.id).trim();
        }

        return String(tool.path || '')
            .split('/')
            .pop()
            .replace(/\.user\.js$/i, '')
            .replace(/\.js$/i, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toUpperCase();
    }

    function normalizeRole(roleText) {
        const r = String(roleText || '')
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');

        if (r === 'super_admin' || r === 'superadmin') {
            return 'SUPER_ADMIN';
        }
        if (r === 'admin' || r === 'administrator') {
            return 'ADMIN';
        }
        return 'USER';
    }

    function formatRoleLabel(roleText) {
        const normalized = normalizeRole(roleText);
        if (normalized === 'SUPER_ADMIN') return 'Super Admin';
        if (normalized === 'ADMIN') return 'Admin';
        return 'User';
    }

    function rolePillClass(roleText) {
        const normalized = normalizeRole(roleText);
        if (normalized === 'SUPER_ADMIN') {
            return 'yd-pill-blue';
        }
        if (normalized === 'ADMIN') {
            return 'yd-pill-purple';
        }
        return 'yd-pill-yellow';
    }

    // =========================================================
    // ROLES, PERMISSIONS AND VISIBILITY (AUTHORITATIVE REGISTRY)
    // =========================================================

    function isFullyAuthenticated() {
        return Boolean(
            state.authenticated &&
            state.initialized &&
            state.personalRepoVerified &&
            state.user &&
            state.status === 'Connected'
        );
    }

    function isSuperAdmin() {
        if (!isFullyAuthenticated()) return false;

        return normalizeRole(state.user?.role) === 'SUPER_ADMIN';
    }

    function isAdmin() {
        if (!isFullyAuthenticated()) return false;

        const role = normalizeRole(state.user?.role);

        return role === 'SUPER_ADMIN' || role === 'ADMIN';
    }

    function canManage() {
        return isAdmin();
    }

    function canManageVisibility() {
        return isSuperAdmin();
    }

    function normalizePermissionUserId(userId) {
        return String(userId || '')
            .trim()
            .toUpperCase();
    }

    function getAuthenticatedUserId() {
        return normalizePermissionUserId(
            state.user?.id ||
            state.user?.userId ||
            state.user?.username ||
            CONFIG.userId ||
            ''
        );
    }

    function getToolPermissionRecord(
        tool,
        targetUserId = CONFIG.userId
    ) {
        const userId = normalizePermissionUserId(targetUserId);

        if (!userId || !tool || !state.permissions ||
            typeof state.permissions !== 'object') {
            return {
                granted: false,
                forcedState: false,
                type: 'ADMIN'
            };
        }

        const userPermissions = state.permissions[userId];

        if (!userPermissions ||
            typeof userPermissions !== 'object' ||
            Array.isArray(userPermissions)) {
            return {
                granted: false,
                forcedState: false,
                type: 'ADMIN'
            };
        }

        const key = permissionKey(tool);

        const permission =
            userPermissions[key] ??
            userPermissions[tool.path] ??
            userPermissions[tool.name];

        if (typeof permission === 'boolean') {
            return {
                granted: permission,
                forcedState: false,
                type: 'ADMIN'
            };
        }

        if (!permission ||
            typeof permission !== 'object' ||
            Array.isArray(permission)) {
            return {
                granted: false,
                forcedState: false,
                type: 'ADMIN'
            };
        }

        return {
            ...permission,

            granted:
                typeof permission.granted === 'boolean'
                    ? permission.granted
                    : permission.enabled === true,

            forcedState: permission.forcedState === true,

            type:
                permission.type === 'SUPER_ADMIN'
                    ? 'SUPER_ADMIN'
                    : 'ADMIN'
        };
    }

    function permissionGranted(
        tool,
        targetUserId = CONFIG.userId
    ) {
        if (!isFullyAuthenticated()) return false;

        const userId = normalizePermissionUserId(targetUserId);

        if (!userId) return false;

        return getToolPermissionRecord(tool, userId).granted === true;
    }

    function permissionType(
        tool,
        targetUserId = CONFIG.userId
    ) {
        return getToolPermissionRecord(tool, targetUserId).type;
    }

    function isPermissionForced(
        tool,
        targetUserId = CONFIG.userId
    ) {
        return getToolPermissionRecord(
            tool,
            targetUserId
        ).forcedState === true;
    }

    // =========================================================
    // ADMIN SCOPE VALIDATOR (DENY BY DEFAULT)
    // =========================================================

    function resolveAdminScopeConfig(adminUserId) {
        const normalizedAdminId = normalizePermissionUserId(adminUserId);
        if (!normalizedAdminId) return null;

        const authConfigScopes =
            YODAWY.authConfig?.adminScopes ||
            YODAWY.authConfig?.adminScope ||
            null;

        if (authConfigScopes && typeof authConfigScopes === 'object') {
            const matchedKey = Object.keys(authConfigScopes).find(
                k => normalizePermissionUserId(k) === normalizedAdminId
            );
            if (matchedKey && authConfigScopes[matchedKey] && typeof authConfigScopes[matchedKey] === 'object') {
                return authConfigScopes[matchedKey];
            }
        }

        const adminRecord = state.users.find(
            u => normalizePermissionUserId(u.id || u.userId || u.username) === normalizedAdminId
        ) || state.user;

        if (!adminRecord || typeof adminRecord !== 'object') {
            return null;
        }

        if (adminRecord.adminScope && typeof adminRecord.adminScope === 'object') {
            return adminRecord.adminScope;
        }

        if (adminRecord.scope && typeof adminRecord.scope === 'object') {
            return adminRecord.scope;
        }

        if (Array.isArray(adminRecord.managedUsers) || Array.isArray(adminRecord.managedTools)) {
            return {
                users: adminRecord.managedUsers,
                tools: adminRecord.managedTools
            };
        }

        return null;
    }

    function canAdminManageUserTool(targetUserId, tool) {
        if (!isFullyAuthenticated() || !tool) {
            return false;
        }

        if (isSuperAdmin()) {
            return true;
        }

        if (!isAdmin()) {
            return false;
        }

        const adminId = normalizePermissionUserId(CONFIG.userId);
        const targetId = normalizePermissionUserId(targetUserId);
        const toolKey = permissionKey(tool);

        if (!adminId || !targetId || !toolKey) {
            return false;
        }

        const targetUserRecord = state.users.find(
            u => normalizePermissionUserId(u.id || u.userId || u.username) === targetId
        );

        if (!targetUserRecord) {
            return false;
        }

        // An Admin may never manage a Super Admin account.
        if (normalizeRole(targetUserRecord.role) === 'SUPER_ADMIN') {
            return false;
        }

        const toolExists = state.tools.some(t => permissionKey(t) === toolKey);
        if (!toolExists) {
            return false;
        }

        const scopeConfig = resolveAdminScopeConfig(adminId);
        if (!scopeConfig || typeof scopeConfig !== 'object') {
            // Deny by default when no explicit Admin scope configuration exists.
            return false;
        }

        const rawUsers =
            scopeConfig.users ??
            scopeConfig.managedUsers ??
            scopeConfig.allowedUsers;

        const rawTools =
            scopeConfig.tools ??
            scopeConfig.managedTools ??
            scopeConfig.allowedTools;

        if (!Array.isArray(rawUsers) || !Array.isArray(rawTools)) {
            return false;
        }

        const scopedUsers = rawUsers
            .map(u => normalizePermissionUserId(u))
            .filter(Boolean);

        const scopedTools = rawTools
            .map(t => resolveCanonicalToolKey(t, state.tools).toUpperCase())
            .filter(Boolean);

        const isUserInScope = scopedUsers.includes(targetId);
        const isToolInScope = scopedTools.includes(toolKey.toUpperCase());

        return isUserInScope && isToolInScope;
    }

    function canEditToolPermission(
        tool,
        targetUserId,
        field = 'granted'
    ) {
        if (!isFullyAuthenticated() || !tool) {
            return false;
        }

        const targetId = normalizePermissionUserId(targetUserId);

        if (!targetId) return false;

        const normalizedField = String(field || '')
            .trim()
            .toLowerCase();

        if (
            normalizedField !== 'granted' &&
            normalizedField !== 'forcedstate'
        ) {
            return false;
        }

        if (isSuperAdmin()) {
            return true;
        }

        if (!isAdmin()) {
            return false;
        }

        // Admin can never modify Forced State.
        if (normalizedField === 'forcedstate') {
            return false;
        }

        // Admin cannot edit another user's permission when Forced State is ON.
        if (isPermissionForced(tool, targetId)) {
            return false;
        }

        // CRITICAL:
        // Call the real Admin scope validator.
        if (
            typeof canAdminManageUserTool !== 'function' ||
            !canAdminManageUserTool(targetId, tool)
        ) {
            return false;
        }

        return true;
    }

    function permitted(tool) {
        if (!isFullyAuthenticated() || !tool) {
            return false;
        }

        // Permission is evaluated for the authenticated user.
        // Super Admin does not receive an implicit tool permission bypass.
        return permissionGranted(tool, CONFIG.userId);
    }

    function isToolEnabledByUser(tool) {
        const key = permissionKey(tool);
        const toolsMap = state.settings?.tools;

        if (!toolsMap || typeof toolsMap !== 'object') {
            return false;
        }

        return toolsMap[key] === true;
    }

    // =========================================================
    // VISIBILITY POLICY & FAIL-SAFE ENFORCEMENT
    // =========================================================

    function visibilityPolicy(tool) {
        if (!tool || !state.visibility || typeof state.visibility !== 'object') {
            return null;
        }

        const key = permissionKey(tool);

        const record =
            state.visibility[key] ??
            state.visibility[tool.path] ??
            state.visibility[tool.name] ??
            null;

        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            return null;
        }

        return record;
    }

    function ensureToolVisibilityRecord(toolKey) {
        const existing = state.visibility[toolKey];

        if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
            state.visibility[toolKey] = {
                visibility: 'PRIVATE',
                allowedUsers: [],
                developmentStatus: 'UNDER DEVELOPMENT',
                publicationStatus: 'NOT PUBLISHED',
                enabled: false
            };
        } else {
            if (!Array.isArray(existing.allowedUsers)) {
                existing.allowedUsers = [];
            }
            if (!existing.visibility || typeof existing.visibility !== 'string') {
                existing.visibility = 'PRIVATE';
            }
            if (!existing.developmentStatus) {
                existing.developmentStatus = 'UNDER DEVELOPMENT';
            }
            if (!existing.publicationStatus) {
                existing.publicationStatus = 'NOT PUBLISHED';
            }
            if (typeof existing.enabled !== 'boolean') {
                existing.enabled = String(existing.visibility).toUpperCase() !== 'PRIVATE';
            }
        }

        return state.visibility[toolKey];
    }

    function isToolVisibleForUser(tool, targetUserId) {
        const uid = normalizePermissionUserId(targetUserId);
        if (!uid || !tool) return false;

        const userObj = state.users.find(
            u => normalizePermissionUserId(u.id || u.userId || u.username) === uid
        );
        const role = normalizeRole(userObj?.role);

        if (role === 'SUPER_ADMIN') {
            return true;
        }

        const policy = visibilityPolicy(tool);

        // Fail-safe policy: missing or malformed visibility records default to PRIVATE (denied).
        if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
            return false;
        }

        if (policy.enabled === false) {
            return false;
        }

        const visibility = String(
            policy.visibility || 'PRIVATE'
        ).trim().toUpperCase();

        if (visibility === 'PUBLIC' || visibility === 'USER') {
            return true;
        }

        if (visibility === 'ADMIN') {
            return role === 'ADMIN';
        }

        if (visibility === 'PRIVATE' || visibility === 'SUPER_ADMIN') {
            return false;
        }

        if (visibility === 'SELECTED_USERS') {
            const allowedUsers = Array.isArray(policy.allowedUsers)
                ? policy.allowedUsers.map(value =>
                    normalizePermissionUserId(value)
                )
                : [];

            return allowedUsers.includes(uid);
        }

        return false;
    }

    function toolIsVisible(tool) {
        if (!isFullyAuthenticated() || !tool) return false;

        if (isSuperAdmin()) {
            return true;
        }

        return isToolVisibleForUser(tool, CONFIG.userId);
    }

    function setToolVisibilityForUser(toolKey, targetUserId, turnOn) {
        if (!canManageVisibility()) {
            throw new Error('Super Admin access required to modify visibility.');
        }

        const uid = normalizePermissionUserId(targetUserId);
        if (!uid || uid === 'Q-001') return;

        const record = ensureToolVisibilityRecord(toolKey);
        const currentVis = String(record.visibility || 'PRIVATE').toUpperCase();

        const nonSuperAdminIds = state.users
            .filter(u => normalizeRole(u.role) !== 'SUPER_ADMIN')
            .map(u => normalizePermissionUserId(u.id || u.userId || u.username))
            .filter(Boolean);

        let allowedSet = new Set(
            (Array.isArray(record.allowedUsers) ? record.allowedUsers : [])
                .map(id => normalizePermissionUserId(id))
                .filter(Boolean)
        );

        if (currentVis === 'PUBLIC') {
            if (!turnOn) {
                record.visibility = 'SELECTED_USERS';
                allowedSet = new Set(nonSuperAdminIds.filter(id => id !== uid));
                record.allowedUsers = [...allowedSet];
                if (record.allowedUsers.length === 0) {
                    record.visibility = 'PRIVATE';
                }
            }
        } else if (currentVis === 'PRIVATE') {
            if (turnOn) {
                record.visibility = 'SELECTED_USERS';
                allowedSet.add(uid);
                record.allowedUsers = [...allowedSet];
            }
        } else {
            if (turnOn) {
                allowedSet.add(uid);
            } else {
                allowedSet.delete(uid);
            }
            record.allowedUsers = [...allowedSet];
            if (record.allowedUsers.length === 0) {
                record.visibility = 'PRIVATE';
            }
        }

        record.enabled = record.visibility !== 'PRIVATE';
        state.visibilityDirty = true;
    }

    function setToolPolicyMode(toolKey, newMode) {
        if (!canManageVisibility()) {
            throw new Error('Super Admin access required to modify visibility.');
        }

        const mode = String(newMode || 'PRIVATE').toUpperCase();
        const record = ensureToolVisibilityRecord(toolKey);

        record.visibility = mode;

        if (mode === 'PRIVATE') {
            record.allowedUsers = [];
            record.enabled = false;
        } else if (mode === 'PUBLIC' || mode === 'ADMIN' || mode === 'USER') {
            record.enabled = true;
        } else if (mode === 'SELECTED_USERS') {
            record.enabled = record.allowedUsers.length > 0;
        } else {
            record.visibility = 'PRIVATE';
            record.allowedUsers = [];
            record.enabled = false;
        }

        state.visibilityDirty = true;
    }

    // =========================================================
    // PERSONAL REPOSITORY ACCESS & SETTINGS VERIFICATION
    // =========================================================

    function resetAuthState() {
        state.authenticated = false;
        state.initialized = false;
        state.personalRepoVerified = false;
        state.status = 'unConnected';
        state.user = null;
        state.userRole = 'NONE';
        state.dashboardVariant = 'NONE';
        state.userFormOpen = false;
        state.userFormId = '';
        state.userFormDraft = null;
        state.userSaving = false;
        state.userSavingTargetId = '';
        state.personalToken = '';
        state.settings = {};
        state.tools = [];
        YODAWY.authenticated = false;
    }

    async function verifyPersonalRepositoryAccess(personalRepository, personalToken) {
        const expectedOwner = String(OWNER || '').trim();
        const expectedRepo = String(personalRepository || '').trim();
        const cleanToken = String(personalToken || '').trim();

        if (!expectedOwner || !expectedRepo) {
            throwAuthError('UNKNOWN_ERROR');
        }

        if (isPlaceholderToken(cleanToken)) {
            throwAuthError('TOKEN_INVALID');
        }

        const repoApiUrl =
            `${API}/repos/${encodeURIComponent(expectedOwner)}/${encodeURIComponent(expectedRepo)}`;

        let response;
        try {
            response = await fetch(repoApiUrl, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${cleanToken}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                credentials: 'omit',
                cache: 'no-store'
            });
        } catch {
            throwAuthError('NETWORK_ERROR');
        }

        if (!response.ok) {
            throwAuthError('TOKEN_INVALID');
        }

        const repoMetadata = await response.json().catch(() => null);
        const actualOwner = String(repoMetadata?.owner?.login || '').trim().toLowerCase();
        const actualRepo = String(repoMetadata?.name || '').trim().toLowerCase();

        if (
            !repoMetadata ||
            actualOwner !== expectedOwner.toLowerCase() ||
            actualRepo !== expectedRepo.toLowerCase()
        ) {
            throwAuthError('TOKEN_INVALID');
        }

        return repoMetadata;
    }

    async function readPersonalSettingsFile(personalRepository, settingsPath, personalToken) {
        const cleanToken = String(personalToken || '').trim();
        const branch = YODAWY.branch || 'main';
        const url = `${repositoryUrl(personalRepository, settingsPath)}?ref=${encodeURIComponent(branch)}`;

        let response;
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${cleanToken}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                credentials: 'omit',
                cache: 'no-store'
            });
        } catch {
            throwAuthError('NETWORK_ERROR');
        }

        if (response.status === 404) {
            return { tools: {} };
        }

        if (response.status === 401 || response.status === 403) {
            throwAuthError('TOKEN_INVALID');
        }

        if (!response.ok) {
            throwAuthError('UNKNOWN_ERROR');
        }

        const payload = await response.json().catch(() => null);
        if (!payload || typeof payload.content !== 'string') {
            return { tools: {} };
        }

        try {
            const cleaned = payload.content.replace(/\s+/g, '');
            const binary = atob(cleaned);
            const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
            const decoded = new TextDecoder('utf-8').decode(bytes);
            const parsed = JSON.parse(decoded);
            return parsed && typeof parsed === 'object' ? parsed : { tools: {} };
        } catch {
            return { tools: {} };
        }
    }

    // =========================================================
    // GITHUB CONTENTS API READ & WRITE HELPERS (WITH SHA)
    // =========================================================

    function encodeJsonToBase64(data) {
        const bytes = new TextEncoder().encode(
            JSON.stringify(data, null, 2) + '\n'
        );

        let binary = '';
        for (let index = 0; index < bytes.length; index += 8192) {
            binary += String.fromCharCode(
                ...bytes.subarray(index, index + 8192)
            );
        }

        return btoa(binary);
    }

    function decodeBase64Json(base64Content) {
        const cleaned = String(base64Content || '').replace(/\s+/g, '');
        const binary = atob(cleaned);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const decoded = new TextDecoder('utf-8').decode(bytes);
        return JSON.parse(decoded);
    }

    async function fetchRepositoryJsonWithSha(repository, path, token) {
        const cleanToken = String(token || '').trim();
        const branch = YODAWY.branch || 'main';
        const url = `${repositoryUrl(repository, path)}?ref=${encodeURIComponent(branch)}`;

        let response;
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${cleanToken}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                credentials: 'omit',
                cache: 'no-store'
            });
        } catch {
            throwAuthError('NETWORK_ERROR');
        }

        if (response.status === 404) {
            return { exists: false, sha: '', data: {} };
        }

        if (response.status === 401 || response.status === 403) {
            throwAuthError('TOKEN_INVALID');
        }

        if (!response.ok) {
            const errPayload = await response.json().catch(() => ({}));
            throw new Error(
                errPayload.message || `Failed to read ${repository}/${path}: HTTP ${response.status}`
            );
        }

        const payload = await response.json().catch(() => null);
        if (!payload || typeof payload.content !== 'string') {
            return { exists: true, sha: payload?.sha || '', data: {} };
        }

        const parsed = decodeBase64Json(payload.content);
        return {
            exists: true,
            sha: String(payload.sha || ''),
            data: parsed && typeof parsed === 'object' ? parsed : {}
        };
    }

    async function putRepositoryJsonWithSha(repository, path, token, data, sha, commitMessage) {
        const cleanToken = String(token || '').trim();
        const branch = YODAWY.branch || 'main';

        const body = {
            message: commitMessage,
            content: encodeJsonToBase64(data),
            branch
        };

        if (sha) {
            body.sha = sha;
        }

        let response;
        try {
            response = await fetch(repositoryUrl(repository, path), {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${cleanToken}`,
                    Accept: 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                credentials: 'omit',
                cache: 'no-store',
                body: JSON.stringify(body)
            });
        } catch {
            throwAuthError('NETWORK_ERROR');
        }

        const result = await response.json().catch(() => ({}));

        if (response.status === 401 || response.status === 403) {
            const authErr = new Error(
                result.message || 'Repository write access denied for this token.'
            );
            authErr.status = response.status;
            throw authErr;
        }

        if (response.status === 409 || response.status === 422) {
            const conflictErr = new Error(
                result.message || 'Concurrent modification conflict (SHA mismatch).'
            );
            conflictErr.status = response.status;
            conflictErr.isConflict = true;
            throw conflictErr;
        }

        if (!response.ok) {
            const err = new Error(
                result.message || `Write failed (${response.status})`
            );
            err.status = response.status;
            throw err;
        }

        return result;
    }

    // =========================================================
    // USER REGISTRY MANAGEMENT (SUPER ADMIN ONLY)
    // =========================================================

    async function mutateUserRegistry(mutator, commitMessage) {
        if (!isFullyAuthenticated() || !isSuperAdmin()) {
            throw new Error(
                'Only an authenticated Super Admin can manage users.'
            );
        }

        const repository = getUserRegistryRepository();
        const path = getUserRegistryPath();
        const token = String(
    YODAWY.registryToken || ''
).trim();

        if (!repository || !path || !token || isPlaceholderToken(token)) {
            throw new Error(
                'User registry configuration or Personal Token is missing.'
            );
        }

        for (let attempt = 1; attempt <= 2; attempt++) {
            const currentFile = await fetchRepositoryJsonWithSha(
                repository,
                path,
                token
            );

            if (!currentFile.exists || !currentFile.sha) {
                throw new Error(
                    `User registry not found or missing SHA: ${repository}/${path}`
                );
            }

            const rawRoot = currentFile.data;
            const hasValidRegistryStructure =
                Array.isArray(rawRoot) ||
                Boolean(
                    rawRoot &&
                    typeof rawRoot === 'object' &&
                    Array.isArray(rawRoot.users)
                );

            if (!hasValidRegistryStructure) {
                throw new Error('Invalid user registry format.');
            }

            const currentUsers = getUsers(rawRoot);

            if (!Array.isArray(currentUsers)) {
                throw new Error('Invalid user registry format.');
            }

            const nextUsers = mutator(
                currentUsers.map(user => ({ ...user }))
            );

            if (!Array.isArray(nextUsers)) {
                throw new Error('Invalid user registry update.');
            }

            const seenIds = new Set();

            for (const user of nextUsers) {
                const id = normalizePermissionUserId(
                    user.id || user.userId || user.username
                );

                if (!id) {
                    throw new Error(
                        'Every employee must have a User ID.'
                    );
                }

                const normalizedId = id.toUpperCase();

                if (seenIds.has(normalizedId)) {
                    throw new Error(`Duplicate User ID: ${id}`);
                }

                seenIds.add(normalizedId);
            }

            const activeSuperAdmins = nextUsers.filter(user =>
                normalizeRole(user.role) === 'SUPER_ADMIN' &&
                String(user.status || '').trim().toLowerCase() === 'active'
            );

            if (activeSuperAdmins.length === 0) {
                throw new Error(
                    'At least one active Super Admin must remain.'
                );
            }

            const payload = Array.isArray(rawRoot)
                ? nextUsers
                : {
                    ...(rawRoot && typeof rawRoot === 'object'
                        ? rawRoot
                        : {}),
                    users: nextUsers
                };

            try {
                await putRepositoryJsonWithSha(
                    repository,
                    path,
                    token,
                    payload,
                    currentFile.sha,
                    commitMessage
                );

                state.users = nextUsers;
                return nextUsers;

            } catch (error) {
                if ((error.isConflict || error.status === 409) && attempt < 2) {
                    log(
                        'SHA conflict detected while saving user registry; retrying with latest repository state...',
                        'warning'
                    );
                    continue;
                }

                throw error;
            }
        }

        throw new Error('Unable to save the user registry.');
    }

    async function addRegistryUser(userData) {
        if (!isFullyAuthenticated() || !isSuperAdmin()) {
            throw new Error(
                'Only an authenticated Super Admin can manage users.'
            );
        }

        const id = normalizePermissionUserId(userData?.id);
        const name = String(userData?.name || '').trim();
        const repository = String(userData?.repository || '').trim();

        if (!id) {
            throw new Error('Enter a User ID.');
        }

        if (!name) {
            throw new Error('Enter an employee name.');
        }

        if (!repository || !/^[A-Za-z0-9._-]+$/.test(repository)) {
            throw new Error('Enter a valid repository name.');
        }

        const role = formatRoleLabel(userData?.role);
        const status =
            String(userData?.status || '').trim().toLowerCase() === 'inactive'
                ? 'Inactive'
                : 'Active';

        await mutateUserRegistry(users => {
            const duplicate = users.some(user =>
                normalizePermissionUserId(
                    user.id || user.userId || user.username
                ).toUpperCase() === id.toUpperCase()
            );

            if (duplicate) {
                throw new Error(`User ID "${id}" already exists.`);
            }

            users.push({
                id,
                name,
                repository,
                role,
                status
            });

            return users;
        }, `Add dashboard user ${id}`);

        state.userFormOpen = false;
        state.userFormId = '';
        state.userFormDraft = null;
        state.permissionsSelectedUser = id;

        notifySuccess(
            `Employee ${id} was added to the registry.`,
            'USER ADDED'
        );
    }

    async function updateRegistryUser(targetId, userData) {
        if (!isFullyAuthenticated() || !isSuperAdmin()) {
            throw new Error(
                'Only an authenticated Super Admin can manage users.'
            );
        }

        const id = normalizePermissionUserId(targetId);
        const name = String(userData?.name || '').trim();
        const repository = String(userData?.repository || '').trim();

        if (!id || !name) {
            throw new Error('User ID and name are required.');
        }

        if (!repository || !/^[A-Za-z0-9._-]+$/.test(repository)) {
            throw new Error('Enter a valid repository name.');
        }

        const nextRole = formatRoleLabel(userData?.role);
        const nextStatus =
            String(userData?.status || '').trim().toLowerCase() === 'inactive'
                ? 'Inactive'
                : 'Active';

        const currentUserId = getAuthenticatedUserId();

        if (
            id === currentUserId &&
            (
                normalizeRole(nextRole) !== 'SUPER_ADMIN' ||
                nextStatus !== 'Active'
            )
        ) {
            throw new Error(
                'You cannot demote or deactivate the signed-in Super Admin.'
            );
        }

        await mutateUserRegistry(users => {
            const index = users.findIndex(user =>
                normalizePermissionUserId(
                    user.id || user.userId || user.username
                ) === id
            );

            if (index < 0) {
                throw new Error(`Employee "${id}" was not found.`);
            }

            const current = users[index];

            users[index] = {
                ...current,
                id: normalizePermissionUserId(
                    current.id || current.userId || current.username || id
                ),
                name,
                repository,
                role: nextRole,
                status: nextStatus
            };

            return users;
        }, `Update dashboard user ${id}`);

        if (id === currentUserId && state.user) {
            state.user = {
                ...state.user,
                name,
                repository,
                role: nextRole,
                status: nextStatus
            };
        }

        state.userFormOpen = false;
        state.userFormId = '';
        state.userFormDraft = null;

        notifySuccess(
            `Employee ${id} was updated.`,
            'USER UPDATED'
        );
    }

    async function deleteRegistryUser(targetId) {
        if (!isFullyAuthenticated() || !isSuperAdmin()) {
            throw new Error(
                'Only an authenticated Super Admin can manage users.'
            );
        }

        const id = normalizePermissionUserId(targetId);

        if (!id) {
            throw new Error('Invalid User ID.');
        }

        const currentUserId = getAuthenticatedUserId();

        if (id === currentUserId) {
            throw new Error(
                'You cannot delete the currently signed-in account.'
            );
        }

        const target = state.users.find(user =>
            normalizePermissionUserId(
                user.id || user.userId || user.username
            ) === id
        );

        if (!target) {
            throw new Error(`Employee "${id}" was not found.`);
        }

        if (normalizeRole(target.role) === 'SUPER_ADMIN') {
            throw new Error(
                'Deleting a Super Admin is blocked to prevent lockout.'
            );
        }

        await mutateUserRegistry(
            users => {
                const authoritativeTarget = users.find(user =>
                    normalizePermissionUserId(
                        user.id || user.userId || user.username
                    ) === id
                );

                if (!authoritativeTarget) {
                    throw new Error(`Employee "${id}" was not found.`);
                }

                if (normalizeRole(authoritativeTarget.role) === 'SUPER_ADMIN') {
                    throw new Error(
                        'Deleting a Super Admin is blocked to prevent lockout.'
                    );
                }

                return users.filter(user =>
                    normalizePermissionUserId(
                        user.id || user.userId || user.username
                    ) !== id
                );
            },
            `Delete dashboard user ${id}`
        );

        if (state.permissionsSelectedUser === id) {
            const nextDefaultUser =
                state.users.find(u => normalizeRole(u.role) !== 'SUPER_ADMIN') ||
                state.users[0];
            state.permissionsSelectedUser = nextDefaultUser
                ? normalizePermissionUserId(
                    nextDefaultUser.id || nextDefaultUser.userId || nextDefaultUser.username
                )
                : '';
        }

        if (state.visibilitySelectedUser === id) {
            state.visibilitySelectedUser = 'ALL';
        }

        state.userFormOpen = false;
        state.userFormId = '';
        state.userFormDraft = null;

        notifySuccess(
            `Employee ${id} was removed from the registry.`,
            'USER DELETED'
        );
    }

    function readUserFormInputs() {
        const isEditing = Boolean(state.userFormId);
        return {
            id: isEditing
                ? state.userFormId
                : normalizePermissionUserId($('#yd-user-id')?.value || ''),
            name: String($('#yd-user-name')?.value || '').trim(),
            repository: String($('#yd-user-repository')?.value || '').trim(),
            role: formatRoleLabel($('#yd-user-role')?.value || 'User'),
            status:
                String($('#yd-user-status')?.value || 'Active').trim().toLowerCase() === 'inactive'
                    ? 'Inactive'
                    : 'Active'
        };
    }

    // =========================================================
    // AUTHENTICATION (TWO-STAGE: SYSTEM + PERSONAL REPOSITORY)
    // =========================================================

    async function authenticate() {
        resetAuthState();

        const authConfig = YODAWY.authConfig;

        const messagesPath =
            authConfig?.dashboard?.messagesPath ||
            'CONFIG/auth-messages.json';

        try {
            const loadedMessages = await readJson(
                YODAWY.dashboardRepository,
                messagesPath
            );
            const extractedMessages =
                loadedMessages?.messages && typeof loadedMessages.messages === 'object'
                    ? loadedMessages.messages
                    : loadedMessages;

            if (extractedMessages && typeof extractedMessages === 'object') {
                state.messages = {
                    ...DEFAULT_AUTH_MESSAGES,
                    ...extractedMessages
                };
            }
        } catch {
            // Preserve preloaded authMessages from the bootstrap loader.
        }

        if (!authConfig || authConfig.provider !== 'github' || authConfig.enabled === false) {
            throwAuthError('WRONG_SYSTEM');
        }

        const registryRepository = getUserRegistryRepository();
        const registryPath = getUserRegistryPath();

        const permissionsRepository = getPermissionsRepository();
        const permissionsPath = getPermissionsPath();
        const visibilityRepository = getVisibilityRepository();
        const visibilityPath = getVisibilityPath();

        let usersData;
        let permissionsData;
        let visibilityData;

        try {
            [
                usersData,
                permissionsData,
                visibilityData
            ] = await Promise.all([
                readJson(registryRepository, registryPath),
                readJson(permissionsRepository, permissionsPath).catch(() => ({})),
                readJson(visibilityRepository, visibilityPath).catch(() => ({}))
            ]);
        } catch {
            throwAuthError('NETWORK_ERROR');
        }

        const allUsers = getUsers(usersData);
        state.users = allUsers;

        const targetUserId = normalizePermissionUserId(CONFIG.userId);
        if (!targetUserId) {
            throwAuthError('INVALID_CREDENTIALS');
        }

        const user = allUsers.find(item =>
            normalizePermissionUserId(
                item.id ||
                item.userId ||
                item.username ||
                ''
            ) === targetUserId
        );

        if (!user) {
            throwAuthError('INVALID_CREDENTIALS');
        }

        if (String(user.status || '').trim().toLowerCase() !== 'active') {
            throwAuthError('USER_INACTIVE');
        }

        const personalRepository = String(
            user.repository ||
            user.personalRepository ||
            user.personal_repository ||
            ''
        ).trim();

        if (!personalRepository) {
            throwAuthError('UNKNOWN_ERROR');
        }

        const configuredPersonalToken = String(YODAWY.personalToken || '').trim();

        if (isPlaceholderToken(configuredPersonalToken)) {
            throwAuthError('TOKEN_INVALID');
        }

        await verifyPersonalRepositoryAccess(personalRepository, configuredPersonalToken);
        state.personalRepoVerified = true;

        const loadedSettings = await readPersonalSettingsFile(
            personalRepository,
            authConfig.settingsPath || CONFIG.settingsPath,
            configuredPersonalToken
        );

        state.settings = loadedSettings && typeof loadedSettings === 'object'
            ? loadedSettings
            : {};

        if (!state.settings.tools || typeof state.settings.tools !== 'object') {
            state.settings.tools = {};
        }

        const authoritativeRole = normalizeRole(user.role);

        state.user = {
            ...user,
            role: formatRoleLabel(authoritativeRole),
            repository: personalRepository
        };
        state.userRole = authoritativeRole;
        state.dashboardVariant = authoritativeRole;
        state.personalToken = configuredPersonalToken;

        state.permissionsRawWrapper = Boolean(
            permissionsData &&
            typeof permissionsData === 'object' &&
            !Array.isArray(permissionsData) &&
            permissionsData.users &&
            typeof permissionsData.users === 'object'
        );
        state.permissions = getPermissions(permissionsData, state.tools);

        const rawVisibilityMap =
            visibilityData?.visibility &&
            typeof visibilityData.visibility === 'object'
                ? visibilityData.visibility
                : visibilityData?.tools &&
                  typeof visibilityData.tools === 'object'
                    ? visibilityData.tools
                    : (visibilityData && typeof visibilityData === 'object' && !Array.isArray(visibilityData)
                        ? visibilityData
                        : {});

        state.visibility = {};
        for (const [k, v] of Object.entries(rawVisibilityMap)) {
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                state.visibility[String(k).trim()] = {
                    ...v,
                    visibility: String(v.visibility || 'PRIVATE').trim().toUpperCase(),
                    allowedUsers: Array.isArray(v.allowedUsers)
                        ? v.allowedUsers.map(u => normalizePermissionUserId(u)).filter(Boolean)
                        : [],
                    developmentStatus: v.developmentStatus || 'UNDER DEVELOPMENT',
                    publicationStatus: v.publicationStatus || 'NOT PUBLISHED',
                    enabled: typeof v.enabled === 'boolean'
                        ? v.enabled
                        : String(v.visibility || 'PRIVATE').trim().toUpperCase() !== 'PRIVATE'
                };
            }
        }

        if (!state.permissionsSelectedUser && allUsers.length > 0) {
            const firstNonSuper = allUsers.find(u => normalizeRole(u.role) !== 'SUPER_ADMIN') || allUsers[0];
            state.permissionsSelectedUser = normalizePermissionUserId(
                firstNonSuper.id || firstNonSuper.userId || firstNonSuper.username
            );
        }

        state.visibilityDirty = false;
        state.error = '';
        state.errorTitle = '';

        state.authenticated = true;
        state.initialized = true;
        state.status = 'Connected';
        state.section = state.settings.startPage === 'tools' ? 'tools' : 'overview';

        YODAWY.authenticated = true;
        YODAWY.userRole = authoritativeRole;
        YODAWY.dashboardVariant = authoritativeRole;
        YODAWY.authError = '';

        log(
            `Authenticated as ${state.user.name || CONFIG.userId} (${authoritativeRole} DASHBOARD).`,
            'success'
        );
    }

    // =========================================================
    // LOAD TOOLS FROM THE DASHBOARD REPOSITORY
    // =========================================================

    async function loadTools() {
        if (!isFullyAuthenticated()) {
            state.tools = [];
            throwAuthError('TOKEN_INVALID');
        }

        const repository = YODAWY.dashboardRepository;
        const branch = YODAWY.branch || 'main';

        let manifestData;

        try {
            manifestData = await readJson(
                repository,
                CONFIG.manifestPath,
                undefined,
                branch
            );
        } catch (error) {
            throw new Error(
                `Could not read ${repository}/${CONFIG.manifestPath}: ${error.message || error}`
            );
        }

        const manifestTools = Array.isArray(manifestData)
            ? manifestData
            : Array.isArray(manifestData?.tools)
                ? manifestData.tools
                : [];

        if (!manifestTools.length) {
            throw new Error(
                `${CONFIG.manifestPath} was found, but it does not contain a non-empty "tools" array.`
            );
        }

        function resolveToolPath(item) {
            const rawPath = String(
                item.path ||
                item.filePath ||
                item.file ||
                item.filename ||
                item.name ||
                ''
            ).trim().replace(/\\/g, '/');

            if (!rawPath) return '';

            if (rawPath.startsWith('TOOLS_CACHE/')) {
                return rawPath;
            }

            if (rawPath.startsWith('TOOLS/')) {
                return `TOOLS_CACHE/${rawPath}`;
            }

            if (rawPath.includes('/')) {
                return `${CONFIG.toolsDirectory}/${rawPath.split('/').pop()}`;
            }

            return `${CONFIG.toolsDirectory}/${rawPath}`;
        }

        const normalizedTools = manifestTools
            .filter(item => item && typeof item === 'object')
            .map(item => ({
                ...item,
                resolvedPath: resolveToolPath(item)
            }))
            .filter(item =>
                item.resolvedPath &&
                /\.js$/i.test(item.resolvedPath)
            );

        if (!normalizedTools.length) {
            throw new Error(
                `No JavaScript tool paths were found in ${CONFIG.manifestPath}. Each tool needs a .js path or filename.`
            );
        }

        const results = await Promise.allSettled(
            normalizedTools.map(async item => {
                const file = await readText(
                    repository,
                    item.resolvedPath,
                    undefined,
                    branch
                );

                const source = String(
                    typeof file === 'string'
                        ? file
                        : file?.content ?? file?.data ?? ''
                ).replace(/\u00a0/g, ' ');

                if (!source.trim()) {
                    throw new Error(
                        `Empty tool source: ${item.resolvedPath}`
                    );
                }

                const header = source.match(
                    /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/
                );

                if (!header) {
                    throw new Error(
                        `Missing userscript metadata: ${item.resolvedPath}`
                    );
                }

                const metadata = header[1];

                const values = key => [
                    ...metadata.matchAll(
                        new RegExp(
                            '^\\s*//\\s*@' + key + '\\s+(.+?)\\s*$',
                            'gm'
                        )
                    )
                ].map(match => match[1].trim());

                return {
                    id: String(
                        item.id ||
                        item.toolId ||
                        item.tool_id ||
                        ''
                    ).trim(),

                    path: item.resolvedPath,
                    source,
                    sha: typeof file === 'object' && file
                        ? file.sha || ''
                        : '',

                    name:
                        item.name ||
                        values('name')[0] ||
                        item.resolvedPath.split('/').pop(),

                    description:
                        item.description ||
                        values('description')[0] ||
                        '',

                    matches: Array.isArray(item.matches)
                        ? item.matches
                        : [
                            ...values('match'),
                            ...values('include')
                        ],

                    excludes: Array.isArray(item.excludes)
                        ? item.excludes
                        : [
                            ...values('exclude'),
                            ...values('exclude-match')
                        ],

                    grants: values('grant').filter(
                        value => value !== 'none'
                    ),

                    requires: values('require'),

                    enabled: item.enabled !== false
                };
            })
        );

        state.tools = results
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value)
            .sort((a, b) => permissionKey(a).localeCompare(permissionKey(b)));

        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const item = normalizedTools[index];

                const errorDetails = {
                    tool: item?.name || item?.resolvedPath || 'Unknown Tool',
                    path: item?.resolvedPath || '',
                    error: result.reason?.message || String(result.reason)
                };

                console.error('[YODAWY TOOL LOAD FAILED]', errorDetails);

                log(
                    `${errorDetails.path}: ${errorDetails.error}`,
                    'error'
                );
            }
        });

        if (!state.tools.length) {
            throw new Error(
                `The manifest was read, but none of its JavaScript tools could be loaded. Check the tool paths in ${CONFIG.manifestPath}.`
            );
        }

        // Re-normalize permissions against the loaded tools manifest so legacy path/name keys resolve to canonical TOOL-IDs.
        state.permissions = getPermissions(state.permissions, state.tools);

        log(
            `Loaded ${state.tools.length} tools from ${repository}/${CONFIG.toolsDirectory} using ${CONFIG.manifestPath}.`,
            'success'
        );
    }

    // =========================================================
    // PAGE MATCHING
    // =========================================================

    function simpleMatch(pattern, href) {
        if (pattern === '<all_urls>') return true;

        try {
            const url = new URL(href);

            const match = pattern.match(
                /^(\*|https?|file|ftp):\/\/([^/]+)(\/.*)$/i
            );

            if (!match) return false;

            const [, scheme, hostPattern, pathPattern] = match;

            if (
                scheme !== '*' &&
                scheme.toLowerCase() !== url.protocol.slice(0, -1)
            ) {
                return false;
            }

            const host = hostPattern.toLowerCase();
            const actualHost = url.hostname.toLowerCase();

            if (host !== '*') {
                if (host.startsWith('*.')) {
                    const suffix = host.slice(2);

                    if (
                        actualHost !== suffix &&
                        !actualHost.endsWith(`.${suffix}`)
                    ) {
                        return false;
                    }
                } else if (host !== actualHost) {
                    return false;
                }
            }

            const escaped = pathPattern.split('*')
                .map(part =>
                    part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                )
                .join('.*');

            return new RegExp(`^${escaped}$`)
                .test(url.pathname + url.search + url.hash);
        } catch {
            return false;
        }
    }

    function matchesPage(tool) {
        if (!tool || !Array.isArray(tool.matches) || !tool.matches.length) return false;

        if (Array.isArray(tool.excludes) && tool.excludes.some(pattern =>
            simpleMatch(pattern, location.href)
        )) {
            return false;
        }

        return tool.matches.some(pattern =>
            simpleMatch(pattern, location.href)
        );
    }

    // =========================================================
    // RUN TOOL (STRICT EXECUTION GUARD)
    // =========================================================

    function runTool(tool) {
        if (!isFullyAuthenticated() || !tool || typeof tool !== 'object') {
            throw new Error('Tool permission denied.');
        }

        const key = permissionKey(tool);
        const trustedTool = state.tools.find(item => permissionKey(item) === key);

        if (!trustedTool || trustedTool.enabled === false) {
            throw new Error('Tool is not available in the trusted manifest.');
        }

        if (!permitted(trustedTool) || !toolIsVisible(trustedTool)) {
            throw new Error('Tool permission denied.');
        }

        if (!matchesPage(trustedTool)) {
            throw new Error(
                'This tool does not match the current page.'
            );
        }

        if (!trustedTool.source || typeof trustedTool.source !== 'string' || !trustedTool.source.trim()) {
            throw new Error(`${trustedTool.name}: empty or invalid tool source.`);
        }

        if (Array.isArray(trustedTool.requires) && trustedTool.requires.length) {
            throw new Error(
                `${trustedTool.name}: @require dependencies are not supported.`
            );
        }

        const unsupported = (Array.isArray(trustedTool.grants) ? trustedTool.grants : []).filter(
            grant => grant !== 'unsafeWindow'
        );

        if (unsupported.length) {
            throw new Error(
                `${trustedTool.name}: unsupported @grant: ${unsupported.join(', ')}`
            );
        }

        const runKey = '__YODAWY_TOOL_' +
            trustedTool.path.replace(/[^a-zA-Z0-9]/g, '_');

        if (window[runKey]) {
            log(`${trustedTool.name} is already running.`, 'warning');
            return;
        }

        try {
            new Function(
                'unsafeWindow',
                `"use strict";\n${trustedTool.source}\n`
            )(window);

            window[runKey] = true;

            log(`Started ${trustedTool.name}.`, 'success');
        } catch (error) {
            log(`${trustedTool.name}: ${error.message}`, 'error');
            throw error;
        }
    }

    // =========================================================
    // SYNC
    // =========================================================

    async function sync() {
        if (state.loading) return isFullyAuthenticated();

        state.loading = true;
        state.error = '';
        state.errorTitle = '';
        render();

        try {
            if (!isFullyAuthenticated()) {
                await authenticate();
            }

            await loadTools();

            for (const tool of state.tools) {
                if (
                    permitted(tool) &&
                    toolIsVisible(tool) &&
                    isToolEnabledByUser(tool) &&
                    matchesPage(tool)
                ) {
                    try {
                        runTool(tool);
                    } catch (error) {
                        log(error.message, 'warning');
                    }
                }
            }

            state.status = 'Connected';
            return true;
        } catch (error) {
            resetAuthState();
            state.errorTitle = error.title || '';
            state.error = error.userMessage || error.message || String(error);
            YODAWY.authError = state.error;

            log(
                state.errorTitle ? `${state.errorTitle}: ${state.error}` : state.error,
                'error'
            );
            return false;
        } finally {
            state.loading = false;
            render();
        }
    }

    // =========================================================
    // SAVE PERSONAL SETTINGS & TOOL ON/OFF STATE
    // =========================================================

    async function writePersonalSettings(updatedSettings, successLogMessage) {
        if (!isFullyAuthenticated()) {
            throwAuthError('TOKEN_INVALID');
        }

        const repository = state.user.repository;
        const path = CONFIG.settingsPath;

        let current = null;

        try {
            current = await YODAWY.request(
                repositoryUrl(repository, path),
                state.personalToken
            );
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                throwAuthError('TOKEN_INVALID');
            }
            if (error.status !== 404) throw error;
        }

        const body = {
            message: 'Update dashboard settings',
            content: encodeJsonToBase64(updatedSettings),
            branch: YODAWY.branch
        };

        if (current?.sha) {
            body.sha = current.sha;
        }

        const response = await fetch(
            repositoryUrl(repository, path),
            {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${state.personalToken}`,
                    Accept: 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                credentials: 'omit',
                cache: 'no-store',
                body: JSON.stringify(body)
            }
        );

        const result = await response.json().catch(() => ({}));

        if (response.status === 401 || response.status === 403) {
            throwAuthError('TOKEN_INVALID');
        }

        if (!response.ok) {
            throw new Error(
                result.message ||
                `Settings save failed: ${response.status}`
            );
        }

        state.settings = updatedSettings;
        log(successLogMessage, 'success');
    }

    async function saveSettings() {
        if (!isFullyAuthenticated()) {
            throwAuthError('TOKEN_INVALID');
        }

        const displayName = $('#yd-name')?.value.trim() ||
            state.user.name ||
            CONFIG.userId;

        const startPage = $('#yd-start')?.value || 'overview';
        const repository = state.user.repository;

        const settings = {
            ...state.settings,
            owner: OWNER,
            repository,
            displayName,
            startPage,
            tools: {
                ...(state.settings.tools || {})
            },
            updatedAt: new Date().toISOString()
        };

        await writePersonalSettings(settings, 'Settings saved.');
        state.user.name = displayName;
        notifySuccess('Personal settings saved.', 'SETTINGS');
    }

    async function toggleMyToolSwitch(tool, turnOn) {
        if (!isFullyAuthenticated()) {
            throwAuthError('TOKEN_INVALID');
        }

        if (!permitted(tool) || !toolIsVisible(tool)) {
            throw new Error('You do not have permission to enable this tool.');
        }

        const key = permissionKey(tool);
        const repository = state.user.repository;

        const previousSettings = state.settings;
        const toolsMap = {
            ...(state.settings.tools || {}),
            [key]: Boolean(turnOn)
        };

        const settings = {
            ...state.settings,
            owner: OWNER,
            repository,
            displayName: state.settings.displayName || state.user.name || CONFIG.userId,
            startPage: state.settings.startPage || 'overview',
            dashboardOpen: Boolean(state.settings.dashboardOpen),
            tools: toolsMap
        };

        try {
            await writePersonalSettings(
                settings,
                `${tool.name} turned ${turnOn ? 'ON' : 'OFF'}.`
            );
        } catch (err) {
            state.settings = previousSettings;
            render();
            throw err;
        }

        if (turnOn && matchesPage(tool)) {
            try {
                runTool(tool);
            } catch (error) {
                log(error.message, 'warning');
            }
        }

        render();
    }

    // =========================================================
    // SAVE TOOL PERMISSION (AUTHORITATIVE READ-MODIFY-WRITE)
    // =========================================================

    function resolveTrustedTool(toolOrKey) {
        if (!toolOrKey) return null;
        const targetKey = typeof toolOrKey === 'object'
            ? permissionKey(toolOrKey)
            : String(toolOrKey).trim();

        if (!targetKey) return null;

        return state.tools.find(
            item =>
                permissionKey(item).toUpperCase() === targetKey.toUpperCase() ||
                String(item.path || '').trim() === targetKey ||
                String(item.name || '').trim() === targetKey
        ) || null;
    }

    async function saveToolPermission(targetUserId, tool, changes) {
        // 1. Require full authentication.
        if (!isFullyAuthenticated()) {
            throwAuthError('TOKEN_INVALID');
        }

        // 8. Deny User permission-record changes.
        if (!isSuperAdmin() && !isAdmin()) {
            throw new Error('Access denied: Users cannot modify permission records.');
        }

        // 2. Verify that the target user exists.
        const targetId = normalizePermissionUserId(targetUserId);
        const targetUserObj = state.users.find(
            u => normalizePermissionUserId(u.id || u.userId || u.username) === targetId
        );

        if (!targetId || !targetUserObj) {
            throw new Error(`Target user "${targetUserId}" does not exist in the user registry.`);
        }

        // 3. Verify that the tool exists in the trusted manifest.
        const trustedTool = resolveTrustedTool(tool);
        if (!trustedTool) {
            throw new Error('Target tool does not exist in the trusted tools manifest.');
        }

        const toolKey = permissionKey(trustedTool);

        // 4 & 5. Accept only supported fields (granted, forcedState) and require boolean values.
        if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
            throw new Error('Invalid permission changes payload.');
        }

        const changeKeys = Object.keys(changes);
        if (changeKeys.length === 0) {
            throw new Error('No permission fields specified to update.');
        }

        const allowedFields = new Set(['granted', 'forcedState']);
        for (const field of changeKeys) {
            if (!allowedFields.has(field)) {
                throw new Error(`Unsupported permission field: "${field}".`);
            }
            if (typeof changes[field] !== 'boolean') {
                throw new Error(`Permission field "${field}" must be a boolean.`);
            }
        }

        // 6 & 7. Enforce role & scope rules for every requested field.
        for (const field of changeKeys) {
            if (!canEditToolPermission(trustedTool, targetId, field)) {
                if (field === 'forcedState') {
                    throw new Error('Only Super Admin can modify forcedState.');
                }
                if (isPermissionForced(trustedTool, targetId)) {
                    throw new Error('Cannot modify permission: Forced State is locked by Super Admin.');
                }
                throw new Error(`Admin scope denied for user ${targetId} and tool ${toolKey}.`);
            }
        }

        const repository = getPermissionsRepository();
        const path = getPermissionsPath();

        if (!repository || !path) {
            throw new Error('Authoritative permissions repository or path is not configured.');
        }

        const maxAttempts = 2;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // 13. Load the authoritative current configuration before saving.
            const currentFile = await fetchRepositoryJsonWithSha(
                repository,
                path,
                state.personalToken
            );

            const rawRoot =
                currentFile.data &&
                typeof currentFile.data === 'object' &&
                !Array.isArray(currentFile.data)
                    ? currentFile.data
                    : {};

            const hasUsersWrapper = Boolean(
                rawRoot.users &&
                typeof rawRoot.users === 'object' &&
                !Array.isArray(rawRoot.users)
            );

            const authoritativeUsersMap = getPermissions(rawRoot, state.tools);
            const authoritativeUserPerms = authoritativeUsersMap[targetId] || {};
            const authoritativeRecord = authoritativeUserPerms[toolKey] || {
                granted: false,
                forcedState: false,
                type: 'ADMIN'
            };

            // Re-validate against authoritative server record before writing (prevents stale UI bypass).
            if (!isSuperAdmin()) {
                if (Object.prototype.hasOwnProperty.call(changes, 'forcedState')) {
                    throw new Error('Only Super Admin can modify forcedState.');
                }
                if (authoritativeRecord.forcedState === true) {
                    state.permissions = authoritativeUsersMap;
                    render();
                    throw new Error(
                        'Permission update rejected: Forced State is currently active on the authoritative record.'
                    );
                }
                if (!canAdminManageUserTool(targetId, trustedTool)) {
                    throw new Error(`Admin scope denied for user ${targetId} and tool ${toolKey}.`);
                }
            }

            // 9, 10, 11, 12. Preserve all other users, tools, and unrelated metadata.
            const updatedRecord = {
                ...authoritativeRecord,
                granted: Object.prototype.hasOwnProperty.call(changes, 'granted')
                    ? changes.granted
                    : Boolean(authoritativeRecord.granted),
                forcedState: isSuperAdmin() && Object.prototype.hasOwnProperty.call(changes, 'forcedState')
                    ? changes.forcedState
                    : Boolean(authoritativeRecord.forcedState),
                type: isSuperAdmin() ? 'SUPER_ADMIN' : 'ADMIN'
            };

            delete updatedRecord.enabled;

            const nextUsersMap = {
                ...authoritativeUsersMap,
                [targetId]: {
                    ...authoritativeUserPerms,
                    [toolKey]: updatedRecord
                }
            };

            const payloadToWrite = hasUsersWrapper
                ? {
                    ...rawRoot,
                    users: nextUsersMap
                }
                : nextUsersMap;

            const summaryParts = changeKeys.map(k => `${k}=${changes[k]}`);
            const commitMsg = `Update permission ${targetId}/${toolKey} (${summaryParts.join(', ')})`;

            try {
                // 14. Handle GitHub SHA conflicts and concurrent writes.
                await putRepositoryJsonWithSha(
                    repository,
                    path,
                    state.personalToken,
                    payloadToWrite,
                    currentFile.sha,
                    commitMsg
                );

                // 15. Update local state ONLY after a successful save.
                state.permissions = nextUsersMap;
                state.permissionsRawWrapper = hasUsersWrapper;

                // 16. Display success feedback through the notification system.
                notifySuccess(
                    `Updated ${trustedTool.name} (${toolKey}) for ${targetId}: ${summaryParts.join(', ')}.`,
                    'PERMISSION SAVED'
                );

                return updatedRecord;
            } catch (writeErr) {
                lastError = writeErr;
                if (writeErr.isConflict && attempt < maxAttempts) {
                    log(
                        `SHA conflict detected while saving ${targetId}/${toolKey}; retrying with latest repository state...`,
                        'warning'
                    );
                    continue;
                }
                throw writeErr;
            }
        }

        throw lastError || new Error('Permission save failed.');
    }

    // =========================================================
    // SAVE VISIBILITY SETTINGS (CONSISTENT REPOSITORY & PATH)
    // =========================================================

    async function saveVisibilitySettings() {
        if (!canManageVisibility()) {
            throw new Error('Super Admin access required to modify visibility.');
        }

        const repository = getVisibilityRepository();
        const path = getVisibilityPath();

        if (!repository || !path) {
            throw new Error('Authoritative visibility repository or path is not configured.');
        }

        const currentFile = await fetchRepositoryJsonWithSha(
            repository,
            path,
            state.personalToken
        );

        const rawRoot =
            currentFile.data &&
            typeof currentFile.data === 'object' &&
            !Array.isArray(currentFile.data)
                ? currentFile.data
                : {};

        const existingVisibilityMap =
            rawRoot.visibility && typeof rawRoot.visibility === 'object'
                ? rawRoot.visibility
                : rawRoot.tools && typeof rawRoot.tools === 'object'
                    ? rawRoot.tools
                    : rawRoot;

        const newVisibility = {};

        // Preserve any unrelated tool records present in the authoritative file.
        for (const [key, value] of Object.entries(existingVisibilityMap)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                newVisibility[key] = { ...value };
            }
        }

        // Preserve any additional records in local state.visibility.
        for (const [key, value] of Object.entries(state.visibility)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                newVisibility[key] = {
                    ...(newVisibility[key] || {}),
                    ...value
                };
            }
        }

        const orderedTools = [...state.tools].sort((a, b) =>
            permissionKey(a).localeCompare(permissionKey(b))
        );

        for (const tool of orderedTools) {
            const key = permissionKey(tool);
            const record = ensureToolVisibilityRecord(key);
            const visValue = String(record.visibility || 'PRIVATE').trim().toUpperCase();
            const allowedUsers = Array.isArray(record.allowedUsers)
                ? record.allowedUsers
                    .map(s => normalizePermissionUserId(s))
                    .filter(Boolean)
                : [];

            newVisibility[key] = {
                ...(newVisibility[key] || {}),
                visibility: visValue,
                allowedUsers,
                developmentStatus: record.developmentStatus || 'UNDER DEVELOPMENT',
                publicationStatus: record.publicationStatus || 'NOT PUBLISHED',
                enabled: visValue !== 'PRIVATE'
            };
        }

        const payloadToWrite =
            rawRoot.visibility && typeof rawRoot.visibility === 'object'
                ? { ...rawRoot, visibility: newVisibility }
                : rawRoot.tools && typeof rawRoot.tools === 'object'
                    ? { ...rawRoot, tools: newVisibility }
                    : newVisibility;

        await putRepositoryJsonWithSha(
            repository,
            path,
            state.personalToken,
            payloadToWrite,
            currentFile.sha,
            'Update tool visibility configuration'
        );

        state.visibility = newVisibility;
        state.visibilityDirty = false;

        notifySuccess('Tool visibility configuration saved.', 'VISIBILITY SAVED');
    }

    // =========================================================
    // DASHBOARD UI & CLEAN MODERN DESIGN SYSTEM
    // =========================================================

    const style = document.createElement('style');

    style.textContent = `
        #yd-modal button,
        #yd-launcher {
            outline: none;
            border: 0;
            box-shadow: none;
            -webkit-tap-highlight-color: transparent;
        }
        #yd-modal button:focus,
        #yd-modal button:focus-visible,
        #yd-modal button:active,
        #yd-launcher:focus,
        #yd-launcher:focus-visible {
            outline: none !important;
            box-shadow: none !important;
        }
        #yd-launcher {
            position: fixed;
            right: 20px;
            bottom: 20px;
            z-index: 2147483000;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: ${PURPLE};
            color: #fff;
            border-radius: 999px;
            padding: 10px 16px;
            font: 700 12.5px system-ui, -apple-system, sans-serif;
            cursor: pointer;
            box-shadow: 0 6px 20px #00000029 !important;
            transition: background .15s;
        }
        #yd-launcher:hover {
            background: ${DARK};
        }
        #yd-overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483001;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 3vh 3vw;
            background: #17131c80;
            backdrop-filter: blur(2px);
        }
        #yd-overlay.open {
            display: flex;
        }
        #yd-modal {
            width: 100%;
            height: 100%;
            max-width: 1180px;
            max-height: 780px;
            background: ${LIGHT_BG};
            color: #29242e;
            border-radius: 14px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            font: 13px/1.45 system-ui, -apple-system, sans-serif;
            box-shadow: 0 20px 50px #00000038;
            border: 1px solid #e7e0ea;
        }
        #yd-modal * {
            box-sizing: border-box;
        }
        #yd-header {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            height: 54px;
            padding: 0 18px;
            background: #fff;
            border-bottom: 1px solid #e7e0ea;
            flex-shrink: 0;
        }
        .yd-brand {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }
        .yd-brand-logo {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            border-radius: 8px;
            background: ${PURPLE};
            color: #fff;
            flex-shrink: 0;
        }
        .yd-brand-title {
            font-size: 14.5px;
            font-weight: 800;
            color: #29242e;
            letter-spacing: .2px;
        }
        #yd-body {
            display: flex;
            flex: 1;
            min-height: 0;
        }
        #yd-sidebar {
            width: 195px;
            flex-shrink: 0;
            background: #fff;
            padding: 14px 10px;
            border-right: 1px solid #e7e0ea;
            overflow: auto;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        #yd-main {
            flex: 1;
            min-width: 0;
            overflow: auto;
            padding: 20px 24px;
        }
        .yd-nav {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            height: 36px;
            text-align: left;
            border: 0;
            border-radius: 8px;
            padding: 0 12px;
            background: transparent;
            color: #655c6a;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background .12s, color .12s;
        }
        .yd-nav:hover {
            background: ${LIGHT_BG};
            color: ${DARK};
        }
        .yd-nav.active {
            background: ${SOFT_BG};
            color: ${DARK};
            font-weight: 800;
        }
        .yd-nav-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            color: ${PURPLE};
            flex-shrink: 0;
        }
        .yd-title {
            font-size: 16px;
            font-weight: 800;
            color: #29242e;
            line-height: 1.25;
        }
        .yd-page-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 16px;
        }
        .yd-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 16px;
        }
        .yd-kpi-card {
            display: flex;
            align-items: center;
            gap: 12px;
            background: #fff;
            border: 1px solid #e7e0ea;
            border-radius: 12px;
            padding: 10px 14px;
            min-width: 0;
            box-shadow: 0 2px 6px #24152e06;
        }
        .yd-kpi-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: 9px;
            background: ${SOFT_BG};
            color: ${PURPLE};
            flex-shrink: 0;
        }
        .yd-kpi-icon.blue {
            background: #ebf5fb;
            color: #1f618d;
        }
        .yd-kpi-icon.green {
            background: #eafaf1;
            color: #1e8449;
        }
        .yd-kpi-icon.purple {
            background: ${SOFT_BG};
            color: ${PURPLE};
        }
        .yd-kpi-icon.amber {
            background: #fef9e7;
            color: #9a7d0a;
        }
        .yd-kpi-info {
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-width: 0;
        }
        .yd-kpi-label {
            font-size: 11.5px;
            font-weight: 600;
            color: #7c7482;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .yd-kpi-value {
            font-size: 17px;
            font-weight: 800;
            color: #29242e;
            line-height: 1.25;
            margin-top: 2px;
        }
        .yd-info-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
        }
        .yd-card {
            background: #fff;
            border: 1px solid #e7e0ea;
            border-radius: 12px;
            padding: 14px 16px;
            margin-bottom: 14px;
            min-width: 0;
            box-shadow: 0 2px 6px #24152e06;
        }
        .yd-card-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 800;
            color: #29242e;
            padding-bottom: 10px;
            margin-bottom: 6px;
            border-bottom: 1px solid #f2edf4;
        }
        .yd-clean-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            height: 36px;
            border-bottom: 1px solid #f6f2f8;
            font-size: 12.5px;
        }
        .yd-clean-row:last-child {
            border-bottom: 0;
        }
        .yd-clean-label {
            color: #7c7482;
            font-weight: 600;
        }
        .yd-clean-val {
            color: #29242e;
            font-weight: 700;
        }
        .yd-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            height: 30px;
            border: 1px solid #e2d8e6 !important;
            background: #fff;
            color: ${DARK};
            border-radius: 8px;
            padding: 0 12px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: background .15s, opacity .15s;
        }
        .yd-btn:hover {
            background: ${LIGHT_BG};
        }
        .yd-btn:disabled {
            opacity: .5;
            cursor: not-allowed;
        }
        .yd-primary {
            background: ${PURPLE};
            color: #fff;
            border-color: ${PURPLE} !important;
        }
        .yd-primary:hover {
            background: ${DARK};
        }
        .yd-btn-danger {
            background: #fdf0f0;
            color: #c0392b;
            border-color: #f5c2c9 !important;
        }
        .yd-btn-danger:hover {
            background: #fbe2e2;
        }
        .yd-row-actions {
            display: inline-flex;
            align-items: center;
            justify-content: flex-end;
            gap: 6px;
        }
        .yd-form-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
            margin-top: 10px;
        }
        .yd-form-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .yd-form-field .yd-input,
        .yd-form-field .yd-select {
            width: 100%;
        }
        .yd-form-field .yd-input[disabled] {
            background: #f3eff5;
            color: #7c7482;
            cursor: not-allowed;
        }
        .yd-form-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 14px;
            padding-top: 12px;
            border-top: 1px solid #f2edf4;
        }
        .yd-close-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            border-radius: 8px;
            border: 1px solid #e7e0ea !important;
            background: #fff;
            color: #655c6a;
            cursor: pointer;
            padding: 0;
            transition: background .15s, color .15s;
        }
        .yd-close-btn:hover {
            background: #fdf0f0;
            color: #c0392b;
            border-color: #f5c2c9 !important;
        }
        .yd-select,
        .yd-input {
            height: 32px;
            padding: 0 10px;
            border-radius: 8px;
            border: 1px solid #dfd5e3;
            background: #fff;
            color: #29242e;
            font: 600 12.5px system-ui, -apple-system, sans-serif;
            outline: none;
        }
        .yd-select:focus,
        .yd-input:focus {
            border-color: ${PURPLE};
        }

        /* =====================================================
            ODOO FADE PILLS & COMPACT BADGES
            ===================================================== */
        .yd-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            height: 22px;
            padding: 0 9px;
            background: ${SOFT_BG};
            color: ${DARK};
            border: 1px solid #e2d4df;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            white-space: nowrap;
        }
        .yd-pill-green {
            background: #eafaf1;
            color: #1e8449;
            border-color: #c8f0d8;
        }
        .yd-pill-red {
            background: #fdf0f0;
            color: #c0392b;
            border-color: #f7d4d4;
        }
        .yd-pill-blue {
            background: #ebf5fb;
            color: #1f618d;
            border-color: #cbe5f6;
        }
        .yd-pill-yellow {
            background: #fef9e7;
            color: #9a7d0a;
            border-color: #faeab1;
        }
        .yd-pill-purple {
            background: #f3ecf1;
            color: #68465f;
            border-color: #e2d4df;
        }
        .yd-id-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 22px;
            padding: 0 8px;
            background: #f3ecf1;
            color: ${DARK};
            border: 1px solid #e2d4df;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 700;
        }
        .yd-error {
            padding: 10px 14px;
            background: #fdf0f0;
            color: #c0392b;
            border: 1px solid #f7d4d4;
            border-radius: 8px;
            margin-bottom: 14px;
            font-size: 12px;
            font-weight: 600;
            overflow-wrap: anywhere;
        }
        .yd-error-title {
            font-weight: 800;
            font-size: 12.5px;
            margin-bottom: 2px;
        }
        .yd-notice {
            padding: 10px 14px;
            background: #eafaf1;
            color: #1e8449;
            border: 1px solid #c8f0d8;
            border-radius: 8px;
            margin-bottom: 14px;
            font-size: 12px;
            font-weight: 600;
            overflow-wrap: anywhere;
        }
        .yd-notice-title {
            font-weight: 800;
            font-size: 12.5px;
            margin-bottom: 2px;
        }
        .yd-empty {
            padding: 24px;
            text-align: center;
            color: #8c8492;
            font-size: 12.5px;
        }

        /* =====================================================
            HEADER STATUS & COMPACT PROFILE BUTTON
            ===================================================== */
        .yd-header-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
        }
        .yd-header-status {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            height: 30px;
            padding: 0 12px;
            background: #f8f5f7;
            border: 1px solid #e7e0ea;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            color: #68465f;
        }
        .yd-header-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #c94b58;
        }
        .yd-profile-wrap {
            position: relative;
            display: inline-flex;
            align-items: center;
        }
        .yd-gb-btn {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            padding: 1.5px;
            border: 0;
            border-radius: 50%;
            background: conic-gradient(#875A7B, #68465f, #b48aa8, #875A7B);
            cursor: pointer;
        }
        .yd-gb-avatar {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: ${PURPLE};
            color: #fff;
            border: 1px solid #fff;
            font-size: 12px;
            font-weight: 800;
            user-select: none;
        }
        .yd-gb-badge {
            position: absolute;
            right: -2px;
            bottom: -2px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #fff;
            padding: 1px;
        }
        .yd-profile-menu {
            position: absolute;
            top: calc(100% + 10px);
            right: 0;
            z-index: 2147483005;
            width: 290px;
            padding: 14px;
            background: ${LIGHT_BG};
            border: 1px solid #e2d9e5;
            border-radius: 16px;
            box-shadow: 0 14px 36px #24152e26;
        }
        .yd-profile-menu[hidden] {
            display: none !important;
        }
        .yd-gb-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            padding: 14px 12px;
            background: #fff;
            border: 1px solid #eee8f0;
            border-radius: 12px;
            margin-bottom: 8px;
        }
        .yd-gb-ring-lg {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 48px;
            height: 48px;
            padding: 1.5px;
            border-radius: 50%;
            background: conic-gradient(${PURPLE}, ${DARK}, #b48aa8, ${PURPLE});
            margin-bottom: 8px;
        }
        .yd-gb-avatar-lg {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: ${PURPLE};
            color: #fff;
            border: 1.5px solid #fff;
            font-size: 18px;
            font-weight: 800;
        }
        .yd-gb-name {
            font-size: 13.5px;
            font-weight: 800;
            color: #29242e;
        }
        .yd-gb-meta {
            font-size: 11px;
            color: #8c8492;
            margin-top: 2px;
        }
        .yd-gb-pills {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            margin-top: 8px;
            flex-wrap: wrap;
        }
        .yd-dropdown-action {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 8px 10px;
            border-radius: 10px;
            background: #fff;
            color: #29242e;
            cursor: pointer;
            text-align: left;
            font: inherit;
            margin-top: 6px;
            border: 1px solid #eee8f0 !important;
            transition: background .12s;
        }
        .yd-dropdown-action:hover {
            background: ${SOFT_BG};
        }
        .yd-action-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            flex-shrink: 0;
            border-radius: 7px;
            background: ${SOFT_BG};
            color: ${PURPLE};
        }
        .yd-dropdown-action b {
            display: block;
            font-size: 12px;
        }

        /* =====================================================
            SLIM MODERN TABLE
            ===================================================== */
        .yd-table-card {
            background: #fff;
            border: 1px solid #e7e0ea;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 6px #24152e06;
            margin-bottom: 14px;
        }
        .yd-table-card-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            min-height: 44px;
            padding: 8px 14px;
            background: #fff;
            border-bottom: 1px solid #eee8f0;
            flex-wrap: wrap;
        }
        .yd-table-card-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13.5px;
            font-weight: 800;
            color: #29242e;
        }
        .yd-table-pills {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .yd-table-responsive {
            width: 100%;
            overflow-x: auto;
        }
        .yd-table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 13px;
        }
        .yd-table thead tr {
            border-bottom: 1px solid #e7e0ea;
        }
        .yd-table thead th {
            height: 38px;
            padding: 0 12px;
            background: #faf8fa;
            color: #655c6a;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
            vertical-align: middle;
        }
        .yd-table tbody tr {
            height: 42px;
            border-bottom: 1px solid #f1ecf3;
            transition: background .12s;
        }
        .yd-table tbody tr:last-child {
            border-bottom: 0;
        }
        .yd-table tbody tr:hover {
            background: #f9f6f9;
        }
        .yd-table tbody td,
        .yd-table tbody th {
            padding: 6px 12px;
            vertical-align: middle;
            white-space: nowrap;
        }
        .yd-tool-name {
            font-size: 13px;
            font-weight: 600;
            color: #29242e;
        }

        /* =====================================================
            ACCESS LOCK / UNLOCK ICON WITH HOVER TOOLTIP
            ===================================================== */
        .yd-access-badge {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border-radius: 7px;
            cursor: help;
        }
        .yd-access-badge.unlocked {
            background: #eafaf1;
            color: #1e8449;
            border: 1px solid #c8f0d8;
        }
        .yd-access-badge.locked {
            background: #fdf0f0;
            color: #c0392b;
            border: 1px solid #f7d4d4;
        }
        .yd-tooltip {
            position: absolute;
            bottom: calc(100% + 7px);
            left: 50%;
            transform: translateX(-50%) translateY(3px);
            padding: 5px 10px;
            background: #29242e;
            color: #fff;
            font-size: 11px;
            font-weight: 600;
            border-radius: 6px;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            visibility: hidden;
            box-shadow: 0 6px 16px #0000002e;
            transition: opacity .14s, transform .14s, visibility .14s;
            z-index: 20;
        }
        .yd-tooltip::after {
            content: "";
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            border-width: 4px;
            border-style: solid;
            border-color: #29242e transparent transparent transparent;
        }
        .yd-access-badge:hover .yd-tooltip {
            opacity: 1;
            visibility: visible;
            transform: translateX(-50%) translateY(0);
        }

        /* =====================================================
            COMPACT SWITCH CONTROL
            ===================================================== */
        .yd-switch-wrap {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .yd-switch {
            position: relative;
            width: 38px;
            height: 20px;
            border: 0;
            border-radius: 999px;
            background: #d5cbd8;
            cursor: pointer;
            padding: 2px;
            transition: background .18s, opacity .18s;
            flex-shrink: 0;
        }
        .yd-switch.on {
            background: #287a4b;
        }
        .yd-switch:disabled {
            opacity: .4;
            cursor: not-allowed;
        }
        .yd-switch-knob {
            display: block;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 3px #0003;
            transition: transform .18s;
            transform: translateX(0);
        }
        .yd-switch.on .yd-switch-knob {
            transform: translateX(18px);
        }
        .yd-switch-state {
            font-size: 11px;
            font-weight: 700;
            min-width: 24px;
            color: #655c6a;
        }

        @media (max-width: 850px) {
            .yd-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .yd-info-grid,
            .yd-form-grid {
                grid-template-columns: 1fr;
            }
            #yd-sidebar {
                width: 155px;
            }
            #yd-main {
                padding: 14px;
            }
        }
    `;

    document.head.appendChild(style);

    const launcher = document.createElement('button');
    launcher.id = 'yd-launcher';
    launcher.type = 'button';
    launcher.innerHTML = `${ICONS.brand}<span>YODAWY DASHBOARD</span>`;

    const overlay = document.createElement('div');
    overlay.id = 'yd-overlay';

    overlay.innerHTML = `
        <div id="yd-modal" role="dialog" aria-modal="true">
            <header id="yd-header">
                <div class="yd-brand">
                    <div class="yd-brand-logo">${ICONS.brand}</div>
                    <div class="yd-brand-title" id="yd-brand-title">YODAWY DASHBOARD</div>
                </div>

                <div class="yd-header-actions">
                    <div class="yd-header-status">
                        <span id="yd-header-dot" class="yd-header-dot"></span>
                        <span id="yd-status">unConnected</span>
                    </div>

                    <div class="yd-profile-wrap">
                        <button
                            id="yd-profile-trigger"
                            class="yd-gb-btn"
                            data-action="profile-toggle"
                            aria-expanded="false"
                            aria-controls="yd-profile-menu"
                            aria-label="Account"
                            type="button"
                        >
                            <span class="yd-gb-avatar" id="yd-profile-avatar">?</span>
                            <span class="yd-gb-badge" id="yd-profile-badge">${ICONS.alertBadge}</span>
                        </button>

                        <div id="yd-profile-menu" class="yd-profile-menu" hidden>
                            <div class="yd-gb-card">
                                <div class="yd-gb-ring-lg">
                                    <div class="yd-gb-avatar-lg" id="yd-profile-avatar-lg">?</div>
                                </div>
                                <div id="yd-profile-name" class="yd-gb-name">Not Authenticated</div>
                                <div id="yd-profile-id" class="yd-gb-meta">ID: —</div>
                                <div class="yd-gb-pills">
                                    <span id="yd-profile-role" class="yd-pill yd-pill-red">Unverified</span>
                                    <span id="yd-profile-connection" class="yd-pill yd-pill-red">unConnected</span>
                                </div>
                            </div>

                            <button class="yd-dropdown-action" data-action="refresh-connection" type="button">
                                <span class="yd-action-icon">${ICONS.sync}</span>
                                <span><b>Refresh Connection</b></span>
                            </button>

                            <button class="yd-dropdown-action" data-action="refresh-tools" type="button">
                                <span class="yd-action-icon">${ICONS.tools}</span>
                                <span><b>Refresh Tools</b></span>
                            </button>
                        </div>
                    </div>

                    <button class="yd-close-btn" data-action="close" type="button" title="Close">
                        ${ICONS.close}
                    </button>
                </div>
            </header>

            <div id="yd-body">
                <aside id="yd-sidebar"></aside>
                <main id="yd-main"></main>
            </div>
        </div>
    `;

    launcher.style.display = 'none';

    document.body.append(launcher, overlay);

    function header(title, action = '') {
        return `
            <div class="yd-page-head">
                <div class="yd-title">${esc(title)}</div>
                ${action}
            </div>
        `;
    }

    function button(label, action, primary = false, iconSvg = '') {
        return `
            <button class="yd-btn ${primary ? 'yd-primary' : ''}" data-action="${esc(action)}" type="button">
                ${iconSvg}
                <span>${esc(label)}</span>
            </button>
        `;
    }

    function renderErrorBox() {
        let html = '';
        if (state.error) {
            html += `
                <div class="yd-error">
                    ${state.errorTitle ? `<div class="yd-error-title">${esc(state.errorTitle)}</div>` : ''}
                    <div>${esc(state.error)}</div>
                </div>
            `;
        }
        if (state.notice) {
            html += `
                <div class="yd-notice">
                    ${state.noticeTitle ? `<div class="yd-notice-title">${esc(state.noticeTitle)}</div>` : ''}
                    <div>${esc(state.notice)}</div>
                </div>
            `;
        }
        return html;
    }

    function renderSwitch({ isOn, action, disabled = false, title = '' }) {
        return `
            <div class="yd-switch-wrap" title="${esc(title)}">
                <button
                    class="yd-switch ${isOn ? 'on' : ''}"
                    type="button"
                    role="switch"
                    aria-checked="${isOn ? 'true' : 'false'}"
                    ${disabled ? 'disabled' : `data-action="${esc(action)}"`}
                >
                    <span class="yd-switch-knob"></span>
                </button>
                <span class="yd-switch-state">${isOn ? 'ON' : 'OFF'}</span>
            </div>
        `;
    }

    function renderAccessIcon(allowed, tooltipText = '') {
        if (allowed) {
            return `
                <div class="yd-access-badge unlocked" aria-label="Permitted">
                    ${ICONS.unlocked}
                    <span class="yd-tooltip">${esc(tooltipText || 'Permitted')}</span>
                </div>
            `;
        }

        return `
            <div class="yd-access-badge locked" aria-label="Permission required">
                ${ICONS.lock}
                <span class="yd-tooltip">${esc(tooltipText || 'Permission required to enable this tool')}</span>
            </div>
        `;
    }

    function kpiCard({ icon, colorClass = 'purple', label, value }) {
        return `
            <div class="yd-kpi-card">
                <div class="yd-kpi-icon ${esc(colorClass)}">${icon}</div>
                <div class="yd-kpi-info">
                    <div class="yd-kpi-label">${esc(label)}</div>
                    <div class="yd-kpi-value">${esc(value)}</div>
                </div>
            </div>
        `;
    }

    // =========================================================
    // OVERVIEW PAGE
    // =========================================================

    function overviewPage() {
        const isConnected = isFullyAuthenticated();
        const visibleTools = isConnected ? state.tools.filter(toolIsVisible) : [];
        const permittedTools = visibleTools.filter(permitted);
        const enabledTools = permittedTools.filter(isToolEnabledByUser);

        const userName = isConnected
            ? (state.settings.displayName || state.user?.name || CONFIG.userId)
            : 'Not Authenticated';
        const userRole = isConnected
            ? formatRoleLabel(state.user?.role)
            : 'Unverified';
        const userStatus = isConnected
            ? (state.user?.status || 'Active')
            : 'unConnected';

        return header(
            'Overview',
            button('Sync', 'sync', true, ICONS.sync)
        ) +
        `<div class="yd-grid">
            ${kpiCard({
                icon: ICONS.tools,
                colorClass: 'blue',
                label: 'Tools',
                value: visibleTools.length
            })}
            ${kpiCard({
                icon: ICONS.unlocked,
                colorClass: 'green',
                label: 'Permitted',
                value: permittedTools.length
            })}
            ${kpiCard({
                icon: ICONS.bolt,
                colorClass: 'purple',
                label: 'Active (ON)',
                value: enabledTools.length
            })}
            ${kpiCard({
                icon: ICONS.cloud,
                colorClass: isConnected ? 'green' : 'amber',
                label: 'Status',
                value: isConnected ? 'Connected' : 'unConnected'
            })}
        </div>

        <div class="yd-info-grid">
            <div class="yd-card">
                <div class="yd-card-title">
                    ${ICONS.user}
                    <span>Account</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">Name</span>
                    <span class="yd-clean-val">${esc(userName)}</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">User ID</span>
                    <span class="yd-id-badge">${esc(CONFIG.userId || '—')}</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">Role</span>
                    <span class="yd-pill ${isConnected ? rolePillClass(userRole) : 'yd-pill-red'}">${esc(userRole)}</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">Account Status</span>
                    <span class="yd-pill ${isConnected && String(userStatus).toLowerCase() === 'active' ? 'yd-pill-green' : 'yd-pill-red'}">${esc(userStatus)}</span>
                </div>
            </div>

            <div class="yd-card">
                <div class="yd-card-title">
                    ${ICONS.cloud}
                    <span>Connection</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">System</span>
                    <span class="yd-pill ${isConnected ? 'yd-pill-green' : 'yd-pill-red'}">${isConnected ? 'Connected to system' : 'unConnected'}</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">Personal Settings</span>
                    <span class="yd-pill ${isConnected ? 'yd-pill-green' : 'yd-pill-red'}">${isConnected ? 'Connected' : 'unConnected'}</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">Tools Sync</span>
                    <span class="yd-pill ${isConnected && state.tools.length ? 'yd-pill-blue' : 'yd-pill-yellow'}">${isConnected && state.tools.length ? 'Ready' : 'No tools'}</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">Current Site</span>
                    <span class="yd-pill yd-pill-purple">${esc(location.hostname)}</span>
                </div>
            </div>
        </div>`;
    }

    // =========================================================
    // TOOLS PAGE
    // =========================================================

    function toolsPage() {
        const tools = state.tools.filter(toolIsVisible);
        const permittedCount = tools.filter(permitted).length;
        const onCount = tools.filter(t => permitted(t) && isToolEnabledByUser(t)).length;

        return header(
            'Tools',
            button('Reload', 'sync', true, ICONS.sync)
        ) +
        `<div class="yd-table-card">
            <div class="yd-table-card-head">
                <div class="yd-table-card-title">
                    ${ICONS.tools}
                    <span>Tools (${tools.length})</span>
                </div>
                <div class="yd-table-pills">
                    <span class="yd-pill yd-pill-blue">${permittedCount} Permitted</span>
                    <span class="yd-pill yd-pill-green">${onCount} ON</span>
                </div>
            </div>
            <div class="yd-table-responsive">
                <table class="yd-table">
                    <thead>
                        <tr>
                            <th scope="col" style="width:50px">#</th>
                            <th scope="col" style="width:120px">ID</th>
                            <th scope="col">Tool</th>
                            <th scope="col" style="width:90px;text-align:center">Access</th>
                            <th scope="col" style="width:120px;text-align:right">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tools.map((tool, index) => {
                            const key = permissionKey(tool);
                            const allowed = permitted(tool);
                            const enabledByUser = allowed && isToolEnabledByUser(tool);

                            const toggleControl = renderSwitch({
                                isOn: enabledByUser,
                                action: `toggle-my-tool:${key}`,
                                disabled: !allowed,
                                title: allowed
                                    ? `Turn ${tool.name} ${enabledByUser ? 'OFF' : 'ON'}`
                                    : 'Permission required to enable this tool'
                            });

                            return `
                                <tr>
                                    <th scope="row">${index + 1}</th>
                                    <td>
                                        <span class="yd-id-badge">${esc(key)}</span>
                                    </td>
                                    <td>
                                        <div class="yd-tool-name">${esc(tool.name)}</div>
                                    </td>
                                    <td style="text-align:center">
                                        ${renderAccessIcon(allowed)}
                                    </td>
                                    <td style="text-align:right">
                                        ${toggleControl}
                                    </td>
                                </tr>
                            `;
                        }).join('') || `
                            <tr>
                                <td colspan="5" class="yd-empty">No tools available.</td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    // =========================================================
    // PERMISSION MANAGEMENT UI (INTEGRATED IN USERS & SHARED TOOLS)
    // =========================================================

    function renderPermissionManagementTable(targetUserId) {
        const targetId = normalizePermissionUserId(targetUserId);
        const targetUser = state.users.find(
            u => normalizePermissionUserId(u.id || u.userId || u.username) === targetId
        );

        if (!targetId || !targetUser) {
            return `<div class="yd-empty">Select a valid user to manage tool permissions.</div>`;
        }

        const tools = state.tools;
        const targetRole = formatRoleLabel(targetUser.role);

        return `
            <div class="yd-table-responsive">
                <table class="yd-table">
                    <thead>
                        <tr>
                            <th scope="col" style="width:46px">#</th>
                            <th scope="col" style="width:120px">Tool ID</th>
                            <th scope="col">Tool Name</th>
                            <th scope="col" style="width:170px">Edit Lock / Scope</th>
                            <th scope="col" style="width:130px;text-align:center">Forced State</th>
                            <th scope="col" style="width:130px;text-align:right">Granted</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tools.map((tool, index) => {
                            const key = permissionKey(tool);
                            const record = getToolPermissionRecord(tool, targetId);
                            const isGranted = record.granted === true;
                            const isForced = record.forcedState === true;

                            const canEditGranted = canEditToolPermission(tool, targetId, 'granted');
                            const canEditForced = canEditToolPermission(tool, targetId, 'forcedState');

                            const isSavingGranted =
                                state.permissionSavingKey === `${targetId}:${key}:granted`;
                            const isSavingForced =
                                state.permissionSavingKey === `${targetId}:${key}:forcedState`;

                            let lockBadgeHtml = '';
                            if (isSuperAdmin()) {
                                lockBadgeHtml = `<span class="yd-pill yd-pill-blue">Super Admin (Full Edit)</span>`;
                            } else if (isForced) {
                                lockBadgeHtml = `<span class="yd-pill yd-pill-red">Locked (Forced State ON)</span>`;
                            } else if (!canEditGranted) {
                                lockBadgeHtml = `<span class="yd-pill yd-pill-yellow">Locked (Out of Scope)</span>`;
                            } else {
                                lockBadgeHtml = `<span class="yd-pill yd-pill-green">Authorized (${esc(targetRole)})</span>`;
                            }

                            const forcedSwitch = renderSwitch({
                                isOn: isForced,
                                action: `toggle-perm-forced:${targetId}:${key}`,
                                disabled: !canEditForced || Boolean(state.permissionSavingKey),
                                title: canEditForced
                                    ? `Set Forced State ${isForced ? 'OFF' : 'ON'} for ${targetId}`
                                    : 'Only Super Admin can change Forced State'
                            });

                            const grantedSwitch = renderSwitch({
                                isOn: isGranted,
                                action: `toggle-perm-granted:${targetId}:${key}`,
                                disabled: !canEditGranted || Boolean(state.permissionSavingKey),
                                title: canEditGranted
                                    ? `Set Granted ${isGranted ? 'OFF' : 'ON'} for ${targetId}`
                                    : isForced
                                        ? 'Editing locked because Forced State is ON'
                                        : 'You are not authorized to edit this user/tool permission'
                            });

                            return `
                                <tr>
                                    <th scope="row">${index + 1}</th>
                                    <td><span class="yd-id-badge">${esc(key)}</span></td>
                                    <td><div class="yd-tool-name">${esc(tool.name)}</div></td>
                                    <td>${lockBadgeHtml}</td>
                                    <td style="text-align:center">
                                        ${isSavingForced ? '<span class="yd-pill yd-pill-purple">Saving…</span>' : forcedSwitch}
                                    </td>
                                    <td style="text-align:right">
                                        ${isSavingGranted ? '<span class="yd-pill yd-pill-purple">Saving…</span>' : grantedSwitch}
                                    </td>
                                </tr>
                            `;
                        }).join('') || `
                            <tr>
                                <td colspan="6" class="yd-empty">No tools loaded in manifest.</td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderUserManagementForm() {
        if (!isSuperAdmin() || !state.userFormOpen) {
            return '';
        }

        const isEditing = Boolean(state.userFormId);
        const existingUser = isEditing
            ? state.users.find(
                u => normalizePermissionUserId(u.id || u.userId || u.username) === state.userFormId
            )
            : null;

        const draft = state.userFormDraft || {
            id: isEditing ? state.userFormId : '',
            name: existingUser ? String(existingUser.name || '').trim() : '',
            repository: existingUser
                ? String(
                    existingUser.repository ||
                    existingUser.personalRepository ||
                    existingUser.personal_repository ||
                    ''
                ).trim()
                : '',
            role: existingUser ? formatRoleLabel(existingUser.role) : 'User',
            status: existingUser && String(existingUser.status || '').trim().toLowerCase() === 'inactive'
                ? 'Inactive'
                : 'Active'
        };

        const roleValue = formatRoleLabel(draft.role);
        const statusValue = String(draft.status || 'Active').trim().toLowerCase() === 'inactive'
            ? 'Inactive'
            : 'Active';

        return `
            <div class="yd-card">
                <div class="yd-card-title">
                    ${ICONS.user}
                    <span>${isEditing ? `Edit Employee (${esc(state.userFormId)})` : 'Add New Employee'}</span>
                </div>
                <div class="yd-form-grid">
                    <div class="yd-form-field">
                        <label class="yd-clean-label" for="yd-user-id">User ID</label>
                        <input
                            id="yd-user-id"
                            class="yd-input"
                            type="text"
                            value="${esc(isEditing ? state.userFormId : draft.id)}"
                            placeholder="e.g. Q-002"
                            ${isEditing || state.userSaving ? 'readonly disabled' : ''}
                        />
                    </div>
                    <div class="yd-form-field">
                        <label class="yd-clean-label" for="yd-user-name">Employee Name</label>
                        <input
                            id="yd-user-name"
                            class="yd-input"
                            type="text"
                            value="${esc(draft.name)}"
                            placeholder="e.g. MOHAMED SALEH"
                            ${state.userSaving ? 'disabled' : ''}
                        />
                    </div>
                    <div class="yd-form-field">
                        <label class="yd-clean-label" for="yd-user-repository">Personal Repository</label>
                        <input
                            id="yd-user-repository"
                            class="yd-input"
                            type="text"
                            value="${esc(draft.repository)}"
                            placeholder="e.g. Q-002_EMPLOYEE_NAME"
                            ${state.userSaving ? 'disabled' : ''}
                        />
                    </div>
                    <div class="yd-form-field">
                        <label class="yd-clean-label" for="yd-user-role">Role</label>
                        <select id="yd-user-role" class="yd-select" ${state.userSaving ? 'disabled' : ''}>
                            <option value="User" ${roleValue === 'User' ? 'selected' : ''}>User</option>
                            <option value="Admin" ${roleValue === 'Admin' ? 'selected' : ''}>Admin</option>
                            <option value="Super Admin" ${roleValue === 'Super Admin' ? 'selected' : ''}>Super Admin</option>
                        </select>
                    </div>
                    <div class="yd-form-field">
                        <label class="yd-clean-label" for="yd-user-status">Status</label>
                        <select id="yd-user-status" class="yd-select" ${state.userSaving ? 'disabled' : ''}>
                            <option value="Active" ${statusValue === 'Active' ? 'selected' : ''}>Active</option>
                            <option value="Inactive" ${statusValue === 'Inactive' ? 'selected' : ''}>Inactive</option>
                        </select>
                    </div>
                </div>
                <div class="yd-form-actions">
                    <button
                        class="yd-btn"
                        data-action="cancel-user-form"
                        type="button"
                        ${state.userSaving ? 'disabled' : ''}
                    >
                        <span>Cancel</span>
                    </button>
                    <button
                        class="yd-btn yd-primary"
                        data-action="save-registry-user"
                        type="button"
                        ${state.userSaving ? 'disabled' : ''}
                    >
                        ${ICONS.cloud}
                        <span>${state.userSaving ? 'Saving…' : 'Save Employee'}</span>
                    </button>
                </div>
            </div>
        `;
    }

    function usersPage() {
        if (!canManage()) return deniedPage();

        const usersList = state.users;
        if (!state.permissionsSelectedUser && usersList.length > 0) {
            state.permissionsSelectedUser = normalizePermissionUserId(
                usersList[0].id || usersList[0].userId || usersList[0].username
            );
        }

        const selectedUid = normalizePermissionUserId(state.permissionsSelectedUser);
        const superAdminView = isSuperAdmin();
        const currentUserId = getAuthenticatedUserId();

        const topActions = `
            <div class="yd-table-pills">
                ${superAdminView ? button('Add User', 'open-add-user-form', true, ICONS.plus) : ''}
                ${button('Reload', 'sync', !superAdminView, ICONS.sync)}
            </div>
        `;

        return header(
            'Users & Permissions',
            topActions
        ) +
        renderUserManagementForm() +
        `<div class="yd-table-card">
            <div class="yd-table-card-head">
                <div class="yd-table-card-title">
                    ${ICONS.user}
                    <span>Registered Users (${usersList.length})</span>
                </div>
                ${superAdminView ? `
                    <div class="yd-table-pills">
                        <span class="yd-pill yd-pill-blue">Registry: ${esc(getUserRegistryPath())}</span>
                    </div>
                ` : ''}
            </div>
            <div class="yd-table-responsive">
                <table class="yd-table">
                    <thead>
                        <tr>
                            <th scope="col" style="width:50px">#</th>
                            <th scope="col" style="width:120px">User ID</th>
                            <th scope="col">Name</th>
                            <th scope="col" style="width:210px">Repository</th>
                            <th scope="col" style="width:130px">Role</th>
                            <th scope="col" style="width:110px">Status</th>
                            <th scope="col" style="width:140px;text-align:right">Permissions</th>
                            ${superAdminView ? '<th scope="col" style="width:165px;text-align:right">Actions</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${usersList.map((u, idx) => {
                            const uid = normalizePermissionUserId(u.id || u.userId || u.username);
                            const repoName = String(
                                u.repository ||
                                u.personalRepository ||
                                u.personal_repository ||
                                '—'
                            ).trim();
                            const roleLabel = formatRoleLabel(u.role);
                            const isActive = String(u.status || '').toLowerCase() === 'active';
                            const isSelected = uid === selectedUid;
                            const isRowSaving = state.userSaving && state.userSavingTargetId === uid;
                            const isSelf = uid === currentUserId;
                            const isTargetSuperAdmin = normalizeRole(u.role) === 'SUPER_ADMIN';

                            return `
                                <tr>
                                    <th scope="row">${idx + 1}</th>
                                    <td><span class="yd-id-badge">${esc(uid)}</span></td>
                                    <td><div class="yd-tool-name">${esc(u.name || uid)}</div></td>
                                    <td><span class="yd-id-badge">${esc(repoName)}</span></td>
                                    <td><span class="yd-pill ${rolePillClass(roleLabel)}">${esc(roleLabel)}</span></td>
                                    <td><span class="yd-pill ${isActive ? 'yd-pill-green' : 'yd-pill-red'}">${esc(u.status || 'Unknown')}</span></td>
                                    <td style="text-align:right">
                                        <button
                                            class="yd-btn ${isSelected ? 'yd-primary' : ''}"
                                            data-action="select-perm-user:${esc(uid)}"
                                            type="button"
                                        >
                                            <span>${isSelected ? 'Managing' : 'Manage'}</span>
                                        </button>
                                    </td>
                                    ${superAdminView ? `
                                        <td style="text-align:right">
                                            ${isRowSaving ? '<span class="yd-pill yd-pill-purple">Saving…</span>' : `
                                                <div class="yd-row-actions">
                                                    <button
                                                        class="yd-btn"
                                                        data-action="edit-registry-user:${esc(uid)}"
                                                        type="button"
                                                        ${state.userSaving ? 'disabled' : ''}
                                                        title="Edit ${esc(uid)}"
                                                    >
                                                        ${ICONS.edit}
                                                        <span>Edit</span>
                                                    </button>
                                                    <button
                                                        class="yd-btn yd-btn-danger"
                                                        data-action="delete-registry-user:${esc(uid)}"
                                                        type="button"
                                                        ${state.userSaving ? 'disabled' : ''}
                                                        title="${esc(
                                                            isSelf
                                                                ? 'Cannot delete signed-in account'
                                                                : isTargetSuperAdmin
                                                                    ? 'Super Admin deletion is blocked'
                                                                    : `Delete ${uid}`
                                                        )}"
                                                    >
                                                        ${ICONS.trash}
                                                        <span>Delete</span>
                                                    </button>
                                                </div>
                                            `}
                                        </td>
                                    ` : ''}
                                </tr>
                            `;
                        }).join('') || `
                            <tr>
                                <td colspan="${superAdminView ? 8 : 7}" class="yd-empty">No users found.</td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="yd-table-card">
            <div class="yd-table-card-head">
                <div class="yd-table-card-title">
                    ${ICONS.lock}
                    <span>Tool Permissions — User: ${esc(selectedUid || 'None')}</span>
                </div>
                <div class="yd-table-pills">
                    <label for="yd-perm-user-filter" class="yd-clean-label">Target User:</label>
                    <select id="yd-perm-user-filter" class="yd-select">
                        ${usersList.map(u => {
                            const uid = normalizePermissionUserId(u.id || u.userId || u.username);
                            return `<option value="${esc(uid)}" ${uid === selectedUid ? 'selected' : ''}>${esc(uid)} — ${esc(u.name || uid)} (${esc(formatRoleLabel(u.role))})</option>`;
                        }).join('')}
                    </select>
                </div>
            </div>
            ${renderPermissionManagementTable(selectedUid)}
        </div>`;
    }

    function sharedPage() {
        if (!canManage()) return deniedPage();

        const usersList = state.users;
        if (!state.permissionsSelectedUser && usersList.length > 0) {
            state.permissionsSelectedUser = normalizePermissionUserId(
                usersList[0].id || usersList[0].userId || usersList[0].username
            );
        }

        const selectedUid = normalizePermissionUserId(state.permissionsSelectedUser);

        return header(
            'Shared Tools & Permission Matrix',
            button('Reload', 'sync', true, ICONS.sync)
        ) +
        `<div class="yd-table-card">
            <div class="yd-table-card-head">
                <div class="yd-table-card-title">
                    ${ICONS.tools}
                    <span>Permission Management (${esc(selectedUid || 'None')})</span>
                </div>
                <div class="yd-table-pills">
                    <label for="yd-perm-user-filter" class="yd-clean-label">User:</label>
                    <select id="yd-perm-user-filter" class="yd-select">
                        ${usersList.map(u => {
                            const uid = normalizePermissionUserId(u.id || u.userId || u.username);
                            return `<option value="${esc(uid)}" ${uid === selectedUid ? 'selected' : ''}>${esc(uid)} — ${esc(u.name || uid)}</option>`;
                        }).join('')}
                    </select>
                </div>
            </div>
            ${renderPermissionManagementTable(selectedUid)}
        </div>`;
    }

    // =========================================================
    // VISIBILITY PAGE (SUPER ADMIN ONLY)
    // =========================================================

    function visibilityPage() {
        if (!canManageVisibility()) return deniedPage();

        const nonSuperUsers = state.users.filter(u => normalizeRole(u.role) !== 'SUPER_ADMIN');
        const selectedUser = state.visibilitySelectedUser || 'ALL';

        return header(
            'Visibility',
            button(
                state.visibilityDirty ? 'Save Visibility *' : 'Save Visibility',
                'save-visibility',
                true,
                ICONS.cloud
            )
        ) +
        `<div class="yd-table-card">
            <div class="yd-table-card-head">
                <div class="yd-table-card-title">
                    ${ICONS.lock}
                    <span>Global Tool Visibility (${state.tools.length})</span>
                </div>
                <div class="yd-table-pills">
                    <label for="yd-vis-user-filter" class="yd-clean-label">Inspect User:</label>
                    <select id="yd-vis-user-filter" class="yd-select">
                        <option value="ALL" ${selectedUser === 'ALL' ? 'selected' : ''}>All Users</option>
                        ${nonSuperUsers.map(u => {
                            const uid = normalizePermissionUserId(u.id || u.userId || u.username);
                            return `<option value="${esc(uid)}" ${selectedUser === uid ? 'selected' : ''}>${esc(uid)} — ${esc(u.name || uid)}</option>`;
                        }).join('')}
                    </select>
                </div>
            </div>
            <div class="yd-table-responsive">
                <table class="yd-table">
                    <thead>
                        <tr>
                            <th scope="col" style="width:50px">#</th>
                            <th scope="col" style="width:120px">Tool ID</th>
                            <th scope="col">Tool</th>
                            <th scope="col" style="width:180px">Policy Mode</th>
                            <th scope="col" style="width:160px">Allowed Users</th>
                            ${selectedUser !== 'ALL' ? `<th scope="col" style="width:140px;text-align:right">Visible to ${esc(selectedUser)}</th>` : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${state.tools.map((tool, index) => {
                            const key = permissionKey(tool);
                            const record = ensureToolVisibilityRecord(key);
                            const mode = String(record.visibility || 'PRIVATE').toUpperCase();
                            const allowedList = Array.isArray(record.allowedUsers) ? record.allowedUsers : [];

                            return `
                                <tr>
                                    <th scope="row">${index + 1}</th>
                                    <td><span class="yd-id-badge">${esc(key)}</span></td>
                                    <td><div class="yd-tool-name">${esc(tool.name)}</div></td>
                                    <td>
                                        <select class="yd-select" data-vis-policy-tool="${esc(key)}">
                                            ${['PRIVATE', 'PUBLIC', 'ADMIN', 'SELECTED_USERS'].map(opt => `
                                                <option value="${opt}" ${mode === opt ? 'selected' : ''}>${opt}</option>
                                            `).join('')}
                                        </select>
                                    </td>
                                    <td>
                                        <span class="yd-pill ${mode === 'PUBLIC' ? 'yd-pill-green' : mode === 'PRIVATE' ? 'yd-pill-red' : 'yd-pill-blue'}">
                                            ${mode === 'PUBLIC' ? 'All Users' : mode === 'PRIVATE' ? 'Super Admin Only' : mode === 'ADMIN' ? 'Admins' : `${allowedList.length} Selected`}
                                        </span>
                                    </td>
                                    ${selectedUser !== 'ALL' ? `
                                        <td style="text-align:right">
                                            ${renderSwitch({
                                                isOn: isToolVisibleForUser(tool, selectedUser),
                                                action: `toggle-vis-cell:${key}:${selectedUser}`,
                                                disabled: false,
                                                title: `Toggle visibility of ${tool.name} for ${selectedUser}`
                                            })}
                                        </td>
                                    ` : ''}
                                </tr>
                            `;
                        }).join('') || `
                            <tr>
                                <td colspan="6" class="yd-empty">No tools available.</td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    // =========================================================
    // SETTINGS, SYSTEM & LOGS PAGES
    // =========================================================

    function settingsPage() {
        const displayName = state.settings.displayName || state.user?.name || CONFIG.userId;
        const startPage = state.settings.startPage === 'tools' ? 'tools' : 'overview';

        return header(
            'Settings',
            button('Save Settings', 'save-settings', true, ICONS.cloud)
        ) +
        `<div class="yd-card">
            <div class="yd-card-title">
                ${ICONS.user}
                <span>Personal Dashboard Preferences</span>
            </div>
            <div class="yd-clean-row">
                <label class="yd-clean-label" for="yd-name">Display Name</label>
                <input id="yd-name" class="yd-input" type="text" value="${esc(displayName)}" />
            </div>
            <div class="yd-clean-row">
                <label class="yd-clean-label" for="yd-start">Default Start Section</label>
                <select id="yd-start" class="yd-select">
                    <option value="overview" ${startPage === 'overview' ? 'selected' : ''}>Overview</option>
                    <option value="tools" ${startPage === 'tools' ? 'selected' : ''}>Tools</option>
                </select>
            </div>
        </div>`;
    }

    function systemPage() {
        if (!canManage()) return deniedPage();

        return header('System') +
        `<div class="yd-card">
            <div class="yd-card-title">
                ${ICONS.cloud}
                <span>Repository & Configuration Paths</span>
            </div>
            <div class="yd-clean-row">
                <span class="yd-clean-label">Dashboard Repository</span>
                <span class="yd-id-badge">${esc(YODAWY.dashboardRepository || '—')}</span>
            </div>
            <div class="yd-clean-row">
                <span class="yd-clean-label">User Registry Target</span>
                <span class="yd-id-badge">${esc(`${getUserRegistryRepository()}/${getUserRegistryPath()}`)}</span>
            </div>
            <div class="yd-clean-row">
                <span class="yd-clean-label">Permissions Target</span>
                <span class="yd-id-badge">${esc(`${getPermissionsRepository()}/${getPermissionsPath()}`)}</span>
            </div>
            <div class="yd-clean-row">
                <span class="yd-clean-label">Visibility Target</span>
                <span class="yd-id-badge">${esc(`${getVisibilityRepository()}/${getVisibilityPath()}`)}</span>
            </div>
            <div class="yd-clean-row">
                <span class="yd-clean-label">Personal Repository</span>
                <span class="yd-id-badge">${esc(state.user?.repository || '—')}</span>
            </div>
        </div>`;
    }

    function logsPage() {
        return header(
            'Logs',
            button('Clear Logs', 'clear-logs', false)
        ) +
        `<div class="yd-table-card">
            <div class="yd-table-responsive">
                <table class="yd-table">
                    <thead>
                        <tr>
                            <th scope="col" style="width:110px">Time</th>
                            <th scope="col" style="width:100px">Level</th>
                            <th scope="col">Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.logs.map(item => `
                            <tr>
                                <td>${esc(item.time)}</td>
                                <td>
                                    <span class="yd-pill ${item.type === 'error' ? 'yd-pill-red' : item.type === 'success' ? 'yd-pill-green' : item.type === 'warning' ? 'yd-pill-yellow' : 'yd-pill-blue'}">
                                        ${esc(item.type.toUpperCase())}
                                    </span>
                                </td>
                                <td style="white-space:normal">${esc(item.message)}</td>
                            </tr>
                        `).join('') || `
                            <tr>
                                <td colspan="3" class="yd-empty">No logs recorded.</td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    function deniedPage() {
        return header('Access denied') +
            '<div class="yd-error">Your account does not have administrator access.</div>';
    }

    // =========================================================
    // ROLE-BASED SIDEBAR SECTIONS (USER / ADMIN / SUPER_ADMIN)
    // =========================================================

    function getSectionsForCurrentRole() {
        const baseSections = [
            ['overview', 'Overview', ICONS.overview],
            ['tools', 'Tools', ICONS.tools]
        ];

        if (!isFullyAuthenticated()) {
            return baseSections;
        }

        const role = normalizeRole(state.user?.role);

        if (role === 'SUPER_ADMIN') {
            return [
                ...baseSections,
                ['users', 'Users', ICONS.user],
                ['shared', 'Shared Tools', ICONS.tools],
                ['visibility', 'Visibility', ICONS.lock],
                ['system', 'System', ICONS.cloud],
                ['settings', 'Settings', ICONS.user],
                ['logs', 'Logs', ICONS.sync]
            ];
        }

        if (role === 'ADMIN') {
            return [
                ...baseSections,
                ['users', 'Users', ICONS.user],
                ['shared', 'Shared Tools', ICONS.tools],
                ['system', 'System', ICONS.cloud],
                ['settings', 'Settings', ICONS.user],
                ['logs', 'Logs', ICONS.sync]
            ];
        }

        return [
            ...baseSections,
            ['settings', 'Settings', ICONS.user],
            ['logs', 'Logs', ICONS.sync]
        ];
    }

    // =========================================================
    // RENDER
    // =========================================================

    function render() {
        const sidebarEl = $('#yd-sidebar');
        const mainEl = $('#yd-main');

        if (!sidebarEl || !mainEl) return;

        const isConnected = isFullyAuthenticated();

        const statusElement = $('#yd-status');
        if (statusElement) {
            statusElement.textContent = state.loading
                ? 'Syncing…'
                : isConnected
                    ? 'Connected'
                    : 'unConnected';
        }

        const brandTitleElement = $('#yd-brand-title');
        if (brandTitleElement) {
            if (isConnected) {
                const roleLabel = formatRoleLabel(state.user?.role).toUpperCase();
                brandTitleElement.textContent = `YODAWY DASHBOARD (${roleLabel})`;
            } else {
                brandTitleElement.textContent = 'YODAWY DASHBOARD';
            }
        }

        const profileName = isConnected
            ? String(
                state.settings.displayName ||
                state.user?.name ||
                CONFIG.userId ||
                'User'
            ).trim()
            : 'Not Authenticated';

        const profileId = CONFIG.userId || '—';
        const profileRole = isConnected
            ? formatRoleLabel(state.user?.role)
            : 'Unverified';
        const initial = isConnected
            ? (profileName.charAt(0).toUpperCase() || 'U')
            : '?';

        const profileNameElement = $('#yd-profile-name');
        const profileIdElement = $('#yd-profile-id');
        const profileRoleElement = $('#yd-profile-role');
        const profileAvatarElement = $('#yd-profile-avatar');
        const profileAvatarLgElement = $('#yd-profile-avatar-lg');
        const profileConnectionElement = $('#yd-profile-connection');
        const profileBadgeElement = $('#yd-profile-badge');
        const headerDot = $('#yd-header-dot');

        if (profileNameElement) {
            profileNameElement.textContent = profileName;
        }

        if (profileIdElement) {
            profileIdElement.textContent = `ID: ${profileId}`;
        }

        if (profileRoleElement) {
            profileRoleElement.textContent = profileRole;
            profileRoleElement.className = `yd-pill ${isConnected ? rolePillClass(profileRole) : 'yd-pill-red'}`;
        }

        if (profileAvatarElement) {
            profileAvatarElement.textContent = initial;
        }

        if (profileAvatarLgElement) {
            profileAvatarLgElement.textContent = initial;
        }

        if (profileConnectionElement) {
            profileConnectionElement.textContent = state.loading
                ? 'Syncing…'
                : isConnected
                    ? 'Connected'
                    : 'unConnected';
            profileConnectionElement.className = `yd-pill ${isConnected ? 'yd-pill-green' : 'yd-pill-red'}`;
        }

        if (profileBadgeElement) {
            profileBadgeElement.innerHTML = isConnected
                ? ICONS.okBadge
                : ICONS.alertBadge;
        }

        if (headerDot) {
            headerDot.style.background = state.loading
                ? '#c58a32'
                : isConnected
                    ? '#39865b'
                    : '#c94b58';
        }

        const sections = getSectionsForCurrentRole();

        if (!sections.some(([id]) => id === state.section)) {
            state.section = 'overview';
        }

        sidebarEl.innerHTML = sections.map(([id, name, icon]) => `
            <button class="yd-nav ${state.section === id ? 'active' : ''}" data-section="${id}" type="button">
                <span class="yd-nav-icon">${icon}</span>
                <span>${esc(name)}</span>
            </button>
        `).join('');

        const pages = {
            overview: overviewPage,
            tools: toolsPage,
            settings: settingsPage,
            users: usersPage,
            shared: sharedPage,
            visibility: visibilityPage,
            system: systemPage,
            logs: logsPage
        };

        mainEl.innerHTML = state.loading
            ? '<div class="yd-empty">Loading…</div>'
            : !isConnected
                ? `<div class="yd-card">
                    <div class="yd-title" style="margin-bottom:12px">Connect to System</div>
                    ${button('Connect', 'sync', true, ICONS.sync)}
                    ${(state.error || state.notice) ? `<div style="margin-top:12px">${renderErrorBox()}</div>` : ''}
                </div>`
                : pages[state.section]();

        if (isConnected && (state.error || state.notice)) {
            mainEl.insertAdjacentHTML('afterbegin', renderErrorBox());
        }
    }

    // =========================================================
    // EVENT HANDLERS
    // =========================================================

    launcher.addEventListener('click', () => {
        overlay.classList.add('open');
        render();

        if (!isFullyAuthenticated() && !state.loading) {
            void sync();
        }
    });

    overlay.addEventListener('change', event => {
        const userFilter = event.target.closest('#yd-vis-user-filter');
        if (userFilter) {
            state.visibilitySelectedUser = userFilter.value || 'ALL';
            render();
            return;
        }

        const permUserFilter = event.target.closest('#yd-perm-user-filter');
        if (permUserFilter) {
            state.permissionsSelectedUser = normalizePermissionUserId(permUserFilter.value);
            state.error = '';
            state.notice = '';
            render();
            return;
        }

        const policySelect = event.target.closest('[data-vis-policy-tool]');
        if (policySelect) {
            try {
                const toolKey = policySelect.dataset.visPolicyTool;
                setToolPolicyMode(toolKey, policySelect.value);
                render();
            } catch (error) {
                notify(error.message || String(error), 'VISIBILITY ERROR');
            }
        }
    });

    overlay.addEventListener('click', async event => {
        if (event.target === overlay) {
            overlay.classList.remove('open');
            return;
        }

        const nav = event.target.closest('[data-section]');

        if (nav) {
            state.section = nav.dataset.section;
            state.error = '';
            state.notice = '';
            render();
            return;
        }

        const actionElement = event.target.closest('[data-action]');
        const action = actionElement?.dataset.action;

        if (!action) {
            if (!event.target.closest('.yd-profile-wrap')) {
                const menu = $('#yd-profile-menu');
                const trigger = $('#yd-profile-trigger');

                if (menu && !menu.hidden) {
                    menu.hidden = true;
                    trigger?.setAttribute('aria-expanded', 'false');
                }
            }

            return;
        }

        if (action === 'profile-toggle') {
            const menu = $('#yd-profile-menu');
            const trigger = $('#yd-profile-trigger');

            if (menu && trigger) {
                menu.hidden = !menu.hidden;

                trigger.setAttribute(
                    'aria-expanded',
                    String(!menu.hidden)
                );
            }

            return;
        }

        try {
            if (action === 'close') {
                overlay.classList.remove('open');

            } else if (action === 'sync') {
                state.notice = '';
                resetAuthState();
                await sync();

            } else if (action === 'save-settings') {
                await saveSettings();

            } else if (action === 'save-visibility') {
                await saveVisibilitySettings();

            } else if (action === 'clear-logs') {
                state.logs = [];
                render();

            } else if (action === 'open-add-user-form') {
                if (!isFullyAuthenticated() || !isSuperAdmin()) {
                    throw new Error('Only an authenticated Super Admin can manage users.');
                }

                state.userFormOpen = true;
                state.userFormId = '';
                state.userFormDraft = {
                    id: '',
                    name: '',
                    repository: '',
                    role: 'User',
                    status: 'Active'
                };
                state.error = '';
                state.notice = '';
                render();

            } else if (action === 'cancel-user-form') {
                state.userFormOpen = false;
                state.userFormId = '';
                state.userFormDraft = null;
                state.error = '';
                state.notice = '';
                render();

            } else if (action.startsWith('edit-registry-user:')) {
                if (!isFullyAuthenticated() || !isSuperAdmin()) {
                    throw new Error('Only an authenticated Super Admin can manage users.');
                }

                const targetUid = normalizePermissionUserId(
                    action.slice('edit-registry-user:'.length)
                );

                const targetUser = state.users.find(
                    u => normalizePermissionUserId(u.id || u.userId || u.username) === targetUid
                );

                if (!targetUid || !targetUser) {
                    throw new Error(`Employee "${targetUid}" was not found.`);
                }

                state.userFormOpen = true;
                state.userFormId = targetUid;
                state.userFormDraft = {
                    id: targetUid,
                    name: String(targetUser.name || '').trim(),
                    repository: String(
                        targetUser.repository ||
                        targetUser.personalRepository ||
                        targetUser.personal_repository ||
                        ''
                    ).trim(),
                    role: formatRoleLabel(targetUser.role),
                    status:
                        String(targetUser.status || '').trim().toLowerCase() === 'inactive'
                            ? 'Inactive'
                            : 'Active'
                };
                state.error = '';
                state.notice = '';
                render();

            } else if (action === 'save-registry-user') {
                if (!isFullyAuthenticated() || !isSuperAdmin()) {
                    throw new Error('Only an authenticated Super Admin can manage users.');
                }

                const formValues = readUserFormInputs();
                state.userFormDraft = formValues;
                state.userSaving = true;
                state.userSavingTargetId = state.userFormId || formValues.id;
                state.error = '';
                state.notice = '';
                render();

                try {
                    if (state.userFormId) {
                        await updateRegistryUser(state.userFormId, formValues);
                    } else {
                        await addRegistryUser(formValues);
                    }
                } finally {
                    state.userSaving = false;
                    state.userSavingTargetId = '';
                    render();
                }

            } else if (action.startsWith('delete-registry-user:')) {
                if (!isFullyAuthenticated() || !isSuperAdmin()) {
                    throw new Error('Only an authenticated Super Admin can manage users.');
                }

                const targetUid = normalizePermissionUserId(
                    action.slice('delete-registry-user:'.length)
                );

                state.userSaving = true;
                state.userSavingTargetId = targetUid;
                state.error = '';
                state.notice = '';
                render();

                try {
                    await deleteRegistryUser(targetUid);
                } finally {
                    state.userSaving = false;
                    state.userSavingTargetId = '';
                    render();
                }

            } else if (action === 'refresh-connection') {
                const menu = $('#yd-profile-menu');
                const trigger = $('#yd-profile-trigger');

                if (menu) menu.hidden = true;
                trigger?.setAttribute('aria-expanded', 'false');

                resetAuthState();
                state.users = [];
                state.permissions = {};
                state.visibility = {};
                state.visibilityDirty = false;
                state.notice = '';

                await sync();

            } else if (action === 'refresh-tools') {
                const menu = $('#yd-profile-menu');
                const trigger = $('#yd-profile-trigger');

                if (menu) menu.hidden = true;
                trigger?.setAttribute('aria-expanded', 'false');

                if (!isFullyAuthenticated()) {
                    await sync();
                } else {
                    state.loading = true;
                    state.error = '';
                    state.errorTitle = '';
                    state.notice = '';
                    render();

                    try {
                        await verifyPersonalRepositoryAccess(
                            state.user.repository,
                            state.personalToken
                        );
                        await loadTools();
                        state.status = 'Connected';
                        log('Tools refreshed successfully.', 'success');
                    } catch (error) {
                        if (error.code === 'TOKEN_INVALID' || error.code === 'NETWORK_ERROR') {
                            resetAuthState();
                        }
                        state.errorTitle = error.title || '';
                        state.error = error.userMessage || error.message || String(error);
                        log(state.error, 'error');
                    } finally {
                        state.loading = false;
                        render();
                    }
                }

            } else if (action.startsWith('select-perm-user:')) {
                const targetUid = normalizePermissionUserId(
                    action.slice('select-perm-user:'.length)
                );
                state.permissionsSelectedUser = targetUid;
                state.error = '';
                state.notice = '';
                render();

            } else if (action.startsWith('toggle-perm-granted:')) {
                const parts = action.split(':');
                const targetUid = normalizePermissionUserId(parts[1]);
                const toolKey = parts.slice(2).join(':');
                const tool = resolveTrustedTool(toolKey);

                if (!tool) {
                    throw new Error('Tool not found in manifest.');
                }

                const currentGranted = permissionGranted(tool, targetUid);
                state.permissionSavingKey = `${targetUid}:${permissionKey(tool)}:granted`;
                render();

                try {
                    await saveToolPermission(targetUid, tool, {
                        granted: !currentGranted
                    });
                } finally {
                    state.permissionSavingKey = '';
                    render();
                }

            } else if (action.startsWith('toggle-perm-forced:')) {
                const parts = action.split(':');
                const targetUid = normalizePermissionUserId(parts[1]);
                const toolKey = parts.slice(2).join(':');
                const tool = resolveTrustedTool(toolKey);

                if (!tool) {
                    throw new Error('Tool not found in manifest.');
                }

                const currentForced = isPermissionForced(tool, targetUid);
                state.permissionSavingKey = `${targetUid}:${permissionKey(tool)}:forcedState`;
                render();

                try {
                    await saveToolPermission(targetUid, tool, {
                        forcedState: !currentForced
                    });
                } finally {
                    state.permissionSavingKey = '';
                    render();
                }

            } else if (action.startsWith('toggle-my-tool:')) {
                const key = action.slice('toggle-my-tool:'.length);
                const tool = state.tools.find(
                    item => permissionKey(item) === key
                );

                if (!tool) {
                    throw new Error('Tool not found.');
                }

                const nextState = !isToolEnabledByUser(tool);
                await toggleMyToolSwitch(tool, nextState);

            } else if (action.startsWith('toggle-vis-cell:')) {
                const parts = action.split(':');
                const toolKey = parts[1];
                const targetUid = parts[2];

                const tool = state.tools.find(
                    item => permissionKey(item) === toolKey
                );

                if (!tool) {
                    throw new Error('Tool not found.');
                }

                const currentlyVisible = isToolVisibleForUser(tool, targetUid);
                setToolVisibilityForUser(toolKey, targetUid, !currentlyVisible);
                render();
            }

        } catch (error) {
            notify(
                error.userMessage || error.message || String(error),
                error.title || 'OPERATION FAILED'
            );
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            const menu = $('#yd-profile-menu');
            const trigger = $('#yd-profile-trigger');

            if (menu) menu.hidden = true;

            trigger?.setAttribute('aria-expanded', 'false');

            overlay.classList.remove('open');
        }
    });

    // Authenticate before exposing the dashboard launcher.
    let connected = false;

    try {
        connected = await sync();

        if (connected && YODAWY.authenticated === true) {
            launcher.style.display = '';
            return true;
        }

        // Remove the dashboard UI when authentication fails.
        launcher.remove();
        overlay.remove();
        style.remove();

        window.__YODAWY_DASHBOARD_RUNNING__ = false;
        YODAWY.authenticated = false;

        return false;
    } catch (error) {
        launcher.remove();
        overlay.remove();
        style.remove();

        window.__YODAWY_DASHBOARD_RUNNING__ = false;
        YODAWY.authenticated = false;

        YODAWY.authError = error?.message || 'ENGINE_INIT_FAILED';

        return false;
    }
};
