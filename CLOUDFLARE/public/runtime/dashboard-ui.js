(() => {
    'use strict';

    const page = document.defaultView || window;
    if (typeof window.YODAWY_DASHBOARD_UI?.init === 'function' || typeof page.YODAWY_DASHBOARD_UI?.init === 'function') return;

    const CONFIG = Object.freeze({
        ID: 'yd-dashboard-root',
        STYLE_ID: 'yd-dashboard-styles',
        BRAND: '#875A7B',
        DARK: '#68465f',
        LIGHT: '#f8f5f7',
        REFRESH_INTERVAL: 30000
    });

    const addWindowEventListener = (type, listener, options) => {
        const method = page?.EventTarget?.prototype?.addEventListener;
        if (typeof method !== 'function') throw new Error('Native window event handling is unavailable.');
        method.call(page, type, listener, options);
    };

    const removeWindowEventListener = (type, listener, options) => {
        const method = page?.EventTarget?.prototype?.removeEventListener;
        if (typeof method !== 'function') throw new Error('Native window event handling is unavailable.');
        method.call(page, type, listener, options);
    };

    const ANNOUNCEMENT_CYCLES = Object.freeze([
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ]);

    let context = null;
    let rootElement = null;
    let portalAccounts = null;
    let portalAccountsLoading = false;
    let activePage = 'tools';
    let refreshTimer = null;
    let notice = null;
    let isOpen = false;
    let profileOpen = false;
    const expandedUsers = new Set();
    const expandedTools = new Set();
    let visibilityDraft = null;
    let openVisibilityToolId = null;
    let visibilityMode = 'USERS';
    const visibilityExpandedUsers = new Set();
    const visibilityExpandedTools = new Set();
    const optimisticVisibility = new Map();
    const pendingVisibilitySubmissions = new Set();
    const backgroundTransactions = new Set();
    const localTransactions = new Map();
    const pendingAnnouncements = new Map();
    const pendingLocalTools = new Map();
    const trackedTransactions = new Set();
    const activityItems = new Map();
    let activityMenuOpen = false;
    let activityCounter = 0;
    let networkPage = 1;
    const NETWORK_PAGE_SIZE = 10;
    let dropdownMenuClickHandler = null;
    let dropdownMenuInputHandler = null;
    let dropdownOutsideClickHandler = null;
    let dropdownKeydownHandler = null;
    let dropdownScrollHandler = null;
    let dropdownResizeHandler = null;
    let activityClickHandler = null;
    let activityClickRoot = null;

    const syncInputSurfaceBackgrounds = scope => {
        const selector = 'input:not([type="hidden"]), textarea, select, .yd-allowed-users-search';
        const controls = [...(scope?.querySelectorAll?.(selector) || [])];
        if (scope?.matches?.(selector)) controls.unshift(scope);
        controls.forEach(control => {
            let ancestor = control.parentElement;
            let background = '';
            while (ancestor) {
                const color = page.getComputedStyle(ancestor).backgroundColor.replace(/\s+/g, '').toLowerCase();
                if (color === 'rgb(255,255,255)' || color === 'rgba(255,255,255,1)') {
                    background = '#e1e1e1';
                    break;
                }
                if (color === 'rgb(225,225,225)' || color === 'rgba(225,225,225,1)') {
                    background = '#fff';
                    break;
                }
                ancestor = ancestor.parentElement;
            }
            if (background) control.style.setProperty('background-color', background, 'important');
            else control.style.removeProperty('background-color');
        });
    };

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
    const getRoleTone = value => {
        const role = String(value || 'USER').trim().toUpperCase().replace(/[\s-]+/g, '_');
        return role === 'SUPER_ADMIN' ? 'super-admin' : role === 'ADMIN' ? 'admin' : 'user';
    };
    const renderRolePill = value => '<span class="yd-pill yd-role-pill yd-role-' + getRoleTone(value) + '">' + escapeHTML(formatRole(value)) + '</span>';
    const renderRoleLabel = value => '<span class="yd-role-label yd-role-' + getRoleTone(value) + '">' + escapeHTML(formatRole(value)) + '</span>';

    const getRoleEngine = (runtimeContext = context) => {
        if (!runtimeContext) return null;
        return runtimeContext.userRole === 'SUPER_ADMIN'
            ? runtimeContext.superAdminEngine || runtimeContext.superAdmin || null
            : runtimeContext.userRole === 'ADMIN'
                ? runtimeContext.adminEngine || runtimeContext.admin || null
                : runtimeContext.userEngine || null;
    };

    const isCurrentUI = () => Boolean(context && rootElement?.isConnected && document.getElementById(CONFIG.ID) === rootElement);

    const ROLE_ACCESS = Object.freeze({
        USER: Object.freeze({
            pages: Object.freeze(['tools', 'overview', 'announcements', 'accounts', 'account']),
            actions: Object.freeze(['refresh-connection', 'save-settings', 'toggle-my-tool', 'change-password']),
            canManageAnnouncements: false,
            canManageUsers: false,
            canEditUsers: false,
            canDeleteUsers: false,
            canManageUserPermissions: false,
            canManageSharedTools: false,
            canManageVisibility: false,
            canViewNetwork: false
        }),
        ADMIN: Object.freeze({
            pages: Object.freeze(['tools', 'overview', 'announcements', 'users', 'permissions', 'accounts', 'account']),
            actions: Object.freeze(['refresh-connection', 'save-settings', 'toggle-my-tool', 'change-password', 'add-user', 'edit-user', 'delete-user', 'toggle-permission', 'add-announcement', 'edit-announcement', 'delete-announcement']),
            canManageAnnouncements: true,
            canManageUsers: true,
            canEditUsers: true,
            canDeleteUsers: true,
            canManageUserPermissions: true,
            canManageSharedTools: false,
            canManageVisibility: false,
            canViewNetwork: false
        }),
        SUPER_ADMIN: Object.freeze({
            pages: Object.freeze(['tools', 'overview', 'announcements', 'users', 'permissions', 'visibility', 'transactions', 'accounts', 'account']),
            actions: Object.freeze(['refresh-connection', 'save-settings', 'toggle-my-tool', 'change-password', 'add-user', 'edit-user', 'delete-user', 'toggle-permission', 'toggle-visibility-bulk', 'toggle-visibility', 'save-allowed-users', 'add-announcement', 'edit-announcement', 'delete-announcement']),
            canManageAnnouncements: true,
            canManageUsers: true,
            canEditUsers: true,
            canDeleteUsers: true,
            canManageUserPermissions: false,
            canManageSharedTools: true,
            canManageVisibility: true,
            canViewNetwork: true
        })
    });

    const getRoleAccess = () => ROLE_ACCESS[context?.userRole] || ROLE_ACCESS.USER;

    const getUsers = () => {
        try { return getRoleEngine()?.getUsers?.() || (context?.user ? [context.user] : []); }
        catch { return [context.user]; }
    };

    const getVisibilityUsers = () => getUsers().filter(user => String(user.role || 'USER').trim().toUpperCase() !== 'SUPER_ADMIN');

    const getTools = () => {
        try { return context.tools?.getManifest?.() || []; }
        catch { return []; }
    };

    const getLoadedTools = () => {
        try { return context.tools?.getLoadedTools?.() || []; }
        catch { return []; }
    };

    const getPendingStorageKey = () => 'yd-dashboard-pending-v1:' + String(context?.userId || context?.user?.id || context?.user?.userId || 'UNKNOWN').trim().toUpperCase();
    const getPendingAnnouncementsStorageKey = () => 'yd-dashboard-pending-announcements-v1:' + String(context?.userId || context?.user?.id || context?.user?.userId || 'UNKNOWN').trim().toUpperCase();

    const persistPendingAnnouncements = () => {
        try {
            localStorage.setItem(getPendingAnnouncementsStorageKey(), JSON.stringify([...pendingAnnouncements.values()]));
        } catch {}
    };

    const restorePendingAnnouncements = () => {
        try {
            const records = JSON.parse(localStorage.getItem(getPendingAnnouncementsStorageKey()) || '[]');
            pendingAnnouncements.clear();
            if (Array.isArray(records)) records.forEach(record => {
                if (record?.requestId && record?.id) pendingAnnouncements.set(record.requestId, record);
            });
        } catch {
            pendingAnnouncements.clear();
        }
    };

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

    const getPendingVisibility = (toolId, userId = '') => {
        const tool = String(toolId || '').trim();
        const user = String(userId || '').trim().toUpperCase();
        const transaction = getPendingTransactions().find(item => {
            if (String(item.action || '').toUpperCase() !== 'UPDATE_VISIBILITY') return false;
            if (!(item.targetToolIds || []).map(value => String(value || '').trim()).includes(tool)) return false;
            const target = String(item.targetId || item.targetUserId || '').trim().toUpperCase();
            return target ? Boolean(user) && target === user : !user;
        });
        const key = user ? tool + ':' + user : tool + ':*';
        return transaction || (pendingVisibilitySubmissions.has(key) ? { action: 'SUBMITTING' } : null);
    };

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

    const renderPendingBadge = () => '<span class="yd-pending-badge" role="status" aria-label="Loading"><span class="yd-control-spinner" aria-hidden="true"></span></span>';
    const renderFailedBadge = (label = 'FAILED') => '<span class="yd-pending-badge yd-pending-failed"><i class="fa-solid fa-circle-exclamation"></i><span>' + escapeHTML(label) + '</span></span>';
    const setButtonLoading = (button, label = 'Loading') => {
        if (!button) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.classList.add('yd-button-loading');
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

    const showNotice = () => {};

    const updateActivity = (id, changes = {}) => {
        if (!id) return;
        const current = activityItems.get(id) || {
            id,
            startedAt: Date.now(),
            status: 'RUNNING',
            statusLabel: 'ACTIVE',
            stage: 'Starting operation'
        };
        const next = { ...current, ...changes, id };
        if (Object.keys(next).every(key => next[key] === current[key])) return;
        activityItems.set(id, next);
        if (isCurrentUI()) render();
    };

    const beginActivity = (label, location = 'Dashboard', stage = 'Starting operation', id = '') => {
        const activityId = id || 'LOCAL-' + (++activityCounter);
        updateActivity(activityId, {
            label: String(label || 'Background operation'),
            location: String(location || 'Dashboard'),
            status: 'RUNNING',
            statusLabel: 'ACTIVE',
            stage,
            startedAt: activityItems.get(activityId)?.startedAt || Date.now()
        });
        return activityId;
    };

    const finishActivity = id => {
        if (!id || !activityItems.delete(id)) return;
        if (!activityItems.size) activityMenuOpen = false;
        if (isCurrentUI()) render();
    };

    const getActivityLocation = metadata => {
        const pageNames = {
            tools: 'Tools',
            overview: 'Overview',
            announcements: 'Announcements',
            users: 'Users',
            permissions: 'Permissions',
            visibility: 'Visibility',
            transactions: 'NETWORK',
            account: 'Settings'
        };
        const parts = [pageNames[activePage] || 'Dashboard'];
        const target = metadata?.targetName || metadata?.targetId;
        if (target) parts.push(String(target));
        if (metadata?.targetToolId) parts.push(String(metadata.targetToolId));
        else if (Array.isArray(metadata?.targetToolIds) && metadata.targetToolIds.length) {
            parts.push(metadata.targetToolIds.length === 1 ? String(metadata.targetToolIds[0]) : metadata.targetToolIds.length + ' tools');
        }
        return parts.join(' · ');
    };

    const trackBackground = (task, details = {}) => {
        const activityId = beginActivity(
            details.label || 'Background operation',
            details.location || 'Dashboard',
            details.stage || 'Working in the background'
        );
        backgroundTransactions.add(task);
        task.finally(() => {
            backgroundTransactions.delete(task);
            finishActivity(activityId);
        }).catch(() => {});
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
        document.getElementById('yd-nunito-font')?.remove();
        document.getElementById('yd-poppins-font')?.remove();
        ensureExternalStylesheet('yd-nunito-sans-font', 'https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,300..900&display=swap');
        ensureExternalStylesheet('yd-cairo-font', 'https://fonts.googleapis.com/css2?family=Cairo:wght@300..900&display=swap');
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
    --border: #d9d9de;
    --border-soft: #d9d9de;
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
    font: 400 12px/1.45 'Nunito Sans', 'Cairo', system-ui, -apple-system, sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
}
#yd-dashboard-root *:not(.yd-custom-icon), #yd-dashboard-root *:not(.yd-custom-icon)::before, #yd-dashboard-root *:not(.yd-custom-icon)::after {
    box-sizing: border-box;
    font-family: 'Nunito Sans', 'Cairo', system-ui, -apple-system, sans-serif !important;
}
@font-face {
    font-family: 'YD Dashboard Icons';
    src: url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/webfonts/fa-solid-900.woff2') format('woff2'), url('https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/webfonts/fa-solid-900.woff2') format('woff2');
    font-style: normal;
    font-weight: 900;
    font-display: block;
}
#yd-dashboard-root .yd-custom-icon {
    font-family: 'YD Dashboard Icons' !important;
    font-weight: 900 !important;
    font-style: normal !important;
    font-variant: normal !important;
}
#yd-dashboard-root .yd-custom-icon.fa-spinner::before { content: '\f110'; }
#yd-dashboard-root .yd-custom-icon.fa-circle-exclamation::before { content: '\f06a'; }
#yd-dashboard-root .yd-custom-icon.fa-toolbox::before { content: '\f552'; }
#yd-dashboard-root .yd-custom-icon.fa-chart-pie::before { content: '\f200'; }
#yd-dashboard-root .yd-custom-icon.fa-bullhorn::before { content: '\f0a1'; }
#yd-dashboard-root .yd-custom-icon.fa-users::before { content: '\f0c0'; }
#yd-dashboard-root .yd-custom-icon.fa-sliders::before { content: '\f1de'; }
#yd-dashboard-root .yd-custom-icon.fa-eye::before { content: '\f06e'; }
#yd-dashboard-root .yd-custom-icon.fa-right-left::before { content: '\f362'; }
#yd-dashboard-root .yd-custom-icon.fa-gear::before { content: '\f013'; }
#yd-dashboard-root .yd-custom-icon.fa-user-shield::before { content: '\f505'; }
#yd-dashboard-root .yd-custom-icon.fa-arrows-rotate::before { content: '\f021'; }
#yd-dashboard-root .yd-custom-icon.fa-cloud-arrow-up::before { content: '\f0ee'; }
#yd-dashboard-root .yd-custom-icon.fa-xmark::before { content: '\f00d'; }
#yd-dashboard-root .yd-custom-icon.fa-circle-info::before { content: '\f05a'; }
#yd-dashboard-root .yd-custom-icon.fa-check::before { content: '\f00c'; }
#yd-dashboard-root .yd-custom-icon.fa-arrow-rotate-right::before { content: '\f01e'; }
#yd-dashboard-root .yd-custom-icon.fa-shield-halved::before { content: '\f3ed'; }
#yd-dashboard-root .yd-custom-icon.fa-bolt::before { content: '\f0e7'; }
#yd-dashboard-root .yd-custom-icon.fa-cloud::before { content: '\f0c2'; }
#yd-dashboard-root .yd-custom-icon.fa-user::before { content: '\f007'; }
#yd-dashboard-root .yd-custom-icon.fa-plug-circle-check::before { content: '\e55c'; }
#yd-dashboard-root .yd-custom-icon.fa-plus::before { content: '\f067'; }
#yd-dashboard-root .yd-custom-icon.fa-square-check::before { content: '\f14a'; }
#yd-dashboard-root .yd-custom-icon.fa-square::before { content: '\f0c8'; }
#yd-dashboard-root .yd-custom-icon.fa-database::before { content: '\f1c0'; }
#yd-dashboard-root .yd-custom-icon.fa-lock::before { content: '\f023'; }
#yd-dashboard-root .yd-custom-icon.fa-key::before { content: '\f084'; }
#yd-dashboard-root .yd-custom-icon.fa-circle-check::before { content: '\f058'; }
#yd-dashboard-root .fa-spin { animation: yd-fa-spin 2s linear infinite; }
@keyframes yd-fa-spin { to { transform: rotate(360deg); } }

#yd-dashboard-root :lang(ar):not(.fa-solid):not(.fas):not(.fa-regular):not(.far):not(.fa-brands):not(.fab),
#yd-dashboard-root [dir="rtl"]:not(.fa-solid):not(.fas):not(.fa-regular):not(.far):not(.fa-brands):not(.fab),
#yd-dashboard-root [dir="rtl"] :not(.fa-solid):not(.fas):not(.fa-regular):not(.far):not(.fa-brands):not(.fab),
body > .ui-select-menu.yd-select-portal-menu :lang(ar):not(.fa-solid):not(.fas):not(.fa-regular):not(.far):not(.fa-brands):not(.fab),
body > .ui-select-menu.yd-select-portal-menu [dir="rtl"]:not(.fa-solid):not(.fas):not(.fa-regular):not(.far):not(.fa-brands):not(.fab) {
    font-family: 'Cairo', sans-serif !important;
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
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--canvas);
    color: var(--ink);
    box-shadow: 0 28px 80px #17131c40;
}

