YODAWY.init = async function () {
    'use strict';

    if (window.__YODAWY_DASHBOARD_RUNNING__) return;
    window.__YODAWY_DASHBOARD_RUNNING__ = true;

    const CONFIG = {
        userId: String(YODAWY.userId || 'Q-001').trim(),
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

    const state = {
        section: 'overview',
        status: 'unConnected',
        user: null,
        users: [],
        personalToken: '',
        settings: {},
        messages: {},
        permissions: {},
        visibility: {},
        visibilitySelectedUser: 'ALL',
        visibilityDirty: false,
        tools: [],
        logs: [],
        error: '',
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

    function notify(message) {
        state.error = message;
        log(message, 'error');
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

    function getUsers(data) {
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.users)) return data.users;
        return [];
    }

    function getPermissions(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return {};
        }

        if (data.users && typeof data.users === 'object') {
            return data.users;
        }

        return data;
    }

    function getPersonalToken(user) {
        return user?.personalToken ||
            user?.personal_token ||
            user?.githubToken ||
            user?.github_token ||
            user?.token ||
            '';
    }

    function getMessage(key, fallback) {
        const value = state.messages[key];

        return typeof value === 'string' && value
            ? value
            : fallback;
    }

    function permissionKey(tool) {
        if (tool.id) {
            return String(tool.id).trim();
        }

        return tool.path.split('/').pop()
            .replace(/\.user\.js$/i, '')
            .replace(/\.js$/i, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toUpperCase();
    }

    function rolePillClass(roleText) {
        const r = String(roleText || '').trim().toLowerCase();
        if (r === 'super admin' || r === 'superadmin') {
            return 'yd-pill-blue';
        }
        if (r === 'admin') {
            return 'yd-pill-purple';
        }
        return 'yd-pill-yellow';
    }

    // =========================================================
    // ROLES, PERMISSIONS AND VISIBILITY
    // =========================================================

    function isSuperAdmin() {
        const role = String(state.user?.role || '').trim().toLowerCase();

        return state.authenticated && (
            CONFIG.userId.toUpperCase() === 'Q-001' ||
            role === 'super admin' ||
            role === 'superadmin'
        );
    }

    function isAdmin() {
        const role = String(state.user?.role || '').trim().toLowerCase();

        return state.authenticated && (
            isSuperAdmin() || role === 'admin'
        );
    }

    function canManage() {
        return isAdmin();
    }

    function canManageVisibility() {
        return isSuperAdmin();
    }

    function getToolPermissionRecord(tool) {
        const userPermissions = state.permissions[CONFIG.userId] || {};
        const key = permissionKey(tool);

        return userPermissions[key] ??
            userPermissions[tool.path] ??
            userPermissions[tool.name] ??
            false;
    }

    function permissionGranted(tool) {
        const permission = getToolPermissionRecord(tool);

        if (typeof permission === 'boolean') {
            return permission;
        }

        if (permission && typeof permission === 'object') {
            return permission.granted === true ||
                permission.enabled === true;
        }

        return false;
    }

    function permissionType(tool) {
        const permission = getToolPermissionRecord(tool);

        if (permission && typeof permission === 'object') {
            return permission.type === 'SUPER_ADMIN'
                ? 'SUPER_ADMIN'
                : 'ADMIN';
        }

        return 'ADMIN';
    }

    function permitted(tool) {
        return permissionGranted(tool);
    }

    function isToolEnabledByUser(tool) {
        const key = permissionKey(tool);
        const toolsMap = state.settings?.tools;

        if (!toolsMap || typeof toolsMap !== 'object') {
            return false;
        }

        return toolsMap[key] === true;
    }

    function visibilityPolicy(tool) {
        const key = permissionKey(tool);

        return state.visibility[key] ??
            state.visibility[tool.path] ??
            state.visibility[tool.name] ??
            {};
    }

    function ensureToolVisibilityRecord(toolKey) {
        const existing = state.visibility[toolKey];

        if (!existing || typeof existing !== 'object') {
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
            if (!existing.visibility) {
                existing.visibility = 'PRIVATE';
            }
        }

        return state.visibility[toolKey];
    }

    function isToolVisibleForUser(tool, targetUserId) {
        const uid = String(targetUserId || '').trim().toUpperCase();
        const userObj = state.users.find(
            u => String(u.id || '').trim().toUpperCase() === uid
        );
        const role = String(userObj?.role || '').trim().toLowerCase();

        if (uid === 'Q-001' || role === 'super admin' || role === 'superadmin') {
            return true;
        }

        const policy = visibilityPolicy(tool);

        if (!policy || typeof policy !== 'object') {
            return true;
        }

        const visibility = String(
            policy.visibility || 'PUBLIC'
        ).toUpperCase();

        if (visibility === 'PUBLIC') {
            return true;
        }

        if (visibility === 'PRIVATE') {
            return false;
        }

        if (visibility === 'SELECTED_USERS') {
            const allowedUsers = Array.isArray(policy.allowedUsers)
                ? policy.allowedUsers.map(value =>
                    String(value).trim().toUpperCase()
                )
                : [];

            return allowedUsers.includes(uid);
        }

        return true;
    }

    function toolIsVisible(tool) {
        if (isSuperAdmin()) {
            return true;
        }

        return isToolVisibleForUser(tool, CONFIG.userId);
    }

    function setToolVisibilityForUser(toolKey, targetUserId, turnOn) {
        const uid = String(targetUserId || '').trim().toUpperCase();
        if (uid === 'Q-001') return;

        const record = ensureToolVisibilityRecord(toolKey);
        const currentVis = String(record.visibility || 'PRIVATE').toUpperCase();

        const nonSuperAdminIds = state.users
            .map(u => String(u.id || '').trim().toUpperCase())
            .filter(id => id && id !== 'Q-001');

        let allowedSet = new Set(
            (Array.isArray(record.allowedUsers) ? record.allowedUsers : [])
                .map(id => String(id).trim().toUpperCase())
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
        const mode = String(newMode || 'PRIVATE').toUpperCase();
        const record = ensureToolVisibilityRecord(toolKey);

        record.visibility = mode;

        if (mode === 'PRIVATE') {
            record.allowedUsers = [];
            record.enabled = false;
        } else if (mode === 'PUBLIC') {
            record.enabled = true;
        } else if (mode === 'SELECTED_USERS') {
            record.enabled = record.allowedUsers.length > 0;
        }

        state.visibilityDirty = true;
    }

    // =========================================================
    // AUTHENTICATION
    // =========================================================

    async function authenticate() {
        const authConfig = YODAWY.authConfig;

        if (!authConfig || authConfig.provider !== 'github') {
            throw new Error('Invalid GitHub AUTH configuration.');
        }

        const userRegistry = authConfig.userRegistry || {};

        const registryRepository =
            userRegistry.repository ||
            YODAWY.dashboardRepository;

        const registryPath =
            userRegistry.path ||
            'CONFIG/auth-users.json';

        const messagesPath =
            authConfig.dashboard?.messagesPath ||
            'CONFIG/auth-messages.json';

        const permissionsPath =
            authConfig.permissionsPath ||
            CONFIG.permissionsPath;

        const visibilityPath =
            authConfig.visibilityPath ||
            CONFIG.visibilityPath;

        const [
            usersData,
            messagesData,
            permissionsData,
            visibilityData
        ] = await Promise.all([
            readJson(registryRepository, registryPath),

            readJson(
                YODAWY.dashboardRepository,
                messagesPath
            ).catch(() => ({})),

            readJson(
                YODAWY.dashboardRepository,
                permissionsPath
            ).catch(() => ({})),

            readJson(
                YODAWY.dashboardRepository,
                visibilityPath
            ).catch(() => ({}))
        ]);

        if (authConfig.enabled === false) {
            throw new Error('System is disabled.');
        }

        const allUsers = getUsers(usersData);
        state.users = allUsers;

        const user = allUsers.find(item =>
            String(
                item.id ||
                item.userId ||
                item.username ||
                ''
            ).trim().toUpperCase() === CONFIG.userId.toUpperCase()
        );

        if (!user) {
            throw new Error(
                getMessage('INVALID_ID', 'User ID was not found.')
            );
        }

        if (String(user.status || '').toLowerCase() !== 'active') {
            throw new Error(
                getMessage('ACCOUNT_DISABLED', 'Account is not active.')
            );
        }

        const personalRepository =
            user.repository ||
            user.personalRepository ||
            user.personal_repository;

        const personalToken = String(
            YODAWY.personalToken ||
            getPersonalToken(user) ||
            ''
        ).trim();

        if (!personalRepository) {
            throw new Error(
                'Personal repository is missing from the user registry.'
            );
        }

        if (!personalToken) {
            throw new Error(
                'Personal token is missing. Set PERSONAL_TOKEN in the Loader or provide it in the user registry.'
            );
        }

        state.user = {
            ...user,
            repository: personalRepository
        };

        state.personalToken = personalToken;

        state.messages =
            messagesData.messages ||
            messagesData ||
            {};

        state.permissions = getPermissions(permissionsData);

        state.visibility =
            visibilityData?.visibility &&
            typeof visibilityData.visibility === 'object'
                ? visibilityData.visibility
                : visibilityData?.tools &&
                  typeof visibilityData.tools === 'object'
                    ? visibilityData.tools
                    : getPermissions(visibilityData);

        state.visibilityDirty = false;

        try {
            state.settings = await readJson(
                personalRepository,
                authConfig.settingsPath || CONFIG.settingsPath,
                personalToken
            );
        } catch (error) {
            if (error.status !== 404) {
                log(`Settings: ${error.message}`, 'warning');
            }

            state.settings = {};
        }

        if (!state.settings || typeof state.settings !== 'object') {
            state.settings = {};
        }

        if (!state.settings.tools || typeof state.settings.tools !== 'object') {
            state.settings.tools = {};
        }

        state.authenticated = true;
        state.initialized = true;
        state.status = 'Connected';
        state.section = state.settings.startPage === 'tools' ? 'tools' : 'overview';

        log('User authentication successful.', 'success');
    }

    // =========================================================
    // LOAD TOOLS FROM THE DASHBOARD REPOSITORY
    // =========================================================

    async function loadTools() {
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

                const source = String(file.content || '').replace(/\u00a0/g, ' ');

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
                    sha: file.sha || '',

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

                log(
                    `${item?.resolvedPath || 'Tool'}: ${result.reason?.message || 'Tool loading failed.'}`,
                    'error'
                );
            }
        });

        if (!state.tools.length) {
            throw new Error(
                `The manifest was read, but none of its JavaScript tools could be loaded. Check the tool paths in ${CONFIG.manifestPath}.`
            );
        }

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
        if (!tool.matches.length) return false;

        if (tool.excludes.some(pattern =>
            simpleMatch(pattern, location.href)
        )) {
            return false;
        }

        return tool.matches.some(pattern =>
            simpleMatch(pattern, location.href)
        );
    }

    // =========================================================
    // RUN TOOL
    // =========================================================

    function runTool(tool) {
        if (!state.authenticated || !permitted(tool)) {
            throw new Error('Tool permission denied.');
        }

        if (!matchesPage(tool)) {
            throw new Error(
                'This tool does not match the current page.'
            );
        }

        if (tool.requires.length) {
            throw new Error(
                `${tool.name}: @require dependencies are not supported.`
            );
        }

        const unsupported = tool.grants.filter(
            grant => grant !== 'unsafeWindow'
        );

        if (unsupported.length) {
            throw new Error(
                `${tool.name}: unsupported @grant: ${unsupported.join(', ')}`
            );
        }

        const runKey = '__YODAWY_TOOL_' +
            tool.path.replace(/[^a-zA-Z0-9]/g, '_');

        if (window[runKey]) {
            log(`${tool.name} is already running.`, 'warning');
            return;
        }

        try {
            new Function(
                'unsafeWindow',
                `"use strict";\n${tool.source}\n`
            )(window);

            window[runKey] = true;

            log(`Started ${tool.name}.`, 'success');
        } catch (error) {
            log(`${tool.name}: ${error.message}`, 'error');
            throw error;
        }
    }

    // =========================================================
    // SYNC
    // =========================================================

    async function sync() {
        if (state.loading) return;

        state.loading = true;
        state.error = '';
        render();

        try {
            if (!state.authenticated) {
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
        } catch (error) {
            state.error = error.message || String(error);
            state.status = 'unConnected';
            state.authenticated = false;
            state.initialized = false;

            log(state.error, 'error');
        } finally {
            state.loading = false;
            render();
        }
    }

    // =========================================================
    // SAVE PERSONAL SETTINGS & TOOL ON/OFF STATE
    // =========================================================

    async function writePersonalSettings(updatedSettings, successLogMessage) {
        const repository = state.user.repository;
        const path = CONFIG.settingsPath;

        let current = null;

        try {
            current = await YODAWY.request(
                repositoryUrl(repository, path),
                state.personalToken
            );
        } catch (error) {
            if (error.status !== 404) throw error;
        }

        const bytes = new TextEncoder().encode(
            JSON.stringify(updatedSettings, null, 2) + '\n'
        );

        let binary = '';

        for (let index = 0; index < bytes.length; index += 8192) {
            binary += String.fromCharCode(
                ...bytes.subarray(index, index + 8192)
            );
        }

        const body = {
            message: 'Update dashboard settings',
            content: btoa(binary),
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
        if (!state.authenticated) {
            throw new Error('Authentication required.');
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
        render();
    }

    async function toggleMyToolSwitch(tool, turnOn) {
        if (!state.authenticated) {
            throw new Error('Authentication required.');
        }

        if (!permitted(tool)) {
            throw new Error('You do not have permission to enable this tool.');
        }

        const key = permissionKey(tool);
        const repository = state.user.repository;

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

        state.settings = settings;
        render();

        await writePersonalSettings(
            settings,
            `${tool.name} turned ${turnOn ? 'ON' : 'OFF'}.`
        );

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
    // SAVE VISIBILITY SETTINGS (AUTHORITATIVE USERS REPO)
    // =========================================================

    async function saveVisibilitySettings() {
        if (!isSuperAdmin()) {
            throw new Error('Super Admin access required to modify visibility.');
        }

        const repository = CONFIG.usersRepository;
        const path = CONFIG.visibilityPath;

        const newVisibility = {};

        const orderedTools = [...state.tools].sort((a, b) =>
            permissionKey(a).localeCompare(permissionKey(b))
        );

        for (const tool of orderedTools) {
            const key = permissionKey(tool);
            const record = ensureToolVisibilityRecord(key);
            const visValue = String(record.visibility || 'PRIVATE').toUpperCase();
            const allowedUsers = Array.isArray(record.allowedUsers)
                ? record.allowedUsers
                    .map(s => String(s).trim().toUpperCase())
                    .filter(Boolean)
                : [];

            newVisibility[key] = {
                visibility: visValue,
                allowedUsers,
                developmentStatus: record.developmentStatus || 'UNDER DEVELOPMENT',
                publicationStatus: record.publicationStatus || 'NOT PUBLISHED',
                enabled: visValue !== 'PRIVATE'
            };
        }

        for (const [key, value] of Object.entries(state.visibility)) {
            if (!newVisibility[key] && value && typeof value === 'object') {
                newVisibility[key] = value;
            }
        }

        let current = null;

        try {
            current = await YODAWY.request(
                repositoryUrl(repository, path),
                state.personalToken
            );
        } catch (error) {
            if (error.status !== 404) throw error;
        }

        const bytes = new TextEncoder().encode(
            JSON.stringify(newVisibility, null, 2) + '\n'
        );

        let binary = '';

        for (let index = 0; index < bytes.length; index += 8192) {
            binary += String.fromCharCode(
                ...bytes.subarray(index, index + 8192)
            );
        }

        const body = {
            message: 'Update tool visibility configuration',
            content: btoa(binary),
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

        if (!response.ok) {
            throw new Error(
                result.message ||
                `Visibility save failed: ${response.status}`
            );
        }

        state.visibility = newVisibility;
        state.visibilityDirty = false;
        state.error = '';

        log('Tool visibility saved to Users Repository.', 'success');
        render();
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
            transition: background .15s;
        }
        .yd-btn:hover {
            background: ${LIGHT_BG};
        }
        .yd-primary {
            background: ${PURPLE};
            color: #fff;
            border-color: ${PURPLE} !important;
        }
        .yd-primary:hover {
            background: ${DARK};
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
        .yd-empty {
            padding: 24px;
            text-align: center;
            color: #8c8492;
            font-size: 12.5px;
        }

        /* =====================================================
           HEADER STATUS & COMPACT PROFILE BUTTON (NO HOVER JUMP)
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
            background: #c58a32;
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
           SLIM MODERN TABLE (SHADCN-INSPIRED COMPACT ROWS)
           ===================================================== */
        .yd-table-card {
            background: #fff;
            border: 1px solid #e7e0ea;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 6px #24152e06;
        }
        .yd-table-card-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            height: 44px;
            padding: 0 14px;
            background: #fff;
            border-bottom: 1px solid #eee8f0;
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
            gap: 6px;
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
            .yd-info-grid {
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
                    <div class="yd-brand-title">YODAWY DASHBOARD</div>
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
                            <span class="yd-gb-avatar" id="yd-profile-avatar">M</span>
                            <span class="yd-gb-badge" id="yd-profile-badge">${ICONS.okBadge}</span>
                        </button>

                        <div id="yd-profile-menu" class="yd-profile-menu" hidden>
                            <div class="yd-gb-card">
                                <div class="yd-gb-ring-lg">
                                    <div class="yd-gb-avatar-lg" id="yd-profile-avatar-lg">M</div>
                                </div>
                                <div id="yd-profile-name" class="yd-gb-name">MOHAMED SALEH</div>
                                <div id="yd-profile-id" class="yd-gb-meta">ID: Q-001</div>
                                <div class="yd-gb-pills">
                                    <span id="yd-profile-role" class="yd-pill yd-pill-blue">Super Admin</span>
                                    <span id="yd-profile-connection" class="yd-pill yd-pill-green">Connected</span>
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

    function renderAccessIcon(allowed) {
        if (allowed) {
            return `
                <div class="yd-access-badge unlocked" aria-label="Permitted">
                    ${ICONS.unlocked}
                    <span class="yd-tooltip">Permitted</span>
                </div>
            `;
        }

        return `
            <div class="yd-access-badge locked" aria-label="Permission required">
                ${ICONS.lock}
                <span class="yd-tooltip">Permission required to enable this tool</span>
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
    // OVERVIEW PAGE (SIMPLE, CLEAN, NO TABLE, NO JARGON)
    // =========================================================

    function overviewPage() {
        const visibleTools = state.tools.filter(toolIsVisible);
        const permittedTools = visibleTools.filter(permitted);
        const enabledTools = permittedTools.filter(isToolEnabledByUser);

        const userName = state.settings.displayName || state.user?.name || CONFIG.userId;
        const userRole = state.user?.role || 'User';
        const userStatus = state.user?.status || 'Active';
        const isConnected = state.authenticated && state.status === 'Connected';

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
                    <span class="yd-id-badge">${esc(CONFIG.userId)}</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">Role</span>
                    <span class="yd-pill ${rolePillClass(userRole)}">${esc(userRole)}</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">Account Status</span>
                    <span class="yd-pill ${String(userStatus).toLowerCase() === 'active' ? 'yd-pill-green' : 'yd-pill-red'}">${esc(userStatus)}</span>
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
                    <span class="yd-pill ${state.tools.length ? 'yd-pill-blue' : 'yd-pill-yellow'}">${state.tools.length ? 'Ready' : 'No tools'}</span>
                </div>
                <div class="yd-clean-row">
                    <span class="yd-clean-label">Current Site</span>
                    <span class="yd-pill yd-pill-purple">${esc(location.hostname)}</span>
                </div>
            </div>
        </div>`;
    }

    // =========================================================
    // TOOLS PAGE (SLIM MODERN TABLE, SPLIT PILLS, UNLOCKED/LOCKED PADLOCK)
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
                                    ? `Turn ${tool.name}${enabledByUser ? 'OFF' : 'ON'}`
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
    // PRESERVED PAGES (KEPT INTACT FOR UPCOMING MILESTONES)
    // =========================================================

    function settingsPage() {
        return header('Settings');
    }

    function usersPage() {
        if (!canManage()) return deniedPage();
        return header('Users');
    }

    function sharedPage() {
        if (!canManage()) return deniedPage();
        return header('Shared Tools');
    }

    function visibilityPage() {
        if (!canManageVisibility()) return deniedPage();
        return header('Visibility');
    }

    function systemPage() {
        if (!canManage()) return deniedPage();
        return header('System');
    }

    function logsPage() {
        return header('Logs');
    }

    function deniedPage() {
        return header('Access denied') +
            '<div class="yd-error">Your account does not have administrator access.</div>';
    }

    // =========================================================
    // RENDER
    // =========================================================

    function render() {
        const sidebarEl = $('#yd-sidebar');
        const mainEl = $('#yd-main');

        if (!sidebarEl || !mainEl) return;

        const isConnected = state.authenticated && state.status === 'Connected';

        $('#yd-status').textContent = state.loading
            ? 'Syncing…'
            : isConnected
                ? 'Connected'
                : 'unConnected';

        const profileName = String(
            state.settings.displayName ||
            state.user?.name ||
            CONFIG.userId ||
            'User'
        ).trim();

        const profileId = CONFIG.userId;
        const profileRole = state.user?.role || 'User';
        const initial = profileName.charAt(0).toUpperCase() || 'U';

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
            profileRoleElement.className = `yd-pill ${rolePillClass(profileRole)}`;
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

        const sections = [
            ['overview', 'Overview', ICONS.overview],
            ['tools', 'Tools', ICONS.tools]
        ];

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
            : !state.authenticated
                ? `<div class="yd-card">
                    <div class="yd-title" style="margin-bottom:12px">Connect to System</div>
                    ${button('Connect', 'sync', true, ICONS.sync)}
                    ${state.error ? `<div class="yd-error" style="margin-top:12px">${esc(state.error)}</div>` : ''}
                </div>`
                : pages[state.section]();

        if (state.authenticated && state.error) {
            mainEl.insertAdjacentHTML(
                'afterbegin',
                `<div class="yd-error">${esc(state.error)}</div>`
            );
        }
    }

    // =========================================================
    // EVENT HANDLERS
    // =========================================================

    launcher.addEventListener('click', () => {
        overlay.classList.add('open');
        render();

        if (!state.initialized) {
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

        const policySelect = event.target.closest('[data-vis-policy-tool]');
        if (policySelect) {
            const toolKey = policySelect.dataset.visPolicyTool;
            setToolPolicyMode(toolKey, policySelect.value);
            render();
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
                await sync();

            } else if (action === 'save-settings') {
                await saveSettings();

            } else if (action === 'save-visibility') {
                await saveVisibilitySettings();

            } else if (action === 'clear-logs') {
                state.logs = [];
                render();

            } else if (action === 'refresh-connection') {
                const menu = $('#yd-profile-menu');
                const trigger = $('#yd-profile-trigger');

                if (menu) menu.hidden = true;

                trigger?.setAttribute('aria-expanded', 'false');

                state.authenticated = false;
                state.initialized = false;
                state.user = null;
                state.users = [];
                state.personalToken = '';
                state.settings = {};
                state.permissions = {};
                state.visibility = {};
                state.visibilityDirty = false;
                state.tools = [];
                state.status = 'unConnected';

                await sync();

            } else if (action === 'refresh-tools') {
                const menu = $('#yd-profile-menu');
                const trigger = $('#yd-profile-trigger');

                if (menu) menu.hidden = true;

                trigger?.setAttribute('aria-expanded', 'false');

                if (!state.authenticated) {
                    await sync();

                } else {
                    state.loading = true;
                    state.error = '';
                    render();

                    try {
                        await loadTools();

                        state.status = 'Connected';

                        log(
                            'Tools refreshed successfully.',
                            'success'
                        );

                    } catch (error) {
                        state.error = error.message || String(error);

                        log(state.error, 'error');

                    } finally {
                        state.loading = false;
                        render();
                    }
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
            notify(error.message || String(error));
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

    render();

    log('Dashboard engine initialized.', 'success');

    return true;
};
