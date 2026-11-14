// ==UserScript==
// @name         CONFIRMATION TYPE BUTTONS
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
    const TOOL_PATH = 'TOOLS/confirmation-type-buttons.js';

    const C = {
        M: 'helpdesk.ticket',
        F: 'ticket_confirmation_type',
        I: 'tm-confirmation-buttons',
        STYLE: 'tm-confirm-style',
        COLOR: '#875A7B',
        INTERVAL: 300
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
        observer: null,
        interval: null,
        request: null,
        renderQueued: false,
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

        controller() {
            const services = window.odoo?.__DEBUG__?.services;
            if (!services) return null;

            for (const service of Object.values(services)) {
                for (const action of service?.__parentedChildren || []) {
                    for (const controller of action?.__parentedChildren || []) {
                        if (
                            controller?.modelName === C.M &&
                            controller.handle &&
                            controller.saveRecord
                        ) {
                            return controller;
                        }
                    }
                }
            }

            return null;
        }
    };

    const ui = {
        addStyle() {
            if (document.getElementById(C.STYLE)) return;

            const style = utils.element('style', { id: C.STYLE });

            style.textContent = `
                #${C.I}{display:contents}
                .tm-confirm-btn{width:auto;min-width:55px;height:30px;margin:8px 4px;padding:0 8px;border:0;border-radius:4px;background:${C.COLOR};color:#fff;font-size:11px;font-weight:700;cursor:pointer;line-height:30px;text-align:center;transition:opacity .15s,transform .1s,box-shadow .15s}
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

        render() {
            if (state.destroyed || !utils.isTicket()) {
                this.removeButtons();
                return;
            }

            if (document.getElementById(C.I)) return;

            const box = document.querySelector('.oe_button_box');
            if (!box) return;

            const container = this.createContainer();
            const split = box.querySelector('#tmLetsSplit');

            box.prepend(container);

            if (split) {
                box.insertBefore(split, container.nextSibling);
            }
        },

        removeButtons() {
            document.getElementById(C.I)?.remove();
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

                const controller = api.controller();

                if (controller) {
                    await controller.reload();
                }

                if (state.destroyed || request.signal.aborted) return;

                ui.active(value);
                ui.toast('Updated successfully.');
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

            state.interval = setInterval(() => {
                if (state.destroyed) return;
                ui.render();
            }, C.INTERVAL);

            state.observer = new MutationObserver(() => {
                if (state.destroyed || state.renderQueued) return;

                state.renderQueued = true;

                queueMicrotask(() => {
                    state.renderQueued = false;
                    if (!state.destroyed) ui.render();
                });
            });

            state.observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            ui.render();

            return true;
        },

        async suspend() {
            if (!state.initialized) return true;
            state.controller.abort();
            state.controller = new AbortController();
            state.request?.abort();
            state.request = null;
            state.observer?.disconnect();
            state.observer = null;
            clearInterval(state.interval);
            state.interval = null;
            state.initialized = false;
            ui.destroy();
            return true;
        },

        async resume() {
            if (state.destroyed || state.initialized) return true;
            state.controller = new AbortController();
            return this.init();
        },

        async destroy() {
            if (state.destroyed) return true;

            state.destroyed = true;

            state.controller.abort();
            state.request?.abort();
            state.request = null;

            state.observer?.disconnect();
            state.observer = null;

            clearInterval(state.interval);
            state.interval = null;

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