#yd-dashboard-root #yd-header {
    position: relative;
    z-index: 50;
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
#yd-dashboard-root .yd-activity-wrap { position: relative; z-index: 20; display: inline-flex; align-items: center; }
#yd-dashboard-root .yd-activity-trigger {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 92px;
    min-height: 34px;
    padding: 4px 8px;
    border: 1px solid #e6dbe3;
    border-radius: 9px;
    background: #faf7fa;
    color: var(--ink);
    cursor: pointer;
    text-align: left;
}
#yd-dashboard-root .yd-activity-spinner,
#yd-dashboard-root .yd-activity-item-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    border: 2px solid var(--brand);
    border-right-color: transparent;
    border-radius: 50%;
    animation: yd-control-spin .72s linear infinite;
}
#yd-dashboard-root .yd-activity-trigger-copy { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
#yd-dashboard-root .yd-activity-trigger-copy strong { color: var(--brand-dark); font-size: 9px; font-weight: 800 !important; line-height: 1.2; white-space: nowrap; }
#yd-dashboard-root .yd-activity-trigger-copy small { max-width: 132px; overflow: hidden; color: var(--muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
#yd-dashboard-root .yd-activity-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--brand);
    color: #fff;
    font-size: 9px;
    font-weight: 800 !important;
}
#yd-dashboard-root .yd-activity-dropdown {
    position: absolute;
    top: calc(100% + 11px);
    right: 0;
    z-index: 2147483010;
    display: flex;
    flex-direction: column;
    width: min(410px, calc(100vw - 28px));
    max-height: min(540px, calc(100vh - 105px));
    overflow: hidden;
    border: 1px solid #e6dfe5;
    border-radius: 14px;
    background: #fff;
    color: var(--ink);
    box-shadow: 0 12px 38px rgba(34, 21, 35, .18), 0 2px 8px rgba(34, 21, 35, .08);
    transform-origin: top right;
    animation: yd-select-dropdown-drop .24s cubic-bezier(.16, 1, .3, 1) both;
}
#yd-dashboard-root .yd-activity-dropdown[hidden] { display: none !important; }
#yd-dashboard-root .yd-activity-menu-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px 15px 13px;
    border-bottom: 1px solid #eee9ed;
    background: #fff;
}
#yd-dashboard-root .yd-activity-menu-heading { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 3px; }
#yd-dashboard-root .yd-activity-menu-head strong { color: #25212a; font-size: 13px; font-weight: 750 !important; }
#yd-dashboard-root .yd-activity-menu-head small { color: #85808a; font-size: 10px; }
#yd-dashboard-root .yd-activity-menu-total {
    flex: 0 0 auto;
    padding: 5px 8px;
    border: 1px solid #eadfea;
    border-radius: 999px;
    background: #faf6fa;
    color: var(--brand-dark);
    font-size: 9px;
    font-weight: 800 !important;
    white-space: nowrap;
}
#yd-dashboard-root .yd-activity-menu-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 27px;
    height: 27px;
    flex: 0 0 27px;
    padding: 0;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: #77717b;
    cursor: pointer;
}
#yd-dashboard-root .yd-activity-menu-close:hover { background: #f2edf2; color: var(--brand-dark); }
#yd-dashboard-root .yd-activity-list { overflow: auto; overscroll-behavior: contain; padding: 3px 12px; }
#yd-dashboard-root .yd-activity-item { display: flex; align-items: flex-start; gap: 11px; padding: 13px 3px; border-bottom: 1px solid #f0edf0; }
#yd-dashboard-root .yd-activity-item:last-child { border-bottom: 0; }
#yd-dashboard-root .yd-activity-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    border: 1px solid #eee5ed;
    border-radius: 10px;
    background: #faf6fa;
    color: var(--brand);
    font-size: 14px;
}
#yd-dashboard-root .yd-activity-item-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 5px; }
#yd-dashboard-root .yd-activity-item-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
#yd-dashboard-root .yd-activity-item-copy strong { overflow: hidden; color: #29252d; font-size: 11px; font-weight: 750 !important; text-overflow: ellipsis; white-space: nowrap; }
#yd-dashboard-root .yd-activity-item-copy small { overflow: hidden; color: #817b85; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
#yd-dashboard-root .yd-activity-item-stage { color: #62596a; font-size: 9px; line-height: 1.45; }
#yd-dashboard-root .yd-activity-item-status { flex: 0 0 auto; padding: 3px 6px; border-radius: 999px; background: #f3edf4; color: var(--brand-dark); font-size: 8px; font-weight: 800 !important; white-space: nowrap; }
#yd-dashboard-root .yd-activity-progress {
    position: relative;
    height: 3px;
    overflow: hidden;
    border-radius: 999px;
    background: #eee9ef;
}
#yd-dashboard-root .yd-activity-progress span {
    position: absolute;
    inset: 0 auto 0 0;
    width: 36%;
    border-radius: inherit;
    background: var(--brand);
    animation: yd-activity-progress 1.7s ease-in-out infinite;
}
@keyframes yd-activity-progress {
    0% { transform: translateX(-110%); }
    100% { transform: translateX(310%); }
}
#yd-dashboard-root .yd-activity-menu-foot {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 14px;
    border-top: 1px solid #eee9ed;
    background: #fbfafb;
    color: #817b85;
    font-size: 9px;
}
#yd-dashboard-root .yd-activity-menu-foot i { color: var(--brand); }
@media (max-width: 620px) {
    #yd-dashboard-root .yd-activity-trigger { min-width: 35px; justify-content: center; padding: 4px 6px; }
    #yd-dashboard-root .yd-activity-trigger-copy { display: none; }
    #yd-dashboard-root .yd-activity-dropdown { right: 0; width: min(390px, calc(100vw - 20px)); max-height: calc(100vh - 95px); }
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
#yd-dashboard-root #yd-profile-trigger:focus,
#yd-dashboard-root #yd-profile-trigger:focus-visible,
#yd-dashboard-root #yd-profile-trigger:active {
    border: 0 !important;
    outline: none !important;
    box-shadow: none !important;
    -webkit-tap-highlight-color: transparent;
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
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: #fff;
    color: var(--ink);
    box-shadow: 0 0 16px 2px rgba(0, 0, 0, .12), 0 0 0 1px rgba(135, 90, 123, .08);
    animation: yd-dropdown-enter .13s cubic-bezier(.2, .8, .2, 1) both;
}
#yd-dashboard-root .yd-profile-menu[hidden] { display: none !important; }
#yd-dashboard-root .yd-gb-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 0 8px;
    padding: 12px 10px 13px;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 8px;
    background: #faf9fb;
    text-align: center;
}
#yd-dashboard-root .yd-gb-ring-lg {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 54px;
    height: 54px;
    margin-bottom: 8px;
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
#yd-dashboard-root .yd-gb-name { color: var(--ink); font-size: 14px; font-weight: 700 !important; line-height: 1.4; }
#yd-dashboard-root .yd-gb-meta { margin-top: 4px; color: var(--muted); font-size: 11px; line-height: 1.4; }
#yd-dashboard-root .yd-gb-pills { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 9px; flex-wrap: wrap; }
#yd-dashboard-root .yd-dropdown-action {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-height: 38px;
    margin-top: 0;
    padding: 6px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    transition: background-color .18s ease, color .18s ease, transform .18s ease;
}
#yd-dashboard-root .yd-dropdown-action:hover { background: var(--brand-soft); color: var(--brand-dark); }
#yd-dashboard-root .yd-profile-menu .yd-dropdown-action:hover,
#yd-dashboard-root .yd-profile-menu .yd-dropdown-action:focus-visible {
    background: #e9dfea !important;
    color: #68465f !important;
    outline: none !important;
}
#yd-dashboard-root .yd-profile-menu .yd-dropdown-action:hover .yd-action-icon,
#yd-dashboard-root .yd-profile-menu .yd-dropdown-action:focus-visible .yd-action-icon {
    border-color: #875a7b;
    background: #875a7b;
    color: #fff;
}
#yd-dashboard-root .yd-action-icon { transition: background-color .18s ease, border-color .18s ease, color .18s ease, transform .18s ease; }
#yd-dashboard-root .yd-dropdown-action:hover .yd-action-icon { transform: translateX(2px); }
#yd-dashboard-root .yd-action-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 25px;
    height: 25px;
    flex: 0 0 25px;
    border: 1px solid var(--border);
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
    border-color: var(--border);
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
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #f7f2f7;
    color: var(--brand);
    font-size: 12px;
    transition: background-color .18s ease, border-color .18s ease, color .18s ease, transform .18s ease;
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
    background: #e1e1e1;
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

body > .yd-modal-backdrop .yd-primary, #yd-dashboard-root .yd-primary, #yd-dashboard-root .yd-secondary, #yd-dashboard-root .yd-danger {
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
body > .yd-modal-backdrop .yd-primary, #yd-dashboard-root .yd-primary {
    border: 1px solid var(--brand);
    background: var(--brand);
    color: #fff;
    box-shadow: 0 2px 5px #875a7b1a;
}
body > .yd-modal-backdrop .yd-primary:hover, #yd-dashboard-root .yd-primary:hover {
    border-color: var(--brand-dark);
    background: var(--brand-dark);
    box-shadow: 0 3px 8px #68465f24;
}
#yd-dashboard-root .yd-secondary { border: 1px solid var(--border); background: #fff; color: var(--brand-dark); }
#yd-dashboard-root .yd-secondary:hover { border-color: #d8c7d7; background: var(--brand-soft); }
#yd-dashboard-root .yd-danger { border: 1px solid var(--danger-border); background: var(--danger-bg); color: var(--danger); }
#yd-dashboard-root .yd-danger:hover { border-color: #e7bec2; background: #f9e7e8; }

#yd-dashboard-root .yd-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 11px; margin-bottom: 14px; }
#yd-dashboard-root .yd-card {
    min-width: 0;
    margin-bottom: 12px;
    padding: 14px;
    border: 1px solid var(--border);
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
    border: 1px solid var(--border);
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
    border: 1px solid var(--brand);
    border-radius: 9px;
    background: var(--brand);
    color: #fff;
    font-size: 14px;
}
#yd-dashboard-root .yd-kpi-icon.blue { border-color: var(--info); background: var(--info); color: #fff; }
#yd-dashboard-root .yd-kpi-icon.green { border-color: var(--success); background: var(--success); color: #fff; }
#yd-dashboard-root .yd-kpi-icon.purple { border-color: var(--brand); background: var(--brand); color: #fff; }
#yd-dashboard-root .yd-kpi-icon.amber { border-color: var(--warning); background: var(--warning); color: #fff; }
#yd-dashboard-root .yd-info-grid .yd-title-icon {
    border-color: var(--brand);
    background: var(--brand);
    color: #fff;
}
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
    border: 1px solid var(--border);
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
    border: 0;
    border-radius: 0;
    background: #fff;
    box-shadow: none;
}
#yd-dashboard-root .yd-table-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 45px;
    padding: 8px 13px;
    border-bottom: 1px solid var(--border);
    background: #fff;
    flex-wrap: wrap;
}
#yd-dashboard-root .yd-table-card-title { display: flex; align-items: center; gap: 8px; color: var(--ink); font-size: 12px; font-weight: 700 !important; }
#yd-dashboard-root .yd-table-responsive { width: 100%; overflow-x: auto; }
#yd-dashboard-root table { width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 12px; }
#yd-dashboard-root thead th {
    height: 38px;
    padding: 0 12px;
    border-bottom: 1px solid #d8c9dc;
    background: #e9dfea;
    color: #68465f;
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
#yd-dashboard-root tbody tr:nth-child(even) td, #yd-dashboard-root tbody tr:nth-child(even) th { background: #fff; }
#yd-dashboard-root tbody tr:hover td, #yd-dashboard-root tbody tr:hover th { background: #faf8fb; }

#yd-dashboard-root .yd-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 21px;
    padding: 2px 8px;
    border: 1px solid var(--border);
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
    border: 1px solid var(--border);
    border-radius: 7px;
    background: #f7f2f6;
    color: var(--brand-dark);
    font-family: 'Nunito Sans', 'Cairo', system-ui, -apple-system, sans-serif !important;
    font-size: 10px;
    font-weight: 600 !important;
}

#yd-dashboard-root .yd-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 9px; flex-wrap: wrap; margin: 0 0 11px; }
#yd-dashboard-root .yd-search, #yd-dashboard-root .yd-field input, #yd-dashboard-root .yd-input {
    width: min(340px, 100%);
    min-width: 0;
    height: 36px;
    min-height: 36px;
    padding: 0 11px;
    border: 1px solid var(--border);
    border-radius: 8px;
    outline: none;
    background: #fff;
    color: var(--ink);
    font-size: 12px;
    transition: border-color .15s, box-shadow .15s;
}
#yd-dashboard-root .yd-search { flex: 0 1 340px; max-width: 100%; }
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

body > .yd-modal-backdrop {
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
body > .yd-modal-backdrop .yd-modal {
    width: min(560px, 100%);
    padding: 22px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 24px 70px #17131c38;
    animation: yd-modal-enter .18s cubic-bezier(.2, .8, .2, 1) both;
}
body > .yd-modal-backdrop .yd-modal h3 { margin: 0 0 14px; color: var(--ink); font-size: 16px; font-weight: 700 !important; letter-spacing: -.02em; }
body > .yd-modal-backdrop .yd-modal-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--border-soft); }
body > .yd-modal-backdrop .yd-confirm-modal { width: min(430px, 100%); padding: 22px; }
body > .yd-modal-backdrop .yd-confirm-modal p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
body > .yd-modal-backdrop .yd-message-icon {
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
body > .yd-modal-backdrop .yd-message-icon.success, #yd-dashboard-root .yd-message-icon.success { border-color: var(--success-border); background: var(--success-bg); color: var(--success); }

#yd-dashboard-root .yd-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 38px;
    height: 22px;
    padding: 3px;
    border: 0;
    border-radius: 999px;
    background: #aaaaaa;
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
    transition: transform .18s cubic-bezier(.2, .8, .2, 1), box-shadow .16s ease;
}
#yd-dashboard-root .yd-switch.on .yd-switch-knob { transform: translateX(16px); }
#yd-dashboard-root .yd-switch:disabled { opacity: .5; cursor: not-allowed; }

#yd-dashboard-root .yd-icon-btn {
    display: inline-grid;
    place-items: center;
    flex: 0 0 30px;
    width: 30px;
    min-width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
    color: var(--brand);
    line-height: 1;
    cursor: pointer;
    transition: background-color .18s ease, border-color .18s ease, color .18s ease, transform .18s ease, box-shadow .18s ease;
}
#yd-dashboard-root .yd-icon-btn > .yd-action-svg {
    display: block !important;
    width: 16px !important;
    min-width: 16px !important;
    height: 16px !important;
    min-height: 16px !important;
    overflow: visible !important;
    opacity: 1 !important;
    visibility: visible !important;
}
#yd-dashboard-root .yd-icon-btn > .yd-action-svg path {
    fill: none !important;
    stroke: currentColor !important;
    stroke-width: 2 !important;
    stroke-linecap: round !important;
    stroke-linejoin: round !important;
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
    font-family: 'Nunito Sans', 'Cairo', system-ui, -apple-system, sans-serif !important;
    font-size: 10.5px;
    text-overflow: ellipsis;
    vertical-align: middle;
}

#yd-dashboard-root .yd-tool-accordion-list {
    padding-bottom: 20px;
}

#yd-dashboard-root .yd-accordion-list,
#yd-dashboard-root .yd-tool-accordion-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: visible;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
}
#yd-dashboard-root .yd-accordion-list .yd-accordion-item,
#yd-dashboard-root .yd-tool-accordion-list .yd-tool-accordion-item {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: #fff;
    box-shadow: 0 2px 5px #29242e08;
}
#yd-dashboard-root .yd-accordion-item + .yd-accordion-item > summary,
#yd-dashboard-root .yd-tool-accordion-item + .yd-tool-accordion-item > summary {
    border-top: 0;
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
    transition: background-color .18s ease, color .18s ease, border-color .18s ease;
}
#yd-dashboard-root .yd-accordion-list .yd-accordion-item > summary,
#yd-dashboard-root .yd-accordion-list .yd-accordion-item > summary:hover,
#yd-dashboard-root .yd-accordion-list .yd-accordion-item[open] > summary {
    background: #fff !important;
}
#yd-dashboard-root .yd-accordion-item > summary,
#yd-dashboard-root .yd-tool-accordion-item > summary { padding-right: 38px; }
#yd-dashboard-root .yd-accordion-item > summary::-webkit-details-marker,
#yd-dashboard-root .yd-tool-accordion-item > summary::-webkit-details-marker { display: none; }
#yd-dashboard-root .yd-accordion-item > summary:hover { background: #ebe3ed !important; }
#yd-dashboard-root .yd-accordion-item[open] > summary { background: #ebe3ed !important; }
#yd-dashboard-root .yd-tool-accordion-item > summary,
#yd-dashboard-root .yd-tool-accordion-item > summary:hover,
#yd-dashboard-root .yd-tool-accordion-item[open] > summary { background: #fff !important; }
#yd-dashboard-root .yd-accordion-item > summary::after,
#yd-dashboard-root .yd-tool-accordion-item > summary::after {
    position: absolute;
    right: 16px;
    width: 7px;
    height: 7px;
    border-right: 2px solid var(--muted);
    border-bottom: 2px solid var(--muted);
    content: '';
    transform: rotate(45deg);
    transition: transform .18s ease, border-color .18s ease;
}
#yd-dashboard-root .yd-accordion-item[open] > summary::after,
#yd-dashboard-root .yd-tool-accordion-item[open] > summary::after { transform: rotate(225deg); }
#yd-dashboard-root .yd-accordion-item > summary:hover::after,
#yd-dashboard-root .yd-tool-accordion-item > summary:hover::after { border-color: var(--brand); }
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
#yd-dashboard-root details.yd-accordion-item,
#yd-dashboard-root details.yd-tool-accordion-item,
#yd-dashboard-root details.yd-visibility-accordion-item {
    interpolate-size: allow-keywords;
}
@supports selector(details::details-content) {
    #yd-dashboard-root details.yd-accordion-item::details-content,
    #yd-dashboard-root details.yd-tool-accordion-item::details-content,
    #yd-dashboard-root details.yd-visibility-accordion-item::details-content {
        display: block;
        block-size: 0;
        min-block-size: 0;
        overflow: hidden;
        transition: block-size .32s cubic-bezier(.2, .8, .2, 1), content-visibility .32s allow-discrete;
    }
    #yd-dashboard-root details.yd-accordion-item[open]::details-content,
    #yd-dashboard-root details.yd-tool-accordion-item[open]::details-content,
    #yd-dashboard-root details.yd-visibility-accordion-item[open]::details-content {
        block-size: auto;
    }
}
#yd-dashboard-root .yd-visibility-modes {
    position: relative;
    display: flex;
    align-items: center;
    gap: 3px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    margin: 0 0 16px;
    padding: 4px;
    overflow: hidden;
    border: 1px solid #e5dce6;
    border-radius: 10px;
    background: #f4eff4;
    box-shadow: inset 0 1px 2px rgba(41, 36, 46, .04);
}
#yd-dashboard-root .yd-visibility-modes::before {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 5px;
    width: calc(50% - 6.5px);
    border-radius: 7px;
    background: var(--brand);
    box-shadow: 0 2px 5px rgba(104, 70, 95, .2);
    content: '';
    pointer-events: none;
    transform: translateX(0);
    transition: transform .28s cubic-bezier(.2, .8, .2, 1);
}
#yd-dashboard-root .yd-visibility-modes[data-active-mode="TOOLS"]::before {
    transform: translateX(calc(100% + 3px));
}
#yd-dashboard-root .yd-visibility-mode-card {
    position: relative;
    z-index: 1;
    display: inline-flex;
    flex: 1 1 50%;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 50%;
    min-width: 0;
    min-height: 36px;
    padding: 7px 16px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent !important;
    color: #756b77;
    cursor: pointer;
    transition: color .24s ease, border-color .24s ease;
}
#yd-dashboard-root .yd-visibility-mode-card:hover:not(.active) { color: #68465f; }
#yd-dashboard-root .yd-visibility-mode-card.active {
    border-color: transparent;
    background: transparent !important;
    color: #fff;
}
#yd-dashboard-root .yd-visibility-mode-card:focus,
#yd-dashboard-root .yd-visibility-mode-card:focus-visible,
#yd-dashboard-root .yd-visibility-mode-card:active {
    border-color: transparent !important;
    outline: none !important;
    box-shadow: none !important;
    background: transparent !important;
    -webkit-tap-highlight-color: transparent;
}
#yd-dashboard-root .yd-visibility-mode-icon {
    display: inline-grid;
    place-items: center;
    color: inherit;
    font-size: 13px;
}
#yd-dashboard-root .yd-visibility-mode-copy {
    display: inline-flex;
    align-items: center;
    min-width: 0;
}
#yd-dashboard-root .yd-visibility-mode-copy strong {
    color: inherit;
    font-size: 11px;
    font-weight: 800 !important;
    letter-spacing: .045em;
}
#yd-dashboard-root .yd-visibility-mode-check { display: none; }
#yd-dashboard-root .yd-visibility-mode-card:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
}
#yd-dashboard-root .yd-visibility-bulk {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7px;
    flex: 0 0 auto;
    white-space: nowrap;
}
#yd-dashboard-root .yd-visibility-bulk-label {
    color: var(--muted);
    font-size: 9px;
    font-weight: 800 !important;
    letter-spacing: .035em;
}
#yd-dashboard-root .yd-visibility-bulk-switch { flex: 0 0 38px; }
#yd-dashboard-root .yd-visibility-accordion-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
#yd-dashboard-root .yd-visibility-accordion-item {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: #fff;
    box-shadow: 0 2px 5px #29242e08;
}
#yd-dashboard-root .yd-visibility-accordion-item > summary {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 58px;
    padding: 9px 42px 9px 13px;
    background: #fff;
    color: var(--ink);
    cursor: pointer;
    list-style: none;
    transition: background-color .18s ease;
}
#yd-dashboard-root .yd-visibility-accordion-item > summary::-webkit-details-marker { display: none; }
#yd-dashboard-root .yd-visibility-accordion-item > summary:hover,
#yd-dashboard-root .yd-visibility-accordion-item[open] > summary { background: #f8f5f7; }
#yd-dashboard-root .yd-visibility-accordion-item > summary::after {
    position: absolute;
    right: 17px;
    width: 7px;
    height: 7px;
    border-right: 2px solid var(--muted);
    border-bottom: 2px solid var(--muted);
    content: '';
    transform: rotate(45deg);
    transition: transform .18s ease, border-color .18s ease;
}
#yd-dashboard-root .yd-visibility-accordion-item[open] > summary::after {
    border-color: var(--brand);
    transform: rotate(225deg);
}
#yd-dashboard-root .yd-visibility-accordion-item > summary:hover::after { border-color: var(--brand); }
#yd-dashboard-root .yd-visibility-accordion-heading {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}
#yd-dashboard-root .yd-visibility-accordion-heading strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#yd-dashboard-root .yd-visibility-accordion-heading small {
    color: var(--muted);
    font-size: 10px;
}
#yd-dashboard-root .yd-visibility-accordion-meta {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7px;
    flex: 0 0 auto;
}
#yd-dashboard-root .yd-visibility-rows {
    margin: 0 10px 10px;
    padding: 4px 10px;
    border: 1px solid var(--border-soft);
    border-radius: 9px;
    background: #fff;
}
#yd-dashboard-root .yd-visibility-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 51px;
    margin: 4px 0;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: #e1e1e1;
}
#yd-dashboard-root .yd-visibility-row:last-child { border-bottom: 0; }
#yd-dashboard-root .yd-visibility-row-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
}
#yd-dashboard-root .yd-visibility-row-main strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#yd-dashboard-root .yd-visibility-row-main small {
    color: var(--muted);
    font-size: 9.5px;
}
#yd-dashboard-root .yd-visibility-row-control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 0 0 auto;
}
#yd-dashboard-root .yd-visibility-switch.is-loading { cursor: wait; }
#yd-dashboard-root .yd-visibility-switch:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 3px;
}
#yd-dashboard-root .yd-accordion-item > summary::after,
#yd-dashboard-root .yd-tool-accordion-item > summary::after,
#yd-dashboard-root .yd-visibility-accordion-item > summary::after {
    transition: transform .32s cubic-bezier(.22, .8, .2, 1), border-color .32s ease;
}
@media (max-width: 620px) {
    #yd-dashboard-root .yd-visibility-modes { display: flex; width: 100%; }
    #yd-dashboard-root .yd-visibility-mode-card { flex: 1; min-width: 0; min-height: 36px; padding: 7px 10px; }
    #yd-dashboard-root .yd-visibility-row { align-items: flex-start; }
    #yd-dashboard-root .yd-visibility-row-control { padding-top: 4px; }
    #yd-dashboard-root .yd-visibility-accordion-meta { flex-wrap: wrap; }
}

