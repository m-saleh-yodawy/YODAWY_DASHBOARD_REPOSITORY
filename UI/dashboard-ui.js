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

    const injectStyles = () => {\n        if (document.getElementById(CONFIG.STYLE_ID)) return;\n        const style = document.createElement('style');\n        style.id = CONFIG.STYLE_ID;\n        style.textContent = "\n#yd-dashboard-root{--brand:#875a7b;--brand-dark:#68465f;--brand-soft:#f4edf3;--ink:#29242e;--text:#514a56;--muted:#77717d;--subtle:#9b949f;--border:#e9e4eb;--border-soft:#f1edf2;--canvas:#f7f6f8;--success:#247a53;--success-bg:#eef8f2;--success-border:#d7eadf;--info:#35678f;--info-bg:#edf4fa;--info-border:#d9e7f2;--warning:#926b22;--warning-bg:#fbf6e9;--warning-border:#efe2bd;--danger:#b94b55;--danger-bg:#fcf0f0;--danger-border:#f0d7d9;color:var(--ink);font:13px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",sans-serif;font-synthesis:none;text-rendering:optimizeLegibility}\n#yd-dashboard-root *{box-sizing:border-box}\n#yd-dashboard-root button,#yd-dashboard-root input,#yd-dashboard-root select{font:inherit}\n#yd-dashboard-root #yd-launcher{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:inline-flex;align-items:center;gap:10px;min-height:46px;padding:0 18px;border:1px solid var(--brand);border-radius:999px;background:var(--brand);color:#fff;font-size:12px;font-weight:750;letter-spacing:.02em;cursor:pointer;box-shadow:0 8px 24px #39223924;transition:all .16s}\n#yd-dashboard-root #yd-launcher:hover{background:var(--brand-dark);border-color:var(--brand-dark);box-shadow:0 10px 26px #39223930;transform:translateY(-1px)}\n#yd-dashboard-root #yd-overlay{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;padding:24px;background:#17131c85;backdrop-filter:blur(4px)}\n#yd-dashboard-root #yd-overlay.open{display:flex}\n#yd-dashboard-root #yd-modal{position:relative;display:flex;flex-direction:column;width:min(1360px,100%);height:min(860px,calc(100vh - 48px));max-height:calc(100vh - 48px);overflow:hidden;border:1px solid #e5dfe8;border-radius:18px;background:var(--canvas);color:var(--ink);box-shadow:0 28px 80px #17131c40}\n#yd-dashboard-root #yd-header{display:flex;align-items:center;justify-content:space-between;gap:18px;flex:0 0 68px;min-height:68px;padding:0 24px;background:#fff;border-bottom:1px solid var(--border)}\n#yd-dashboard-root .yd-brand{display:flex;align-items:center;gap:12px;min-width:0}\n#yd-dashboard-root .yd-brand-logo{display:flex;align-items:center;justify-content:center;width:36px;height:36px;flex:0 0 36px;border-radius:10px;background:var(--brand);color:#fff;font-size:17px;font-weight:850}\n#yd-dashboard-root .yd-brand-title{overflow:hidden;color:var(--ink);font-size:14px;font-weight:800;letter-spacing:.035em;text-overflow:ellipsis;white-space:nowrap}\n#yd-dashboard-root .yd-header-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px}\n#yd-dashboard-root .yd-header-status{display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;border:1px solid var(--success-border);border-radius:999px;background:var(--success-bg);color:var(--success);font-size:11px;font-weight:700;white-space:nowrap}\n#yd-dashboard-root .yd-header-dot{width:7px;height:7px;border-radius:50%;background:#2e9464;box-shadow:0 0 0 3px #2e94641a}\n#yd-dashboard-root .yd-profile-wrap{position:relative;display:inline-flex;align-items:center}\n#yd-dashboard-root .yd-gb-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;padding:2px;border:0;border-radius:50%;background:conic-gradient(var(--brand),var(--brand-dark),#b48aa8,var(--brand));cursor:pointer}\n#yd-dashboard-root .yd-gb-avatar{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:2px solid #fff;border-radius:50%;background:var(--brand);color:#fff;font-size:12px;font-weight:800}\n#yd-dashboard-root .yd-gb-badge{position:absolute;right:-2px;bottom:-2px;display:grid;place-items:center;width:14px;height:14px;border:2px solid #fff;border-radius:50%;background:var(--success);color:#fff;font-size:8px}\n#yd-dashboard-root .yd-profile-menu{position:absolute;top:calc(100% + 12px);right:0;z-index:2147483005;width:304px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--canvas);box-shadow:0 16px 42px #24152e20}\n#yd-dashboard-root .yd-profile-menu[hidden]{display:none!important}\n#yd-dashboard-root .yd-gb-card{display:flex;flex-direction:column;align-items:center;margin-bottom:10px;padding:18px 14px;border:1px solid var(--border);border-radius:12px;background:#fff;text-align:center}\n#yd-dashboard-root .yd-gb-ring-lg{display:flex;align-items:center;justify-content:center;width:54px;height:54px;margin-bottom:10px;padding:2px;border-radius:50%;background:conic-gradient(var(--brand),var(--brand-dark),#b48aa8,var(--brand))}\n#yd-dashboard-root .yd-gb-avatar-lg{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:2px solid #fff;border-radius:50%;background:var(--brand);color:#fff;font-size:18px;font-weight:800}\n#yd-dashboard-root .yd-gb-name{color:var(--ink);font-size:14px;font-weight:800}\n#yd-dashboard-root .yd-gb-meta{margin-top:3px;color:var(--muted);font-size:11px}\n#yd-dashboard-root .yd-gb-pills{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:10px;flex-wrap:wrap}\n#yd-dashboard-root .yd-dropdown-action{display:flex;align-items:center;gap:11px;width:100%;min-height:46px;margin-top:7px;padding:7px 10px;border:1px solid var(--border);border-radius:10px;background:#fff;color:var(--text);cursor:pointer;text-align:left}\n#yd-dashboard-root .yd-dropdown-action:hover{border-color:#e1d4e0;background:var(--brand-soft);color:var(--brand-dark)}\n#yd-dashboard-root .yd-action-icon{display:flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 30px;border-radius:8px;background:var(--brand-soft);color:var(--brand);font-size:14px}\n#yd-dashboard-root .yd-dropdown-action b{display:block;font-size:12px;font-weight:700}\n#yd-dashboard-root .yd-close-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:1px solid var(--border);border-radius:9px;background:#fff;color:var(--muted);cursor:pointer;font-size:21px;line-height:1;transition:all .15s}\n#yd-dashboard-root .yd-close-btn:hover{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}\n#yd-dashboard-root #yd-body{display:flex;flex:1;min-height:0}\n#yd-dashboard-root #yd-sidebar{display:flex;flex:0 0 224px;flex-direction:column;gap:5px;width:224px;overflow:auto;padding:20px 14px;border-right:1px solid var(--border);background:#fff}\n#yd-dashboard-root .yd-nav-label{padding:6px 12px 10px;color:var(--subtle);font-size:10px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}\n#yd-dashboard-root .yd-nav{display:flex;align-items:center;gap:11px;width:100%;min-height:42px;padding:0 12px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--text);cursor:pointer;text-align:left;font-size:12.5px;font-weight:650;transition:all .14s}\n#yd-dashboard-root .yd-nav:hover{background:#f8f5f8;color:var(--brand-dark)}\n#yd-dashboard-root .yd-nav.active{border-color:#eadfe8;background:var(--brand-soft);color:var(--brand-dark);font-weight:750}\n#yd-dashboard-root .yd-nav-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 20px;color:var(--brand);font-size:15px}\n#yd-dashboard-root .yd-sidebar-bottom{margin-top:auto;padding:16px 12px 4px;border-top:1px solid var(--border-soft);color:var(--subtle);font-size:10px;line-height:1.75}\n#yd-dashboard-root #yd-main{flex:1;min-width:0;overflow:auto;padding:28px 30px;background:var(--canvas);scrollbar-color:#d7cfd9 transparent;scrollbar-width:thin}\n#yd-dashboard-root .yd-welcome{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 22px}\n#yd-dashboard-root .yd-welcome h1{margin:0;color:var(--ink);font-size:21px;font-weight:800;letter-spacing:-.035em;line-height:1.25}\n#yd-dashboard-root .yd-welcome p{margin:6px 0 0;color:var(--muted);font-size:12.5px;line-height:1.5}\n#yd-dashboard-root .yd-primary,#yd-dashboard-root .yd-secondary,#yd-dashboard-root .yd-danger{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:0 14px;border-radius:9px;cursor:pointer;font-size:12px;font-weight:750;white-space:nowrap;transition:all .15s}\n#yd-dashboard-root .yd-primary{border:1px solid var(--brand);background:var(--brand);color:#fff;box-shadow:0 2px 5px #875a7b1a}\n#yd-dashboard-root .yd-primary:hover{border-color:var(--brand-dark);background:var(--brand-dark);box-shadow:0 3px 8px #68465f24}\n#yd-dashboard-root .yd-secondary{border:1px solid #e2dbe5;background:#fff;color:var(--brand-dark)}\n#yd-dashboard-root .yd-secondary:hover{border-color:#d8c7d7;background:var(--brand-soft)}\n#yd-dashboard-root .yd-danger{border:1px solid var(--danger-border);background:var(--danger-bg);color:var(--danger)}\n#yd-dashboard-root .yd-danger:hover{border-color:#e7bec2;background:#f9e7e8}\n#yd-dashboard-root button:disabled{opacity:.48;cursor:not-allowed;box-shadow:none}\n#yd-dashboard-root .yd-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}\n#yd-dashboard-root .yd-card{min-width:0;margin-bottom:16px;padding:18px;border:1px solid var(--border);border-radius:13px;background:#fff;box-shadow:0 2px 8px #29242e07}\n#yd-dashboard-root .yd-stat{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}\n#yd-dashboard-root .yd-stat-label{color:var(--muted);font-size:11.5px;font-weight:650}\n#yd-dashboard-root .yd-stat-value{margin-top:4px;color:var(--ink);font-size:20px;font-weight:800;letter-spacing:-.025em}\n#yd-dashboard-root .yd-stat-icon{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:var(--brand-soft);color:var(--brand);font-size:17px}\n#yd-dashboard-root .yd-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0 12px}\n#yd-dashboard-root .yd-section-head h2{margin:0;color:var(--ink);font-size:14px;font-weight:800}\n#yd-dashboard-root .yd-section-head span{color:var(--muted);font-size:11px}\n#yd-dashboard-root .yd-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}\n#yd-dashboard-root .yd-tool-card{display:flex;flex-direction:column;min-height:156px;margin:0;padding:16px}\n#yd-dashboard-root .yd-tool-head{display:flex;align-items:center;gap:12px;min-width:0}\n#yd-dashboard-root .yd-tool-icon{display:grid;place-items:center;width:40px;height:40px;flex:0 0 40px;border-radius:10px;background:var(--brand-soft);color:var(--brand);font-size:16px}\n#yd-dashboard-root .yd-tool-name{color:var(--ink);font-size:12.5px;font-weight:750;line-height:1.4}\n#yd-dashboard-root .yd-tool-meta{margin-top:4px;color:var(--muted);font-size:10.5px}\n#yd-dashboard-root .yd-tool-description{min-height:38px;margin:14px 0;color:var(--muted);font-size:11.5px;line-height:1.55}\n#yd-dashboard-root .yd-tool-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:11px;border-top:1px solid var(--border-soft)}\n#yd-dashboard-root .yd-status{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:10px;font-weight:750;text-transform:uppercase}\n#yd-dashboard-root .yd-dot{width:7px;height:7px;border-radius:50%;background:#b8b1bb}\n#yd-dashboard-root .yd-status.on{color:var(--success)}\n#yd-dashboard-root .yd-status.on .yd-dot{background:#2e9464;box-shadow:0 0 0 3px #2e94641a}\n#yd-dashboard-root .yd-table-wrap{overflow:auto;margin-bottom:16px;border:1px solid var(--border);border-radius:13px;background:#fff;box-shadow:0 2px 8px #29242e06}\n#yd-dashboard-root table{width:100%;border-collapse:separate;border-spacing:0;text-align:left;font-size:12px}\n#yd-dashboard-root thead th{height:44px;padding:0 15px;border-bottom:1px solid var(--border);background:#faf9fb;color:#716a76;font-size:10.5px;font-weight:800;letter-spacing:.025em;text-align:left;white-space:nowrap}\n#yd-dashboard-root tbody td,#yd-dashboard-root tbody th{height:49px;padding:8px 15px;border-top:1px solid var(--border-soft);background:#fff;color:var(--text);font-size:12px;font-weight:500;vertical-align:middle;white-space:nowrap}\n#yd-dashboard-root tbody tr:first-child td,#yd-dashboard-root tbody tr:first-child th{border-top:0}\n#yd-dashboard-root tbody tr:hover td,#yd-dashboard-root tbody tr:hover th{background:#fbf9fc}\n#yd-dashboard-root td strong{color:var(--ink);font-weight:750}\n#yd-dashboard-root .yd-pill{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:2px 9px;border:1px solid #e6dce6;border-radius:999px;background:var(--brand-soft);color:var(--brand-dark);font-size:10.5px;font-weight:750;line-height:1.2;white-space:nowrap}\n#yd-dashboard-root .yd-pill.green{border-color:var(--success-border);background:var(--success-bg);color:var(--success)}\n#yd-dashboard-root .yd-pill.red{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}\n#yd-dashboard-root .yd-pill.blue{border-color:var(--info-border);background:var(--info-bg);color:var(--info)}\n#yd-dashboard-root .yd-pill.yellow{border-color:var(--warning-border);background:var(--warning-bg);color:var(--warning)}\n#yd-dashboard-root .yd-id-badge{display:inline-flex;align-items:center;justify-content:center;min-height:24px;padding:2px 9px;border:1px solid #e8dfe8;border-radius:7px;background:#f7f2f6;color:var(--brand-dark);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;font-weight:750}\n#yd-dashboard-root .yd-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px}\n#yd-dashboard-root .yd-search,#yd-dashboard-root .yd-field input,#yd-dashboard-root .yd-field select,#yd-dashboard-root .yd-input,#yd-dashboard-root .yd-select{width:auto;min-width:0;height:38px;padding:0 11px;border:1px solid #ded8e1;border-radius:9px;outline:none;background:#fff;color:var(--ink);font-size:12px;font-weight:550;transition:border-color .15s,box-shadow .15s}\n#yd-dashboard-root .yd-search{width:min(360px,100%)}\n#yd-dashboard-root .yd-search::placeholder,#yd-dashboard-root input::placeholder{color:#aaa3ad;font-weight:450}\n#yd-dashboard-root .yd-search:focus,#yd-dashboard-root input:focus,#yd-dashboard-root select:focus{border-color:#b28aa8;box-shadow:0 0 0 3px #875a7b15}\n#yd-dashboard-root .yd-empty{padding:30px 18px!important;color:var(--muted)!important;font-size:12px!important;text-align:center}\n#yd-dashboard-root .yd-panel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}\n#yd-dashboard-root .yd-info-row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--border-soft);font-size:12px}\n#yd-dashboard-root .yd-info-row:last-child{border:0}\n#yd-dashboard-root .yd-info-row span{color:var(--muted)}\n#yd-dashboard-root .yd-info-row strong{max-width:65%;overflow-wrap:anywhere;color:var(--ink);font-weight:700;text-align:right}\n#yd-dashboard-root .yd-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:12px}\n#yd-dashboard-root .yd-field{display:flex;flex-direction:column;gap:7px;min-width:0}\n#yd-dashboard-root .yd-field label{color:var(--text);font-size:11.5px;font-weight:750}\n#yd-dashboard-root .yd-field input,#yd-dashboard-root .yd-field select{width:100%}\n#yd-dashboard-root .yd-modal-backdrop{position:fixed;inset:0;z-index:2147483005;display:grid;place-items:center;padding:22px;background:#17131c88;backdrop-filter:blur(3px)}\n#yd-dashboard-root .yd-modal{width:min(560px,100%);padding:26px;border:1px solid var(--border);border-radius:15px;background:#fff;box-shadow:0 24px 70px #17131c38}\n#yd-dashboard-root .yd-modal h3{margin:0 0 18px;color:var(--ink);font-size:18px;font-weight:800;letter-spacing:-.025em}\n#yd-dashboard-root .yd-modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:24px;padding-top:16px;border-top:1px solid var(--border-soft)}\n#yd-dashboard-root .yd-toast{position:fixed;right:26px;bottom:26px;z-index:2147483006;max-width:min(440px,calc(100vw - 32px));padding:12px 16px;border:1px solid #3b3442;border-radius:10px;background:#302a35;color:#fff;box-shadow:0 12px 32px #17131c24;font-size:12px;font-weight:650}\n#yd-dashboard-root .yd-toast.error{border-color:#a8414a;background:#a8414a}\n#yd-dashboard-root .yd-switch{position:relative;display:inline-flex;align-items:center;width:42px;height:24px;padding:3px;border:0;border-radius:999px;background:#d8d2da;cursor:pointer;vertical-align:middle;transition:background .16s}\n#yd-dashboard-root .yd-switch.on{background:#2b865c}\n#yd-dashboard-root .yd-switch-knob{display:block;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transition:transform .16s}\n#yd-dashboard-root .yd-switch.on .yd-switch-knob{transform:translateX(18px)}\n#yd-dashboard-root .yd-kpi-card{display:flex;align-items:center;gap:13px;min-width:0;min-height:86px;padding:15px 16px;border:1px solid var(--border);border-radius:13px;background:#fff;box-shadow:0 2px 8px #29242e07}\n#yd-dashboard-root .yd-kpi-icon{display:flex;align-items:center;justify-content:center;width:42px;height:42px;flex:0 0 42px;border-radius:11px;background:var(--brand-soft);color:var(--brand);font-size:16px;font-weight:800}\n#yd-dashboard-root .yd-kpi-icon.blue{background:var(--info-bg);color:var(--info)}\n#yd-dashboard-root .yd-kpi-icon.green{background:var(--success-bg);color:var(--success)}\n#yd-dashboard-root .yd-kpi-icon.purple{background:var(--brand-soft);color:var(--brand)}\n#yd-dashboard-root .yd-kpi-icon.amber{background:var(--warning-bg);color:var(--warning)}\n#yd-dashboard-root .yd-kpi-info{display:flex;flex-direction:column;justify-content:center;min-width:0}\n#yd-dashboard-root .yd-kpi-label{overflow:hidden;color:var(--muted);font-size:11px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}\n#yd-dashboard-root .yd-kpi-value{margin-top:3px;color:var(--ink);font-size:20px;font-weight:800;letter-spacing:-.025em;line-height:1.25}\n#yd-dashboard-root .yd-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}\n#yd-dashboard-root .yd-card-title{display:flex;align-items:center;gap:9px;margin:0 0 8px;padding-bottom:12px;border-bottom:1px solid var(--border-soft);color:var(--ink);font-size:13px;font-weight:800}\n#yd-dashboard-root .yd-clean-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:42px;border-bottom:1px solid #f4f0f5;font-size:12px}\n#yd-dashboard-root .yd-clean-row:last-child{border-bottom:0}\n#yd-dashboard-root .yd-clean-label{color:var(--muted);font-weight:600}\n#yd-dashboard-root .yd-clean-val{color:var(--ink);font-weight:750;text-align:right}\n#yd-dashboard-root .yd-table-card{overflow:hidden;margin-bottom:16px;border:1px solid var(--border);border-radius:13px;background:#fff;box-shadow:0 2px 8px #29242e07}\n#yd-dashboard-root .yd-table-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:54px;padding:10px 16px;border-bottom:1px solid var(--border);background:#fff;flex-wrap:wrap}\n#yd-dashboard-root .yd-table-card-title{display:flex;align-items:center;gap:9px;color:var(--ink);font-size:13px;font-weight:800}\n#yd-dashboard-root .yd-table-pills{display:flex;align-items:center;gap:7px;flex-wrap:wrap}\n#yd-dashboard-root .yd-table-responsive{width:100%;overflow-x:auto}\n#yd-dashboard-root .yd-switch-state{display:inline-block;min-width:28px;margin-left:7px;color:var(--muted);font-size:10.5px;font-weight:750}\n#yd-dashboard-root .yd-access-badge{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1px solid transparent;border-radius:8px;font-size:14px;font-weight:850}\n#yd-dashboard-root .yd-access-badge.unlocked{border-color:var(--success-border);background:var(--success-bg);color:var(--success)}\n#yd-dashboard-root .yd-access-badge.locked{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}\n@media(max-width:1120px){#yd-dashboard-root .yd-stats,#yd-dashboard-root .yd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#yd-dashboard-root #yd-main{padding:24px}}\n@media(max-width:850px){#yd-dashboard-root .yd-panel-grid,#yd-dashboard-root .yd-info-grid{grid-template-columns:1fr}#yd-dashboard-root #yd-sidebar{width:190px;flex-basis:190px}#yd-dashboard-root #yd-main{padding:20px}}\n@media(max-width:620px){#yd-dashboard-root #yd-overlay{padding:0}#yd-dashboard-root #yd-modal{width:100%;height:100%;max-height:none;border:0;border-radius:0}#yd-dashboard-root #yd-header{flex-basis:60px;min-height:60px;padding:0 13px;gap:8px}#yd-dashboard-root .yd-brand{gap:8px}#yd-dashboard-root .yd-brand-logo{width:32px;height:32px;flex-basis:32px}#yd-dashboard-root .yd-brand-title{max-width:180px;font-size:11px}#yd-dashboard-root .yd-header-actions{gap:7px}#yd-dashboard-root .yd-header-status{min-height:30px;padding:0 8px;font-size:10px}#yd-dashboard-root .yd-gb-btn{width:34px;height:34px}#yd-dashboard-root .yd-close-btn{width:32px;height:32px}#yd-dashboard-root #yd-sidebar{width:60px;flex-basis:60px;padding:12px 6px}#yd-dashboard-root .yd-nav{justify-content:center;min-height:42px;padding:0 6px;font-size:0}#yd-dashboard-root .yd-nav span:not(.yd-nav-icon),#yd-dashboard-root .yd-nav-label,#yd-dashboard-root .yd-sidebar-bottom{display:none}#yd-dashboard-root .yd-nav-icon{font-size:16px}#yd-dashboard-root #yd-main{padding:18px 14px}#yd-dashboard-root .yd-welcome{margin-bottom:18px}#yd-dashboard-root .yd-welcome h1{font-size:19px}#yd-dashboard-root .yd-stats,#yd-dashboard-root .yd-grid{grid-template-columns:1fr 1fr;gap:10px}#yd-dashboard-root .yd-kpi-card{min-height:76px;padding:11px}#yd-dashboard-root .yd-kpi-icon{width:36px;height:36px;flex-basis:36px}#yd-dashboard-root .yd-kpi-value{font-size:17px}#yd-dashboard-root .yd-form-grid{grid-template-columns:1fr}#yd-dashboard-root .yd-profile-menu{right:-44px;width:min(304px,calc(100vw - 82px))}#yd-dashboard-root .yd-modal-backdrop{padding:12px}#yd-dashboard-root .yd-modal{padding:20px}}\n@media(max-width:380px){#yd-dashboard-root .yd-header-status{display:none}#yd-dashboard-root .yd-stats,#yd-dashboard-root .yd-grid{grid-template-columns:1fr}#yd-dashboard-root .yd-table-card-head{align-items:flex-start}}\n@media(prefers-reduced-motion:reduce){#yd-dashboard-root *,#yd-dashboard-root *::before,#yd-dashboard-root *::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}\n";\n        (document.head || document.documentElement).appendChild(style);\n    };\n    const navItems = () => {
        const items = [['overview', '▦', 'Overview'], ['tools', '⚒', 'Tools']];
        if (['ADMIN', 'SUPER_ADMIN'].includes(context.userRole)) items.push(['users', '♙', 'Users']);
        if (context.userRole === 'ADMIN') items.push(['permissions', '◈', 'User Permissions']);
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
    const statCard = (label, value, icon, colorClass = 'purple') =>
        '<div class="yd-kpi-card"><div class="yd-kpi-icon ' + colorClass + '">' + icon + '</div><div class="yd-kpi-info"><div class="yd-kpi-label">' + escapeHTML(label) + '</div><div class="yd-kpi-value">' + escapeHTML(value) + '</div></div></div>';

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
        const toolList = getTools();
        const visibleTools = toolList.filter(tool => context.userRole === 'SUPER_ADMIN' || context.visibility?.isVisible?.(tool.id, tool));
        const permittedTools = visibleTools.filter(tool => context.permissions?.canUse?.(context.userId || context.user?.id, tool.id) === true);
        const enabledTools = permittedTools.filter(tool => context.settings?.isEnabled?.(tool.id) === true);
        const settings = context.settings?.getSettings?.() || {};
        const user = context.user || {};
        const role = String(context.userRole || 'USER').replace(/_/g, ' ');
        return '<section class="yd-welcome"><div><h1>Overview</h1><p>Your centralized Yodawy tools workspace and account status.</p></div><button class="yd-primary" data-action="refresh">↻ &nbsp; Sync</button></section>' +
            '<section class="yd-stats">' +
                statCard('Tools', visibleTools.length, '⚒', 'blue') +
                statCard('Permitted', permittedTools.length, '♙', 'green') +
                statCard('Active (ON)', enabledTools.length, 'ϟ', 'purple') +
                statCard('Status', 'Connected', '☁', 'green') +
            '</section>' +
            '<section class="yd-info-grid">' +
                '<div class="yd-card"><div class="yd-card-title">♙ <span>Account</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Name</span><span class="yd-clean-val">' + escapeHTML(settings.displayName || user.name || '—') + '</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">User ID</span><span class="yd-id-badge">' + escapeHTML(user.id || user.userId || context.userId || '—') + '</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Role</span><span class="yd-pill blue">' + escapeHTML(role) + '</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Account Status</span><span class="yd-pill green">' + escapeHTML(user.status || 'Active') + '</span></div>' +
                '</div>' +
                '<div class="yd-card"><div class="yd-card-title">☁ <span>Connection</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">System</span><span class="yd-pill green">Connected to system</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Personal Settings</span><span class="yd-pill ' + (context.settings?.isLoaded?.() ? 'green' : 'red') + '">' + (context.settings?.isLoaded?.() ? 'Connected' : 'Unavailable') + '</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Tools Sync</span><span class="yd-pill ' + (context.tools?.isInitialized?.() ? 'blue' : 'yellow') + '">' + (context.tools?.isInitialized?.() ? 'Ready' : 'Pending') + '</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Current Site</span><span class="yd-pill">' + escapeHTML(location.hostname) + '</span></div>' +
                '</div>' +
            '</section>';
    };
    const renderTools = () => {
        const allTools = getTools();
        const visibleTools = allTools.filter(tool => context.userRole === 'SUPER_ADMIN' || context.visibility?.isVisible?.(tool.id, tool));
        const userId = context.userId || context.user?.id;
        const permittedCount = visibleTools.filter(tool => context.permissions?.canUse?.(userId, tool.id) === true).length;
        const onCount = visibleTools.filter(tool => context.permissions?.canUse?.(userId, tool.id) === true && context.settings?.isEnabled?.(tool.id) === true).length;
        const rows = visibleTools.map((tool, index) => {
            const id = String(tool.id || '').trim();
            const allowed = context.permissions?.canUse?.(userId, id) === true;
            const enabled = allowed && context.settings?.isEnabled?.(id) === true;
            return '<tr><th>' + (index + 1) + '</th><td><span class="yd-id-badge">' + escapeHTML(id) + '</span></td><td><div class="yd-tool-name">' + escapeHTML(tool.name) + '</div></td><td style="text-align:center"><span class="yd-access-badge ' + (allowed ? 'unlocked' : 'locked') + '">' + (allowed ? '✓' : '×') + '</span></td><td style="text-align:right"><button class="yd-switch ' + (enabled ? 'on' : '') + '" data-action="toggle-my-tool" data-tool="' + escapeHTML(id) + '" data-enabled="' + String(enabled) + '" ' + (allowed ? '' : 'disabled') + ' role="switch" aria-checked="' + String(enabled) + '"><span class="yd-switch-knob"></span></button><span class="yd-switch-state">' + (enabled ? 'ON' : 'OFF') + '</span></td></tr>';
        }).join('');
        return '<section class="yd-welcome"><div><h1>Tools</h1><p>Manage access and personal ON/OFF status for available tools.</p></div><button class="yd-secondary" data-action="sync-tools">↻ &nbsp; Reload</button></section>' +
            '<div class="yd-toolbar"><input class="yd-search" id="yd-tool-search" placeholder="Search tools by name or ID"><span class="yd-pill">' + getLoadedTools().length + ' loaded / ' + allTools.length + ' total</span></div>' +
            '<div class="yd-table-card"><div class="yd-table-card-head"><div class="yd-table-card-title">⚒ <span>Tools (' + visibleTools.length + ')</span></div><div class="yd-table-pills"><span class="yd-pill blue">' + permittedCount + ' Permitted</span><span class="yd-pill green">' + onCount + ' ON</span></div></div>' +
            '<div class="yd-table-responsive"><table><thead><tr><th style="width:50px">#</th><th style="width:120px">ID</th><th>Tool</th><th style="width:100px;text-align:center">Access</th><th style="width:120px;text-align:right">Status</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="yd-empty">No tools available.</td></tr>') + '</tbody></table></div></div>';
    };
    const renderUsers = () => {
        const users = getUsers();
        const isAdmin = context.userRole === 'ADMIN';
        const roleDescription = isAdmin
            ? 'Manage USER accounts and their basic account details.'
            : 'Manage registered accounts and their dashboard roles.';

        return `
            <section class="yd-welcome"><div><h1>Users Directory</h1><p>${roleDescription}</p></div><button class="yd-primary" data-action="add-user">＋ Add User</button></section>
            <div class="yd-toolbar"><input class="yd-search" id="yd-user-search" placeholder="Search by ID, name, role or repository"><span class="yd-pill">${users.length} users</span></div>
            <div class="yd-table-wrap"><table><thead><tr><th>User</th><th>User ID</th><th>Role</th><th>Status</th><th>Personal Repository</th><th>Actions</th></tr></thead><tbody>
                ${users.map(user => `<tr><td><strong>${escapeHTML(user.name)}</strong></td><td>${escapeHTML(user.id)}</td><td><span class="yd-pill">${escapeHTML(user.role)}</span></td><td><span class="yd-pill ${String(user.status).toLowerCase() === 'active' ? 'green' : 'red'}">${escapeHTML(user.status)}</span></td><td>${escapeHTML(user.repository || 'Provisioning')}</td><td><button class="yd-secondary" data-action="edit-user" data-id="${escapeHTML(user.id)}">Edit</button>${isAdmin ? '' : ` <button class="yd-danger" data-action="delete-user" data-id="${escapeHTML(user.id)}">Delete</button>`}</td></tr>`).join('')}
            </tbody></table></div>
        `;
    };

    const renderPermissions = () => {
        const allUsers = getUsers();
        const users = allUsers.filter(user =>
            context.userRole === 'SUPER_ADMIN'
                ? ['ADMIN', 'USER'].includes(String(user.role).toUpperCase())
                : String(user.role).toUpperCase() === 'USER'
        );
        const tools = getRoleEngine()?.getTools?.() || getTools().filter(tool =>
            context.userRole === 'SUPER_ADMIN' || context.visibility?.isVisible?.(tool.id, tool)
        );
        const permissions = getRoleEngine()?.getPermissions?.() || {};
        const isAdmin = context.userRole === 'ADMIN';
        const title = isAdmin ? 'User Permissions' : 'Tool Permissions';
        const description = isAdmin
            ? 'Grant or revoke tool access for USER accounts.'
            : 'Grant or revoke tool access for ADMIN and USER accounts.';

        return `
            <section class="yd-welcome"><div><h1>${title}</h1><p>${description}</p></div><span class="yd-pill">${isAdmin ? 'ADMIN CONTROL' : 'SUPER ADMIN CONTROL'}</span></section>
            <div class="yd-table-wrap"><table><thead><tr><th>User</th><th>Tool</th><th>Granted</th><th>Forced State</th><th>Action</th></tr></thead><tbody>
                ${users.flatMap(user => tools.map(tool => {
                    const record = permissions[user.id]?.[tool.id] || {};
                    return `<tr><td><strong>${escapeHTML(user.name)}</strong><br>${escapeHTML(user.id)}</td><td>${escapeHTML(tool.name)}</td><td><span class="yd-pill ${record.granted ? 'green' : 'red'}">${record.granted ? 'Granted' : 'Denied'}</span></td><td>${record.forcedState ? 'Protected' : 'Normal'}</td><td><button class="yd-secondary" data-action="toggle-permission" data-user="${escapeHTML(user.id)}" data-tool="${escapeHTML(tool.id)}" data-granted="${record.granted === true}">${record.granted ? 'Revoke' : 'Grant'}</button></td></tr>`;
                })).join('') || '<tr><td colspan="5" class="yd-empty">No eligible users or visible tools.</td></tr>'}
            </tbody></table></div>
        `;
    };

    const renderVisibility = () => {
        const toolList = getTools();
        const visibilityMap = getRoleEngine()?.getVisibility?.() || {};
        const rows = toolList.map((tool,index) => {
            const record = visibilityMap[tool.id] || { visibility: 'PRIVATE', allowedUsers: [] };
            const allowed = Array.isArray(record.allowedUsers) ? record.allowedUsers : [];
            const id = escapeHTML(tool.id);
            return '<tr><th>' + (index + 1) + '</th><td><span class="yd-id-badge">' + id + '</span></td><td><div class="yd-tool-name">' + escapeHTML(tool.name) + '</div></td><td><select class="yd-select" data-visibility="' + id + '"><option value="PRIVATE" ' + (record.visibility === 'PRIVATE' ? 'selected' : '') + '>PRIVATE</option><option value="PUBLIC" ' + (record.visibility === 'PUBLIC' ? 'selected' : '') + '>PUBLIC</option><option value="SELECTED_USERS" ' + (record.visibility === 'SELECTED_USERS' ? 'selected' : '') + '>SELECTED_USERS</option></select></td><td><input class="yd-input" data-allowed="' + id + '" value="' + escapeHTML(allowed.join(', ')) + '" placeholder="Q-001, Q-002"></td><td style="text-align:right"><button class="yd-primary" data-action="save-visibility" data-tool="' + id + '">Save</button></td></tr>';
        }).join('');
        return '<section class="yd-welcome"><div><h1>Visibility</h1><p>Set who can discover each tool.</p></div></section>' +
            '<div class="yd-table-card"><div class="yd-table-card-head"><div class="yd-table-card-title">◈ <span>Global Tool Visibility (' + toolList.length + ')</span></div><span class="yd-pill blue">SUPER ADMIN CONTROL</span></div>' +
            '<div class="yd-table-responsive"><table><thead><tr><th style="width:50px">#</th><th style="width:120px">Tool ID</th><th>Tool</th><th>Visibility</th><th>Allowed Users</th><th style="text-align:right">Action</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="yd-empty">No tools available.</td></tr>') + '</tbody></table></div></div>';
    };
    const renderTransactions = () => `
        <section class="yd-welcome"><div><h1>NETWORK Activity</h1><p>Centralized administrative request and transaction history.</p></div><button class="yd-secondary" data-action="refresh">Refresh History</button></section>
        ${renderTransactionsTable(getTransactions())}
    `;

    const renderAccount = () => {
        const user = context.user || {};
        const settings = context.settings?.getSettings?.() || { tools: {} };
        return '<section class="yd-welcome"><div><h1>Settings</h1><p>Personal dashboard preferences and workspace details.</p></div><button class="yd-primary" data-action="save-settings">☁ &nbsp; Save Settings</button></section>' +
            '<div class="yd-panel-grid"><div class="yd-card"><div class="yd-card-title">♙ <span>Personal Dashboard Preferences</span></div>' +
                '<div class="yd-field"><label for="yd-display-name">Display Name</label><input id="yd-display-name" class="yd-input" value="' + escapeHTML(settings.displayName || user.name || '') + '"></div>' +
                '<div class="yd-field" style="margin-top:12px"><label for="yd-start-page">Default Start Section</label><select id="yd-start-page" class="yd-select"><option value="overview" ' + (settings.startPage !== 'tools' ? 'selected' : '') + '>Overview</option><option value="tools" ' + (settings.startPage === 'tools' ? 'selected' : '') + '>Tools</option></select></div>' +
            '</div><div class="yd-card"><div class="yd-card-title">☁ <span>Repository & Account</span></div>' +
                '<div class="yd-info-row"><span>Full Name</span><strong>' + escapeHTML(user.name || '—') + '</strong></div>' +
                '<div class="yd-info-row"><span>User ID</span><strong>' + escapeHTML(user.id || user.userId || context.userId || '—') + '</strong></div>' +
                '<div class="yd-info-row"><span>Role</span><strong>' + escapeHTML(context.userRole) + '</strong></div>' +
                '<div class="yd-info-row"><span>Personal Repository</span><strong>' + escapeHTML(context.personalRepository || '—') + '</strong></div>' +
                '<div class="yd-info-row"><span>Dashboard Repository</span><strong>' + escapeHTML(context.dashboardRepository || '—') + '</strong></div>' +
                '<div class="yd-info-row"><span>Branch</span><strong>' + escapeHTML(context.branch || 'main') + '</strong></div>' +
            '</div></div>';
    };
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
                    ${context.userRole === 'SUPER_ADMIN' ? `<div class="yd-field"><label>Role</label><select name="role"><option value="USER" ${user?.role === 'USER' ? 'selected' : ''}>USER</option><option value="ADMIN" ${user?.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option><option value="SUPER_ADMIN" ${user?.role === 'SUPER_ADMIN' ? 'selected' : ''}>SUPER_ADMIN</option></select></div>` : ''}
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
            const payload = {
                name: form.get('name'),
                status: form.get('status'),
                ...(context.userRole === 'SUPER_ADMIN' ? { role: form.get('role') } : {})
            };
            const engine = getRoleEngine();

            try {
                setBusy(true);
                if (editing) await engine.editUser(user.id, payload);
                else await engine.addUser({ ...payload, id: form.get('id') });
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
            } else if (action === 'save-settings') {
                const updated = context.settings.getSettings();
                updated.displayName = document.getElementById(CONFIG.ID).querySelector('#yd-display-name')?.value.trim() || context.user?.name || '';
                updated.startPage = document.getElementById(CONFIG.ID).querySelector('#yd-start-page')?.value || 'overview';
                setBusy(true);
                await context.settings.save(updated);
                showNotice('Personal settings saved.');
                render();
            } else if (action === 'toggle-my-tool') {
                const toolId = button.dataset.tool;
                const nextEnabled = button.dataset.enabled !== 'true';
                setBusy(true);
                if (nextEnabled) await context.settings.enableTool(toolId);
                else await context.settings.disableTool(toolId);
                await context.tools.syncTool(toolId);
                showNotice('Tool setting saved.');
                render();
            } else if (action === 'add-user') {
                openUserModal();
            } else if (action === 'edit-user') {
                openUserModal(getUsers().find(user => user.id === button.dataset.id));
            } else if (action === 'delete-user') {
                if (!confirm('Delete this user? The request will be processed through NETWORK.')) return;
                setBusy(true);
                await getRoleEngine().deleteUser(button.dataset.id);
                showNotice('User deletion request submitted.');
            } else if (action === 'toggle-permission') {
                const granted = button.dataset.granted === 'true';
                setBusy(true);
                await getRoleEngine().setToolPermission(button.dataset.user, button.dataset.tool, { granted: !granted });
                showNotice('Permission update submitted through NETWORK.');
                await refresh();
            } else if (action === 'save-visibility') {
                const id = button.dataset.tool;
                const root = document.getElementById(CONFIG.ID);
                const visibility = root.querySelector('[data-visibility="' + id + '"]').value;
                const allowedUsers = root.querySelector('[data-allowed="' + id + '"]').value.split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
                setBusy(true);
                await context.superAdmin.setToolVisibility(id, { visibility, allowedUsers });
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
