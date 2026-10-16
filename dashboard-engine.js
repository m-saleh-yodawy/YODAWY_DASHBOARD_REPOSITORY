 // ==UserScript==
 // @name         YODAWY DASHBOARD
 // @namespace    https://github.com/m-saleh-yodawy/
 // @version      1
 // @author       Mohamed Saleh
 // @match        https://odoo.yodawy.com/*
 // @grant        none
 // ==/UserScript==

 (() => {
     'use strict';

     if (window.__YODAWY_DASHBOARD_RUNNING__) return;
     window.__YODAWY_DASHBOARD_RUNNING__ = true;

     const CONFIG = {
         owner: 'm-saleh-yodawy',
         branch: 'main',
         userId: 'Q-001',
         dashboardRepo: 'YODAWY_DASHBOARD_REPOSITORY',
         toolsRepo: 'YODAWY_TOOLS_REPOSITORY',
         systemToken: 'PASTE_SYSTEM_DASHBOARD_REPO_TOKEN',
         personalToken: 'PASTE_PERSONAL_DASHBOARD_TOKEN',
         paths: {
             authConfig: 'CONFIG/auth-config.json',
             users: 'CONFIG/auth-users.json',
             messages: 'CONFIG/auth-messages.json',
             permissions: 'CONFIG/tool-permissions.json',
             tools: 'TOOLS'
         }
     };

     const PURPLE = '#875A7B';
     const DARK = '#68465f';
     const API = 'https://api.github.com';

     const state = {
         section: 'overview',
         status: 'Not connected',
         user: null,
         settings: {},
         messages: {},
         permissions: {},
         tools: [],
         logs: [],
         error: '',
         loading: false,
         authenticated: false,
         initialized: false
     };

     const $ = (selector, root = document) => root.querySelector(selector);

     const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
         '&': '&amp;',
         '<': '&lt;',
         '>': '&gt;',
         '"': '&quot;',
         "'": '&#39;'
     })[c]);

     const log = (message, type = 'info') => {
         state.logs.unshift({
             message: String(message),
             type,
             time: new Date().toLocaleTimeString()
         });
         state.logs.length = Math.min(state.logs.length, 50);
     };

     const repoUrl = (repo, path = '') =>
         `${API}/repos/${encodeURIComponent(CONFIG.owner)}/${encodeURIComponent(repo)}` +
         (path ? `/contents/${path.split('/').map(encodeURIComponent).join('/')}` : '');

     async function request(url, token, options = {}) {
         const response = await fetch(url, {
             ...options,
             headers: {
                 Accept: 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28',
                 ...(token ? { Authorization: `Bearer ${token}` } : {}),
                 ...options.headers
             },
             credentials: 'omit',
             cache: 'no-store'
         });

         const data = await response.json().catch(() => ({}));

         if (!response.ok) {
             const error = new Error(data.message || `GitHub error ${response.status}`);
             error.status = response.status;
             throw error;
         }

         return data;
     }

     function decodeContent(content) {
         const binary = atob(String(content || '').replace(/\s/g, ''));
         const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
         return new TextDecoder().decode(bytes);
     }

     async function readJSON(repo, path, token) {
         const file = await request(repoUrl(repo, path), token);
         if (typeof file.content !== 'string') throw new Error(`Missing file: ${path}`);
         return JSON.parse(decodeContent(file.content));
     }

     async function readDirectory(repo, path, token) {
         const result = await request(repoUrl(repo, path), token);
         if (!Array.isArray(result)) throw new Error(`${path} is not a directory`);
         return result;
     }

     function getUsers(data) {
         if (Array.isArray(data)) return data;
         if (Array.isArray(data?.users)) return data.users;
         return [];
     }

     function getUserPermissions(data) {
         if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
         return data;
     }

     function permissionKey(tool) {
         return tool.path.split('/').pop()
             .replace(/\.user\.js$/i, '')
             .replace(/\.js$/i, '')
             .replace(/[^a-zA-Z0-9]+/g, '_')
             .replace(/^_+|_+$/g, '')
             .toUpperCase();
     }

     function canManage() {
         return state.authenticated &&
             String(state.user?.role || '').toLowerCase() === 'admin';
     }

     function permitted(tool) {
         const userPermissions = state.permissions[CONFIG.userId] || {};
         return userPermissions[permissionKey(tool)] === true;
     }

     function message(key, fallback) {
         const value = state.messages[key];
         return typeof value === 'string' && value ? value : fallback;
     }

     function simpleMatch(pattern, href) {
         if (pattern === '<all_urls>') return true;

         try {
             const url = new URL(href);
             const match = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]+)(\/.*)$/i);
             if (!match) return false;

             const [, scheme, hostPattern, pathPattern] = match;

             if (scheme !== '*' && scheme.toLowerCase() !== url.protocol.slice(0, -1)) {
                 return false;
             }

             const host = hostPattern.toLowerCase();
             const actualHost = url.hostname.toLowerCase();

             if (host !== '*') {
                 if (host.startsWith('*.')) {
                     const suffix = host.slice(2);
                     if (actualHost !== suffix && !actualHost.endsWith(`.${suffix}`)) {
                         return false;
                     }
                 } else if (host !== actualHost) {
                     return false;
                 }
             }

             const escaped = pathPattern.split('*')
                 .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                 .join('.*');

             return new RegExp(`^${escaped}$`)
                 .test(url.pathname + url.search + url.hash);
         } catch {
             return false;
         }
     }

     function parseTool(source, path) {
         const header = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
         const metadata = header?.[1] || '';

         const values = key => [
             ...metadata.matchAll(
                 new RegExp('^\\s*//\\s*@' + key + '\\s+(.+?)\\s*$', 'gm')
             )
         ].map(match => match[1].trim());

         return {
             path,
             source,
             name: values('name')[0] || path.split('/').pop(),
             description: values('description')[0] || '',
             matches: [...values('match'), ...values('include')],
             excludes: [...values('exclude'), ...values('exclude-match')],
             grants: values('grant').filter(value => value !== 'none'),
             requires: values('require'),
             enabled: true,
             metadataFound: Boolean(header)
         };
     }

     function matchesPage(tool) {
         if (!tool.metadataFound || !tool.matches.length) return false;

         if (tool.excludes.some(pattern => simpleMatch(pattern, location.href))) {
             return false;
         }

         return tool.matches.some(pattern => simpleMatch(pattern, location.href));
     }

     async function authenticate() {
         if (!CONFIG.systemToken || CONFIG.systemToken.startsWith('PASTE_')) {
             throw new Error('SYSTEM DASHBOARD REPO TOKEN is not configured.');
         }

         if (!CONFIG.personalToken || CONFIG.personalToken.startsWith('PASTE_')) {
             throw new Error('PERSONAL DASHBOARD TOKEN is not configured.');
         }

         await request(repoUrl(CONFIG.dashboardRepo), CONFIG.systemToken);

         const [authConfig, usersData, messages, permissionsData] = await Promise.all([
             readJSON(CONFIG.dashboardRepo, CONFIG.paths.authConfig, CONFIG.systemToken),
             readJSON(CONFIG.dashboardRepo, CONFIG.paths.users, CONFIG.systemToken),
             readJSON(CONFIG.dashboardRepo, CONFIG.paths.messages, CONFIG.systemToken)
                 .catch(() => ({})),
             readJSON(CONFIG.dashboardRepo, CONFIG.paths.permissions, CONFIG.systemToken)
                 .catch(() => ({}))
         ]);

         if (authConfig?.enabled === false) {
             throw new Error(message('SYSTEM_DISABLED', 'System is disabled.'));
         }

         const user = getUsers(usersData).find(item =>
             String(item.id || '').trim().toUpperCase() === CONFIG.userId.toUpperCase()
         );

         if (!user) {
             throw new Error(message('INVALID_ID', 'INVALID ID OR PASSWORD'));
         }

         if (String(user.status || '').toLowerCase() !== 'active') {
             throw new Error(message('ACCOUNT_DISABLED', 'Account is not active.'));
         }

         if (!user.repository) {
             throw new Error(message('MISSING_REPOSITORY', 'Personal repository is missing.'));
         }

         state.user = user;
         state.messages = messages?.messages || messages || {};
         state.permissions = getUserPermissions(permissionsData);
         state.settings = {};

         const personalRepo = user.repository;

         await request(repoUrl(personalRepo), CONFIG.personalToken);

         try {
             state.settings = await readJSON(
                 personalRepo,
                 authConfig?.settingsPath || 'DASHBOARD/dashboard-settings.json',
                 CONFIG.personalToken
             );
         } catch (error) {
             if (error.status !== 404) log(error.message, 'warning');
         }

         state.authenticated = true;
         state.status = 'Connected';
         state.initialized = true;
         state.section = state.settings.startPage || 'overview';

         log('Authentication successful.', 'success');
     }

     async function loadTools() {
         const listing = await readDirectory(
             CONFIG.toolsRepo,
             CONFIG.paths.tools,
             null
         );

         const files = listing.filter(item =>
             item.type === 'file' &&
             /\.js$/i.test(item.name) &&
             !/\.min\.js$/i.test(item.name)
         );

         const results = await Promise.allSettled(files.map(async item => {
             const response = await fetch(item.download_url, {
                 credentials: 'omit',
                 cache: 'no-store'
             });

             if (!response.ok) throw new Error(`Cannot download ${item.name}`);

             return parseTool(await response.text(), item.path);
         }));

         state.tools = results
             .filter(result => result.status === 'fulfilled')
             .map(result => result.value)
             .sort((a, b) => a.name.localeCompare(b.name));

         results.filter(result => result.status === 'rejected')
             .forEach(result => log(result.reason?.message || 'Tool loading failed.', 'error'));

         log(`Loaded ${state.tools.length} tools.`, 'success');
     }

     function runTool(tool) {
         if (!state.authenticated || !permitted(tool) || !tool.enabled) return;
         if (!matchesPage(tool)) return;

         if (tool.requires.length) {
             log(`${tool.name}: @require dependencies are not supported.`, 'warning');
             return;
         }

         const unsupported = tool.grants.filter(grant => grant !== 'unsafeWindow');

         if (unsupported.length) {
             log(`${tool.name}: unsupported @grant: ${unsupported.join(', ')}`, 'warning');
             return;
         }

         const runKey = '__YODAWY_TOOL_' + tool.path.replace(/[^a-zA-Z0-9]/g, '_');
         if (window[runKey]) return;

         try {
             const runner = new Function('unsafeWindow', `"use strict";\n${tool.source}\n`);
             runner(window);
             window[runKey] = true;
             log(`Started ${tool.name}.`, 'success');
         } catch (error) {
             log(`${tool.name}: ${error.message}`, 'error');
         }
     }

     async function sync() {
         if (state.loading) return;

         state.loading = true;
         state.error = '';
         render();

         try {
             if (!state.authenticated) await authenticate();

             await loadTools();

             for (const tool of state.tools) runTool(tool);

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

     async function saveSettings() {
         if (!state.authenticated) throw new Error('Authentication required.');

         const displayName = $('#yd-name')?.value.trim() || state.user.name || CONFIG.userId;
         const startPage = $('#yd-start')?.value || 'overview';
         const repo = state.user.repository;

         const settings = {
             ...state.settings,
             owner: CONFIG.owner,
             repository: repo,
             displayName,
             startPage,
             updatedAt: new Date().toISOString()
         };

         const path = 'DASHBOARD/dashboard-settings.json';
         let current = null;

         try {
             current = await request(repoUrl(repo, path), CONFIG.personalToken);
         } catch (error) {
             if (error.status !== 404) throw error;
         }

         const bytes = new TextEncoder().encode(JSON.stringify(settings, null, 2) + '\n');
         let binary = '';

         for (let i = 0; i < bytes.length; i += 8192) {
             binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
         }

         const body = {
             message: 'Update dashboard settings',
             content: btoa(binary),
             branch: CONFIG.branch
         };

         if (current?.sha) body.sha = current.sha;

         await request(repoUrl(repo, path), CONFIG.personalToken, {
             method: 'PUT',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify(body)
         });

         state.settings = settings;
         state.user.name = displayName;
         log('Settings saved.', 'success');
         render();
     }

     const style = document.createElement('style');

     style.textContent = `
         #yd-launcher{position:fixed;right:22px;bottom:22px;z-index:2147483000;background:${PURPLE};color:#fff;border:0;border-radius:40px;padding:13px 18px;font:700 13px system-ui;cursor:pointer;box-shadow:0 8px 25px #0003}
         #yd-overlay{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;padding:3vh 3vw;background:#17131c99}
         #yd-overlay.open{display:flex}
         #yd-modal{width:100%;height:100%;max-width:1450px;max-height:920px;background:#f7f6f9;color:#29242e;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;font:14px/1.5 system-ui}
         #yd-modal *{box-sizing:border-box}
         #yd-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;background:#fff;border-bottom:1px solid #e9e4ec}
         #yd-body{display:flex;flex:1;min-height:0}
         #yd-sidebar{width:210px;flex-shrink:0;background:#fff;padding:15px 10px;border-right:1px solid #e9e4ec;overflow:auto}
         #yd-main{flex:1;min-width:0;overflow:auto;padding:25px}
         .yd-nav{display:block;width:100%;text-align:left;border:0;border-radius:8px;padding:12px;background:transparent;color:#655c6a;cursor:pointer;margin-bottom:4px}
         .yd-nav.active{background:#f1e8f1;color:${DARK};font-weight:800}
         .yd-title{font-size:21px;font-weight:800}
         .yd-sub{font-size:11px;color:#8c8492}
         .yd-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
         .yd-card{background:#fff;border:1px solid #eee8f0;border-radius:12px;padding:17px;margin-bottom:15px;min-width:0}
         .yd-value{font-size:26px;font-weight:800;margin-top:8px}
         .yd-btn{border:1px solid #e5dce8;background:#fff;color:${DARK};border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;margin:2px}
         .yd-primary{background:${PURPLE};color:#fff;border-color:${PURPLE}}
         .yd-field{display:flex;flex-direction:column;gap:6px;margin:12px 0}
         .yd-field input,.yd-field select{width:100%;padding:10px;border:1px solid #e3dce6;border-radius:8px;font:12px system-ui}
         .yd-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #eee}
         .yd-grow{flex:1;min-width:0;overflow-wrap:anywhere}
         .yd-note{padding:12px;background:#f1e8f1;border-radius:8px;margin-bottom:14px;font-size:12px;overflow-wrap:anywhere}
         .yd-error{padding:12px;background:#fbe6e9;color:#a83d51;border-radius:8px;margin-bottom:14px;overflow-wrap:anywhere}
         .yd-pill{display:inline-block;padding:4px 8px;background:#eee4ef;color:${DARK};border-radius:7px;font-size:11px}
         .yd-empty{padding:24px;text-align:center;color:#8c8492}
         @media(max-width:800px){#yd-overlay{padding:0}#yd-modal{border-radius:0}#yd-sidebar{width:125px}#yd-main{padding:12px}.yd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#yd-header{padding:12px}}
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
                 <div>
                     <div class="yd-title">YODAWY DASHBOARD</div>
                     <div class="yd-sub">Automation Control Center</div>
                 </div>
                 <div>
                     <span id="yd-status" class="yd-pill">Not connected</span>
                     <button class="yd-btn" data-action="close">Close</button>
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
         return `<button class="yd-btn ${primary ? 'yd-primary' : ''}" data-action="${esc(action)}">${esc(label)}</button>`;
     }

     function card(title, value) {
         return `<div class="yd-card">${esc(title)}<div class="yd-value">${esc(value)}</div></div>`;
     }

     function overviewPage() {
         const available = state.tools.filter(permitted).length;

         return header('Overview', `Signed in as ${state.user?.name || CONFIG.userId}`, button('Test & Sync', 'sync', true)) +
             (state.error ? `<div class="yd-error">${esc(state.error)}</div>` : '') +
             `<div class="yd-grid">
                 ${card('Available Tools', available)}
                 ${card('Discovered Tools', state.tools.length)}
                 ${card('User ID', CONFIG.userId)}
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

     function toolsPage() {
         const tools = state.tools.filter(permitted);

         return header('My Tools', 'Tools available for your account.', button('Reload Tools', 'sync', true)) +
             `<div class="yd-card"><b>Allowed Tools (${tools.length})</b>
                 ${tools.map(tool => `
                     <div class="yd-row">
                         <div class="yd-grow">
                             <b>${esc(tool.name)}</b>
                             <div class="yd-sub">${esc(tool.path)}</div>
                             <div class="yd-sub">${esc(tool.description)}</div>
                         </div>
                         <span class="yd-pill">${tool.enabled ? 'Enabled' : 'Disabled'}</span>
                         ${button('Run', `run:${tool.path}`)}
                     </div>
                 `).join('') || '<div class="yd-empty">No permitted tools found.</div>'}
             </div>`;
     }

     function settingsPage() {
         const settings = state.settings;

         return header('My Settings', 'Personal settings saved in your employee repository.') +
             `<div class="yd-card">
                 <div class="yd-field"><label>GitHub Owner</label><input value="${esc(CONFIG.owner)}" readonly></div>
                 <div class="yd-field"><label>Personal Repository</label><input value="${esc(state.user?.repository || '')}" readonly></div>
                 <div class="yd-field"><label>Default Page</label>
                     <select id="yd-start">
                         ${['overview', 'tools', 'settings'].map(value =>
                             `<option value="${value}" ${(settings.startPage || 'overview') === value ? 'selected' : ''}>${value}</option>`
                         ).join('')}
                     </select>
                 </div>
                 <div class="yd-field"><label>Display Name</label><input id="yd-name" value="${esc(settings.displayName || state.user?.name || '')}"></div>
                 ${button('Save Settings', 'save-settings', true)}
             </div>`;
     }

     function usersPage() {
         if (!canManage()) return deniedPage();
         return header('Users Management', 'User registry and tool permissions.') +
             `<div class="yd-card">
                 <div class="yd-row"><div class="yd-grow">Authenticated user</div>${esc(state.user?.name || CONFIG.userId)}</div>
                 <div class="yd-row"><div class="yd-grow">Role</div>${esc(state.user?.role || '')}</div>
                 <div class="yd-row"><div class="yd-grow">Status</div>${esc(state.user?.status || '')}</div>
                 <div class="yd-note">User editing is not enabled in this simplified version.</div>
             </div>`;
     }

     function sharedPage() {
         if (!canManage()) return deniedPage();

         return header('Shared Tools', 'Tools discovered from the shared repository.') +
             `<div class="yd-card">
                 ${state.tools.map(tool => `
                     <div class="yd-row">
                         <div class="yd-grow"><b>${esc(tool.name)}</b><div class="yd-sub">${esc(tool.path)}</div></div>
                         <span class="yd-pill">${permitted(tool) ? 'Permitted' : 'Not permitted'}</span>
                     </div>
                 `).join('') || '<div class="yd-empty">No tools loaded.</div>'}
             </div>`;
     }

     function systemPage() {
         if (!canManage()) return deniedPage();

         return header('System Settings', 'Repository and connection information.') +
             `<div class="yd-card">
                 <div class="yd-row"><div class="yd-grow">Owner</div>${esc(CONFIG.owner)}</div>
                 <div class="yd-row"><div class="yd-grow">Branch</div>${esc(CONFIG.branch)}</div>
                 <div class="yd-row"><div class="yd-grow">Dashboard Repository</div>${esc(CONFIG.dashboardRepo)}</div>
                 <div class="yd-row"><div class="yd-grow">Tools Repository</div>${esc(CONFIG.toolsRepo)}</div>
                 <div class="yd-note">Never publish real tokens in a repository or share them with other users.</div>
             </div>`;
     }

     function logsPage() {
         return header('Activity Logs', 'Recent operations in this browser session.', button('Clear Logs', 'clear-logs')) +
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
         return header('Access denied', 'This section is available to administrators only.') +
             '<div class="yd-error">Your account does not have administrator access.</div>';
     }

     function render() {
         if (!$('#yd-sidebar') || !$('#yd-main')) return;

         $('#yd-status').textContent = state.loading ? 'Loading…' : state.status;

         const sections = [
             ['overview', 'Overview'],
             ['tools', 'My Tools'],
             ['settings', 'My Settings'],
             ...(canManage() ? [['users', 'Users Management'], ['shared', 'Shared Tools'], ['system', 'System Settings']] : []),
             ['logs', 'Activity Logs']
         ];

         if (!sections.some(([id]) => id === state.section)) state.section = 'overview';

         $('#yd-sidebar').innerHTML = sections.map(([id, name]) =>
             `<button class="yd-nav ${state.section === id ? 'active' : ''}" data-section="${id}">${name}</button>`
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
             ? '<div class="yd-empty">Connecting and loading tools…</div>'
             : !state.authenticated
                 ? `<div class="yd-card"><div class="yd-title">Authentication Required</div><p class="yd-sub">Connect to GitHub to verify your account and load permitted tools.</p>${button('Connect & Load Tools', 'sync', true)}${state.error ? `<div class="yd-error">${esc(state.error)}</div>` : ''}</div>`
                 : pages[state.section]();

         if (state.authenticated && state.error) {
             $('#yd-main').insertAdjacentHTML('afterbegin', `<div class="yd-error">${esc(state.error)}</div>`);
         }
     }

     launcher.addEventListener('click', () => {
         overlay.classList.add('open');
         render();
         if (!state.initialized) void sync();
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

         const action = event.target.closest('[data-action]')?.dataset.action;
         if (!action) return;

         try {
             if (action === 'close') {
                 overlay.classList.remove('open');
             } else if (action === 'sync') {
                 await sync();
             } else if (action === 'save-settings') {
                 await saveSettings();
             } else if (action === 'clear-logs') {
                 state.logs = [];
                 render();
             } else if (action.startsWith('run:')) {
                 const path = action.slice(4);
                 const tool = state.tools.find(item => item.path === path);
                 if (!tool || !permitted(tool)) throw new Error('Tool permission denied.');
                 runTool(tool);
                 render();
             }
         } catch (error) {
             state.error = error.message || String(error);
             log(state.error, 'error');
             render();
         }
     });

     document.addEventListener('keydown', event => {
         if (event.key === 'Escape') overlay.classList.remove('open');
     });

     render();
 })();
