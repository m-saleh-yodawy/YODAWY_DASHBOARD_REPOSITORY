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
        status: 'Not connected',
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
        state.section = state.settings.startPage || 'overview';

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
            state.status = 'Connection failed';
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
    // DASHBOARD UI
    // =========================================================

    const style = document.createElement('style');

    style.textContent = `
        #yd-launcher {
            position: fixed;
            right: 22px;
            bottom: 22px;
            z-index: 2147483000;
            background: ${PURPLE};
            color: #fff;
            border: 0;
            border-radius: 40px;
            padding: 13px 18px;
            font: 700 13px system-ui;
            cursor: pointer;
            box-shadow: 0 8px 25px #0003;
        }
        #yd-overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483001;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 3vh 3vw;
            background: #17131c99;
        }
        #yd-overlay.open {
            display: flex;
        }
        #yd-modal {
            width: 100%;
            height: 100%;
            max-width: 1450px;
            max-height: 920px;
            background: ${LIGHT_BG};
            color: #29242e;
            border-radius: 16px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            font: 14px/1.5 system-ui;
        }
        #yd-modal * {
            box-sizing: border-box;
        }
        #yd-header {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            padding: 16px 22px;
            background: #fff;
            border-bottom: 1px solid #e9e4ec;
        }
        #yd-body {
            display: flex;
            flex: 1;
            min-height: 0;
        }
        #yd-sidebar {
            width: 210px;
            flex-shrink: 0;
            background: #fff;
            padding: 15px 10px;
            border-right: 1px solid #e9e4ec;
            overflow: auto;
        }
        #yd-main {
            flex: 1;
            min-width: 0;
            overflow: auto;
            padding: 25px;
        }
        .yd-nav {
            display: block;
            width: 100%;
            text-align: left;
            border: 0;
            border-radius: 8px;
            padding: 12px;
            background: transparent;
            color: #655c6a;
            cursor: pointer;
            margin-bottom: 4px;
        }
        .yd-nav.active {
            background: ${SOFT_BG};
            color: ${DARK};
            font-weight: 800;
        }
        .yd-title {
            font-size: 21px;
            font-weight: 800;
        }
        .yd-sub {
            font-size: 11px;
            color: #8c8492;
        }
        .yd-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
        }
        .yd-card {
            background: #fff;
            border: 1px solid #eee8f0;
            border-radius: 12px;
            padding: 17px;
            margin-bottom: 15px;
            min-width: 0;
        }
        .yd-value {
            font-size: 26px;
            font-weight: 800;
            margin-top: 8px;
        }
        .yd-btn {
            border: 1px solid #e5dce8;
            background: #fff;
            color: ${DARK};
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            margin: 2px;
        }
        .yd-primary {
            background: ${PURPLE};
            color: #fff;
            border-color: ${PURPLE};
        }
        .yd-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin: 12px 0;
        }
        .yd-field input,
        .yd-field select {
            width: 100%;
            padding: 10px;
            border: 1px solid #e3dce6;
            border-radius: 8px;
            font: 12px system-ui;
            background: #fff;
            color: #29242e;
        }
        .yd-row {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 0;
            border-bottom: 1px solid #eee;
        }
        .yd-grow {
            flex: 1;
            min-width: 0;
            overflow-wrap: anywhere;
        }
        .yd-note {
            padding: 12px;
            background: ${SOFT_BG};
            border-radius: 8px;
            margin-bottom: 14px;
            font-size: 12px;
            overflow-wrap: anywhere;
        }
        .yd-error {
            padding: 12px;
            background: #fbe6e9;
            color: #a83d51;
            border-radius: 8px;
            margin-bottom: 14px;
            overflow-wrap: anywhere;
        }
        .yd-pill {
            display: inline-block;
            padding: 4px 8px;
            background: ${SOFT_BG};
            color: ${DARK};
            border-radius: 7px;
            font-size: 11px;
            font-weight: 700;
        }
        .yd-empty {
            padding: 24px;
            text-align: center;
            color: #8c8492;
        }
        .yd-brand {
            min-width: 0;
        }
        .yd-header-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
        }
        .yd-profile-wrap {
            position: relative;
        }
        .yd-profile-trigger {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 10px 6px 6px;
            background: #fff;
            border: 1px solid #e8dfe9;
            border-radius: 12px;
            color: #29242e;
            cursor: pointer;
            text-align: left;
            transition: background .2s, border-color .2s;
            font: inherit;
        }
        .yd-profile-trigger:hover {
            background: ${LIGHT_BG};
            border-color: #cbb8ce;
        }
        .yd-avatar {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 38px;
            flex-shrink: 0;
            border-radius: 11px;
            background: ${PURPLE};
            color: #fff;
            font-size: 15px;
            font-weight: 800;
        }
        .yd-profile-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
            max-width: 180px;
        }
        .yd-profile-name {
            font-size: 12px;
            font-weight: 800;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .yd-profile-id {
            color: #8c8492;
            font-size: 10px;
            font-weight: 600;
        }
        .yd-profile-chevron {
            margin-left: 5px;
            color: ${PURPLE};
            font-size: 17px;
        }
        .yd-profile-menu {
            position: absolute;
            top: calc(100% + 10px);
            right: 0;
            z-index: 2147483005;
            width: 300px;
            padding: 14px;
            background: #fff;
            border: 1px solid #e8dfe9;
            border-radius: 14px;
            box-shadow: 0 14px 40px #24152e24;
        }
        .yd-profile-menu[hidden] {
            display: none !important;
        }
        .yd-dropdown-heading {
            padding: 3px 4px 12px;
            color: #8c8492;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 1px;
        }
        .yd-connection-row {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px 10px;
            background: ${LIGHT_BG};
            border-radius: 10px;
        }
        .yd-connection-dot {
            width: 10px;
            height: 10px;
            flex-shrink: 0;
            border-radius: 50%;
            background: #c58a32;
            box-shadow: 0 0 0 4px #c58a321a;
        }
        .yd-connection-label {
            color: #8c8492;
            font-size: 10px;
        }
        .yd-connection-value {
            margin-top: 2px;
            color: ${DARK};
            font-size: 12px;
            font-weight: 800;
            overflow-wrap: anywhere;
        }
        .yd-dropdown-divider {
            height: 1px;
            margin: 12px 0;
            background: #eee8f0;
        }
        .yd-dropdown-action {
            display: flex;
            align-items: center;
            gap: 11px;
            width: 100%;
            padding: 11px 9px;
            border: 0;
            border-radius: 9px;
            background: transparent;
            color: #29242e;
            cursor: pointer;
            text-align: left;
            font: inherit;
        }
        .yd-dropdown-action:hover {
            background: ${SOFT_BG};
        }
        .yd-action-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 34px;
            height: 34px;
            flex-shrink: 0;
            border-radius: 9px;
            background: ${SOFT_BG};
            color: ${PURPLE};
            font-size: 21px;
            font-weight: 700;
        }
        .yd-dropdown-action b {
            display: block;
            font-size: 12px;
        }
        .yd-dropdown-action small {
            display: block;
            margin-top: 3px;
            color: #8c8492;
            font-size: 10px;
            line-height: 1.5;
        }
        .yd-switch-wrap {
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .yd-switch {
            position: relative;
            width: 46px;
            height: 24px;
            border: 0;
            border-radius: 999px;
            background: #d5cbd8;
            cursor: pointer;
            padding: 2px;
            transition: background .2s, opacity .2s;
            flex-shrink: 0;
        }
        .yd-switch.on {
            background: ${PURPLE};
        }
        .yd-switch:disabled {
            opacity: .45;
            cursor: not-allowed;
        }
        .yd-switch-knob {
            display: block;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 2px 5px #0003;
            transition: transform .2s;
            transform: translateX(0);
        }
        .yd-switch.on .yd-switch-knob {
            transform: translateX(22px);
        }
        .yd-switch-state {
            font-size: 11px;
            font-weight: 800;
            min-width: 26px;
            color: ${DARK};
        }
        .yd-matrix-scroll {
            position: relative;
            max-height: 520px;
            overflow: auto;
            border: 1px solid #e5dce8;
            border-radius: 10px;
            background: #fff;
        }
        .yd-matrix-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            font-size: 12px;
        }
        .yd-matrix-table th,
        .yd-matrix-table td {
            padding: 12px 14px;
            border-bottom: 1px solid #eee8f0;
            border-right: 1px solid #eee8f0;
            text-align: center;
            vertical-align: middle;
            background: #fff;
            white-space: nowrap;
        }
        .yd-matrix-table thead th {
            position: sticky;
            top: 0;
            z-index: 3;
            background: ${SOFT_BG};
            color: ${DARK};
            font-weight: 800;
        }
        .yd-matrix-table .yd-sticky-col {
            position: sticky;
            left: 0;
            z-index: 2;
            text-align: left;
            min-width: 240px;
            max-width: 280px;
            background: #fff;
            box-shadow: 2px 0 6px #0000000a;
        }
        .yd-matrix-table thead .yd-sticky-col {
            z-index: 4;
            background: ${SOFT_BG};
        }
        .yd-policy-select {
            padding: 6px 8px;
            border: 1px solid #d8cede;
            border-radius: 7px;
            background: ${LIGHT_BG};
            color: ${DARK};
            font-size: 11px;
            font-weight: 700;
        }
        @media (max-width: 650px) {
            #yd-header {
                align-items: flex-start;
                flex-wrap: wrap;
            }
            .yd-header-actions {
                width: 100%;
                justify-content: flex-start;
                flex-wrap: wrap;
            }
            .yd-profile-menu {
                right: auto;
                left: 0;
                width: min(300px, calc(100vw - 30px));
            }
        }
        @media (max-width: 800px) {
            #yd-overlay {
                padding: 0;
            }
            #yd-modal {
                border-radius: 0;
            }
            #yd-sidebar {
                width: 125px;
            }
            #yd-main {
                padding: 12px;
            }
            .yd-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            #yd-header {
                padding: 12px;
            }
        }
    `;

    document.head.appendChild(style);

    const launcher = document.createElement('button');
    launcher.id = 'yd-launcher';
    launcher.textContent = 'YODAWY DASHBOARD';

    const overlay = document.createElement('div');
    overlay.id = 'yd-overlay';

    overlay.innerHTML = `
        <div id="yd-modal" role="dialog" aria-modal="true">
            <header id="yd-header">
                <div class="yd-brand">
                    <div class="yd-title">YODAWY DASHBOARD</div>
                    <div class="yd-sub">Automation Control Center</div>
                </div>

                <div class="yd-header-actions">
                    <span id="yd-status" class="yd-pill">Not connected</span>

                    <div class="yd-profile-wrap">
                        <button
                            id="yd-profile-trigger"
                            class="yd-profile-trigger"
                            data-action="profile-toggle"
                            aria-expanded="false"
                            aria-controls="yd-profile-menu"
                            type="button"
                        >
                            <span class="yd-avatar" id="yd-profile-avatar">U</span>

                            <span class="yd-profile-text">
                                <span id="yd-profile-name" class="yd-profile-name">User Name</span>
                                <span id="yd-profile-id" class="yd-profile-id">ID: Q-001</span>
                            </span>

                            <span class="yd-profile-chevron">⌄</span>
                        </button>

                        <div id="yd-profile-menu" class="yd-profile-menu" hidden>
                            <div class="yd-dropdown-heading">ACCOUNT &amp; CONNECTION</div>

                            <div class="yd-connection-row">
                                <span class="yd-connection-dot"></span>
                                <div>
                                    <div class="yd-connection-label">Connection Status</div>
                                    <div id="yd-profile-connection" class="yd-connection-value">Not connected</div>
                                </div>
                            </div>

                            <div class="yd-dropdown-divider"></div>

                            <button class="yd-dropdown-action" data-action="refresh-connection" type="button">
                                <span class="yd-action-icon">↻</span>
                                <span>
                                    <b>Refresh Connection</b>
                                    <small>Recheck account and GitHub access</small>
                                </span>
                            </button>

                            <button class="yd-dropdown-action" data-action="refresh-tools" type="button">
                                <span class="yd-action-icon">⟳</span>
                                <span>
                                    <b>Refresh Tools</b>
                                    <small>Reload the tools manifest and scripts</small>
                                </span>
                            </button>
                        </div>
                    </div>

                    <button class="yd-btn" data-action="close" type="button">Close</button>
                </div>
            </header>

            <div id="yd-body">
                <aside id="yd-sidebar"></aside>
                <main id="yd-main"></main>
            </div>
        </div>
    `;

    document.body.append(launcher, overlay);

    function header(title, description, action = '') {
        return `
            <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap;margin-bottom:20px">
                <div>
                    <div class="yd-title">${esc(title)}</div>
                    <div class="yd-sub">${esc(description)}</div>
                </div>
                ${action}
            </div>
        `;
    }

    function button(label, action, primary = false) {
        return `<button class="yd-btn ${primary ? 'yd-primary' : ''}" data-action="${esc(action)}" type="button">${esc(label)}</button>`;
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

    function card(title, value) {
        return `<div class="yd-card">${esc(title)}<div class="yd-value">${esc(value)}</div></div>`;
    }

    function overviewPage() {
        const available = state.tools.filter(permitted).length;

        return header(
            'Overview',
            `Signed in as ${state.settings.displayName || state.user?.name || CONFIG.userId}`,
            button('Test & Sync', 'sync', true)
        ) +
        `<div class="yd-grid">
            ${card('Available Tools', available)}
            ${card('Discovered Tools', state.tools.length)}
            <div class="yd-card">GitHub Status<div style="margin-top:8px"><span class="yd-pill">${esc(state.status)}</span></div></div>
        </div>
        <div class="yd-card">
            <b>Account</b>
            <div class="yd-row">
                <div class="yd-grow">${esc(state.user?.name || CONFIG.userId)}<div class="yd-sub">ID: ${esc(CONFIG.userId)}</div></div>
                <span class="yd-pill">${esc(state.user?.role || 'Unknown')}</span>
                <span class="yd-pill">${esc(state.user?.status || 'Unknown')}</span>
            </div>
        </div>
        <div class="yd-card"><b>Authentication</b>
            <div class="yd-row"><div class="yd-grow">System AUTH</div><span class="yd-pill">${state.authenticated ? 'Verified' : 'Not verified'}</span></div>
            <div class="yd-row"><div class="yd-grow">Personal AUTH</div><span class="yd-pill">${state.authenticated ? 'Verified' : 'Not verified'}</span></div>
        </div>`;
    }

    // =========================================================
    // MY TOOLS
    // Show visible tools with ON/OFF switch; disabled if not permitted.
    // =========================================================

    function toolsPage() {
        const tools = state.tools.filter(toolIsVisible);

        return header(
            'My Tools',
            'Tools visible to your account. Turning a tool ON/OFF requires permission.',
            button('Reload Tools', 'sync', true)
        ) +
        `<div class="yd-card"><b>Visible Tools (${tools.length})</b>
            ${tools.map(tool => {
                const key = permissionKey(tool);
                const allowed = permitted(tool);
                const enabledByUser = allowed && isToolEnabledByUser(tool);

                const status = allowed
                    ? 'Permitted'
                    : 'Permission required';

                const toggleControl = renderSwitch({
                    isOn: enabledByUser,
                    action: `toggle-my-tool:${key}`,
                    disabled: !allowed,
                    title: allowed
                        ? `Turn ${tool.name}${enabledByUser ? 'OFF' : 'ON'}`
                        : 'You do not have permission to run this tool.'
                });

                return `
                    <div class="yd-row">
                        <div class="yd-grow">
                            <b>${esc(tool.name)}</b>
                            <div class="yd-sub">${esc(tool.path)} — ID:${esc(key)}</div>
                            <div class="yd-sub">${esc(tool.description)}</div>
                        </div>

                        <span class="yd-pill">${esc(status)}</span>

                        ${toggleControl}
                    </div>
                `;
            }).join('') ||
            '<div class="yd-empty">No visible tools found. Check tool visibility settings.</div>'}
        </div>`;
    }

    function settingsPage() {
        const currentStartPage = state.settings.startPage || 'overview';

        return header(
            'My Settings',
            'Personal settings saved in your employee repository.'
        ) +
        `<div class="yd-card">
            <div class="yd-field"><label>GitHub Owner</label><input value="${esc(OWNER)}" readonly></div>
            <div class="yd-field"><label>Personal Repository</label><input value="${esc(state.user?.repository || '')}" readonly></div>
            <div class="yd-field"><label>Default Page</label>
                <select id="yd-start">
                    ${['overview', 'tools', 'settings'].map(value =>
                        `<option value="${value}" ${currentStartPage === value ? 'selected' : ''}>${value}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="yd-field"><label>Display Name</label><input id="yd-name" value="${esc(state.settings.displayName || state.user?.name || '')}"></div>
            ${button('Save Settings', 'save-settings', true)}
        </div>`;
    }

    function usersPage() {
        if (!canManage()) return deniedPage();

        return header(
            'Users Management',
            'User registry and tool permissions.'
        ) +
        `<div class="yd-card">
            <div class="yd-row"><div class="yd-grow">Authenticated user</div>${esc(state.user?.name || CONFIG.userId)}</div>
            <div class="yd-row"><div class="yd-grow">Role</div>${esc(state.user?.role || '')}</div>
            <div class="yd-row"><div class="yd-grow">Status</div>${esc(state.user?.status || '')}</div>
            <div class="yd-note">User editing is not enabled in this version.</div>
        </div>`;
    }

    // =========================================================
    // SHARED TOOLS
    // =========================================================

    function sharedPage() {
        if (!canManage()) {
            return deniedPage();
        }

        return header(
            'Shared Tools',
            'All tools discovered from the dashboard repository.'
        ) +
        `<div class="yd-card">
            ${state.tools.map(tool => {
                const allowed = permitted(tool);
                const policy = visibilityPolicy(tool);

                const visibility = String(
                    policy.visibility || 'PUBLIC'
                ).toUpperCase();

                const type = permissionType(tool);

                const permissionLabel = allowed
                    ? 'Permitted'
                    : 'Not permitted';

                return `
                    <div class="yd-row">
                        <div class="yd-grow">
                            <b>${esc(tool.name)}</b>
                            <div class="yd-sub">${esc(tool.path)}</div>
                            <div class="yd-sub">Visibility: ${esc(visibility)}</div>
                            <div class="yd-sub">Permission type: ${esc(type)}</div>
                        </div>

                        <span class="yd-pill">${esc(permissionLabel)}</span>
                    </div>
                `;
            }).join('') ||
            '<div class="yd-empty">No tools loaded.</div>'}
        </div>`;
    }

    // =========================================================
    // VISIBILITY MANAGEMENT (SUPER ADMIN ONLY)
    // User dropdown + All Users Frozen Matrix View + Single User Tool Switches
    // =========================================================

    function visibilityPage() {
        if (!canManageVisibility()) {
            return deniedPage();
        }

        const usersList = state.users.length
            ? state.users
            : [{ id: CONFIG.userId, name: state.user?.name || CONFIG.userId, role: 'Super Admin', status: 'Active' }];

        const selectedUser = state.visibilitySelectedUser || 'ALL';

        const dropdownHtml = `
            <div class="yd-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
                    <div class="yd-field" style="flex:1;min-width:260px;margin:0">
                        <label><b>Select User to Control Tool Visibility</b></label>
                        <select id="yd-vis-user-filter">
                            <option value="ALL" ${selectedUser === 'ALL' ? 'selected' : ''}>All Users (Matrix View)</option>
                            ${usersList.map(u => {
                                const uid = String(u.id || '').trim();
                                const uname = String(u.name || uid).trim();
                                return `<option value="${esc(uid)}" ${selectedUser === uid ? 'selected' : ''}>${esc(uname)} (${esc(uid)})</option>`;
                            }).join('')}
                        </select>
                    </div>
                    <div>
                        ${state.visibilityDirty ? '<span class="yd-pill" style="margin-right:8px">Unsaved changes</span>' : ''}
                        ${button('Save Visibility', 'save-visibility', true)}
                    </div>
                </div>
            </div>
        `;

        if (selectedUser === 'ALL') {
            const matrixHtml = `
                <div class="yd-card">
                    <div style="margin-bottom:12px">
                        <b>All Users &amp; Tools Visibility Matrix</b>
                        <div class="yd-sub">Tool names (left column) and User names (top row) remain frozen while scrolling.</div>
                    </div>
                    <div class="yd-matrix-scroll">
                        <table class="yd-matrix-table">
                            <thead>
                                <tr>
                                    <th class="yd-sticky-col">Tool / Policy</th>
                                    ${usersList.map(u => {
                                        const uid = String(u.id || '').trim();
                                        const uname = String(u.name || uid).trim();
                                        return `
                                            <th>
                                                <div>${esc(uname)}</div>
                                                <div class="yd-sub">${esc(uid)}</div>
                                            </th>
                                        `;
                                    }).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${state.tools.map(tool => {
                                    const key = permissionKey(tool);
                                    const policy = ensureToolVisibilityRecord(key);
                                    const currentVis = String(policy.visibility || 'PRIVATE').toUpperCase();

                                    return `
                                        <tr>
                                            <td class="yd-sticky-col">
                                                <b>${esc(tool.name)}</b>
                                                <div class="yd-sub">ID: ${esc(key)}</div>
                                                <div style="margin-top:6px">
                                                    <select class="yd-policy-select" data-vis-policy-tool="${esc(key)}">
                                                        <option value="PUBLIC" ${currentVis === 'PUBLIC' ? 'selected' : ''}>PUBLIC</option>
                                                        <option value="PRIVATE" ${currentVis === 'PRIVATE' ? 'selected' : ''}>PRIVATE</option>
                                                        <option value="SELECTED_USERS" ${currentVis === 'SELECTED_USERS' ? 'selected' : ''}>SELECTED_USERS</option>
                                                    </select>
                                                </div>
                                            </td>
                                            ${usersList.map(u => {
                                                const uid = String(u.id || '').trim().toUpperCase();
                                                const isSuper = uid === 'Q-001' || String(u.role || '').trim().toLowerCase() === 'super admin';
                                                const visibleForUser = isToolVisibleForUser(tool, uid);

                                                return `
                                                    <td>
                                                        ${renderSwitch({
                                                            isOn: visibleForUser,
                                                            action: `toggle-vis-cell:${key}:${uid}`,
                                                            disabled: isSuper,
                                                            title: isSuper
                                                                ? 'Super Admin always has visibility.'
                                                                : `Toggle ${tool.name} visibility for${u.name || uid}`
                                                        })}
                                                    </td>
                                                `;
                                            }).join('')}
                                        </tr>
                                    `;
                                }).join('') || '<tr><td colspan="99" class="yd-empty">No tools found.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            return header(
                'Visibility Management',
                'Control tool visibility across all users or per individual user (Super Admin Only).'
            ) + dropdownHtml + matrixHtml;
        }

        const targetUser = usersList.find(
            u => String(u.id || '').trim().toUpperCase() === selectedUser.toUpperCase()
        ) || { id: selectedUser, name: selectedUser, role: 'User', status: 'Inactive' };

        const targetUid = String(targetUser.id || '').trim().toUpperCase();
        const isTargetSuper = targetUid === 'Q-001' || String(targetUser.role || '').trim().toLowerCase() === 'super admin';

        const singleUserHtml = `
            <div class="yd-card">
                <div class="yd-row" style="padding-top:0">
                    <div class="yd-grow">
                        <b>${esc(targetUser.name || targetUid)}</b>
                        <div class="yd-sub">ID: ${esc(targetUid)} — Repository: ${esc(targetUser.repository || 'N/A')}</div>
                    </div>
                    <span class="yd-pill">${esc(targetUser.role || 'User')}</span>
                    <span class="yd-pill">${esc(targetUser.status || 'Unknown')}</span>
                </div>

                ${state.tools.map(tool => {
                    const key = permissionKey(tool);
                    const policy = ensureToolVisibilityRecord(key);
                    const currentVis = String(policy.visibility || 'PRIVATE').toUpperCase();
                    const visibleForUser = isToolVisibleForUser(tool, targetUid);

                    return `
                        <div class="yd-row">
                            <div class="yd-grow">
                                <b>${esc(tool.name)}</b>
                                <div class="yd-sub">${esc(tool.path)} — ID:${esc(key)}</div>
                                <div class="yd-sub">Current Policy: <b>${esc(currentVis)}</b></div>
                            </div>
                            ${renderSwitch({
                                isOn: visibleForUser,
                                action: `toggle-vis-cell:${key}:${targetUid}`,
                                disabled: isTargetSuper,
                                title: isTargetSuper
                                    ? 'Super Admin always has visibility.'
                                    : `Turn visibility ${visibleForUser ? 'OFF' : 'ON'} for ${targetUser.name || targetUid}`
                            })}
                        </div>
                    `;
                }).join('') || '<div class="yd-empty">No tools found.</div>'}
            </div>
        `;

        return header(
            'Visibility Management',
            'Control tool visibility across all users or per individual user (Super Admin Only).'
        ) + dropdownHtml + singleUserHtml;
    }

    function systemPage() {
        if (!canManage()) return deniedPage();

        return header(
            'System Settings',
            'Repository and connection information.'
        ) +
        `<div class="yd-card">
            <div class="yd-row"><div class="yd-grow">Owner</div>${esc(OWNER)}</div>
            <div class="yd-row"><div class="yd-grow">Branch</div>${esc(YODAWY.branch)}</div>
            <div class="yd-row"><div class="yd-grow">Dashboard Repository</div>${esc(YODAWY.dashboardRepository)}</div>
            <div class="yd-row"><div class="yd-grow">Users Repository</div>${esc(CONFIG.usersRepository)}</div>
            <div class="yd-row"><div class="yd-grow">Tools Source</div>${esc(YODAWY.dashboardRepository)}/${esc(CONFIG.toolsDirectory)}</div>
            <div class="yd-row"><div class="yd-grow">Tools Manifest</div>${esc(CONFIG.manifestPath)}</div>
            <div class="yd-note">Tokens are read from the configured authentication source and are not displayed here.</div>
        </div>`;
    }

    function logsPage() {
        return header(
            'Activity Logs',
            'Recent operations in this browser session.',
            button('Clear Logs', 'clear-logs')
        ) +
        `<div class="yd-card">
            ${state.logs.map(item => `
                <div class="yd-row">
                    <div class="yd-grow">${esc(item.message)}<div class="yd-sub">${esc(item.time)}</div></div>
                    <span class="yd-pill">${esc(item.type)}</span>
                </div>
            `).join('') || '<div class="yd-empty">No activity yet.</div>'}
        </div>`;
    }

    function deniedPage() {
        return header(
            'Access denied',
            'This section is available to administrators only.'
        ) +
        '<div class="yd-error">Your account does not have administrator access.</div>';
    }

    // =========================================================
    // RENDER
    // =========================================================

    function render() {
        const sidebarEl = $('#yd-sidebar');
        const mainEl = $('#yd-main');

        if (!sidebarEl || !mainEl) return;

        $('#yd-status').textContent = state.loading
            ? 'Loading…'
            : state.status;

        const profileName = String(
            state.settings.displayName ||
            state.user?.name ||
            CONFIG.userId ||
            'User'
        ).trim();

        const profileId = CONFIG.userId;
        const profileNameElement = $('#yd-profile-name');
        const profileIdElement = $('#yd-profile-id');
        const profileAvatarElement = $('#yd-profile-avatar');
        const profileConnectionElement = $('#yd-profile-connection');
        const connectionDot = $('.yd-connection-dot');

        if (profileNameElement) {
            profileNameElement.textContent = profileName;
        }

        if (profileIdElement) {
            profileIdElement.textContent = `ID: ${profileId}`;
        }

        if (profileAvatarElement) {
            profileAvatarElement.textContent =
                profileName.charAt(0).toUpperCase() || 'U';
        }

        if (profileConnectionElement) {
            profileConnectionElement.textContent = state.loading
                ? 'Connecting…'
                : state.status;
        }

        if (connectionDot) {
            connectionDot.style.background = state.loading
                ? '#c58a32'
                : state.authenticated && state.status === 'Connected'
                    ? '#39865b'
                    : '#c94b58';
        }

        const sections = [
            ['overview', 'Overview'],
            ['tools', 'My Tools'],
            ['settings', 'My Settings'],
            ...(canManage()
                ? [
                    ['users', 'Users Management'],
                    ['shared', 'Shared Tools'],
                    ...(canManageVisibility() ? [['visibility', 'Visibility']] : []),
                    ['system', 'System Settings']
                ]
                : []),
            ['logs', 'Activity Logs']
        ];

        if (!sections.some(([id]) => id === state.section)) {
            state.section = 'overview';
        }

        sidebarEl.innerHTML = sections.map(([id, name]) =>
            `<button class="yd-nav ${state.section === id ? 'active' : ''}" data-section="${id}" type="button">${name}</button>`
        ).join('');

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
            ? '<div class="yd-empty">Connecting and loading tools…</div>'
            : !state.authenticated
                ? `<div class="yd-card">
                    <div class="yd-title">Authentication Required</div>
                    <p class="yd-sub">Connect to GitHub to verify your account and load permitted tools.</p>
                    ${button('Connect & Load Tools', 'sync', true)}
                    ${state.error ? `<div class="yd-error">${esc(state.error)}</div>` : ''}
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
                state.status = 'Reconnecting';

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
