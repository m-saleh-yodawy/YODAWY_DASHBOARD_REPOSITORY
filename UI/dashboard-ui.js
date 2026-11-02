(() => {
    'use strict';

    if (window.YODAWY_DASHBOARD_UI) return;

    const CONFIG = Object.freeze({
        ID: 'yd-dashboard-root',
        STYLE_ID: 'yd-dashboard-styles',
        BRAND: '#875A7B',
        DARK: '#68465f',
        LIGHT: '#f8f5f7',
        REFRESH_INTERVAL: 30000
    });

    let context = null;
    let activePage = 'overview';
    let refreshTimer = null;
    let busy = false;
    let notice = null;

    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);

    const formatDate = value => {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
    };

    const initials = value => String(value || 'Y').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();

    const getRoleEngine = () => context.userRole === 'SUPER_ADMIN'
        ? context.superAdmin || null
        : context.userRole === 'ADMIN'
            ? context.admin || null
            : context.user || null;

    const getUsers = () => {
        try { return getRoleEngine()?.getUsers?.() || [context.user]; }
        catch { return [context.user]; }
    };

    const getTools = () => {
        try { return context.tools?.getManifest?.() || []; }
        catch { return []; }
    };

    const getLoadedTools = () => {
        try { return context.tools?.getLoadedTools?.() || []; }
        catch { return []; }
    };

    const getTransactions = () => {
        try { return getRoleEngine()?.getTransactionHistory?.() || []; }
        catch { return []; }
    };

    const showNotice = (message, type = 'success') => {
        notice = { message, type };
        const element = document.querySelector('#' + CONFIG.ID + ' .yd-toast');
        if (element) {
            element.className = 'yd-toast ' + type;
            element.textContent = message;
            element.hidden = false;
            clearTimeout(element._ydTimer);
            element._ydTimer = setTimeout(() => {
                element.hidden = true;
                notice = null;
            }, 4500);
        } else render();
    };

    const injectStyles = () => {
        if (document.getElementById(CONFIG.STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = CONFIG.STYLE_ID;
        style.textContent = `
            #${CONFIG.ID}{position:fixed;inset:0;z-index:99998;display:flex;background:#f6f4f6;color:#322d34;font:14px/1.5 Inter,Segoe UI,Arial,sans-serif}
            #${CONFIG.ID} *{box-sizing:border-box}
            #${CONFIG.ID} button,#${CONFIG.ID} input,#${CONFIG.ID} select{font:inherit}
            #${CONFIG.ID} button{cursor:pointer}
            #${CONFIG.ID} .yd-sidebar{width:248px;flex:0 0 248px;background:#2f2931;color:#fff;display:flex;flex-direction:column;padding:24px 16px}
            #${CONFIG.ID} .yd-brand{display:flex;align-items:center;gap:12px;padding:4px 8px 28px}
            #${CONFIG.ID} .yd-brand-mark{width:38px;height:38px;border-radius:11px;background:${CONFIG.BRAND};display:grid;place-items:center;font-weight:900;font-size:18px}
            #${CONFIG.ID} .yd-brand-name{font-weight:800;letter-spacing:.7px;font-size:14px}
            #${CONFIG.ID} .yd-brand-sub{color:#bdb4be;font-size:10px;letter-spacing:1.4px}
            #${CONFIG.ID} .yd-nav-label{padding:12px 10px 8px;color:#9f96a1;font-size:10px;font-weight:800;letter-spacing:1.2px}
            #${CONFIG.ID} .yd-nav{display:grid;gap:5px}
            #${CONFIG.ID} .yd-nav button{border:0;background:transparent;color:#cfc8d1;text-align:left;padding:11px 12px;border-radius:8px;display:flex;align-items:center;gap:11px;font-weight:600;font-size:12px}
            #${CONFIG.ID} .yd-nav button:hover,#${CONFIG.ID} .yd-nav button.active{background:#493d4a;color:#fff}
            #${CONFIG.ID} .yd-nav-icon{width:20px;text-align:center;font-size:15px}
            #${CONFIG.ID} .yd-sidebar-bottom{margin-top:auto;border-top:1px solid #514853;padding:17px 8px 0;color:#bdb4be;font-size:10px}
            #${CONFIG.ID} .yd-main{min-width:0;flex:1;display:flex;flex-direction:column;overflow:hidden}
            #${CONFIG.ID} .yd-topbar{height:72px;flex:0 0 72px;background:#fff;border-bottom:1px solid #e9e4e9;display:flex;align-items:center;justify-content:space-between;padding:0 30px}
            #${CONFIG.ID} .yd-breadcrumb{font-size:11px;color:#928994}
            #${CONFIG.ID} .yd-page-title{font-size:18px;font-weight:800;color:#382f39;margin-top:2px}
            #${CONFIG.ID} .yd-top-actions{display:flex;align-items:center;gap:12px}
            #${CONFIG.ID} .yd-icon-btn{width:36px;height:36px;border:1px solid #e9e4e9;border-radius:9px;background:#fff;color:#655b67}
            #${CONFIG.ID} .yd-user-chip{display:flex;align-items:center;gap:9px;border-left:1px solid #eee;padding-left:15px}
            #${CONFIG.ID} .yd-avatar{width:36px;height:36px;border-radius:50%;background:#eee5ed;color:${CONFIG.DARK};display:grid;place-items:center;font-size:11px;font-weight:800}
            #${CONFIG.ID} .yd-user-name{font-size:11px;font-weight:800}
            #${CONFIG.ID} .yd-user-role{font-size:10px;color:#978d99}
            #${CONFIG.ID} .yd-content{overflow:auto;padding:26px 30px 36px;flex:1}
            #${CONFIG.ID} .yd-content-inner{max-width:1440px;margin:0 auto}
            #${CONFIG.ID} .yd-welcome{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;gap:16px}
            #${CONFIG.ID} .yd-welcome h1{margin:0;color:#332d35;font-size:23px;line-height:1.3}
            #${CONFIG.ID} .yd-welcome p{margin:6px 0 0;color:#887f8b;font-size:12px}
            #${CONFIG.ID} .yd-primary{border:0;border-radius:8px;padding:10px 15px;background:${CONFIG.BRAND};color:white;font-weight:800;font-size:11px}
            #${CONFIG.ID} .yd-primary:hover{background:${CONFIG.DARK}}
            #${CONFIG.ID} .yd-secondary{border:1px solid #e4dce5;border-radius:8px;padding:9px 13px;background:#fff;color:#5a505d;font-size:11px;font-weight:700}
            #${CONFIG.ID} .yd-danger{border:1px solid #f1d5d5;border-radius:7px;background:#fff8f8;color:#b34747;padding:7px 10px;font-size:10px;font-weight:800}
            #${CONFIG.ID} .yd-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:20px}
            #${CONFIG.ID} .yd-card{background:#fff;border:1px solid #ebe6eb;border-radius:11px;padding:18px;box-shadow:0 2px 8px #322d3408}
            #${CONFIG.ID} .yd-stat{display:flex;justify-content:space-between;align-items:flex-start}
            #${CONFIG.ID} .yd-stat-label{color:#928995;font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase}
            #${CONFIG.ID} .yd-stat-value{font-size:27px;font-weight:850;color:#332d35;margin-top:7px;line-height:1.1}
            #${CONFIG.ID} .yd-stat-icon{width:36px;height:36px;border-radius:9px;background:${CONFIG.LIGHT};color:${CONFIG.BRAND};display:grid;place-items:center;font-size:16px}
            #${CONFIG.ID} .yd-section-head{display:flex;align-items:center;justify-content:space-between;margin:22px 0 12px}
            #${CONFIG.ID} .yd-section-head h2{margin:0;font-size:14px;color:#39323c}
            #${CONFIG.ID} .yd-section-head span{font-size:10px;color:#958b98}
            #${CONFIG.ID} .yd-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
            #${CONFIG.ID} .yd-tool-card{padding:16px}
            #${CONFIG.ID} .yd-tool-head{display:flex;align-items:center;gap:10px}
            #${CONFIG.ID} .yd-tool-icon{width:38px;height:38px;border-radius:10px;background:${CONFIG.LIGHT};color:${CONFIG.BRAND};display:grid;place-items:center;font-size:16px;font-weight:800}
            #${CONFIG.ID} .yd-tool-name{font-weight:800;font-size:11px;color:#3b333d}
            #${CONFIG.ID} .yd-tool-meta{font-size:10px;color:#9a909d;margin-top:2px}
            #${CONFIG.ID} .yd-tool-description{color:#817783;font-size:11px;margin:13px 0;min-height:32px}
            #${CONFIG.ID} .yd-tool-foot{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #f0edf0;padding-top:12px}
            #${CONFIG.ID} .yd-status{display:inline-flex;align-items:center;gap:5px;font-size:9px;font-weight:800;text-transform:uppercase;color:#8a818d}
            #${CONFIG.ID} .yd-dot{width:6px;height:6px;border-radius:50%;background:#bcb4bd}
            #${CONFIG.ID} .yd-status.on{color:#25835f}
            #${CONFIG.ID} .yd-status.on .yd-dot{background:#2ba879}
            #${CONFIG.ID} .yd-table-wrap{overflow:auto;background:#fff;border:1px solid #eae5eb;border-radius:10px}
            #${CONFIG.ID} table{width:100%;border-collapse:collapse;min-width:640px}
            #${CONFIG.ID} th{background:#faf8fa;color:#8b818e;text-align:left;font-size:9px;letter-spacing:.7px;text-transform:uppercase;padding:12px 14px}
            #${CONFIG.ID} td{padding:13px 14px;border-top:1px solid #f0edf0;font-size:11px;color:#554b58;vertical-align:middle}
            #${CONFIG.ID} td strong{color:#3b333d}
            #${CONFIG.ID} .yd-pill{display:inline-flex;padding:4px 8px;border-radius:20px;background:#f4eff4;color:${CONFIG.DARK};font-size:9px;font-weight:800;text-transform:uppercase}
            #${CONFIG.ID} .yd-pill.green{background:#eaf7f1;color:#26815f}
            #${CONFIG.ID} .yd-pill.red{background:#fff0f0;color:#b44b4b}
            #${CONFIG.ID} .yd-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0}
            #${CONFIG.ID} .yd-search{width:min(300px,100%);border:1px solid #e7e1e8;border-radius:8px;padding:10px 12px;background:#fff;outline:none;font-size:11px}
            #${CONFIG.ID} .yd-search:focus,#${CONFIG.ID} input:focus,#${CONFIG.ID} select:focus{border-color:${CONFIG.BRAND};box-shadow:0 0 0 3px #875a7b18;outline:none}
            #${CONFIG.ID} .yd-empty{padding:35px 20px;text-align:center;color:#928995;font-size:11px}
            #${CONFIG.ID} .yd-panel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
            #${CONFIG.ID} .yd-info-row{display:flex;justify-content:space-between;gap:15px;padding:10px 0;border-bottom:1px solid #f0edf0;font-size:11px}
            #${CONFIG.ID} .yd-info-row:last-child{border:0}
            #${CONFIG.ID} .yd-info-row span{color:#918793}
            #${CONFIG.ID} .yd-info-row strong{text-align:right;overflow-wrap:anywhere}
            #${CONFIG.ID} .yd-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
            #${CONFIG.ID} .yd-field{display:grid;gap:5px}
            #${CONFIG.ID} .yd-field label{font-size:10px;font-weight:800;color:#746a77}
            #${CONFIG.ID} .yd-field input,#${CONFIG.ID} .yd-field select{width:100%;border:1px solid #e6e0e7;border-radius:7px;padding:9px 10px;background:#fff;color:#423946;font-size:11px}
            #${CONFIG.ID} .yd-modal-backdrop{position:fixed;inset:0;z-index:100000;background:#211a2399;display:grid;place-items:center;padding:20px}
            #${CONFIG.ID} .yd-modal{width:min(520px,100%);background:#fff;border-radius:13px;padding:22px;box-shadow:0 20px 70px #0003}
            #${CONFIG.ID} .yd-modal h3{margin:0 0 16px;font-size:16px}
            #${CONFIG.ID} .yd-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
            #${CONFIG.ID} .yd-toast{position:fixed;right:25px;bottom:24px;z-index:100001;max-width:420px;padding:12px 16px;border-radius:8px;background:#2f2931;color:#fff;box-shadow:0 10px 30px #0002;font-size:11px}
            #${CONFIG.ID} .yd-toast.error{background:#9f3d48}
            @media(max-width:1000px){#${CONFIG.ID} .yd-sidebar{width:205px;flex-basis:205px}#${CONFIG.ID} .yd-stats{grid-template-columns:repeat(2,minmax(0,1fr))}#${CONFIG.ID} .yd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
            @media(max-width:700px){#${CONFIG.ID} .yd-sidebar{width:64px;flex-basis:64px;padding:18px 7px}#${CONFIG.ID} .yd-brand{justify-content:center;padding:4px 0 25px}#${CONFIG.ID} .yd-brand-text,#${CONFIG.ID} .yd-nav-label,#${CONFIG.ID} .yd-nav-text,#${CONFIG.ID} .yd-sidebar-bottom{display:none}#${CONFIG.ID} .yd-nav button{justify-content:center;padding:12px 5px}#${CONFIG.ID} .yd-content{padding:18px 13px}#${CONFIG.ID} .yd-topbar{padding:0 14px}#${CONFIG.ID} .yd-grid,#${CONFIG.ID} .yd-panel-grid{grid-template-columns:1fr}#${CONFIG.ID} .yd-welcome{display:block}#${CONFIG.ID} .yd-welcome .yd-primary{margin-top:13px}}
            @media(max-width:420px){#${CONFIG.ID} .yd-stats{grid-template-columns:1fr 1fr;gap:8px}#${CONFIG.ID} .yd-card{padding:13px}#${CONFIG.ID} .yd-stat-value{font-size:22px}#${CONFIG.ID} .yd-form-grid{grid-template-columns:1fr}}
        `;
        document.head.appendChild(style);
    };

    const navItems = () => {
        const items = [['overview', '⌂', 'Overview'], ['tools', '▦', 'Tools']];
        if (['ADMIN', 'SUPER_ADMIN'].includes(context.userRole)) items.push(['users', '♙', 'Users']);
        if (context.userRole === 'SUPER_ADMIN') items.push(['permissions', '◈', 'Permissions'], ['visibility', '◉', 'Visibility'], ['transactions', '⇄', 'NETWORK']);
        items.push(['account', '⚙', 'Account']);
        return items;
    };

    const pageTitle = () => ({
        overview: 'Overview', tools: 'Tools Management', users: 'User Management',
        permissions: 'Tool Permissions', visibility: 'Tool Visibility',
        transactions: 'NETWORK Transactions', account: 'Account Settings'
    })[activePage] || 'Dashboard';

    const renderShell = body => {
        const user = context.user || {};
        return `
            <aside class="yd-sidebar">
                <div class="yd-brand"><div class="yd-brand-mark">Y</div><div class="yd-brand-text"><div class="yd-brand-name">YODAWY</div><div class="yd-brand-sub">TOOLS CLOUD</div></div></div>
                <div class="yd-nav-label">WORKSPACE</div>
                <nav class="yd-nav">${navItems().map(([id, icon, label]) => `<button type="button" data-page="${id}" class="${activePage === id ? 'active' : ''}"><span class="yd-nav-icon">${icon}</span><span class="yd-nav-text">${label}</span></button>`).join('')}</nav>
                <div class="yd-sidebar-bottom">Authenticated Workspace<br>Version 1.0</div>
            </aside>
            <main class="yd-main">
                <header class="yd-topbar">
                    <div><div class="yd-breadcrumb">YODAWY / WORKSPACE / ${escapeHTML(activePage.toUpperCase())}</div><div class="yd-page-title">${escapeHTML(pageTitle())}</div></div>
                    <div class="yd-top-actions"><button type="button" class="yd-icon-btn" data-action="refresh" title="Refresh">↻</button><div class="yd-user-chip"><div class="yd-avatar">${escapeHTML(initials(user.name))}</div><div><div class="yd-user-name">${escapeHTML(user.name || user.id || 'User')}</div><div class="yd-user-role">${escapeHTML(context.userRole.replace('_', ' '))}</div></div></div></div>
                </header>
                <div class="yd-content"><div class="yd-content-inner">${body}</div></div>
            </main>
            ${notice ? `<div class="yd-toast ${notice.type}">${escapeHTML(notice.message)}</div>` : ''}
        `;
    };

    const statCard = (label, value, icon) => `
        <div class="yd-card"><div class="yd-stat"><div><div class="yd-stat-label">${escapeHTML(label)}</div><div class="yd-stat-value">${escapeHTML(value)}</div></div><div class="yd-stat-icon">${icon}</div></div></div>
    `;

    const renderToolCards = tools => {
        if (!tools.length) return '<div class="yd-card yd-empty">No tools are currently available.</div>';
        const loaded = new Set(getLoadedTools().map(tool => tool.id));
        return `<div class="yd-grid">${tools.map(tool => `
            <article class="yd-card yd-tool-card">
                <div class="yd-tool-head"><div class="yd-tool-icon">▦</div><div><div class="yd-tool-name">${escapeHTML(tool.name)}</div><div class="yd-tool-meta">${escapeHTML(tool.id)} · v${escapeHTML(tool.version || '1')}</div></div></div>
                <div class="yd-tool-description">${escapeHTML(tool.description || 'Yodawy productivity tool.')}</div>
                <div class="yd-tool-foot"><span class="yd-status ${loaded.has(tool.id) ? 'on' : ''}"><i class="yd-dot"></i>${loaded.has(tool.id) ? 'Loaded' : 'Not loaded'}</span><span class="yd-pill">${escapeHTML(tool.author || 'Yodawy')}</span></div>
            </article>
        `).join('')}</div>`;
    };

    const renderTransactionsTable = transactions => {
        if (!transactions.length) return '<div class="yd-card yd-empty">No NETWORK transactions found.</div>';
        return `<div class="yd-table-wrap"><table><thead><tr><th>Request ID</th><th>Action</th><th>Status</th><th>Actor</th><th>Updated</th></tr></thead><tbody>${transactions.map(item => `<tr><td><strong>${escapeHTML(item.requestId || item.transactionId || '—')}</strong></td><td>${escapeHTML(item.action || item.requestType || '—')}</td><td><span class="yd-pill ${String(item.status).toUpperCase() === 'COMPLETED' ? 'green' : ['FAILED', 'REJECTED'].includes(String(item.status).toUpperCase()) ? 'red' : ''}">${escapeHTML(item.status || 'PENDING')}</span></td><td>${escapeHTML(item.actor?.name || item.actor?.id || '—')}</td><td>${escapeHTML(formatDate(item.updatedAt || item.createdAt))}</td></tr>`).join('')}</tbody></table></div>`;
    };

    const renderOverview = () => {
        const tools = getTools();
        const users = getUsers();
        const loaded = getLoadedTools();
        const transactions = getTransactions();
        const activeUsers = users.filter(user => String(user.status).toLowerCase() === 'active').length;
        const enabledTools = tools.filter(tool => context.visibility?.getVisibility?.(tool.id)?.enabled === true).length;
        return `
            <section class="yd-welcome"><div><h1>Welcome back, ${escapeHTML(context.user?.name || 'User')}</h1><p>Your centralized workspace for Yodawy tools and dashboard operations.</p></div><button class="yd-primary" data-action="refresh">↻ &nbsp; Refresh Workspace</button></section>
            <section class="yd-stats">
                ${statCard('Registered Users', users.length, '♙')}
                ${statCard('Active Users', activeUsers, '✓')}
                ${statCard('Available Tools', tools.length, '▦')}
                ${statCard('Loaded Tools', loaded.length, '⚡')}
            </section>
            <div class="yd-section-head"><h2>Tools Overview</h2><span>${tools.length} tools in manifest · ${enabledTools} visible enabled</span></div>
            ${renderToolCards(tools.slice(0, 6))}
            <div class="yd-section-head"><h2>Recent NETWORK Activity</h2><span>${transactions.length} transactions</span></div>
            ${renderTransactionsTable(transactions.slice(0, 5))}
        `;
    };

    const renderTools = () => `
        <section class="yd-welcome"><div><h1>Tools Library</h1><p>Tools available to your authenticated account.</p></div><button class="yd-secondary" data-action="sync-tools">Sync Tools</button></section>
        <div class="yd-toolbar"><input class="yd-search" id="yd-tool-search" placeholder="Search tools by name or ID"><span class="yd-pill">${getLoadedTools().length} loaded / ${getTools().length} total</span></div>
        <div id="yd-tool-list">${renderToolCards(getTools())}</div>
    `;

    const renderUsers = () => {
        const users = getUsers();
        return `
            <section class="yd-welcome"><div><h1>Users Directory</h1><p>Manage registered accounts and their dashboard roles.</p></div><button class="yd-primary" data-action="add-user">＋ Add User</button></section>
            <div class="yd-toolbar"><input class="yd-search" id="yd-user-search" placeholder="Search by ID, name, role or repository"><span class="yd-pill">${users.length} users</span></div>
            <div class="yd-table-wrap"><table><thead><tr><th>User</th><th>User ID</th><th>Role</th><th>Status</th><th>Personal Repository</th><th>Actions</th></tr></thead><tbody>
                ${users.map(user => `<tr><td><strong>${escapeHTML(user.name)}</strong></td><td>${escapeHTML(user.id)}</td><td><span class="yd-pill">${escapeHTML(user.role)}</span></td><td><span class="yd-pill ${String(user.status).toLowerCase() === 'active' ? 'green' : 'red'}">${escapeHTML(user.status)}</span></td><td>${escapeHTML(user.repository || 'Provisioning')}</td><td><button class="yd-secondary" data-action="edit-user" data-id="${escapeHTML(user.id)}">Edit</button> <button class="yd-danger" data-action="delete-user" data-id="${escapeHTML(user.id)}">Delete</button></td></tr>`).join('')}
            </tbody></table></div>
        `;
    };

    const renderPermissions = () => {
        const users = getUsers();
        const tools = getTools();
        const permissions = getRoleEngine()?.getPermissions?.() || {};
        return `
            <section class="yd-welcome"><div><h1>Tool Permissions</h1><p>Control which users are allowed to use each tool.</p></div><span class="yd-pill">SUPER ADMIN CONTROL</span></section>
            <div class="yd-table-wrap"><table><thead><tr><th>User</th><th>Tool</th><th>Granted</th><th>Forced State</th><th>Action</th></tr></thead><tbody>
                ${users.flatMap(user => tools.map(tool => {
                    const record = permissions[user.id]?.[tool.id] || {};
                    return `<tr><td><strong>${escapeHTML(user.name)}</strong><br>${escapeHTML(user.id)}</td><td>${escapeHTML(tool.name)}</td><td><span class="yd-pill ${record.granted ? 'green' : 'red'}">${record.granted ? 'Granted' : 'Denied'}</span></td><td>${record.forcedState ? 'Protected' : 'Normal'}</td><td><button class="yd-secondary" data-action="toggle-permission" data-user="${escapeHTML(user.id)}" data-tool="${escapeHTML(tool.id)}" data-granted="${record.granted === true}">${record.granted ? 'Revoke' : 'Grant'}</button></td></tr>`;
                })).join('')}
            </tbody></table></div>
        `;
    };

    const renderVisibility = () => {
        const tools = getTools();
        const visibilityMap = getRoleEngine()?.getVisibility?.() || {};
        return `
            <section class="yd-welcome"><div><h1>Tool Visibility</h1><p>Control discovery and availability by audience.</p></div></section>
            <div class="yd-grid">${tools.map(tool => {
                const record = visibilityMap[tool.id] || { visibility: 'PRIVATE', allowedUsers: [], enabled: false };
                return `<article class="yd-card yd-tool-card"><div class="yd-tool-head"><div class="yd-tool-icon">◉</div><div><div class="yd-tool-name">${escapeHTML(tool.name)}</div><div class="yd-tool-meta">${escapeHTML(tool.id)}</div></div></div><div class="yd-form-grid" style="margin-top:16px"><div class="yd-field"><label>Visibility</label><select data-visibility="${escapeHTML(tool.id)}"><option value="PRIVATE" ${record.visibility === 'PRIVATE' ? 'selected' : ''}>PRIVATE</option><option value="PUBLIC" ${record.visibility === 'PUBLIC' ? 'selected' : ''}>PUBLIC</option><option value="SELECTED_USERS" ${record.visibility === 'SELECTED_USERS' ? 'selected' : ''}>SELECTED_USERS</option></select></div><div class="yd-field"><label>Enabled</label><select data-enabled="${escapeHTML(tool.id)}"><option value="true" ${record.enabled ? 'selected' : ''}>Enabled</option><option value="false" ${!record.enabled ? 'selected' : ''}>Disabled</option></select></div></div><div class="yd-field" style="margin-top:12px"><label>Allowed User IDs (comma separated)</label><input data-allowed="${escapeHTML(tool.id)}" value="${escapeHTML((record.allowedUsers || []).join(', '))}" placeholder="Q-001, Q-002"></div><div style="display:flex;justify-content:flex-end;margin-top:13px"><button class="yd-primary" data-action="save-visibility" data-tool="${escapeHTML(tool.id)}">Save Visibility</button></div></article>`;
            }).join('')}</div>
        `;
    };

    const renderTransactions = () => `
        <section class="yd-welcome"><div><h1>NETWORK Activity</h1><p>Centralized administrative request and transaction history.</p></div><button class="yd-secondary" data-action="refresh">Refresh History</button></section>
        ${renderTransactionsTable(getTransactions())}
    `;

    const renderAccount = () => `
        <section class="yd-welcome"><div><h1>Account Profile</h1><p>Your authenticated dashboard identity.</p></div></section>
        <div class="yd-panel-grid">
            <div class="yd-card"><div class="yd-section-head"><h2>Identity</h2></div>
                <div class="yd-info-row"><span>Full Name</span><strong>${escapeHTML(context.user?.name)}</strong></div>
                <div class="yd-info-row"><span>User ID</span><strong>${escapeHTML(context.user?.id || context.user?.userId)}</strong></div>
                <div class="yd-info-row"><span>Role</span><strong>${escapeHTML(context.userRole)}</strong></div>
                <div class="yd-info-row"><span>Status</span><strong>${escapeHTML(context.user?.status || 'Active')}</strong></div>
            </div>
            <div class="yd-card"><div class="yd-section-head"><h2>Workspace</h2></div>
                <div class="yd-info-row"><span>Personal Repository</span><strong>${escapeHTML(context.personalRepository || '—')}</strong></div>
                <div class="yd-info-row"><span>Dashboard Repository</span><strong>${escapeHTML(context.dashboardRepository || '—')}</strong></div>
                <div class="yd-info-row"><span>Branch</span><strong>${escapeHTML(context.branch || 'main')}</strong></div>
                <div class="yd-info-row"><span>Authenticated</span><strong>Verified</strong></div>
            </div>
        </div>
    `;

    const renderPage = () => ({
        overview: renderOverview,
        tools: renderTools,
        users: renderUsers,
        permissions: renderPermissions,
        visibility: renderVisibility,
        transactions: renderTransactions,
        account: renderAccount
    }[activePage] || renderOverview)();

    const render = () => {
        const root = document.getElementById(CONFIG.ID);
        if (root) root.innerHTML = renderShell(renderPage());
    };

    const setBusy = value => {
        busy = value;
        document.querySelectorAll('#' + CONFIG.ID + ' button[data-action]').forEach(button => {
            button.disabled = value && button.dataset.action !== 'refresh';
        });
    };

    const refresh = async () => {
        await Promise.all([
            context.permissions?.load?.(),
            context.visibility?.load?.()
        ]);
        await context.tools?.loadManifest?.();
        const engine = getRoleEngine();
        if (engine?.refresh) await engine.refresh();
        render();
        return true;
    };

    const openUserModal = user => {
        const editing = Boolean(user);
        const overlay = document.createElement('div');
        overlay.className = 'yd-modal-backdrop';
        overlay.innerHTML = `
            <form class="yd-modal" id="yd-user-form">
                <h3>${editing ? 'Edit User' : 'Add User'}</h3>
                <div class="yd-form-grid">
                    <div class="yd-field"><label>Full Name</label><input name="name" required value="${escapeHTML(user?.name || '')}" placeholder="Employee full name"></div>
                    <div class="yd-field"><label>User ID</label><input name="id" ${editing ? 'disabled' : 'required'} value="${escapeHTML(user?.id || '')}" placeholder="Q-000"></div>
                    <div class="yd-field"><label>Role</label><select name="role"><option value="USER" ${user?.role === 'USER' ? 'selected' : ''}>USER</option><option value="ADMIN" ${user?.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option><option value="SUPER_ADMIN" ${user?.role === 'SUPER_ADMIN' ? 'selected' : ''}>SUPER_ADMIN</option></select></div>
                    <div class="yd-field"><label>Status</label><select name="status"><option value="Active" ${String(user?.status || 'Active').toLowerCase() === 'active' ? 'selected' : ''}>Active</option><option value="Inactive" ${String(user?.status).toLowerCase() === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
                </div>
                <div class="yd-modal-actions"><button type="button" class="yd-secondary" data-modal-close>Cancel</button><button type="submit" class="yd-primary">${editing ? 'Save Changes' : 'Create User'}</button></div>
            </form>
        `;
        document.getElementById(CONFIG.ID).appendChild(overlay);
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-modal-close]')) overlay.remove();
        });
        overlay.querySelector('form').addEventListener('submit', async event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const payload = { name: form.get('name'), role: form.get('role'), status: form.get('status') };
            try {
                setBusy(true);
                if (editing) await context.superAdmin.editUser(user.id, payload);
                else await context.superAdmin.addUser({ ...payload, id: form.get('id') });
                overlay.remove();
                showNotice(editing ? 'User update request submitted.' : 'User creation request submitted.');
                await refresh();
            } catch (error) {
                showNotice(error?.message || 'Unable to submit user request.', 'error');
            } finally {
                setBusy(false);
            }
        });
    };

    const runAction = async (action, button) => {
        if (busy) return;
        try {
            if (action === 'refresh') {
                setBusy(true);
                await refresh();
                showNotice('Dashboard data refreshed.');
            } else if (action === 'sync-tools') {
                setBusy(true);
                await context.tools.sync();
                render();
                showNotice('Tool synchronization completed.');
            } else if (action === 'add-user') {
                openUserModal();
            } else if (action === 'edit-user') {
                openUserModal(getUsers().find(user => user.id === button.dataset.id));
            } else if (action === 'delete-user') {
                if (!confirm('Delete this user? The request will be processed through NETWORK.')) return;
                setBusy(true);
                await context.superAdmin.deleteUser(button.dataset.id);
                showNotice('User deletion request submitted.');
            } else if (action === 'toggle-permission') {
                const granted = button.dataset.granted === 'true';
                setBusy(true);
                await context.superAdmin.setToolPermission(button.dataset.user, button.dataset.tool, { granted: !granted });
                showNotice('Permission update submitted through NETWORK.');
                await refresh();
            } else if (action === 'save-visibility') {
                const id = button.dataset.tool;
                const root = document.getElementById(CONFIG.ID);
                const visibility = root.querySelector('[data-visibility="' + id + '"]').value;
                const enabled = root.querySelector('[data-enabled="' + id + '"]').value === 'true';
                const allowedUsers = root.querySelector('[data-allowed="' + id + '"]').value.split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
                setBusy(true);
                await context.superAdmin.setToolVisibility(id, { visibility, enabled, allowedUsers });
                showNotice('Visibility update submitted through NETWORK.');
                await refresh();
            }
        } catch (error) {
            showNotice(error?.message || 'The requested action failed.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const bindEvents = root => {
        root.addEventListener('click', event => {
            const nav = event.target.closest('[data-page]');
            if (nav) {
                activePage = nav.dataset.page;
                notice = null;
                render();
                return;
            }
            const button = event.target.closest('[data-action]');
            if (button) runAction(button.dataset.action, button);
        });
        root.addEventListener('input', event => {
            if (event.target.id === 'yd-user-search') {
                const query = event.target.value.toLowerCase();
                root.querySelectorAll('tbody tr').forEach(row => {
                    row.hidden = !row.textContent.toLowerCase().includes(query);
                });
            }
            if (event.target.id === 'yd-tool-search') {
                const query = event.target.value.toLowerCase();
                const filtered = getTools().filter(tool => (tool.name + ' ' + tool.id + ' ' + (tool.description || '')).toLowerCase().includes(query));
                const list = root.querySelector('#yd-tool-list');
                if (list) list.innerHTML = renderToolCards(filtered);
            }
        });
    };

    const init = async options => {
        if (context) return true;
        if (!options || options.authenticated !== true || !options.user || !options.tools) {
            throw new Error('Authenticated dashboard context is required.');
        }
        context = options;
        injectStyles();
        document.getElementById(CONFIG.ID)?.remove();
        const root = document.createElement('div');
        root.id = CONFIG.ID;
        document.body.appendChild(root);
        render();
        bindEvents(root);
        refreshTimer = setInterval(() => refresh().catch(() => {}), CONFIG.REFRESH_INTERVAL);
        return true;
    };

    const destroy = async () => {
        clearInterval(refreshTimer);
        refreshTimer = null;
        document.getElementById(CONFIG.ID)?.remove();
        document.getElementById(CONFIG.STYLE_ID)?.remove();
        context = null;
        notice = null;
        return true;
    };

    window.YODAWY_DASHBOARD_UI = Object.freeze({
        version: 1,
        init,
        render,
        refresh,
        destroy,
        getContext: () => context,
        getActivePage: () => activePage
    });
})();
