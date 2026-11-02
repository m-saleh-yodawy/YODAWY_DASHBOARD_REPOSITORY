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
    let isOpen = false;
    let profileOpen = false;

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
        style.textContent = "\n#yd-dashboard-root{color:#29242e;font:13px/1.45 system-ui,-apple-system,\"Segoe UI\",sans-serif}\n#yd-dashboard-root *{box-sizing:border-box}\n#yd-dashboard-root button,#yd-dashboard-root input,#yd-dashboard-root select{font:inherit}\n#yd-dashboard-root #yd-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;background:#875A7B;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:700 12.5px system-ui,-apple-system,sans-serif;cursor:pointer;box-shadow:0 6px 20px #00000029;transition:background .15s}\n#yd-dashboard-root #yd-launcher:hover{background:#68465f}\n#yd-dashboard-root #yd-overlay{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;padding:3vh 3vw;background:#17131c80;backdrop-filter:blur(2px)}\n#yd-dashboard-root #yd-overlay.open{display:flex}\n#yd-dashboard-root #yd-modal{position:relative;width:100%;height:100%;max-width:1180px;max-height:780px;background:#f8f5f7;color:#29242e;border:1px solid #e7e0ea;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 50px #00000038}\n#yd-dashboard-root #yd-header{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:54px;height:54px;padding:0 18px;background:#fff;border-bottom:1px solid #e7e0ea;flex-shrink:0}\n#yd-dashboard-root .yd-brand{display:flex;align-items:center;gap:10px;min-width:0}\n#yd-dashboard-root .yd-brand-logo{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;background:#875A7B;color:#fff;font-size:15px;font-weight:900;flex-shrink:0}\n#yd-dashboard-root .yd-brand-title{font-size:14.5px;font-weight:800;color:#29242e;letter-spacing:.2px}\n#yd-dashboard-root .yd-header-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px}\n#yd-dashboard-root .yd-header-status{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;background:#f8f5f7;border:1px solid #e7e0ea;border-radius:999px;font-size:12px;font-weight:700;color:#68465f}\n#yd-dashboard-root .yd-header-dot{width:7px;height:7px;border-radius:50%;background:#39865b}\n#yd-dashboard-root .yd-profile-wrap{position:relative;display:inline-flex;align-items:center}\n#yd-dashboard-root .yd-gb-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:31px;height:31px;padding:1.5px;border:0;border-radius:50%;background:conic-gradient(#875A7B,#68465f,#b48aa8,#875A7B);cursor:pointer}\n#yd-dashboard-root .yd-gb-avatar{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:#875A7B;color:#fff;border:1px solid #fff;font-size:12px;font-weight:800}\n#yd-dashboard-root .yd-gb-badge{position:absolute;right:-2px;bottom:-2px;width:12px;height:12px;border-radius:50%;background:#fff;color:#39865b;border:2px solid #fff;font-size:8px;text-align:center}\n#yd-dashboard-root .yd-profile-menu{position:absolute;top:calc(100% + 10px);right:0;z-index:2147483005;width:290px;padding:14px;background:#f8f5f7;border:1px solid #e2d9e5;border-radius:16px;box-shadow:0 14px 36px #24152e26}\n#yd-dashboard-root .yd-profile-menu[hidden]{display:none!important}\n#yd-dashboard-root .yd-gb-card{display:flex;flex-direction:column;align-items:center;text-align:center;padding:14px 12px;background:#fff;border:1px solid #eee8f0;border-radius:12px;margin-bottom:8px}\n#yd-dashboard-root .yd-gb-ring-lg{display:flex;align-items:center;justify-content:center;width:48px;height:48px;padding:1.5px;border-radius:50%;background:conic-gradient(#875A7B,#68465f,#b48aa8,#875A7B);margin-bottom:8px}\n#yd-dashboard-root .yd-gb-avatar-lg{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:#875A7B;color:#fff;border:1.5px solid #fff;font-size:18px;font-weight:800}\n#yd-dashboard-root .yd-gb-name{font-size:13.5px;font-weight:800;color:#29242e}\n#yd-dashboard-root .yd-gb-meta{font-size:11px;color:#8c8492;margin-top:2px}\n#yd-dashboard-root .yd-gb-pills{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;flex-wrap:wrap}\n#yd-dashboard-root .yd-dropdown-action{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:10px;background:#fff;color:#29242e;cursor:pointer;text-align:left;font:inherit;margin-top:6px;border:1px solid #eee8f0}\n#yd-dashboard-root .yd-dropdown-action:hover{background:#eee7ed}\n#yd-dashboard-root .yd-action-icon{display:flex;align-items:center;justify-content:center;width:28px;height:28px;flex-shrink:0;border-radius:7px;background:#eee7ed;color:#875A7B}\n#yd-dashboard-root .yd-dropdown-action b{display:block;font-size:12px}\n#yd-dashboard-root .yd-close-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:1px solid #e7e0ea;background:#fff;color:#655c6a;cursor:pointer;padding:0;font-size:19px;line-height:1}\n#yd-dashboard-root .yd-close-btn:hover{background:#fdf0f0;color:#c0392b;border-color:#f5c2c9}\n#yd-dashboard-root #yd-body{display:flex;flex:1;min-height:0}\n#yd-dashboard-root #yd-sidebar{width:195px;flex:0 0 195px;background:#fff;padding:14px 10px;border-right:1px solid #e7e0ea;overflow:auto;display:flex;flex-direction:column;gap:4px}\n#yd-dashboard-root .yd-nav-label{padding:5px 12px 8px;color:#9b92a0;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase}\n#yd-dashboard-root .yd-nav{display:flex;align-items:center;gap:10px;width:100%;height:36px;text-align:left;border:0;border-radius:8px;padding:0 12px;background:transparent;color:#655c6a;font-size:13px;font-weight:600;cursor:pointer;transition:background .12s,color .12s}\n#yd-dashboard-root .yd-nav:hover{background:#f8f5f7;color:#68465f}\n#yd-dashboard-root .yd-nav.active{background:#eee7ed;color:#68465f;font-weight:800}\n#yd-dashboard-root .yd-nav-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;color:#875A7B;flex-shrink:0}\n#yd-dashboard-root .yd-sidebar-bottom{margin-top:auto;padding:14px 12px 4px;border-top:1px solid #f0eaf1;color:#9a909d;font-size:10px;line-height:1.7}\n#yd-dashboard-root #yd-main{flex:1;min-width:0;overflow:auto;padding:20px 24px;background:#f8f5f7}\n#yd-dashboard-root .yd-welcome{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}\n#yd-dashboard-root .yd-welcome h1{margin:0;color:#29242e;font-size:16px;font-weight:800;line-height:1.25}\n#yd-dashboard-root .yd-welcome p{margin:4px 0 0;color:#8c8492;font-size:11.5px}\n#yd-dashboard-root .yd-primary,#yd-dashboard-root .yd-secondary,#yd-dashboard-root .yd-danger{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:0 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;transition:background .15s,opacity .15s}\n#yd-dashboard-root .yd-primary{background:#875A7B;color:#fff;border:1px solid #875A7B}\n#yd-dashboard-root .yd-primary:hover{background:#68465f;border-color:#68465f}\n#yd-dashboard-root .yd-secondary{background:#fff;color:#68465f;border:1px solid #e2d8e6}\n#yd-dashboard-root .yd-secondary:hover{background:#f8f5f7}\n#yd-dashboard-root .yd-danger{background:#fdf0f0;color:#c0392b;border:1px solid #f5c2c9}\n#yd-dashboard-root .yd-danger:hover{background:#fbe2e2}\n#yd-dashboard-root button:disabled{opacity:.45;cursor:not-allowed}\n#yd-dashboard-root .yd-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}\n#yd-dashboard-root .yd-card{background:#fff;border:1px solid #e7e0ea;border-radius:12px;padding:14px 16px;margin-bottom:14px;min-width:0;box-shadow:0 2px 6px #24152e06}\n#yd-dashboard-root .yd-stat{display:flex;justify-content:space-between;align-items:flex-start}\n#yd-dashboard-root .yd-stat-label{color:#7c7482;font-size:11px;font-weight:600}\n#yd-dashboard-root .yd-stat-value{font-size:17px;font-weight:800;color:#29242e;margin-top:2px}\n#yd-dashboard-root .yd-stat-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:9px;background:#eee7ed;color:#875A7B;font-size:16px}\n#yd-dashboard-root .yd-section-head{display:flex;align-items:center;justify-content:space-between;margin:16px 0 10px}\n#yd-dashboard-root .yd-section-head h2{margin:0;font-size:13px;color:#29242e}\n#yd-dashboard-root .yd-section-head span{font-size:10px;color:#958b98}\n#yd-dashboard-root .yd-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}\n#yd-dashboard-root .yd-tool-card{padding:14px}\n#yd-dashboard-root .yd-tool-head{display:flex;align-items:center;gap:10px}\n#yd-dashboard-root .yd-tool-icon{width:36px;height:36px;border-radius:9px;background:#eee7ed;color:#875A7B;display:grid;place-items:center}\n#yd-dashboard-root .yd-tool-name{font-size:12px;font-weight:700;color:#29242e}\n#yd-dashboard-root .yd-tool-meta{font-size:10px;color:#8c8492;margin-top:2px}\n#yd-dashboard-root .yd-tool-description{font-size:11px;color:#817783;margin:10px 0;min-height:28px}\n#yd-dashboard-root .yd-tool-foot{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #f0edf0;padding-top:10px}\n#yd-dashboard-root .yd-status{display:inline-flex;align-items:center;gap:5px;font-size:9px;font-weight:800;text-transform:uppercase;color:#8a818d}\n#yd-dashboard-root .yd-dot{width:6px;height:6px;border-radius:50%;background:#bcb4bd}\n#yd-dashboard-root .yd-status.on{color:#25835f}\n#yd-dashboard-root .yd-status.on .yd-dot{background:#2ba879}\n#yd-dashboard-root .yd-table-wrap{overflow:auto;background:#fff;border:1px solid #e7e0ea;border-radius:12px;margin-bottom:14px}\n#yd-dashboard-root table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}\n#yd-dashboard-root th{height:38px;padding:0 12px;background:#faf8fa;color:#655c6a;font-size:11px;font-weight:700;white-space:nowrap;text-align:left}\n#yd-dashboard-root td{height:42px;padding:6px 12px;border-top:1px solid #f1ecf3;color:#554b58;vertical-align:middle;white-space:nowrap}\n#yd-dashboard-root tbody tr:hover{background:#f9f6f9}\n#yd-dashboard-root .yd-pill{display:inline-flex;align-items:center;gap:5px;min-height:22px;padding:0 9px;background:#eee7ed;color:#68465f;border:1px solid #e2d4df;border-radius:999px;font-size:10px;font-weight:700;white-space:nowrap}\n#yd-dashboard-root .yd-pill.green{background:#eafaf1;color:#1e8449;border-color:#c8f0d8}\n#yd-dashboard-root .yd-pill.red{background:#fdf0f0;color:#c0392b;border-color:#f7d4d4}\n#yd-dashboard-root .yd-pill.blue{background:#ebf5fb;color:#1f618d;border-color:#cbe5f6}\n#yd-dashboard-root .yd-pill.yellow{background:#fef9e7;color:#9a7d0a;border-color:#faeab1}\n#yd-dashboard-root .yd-id-badge{display:inline-flex;align-items:center;justify-content:center;min-height:22px;padding:0 8px;background:#f3ecf1;color:#68465f;border:1px solid #e2d4df;border-radius:6px;font-size:10px;font-weight:700}\n#yd-dashboard-root .yd-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0}\n#yd-dashboard-root .yd-search,#yd-dashboard-root .yd-field input,#yd-dashboard-root .yd-field select,#yd-dashboard-root .yd-input,#yd-dashboard-root .yd-select{height:32px;padding:0 10px;border-radius:8px;border:1px solid #dfd5e3;background:#fff;color:#29242e;font:600 12px system-ui,-apple-system,sans-serif;outline:none}\n#yd-dashboard-root .yd-search{width:min(320px,100%)}\n#yd-dashboard-root .yd-search:focus,#yd-dashboard-root input:focus,#yd-dashboard-root select:focus{border-color:#875A7B;box-shadow:0 0 0 2px #875a7b18}\n#yd-dashboard-root .yd-empty{padding:24px;text-align:center;color:#8c8492;font-size:12px}\n#yd-dashboard-root .yd-panel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}\n#yd-dashboard-root .yd-info-row{display:flex;justify-content:space-between;gap:15px;padding:10px 0;border-bottom:1px solid #f0edf0;font-size:11px}\n#yd-dashboard-root .yd-info-row:last-child{border:0}\n#yd-dashboard-root .yd-info-row span{color:#918793}\n#yd-dashboard-root .yd-info-row strong{text-align:right;overflow-wrap:anywhere}\n#yd-dashboard-root .yd-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:10px}\n#yd-dashboard-root .yd-field{display:flex;flex-direction:column;gap:5px;min-width:0}\n#yd-dashboard-root .yd-field label{font-size:11px;font-weight:700;color:#7c7482}\n#yd-dashboard-root .yd-field input,#yd-dashboard-root .yd-field select{width:100%}\n#yd-dashboard-root .yd-modal-backdrop{position:fixed;inset:0;z-index:2147483005;background:#17131c80;display:grid;place-items:center;padding:20px}\n#yd-dashboard-root .yd-modal{width:min(520px,100%);background:#fff;border:1px solid #e7e0ea;border-radius:13px;padding:22px;box-shadow:0 20px 70px #0003}\n#yd-dashboard-root .yd-modal h3{margin:0 0 16px;font-size:16px;color:#29242e}\n#yd-dashboard-root .yd-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}\n#yd-dashboard-root .yd-toast{position:fixed;right:25px;bottom:24px;z-index:2147483006;max-width:420px;padding:10px 14px;border-radius:8px;background:#29242e;color:#fff;box-shadow:0 10px 30px #0002;font-size:11px;font-weight:600}\n#yd-dashboard-root .yd-toast.error{background:#9f3d48}\n#yd-dashboard-root .yd-switch{position:relative;width:38px;height:20px;border:0;border-radius:999px;background:#d5cbd8;cursor:pointer;padding:2px;vertical-align:middle}\n#yd-dashboard-root .yd-switch.on{background:#287a4b}\n#yd-dashboard-root .yd-switch-knob{display:block;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0003;transition:transform .18s}\n#yd-dashboard-root .yd-switch.on .yd-switch-knob{transform:translateX(18px)}\n@media(max-width:850px){#yd-dashboard-root .yd-stats,#yd-dashboard-root .yd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#yd-dashboard-root .yd-panel-grid{grid-template-columns:1fr}#yd-dashboard-root #yd-sidebar{width:155px;flex-basis:155px}#yd-dashboard-root #yd-main{padding:14px}}\n@media(max-width:600px){#yd-dashboard-root #yd-overlay{padding:0}#yd-dashboard-root #yd-modal{max-height:none;height:100%;border-radius:0}#yd-dashboard-root #yd-header{padding:0 10px}#yd-dashboard-root .yd-brand-title{font-size:11px}#yd-dashboard-root .yd-header-status{padding:0 7px;font-size:10px}#yd-dashboard-root #yd-sidebar{width:56px;flex-basis:56px;padding:10px 5px}#yd-dashboard-root .yd-nav{justify-content:center;padding:0 5px;font-size:0}#yd-dashboard-root .yd-nav span:not(.yd-nav-icon),#yd-dashboard-root .yd-nav-label,#yd-dashboard-root .yd-sidebar-bottom{display:none}#yd-dashboard-root .yd-nav-icon{font-size:15px}#yd-dashboard-root #yd-main{padding:12px 10px}#yd-dashboard-root .yd-form-grid{grid-template-columns:1fr}#yd-dashboard-root .yd-profile-menu{right:-40px;width:min(290px,calc(100vw - 80px))}}\n";
        (document.head || document.documentElement).appendChild(style);
    };
    const navItems = () => {
        const items = [['overview', '▦', 'Overview'], ['tools', '⚒', 'Tools']];
        if (['ADMIN', 'SUPER_ADMIN'].includes(context.userRole)) items.push(['users', '♙', 'Users']);
        if (context.userRole === 'SUPER_ADMIN') items.push(['permissions', '◈', 'Shared Tools'], ['visibility', '◉', 'Visibility'], ['transactions', '⇄', 'NETWORK']);
        items.push(['account', '⚙', 'Settings']);
        return items;
    };

    const pageTitle = () => ({ overview: 'Overview', tools: 'Tools', users: 'Users & Permissions', permissions: 'Shared Tools', visibility: 'Visibility', transactions: 'NETWORK Activity', account: 'Settings' })[activePage] || 'Dashboard';

    const renderShell = body => {
        const user = context.user || {};
        const role = String(context.userRole || 'USER').replace(/_/g, ' ');
        const name = escapeHTML(user.name || user.id || 'User');
        const avatar = escapeHTML(initials(user.name || user.id));
        const menu = navItems().map(([id, icon, label]) => '<button type="button" data-page="' + id + '" class="yd-nav ' + (activePage === id ? 'active' : '') + '"><span class="yd-nav-icon">' + icon + '</span><span>' + escapeHTML(label) + '</span></button>').join('');
        const toast = notice ? '<div class="yd-toast ' + escapeHTML(notice.type) + '">' + escapeHTML(notice.message) + '</div>' : '';
        return '<button id="yd-launcher" type="button" data-action="toggle-dashboard"><span class="yd-brand-logo">Y</span><span>YODAWY DASHBOARD</span></button>' +
            '<div id="yd-overlay" class="' + (isOpen ? 'open' : '') + '">' +
                '<div id="yd-modal" role="dialog" aria-modal="true" aria-label="Yodawy Dashboard">' +
                    '<header id="yd-header"><div class="yd-brand"><div class="yd-brand-logo">Y</div><div class="yd-brand-title">YODAWY DASHBOARD (' + escapeHTML(role.toUpperCase()) + ')</div></div>' +
                        '<div class="yd-header-actions"><div class="yd-header-status"><span class="yd-header-dot"></span><span>Connected</span></div>' +
                            '<div class="yd-profile-wrap"><button id="yd-profile-trigger" class="yd-gb-btn" data-action="profile-toggle" aria-expanded="' + String(profileOpen) + '" type="button" aria-label="Account"><span class="yd-gb-avatar">' + avatar + '</span><span class="yd-gb-badge">✓</span></button>' +
                                '<div id="yd-profile-menu" class="yd-profile-menu"' + (profileOpen ? '' : ' hidden') + '>' +
                                    '<div class="yd-gb-card"><div class="yd-gb-ring-lg"><div class="yd-gb-avatar-lg">' + avatar + '</div></div><div class="yd-gb-name">' + name + '</div><div class="yd-gb-meta">ID: ' + escapeHTML(user.id || user.userId || context.userId || '—') + '</div><div class="yd-gb-pills"><span class="yd-pill blue">' + escapeHTML(role) + '</span><span class="yd-pill green">Connected</span></div></div>' +
                                    '<button class="yd-dropdown-action" data-action="refresh-connection" type="button"><span class="yd-action-icon">↻</span><span><b>Refresh Connection</b></span></button>' +
                                    '<button class="yd-dropdown-action" data-action="refresh-tools" type="button"><span class="yd-action-icon">⚒</span><span><b>Refresh Tools</b></span></button>' +
                                '</div></div><button class="yd-close-btn" data-action="close-dashboard" type="button" title="Close">×</button></div>' +
                    '</header><div id="yd-body"><aside id="yd-sidebar"><div class="yd-nav-label">Workspace</div>' + menu + '<div class="yd-sidebar-bottom">Authenticated Workspace<br>Yodawy Tools Cloud · v1</div></aside><main id="yd-main">' + body + '</main></div>' +
                '</div></div>' + toast;
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
            if (event.target.id === 'yd-overlay') { isOpen = false; profileOpen = false; render(); return; }
            const actionButton = event.target.closest('[data-action]');
            if (actionButton?.dataset.action === 'toggle-dashboard') { isOpen = !isOpen; render(); return; }
            if (actionButton?.dataset.action === 'close-dashboard') { isOpen = false; profileOpen = false; render(); return; }
            if (actionButton?.dataset.action === 'profile-toggle') { profileOpen = !profileOpen; render(); return; }
            const nav = event.target.closest('[data-page]');
            if (nav) { activePage = nav.dataset.page; notice = null; profileOpen = false; render(); return; }
            if (actionButton?.dataset.action === 'refresh-connection') { runAction('refresh'); return; }
            if (actionButton?.dataset.action === 'refresh-tools') { runAction('sync-tools'); return; }
            if (actionButton) runAction(actionButton.dataset.action, actionButton);
        });
        root.addEventListener('input', event => {
            if (event.target.id === 'yd-user-search' || event.target.id === 'yd-tool-search') {
                const query = event.target.value.toLowerCase();
                root.querySelectorAll('tbody tr').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(query); });
            }
        });
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && isOpen) { isOpen = false; profileOpen = false; render(); } });
    };

    const init = async options => {
        if (context) return true;
        if (!options || options.authenticated !== true || !options.user || !options.tools) {
            throw new Error('Authenticated dashboard context is required.');
        }
        context = options;
        isOpen = false;
        profileOpen = false;
        injectStyles();
        document.getElementById(CONFIG.ID)?.remove();
        const root = document.createElement('div');
        root.id = CONFIG.ID;
        document.body.appendChild(root);
        render();
        bindEvents(root);
        refreshTimer = null;
        return true;
    };

    const destroy = async () => {
        clearInterval(refreshTimer);
        refreshTimer = null;
        document.getElementById(CONFIG.ID)?.remove();
        document.getElementById(CONFIG.STYLE_ID)?.remove();
        context = null;
        notice = null;
        isOpen = false;
        profileOpen = false;
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
