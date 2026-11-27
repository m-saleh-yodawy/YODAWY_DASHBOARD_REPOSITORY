(function (global) {
    'use strict';

    if (global.YODAWY_TOOLS_MANAGER) return;

    const CONFIG = Object.freeze({
        MANIFEST_PATH: 'TOOLS_CACHE/tools-manifest.json',
        REGISTRY_NAME: 'YODAWY_TOOL_INSTANCES'
    });

    const page = document.defaultView || global;
    const loadedTools = new Map();
    const pendingTools = new Map();

    let manifest = [];
    let unavailableTools = [];
    let initialized = false;
    let syncing = false;
    let routeSyncPending = false;
    let routeSyncScheduled = false;

    const isOdooHome = () => {
        if (page.location?.hostname?.toLowerCase() !== 'odoo.yodawy.com') return false;
        const params = new URLSearchParams(String(page.location.hash || '').replace(/^#/, ''));
        return params.has('home') || (!params.has('action') && !params.has('model') && !params.has('view_type'));
    };

    const syncHomeToolVisibility = () => {
        const styleId = 'yd-odoo-home-tools-hidden';
        const existing = document.getElementById(styleId);
        if (page.location?.hostname?.toLowerCase() !== 'odoo.yodawy.com' || !isOdooHome()) {
            existing?.remove();
            return;
        }
        if (existing) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = '#ms-stock-hzb-systray-item,#ordered-systray-item,#noitems-systray-item{display:none!important}';
        (document.head || document.documentElement).appendChild(style);
    };

    const scheduleRouteSync = () => {
        syncHomeToolVisibility();
        if (!initialized) return;
        if (syncing) {
            routeSyncPending = true;
            return;
        }
        if (routeSyncScheduled) return;
        routeSyncScheduled = true;
        Promise.resolve().then(() => {
            routeSyncScheduled = false;
            if (!initialized) return;
            if (syncing) {
                routeSyncPending = true;
                return;
            }
            sync().catch(() => {});
        });
    };

    page.addEventListener('hashchange', scheduleRouteSync);
    syncHomeToolVisibility();

    const createError = message => {
        const error = new Error(message);
        error.code = 'TOOLS_MANAGER_ERROR';
        return error;
    };

    const getDependencies = () => {
        const API = global.YODAWY_API_ENGINE;
        const AUTH = global.YODAWY_AUTH_ENGINE;
        const LOADER = global.YODAWY_MODULE_LOADER;
        const PERMISSIONS = global.YODAWY_PERMISSIONS_ENGINE;
        const SETTINGS = global.YODAWY_SETTINGS_ENGINE;
        const VISIBILITY = global.YODAWY_VISIBILITY_ENGINE;

        if (!API || !AUTH || !LOADER || !PERMISSIONS || !SETTINGS || !VISIBILITY) {
            throw createError('Required engines are unavailable');
        }

        return { API, AUTH, LOADER, PERMISSIONS, SETTINGS, VISIBILITY };
    };

    const normalizePath = path => {
        if (typeof path !== 'string' || !path.trim()) {
            throw createError('Invalid tool path');
        }

        let normalized = path.trim().replace(/\\/g, '/').replace(/^\/+/, '');

        if (normalized.startsWith('TOOLS_CACHE/')) {
            normalized = normalized;
        } else if (normalized.startsWith('TOOLS/')) {
            normalized = `TOOLS_CACHE/${normalized}`;
        } else {
            normalized = `TOOLS_CACHE/TOOLS/${normalized.split('/').pop()}`;
        }

        const parts = normalized.split('/');

        if (
            parts.some(part => !part || part === '.' || part === '..') ||
            !/\.js$/i.test(normalized) ||
            /\.min\.js$/i.test(normalized)
        ) {
            throw createError('Invalid or unsupported tool path');
        }

        return normalized;
    };

    const normalizeHash = hash => {
        const value = String(hash || '').trim().toLowerCase().replace(/^sha256-/, '');

        if (!/^[a-f0-9]{64}$/.test(value)) {
            throw createError('Tool manifest contains an invalid SHA-256 hash');
        }

        return value;
    };

    const validateManifest = data => {
        if (!data || !Array.isArray(data.tools)) {
            throw createError('Invalid tools manifest structure');
        }

        const ids = new Set();
        const paths = new Set();

        return data.tools.map(tool => {
            if (!tool || typeof tool !== 'object') {
                throw createError('Invalid tool manifest entry');
            }

            const id = String(tool.id || '').trim();
            const name = String(tool.name || '').trim();
            const path = normalizePath(tool.path || tool.file);
            const icon = typeof tool.icon === 'string' ? tool.icon.trim() : '';
            const sha256 = normalizeHash(tool.sha256);
            const matches = Array.isArray(tool.matches)
                ? [...new Set(tool.matches.map(value => String(value || '').trim()).filter(Boolean))]
                : [];

            const issues = [];
            if (!id) issues.push('missing ID');
            if (!name) issues.push('missing name');
            if (!matches.length) issues.push('missing match patterns');
            if (ids.has(id)) issues.push('duplicate ID');
            if (paths.has(path)) issues.push('duplicate path');
            if (issues.length) throw createError('Invalid tool manifest entry ' + (id || name || path || 'unknown') + ': ' + issues.join(', '));

            ids.add(id);
            paths.add(path);

            return Object.freeze({
                ...tool,
                id,
                name,
                path,
                icon,
                sha256,
                matches: Object.freeze(matches)
            });
        });
    };

    const loadManifest = async () => {
        const { API } = getDependencies();
        const data = await API.get('/api/dashboard/tools/manifest');
        if (data?.success !== true || !Array.isArray(data.tools)) throw createError(data?.error || 'Live tools manifest is unavailable');
        manifest = validateManifest(data);
        unavailableTools = Array.isArray(data.unavailable)
            ? data.unavailable.filter(item => item && typeof item.id === 'string' && item.id.trim()).map(item => ({ ...item, id: item.id.trim() }))
            : [];
        initialized = true;
        return getManifest();
    };

    const ensureInitialized = () => {
        if (!initialized) {
            throw createError('Tools manager has not been initialized');
        }
    };

    const getTool = toolId => {
        ensureInitialized();

        const tool = manifest.find(item => item.id === toolId);

        if (!tool) {
            throw createError(`Tool not found: ${toolId}`);
        }

        return tool;
    };

    const getRegistry = () => {
        const registry = page[CONFIG.REGISTRY_NAME];

        return registry && typeof registry === 'object'
            ? registry
            : null;
    };

    const matchesPage = tool => {
        const href = String(page.location?.href || '').toLowerCase();
        if (!href || !Array.isArray(tool.matches)) return false;
        return tool.matches.some(pattern => {
            const value = String(pattern || '').trim().toLowerCase();
            if (!value) return false;
            const parts = value.split('*');
            let position = 0;
            for (let index = 0; index < parts.length; index++) {
                const part = parts[index];
                const found = href.indexOf(part, position);
                if (found < 0 || (!index && found !== 0)) return false;
                position = found + part.length;
            }
            return value.endsWith('*') || position === href.length;
        });
    };
    const canLoad = (tool, dependencies) => {
        if (isOdooHome() || !matchesPage(tool)) return false;
        const { AUTH, PERMISSIONS, SETTINGS, VISIBILITY } = dependencies;
        const userId = AUTH.getUserId();

        if (tool.enabled === false) return false;
        if (!AUTH.isAuthenticated() || !userId) return false;
        if (!SETTINGS.isLoaded() || !VISIBILITY.isLoaded()) return false;
        if (!PERMISSIONS.isLoaded()) return false;

        const permitted = AUTH.getRole() === 'SUPER_ADMIN'
            ? true
            : PERMISSIONS.canUse(userId, tool.id);

        return (
            permitted &&
            SETTINGS.isEnabled(tool.id) &&
            VISIBILITY.isVisible(tool.id, tool) === true
        );
    };

    const recordLifecycle = async (API, action, tool) => {
        if (typeof API?.recordActivity !== 'function') return false;
        const opened = action === 'TOOL_STARTED';
        try {
            const result = await API.recordActivity({
                action,
                toolId: tool.id,
                toolName: tool.name,
                summary: (opened ? 'Opened ' : 'Closed ') + tool.name
            });
            return result?.success === true;
        } catch {
            return false;
        }
    };

    const LIFECYCLE_STATES = Object.freeze({
        UNINITIALIZED: 'UNINITIALIZED',
        INITIALIZING: 'INITIALIZING',
        ACTIVE: 'ACTIVE',
        PAUSING: 'PAUSING',
        PAUSED: 'PAUSED',
        RESUMING: 'RESUMING',
        REFRESHING: 'REFRESHING',
        DESTROYING: 'DESTROYING',
        DESTROYED: 'DESTROYED',
        ERROR: 'ERROR'
    });

    const VALID_TRANSITIONS = Object.freeze({
        UNINITIALIZED: new Set(['INITIALIZING', 'ACTIVE', 'DESTROYING', 'DESTROYED', 'ERROR']),
        INITIALIZING: new Set(['ACTIVE', 'DESTROYING', 'DESTROYED', 'ERROR']),
        ACTIVE: new Set(['PAUSING', 'REFRESHING', 'DESTROYING', 'ERROR']),
        PAUSING: new Set(['PAUSED', 'ACTIVE', 'DESTROYING', 'ERROR']),
        PAUSED: new Set(['RESUMING', 'DESTROYING', 'ERROR']),
        RESUMING: new Set(['ACTIVE', 'PAUSED', 'DESTROYING', 'ERROR']),
        REFRESHING: new Set(['ACTIVE', 'DESTROYING', 'ERROR']),
        DESTROYING: new Set(['DESTROYED', 'ERROR']),
        DESTROYED: new Set(['INITIALIZING', 'ACTIVE']),
        ERROR: new Set(['INITIALIZING', 'DESTROYING', 'DESTROYED', 'ACTIVE'])
    });

    const lifecycleRecords = new Map();
    const lifecycleLocks = new Map();

    const withTimeout = (promise, ms = 10000, label = 'LIFECYCLE_TIMEOUT') => {
        let timer = null;
        return Promise.race([
            Promise.resolve(promise),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(createError(label)), ms);
            })
        ]).finally(() => {
            if (timer) clearTimeout(timer);
        });
    };

    const withToolLock = async (toolId, task) => {
        const previous = lifecycleLocks.get(toolId) || Promise.resolve();
        let release;
        const next = new Promise(resolve => { release = resolve; });
        const chained = previous.catch(() => {}).then(() => next);
        lifecycleLocks.set(toolId, chained);
        await previous.catch(() => {});
        try {
            return await task();
        } finally {
            release();
            if (lifecycleLocks.get(toolId) === chained) lifecycleLocks.delete(toolId);
        }
    };

    const getLifecycleRecord = toolId => {
        const id = String(toolId || '').trim();
        if (!id) return null;
        let rec = lifecycleRecords.get(id);
        if (!rec) {
            rec = {
                id,
                state: LIFECYCLE_STATES.UNINITIALIZED,
                lastError: null,
                updatedAt: Date.now()
            };
            lifecycleRecords.set(id, rec);
        }
        return rec;
    };

    const transitionState = (toolId, nextState, error = null) => {
        const rec = getLifecycleRecord(toolId);
        if (!rec) return null;
        const allowed = VALID_TRANSITIONS[rec.state];
        if (rec.state !== nextState && allowed && !allowed.has(nextState)) {
            throw createError(`Invalid lifecycle transition for ${toolId}: ${rec.state} -> ${nextState}`);
        }
        rec.state = nextState;
        rec.lastError = error ? String(error?.message || error) : null;
        rec.updatedAt = Date.now();
        return rec.state;
    };

    const getToolInstance = toolId => {
        const registry = getRegistry();
        return registry?.[toolId] || null;
    };

    const destroyTool = async toolId => withToolLock(toolId, async () => {
        const rec = getLifecycleRecord(toolId);
        const registered = getToolInstance(toolId);
        const loaded = loadedTools.get(toolId);
        if (rec.state === LIFECYCLE_STATES.DESTROYED && !registered && !loaded) return true;
        if (!registered && !loaded) {
            if (rec.state !== LIFECYCLE_STATES.DESTROYED) transitionState(toolId, LIFECYCLE_STATES.DESTROYED);
            return true;
        }
        transitionState(toolId, LIFECYCLE_STATES.DESTROYING);
        try {
            const { API, LOADER } = getDependencies();
            if (typeof registered?.destroy === 'function') {
                const stopped = await withTimeout(registered.destroy(), 8000, `Destroy timeout for ${toolId}`);
                if (stopped === false) {
                    transitionState(toolId, LIFECYCLE_STATES.ACTIVE);
                    return false;
                }
            }
            const registry = getRegistry();
            if (registry && registry[toolId] === registered) delete registry[toolId];
            if (loaded?.path) {
                try { LOADER.clear(loaded.path, { destroy: true }); } catch {}
                loadedTools.delete(toolId);
                await recordLifecycle(API, 'TOOL_STOPPED', loaded);
            }
            transitionState(toolId, LIFECYCLE_STATES.DESTROYED);
            return true;
        } catch (error) {
            transitionState(toolId, LIFECYCLE_STATES.ERROR, error);
            throw error;
        }
    });

    const pauseTool = async toolId => withToolLock(toolId, async () => {
        const rec = getLifecycleRecord(toolId);
        const registered = getToolInstance(toolId);
        if (!registered) return { paused: false, skipped: true, reason: 'NOT_LOADED' };
        if (rec.state === LIFECYCLE_STATES.PAUSED) return { paused: true, alreadyPaused: true };
        if (rec.state === LIFECYCLE_STATES.DESTROYED) return { paused: false, skipped: true, reason: 'DESTROYED' };
        const pauseFn = typeof registered.pause === 'function'
            ? registered.pause.bind(registered)
            : typeof registered.suspend === 'function'
                ? registered.suspend.bind(registered)
                : null;
        if (!pauseFn || registered.supportsPause === false) {
            return { paused: false, skipped: true, reason: 'PAUSE_NOT_SUPPORTED' };
        }
        if (rec.state === LIFECYCLE_STATES.UNINITIALIZED) rec.state = LIFECYCLE_STATES.ACTIVE;
        transitionState(toolId, LIFECYCLE_STATES.PAUSING);
        try {
            const ok = await withTimeout(pauseFn(), 8000, `Pause timeout for ${toolId}`);
            if (ok === false) {
                transitionState(toolId, LIFECYCLE_STATES.ACTIVE);
                return { paused: false, busy: true };
            }
            transitionState(toolId, LIFECYCLE_STATES.PAUSED);
            return { paused: true };
        } catch (error) {
            transitionState(toolId, LIFECYCLE_STATES.ERROR, error);
            throw error;
        }
    });

    const resumeTool = async toolId => withToolLock(toolId, async () => {
        const rec = getLifecycleRecord(toolId);
        const registered = getToolInstance(toolId);
        if (!registered || rec.state === LIFECYCLE_STATES.DESTROYED) return false;
        if (rec.state !== LIFECYCLE_STATES.PAUSED) return true;
        if (typeof registered.resume !== 'function') {
            transitionState(toolId, LIFECYCLE_STATES.ACTIVE);
            return true;
        }
        transitionState(toolId, LIFECYCLE_STATES.RESUMING);
        try {
            const ok = await withTimeout(registered.resume(), 8000, `Resume timeout for ${toolId}`);
            if (ok === false) {
                transitionState(toolId, LIFECYCLE_STATES.PAUSED);
                return false;
            }
            transitionState(toolId, LIFECYCLE_STATES.ACTIVE);
            return true;
        } catch (error) {
            transitionState(toolId, LIFECYCLE_STATES.ERROR, error);
            throw error;
        }
    });

    const refreshTool = async toolId => withToolLock(toolId, async () => {
        const rec = getLifecycleRecord(toolId);
        const registered = getToolInstance(toolId);
        if (!registered || rec.state === LIFECYCLE_STATES.DESTROYED) return false;
        if (registered.refreshRequiresRebuild === true) {
            return null; // Caller delegates to rebuildTool outside lock
        }
        if (typeof registered.refresh !== 'function') return true;
        if (rec.state === LIFECYCLE_STATES.UNINITIALIZED) rec.state = LIFECYCLE_STATES.ACTIVE;
        if (rec.state !== LIFECYCLE_STATES.ACTIVE) return false;
        transitionState(toolId, LIFECYCLE_STATES.REFRESHING);
        try {
            const ok = await withTimeout(registered.refresh(), 8000, `Refresh timeout for ${toolId}`);
            transitionState(toolId, LIFECYCLE_STATES.ACTIVE);
            return ok !== false;
        } catch (error) {
            transitionState(toolId, LIFECYCLE_STATES.ERROR, error);
            throw error;
        }
    });

    const rebuildTool = async toolId => {
        const tool = getTool(toolId);
        await destroyTool(toolId);
        return start(tool);
    };

    const stop = async toolId => {
        const instance = loadedTools.get(toolId);

        if (!instance && !getToolInstance(toolId)) return false;

        const registry = getRegistry();
        const registered = registry?.[toolId];

        if (typeof registered?.destroy !== 'function') {
            if (instance) instance.destroyable = false;
            return false;
        }

        try {
            return await destroyTool(toolId);
        } catch (error) {
            throw createError(`Failed to stop tool ${toolId}: ${error.message}`);
        }
    };

    const start = async tool => {
        const dependencies = getDependencies();
        if (!canLoad(tool, dependencies)) {
            return loadedTools.has(tool.id) ? stop(tool.id) : false;
        }
        const existing = loadedTools.get(tool.id);
        if (existing && existing.path === tool.path && existing.sha256 === tool.sha256) {
            const rec = getLifecycleRecord(tool.id);
            if (rec && rec.state === LIFECYCLE_STATES.UNINITIALIZED) rec.state = LIFECYCLE_STATES.ACTIVE;
            return true;
        }
        if (existing && !await stop(tool.id)) throw createError('Tool ' + tool.id + ' cannot be safely replaced because it has no destroy method');

        if (pendingTools.has(tool.id)) {
            return pendingTools.get(tool.id);
        }

        const task = (async () => {
            const dependencies = getDependencies();

            if (!canLoad(tool, dependencies)) return false;

            transitionState(tool.id, LIFECYCLE_STATES.INITIALIZING);

            try {
                const result = await dependencies.LOADER.load(tool.path, {
                    toolId: tool.id,
                    sha256: tool.sha256
                });

                if (!result.registered || !result.destroyable) {
                    const registry = getRegistry();
                    const registered = registry?.[tool.id];
                    try { await registered?.destroy?.(); } catch {}
                    if (registry?.[tool.id] === registered) delete registry[tool.id];
                    dependencies.LOADER.clear(tool.path, { destroy: true });
                    throw createError('Tool ' + tool.id + ' must register an instance with destroy().');
                }

                loadedTools.set(tool.id, {
                    id: tool.id,
                    name: tool.name,
                    path: tool.path,
                    sha256: tool.sha256,
                    loadedAt: result.loadedAt,
                    registered: result.registered,
                    destroyable: result.destroyable
                });
                transitionState(tool.id, LIFECYCLE_STATES.ACTIVE);
                await recordLifecycle(dependencies.API, 'TOOL_STARTED', tool);

                return true;
            } catch (error) {
                transitionState(tool.id, LIFECYCLE_STATES.ERROR, error);
                throw error;
            }
        })();

        pendingTools.set(tool.id, task);

        try {
            return await task;
        } finally {
            pendingTools.delete(tool.id);
        }
    };

    const syncTool = async toolId => {
        const tool = getTool(toolId);
        const dependencies = getDependencies();

        if (canLoad(tool, dependencies)) {
            return start(tool);
        }

        return stop(toolId);
    };

    let syncFailures = [];

    const sync = async () => {
        ensureInitialized();

        if (syncing) {
            throw createError('Tools synchronization is already running');
        }

        syncing = true;
        syncFailures = [];

        try {
            const dependencies = getDependencies();
            const activeIds = new Set([...manifest.map(tool => tool.id), ...unavailableTools.map(tool => tool.id)]);
            for (const id of [...loadedTools.keys()]) {
                if (!activeIds.has(id)) {
                    try {
                        if (!await stop(id)) throw createError('Tool ' + id + ' cannot be safely removed');
                    } catch (error) {
                        syncFailures.push({ id, name: id, message: error?.message || 'Tool removal failed' });
                    }
                }
            }

            for (const tool of manifest) {
                try {
                    if (canLoad(tool, dependencies)) await start(tool);
                    else await stop(tool.id);
                } catch (error) {
                    syncFailures.push({ id: tool.id, name: tool.name, message: error?.message || 'Tool synchronization failed' });
                }
            }

            return getLoadedTools();
        } finally {
            syncing = false;
            if (routeSyncPending) {
                routeSyncPending = false;
                scheduleRouteSync();
            }
        }
    };

    const stopAll = async () => {
        const ids = [...loadedTools.keys()];
        const results = await Promise.allSettled(ids.map(stop));

        return results.every(result =>
            result.status === 'fulfilled' && result.value === true
        );
    };

    const getManifest = () => {
        ensureInitialized();
        return manifest.map(tool => ({ ...tool }));
    };

    const getLoadedTools = () =>
        [...loadedTools.values()].map(tool => ({ ...tool }));

    const isLoaded = toolId =>
        loadedTools.has(toolId);

    const getStatus = toolId => {
        const tool = getTool(toolId);
        const loaded = loadedTools.get(toolId);

        return Object.freeze({
            id: tool.id,
            name: tool.name,
            loaded: Boolean(loaded),
            registered: loaded?.registered || false,
            destroyable: loaded?.destroyable || false,
            path: tool.path
        });
    };

    const EXCLUDE_ATTR = 'data-yd-screenshot-exclude';
    const EXCLUDE_CLASS = 'yd-screenshot-exclude';
    const DEFAULT_EXCLUDED_SELECTORS = [
        '#yd-dashboard-menu-item',
        '#yd-launcher',
        '#yd-dashboard-root',
        '.yd-select-portal-menu',
        '#yodawy-dev-mode-banner',
        '#yd-cloud-error',
        '#yd-screen-systray-item',
        '#yd-screen-toast',
        '#noitems-panel',
        '#noitems-systray-item',
        '#ordered-panel',
        '#ordered-systray-item',
        '#ms-stock-hzb-checker',
        '#ms-stock-hzb-systray-item',
        '#ydDirectSplitButton',
        '#ydDirectSplitDialog',
        '#tm-confirmation-buttons',
        '#tm-alt-call-popup',
        '.yodawy-copy-success',
        '.yd-open-erx-backdrop',
        '[data-yd-log-note-tool]',
        '.ms-alt-qty-warning',
        '.yd-mc-layer',
        '.yd-mc-copy-btn'
    ];
    const registeredExclusions = new Set();
    let captureSequence = 0;
    let activeCapturePromise = null;
    let libraryPromise = null;
    const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

    const registerExcludedElement = (target, meta = {}) => {
        if (!target) return () => {};
        const entry = { target, meta };
        registeredExclusions.add(entry);
        if (target instanceof Element) {
            target.setAttribute(EXCLUDE_ATTR, 'true');
        }
        return () => {
            registeredExclusions.delete(entry);
        };
    };

    const resolveExcludedElements = () => {
        const nodes = new Set();
        const addNode = node => {
            if (node instanceof Element && node.isConnected) nodes.add(node);
        };
        document.querySelectorAll(`[${EXCLUDE_ATTR}="true"], .${EXCLUDE_CLASS}`).forEach(addNode);
        for (const selector of DEFAULT_EXCLUDED_SELECTORS) {
            try {
                document.querySelectorAll(selector).forEach(addNode);
            } catch {}
        }
        for (const entry of registeredExclusions) {
            try {
                const resolved = typeof entry.target === 'function' ? entry.target() : entry.target;
                if (!resolved) continue;
                if (typeof resolved === 'string') {
                    document.querySelectorAll(resolved).forEach(addNode);
                } else if (Array.isArray(resolved) || resolved instanceof NodeList) {
                    for (const el of resolved) addNode(el);
                } else {
                    addNode(resolved);
                }
            } catch {}
        }
        return [...nodes];
    };

    const isScreenshotExcludedElement = element => {
        if (!(element instanceof Element)) return false;
        if (element.getAttribute(EXCLUDE_ATTR) === 'true' || element.classList?.contains(EXCLUDE_CLASS)) return true;
        const combined = `[${EXCLUDE_ATTR}="true"], .${EXCLUDE_CLASS}, ${DEFAULT_EXCLUDED_SELECTORS.join(',')}`;
        try {
            if (element.matches?.(combined) || element.closest?.(combined)) return true;
        } catch {}
        for (const entry of registeredExclusions) {
            try {
                const resolved = typeof entry.target === 'function' ? entry.target() : entry.target;
                if (!resolved) continue;
                if (typeof resolved === 'string') {
                    if (element.matches?.(resolved) || element.closest?.(resolved)) return true;
                } else if (resolved instanceof Element) {
                    if (element === resolved || resolved.contains(element)) return true;
                }
            } catch {}
        }
        return false;
    };

    const waitCaptureFrames = () => new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        } else {
            setTimeout(resolve, 32);
        }
    });

    const ensureHtml2Canvas = async () => {
        if (typeof page.html2canvas === 'function') return page.html2canvas;
        if (typeof window.html2canvas === 'function') return window.html2canvas;
        if (!libraryPromise) {
            libraryPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                let timer = setTimeout(() => {
                    script.remove();
                    reject(createError('SCREENSHOT_LIBRARY_TIMEOUT'));
                }, 15000);
                script.src = HTML2CANVAS_URL;
                script.async = true;
                script.crossOrigin = 'anonymous';
                script.onload = () => {
                    clearTimeout(timer);
                    timer = null;
                    const lib = page.html2canvas || window.html2canvas;
                    if (typeof lib === 'function') resolve(lib);
                    else reject(createError('SCREENSHOT_LIBRARY_UNAVAILABLE'));
                };
                script.onerror = () => {
                    if (timer) clearTimeout(timer);
                    script.remove();
                    reject(createError('SCREENSHOT_LIBRARY_LOAD_FAILED'));
                };
                (document.head || document.documentElement).appendChild(script);
            }).catch(error => {
                libraryPromise = null;
                throw error;
            });
        }
        return libraryPromise;
    };

    const captureCleanScreenshot = async (options = {}) => {
        if (activeCapturePromise) {
            if (!options.queue) throw createError('SCREENSHOT_CAPTURE_IN_PROGRESS');
            await activeCapturePromise.catch(() => {});
        }

        const runCaptureTask = async () => {
            const captureId = ++captureSequence;
            const hideToken = 'yd-hidden-' + captureId;
            const requesterToolId = String(options.requesterToolId || '').trim();
            const MARKER = 'data-yd-screen-fixed-marker';
            const root = document.documentElement;
            const body = document.body;

            const hiddenSnapshots = [];
            const pausedTools = [];
            const fixedSnapshots = [];
            const restoreErrors = [];
            let captureError = null;
            let blob = null;

            const html2canvasLib = typeof options.renderer === 'function'
                ? options.renderer
                : await ensureHtml2Canvas();

            try {
                // 1. Pause ONLY tools whose screenshotBehavior === 'pause-required'
                const registry = getRegistry() || {};
                const entries = Object.entries(registry).filter(([id, inst]) =>
                    inst && typeof inst === 'object' && id !== requesterToolId && inst.screenshotBehavior === 'pause-required'
                );

                for (const [id, inst] of entries) {
                    const rec = getLifecycleRecord(id);
                    if (rec && rec.state === LIFECYCLE_STATES.PAUSED) continue;
                    const res = await pauseTool(id);
                    if (res.busy) throw createError('TOOL_BUSY: ' + id);
                    if (res.paused) pausedTools.push(id);
                }

                // 2. Activate global screenshot clean mode and hide all YODAWY UI elements
                root.setAttribute('data-yd-screenshot-clean', 'true');
                const excluded = resolveExcludedElements();
                for (const element of excluded) {
                    hiddenSnapshots.push({
                        element,
                        prevAttr: element.getAttribute('data-yd-screenshot-hidden'),
                        prevDisplay: element.style.getPropertyValue('display'),
                        prevDisplayPriority: element.style.getPropertyPriority('display'),
                        prevVisibility: element.style.getPropertyValue('visibility'),
                        prevVisibilityPriority: element.style.getPropertyPriority('visibility')
                    });
                    element.setAttribute('data-yd-screenshot-hidden', hideToken);
                    element.style.setProperty('display', 'none', 'important');
                    element.style.setProperty('visibility', 'hidden', 'important');
                }

                try { await document.fonts?.ready; } catch {}
                await waitCaptureFrames();

                // 3. Measure full document dimensions & snapshot fixed/sticky nodes
                // Viewport-only dimensions: capture strictly the visible webpage viewport inside the active Browser Tab
                const viewportWidth = Math.max(1, Math.round(window.visualViewport?.width || window.innerWidth || root.clientWidth || 0));
                const viewportHeight = Math.max(1, Math.round(window.visualViewport?.height || window.innerHeight || root.clientHeight || 0));
                const scrollX = window.scrollX ?? window.pageXOffset ?? root.scrollLeft ?? 0;
                const scrollY = window.scrollY ?? window.pageYOffset ?? root.scrollTop ?? 0;

                const scale = Number.isFinite(options.scale)
                    ? options.scale
                    : (window.devicePixelRatio || 1);

                const canvas = await html2canvasLib(root, {
                    backgroundColor: '#fff',
                    scale,
                    useCORS: true,
                    allowTaint: false,
                    logging: false,
                    imageTimeout: 0,
                    x: scrollX,
                    y: scrollY,
                    width: viewportWidth,
                    height: viewportHeight,
                    windowWidth: window.innerWidth || viewportWidth,
                    windowHeight: window.innerHeight || viewportHeight,
                    scrollX: 0,
                    scrollY: 0,
                    onclone: clonedDocument => {
                        // Keep fixed elements in place relative to the cloned document viewport
                        clonedDocument.querySelectorAll('[' + MARKER + ']').forEach(element => {
                            const marker = element.getAttribute(MARKER);
                            const item = fixedSnapshots.find(entry => entry.marker === marker);
                            if (!item) return;
                            element.style.setProperty('position', 'absolute', 'important');
                            element.style.setProperty('left', item.left + 'px', 'important');
                            element.style.setProperty('top', item.top + 'px', 'important');
                            element.style.setProperty('right', 'auto', 'important');
                            element.style.setProperty('bottom', 'auto', 'important');
                            element.style.setProperty('transform', 'none', 'important');
                        });
                    },
                    ignoreElements: element => isScreenshotExcludedElement(element)
                });

                blob = await new Promise((resolve, reject) => {
                    try {
                        canvas.toBlob(
                            result => result && result.size > 0 ? resolve(result) : reject(createError('SCREENSHOT_IMAGE_CREATION_FAILED')),
                            'image/png',
                            options.quality
                        );
                    } catch (err) {
                        reject(err);
                    }
                });
            } catch (error) {
                captureError = error;
            } finally {
                fixedSnapshots.forEach(({ element, previous }) => {
                    if (previous === null) element.removeAttribute(MARKER);
                    else element.setAttribute(MARKER, previous);
                });

                for (const snap of hiddenSnapshots.reverse()) {
                    const el = snap.element;
                    if (el.getAttribute('data-yd-screenshot-hidden') === hideToken) {
                        if (snap.prevAttr === null) el.removeAttribute('data-yd-screenshot-hidden');
                        else el.setAttribute('data-yd-screenshot-hidden', snap.prevAttr);

                        if (el.style.getPropertyValue('display') === 'none') {
                            if (snap.prevDisplay) el.style.setProperty('display', snap.prevDisplay, snap.prevDisplayPriority);
                            else el.style.removeProperty('display');
                        }
                        if (el.style.getPropertyValue('visibility') === 'hidden') {
                            if (snap.prevVisibility) el.style.setProperty('visibility', snap.prevVisibility, snap.prevVisibilityPriority);
                            else el.style.removeProperty('visibility');
                        }
                    }
                }

                root.removeAttribute('data-yd-screenshot-clean');

                for (const id of pausedTools.reverse()) {
                    try {
                        const resumed = await resumeTool(id);
                        if (resumed === false) restoreErrors.push(id);
                    } catch {
                        restoreErrors.push(id);
                    }
                }
                await waitCaptureFrames();
            }

            if (restoreErrors.length) throw createError('RESTORE_FAILED: ' + restoreErrors.join(', '));
            if (captureError) throw captureError;
            if (!blob) throw createError('SCREENSHOT_EMPTY');
            return blob;
        };

        const task = runCaptureTask();
        activeCapturePromise = task;
        try {
            return await task;
        } finally {
            if (activeCapturePromise === task) activeCapturePromise = null;
        }
    };

    const lifecycleApi = Object.freeze({
        STATES: LIFECYCLE_STATES,
        getState: toolId => getLifecycleRecord(toolId)?.state || LIFECYCLE_STATES.UNINITIALIZED,
        getAllStates: () => {
            const out = {};
            for (const [id, rec] of lifecycleRecords) out[id] = { ...rec };
            return out;
        },
        destroy: destroyTool,
        rebuild: rebuildTool,
        pause: pauseTool,
        resume: resumeTool,
        refresh: async toolId => {
            const res = await refreshTool(toolId);
            if (res === null) return rebuildTool(toolId);
            return res;
        }
    });

    const screenshotCoordinatorApi = Object.freeze({
        EXCLUDE_ATTR,
        EXCLUDE_CLASS,
        registerElement: registerExcludedElement,
        getExcludedElements: resolveExcludedElements,
        isExcluded: isScreenshotExcludedElement,
        isCapturing: () => Boolean(activeCapturePromise),
        capture: captureCleanScreenshot
    });

    global.YODAWY_TOOL_LIFECYCLE = lifecycleApi;
    global.YODAWY_SCREENSHOT_COORDINATOR = screenshotCoordinatorApi;

    global.YODAWY_TOOLS_MANAGER = Object.freeze({
        version: 4,
        lifecycle: lifecycleApi,
        screenshot: screenshotCoordinatorApi,
        loadManifest,
        sync,
        syncTool,
        start: async toolId => start(getTool(toolId)),
        stop,
        stopAll,
        getManifest,
        getLoadedTools,
        getSyncFailures: () => syncFailures.map(item => ({ ...item })),
        getUnavailableTools: () => unavailableTools.map(item => ({ ...item })),
        getStatus,
        isLoaded,
        isInitialized: () => initialized
    });

})(window);
