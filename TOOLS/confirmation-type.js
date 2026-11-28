// ==UserScript==
// @name         Confirmation Type
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const TOOL_ID = 'TOOL-001';
    const TOOL_PATH = 'TOOLS/confirmation-type.js';

    const C = {
        M: 'helpdesk.ticket',
        F: 'ticket_confirmation_type',
        I: 'tm-confirmation-buttons',
        STYLE: 'tm-confirm-style',
        NO_WRAP_CLASS: 'yd-ticket-action-nowrap',
        COLOR: '#875A7B',
    };

    const TYPES = [
        [1, 'W - W'],
        [2, 'WO - W'],
        [3, 'UR'],
        [4, 'W - WO'],
        [5, 'WO - WO']
    ];

    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);

    if (registry[TOOL_ID]) return;

    const state = {
        initialized: false,
        destroyed: false,
        loading: false,
        activeTicketId: 0,
        activeValue: 0,
        observer: null,
        layoutResizeObserver: null,
        layoutBox: null,
        layoutContainer: null,
        layoutElements: new Set(),
        layoutFrame: 0,
        request: null,
        toastTimers: new Set(),
        controller: new AbortController()
    };

    const utils = {
        params() {
            return new URLSearchParams(location.hash.replace(/^#/, ''));
        },
        isTicket() {
            const params = this.params();
            return params.get('model') === C.M && params.get('view_type') === 'form';
        },
        ticketId() {
            return Number(this.params().get('id'));
        },
        element(tag, properties = {}) {
            const element = document.createElement(tag);
            Object.assign(element, properties);
            return element;
        },
        all(selector) {
            return [...document.querySelectorAll(selector)];
        },
        wait(selector, timeout = 10000, signal) {
            return new Promise((resolve, reject) => {
                if (signal?.aborted || state.destroyed) {
                    reject(new DOMException('Aborted', 'AbortError'));
                    return;
                }

                const started = Date.now();
                let timer;

                const finish = (value, error) => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', abort);
                    error ? reject(error) : resolve(value);
                };

                const abort = () => finish(null, new DOMException('Aborted', 'AbortError'));

                const check = () => {
                    if (signal?.aborted || state.destroyed) {
                        abort();
                        return;
                    }

                    const element = document.querySelector(selector);

                    if (element) {
                        finish(element);
                        return;
                    }

                    if (Date.now() - started >= timeout) {
                        finish(null);
                        return;
                    }

                    timer = setTimeout(check, 200);
                };

                signal?.addEventListener('abort', abort, { once: true });
                check();
            });
        }
    };

    const api = {
        async rpc(data, signal) {
            const response = await fetch('/web/dataset/call_kw', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal
            });

            if (!response.ok) throw new Error('RPC request failed.');

            const result = await response.json();

            if (result.error) throw new Error('Odoo RPC error.');

            return result.result;
        },

        async update(id, value, signal) {
            const params = utils.params();
            const session = window.odoo?.session_info;

            if (!session?.user_context) {
                throw new Error('Odoo session is unavailable.');
            }

            return this.rpc({
                jsonrpc: '2.0',
                method: 'call',
                params: {
                    model: C.M,
                    method: 'write',
                    args: [[id], { [C.F]: value }],
                    kwargs: {
                        context: {
                            lang: session.user_context.lang,
                            tz: session.user_context.tz,
                            uid: session.uid,
                            allowed_company_ids: session.user_context.allowed_company_ids,
                            active_id: id,
                            active_ids: [id],
                            params: {
                                action: Number(params.get('action')),
                                active_id: id,
                                cids: Number(params.get('cids')),
                                id,
                                menu_id: Number(params.get('menu_id')),
                                model: C.M,
                                view_type: 'form'
                            }
                        }
                    }
                },
                id: Date.now()
            }, signal);
        },

        controller(ticketId) {
            const services = window.odoo?.__DEBUG__?.services || {};
            const owlRoot = window.odoo?.__WOWL_DEBUG__?.root;
            const roots = [
                ...this.values(services),
                services.action,
                services['web.ActionManager'],
                services.action?.currentController,
                services['web.ActionManager']?.currentController,
                owlRoot?.env?.services?.action?.currentController,
                window.odoo?.__DEBUG__?.root,
                owlRoot
            ];
            const queue = roots.filter(Boolean);
            const visited = new WeakSet();
            while (queue.length) {
                const candidate = queue.shift();
                if (!candidate || typeof candidate !== 'object' || visited.has(candidate)) continue;
                visited.add(candidate);
                if (candidate.modelName === C.M && typeof candidate.reload === 'function') {
                    let destroyed = false;
                    try { destroyed = Boolean(candidate.isDestroyed?.()); } catch { destroyed = true; }
                    const element = candidate.el || candidate.$el?.[0];
                    let recordIds = [];
                    try {
                        const env = candidate.model?.get?.(candidate.handle, { env: true });
                        recordIds = [env?.currentId, ...(Array.isArray(env?.ids) ? env.ids : [])].map(Number).filter(Number.isSafeInteger);
                    } catch {}
                    if (!destroyed && element?.isConnected !== false && (!recordIds.length || recordIds.includes(Number(ticketId)))) return candidate;
                }
                queue.push(
                    ...this.values(candidate.__parentedChildren),
                    candidate.currentController,
                    candidate.controller,
                    candidate.viewController,
                    candidate.activeController
                );
            }
            return null;
        },

        values(value) {
            if (Array.isArray(value)) return value;
            if (value instanceof Map || value instanceof Set) return [...value.values()];
            return value && typeof value === 'object' ? Object.values(value) : [];
        },

        refreshResourceKind(entry) {
            const url = String(entry?.name || '');
            if (!url.includes('/web/dataset/call_kw/')) return '';
            if (url.includes('/web/dataset/call_kw/helpdesk.ticket/read')) return 'ticket';
            if (url.includes('/web/dataset/call_kw/mail.message/read') || url.includes('/web/dataset/call_kw/mail.message/message_fetch')) return 'chatter';
            if (/\/(?:helpdesk\.tag\/read|mail\.followers\/(?:read|read_followers)|ir\.attachment\/search_read|mail\.activity\/activity_format|helpdesk\.ticket\/get_suggested_recipients)(?:[?#]|$)/.test(url)) return 'related';
            return '';
        },

        async reloadTicketFormController(controller, timeout = 12000) {
            const perf = window.performance;
            if (!perf?.getEntriesByType || typeof perf.now !== 'function') return false;
            const startedAt = perf.now();
            let ticketRead = false;
            let chatterRead = false;
            let lastRequestAt = startedAt;
            const seen = new Set();
            const inspect = entries => {
                for (const entry of entries || []) {
                    if (entry.entryType !== 'resource' || entry.startTime < startedAt - 1) continue;
                    const kind = this.refreshResourceKind(entry);
                    if (!kind) continue;
                    const key = entry.name + ':' + entry.startTime;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    lastRequestAt = perf.now();
                    if (kind === 'ticket') ticketRead = true;
                    if (kind === 'chatter') chatterRead = true;
                }
            };
            let observer = null;
            try {
                if (typeof window.PerformanceObserver === 'function') {
                    observer = new window.PerformanceObserver(list => inspect(list.getEntries()));
                    observer.observe({ type: 'resource', buffered: true });
                }
            } catch {
                observer?.disconnect();
                observer = null;
            }
            try {
                await controller.reload();
                const deadline = Date.now() + timeout;
                while (Date.now() < deadline) {
                    inspect(perf.getEntriesByType('resource'));
                    if (ticketRead && chatterRead && perf.now() - lastRequestAt >= 900) return true;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                return false;
            } finally {
                observer?.disconnect();
            }
        },

        async softReloadTicketView(ticketId) {
            const controller = this.controller(ticketId);
            if (!controller) return false;
            try {
                return await this.reloadTicketFormController(controller);
            } catch {
                return false;
            }
        }
    };

    const ui = {
        addStyle() {
            document.getElementById(C.STYLE)?.remove();
            const style = utils.element('style', { id: C.STYLE });

            style.textContent = `
                .oe_button_box.yd-ticket-action-nowrap{flex-wrap:nowrap!important}
                #tm-confirmation-buttons{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;width:auto;min-width:0;max-width:100%;vertical-align:middle;gap:10px;white-space:nowrap;box-sizing:border-box}
                .tm-confirm-btn{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:auto;min-width:48px;height:30px;margin:6px 0;padding:0 6px;border:0;border-radius:4px;background:${C.COLOR};color:#fff;font-size:10px;font-weight:700;cursor:pointer;line-height:1;text-align:center;vertical-align:middle;white-space:nowrap;transition:opacity .15s,transform .1s,box-shadow .15s}
                .tm-confirm-btn:hover{opacity:.85}
                .tm-confirm-btn:active{transform:scale(.96)}
                .tm-confirm-btn.tm-active{box-shadow:0 0 0 2px #fff inset,0 0 0 3px ${C.COLOR}}
                .tm-confirm-btn.tm-loading{opacity:.5;pointer-events:none}
                .tm-confirm-toast{position:fixed;right:20px;bottom:20px;z-index:999999999;background:${C.COLOR};color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;font-weight:600;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s}
                .tm-confirm-toast.show{opacity:1;transform:translateY(0)}
            `;

            document.head.appendChild(style);
        },

        createContainer() {
            const container = utils.element('div', { id: C.I });

            TYPES.forEach(([id, label]) => {
                const button = utils.element('button', {
                    className: 'tm-confirm-btn',
                    textContent: label,
                    type: 'button'
                });

                button.dataset.id = id;
                container.appendChild(button);
            });

            return container;
        },

        centerContainer(box, container) {
            const boxStyle = getComputedStyle(box);
            const number = value => Number.parseFloat(value) || 0;
            const siblings = [...box.children].filter(element => element !== container);
            const occupied = siblings.reduce((total, element) => {
                const rect = element.getBoundingClientRect();
                if (!rect.width || !rect.height || getComputedStyle(element).display === 'none') return total;
                const style = getComputedStyle(element);
                return total + rect.width + number(style.marginLeft) + number(style.marginRight);
            }, 0);
            const gap = number(boxStyle.columnGap);
            const padding = number(boxStyle.paddingLeft) + number(boxStyle.paddingRight);
            const available = Math.max(0, box.clientWidth - padding - occupied - gap * Math.max(0, siblings.length));
            container.style.width = available + 'px';
            container.style.boxSizing = 'border-box';
        },

        observeLayout(box, container) {
            if (typeof ResizeObserver !== 'function') return;
            const elements = new Set([box, ...box.children].filter(element => element !== container));
            const same = state.layoutBox === box && elements.size === state.layoutElements.size && [...elements].every(element => state.layoutElements.has(element));
            if (same && state.layoutResizeObserver) return;
            state.layoutResizeObserver?.disconnect();
            state.layoutBox = box;
            state.layoutContainer = container;
            state.layoutElements = elements;
            state.layoutResizeObserver ||= new ResizeObserver(() => {
                if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame);
                state.layoutFrame = requestAnimationFrame(() => {
                    state.layoutFrame = 0;
                    if (!state.destroyed && state.layoutBox?.isConnected && state.layoutContainer?.isConnected) {
                        ui.centerContainer(state.layoutBox, state.layoutContainer);
                    }
                });
            });
            elements.forEach(element => state.layoutResizeObserver.observe(element));
        },

        normalizeLegacyLayout(box, container) {
            for (const bar of [...box.querySelectorAll(':scope > #yd-ticket-action-bar')]) {
                const oldConfirmation = bar.querySelector('#' + C.I);
                const oldSplit = bar.querySelector('#ydDirectSplitButton');
                const oldNative = bar.querySelector('#yd-native-buttons');
                if (oldConfirmation) box.insertBefore(oldConfirmation, bar);
                if (oldSplit) box.insertBefore(oldSplit, bar);
                for (const button of [...(oldNative?.children || [])]) box.insertBefore(button, bar);
                bar.remove();
            }
            for (const button of box.querySelectorAll(':scope > button[data-yd-native-original-width]')) {
                button.removeAttribute('data-yd-native-original-width');
                button.style.removeProperty('--yd-native-original-width');
            }
            const split = box.querySelector(':scope > #ydDirectSplitButton');
            if (split) {
                split.removeAttribute('data-yd-split-original-width');
                split.style.removeProperty('--yd-split-original-width');
            }
            const rtl = getComputedStyle(box).direction === 'rtl';
            const nativeButtons = [...box.children].filter(element =>
                element.matches?.('button.oe_stat_button') && element.id !== 'ydDirectSplitButton'
            );
            if (rtl) {
                const lastNative = nativeButtons[nativeButtons.length - 1];
                if (split) box.insertBefore(split, lastNative?.nextSibling || null);
                box.insertBefore(container, split?.nextSibling || null);
            } else {
                box.insertBefore(container, box.firstElementChild);
                if (split) box.insertBefore(split, container.nextSibling);
            }
            box.classList.add(C.NO_WRAP_CLASS);
            state.layoutBox = box;
            this.centerContainer(box, container);
            this.observeLayout(box, container);
            return true;
        },

        render() {
            if (state.destroyed || !utils.isTicket()) {
                this.removeButtons();
                return;
            }
            const box = [...document.querySelectorAll('.o_not_full.oe_button_box, .oe_button_box')].find(element => element.isConnected);
            if (!box) return;
            let container = box.querySelector(':scope > #' + C.I);
            if (!container) {
                container = this.createContainer();
                container.setAttribute('data-yd-screenshot-exclude', 'true');
                window.YODAWY_SCREENSHOT_COORDINATOR?.registerElement?.(container, { toolId: TOOL_ID });
            }
            this.normalizeLegacyLayout(box, container);
            if (state.activeTicketId === utils.ticketId()) this.active(state.activeValue);
        },

        removeButtons() {
            state.layoutBox?.classList.remove(C.NO_WRAP_CLASS);
            const container = document.getElementById(C.I);
            container?.style.removeProperty('width');
            container?.style.removeProperty('box-sizing');
            container?.remove();
            state.layoutResizeObserver?.disconnect();
            state.layoutResizeObserver = null;
            state.layoutBox = null;
            state.layoutContainer = null;
            state.layoutElements.clear();
            if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame);
            state.layoutFrame = 0;
        },
        loading(value) {
            state.loading = value;

            utils.all('.tm-confirm-btn').forEach(button => {
                button.disabled = value;
                button.classList.toggle('tm-loading', value);
            });
        },

        active(id) {
            utils.all('.tm-confirm-btn').forEach(button => {
                button.classList.toggle(
                    'tm-active',
                    Number(button.dataset.id) === Number(id)
                );
            });
        },

        toast(message) {
            if (state.destroyed) return;

            document.querySelector('.tm-confirm-toast')?.remove();

            const toast = utils.element('div', {
                className: 'tm-confirm-toast',
                textContent: message
            });

            document.body.appendChild(toast);

            requestAnimationFrame(() => {
                if (!state.destroyed) toast.classList.add('show');
            });

            const firstTimer = setTimeout(() => {
                state.toastTimers.delete(firstTimer);
                if (state.destroyed) return;

                toast.classList.remove('show');

                const secondTimer = setTimeout(() => {
                    state.toastTimers.delete(secondTimer);
                    toast.remove();
                }, 200);

                state.toastTimers.add(secondTimer);
            }, 1800);

            state.toastTimers.add(firstTimer);
        },

        destroy() {
            this.removeButtons();
            document.querySelectorAll('.tm-confirm-toast').forEach(toast => toast.remove());
            document.getElementById(C.STYLE)?.remove();

            state.toastTimers.forEach(clearTimeout);
            state.toastTimers.clear();
        }
    };

    const events = {
        async click(event) {
            if (state.destroyed || state.loading) return;

            const target = event.target;
            if (!(target instanceof Element)) return;

            const button = target.closest('.tm-confirm-btn');
            if (!button) return;

            const id = utils.ticketId();
            const value = Number(button.dataset.id);

            if (!id) return;

            const request = new AbortController();
            state.request = request;

            try {
                ui.loading(true);

                await api.update(id, value, request.signal);

                if (state.destroyed || request.signal.aborted) return;

                state.activeTicketId = id;
                state.activeValue = value;
                const refreshed = await api.softReloadTicketView(id);

                if (state.destroyed || request.signal.aborted) return;

                ui.render();
                ui.active(value);
                ui.toast(refreshed ? 'Updated successfully.' : 'Saved successfully. View refresh unavailable.');
            } catch (error) {
                if (!state.destroyed && error?.name !== 'AbortError') {
                    ui.toast('Something went wrong.');
                }
            } finally {
                if (state.request === request) {
                    state.request = null;
                }

                if (!state.destroyed) {
                    ui.loading(false);
                }
            }
        }
    };

    const instance = {
        id: TOOL_ID,
        path: TOOL_PATH,

        init() {
            if (state.initialized || state.destroyed) return false;

            state.initialized = true;

            ui.addStyle();

            document.addEventListener('click', events.click, {
                signal: state.controller.signal
            });

            const routeChange = () => {
                if (!state.destroyed) ui.render();
            };

            window.addEventListener('hashchange', routeChange, {
                signal: state.controller.signal
            });

            state.observer = new MutationObserver(records => {
                if (state.destroyed || !state.initialized || !utils.isTicket() || document.getElementById(C.I)) return;
                const boxAdded = records.some(record => [...record.addedNodes].some(node =>
                    node.nodeType === Node.ELEMENT_NODE &&
                    (node.matches('.oe_button_box') || node.querySelector('.oe_button_box'))
                ));
                if (boxAdded) ui.render();
            });

            state.observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            window.addEventListener('resize', () => {
                if (!state.destroyed) ui.render();
            }, { signal: state.controller.signal });

            ui.render();

            return true;
        },

        screenshotBehavior: 'hide-only',
        supportsPause: false,
        async suspend() {
            if (!state.initialized) return true;
            state.controller.abort();
            state.controller = new AbortController();
            state.request?.abort();
            state.request = null;
            state.observer?.disconnect();
            state.observer = null;
            state.layoutResizeObserver?.disconnect();
            state.layoutResizeObserver = null;
            state.layoutBox = null;
            state.layoutContainer = null;
            state.layoutElements.clear();
            if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame);
            state.layoutFrame = 0;
            state.initialized = false;
            ui.destroy();
            return true;
        },

        async resume() {
            if (state.destroyed || state.initialized) return true;
            state.controller = new AbortController();
            return this.init();
        },

        async refresh() {
            if (state.destroyed) return false;
            ui.render();
            return true;
        },

        async destroy() {
            if (state.destroyed) return true;

            state.destroyed = true;

            state.controller.abort();
            state.request?.abort();
            state.request = null;

            state.observer?.disconnect();
            state.observer = null;
            state.layoutResizeObserver?.disconnect();
            state.layoutResizeObserver = null;
            state.layoutBox = null;
            state.layoutContainer = null;
            state.layoutElements.clear();
            if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame);
            state.layoutFrame = 0;
            ui.destroy();

            return true;
        },

        get status() {
            return state.destroyed ? 'STOPPED' : state.initialized ? 'RUNNING' : 'IDLE';
        }
    };

    registry[TOOL_ID] = instance;

    try {
        instance.init();
    } catch (error) {
        instance.destroy();
        throw error;
    }
})();
