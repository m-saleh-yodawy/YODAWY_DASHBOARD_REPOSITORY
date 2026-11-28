// ==UserScript==
// @name         Create Chronic OM
// @namespace    https://odoo.yodawy.com/
// @version      1
// @description  Open Chronic Order Management ticket creation inside a modal from Quotation Station.
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const TOOL_ID = 'TOOL-020';
    const BUTTON_ID = 'ydCreateChronicOmButton';
    const MODAL_ID = 'ydCreateChronicOmModal';
    const STYLE_ID = 'ydCreateChronicOmStyle';
    const CREATE_URL = 'https://odoo.yodawy.com/web#id=&action=548&active_id=42&model=helpdesk.ticket&view_type=form&cids=2&menu_id=366';
    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    if (registry[TOOL_ID] || location.hostname !== 'odoo.yodawy.com') return;

    const state = {
        destroyed: false,
        suspended: false,
        observer: null,
        modal: null,
        opener: null,
        renderFrame: 0,
        previousBodyOverflow: '',
        previousHtmlOverflow: '',
        keydown: null
    };

    const hashParams = () => new URLSearchParams(location.hash.replace(/^#/, ''));
    const routeValue = name => hashParams().get(name) || new URLSearchParams(location.search).get(name) || '';
    const getTicketId = () => {
        const value = routeValue('id');
        return /^\d+$/.test(value) ? Number(value) : 0;
    };

    const getTicketTeamId = () => {
        const ticketId = getTicketId();
        const renderedIds = [...document.querySelectorAll('.o_form_view[data-res-id],.o_form_renderer[data-res-id],[data-oe-model="helpdesk.ticket"][data-oe-id]')]
            .map(node => Number(node.getAttribute('data-res-id') || node.getAttribute('data-oe-id') || 0))
            .filter(Number.isSafeInteger);
        if (ticketId && renderedIds.length && !renderedIds.includes(ticketId)) return 0;
        const nodes = document.querySelectorAll('[name="team_id"]');
        for (const node of nodes) {
            const values = [
                node.getAttribute('raw-value'),
                node.getAttribute('data-id'),
                node.querySelector('[raw-value]')?.getAttribute('raw-value'),
                node.querySelector('[data-id]')?.getAttribute('data-id')
            ];
            for (const value of values) if (/^\d+$/.test(String(value || '').trim())) return Number(value);
            const match = String(node.textContent || '').trim().match(/^(\d+)\s*-/);
            if (match) return Number(match[1]);
        }
        return 0;
    };

    const isQuotationTicket = () => {
        if (location.hostname !== 'odoo.yodawy.com' || routeValue('model') !== 'helpdesk.ticket' || routeValue('view_type') !== 'form' || !getTicketId()) return false;
        const teamId = getTicketTeamId();
        const quotationStationRoute = routeValue('action') === '548' && routeValue('active_id') === '69' && routeValue('menu_id') === '366';
        if (quotationStationRoute) return !teamId || teamId === 69;
        const contactTicketsRoute = routeValue('action') === '542' && routeValue('menu_id') === '320' && /^\d+$/.test(routeValue('active_id'));
        return contactTicketsRoute && teamId === 69;
    };

    const addStyle = () => {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '#' + BUTTON_ID + '{cursor:pointer!important}' +
            '#' + BUTTON_ID + ':hover{background:#f8f5f7!important}' +
            '#' + MODAL_ID + '{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;background:rgba(24,18,27,.62);backdrop-filter:blur(3px);font-family:Nunito,Arial,sans-serif}' +
            '#' + MODAL_ID + ' .yd-com-panel{display:flex;flex-direction:column;width:min(1320px,100%);height:min(920px,calc(100vh - 48px));min-height:360px;overflow:hidden;background:#fff;border:1px solid #e9dfe8;border-radius:14px;box-shadow:0 24px 80px rgba(20,12,22,.3);color:#302833}' +
            '#' + MODAL_ID + ' .yd-com-header{display:flex;align-items:center;justify-content:space-between;gap:18px;flex:0 0 auto;min-height:66px;padding:12px 18px 12px 22px;border-bottom:1px solid #eee7ed;background:#fff}' +
            '#' + MODAL_ID + ' .yd-com-heading{display:flex;align-items:center;gap:12px;min-width:0}' +
            '#' + MODAL_ID + ' .yd-com-mark{display:grid;place-items:center;flex:0 0 38px;width:38px;height:38px;border-radius:10px;background:#875a7b;color:#fff;font-size:16px}' +
            '#' + MODAL_ID + ' .yd-com-copy{min-width:0}' +
            '#' + MODAL_ID + ' .yd-com-kicker{display:block;margin-bottom:3px;color:#9a8297;font-size:9px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase}' +
            '#' + MODAL_ID + ' .yd-com-title{margin:0;color:#68465f;font-size:16px;font-weight:800;line-height:1.25}' +
            '#' + MODAL_ID + ' .yd-com-subtitle{margin:3px 0 0;color:#8a818b;font-size:11px;line-height:1.35}' +
            '#' + MODAL_ID + ' .yd-com-close{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;padding:0;border:0;border-radius:8px;background:#f2edf1;color:#68465f;font-size:23px;line-height:1;cursor:pointer;transition:background .15s,transform .15s}' +
            '#' + MODAL_ID + ' .yd-com-close:hover{background:#e9dfe8;transform:rotate(90deg)}' +
            '#' + MODAL_ID + ' .yd-com-content{position:relative;flex:1 1 auto;min-height:0;background:#f7f5f7}' +
            '#' + MODAL_ID + ' .yd-com-frame{display:block;width:100%;height:100%;min-height:0;border:0;background:#fff}' +
            '#' + MODAL_ID + ' .yd-com-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#766675;font-size:12px;pointer-events:none;transition:opacity .18s}' +
            '#' + MODAL_ID + ' .yd-com-loading[hidden]{display:none}' +
            '#' + MODAL_ID + ' .yd-com-spinner{width:17px;height:17px;border:2px solid #eadfe8;border-top-color:#875a7b;border-radius:50%;animation:yd-com-spin .7s linear infinite}' +
            '#' + MODAL_ID + ' .yd-com-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:0 0 auto;min-height:36px;padding:7px 16px;border-top:1px solid #eee7ed;background:#fff;color:#998e99;font-size:10px}' +
            '#' + MODAL_ID + ' .yd-com-footer strong{color:#68465f;font-weight:700}' +
            '@keyframes yd-com-spin{to{transform:rotate(360deg)}}' +
            '@media(max-width:700px){#' + MODAL_ID + '{padding:8px}#' + MODAL_ID + ' .yd-com-panel{height:calc(100vh - 16px);min-height:280px;border-radius:10px}#' + MODAL_ID + ' .yd-com-header{min-height:58px;padding:9px 11px}#' + MODAL_ID + ' .yd-com-subtitle{display:none}#' + MODAL_ID + ' .yd-com-footer{padding:6px 10px}}';
        document.head.appendChild(style);
    };

    const closeModal = () => {
        if (!state.modal) return;
        document.removeEventListener('keydown', state.keydown, true);
        state.modal.remove();
        state.modal = null;
        document.body.style.overflow = state.previousBodyOverflow;
        document.documentElement.style.overflow = state.previousHtmlOverflow;
        const opener = state.opener;
        state.opener = null;
        if (opener?.isConnected) opener.focus();
    };

    const openModal = button => {
        if (state.destroyed || state.suspended) return;
        if (state.modal) {
            state.modal.querySelector('.yd-com-close')?.focus();
            return;
        }
        addStyle();
        state.opener = button;
        state.previousBodyOverflow = document.body.style.overflow;
        state.previousHtmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';

        const overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        overlay.setAttribute('data-yd-screenshot-exclude', 'true');
        overlay.innerHTML = '<section class="yd-com-panel" role="dialog" aria-modal="true" aria-labelledby="yd-com-title"><header class="yd-com-header"><div class="yd-com-heading"><span class="yd-com-mark"><i class="fa-solid fa-file-circle-plus"></i></span><div class="yd-com-copy"><span class="yd-com-kicker">QUOTATION STATION WORKSPACE</span><h2 class="yd-com-title" id="yd-com-title">Create Chronic OM Ticket</h2><p class="yd-com-subtitle">Create a Chronic Order Management ticket without leaving the current quotation.</p></div></div><button type="button" class="yd-com-close" aria-label="Close modal" title="Close">×</button></header><div class="yd-com-content"><iframe class="yd-com-frame" title="Chronic Order Management ticket creation" referrerpolicy="same-origin"></iframe><div class="yd-com-loading"><span class="yd-com-spinner"></span><span>Loading Chronic Order Management form...</span></div></div><footer class="yd-com-footer"><span>Odoo · <strong>Chronic Order Management</strong></span><span>Current quotation remains open</span></footer></section>';
        document.body.appendChild(overlay);
        state.modal = overlay;

        const frame = overlay.querySelector('.yd-com-frame');
        const loading = overlay.querySelector('.yd-com-loading');
        frame.addEventListener('load', () => {
            if (state.modal === overlay) loading.hidden = true;
        }, { once: true });
        overlay.querySelector('.yd-com-close').addEventListener('click', closeModal);
        state.keydown = event => {
            if (event.key === 'Escape' && state.modal === overlay) {
                event.preventDefault();
                event.stopPropagation();
                closeModal();
            }
        };
        document.addEventListener('keydown', state.keydown, true);
        frame.src = CREATE_URL;
        overlay.querySelector('.yd-com-close').focus();
    };

    const removeButton = () => {
        document.getElementById(BUTTON_ID)?.remove();
    };

    const render = () => {
        if (state.destroyed || state.suspended) return;
        if (!isQuotationTicket()) {
            removeButton();
            closeModal();
            return;
        }
        const box = [...document.querySelectorAll('.o_not_full.oe_button_box, .oe_button_box')].find(element => element.isConnected);
        if (!box || document.getElementById(BUTTON_ID)) return;
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.className = 'btn oe_stat_button';
        button.title = 'Create a Chronic Order Management ticket';
        button.setAttribute('aria-label', 'Create Chronic OM Ticket');
        button.setAttribute('data-yd-screenshot-exclude', 'true');
        button.innerHTML = '<i class="yd-fa-icon fa-solid fa-file-circle-plus fa-fw o_button_icon"></i><div class="o_stat_info"><span class="o_stat_text">Chronic OM</span></div>';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openModal(button);
        });
        const split = box.querySelector(':scope > #ydDirectSplitButton');
        if (split) box.insertBefore(button, split.nextSibling);
        else box.appendChild(button);
    };

    const scheduleRender = () => {
        if (state.destroyed || state.suspended || state.renderFrame) return;
        state.renderFrame = requestAnimationFrame(() => {
            state.renderFrame = 0;
            render();
        });
    };

    const startObserver = () => {
        if (state.destroyed || state.suspended || state.observer || !document.body) return;
        state.observer = new MutationObserver(scheduleRender);
        state.observer.observe(document.body, { childList: true, subtree: true });
    };

    const instance = Object.freeze({
        id: TOOL_ID,
        path: 'TOOLS/create-chronic-om.js',
        screenshotBehavior: 'hide-only',
        supportsPause: true,
        init() {
            if (state.destroyed || state.suspended) return false;
            addStyle();
            startObserver();
            render();
            return true;
        },
        pause() {
            if (state.destroyed) return true;
            state.suspended = true;
            if (state.renderFrame) cancelAnimationFrame(state.renderFrame);
            state.renderFrame = 0;
            state.observer?.disconnect();
            state.observer = null;
            closeModal();
            removeButton();
            return true;
        },
        suspend() {
            return this.pause();
        },
        resume() {
            if (state.destroyed) return false;
            state.suspended = false;
            startObserver();
            render();
            return true;
        },
        refresh() {
            if (state.destroyed || state.suspended) return false;
            render();
            return true;
        },
        destroy() {
            if (state.destroyed) return true;
            state.destroyed = true;
            if (state.renderFrame) cancelAnimationFrame(state.renderFrame);
            state.observer?.disconnect();
            state.observer = null;
            closeModal();
            removeButton();
            document.getElementById(STYLE_ID)?.remove();
            if (registry[TOOL_ID] === instance) delete registry[TOOL_ID];
            return true;
        }
    });

    registry[TOOL_ID] = instance;
    instance.init();
})();