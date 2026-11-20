// ==UserScript==
// @name         Open ERX
// @namespace    https://odoo.yodawy.com/
// @version      1
// @description  Open matching Portal prescriptions inside Odoo.
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const TOOL_ID = 'TOOL-015';
    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    if (registry[TOOL_ID] || location.hostname !== 'odoo.yodawy.com') return;

    const ODOO_KEYS = [
        'Administrative control Authority (ACA)','Ahly Medical','Ain Shams University','Al-Mohandes for Chemical Trade and Industry','Amiantit FiberGlass Lokma Group','Amis','Apatch Petroleum','ARDISEIS P','AUC','AXA Services Egypt','AXON','Bank Misr','Baraka Bank','Bash Hakeem','Bayer PSP','Bupa','Care Plus','Central Bank of Egypt','Cheiron - Pico petroleum','CIAF','Cinema syndicate','Cinnabon','Coca-Cola','Coca Cola Digital Hub','DES','DMS','EGY-Care','EgyMed','Egyptian Football Association','EL Doha - Direct','El Mashreq','El Mrasem 5th installment ( Mivida)','El Mrasem For Construction','ElTawon','EMC','EMC Pensioners','Eshpetco','GASCO','General Organization for Government Printing Offices','GlobeMed','HDB','Health and Wealth','Housing and Building Research Center','HyperOne','INAYA EGYPT CO.','IQVIA PSP','Journalist Syndicate','Libano-Suisse','Life Healthcare','Limitless Care','Masr El Khier','Medicard','Medicare','MediConsult','MediGold','MedMark','MedMisr','Mednet','Medright','MedRight HPM','MedRight TPA','Medsure','MetLife','Midor','MISR HEALTH CARE','Movenpick - Self Insured','MSD PSP','MY PHARMACY CASH ORDER','Nabd Misr Clinics','NASR MINING','National Authority For Printing &Publishing','Neqabty','Next Care','NextCare 2','NileSat','Omega Care','Oriental Weavers _ 10th Ramadan','Petrojet','Pfizer PSP','Prime Health','Prime Health Insurance','Reliance Healthcare','Roche PSP','Rome Catholic NGO','Sanofi','SEDICO','Seha One','Sheraton','Smart Medical Services','SUEZ CANAL LIFE INSURANCE','Tri-Star','Unicare','Unimed','Veterinaries Syndicate','Wadi El Neel','Yodawy Direct Orders'
    ];

    const state = { destroyed: false, observer: null, handlers: new Map(), modal: null, accounts: [], ticket: null, busy: false };

    const normalize = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const normalizeKey = value => normalize(value).replace(/\s*\(\d+\)\s*$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const money = value => value === null || value === undefined || value === '' ? '—' : Number.isFinite(Number(value)) ? Number(value).toFixed(2) : String(value);
    const keyFor = company => {
        const target = normalizeKey(company);
        return ODOO_KEYS.find(key => normalizeKey(key) === target) || '';
    };
    const getField = name => {
        const element = document.querySelector('[name="' + name + '"]');
        return normalize(element?.innerText || element?.textContent || '');
    };
    const getTicketData = card => {
        const companyNode = document.querySelector('span[name="payor_id"] span') || document.querySelector('span[name="payor_id"]');
        const companyRaw = normalize(companyNode?.innerText || companyNode?.textContent || '');
        const company = keyFor(companyRaw);
        return {
            company,
            companyRaw,
            cardNumber: normalize(card?.innerText || card?.textContent || ''),
            formNumber: getField('prescription_number')
        };
    };
    const getApi = () => window.YODAWY_API_ENGINE;
    const setBusy = (busy, message = '') => {
        state.busy = busy;
        const button = state.modal?.querySelector('[data-open-erx-run]');
        const status = state.modal?.querySelector('[data-open-erx-status]');
        if (button) {
            button.disabled = busy;
            button.innerHTML = busy ? '<span class="yd-open-erx-spinner"></span> Working...' : 'Find Prescription';
        }
        if (status) {
            status.hidden = !message;
            status.textContent = message;
        }
    };
    const closeModal = () => {
        if (state.busy) return;
        state.modal?.remove();
        state.modal = null;
    };
    const renderResult = data => {
        const target = state.modal?.querySelector('[data-open-erx-result]');
        if (!target) return;
        const prescription = data.prescription || {};
        const medications = Array.isArray(prescription.medications) ? prescription.medications : [];
        target.innerHTML =
            '<section class="yd-open-erx-result-card"><div class="yd-open-erx-result-head"><div><span>Patient</span><strong>' + escapeHTML(data.patient?.name || '—') + '</strong></div><span class="yd-open-erx-status-pill">' + escapeHTML(prescription.status || 'Prescription Found') + '</span></div><div class="yd-open-erx-summary"><div><span>Form Number</span><strong>' + escapeHTML(prescription.formNumber || '') + '</strong></div><div><span>Prescription Number</span><strong>' + escapeHTML(prescription.prescriptionNumber || '—') + '</strong></div><div><span>Doctor</span><strong>' + escapeHTML(prescription.doctorName || '—') + '</strong></div><div><span>Created</span><strong>' + escapeHTML(prescription.creationDate || '—') + '</strong></div><div><span>Expiry</span><strong>' + escapeHTML(prescription.expiryDate || '—') + '</strong></div><div><span>Co-payment</span><strong>' + escapeHTML(prescription.coPayment || '—') + '</strong></div></div><div class="yd-open-erx-medications"><div class="yd-open-erx-section-title">Prescription Items <span>' + medications.length + '</span></div>' +
            (medications.length ? '<div class="yd-open-erx-table-wrap"><table><thead><tr><th>Medication</th><th>Form</th><th>Quantity</th><th>Dispensed</th><th>Price</th></tr></thead><tbody>' + medications.map(item => '<tr><td>' + escapeHTML(item.DrugName || '—') + '</td><td>' + escapeHTML(item.Form || item.DrugForm?.Name || item.SubForm?.Name || '—') + '</td><td>' + escapeHTML(item.Quantity ?? '—') + '</td><td>' + escapeHTML(item.DisposedQuantity ?? '—') + '</td><td>' + escapeHTML(money(item.Price)) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="yd-open-erx-empty">No medication details returned.</div>') +
            '</div>' + (prescription.note ? '<div class="yd-open-erx-note"><span>Prescription Note</span><p>' + escapeHTML(prescription.note) + '</p></div>' : '') + '</section>';
        target.hidden = false;
        state.modal?.querySelector('[data-open-erx-run]')?.setAttribute('hidden', 'hidden');
        state.modal?.querySelector('[data-open-erx-status]')?.setAttribute('hidden', 'hidden');
        state.modal?.querySelector('[data-open-erx-account-wrap]')?.setAttribute('hidden', 'hidden');
        state.modal?.querySelector('[data-open-erx-close]')?.focus();
    };
    const showFailure = (message, code = '') => {
        const target = state.modal?.querySelector('[data-open-erx-result]');
        if (!target) return;
        const descriptions = {
            PORTAL_LOGIN_FAILED: 'The selected Portal account could not sign in. Check its credentials in PORTALS.',
            PORTAL_LOGIN_REQUEST_FAILED: 'Portal login service could not be reached. Please retry.',
            CARD_NUMBER_NOT_VALID: message || 'The card number was not accepted by Portal.',
            FORM_NUMBER_NOT_FOUND: 'No prescription matched the exact Form Number from Odoo.',
            NO_PRESCRIPTIONS_FOUND: 'No prescriptions were found for this card.',
            CARD_VALIDATION_REQUEST_FAILED: 'Card validation failed. Please retry.',
            PRESCRIPTION_HISTORY_FAILED: 'Could not load the prescription history.',
            PRESCRIPTION_DETAILS_FAILED: 'Could not load the matched prescription details.',
            PORTAL_CREDENTIALS_UNAVAILABLE: 'The selected Portal credentials could not be decrypted.',
            UNAUTHORIZED: 'Your Dashboard session has expired. Refresh Odoo and try again.'
        };
        const text = descriptions[code] || message || 'Open ERX could not complete the request.';
        target.innerHTML = '<div class="yd-open-erx-error"><i class="fa-solid fa-circle-exclamation"></i><strong>Unable to Open ERX</strong><p>' + escapeHTML(text) + '</p></div>';
        target.hidden = false;
        state.modal?.querySelector('[data-open-erx-run]')?.removeAttribute('hidden');
    };
    const startSearch = async () => {
        if (state.busy) return;
        const selected = state.modal?.querySelector('[data-open-erx-account]')?.value || '';
        if (!selected) return showFailure('Select a linked Portal account first.');
        const api = getApi();
        if (!api?.runOpenErx) return showFailure('The Dashboard API is not ready. Refresh Odoo and try again.');
        const data = state.ticket;
        if (!data?.cardNumber || !data?.formNumber) return showFailure('Card Number or Form Number is missing from the Odoo ticket.');
        const result = state.modal?.querySelector('[data-open-erx-result]');
        if (result) { result.hidden = true; result.innerHTML = ''; }
        setBusy(true, 'Signing in, validating the card and matching the exact Form Number...');
        try {
            const response = await api.runOpenErx(selected, data.cardNumber, data.formNumber);
            if (response?.success !== true) {
                showFailure(response?.message || response?.error || 'Open ERX request failed.', response?.error || '');
                return;
            }
            renderResult(response);
        } catch (error) {
            showFailure(error?.message || 'The Open ERX request failed.');
        } finally {
            state.busy = false;
            const button = state.modal?.querySelector('[data-open-erx-run]');
            if (button && !button.hidden) {
                button.disabled = false;
                button.textContent = 'Find Prescription';
            }
        }
    };
    const loadAccounts = async () => {
        const data = state.ticket;
        const api = getApi();
        if (!api?.getOpenErxAccounts) return showFailure('The Dashboard account service is not ready. Refresh Odoo and try again.');
        const select = state.modal?.querySelector('[data-open-erx-account]');
        const button = state.modal?.querySelector('[data-open-erx-run]');
        const status = state.modal?.querySelector('[data-open-erx-status]');
        if (!select || !button) return;
        select.disabled = true;
        button.disabled = true;
        status.hidden = false;
        status.textContent = 'Loading matching accounts from PORTALS...';
        try {
            const response = await api.getOpenErxAccounts(data.company);
            if (response?.success !== true) throw new Error(response?.error || 'Portal accounts could not be loaded.');
            state.accounts = Array.isArray(response.accounts) ? response.accounts : [];
            if (!state.accounts.length) {
                status.textContent = 'No linked Portal account matches this Odoo Key in your PORTALS list.';
                button.disabled = true;
                return;
            }
            select.innerHTML = state.accounts.map(account => '<option value="' + escapeHTML(account.id) + '">' + escapeHTML((account.accountType === 'PERSONAL' ? 'Personal' : 'Non-Personal') + ' · ' + (account.username || account.label || account.id)) + '</option>').join('');
            select.disabled = state.accounts.length < 2;
            button.disabled = false;
            status.textContent = state.accounts.length > 1 ? 'Multiple accounts match. Select the account to use.' : 'Matching Portal account found.';
        } catch (error) {
            status.textContent = error?.message || 'Unable to load Portal accounts.';
            button.disabled = true;
        }
    };
    const openModal = async data => {
        closeModal();
        state.ticket = data;
        const overlay = document.createElement('div');
        overlay.className = 'yd-open-erx-backdrop';
        overlay.innerHTML = '<section class="yd-open-erx-modal" role="dialog" aria-modal="true" aria-labelledby="yd-open-erx-title"><header><div><span class="yd-open-erx-kicker">YODAWY WORKSPACE</span><h2 id="yd-open-erx-title">Open ERX</h2><p>Search the Portal prescription directly inside Odoo.</p></div><button type="button" data-open-erx-close aria-label="Close">×</button></header><div class="yd-open-erx-ticket"><div><span>Insurance Company</span><strong>' + escapeHTML(data.company) + '</strong></div><div><span>Card Number</span><strong>' + escapeHTML(data.cardNumber) + '</strong></div><div><span>Form Number</span><strong>' + escapeHTML(data.formNumber) + '</strong></div></div><div class="yd-open-erx-account" data-open-erx-account-wrap><label for="yd-open-erx-account">PORTALS Account</label><select id="yd-open-erx-account" data-open-erx-account disabled><option>Loading accounts...</option></select></div><div class="yd-open-erx-status" data-open-erx-status>Loading matching accounts from PORTALS...</div><div class="yd-open-erx-result" data-open-erx-result hidden></div><footer><button type="button" class="yd-open-erx-secondary" data-open-erx-close>Close</button><button type="button" class="yd-open-erx-primary" data-open-erx-run disabled>Find Prescription</button></footer></section>';
        document.body.append(overlay);
        state.modal = overlay;
        overlay.querySelectorAll('[data-open-erx-close]').forEach(button => button.addEventListener('click', closeModal));
        overlay.addEventListener('click', event => { if (event.target === overlay && !state.busy) closeModal(); });
        overlay.querySelector('[data-open-erx-run]').addEventListener('click', startSearch);
        overlay.querySelector('[data-open-erx-account]').addEventListener('change', () => {
            const status = overlay.querySelector('[data-open-erx-status]');
            if (status) status.textContent = 'Portal account selected.';
        });
        const keydown = event => {
            if (event.key === 'Escape' && state.modal === overlay && !state.busy) closeModal();
        };
        overlay._ydKeydown = keydown;
        document.addEventListener('keydown', keydown, true);
        overlay._ydRemoveKeydown = () => document.removeEventListener('keydown', keydown, true);
        if (!document.getElementById('yd-open-erx-style')) {
            const style = document.createElement('style');
            style.id = 'yd-open-erx-style';
            style.textContent = '.yd-open-erx-backdrop{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:22px;background:rgba(22,17,25,.58);backdrop-filter:blur(3px);font-family:Nunito,Arial,sans-serif}.yd-open-erx-modal{width:min(920px,100%);max-height:88vh;overflow:auto;background:#fff;border:1px solid #eadfe8;border-radius:14px;box-shadow:0 22px 70px rgba(25,15,25,.28);color:#302833}.yd-open-erx-modal header{display:flex;justify-content:space-between;gap:20px;padding:22px 24px;border-bottom:1px solid #eee7ed}.yd-open-erx-kicker{font-size:10px;letter-spacing:1.3px;color:#92768d;font-weight:800}.yd-open-erx-modal h2{margin:5px 0;color:#68465f;font-size:22px}.yd-open-erx-modal header p{margin:0;color:#77717a;font-size:12px}.yd-open-erx-modal header button{width:32px;height:32px;border:0;border-radius:7px;background:#eee7ed;color:#68465f;font-size:22px;cursor:pointer}.yd-open-erx-ticket{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:18px 24px;background:#faf8fa}.yd-open-erx-ticket div,.yd-open-erx-summary div{display:flex;flex-direction:column;gap:5px;min-width:0}.yd-open-erx-ticket span,.yd-open-erx-summary span,.yd-open-erx-note span{font-size:10px;color:#8b808b;font-weight:700;text-transform:uppercase;letter-spacing:.4px}.yd-open-erx-ticket strong,.yd-open-erx-summary strong{font-size:12px;color:#403744;overflow-wrap:anywhere}.yd-open-erx-account{padding:18px 24px 0}.yd-open-erx-account label{display:block;margin-bottom:7px;color:#655b66;font-size:12px;font-weight:700}.yd-open-erx-account select{width:100%;height:40px;padding:0 12px;border:1px solid #d8cbd6;border-radius:7px;background:#fff;color:#453b46;font-size:12px}.yd-open-erx-status{margin:14px 24px;padding:10px 12px;border-radius:7px;background:#f8f5f7;color:#68465f;font-size:12px}.yd-open-erx-status[hidden],.yd-open-erx-result[hidden]{display:none}.yd-open-erx-result{padding:0 24px 20px}.yd-open-erx-result-card{border:1px solid #e9e0e8;border-radius:10px;overflow:hidden}.yd-open-erx-result-head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:15px;background:#f9f6f9}.yd-open-erx-result-head div{display:flex;flex-direction:column;gap:5px}.yd-open-erx-result-head span:first-child{font-size:10px;color:#8b808b;text-transform:uppercase;font-weight:700}.yd-open-erx-result-head strong{font-size:15px;color:#493e4a}.yd-open-erx-status-pill{padding:5px 9px;border-radius:20px;background:#e8f5ed;color:#257346;font-size:10px;font-weight:800}.yd-open-erx-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;padding:16px}.yd-open-erx-medications{padding:0 16px 16px}.yd-open-erx-section-title{display:flex;gap:8px;align-items:center;margin-bottom:10px;color:#68465f;font-size:13px;font-weight:800}.yd-open-erx-section-title span{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:12px;background:#eee7ed;font-size:10px}.yd-open-erx-table-wrap{overflow:auto;border:1px solid #eee7ed;border-radius:8px}.yd-open-erx-table-wrap table{width:100%;border-collapse:collapse;font-size:11px}.yd-open-erx-table-wrap th{padding:10px;background:#f8f5f7;color:#65596a;text-align:left;white-space:nowrap}.yd-open-erx-table-wrap td{padding:10px;border-top:1px solid #f0eaf0;color:#403744;vertical-align:top}.yd-open-erx-empty{padding:12px;color:#867c87;font-size:12px}.yd-open-erx-note{margin:0 16px 16px;padding:12px;border-radius:8px;background:#faf8fa}.yd-open-erx-note p{margin:6px 0 0;color:#4d434e;font-size:12px;white-space:pre-wrap}.yd-open-erx-error{padding:20px;text-align:center;color:#a52b35}.yd-open-erx-error i{font-size:24px}.yd-open-erx-error strong{display:block;margin:8px 0 4px;font-size:14px}.yd-open-erx-error p{margin:0;color:#756a75;font-size:12px}.yd-open-erx-modal footer{display:flex;justify-content:flex-end;gap:9px;padding:15px 24px;border-top:1px solid #eee7ed}.yd-open-erx-modal footer button{min-height:38px;padding:8px 15px;border-radius:7px;font-size:12px;font-weight:800;cursor:pointer}.yd-open-erx-primary{border:1px solid #875a7b;background:#875a7b;color:#fff}.yd-open-erx-secondary{border:1px solid #ddd2dc;background:#fff;color:#68465f}.yd-open-erx-modal footer button:disabled{opacity:.55;cursor:not-allowed}.yd-open-erx-spinner{display:inline-block;width:12px;height:12px;margin-right:7px;border:2px solid #e3d5e1;border-top-color:#fff;border-radius:50%;vertical-align:middle;animation:yd-open-erx-spin .7s linear infinite}@keyframes yd-open-erx-spin{to{transform:rotate(360deg)}}@media(max-width:650px){.yd-open-erx-ticket{grid-template-columns:1fr}.yd-open-erx-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.yd-open-erx-modal{max-height:94vh}}';
            document.head.append(style);
        }
        await loadAccounts();
    };
    const setup = () => {
        if (state.destroyed || !document.body) return;
        for (const [element, item] of state.handlers) {
            if (!element.isConnected) {
                element.removeEventListener('click', item.handler);
                state.handlers.delete(element);
            }
        }
        for (const card of document.querySelectorAll('span[name="user_ref"]')) {
            if (state.handlers.has(card)) continue;
            const handler = event => {
                event.preventDefault();
                event.stopPropagation();
                const data = getTicketData(card);
                if (!data.company || !data.cardNumber || !data.formNumber) {
                    openModal({
                        company: data.company || data.companyRaw || 'Unsupported Company',
                        cardNumber: data.cardNumber || 'Unavailable',
                        formNumber: data.formNumber || 'Unavailable'
                    });
                    return;
                }
                openModal(data);
            };
            card.title = 'Open ERX';
            card.style.cursor = 'pointer';
            card.addEventListener('click', handler);
            state.handlers.set(card, { handler });
        }
    };
    const cleanup = () => {
        state.destroyed = true;
        state.observer?.disconnect();
        for (const [element, item] of state.handlers) element.removeEventListener('click', item.handler);
        state.handlers.clear();
        if (state.modal) {
            state.modal._ydRemoveKeydown?.();
            state.modal.remove();
            state.modal = null;
        }
        document.getElementById('yd-open-erx-style')?.remove();
        if (registry[TOOL_ID] === instance) delete registry[TOOL_ID];
        return true;
    };
    const instance = Object.freeze({ id: TOOL_ID, path: 'TOOLS/open-erx.js', destroy: async () => cleanup() });
    registry[TOOL_ID] = instance;
    state.observer = new MutationObserver(setup);
    state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setup();
})();