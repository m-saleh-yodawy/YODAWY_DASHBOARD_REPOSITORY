(() => {
    'use strict';

    if (window.__YODAWY_DASHBOARD_ENGINE_RUNNING__) return;
    window.__YODAWY_DASHBOARD_ENGINE_RUNNING__ = true;

    // =========================================================
    // CONFIGURATION — replace token placeholders manually
    // =========================================================

    const CONFIG = {
        owner: 'm-saleh-yodawy',
        branch: 'main',

        userId: 'Q-001',

        dashboardRepo: 'YODAWY_DASHBOARD_REPOSITORY',
        usersRepo: 'YODAWY_USERS_REPOSITORY',
        toolsRepo: 'YODAWY_TOOLS_REPOSITORY',
        personalRepo: 'Q-001_MOHAMED_SALEH',

        tokens: {
            usersRead: 'PASTE_USERS_READ_TOKEN',
            usersWrite: 'PASTE_USERS_WRITE_TOKEN',
            tools: 'PASTE_TOOLS_TOKEN',
            personal: 'PASTE_PERSONAL_REPOSITORY_TOKEN'
        },

        paths: {
            users: 'CONFIG/users.json',
            permissions: 'CONFIG/tool-permissions.json',
            tools: 'TOOLS',
            settings: 'DASHBOARD/dashboard-settings.json'
        }
    };

    const PURPLE = '#875A7B';
    const DARK = '#68465f';

    const state = {
        section: 'overview',
        users: [],
        permissions: {},
        currentUser: null,
        tools: [],
        settings: {},
        checks: [],
        logs: [],
        status: 'Not connected',
        error: '',
        loading: false,
        initialized: false,
        selectedTool: ''
    };

    let saveQueue = Promise.resolve();

    // =========================================================
    // UTILITIES
    // =========================================================

    const $ = (selector, root = document) =>
        root.querySelector(selector);

    const $$ = (selector, root = document) =>
        [...root.querySelectorAll(selector)];

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    }

    function log(message, type = 'info') {
        state.logs.unshift({
            time: new Date().toLocaleString(),
            message: String(message),
            type
        });

        state.logs = state.logs.slice(0, 100);

        if (state.section === 'logs') render();
    }

    function isWrite(method) {
        return !['GET', 'HEAD'].includes(
            String(method).toUpperCase()
        );
    }

    function tokenFor(repo, method) {
        const write = isWrite(method);

        if (repo === CONFIG.usersRepo) {
            return write
                ? CONFIG.tokens.usersWrite
                : CONFIG.tokens.usersRead;
        }

        if (repo === CONFIG.toolsRepo) {
            return CONFIG.tokens.tools;
        }

        if (repo === CONFIG.personalRepo) {
            return CONFIG.tokens.personal;
        }

        throw new Error(`No token configured for repository: ${repo}`);
    }

    function validateConfig(repo, token) {
        if (!CONFIG.owner || !repo || !CONFIG.branch) {
            throw new Error('GitHub owner, repository, and branch are required.');
        }

        if (!token || token.startsWith('PASTE_')) {
            throw new Error(`Add the GitHub token for ${repo} in CONFIG.tokens.`);
        }
    }

    function githubUrl(repo, path, method) {
        const encodedPath = path
            .split('/')
            .map(encodeURIComponent)
            .join('/');

        const base =
            `https://api.github.com/repos/` +
            `${encodeURIComponent(CONFIG.owner)}/` +
            `${encodeURIComponent(repo)}/contents/${encodedPath}`;

        return method.toUpperCase() === 'GET'
            ? `${base}?ref=${encodeURIComponent(CONFIG.branch)}`
            : base;
    }

    // =========================================================
    // GITHUB API
    // =========================================================

    async function apiRequest(method, repo, path, body) {
        const token = tokenFor(repo, method);
        validateConfig(repo, token);

        let response;

        try {
            response = await fetch(githubUrl(repo, path, method), {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Content-Type': 'application/json'
                },
                body: body ? JSON.stringify(body) : undefined,
                credentials: 'omit',
                cache: 'no-store'
            });
        } catch (error) {
            throw new Error(
                `GitHub network request failed: ${error.message || error}`
            );
        }

        let data = {};

        try {
            data = await response.json();
        } catch {
            // Keep empty response data.
        }

        if (!response.ok) {
            const error = new Error(
                data.message || `GitHub API error (${response.status})`
            );

            error.status = response.status;
            throw error;
        }

        return data;
    }

    function decodeBase64UTF8(content) {
        const binary = atob(String(content || '').replace(/\s/g, ''));
        const bytes = Uint8Array.from(
            binary,
            character => character.charCodeAt(0)
        );

        return new TextDecoder().decode(bytes);
    }

    function encodeBase64UTF8(content) {
        const bytes = new TextEncoder().encode(String(content));
        let binary = '';

        for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode(
                ...bytes.subarray(i, i + 8192)
            );
        }

        return btoa(binary);
    }

    async function readText(repo, path) {
        const result = await apiRequest('GET', repo, path);

        if (typeof result.content !== 'string') {
            throw new Error(`No file content returned for ${path}.`);
        }

        return {
            content: decodeBase64UTF8(result.content),
            sha: result.sha || ''
        };
    }

    async function readJSON(repo, path) {
        const result = await readText(repo, path);

        try {
            return JSON.parse(result.content);
        } catch {
            throw new Error(`Invalid JSON in ${repo}/${path}.`);
        }
    }

    async function writeContent(repo, path, content, message) {
        let current = null;

        try {
            current = await apiRequest('GET', repo, path);
        } catch (error) {
            if (error.status !== 404) throw error;
        }

        const body = {
            message: message || `Update ${path} via YODAWY Dashboard`,
            content: encodeBase64UTF8(content),
            branch: CONFIG.branch
        };

        if (current?.sha) body.sha = current.sha;

        const result = await apiRequest('PUT', repo, path, body);

        log(`Saved ${repo}/${path}.`, 'success');

        return result;
    }

    async function writeJSON(repo, path, value) {
        return writeContent(
            repo,
            path,
            JSON.stringify(value, null, 2) + '\n'
        );
    }

    function errorMessage(error) {
        if (error?.status === 401) return '401: Invalid or expired token.';
        if (error?.status === 403) return '403: Permission denied or rate limit.';
        if (error?.status === 404) return '404: Repository/file not found or inaccessible.';
        if (error?.status === 409) return '409: Branch conflict. Reload and retry.';
        if (error?.status === 422) return '422: Invalid request or file update conflict.';

        return error?.message || String(error || 'Unknown error');
    }

    // =========================================================
    // USER AND PERMISSION MANAGEMENT
    // =========================================================

    function canManage() {
        return Boolean(
            state.currentUser &&
            state.currentUser.status === 'Active' &&
            String(state.currentUser.role || '').toLowerCase() === 'admin'
        );
    }

    function permissionKey(tool) {
        return tool.path
            .split('/')
            .pop()
            .replace(/\.user\.js$/i, '')
            .replace(/\.js$/i, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toUpperCase();
    }

    function getToolPermission(tool) {
        if (!state.currentUser || state.currentUser.status !== 'Active') {
            return false;
        }

        const permissions = state.permissions[CONFIG.userId];

        if (!permissions || typeof permissions !== 'object') {
            return false;
        }

        return permissions[permissionKey(tool)] === true;
    }

    function applyToolSettings() {
        const savedTools =
            state.settings.tools &&
            typeof state.settings.tools === 'object'
                ? state.settings.tools
                : {};

        for (const tool of state.tools) {
            const saved =
                savedTools[permissionKey(tool)] ??
                savedTools[tool.path];

            tool.enabled = typeof saved === 'boolean'
                ? saved
                : saved && typeof saved.enabled === 'boolean'
                    ? saved.enabled
                    : true;
        }
    }

    async function editUser(index) {
        if (!canManage()) throw new Error('Admin access required.');

        const existing = index >= 0 ? state.users[index] : {};

        const idInput = prompt('User ID:', existing.id || '');
        if (idInput === null) return;

        const id = idInput.trim().toUpperCase();

        if (!/^[A-Z0-9][A-Z0-9-]*$/.test(id)) {
            throw new Error('Use letters, numbers, and hyphens for User ID.');
        }

        if (state.users.some((user, i) =>
            String(user.id).toUpperCase() === id && i !== index
        )) {
            throw new Error('This User ID already exists.');
        }

        const name = prompt('User name:', existing.name || '');
        if (name === null) return;
        if (!name.trim()) throw new Error('User name cannot be empty.');

        const repository = prompt(
            'Personal repository:',
            existing.repository || ''
        );
        if (repository === null) return;

        const role = prompt(
            'Role (Admin or User):',
            existing.role || 'User'
        );
        if (role === null) return;

        if (!['admin', 'user'].includes(role.trim().toLowerCase())) {
            throw new Error('Role must be Admin or User.');
        }

        const status = prompt(
            'Status (Active, Pending, Disabled):',
            existing.status || 'Active'
        );
        if (status === null) return;

        const statuses = {
            active: 'Active',
            pending: 'Pending',
            disabled: 'Disabled'
        };

        if (!statuses[status.trim().toLowerCase()]) {
            throw new Error('Invalid user status.');
        }

        const updated = {
            ...existing,
            id,
            name: name.trim(),
            repository: repository.trim(),
            role: role.trim().toLowerCase() === 'admin' ? 'Admin' : 'User',
            status: statuses[status.trim().toLowerCase()]
        };

        const users = [...state.users];

        if (index >= 0) users[index] = updated;
        else users.push(updated);

        await writeJSON(CONFIG.usersRepo, CONFIG.paths.users, { users });

        const permissions = { ...state.permissions };

        if (!permissions[id]) permissions[id] = {};

        await writeJSON(
            CONFIG.usersRepo,
            CONFIG.paths.permissions,
            permissions
        );

        log(`${index >= 0 ? 'Updated' : 'Added'} user ${updated.name}.`, 'success');

        await loadConfig();
    }

    async function deleteUser(index) {
        if (!canManage()) throw new Error('Admin access required.');

        const user = state.users[index];
        if (!user) return;

        if (String(user.id).toUpperCase() === CONFIG.userId.toUpperCase()) {
            throw new Error('You cannot delete the account running this dashboard.');
        }

        if (!confirm(`Delete ${user.name || user.id}?`)) return;

        const users = state.users.filter((_, i) => i !== index);
        const permissions = { ...state.permissions };
        delete permissions[user.id];

        await writeJSON(CONFIG.usersRepo, CONFIG.paths.users, { users });
        await writeJSON(CONFIG.usersRepo, CONFIG.paths.permissions, permissions);

        log(`Deleted user ${user.id}.`, 'success');
        await loadConfig();
    }

    async function editPermissions(userId) {
        if (!canManage()) throw new Error('Admin access required.');

        const user = state.users.find(item => item.id === userId);
        if (!user) throw new Error('User not found.');

        const allPermissions = { ...state.permissions };
        const permissions = { ...(allPermissions[userId] || {}) };

        for (const tool of state.tools) {
            const key = permissionKey(tool);
            const answer = prompt(
                `${user.name} — ${tool.name}\nPermission key: ${key}\nEnter true or false:`,
                String(permissions[key] === true)
            );

            if (answer === null) return;

            const normalized = answer.trim().toLowerCase();

            if (!['true', 'false'].includes(normalized)) {
                throw new Error('Permission must be true or false.');
            }

            permissions[key] = normalized === 'true';
        }

        allPermissions[userId] = permissions;

        await writeJSON(
            CONFIG.usersRepo,
            CONFIG.paths.permissions,
            allPermissions
        );

        log(`Updated permissions for ${userId}.`, 'success');
        await loadConfig();
    }

    // =========================================================
    // TOOL DISCOVERY AND EXECUTION
    // =========================================================

    function parseMetadata(source, path) {
        const header = source.match(
            /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/
        );

        const metadata = header ? header[1] : '';

        const values = key => [
            ...metadata.matchAll(
                new RegExp(
                    '^\\s*//\\s*@' + key + '\\s+(.+?)\\s*$',
                    'gm'
                )
            )
        ].map(match => match[1].trim());

        const filename = path.split('/').pop();

        return {
            name: values('name')[0] ||
                filename.replace(/\.user\.js$/i, '').replace(/\.js$/i, ''),
            path,
            description: values('description')[0] || path,
            matches: [...values('match'), ...values('include')],
            excludes: [...values('exclude'), ...values('exclude-match')],
            grants: values('grant').filter(value => value !== 'none'),
            requires: values('require'),
            metadataFound: Boolean(header)
        };
    }

    function matchesPage(tool) {
        if (!tool.metadataFound || !tool.matches.length) return false;

        const href = location.href;

        if (tool.excludes.some(pattern => simpleMatch(pattern, href))) {
            return false;
        }

        return tool.matches.some(pattern => simpleMatch(pattern, href));
    }

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
                scheme.toLowerCase() !== url.protocol.slice(0, -1).toLowerCase()
            ) return false;

            const host = hostPattern.toLowerCase();
            const actualHost = url.hostname.toLowerCase();

            if (host !== '*') {
                if (host.startsWith('*.')) {
                    const suffix = host.slice(2);

                    if (actualHost !== suffix && !actualHost.endsWith('.' + suffix)) {
                        return false;
                    }
                } else if (host !== actualHost) {
                    return false;
                }
            }

            const escaped = pathPattern
                .split('*')
                .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('.*');

            return new RegExp('^' + escaped + '$')
                .test(url.pathname + url.search + url.hash);
        } catch {
            return false;
        }
    }

    function runTool(tool) {
        if (!state.initialized) return;
        if (!state.currentUser || state.currentUser.status !== 'Active') return;
        if (!getToolPermission(tool) || !tool.enabled || !matchesPage(tool)) return;

        if (tool.requires.length) {
            log(`${tool.name}: @require dependencies need separate installation.`, 'warning');
            return;
        }

        const unsupported = tool.grants.filter(
            grant => grant !== 'unsafeWindow'
        );

        if (unsupported.length) {
            log(`${tool.name}: unsupported @grant: ${unsupported.join(', ')}`, 'warning');
            return;
        }

        const runKey = '__YODAWY_TOOL_' +
            tool.path.replace(/[^a-zA-Z0-9]/g, '_');

        if (window[runKey]) return;

        try {
            // Tools are executable code fetched from the configured tools repository.
            // Only grant execution access to repositories and users you trust.
            const runner = new Function(
                'unsafeWindow',
                `"use strict";\n${tool.source}\n`
            );

            runner(window);
            window[runKey] = true;

            log(`Started ${tool.name}.`, 'success');
        } catch (error) {
            log(`${tool.name}: ${error.message || error}`, 'error');
        }
    }

    async function loadTools() {
        const listing = await apiRequest(
            'GET',
            CONFIG.toolsRepo,
            CONFIG.paths.tools
        );

        if (!Array.isArray(listing)) {
            throw new Error('TOOLS path did not return a directory listing.');
        }

        const files = listing.filter(item =>
            item.type === 'file' &&
            /\.js$/i.test(item.name) &&
            !/\.min\.js$/i.test(item.name)
        );

        const results = await Promise.allSettled(
            files.map(async item => {
                const file = await readText(CONFIG.toolsRepo, item.path);

                return {
                    ...parseMetadata(file.content, item.path),
                    source: file.content,
                    sha: file.sha,
                    enabled: true
                };
            })
        );

        state.tools = results
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value)
            .sort((a, b) => a.name.localeCompare(b.name));

        for (const result of results) {
            if (result.status === 'rejected') {
                log(errorMessage(result.reason), 'error');
            }
        }

        applyToolSettings();
    }

    // =========================================================
    // PERSONAL SETTINGS
    // =========================================================

    function saveSettings(update) {
        saveQueue = saveQueue.catch(() => {}).then(async () => {
            const next = update({ ...state.settings });

            next.owner = CONFIG.owner;
            next.repository = CONFIG.personalRepo;
            next.updatedAt = new Date().toISOString();

            await writeJSON(
                CONFIG.personalRepo,
                CONFIG.paths.settings,
                next
            );

            state.settings = next;
            applyToolSettings();

            return next;
        });

        return saveQueue;
    }

    async function savePersonalSettings() {
        const startPage = $('#yd-start-page')?.value || 'overview';
        const displayName = $('#yd-display-name')?.value.trim() || '';

        await saveSettings(settings => ({
            ...settings,
            startPage,
            displayName
        }));

        log('Personal settings saved.', 'success');
        render();
    }

    async function toggleTool(path, enabled) {
        const tool = state.tools.find(item => item.path === path);
        if (!tool) return;

        if (enabled && !getToolPermission(tool)) {
            throw new Error('This tool is not permitted for your account.');
        }

        await saveSettings(settings => {
            const tools = { ...(settings.tools || {}) };

            tools[permissionKey(tool)] = {
                enabled
            };

            return { ...settings, tools };
        });

        tool.enabled = enabled;

        if (enabled) runTool(tool);

        log(`${tool.name}: ${enabled ? 'enabled' : 'disabled'}.`, 'success');
        render();
    }

    // =========================================================
    // SHARED TOOL EDITOR
    // =========================================================

    async function saveToolSource() {
        if (!canManage()) throw new Error('Admin access required.');

        const path = $('#yd-tool-select')?.value;
        const source = $('#yd-tool-source')?.value;

        if (!path || typeof source !== 'string') {
            throw new Error('Select a JavaScript file first.');
        }

        if (!source.trim() && !confirm('Save an empty JavaScript file?')) return;

        await writeContent(
            CONFIG.toolsRepo,
            path,
            source,
            `Update ${path} via YODAWY Dashboard`
        );

        const metadata = parseMetadata(source, path);
        const tool = state.tools.find(item => item.path === path);

        if (tool) Object.assign(tool, metadata, { source });

        log(`${path} saved. Reload tools to apply changes.`, 'success');
        render();
    }

    async function reloadSelectedTool() {
        if (!canManage()) throw new Error('Admin access required.');

        const path = $('#yd-tool-select')?.value;
        if (!path) throw new Error('Select a JavaScript file first.');

        const file = await readText(CONFIG.toolsRepo, path);
        const metadata = parseMetadata(file.content, path);
        const old = state.tools.find(tool => tool.path === path);

        const next = {
            ...metadata,
            source: file.content,
            sha: file.sha,
            enabled: old ? old.enabled : true
        };

        state.tools = [
            ...state.tools.filter(tool => tool.path !== path),
            next
        ].sort((a, b) => a.name.localeCompare(b.name));

        state.selectedTool = path;
        log(`${path} reloaded.`, 'success');
        render();
    }

    // =========================================================
    // CONNECTION AND CONFIGURATION
    // =========================================================

    async function checkPath(label, repo, path) {
        try {
            await apiRequest('GET', repo, path);

            return {
                label,
                repo,
                path,
                ok: true,
                message: 'GitHub API request succeeded.'
            };
        } catch (error) {
            return {
                label,
                repo,
                path,
                ok: false,
                message: errorMessage(error)
            };
        }
    }

    async function loadConfig() {
        if (state.loading) return;

        state.loading = true;
        state.error = '';
        render();

        try {
            const [usersData, permissionsData] = await Promise.all([
                readJSON(CONFIG.usersRepo, CONFIG.paths.users),
                readJSON(CONFIG.usersRepo, CONFIG.paths.permissions)
            ]);

            state.users = Array.isArray(usersData)
                ? usersData
                : Array.isArray(usersData?.users)
                    ? usersData.users
                    : [];

            state.permissions =
                permissionsData &&
                typeof permissionsData === 'object' &&
                !Array.isArray(permissionsData)
                    ? permissionsData
                    : {};

            state.currentUser = state.users.find(user =>
                String(user.id || '').toUpperCase() ===
                CONFIG.userId.toUpperCase()
            ) || null;

            if (!state.currentUser) {
                throw new Error(
                    `User ${CONFIG.userId} is not registered in ${CONFIG.paths.users}.`
                );
            }

            if (state.currentUser.status !== 'Active') {
                throw new Error(
                    `Account status is ${state.currentUser.status || 'Unknown'}.`
                );
            }

            const personalRepo =
                state.currentUser.repository || CONFIG.personalRepo;

            // This environment uses the employee's repository for personal settings.
            CONFIG.personalRepo = personalRepo;

            const results = await Promise.all([
                checkPath('Users registry', CONFIG.usersRepo, CONFIG.paths.users),
                checkPath('Tool permissions', CONFIG.usersRepo, CONFIG.paths.permissions),
                checkPath('Tools directory', CONFIG.toolsRepo, CONFIG.paths.tools),
                checkPath('Personal settings', CONFIG.personalRepo, CONFIG.paths.settings)
            ]);

            state.checks = results;

            try {
                state.settings = await readJSON(
                    CONFIG.personalRepo,
                    CONFIG.paths.settings
                );
            } catch (error) {
                if (error.status !== 404) {
                    log(`Settings: ${errorMessage(error)}`, 'warning');
                }

                state.settings = {};
            }

            try {
                await loadTools();
            } catch (error) {
                state.tools = [];
                log(`Tool discovery: ${errorMessage(error)}`, 'error');
            }

            const connected = results.filter(result => result.ok).length;

            state.status = connected === results.length
                ? 'Connected'
                : `Partially connected (${connected}/${results.length})`;

            state.initialized = true;

            for (const tool of state.tools) runTool(tool);

            log(
                `GitHub sync complete: ${connected}/${results.length} paths accessible.`,
                connected === results.length ? 'success' : 'warning'
            );
        } catch (error) {
            state.error = errorMessage(error);
            state.status = 'Connection failed';
            state.initialized = false;

            log(state.error, 'error');
        } finally {
            state.loading = false;
            render();
        }
    }

    // =========================================================
    // DASHBOARD UI
    // =========================================================

    const style = document.createElement('style');

    style.textContent = `
      #yd-launcher{position:fixed;right:22px;bottom:22px;z-index:2147483000;
        background:${PURPLE};color:#fff;border:0;border-radius:40px;padding:13px 18px;
        font:700 13px system-ui;cursor:pointer;box-shadow:0 8px 25px #0003}
      #yd-overlay{position:fixed;inset:0;z-index:2147483001;display:none;
        align-items:center;justify-content:center;padding:3vh 3vw;background:#17131c99}
      #yd-overlay.open{display:flex}
      #yd-modal{width:100%;height:100%;max-width:1450px;max-height:920px;
        background:#f7f6f9;color:#29242e;border-radius:16px;overflow:hidden;
        display:flex;flex-direction:column;font:14px/1.5 system-ui}
      #yd-modal *{box-sizing:border-box}
      #yd-header{display:flex;align-items:center;justify-content:space-between;
        padding:16px 22px;background:#fff;border-bottom:1px solid #e9e4ec}
      #yd-body{display:flex;flex:1;min-height:0}
      #yd-sidebar{width:210px;flex-shrink:0;background:#fff;padding:15px 10px;
        border-right:1px solid #e9e4ec}
      #yd-main{flex:1;min-width:0;overflow:auto;padding:25px}
      .yd-nav{display:block;width:100%;text-align:left;border:0;border-radius:8px;
        padding:12px;background:transparent;color:#655c6a;cursor:pointer;margin-bottom:4px}
      .yd-nav.active{background:#f1e8f1;color:${DARK};font-weight:800}
      .yd-title{font-size:21px;font-weight:800}
      .yd-sub{font-size:11px;color:#8c8492}
      .yd-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
      .yd-card{background:#fff;border:1px solid #eee8f0;border-radius:12px;
        padding:17px;margin-bottom:15px;min-width:0}
      .yd-value{font-size:26px;font-weight:800;margin-top:8px}
      .yd-btn{border:1px solid #e5dce8;background:#fff;color:${DARK};border-radius:8px;
        padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;margin:2px}
      .yd-primary{background:${PURPLE};color:#fff;border-color:${PURPLE}}
      .yd-field{display:flex;flex-direction:column;gap:6px;margin:12px 0}
      .yd-field input,.yd-field select,.yd-field textarea{width:100%;padding:10px;
        border:1px solid #e3dce6;border-radius:8px;font:12px system-ui}
      .yd-field textarea{min-height:320px;font-family:monospace;white-space:pre}
      .yd-table{border-collapse:collapse;width:100%;background:#fff;font-size:12px}
      .yd-table th,.yd-table td{padding:10px;border-bottom:1px solid #eee;text-align:left}
      .yd-row{display:flex;align-items:center;gap:12px;padding:12px 0;
        border-bottom:1px solid #eee}
      .yd-grow{flex:1;min-width:0;overflow-wrap:anywhere}
      .yd-note{padding:12px;background:#f1e8f1;border-radius:8px;margin-bottom:14px;
        font-size:12px;overflow-wrap:anywhere}
      .yd-error{padding:12px;background:#fbe6e9;color:#a83d51;border-radius:8px;
        margin-bottom:14px;overflow-wrap:anywhere}
      .yd-pill{display:inline-block;padding:4px 8px;background:#eee4ef;
        color:${DARK};border-radius:7px;font-size:11px}
      .yd-empty{padding:24px;text-align:center;color:#8c8492}
      @media(max-width:800px){#yd-overlay{padding:0}#yd-modal{border-radius:0}
        #yd-sidebar{width:115px}#yd-main{padding:12px}.yd-grid{grid-template-columns:1fr 1fr}}
    `;

    document.head.appendChild(style);

    const launcher = document.createElement('button');
    launcher.id = 'yd-launcher';
    launcher.textContent = 'YODAWY DASHBOARD';
    document.body.appendChild(launcher);

    const overlay = document.createElement('div');
    overlay.id = 'yd-overlay';

    overlay.innerHTML = `
      <div id="yd-modal" role="dialog" aria-modal="true">
        <header id="yd-header">
          <div>
            <div class="yd-title">YODAWY DASHBOARD</div>
            <div class="yd-sub">Automation Control Center</div>
          </div>
          <div>
            <span id="yd-role" class="yd-pill">Loading…</span>
            <button class="yd-btn" data-action="close">Close</button>
          </div>
        </header>
        <div id="yd-body">
          <aside id="yd-sidebar"></aside>
          <main id="yd-main"></main>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    launcher.addEventListener('click', () => {
        overlay.classList.add('open');
        render();
        if (!state.initialized) void loadConfig();
    });

    overlay.addEventListener('click', event => {
        if (event.target === overlay) overlay.classList.remove('open');
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') overlay.classList.remove('open');
    });

    function button(label, action, primary = false) {
        return `<button class="yd-btn ${primary ? 'yd-primary' : ''}"
            data-action="${esc(action)}">${esc(label)}</button>`;
    }

    function pageHeader(title, description, actions = '') {
        return `<div style="display:flex;justify-content:space-between;gap:12px;
            align-items:start;margin-bottom:20px;flex-wrap:wrap">
            <div><div class="yd-title">${esc(title)}</div>
            <div class="yd-sub">${esc(description)}</div></div>
            <div>${actions}</div></div>`;
    }

    function overviewPage() {
        return pageHeader(
            'Overview',
            `Signed in as ${state.currentUser?.name || CONFIG.userId}`,
            button('Test & Sync', 'sync', true)
        ) +
        (state.error ? `<div class="yd-error">${esc(state.error)}</div>` : '') +
        `<div class="yd-grid">
          <div class="yd-card">Available Tools
            <div class="yd-value">${state.tools.filter(getToolPermission).length}</div>
          </div>
          <div class="yd-card">Discovered Tools
            <div class="yd-value">${state.tools.length}</div>
          </div>
          <div class="yd-card">Registered Users
            <div class="yd-value">${state.users.length}</div>
          </div>
          <div class="yd-card">GitHub Status
            <div style="margin-top:8px"><span class="yd-pill">${esc(state.status)}</span></div>
          </div>
        </div>
        <div class="yd-card">
          <b>Account</b>
          <div class="yd-row"><div class="yd-grow">
            ${esc(state.currentUser?.name || CONFIG.userId)}
            <div class="yd-sub">ID: ${esc(CONFIG.userId)}</div>
          </div><span class="yd-pill">${esc(state.currentUser?.role || 'Unknown')}</span>
          <span class="yd-pill">${esc(state.currentUser?.status || 'Unknown')}</span></div>
        </div>
        <div class="yd-card"><b>Repository Diagnostics</b>${statusRows()}</div>`;
    }

    function statusRows() {
        return state.checks.map(item => `
          <div class="yd-row"><div class="yd-grow">
            <b>${esc(item.label)}</b>
            <div class="yd-sub">${esc(item.repo)}/${esc(item.path)}</div>
            <div class="yd-sub">${esc(item.message)}</div>
          </div><span class="yd-pill">${item.ok ? 'Connected' : 'Failed'}</span></div>
        `).join('') || '<div class="yd-empty">Run Test & Sync to check repositories.</div>';
    }

    function toolsPage() {
        const tools = state.tools.filter(getToolPermission);

        return pageHeader(
            'My Tools',
            'Tools are discovered from the shared TOOLS directory.',
            button('Reload Tools', 'sync', true)
        ) +
        `<div class="yd-note">Access requires an active account and an explicit permission in tool-permissions.json.</div>
        <div class="yd-card"><b>Allowed Tools (${tools.length})</b>
        ${tools.map(tool => `
          <div class="yd-row"><div class="yd-grow">
            <b>${esc(tool.name)}</b>
            <div class="yd-sub">${esc(tool.path)}</div>
            <div class="yd-sub">${esc(tool.description)}</div>
          </div>
          <label><input type="checkbox" data-toggle="${esc(tool.path)}"
            ${tool.enabled ? 'checked' : ''}> Enabled</label></div>
        `).join('') || '<div class="yd-empty">No permitted tools found.</div>'}</div>`;
    }

    function settingsPage() {
        const start = state.settings.startPage || 'overview';

        return pageHeader('My Settings', 'Personal settings saved in your employee repository.',
            button('Save Settings', 'save-settings', true)) +
        `<div class="yd-card">
          <div class="yd-field"><label>GitHub Owner</label>
            <input value="${esc(CONFIG.owner)}" readonly></div>
          <div class="yd-field"><label>Personal Repository</label>
            <input value="${esc(CONFIG.personalRepo)}" readonly></div>
          <div class="yd-field"><label>Default Page</label>
            <select id="yd-start-page">
              ${['overview','tools','settings','logs'].map(value =>
                `<option value="${value}" ${value === start ? 'selected' : ''}>${value}</option>`
              ).join('')}
            </select></div>
          <div class="yd-field"><label>Display Name</label>
            <input id="yd-display-name" value="${esc(state.settings.displayName || '')}"></div>
        </div>`;
    }

    function usersPage() {
        if (!canManage()) return deniedPage();

        return pageHeader('Users Management', 'Manage users and tool permissions.',
            button('Add User', 'add-user', true)) +
        `<div class="yd-card" style="overflow:auto"><table class="yd-table">
          <thead><tr><th>Name</th><th>ID</th><th>Repository</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${state.users.map((user, index) => `
            <tr><td>${esc(user.name)}</td><td>${esc(user.id)}</td>
              <td>${esc(user.repository)}</td><td>${esc(user.role)}</td>
              <td>${esc(user.status)}</td><td>
                ${button('Edit', `edit-user:${index}`)}
                ${button('Delete', `delete-user:${index}`)}
              </td></tr>`).join('')}
          </tbody></table></div>
        <div class="yd-card"><b>Tool Permissions</b>
          ${state.users.map(user => `<div class="yd-row"><div class="yd-grow">
            ${esc(user.name)} (${esc(user.id)})
            <div class="yd-sub">${Object.entries(state.permissions[user.id] || {})
                .filter(([, allowed]) => allowed === true)
                .map(([key]) => esc(key)).join(', ') || 'No tools allowed'}</div>
          </div>${button('Edit Permissions', `permissions:${user.id}`)}</div>`).join('')}
        </div>`;
    }

    function sharedPage() {
        if (!canManage()) return deniedPage();

        const selected =
            state.tools.find(tool => tool.path === state.selectedTool) ||
            state.tools[0];

        return pageHeader('Shared Tools', 'Edit JavaScript files in the tools repository.') +
        `<div class="yd-card">
          <div class="yd-field"><label>Select JavaScript file</label>
            <select id="yd-tool-select">
              ${state.tools.map(tool => `<option value="${esc(tool.path)}"
                ${selected?.path === tool.path ? 'selected' : ''}>${esc(tool.path)}</option>`).join('')}
            </select></div>
          ${selected ? `<div class="yd-field"><label>Source</label>
            <textarea id="yd-tool-source" spellcheck="false">${esc(selected.source)}</textarea></div>
            ${button('Save Script', 'save-source', true)}
            ${button('Reload Source', 'reload-source')}`
            : '<div class="yd-empty">No JavaScript tools loaded.</div>'}
        </div>`;
    }

    function systemPage() {
        if (!canManage()) return deniedPage();

        return pageHeader('System Settings', 'Repository and connection configuration.',
            button('Test & Sync', 'sync', true)) +
        `<div class="yd-card">
          <div class="yd-row"><div class="yd-grow">Owner</div>${esc(CONFIG.owner)}</div>
          <div class="yd-row"><div class="yd-grow">Branch</div>${esc(CONFIG.branch)}</div>
          <div class="yd-row"><div class="yd-grow">Users Repository</div>${esc(CONFIG.usersRepo)}</div>
          <div class="yd-row"><div class="yd-grow">Tools Repository</div>${esc(CONFIG.toolsRepo)}</div>
          <div class="yd-row"><div class="yd-grow">Personal Repository</div>${esc(CONFIG.personalRepo)}</div>
          <div class="yd-note">Tokens are configured locally in this engine. Never commit real tokens into a repository file.</div>
        </div><div class="yd-card"><b>Connection Diagnostics</b>${statusRows()}</div>`;
    }

    function logsPage() {
        return pageHeader('Activity Logs', 'Recent operations in this browser session.',
            button('Clear Logs', 'clear-logs')) +
        `<div class="yd-card">${state.logs.map(item => `
          <div class="yd-row"><div class="yd-grow">${esc(item.message)}
            <div class="yd-sub">${esc(item.time)}</div>
          </div><span class="yd-pill">${esc(item.type)}</span></div>
        `).join('') || '<div class="yd-empty">No activity yet.</div>'}</div>`;
    }

    function deniedPage() {
        return pageHeader('Access denied', 'This section is available to administrators only.') +
            '<div class="yd-error">Your account does not have permission to manage this section.</div>';
    }

    function render() {
        if (!$('#yd-sidebar') || !$('#yd-main')) return;

        $('#yd-role').textContent = state.currentUser
            ? `${state.currentUser.name} · ${state.currentUser.role}`
            : `USER ID: ${CONFIG.userId}`;

        const sections = [
            ['overview', 'Overview'],
            ['tools', 'My Tools'],
            ['settings', 'My Settings'],
            ...(canManage() ? [
                ['users', 'Users Management'],
                ['shared', 'Shared Tools'],
                ['system', 'System Settings']
            ] : []),
            ['logs', 'Activity Logs']
        ];

        $('#yd-sidebar').innerHTML = sections.map(([id, label]) =>
            `<button class="yd-nav ${state.section === id ? 'active' : ''}"
              data-section="${id}">${label}</button>`
        ).join('');

        const pages = {
            overview: overviewPage,
            tools: toolsPage,
            settings: settingsPage,
            users: usersPage,
            shared: sharedPage,
            system: systemPage,
            logs: logsPage
        };

        $('#yd-main').innerHTML = state.loading
            ? '<div class="yd-empty">Connecting to GitHub…</div>'
            : (pages[state.section] || overviewPage)();

        bindEvents();
    }

    function bindEvents() {
        $$('[data-section]', $('#yd-sidebar')).forEach(button => {
            button.addEventListener('click', () => {
                state.section = button.dataset.section;
                render();
            });
        });

        $('#yd-tool-select')?.addEventListener('change', event => {
            state.selectedTool = event.target.value;
            render();
        });

        $$('[data-toggle]', $('#yd-main')).forEach(input => {
            input.addEventListener('change', async () => {
                input.disabled = true;

                try {
                    await toggleTool(input.dataset.toggle, input.checked);
                } catch (error) {
                    alert(errorMessage(error));
                    render();
                }
            });
        });

        $$('[data-action]', $('#yd-modal')).forEach(button => {
            button.addEventListener('click', async () => {
                const action = button.dataset.action;

                if (action === 'close') {
                    overlay.classList.remove('open');
                    return;
                }

                button.disabled = true;

                try {
                    if (action === 'sync') {
                        await loadConfig();
                    } else if (action === 'save-settings') {
                        await savePersonalSettings();
                    } else if (action === 'add-user') {
                        await editUser(-1);
                    } else if (action.startsWith('edit-user:')) {
                        await editUser(Number(action.split(':')[1]));
                    } else if (action.startsWith('delete-user:')) {
                        await deleteUser(Number(action.split(':')[1]));
                    } else if (action.startsWith('permissions:')) {
                        await editPermissions(action.slice('permissions:'.length));
                    } else if (action === 'save-source') {
                        await saveToolSource();
                    } else if (action === 'reload-source') {
                        await reloadSelectedTool();
                    } else if (action === 'clear-logs') {
                        state.logs = [];
                        render();
                    }
                } catch (error) {
                    state.error = errorMessage(error);
                    log(state.error, 'error');
                    render();
                    alert(`YODAWY Dashboard: ${state.error}`);
                } finally {
                    if (button.isConnected) button.disabled = false;
                }
            });
        });
    }

    log(`Dashboard engine initialized for ${CONFIG.userId}.`);
    render();
    void loadConfig();

})();