#yd-dashboard-root .yd-permission-search-wrap {
    display: flex;
    justify-content: flex-start;
    width: 100%;
    margin: 0 0 10px;
}
#yd-dashboard-root .yd-permission-search {
    box-sizing: border-box;
    width: 50%;
    min-width: 220px;
    max-width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #f8f5f7;
    color: #18181b;
    font-size: 11.5px;
    transition: border-color .15s, background-color .15s, box-shadow .15s;
}
#yd-dashboard-root .yd-permission-search::placeholder { color: #8b838d; }
#yd-dashboard-root .yd-permission-search:focus {
    border-color: var(--brand);
    outline: none !important;
    box-shadow: 0 0 0 2px rgba(135, 90, 123, .12);
}
#yd-dashboard-root .yd-permission-search-empty {
    margin: 8px 0;
    color: var(--muted);
    font-size: 11px;
    text-align: center;
}
#yd-dashboard-root .yd-permission-row[hidden] { display: none !important; }
#yd-dashboard-root .yd-permission-search-wrap + .yd-permission-search-empty[hidden] { display: none !important; }
#yd-dashboard-root .yd-permission-row {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(300px, 1.2fr);
    align-items: center;
    gap: 10px;
    margin: 0 0 10px;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: #e1e1e1;
}
#yd-dashboard-root .yd-permission-row:last-child { margin-bottom: 0; }
#yd-dashboard-root .yd-permission-row.is-pending { border-color: #ead7a9; background: #fffcf5; }
#yd-dashboard-root .yd-permission-tool { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
#yd-dashboard-root .yd-permission-tool strong { color: var(--ink); font-size: 11.5px; }
#yd-dashboard-root .yd-permission-tool > span { color: var(--muted); font-family: 'Nunito Sans', 'Cairo', system-ui, -apple-system, sans-serif !important; font-size: 10px; }
#yd-dashboard-root .yd-permission-controls { display: flex; align-items: center; justify-content: flex-end; gap: 18px; flex-wrap: wrap; }
#yd-dashboard-root .yd-permission-control { display: flex; align-items: center; gap: 6px; min-width: 132px; }
#yd-dashboard-root .yd-permission-label { min-width: 75px; color: var(--muted); font-size: 10px; font-weight: 600 !important; }
#yd-dashboard-root .yd-permission-status-dot { display: inline-block; width: 5px; height: 5px; flex: 0 0 5px; border-radius: 50%; background: #d04452; box-shadow: 0 0 0 2px #d044521a; }
#yd-dashboard-root .yd-permission-status-dot.on { background: #24945f; box-shadow: 0 0 0 2px #24945f1a; }

#yd-dashboard-root .yd-tool-accordion-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
#yd-dashboard-root .yd-accordion-index {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    border: 1px solid var(--brand);
    border-radius: 8px;
    background: var(--brand);
    color: #fff;
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
    border: 1px dashed var(--border);
    border-radius: 9px;
    background: #fff;
}
#yd-dashboard-root .yd-settings-placeholder-icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    border: 1px solid var(--border);
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
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--brand);
}
#yd-dashboard-root .yd-pending-badge.yd-pending-failed {
    border-color: #f0d7d9;
    background: #fff1f2;
    color: #b42332;
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
#yd-dashboard-root button.yd-button-loading { position: relative; }
#yd-dashboard-root button.yd-button-loading > * { visibility: hidden !important; }
#yd-dashboard-root button.yd-button-loading::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 13px;
    height: 13px;
    margin: -7.5px 0 0 -7.5px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: yd-control-spin .7s linear infinite;
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
    border: 1px solid #e6dbe3;
    border-radius: 8px;
    background: var(--brand-soft);
    color: var(--brand-dark);
    font-size: 12px;
    font-weight: 600 !important;
    text-decoration: none;
    cursor: pointer;
    transition: all .12s;
}
#yd-dashboard-root .yd-pagination-link:not(.active):hover:not(.disabled),
#yd-dashboard-root .yd-pagination-link:not(.active):focus-visible:not(.disabled) {
    border-color: var(--border);
    background: #e9dfea;
    color: #68465f;
}
#yd-dashboard-root .yd-pagination-link.active { border-color: var(--brand) !important; background: var(--brand) !important; color: #fff !important; font-weight: 700 !important; }
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
    border: 1px solid var(--border);
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
#yd-dashboard-root .yd-allowed-users-dropdown .ui-select-value[data-placeholder="true"] { color: #fff !important; }
#yd-dashboard-root .ui-select-chevron {
    display: block !important;
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    color: var(--muted);
    opacity: 1;
    visibility: visible;
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
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
    color: #18181b;
    box-shadow: 0 0 16px 2px rgba(0, 0, 0, .12), 0 0 0 1px rgba(135, 90, 123, .08);
    box-sizing: border-box;
    font-family: 'Nunito Sans', 'Cairo', system-ui, -apple-system, sans-serif !important;
    transform-origin: top center;
    box-sizing: border-box !important;
    animation: yd-select-dropdown-drop .34s cubic-bezier(.16, 1, .3, 1) both;
}
#yd-dashboard-root .ui-select[data-open="true"] .ui-select-menu,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] {
    display: block;
}
#yd-dashboard-root .ui-select-menu[data-open-direction="up"],
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"][data-open-direction="up"] {
    transform-origin: bottom center;
    animation-name: yd-select-dropdown-rise;
}
@supports (position-anchor: --yd-dropdown-anchor) and (top: anchor(bottom)) and (width: anchor-size(width)) {
    body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] {
        position: fixed !important;
        position-anchor: --yd-active-dropdown-anchor !important;
        top: anchor(bottom) !important;
        left: anchor(left) !important;
        right: auto !important;
        margin-top: 4px !important;
        width: var(--yd-select-menu-width, anchor-size(width)) !important;
        min-width: max(var(--yd-select-menu-width, anchor-size(width)), 144px) !important;
        max-width: min(360px, calc(100vw - 24px)) !important;
        max-height: min(320px, calc(100vh - 24px)) !important;
        position-try-fallbacks: flip-block, flip-inline !important;
    }
}
#yd-dashboard-root .ui-select-menu[hidden],
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"][hidden] {
    display: none !important;
}
#yd-dashboard-root .ui-select-group,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-group {
    display: block;
    width: 100%;
    min-width: 0;
    padding: 10px;
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
    padding: 8px 30px 8px 10px;
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
#yd-dashboard-root .yd-allowed-users-dropdown > .ui-select-trigger { max-width: 220px; }
#yd-dashboard-root .yd-allowed-users-dropdown > .ui-select-trigger,
#yd-dashboard-root .yd-allowed-users-dropdown > .ui-select-trigger:hover:not(:disabled),
#yd-dashboard-root .yd-allowed-users-dropdown[data-open="true"] > .ui-select-trigger {
    border: 1px solid var(--brand);
    background: var(--brand);
    color: #fff;
}
#yd-dashboard-root .yd-allowed-users-dropdown > .ui-select-trigger:hover:not(:disabled) {
    border-color: var(--brand-dark);
    background: var(--brand-dark);
    color: #fff;
}
#yd-dashboard-root .yd-allowed-users-dropdown .ui-select-chevron {
    color: rgba(255, 255, 255, .9);
}
#yd-dashboard-root .yd-allowed-users-dropdown > .ui-select-trigger:focus-visible {
    outline: none !important;
    box-shadow: none !important;
}
#yd-dashboard-root .yd-allowed-users-search,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search {
    box-sizing: border-box;
    display: block;
    position: static;
    top: auto;
    z-index: auto;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    height: 30px;
    margin: 0 0 6px;
    align-self: stretch;
    flex: 0 0 100%;
    background-color: #e1e1e1 !important;
    box-shadow: none;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: #f8f5f7;
    color: #18181b;
    font-family: 'Nunito Sans', 'Cairo', system-ui, -apple-system, sans-serif !important;
    font-size: 11px;
}
#yd-dashboard-root .yd-allowed-users-search::placeholder,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search::placeholder { color: #8b838d; }
#yd-dashboard-root .yd-allowed-users-search:focus,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search:focus {
    border-color: var(--brand);
    outline: none !important;
    box-shadow: 0 0 0 2px rgba(135, 90, 123, .12);
}
#yd-dashboard-root .yd-allowed-users-option[hidden],
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-option[hidden],
#yd-dashboard-root .yd-dropdown-separator[hidden],
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-dropdown-separator[hidden] { display: none !important; }
#yd-dashboard-root .yd-allowed-users-search-empty,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search-empty {
    padding: 8px 4px;
    color: #71717a;
    font-size: 11px;
    text-align: center;
}
#yd-dashboard-root .yd-allowed-users-search-empty[hidden],
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search-empty[hidden] { display: none !important; }
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
    position: static;
    bottom: auto;
    z-index: auto;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 8px;
    padding: 8px 0 0;
    border-top: 1px solid #eee9ef;
    background: #fff;
    box-shadow: none;
}
#yd-dashboard-root .yd-allowed-users-menu,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"].yd-allowed-users-menu {
    overflow: hidden !important;
}
#yd-dashboard-root .yd-allowed-users-list,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-list {
    display: block;
    max-height: min(220px, calc(100vh - 170px));
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-color: #bdaabd #f4eff4;
    scrollbar-width: thin;
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
    border: 1px solid var(--border);
    background: #fff;
    color: #68465f;
}

#yd-dashboard-root .yd-announcement-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    width: 55%;
    margin: 0 auto;
}
#yd-dashboard-root article.yd-announcement-card {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 836px;
    min-width: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: 12px;
    background: #ffffff !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}
#yd-dashboard-root article.yd-announcement-card.yd-announcement-pending {
    opacity: .62;
    filter: saturate(.72);
    pointer-events: none;
    cursor: wait;
    user-select: none;
}
#yd-dashboard-root article.yd-announcement-card.yd-announcement-pending .yd-announcement-footer {
    visibility: hidden;
}
#yd-dashboard-root .yd-announcement-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 7px 12px;
    border-bottom: 1px solid var(--border);
    background: transparent;
}
#yd-dashboard-root .yd-announcement-author-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
#yd-dashboard-root .yd-announcement-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
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
    font-size: 12px;
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
    font-size: 10px;
    white-space: nowrap;
}
#yd-dashboard-root .yd-announcement-date svg { width: 12px; height: 12px; flex: 0 0 12px; }
#yd-dashboard-root .yd-announcement-cycle-wrap {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex: 0 0 auto;
}
#yd-dashboard-root .yd-announcement-cycle-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 100px;
    min-height: 26px;
    padding: 4px 9px;
    border: 1px solid var(--brand);
    border-radius: 8px;
    background: var(--brand);
    color: #fff;
    font-size: 12px;
    font-weight: 600 !important;
    text-align: center;
    white-space: nowrap;
}
#yd-dashboard-root .yd-announcement-form .yd-announcement-cycle-select {
    display: flex;
    width: 100%;
    min-width: 0;
}
#yd-dashboard-root .yd-announcement-form .yd-announcement-cycle-select > .ui-select-trigger,
#yd-dashboard-root .yd-announcement-form .yd-announcement-cycle-select[data-open="true"] > .ui-select-trigger {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 34px;
    min-height: 34px;
    padding: 0 34px;
    border: 1px solid var(--brand);
    border-radius: 8px;
    background: var(--brand);
    color: #fff;
    font-size: 12px;
    font-weight: 600 !important;
    text-align: center;
}
#yd-dashboard-root .yd-announcement-form .yd-announcement-cycle-select > .ui-select-trigger:hover:not(:disabled) {
    border-color: var(--brand-dark);
    background: var(--brand-dark);
    color: #fff;
}
#yd-dashboard-root .yd-announcement-form .yd-announcement-cycle-select .ui-select-value,
#yd-dashboard-root .yd-announcement-form .yd-announcement-cycle-select .ui-select-value[data-placeholder="true"] {
    color: #fff !important;
}
#yd-dashboard-root .yd-announcement-form .yd-announcement-cycle-select .ui-select-chevron {
    color: rgba(255, 255, 255, .92);
}
#yd-dashboard-root .yd-announcement-form .yd-announcement-cycle-select .ui-select-value {
    flex: 1 1 auto;
    width: 100%;
    padding: 0;
    text-align: center !important;
}
#yd-dashboard-root .yd-announcement-form .yd-announcement-cycle-select .ui-select-chevron {
    position: absolute;
    top: calc(50% - 7px);
    right: 10px;
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
}
#yd-dashboard-root .yd-announcement-body {
    margin: 0;
    padding: 14px;
    background: transparent;
    color: #18181b;
    font-size: 15px;
    font-weight: 600 !important;
    line-height: 2;
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
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border);
    background: transparent;
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
    border: 1px solid var(--border);
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
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes yd-select-dropdown-drop {
    from { opacity: 0; transform: translateY(-11px) scaleY(.94); }
    72% { opacity: 1; transform: translateY(1px) scaleY(1.005); }
    to { opacity: 1; transform: translateY(0) scaleY(1); }
}
@keyframes yd-select-dropdown-rise {
    from { opacity: 0; transform: translateY(11px) scaleY(.94); }
    72% { opacity: 1; transform: translateY(-1px) scaleY(1.005); }
    to { opacity: 1; transform: translateY(0) scaleY(1); }
}
@keyframes yd-backdrop-enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes yd-modal-enter {
    from { opacity: 0; transform: translateY(7px) scale(.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 1120px) {
    #yd-dashboard-root .yd-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    #yd-dashboard-root .yd-announcement-list { width: 82.5%; }
}
@media (max-width: 850px) {
    #yd-dashboard-root .yd-panel-grid, #yd-dashboard-root .yd-info-grid { grid-template-columns: 1fr; }
    #yd-dashboard-root #yd-sidebar { width: 190px; flex-basis: 190px; }
    #yd-dashboard-root .yd-announcement-list { width: 100%; }
}
@media (max-width: 760px) {
    #yd-dashboard-root .yd-permission-search { width: 100%; min-width: 0; }
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

#yd-dashboard-root input:not([type="hidden"]),
#yd-dashboard-root textarea,
#yd-dashboard-root select,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search {
    border: 1px solid var(--border) !important;
    border-radius: 8px !important;
    background: #fff !important;
    color: #18181b !important;
    font: inherit !important;
    box-shadow: none !important;
    outline: none !important;
    transition: border-color .16s ease, background-color .16s ease, box-shadow .16s ease !important;
    accent-color: #875a7b;
}
#yd-dashboard-root input:not([type="hidden"]),
#yd-dashboard-root select,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search {
    min-height: 36px;
    padding: 0 11px !important;
}
#yd-dashboard-root textarea {
    padding: 10px 11px !important;
}
#yd-dashboard-root input:not([type="hidden"]):hover:not(:disabled),
#yd-dashboard-root textarea:hover:not(:disabled),
#yd-dashboard-root select:hover:not(:disabled),
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search:hover {
    border-color: #b28aa8 !important;
    background-color: #fcf9fc !important;
}
#yd-dashboard-root input:not([type="hidden"]):focus,
#yd-dashboard-root input:not([type="hidden"]):focus-visible,
#yd-dashboard-root textarea:focus,
#yd-dashboard-root textarea:focus-visible,
#yd-dashboard-root select:focus,
#yd-dashboard-root select:focus-visible,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search:focus {
    border-color: #875a7b !important;
    background-color: #fff !important;
    box-shadow: 0 0 0 3px rgba(135, 90, 123, .16) !important;
    outline: none !important;
}
#yd-dashboard-root input:not([type="hidden"])::placeholder,
#yd-dashboard-root textarea::placeholder,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search::placeholder {
    color: #96909a !important;
    opacity: 1;
}
#yd-dashboard-root input:not([type="hidden"]):disabled,
#yd-dashboard-root textarea:disabled,
#yd-dashboard-root select:disabled,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search:disabled {
    background: #f3f1f4 !important;
    color: #96909a !important;
    cursor: not-allowed;
}
#yd-dashboard-root .yd-permission-search-wrap { justify-content: flex-start; }
#yd-dashboard-root .yd-allowed-users-option[data-selected="true"]::after,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-option[data-selected="true"]::after {
    content: none !important;
    display: none !important;
}

