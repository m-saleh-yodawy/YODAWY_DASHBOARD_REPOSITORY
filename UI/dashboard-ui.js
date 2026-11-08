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

    const ANNOUNCEMENT_CYCLES = Object.freeze([
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ]);

    let context = null;
    let activePage = 'tools';
    let refreshTimer = null;
    let notice = null;
    let isOpen = false;
    let profileOpen = false;
    const expandedUsers = new Set();
    const expandedTools = new Set();
    let visibilityDraft = null;
    let openVisibilityToolId = null;
    const optimisticVisibility = new Map();
    const pendingVisibilitySubmissions = new Set();
    const backgroundTransactions = new Set();
    const localTransactions = new Map();
    const pendingLocalTools = new Map();
    const trackedTransactions = new Set();
    let networkPage = 1;
    const NETWORK_PAGE_SIZE = 10;
    let dropdownMenuClickHandler = null;
    let dropdownOutsideClickHandler = null;
    let dropdownKeydownHandler = null;
    let dropdownScrollHandler = null;
    let dropdownResizeHandler = null;

    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);

    const formatDate = value => {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
    };

    const formatAnnouncementDate = value => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return { date: '—', time: '—' };
        return {
            date: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
            time: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
        };
    };

    const getAnnouncementCycle = post => {
        const selected = String(post?.cycle || '').trim().toLowerCase();
        const match = ANNOUNCEMENT_CYCLES.find(cycle => cycle.toLowerCase() === selected);
        if (match) return match;
        const date = new Date(post?.createdAt || Date.now());
        const month = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date);
        return ANNOUNCEMENT_CYCLES.find(cycle => cycle.toLowerCase() === month.toLowerCase()) || ANNOUNCEMENT_CYCLES[0];
    };

    const initials = value => String(value || 'Y').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();

    const formatName = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase().replace(/(^|[\s'’-])\p{L}/gu, char => char.toLocaleUpperCase());

    const formatRole = value => String(value || 'USER').trim().toUpperCase().replace(/SUPER_ADMIN/g, 'SUPER ADMIN').replace(/_/g, ' ');

    const getRoleEngine = () => context.userRole === 'SUPER_ADMIN'
        ? context.superAdminEngine || context.superAdmin || null
        : context.userRole === 'ADMIN'
            ? context.adminEngine || context.admin || null
            : context.userEngine || null;

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

    const isPendingTransaction = transaction => !['COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED'].includes(String(transaction?.status || '').toUpperCase());

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
    ) || (pendingVisibilitySubmissions.has(String(toolId || '').trim()) ? { action: 'SUBMITTING' } : null);

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
    const setButtonLoading = (button, label = 'Loading') => {
        if (!button) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = '<span class="yd-inline-loading"><span class="yd-control-spinner" aria-hidden="true"></span><span>' + escapeHTML(label) + '</span></span>';
    };
    const setControlLoading = control => {
        if (!control) return;
        control.disabled = true;
        control.setAttribute('aria-busy', 'true');
        const chevron = control.querySelector('.ui-select-chevron');
        if (chevron) {
            const spinner = document.createElement('span');
            spinner.className = 'yd-control-spinner';
            spinner.setAttribute('aria-hidden', 'true');
            chevron.replaceWith(spinner);
        }
    };

    const renderDropdown = (name, value, options, attributes = {}, disabled = false) => {
        const multiple = attributes['data-multiple'] === 'true';
        const values = multiple ? (Array.isArray(value) ? value : value == null ? [] : [value]).map(String) : [String(value ?? '')];
        const selected = options.filter(option => values.includes(String(option.value)));
        const selectedOption = selected[0] || options[0] || { value: '', label: '' };
        const placeholder = String(attributes['data-placeholder'] || 'Select...');
        const groupLabel = String(attributes['data-label'] || '');
        const extraClass = attributes.class ? ' ' + String(attributes.class).trim() : '';
        const extraMenuClass = attributes['data-menu-class'] ? ' ' + String(attributes['data-menu-class']).trim() : '';
        const label = selected.length ? selected.map(option => option.label).join(', ') : placeholder;
        const storedValue = multiple ? JSON.stringify(selected.map(option => String(option.value))) : String(selectedOption.value);
        const omittedKeys = new Set(['id', 'class', 'data-menu-class', 'data-multiple', 'data-placeholder', 'data-label']);
        const attrs = Object.entries(attributes).filter(([key]) => !omittedKeys.has(key)).map(([key, item]) => ' ' + key + '="' + escapeHTML(item) + '"').join('');
        const nameAttr = name ? ' name="' + escapeHTML(name) + '"' : '';
        const idAttr = attributes.id ? ' id="' + escapeHTML(attributes.id) + '"' : '';
        const header = groupLabel ? '<div class="ui-select-label">' + escapeHTML(groupLabel) + '</div>' : '';
        const items = options.map(option => {
            const optionSelected = values.includes(String(option.value));
            return '<button type="button" class="ui-select-option ui-select-item yd-dropdown-item' + (optionSelected ? ' selected' : '') + '" role="option" aria-selected="' + String(optionSelected) + '" data-selected="' + String(optionSelected) + '" data-action="select-dropdown" data-value="' + escapeHTML(option.value) + '"><span>' + escapeHTML(option.label) + '</span></button>';
        }).join('');
        return '<div class="ui-select yd-dropdown yd-select-dropdown' + extraClass + (disabled ? ' disabled' : '') + '" data-dropdown data-multiple="' + String(multiple) + '" data-open="false" data-placeholder="' + escapeHTML(placeholder) + '" data-value="' + escapeHTML(storedValue) + '"' + attrs + '>' +
            '<input type="hidden"' + nameAttr + idAttr + ' value="' + escapeHTML(multiple ? storedValue : selectedOption.value) + '">' +
            '<button type="button" class="ui-select-trigger yd-dropdown-trigger" data-action="toggle-dropdown" aria-haspopup="listbox" aria-expanded="false"' + (disabled ? ' disabled' : '') + '><span class="ui-select-value yd-dropdown-value"' + (selected.length ? ' data-placeholder="false"' : ' data-placeholder="true"') + '>' + escapeHTML(label) + '</span><svg class="ui-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>' +
            '<div class="ui-select-menu ui-select-content yd-dropdown-menu' + extraMenuClass + '" role="listbox" aria-multiselectable="' + String(multiple) + '" hidden><div class="ui-select-group">' + header + items + '</div></div></div>';
    };

    const renderAnnouncementCycleDropdown = (cycle, id) => renderDropdown(
        '',
        cycle,
        ANNOUNCEMENT_CYCLES.map(item => ({ value: item, label: item })),
        {
            class: 'yd-announcement-cycle-select',
            'data-menu-class': 'yd-announcement-cycle-menu',
            'data-placeholder': 'Cycle',
            'data-label': 'Cycle',
            'data-announcement-cycle': 'true',
            'data-id': id,
            'aria-label': 'Announcement cycle'
        }
    );

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

    const ensureExternalStylesheet = (id, href, fallbackHref) => {
        let link = document.getElementById(id);
        if (!link) {
            link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }
        if (fallbackHref && link.dataset.fallbackBound !== 'true') {
            link.dataset.fallbackBound = 'true';
            link.addEventListener('error', () => {
                if (link.dataset.fallbackUsed === 'true') return;
                link.dataset.fallbackUsed = 'true';
                link.href = fallbackHref;
            });
        }
        if (!link.sheet) link.href = href;
    };

    const injectStyles = () => {
        ensureExternalStylesheet('yd-fontawesome-css', 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css', 'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/css/all.min.css');
        document.getElementById('yd-nunito-font')?.remove();
        ensureExternalStylesheet('yd-poppins-font', 'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800;900&display=swap');
        const style = document.getElementById(CONFIG.STYLE_ID) || document.createElement('style');
        style.id = CONFIG.STYLE_ID;
        style.textContent = String.raw`
#yd-dashboard-root {
    --brand: #875a7b;
    --brand-dark: #68465f;
    --brand-soft: #f4eff2;
    --brand-ring: rgba(135, 90, 123, 0.28);
    --ink: #18181b;
    --text: #514a56;
    --muted: #71717a;
    --subtle: #9b949f;
    --border: #dcd5e1;
    --border-soft: #eae4ec;
    --canvas: #f7f6f8;
    --success: #247a53;
    --success-bg: #eef8f2;
    --success-border: #d7eadf;
    --info: #35678f;
    --info-bg: #edf4fa;
    --info-border: #d9e7f2;
    --warning: #926b22;
    --warning-bg: #fbf6e9;
    --warning-border: #efe2bd;
    --danger: #dc2626;
    --danger-bg: #fee2e2;
    --danger-border: #f0d7d9;
    color: var(--ink);
    font: 400 12px/1.45 'Poppins', system-ui, -apple-system, sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
}
#yd-dashboard-root *, #yd-dashboard-root *::before, #yd-dashboard-root *::after {
    box-sizing: border-box;
    font-family: 'Poppins', system-ui, -apple-system, sans-serif !important;
}
#yd-dashboard-root .fa-solid, #yd-dashboard-root .fas,
#yd-dashboard-root .fa-solid::before, #yd-dashboard-root .fas::before {
    font-family: "Font Awesome 6 Free" !important;
    font-weight: 900 !important;
    font-style: normal !important;
    font-variant: normal !important;
}
#yd-dashboard-root .fa-regular, #yd-dashboard-root .far,
#yd-dashboard-root .fa-regular::before, #yd-dashboard-root .far::before {
    font-family: "Font Awesome 6 Free" !important;
    font-weight: 400 !important;
    font-style: normal !important;
    font-variant: normal !important;
}
#yd-dashboard-root .fa-brands, #yd-dashboard-root .fab,
#yd-dashboard-root .fa-brands::before, #yd-dashboard-root .fab::before {
    font-family: "Font Awesome 6 Brands" !important;
    font-weight: 400 !important;
    font-style: normal !important;
    font-variant: normal !important;
}
#yd-dashboard-root i.fa-solid::before, #yd-dashboard-root i.fas::before,
#yd-dashboard-root i.fa-regular::before, #yd-dashboard-root i.far::before,
#yd-dashboard-root i.fa-brands::before, #yd-dashboard-root i.fab::before {
    display: inline-block !important;
    line-height: 1 !important;
}
#yd-dashboard-root strong, #yd-dashboard-root b { font-weight: 600 !important; }
#yd-dashboard-root button, #yd-dashboard-root input, #yd-dashboard-root select, #yd-dashboard-root textarea { font: inherit; }
#yd-dashboard-root button:disabled { opacity: .48; cursor: not-allowed; box-shadow: none; }

#yd-dashboard-root #yd-launcher {
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 2147483000;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    padding: 0 18px;
    border: 1px solid var(--brand);
    border-radius: 999px;
    background: var(--brand);
    color: #fff;
    font-size: 12px;
    font-weight: 700 !important;
    letter-spacing: .02em;
    cursor: pointer;
    box-shadow: 0 8px 24px #39223924;
    transition: all .16s;
}
#yd-dashboard-root #yd-launcher:hover {
    background: var(--brand-dark);
    border-color: var(--brand-dark);
    box-shadow: 0 10px 26px #39223930;
    transform: translateY(-1px);
}

#yd-dashboard-root #yd-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483001;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #17131c85;
    backdrop-filter: blur(4px);
}
#yd-dashboard-root #yd-overlay.open { display: flex; }

#yd-dashboard-root #yd-modal {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(1360px, 100%);
    height: min(860px, calc(100vh - 48px));
    max-height: calc(100vh - 48px);
    overflow: hidden;
    border: 1px solid #e5dfe8;
    border-radius: 18px;
    background: var(--canvas);
    color: var(--ink);
    box-shadow: 0 28px 80px #17131c40;
}

#yd-dashboard-root #yd-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    flex: 0 0 60px;
    min-height: 60px;
    padding: 0 20px;
    background: #fff;
    border-bottom: 1px solid #d9d2df;
}
#yd-dashboard-root .yd-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
#yd-dashboard-root .yd-brand-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    border-radius: 9px;
    background: var(--brand);
    color: #fff;
    font-size: 15px;
    font-weight: 800 !important;
}
#yd-dashboard-root .yd-brand-title {
    overflow: hidden;
    color: var(--ink);
    font-size: 13px;
    font-weight: 600 !important;
    letter-spacing: .035em;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#yd-dashboard-root .yd-header-actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; }
#yd-dashboard-root .yd-header-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid var(--success-border);
    border-radius: 999px;
    background: var(--success-bg);
    color: var(--success);
    font-size: 11px;
    font-weight: 600 !important;
    white-space: nowrap;
}
#yd-dashboard-root .yd-header-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #2e9464;
    box-shadow: 0 0 0 3px #2e94641a;
}

#yd-dashboard-root .yd-profile-wrap { position: relative; display: inline-flex; align-items: center; }
#yd-dashboard-root .yd-gb-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 1px;
    border: 0;
    border-radius: 50%;
    background: conic-gradient(var(--brand), var(--brand-dark), #b48aa8, var(--brand));
    cursor: pointer;
}
#yd-dashboard-root .yd-gb-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    border: 1px solid #fff;
    border-radius: 50%;
    background: var(--brand);
    color: #fff;
    font-size: 12px;
    font-weight: 700 !important;
}
#yd-dashboard-root .yd-gb-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border: 1px solid #fff;
    border-radius: 50%;
    background: var(--success);
    color: #fff;
    font-size: 8px;
}
#yd-dashboard-root .yd-profile-menu {
    position: absolute;
    top: calc(100% + 12px);
    right: 0;
    z-index: 2147483005;
    width: 304px;
    padding: 6px;
    border: 1px solid #ded8e3;
    border-radius: 10px;
    background: #fff;
    color: var(--ink);
    box-shadow: 0 12px 30px #21132b20, 0 0 0 1px #29242e08;
    animation: yd-dropdown-enter .13s cubic-bezier(.2, .8, .2, 1) both;
}
#yd-dashboard-root .yd-profile-menu[hidden] { display: none !important; }
#yd-dashboard-root .yd-gb-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 0 5px;
    padding: 12px;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 7px;
    background: #faf9fb;
    text-align: center;
}
#yd-dashboard-root .yd-gb-ring-lg {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 54px;
    height: 54px;
    margin-bottom: 10px;
    padding: 1px;
    border-radius: 50%;
    background: conic-gradient(var(--brand), var(--brand-dark), #b48aa8, var(--brand));
}
#yd-dashboard-root .yd-gb-avatar-lg {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    border: 1px solid #fff;
    border-radius: 50%;
    background: var(--brand);
    color: #fff;
    font-size: 18px;
    font-weight: 700 !important;
}
#yd-dashboard-root .yd-gb-name { color: var(--ink); font-size: 14px; font-weight: 700 !important; }
#yd-dashboard-root .yd-gb-meta { margin-top: 3px; color: var(--muted); font-size: 11px; }
#yd-dashboard-root .yd-gb-pills { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 10px; flex-wrap: wrap; }
#yd-dashboard-root .yd-dropdown-action {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-height: 36px;
    margin-top: 2px;
    padding: 5px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
}
#yd-dashboard-root .yd-dropdown-action:hover { background: var(--brand-soft); color: var(--brand-dark); }
#yd-dashboard-root .yd-action-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 25px;
    height: 25px;
    flex: 0 0 25px;
    border: 1px solid #e3d9e5;
    border-radius: 6px;
    background: #f5eff6;
    color: var(--brand);
    font-size: 11px;
}
#yd-dashboard-root .yd-close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
    color: var(--muted);
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    transition: all .15s;
}
#yd-dashboard-root .yd-close-btn:hover { border-color: var(--danger-border); background: var(--danger-bg); color: var(--danger); }

#yd-dashboard-root #yd-body { display: flex; flex: 1; min-height: 0; }
#yd-dashboard-root #yd-sidebar {
    display: flex;
    flex: 0 0 224px;
    flex-direction: column;
    gap: 4px;
    width: 224px;
    overflow: auto;
    padding: 15px 12px;
    border-right: 1px solid var(--border);
    background: #fff;
}
#yd-dashboard-root .yd-nav-label {
    padding: 6px 12px 10px;
    color: var(--subtle);
    font-size: 10px;
    font-weight: 700 !important;
    letter-spacing: .11em;
    text-transform: uppercase;
}
#yd-dashboard-root .yd-nav {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 36px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 12px;
    font-weight: 500 !important;
    transition: all .14s;
}
#yd-dashboard-root .yd-nav {
    outline: none !important;
    box-shadow: none !important;
    -webkit-tap-highlight-color: transparent;
}
#yd-dashboard-root .yd-nav:hover,
#yd-dashboard-root .yd-nav:focus,
#yd-dashboard-root .yd-nav:focus-visible {
    outline: none !important;
    box-shadow: none !important;
}
#yd-dashboard-root .yd-nav:not(.active):hover,
#yd-dashboard-root .yd-nav:not(.active):focus-visible {
    border-color: #e2d5e5;
    background: #e9dfea;
    color: #68465f;
}
#yd-dashboard-root .yd-nav.active {
    border-color: #875a7b;
    background: #875a7b;
    color: #fff;
    font-weight: 600 !important;
}

#yd-dashboard-root .yd-nav-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 25px;
    height: 25px;
    flex: 0 0 25px;
    border: 1px solid #e5dce7;
    border-radius: 8px;
    background: #f7f2f7;
    color: var(--brand);
    font-size: 12px;
}
#yd-dashboard-root .yd-nav.active .yd-nav-icon { border-color: #fff; background: #fff; color: #875a7b; }
#yd-dashboard-root .yd-sidebar-bottom {
    margin-top: auto;
    padding: 16px 12px 4px;
    border-top: 1px solid var(--border-soft);
    color: var(--subtle);
    font-size: 10px;
    line-height: 1.75;
}

#yd-dashboard-root #yd-main {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 22px 26px;
    background: var(--canvas);
    scrollbar-color: #d7cfd9 transparent;
    scrollbar-width: thin;
}
#yd-dashboard-root .yd-network-page {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 100%;
    min-height: 100%;
}
#yd-dashboard-root .yd-network-page > .yd-welcome {
    flex: 0 0 auto;
}
#yd-dashboard-root .yd-network-page .yd-network-table {
    flex: 0 0 auto;
    margin-bottom: 0;
}
#yd-dashboard-root .yd-network-page .yd-network-pagination {
    flex: 0 0 auto;
    margin-top: auto;
}
#yd-dashboard-root .yd-welcome {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin: 0 0 17px;
}
#yd-dashboard-root .yd-welcome h1 {
    margin: 0;
    color: var(--ink);
    font-size: 19px;
    font-weight: 600 !important;
    letter-spacing: -.02em;
    line-height: 1.25;
}
#yd-dashboard-root .yd-welcome p { margin: 4px 0 0; color: var(--muted); font-size: 11.5px; line-height: 1.5; }

#yd-dashboard-root .yd-primary, #yd-dashboard-root .yd-secondary, #yd-dashboard-root .yd-danger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 32px;
    padding: 0 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 11.5px;
    font-weight: 500 !important;
    white-space: nowrap;
    transition: all .15s;
}
#yd-dashboard-root .yd-primary {
    border: 1px solid var(--brand);
    background: var(--brand);
    color: #fff;
    box-shadow: 0 2px 5px #875a7b1a;
}
#yd-dashboard-root .yd-primary:hover {
    border-color: var(--brand-dark);
    background: var(--brand-dark);
    box-shadow: 0 3px 8px #68465f24;
}
#yd-dashboard-root .yd-secondary { border: 1px solid #e2dbe5; background: #fff; color: var(--brand-dark); }
#yd-dashboard-root .yd-secondary:hover { border-color: #d8c7d7; background: var(--brand-soft); }
#yd-dashboard-root .yd-danger { border: 1px solid var(--danger-border); background: var(--danger-bg); color: var(--danger); }
#yd-dashboard-root .yd-danger:hover { border-color: #e7bec2; background: #f9e7e8; }

#yd-dashboard-root .yd-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 11px; margin-bottom: 14px; }
#yd-dashboard-root .yd-card {
    min-width: 0;
    margin-bottom: 12px;
    padding: 14px;
    border: 1px solid #ded7e3;
    border-radius: 11px;
    background: #fff;
    box-shadow: 0 2px 5px #29242e08;
}
#yd-dashboard-root .yd-kpi-card {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: 72px;
    padding: 11px 13px;
    border: 1px solid #ded7e3;
    border-radius: 11px;
    background: #fff;
    box-shadow: 0 2px 8px #29242e07;
}
#yd-dashboard-root .yd-kpi-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    border: 1px solid #e1d8e5;
    border-radius: 9px;
    background: var(--brand-soft);
    color: var(--brand);
    font-size: 14px;
}
#yd-dashboard-root .yd-kpi-icon.blue { background: var(--info-bg); color: var(--info); }
#yd-dashboard-root .yd-kpi-icon.green { background: var(--success-bg); color: var(--success); }
#yd-dashboard-root .yd-kpi-icon.purple { background: var(--brand-soft); color: var(--brand); }
#yd-dashboard-root .yd-kpi-icon.amber { background: var(--warning-bg); color: var(--warning); }
#yd-dashboard-root .yd-kpi-info { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
#yd-dashboard-root .yd-kpi-label { overflow: hidden; color: var(--muted); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
#yd-dashboard-root .yd-kpi-value { margin-top: 3px; color: var(--ink); font-size: 18px; font-weight: 700 !important; letter-spacing: -.025em; line-height: 1.25; }

#yd-dashboard-root .yd-info-grid, #yd-dashboard-root .yd-panel-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
#yd-dashboard-root .yd-card-title {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 0 0 6px;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--border-soft);
    color: var(--ink);
    font-size: 12px;
    font-weight: 700 !important;
}
#yd-dashboard-root .yd-title-icon {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    border: 1px solid #e1d7e4;
    border-radius: 8px;
    background: #f7f1f7;
    color: var(--brand);
    font-size: 11px;
}
#yd-dashboard-root .yd-clean-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 36px;
    border-bottom: 1px solid #f4f0f5;
    font-size: 11.5px;
}
#yd-dashboard-root .yd-clean-row:last-child { border-bottom: 0; }
#yd-dashboard-root .yd-clean-label { color: var(--muted); }
#yd-dashboard-root .yd-clean-val { color: var(--ink); font-weight: 600 !important; text-align: right; }

#yd-dashboard-root .yd-info-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 9px 0;
    border-bottom: 1px solid var(--border-soft);
    font-size: 11.5px;
}
#yd-dashboard-root .yd-info-row:last-child { border: 0; }
#yd-dashboard-root .yd-info-row span { color: var(--muted); }
#yd-dashboard-root .yd-info-row strong { max-width: 65%; overflow-wrap: anywhere; color: var(--ink); text-align: right; }

#yd-dashboard-root .yd-table-wrap, #yd-dashboard-root .yd-table-card {
    overflow: auto;
    margin-bottom: 12px;
    border: 1px solid #dcd5e1;
    border-radius: 11px;
    background: #fff;
    box-shadow: 0 2px 5px #29242e08;
}
#yd-dashboard-root .yd-table-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 45px;
    padding: 8px 13px;
    border-bottom: 1px solid #ded7e3;
    background: #fff;
    flex-wrap: wrap;
}
#yd-dashboard-root .yd-table-card-title { display: flex; align-items: center; gap: 8px; color: var(--ink); font-size: 12px; font-weight: 700 !important; }
#yd-dashboard-root .yd-table-responsive { width: 100%; overflow-x: auto; }
#yd-dashboard-root table { width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 12px; }
#yd-dashboard-root thead th {
    height: 38px;
    padding: 0 12px;
    border-bottom: 1px solid #d9d2df;
    background: #faf9fb;
    color: #716a76;
    font-size: 10px;
    font-weight: 700 !important;
    letter-spacing: .025em;
    text-align: left;
    white-space: nowrap;
}
#yd-dashboard-root tbody td, #yd-dashboard-root tbody th {
    height: 41px;
    padding: 6px 12px;
    border-top: 1px solid #e9e3eb;
    background: #fff;
    color: var(--text);
    font-size: 11.5px;
    vertical-align: middle;
    white-space: nowrap;
}
#yd-dashboard-root tbody tr:first-child td, #yd-dashboard-root tbody tr:first-child th { border-top: 0; }
#yd-dashboard-root tbody tr:nth-child(even) td, #yd-dashboard-root tbody tr:nth-child(even) th { background: #fcfbfd; }
#yd-dashboard-root tbody tr:hover td, #yd-dashboard-root tbody tr:hover th { background: #f7f2f8; }

#yd-dashboard-root .yd-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 21px;
    padding: 2px 8px;
    border: 1px solid #e6dce6;
    border-radius: 999px;
    background: var(--brand-soft);
    color: var(--brand-dark);
    font-size: 10px;
    font-weight: 500 !important;
    line-height: 1.2;
    white-space: nowrap;
}
#yd-dashboard-root .yd-pill.green { border-color: var(--success-border); background: var(--success-bg); color: var(--success); }
#yd-dashboard-root .yd-pill.red { border-color: var(--danger-border); background: var(--danger-bg); color: var(--danger); }
#yd-dashboard-root .yd-pill.blue { border-color: var(--info-border); background: var(--info-bg); color: var(--info); }
#yd-dashboard-root .yd-pill.yellow { border-color: var(--warning-border); background: var(--warning-bg); color: var(--warning); }

#yd-dashboard-root .yd-id-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 21px;
    padding: 2px 8px;
    border: 1px solid #e8dfe8;
    border-radius: 7px;
    background: #f7f2f6;
    color: var(--brand-dark);
    font-family: 'Poppins', system-ui, -apple-system, sans-serif !important;
    font-size: 10px;
    font-weight: 600 !important;
}

#yd-dashboard-root .yd-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 9px; flex-wrap: wrap; margin: 0 0 11px; }
#yd-dashboard-root .yd-search, #yd-dashboard-root .yd-field input, #yd-dashboard-root .yd-input {
    width: auto;
    min-width: 0;
    height: 36px;
    min-height: 36px;
    padding: 0 11px;
    border: 1px solid #d8d0dc;
    border-radius: 8px;
    outline: none;
    background: #fff;
    color: var(--ink);
    font-size: 12px;
    transition: border-color .15s, box-shadow .15s;
}
#yd-dashboard-root .yd-search { width: min(340px, 100%); }
#yd-dashboard-root .yd-search::placeholder, #yd-dashboard-root input::placeholder { color: #aaa3ad; }
#yd-dashboard-root .yd-search:focus, #yd-dashboard-root input:focus {
    outline: none !important;
    box-shadow: none !important;
}
#yd-dashboard-root .yd-empty { padding: 30px 18px !important; color: var(--muted) !important; font-size: 12px !important; text-align: center; }

#yd-dashboard-root .yd-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 9px; }
#yd-dashboard-root .yd-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
#yd-dashboard-root .yd-field label { color: var(--text); font-size: 11px; font-weight: 600 !important; }
#yd-dashboard-root .yd-field input { width: 100%; }

#yd-dashboard-root .yd-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483005;
    display: grid;
    place-items: center;
    padding: 22px;
    background: #17131c88;
    backdrop-filter: blur(3px);
    animation: yd-backdrop-enter .16s ease-out both;
}
#yd-dashboard-root .yd-modal {
    width: min(560px, 100%);
    padding: 22px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 24px 70px #17131c38;
    animation: yd-modal-enter .18s cubic-bezier(.2, .8, .2, 1) both;
}
#yd-dashboard-root .yd-modal h3 { margin: 0 0 14px; color: var(--ink); font-size: 16px; font-weight: 700 !important; letter-spacing: -.02em; }
#yd-dashboard-root .yd-modal-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--border-soft); }
#yd-dashboard-root .yd-confirm-modal { width: min(430px, 100%); padding: 22px; }
#yd-dashboard-root .yd-confirm-modal p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
#yd-dashboard-root .yd-message-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    margin: 0 0 12px;
    border: 1px solid var(--danger-border);
    border-radius: 12px;
    background: var(--danger-bg);
    color: var(--danger);
    font-size: 19px;
}
#yd-dashboard-root .yd-message-icon.success { border-color: var(--success-border); background: var(--success-bg); color: var(--success); }

#yd-dashboard-root .yd-toast {
    position: fixed;
    right: 26px;
    bottom: 26px;
    z-index: 2147483006;
    max-width: min(440px, calc(100vw - 32px));
    padding: 12px 16px;
    border: 1px solid #3b3442;
    border-radius: 10px;
    background: #302a35;
    color: #fff;
    box-shadow: 0 12px 32px #17131c24;
    font-size: 12px;
    font-weight: 600 !important;
    animation: yd-toast-enter .18s cubic-bezier(.2, .8, .2, 1) both;
}
#yd-dashboard-root .yd-toast.error { border-color: #a8414a; background: #a8414a; }

#yd-dashboard-root .yd-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 38px;
    height: 22px;
    padding: 3px;
    border: 0;
    border-radius: 999px;
    background: #d8d2da;
    cursor: pointer;
    vertical-align: middle;
    transition: background-color .24s ease, box-shadow .2s ease, opacity .2s ease;
}
#yd-dashboard-root .yd-switch.on { background: #2b865c; }
#yd-dashboard-root .yd-switch.yd-switch-forced.on { background: #c33d4b !important; }
#yd-dashboard-root .yd-switch-knob {
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px #0002;
    transition: transform .24s cubic-bezier(.2, .8, .2, 1);
}
#yd-dashboard-root .yd-switch.on .yd-switch-knob { transform: translateX(16px); }
#yd-dashboard-root .yd-switch:disabled { opacity: .5; cursor: not-allowed; }

#yd-dashboard-root .yd-icon-btn {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
    color: var(--brand);
    cursor: pointer;
    transition: all .15s;
}
#yd-dashboard-root .yd-icon-btn:hover { border-color: #d8c7d7; background: var(--brand-soft); color: var(--brand-dark); }
#yd-dashboard-root .yd-icon-btn.danger { border-color: var(--danger-border); background: #fff; color: var(--danger); }
#yd-dashboard-root .yd-icon-btn.danger:hover { border-color: #e7bec2; background: var(--danger-bg); color: #a83742; }
#yd-dashboard-root .yd-user-actions { display: flex; align-items: center; gap: 6px; }
#yd-dashboard-root .yd-repository-name {
    display: inline-block;
    max-width: 260px;
    overflow: hidden;
    color: var(--muted);
    font-family: 'Poppins', system-ui, -apple-system, sans-serif !important;
    font-size: 10.5px;
    text-overflow: ellipsis;
    vertical-align: middle;
}

#yd-dashboard-root .yd-accordion-list, #yd-dashboard-root .yd-tool-accordion-list {
    overflow: hidden;
    border: 1px solid #dcd5e1;
    border-radius: 11px;
    background: #fff;
    box-shadow: 0 2px 5px #29242e08;
}
#yd-dashboard-root .yd-accordion-item + .yd-accordion-item > summary,
#yd-dashboard-root .yd-tool-accordion-item + .yd-tool-accordion-item > summary {
    border-top: 1px solid #e2dbe5;
}
#yd-dashboard-root .yd-accordion-item > summary, #yd-dashboard-root .yd-tool-accordion-item > summary {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
    padding: 6px 12px;
    background: #ebe3ed !important;
    color: var(--ink);
    cursor: pointer;
    list-style: none;
    transition: background .15s;
}
#yd-dashboard-root .yd-accordion-item > summary { padding-right: 38px; }
#yd-dashboard-root .yd-accordion-item > summary::-webkit-details-marker,
#yd-dashboard-root .yd-tool-accordion-item > summary::-webkit-details-marker { display: none; }
#yd-dashboard-root .yd-accordion-item > summary:hover,
#yd-dashboard-root .yd-tool-accordion-item > summary:hover { background: #ebe3ed !important; }
#yd-dashboard-root .yd-accordion-item[open] > summary,
#yd-dashboard-root .yd-tool-accordion-item[open] > summary { background: #ebe3ed !important; }
#yd-dashboard-root .yd-accordion-item > summary::after {
    position: absolute;
    right: 16px;
    width: 7px;
    height: 7px;
    border-right: 2px solid var(--muted);
    border-bottom: 2px solid var(--muted);
    content: '';
    transform: rotate(45deg);
    transition: transform .15s;
}
#yd-dashboard-root .yd-accordion-item[open] > summary::after { transform: rotate(225deg); }
#yd-dashboard-root .yd-accordion-user { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
#yd-dashboard-root .yd-accordion-user > strong { color: var(--ink); font-size: 12px; }
#yd-dashboard-root .yd-accordion-user > small, #yd-dashboard-root .yd-accordion-summary-meta { display: flex; align-items: center; gap: 7px; }
#yd-dashboard-root .yd-accordion-body, #yd-dashboard-root .yd-tool-accordion-body {
    margin: 10px;
    padding: 10px;
    border: 0;
    border-radius: 10px;
    background: #fff;
    box-shadow: 0 1px 3px #29242e08;
}
#yd-dashboard-root .yd-permission-row {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(300px, 1.2fr);
    align-items: center;
    gap: 10px;
    margin: 4px 0;
    padding: 6px 9px;
    border: 1px solid #d8cfdd;
    border-radius: 10px;
    background: #fff;
}
#yd-dashboard-root .yd-permission-row.is-pending { border-color: #ead7a9; background: #fffcf5; }
#yd-dashboard-root .yd-permission-tool { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
#yd-dashboard-root .yd-permission-tool strong { color: var(--ink); font-size: 11.5px; }
#yd-dashboard-root .yd-permission-tool > span { color: var(--muted); font-family: 'Poppins', system-ui, -apple-system, sans-serif !important; font-size: 10px; }
#yd-dashboard-root .yd-permission-controls { display: flex; align-items: center; justify-content: flex-end; gap: 18px; flex-wrap: wrap; }
#yd-dashboard-root .yd-permission-control { display: flex; align-items: center; gap: 6px; min-width: 132px; }
#yd-dashboard-root .yd-permission-label { min-width: 75px; color: var(--muted); font-size: 10px; font-weight: 600 !important; }

#yd-dashboard-root .yd-tool-accordion-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
#yd-dashboard-root .yd-accordion-index {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    border: 1px solid #e0d6e2;
    border-radius: 8px;
    background: #f6f0f6;
    color: var(--brand-dark);
    font-size: 10px;
    font-weight: 700 !important;
}
#yd-dashboard-root .yd-tool-accordion-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
#yd-dashboard-root .yd-tool-accordion-copy strong { overflow: hidden; color: var(--ink); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
#yd-dashboard-root .yd-tool-accordion-copy small { color: var(--muted); font-size: 9.5px; }
#yd-dashboard-root .yd-tool-accordion-actions { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
#yd-dashboard-root .yd-tool-settings-placeholder {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 34px;
    padding: 6px 8px;
    border: 1px dashed #d9cfdf;
    border-radius: 9px;
    background: #fff;
}
#yd-dashboard-root .yd-settings-placeholder-icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    border: 1px solid #e3d9e6;
    border-radius: 8px;
    background: #f7f2f7;
    color: var(--brand);
    font-size: 11px;
}
#yd-dashboard-root .yd-tool-settings-placeholder > span:last-child { display: flex; flex-direction: column; gap: 1px; }
#yd-dashboard-root .yd-tool-settings-placeholder strong { color: var(--text); font-size: 10.5px; }
#yd-dashboard-root .yd-tool-settings-placeholder small { color: var(--muted); font-size: 9.5px; }
#yd-dashboard-root .yd-tool-summary { display: flex; align-items: center; gap: 7px; margin-top: 9px; color: var(--muted); font-size: 9.5px; }
#yd-dashboard-root .yd-tool-summary span { padding: 3px 8px; border: 1px solid var(--border); border-radius: 999px; background: #fff; }

#yd-dashboard-root .yd-pending-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
    padding: 2px 8px;
    border: 1px solid #ead7a9;
    border-radius: 999px;
    background: #fff8e8;
    color: #8a6421;
    font-size: 9px;
    font-weight: 500 !important;
    white-space: nowrap;
}
#yd-dashboard-root .yd-inline-loading {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
}
#yd-dashboard-root .yd-control-spinner {
    display: inline-block;
    width: 13px;
    height: 13px;
    flex: 0 0 13px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: yd-control-spin .7s linear infinite;
}
#yd-dashboard-root button[aria-busy="true"]:disabled,
#yd-dashboard-root .ui-select-trigger[aria-busy="true"]:disabled {
    opacity: .9;
    cursor: wait;
}
#yd-dashboard-root .yd-switch.is-loading .yd-switch-knob {
    opacity: 0;
}
#yd-dashboard-root .yd-switch.is-loading::after {
    content: "";
    position: absolute;
    top: 5px;
    left: 13px;
    width: 12px;
    height: 12px;
    border: 2px solid #fff;
    border-right-color: transparent;
    border-radius: 50%;
    animation: yd-control-spin .7s linear infinite;
}
@keyframes yd-control-spin {
    to { transform: rotate(360deg); }
}
#yd-dashboard-root .yd-pending-row, #yd-dashboard-root .yd-pending-row td { background: #fffcf5 !important; }

#yd-dashboard-root .yd-network-table td { white-space: normal; }
#yd-dashboard-root .yd-network-activity { display: flex; flex-direction: column; gap: 2px; min-width: 180px; }
#yd-dashboard-root .yd-network-activity strong { color: var(--ink); font-size: 11px; }
#yd-dashboard-root .yd-network-activity small { color: var(--muted); font-size: 9px; }
#yd-dashboard-root .yd-network-pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 12px 2px 2px;
}
#yd-dashboard-root .yd-pagination { display: flex; justify-content: center; width: 100%; margin: 0 auto; }
#yd-dashboard-root .yd-pagination-content { display: flex; align-items: center; gap: 2px; margin: 0; padding: 0; list-style: none; }
#yd-dashboard-root .yd-pagination-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-weight: 500 !important;
    text-decoration: none;
    cursor: pointer;
    transition: all .12s;
}
#yd-dashboard-root .yd-pagination-link:hover:not(.disabled) { background: #f1eef3; color: var(--ink); }
#yd-dashboard-root .yd-pagination-link.active { border-color: #e2dce5; background: #fff; color: var(--ink); font-weight: 600 !important; }
#yd-dashboard-root .yd-pagination-link.disabled { opacity: .38; pointer-events: none; cursor: not-allowed; }

#yd-dashboard-root .ui-select {
    position: relative;
    display: inline-flex;
    width: 100%;
    min-width: 0;
}
#yd-dashboard-root .ui-select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    height: 34px;
    min-height: 34px;
    padding: 0 10px;
    border: 1px solid #d8d0dc;
    border-radius: 8px;
    background: #fff;
    color: var(--ink);
    font-size: 12px;
    font-weight: 500 !important;
    text-align: left;
    white-space: nowrap;
    outline: none;
    user-select: none;
    cursor: pointer;
    transition: border-color .15s, box-shadow .15s, background-color .15s;
}
#yd-dashboard-root .ui-select-trigger:hover:not(:disabled) {
    border-color: #b28aa8;
    background: #fcf9fc;
    color: var(--brand-dark);
}
#yd-dashboard-root .ui-select-trigger:focus-visible,
#yd-dashboard-root .ui-select[data-open="true"] .ui-select-trigger {
    outline: none !important;
    box-shadow: none !important;
}
#yd-dashboard-root .ui-select-trigger:disabled { cursor: not-allowed; opacity: .5; }
#yd-dashboard-root .ui-select-value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: inherit;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#yd-dashboard-root .ui-select-value[data-placeholder="true"] { color: var(--muted); }
#yd-dashboard-root .ui-select-chevron {
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    color: var(--muted);
    pointer-events: none;
    transition: transform .15s;
}
#yd-dashboard-root .ui-select[data-open="true"] .ui-select-chevron { transform: rotate(180deg); }

#yd-dashboard-root .ui-select-menu,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 2147483647;
    display: none;
    width: 100%;
    min-width: max(100%, 144px);
    max-width: min(360px, calc(100vw - 24px));
    max-height: min(320px, calc(100vh - 24px));
    overflow-x: hidden;
    overflow-y: auto;
    padding: 0;
    border: 1px solid #ded6e2;
    border-radius: 8px;
    background: #fff;
    color: #18181b;
    box-shadow: 0 4px 6px -1px #0000001a, 0 2px 4px -2px #00000014, 0 0 0 1px #875a7b12;
    box-sizing: border-box;
    font-family: 'Poppins', system-ui, -apple-system, sans-serif !important;
    transform-origin: top left;
    animation: yd-dropdown-enter .12s cubic-bezier(.2, .8, .2, 1) both;
}
#yd-dashboard-root .ui-select[data-open="true"] .ui-select-menu,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] {
    display: block;
}
#yd-dashboard-root .ui-select-menu[hidden],
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"][hidden] {
    display: none !important;
}
#yd-dashboard-root .ui-select-group,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-group {
    padding: 4px;
}
#yd-dashboard-root .ui-select-label,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-label {
    padding: 4px 6px;
    color: #71717a;
    font-size: 11px;
    font-weight: 600 !important;
}
#yd-dashboard-root .ui-select-item,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 31px;
    padding: 5px 28px 5px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #18181b;
    font-size: 12.5px;
    font-weight: 500 !important;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    box-sizing: border-box;
    transition: background-color .12s, color .12s;
}
#yd-dashboard-root .ui-select-item:hover,
#yd-dashboard-root .ui-select-item:focus-visible,
#yd-dashboard-root .ui-select-option:hover,
#yd-dashboard-root .ui-select-option:focus-visible,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-item:hover,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-item:focus-visible,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-option:hover,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-option:focus-visible {
    background-color: #e9dfea !important;
    color: #68465f !important;
    outline: none !important;
}
#yd-dashboard-root .ui-select-item[data-selected="true"],
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-item[data-selected="true"] {
    background: #f8f5f7;
    color: #714b67;
    font-weight: 700 !important;
}
#yd-dashboard-root .ui-select-item[data-selected="true"]::after,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-item[data-selected="true"]::after {
    content: "";
    position: absolute;
    right: 10px;
    top: calc(50% - 5px);
    width: 4px;
    height: 8px;
    border: solid #714b67;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
}

#yd-dashboard-root .yd-allowed-users-dropdown { display: flex; width: 100%; min-width: 220px; }
#yd-dashboard-root .yd-allowed-users-dropdown > .ui-select-trigger,
#yd-dashboard-root .yd-allowed-users-dropdown > .ui-select-trigger:hover:not(:disabled),
#yd-dashboard-root .yd-allowed-users-dropdown > .ui-select-trigger:focus-visible,
#yd-dashboard-root .yd-allowed-users-dropdown[data-open="true"] > .ui-select-trigger {
    border: 0;
    box-shadow: none;
}
#yd-dashboard-root .yd-allowed-users-option > span:first-child,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-option > span:first-child {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
#yd-dashboard-root .yd-allowed-users-option > span:first-child > i,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-option > span:first-child > i {
    width: 14px;
    color: #875a7b;
}
#yd-dashboard-root .yd-allowed-user-copy,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-user-copy {
    display: flex;
    flex-direction: column;
    gap: 1px;
}
#yd-dashboard-root .yd-allowed-user-copy small,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-user-copy small {
    color: #71717a;
    font-size: 9.5px;
}
#yd-dashboard-root .yd-dropdown-separator,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-dropdown-separator {
    height: 1px;
    margin: 4px 2px;
    background: #e9e4eb;
}
#yd-dashboard-root .yd-allowed-users-footer,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding: 6px 4px 2px;
}
#yd-dashboard-root .yd-allowed-users-footer button,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-footer button {
    min-height: 28px;
    padding: 0 10px;
    border-radius: 7px;
    font-size: 11px;
    font-weight: 600 !important;
    cursor: pointer;
}
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-primary {
    border: 1px solid #875a7b;
    background: #875a7b;
    color: #fff;
}
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-secondary {
    border: 1px solid #e2dbe5;
    background: #fff;
    color: #68465f;
}

#yd-dashboard-root .yd-announcement-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    width: 50%;
    margin: 0 auto;
}
#yd-dashboard-root article.yd-announcement-card {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 760px;
    min-width: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid #e4e4e7;
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}
#yd-dashboard-root .yd-announcement-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 10px 14px;
    border-bottom: 1px solid #f0f0f2;
    background: #fff;
}
#yd-dashboard-root .yd-announcement-author-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}
#yd-dashboard-root .yd-announcement-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    border-radius: 50%;
    background: var(--brand);
    color: #fff;
    font-size: 11px;
    font-weight: 700 !important;
}
#yd-dashboard-root .yd-announcement-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
}
#yd-dashboard-root .yd-announcement-author {
    color: #18181b;
    font-size: 13px;
    font-weight: 700 !important;
}
#yd-dashboard-root .yd-announcement-by {
    color: var(--brand);
    font-weight: 700 !important;
}
#yd-dashboard-root .yd-announcement-date {
    display: flex;
    align-items: center;
    gap: 3px;
    color: #71717a;
    font-size: 11px;
    white-space: nowrap;
}
#yd-dashboard-root .yd-announcement-date svg { width: 12px; height: 12px; flex: 0 0 12px; }
#yd-dashboard-root .yd-announcement-cycle-wrap {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex: 0 0 auto;
    min-width: 108px;
}
#yd-dashboard-root .yd-announcement-cycle-select { width: 108px; min-width: 108px; }
#yd-dashboard-root .yd-announcement-cycle-select .ui-select-trigger {
    height: 29px;
    min-height: 29px;
    padding: 5px 8px;
    border: 1px solid var(--brand);
    border-radius: 8px;
    background: var(--brand);
    color: #fff;
    font-size: 12px;
    font-weight: 600 !important;
}
#yd-dashboard-root .yd-announcement-cycle-select .ui-select-trigger:hover:not(:disabled) {
    border-color: var(--brand-dark);
    background: var(--brand-dark);
    color: #fff;
}
#yd-dashboard-root .yd-announcement-cycle-select .ui-select-chevron {
    width: 13px;
    height: 13px;
    flex: 0 0 13px;
    color: rgba(255, 255, 255, 0.85);
}
#yd-dashboard-root .yd-announcement-cycle-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 108px;
    min-height: 29px;
    padding: 5px 8px;
    border: 1px solid var(--brand);
    border-radius: 8px;
    background: var(--brand);
    color: #fff;
    font-size: 12px;
    font-weight: 600 !important;
    text-align: center;
    white-space: nowrap;
}
#yd-dashboard-root .yd-announcement-body {
    margin: 0;
    padding: 18px;
    background: #fff;
    color: #18181b;
    font-size: 14.5px;
    font-weight: 600 !important;
    line-height: 1.65;
    text-align: right;
    direction: rtl;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
#yd-dashboard-root .yd-announcement-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 0 18px 14px;
    background: #fff;
}
#yd-dashboard-root .yd-announcement-actions { display: flex; align-items: center; gap: 8px; }
#yd-dashboard-root .yd-announcement-footer .yd-icon-btn { width: 30px; height: 30px; }
#yd-dashboard-root .yd-announcement-list[data-role="user"] .yd-announcement-footer { display: none !important; }

#yd-dashboard-root .yd-announcement-form { width: min(620px, 100%); padding: 22px; }
#yd-dashboard-root .yd-announcement-form textarea {
    display: block;
    width: 100%;
    min-height: 180px;
    padding: 10px 11px;
    border: 1px solid #ded8e1;
    border-radius: 9px;
    background: #fff;
    color: var(--ink);
    font-size: 12px;
    resize: vertical;
}
#yd-dashboard-root .yd-announcement-form textarea:focus {
    outline: none !important;
    box-shadow: none !important;
}
#yd-dashboard-root .yd-announcement-form .yd-field { margin-top: 10px; }

@keyframes yd-dropdown-enter {
    from { opacity: 0; transform: translateY(-4px) scale(.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes yd-backdrop-enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes yd-modal-enter {
    from { opacity: 0; transform: translateY(7px) scale(.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes yd-toast-enter {
    from { opacity: 0; transform: translateY(7px); }
    to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 1120px) {
    #yd-dashboard-root .yd-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    #yd-dashboard-root .yd-announcement-list { width: 75%; }
}
@media (max-width: 850px) {
    #yd-dashboard-root .yd-panel-grid, #yd-dashboard-root .yd-info-grid { grid-template-columns: 1fr; }
    #yd-dashboard-root #yd-sidebar { width: 190px; flex-basis: 190px; }
    #yd-dashboard-root .yd-announcement-list { width: 100%; }
}
@media (max-width: 760px) {
    #yd-dashboard-root .yd-permission-row { grid-template-columns: 1fr; }
    #yd-dashboard-root .yd-permission-controls { justify-content: flex-start; }
    #yd-dashboard-root .yd-network-pagination { align-items: flex-start; flex-direction: column; }
}
@media (max-width: 620px) {
    #yd-dashboard-root #yd-overlay { padding: 0; }
    #yd-dashboard-root #yd-modal { width: 100%; height: 100%; max-height: none; border: 0; border-radius: 0; }
    #yd-dashboard-root #yd-sidebar { width: 60px; flex-basis: 60px; padding: 12px 6px; }
    #yd-dashboard-root .yd-nav { justify-content: center; padding: 0 6px; font-size: 0; }
    #yd-dashboard-root .yd-nav span:not(.yd-nav-icon), #yd-dashboard-root .yd-nav-label, #yd-dashboard-root .yd-sidebar-bottom { display: none; }
    #yd-dashboard-root .yd-form-grid { grid-template-columns: 1fr; }
}
#yd-dashboard-root .yd-visibility-table-card thead th {
    background: #e9dfea !important;
    color: #68465f !important;
    border-bottom-color: #d8c9dc !important;
}
#yd-dashboard-root .ui-select-option:hover,
#yd-dashboard-root .ui-select-option:focus-visible,
#yd-dashboard-root .ui-select-item:hover,
#yd-dashboard-root .ui-select-item:focus-visible,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-option:hover,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-option:focus-visible,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-item:hover,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-item:focus-visible {
    background-color: #e9dfea !important;
    color: #68465f !important;
    outline: none !important;
}
#yd-dashboard-root input:focus,
#yd-dashboard-root input:focus-visible,
#yd-dashboard-root textarea:focus,
#yd-dashboard-root textarea:focus-visible,
#yd-dashboard-root select:focus,
#yd-dashboard-root select:focus-visible,
#yd-dashboard-root .ui-select-trigger:focus,
#yd-dashboard-root .ui-select-trigger:focus-visible {
    outline: none !important;
    box-shadow: none !important;
}

`;
        (document.head || document.documentElement).appendChild(style);
    };

    const navItems = () => {
        const items = [['tools', 'fa-solid fa-toolbox', 'Tools'], ['overview', 'fa-solid fa-chart-pie', 'Overview'], ['announcements', 'fa-solid fa-bullhorn', 'Announcements']];
        if (['ADMIN', 'SUPER_ADMIN'].includes(context.userRole)) items.push(['users', 'fa-solid fa-users', 'Users']);
        if (context.userRole === 'ADMIN') items.push(['permissions', 'fa-solid fa-sliders', 'User Permissions']);
        if (context.userRole === 'SUPER_ADMIN') items.push(['permissions', 'fa-solid fa-share-nodes', 'Shared Tools'], ['visibility', 'fa-solid fa-eye', 'Visibility'], ['transactions', 'fa-solid fa-right-left', 'NETWORK']);
        items.push(['account', 'fa-solid fa-gear', 'Settings']);
        return items;
    };

    const renderShell = body => {
        const user = context.user || {};
        const role = formatRole(context.userRole);
        const name = escapeHTML(formatName(user.name || user.id || 'User'));
        const avatar = escapeHTML(initials(user.name || user.id));
        const menu = navItems().map(([id, icon, label]) => '<button type="button" data-page="' + id + '" class="yd-nav ' + (activePage === id ? 'active' : '') + '"><span class="yd-nav-icon"><i class="' + icon + '"></i></span><span>' + escapeHTML(label) + '</span></button>').join('');
        const toast = notice ? '<div class="yd-toast ' + escapeHTML(notice.type) + '">' + escapeHTML(notice.message) + '</div>' : '';
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
                '</div></div>' + toast;
    };

    const statCard = (label, value, icon, colorClass = 'purple') =>
        '<div class="yd-kpi-card"><div class="yd-kpi-icon ' + colorClass + '"><i class="' + icon + '"></i></div><div class="yd-kpi-info"><div class="yd-kpi-label">' + escapeHTML(label) + '</div><div class="yd-kpi-value">' + escapeHTML(value) + '</div></div></div>';

    const renderPagination = (currentPage, totalPages, action) => {
        if (totalPages <= 1) return '';
        const firstPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
        const lastPage = Math.min(totalPages, firstPage + 4);
        const link = (label, page, active = false, disabled = false, aria = '') =>
            '<li data-slot="pagination-item"><a data-slot="pagination-link" href="#" role="button" tabindex="' + (disabled ? '-1' : '0') + '" data-action="' + escapeHTML(action) + '" data-page="' + page + '" aria-label="' + escapeHTML(aria || String(label)) + '"' +
            (active ? ' aria-current="page" data-active="true"' : '') +
            (disabled ? ' aria-disabled="true"' : '') +
            ' class="yd-pagination-link' + (active ? ' active' : '') + (disabled ? ' disabled' : '') + '">' + label + '</a></li>';
        let pages = link('<i class="fa-solid fa-chevron-left"></i>', currentPage - 1, false, currentPage <= 1, 'Previous page');
        for (let page = firstPage; page <= lastPage; page++) pages += link(String(page), page, page === currentPage, false, 'Page ' + page);
        pages += link('<i class="fa-solid fa-chevron-right"></i>', currentPage + 1, false, currentPage >= totalPages, 'Next page');
        return '<nav role="navigation" aria-label="pagination" data-slot="pagination" class="yd-pagination"><ul data-slot="pagination-content" class="yd-pagination-content">' + pages + '</ul></nav>';
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
            '<div class="yd-network-pagination">' + renderPagination(networkPage, totalPages, 'network-page') + '</div>';
    };

    const renderOverview = () => {
        const toolList = getTools();
        const visibleTools = toolList.filter(tool => context.userRole === 'SUPER_ADMIN' || context.visibility?.isVisible?.(tool.id, tool));
        const permittedTools = visibleTools.filter(tool => context.permissions?.canUse?.(context.userId || context.user?.id, tool.id) === true);
        const enabledTools = visibleTools.filter(tool => context.settings?.isEnabled?.(tool.id) === true);
        const user = context.user || {};
        const role = formatRole(context.userRole);
        return '<section class="yd-welcome"><div><h1>Overview</h1><p>Your centralized Yodawy tools workspace and account status.</p></div></section>' +
            '<section class="yd-stats">' +
                statCard('Tools', visibleTools.length, 'fa-solid fa-toolbox', 'blue') +
                statCard('Permitted', permittedTools.length, 'fa-solid fa-shield-halved', 'green') +
                statCard('Active (ON)', enabledTools.length, 'fa-solid fa-bolt', 'purple') +
                statCard('Status', 'Connected', 'fa-solid fa-cloud', 'green') +
            '</section>' +
            '<section class="yd-info-grid">' +
                '<div class="yd-card"><div class="yd-card-title"><span class="yd-title-icon"><i class="fa-solid fa-user"></i></span><span>Account</span></div>' +
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
            const storedEnabled = allowed && context.settings?.isEnabled?.(id) === true;
            const pending = pendingLocalTools.get(id);
            const enabled = pending ? pending.enabled === true : storedEnabled;
            const expanded = expandedTools.has(id) ? ' open' : '';
            const status = pending ? renderPendingBadge(pending.label || 'Updating') : '<span class="yd-pill ' + (enabled ? 'green' : 'red') + '">' + (enabled ? 'ON' : 'OFF') + '</span>';
            return '<details class="yd-tool-accordion-item" data-tool-accordion data-tool="' + escapeHTML(id) + '"' + expanded + '>' +
                '<summary><span class="yd-tool-accordion-main"><span class="yd-accordion-index">' + String(index + 1).padStart(2, '0') + '</span><span class="yd-tool-accordion-copy"><strong>' + escapeHTML(tool.name) + '</strong><small>' + escapeHTML(id) + ' · v' + escapeHTML(tool.version || '1') + '</small></span></span>' +
                '<span class="yd-tool-accordion-actions">' + status + '<button type="button" class="yd-switch ' + (enabled ? 'on' : '') + (pending ? ' is-loading' : '') + '" data-action="toggle-my-tool" data-tool="' + escapeHTML(id) + '" data-enabled="' + String(enabled) + '" ' + (allowed && !pending ? '' : 'disabled') + ' role="switch" aria-checked="' + String(enabled) + '" aria-label="Toggle ' + escapeHTML(tool.name) + '"><span class="yd-switch-knob"></span></button></span></summary>' +
                '<div class="yd-tool-accordion-body"><div class="yd-tool-settings-placeholder"><span class="yd-settings-placeholder-icon"><i class="fa-solid fa-sliders"></i></span><span><strong>User Settings</strong><small>Tool-specific user settings will be available here.</small></span>' + (pending ? renderPendingBadge(pending.label || 'Updating') : '') + '</div></div></details>';
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
            return '<tr' + (pending ? ' class="yd-pending-row"' : '') + '><td><strong>' + escapeHTML(formatName(user.name)) + '</strong></td><td><span class="yd-id-badge">' + escapeHTML(user._pending ? 'ASSIGNING ID' : id) + '</span></td><td><span class="yd-pill">' + escapeHTML(formatRole(user.role)) + '</span></td><td>' + status + '</td><td><span class="yd-repository-name">' + escapeHTML(repository) + '</span></td><td><div class="yd-user-actions">' + editButton + deleteButton + '</div></td></tr>';
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
                const pendingUser = getPendingUser(user);
                let grantedCount = 0, forcedCount = 0;
                const rows = tools.map(tool => {
                    const record = userPermissions[tool.id] || {};
                    const pending = getPendingPermission(userId, tool.id);
                    const granted = pending?.permissionField === 'granted' && typeof pending.permissionValue === 'boolean' ? pending.permissionValue : record.granted === true;
                    const forced = pending?.permissionField === 'forcedState' && typeof pending.permissionValue === 'boolean' ? pending.permissionValue : record.forcedState === true;
                    if (granted) grantedCount++;
                    if (forced) forcedCount++;
                    const disabled = active && !pending && !pendingUser ? '' : ' disabled';
                    const pendingBadge = pending ? renderPendingBadge('Queued') : '';
                    const permittedSwitch = '<button type="button" class="yd-switch ' + (granted ? 'on' : '') + (pending?.permissionField === 'granted' || pendingUser ? ' is-loading' : '') + '" data-action="toggle-permission" data-field="granted" data-value="' + String(granted) + '" data-user="' + escapeHTML(userId) + '" data-tool="' + escapeHTML(tool.id) + '" role="switch" aria-checked="' + String(granted) + '" aria-label="Permit ' + escapeHTML(tool.name) + '"' + disabled + '><span class="yd-switch-knob"></span></button>';
                    const forcedSwitch = '<button type="button" class="yd-switch yd-switch-forced ' + (forced ? 'on' : '') + (pending?.permissionField === 'forcedState' || pendingUser ? ' is-loading' : '') + '" data-action="toggle-permission" data-field="forcedState" data-value="' + String(forced) + '" data-user="' + escapeHTML(userId) + '" data-tool="' + escapeHTML(tool.id) + '" role="switch" aria-checked="' + String(forced) + '" aria-label="Force state for ' + escapeHTML(tool.name) + '"' + disabled + '><span class="yd-switch-knob"></span></button>';
                    return '<div class="yd-permission-row' + (pending ? ' is-pending' : '') + '"><div class="yd-permission-tool"><strong>' + escapeHTML(tool.name) + '</strong>' + pendingBadge + '<span>' + escapeHTML(tool.id) + '</span></div><div class="yd-permission-controls"><div class="yd-permission-control"><span class="yd-permission-label">Permitted</span>' + permittedSwitch + '</div><div class="yd-permission-control"><span class="yd-permission-label">Forced State</span>' + forcedSwitch + '</div></div></div>';
                }).join('');
                const expanded = expandedUsers.has(userId) ? ' open' : '';
                const userBadge = pendingUser ? renderPendingBadge(String(pendingUser.action).toUpperCase() === 'DELETE_USER' ? 'Deleting' : 'Updating') : '';
                return '<details class="yd-accordion-item" data-user-accordion data-user="' + escapeHTML(userId) + '"' + expanded + '><summary><span class="yd-accordion-user"><strong>' + escapeHTML(formatName(user.name)) + ' ' + userBadge + '</strong><small><span class="yd-id-badge">' + escapeHTML(userId) + '</span><span class="yd-pill">' + escapeHTML(formatRole(user.role)) + '</span></small></span><span class="yd-accordion-summary-meta"><span class="yd-pill green">' + grantedCount + ' Permitted</span><span class="yd-pill blue">' + forcedCount + ' Forced</span></span></summary><div class="yd-accordion-body">' + (rows || '<div class="yd-empty">No tools are available.</div>') + '</div></details>';
            }).join('');
            return '<section class="yd-welcome"><div><h1>Shared Tools</h1><p>Expand a user to manage tool access and forced states.</p></div><span class="yd-pill">SUPER ADMIN CONTROL</span></section><div class="yd-accordion-list">' + (items || '<div class="yd-empty">No eligible users found.</div>') + '</div>';
        }
        return '<section class="yd-welcome"><div><h1>User Permissions</h1><p>Permit or revoke tool access for USER accounts.</p></div><span class="yd-pill">ADMIN CONTROL</span></section>' +
            '<div class="yd-table-wrap"><table><thead><tr><th>User</th><th>Tool</th><th>Permitted</th><th>Forced State</th><th>Action</th></tr></thead><tbody>' +
            (users.flatMap(user => tools.map(tool => {
                const record = permissions[user.id]?.[tool.id] || {};
                const pending = getPendingPermission(user.id, tool.id);
                const pendingUser = getPendingUser(user);
                const blocked = pending || pendingUser;
                const permissionAction = blocked
                    ? '<span class="yd-inline-loading"><span class="yd-control-spinner" aria-hidden="true"></span><span>' + (pendingUser ? 'Updating' : 'Saving') + '</span></span>'
                    : record.granted ? 'Revoke' : 'Permit';
                return '<tr' + (blocked ? ' class="yd-pending-row"' : '') + '><td><strong>' + escapeHTML(formatName(user.name)) + '</strong>' + (pendingUser ? renderPendingBadge('Updating') : '') + '</td><td>' + escapeHTML(tool.name) + (pending ? renderPendingBadge('Queued') : '') + '</td><td><span class="yd-pill ' + (record.granted ? 'green' : 'red') + '">' + (record.granted ? 'Permitted' : 'Denied') + '</span></td><td>' + (record.forcedState ? 'Protected' : 'Normal') + '</td><td><button class="yd-secondary" data-action="toggle-permission" data-user="' + escapeHTML(user.id) + '" data-tool="' + escapeHTML(tool.id) + '" data-granted="' + String(record.granted === true) + '"' + (blocked ? ' disabled' : '') + '>' + permissionAction + '</button></td></tr>';
            })).join('') || '<tr><td colspan="5" class="yd-empty">No eligible users or visible tools.</td></tr>') + '</tbody></table></div>';
    };

    const renderAllowedUsersDropdown = (tool, record, users, pending) => {
        const toolId = String(tool.id);
        const draft = visibilityDraft?.toolId === toolId ? visibilityDraft : {
            toolId,
            allUsers: record.visibility === 'PUBLIC',
            allowedUsers: new Set((record.allowedUsers || []).map(id => String(id).trim().toUpperCase()))
        };
        const allSelected = draft.allUsers;
        const activeUsers = users.filter(user => String(user.status || '').toLowerCase() === 'active');
        const selectedCount = allSelected ? activeUsers.length : draft.allowedUsers.size;
        const label = allSelected ? 'All Users' : selectedCount ? selectedCount + ' Selected' : 'No Users Selected';
        const isOpen = openVisibilityToolId === toolId && !pending;
        const allOption = '<button type="button" class="ui-select-option ui-select-item yd-allowed-users-option' + (allSelected ? ' selected' : '') + '" data-selected="' + String(allSelected) + '" data-action="toggle-allowed-all" data-tool="' + escapeHTML(toolId) + '" role="option" aria-selected="' + String(allSelected) + '"' + (pending ? ' disabled' : '') + '><span><i class="fa-solid fa-users"></i>All Users</span></button>';
        const userOptions = users.map(user => {
            const id = String(user.id || '').trim().toUpperCase();
            const active = String(user.status || '').toLowerCase() === 'active';
            const selected = allSelected || draft.allowedUsers.has(id);
            return '<button type="button" class="ui-select-option ui-select-item yd-allowed-users-option' + (selected ? ' selected' : '') + '" data-selected="' + String(selected) + '" data-action="toggle-allowed-user" data-tool="' + escapeHTML(toolId) + '" data-user="' + escapeHTML(id) + '" role="option" aria-selected="' + String(selected) + '"' + (!active || pending ? ' disabled' : '') + '><span><i class="fa-regular ' + (selected ? 'fa-square-check' : 'fa-square') + '"></i><span class="yd-allowed-user-copy">' + escapeHTML(formatName(user.name)) + '<small>' + escapeHTML(id) + ' · ' + escapeHTML(formatRole(user.role)) + '</small></span></span></button>';
        }).join('');
        const pendingLabel = pending?.action === 'SUBMITTING' ? 'Saving' : 'Pending';
        const footer = pending
            ? '<div class="yd-allowed-users-footer">' + renderPendingBadge(pendingLabel) + '</div>'
            : '<div class="yd-allowed-users-footer"><button type="button" class="yd-secondary" data-action="cancel-allowed-users" data-tool="' + escapeHTML(toolId) + '">Cancel</button><button type="button" class="yd-primary" data-action="save-allowed-users" data-tool="' + escapeHTML(toolId) + '">Apply</button></div>';
        const selectedValues = allSelected ? activeUsers.map(user => String(user.id || '').trim().toUpperCase()) : [...draft.allowedUsers];
        return '<div class="ui-select yd-dropdown yd-select-dropdown yd-allowed-users-dropdown' + (isOpen ? ' open' : '') + (pending ? ' disabled' : '') + '" data-multiple="true" data-open="' + String(isOpen) + '" data-placeholder="Select users" data-value="' + escapeHTML(JSON.stringify(selectedValues)) + '" data-tool="' + escapeHTML(toolId) + '">' +
            '<button type="button" class="ui-select-trigger yd-dropdown-trigger" data-action="toggle-dropdown" aria-haspopup="listbox" aria-expanded="' + String(isOpen) + '"' + (pending ? ' disabled' : '') + '><span class="ui-select-value yd-dropdown-value" data-placeholder="' + String(!selectedCount) + '">' + escapeHTML(label) + '</span>' + (pending ? renderPendingBadge(pendingLabel) : '<svg class="ui-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>') + '</button>' +
            '<div class="ui-select-menu ui-select-content yd-dropdown-menu yd-allowed-users-menu" role="listbox" aria-multiselectable="true"' + (isOpen ? '' : ' hidden') + '><div class="ui-select-group"><div class="ui-select-label">Allowed Users</div>' + allOption + '<div class="yd-dropdown-separator" role="separator"></div>' + (userOptions || '<div class="yd-empty">No users available.</div>') + footer + '</div></div></div>';
    };

    const refreshAllowedUsersDropdown = toolId => {
        const root = document.getElementById(CONFIG.ID);
        const current = [...(root?.querySelectorAll('.yd-allowed-users-dropdown') || [])].find(item => item.dataset.tool === toolId);
        const tool = getTools().find(item => String(item.id) === String(toolId));
        if (!current || !tool) return;
        const shouldRemainOpen = openVisibilityToolId === toolId && !getPendingVisibility(toolId);
        closeDropdowns(null);
        const engine = getRoleEngine();
        const record = optimisticVisibility.get(toolId) || (engine?.getVisibility?.() || {})[toolId] || { visibility: 'PRIVATE', allowedUsers: [] };
        const fresh = document.createElement('div');
        fresh.innerHTML = renderAllowedUsersDropdown(tool, record, engine?.getUsers?.() || [], getPendingVisibility(toolId));
        const replacement = fresh.firstElementChild;
        if (!replacement) return;
        current.replaceWith(replacement);
        if (shouldRemainOpen) openDropdownMenu(replacement);
    };

    const renderVisibility = () => {
        const tools = getTools();
        const engine = getRoleEngine();
        const visibility = { ...(engine?.getVisibility?.() || {}), ...Object.fromEntries(optimisticVisibility) };
        const users = engine?.getUsers?.() || [];
        const rows = tools.map((tool, index) => {
            const record = visibility[tool.id] || { visibility: 'PRIVATE', allowedUsers: [] };
            const pending = getPendingVisibility(tool.id);
            return '<tr' + (pending ? ' class="yd-pending-row"' : '') + '><th>' + (index + 1) + '</th><td><span class="yd-id-badge">' + escapeHTML(tool.id) + '</span></td><td><div class="yd-tool-name">' + escapeHTML(tool.name) + '</div></td><td>' + renderAllowedUsersDropdown(tool, record, users, pending) + '</td></tr>';
        }).join('');
        return '<section class="yd-welcome"><div><h1>Allowed Users</h1><p>Choose All Users or manage access for individual accounts.</p></div><span class="yd-pill blue">SUPER ADMIN CONTROL</span></section>' +
            '<div class="yd-table-card yd-visibility-table-card"><div class="yd-table-responsive"><table><thead><tr><th style="width:70px">#</th><th style="width:120px">Tool ID</th><th>Tool</th><th>Allowed Users</th></tr></thead><tbody>' + (rows || '<tr><td colspan="4" class="yd-empty">No tools available.</td></tr>') + '</tbody></table></div></div>';
    };

    const renderAnnouncements = () => {
        const posts = context.announcements?.getPosts?.() || [];
        const canManage = ['ADMIN', 'SUPER_ADMIN'].includes(context.userRole);
        const role = String(context.userRole || 'USER').trim().toLowerCase().replace(/_/g, '');
        const cards = posts.map(post => {
            const published = formatAnnouncementDate(post.createdAt || post.updatedAt);
            const cycle = getAnnouncementCycle(post);
            const id = escapeHTML(post.id);
            const authorName = String(post.createdBy || 'Dashboard Team').toLocaleUpperCase();
            const author = escapeHTML(authorName);
            const cycleControl = canManage
                ? renderAnnouncementCycleDropdown(cycle, post.id)
                : '<span class="yd-announcement-cycle-box">' + escapeHTML(cycle) + '</span>';
            return '<article class="yd-announcement-card"><header class="yd-announcement-head yd-announcement-header"><div class="yd-announcement-author-wrap"><div class="yd-announcement-avatar">' + escapeHTML(initials(authorName)) + '</div><div class="yd-announcement-meta"><strong class="yd-announcement-author"><span class="yd-announcement-by">By:</span> ' + author + '</strong><time class="yd-announcement-date">' + escapeHTML(published.date + ' • ' + published.time) + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></time></div></div><div class="yd-announcement-cycle-wrap">' + cycleControl + '</div></header><div class="yd-announcement-body" dir="rtl">' + escapeHTML(post.body) + '</div>' +
                (canManage ? '<footer class="yd-announcement-footer"><div class="yd-announcement-actions"><button type="button" class="yd-icon-btn" data-action="edit-announcement" data-id="' + id + '" title="Edit announcement" aria-label="Edit announcement"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button><button type="button" class="yd-icon-btn danger" data-action="delete-announcement" data-id="' + id + '" title="Delete announcement" aria-label="Delete announcement"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button></div></footer>' : '') +
                '</article>';
        }).join('');
        return '<section class="yd-welcome"><div><h1>Announcements</h1><p>Operational messages and important team updates.</p></div>' +
            (canManage ? '<button type="button" class="yd-primary" data-action="add-announcement"><i class="fa-solid fa-plus"></i><span>New Announcement</span></button>' : '') +
            '</section><div class="yd-announcement-list" data-role="' + escapeHTML(role) + '">' + (cards || '<div class="yd-card yd-empty">No announcements have been published yet.</div>') + '</div>';
    };

    const openAnnouncementModal = post => {
        const editing = Boolean(post);
        const cycle = getAnnouncementCycle(post || { createdAt: new Date().toISOString() });
        const overlay = document.createElement('div');
        overlay.className = 'yd-modal-backdrop';
        overlay.innerHTML = '<form class="yd-modal yd-announcement-form" role="dialog" aria-modal="true" aria-labelledby="yd-announcement-form-title"><h3 id="yd-announcement-form-title">' + (editing ? 'Edit Announcement' : 'New Announcement') + '</h3><div class="yd-field"><label for="yd-announcement-body">Message</label><textarea id="yd-announcement-body" name="body" maxlength="6000" required placeholder="Write the announcement here...">' + escapeHTML(post?.body || '') + '</textarea></div><div class="yd-field"><label for="yd-announcement-cycle">Cycle</label>' + renderDropdown('cycle', cycle, ANNOUNCEMENT_CYCLES.map(item => ({ value: item, label: item })), { id: 'yd-announcement-cycle', 'data-label': 'Cycle' }) + '</div><div class="yd-modal-actions"><button type="button" class="yd-secondary" data-announcement-cancel>Cancel</button><button type="submit" class="yd-primary">' + (editing ? 'Save Changes' : 'Publish') + '</button></div></form>';
        document.getElementById(CONFIG.ID).appendChild(overlay);
        const close = () => {
            closeDropdowns(null);
            overlay.remove();
        };
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-announcement-cancel]')) close();
        });
        overlay.querySelector('form').addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const submit = form.querySelector('[type="submit"]');
            const data = new FormData(form);
            const payload = { body: String(data.get('body') || '').trim(), cycle: String(data.get('cycle') || '') };
            if (!payload.body) return;
            setButtonLoading(submit, editing ? 'Saving' : 'Publishing');
            try {
                if (editing) await context.announcements.updatePost(post.id, payload);
                else await context.announcements.createPost(payload);
                await context.announcements.load();
                close();
                render();
                showNotice(editing ? 'Announcement updated.' : 'Announcement published.');
            } catch (error) {
                submit.disabled = false;
                submit.removeAttribute('aria-busy');
                submit.textContent = editing ? 'Save Changes' : 'Publish';
                showMessageDialog('Announcement Not Saved', error?.message || 'Unable to save this announcement.');
            }
        });
    };

    const renderTransactions = () =>
        '<div class="yd-network-page"><section class="yd-welcome"><div><h1>NETWORK Activity</h1><p>Administrative activity and request status.</p></div></section>' +
        renderTransactionsTable(getTransactions()) + '</div>';

    const renderAccount = () => {
        const user = context.user || {};
        const settings = context.settings?.getSettings?.() || { tools: {} };
        return '<section class="yd-welcome"><div><h1>Settings</h1><p>Personal dashboard preferences and workspace details.</p></div><button class="yd-primary" data-action="save-settings"><i class="fa-solid fa-cloud-arrow-up"></i><span>Save Settings</span></button></section>' +
            '<div class="yd-panel-grid"><div class="yd-card"><div class="yd-card-title"><span class="yd-title-icon"><i class="fa-solid fa-sliders"></i></span><span>Personal Dashboard Preferences</span></div>' +
                '<div class="yd-field"><label for="yd-start-page">Default Start Section</label>' + renderDropdown('startPage', settings.startPage === 'overview' ? 'overview' : 'tools', [{ value: 'tools', label: 'Tools' }, { value: 'overview', label: 'Overview' }], { id: 'yd-start-page', 'data-label': 'Start Section' }) + '</div>' +
            '</div><div class="yd-card"><div class="yd-card-title"><span class="yd-title-icon"><i class="fa-solid fa-database"></i></span><span>Repository & Account</span></div>' +
                '<div class="yd-info-row"><span>Full Name</span><strong>' + escapeHTML(formatName(user.name || '—')) + '</strong></div>' +
                '<div class="yd-info-row"><span>User ID</span><strong>' + escapeHTML(user.id || user.userId || context.userId || '—') + '</strong></div>' +
                '<div class="yd-info-row"><span>Role</span><strong>' + escapeHTML(formatRole(context.userRole)) + '</strong></div>' +
                '<div class="yd-info-row"><span>Personal Repository</span><strong>' + escapeHTML(context.personalRepository || '—') + '</strong></div>' +
                '<div class="yd-info-row"><span>Dashboard Repository</span><strong>' + escapeHTML(context.dashboardRepository || '—') + '</strong></div>' +
                '<div class="yd-info-row"><span>Branch</span><strong>' + escapeHTML(context.branch || 'main') + '</strong></div>' +
            '</div></div>';
    };

    const renderPage = () => ({
        overview: renderOverview,
        tools: renderTools,
        announcements: renderAnnouncements,
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
        closeDropdowns(null);
        openVisibilityToolId = null;
        root.innerHTML = renderShell(renderPage());
    };

    const refresh = async () => {
        await Promise.all([
            context.permissions?.load?.(),
            context.visibility?.load?.()
        ]);
        await context.tools?.loadManifest?.();
        await context.announcements?.load?.();
        const engine = getRoleEngine();
        if (engine?.refresh) await engine.refresh();
        render();
        return true;
    };

    const persistTransaction = transaction => {
        localTransactions.set(transaction.requestId, transaction);
        networkPage = 1;
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
                    try {
                        result = await engine.waitForTransaction(requestId, {
                            timeout: 120000,
                            interval: 4000,
                            refresh: false
                        });
                    } catch {
                        await new Promise(resolve => setTimeout(resolve, 4000));
                        continue;
                    }
                    const status = String(result?.status || '').toUpperCase();
                    if (status !== 'TIMEOUT') break;
                }
                const status = String(result?.status || '').toUpperCase();
                if (!result || status === 'TIMEOUT') {
                    showMessageDialog('Still Processing', 'This request is taking longer than expected. It remains queued and locked. The dashboard will keep checking its status.');
                    if (context && localTransactions.has(requestId)) setTimeout(() => monitorTransaction(transaction), 15000);
                    return;
                }
                if (status !== 'COMPLETED') throw new Error(result?.error || result?.message || 'The request could not be completed.');
                removePendingTransaction(transaction);
                try { await refresh(); } catch {}
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
            if (Array.isArray(metadata.targetToolIds) && metadata.targetToolIds.length) {
                metadata.targetToolIds.forEach(toolId => optimisticVisibility.delete(toolId));
                render();
            }
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

    const encodeJSON = value => {
        const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        return btoa(binary);
    };

    const decodeJSON = value => {
        const binary = atob(String(value || '').replace(/\s/g, ''));
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    };

    const appendNetworkActivity = async ({ action, toolId = '', toolName = '', summary = '' }) => {
        const api = window.YODAWY_API_ENGINE;
        const config = api?.getConfig?.();
        if (!api?.getFile || !api?.put || !config?.owner || !config?.repo || !config?.branch) throw new Error('Central NETWORK API is unavailable.');
        const actor = context.user || {};
        const now = new Date().toISOString();
        const requestId = 'ACTIVITY-' + (window.crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(36).slice(2)));
        const record = {
            requestId,
            sequence: String(Date.now()),
            requestType: 'DASHBOARD_ACTIVITY_LOG',
            action,
            status: 'COMPLETED',
            actorId: String(context.userId || actor.id || actor.userId || '').trim().toUpperCase(),
            actorName: formatName(actor.name || context.userId || 'Unknown'),
            ...(toolId ? { targetToolId: toolId, targetToolIds: [toolId] } : {}),
            ...(toolName ? { targetToolName: toolName } : {}),
            summary,
            createdAt: now,
            updatedAt: now
        };
        const endpoint = '/repos/' + encodeURIComponent(config.owner) + '/' + encodeURIComponent(config.repo) + '/contents/NETWORK/network-logs.json';
        let lastError = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const file = await api.getFile('NETWORK/network-logs.json');
                const log = file?.content ? decodeJSON(file.content) : { protocolVersion: 1, transactions: {} };
                const transactions = log.transactions && typeof log.transactions === 'object' && !Array.isArray(log.transactions) ? log.transactions : {};
                transactions[requestId] = record;
                const active = Object.entries(transactions).filter(([, item]) => ['SENT', 'RECEIVED', 'PROCESSING', 'PROCESSED', 'RESPONSE_SENT'].includes(String(item?.status || '').toUpperCase()));
                const completed = Object.entries(transactions).filter(([, item]) => !['SENT', 'RECEIVED', 'PROCESSING', 'PROCESSED', 'RESPONSE_SENT'].includes(String(item?.status || '').toUpperCase())).sort((left, right) => String(right[1]?.updatedAt || '').localeCompare(String(left[1]?.updatedAt || ''))).slice(0, 50);
                const retained = Object.fromEntries([...active, ...completed]);
                const response = await api.put(endpoint, {
                    message: 'Record dashboard activity ' + action,
                    content: encodeJSON({ protocolVersion: 1, updatedAt: now, transactions: retained }),
                    sha: file.sha,
                    branch: config.branch
                });
                if (!response.data?.content?.sha) throw new Error('NETWORK activity log update was not confirmed.');
                networkPage = 1;
                try { await getRoleEngine()?.refresh?.(); } catch {}
                return record;
            } catch (error) {
                lastError = error;
                if (![409, 422].includes(Number(error?.status)) || attempt === 4) break;
                await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
            }
        }
        throw lastError || new Error('Unable to record NETWORK activity.');
    };

    const createVisibilityDraft = toolId => {
        const engine = getRoleEngine();
        const record = optimisticVisibility.get(toolId) || (engine?.getVisibility?.() || {})[toolId] || { visibility: 'PRIVATE', allowedUsers: [] };
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
            setButtonLoading(button, 'Submitting');
            try {
                await onConfirm();
                close();
            } catch (error) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
                button.textContent = confirmLabel;
                showMessageDialog('Unable to Submit Request', error?.message || 'The requested action failed.');
            }
        });
    };

    const openUserModal = user => {
        const editing = Boolean(user);
        const overlay = document.createElement('div');
        overlay.className = 'yd-modal-backdrop';
        const roleDropdown = context.userRole === 'SUPER_ADMIN'
            ? '<div class="yd-field"><label>Role</label>' + renderDropdown('role', user?.role || 'USER', [{ value: 'USER', label: 'USER' }, { value: 'ADMIN', label: 'ADMIN' }, { value: 'SUPER_ADMIN', label: 'SUPER ADMIN' }], { 'data-label': 'Roles' }) + '</div>'
            : '';
        const statusDropdown = '<div class="yd-field"><label>Status</label>' + renderDropdown('status', user?.status || 'Active', [{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }], { 'data-label': 'Status' }) + '</div>';
        overlay.innerHTML = '<form class="yd-modal" id="yd-user-form">' +
            '<h3>' + (editing ? 'Edit User' : 'Add User') + '</h3>' +
            '<div class="yd-form-grid">' +
                '<div class="yd-field"><label>Full Name</label><input name="name" required value="' + escapeHTML(formatName(user?.name || '')) + '" placeholder="Employee full name"></div>' +
                roleDropdown + statusDropdown +
            '</div><div class="yd-modal-actions"><button type="button" class="yd-secondary" data-modal-close>Cancel</button><button type="submit" class="yd-primary">' + (editing ? 'Save Changes' : 'Create User') + '</button></div></form>';
        document.getElementById(CONFIG.ID).appendChild(overlay);
        const close = () => {
            closeDropdowns(null);
            overlay.remove();
        };
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-modal-close]')) close();
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
            setButtonLoading(submitButton, 'Submitting');
            try {
                await runNetworkOperation(editing ? 'Updating user' : 'Creating user', () =>
                    editing ? engine.editUser(user.id, payload) : engine.addUser(payload), metadata
                );
                close();
            } catch (error) {
                submitButton.disabled = false;
                submitButton.removeAttribute('aria-busy');
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
        try {
            if (action === 'refresh-connection') {
                if (button?.disabled) return;
                if (button) {
                    button.disabled = true;
                    button.setAttribute('aria-busy', 'true');
                    const icon = button.querySelector('.yd-action-icon');
                    const label = button.querySelector('b');
                    if (icon) icon.innerHTML = '<span class="yd-control-spinner" aria-hidden="true"></span>';
                    if (label) label.textContent = 'Refreshing';
                }
                showNotice('Refreshing connection in the background...');
                trackBackground(refresh().then(() => showNotice('Connection refreshed successfully.')).catch(error => showMessageDialog('Refresh Failed', error?.message || 'Unable to refresh connection.')).finally(() => {
                    if (button?.isConnected) {
                        button.disabled = false;
                        button.removeAttribute('aria-busy');
                        const icon = button.querySelector('.yd-action-icon');
                        const label = button.querySelector('b');
                        if (icon) icon.innerHTML = '<i class="fa-solid fa-arrow-rotate-right"></i>';
                        if (label) label.textContent = 'Refresh';
                    }
                }));
            } else if (action === 'save-settings') {
                const updated = context.settings.getSettings();
                delete updated.displayName;
                updated.startPage = document.getElementById(CONFIG.ID).querySelector('#yd-start-page')?.value || 'tools';
                activePage = updated.startPage;
                setButtonLoading(button, 'Saving');
                showNotice('Saving personal dashboard settings in the background...');
                trackBackground((async () => {
                    try {
                        await context.settings.save(updated);
                        try {
                            await appendNetworkActivity({
                                action: 'UPDATE_DASHBOARD_SETTINGS',
                                summary: 'UPDATE DASHBOARD SETTINGS'
                            });
                            showNotice('Personal settings saved and NETWORK activity recorded.');
                        } catch (error) {
                            showMessageDialog('Settings Saved · Activity Not Logged', 'Your personal settings were saved successfully, but NETWORK activity could not be recorded: ' + (error?.message || 'Unknown error.'));
                        }
                        render();
                    } catch (error) {
                        render();
                        showMessageDialog('Settings Not Saved', error?.message || 'Unable to save personal settings.');
                    }
                })());
            } else if (action === 'toggle-my-tool') {
                const toolId = button.dataset.tool;
                const nextEnabled = button.dataset.enabled !== 'true';
                if (pendingLocalTools.has(toolId)) return;
                pendingLocalTools.set(toolId, { label: nextEnabled ? 'Enabling' : 'Disabling', enabled: nextEnabled });
                button.classList.toggle('on', nextEnabled);
                button.setAttribute('aria-checked', String(nextEnabled));
                await new Promise(resolve => requestAnimationFrame(resolve));
                render();
                showNotice((nextEnabled ? 'Enabling ' : 'Disabling ') + toolId + '...');
                trackBackground((async () => {
                    try {
                        if (nextEnabled) await context.settings.enableTool(toolId);
                        else await context.settings.disableTool(toolId);
                        await context.tools.syncTool(toolId);
                        try {
                            const toolName = getTools().find(tool => String(tool.id) === String(toolId))?.name || toolId;
                            await appendNetworkActivity({
                                action: nextEnabled ? 'ENABLE_TOOL' : 'DISABLE_TOOL',
                                toolId,
                                toolName,
                                summary: (nextEnabled ? 'ENABLE TOOL · ' : 'DISABLE TOOL · ') + toolName
                            });
                            pendingLocalTools.delete(toolId);
                            render();
                            showNotice('Tool setting saved and NETWORK activity recorded.');
                        } catch (error) {
                            pendingLocalTools.delete(toolId);
                            render();
                            showMessageDialog('Tool Updated · Activity Not Logged', 'The tool state was saved successfully, but NETWORK activity could not be recorded: ' + (error?.message || 'Unknown error.'));
                        }
                    } catch (error) {
                        pendingLocalTools.delete(toolId);
                        render();
                        showMessageDialog('Tool Update Failed', error?.message || 'Unable to update this tool.');
                    }
                })());
            } else if (action === 'add-user') {
                openUserModal();
            } else if (action === 'edit-user') {
                if (getPendingUser({ id: button.dataset.id })) return;
                openUserModal(getUsers().find(user => user.id === button.dataset.id));
            } else if (action === 'delete-user') {
                const user = getUsers().find(item => String(item.id).toUpperCase() === String(button.dataset.id).toUpperCase());
                if (getPendingUser(user)) return;
                openConfirmDialog('Delete User', 'Delete ' + formatName(user?.name || button.dataset.id) + '? This request will be processed through NETWORK.', 'Delete User', () => {
                    const metadata = { action: 'DELETE_USER', targetId: button.dataset.id, targetName: formatName(user?.name || button.dataset.id), summary: 'DELETE USER · ' + formatName(user?.name || button.dataset.id) };
                    return runNetworkOperation('Deleting user', () => getRoleEngine().deleteUser(button.dataset.id), metadata);
                });
            } else if (action === 'toggle-permission') {
                const field = button.dataset.field || 'granted';
                const userId = button.dataset.user;
                const toolId = button.dataset.tool;
                if (getPendingPermission(userId, toolId) || getPendingUser({ id: userId }) || button.disabled) return;
                const current = button.dataset.value !== undefined ? button.dataset.value === 'true' : button.dataset.granted === 'true';
                const nextValue = !current;
                const user = getUsers().find(item => String(item.id).toUpperCase() === String(userId).toUpperCase());
                const metadata = {
                    action: 'MODIFY_TOOL_PERMISSION',
                    targetId: userId,
                    targetName: formatName(user?.name || userId),
                    targetToolId: toolId,
                    targetToolIds: [toolId],
                    permissionField: field,
                    permissionValue: nextValue,
                    summary: 'MODIFY TOOL PERMISSION · ' + (field === 'forcedState' ? (nextValue ? 'FORCED STATE ON' : 'FORCED STATE OFF') : (nextValue ? 'PERMITTED' : 'ACCESS REVOKED')) + ' · ' + toolId + ' · ' + formatName(user?.name || userId)
                };
                button.dataset.value = String(nextValue);
                button.classList.toggle('on', nextValue);
                button.setAttribute('aria-checked', String(nextValue));
                if (button.classList.contains('yd-switch')) {
                    button.disabled = true;
                    button.classList.add('is-loading');
                    button.setAttribute('aria-busy', 'true');
                } else setButtonLoading(button, 'Saving');
                await runNetworkOperation(field === 'forcedState' ? 'Updating forced state' : 'Updating tool access', () =>
                    getRoleEngine().setToolPermission(userId, toolId, { [field]: nextValue }), metadata
                );
            } else if (action === 'save-allowed-users') {
                const toolId = button.dataset.tool;
                const draft = visibilityDraft;
                if (!draft || draft.toolId !== toolId) throw new Error('No allowed-user changes are available to apply.');
                if (getPendingVisibility(toolId)) return;
                const record = draft.allUsers
                    ? { visibility: 'PUBLIC', allowedUsers: [] }
                    : { visibility: 'SELECTED_USERS', allowedUsers: [...draft.allowedUsers] };
                optimisticVisibility.set(toolId, record);
                pendingVisibilitySubmissions.add(toolId);
                visibilityDraft = null;
                openVisibilityToolId = null;
                closeDropdowns(null);
                render();
                const metadata = { action: 'UPDATE_VISIBILITY', targetToolIds: [toolId], summary: 'UPDATE VISIBILITY · ' + toolId };
                try {
                    await runNetworkOperation('Saving allowed users', () => getRoleEngine().setToolVisibility(toolId, record), metadata);
                } finally {
                    pendingVisibilitySubmissions.delete(toolId);
                    render();
                }
            } else if (action === 'add-announcement') {
                openAnnouncementModal();
            } else if (action === 'edit-announcement') {
                const post = (context.announcements?.getPosts?.() || []).find(item => item.id === button.dataset.id);
                if (!post) throw new Error('Announcement was not found.');
                openAnnouncementModal(post);
            } else if (action === 'delete-announcement') {
                const post = (context.announcements?.getPosts?.() || []).find(item => item.id === button.dataset.id);
                if (!post) throw new Error('Announcement was not found.');
                openConfirmDialog('Delete Announcement', 'Delete this announcement?', 'Delete', async () => {
                    await context.announcements.deletePost(post.id);
                    await context.announcements.load();
                    render();
                    showNotice('Announcement deleted.');
                });
            }
        } catch (error) {
            if (button && action === 'toggle-permission') render();
            showMessageDialog('Operation Not Submitted', error?.message || 'The requested operation could not be submitted.');
        }
    };

    const getDropdownMenu = dropdown => dropdown?._ydSelectMenu || dropdown?.querySelector('.ui-select-menu') || null;

    const positionDropdownMenu = dropdown => {
        const menu = getDropdownMenu(dropdown);
        const trigger = dropdown?.querySelector('.ui-select-trigger');
        if (!menu || !trigger || menu.dataset.portal !== 'true') return;
        const rect = trigger.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const width = Math.min(Math.max(rect.width, dropdown.classList.contains('yd-allowed-users-dropdown') ? 240 : 144), viewportWidth - 24);
        const maxHeight = Math.min(dropdown.classList.contains('yd-announcement-cycle-select') ? 260 : 320, viewportHeight - 24);
        const menuHeight = Math.min(menu.scrollHeight || maxHeight, maxHeight);
        const roomBelow = viewportHeight - rect.bottom - 12;
        const roomAbove = rect.top - 12;
        const openAbove = roomBelow < Math.min(menuHeight, 180) && roomAbove > roomBelow;
        const left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12));
        const top = openAbove
            ? Math.max(12, rect.top - menuHeight - 4)
            : Math.max(12, Math.min(rect.bottom + 4, viewportHeight - menuHeight - 12));
        menu.style.setProperty('position', 'fixed', 'important');
        menu.style.setProperty('left', left + 'px', 'important');
        menu.style.setProperty('top', top + 'px', 'important');
        menu.style.setProperty('width', width + 'px', 'important');
        menu.style.setProperty('min-width', width + 'px', 'important');
        menu.style.setProperty('max-width', 'calc(100vw - 24px)', 'important');
        menu.style.setProperty('max-height', maxHeight + 'px', 'important');
        menu.style.setProperty('z-index', '2147483647', 'important');
    };

    const openDropdownMenu = dropdown => {
        const menu = getDropdownMenu(dropdown);
        const trigger = dropdown?.querySelector('.ui-select-trigger');
        if (!menu || !trigger) return;
        dropdown._ydSelectMenu = menu;
        menu._ydSelectOwner = dropdown;
        menu.dataset.portal = 'true';
        menu.classList.add('yd-select-portal-menu');
        menu.hidden = false;
        document.body.appendChild(menu);
        positionDropdownMenu(dropdown);
    };

    const closeDropdownMenu = dropdown => {
        const menu = getDropdownMenu(dropdown);
        if (menu) {
            menu.hidden = true;
            menu.removeAttribute('data-portal');
            menu.classList.remove('yd-select-portal-menu');
            menu.style.cssText = '';
            if (menu.parentElement !== dropdown) dropdown.appendChild(menu);
            delete menu._ydSelectOwner;
        }
        dropdown.dataset.open = 'false';
        dropdown.classList.remove('open');
        dropdown.querySelector('.ui-select-trigger')?.setAttribute('aria-expanded', 'false');
    };

    const closeDropdowns = except => {
        document.querySelectorAll('#' + CONFIG.ID + ' .ui-select[data-open="true"]').forEach(dropdown => {
            if (dropdown === except) return;
            closeDropdownMenu(dropdown);
        });
    };

    const handleAllowedUsersAction = actionButton => {
        if (actionButton?.dataset.action === 'toggle-allowed-all') {
            const toolId = actionButton.dataset.tool;
            if (!visibilityDraft || visibilityDraft.toolId !== toolId || getPendingVisibility(toolId)) return true;
            visibilityDraft.allUsers = !visibilityDraft.allUsers;
            visibilityDraft.allowedUsers = visibilityDraft.allUsers
                ? new Set(getRoleEngine().getUsers().map(user => String(user.id || '').trim().toUpperCase()))
                : new Set();
            openVisibilityToolId = toolId;
            refreshAllowedUsersDropdown(toolId);
            return true;
        }
        if (actionButton?.dataset.action === 'toggle-allowed-user') {
            const toolId = actionButton.dataset.tool;
            const userId = actionButton.dataset.user;
            if (getPendingVisibility(toolId)) return true;
            if (!visibilityDraft || visibilityDraft.toolId !== toolId) visibilityDraft = createVisibilityDraft(toolId);
            if (visibilityDraft.allUsers) {
                visibilityDraft.allowedUsers = new Set(getRoleEngine().getUsers().map(user => String(user.id || '').trim().toUpperCase()));
                visibilityDraft.allUsers = false;
            }
            if (visibilityDraft.allowedUsers.has(userId)) visibilityDraft.allowedUsers.delete(userId);
            else visibilityDraft.allowedUsers.add(userId);
            openVisibilityToolId = toolId;
            refreshAllowedUsersDropdown(toolId);
            return true;
        }
        if (actionButton?.dataset.action === 'cancel-allowed-users') {
            visibilityDraft = null;
            openVisibilityToolId = null;
            closeDropdowns(null);
            return true;
        }
        if (actionButton?.dataset.action === 'save-allowed-users') {
            runAction('save-allowed-users', actionButton);
            return true;
        }
        return false;
    };

    const handleDropdownSelection = (dropdown, actionButton) => {
        const hidden = dropdown?.querySelector('input[type="hidden"]');
        const menu = getDropdownMenu(dropdown);
        if (!dropdown || !hidden || !menu) return;
        const multiple = dropdown.dataset.multiple === 'true';
        const value = String(actionButton.dataset.value ?? '');
        const currentValues = multiple ? (() => {
            try { return JSON.parse(dropdown.dataset.value || '[]').map(String); } catch { return []; }
        })() : [];
        const values = multiple
            ? currentValues.includes(value) ? currentValues.filter(item => item !== value) : [...currentValues, value]
            : [value];
        const options = [...menu.querySelectorAll('.ui-select-option[data-value]')];
        const selectedOptions = options.filter(option => values.includes(String(option.dataset.value)));
        const placeholder = dropdown.dataset.placeholder || 'Select...';
        const label = selectedOptions.map(option => option.querySelector('span')?.textContent.trim() || option.textContent.trim()).join(', ');
        dropdown.dataset.value = multiple ? JSON.stringify(values) : value;
        hidden.value = multiple ? JSON.stringify(values) : value;
        const valueElement = dropdown.querySelector('.ui-select-value');
        if (valueElement) {
            valueElement.textContent = label || placeholder;
            valueElement.dataset.placeholder = String(!label);
        }
        options.forEach(option => {
            const selected = values.includes(String(option.dataset.value));
            option.dataset.selected = String(selected);
            option.setAttribute('aria-selected', String(selected));
            option.classList.toggle('selected', selected);
        });
        if (multiple) positionDropdownMenu(dropdown);
        else closeDropdowns(null);
        dropdown.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { values } }));
        if (!dropdown.hasAttribute('data-announcement-cycle')) return;
        const post = (context.announcements?.getPosts?.() || []).find(item => String(item.id) === String(dropdown.dataset.id));
        if (!post || !ANNOUNCEMENT_CYCLES.includes(value) || getAnnouncementCycle(post) === value) return;
        const trigger = dropdown.querySelector('.ui-select-trigger');
        setControlLoading(trigger);
        trackBackground((async () => {
            try {
                await context.announcements.updatePost(post.id, { body: post.body, cycle: value });
                await context.announcements.load();
                render();
                showNotice('Announcement cycle updated.');
            } catch (error) {
                render();
                showMessageDialog('Cycle Not Updated', error?.message || 'Unable to update the announcement cycle.');
            }
        })());
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
            const actionButton = event.target.closest('[data-action]');
            const dropdown = event.target.closest('.yd-dropdown');
            if (handleAllowedUsersAction(actionButton)) return;
            if (actionButton?.dataset.action === 'toggle-dropdown') {
                const opening = dropdown.dataset.open !== 'true';
                if (!opening) {
                    if (dropdown.classList.contains('yd-allowed-users-dropdown')) openVisibilityToolId = null;
                    closeDropdowns(null);
                    return;
                }
                closeDropdowns(dropdown);
                if (dropdown.classList.contains('yd-allowed-users-dropdown')) {
                    const toolId = dropdown.dataset.tool;
                    if (!visibilityDraft || visibilityDraft.toolId !== toolId) visibilityDraft = createVisibilityDraft(toolId);
                    openVisibilityToolId = toolId;
                }
                dropdown.dataset.open = 'true';
                dropdown.classList.add('open');
                dropdown.querySelector('.ui-select-trigger')?.setAttribute('aria-expanded', 'true');
                openDropdownMenu(dropdown);
                return;
            }
            if (actionButton?.dataset.action === 'select-dropdown') {
                handleDropdownSelection(dropdown, actionButton);
                return;
            }
            closeDropdowns(dropdown);
            if (event.target.id === 'yd-overlay') {
                isOpen = false;
                profileOpen = false;
                render();
                return;
            }
            if (actionButton?.dataset.action === 'toggle-my-tool') {
                event.preventDefault();
                event.stopPropagation();
                runAction(actionButton.dataset.action, actionButton);
                return;
            }
            if (actionButton?.dataset.action === 'toggle-dashboard') { isOpen = !isOpen; render(); return; }
            if (actionButton?.dataset.action === 'close-dashboard') { isOpen = false; profileOpen = false; render(); return; }
            if (actionButton?.dataset.action === 'profile-toggle') { profileOpen = !profileOpen; render(); return; }
            if (actionButton?.dataset.action === 'network-page') {
                event.preventDefault();
                networkPage = Math.max(1, Number(actionButton.dataset.page) || 1);
                render();
                return;
            }
            const nav = event.target.closest('[data-page]');
            if (nav) {
                activePage = nav.dataset.page;
                notice = null;
                profileOpen = false;
                if (activePage !== 'visibility') { visibilityDraft = null; openVisibilityToolId = null; }
                render();
                return;
            }
            if (actionButton?.dataset.action === 'refresh-connection') { runAction('refresh-connection', actionButton); return; }
            if (actionButton) runAction(actionButton.dataset.action, actionButton);
        });

        root.addEventListener('input', event => {
            if (event.target.id === 'yd-user-search' || event.target.id === 'yd-tool-search') {
                const query = event.target.value.toLowerCase();
                root.querySelectorAll('tbody tr, .yd-tool-accordion-item').forEach(row => {
                    row.hidden = !row.textContent.toLowerCase().includes(query);
                });
            }
        });

        dropdownMenuClickHandler = event => {
            const actionButton = event.target.closest?.('.ui-select-menu.yd-select-portal-menu[data-portal="true"] [data-action]');
            if (!actionButton) return;
            const menu = actionButton.closest('.ui-select-menu');
            const dropdown = menu?._ydSelectOwner;
            if (!dropdown || !root.contains(dropdown)) return;
            event._ydSelectHandled = true;
            if (handleAllowedUsersAction(actionButton)) return;
            if (actionButton.dataset.action === 'select-dropdown') {
                handleDropdownSelection(dropdown, actionButton);
                return;
            }
            runAction(actionButton.dataset.action, actionButton);
        };
        document.addEventListener('click', dropdownMenuClickHandler);

        dropdownOutsideClickHandler = event => {
            if (event._ydSelectHandled || event.target.closest?.('.ui-select-menu.yd-select-portal-menu[data-portal="true"]')) return;
            if (!root.contains(event.target)) closeDropdowns(null);
        };
        document.addEventListener('click', dropdownOutsideClickHandler);

        dropdownKeydownHandler = event => {
            if (event.key !== 'Escape') return;
            if (root.querySelector('.ui-select[data-open="true"]')) {
                closeDropdowns(null);
                return;
            }
            if (isOpen) {
                isOpen = false;
                profileOpen = false;
                render();
            }
        };
        document.addEventListener('keydown', dropdownKeydownHandler);

        dropdownScrollHandler = () => root.querySelectorAll('.ui-select[data-open="true"]').forEach(positionDropdownMenu);
        dropdownResizeHandler = () => root.querySelectorAll('.ui-select[data-open="true"]').forEach(positionDropdownMenu);
        document.addEventListener('scroll', dropdownScrollHandler, true);
        document.defaultView?.addEventListener('resize', dropdownResizeHandler);
    };

    const init = async options => {
        if (context) return true;
        if (!options || options.authenticated !== true || !options.user || !options.tools) {
            throw new Error('Authenticated dashboard context is required.');
        }
        context = options;
        const defaultPage = context.settings?.getSettings?.()?.startPage;
        activePage = defaultPage === 'overview' ? 'overview' : 'tools';
        restorePendingTransactions();
        isOpen = false;
        profileOpen = false;
        injectStyles();
        document.getElementById(CONFIG.ID)?.remove();
        const root = document.createElement('div');
        root.id = CONFIG.ID;
        document.body.appendChild(root);
        render();
        bindEvents(root);
        resumePendingTransactions();
        refreshTimer = null;
        return true;
    };

    const destroy = async () => {
        clearInterval(refreshTimer);
        refreshTimer = null;
        closeDropdowns(null);
        if (dropdownMenuClickHandler) document.removeEventListener('click', dropdownMenuClickHandler);
        if (dropdownOutsideClickHandler) document.removeEventListener('click', dropdownOutsideClickHandler);
        if (dropdownKeydownHandler) document.removeEventListener('keydown', dropdownKeydownHandler);
        if (dropdownScrollHandler) document.removeEventListener('scroll', dropdownScrollHandler, true);
        if (dropdownResizeHandler) document.defaultView?.removeEventListener('resize', dropdownResizeHandler);
        dropdownMenuClickHandler = dropdownOutsideClickHandler = dropdownKeydownHandler = dropdownScrollHandler = dropdownResizeHandler = null;
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
        pendingVisibilitySubmissions.clear();
        pendingLocalTools.clear();
        trackedTransactions.clear();
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
