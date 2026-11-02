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
    let busyMessage = 'Please wait while GitHub completes the operation.';
    const expandedUsers = new Set();
    const expandedTools = new Set();
    let openVisibilityToolId = null;
    let visibilityDraft = null;
    const optimisticVisibility = new Map();
    const backgroundTransactions = new Set();
    const localTransactions = new Map();
    const pendingLocalTools = new Map();
    const trackedTransactions = new Set();
    let networkPage = 1;
    const NETWORK_PAGE_SIZE = 10;

    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);

    const formatDate = value => {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
    };

    const initials = value => String(value || 'Y').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();

    const formatName = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase().replace(/(^|[\s'’-])\p{L}/gu, value => value.toLocaleUpperCase());

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

    const getPendingStorageKey = () => 'yd-dashboard-pending-v1:' + String(context?.userId || context?.user?.id || context?.user?.userId || 'UNKNOWN').trim().toUpperCase();

    const persistPendingTransactions = () => {
        try {
            localStorage.setItem(getPendingStorageKey(), JSON.stringify([...localTransactions.values()]));
        } catch {}
    };

    const restorePendingTransactions = () => {
        try {
            const records = JSON.parse(localStorage.getItem(getPendingStorageKey()) || '[]');
            localTransactions.clear();
            if (Array.isArray(records)) records.forEach(record => {
                if (record?.requestId && isPendingTransaction(record)) localTransactions.set(record.requestId, record);
            });
        } catch {
            localTransactions.clear();
        }
    };

    const isPendingTransaction = transaction => !['COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED'].includes(String(transaction?.status || '').toUpperCase());

    const getTransactions = () => {
        let records = [];
        try { records = getRoleEngine()?.getTransactionHistory?.() || []; }
        catch {}
        const merged = new Map(records.map(record => [record.requestId || record.transactionId, record]));
        for (const [id, record] of localTransactions) merged.set(id, { ...record, ...merged.get(id) });
        return [...merged.values()].filter(Boolean).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    };

    const getPendingTransactions = () => getTransactions().filter(isPendingTransaction);

    const getPendingPermission = (userId, toolId) => getPendingTransactions().find(item =>
        ['MODIFY_TOOL_PERMISSION', 'UPDATE_TOOL_PERMISSION', 'GRANT_TOOL_PERMISSION', 'REVOKE_TOOL_PERMISSION'].includes(String(item.action || '').toUpperCase()) &&
        String(item.targetId || item.targetUserId || '').trim().toUpperCase() === String(userId || '').trim().toUpperCase() &&
        (item.targetToolIds || [item.targetToolId]).map(value => String(value || '').trim()).includes(String(toolId || '').trim())
    ) || null;

    const getPendingVisibility = toolId => getPendingTransactions().find(item =>
        String(item.action || '').toUpperCase() === 'UPDATE_VISIBILITY' &&
        (item.targetToolIds || []).map(value => String(value || '').trim()).includes(String(toolId || '').trim())
    ) || null;

    const getPendingUser = user => {
        const id = String(user?.id || '').trim().toUpperCase();
        const name = String(user?.name || '').trim().toLocaleLowerCase();
        return getPendingTransactions().find(item => {
            const action = String(item.action || '').toUpperCase();
            if (!['ADD_USER', 'UPDATE_USER', 'EDIT_USER', 'DELETE_USER'].includes(action)) return false;
            if (id && String(item.targetId || '').trim().toUpperCase() === id) return true;
            return action === 'ADD_USER' && name && String(item.targetName || '').trim().toLocaleLowerCase() === name;
        }) || null;
    };

    const formatAction = value => ({
        UPDATE_VISIBILITY: 'UPDATE VISIBILITY',
        MODIFY_TOOL_PERMISSION: 'MODIFY TOOL PERMISSION',
        ADD_USER: 'ADD USER',
        UPDATE_USER: 'UPDATE USER',
        DELETE_USER: 'DELETE USER',
        SYNC_USERS: 'SYNC USERS',
        UPDATE_DASHBOARD_SETTINGS: 'UPDATE DASHBOARD SETTINGS'
    }[String(value || '').trim().toUpperCase()] || String(value || 'ACTIVITY').trim().replace(/_/g, ' ').toUpperCase());

    const getActorName = transaction => {
        const actorId = String(transaction?.actorId || '').trim().toUpperCase();
        const actor = getUsers().find(user => String(user?.id || '').trim().toUpperCase() === actorId);
        return transaction?.actorName || transaction?.actor?.name || actor?.name || actorId || 'Unknown';
    };

    const renderPendingBadge = (label = 'Pending') => '<span class="yd-pending-badge"><i class="fa-solid fa-spinner fa-spin"></i><span>' + escapeHTML(label) + '</span></span>';

    const renderDropdown = (name, value, options, attributes = {}, disabled = false) => {
        const selected = options.find(option => String(option.value) === String(value)) || options[0] || { value: '', label: '' };
        const attrs = Object.entries(attributes).map(([key, item]) => ' ' + key + '="' + escapeHTML(item) + '"').join('');
        const nameAttr = name ? ' name="' + escapeHTML(name) + '"' : '';
        const idAttr = attributes.id ? '' : '';
        return '<div class="yd-dropdown yd-select-dropdown' + (disabled ? ' disabled' : '') + '" data-dropdown' + attrs + '>' +
            '<input type="hidden"' + nameAttr + (attributes.id ? ' id="' + escapeHTML(attributes.id) + '"' : '') + ' value="' + escapeHTML(selected.value) + '">' +
            '<button type="button" class="yd-dropdown-trigger" data-action="toggle-dropdown" aria-haspopup="menu" aria-expanded="false"' + (disabled ? ' disabled' : '') + '><span class="yd-dropdown-value">' + escapeHTML(selected.label) + '</span><i class="fa-solid fa-chevron-down"></i></button>' +
            '<div class="yd-dropdown-menu" role="menu" hidden>' + options.map(option => '<button type="button" class="yd-dropdown-item' + (String(option.value) === String(selected.value) ? ' selected' : '') + '" role="menuitem" data-action="select-dropdown" data-value="' + escapeHTML(option.value) + '">' + escapeHTML(option.label) + (String(option.value) === String(selected.value) ? '<i class="fa-solid fa-check"></i>' : '') + '</button>').join('') + '</div></div>';
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

    const trackBackground = task => {
        backgroundTransactions.add(task);
        task.finally(() => backgroundTransactions.delete(task)).catch(() => {});
        return task;
    };

    const ensureExternalStylesheet = (id, href) => {
        if (document.getElementById(id)) return;
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    };

    const injectStyles = () => {
        ensureExternalStylesheet('yd-fontawesome-css', 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css');
        ensureExternalStylesheet('yd-cairo-font', 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap');
        if (document.getElementById(CONFIG.STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = CONFIG.STYLE_ID;
        style.textContent = "\n#yd-dashboard-root{--brand:#875a7b;--brand-dark:#68465f;--brand-soft:#f4edf3;--ink:#29242e;--text:#514a56;--muted:#77717d;--subtle:#9b949f;--border:#e9e4eb;--border-soft:#f1edf2;--canvas:#f7f6f8;--success:#247a53;--success-bg:#eef8f2;--success-border:#d7eadf;--info:#35678f;--info-bg:#edf4fa;--info-border:#d9e7f2;--warning:#926b22;--warning-bg:#fbf6e9;--warning-border:#efe2bd;--danger:#b94b55;--danger-bg:#fcf0f0;--danger-border:#f0d7d9;color:var(--ink);font:13px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",sans-serif;font-synthesis:none;text-rendering:optimizeLegibility}\n#yd-dashboard-root *{box-sizing:border-box}\n#yd-dashboard-root button,#yd-dashboard-root input,#yd-dashboard-root select{font:inherit}\n#yd-dashboard-root #yd-launcher{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:inline-flex;align-items:center;gap:10px;min-height:46px;padding:0 18px;border:1px solid var(--brand);border-radius:999px;background:var(--brand);color:#fff;font-size:12px;font-weight:750;letter-spacing:.02em;cursor:pointer;box-shadow:0 8px 24px #39223924;transition:all .16s}\n#yd-dashboard-root #yd-launcher:hover{background:var(--brand-dark);border-color:var(--brand-dark);box-shadow:0 10px 26px #39223930;transform:translateY(-1px)}\n#yd-dashboard-root #yd-overlay{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;padding:24px;background:#17131c85;backdrop-filter:blur(4px)}\n#yd-dashboard-root #yd-overlay.open{display:flex}\n#yd-dashboard-root #yd-modal{position:relative;display:flex;flex-direction:column;width:min(1360px,100%);height:min(860px,calc(100vh - 48px));max-height:calc(100vh - 48px);overflow:hidden;border:1px solid #e5dfe8;border-radius:18px;background:var(--canvas);color:var(--ink);box-shadow:0 28px 80px #17131c40}\n#yd-dashboard-root #yd-header{display:flex;align-items:center;justify-content:space-between;gap:18px;flex:0 0 68px;min-height:68px;padding:0 24px;background:#fff;border-bottom:1px solid var(--border)}\n#yd-dashboard-root .yd-brand{display:flex;align-items:center;gap:12px;min-width:0}\n#yd-dashboard-root .yd-brand-logo{display:flex;align-items:center;justify-content:center;width:36px;height:36px;flex:0 0 36px;border-radius:10px;background:var(--brand);color:#fff;font-size:17px;font-weight:850}\n#yd-dashboard-root .yd-brand-title{overflow:hidden;color:var(--ink);font-size:14px;font-weight:800;letter-spacing:.035em;text-overflow:ellipsis;white-space:nowrap}\n#yd-dashboard-root .yd-header-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px}\n#yd-dashboard-root .yd-header-status{display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;border:1px solid var(--success-border);border-radius:999px;background:var(--success-bg);color:var(--success);font-size:11px;font-weight:700;white-space:nowrap}\n#yd-dashboard-root .yd-header-dot{width:7px;height:7px;border-radius:50%;background:#2e9464;box-shadow:0 0 0 3px #2e94641a}\n#yd-dashboard-root .yd-profile-wrap{position:relative;display:inline-flex;align-items:center}\n#yd-dashboard-root .yd-gb-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;padding:2px;border:0;border-radius:50%;background:conic-gradient(var(--brand),var(--brand-dark),#b48aa8,var(--brand));cursor:pointer}\n#yd-dashboard-root .yd-gb-avatar{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:2px solid #fff;border-radius:50%;background:var(--brand);color:#fff;font-size:12px;font-weight:800}\n#yd-dashboard-root .yd-gb-badge{position:absolute;right:-2px;bottom:-2px;display:grid;place-items:center;width:14px;height:14px;border:2px solid #fff;border-radius:50%;background:var(--success);color:#fff;font-size:8px}\n#yd-dashboard-root .yd-profile-menu{position:absolute;top:calc(100% + 12px);right:0;z-index:2147483005;width:304px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--canvas);box-shadow:0 16px 42px #24152e20}\n#yd-dashboard-root .yd-profile-menu[hidden]{display:none!important}\n#yd-dashboard-root .yd-gb-card{display:flex;flex-direction:column;align-items:center;margin-bottom:10px;padding:18px 14px;border:1px solid var(--border);border-radius:12px;background:#fff;text-align:center}\n#yd-dashboard-root .yd-gb-ring-lg{display:flex;align-items:center;justify-content:center;width:54px;height:54px;margin-bottom:10px;padding:2px;border-radius:50%;background:conic-gradient(var(--brand),var(--brand-dark),#b48aa8,var(--brand))}\n#yd-dashboard-root .yd-gb-avatar-lg{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:2px solid #fff;border-radius:50%;background:var(--brand);color:#fff;font-size:18px;font-weight:800}\n#yd-dashboard-root .yd-gb-name{color:var(--ink);font-size:14px;font-weight:800}\n#yd-dashboard-root .yd-gb-meta{margin-top:3px;color:var(--muted);font-size:11px}\n#yd-dashboard-root .yd-gb-pills{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:10px;flex-wrap:wrap}\n#yd-dashboard-root .yd-dropdown-action{display:flex;align-items:center;gap:11px;width:100%;min-height:46px;margin-top:7px;padding:7px 10px;border:1px solid var(--border);border-radius:10px;background:#fff;color:var(--text);cursor:pointer;text-align:left}\n#yd-dashboard-root .yd-dropdown-action:hover{border-color:#e1d4e0;background:var(--brand-soft);color:var(--brand-dark)}\n#yd-dashboard-root .yd-action-icon{display:flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 30px;border-radius:8px;background:var(--brand-soft);color:var(--brand);font-size:14px}\n#yd-dashboard-root .yd-dropdown-action b{display:block;font-size:12px;font-weight:700}\n#yd-dashboard-root .yd-close-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:1px solid var(--border);border-radius:9px;background:#fff;color:var(--muted);cursor:pointer;font-size:21px;line-height:1;transition:all .15s}\n#yd-dashboard-root .yd-close-btn:hover{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}\n#yd-dashboard-root #yd-body{display:flex;flex:1;min-height:0}\n#yd-dashboard-root #yd-sidebar{display:flex;flex:0 0 224px;flex-direction:column;gap:5px;width:224px;overflow:auto;padding:20px 14px;border-right:1px solid var(--border);background:#fff}\n#yd-dashboard-root .yd-nav-label{padding:6px 12px 10px;color:var(--subtle);font-size:10px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}\n#yd-dashboard-root .yd-nav{display:flex;align-items:center;gap:11px;width:100%;min-height:42px;padding:0 12px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--text);cursor:pointer;text-align:left;font-size:12.5px;font-weight:650;transition:all .14s}\n#yd-dashboard-root .yd-nav:hover{background:#f8f5f8;color:var(--brand-dark)}\n#yd-dashboard-root .yd-nav.active{border-color:#eadfe8;background:var(--brand-soft);color:var(--brand-dark);font-weight:750}\n#yd-dashboard-root .yd-nav-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 20px;color:var(--brand);font-size:15px}\n#yd-dashboard-root .yd-sidebar-bottom{margin-top:auto;padding:16px 12px 4px;border-top:1px solid var(--border-soft);color:var(--subtle);font-size:10px;line-height:1.75}\n#yd-dashboard-root #yd-main{flex:1;min-width:0;overflow:auto;padding:28px 30px;background:var(--canvas);scrollbar-color:#d7cfd9 transparent;scrollbar-width:thin}\n#yd-dashboard-root .yd-welcome{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 22px}\n#yd-dashboard-root .yd-welcome h1{margin:0;color:var(--ink);font-size:21px;font-weight:800;letter-spacing:-.035em;line-height:1.25}\n#yd-dashboard-root .yd-welcome p{margin:6px 0 0;color:var(--muted);font-size:12.5px;line-height:1.5}\n#yd-dashboard-root .yd-primary,#yd-dashboard-root .yd-secondary,#yd-dashboard-root .yd-danger{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:0 14px;border-radius:9px;cursor:pointer;font-size:12px;font-weight:750;white-space:nowrap;transition:all .15s}\n#yd-dashboard-root .yd-primary{border:1px solid var(--brand);background:var(--brand);color:#fff;box-shadow:0 2px 5px #875a7b1a}\n#yd-dashboard-root .yd-primary:hover{border-color:var(--brand-dark);background:var(--brand-dark);box-shadow:0 3px 8px #68465f24}\n#yd-dashboard-root .yd-secondary{border:1px solid #e2dbe5;background:#fff;color:var(--brand-dark)}\n#yd-dashboard-root .yd-secondary:hover{border-color:#d8c7d7;background:var(--brand-soft)}\n#yd-dashboard-root .yd-danger{border:1px solid var(--danger-border);background:var(--danger-bg);color:var(--danger)}\n#yd-dashboard-root .yd-danger:hover{border-color:#e7bec2;background:#f9e7e8}\n#yd-dashboard-root button:disabled{opacity:.48;cursor:not-allowed;box-shadow:none}\n#yd-dashboard-root .yd-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}\n#yd-dashboard-root .yd-card{min-width:0;margin-bottom:16px;padding:18px;border:1px solid var(--border);border-radius:13px;background:#fff;box-shadow:0 2px 8px #29242e07}\n#yd-dashboard-root .yd-stat{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}\n#yd-dashboard-root .yd-stat-label{color:var(--muted);font-size:11.5px;font-weight:650}\n#yd-dashboard-root .yd-stat-value{margin-top:4px;color:var(--ink);font-size:20px;font-weight:800;letter-spacing:-.025em}\n#yd-dashboard-root .yd-stat-icon{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:var(--brand-soft);color:var(--brand);font-size:17px}\n#yd-dashboard-root .yd-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0 12px}\n#yd-dashboard-root .yd-section-head h2{margin:0;color:var(--ink);font-size:14px;font-weight:800}\n#yd-dashboard-root .yd-section-head span{color:var(--muted);font-size:11px}\n#yd-dashboard-root .yd-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}\n#yd-dashboard-root .yd-tool-card{display:flex;flex-direction:column;min-height:156px;margin:0;padding:16px}\n#yd-dashboard-root .yd-tool-head{display:flex;align-items:center;gap:12px;min-width:0}\n#yd-dashboard-root .yd-tool-icon{display:grid;place-items:center;width:40px;height:40px;flex:0 0 40px;border-radius:10px;background:var(--brand-soft);color:var(--brand);font-size:16px}\n#yd-dashboard-root .yd-tool-name{color:var(--ink);font-size:12.5px;font-weight:750;line-height:1.4}\n#yd-dashboard-root .yd-tool-meta{margin-top:4px;color:var(--muted);font-size:10.5px}\n#yd-dashboard-root .yd-tool-description{min-height:38px;margin:14px 0;color:var(--muted);font-size:11.5px;line-height:1.55}\n#yd-dashboard-root .yd-tool-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:11px;border-top:1px solid var(--border-soft)}\n#yd-dashboard-root .yd-status{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:10px;font-weight:750;text-transform:uppercase}\n#yd-dashboard-root .yd-dot{width:7px;height:7px;border-radius:50%;background:#b8b1bb}\n#yd-dashboard-root .yd-status.on{color:var(--success)}\n#yd-dashboard-root .yd-status.on .yd-dot{background:#2e9464;box-shadow:0 0 0 3px #2e94641a}\n#yd-dashboard-root .yd-table-wrap{overflow:auto;margin-bottom:16px;border:1px solid var(--border);border-radius:13px;background:#fff;box-shadow:0 2px 8px #29242e06}\n#yd-dashboard-root table{width:100%;border-collapse:separate;border-spacing:0;text-align:left;font-size:12px}\n#yd-dashboard-root thead th{height:44px;padding:0 15px;border-bottom:1px solid var(--border);background:#faf9fb;color:#716a76;font-size:10.5px;font-weight:800;letter-spacing:.025em;text-align:left;white-space:nowrap}\n#yd-dashboard-root tbody td,#yd-dashboard-root tbody th{height:49px;padding:8px 15px;border-top:1px solid var(--border-soft);background:#fff;color:var(--text);font-size:12px;font-weight:500;vertical-align:middle;white-space:nowrap}\n#yd-dashboard-root tbody tr:first-child td,#yd-dashboard-root tbody tr:first-child th{border-top:0}\n#yd-dashboard-root tbody tr:hover td,#yd-dashboard-root tbody tr:hover th{background:#fbf9fc}\n#yd-dashboard-root td strong{color:var(--ink);font-weight:750}\n#yd-dashboard-root .yd-pill{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:2px 9px;border:1px solid #e6dce6;border-radius:999px;background:var(--brand-soft);color:var(--brand-dark);font-size:10.5px;font-weight:750;line-height:1.2;white-space:nowrap}\n#yd-dashboard-root .yd-pill.green{border-color:var(--success-border);background:var(--success-bg);color:var(--success)}\n#yd-dashboard-root .yd-pill.red{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}\n#yd-dashboard-root .yd-pill.blue{border-color:var(--info-border);background:var(--info-bg);color:var(--info)}\n#yd-dashboard-root .yd-pill.yellow{border-color:var(--warning-border);background:var(--warning-bg);color:var(--warning)}\n#yd-dashboard-root .yd-id-badge{display:inline-flex;align-items:center;justify-content:center;min-height:24px;padding:2px 9px;border:1px solid #e8dfe8;border-radius:7px;background:#f7f2f6;color:var(--brand-dark);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;font-weight:750}\n#yd-dashboard-root .yd-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px}\n#yd-dashboard-root .yd-search,#yd-dashboard-root .yd-field input,#yd-dashboard-root .yd-field select,#yd-dashboard-root .yd-input,#yd-dashboard-root .yd-select{width:auto;min-width:0;height:38px;padding:0 11px;border:1px solid #ded8e1;border-radius:9px;outline:none;background:#fff;color:var(--ink);font-size:12px;font-weight:550;transition:border-color .15s,box-shadow .15s}\n#yd-dashboard-root .yd-search{width:min(360px,100%)}\n#yd-dashboard-root .yd-search::placeholder,#yd-dashboard-root input::placeholder{color:#aaa3ad;font-weight:450}\n#yd-dashboard-root .yd-search:focus,#yd-dashboard-root input:focus,#yd-dashboard-root select:focus{border-color:#b28aa8;box-shadow:0 0 0 3px #875a7b15}\n#yd-dashboard-root .yd-empty{padding:30px 18px!important;color:var(--muted)!important;font-size:12px!important;text-align:center}\n#yd-dashboard-root .yd-panel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}\n#yd-dashboard-root .yd-info-row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--border-soft);font-size:12px}\n#yd-dashboard-root .yd-info-row:last-child{border:0}\n#yd-dashboard-root .yd-info-row span{color:var(--muted)}\n#yd-dashboard-root .yd-info-row strong{max-width:65%;overflow-wrap:anywhere;color:var(--ink);font-weight:700;text-align:right}\n#yd-dashboard-root .yd-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:12px}\n#yd-dashboard-root .yd-field{display:flex;flex-direction:column;gap:7px;min-width:0}\n#yd-dashboard-root .yd-field label{color:var(--text);font-size:11.5px;font-weight:750}\n#yd-dashboard-root .yd-field input,#yd-dashboard-root .yd-field select{width:100%}\n#yd-dashboard-root .yd-modal-backdrop{position:fixed;inset:0;z-index:2147483005;display:grid;place-items:center;padding:22px;background:#17131c88;backdrop-filter:blur(3px)}\n#yd-dashboard-root .yd-modal{width:min(560px,100%);padding:26px;border:1px solid var(--border);border-radius:15px;background:#fff;box-shadow:0 24px 70px #17131c38}\n#yd-dashboard-root .yd-modal h3{margin:0 0 18px;color:var(--ink);font-size:18px;font-weight:800;letter-spacing:-.025em}\n#yd-dashboard-root .yd-modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:24px;padding-top:16px;border-top:1px solid var(--border-soft)}\n#yd-dashboard-root .yd-toast{position:fixed;right:26px;bottom:26px;z-index:2147483006;max-width:min(440px,calc(100vw - 32px));padding:12px 16px;border:1px solid #3b3442;border-radius:10px;background:#302a35;color:#fff;box-shadow:0 12px 32px #17131c24;font-size:12px;font-weight:650}\n#yd-dashboard-root .yd-toast.error{border-color:#a8414a;background:#a8414a}\n#yd-dashboard-root .yd-switch{position:relative;display:inline-flex;align-items:center;width:42px;height:24px;padding:3px;border:0;border-radius:999px;background:#d8d2da;cursor:pointer;vertical-align:middle;transition:background .16s}\n#yd-dashboard-root .yd-switch.on{background:#2b865c}\n#yd-dashboard-root .yd-switch-knob{display:block;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transition:transform .16s}\n#yd-dashboard-root .yd-switch.on .yd-switch-knob{transform:translateX(18px)}\n#yd-dashboard-root .yd-kpi-card{display:flex;align-items:center;gap:13px;min-width:0;min-height:86px;padding:15px 16px;border:1px solid var(--border);border-radius:13px;background:#fff;box-shadow:0 2px 8px #29242e07}\n#yd-dashboard-root .yd-kpi-icon{display:flex;align-items:center;justify-content:center;width:42px;height:42px;flex:0 0 42px;border-radius:11px;background:var(--brand-soft);color:var(--brand);font-size:16px;font-weight:800}\n#yd-dashboard-root .yd-kpi-icon.blue{background:var(--info-bg);color:var(--info)}\n#yd-dashboard-root .yd-kpi-icon.green{background:var(--success-bg);color:var(--success)}\n#yd-dashboard-root .yd-kpi-icon.purple{background:var(--brand-soft);color:var(--brand)}\n#yd-dashboard-root .yd-kpi-icon.amber{background:var(--warning-bg);color:var(--warning)}\n#yd-dashboard-root .yd-kpi-info{display:flex;flex-direction:column;justify-content:center;min-width:0}\n#yd-dashboard-root .yd-kpi-label{overflow:hidden;color:var(--muted);font-size:11px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}\n#yd-dashboard-root .yd-kpi-value{margin-top:3px;color:var(--ink);font-size:20px;font-weight:800;letter-spacing:-.025em;line-height:1.25}\n#yd-dashboard-root .yd-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}\n#yd-dashboard-root .yd-card-title{display:flex;align-items:center;gap:9px;margin:0 0 8px;padding-bottom:12px;border-bottom:1px solid var(--border-soft);color:var(--ink);font-size:13px;font-weight:800}\n#yd-dashboard-root .yd-clean-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:42px;border-bottom:1px solid #f4f0f5;font-size:12px}\n#yd-dashboard-root .yd-clean-row:last-child{border-bottom:0}\n#yd-dashboard-root .yd-clean-label{color:var(--muted);font-weight:600}\n#yd-dashboard-root .yd-clean-val{color:var(--ink);font-weight:750;text-align:right}\n#yd-dashboard-root .yd-table-card{overflow:hidden;margin-bottom:16px;border:1px solid var(--border);border-radius:13px;background:#fff;box-shadow:0 2px 8px #29242e07}\n#yd-dashboard-root .yd-table-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:54px;padding:10px 16px;border-bottom:1px solid var(--border);background:#fff;flex-wrap:wrap}\n#yd-dashboard-root .yd-table-card-title{display:flex;align-items:center;gap:9px;color:var(--ink);font-size:13px;font-weight:800}\n#yd-dashboard-root .yd-table-pills{display:flex;align-items:center;gap:7px;flex-wrap:wrap}\n#yd-dashboard-root .yd-table-responsive{width:100%;overflow-x:auto}\n#yd-dashboard-root .yd-switch-state{display:inline-block;min-width:28px;margin-left:7px;color:var(--muted);font-size:10.5px;font-weight:750}\n#yd-dashboard-root .yd-access-badge{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1px solid transparent;border-radius:8px;font-size:14px;font-weight:850}\n#yd-dashboard-root .yd-access-badge.unlocked{border-color:var(--success-border);background:var(--success-bg);color:var(--success)}\n#yd-dashboard-root .yd-access-badge.locked{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}\n@media(max-width:1120px){#yd-dashboard-root .yd-stats,#yd-dashboard-root .yd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#yd-dashboard-root #yd-main{padding:24px}}\n@media(max-width:850px){#yd-dashboard-root .yd-panel-grid,#yd-dashboard-root .yd-info-grid{grid-template-columns:1fr}#yd-dashboard-root #yd-sidebar{width:190px;flex-basis:190px}#yd-dashboard-root #yd-main{padding:20px}}\n@media(max-width:620px){#yd-dashboard-root #yd-overlay{padding:0}#yd-dashboard-root #yd-modal{width:100%;height:100%;max-height:none;border:0;border-radius:0}#yd-dashboard-root #yd-header{flex-basis:60px;min-height:60px;padding:0 13px;gap:8px}#yd-dashboard-root .yd-brand{gap:8px}#yd-dashboard-root .yd-brand-logo{width:32px;height:32px;flex-basis:32px}#yd-dashboard-root .yd-brand-title{max-width:180px;font-size:11px}#yd-dashboard-root .yd-header-actions{gap:7px}#yd-dashboard-root .yd-header-status{min-height:30px;padding:0 8px;font-size:10px}#yd-dashboard-root .yd-gb-btn{width:34px;height:34px}#yd-dashboard-root .yd-close-btn{width:32px;height:32px}#yd-dashboard-root #yd-sidebar{width:60px;flex-basis:60px;padding:12px 6px}#yd-dashboard-root .yd-nav{justify-content:center;min-height:42px;padding:0 6px;font-size:0}#yd-dashboard-root .yd-nav span:not(.yd-nav-icon),#yd-dashboard-root .yd-nav-label,#yd-dashboard-root .yd-sidebar-bottom{display:none}#yd-dashboard-root .yd-nav-icon{font-size:16px}#yd-dashboard-root #yd-main{padding:18px 14px}#yd-dashboard-root .yd-welcome{margin-bottom:18px}#yd-dashboard-root .yd-welcome h1{font-size:19px}#yd-dashboard-root .yd-stats,#yd-dashboard-root .yd-grid{grid-template-columns:1fr 1fr;gap:10px}#yd-dashboard-root .yd-kpi-card{min-height:76px;padding:11px}#yd-dashboard-root .yd-kpi-icon{width:36px;height:36px;flex-basis:36px}#yd-dashboard-root .yd-kpi-value{font-size:17px}#yd-dashboard-root .yd-form-grid{grid-template-columns:1fr}#yd-dashboard-root .yd-profile-menu{right:-44px;width:min(304px,calc(100vw - 82px))}#yd-dashboard-root .yd-modal-backdrop{padding:12px}#yd-dashboard-root .yd-modal{padding:20px}}\n@media(max-width:380px){#yd-dashboard-root .yd-header-status{display:none}#yd-dashboard-root .yd-stats,#yd-dashboard-root .yd-grid{grid-template-columns:1fr}#yd-dashboard-root .yd-table-card-head{align-items:flex-start}}\n@media(prefers-reduced-motion:reduce){#yd-dashboard-root *,#yd-dashboard-root *::before,#yd-dashboard-root *::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}\n#yd-dashboard-root .yd-icon-btn{display:inline-grid;place-items:center;width:34px;height:34px;padding:0;border:1px solid var(--border);border-radius:9px;background:#fff;color:var(--brand);cursor:pointer;transition:all .15s}\n#yd-dashboard-root .yd-icon-btn:hover{border-color:#d8c7d7;background:var(--brand-soft);color:var(--brand-dark)}\n#yd-dashboard-root .yd-icon-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}\n#yd-dashboard-root .yd-icon-btn.danger{border-color:var(--danger-border);background:#fff;color:var(--danger)}\n#yd-dashboard-root .yd-icon-btn.danger:hover{border-color:#e7bec2;background:var(--danger-bg);color:#a83742}\n#yd-dashboard-root .yd-user-actions{display:flex;align-items:center;justify-content:flex-start;gap:7px}\n#yd-dashboard-root .yd-repository-name{display:inline-block;max-width:260px;overflow:hidden;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;font-weight:650;text-overflow:ellipsis;vertical-align:middle}\n#yd-dashboard-root .yd-accordion-list{overflow:hidden;border:1px solid var(--border);border-radius:13px;background:#fff;box-shadow:0 2px 8px #29242e06}\n#yd-dashboard-root .yd-accordion-item{border-bottom:1px solid var(--border-soft)}\n#yd-dashboard-root .yd-accordion-item:last-child{border-bottom:0}\n#yd-dashboard-root .yd-accordion-item>summary{position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:68px;padding:13px 42px 13px 18px;background:#fff;color:var(--ink);cursor:pointer;list-style:none;transition:background .15s}\n#yd-dashboard-root .yd-accordion-item>summary::-webkit-details-marker{display:none}\n#yd-dashboard-root .yd-accordion-item>summary::marker{display:none;content:''}\n#yd-dashboard-root .yd-accordion-item>summary:hover{background:#fbf8fb}\n#yd-dashboard-root .yd-accordion-item[open]>summary{background:var(--brand-soft)}\n#yd-dashboard-root .yd-accordion-user{display:flex;flex-direction:column;gap:6px;min-width:0}\n#yd-dashboard-root .yd-accordion-user>strong{color:var(--ink);font-size:13px;font-weight:800}\n#yd-dashboard-root .yd-accordion-user>small{display:flex;align-items:center;gap:7px}\n#yd-dashboard-root .yd-accordion-summary-meta{display:flex;align-items:center;gap:7px}\n#yd-dashboard-root .yd-accordion-item>summary::after{position:absolute;right:20px;width:8px;height:8px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);content:'';transform:rotate(45deg);transition:transform .15s}\n#yd-dashboard-root .yd-accordion-item[open]>summary::after{transform:rotate(225deg)}\n#yd-dashboard-root .yd-accordion-body{padding:4px 18px 12px;background:#fff}\n#yd-dashboard-root .yd-permission-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(330px,1.2fr);align-items:center;gap:20px;padding:13px 0;border-bottom:1px solid var(--border-soft)}\n#yd-dashboard-root .yd-permission-row:last-child{border-bottom:0}\n#yd-dashboard-root .yd-permission-tool{display:flex;flex-direction:column;gap:4px;min-width:0}\n#yd-dashboard-root .yd-permission-tool strong{color:var(--ink);font-size:12px;font-weight:750}\n#yd-dashboard-root .yd-permission-tool>span{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px}\n#yd-dashboard-root .yd-permission-controls{display:flex;align-items:center;justify-content:flex-end;gap:28px;flex-wrap:wrap}\n#yd-dashboard-root .yd-permission-control{display:flex;align-items:center;gap:9px;min-width:145px}\n#yd-dashboard-root .yd-permission-label{min-width:82px;color:var(--muted);font-size:11px;font-weight:700}\n#yd-dashboard-root .yd-switch.yd-switch-forced.on{background:#bd8a35}\n#yd-dashboard-root .yd-switch:focus-visible,#yd-dashboard-root .yd-icon-btn:focus-visible{outline:3px solid #875a7b35;outline-offset:2px}\n#yd-dashboard-root .yd-select,#yd-dashboard-root .yd-field select{appearance:none;-webkit-appearance:none;min-height:38px;padding-right:36px;border:1px solid #ded8e1;border-radius:11px;background-color:#fff;background-image:url(data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23875a7b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E);background-position:right 12px center;background-repeat:no-repeat;background-size:13px 13px;cursor:pointer}\n#yd-dashboard-root .yd-select:focus,#yd-dashboard-root .yd-field select:focus{border-color:#b28aa8;box-shadow:0 0 0 3px #875a7b15}\n#yd-dashboard-root .yd-field input,#yd-dashboard-root .yd-input{border-radius:11px}\n#yd-dashboard-root .yd-loading-overlay{position:fixed;inset:0;z-index:2147483010;display:grid;place-items:center;padding:20px;background:#17131c68;backdrop-filter:blur(3px)}\n#yd-dashboard-root .yd-loading-overlay[hidden]{display:none!important}\n#yd-dashboard-root .yd-loading-card{display:flex;align-items:center;gap:16px;width:min(430px,100%);padding:20px 22px;border:1px solid var(--border);border-radius:16px;background:#fff;box-shadow:0 20px 60px #17131c35}\n#yd-dashboard-root .yd-spinner{width:34px;height:34px;flex:0 0 34px;border:3px solid #eadfe8;border-top-color:var(--brand);border-radius:50%;animation:yd-spinner-rotate .8s linear infinite}\n#yd-dashboard-root .yd-loading-card>div{display:flex;flex-direction:column;gap:5px;min-width:0}\n#yd-dashboard-root .yd-loading-card strong{color:var(--brand-dark);font-size:11px;font-weight:850;letter-spacing:.06em}\n#yd-dashboard-root .yd-loading-message{color:var(--muted);font-size:12px;line-height:1.5}\n@keyframes yd-spinner-rotate{to{transform:rotate(360deg)}}\n@media(max-width:760px){#yd-dashboard-root .yd-permission-row{grid-template-columns:1fr;gap:10px}#yd-dashboard-root .yd-permission-controls{justify-content:flex-start;gap:16px}#yd-dashboard-root .yd-accordion-summary-meta{display:none}}#yd-dashboard-root{--border:#dcd5e1;--border-soft:#eae4ec;font-family:\"Cairo\",Tahoma,Arial,sans-serif;font-size:12px;line-height:1.5}\n#yd-dashboard-root button,#yd-dashboard-root input,#yd-dashboard-root select{font-family:inherit}\n#yd-dashboard-root #yd-header{flex-basis:60px;min-height:60px;padding:0 20px;border-bottom-color:#d9d2df}\n#yd-dashboard-root .yd-brand-title{font-size:13px}\n#yd-dashboard-root .yd-header-actions{gap:9px}\n#yd-dashboard-root .yd-header-status{min-height:30px;padding:0 10px}\n#yd-dashboard-root .yd-brand-logo{width:32px;height:32px;flex-basis:32px;border-radius:9px;font-size:15px}\n#yd-dashboard-root #yd-sidebar{gap:4px;padding:15px 12px}\n#yd-dashboard-root .yd-nav{min-height:36px;padding:0 10px;border-radius:9px;gap:10px;font-size:12px}\n#yd-dashboard-root .yd-nav-icon{width:25px;height:25px;flex-basis:25px;border:1px solid #e5dce7;border-radius:8px;background:#f7f2f7;color:var(--brand);font-size:12px}\n#yd-dashboard-root .yd-nav.active .yd-nav-icon{border-color:#d9c6d8;background:#fff}\n#yd-dashboard-root #yd-main{padding:22px 26px}\n#yd-dashboard-root .yd-welcome{margin-bottom:17px;gap:12px}\n#yd-dashboard-root .yd-welcome h1{font-size:19px;letter-spacing:-.02em}\n#yd-dashboard-root .yd-welcome p{margin-top:4px;font-size:11.5px}\n#yd-dashboard-root .yd-primary,#yd-dashboard-root .yd-secondary,#yd-dashboard-root .yd-danger{min-height:32px;padding:0 12px;border-radius:8px;font-size:11.5px}\n#yd-dashboard-root .yd-primary,#yd-dashboard-root .yd-secondary{gap:7px}\n#yd-dashboard-root .yd-stats{gap:11px;margin-bottom:14px}\n#yd-dashboard-root .yd-card{margin-bottom:12px;padding:14px;border-color:#ded7e3;border-radius:11px;box-shadow:0 2px 5px #29242e08}\n#yd-dashboard-root .yd-kpi-card{min-height:72px;padding:11px 13px;gap:10px;border-color:#ded7e3;border-radius:11px}\n#yd-dashboard-root .yd-kpi-icon{width:36px;height:36px;flex-basis:36px;border:1px solid #e1d8e5;border-radius:9px;font-size:14px}\n#yd-dashboard-root .yd-kpi-value{font-size:18px}\n#yd-dashboard-root .yd-kpi-label{font-size:10.5px}\n#yd-dashboard-root .yd-section-head{margin:15px 0 9px}\n#yd-dashboard-root .yd-grid{gap:11px;margin-bottom:14px}\n#yd-dashboard-root .yd-tool-card{min-height:138px;padding:13px}\n#yd-dashboard-root .yd-tool-icon{width:34px;height:34px;flex-basis:34px;border:1px solid #e2d9e6;border-radius:9px;background:#f6f0f6;font-size:14px}\n#yd-dashboard-root .yd-tool-description{min-height:32px;margin:10px 0;font-size:11px}\n#yd-dashboard-root .yd-tool-foot{padding-top:8px}\n#yd-dashboard-root .yd-table-wrap,#yd-dashboard-root .yd-table-card{margin-bottom:12px;border-color:#dcd5e1;border-radius:11px;box-shadow:0 2px 5px #29242e08}\n#yd-dashboard-root thead th{height:38px;padding:0 12px;border-bottom-color:#d9d2df;font-size:10px}\n#yd-dashboard-root tbody td,#yd-dashboard-root tbody th{height:41px;padding:6px 12px;border-top-color:#e9e3eb;font-size:11.5px}\n#yd-dashboard-root tbody tr:nth-child(even) td,#yd-dashboard-root tbody tr:nth-child(even) th{background:#fcfbfd}\n#yd-dashboard-root tbody tr:hover td,#yd-dashboard-root tbody tr:hover th{background:#f7f2f8}\n#yd-dashboard-root .yd-pill{min-height:21px;padding:2px 8px;border-radius:999px;font-size:10px}\n#yd-dashboard-root .yd-id-badge{min-height:21px;padding:2px 8px;border-radius:7px;font-size:10px}\n#yd-dashboard-root .yd-toolbar{gap:9px;margin-bottom:11px}\n#yd-dashboard-root .yd-search,#yd-dashboard-root .yd-field input,#yd-dashboard-root .yd-field select,#yd-dashboard-root .yd-input,#yd-dashboard-root .yd-select{height:34px;min-height:34px;padding:0 10px;border:1px solid #d8d0dc;border-radius:9px;font-size:11.5px}\n#yd-dashboard-root .yd-search{width:min(340px,100%)}\n#yd-dashboard-root .yd-select,#yd-dashboard-root .yd-field select{appearance:none;-webkit-appearance:none;padding-right:32px;background-color:#fff;background-image:url(data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23875a7b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E);background-position:right 10px center;background-repeat:no-repeat;background-size:12px 12px}\n#yd-dashboard-root .yd-select:focus,#yd-dashboard-root .yd-field select:focus,#yd-dashboard-root .yd-search:focus,#yd-dashboard-root input:focus{border-color:#aa82a3;box-shadow:0 0 0 3px #875a7b16}\n#yd-dashboard-root .yd-field{gap:5px}\n#yd-dashboard-root .yd-field label{font-size:10.5px}\n#yd-dashboard-root .yd-form-grid{gap:12px;margin-top:9px}\n#yd-dashboard-root .yd-info-row{padding:9px 0;font-size:11.5px}\n#yd-dashboard-root .yd-clean-row{min-height:36px;font-size:11.5px}\n#yd-dashboard-root .yd-card-title{gap:9px;margin-bottom:6px;padding-bottom:9px;font-size:12px}\n#yd-dashboard-root .yd-title-icon{display:inline-grid;place-items:center;width:26px;height:26px;flex:0 0 26px;border:1px solid #e1d7e4;border-radius:8px;background:#f7f1f7;color:var(--brand);font-size:11px}\n#yd-dashboard-root .yd-table-card-head{min-height:45px;padding:8px 13px;border-bottom-color:#ded7e3}\n#yd-dashboard-root .yd-table-card-title{gap:8px;font-size:12px}\n#yd-dashboard-root .yd-table-pills{gap:5px}\n#yd-dashboard-root .yd-icon-btn{width:30px;height:30px;border-radius:8px}\n#yd-dashboard-root .yd-icon-btn i{font-size:12px}\n#yd-dashboard-root .yd-user-actions{gap:6px}\n#yd-dashboard-root .yd-gb-btn{width:38px;height:38px;padding:1px;border:0;border-radius:50%;background:conic-gradient(var(--brand),var(--brand-dark),#b48aa8,var(--brand))}\n#yd-dashboard-root .yd-gb-ring-lg{display:flex;align-items:center;justify-content:center;width:54px;height:54px;margin-bottom:10px;padding:1px;border-radius:50%;background:conic-gradient(var(--brand),var(--brand-dark),#b48aa8,var(--brand))}\n#yd-dashboard-root .yd-gb-avatar-lg{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:1px solid #fff;border-radius:50%;background:var(--brand);color:#fff;font-size:18px;font-weight:800}\n#yd-dashboard-root .yd-gb-avatar{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:1px solid #fff;border-radius:50%;background:var(--brand);color:#fff;font-size:12px;font-weight:800}\n#yd-dashboard-root .yd-gb-badge{right:-2px;bottom:-2px;width:14px;height:14px;border:1px solid #fff;border-radius:50%;background:var(--success);color:#fff;font-size:8px}\n#yd-dashboard-root .yd-gb-badge i{font-size:7px;line-height:1}\n#yd-dashboard-root .yd-profile-menu{padding:11px;border:1px solid #dcd5e1;border-radius:12px;background:#fff;box-shadow:0 14px 36px #24152e22}\n#yd-dashboard-root .yd-gb-card{margin-bottom:8px;padding:13px 12px;border-color:#e1dbe5;border-radius:10px}\n#yd-dashboard-root .yd-dropdown-action{min-height:38px;margin-top:5px;padding:5px 8px;border:1px solid #e2dce5;border-radius:9px;gap:9px;font-size:11px}\n#yd-dashboard-root .yd-action-icon{width:27px;height:27px;flex-basis:27px;border:1px solid #e3d9e5;border-radius:8px;background:#f5eff6;font-size:11px}\n#yd-dashboard-root .yd-close-btn{width:32px;height:32px;border-radius:8px;font-size:15px}\n#yd-dashboard-root .yd-switch{width:38px;height:22px;padding:3px;border-radius:999px}\n#yd-dashboard-root .yd-switch-knob{width:16px;height:16px}\n#yd-dashboard-root .yd-switch.on .yd-switch-knob{transform:translateX(16px)}\n#yd-dashboard-root .yd-switch.yd-switch-forced.on{background:#bd8a35}\n#yd-dashboard-root .yd-switch-state{min-width:24px;margin-left:5px;font-size:9.5px}\n#yd-dashboard-root .yd-accordion-list,#yd-dashboard-root .yd-tool-accordion-list{overflow:hidden;border:1px solid #dcd5e1;border-radius:11px;background:#fff;box-shadow:0 2px 5px #29242e08}\n#yd-dashboard-root .yd-accordion-item,#yd-dashboard-root .yd-tool-accordion-item{border-bottom:1px solid #e3dce6}\n#yd-dashboard-root .yd-accordion-item:last-child,#yd-dashboard-root .yd-tool-accordion-item:last-child{border-bottom:0}\n#yd-dashboard-root .yd-accordion-item>summary{min-height:54px;padding:8px 40px 8px 13px}\n#yd-dashboard-root .yd-accordion-user{gap:4px}\n#yd-dashboard-root .yd-accordion-user>strong{font-size:12px}\n#yd-dashboard-root .yd-accordion-body{padding:2px 13px 8px}\n#yd-dashboard-root .yd-permission-row{gap:14px;padding:9px 0}\n#yd-dashboard-root .yd-permission-tool strong{font-size:11.5px}\n#yd-dashboard-root .yd-permission-controls{gap:18px}\n#yd-dashboard-root .yd-permission-control{gap:7px;min-width:132px}\n#yd-dashboard-root .yd-permission-label{min-width:75px;font-size:10px}\n#yd-dashboard-root .yd-tool-accordion-item>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:54px;padding:7px 13px;background:#fff;cursor:pointer;list-style:none;transition:background .15s}\n#yd-dashboard-root .yd-tool-accordion-item>summary::-webkit-details-marker{display:none}\n#yd-dashboard-root .yd-tool-accordion-item>summary::marker{display:none;content:''}\n#yd-dashboard-root .yd-tool-accordion-item>summary:hover{background:#faf7fb}\n#yd-dashboard-root .yd-tool-accordion-item[open]>summary{background:#f7f1f7}\n#yd-dashboard-root .yd-tool-accordion-main{display:flex;align-items:center;gap:10px;min-width:0}\n#yd-dashboard-root .yd-accordion-index{display:grid;place-items:center;width:29px;height:29px;flex:0 0 29px;border:1px solid #e0d6e2;border-radius:8px;background:#f6f0f6;color:var(--brand-dark);font-size:10px;font-weight:800}\n#yd-dashboard-root .yd-tool-accordion-copy{display:flex;flex-direction:column;gap:1px;min-width:0}\n#yd-dashboard-root .yd-tool-accordion-copy strong{overflow:hidden;color:var(--ink);font-size:11.5px;font-weight:750;text-overflow:ellipsis;white-space:nowrap}\n#yd-dashboard-root .yd-tool-accordion-copy small{color:var(--muted);font-size:9.5px}\n#yd-dashboard-root .yd-tool-accordion-actions{display:flex;align-items:center;gap:12px;flex:0 0 auto}\n#yd-dashboard-root .yd-tool-accordion-body{padding:9px 13px 10px;border-top:1px solid #e9e2eb;background:#fcfbfd}\n#yd-dashboard-root .yd-tool-settings-placeholder{display:flex;align-items:center;gap:9px;min-height:38px;padding:7px 9px;border:1px dashed #d9cfdf;border-radius:9px;background:#fff}\n#yd-dashboard-root .yd-settings-placeholder-icon{display:grid;place-items:center;width:26px;height:26px;flex:0 0 26px;border:1px solid #e3d9e6;border-radius:8px;background:#f7f2f7;color:var(--brand);font-size:11px}\n#yd-dashboard-root .yd-tool-settings-placeholder>span:last-child{display:flex;flex-direction:column;gap:1px}\n#yd-dashboard-root .yd-tool-settings-placeholder strong{color:var(--text);font-size:10.5px}\n#yd-dashboard-root .yd-tool-settings-placeholder small{color:var(--muted);font-size:9.5px}\n#yd-dashboard-root .yd-tool-summary{display:flex;align-items:center;gap:7px;margin-top:9px;color:var(--muted);font-size:9.5px}\n#yd-dashboard-root .yd-tool-summary span{padding:3px 8px;border:1px solid #e0d9e3;border-radius:7px;background:#fbfafc}\n#yd-dashboard-root .yd-user-picker{display:flex;align-items:center;gap:8px;min-width:180px;min-height:36px;padding:4px 9px;border:1px solid #dcd4e0;border-radius:9px;background:#fff;color:var(--text);cursor:pointer;text-align:left;transition:all .15s}\n#yd-dashboard-root .yd-user-picker:hover{border-color:#cbb7cc;background:#faf6fb}\n#yd-dashboard-root .yd-user-picker-icon{display:grid;place-items:center;width:26px;height:26px;flex:0 0 26px;border:1px solid #e3d8e5;border-radius:7px;background:#f6f0f6;color:var(--brand);font-size:10px}\n#yd-dashboard-root .yd-user-picker-copy{display:flex;flex:1;flex-direction:column;gap:0;min-width:0}\n#yd-dashboard-root .yd-user-picker-copy strong{font-size:10.5px;font-weight:750}\n#yd-dashboard-root .yd-user-picker-copy small{color:var(--muted);font-size:9px}\n#yd-dashboard-root .yd-user-picker-arrow{color:var(--muted);font-size:9px}\n#yd-dashboard-root .yd-visibility-backdrop{z-index:2147483007}\n#yd-dashboard-root .yd-visibility-users-modal{display:flex;flex-direction:column;width:min(470px,100%);max-height:min(650px,calc(100vh - 36px));overflow:hidden;padding:0;border-color:#d9d2df;border-radius:13px}\n#yd-dashboard-root .yd-visibility-modal-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #e5dfe8;background:#fff}\n#yd-dashboard-root .yd-visibility-modal-header h3{margin:0;font-size:15px}\n#yd-dashboard-root .yd-visibility-modal-header p{margin:2px 0 0;color:var(--muted);font-size:10.5px}\n#yd-dashboard-root .yd-visibility-modal-note{display:flex;align-items:center;gap:8px;margin:10px 13px;padding:8px 10px;border:1px solid #dce6ef;border-radius:8px;background:#f3f7fb;color:#526d83;font-size:10px}\n#yd-dashboard-root .yd-visibility-user-list{overflow:auto;padding:0 15px}\n#yd-dashboard-root .yd-visibility-user-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:47px;border-bottom:1px solid #eae5ed}\n#yd-dashboard-root .yd-visibility-user-row:last-child{border-bottom:0}\n#yd-dashboard-root .yd-visibility-user-info{display:flex;flex-direction:column;gap:1px;min-width:0}\n#yd-dashboard-root .yd-visibility-user-info strong{color:var(--ink);font-size:10.5px;font-weight:750}\n#yd-dashboard-root .yd-visibility-user-info small{color:var(--muted);font-size:9px}\n#yd-dashboard-root .yd-visibility-modal-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 15px;border-top:1px solid #e3dce6;background:#faf9fb;color:var(--muted);font-size:10px}\n#yd-dashboard-root .yd-title-icon{display:inline-grid;place-items:center;width:26px;height:26px;flex:0 0 26px;border:1px solid #e1d7e4;border-radius:8px;background:#f7f1f7;color:var(--brand);font-size:11px}\n#yd-dashboard-root .yd-access-badge{width:27px;height:27px;border-radius:8px;font-size:11px}\n#yd-dashboard-root .yd-access-badge i{font-size:11px}\n#yd-dashboard-root .yd-loading-card{padding:17px 19px;border-radius:13px}\n#yd-dashboard-root .yd-modal{padding:22px;border-radius:12px}\n#yd-dashboard-root .yd-modal h3{margin-bottom:14px;font-size:16px}\n#yd-dashboard-root .yd-modal-actions{margin-top:18px;padding-top:12px}\n#yd-dashboard-root .yd-dropdown-action,#yd-dashboard-root .yd-select,#yd-dashboard-root .yd-field select,#yd-dashboard-root .yd-user-picker{border-radius:9px}\n#yd-dashboard-root .yd-dropdown-action:hover,#yd-dashboard-root .yd-user-picker:hover{border-color:#cdbbd0;background:#f7f2f8}\n#yd-dashboard-root .yd-nav:focus-visible,#yd-dashboard-root button:focus-visible,#yd-dashboard-root select:focus-visible{outline:2px solid #875a7b40;outline-offset:2px}\n#yd-dashboard-root .yd-permission-row{grid-template-columns:minmax(180px,1fr) minmax(300px,1.2fr)}\n@media(max-width:760px){#yd-dashboard-root .yd-tool-accordion-actions{gap:7px}#yd-dashboard-root .yd-accordion-index{width:26px;height:26px;flex-basis:26px}#yd-dashboard-root .yd-user-picker{min-width:145px}#yd-dashboard-root .yd-visibility-users-modal{max-height:calc(100vh - 24px)}}";
        style.textContent += "\n#yd-dashboard-root{font-family:'Cairo',sans-serif!important}\n#yd-dashboard-root strong,#yd-dashboard-root b{font-weight:600!important}\n#yd-dashboard-root .yd-welcome h1,#yd-dashboard-root .yd-section-head h2{font-weight:700!important}\n#yd-dashboard-root .yd-nav,#yd-dashboard-root .yd-primary,#yd-dashboard-root .yd-secondary,#yd-dashboard-root .yd-danger{font-weight:600!important}\n#yd-dashboard-root .yd-switch.yd-switch-forced.on{background:#c33d4b!important;border-color:#c33d4b!important}\n#yd-dashboard-root .yd-switch-state{display:none!important}\n#yd-dashboard-root .yd-accordion-body{padding:10px 14px!important;border-top:1px solid #ded6e2;background:#f8f6f9!important}\n#yd-dashboard-root .yd-permission-row{margin:7px 0;padding:10px 12px!important;border:1px solid #d8cfdd!important;border-radius:10px;background:#fff;box-shadow:0 1px 3px #29242e08}\n#yd-dashboard-root .yd-permission-row:last-child{border-bottom:1px solid #d8cfdd!important}\n#yd-dashboard-root .yd-permission-row + .yd-permission-row{margin-top:8px}\n#yd-dashboard-root .yd-visibility-modal-note{background:#f7f3f8;border-color:#e0d5e3;color:#66556a}\n#yd-dashboard-root .yd-visibility-modal-footer{justify-content:space-between;gap:10px}\n#yd-dashboard-root .yd-visibility-modal-footer-actions{display:flex;align-items:center;gap:8px}\n#yd-dashboard-root .yd-access-controls{display:flex;align-items:center;gap:8px;min-width:300px}\n#yd-dashboard-root .yd-access-controls .yd-select{min-width:132px;flex:0 0 132px;height:34px}\n#yd-dashboard-root .yd-access-controls .yd-user-picker{flex:1;min-width:145px}\n#yd-dashboard-root .yd-confirm-modal{width:min(430px,100%);padding:22px}\n#yd-dashboard-root .yd-confirm-modal p{margin:0;color:var(--muted);font-size:12px;line-height:1.7}\n#yd-dashboard-root .yd-confirm-modal .yd-modal-actions{margin-top:20px}\n#yd-dashboard-root .yd-global-loading,#yd-dashboard-root .yd-loading-overlay{display:none!important}\n@media(max-width:760px){#yd-dashboard-root .yd-access-controls{min-width:250px;flex-wrap:wrap}#yd-dashboard-root .yd-permission-row{grid-template-columns:1fr!important;gap:10px!important}#yd-dashboard-root .yd-permission-controls{justify-content:flex-start!important}}\n";
        style.textContent += "\n#yd-dashboard-root .yd-switch{transition:background-color .24s ease,border-color .24s ease,box-shadow .2s ease,opacity .2s ease,transform .2s ease}\n#yd-dashboard-root .yd-switch-knob{transition:transform .24s cubic-bezier(.2,.8,.2,1),background-color .2s ease,box-shadow .2s ease}\n#yd-dashboard-root .yd-switch:hover:not(:disabled){box-shadow:0 0 0 4px #875a7b16}\n#yd-dashboard-root .yd-permission-row,#yd-dashboard-root .yd-permission-control,#yd-dashboard-root .yd-permission-tool,#yd-dashboard-root .yd-visibility-user-row,#yd-dashboard-root .yd-tool-accordion-actions,#yd-dashboard-root .yd-accordion-summary-meta,#yd-dashboard-root .yd-pill,#yd-dashboard-root .yd-user-actions{transition:background-color .22s ease,border-color .22s ease,color .22s ease,opacity .22s ease,transform .22s ease,box-shadow .22s ease}\n#yd-dashboard-root details::details-content{block-size:0;overflow:clip;opacity:0;transition:block-size .26s ease,content-visibility .26s allow-discrete,opacity .2s ease}\n#yd-dashboard-root details[open]::details-content{block-size:auto;opacity:1}\n#yd-dashboard-root .yd-dropdown{position:relative;display:inline-flex;min-width:0}\n#yd-dashboard-root .yd-select-dropdown{width:100%}\n#yd-dashboard-root .yd-dropdown-trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-width:0;min-height:36px;padding:0 11px;border:1px solid #ded8e1;border-radius:9px;background:#fff;color:var(--ink);font-size:11.5px;font-weight:500;text-align:left;cursor:pointer;transition:background-color .16s,border-color .16s,box-shadow .16s,color .16s}\n#yd-dashboard-root .yd-dropdown-trigger:hover:not(:disabled),#yd-dashboard-root .yd-dropdown.open .yd-dropdown-trigger{border-color:#cbb8ce;background:#fcf9fc;color:var(--brand-dark)}\n#yd-dashboard-root .yd-dropdown-trigger:focus-visible{outline:3px solid #875a7b20;outline-offset:2px}\n#yd-dashboard-root .yd-dropdown-trigger>i{flex:0 0 auto;color:var(--muted);font-size:10px;transition:transform .18s ease}\n#yd-dashboard-root .yd-dropdown.open .yd-dropdown-trigger>i{transform:rotate(180deg)}\n#yd-dashboard-root .yd-dropdown-menu,#yd-dashboard-root .yd-profile-menu{border:1px solid #ded8e3;border-radius:10px;background:#fff;color:var(--ink);box-shadow:0 12px 30px #21132b20,0 0 0 1px #29242e08;outline:none}\n#yd-dashboard-root .yd-dropdown-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:2147483012;display:flex;flex-direction:column;gap:2px;width:max(100%,160px);min-width:160px;max-width:min(280px,calc(100vw - 32px));max-height:min(320px,calc(100vh - 80px));overflow-x:hidden;overflow-y:auto;padding:5px;transform-origin:top left;animation:yd-dropdown-enter .13s cubic-bezier(.2,.8,.2,1) both}\n#yd-dashboard-root .yd-dropdown-menu[hidden]{display:none!important}\n#yd-dashboard-root .yd-dropdown-item{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:33px;padding:5px 8px;border:0;border-radius:7px;background:transparent;color:var(--text);font-size:11px;font-weight:500;text-align:left;cursor:pointer;transition:background-color .12s,color .12s}\n#yd-dashboard-root .yd-dropdown-item:hover,#yd-dashboard-root .yd-dropdown-item:focus-visible{background:#f4eef5;color:var(--brand-dark);outline:none}\n#yd-dashboard-root .yd-dropdown-item.selected{color:var(--brand-dark);font-weight:600}\n#yd-dashboard-root .yd-dropdown-item>i{color:var(--brand);font-size:10px}\n#yd-dashboard-root .yd-dropdown.disabled{opacity:.58}\n#yd-dashboard-root .yd-dropdown.disabled .yd-dropdown-trigger{cursor:not-allowed}\n#yd-dashboard-root .yd-profile-menu{padding:6px;animation:yd-dropdown-enter .13s cubic-bezier(.2,.8,.2,1) both}\n#yd-dashboard-root .yd-profile-menu .yd-gb-card{margin:0 0 5px;padding:12px;border:0;border-bottom:1px solid var(--border);border-radius:7px;background:#faf9fb}\n#yd-dashboard-root .yd-profile-menu .yd-dropdown-action{min-height:36px;margin-top:2px;padding:5px 8px;border:0;border-radius:7px;background:transparent;box-shadow:none}\n#yd-dashboard-root .yd-profile-menu .yd-dropdown-action:hover{background:#f4eef5}\n#yd-dashboard-root .yd-profile-menu .yd-action-icon{width:25px;height:25px;flex-basis:25px;border-radius:6px}\n#yd-dashboard-root .yd-pending-badge{display:inline-flex;align-items:center;gap:6px;min-height:22px;padding:2px 8px;border:1px solid #ead7a9;border-radius:999px;background:#fff8e8;color:#8a6421;font-size:9px;font-weight:600;white-space:nowrap}\n#yd-dashboard-root .yd-pending-badge i{font-size:9px}\n#yd-dashboard-root .yd-pending-badge.failed{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}\n#yd-dashboard-root .yd-pending-row{background:#fffcf5!important}\n#yd-dashboard-root .yd-pending-row td{background:#fffcf5!important}\n#yd-dashboard-root .yd-permission-row.is-pending{border-color:#ead7a9!important;background:#fffcf5}\n#yd-dashboard-root .yd-permission-row.is-pending .yd-permission-tool{opacity:.82}\n#yd-dashboard-root .yd-visibility-user-row.is-pending{background:#fffcf5}\n#yd-dashboard-root .yd-visibility-user-row .yd-pending-badge{margin-left:8px}\n#yd-dashboard-root .yd-network-table td{white-space:normal}\n#yd-dashboard-root .yd-network-activity{display:flex;flex-direction:column;gap:2px;min-width:180px}\n#yd-dashboard-root .yd-network-activity strong{color:var(--ink);font-size:11px;font-weight:600}\n#yd-dashboard-root .yd-network-activity small{color:var(--muted);font-size:9px}\n#yd-dashboard-root .yd-network-pagination{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin:12px 2px 2px}\n#yd-dashboard-root .yd-network-pagination span{margin-right:6px;color:var(--muted);font-size:10px}\n#yd-dashboard-root .yd-network-pagination button{min-width:32px;min-height:30px;padding:0 9px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--text);font-size:10px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}\n#yd-dashboard-root .yd-network-pagination button:hover:not(:disabled){border-color:#cbb8ce;background:#f7f1f7;color:var(--brand-dark)}\n#yd-dashboard-root .yd-network-pagination button:disabled{opacity:.4;cursor:not-allowed}\n#yd-dashboard-root .yd-modal-backdrop{animation:yd-backdrop-enter .16s ease-out both}\n#yd-dashboard-root .yd-modal{animation:yd-modal-enter .18s cubic-bezier(.2,.8,.2,1) both}\n#yd-dashboard-root .yd-toast{animation:yd-toast-enter .18s cubic-bezier(.2,.8,.2,1) both}\n@keyframes yd-dropdown-enter{from{opacity:0;transform:translateY(-5px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}\n@keyframes yd-backdrop-enter{from{opacity:0}to{opacity:1}}\n@keyframes yd-modal-enter{from{opacity:0;transform:translateY(7px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}\n@keyframes yd-toast-enter{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}\n@media(prefers-reduced-motion:reduce){#yd-dashboard-root *,#yd-dashboard-root *::before,#yd-dashboard-root *::after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}\n";
        (document.head || document.documentElement).appendChild(style);
    };
    const navItems = () => {
        const items = [['overview', 'fa-solid fa-chart-pie', 'Overview'], ['tools', 'fa-solid fa-toolbox', 'Tools']];
        if (['ADMIN', 'SUPER_ADMIN'].includes(context.userRole)) items.push(['users', 'fa-solid fa-users', 'Users']);
        if (context.userRole === 'ADMIN') items.push(['permissions', 'fa-solid fa-sliders', 'User Permissions']);
        if (context.userRole === 'SUPER_ADMIN') items.push(['permissions', 'fa-solid fa-share-nodes', 'Shared Tools'], ['visibility', 'fa-solid fa-eye', 'Visibility'], ['transactions', 'fa-solid fa-right-left', 'NETWORK']);
        items.push(['account', 'fa-solid fa-gear', 'Settings']);
        return items;
    };

    
        const pageTitle = () => ({ overview: 'Overview', tools: 'Tools', users: 'Users & Permissions', permissions: 'Shared Tools', visibility: 'Visibility', transactions: 'NETWORK Activity', account: 'Settings' })[activePage] || 'Dashboard';

    const renderShell = body => {
        const user = context.user || {};
        const role = String(context.userRole || 'USER').replace(/_/g, ' ');
        const name = escapeHTML(formatName(user.name || user.id || 'User'));
        const avatar = escapeHTML(initials(user.name || user.id));
        const menu = navItems().map(([id, icon, label]) => '<button type="button" data-page="' + id + '" class="yd-nav ' + (activePage === id ? 'active' : '') + '"><span class="yd-nav-icon"><i class="' + icon + '"></i></span><span>' + escapeHTML(label) + '</span></button>').join('');
        const toast = notice ? '<div class="yd-toast ' + escapeHTML(notice.type) + '">' + escapeHTML(notice.message) + '</div>' : '';
        const loading = '<div id="yd-global-loading" class="yd-loading-overlay"' + (busy ? '' : ' hidden') + ' role="status" aria-live="polite"><div class="yd-loading-card"><span class="yd-spinner"></span><div><strong>WORKING WITH GITHUB</strong><span class="yd-loading-message">' + escapeHTML(busyMessage) + '</span></div></div></div>';
        return '<button id="yd-launcher" type="button" data-action="toggle-dashboard"><span class="yd-brand-logo">Y</span><span>YODAWY DASHBOARD</span></button>' +
            '<div id="yd-overlay" class="' + (isOpen ? 'open' : '') + '">' +
                '<div id="yd-modal" role="dialog" aria-modal="true" aria-label="Yodawy Dashboard">' +
                    '<header id="yd-header"><div class="yd-brand"><div class="yd-brand-logo">Y</div><div class="yd-brand-title">YODAWY DASHBOARD (' + escapeHTML(role.toUpperCase()) + ')</div></div>' +
                        '<div class="yd-header-actions"><div class="yd-header-status"><span class="yd-header-dot"></span><span>Connected</span></div>' +
                            '<div class="yd-profile-wrap"><button id="yd-profile-trigger" class="yd-gb-btn" data-action="profile-toggle" aria-expanded="' + String(profileOpen) + '" type="button" aria-label="Account"><span class="yd-gb-avatar">' + avatar + '</span><span class="yd-gb-badge"><i class="fa-solid fa-check"></i></span></button>' +
                                '<div id="yd-profile-menu" class="yd-profile-menu"' + (profileOpen ? '' : ' hidden') + '>' +
                                    '<div class="yd-gb-card"><div class="yd-gb-ring-lg"><div class="yd-gb-avatar-lg">' + avatar + '</div></div><div class="yd-gb-name">' + name + '</div><div class="yd-gb-meta">ID: ' + escapeHTML(user.id || user.userId || context.userId || '—') + '</div><div class="yd-gb-pills"><span class="yd-pill blue">' + escapeHTML(role) + '</span><span class="yd-pill green">Connected</span></div></div>' +
                                    '<button class="yd-dropdown-action" data-action="refresh-connection" type="button"><span class="yd-action-icon"><i class="fa-solid fa-arrow-rotate-right"></i></span><span><b>Refresh</b></span></button>' +
                                '</div></div><button class="yd-close-btn" data-action="close-dashboard" type="button" title="Close"><i class="fa-solid fa-xmark"></i></button></div>' +
                    '</header><div id="yd-body"><aside id="yd-sidebar"><div class="yd-nav-label">Workspace</div>' + menu + '<div class="yd-sidebar-bottom">Authenticated Workspace<br>Yodawy Tools Cloud · v1</div></aside><main id="yd-main">' + body + '</main></div>' +
                '</div></div>' + toast + loading;
    };

    
    const statCard = (label, value, icon, colorClass = 'purple') =>
        '<div class="yd-kpi-card"><div class="yd-kpi-icon ' + colorClass + '"><i class="' + icon + '"></i></div><div class="yd-kpi-info"><div class="yd-kpi-label">' + escapeHTML(label) + '</div><div class="yd-kpi-value">' + escapeHTML(value) + '</div></div></div>';

    const renderToolCards = tools => {
        if (!tools.length) return '<div class="yd-card yd-empty">No tools are currently available.</div>';
        const loaded = new Set(getLoadedTools().map(tool => tool.id));
        return `<div class="yd-grid">${tools.map(tool => `
            <article class="yd-card yd-tool-card">
                <div class="yd-tool-head"><div class="yd-tool-icon"><i class="fa-solid fa-toolbox"></i></div><div><div class="yd-tool-name">${escapeHTML(tool.name)}</div><div class="yd-tool-meta">${escapeHTML(tool.id)} · v${escapeHTML(tool.version || '1')}</div></div></div>
                <div class="yd-tool-description">${escapeHTML(tool.description || 'Yodawy productivity tool.')}</div>
                <div class="yd-tool-foot"><span class="yd-status ${loaded.has(tool.id) ? 'on' : ''}"><i class="yd-dot"></i>${loaded.has(tool.id) ? 'Loaded' : 'Not loaded'}</span><span class="yd-pill">${escapeHTML(tool.author || 'Yodawy')}</span></div>
            </article>
        `).join('')}</div>`;
    };

    const renderTransactionsTable = transactions => {
        if (!transactions.length) return '<div class="yd-card yd-empty">No NETWORK activity found.</div>';
        const totalPages = Math.max(1, Math.ceil(transactions.length / NETWORK_PAGE_SIZE));
        networkPage = Math.min(Math.max(1, networkPage), totalPages);
        const start = (networkPage - 1) * NETWORK_PAGE_SIZE;
        const visible = transactions.slice(start, start + NETWORK_PAGE_SIZE);
        const rows = visible.map(item => {
            const status = String(item.status || 'SENT').toUpperCase();
            const pending = isPendingTransaction(item);
            const actor = getActorName(item);
            const summary = item.summary || formatAction(item.action || item.requestType);
            const statusMarkup = pending
                ? renderPendingBadge(status === 'PROCESSING' ? 'Processing' : status === 'SENT' ? 'Queued' : 'Pending')
                : '<span class="yd-pill ' + (status === 'COMPLETED' ? 'green' : 'red') + '">' + escapeHTML(status) + '</span>';
            return '<tr><td><div class="yd-network-activity"><strong>' + escapeHTML(summary) + '</strong><small>By ' + escapeHTML(actor) + '</small></div></td><td>' + statusMarkup + '</td><td>' + escapeHTML(formatDate(item.updatedAt || item.createdAt)) + '</td></tr>';
        }).join('');
        return '<div class="yd-table-wrap yd-network-table"><table><thead><tr><th>Activity</th><th style="width:130px">Status</th><th style="width:190px">Date</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<div class="yd-network-pagination"><span>' + (start + 1) + '–' + Math.min(start + NETWORK_PAGE_SIZE, transactions.length) + ' of ' + transactions.length + '</span><button type="button" data-action="network-page" data-page="' + (networkPage - 1) + '"' + (networkPage <= 1 ? ' disabled' : '') + ' aria-label="Previous page"><i class="fa-solid fa-chevron-left"></i></button><button type="button" data-action="network-page" data-page="' + (networkPage + 1) + '"' + (networkPage >= totalPages ? ' disabled' : '') + ' aria-label="Next page"><i class="fa-solid fa-chevron-right"></i></button></div>';
    };

    const renderOverview = () => {
        const toolList = getTools();
        const visibleTools = toolList.filter(tool => context.userRole === 'SUPER_ADMIN' || context.visibility?.isVisible?.(tool.id, tool));
        const permittedTools = visibleTools.filter(tool => context.permissions?.canUse?.(context.userId || context.user?.id, tool.id) === true);
        const enabledTools = visibleTools.filter(tool => context.settings?.isEnabled?.(tool.id) === true);
        const settings = context.settings?.getSettings?.() || {};
        const user = context.user || {};
        const role = String(context.userRole || 'USER').replace(/_/g, ' ');
        return '<section class="yd-welcome"><div><h1>Overview</h1><p>Your centralized Yodawy tools workspace and account status.</p></div></section>' +
            '<section class="yd-stats">' +
                statCard('Tools', visibleTools.length, 'fa-solid fa-toolbox', 'blue') +
                statCard('Permitted', permittedTools.length, 'fa-solid fa-shield-halved', 'green') +
                statCard('Active (ON)', enabledTools.length, 'fa-solid fa-bolt', 'purple') +
                statCard('Status', 'Connected', 'fa-solid fa-cloud', 'green') +
            '</section>' +
            '<section class="yd-info-grid">' +
                '<div class="yd-card"><div class="yd-card-title"><span class="yd-title-icon"><i class="fa-solid fa-user"></i></span><span>Account</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Name</span><span class="yd-clean-val">' + escapeHTML(formatName(settings.displayName || user.name || '—')) + '</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">User ID</span><span class="yd-id-badge">' + escapeHTML(user.id || user.userId || context.userId || '—') + '</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Role</span><span class="yd-pill blue">' + escapeHTML(role) + '</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Account Status</span><span class="yd-pill green">' + escapeHTML(user.status || 'Active') + '</span></div>' +
                '</div>' +
                '<div class="yd-card"><div class="yd-card-title"><span class="yd-title-icon"><i class="fa-solid fa-plug-circle-check"></i></span><span>Connection</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">System</span><span class="yd-pill green">Connected to system</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Personal Settings</span><span class="yd-pill ' + (context.settings?.isLoaded?.() ? 'green' : 'red') + '">' + (context.settings?.isLoaded?.() ? 'Connected' : 'Unavailable') + '</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Tools Sync</span><span class="yd-pill ' + (context.tools?.isInitialized?.() ? 'blue' : 'yellow') + '">' + (context.tools?.isInitialized?.() ? 'Ready' : 'Pending') + '</span></div>' +
                    '<div class="yd-clean-row"><span class="yd-clean-label">Current Site</span><span class="yd-pill">' + escapeHTML(location.hostname) + '</span></div>' +
                '</div>' +
            '</section>';
    };

    
        const renderTools = () => {
        const allTools = getTools();
        const isSuperAdmin = context.userRole === 'SUPER_ADMIN';
        const visibleTools = allTools.filter(tool => isSuperAdmin || context.visibility?.isVisible?.(tool.id, tool));
        const userId = context.userId || context.user?.id;
        const permittedCount = isSuperAdmin ? 0 : visibleTools.filter(tool => context.permissions?.canUse?.(userId, tool.id) === true).length;
        const onCount = visibleTools.filter(tool => (isSuperAdmin || context.permissions?.canUse?.(userId, tool.id) === true) && context.settings?.isEnabled?.(tool.id) === true).length;
        const items = visibleTools.map((tool, index) => {
            const id = String(tool.id || '').trim();
            const allowed = isSuperAdmin || context.permissions?.canUse?.(userId, id) === true;
            const enabled = allowed && context.settings?.isEnabled?.(id) === true;
            const expanded = expandedTools.has(id) ? ' open' : '';
            return '<details class="yd-tool-accordion-item" data-tool-accordion data-tool="' + escapeHTML(id) + '"' + expanded + '>' +
                '<summary><span class="yd-tool-accordion-main"><span class="yd-accordion-index">' + String(index + 1).padStart(2, '0') + '</span><span class="yd-tool-accordion-copy"><strong>' + escapeHTML(tool.name) + '</strong><small>' + escapeHTML(id) + ' · v' + escapeHTML(tool.version || '1') + '</small></span></span>' +
                '<span class="yd-tool-accordion-actions"><span class="yd-pill ' + (enabled ? 'green' : 'red') + '">' + (enabled ? 'ON' : 'OFF') + '</span><button type="button" class="yd-switch ' + (enabled ? 'on' : '') + '" data-action="toggle-my-tool" data-tool="' + escapeHTML(id) + '" data-enabled="' + String(enabled) + '" ' + (allowed ? '' : 'disabled') + ' role="switch" aria-checked="' + String(enabled) + '" aria-label="Toggle ' + escapeHTML(tool.name) + '"><span class="yd-switch-knob"></span></button></span></summary>' +
                '<div class="yd-tool-accordion-body"><div class="yd-tool-settings-placeholder"><span class="yd-settings-placeholder-icon"><i class="fa-solid fa-sliders"></i></span><span><strong>User Settings</strong><small>Tool-specific user settings will be available here.</small></span></div></div></details>';
        }).join('');
        return '<section class="yd-welcome"><div><h1>Tools</h1><p>' + (isSuperAdmin ? 'Manage your personal tools and their availability.' : 'Expand a tool to access its personal settings and control its status.') + '</p></div></section>' +
            '<div class="yd-toolbar"><input class="yd-search" id="yd-tool-search" placeholder="Search tools by name or ID"><span class="yd-pill">' + getLoadedTools().length + ' loaded / ' + allTools.length + ' total</span></div>' +
            '<div class="yd-tool-accordion-list">' + (items || '<div class="yd-card yd-empty">No tools available.</div>') + '</div>' +
            '<div class="yd-tool-summary"><span>' + visibleTools.length + ' Tools</span><span>' + permittedCount + ' Permitted</span><span>' + onCount + ' Enabled</span></div>';
    };

    
        const renderUsers = () => {
        const baseUsers = getUsers();
        const pendingAdds = getPendingTransactions().filter(item => String(item.action || '').toUpperCase() === 'ADD_USER' && item.targetName);
        const knownNames = new Set(baseUsers.map(user => String(user.name || '').trim().toLocaleLowerCase()));
        const syntheticUsers = pendingAdds.filter(item => !knownNames.has(String(item.targetName || '').trim().toLocaleLowerCase())).map(item => ({
            id: 'PENDING-' + String(item.sequence || '').trim(),
            name: item.targetName,
            role: item.targetRole || 'USER',
            status: 'Active',
            repository: 'PENDING',
            _pending: true,
            _transaction: item
        }));
        const users = [...baseUsers, ...syntheticUsers];
        const isAdmin = context.userRole === 'ADMIN';
        const currentUserId = String(context.userId || context.user?.id || '').trim().toUpperCase();
        const roleDescription = isAdmin ? 'Manage USER accounts and their basic account details.' : 'Manage registered accounts and their dashboard roles.';
        const rows = users.map(user => {
            const id = String(user.id || '');
            const isSelf = id.trim().toUpperCase() === currentUserId;
            const pending = user._pending ? user._transaction : getPendingUser(user);
            const pendingAction = String(pending?.action || '').toUpperCase();
            const pendingLabel = pendingAction === 'ADD_USER' ? 'Adding' : pendingAction === 'DELETE_USER' ? 'Deleting' : 'Updating';
            const canDelete = !isAdmin && !(context.userRole === 'SUPER_ADMIN' && isSelf) && !user._pending;
            const editButton = !user._pending && !(context.userRole === 'SUPER_ADMIN' && isSelf)
                ? '<button type="button" class="yd-icon-btn" data-action="edit-user" data-id="' + escapeHTML(id) + '" title="Edit user" aria-label="Edit user"' + (pending ? ' disabled' : '') + '><i class="fa-solid fa-pen-to-square"></i></button>'
                : '';
            const deleteButton = canDelete
                ? '<button type="button" class="yd-icon-btn danger" data-action="delete-user" data-id="' + escapeHTML(id) + '" title="Delete user" aria-label="Delete user"' + (pending ? ' disabled' : '') + '><i class="fa-solid fa-trash-can"></i></button>'
                : '';
            const status = pending ? renderPendingBadge(pendingLabel) : '<span class="yd-pill ' + (String(user.status).toLowerCase() === 'active' ? 'green' : 'red') + '">' + escapeHTML(user.status) + '</span>';
            const repository = user._pending ? 'QUEUED' : String(user.repository || 'Provisioning').toUpperCase();
            return '<tr' + (pending ? ' class="yd-pending-row"' : '') + '><td><strong>' + escapeHTML(formatName(user.name)) + '</strong></td><td><span class="yd-id-badge">' + escapeHTML(user._pending ? 'ASSIGNING ID' : id) + '</span></td><td><span class="yd-pill">' + escapeHTML(user.role) + '</span></td><td>' + status + '</td><td><span class="yd-repository-name">' + escapeHTML(repository) + '</span></td><td><div class="yd-user-actions">' + editButton + deleteButton + '</div></td></tr>';
        }).join('');
        return '<section class="yd-welcome"><div><h1>Users Directory</h1><p>' + roleDescription + '</p></div><button class="yd-primary" data-action="add-user"><i class="fa-solid fa-plus"></i><span>Add User</span></button></section>' +
            '<div class="yd-toolbar"><input class="yd-search" id="yd-user-search" placeholder="Search by ID, name, role or repository"><span class="yd-pill">' + users.length + ' users</span></div>' +
            '<div class="yd-table-wrap"><table><thead><tr><th>User</th><th>User ID</th><th>Role</th><th>Status</th><th>Personal Repository</th><th>Actions</th></tr></thead><tbody>' +
            (rows || '<tr><td colspan="6" class="yd-empty">No users found.</td></tr>') + '</tbody></table></div>';
    };

    
    const renderPermissions = () => {
        const allUsers = getUsers();
        const isSuperAdmin = context.userRole === 'SUPER_ADMIN';
        const users = allUsers.filter(user => isSuperAdmin ? ['ADMIN', 'USER'].includes(String(user.role).toUpperCase()) : String(user.role).toUpperCase() === 'USER');
        const tools = getRoleEngine()?.getTools?.() || getTools().filter(tool => isSuperAdmin || context.visibility?.isVisible?.(tool.id, tool));
        const permissions = getRoleEngine()?.getPermissions?.() || {};
        if (isSuperAdmin) {
            const items = users.map(user => {
                const userId = String(user.id || '');
                const userPermissions = permissions[userId] || {};
                const active = String(user.status || '').toLowerCase() === 'active';
                let grantedCount = 0, forcedCount = 0;
                const rows = tools.map(tool => {
                    const record = userPermissions[tool.id] || {};
                    const granted = record.granted === true, forced = record.forcedState === true;
                    const pending = getPendingPermission(userId, tool.id);
                    if (granted) grantedCount++;
                    if (forced) forcedCount++;
                    const disabled = active && !pending ? '' : ' disabled';
                    const pendingBadge = pending ? renderPendingBadge('Queued') : '';
                    const permittedSwitch = '<button type="button" class="yd-switch ' + (granted ? 'on' : '') + '" data-action="toggle-permission" data-field="granted" data-value="' + String(granted) + '" data-user="' + escapeHTML(userId) + '" data-tool="' + escapeHTML(tool.id) + '" role="switch" aria-checked="' + String(granted) + '" aria-label="Permit ' + escapeHTML(tool.name) + '"' + disabled + '><span class="yd-switch-knob"></span></button>';
                    const forcedSwitch = '<button type="button" class="yd-switch yd-switch-forced ' + (forced ? 'on' : '') + '" data-action="toggle-permission" data-field="forcedState" data-value="' + String(forced) + '" data-user="' + escapeHTML(userId) + '" data-tool="' + escapeHTML(tool.id) + '" role="switch" aria-checked="' + String(forced) + '" aria-label="Force state for ' + escapeHTML(tool.name) + '"' + disabled + '><span class="yd-switch-knob"></span></button>';
                    return '<div class="yd-permission-row' + (pending ? ' is-pending' : '') + '"><div class="yd-permission-tool"><strong>' + escapeHTML(tool.name) + '</strong>' + pendingBadge + '<span>' + escapeHTML(tool.id) + '</span></div><div class="yd-permission-controls"><div class="yd-permission-control"><span class="yd-permission-label">Permitted</span>' + permittedSwitch + '</div><div class="yd-permission-control"><span class="yd-permission-label">Forced State</span>' + forcedSwitch + '</div></div></div>';
                }).join('');
                const expanded = expandedUsers.has(userId) ? ' open' : '';
                const userPending = getPendingUser(user);
                const userBadge = userPending ? renderPendingBadge(String(userPending.action).toUpperCase() === 'DELETE_USER' ? 'Deleting' : 'Updating') : '';
                return '<details class="yd-accordion-item" data-user-accordion data-user="' + escapeHTML(userId) + '"' + expanded + '><summary><span class="yd-accordion-user"><strong>' + escapeHTML(formatName(user.name)) + ' ' + userBadge + '</strong><small><span class="yd-id-badge">' + escapeHTML(userId) + '</span><span class="yd-pill">' + escapeHTML(user.role) + '</span></small></span><span class="yd-accordion-summary-meta"><span class="yd-pill green">' + grantedCount + ' Permitted</span><span class="yd-pill blue">' + forcedCount + ' Forced</span></span></summary><div class="yd-accordion-body">' + (rows || '<div class="yd-empty">No tools are available.</div>') + '</div></details>';
            }).join('');
            return '<section class="yd-welcome"><div><h1>Shared Tools</h1><p>Expand a user to manage tool access and forced states.</p></div><span class="yd-pill">SUPER ADMIN CONTROL</span></section><div class="yd-accordion-list">' + (items || '<div class="yd-empty">No eligible users found.</div>') + '</div>';
        }
        return '<section class="yd-welcome"><div><h1>User Permissions</h1><p>Permit or revoke tool access for USER accounts.</p></div><span class="yd-pill">ADMIN CONTROL</span></section>' +
            '<div class="yd-table-wrap"><table><thead><tr><th>User</th><th>Tool</th><th>Permitted</th><th>Forced State</th><th>Action</th></tr></thead><tbody>' +
            (users.flatMap(user => tools.map(tool => {
                const record = permissions[user.id]?.[tool.id] || {};
                const pending = getPendingPermission(user.id, tool.id);
                return '<tr' + (pending ? ' class="yd-pending-row"' : '') + '><td><strong>' + escapeHTML(formatName(user.name)) + '</strong></td><td>' + escapeHTML(tool.name) + (pending ? renderPendingBadge('Queued') : '') + '</td><td><span class="yd-pill ' + (record.granted ? 'green' : 'red') + '">' + (record.granted ? 'Permitted' : 'Denied') + '</span></td><td>' + (record.forcedState ? 'Protected' : 'Normal') + '</td><td><button class="yd-secondary" data-action="toggle-permission" data-user="' + escapeHTML(user.id) + '" data-tool="' + escapeHTML(tool.id) + '" data-granted="' + String(record.granted === true) + '"' + (pending ? ' disabled' : '') + '>' + (record.granted ? 'Revoke' : 'Permit') + '</button></td></tr>';
            })).join('') || '<tr><td colspan="5" class="yd-empty">No eligible users or visible tools.</td></tr>') + '</tbody></table></div>';
    };

    
    const renderVisibility = () => {
        const toolList = getTools();
        const engine = getRoleEngine();
        const storedVisibility = engine?.getVisibility?.() || {};
        const visibilityMap = { ...storedVisibility, ...Object.fromEntries(optimisticVisibility) };
        const users = engine?.getUsers?.() || [];
        const rows = toolList.map((tool, index) => {
            const record = visibilityMap[tool.id] || { visibility: 'PRIVATE', allowedUsers: [] };
            const allowed = Array.isArray(record.allowedUsers) ? record.allowedUsers : [];
            const id = escapeHTML(tool.id);
            const pending = getPendingVisibility(tool.id);
            const selectionLabel = record.visibility === 'PUBLIC' ? 'All Users' : allowed.length ? allowed.length + ' Selected' : 'No Users Selected';
            const scope = record.visibility === 'PUBLIC' ? 'PUBLIC' : 'SELECTED_USERS';
            const scopeDropdown = renderDropdown('', scope, [
                { value: 'PUBLIC', label: 'All Users' },
                { value: 'SELECTED_USERS', label: 'Selected Users' }
            ], { 'data-change': 'visibility', 'data-tool': id }, Boolean(pending));
            return '<tr' + (pending ? ' class="yd-pending-row"' : '') + '><th>' + (index + 1) + '</th><td><span class="yd-id-badge">' + id + '</span></td><td><div class="yd-tool-name">' + escapeHTML(tool.name) + '</div></td>' +
                '<td><div class="yd-access-controls">' + scopeDropdown + '<button type="button" class="yd-user-picker" data-action="open-visibility-users" data-tool="' + id + '"><span class="yd-user-picker-icon"><i class="fa-solid fa-users"></i></span><span class="yd-user-picker-copy"><strong>Select Users</strong><small>' + escapeHTML(selectionLabel) + '</small></span>' + (pending ? renderPendingBadge('Pending') : '<i class="fa-solid fa-chevron-down yd-user-picker-arrow"></i>') + '</button></div></td></tr>';
        }).join('');
        const selectedTool = toolList.find(tool => tool.id === openVisibilityToolId);
        const selectedRecord = selectedTool ? visibilityMap[selectedTool.id] || { visibility: 'PRIVATE', allowedUsers: [] } : null;
        const draft = selectedTool && visibilityDraft?.toolId === selectedTool.id ? visibilityDraft : null;
        const pendingVisibility = selectedTool ? getPendingVisibility(selectedTool.id) : null;
        const selectedIds = new Set(draft ? [...draft.allowedUsers] : (selectedRecord?.allowedUsers || []).map(id => String(id).trim().toUpperCase()));
        const allUsersSelected = draft ? draft.allUsers : selectedRecord?.visibility === 'PUBLIC';
        const modalRows = selectedTool ? users.map(user => {
            const id = String(user.id || '').trim().toUpperCase();
            const active = String(user.status || '').toLowerCase() === 'active';
            const selected = allUsersSelected || selectedIds.has(id);
            return '<div class="yd-visibility-user-row' + (pendingVisibility ? ' is-pending' : '') + '"><span class="yd-visibility-user-info"><strong>' + escapeHTML(formatName(user.name)) + '</strong><small>' + escapeHTML(id) + ' · ' + escapeHTML(user.role) + (active ? '' : ' · INACTIVE') + '</small></span><button type="button" class="yd-switch ' + (selected ? 'on' : '') + '" data-action="toggle-visibility-user" data-tool="' + escapeHTML(selectedTool.id) + '" data-user="' + escapeHTML(id) + '" data-selected="' + String(selected) + '" ' + (active && !pendingVisibility ? '' : 'disabled') + ' role="switch" aria-checked="' + String(selected) + '" aria-label="Allow ' + escapeHTML(formatName(user.name)) + '"><span class="yd-switch-knob"></span></button></div>';
        }).join('') : '';
        const countLabel = allUsersSelected ? users.length + ' users included' : selectedIds.size + ' selected';
        const modalNote = pendingVisibility
            ? '<i class="fa-solid fa-circle-info"></i><span>This tool is queued. Its access settings are locked until processing finishes.</span>' + renderPendingBadge('Pending')
            : '<i class="fa-solid fa-circle-info"></i><span>Changes are saved together when you press Save.</span>';
        const modal = selectedTool ? '<div class="yd-modal-backdrop yd-visibility-backdrop" id="yd-visibility-users-backdrop"><section class="yd-modal yd-visibility-users-modal" role="dialog" aria-modal="true" aria-labelledby="yd-visibility-users-title"><header class="yd-visibility-modal-header"><div><h3 id="yd-visibility-users-title">Allowed Users</h3><p>' + escapeHTML(selectedTool.name) + '</p></div><button type="button" class="yd-icon-btn" data-action="close-visibility-users" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header><div class="yd-visibility-modal-note">' + modalNote + '</div><div class="yd-visibility-user-list">' + (modalRows || '<div class="yd-empty">No users found.</div>') + '</div><footer class="yd-visibility-modal-footer"><span>' + escapeHTML(countLabel) + '</span><div class="yd-visibility-modal-footer-actions"><button type="button" class="yd-secondary" data-action="close-visibility-users">Done</button><button type="button" class="yd-primary" data-action="save-visibility-users"' + (pendingVisibility ? ' disabled' : '') + '>Save</button></div></footer></section></div>' : '';
        return '<section class="yd-welcome"><div><h1>Allowed Users</h1><p>Choose which users can discover each tool. Select All Users or manage individual access.</p></div><span class="yd-pill blue">SUPER ADMIN CONTROL</span></section>' +
            '<div class="yd-table-card"><div class="yd-table-card-head"><div class="yd-table-card-title"><span class="yd-title-icon"><i class="fa-solid fa-users"></i></span><span>Tool Access (' + toolList.length + ')</span></div></div>' +
            '<div class="yd-table-responsive"><table><thead><tr><th style="width:70px">#</th><th style="width:120px">Tool ID</th><th>Tool</th><th>Allowed Users</th></tr></thead><tbody>' + (rows || '<tr><td colspan="4" class="yd-empty">No tools available.</td></tr>') + '</tbody></table></div></div>' + modal;
    };

    
    const renderTransactions = () => `
        <section class="yd-welcome"><div><h1>NETWORK Activity</h1><p>Administrative activity and request status.</p></div></section>
        ${renderTransactionsTable(getTransactions())}
    `;

    const renderAccount = () => {
        const user = context.user || {};
        const settings = context.settings?.getSettings?.() || { tools: {} };
        return '<section class="yd-welcome"><div><h1>Settings</h1><p>Personal dashboard preferences and workspace details.</p></div><button class="yd-primary" data-action="save-settings"><i class="fa-solid fa-cloud-arrow-up"></i><span>Save Settings</span></button></section>' +
            '<div class="yd-panel-grid"><div class="yd-card"><div class="yd-card-title"><span class="yd-title-icon"><i class="fa-solid fa-sliders"></i></span><span>Personal Dashboard Preferences</span></div>' +
                '<div class="yd-field"><label for="yd-display-name">Display Name</label><input id="yd-display-name" class="yd-input" value="' + escapeHTML(formatName(settings.displayName || user.name || '')) + '"></div>' +
                '<div class="yd-field" style="margin-top:10px"><label for="yd-start-page">Default Start Section</label>' + renderDropdown('startPage', settings.startPage === 'tools' ? 'tools' : 'overview', [{ value: 'overview', label: 'Overview' }, { value: 'tools', label: 'Tools' }], { id: 'yd-start-page' }) + '</div>' +
            '</div><div class="yd-card"><div class="yd-card-title"><span class="yd-title-icon"><i class="fa-solid fa-database"></i></span><span>Repository & Account</span></div>' +
                '<div class="yd-info-row"><span>Full Name</span><strong>' + escapeHTML(formatName(user.name || '—')) + '</strong></div>' +
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
        if (!root) return;
        root.querySelectorAll('details[data-user-accordion]').forEach(item => {
            if (item.open) expandedUsers.add(item.dataset.user);
            else expandedUsers.delete(item.dataset.user);
        });
        root.querySelectorAll('details[data-tool-accordion]').forEach(item => {
            if (item.open) expandedTools.add(item.dataset.tool);
            else expandedTools.delete(item.dataset.tool);
        });
        root.innerHTML = renderShell(renderPage());
    };

    const setBusy = (value, message) => {
        busy = value;
        if (typeof message === 'string' && message) busyMessage = message;
        const overlay = document.getElementById('yd-global-loading');
        if (overlay) overlay.hidden = true;
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

    const persistTransaction = transaction => {
        localTransactions.set(transaction.requestId, transaction);
        persistPendingTransactions();
    };

    const removePendingTransaction = transaction => {
        if (!transaction?.requestId) return;
        localTransactions.delete(transaction.requestId);
        (transaction.targetToolIds || []).forEach(toolId => optimisticVisibility.delete(toolId));
        persistPendingTransactions();
    };

    const monitorTransaction = transaction => {
        const requestId = transaction?.requestId;
        if (!requestId || trackedTransactions.has(requestId)) return;
        trackedTransactions.add(requestId);
        const task = (async () => {
            const startedAt = Date.now();
            try {
                const engine = getRoleEngine();
                let result = null;
                while (Date.now() - startedAt < 1800000) {
                    result = await engine.waitForTransaction(requestId, {
                        timeout: 120000,
                        interval: 4000,
                        refresh: false
                    });
                    const status = String(result?.status || '').toUpperCase();
                    if (status !== 'TIMEOUT') break;
                }
                const status = String(result?.status || '').toUpperCase();
                if (status !== 'COMPLETED') throw new Error(result?.error || result?.message || 'The request could not be completed.');
                removePendingTransaction(transaction);
                await refresh();
                showNotice((transaction.summary || formatAction(transaction.action)) + ' completed successfully.');
            } catch (error) {
                removePendingTransaction(transaction);
                try { await refresh(); } catch {}
                showMessageDialog('Operation Failed', error?.message || 'The background operation failed. No changes were confirmed.');
            } finally {
                trackedTransactions.delete(requestId);
            }
        })();
        trackBackground(task);
    };

    const resumePendingTransactions = () => {
        const engine = getRoleEngine();
        const serverRecords = engine?.getTransactionHistory?.() || [];
        for (const item of serverRecords) {
            if (!isPendingTransaction(item) || !item.requestId) continue;
            const stored = localTransactions.get(item.requestId) || {};
            const merged = { ...stored, ...item };
            persistTransaction(merged);
        }
        for (const transaction of [...localTransactions.values()]) {
            if (isPendingTransaction(transaction)) monitorTransaction(transaction);
        }
    };

    const runNetworkOperation = async (message, operation, metadata = {}) => {
        let request;
        try {
            request = await operation();
            if (!request?.requestId) throw new Error('GitHub did not confirm the request.');
        } catch (error) {
            throw error;
        }
        const actor = context.user || {};
        const transaction = {
            ...metadata,
            requestId: request.requestId,
            sequence: request.sequence,
            requestType: 'DASHBOARD_USERS_SYNC',
            status: 'SENT',
            actorId: String(context.userId || actor.id || actor.userId || '').trim().toUpperCase(),
            actorName: formatName(actor.name || context.userId || ''),
            createdAt: request.createdAt || new Date().toISOString(),
            updatedAt: request.createdAt || new Date().toISOString()
        };
        if (!transaction.summary) transaction.summary = formatAction(transaction.action || message);
        persistTransaction(transaction);
        render();
        showNotice(message + ' queued. You can continue working while it processes.');
        monitorTransaction(transaction);
        return request;
    };

    const createVisibilityDraft = toolId => {
        const engine = getRoleEngine();
        const record = (engine?.getVisibility?.() || {})[toolId] || { visibility: 'PRIVATE', allowedUsers: [] };
        const users = engine?.getUsers?.() || [];
        const allUsers = record.visibility === 'PUBLIC';
        return {
            toolId,
            allUsers,
            allowedUsers: new Set(allUsers ? users.map(user => String(user.id || '').trim().toUpperCase()) : (record.allowedUsers || []).map(id => String(id).trim().toUpperCase()))
        };
    };

    const openConfirmDialog = (title, message, confirmLabel, onConfirm) => {
        const overlay = document.createElement('div');
        overlay.className = 'yd-modal-backdrop';
        overlay.innerHTML = '<section class="yd-modal yd-confirm-modal" role="dialog" aria-modal="true"><h3>' + escapeHTML(title) + '</h3><p>' + escapeHTML(message) + '</p><div class="yd-modal-actions"><button type="button" class="yd-secondary" data-confirm-cancel>Cancel</button><button type="button" class="yd-danger" data-confirm-accept>' + escapeHTML(confirmLabel) + '</button></div></section>';
        document.getElementById(CONFIG.ID).appendChild(overlay);
        const close = () => overlay.remove();
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-confirm-cancel]')) close();
        });
        overlay.querySelector('[data-confirm-accept]').addEventListener('click', async event => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = 'Submitting...';
            try {
                await onConfirm();
                close();
            } catch (error) {
                button.disabled = false;
                button.textContent = confirmLabel;
                showNotice(error?.message || 'The requested action failed.', 'error');
            }
        });
    };

    const openUserModal = user => {
        const editing = Boolean(user);
        const overlay = document.createElement('div');
        overlay.className = 'yd-modal-backdrop';
        const roleDropdown = context.userRole === 'SUPER_ADMIN'
            ? '<div class="yd-field"><label>Role</label>' + renderDropdown('role', user?.role || 'USER', [{ value: 'USER', label: 'USER' }, { value: 'ADMIN', label: 'ADMIN' }, { value: 'SUPER_ADMIN', label: 'SUPER_ADMIN' }]) + '</div>'
            : '';
        const statusDropdown = '<div class="yd-field"><label>Status</label>' + renderDropdown('status', user?.status || 'Active', [{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }]) + '</div>';
        overlay.innerHTML = '<form class="yd-modal" id="yd-user-form">' +
            '<h3>' + (editing ? 'Edit User' : 'Add User') + '</h3>' +
            '<div class="yd-form-grid">' +
                '<div class="yd-field"><label>Full Name</label><input name="name" required value="' + escapeHTML(formatName(user?.name || '')) + '" placeholder="Employee full name"></div>' +
                roleDropdown + statusDropdown +
            '</div><div class="yd-modal-actions"><button type="button" class="yd-secondary" data-modal-close>Cancel</button><button type="submit" class="yd-primary">' + (editing ? 'Save Changes' : 'Create User') + '</button></div></form>';
        document.getElementById(CONFIG.ID).appendChild(overlay);
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-modal-close]')) overlay.remove();
        });
        overlay.querySelector('form').addEventListener('submit', async event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const payload = {
                name: String(form.get('name') || '').trim(),
                status: form.get('status') || 'Active',
                ...(context.userRole === 'SUPER_ADMIN' ? { role: form.get('role') || 'USER' } : {})
            };
            const normalizedName = payload.name.replace(/\s+/g, ' ').toLocaleLowerCase();
            const duplicatePending = !editing && getPendingTransactions().find(item =>
                String(item.action || '').toUpperCase() === 'ADD_USER' &&
                String(item.targetName || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase() === normalizedName
            );
            if (duplicatePending) {
                showMessageDialog('User Already Queued', formatName(payload.name) + ' is already being created. Wait for that request to finish before submitting another one.');
                return;
            }
            const engine = getRoleEngine();
            const metadata = {
                action: editing ? 'UPDATE_USER' : 'ADD_USER',
                targetId: editing ? user.id : '',
                targetName: payload.name || formatName(user?.name || ''),
                targetRole: payload.role || user?.role || 'USER',
                summary: (editing ? 'UPDATE USER · ' : 'ADD USER · ') + formatName(payload.name || user?.name || '')
            };
            const submitButton = event.currentTarget.querySelector('[type="submit"]');
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Submitting</span>';
            try {
                await runNetworkOperation(editing ? 'Updating user' : 'Creating user', () =>
                    editing ? engine.editUser(user.id, payload) : engine.addUser(payload), metadata
                );
                overlay.remove();
            } catch (error) {
                submitButton.disabled = false;
                submitButton.textContent = editing ? 'Save Changes' : 'Create User';
                showMessageDialog('Unable to submit user request', error?.message || 'The request could not be submitted.');
            }
        });
    };

    
    const showMessageDialog = (title, message, type = 'error') => {
        const overlay = document.createElement('div');
        overlay.className = 'yd-modal-backdrop';
        const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
        overlay.innerHTML = '<section class="yd-modal yd-confirm-modal yd-message-modal" role="dialog" aria-modal="true"><div class="yd-message-icon ' + escapeHTML(type) + '"><i class="fa-solid ' + icon + '"></i></div><h3>' + escapeHTML(title) + '</h3><p>' + escapeHTML(message) + '</p><div class="yd-modal-actions"><button type="button" class="yd-primary" data-message-close>OK</button></div></section>';
        document.getElementById(CONFIG.ID)?.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-message-close]')) close();
        });
    };

    const runAction = async (action, button) => {
        if (busy) return;
        try {
            if (action === 'refresh-connection') {
                showNotice('Refreshing connection in the background...');
                trackBackground(refresh().then(() => showNotice('Connection refreshed successfully.')).catch(error => showNotice(error?.message || 'Connection refresh failed.', 'error')));
            } else if (action === 'save-settings') {
                const updated = context.settings.getSettings();
                updated.displayName = document.getElementById(CONFIG.ID).querySelector('#yd-display-name')?.value.trim() || context.user?.name || '';
                updated.startPage = document.getElementById(CONFIG.ID).querySelector('#yd-start-page')?.value || 'overview';
                button.disabled = true;
                showNotice('Saving personal dashboard settings in the background...');
                trackBackground((async () => {
                    try {
                        await context.settings.save(updated);
                        showNotice('Personal settings saved.');
                        render();
                    } catch (error) {
                        button.disabled = false;
                        showNotice(error?.message || 'Unable to save personal settings.', 'error');
                    }
                })());
            } else if (action === 'toggle-my-tool') {
                const toolId = button.dataset.tool;
                const nextEnabled = button.dataset.enabled !== 'true';
                button.disabled = true;
                showNotice((nextEnabled ? 'Enabling ' : 'Disabling ') + toolId + ' in the background...');
                trackBackground((async () => {
                    try {
                        if (nextEnabled) await context.settings.enableTool(toolId);
                        else await context.settings.disableTool(toolId);
                        await context.tools.syncTool(toolId);
                        showNotice('Tool setting saved.');
                        render();
                    } catch (error) {
                        render();
                        showNotice(error?.message || 'Unable to update tool setting.', 'error');
                    }
                })());
            } else if (action === 'add-user') {
                openUserModal();
            } else if (action === 'edit-user') {
                openUserModal(getUsers().find(user => user.id === button.dataset.id));
            } else if (action === 'delete-user') {
                const user = getUsers().find(item => String(item.id).toUpperCase() === String(button.dataset.id).toUpperCase());
                openConfirmDialog('Delete User', 'Delete ' + formatName(user?.name || button.dataset.id) + '? This request will be processed through NETWORK.', 'Delete User', () =>
                    runNetworkOperation('Deleting user', () => getRoleEngine().deleteUser(button.dataset.id))
                );
            } else if (action === 'toggle-permission') {
                const field = button.dataset.field || 'granted';
                const current = button.dataset.value !== undefined ? button.dataset.value === 'true' : button.dataset.granted === 'true';
                const nextValue = !current;
                button.dataset.value = String(nextValue);
                button.classList.toggle('on', nextValue);
                button.setAttribute('aria-checked', String(nextValue));
                button.disabled = true;
                await runNetworkOperation(field === 'forcedState' ? 'Updating forced state' : 'Updating tool access', () =>
                    getRoleEngine().setToolPermission(button.dataset.user, button.dataset.tool, { [field]: nextValue }),
                    () => render(),
                    () => render()
                );
            } else if (action === 'open-visibility-users') {
                openVisibilityToolId = button.dataset.tool;
                visibilityDraft = createVisibilityDraft(openVisibilityToolId);
                render();
            } else if (action === 'close-visibility-users') {
                openVisibilityToolId = null;
                visibilityDraft = null;
                render();
            } else if (action === 'toggle-visibility-user') {
                const toolId = button.dataset.tool;
                const userId = button.dataset.user;
                if (!visibilityDraft || visibilityDraft.toolId !== toolId) visibilityDraft = createVisibilityDraft(toolId);
                const selected = visibilityDraft.allUsers || visibilityDraft.allowedUsers.has(userId);
                if (visibilityDraft.allUsers) visibilityDraft.allowedUsers = new Set((getRoleEngine().getUsers() || []).map(user => String(user.id || '').trim().toUpperCase()));
                visibilityDraft.allUsers = false;
                if (selected) visibilityDraft.allowedUsers.delete(userId);
                else visibilityDraft.allowedUsers.add(userId);
                render();
            } else if (action === 'save-visibility-users') {
                const draft = visibilityDraft;
                if (!draft || draft.toolId !== openVisibilityToolId) throw new Error('No visibility changes are available to save.');
                const toolId = draft.toolId;
                const record = draft.allUsers
                    ? { visibility: 'PUBLIC', allowedUsers: [] }
                    : { visibility: 'SELECTED_USERS', allowedUsers: [...draft.allowedUsers] };
                optimisticVisibility.set(toolId, record);
                openVisibilityToolId = null;
                visibilityDraft = null;
                render();
                await runNetworkOperation('Saving allowed users', () => getRoleEngine().setToolVisibility(toolId, record), () => {
                    optimisticVisibility.delete(toolId);
                }, () => {
                    optimisticVisibility.delete(toolId);
                    render();
                });
            } else if (action === 'change-visibility') {
                const toolId = button.dataset.visibility;
                const visibility = button.value;
                if (visibility === 'SELECTED_USERS') {
                    openVisibilityToolId = toolId;
                    visibilityDraft = createVisibilityDraft(toolId);
                    visibilityDraft.allUsers = false;
                    render();
                } else {
                    const record = { visibility: 'PUBLIC', allowedUsers: [] };
                    optimisticVisibility.set(toolId, record);
                    render();
                    await runNetworkOperation('Updating allowed users', () => getRoleEngine().setToolVisibility(toolId, record), () => {
                        optimisticVisibility.delete(toolId);
                    }, () => {
                        optimisticVisibility.delete(toolId);
                        render();
                    });
                }
            }
        } catch (error) {
            showNotice(error?.message || 'The requested action failed.', 'error');
            if (button && action === 'toggle-permission') {
                button.disabled = false;
                button.classList.toggle('on', button.dataset.value === 'true');
            }
        } finally {
            setBusy(false);
        }
    };

    const bindEvents = root => {
        root.addEventListener('toggle', event => {
            const userItem = event.target.closest?.('details[data-user-accordion]');
            const toolItem = event.target.closest?.('details[data-tool-accordion]');
            if (userItem) {
                if (userItem.open) {
                    root.querySelectorAll('details[data-user-accordion]').forEach(other => {
                        if (other !== userItem && other.open) other.open = false;
                    });
                    expandedUsers.clear();
                    expandedUsers.add(userItem.dataset.user);
                } else expandedUsers.delete(userItem.dataset.user);
            }
            if (toolItem) {
                if (toolItem.open) {
                    root.querySelectorAll('details[data-tool-accordion]').forEach(other => {
                        if (other !== toolItem && other.open) other.open = false;
                    });
                    expandedTools.clear();
                    expandedTools.add(toolItem.dataset.tool);
                } else expandedTools.delete(toolItem.dataset.tool);
            }
        }, true);
        root.addEventListener('click', event => {
            if (event.target.id === 'yd-overlay' || event.target.id === 'yd-visibility-users-backdrop') {
                if (event.target.id === 'yd-visibility-users-backdrop') { openVisibilityToolId = null; visibilityDraft = null; }
                else { isOpen = false; profileOpen = false; }
                render();
                return;
            }
            const actionButton = event.target.closest('[data-action]');
            if (actionButton?.dataset.action === 'toggle-my-tool') {
                event.preventDefault();
                event.stopPropagation();
                runAction(actionButton.dataset.action, actionButton);
                return;
            }
            if (actionButton?.dataset.action === 'toggle-dashboard') { isOpen = !isOpen; render(); return; }
            if (actionButton?.dataset.action === 'close-dashboard') { isOpen = false; profileOpen = false; render(); return; }
            if (actionButton?.dataset.action === 'profile-toggle') { profileOpen = !profileOpen; render(); return; }
            const nav = event.target.closest('[data-page]');
            if (nav) {
                activePage = nav.dataset.page;
                notice = null;
                profileOpen = false;
                if (activePage !== 'visibility') { openVisibilityToolId = null; visibilityDraft = null; }
                render();
                return;
            }
            if (actionButton?.dataset.action === 'refresh-connection') { runAction('refresh-connection'); return; }
            if (actionButton) runAction(actionButton.dataset.action, actionButton);
        });
        root.addEventListener('change', event => {
            if (event.target.matches?.('[data-visibility]')) runAction('change-visibility', event.target);
        });
        root.addEventListener('input', event => {
            if (event.target.id === 'yd-user-search' || event.target.id === 'yd-tool-search') {
                const query = event.target.value.toLowerCase();
                root.querySelectorAll('tbody tr, .yd-tool-accordion-item').forEach(row => {
                    row.hidden = !row.textContent.toLowerCase().includes(query);
                });
            }
        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            if (openVisibilityToolId) {
                openVisibilityToolId = null;
                visibilityDraft = null;
                render();
                return;
            }
            if (isOpen) {
                isOpen = false;
                profileOpen = false;
                render();
            }
        });
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
        expandedUsers.clear();
        expandedTools.clear();
        openVisibilityToolId = null;
        visibilityDraft = null;
        optimisticVisibility.clear();
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