#yd-dashboard-root table {
    background: #e1e1e1;
    border-collapse: separate;
    border-spacing: 0 10px;
}
#yd-dashboard-root thead th {
    border: 0;
    background: var(--brand) !important;
    color: #fff !important;
}
#yd-dashboard-root thead th:first-child {
    border-top-left-radius: 10px;
    border-bottom-left-radius: 10px;
}
#yd-dashboard-root thead th:last-child {
    border-top-right-radius: 10px;
    border-bottom-right-radius: 10px;
}
#yd-dashboard-root tbody td,
#yd-dashboard-root tbody th {
    border: 0;
    background: #fff !important;
}
#yd-dashboard-root tbody tr:nth-child(even) td,
#yd-dashboard-root tbody tr:nth-child(even) th {
    background: #fff !important;
}
#yd-dashboard-root tbody tr:hover td,
#yd-dashboard-root tbody tr:hover th {
    background: #faf8fb !important;
}
#yd-dashboard-root tbody td:first-child,
#yd-dashboard-root tbody th:first-child {
    border-top-left-radius: 10px;
    border-bottom-left-radius: 10px;
}
#yd-dashboard-root tbody td:last-child,
#yd-dashboard-root tbody th:last-child {
    border-top-right-radius: 10px;
    border-bottom-right-radius: 10px;
}

#yd-dashboard-root .ui-select-trigger {
    border: 1px solid var(--brand) !important;
    background: var(--brand) !important;
    color: #fff !important;
}
#yd-dashboard-root .ui-select-trigger:hover:not(:disabled),
#yd-dashboard-root .ui-select[data-open="true"] > .ui-select-trigger {
    border-color: var(--brand-dark) !important;
    background: var(--brand-dark) !important;
    color: #fff !important;
}
#yd-dashboard-root .ui-select-trigger:focus-visible {
    border-color: var(--brand) !important;
    background: var(--brand) !important;
    color: #fff !important;
    box-shadow: 0 0 0 3px var(--brand-ring) !important;
}
#yd-dashboard-root .ui-select-trigger .ui-select-value,
#yd-dashboard-root .ui-select-trigger .ui-select-value[data-placeholder="true"],
#yd-dashboard-root .ui-select-trigger .ui-select-chevron {
    color: #fff !important;
}

#yd-dashboard-root .yd-pill.yd-role-super-admin {
    border-color: #bfdbfe !important;
    background: #dbeafe !important;
    color: #1d4ed8 !important;
}
#yd-dashboard-root .yd-pill.yd-role-admin {
    border-color: #fecaca !important;
    background: #fee2e2 !important;
    color: #b91c1c !important;
}
#yd-dashboard-root .yd-pill.yd-role-user {
    border-color: #bbf7d0 !important;
    background: #dcfce7 !important;
    color: #15803d !important;
}
#yd-dashboard-root .yd-role-label {
    display: inline-block;
    padding: 1px 5px;
    border: 1px solid transparent;
    border-radius: 5px;
    font-size: inherit;
    font-weight: 700 !important;
}
#yd-dashboard-root .yd-role-label.yd-role-super-admin { border-color: #bfdbfe !important; background: #dbeafe !important; color: #1d4ed8 !important; }
#yd-dashboard-root .yd-role-label.yd-role-admin { border-color: #fecaca !important; background: #fee2e2 !important; color: #b91c1c !important; }
#yd-dashboard-root .yd-role-label.yd-role-user { border-color: #bbf7d0 !important; background: #dcfce7 !important; color: #15803d !important; }

#yd-dashboard-root input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]),
#yd-dashboard-root select {
    max-width: 340px;
    color: #18181b !important;
    box-shadow: none !important;
    outline: none !important;
}
#yd-dashboard-root .yd-allowed-users-menu .yd-allowed-users-search,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .ui-select-group > .yd-allowed-users-search {
    display: block !important;
    width: 100% !important;
    min-width: 100% !important;
    max-width: none !important;
    flex: none !important;
}
#yd-dashboard-root input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):focus,
#yd-dashboard-root input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):focus-visible,
#yd-dashboard-root textarea:focus,
#yd-dashboard-root textarea:focus-visible,
#yd-dashboard-root select:focus,
#yd-dashboard-root select:focus-visible,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] .yd-allowed-users-search:focus {
    border: 2px solid var(--brand) !important;
    color: #18181b !important;
    box-shadow: none !important;
    outline: none !important;
}

#yd-dashboard-root,
#yd-dashboard-root *,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"],
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] * {
    scrollbar-color: #bdaabd #f4eff4;
    scrollbar-width: thin;
}
#yd-dashboard-root::-webkit-scrollbar,
#yd-dashboard-root *::-webkit-scrollbar,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"]::-webkit-scrollbar,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] *::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}
#yd-dashboard-root::-webkit-scrollbar-track,
#yd-dashboard-root *::-webkit-scrollbar-track,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"]::-webkit-scrollbar-track,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] *::-webkit-scrollbar-track {
    border-radius: 8px;
    background: #f4eff4;
}
#yd-dashboard-root::-webkit-scrollbar-thumb,
#yd-dashboard-root *::-webkit-scrollbar-thumb,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"]::-webkit-scrollbar-thumb,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] *::-webkit-scrollbar-thumb {
    border: 2px solid #f4eff4;
    border-radius: 8px;
    background: #bdaabd;
}
#yd-dashboard-root::-webkit-scrollbar-thumb:hover,
#yd-dashboard-root *::-webkit-scrollbar-thumb:hover,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"]::-webkit-scrollbar-thumb:hover,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] *::-webkit-scrollbar-thumb:hover {
    background: #875a7b;
}
#yd-dashboard-root::-webkit-scrollbar-corner,
#yd-dashboard-root *::-webkit-scrollbar-corner,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"]::-webkit-scrollbar-corner,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] *::-webkit-scrollbar-corner {
    background: #f4eff4;
}

#yd-dashboard-root button,
#yd-dashboard-root a,
#yd-dashboard-root summary,
#yd-dashboard-root input,
#yd-dashboard-root select,
#yd-dashboard-root textarea {
    transition-property: color, background-color, border-color, box-shadow, transform, opacity, filter;
    transition-duration: .22s;
    transition-timing-function: cubic-bezier(.2, .8, .2, 1);
}
#yd-dashboard-root .yd-card,
#yd-dashboard-root .yd-kpi-card,
#yd-dashboard-root .yd-pill,
#yd-dashboard-root .yd-id-badge,
#yd-dashboard-root .yd-role-label,
#yd-dashboard-root .yd-title-icon,
#yd-dashboard-root .yd-kpi-icon,
#yd-dashboard-root .yd-accordion-index,
#yd-dashboard-root .yd-visibility-row,
#yd-dashboard-root .yd-visibility-accordion-item,
#yd-dashboard-root .yd-announcement-card,
#yd-dashboard-root .yd-announcement-avatar,
#yd-dashboard-root .yd-brand-logo,
#yd-dashboard-root .yd-gb-avatar,
#yd-dashboard-root .yd-gb-badge {
    transition-property: color, background-color, border-color, box-shadow, transform, opacity, filter;
    transition-duration: .24s;
    transition-timing-function: cubic-bezier(.2, .8, .2, 1);
}
#yd-dashboard-root .ui-select-item::after {
    transition: border-color .2s ease, transform .2s ease, opacity .2s ease;
}
@media (max-width: 620px) {
    #yd-dashboard-root .yd-visibility-bulk { gap: 5px; }
    #yd-dashboard-root .yd-visibility-bulk-label { font-size: 8px; }
}
#yd-dashboard-root button,
#yd-dashboard-root button:focus,
#yd-dashboard-root button:focus-visible,
#yd-dashboard-root button:active,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] button,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] button:focus,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] button:focus-visible,
body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] button:active {
    outline: none !important;
}
@media (prefers-reduced-motion: reduce) {
    #yd-dashboard-root *,
    body > .ui-select-menu.yd-select-portal-menu[data-portal="true"] * {
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .01ms !important;
        scroll-behavior: auto !important;
    }
}
`;
        (document.head || document.documentElement).appendChild(style);
    };

    const navItems = () => {
        const access = getRoleAccess();
        const items = [['tools', 'fa-solid fa-toolbox', 'Tools'], ['overview', 'fa-solid fa-chart-pie', 'Overview'], ['announcements', 'fa-solid fa-bullhorn', 'Announcements'], ['accounts', 'fa-solid fa-building-shield', 'Accounts']];
        if (access.canManageUsers) items.push(['users', 'fa-solid fa-users', 'Users']);
        if (access.canManageUserPermissions || access.canManageSharedTools) items.push(['permissions', 'fa-solid fa-sliders', 'User Permissions']);
        if (access.canManageVisibility) items.push(['visibility', 'fa-solid fa-eye', 'Visibility']);
        if (access.canViewNetwork) items.push(['transactions', 'fa-solid fa-right-left', 'NETWORK']);
        items.push(['account', 'fa-solid fa-gear', 'Settings']);
        return items;
    };

    const renderActivityIndicator = () => {
        const items = [...activityItems.values()].sort((a, b) => a.startedAt - b.startedAt);
        if (!items.length) return '';
        const count = items.length;
        const first = items[0];
        const rows = items.map(item => {
            const label = String(item.label || 'Background operation');
            const icon = /user|permission|visibility|access/i.test(label) ? 'fa-user-shield'
                : /announcement/i.test(label) ? 'fa-bullhorn'
                : /tool|module|refresh|sync/i.test(label) ? 'fa-arrows-rotate'
                : /setting/i.test(label) ? 'fa-sliders'
                : 'fa-cloud-arrow-up';
            return '<div class="yd-activity-item"><span class="yd-activity-item-icon"><i class="fa-solid ' + icon + '"></i></span><span class="yd-activity-item-copy"><span class="yd-activity-item-top"><strong>' + escapeHTML(label) + '</strong><span class="yd-activity-item-status">' + escapeHTML(item.statusLabel || 'ACTIVE') + '</span></span><small>' + escapeHTML(item.location || 'Dashboard') + '</small><span class="yd-activity-progress"><span></span></span><span class="yd-activity-item-stage">' + escapeHTML(item.stage || 'In progress') + '</span></span></div>';
        }).join('');
        return '<div class="yd-activity-wrap"><button type="button" class="yd-activity-trigger" data-action="activity-toggle" aria-controls="yd-activity-dropdown" aria-expanded="' + String(activityMenuOpen) + '" aria-label="View ' + count + ' active operations"><span class="yd-activity-spinner"></span><span class="yd-activity-trigger-copy"><strong>' + count + ' ACTIVE</strong><small>' + escapeHTML(first.label || 'Background operation') + '</small></span><span class="yd-activity-count">' + count + '</span></button><div id="yd-activity-dropdown" class="yd-activity-dropdown" role="region" aria-label="Active operations"' + (activityMenuOpen ? '' : ' hidden') + '><div class="yd-activity-menu-head"><span class="yd-activity-menu-heading"><strong>Running operations</strong><small>These actions continue in the background</small></span><span class="yd-activity-menu-total">' + count + ' ACTIVE</span><button type="button" class="yd-activity-menu-close" data-action="activity-close" aria-label="Close activity list"><i class="fa-solid fa-xmark"></i></button></div><div class="yd-activity-list">' + rows + '</div><div class="yd-activity-menu-foot"><i class="fa-solid fa-circle-info"></i><span>You can keep working while these actions finish.</span></div></div>';
    };

    const renderShell = body => {
        const user = context.user || {};
        const name = escapeHTML(formatName(user.name || user.id || 'User'));
        const avatar = escapeHTML(initials(user.name || user.id));
        const menu = navItems().map(([id, icon, label]) => '<button type="button" data-page="' + id + '" class="yd-nav ' + (activePage === id ? 'active' : '') + '"><span class="yd-nav-icon"><i class="' + icon + '"></i></span><span>' + escapeHTML(label) + '</span></button>').join('');
        return '<button id="yd-launcher" type="button" data-action="toggle-dashboard"><span class="yd-brand-logo">Y</span><span>YODAWY DASHBOARD</span></button>' +
            '<div id="yd-overlay" class="' + (isOpen ? 'open' : '') + '">' +
                '<div id="yd-modal" role="dialog" aria-modal="true" aria-label="Yodawy Dashboard">' +
                    '<header id="yd-header"><div class="yd-brand"><div class="yd-brand-logo">Y</div><div class="yd-brand-title">YODAWY DASHBOARD</div></div>' +
                        '<div class="yd-header-actions">' + renderActivityIndicator() + '<div class="yd-header-status"><span class="yd-header-dot"></span><span>Connected</span></div>' +
                            '<div class="yd-profile-wrap"><button id="yd-profile-trigger" class="yd-gb-btn" data-action="profile-toggle" aria-expanded="' + String(profileOpen) + '" type="button" aria-label="Account"><span class="yd-gb-avatar">' + avatar + '</span><span class="yd-gb-badge"><i class="fa-solid fa-check"></i></span></button>' +
                                '<div id="yd-profile-menu" class="yd-profile-menu"' + (profileOpen ? '' : ' hidden') + '>' +
                                    '<div class="yd-gb-card"><div class="yd-gb-ring-lg"><div class="yd-gb-avatar-lg">' + avatar + '</div></div><div class="yd-gb-name">' + name + '</div><div class="yd-gb-meta">ID: ' + escapeHTML(user.id || user.userId || context.userId || '—') + '</div><div class="yd-gb-pills">' + renderRolePill(context.userRole) + '<span class="yd-pill green">Connected</span></div></div>' +
                                    '<button class="yd-dropdown-action" data-action="refresh-connection" type="button"><span class="yd-action-icon"><i class="fa-solid fa-arrow-rotate-right"></i></span><span><b>Refresh</b></span></button>' +
                                '</div></div><button class="yd-close-btn" data-action="close-dashboard" type="button" title="Close"><i class="fa-solid fa-xmark"></i></button></div>' +
                    '</header><div id="yd-body"><aside id="yd-sidebar"><div class="yd-nav-label">Workspace</div>' + menu + '<div class="yd-sidebar-bottom">Authenticated Workspace<br>Yodawy Tools Cloud · v1</div></aside><main id="yd-main">' + body + '</main></div>' +
                '</div></div>';
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
        let pages = '';
        for (let page = firstPage; page <= lastPage; page++) pages += link(String(page), page, page === currentPage, false, 'Page ' + page);
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
                    '<div class="yd-clean-row"><span class="yd-clean-label">Role</span>' + renderRolePill(context.userRole) + '</div>' +
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

    const loadPortalAccounts = async () => {
        if (portalAccounts || portalAccountsLoading) return;
        portalAccountsLoading = true;
        try {
            const api = context?.api || page.YODAWY_API_ENGINE;
            const response = await api?.getPortalAccounts?.();
            if (response?.success !== true) throw new Error(response?.error || 'Portal accounts are unavailable.');
            portalAccounts = Array.isArray(response.accounts) ? response.accounts : [];
        } catch {
            portalAccounts = [];
        } finally {
            portalAccountsLoading = false;
            if (context && activePage === 'tools' && isCurrentUI()) render();
        }
    };

    const renderAccounts = () => {
        if (!portalAccounts && !portalAccountsLoading) loadPortalAccounts();
        const accounts = Array.isArray(portalAccounts) ? portalAccounts : [];
        const personal = accounts.filter(account => account.accountType === 'PERSONAL');
        const nonPersonal = accounts.filter(account => account.accountType === 'NON-PERSONAL');
        const renderGroup = (title, icon, items, type) => '<section class="yd-card" style="margin-bottom:16px"><div class="yd-card-title"><span class="yd-title-icon"><i class="fa-solid ' + icon + '"></i></span><span>' + title + '</span><span class="yd-pill">' + items.length + '</span></div>' + (items.length ? '<div class="yd-table-wrap"><table><thead><tr><th>Company</th><th>Username</th><th>Odoo Key</th><th>Provider</th></tr></thead><tbody>' + items.map(account => '<tr><td><strong>' + escapeHTML(account.label || '—') + '</strong></td><td>' + escapeHTML(account.username || '—') + '</td><td>' + escapeHTML(account.odooKey || '—') + '</td><td>' + escapeHTML(account.provider || 'PORTAL') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="yd-empty-state"><i class="fa-solid fa-folder-open"></i><strong>No ' + type + ' accounts yet</strong><small>Accounts assigned to your user will appear here.</small></div>') + '</section>';
        return '<section class="yd-welcome"><div><h1>Portal Accounts</h1><p>Manage personal and shared portal accounts assigned to your Dashboard user.</p></div><div class="yd-welcome-actions"><span class="yd-pill ' + (portalAccountsLoading ? 'yellow' : 'green') + '">' + (portalAccountsLoading ? 'Loading' : accounts.length + ' Accounts') + '</span><button type="button" class="yd-secondary" data-action="refresh-portal-accounts"><i class="fa-solid fa-rotate"></i><span>Refresh</span></button></div></section>' + (portalAccountsLoading ? '<div class="yd-tool-settings-placeholder"><span class="yd-control-spinner"></span><strong>Loading portal accounts...</strong></div>' : renderGroup('Personal Accounts', 'fa-user-lock', personal, 'personal') + renderGroup('Non-Personal Accounts', 'fa-users', nonPersonal, 'non-personal'));
    };

    const renderSplitAccountSettings = settings => {
        if (!portalAccounts && !portalAccountsLoading) loadPortalAccounts();
        if (portalAccountsLoading || !portalAccounts) return '<div class="yd-tool-settings-placeholder"><span class="yd-settings-placeholder-icon"><span class="yd-control-spinner" aria-hidden="true"></span></span><span><strong>Split Account</strong></span></div>';
        const accounts = portalAccounts.filter(account => account.provider === 'METLIFE');
        const types = [...new Set(accounts.map(account => account.accountType).filter(type => ['PERSONAL', 'ALTERNATIVE'].includes(type)))];
        if (!types.length) return '<div class="yd-tool-settings-placeholder"><span class="yd-settings-placeholder-icon"><i class="fa-solid fa-circle-info"></i></span><span><strong>Split Account</strong><small>No MetLife accounts are configured for this user.</small></span></div>';
        const options = [
            ...(types.includes('PERSONAL') ? [{ value: 'PERSONAL', label: 'Personal Account' }] : []),
            ...(types.includes('ALTERNATIVE') ? [{ value: 'ALTERNATIVE', label: 'B.Kamal Account' }] : [])
        ];
        const selected = String(settings.preferences?.metlifeSplitAccount || '');
        const value = options.some(option => option.value === selected) ? selected : '';
        return '<div class="yd-field"><label for="yd-metlife-split-account">MetLife Split Account</label><select id="yd-metlife-split-account" data-action="split-account-preference" class="yd-input" aria-label="MetLife Split Account"><option value="">Choose an account</option>' + options.map(option => '<option value="' + option.value + '"' + (value === option.value ? ' selected' : '') + '>' + option.label + '</option>').join('') + '</select><small class="yd-field-hint">This choice is saved to your personal Dashboard settings.</small></div>';
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
            const status = '<span class="yd-pill ' + (enabled ? 'green' : 'red') + '">' + (enabled ? 'ON' : 'OFF') + '</span>';
            return '<details class="yd-tool-accordion-item" data-tool-accordion data-tool="' + escapeHTML(id) + '"' + expanded + '>' +
                '<summary><span class="yd-tool-accordion-main"><span class="yd-accordion-index">' + String(index + 1).padStart(2, '0') + '</span><span class="yd-tool-accordion-copy"><strong>' + escapeHTML(tool.name) + '</strong><small>' + escapeHTML(id) + '</small></span></span>' +
                '<span class="yd-tool-accordion-actions">' + status + '<button type="button" class="yd-switch ' + (enabled ? 'on' : '') + (pending ? ' is-loading' : '') + '" data-action="toggle-my-tool" data-tool="' + escapeHTML(id) + '" data-enabled="' + String(enabled) + '" ' + (allowed && !pending ? '' : 'disabled') + ' role="switch" aria-checked="' + String(enabled) + '" aria-label="Toggle ' + escapeHTML(tool.name) + '"><span class="yd-switch-knob"></span></button></span></summary>' +
                '<div class="yd-tool-accordion-body">' + (id === 'TOOL-003' ? renderSplitAccountSettings(context.settings?.getSettings?.() || {}) : '<div class="yd-tool-settings-placeholder"><span class="yd-settings-placeholder-icon"><i class="fa-solid fa-sliders"></i></span><span><strong>User Settings</strong><small>No additional settings are available.</small></span></div>') + '</div></details>';
        }).join('');
        return '<section class="yd-welcome"><div><h1>Tools</h1><p>' + (isSuperAdmin ? 'Manage your personal tools and their availability.' : 'Expand a tool to access its personal settings and control its status.') + '</p></div></section>' +
            '<div class="yd-toolbar"><input class="yd-search" id="yd-tool-search" placeholder="Search tools by name or ID"><span class="yd-pill">' + getLoadedTools().length + ' loaded / ' + allTools.length + ' total</span></div>' +
            '<div class="yd-tool-accordion-list">' + (items || '<div class="yd-card yd-empty">No tools available.</div>') + '</div>' +
            '<div class="yd-tool-summary"><span>' + visibleTools.length + ' Tools</span><span>' + permittedCount + ' Permitted</span><span>' + onCount + ' Enabled</span></div>';
    };

    const editActionIcon = '<svg class="yd-action-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" fill="none" stroke="currentColor"></path><path d="m16.5 3.5 4 4L8 20l-5 1 1-5Z" fill="none" stroke="currentColor"></path></svg>';
    const deleteActionIcon = '<svg class="yd-action-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18" fill="none" stroke="currentColor"></path><path d="M8 6V4h8v2" fill="none" stroke="currentColor"></path><path d="m19 6-1 14H6L5 6" fill="none" stroke="currentColor"></path><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor"></path></svg>';

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
        const roleDescription = isAdmin ? 'View all accounts, manage and delete USER accounts, and create USER or ADMIN accounts.' : 'Manage registered accounts and their dashboard roles.';
        const rows = users.map(user => {
            const id = String(user.id || '');
            const isSelf = id.trim().toUpperCase() === currentUserId;
            const pending = user._pending ? user._transaction : getPendingUser(user);
            const pendingAction = String(pending?.action || '').toUpperCase();
            const pendingLabel = pendingAction === 'ADD_USER' ? 'Adding' : pendingAction === 'DELETE_USER' ? 'Deleting' : 'Updating';
            const canDelete = getRoleAccess().canDeleteUsers && !isSelf && !user._pending && (!isAdmin || String(user.role || 'USER').toUpperCase() === 'USER');
            const canEdit = getRoleAccess().canEditUsers && !user._pending && !(context.userRole === 'SUPER_ADMIN' && isSelf) && (!isAdmin || String(user.role || '').toUpperCase() === 'USER');
            const editButton = canEdit
                ? '<button type="button" class="yd-icon-btn" data-action="edit-user" data-id="' + escapeHTML(id) + '" title="Edit user" aria-label="Edit user"' + (pending ? ' disabled' : '') + '>' + editActionIcon + '</button>'
                : '';
            const deleteButton = canDelete
                ? '<button type="button" class="yd-icon-btn danger" data-action="delete-user" data-id="' + escapeHTML(id) + '" title="Delete user" aria-label="Delete user"' + (pending ? ' disabled' : '') + '>' + deleteActionIcon + '</button>'
                : '';
            const status = pending ? renderPendingBadge(pendingLabel) : '<span class="yd-pill ' + (String(user.status).toLowerCase() === 'active' ? 'green' : 'red') + '">' + escapeHTML(user.status) + '</span>';
            const repository = user._pending ? 'QUEUED' : String(user.repository || 'Provisioning').toUpperCase();
            const roleMarkup = isAdmin && String(user.role || '').toUpperCase() === 'SUPER_ADMIN' ? '' : renderRolePill(user.role);
            return '<tr' + (pending ? ' class="yd-pending-row"' : '') + '><td><strong>' + escapeHTML(formatName(user.name)) + '</strong></td><td><span class="yd-id-badge">' + escapeHTML(user._pending ? 'ASSIGNING ID' : id) + '</span></td><td>' + roleMarkup + '</td><td>' + status + '</td><td><span class="yd-repository-name">' + escapeHTML(repository) + '</span></td><td><div class="yd-user-actions">' + editButton + deleteButton + '</div></td></tr>';
        }).join('');
        return '<section class="yd-welcome"><div><h1>Users Directory</h1><p>' + roleDescription + '</p></div>' + (getRoleAccess().canManageUsers ? '<button class="yd-primary" data-action="add-user"><i class="fa-solid fa-plus"></i><span>Add User</span></button>' : '') + '</section>' +
            '<div class="yd-toolbar"><input class="yd-search" id="yd-user-search" placeholder="Search by ID, name, role or repository"><span class="yd-pill">' + users.length + ' users</span></div>' +
            '<div class="yd-table-wrap"><table><thead><tr><th>User</th><th>User ID</th><th>Role</th><th>Status</th><th>Personal Repository</th><th>Actions</th></tr></thead><tbody>' +
            (rows || '<tr><td colspan="6" class="yd-empty">No users found.</td></tr>') + '</tbody></table></div>';
    };

    const renderPermissions = () => {
        const allUsers = getUsers();
        const isSuperAdmin = context.userRole === 'SUPER_ADMIN';
        const users = allUsers.filter(user => isSuperAdmin ? ['ADMIN', 'USER'].includes(String(user.role || '').toUpperCase()) : String(user.role || '').toUpperCase() === 'USER');
        const tools = getRoleEngine()?.getTools?.() || [];
        const permissions = getRoleEngine()?.getPermissions?.() || {};
        const items = users.map(user => {
            const userId = String(user.id || '').trim().toUpperCase();
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
                const blocked = !active || Boolean(pending || pendingUser);
                const permissionDisabled = blocked || (!isSuperAdmin && forced);
                const pendingBadge = '';
                const userEnabled = isSuperAdmin && context.userSettings?.[userId]?.[tool.id] === 'ENABLED';
                const userEnabledControl = isSuperAdmin ? '<div class="yd-permission-control"><span class="yd-permission-label">User Enabled</span><span class="yd-permission-status-dot ' + (userEnabled ? 'on' : '') + '" title="' + (userEnabled ? 'User Enabled' : 'User Disabled') + '" aria-label="' + (userEnabled ? 'User Enabled' : 'User Disabled') + '"></span></div>' : '';
                const permittedControl = '<div class="yd-permission-control"><span class="yd-permission-label">Permitted</span>' + (!isSuperAdmin && forced ? '<span class="yd-pill yellow" title="Protected by Forced State">Protected</span>' : '<button type="button" class="yd-switch ' + (granted ? 'on' : '') + (pending?.permissionField === 'granted' || pendingUser ? ' is-loading' : '') + '" data-action="toggle-permission" data-field="granted" data-value="' + String(granted) + '" data-user="' + escapeHTML(userId) + '" data-tool="' + escapeHTML(tool.id) + '" role="switch" aria-checked="' + String(granted) + '" aria-label="Permit ' + escapeHTML(tool.name) + '"' + (permissionDisabled ? ' disabled' : '') + '><span class="yd-switch-knob"></span></button>') + '</div>';
                const forcedControl = isSuperAdmin
                    ? '<div class="yd-permission-control"><span class="yd-permission-label">Forced State</span><button type="button" class="yd-switch yd-switch-forced ' + (forced ? 'on' : '') + (pending?.permissionField === 'forcedState' || pendingUser ? ' is-loading' : '') + '" data-action="toggle-permission" data-field="forcedState" data-value="' + String(forced) + '" data-user="' + escapeHTML(userId) + '" data-tool="' + escapeHTML(tool.id) + '" role="switch" aria-checked="' + String(forced) + '" aria-label="Force state for ' + escapeHTML(tool.name) + '"' + (blocked ? ' disabled' : '') + '><span class="yd-switch-knob"></span></button></div>'
                    : forced ? '<span class="yd-pill yellow" title="Protected by Forced State">Protected</span>' : '';
                return '<div class="yd-permission-row' + (pending || pendingUser ? ' is-pending' : '') + '"><div class="yd-permission-tool"><strong>' + escapeHTML(tool.name) + '</strong>' + pendingBadge + '<span>' + escapeHTML(tool.id) + '</span></div><div class="yd-permission-controls">' + permittedControl + userEnabledControl + forcedControl + '</div></div>';
            }).join('');
            const expanded = expandedUsers.has(userId) ? ' open' : '';
            const userBadge = '';
            const toolRows = rows || '<div class="yd-empty">No tools are available.</div>';
            return '<details class="yd-accordion-item" data-user-accordion data-user="' + escapeHTML(userId) + '"' + expanded + '><summary><span class="yd-accordion-user"><strong>' + escapeHTML(formatName(user.name)) + ' ' + userBadge + '</strong><small><span class="yd-id-badge">' + escapeHTML(userId) + '</span>' + renderRolePill(user.role) + '</small></span><span class="yd-accordion-summary-meta"><span class="yd-pill green">' + grantedCount + ' Permitted</span><span class="yd-pill blue">' + forcedCount + ' Forced</span></span></summary><div class="yd-accordion-body"><div class="yd-permission-search-wrap"><input type="search" class="yd-permission-search" placeholder="ACTIVE SEARCH" aria-label="Search tools by name or ID"></div><div class="yd-permission-search-empty" hidden>No matching tools found.</div>' + toolRows + '</div></details>';
        }).join('');
        const description = isSuperAdmin
            ? 'Manage tool access and Forced State for USER and ADMIN accounts.'
            : 'Permit or revoke tool access for USER accounts. Forced State protections cannot be changed.';
        const badge = isSuperAdmin
            ? '<span class="yd-pill yd-role-pill yd-role-super-admin">SUPER ADMIN CONTROL</span>'
            : '<span class="yd-pill yd-role-pill yd-role-admin">ADMIN CONTROL</span>';
        const empty = users.length ? '' : '<div class="yd-empty">No eligible USER accounts found.</div>';
        return '<section class="yd-welcome"><div><h1>User Permissions</h1><p>' + description + '</p></div>' + badge + '</section><div class="yd-accordion-list">' + (items || empty) + '</div>';
    };

    const filterAllowedUsersMenu = (menu, query) => {
        if (!menu) return;
        const normalized = String(query || '').trim().toLocaleLowerCase();
        const options = [...menu.querySelectorAll('.yd-allowed-users-option[data-action="toggle-allowed-user"]')];
        let visible = 0;
        options.forEach(option => {
            const matches = !normalized || option.textContent.toLocaleLowerCase().includes(normalized);
            option.hidden = !matches;
            if (matches) visible++;
        });
        const separator = menu.querySelector('.yd-dropdown-separator');
        if (separator) separator.hidden = Boolean(normalized) && visible === 0;
        const empty = menu.querySelector('.yd-allowed-users-search-empty');
        if (empty) empty.hidden = !normalized || visible > 0;
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
        const userOptions = users.map(user => {
            const id = String(user.id || '').trim().toUpperCase();
            const active = String(user.status || '').toLowerCase() === 'active';
            const selected = allSelected || draft.allowedUsers.has(id);
            return '<button type="button" class="ui-select-option ui-select-item yd-allowed-users-option' + (selected ? ' selected' : '') + '" data-selected="' + String(selected) + '" data-action="toggle-allowed-user" data-tool="' + escapeHTML(toolId) + '" data-user="' + escapeHTML(id) + '" role="option" aria-selected="' + String(selected) + '"' + (!active || pending ? ' disabled' : '') + '><span><i class="fa-regular ' + (selected ? 'fa-square-check' : 'fa-square') + '"></i><span class="yd-allowed-user-copy">' + escapeHTML(formatName(user.name)) + '<small>' + escapeHTML(id) + ' · ' + renderRoleLabel(user.role) + '</small></span></span></button>';
        }).join('');
        const pendingLabel = pending?.action === 'SUBMITTING' ? 'Saving' : 'Pending';
        const footer = pending
            ? '<div class="yd-allowed-users-footer">' + renderPendingBadge(pendingLabel) + '</div>'
            : '<div class="yd-allowed-users-footer"><button type="button" class="yd-secondary" data-action="cancel-allowed-users" data-tool="' + escapeHTML(toolId) + '">Cancel</button><button type="button" class="yd-primary" data-action="save-allowed-users" data-tool="' + escapeHTML(toolId) + '">Apply</button></div>';
        const selectedValues = allSelected ? activeUsers.map(user => String(user.id || '').trim().toUpperCase()) : [...draft.allowedUsers];
        return '<div class="ui-select yd-dropdown yd-select-dropdown yd-allowed-users-dropdown' + (isOpen ? ' open' : '') + (pending ? ' disabled' : '') + '" data-multiple="true" data-open="' + String(isOpen) + '" data-placeholder="Select users" data-value="' + escapeHTML(JSON.stringify(selectedValues)) + '" data-tool="' + escapeHTML(toolId) + '">' +
            '<button type="button" class="ui-select-trigger yd-dropdown-trigger" data-action="toggle-dropdown" aria-haspopup="listbox" aria-expanded="' + String(isOpen) + '"' + (pending ? ' disabled' : '') + '><span class="ui-select-value yd-dropdown-value" data-placeholder="' + String(!selectedCount) + '">' + escapeHTML(label) + '</span>' + (pending ? renderPendingBadge(pendingLabel) : '') + '<svg class="ui-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>' +
            '<div class="ui-select-menu ui-select-content yd-dropdown-menu yd-allowed-users-menu" role="listbox" aria-multiselectable="true"' + (isOpen ? '' : ' hidden') + '><div class="ui-select-group"><input type="search" class="yd-allowed-users-search" placeholder="ACTIVE SEARCH" aria-label="Search allowed users"><div class="yd-allowed-users-list">' + (userOptions || '<div class="yd-empty">No users available.</div>') + '<div class="yd-allowed-users-search-empty" hidden>No matching users found.</div></div>' + footer + '</div></div></div>';
    };

    const refreshAllowedUsersDropdown = toolId => {
        const root = document.getElementById(CONFIG.ID);
        const current = [...(root?.querySelectorAll('.yd-allowed-users-dropdown') || [])].find(item => item.dataset.tool === toolId);
        const tool = getTools().find(item => String(item.id) === String(toolId));
        if (!current || !tool) return;
        const pending = getPendingVisibility(toolId);
        const shouldRemainOpen = openVisibilityToolId === toolId && !pending;
        const engine = getRoleEngine();
        const record = optimisticVisibility.get(toolId) || (engine?.getVisibility?.() || {})[toolId] || { visibility: 'PRIVATE', allowedUsers: [] };
        const fresh = document.createElement('div');
        fresh.innerHTML = renderAllowedUsersDropdown(tool, record, getVisibilityUsers(), pending);
        const replacement = fresh.firstElementChild;
        if (!replacement) return;
        const currentTrigger = current.querySelector('.ui-select-trigger');
        const nextValue = replacement.querySelector('.ui-select-value');
        const currentValue = currentTrigger?.querySelector('.ui-select-value');
        const currentMenu = getDropdownMenu(current);
        const nextMenu = replacement.querySelector('.ui-select-menu');
        const currentSearch = currentMenu?.querySelector('.yd-allowed-users-search')?.value || '';
        current.dataset.value = replacement.dataset.value;
        current.dataset.open = String(shouldRemainOpen);
        current.classList.toggle('open', shouldRemainOpen);
        current.classList.toggle('disabled', Boolean(pending));
        currentTrigger?.setAttribute('aria-expanded', String(shouldRemainOpen));
        if (currentTrigger) currentTrigger.disabled = Boolean(pending);
        if (currentValue && nextValue) {
            currentValue.textContent = nextValue.textContent;
            currentValue.dataset.placeholder = nextValue.dataset.placeholder;
        }
        if (currentMenu && nextMenu) {
            currentMenu.innerHTML = nextMenu.innerHTML;
            const searchInput = currentMenu.querySelector('.yd-allowed-users-search');
            if (searchInput) {
                searchInput.value = currentSearch;
                filterAllowedUsersMenu(currentMenu, currentSearch);
            }
            currentMenu.hidden = !shouldRemainOpen;
            if (shouldRemainOpen) {
                if (currentMenu.dataset.portal === 'true') positionDropdownMenu(current);
                else openDropdownMenu(current);
            } else closeDropdownMenu(current);
        }
    };

    const renderVisibility = () => {
        const tools = getTools();
        const engine = getRoleEngine();
        const visibility = { ...(engine?.getVisibility?.() || {}), ...Object.fromEntries(optimisticVisibility) };
        const users = getVisibilityUsers();
        const pendingTools = new Map(tools.map(tool => [String(tool.id), getPendingVisibility(String(tool.id))]));
        const pendingUsers = new Map(users.map(user => [String(user.id || '').trim().toUpperCase(), getPendingUser(user)]));
        const isAllowed = (tool, user) => {
            const record = visibility[String(tool.id)] || { visibility: 'PRIVATE', allowedUsers: [] };
            const userId = String(user.id || '').trim().toUpperCase();
            return record.visibility === 'PUBLIC' || (record.allowedUsers || []).some(id => String(id).trim().toUpperCase() === userId);
        };
        const renderSwitch = (tool, user) => {
            const toolId = String(tool.id);
            const userId = String(user.id || '').trim().toUpperCase();
            const allowed = isAllowed(tool, user);
            const pending = getPendingVisibility(toolId, userId);
            const pendingUser = pendingUsers.get(userId);
            const active = String(user.status || '').toLowerCase() === 'active';
            const disabled = Boolean(pending || pendingUser || !active);
            const loading = Boolean(pending || pendingUser);
            const label = (allowed ? 'Remove access for ' : 'Allow access for ') + formatName(user.name) + ' to ' + tool.name;
            return '<div class="yd-visibility-row-control">' +
                (!active && !loading ? '<span class="yd-pill red">Inactive</span>' : '') +
                '<button type="button" class="yd-switch yd-visibility-switch' + (allowed ? ' on' : '') + (loading ? ' is-loading' : '') + '" data-action="toggle-visibility" data-tool="' + escapeHTML(toolId) + '" data-user="' + escapeHTML(userId) + '" data-enabled="' + String(allowed) + '" role="switch" aria-checked="' + String(allowed) + '" aria-label="' + escapeHTML(label) + '"' + (disabled ? ' disabled' : '') + '><span class="yd-switch-knob"></span></button>' +
                '</div>';
        };
        const renderBulkSwitch = (label, mode, targetId, enabled, disabled, targetName, loading = false) => {
            const actionLabel = (enabled ? 'Disable ' : 'Enable ') + label.toLowerCase() + ' for ' + targetName;
            const targetAttribute = mode === 'ALL_TOOLS' ? 'data-user' : 'data-tool';
            return '<span class="yd-visibility-bulk"><span class="yd-visibility-bulk-label">' + label + '</span><button type="button" class="yd-switch yd-visibility-switch yd-visibility-bulk-switch' + (enabled ? ' on' : '') + (loading ? ' is-loading' : '') + '" data-action="toggle-visibility-bulk" data-mode="' + mode + '" ' + targetAttribute + '="' + escapeHTML(targetId) + '" data-enabled="' + String(enabled) + '" role="switch" aria-checked="' + String(enabled) + '" aria-label="' + escapeHTML(actionLabel) + '"' + (disabled ? ' disabled' : '') + '><span class="yd-switch-knob"></span></button></span>';
        };
        const modeCards = '<div class="yd-visibility-modes" data-active-mode="' + visibilityMode + '" role="tablist" aria-label="Visibility layout">' +
            '<button type="button" class="yd-visibility-mode-card' + (visibilityMode === 'USERS' ? ' active' : '') + '" data-action="visibility-mode" data-mode="USERS" role="tab" aria-selected="' + String(visibilityMode === 'USERS') + '"><span class="yd-visibility-mode-icon"><i class="fa-solid fa-users"></i></span><span class="yd-visibility-mode-copy"><strong>USERS</strong></span></button>' +
            '<button type="button" class="yd-visibility-mode-card' + (visibilityMode === 'TOOLS' ? ' active' : '') + '" data-action="visibility-mode" data-mode="TOOLS" role="tab" aria-selected="' + String(visibilityMode === 'TOOLS') + '"><span class="yd-visibility-mode-icon"><i class="fa-solid fa-toolbox"></i></span><span class="yd-visibility-mode-copy"><strong>TOOLS</strong></span></button></div>';
        let accordions = '';
        if (visibilityMode === 'USERS') {
            accordions = users.map(user => {
                const userId = String(user.id || '').trim().toUpperCase();
                const allowedCount = tools.filter(tool => isAllowed(tool, user)).length;
                const pendingUser = pendingUsers.get(userId);
                const expanded = visibilityExpandedUsers.has(userId) ? ' open' : '';
                const active = String(user.status || '').toLowerCase() === 'active';
                const pendingTool = tools.some(tool => getPendingVisibility(String(tool.id), userId));
                const allToolsEnabled = tools.length > 0 && allowedCount === tools.length;
                const bulkSwitch = renderBulkSwitch('ALL TOOLS', 'ALL_TOOLS', userId, allToolsEnabled, Boolean(!active || pendingUser || pendingTool || !tools.length), formatName(user.name), Boolean(pendingUser || pendingTool));
                const rows = tools.map(tool => {
                    return '<div class="yd-visibility-row"><div class="yd-visibility-row-main"><strong>' + escapeHTML(tool.name) + '</strong><small>' + escapeHTML(tool.id) + '</small></div>' + renderSwitch(tool, user) + '</div>';
                }).join('');
                return '<details class="yd-visibility-accordion-item" data-visibility-user="' + escapeHTML(userId) + '"' + expanded + '><summary><span class="yd-visibility-accordion-heading"><strong>' + escapeHTML(formatName(user.name)) + '</strong><small>' + escapeHTML(userId) + ' · ' + escapeHTML(String(user.role || 'USER').replace(/_/g, ' ')) + '</small></span><span class="yd-visibility-accordion-meta"><span class="yd-pill blue">' + allowedCount + ' / ' + tools.length + ' TOOLS</span>' + bulkSwitch + '</span></summary><div class="yd-visibility-rows">' + (rows || '<div class="yd-empty">No tools available.</div>') + '</div></details>';
            }).join('');
            if (!users.length) accordions = '<div class="yd-card yd-empty">No users are available.</div>';
        } else {
            accordions = tools.map(tool => {
                const toolId = String(tool.id);
                const allowedCount = users.filter(user => isAllowed(tool, user)).length;
                const pending = pendingTools.get(toolId);
                const expanded = visibilityExpandedTools.has(toolId) ? ' open' : '';
                const pendingUser = users.some(user => pendingUsers.get(String(user.id || '').trim().toUpperCase()));
                const allUsersEnabled = users.length > 0 && allowedCount === users.length;
                const bulkSwitch = renderBulkSwitch('ALL USERS', 'ALL_USERS', toolId, allUsersEnabled, Boolean(pending || pendingUser || !users.length), tool.name, Boolean(pending || pendingUser));
                const rows = users.map(user =>
                    '<div class="yd-visibility-row"><div class="yd-visibility-row-main"><strong>' + escapeHTML(formatName(user.name)) + '</strong><small>' + escapeHTML(String(user.id || '').trim().toUpperCase()) + ' · ' + escapeHTML(String(user.role || 'USER').replace(/_/g, ' ')) + '</small></div>' + renderSwitch(tool, user) + '</div>'
                ).join('');
                return '<details class="yd-visibility-accordion-item" data-visibility-tool="' + escapeHTML(toolId) + '"' + expanded + '><summary><span class="yd-visibility-accordion-heading"><strong>' + escapeHTML(tool.name) + '</strong><small>' + escapeHTML(toolId) + '</small></span><span class="yd-visibility-accordion-meta"><span class="yd-pill blue">' + allowedCount + ' / ' + users.length + ' USERS</span>' + bulkSwitch + '</span></summary><div class="yd-visibility-rows">' + (rows || '<div class="yd-empty">No users are available.</div>') + '</div></details>';
            }).join('');
            if (!tools.length) accordions = '<div class="yd-card yd-empty">No tools are available.</div>';
        }
        return '<section class="yd-welcome"><div><h1>Visibility</h1><p>Control which users can access each shared tool.</p></div><span class="yd-pill blue">SUPER ADMIN CONTROL</span></section>' +
            modeCards + '<div class="yd-visibility-accordion-list">' + accordions + '</div>';
    };

    const renderAnnouncements = () => {
        const posts = context.announcements?.getPosts?.() || [];
        const canManage = getRoleAccess().canManageAnnouncements;
        const role = String(context.userRole || 'USER').trim().toLowerCase().replace(/_/g, '');
        const renderCard = (post, pending = null) => {
            const published = formatAnnouncementDate(post.createdAt || post.updatedAt);
            const cycle = getAnnouncementCycle(post);
            const id = escapeHTML(post.id);
            const authorName = String(post.createdBy || 'Dashboard Team').toLocaleUpperCase();
            const author = escapeHTML(authorName);
            const cycleControl = '<span class="yd-announcement-cycle-box">' + escapeHTML(cycle) + '</span>';
            const state = String(pending?.status || '').toUpperCase();
            const busy = Boolean(pending && state !== 'FAILED');
            const statusBadge = pending ? state === 'FAILED' ? renderFailedBadge('FAILED') : renderPendingBadge(state === 'DELETING' ? 'DELETING' : 'PUBLISHING') : '';
            const actions = canManage && !busy
                ? '<footer class="yd-announcement-footer"><div class="yd-announcement-actions"><button type="button" class="yd-icon-btn" data-action="edit-announcement" data-id="' + id + '" title="Edit announcement" aria-label="Edit announcement">' + editActionIcon + '</button><button type="button" class="yd-icon-btn danger" data-action="delete-announcement" data-id="' + id + '" title="Delete announcement" aria-label="Delete announcement">' + deleteActionIcon + '</button></div></footer>'
                : '';
            return '<article class="yd-announcement-card' + (busy ? ' yd-announcement-pending' : state === 'FAILED' ? ' is-failed' : '') + '" ' + (busy ? 'aria-busy="true" aria-disabled="true"' : '') + '><header class="yd-announcement-head yd-announcement-header"><div class="yd-announcement-author-wrap"><div class="yd-announcement-avatar">' + escapeHTML(initials(authorName)) + '</div><div class="yd-announcement-meta"><strong class="yd-announcement-author"><span class="yd-announcement-by">By:</span> ' + author + '</strong><time class="yd-announcement-date">' + escapeHTML(published.date + ' • ' + published.time) + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></time>' + statusBadge + '</div></div><div class="yd-announcement-cycle-wrap">' + cycleControl + '</div></header><div class="yd-announcement-body" dir="rtl">' + escapeHTML(post.body) + '</div>' + actions + '</article>';
        };
        const pendingCreates = [...pendingAnnouncements.values()].filter(item => item.action !== 'DELETE_ANNOUNCEMENT');
        const pendingDeletes = new Map([...pendingAnnouncements.values()].filter(item => item.action === 'DELETE_ANNOUNCEMENT').map(item => [String(item.id), item]));
        const cards = [
            ...pendingCreates.map(post => renderCard(post, post)),
            ...posts.map(post => renderCard(post, pendingDeletes.get(String(post.id)) || null))
        ].join('');
        return '<section class="yd-welcome"><div><h1>Announcements</h1><p>Operational messages and important team updates.</p></div>' +
            (canManage ? '<button type="button" class="yd-primary" data-action="add-announcement"><i class="fa-solid fa-plus"></i><span>New Announcement</span></button>' : '') +
            '</section><div class="yd-announcement-list" data-role="' + escapeHTML(role) + '">' + (cards || '<div class="yd-card yd-empty">No announcements have been published yet.</div>') + '</div>';
    };

    const openAnnouncementModal = post => {
        const editing = Boolean(post);
        const cycle = getAnnouncementCycle(post || { createdAt: new Date().toISOString() });
        const overlay = document.createElement('div');
        overlay.className = 'yd-modal-backdrop';
        overlay.innerHTML = '<form class="yd-modal yd-announcement-form" role="dialog" aria-modal="true" aria-labelledby="yd-announcement-form-title"><h3 id="yd-announcement-form-title">' + (editing ? 'Edit Announcement' : 'New Announcement') + '</h3><div class="yd-field"><label for="yd-announcement-body">Message</label><textarea id="yd-announcement-body" name="body" maxlength="6000" required placeholder="Write the announcement here...">' + escapeHTML(post?.body || '') + '</textarea></div><div class="yd-field"><label for="yd-announcement-cycle">Cycle</label>' + renderDropdown('cycle', cycle, ANNOUNCEMENT_CYCLES.map(item => ({ value: item, label: item })), { id: 'yd-announcement-cycle', class: 'yd-announcement-cycle-select', 'data-label': 'Cycle' }) + '</div><div class="yd-modal-actions"><button type="button" class="yd-secondary" data-announcement-cancel>Cancel</button><button type="submit" class="yd-primary">' + (editing ? 'Save Changes' : 'Publish') + '</button></div></form>';
        document.getElementById(CONFIG.ID).appendChild(overlay);
        syncInputSurfaceBackgrounds(overlay);
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
            if (!payload.body || submit.disabled) return;
            setButtonLoading(submit, editing ? 'Saving' : 'Queuing');
            try {
                if (editing) {
                    await context.announcements.updatePost(post.id, payload);
                    await context.announcements.load();
                    close();
                    render();
                    showNotice('Announcement updated.');
                    return;
                }
                const queued = await context.announcements.queuePost(payload);
                const actor = context.user || {};
                const pending = {
                    requestId: queued.requestId,
                    id: queued.id,
                    body: queued.body,
                    cycle: queued.cycle,
                    createdBy: queued.createdBy || actor.name || context.userId || 'Dashboard Team',
                    createdById: queued.createdById || context.userId || '',
                    createdAt: queued.createdAt || new Date().toISOString(),
                    updatedAt: queued.createdAt || new Date().toISOString(),
                    status: 'PENDING',
                    action: 'CREATE_ANNOUNCEMENT'
                };
                pendingAnnouncements.set(queued.requestId, pending);
                persistPendingAnnouncements();
                const transaction = {
                    requestId: queued.requestId,
                    sequence: queued.sequence,
                    requestType: queued.requestType || 'DASHBOARD_ANNOUNCEMENTS_SYNC',
                    action: 'CREATE_ANNOUNCEMENT',
                    status: 'SENT',
                    actorId: String(context.userId || actor.id || actor.userId || '').trim().toUpperCase(),
                    actorName: formatName(actor.name || context.userId || ''),
                    targetId: queued.id,
                    summary: 'PUBLISH ANNOUNCEMENT · ' + payload.body.slice(0, 90),
                    createdAt: queued.createdAt || new Date().toISOString(),
                    updatedAt: queued.createdAt || new Date().toISOString()
                };
                persistTransaction(transaction);
                close();
                render();
                showNotice('Announcement queued for publishing. You can continue working while it processes.');
                monitorTransaction(transaction);
            } catch (error) {
                submit.disabled = false;
                submit.removeAttribute('aria-busy');
                submit.classList.remove('yd-button-loading');
                submit.textContent = editing ? 'Save Changes' : 'Publish';
                showMessageDialog('Announcement Not Saved', error?.message || 'Unable to submit this announcement.');
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
                '<div class="yd-info-row"><span>Role</span><strong>' + renderRolePill(context.userRole) + '</strong></div>' +
                '<div class="yd-info-row"><span>Personal Repository</span><strong>' + escapeHTML(context.personalRepository || '—') + '</strong></div>' +
                '<div class="yd-info-row"><span>Dashboard Repository</span><strong>' + escapeHTML(context.dashboardRepository || '—') + '</strong></div>' +
                '<div class="yd-info-row"><span>Branch</span><strong>' + escapeHTML(context.branch || 'main') + '</strong></div>' +
            '</div><div class="yd-card"><div class="yd-card-title"><span class="yd-title-icon"><i class="fa-solid fa-lock"></i></span><span>Change Password</span></div>' +
                '<div class="yd-field"><label for="yd-current-password">Current Password</label><input id="yd-current-password" type="password" autocomplete="current-password" maxlength="128"></div>' +
                '<div class="yd-field"><label for="yd-new-password">New Password</label><input id="yd-new-password" type="password" autocomplete="new-password" minlength="10" maxlength="128"></div>' +
                '<div class="yd-field"><label for="yd-confirm-password">Confirm New Password</label><input id="yd-confirm-password" type="password" autocomplete="new-password" minlength="10" maxlength="128"></div>' +
                '<button type="button" class="yd-primary" data-action="change-password"><i class="fa-solid fa-key"></i><span>Update Password</span></button>' +
            '</div></div>';
    };

    const renderPage = () => {
        const access = getRoleAccess();
        if (!access.pages.includes(activePage)) activePage = 'tools';
        const pages = {
            overview: renderOverview,
            tools: renderTools,
            announcements: renderAnnouncements,
            accounts: renderAccounts,
            users: renderUsers,
            permissions: renderPermissions,
            visibility: renderVisibility,
            transactions: renderTransactions,
            account: renderAccount
        };
        return (pages[activePage] || renderOverview)();
    };

    const render = () => {
        const root = rootElement;
        if (!isCurrentUI() || !root) return;
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
        root.querySelectorAll('i.fa-solid, i.fas, i.fa-regular, i.far, i.fa-brands, i.fab').forEach(icon => icon.classList.add('yd-custom-icon'));
        syncInputSurfaceBackgrounds(root);
    };

    const captureUIState = noticeMessage => ({
        activePage,
        isOpen,
        profileOpen,
        expandedUsers: [...document.querySelectorAll('#' + CONFIG.ID + ' details[data-user-accordion][open]')].map(item => item.dataset.user),
        expandedTools: [...document.querySelectorAll('#' + CONFIG.ID + ' details[data-tool-accordion][open]')].map(item => item.dataset.tool),
        notice: noticeMessage || '',
        noticeType: 'success'
    });

    const reloadLatestDashboardUI = async uiState => {
        const API = context?.api || window.YODAWY_API_ENGINE || page.YODAWY_API_ENGINE;
        if (!API?.getFileContent) throw new Error('Dashboard API Engine is unavailable.');
        const source = await API.getFileContent('UI/dashboard-ui.js', { timeout: 30000 });
        if (typeof source !== 'string' || !source.includes('page.YODAWY_DASHBOARD_UI')) {
            throw new Error('The latest Dashboard UI source is invalid or unavailable.');
        }
        const registrationGuard = "    if (typeof window.YODAWY_DASHBOARD_UI?.init === 'function' || typeof page.YODAWY_DASHBOARD_UI?.init === 'function') return;\n";
        if (source.split(registrationGuard).length !== 2) {
            throw new Error('The Dashboard UI registration guard could not be safely bypassed.');
        }
        const executableSource = source.replace(registrationGuard, '');
        const previousUI = page.YODAWY_DASHBOARD_UI || window.YODAWY_DASHBOARD_UI;
        if (typeof previousUI?.destroy !== 'function') throw new Error('The current Dashboard UI cannot be safely replaced.');
        const runtimeContext = context;
        const nextOptions = { ...runtimeContext, uiState };
        let nextUI = null;
        try {
            let executionError = null;
            const captureExecutionError = event => {
                executionError = event.error || new Error(event.message || 'The updated Dashboard UI script failed to execute.');
            };
            addWindowEventListener('error', captureExecutionError, true);
            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.textContent = executableSource;
            try {
                (document.head || document.documentElement).appendChild(script);
            } finally {
                script.remove();
                removeWindowEventListener('error', captureExecutionError, true);
            }
            if (executionError) throw executionError;
            nextUI = page.YODAWY_DASHBOARD_UI;
            if (!nextUI || nextUI === previousUI || typeof nextUI.init !== 'function') {
                throw new Error('The updated Dashboard UI did not register in the page window.');
            }
            nextOptions.ui = nextUI;
            await previousUI.destroy();
            await nextUI.init(nextOptions);
            runtimeContext.ui = nextUI;
            return true;
        } catch (error) {
            const failedUI = page.YODAWY_DASHBOARD_UI;
            if (failedUI && failedUI !== previousUI) {
                try { await failedUI.destroy?.(); } catch {}
            }
            window.YODAWY_DASHBOARD_UI = previousUI;
            page.YODAWY_DASHBOARD_UI = previousUI;
            runtimeContext.ui = previousUI;
            nextOptions.ui = previousUI;
            if (!previousUI.getContext?.()) await previousUI.init(nextOptions);
            throw new Error('The previous Dashboard interface was restored. ' + (error?.message || 'The update could not be activated.'));
        }
    };

    const refresh = async () => {
        const runtimeContext = context;
        if (!runtimeContext || !isCurrentUI()) throw new Error('Dashboard context is no longer active.');
        const roleEngine = getRoleEngine(runtimeContext);
        const toolsManager = runtimeContext.tools;
        let previousManifest = [];
        let loadedTools = [];
        try { previousManifest = toolsManager?.getManifest?.() || []; } catch {}
        try { loadedTools = toolsManager?.getLoadedTools?.() || []; } catch {}
        await Promise.all([
            runtimeContext.permissions?.load?.(),
            runtimeContext.visibility?.load?.(),
            runtimeContext.settings?.load?.(),
            toolsManager?.loadManifest?.(),
            runtimeContext.announcements?.load?.()
        ]);
        if (context !== runtimeContext || !isCurrentUI()) return false;
        if (roleEngine?.refresh) await roleEngine.refresh();
        const nextManifest = toolsManager?.getManifest?.() || [];
        const previousById = new Map(previousManifest.map(tool => [String(tool.id), tool]));
        const nextById = new Map(nextManifest.map(tool => [String(tool.id), tool]));
        const outdatedTools = loadedTools.filter(loaded => {
            const previous = previousById.get(String(loaded.id));
            const next = nextById.get(String(loaded.id));
            return !next || !previous || previous.path !== next.path || previous.sha256 !== next.sha256;
        });
        const skippedTools = [];
        for (const loaded of outdatedTools) {
            if (loaded.destroyable === false || typeof toolsManager?.stop !== 'function') {
                skippedTools.push(loaded.name || loaded.id);
                continue;
            }
            try {
                if (await toolsManager.stop(loaded.id) !== true) skippedTools.push(loaded.name || loaded.id);
            } catch {
                skippedTools.push(loaded.name || loaded.id);
            }
        }
        await toolsManager?.sync?.();
        if (context !== runtimeContext || !isCurrentUI()) return false;
        const message = skippedTools.length
            ? 'Dashboard updated. These tools could not be safely restarted: ' + skippedTools.join(', ')
            : 'Dashboard and available tools updated successfully.';
        await reloadLatestDashboardUI(captureUIState(message));
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

    const getTransactionActivity = status => {
        const states = {
            SENT: ['QUEUED', 'Submitted to NETWORK · waiting for processing'],
            RECEIVED: ['RECEIVED', 'Request received by the destination workflow'],
            PROCESSING: ['PROCESSING', 'Applying the requested changes'],
            PROCESSED: ['PROCESSED', 'Changes applied · preparing the response'],
            RESPONSE_SENT: ['SYNCING', 'Returning the result to Dashboard'],
            COMPLETED: ['FINALIZING', 'Applying the confirmed result'],
            FAILED: ['FAILED', 'The workflow reported a failure'],
            REJECTED: ['REJECTED', 'The request was rejected']
        };
        const [statusLabel, stage] = states[status] || ['QUEUED', 'Waiting for NETWORK status'];
        return { status, statusLabel, stage };
    };

    const monitorTransaction = (transaction, existingActivityId = '', transactionEngine = null) => {
        const requestId = transaction?.requestId;
        if (!requestId || trackedTransactions.has(requestId)) return;
        trackedTransactions.add(requestId);
        const activityId = existingActivityId || 'NETWORK-' + requestId;
        const initial = getTransactionActivity(String(transaction.status || 'SENT').toUpperCase());
        beginActivity(transaction.summary || formatAction(transaction.action), getActivityLocation(transaction), initial.stage, activityId);
        updateActivity(activityId, { ...initial, requestId });
        const task = (async () => {
            const startedAt = Date.now();
            let keepActivity = false;
            try {
                const engine = transactionEngine || getRoleEngine();
                if (!engine?.getTransaction) throw new Error('NETWORK transaction engine is unavailable.');
                let result = null;
                while (Date.now() - startedAt < 1800000) {
                    try {
                        result = await engine.getTransaction(requestId);
                    } catch {
                        updateActivity(activityId, { status: 'WAITING', statusLabel: 'RETRYING', stage: 'Checking NETWORK status again' });
                        await new Promise(resolve => setTimeout(resolve, 3500));
                        continue;
                    }
                    const status = String(result?.status || transaction.status || 'SENT').toUpperCase();
                    updateActivity(activityId, { ...getTransactionActivity(status), requestId });
                    if (['COMPLETED', 'FAILED', 'REJECTED'].includes(status)) break;
                    await new Promise(resolve => setTimeout(resolve, 4000));
                }
                const status = String(result?.status || '').toUpperCase();
                if (!result || !['COMPLETED', 'FAILED', 'REJECTED'].includes(status)) {
                    keepActivity = Boolean(context && localTransactions.has(requestId));
                    updateActivity(activityId, { status: 'QUEUED', statusLabel: 'WAITING', stage: 'Still processing · next status check scheduled' });
                    showMessageDialog('Still Processing', 'This request is taking longer than expected. It remains queued and locked. The dashboard will keep checking its status.');
                    if (keepActivity) setTimeout(() => monitorTransaction(transaction, activityId, engine), 15000);
                    return;
                }
                if (status !== 'COMPLETED') throw new Error(result?.error || result?.message || 'The request could not be completed.');
                updateActivity(activityId, { status: 'FINALIZING', statusLabel: 'SYNCING', stage: 'Refreshing Dashboard data and confirming the update' });
                if (transaction.requestType === 'DASHBOARD_ANNOUNCEMENTS_SYNC' && ['CREATE_ANNOUNCEMENT', 'DELETE_ANNOUNCEMENT'].includes(transaction.action)) {
                    pendingAnnouncements.delete(requestId);
                    persistPendingAnnouncements();
                }
                removePendingTransaction(transaction);
                try { await refresh(); } catch {}
                showNotice((transaction.summary || formatAction(transaction.action)) + ' completed successfully.');
            } catch (error) {
                if (transaction.requestType === 'DASHBOARD_ANNOUNCEMENTS_SYNC' && ['CREATE_ANNOUNCEMENT', 'DELETE_ANNOUNCEMENT'].includes(transaction.action)) {
                    pendingAnnouncements.delete(requestId);
                    persistPendingAnnouncements();
                }
                removePendingTransaction(transaction);
                try { await refresh(); } catch {}
                showMessageDialog('Operation Failed', error?.message || 'The background operation failed. No changes were confirmed.');
            } finally {
                trackedTransactions.delete(requestId);
                if (!keepActivity) finishActivity(activityId);
            }
        })();
        backgroundTransactions.add(task);
        task.finally(() => backgroundTransactions.delete(task)).catch(() => {});
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
        const runtimeContext = context;
        if (!runtimeContext || !isCurrentUI()) throw new Error('Dashboard context is no longer active.');
        const transactionEngine = getRoleEngine(runtimeContext);
        const actor = runtimeContext.user || {};
        const actorId = String(runtimeContext.userId || actor.id || actor.userId || '').trim().toUpperCase();
        const activityId = beginActivity(message, getActivityLocation(metadata), 'Creating NETWORK request', 'SUBMIT-' + (++activityCounter));
        let request;
        try {
            request = await operation();
            if (!request?.requestId) throw new Error('GitHub did not confirm the request.');
        } catch (error) {
            finishActivity(activityId);
            if (Array.isArray(metadata.targetToolIds) && metadata.targetToolIds.length) {
                metadata.targetToolIds.forEach(toolId => optimisticVisibility.delete(toolId));
                render();
            }
            throw error;
        }
        const transaction = {
            ...metadata,
            requestId: request.requestId,
            sequence: request.sequence,
            requestType: 'DASHBOARD_USERS_SYNC',
            status: 'SENT',
            actorId,
            actorName: formatName(actor.name || runtimeContext.userId || ''),
            createdAt: request.createdAt || new Date().toISOString(),
            updatedAt: request.createdAt || new Date().toISOString()
        };
        if (!transaction.summary) transaction.summary = formatAction(transaction.action || message);
        persistTransaction(transaction);
        updateActivity(activityId, {
            status: 'QUEUED',
            statusLabel: 'QUEUED',
            stage: 'Submitted · waiting for NETWORK workflow',
            requestId: request.requestId,
            label: transaction.summary || message,
            location: getActivityLocation(transaction)
        });
        if (isCurrentUI()) {
            render();
            showNotice(message + ' queued. You can continue working while it processes.');
        }
        monitorTransaction(transaction, activityId, transactionEngine);
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
        const api = context?.api || window.YODAWY_API_ENGINE || page.YODAWY_API_ENGINE;
        if (typeof api?.recordActivity === 'function') return api.recordActivity({ action, toolId, toolName, summary });
        const config = api?.getConfig?.();
        if (!api?.getFile || !api?.put || !config?.owner || !config?.repo || !config?.branch) throw new Error('Central NETWORK API is unavailable.');
        const actor = context.user || {};
        const now = new Date().toISOString();
        const requestId = 'ACTIVITY-' + (page.crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(36).slice(2)));
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
        const users = getVisibilityUsers();
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
                button.classList.remove('yd-button-loading');
                button.textContent = confirmLabel;
                showMessageDialog('Unable to Submit Request', error?.message || 'The requested action failed.');
            }
        });
    };

    const openUserModal = user => {
        const editing = Boolean(user);
        const overlay = document.createElement('div');
        overlay.className = 'yd-modal-backdrop';
        const roleOptions = context.userRole === 'SUPER_ADMIN'
            ? [{ value: 'USER', label: 'USER' }, { value: 'ADMIN', label: 'ADMIN' }, { value: 'SUPER_ADMIN', label: 'SUPER ADMIN' }]
            : context.userRole === 'ADMIN' && !editing
                ? [{ value: 'USER', label: 'USER' }, { value: 'ADMIN', label: 'ADMIN' }]
                : [];
        const roleDropdown = roleOptions.length
            ? '<div class="yd-field"><label>Role</label>' + renderDropdown('role', user?.role || 'USER', roleOptions, { 'data-label': 'Roles' }) + '</div>'
            : '';
        const statusDropdown = '<div class="yd-field"><label>Status</label>' + renderDropdown('status', user?.status || 'Active', [{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }], { 'data-label': 'Status' }) + '</div>';
        overlay.innerHTML = '<form class="yd-modal" id="yd-user-form">' +
            '<h3>' + (editing ? 'Edit User' : 'Add User') + '</h3>' +
            '<div class="yd-form-grid">' +
                '<div class="yd-field"><label>Full Name</label><input name="name" required value="' + escapeHTML(formatName(user?.name || '')) + '" placeholder="Employee full name"></div>' +
                (editing ? '<div class="yd-field"><label>Reset Password (Optional)</label><input name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" placeholder="Leave blank to keep current password"></div>' : '<div class="yd-field"><label>Initial Password</label><input name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required placeholder="At least 10 characters"></div>') +
                roleDropdown + statusDropdown +
            '</div><div class="yd-modal-actions"><button type="button" class="yd-secondary" data-modal-close>Cancel</button><button type="submit" class="yd-primary">' + (editing ? 'Save Changes' : 'Create User') + '</button></div></form>';
        document.getElementById(CONFIG.ID).appendChild(overlay);
        syncInputSurfaceBackgrounds(overlay);
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
                ...(String(form.get('password') || '') ? { password: String(form.get('password') || '') } : {}),
                ...((context.userRole === 'SUPER_ADMIN' || (!editing && context.userRole === 'ADMIN')) ? { role: form.get('role') || 'USER' } : {})
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
                await runNetworkOperation(editing ? 'Updating user' : 'Creating user', async () => {
                    if (!editing) return engine.addUser(payload);
                    const result = await engine.editUser(user.id, payload);
                    if (payload.password) await context.api.setUserPassword(user.id, payload.password);
                    return result;
                }, metadata);
                close();
            } catch (error) {
                submitButton.disabled = false;
                submitButton.removeAttribute('aria-busy');
                submitButton.classList.remove('yd-button-loading');
                submitButton.textContent = editing ? 'Save Changes' : 'Create User';
                showMessageDialog('Unable to submit user request', error?.message || 'The request could not be submitted.');
            }
        });
    };

    let activeMessageDialog = null;
    let messageDialogTimer = null;
    const showMessageDialog = (title, message, type = 'error') => {
        if (!isCurrentUI()) return;
        const root = document.getElementById(CONFIG.ID);
        if (!root) return;
        const computed = getComputedStyle(root);
        const variables = [...computed].filter(name => name.startsWith('--'));
        if (activeMessageDialog?.isConnected) {
            const section = activeMessageDialog.querySelector('.yd-message-modal');
            const heading = section?.querySelector('h3');
            const body = section?.querySelector('[data-message-details]');
            if (heading && body) {
                const entry = document.createElement('p');
                entry.textContent = title + ': ' + message;
                body.appendChild(entry);
                heading.textContent = 'Multiple Dashboard Messages';
            }
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'yd-modal-backdrop';
        variables.forEach(name => overlay.style.setProperty(name, computed.getPropertyValue(name)));
        const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
        overlay.innerHTML = '<section class="yd-modal yd-confirm-modal yd-message-modal" role="dialog" aria-modal="true"><div class="yd-message-icon ' + escapeHTML(type) + '"><i class="fa-solid ' + icon + '"></i></div><h3>' + escapeHTML(title) + '</h3><div data-message-details><p>' + escapeHTML(message) + '</p></div><div class="yd-modal-actions"><button type="button" class="yd-primary" data-message-close>OK</button></div></section>';
        overlay.querySelectorAll('i.fa-solid, i.fas, i.fa-regular, i.far, i.fa-brands, i.fab').forEach(icon => icon.classList.add('yd-custom-icon'));
        document.body.appendChild(overlay);
        activeMessageDialog = overlay;
        const closeButton = overlay.querySelector('[data-message-close]');
        if (closeButton) {
            closeButton.disabled = true;
            closeButton.textContent = 'Please wait 10 seconds';
        }
        messageDialogTimer = setTimeout(() => {
            overlay.remove();
            if (activeMessageDialog === overlay) activeMessageDialog = null;
        }, 10000);
    };

    const runAction = async (action, button) => {
        try {
            const access = getRoleAccess();
            if (!access.actions.includes(action)) throw new Error('This action is not available for your role.');
            if (action === 'toggle-permission' && button?.dataset.field === 'forcedState' && context.userRole !== 'SUPER_ADMIN') {
                throw new Error('Forced State can only be managed by SUPER ADMIN.');
            }
            if (action === 'refresh-connection') {
                if (button?.disabled) return;
                if (button) {
                    button.disabled = true;
                    button.setAttribute('aria-busy', 'true');
                    const icon = button.querySelector('.yd-action-icon');
                    const label = button.querySelector('b');
                    if (icon) icon.innerHTML = '<span class="yd-control-spinner" aria-hidden="true"></span>';
                    if (label) label.textContent = 'Refresh';
                }
                showNotice('Refreshing dashboard files, data and available tools...');
                trackBackground(refresh().catch(error => showMessageDialog('Dashboard Refresh Failed', error?.message || 'Unable to refresh the dashboard.')).finally(() => {
                    if (button?.isConnected) {
                        button.disabled = false;
                        button.removeAttribute('aria-busy');
                button.classList.remove('yd-button-loading');
                        const icon = button.querySelector('.yd-action-icon');
                        const label = button.querySelector('b');
                        if (icon) icon.innerHTML = '<i class="fa-solid fa-arrow-rotate-right"></i>';
                        if (label) label.textContent = 'Refresh';
                    }
                }), { label: 'Refreshing Dashboard', location: 'Dashboard', stage: 'Refreshing files, data and tools' });
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
                })(), { label: 'Saving Personal Settings', location: 'Settings', stage: 'Saving preferences and recording NETWORK activity' });
            } else if (action === 'change-password') {
                const currentPassword = document.getElementById('yd-current-password')?.value || '';
                const newPassword = document.getElementById('yd-new-password')?.value || '';
                const confirmPassword = document.getElementById('yd-confirm-password')?.value || '';
                if (!context.cloudAuth?.changePassword) throw new Error('Cloud password service is not connected yet.');
                if (newPassword.length < 10 || newPassword.length > 128) throw new Error('New password must contain 10 to 128 characters.');
                if (newPassword !== confirmPassword) throw new Error('New password confirmation does not match.');
                setButtonLoading(button, 'Updating');
                await context.cloudAuth.changePassword(currentPassword, newPassword);
                showMessageDialog('Password Updated', 'Your password has been changed. Sign in again with your new password.');
                context.auth?.logout?.();
                setTimeout(() => page.location.reload(), 1200);
                return;
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
                })(), { label: (nextEnabled ? 'Enabling ' : 'Disabling ') + (getTools().find(tool => String(tool.id) === String(toolId))?.name || toolId), location: 'Tools · ' + toolId, stage: 'Updating personal tool settings and synchronizing the module' });
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
            } else if (action === 'toggle-visibility-bulk') {
                const mode = String(button.dataset.mode || '');
                const engine = getRoleEngine();
                const users = getVisibilityUsers();
                const tools = getTools();
                const visibility = { ...(engine?.getVisibility?.() || {}), ...Object.fromEntries(optimisticVisibility) };
                if (mode === 'ALL_USERS') {
                    const toolId = String(button.dataset.tool || '').trim();
                    const tool = tools.find(item => String(item.id) === toolId);
                    if (!tool || button.disabled || getPendingVisibility(toolId) || users.some(user => getPendingUser(user))) return;
                    const currentRecord = visibility[toolId] || { visibility: 'PRIVATE', allowedUsers: [] };
                    const currentAllowed = users.length > 0 && users.every(user => {
                        const userId = String(user.id || '').trim().toUpperCase();
                        return currentRecord.visibility === 'PUBLIC' || (currentRecord.visibility === 'SELECTED_USERS' && (currentRecord.allowedUsers || []).some(id => String(id).trim().toUpperCase() === userId));
                    });
                    const nextEnabled = !currentAllowed;
                    const updatedRecord = nextEnabled
                        ? { visibility: 'PUBLIC', allowedUsers: [] }
                        : { visibility: 'SELECTED_USERS', allowedUsers: [] };
                    optimisticVisibility.set(toolId, updatedRecord);
                    pendingVisibilitySubmissions.add(toolId + ':*');
                    render();
                    const metadata = {
                        action: 'UPDATE_VISIBILITY',
                        targetToolIds: [toolId],
                        summary: 'UPDATE VISIBILITY · ALL USERS · ' + tool.name + ' · ' + (nextEnabled ? 'ACCESS ENABLED' : 'ACCESS DISABLED')
                    };
                    try {
                        await runNetworkOperation((nextEnabled ? 'Enabling' : 'Disabling') + ' all users for ' + tool.name, () =>
                            engine.setToolVisibility(toolId, updatedRecord), metadata
                        );
                    } finally {
                        pendingVisibilitySubmissions.delete(toolId + ':*');
                        render();
                    }
                } else if (mode === 'ALL_TOOLS') {
                    const userId = String(button.dataset.user || '').trim().toUpperCase();
                    const user = users.find(item => String(item.id || '').trim().toUpperCase() === userId);
                    if (!user || String(user.status || '').toLowerCase() !== 'active' || button.disabled || getPendingUser(user) || tools.some(tool => getPendingVisibility(String(tool.id), userId))) return;
                    const nextEnabled = button.dataset.enabled !== 'true';
                    const userIds = users.map(item => String(item.id || '').trim().toUpperCase());
                    const changes = [];
                    for (const tool of tools) {
                        const toolId = String(tool.id);
                        const currentRecord = visibility[toolId] || { visibility: 'PRIVATE', allowedUsers: [] };
                        const currentAllowed = currentRecord.visibility === 'PUBLIC' ||
                            (currentRecord.visibility === 'SELECTED_USERS' && (currentRecord.allowedUsers || []).some(id => String(id).trim().toUpperCase() === userId));
                        if (currentAllowed === nextEnabled) continue;
                        const allowedUsers = new Set(currentRecord.visibility === 'PUBLIC'
                            ? userIds
                            : currentRecord.visibility === 'SELECTED_USERS'
                                ? (currentRecord.allowedUsers || []).map(id => String(id).trim().toUpperCase())
                                : []);
                        if (nextEnabled) allowedUsers.add(userId);
                        else allowedUsers.delete(userId);
                        changes.push({ tool, toolId, record: { visibility: 'SELECTED_USERS', allowedUsers: [...allowedUsers] } });
                    }
                    if (!changes.length) {
                        showNotice('All tools already have the requested access state for ' + formatName(user.name) + '.');
                        return;
                    }
                    changes.forEach(({ toolId, record }) => {
                        optimisticVisibility.set(toolId, record);
                        pendingVisibilitySubmissions.add(toolId + ':' + userId);
                    });
                    render();
                    const visibilityChanges = Object.fromEntries(changes.map(({ toolId, record }) => [toolId, record]));
                    const targetToolIds = changes.map(({ toolId }) => toolId);
                    const metadata = {
                        action: 'UPDATE_VISIBILITY',
                        targetId: userId,
                        targetName: formatName(user.name || userId),
                        targetToolIds,
                        summary: 'UPDATE VISIBILITY · ALL TOOLS · ' + formatName(user.name || userId) + ' · ' + targetToolIds.length + ' TOOLS · ' + (nextEnabled ? 'ACCESS ENABLED' : 'ACCESS DISABLED')
                    };
                    try {
                        await runNetworkOperation((nextEnabled ? 'Enabling' : 'Disabling') + ' all ' + targetToolIds.length + ' tools for ' + formatName(user.name || userId), () =>
                            engine.updateVisibility(visibilityChanges, { targetToolIds }), metadata
                        );
                        showNotice('ALL TOOLS access ' + (nextEnabled ? 'enabled' : 'disabled') + ' for ' + formatName(user.name || userId) + '.');
                    } finally {
                        targetToolIds.forEach(toolId => pendingVisibilitySubmissions.delete(toolId + ':' + userId));
                        render();
                    }
                }
            } else if (action === 'toggle-visibility') {
                const toolId = String(button.dataset.tool || '').trim();
                const userId = String(button.dataset.user || '').trim().toUpperCase();
                const engine = getRoleEngine();
                const user = getVisibilityUsers().find(item => String(item.id || '').trim().toUpperCase() === userId);
                const tool = getTools().find(item => String(item.id || '').trim() === toolId);
                if (!tool || !user || button.disabled || getPendingVisibility(toolId, userId) || getPendingUser(user)) return;
                const currentRecord = optimisticVisibility.get(toolId) || (engine?.getVisibility?.() || {})[toolId] || { visibility: 'PRIVATE', allowedUsers: [] };
                const allowedUsers = new Set(currentRecord.visibility === 'PUBLIC'
                    ? getVisibilityUsers().map(item => String(item.id || '').trim().toUpperCase())
                    : (currentRecord.allowedUsers || []).map(id => String(id).trim().toUpperCase()));
                const currentAllowed = currentRecord.visibility === 'PUBLIC' || allowedUsers.has(userId);
                const nextAllowed = !currentAllowed;
                if (nextAllowed) allowedUsers.add(userId);
                else allowedUsers.delete(userId);
                const updatedRecord = { visibility: 'SELECTED_USERS', allowedUsers: [...allowedUsers] };
                optimisticVisibility.set(toolId, updatedRecord);
                pendingVisibilitySubmissions.add(toolId + ':' + userId);
                render();
                const metadata = {
                    action: 'UPDATE_VISIBILITY',
                    targetId: userId,
                    targetName: formatName(user.name || userId),
                    targetToolIds: [toolId],
                    summary: 'UPDATE VISIBILITY · ' + tool.name + ' · ' + formatName(user.name || userId) + ' · ' + (nextAllowed ? 'ACCESS ENABLED' : 'ACCESS DISABLED')
                };
                try {
                    await runNetworkOperation('Updating visibility for ' + formatName(user.name || userId), () =>
                        engine.setToolVisibility(toolId, updatedRecord), metadata
                    );
                } finally {
                    pendingVisibilitySubmissions.delete(toolId + ':' + userId);
                    render();
                }
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
                pendingVisibilitySubmissions.add(toolId + ':*');
                visibilityDraft = null;
                openVisibilityToolId = null;
                closeDropdowns(null);
                render();
                const metadata = { action: 'UPDATE_VISIBILITY', targetToolIds: [toolId], summary: 'UPDATE VISIBILITY · ' + toolId };
                try {
                    await runNetworkOperation('Saving allowed users', () => getRoleEngine().setToolVisibility(toolId, record), metadata);
                } finally {
                    pendingVisibilitySubmissions.delete(toolId + ':*');
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
                if ([...pendingAnnouncements.values()].some(item => item.id === post.id)) return;
                openConfirmDialog('Delete Announcement', 'Delete this announcement?', 'Delete', async () => {
                    const queued = await context.announcements.queueDelete(post.id);
                    const actor = context.user || {};
                    const pending = {
                        requestId: queued.requestId,
                        id: post.id,
                        body: post.body,
                        cycle: post.cycle,
                        createdBy: post.createdBy || actor.name || context.userId || 'Dashboard Team',
                        createdById: post.createdById || context.userId || '',
                        createdAt: post.createdAt || queued.createdAt || new Date().toISOString(),
                        updatedAt: queued.createdAt || new Date().toISOString(),
                        status: 'DELETING',
                        action: 'DELETE_ANNOUNCEMENT'
                    };
                    pendingAnnouncements.set(queued.requestId, pending);
                    persistPendingAnnouncements();
                    const transaction = {
                        requestId: queued.requestId,
                        sequence: queued.sequence,
                        requestType: queued.requestType || 'DASHBOARD_ANNOUNCEMENTS_SYNC',
                        action: 'DELETE_ANNOUNCEMENT',
                        status: 'SENT',
                        actorId: String(context.userId || actor.id || actor.userId || '').trim().toUpperCase(),
                        actorName: formatName(actor.name || context.userId || ''),
                        targetId: post.id,
                        summary: 'DELETE ANNOUNCEMENT · ' + String(post.body || '').slice(0, 90),
                        createdAt: queued.createdAt || new Date().toISOString(),
                        updatedAt: queued.createdAt || new Date().toISOString()
                    };
                    persistTransaction(transaction);
                    render();
                    showNotice('Announcement queued for deletion. The card is disabled while it processes.');
                    monitorTransaction(transaction);
                });
            }
        } catch (error) {
            if (button && ['toggle-permission', 'toggle-visibility-bulk'].includes(action)) render();
            showMessageDialog(error?.partial ? 'Bulk Update Partially Submitted' : 'Operation Not Submitted', error?.message || 'The requested operation could not be submitted.');
        }
    };

    const getDropdownMenu = dropdown => dropdown?._ydSelectMenu || dropdown?.querySelector('.ui-select-menu') || null;

    const positionDropdownMenu = dropdown => {
        const menu = getDropdownMenu(dropdown);
        const trigger = dropdown?.querySelector('.ui-select-trigger');
        if (!menu || !trigger || menu.dataset.portal !== 'true') return;
        const rect = trigger.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const isAllowedUsers = dropdown.classList.contains('yd-allowed-users-dropdown');
        const width = Math.min(Math.max(isAllowedUsers ? dropdownRect.width : rect.width, isAllowedUsers ? 240 : 144), viewportWidth - 24);
        const maxHeight = Math.min(dropdown.classList.contains('yd-announcement-cycle-select') ? 260 : 320, viewportHeight - 24);
        const menuHeight = Math.min(menu.scrollHeight || maxHeight, maxHeight);
        const roomBelow = viewportHeight - rect.bottom - 12;
        const roomAbove = rect.top - 12;
        const openAbove = roomBelow < Math.min(menuHeight, 180) && roomAbove > roomBelow;
        menu.dataset.openDirection = openAbove ? 'up' : 'down';
        const supportsAnchor = typeof CSS !== 'undefined' &&
            CSS.supports('position-anchor: --yd-active-dropdown-anchor') &&
            CSS.supports('top: anchor(bottom)') &&
            CSS.supports('width: anchor-size(width)');
        if (supportsAnchor) {
            trigger.style.setProperty('anchor-name', '--yd-active-dropdown-anchor');
            menu.style.setProperty('position-anchor', '--yd-active-dropdown-anchor', 'important');
            if (isAllowedUsers) menu.style.setProperty('--yd-select-menu-width', dropdownRect.width + 'px');
            else menu.style.removeProperty('--yd-select-menu-width');
            ['position', 'left', 'right', 'top', 'width', 'min-width', 'max-width', 'max-height', 'margin-top'].forEach(property => menu.style.removeProperty(property));
            return;
        }
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
        syncInputSurfaceBackgrounds(menu);
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
        dropdown.querySelector('.ui-select-trigger')?.style.removeProperty('anchor-name');
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
        if (!getRoleAccess().canManageVisibility) return false;
        if (actionButton?.dataset.action === 'toggle-allowed-user') {
            const toolId = actionButton.dataset.tool;
            const userId = actionButton.dataset.user;
            if (getPendingVisibility(toolId)) return true;
            if (!visibilityDraft || visibilityDraft.toolId !== toolId) visibilityDraft = createVisibilityDraft(toolId);
            if (visibilityDraft.allUsers) {
                visibilityDraft.allowedUsers = new Set(getVisibilityUsers().map(user => String(user.id || '').trim().toUpperCase()));
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
    };

    const bindEvents = root => {
        root.addEventListener('change', async event => {
            const select = event.target.closest?.('[data-action="split-account-preference"]');
            if (!select || !root.contains(select)) return;
            const selected = String(select.value || '').toUpperCase();
            if (!['PERSONAL', 'ALTERNATIVE'].includes(selected)) return;
            select.disabled = true;
            try {
                const updated = context.settings.getSettings();
                updated.preferences = { ...(updated.preferences || {}), metlifeSplitAccount: selected };
                await context.settings.save(updated);
                showNotice('MetLife Split Account preference saved.');
            } catch (error) {
                showMessageDialog('Preference Not Saved', error?.message || 'Unable to save your Split account preference.');
                render();
            } finally {
                if (select.isConnected) select.disabled = false;
            }
        });

        root.addEventListener('toggle', event => {
            const userItem = event.target.closest?.('details[data-user-accordion]');
            const toolItem = event.target.closest?.('details[data-tool-accordion]');
            const visibilityUserItem = event.target.closest?.('details[data-visibility-user]');
            const visibilityToolItem = event.target.closest?.('details[data-visibility-tool]');
            if (visibilityUserItem) {
                if (visibilityUserItem.open) {
                    root.querySelectorAll('details[data-visibility-user]').forEach(other => {
                        if (other !== visibilityUserItem && other.open) other.open = false;
                    });
                    visibilityExpandedUsers.clear();
                    visibilityExpandedUsers.add(visibilityUserItem.dataset.visibilityUser);
                } else visibilityExpandedUsers.delete(visibilityUserItem.dataset.visibilityUser);
            }
            if (visibilityToolItem) {
                if (visibilityToolItem.open) {
                    root.querySelectorAll('details[data-visibility-tool]').forEach(other => {
                        if (other !== visibilityToolItem && other.open) other.open = false;
                    });
                    visibilityExpandedTools.clear();
                    visibilityExpandedTools.add(visibilityToolItem.dataset.visibilityTool);
                } else visibilityExpandedTools.delete(visibilityToolItem.dataset.visibilityTool);
            }
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

        activityClickHandler = event => {
            const actionButton = event.target.closest?.('[data-action="activity-toggle"], [data-action="activity-close"]');
            if (!actionButton || !root.contains(actionButton)) return;
            event.preventDefault();
            event.stopPropagation();
            activityMenuOpen = actionButton.dataset.action === 'activity-toggle' ? !activityMenuOpen : false;
            const menu = root.querySelector('.yd-activity-dropdown');
            const trigger = root.querySelector('[data-action="activity-toggle"]');
            if (menu) menu.hidden = !activityMenuOpen;
            trigger?.setAttribute('aria-expanded', String(activityMenuOpen));
        };
        activityClickRoot = root;
        root.addEventListener('click', activityClickHandler, true);

        root.addEventListener('click', event => {
            const actionButton = event.target.closest('[data-action]');
            const dropdown = event.target.closest('.yd-dropdown');
            if (activityMenuOpen && !event.target.closest('.yd-activity-wrap')) {
                activityMenuOpen = false;
                const activityMenu = root.querySelector('.yd-activity-dropdown');
                if (activityMenu) activityMenu.hidden = true;
                root.querySelector('[data-action="activity-toggle"]')?.setAttribute('aria-expanded', 'false');
            }
            if (handleAllowedUsersAction(actionButton)) return;
            if (actionButton?.dataset.action === 'toggle-visibility-bulk') {
                event.preventDefault();
                event.stopPropagation();
                runAction(actionButton.dataset.action, actionButton);
                return;
            }
            if (actionButton?.dataset.action === 'visibility-mode') {
                visibilityMode = actionButton.dataset.mode === 'TOOLS' ? 'TOOLS' : 'USERS';
                render();
                return;
            }
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
            if (actionButton?.dataset.action === 'activity-toggle') { activityMenuOpen = !activityMenuOpen; render(); return; }
            if (actionButton?.dataset.action === 'activity-close') { activityMenuOpen = false; render(); return; }
            if (actionButton?.dataset.action === 'profile-toggle') { profileOpen = !profileOpen; render(); return; }
            if (actionButton?.dataset.action === 'network-page') {
                event.preventDefault();
                networkPage = Math.max(1, Number(actionButton.dataset.page) || 1);
                render();
                return;
            }
            const nav = event.target.closest('[data-page]');
            if (nav) {
                const nextPage = nav.dataset.page;
                if (nextPage !== activePage) {
                    expandedUsers.clear();
                    expandedTools.clear();
                    visibilityExpandedUsers.clear();
                    visibilityExpandedTools.clear();
                    root.querySelectorAll('details[data-user-accordion], details[data-tool-accordion], details[data-visibility-user], details[data-visibility-tool]').forEach(item => {
                        item.open = false;
                    });
                }
                activePage = nextPage;
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
            } else if (event.target.matches('.yd-permission-search')) {
                const body = event.target.closest('.yd-accordion-body');
                const query = event.target.value.trim().toLocaleLowerCase();
                const rows = [...(body?.querySelectorAll('.yd-permission-row') || [])];
                let visible = 0;
                rows.forEach(row => {
                    const matches = !query || row.textContent.toLocaleLowerCase().includes(query);
                    row.hidden = !matches;
                    if (matches) visible++;
                });
                const empty = body?.querySelector('.yd-permission-search-empty');
                if (empty) empty.hidden = !query || visible > 0;
            }
        });

        dropdownMenuInputHandler = event => {
            const searchInput = event.target.closest?.('.yd-allowed-users-search');
            if (!searchInput) return;
            filterAllowedUsersMenu(searchInput.closest('.ui-select-menu'), searchInput.value);
        };
        document.addEventListener('input', dropdownMenuInputHandler);

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
            if (!root.contains(event.target)) {
                closeDropdowns(null);
                if (activityMenuOpen) {
                    activityMenuOpen = false;
                    render();
                }
            }
        };
        document.addEventListener('click', dropdownOutsideClickHandler);

        dropdownKeydownHandler = event => {
            if (event.key !== 'Escape') return;
            if (activityMenuOpen) {
                activityMenuOpen = false;
                render();
                return;
            }
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
        addWindowEventListener('resize', dropdownResizeHandler);
    };

    const init = async options => {
        if (context) return true;
        if (!options || options.authenticated !== true || !options.user || !options.tools) {
            throw new Error('Authenticated dashboard context is required.');
        }
        context = options;
        const uiState = options.uiState && typeof options.uiState === 'object' ? options.uiState : {};
        const defaultPage = context.settings?.getSettings?.()?.startPage;
        const requestedPage = String(uiState.activePage || '');
        activePage = navItems().some(item => item[0] === requestedPage) ? requestedPage : defaultPage === 'overview' ? 'overview' : 'tools';
        expandedUsers.clear();
        expandedTools.clear();
        (Array.isArray(uiState.expandedUsers) ? uiState.expandedUsers : []).forEach(id => expandedUsers.add(String(id)));
        (Array.isArray(uiState.expandedTools) ? uiState.expandedTools : []).forEach(id => expandedTools.add(String(id)));
        restorePendingTransactions();
        restorePendingAnnouncements();
        isOpen = uiState.isOpen === true;
        profileOpen = uiState.profileOpen === true;
        notice = null;
        injectStyles();
        document.getElementById(CONFIG.ID)?.remove();
        const root = document.createElement('div');
        root.id = CONFIG.ID;
        rootElement = root;
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
        if (dropdownMenuInputHandler) document.removeEventListener('input', dropdownMenuInputHandler);
        if (dropdownOutsideClickHandler) document.removeEventListener('click', dropdownOutsideClickHandler);
        if (dropdownKeydownHandler) document.removeEventListener('keydown', dropdownKeydownHandler);
        if (dropdownScrollHandler) document.removeEventListener('scroll', dropdownScrollHandler, true);
        if (dropdownResizeHandler) removeWindowEventListener('resize', dropdownResizeHandler);
        if (activityClickRoot && activityClickHandler) activityClickRoot.removeEventListener('click', activityClickHandler, true);
        activityClickRoot = activityClickHandler = null;
        dropdownMenuClickHandler = dropdownMenuInputHandler = dropdownOutsideClickHandler = dropdownKeydownHandler = dropdownScrollHandler = dropdownResizeHandler = null;
        rootElement?.remove();
        if (document.getElementById(CONFIG.STYLE_ID)) document.getElementById(CONFIG.STYLE_ID).remove();
        rootElement = null;
        context = null;
        portalAccounts = null;
        portalAccountsLoading = false;
        notice = null;
        isOpen = false;
        profileOpen = false;
        expandedUsers.clear();
        expandedTools.clear();
        visibilityExpandedUsers.clear();
        visibilityExpandedTools.clear();
        visibilityMode = 'USERS';
        openVisibilityToolId = null;
        visibilityDraft = null;
        optimisticVisibility.clear();
        pendingVisibilitySubmissions.clear();
        pendingLocalTools.clear();
        trackedTransactions.clear();
        activityItems.clear();
        activityMenuOpen = false;
        return true;
    };

    const dashboardUI = Object.freeze({
        version: 1,
        init,
        render,
        refresh,
        destroy,
        getContext: () => context,
        getActivePage: () => activePage
    });
    window.YODAWY_DASHBOARD_UI = dashboardUI;
    page.YODAWY_DASHBOARD_UI = dashboardUI;
})();
