// ==UserScript==
// @name         Split Alt 1
// @namespace    https://odoo.yodawy.com/
// @version      1
// @description  Split Alt 1 legacy Portal Split workflow.
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/*
// @match        https://portal.yodawy.com/*
// @run-at       document-idle
// @grant         none
// ==/UserScript==

(async function () {
    'use strict';

    const TOOL_ID='TOOL-019';
    const registry=window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    if(registry[TOOL_ID])return;
    const lifecycle=window.__YD_SPLIT_ALT_1_LIFECYCLE__={busy:false,destroyed:false,cleanups:new Set()};
    const keyHandlers=new Set();
    let observer=null;
    const initTimers=new Set();
    const addKeyHandler=handler=>{document.addEventListener('keydown',handler);keyHandlers.add(handler);};
    const removeKeyHandler=handler=>{document.removeEventListener('keydown',handler);keyHandlers.delete(handler);};

    const CONFIG = {
        DIALOG_ID: 'tmSplitDrugDialog',
        FETCH_REQUIRED_ID: 'tmFetchRequiredDialog',
        NOT_SUPPORTED_ID: 'tmNotSupportedDialog',
        BUTTON_ID: 'tmLetsSplit',
        PORTAL_URL: 'https://portal.yodawy.com/'
    };

    let fetchRunning = false;
    let cleanupState = null;
    let chatterObserver = null;

    const normalizeText = text =>
        String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

    const escapeHtml = text =>
        String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

    const isVisible = element => {
        if (!element) return false;

        const rect = element.getBoundingClientRect();

        return rect.width > 0 &&
            rect.height > 0 &&
            element.offsetParent !== null;
    };

    const getText = element =>
        normalizeText(element?.innerText || element?.textContent || '');

    function getFieldValue(name) {
        for (const element of document.querySelectorAll(
            `span[name="${name}"], [name="${name}"]`
        )) {
            const value = getText(element);
            if (value) return value;
        }

        return '';
    }

    function getAcceptsSplitting() {
        for (const element of document.querySelectorAll(
            'span[name="accepts_splitting"], [name="accepts_splitting"]'
        )) {
            const raw = normalizeText(
                element.getAttribute('raw-value') || ''
            ).toLowerCase();

            const value = getText(element).toLowerCase();

            if (['no', 'false'].includes(raw) || ['no', 'false'].includes(value)) {
                return 'no';
            }

            if (['yes', 'true'].includes(raw) || ['yes', 'true'].includes(value)) {
                return 'yes';
            }
        }

        return '';
    }

    const getCardNumber = () => getFieldValue('user_ref');
    const getPrescriptionNumber = () => getFieldValue('prescription_number');
    const getPayor = () => getFieldValue('payor_id');
    const getEmployer = () => getFieldValue('insurance_agency');

    function getCycle() {
        const direct = document.querySelector('span[name="cycle_id"]');

        if (direct) {
            const value = getText(direct);
            if (value) return value;
        }

        for (const row of document.querySelectorAll('tr')) {
            if (!/\bcycle\b/i.test(getText(row))) continue;

            const span = row.querySelector('span[name="cycle_id"]');

            if (span) {
                const value = getText(span);
                if (value) return value;
            }

            const cells = row.querySelectorAll('td');

            if (cells.length >= 2) {
                const value = getText(cells[1]);

                if (value && !/^cycle$/i.test(value)) {
                    return value;
                }
            }
        }

        return '';
    }

    function getCompany() {
        const payor = getPayor().toLowerCase();

        if (payor.includes('next care')) return 'nextcare';
        if (payor.includes('metlife')) return 'metlife';

        return '';
    }

    function getNumericId(value) {
        const text = String(value || '').trim();

        if (!/^\d+$/.test(text)) return 0;

        const id = Number(text);

        return id > 0 ? id : 0;
    }

    function extractIdFromUrlPart(value) {
        const text = String(value || '');

        for (const pattern of [
            /(?:^|[?&#])id=(\d+)/i,
            /(?:^|[?&#])active_id=(\d+)/i,
            /(?:^|[?&#])res_id=(\d+)/i
        ]) {
            const match = text.match(pattern);

            if (match) {
                const id = getNumericId(match[1]);
                if (id) return id;
            }
        }

        try {
            const params = new URLSearchParams(text.replace(/^#/, '?'));

            for (const key of ['id', 'active_id', 'res_id']) {
                const id = getNumericId(params.get(key));
                if (id) return id;
            }
        } catch {}

        return 0;
    }

    function getTicketId() {
        const urlId = extractIdFromUrlPart(location.href);
        if (urlId) return urlId;

        const searchParams = new URLSearchParams(location.search);

        for (const key of ['id', 'active_id', 'res_id']) {
            const id = getNumericId(searchParams.get(key));
            if (id) return id;
        }

        const hashId = extractIdFromUrlPart(location.hash);
        if (hashId) return hashId;

        for (const selector of [
            '.o_form_view',
            '.o_form_renderer',
            '.o_form_sheet_bg',
            '.o_form_sheet',
            '.o_form_nosheet',
            '.o_chatter',
            '[data-res-id]',
            '[data-oe-id]',
            '[data-id]'
        ]) {
            for (const element of document.querySelectorAll(selector)) {
                for (const attribute of [
                    'data-res-id',
                    'data-oe-id',
                    'data-id'
                ]) {
                    const id = getNumericId(element.getAttribute(attribute));
                    if (id) return id;
                }
            }
        }

        for (const selector of [
            '[name="id"]',
            'input[name="id"]',
            'input[name="res_id"]',
            'input[name="active_id"]',
            '[name="res_id"]',
            '[name="active_id"]'
        ]) {
            for (const element of document.querySelectorAll(selector)) {
                for (const value of [
                    element.value,
                    element.getAttribute('value'),
                    element.getAttribute('raw-value'),
                    element.getAttribute('data-id'),
                    element.textContent
                ]) {
                    const id = getNumericId(value);
                    if (id) return id;
                }
            }
        }

        return 0;
    }

    function getSessionContext() {
        const session =
            window.odoo?.session_info ||
            window.odoo?.__session_info__ ||
            {};

        const userContext = { ...(session.user_context || {}) };
        const companies = session.user_companies || session.companies || {};

        let allowedCompanyIds = userContext.allowed_company_ids;

        if (!Array.isArray(allowedCompanyIds)) {
            const currentCompany =
                companies.current_company ||
                companies.current_company_id ||
                session.company_id;

            if (currentCompany) {
                const companyId = typeof currentCompany === 'object'
                    ? currentCompany.id
                    : currentCompany;

                if (companyId) {
                    allowedCompanyIds = [Number(companyId)];
                }
            }
        }

        if (!Array.isArray(allowedCompanyIds) || !allowedCompanyIds.length) {
            allowedCompanyIds = [2];
        }

        return {
            ...userContext,
            lang: userContext.lang || 'en_US',
            tz: userContext.tz || 'Europe/Volgograd',
            uid: userContext.uid || session.uid || 0,
            allowed_company_ids: allowedCompanyIds.map(Number).filter(Boolean)
        };
    }

    function getActiveTeamId() {
        const field = document.querySelector('span[name="team_id"]');

        if (field) {
            const raw =
                field.getAttribute('raw-value') ||
                field.getAttribute('data-id') ||
                '';

            if (/^\d+$/.test(raw)) return Number(raw);

            const match = getText(field).match(/^(\d+)\s*-/);

            if (match) return Number(match[1]);
        }

        return 69;
    }

    function getActionContext() {
        const base = getSessionContext();
        const teamId = getActiveTeamId();

        return {
            ...base,
            active_id: teamId,
            active_ids: [teamId],
            default_team_id: teamId,
            group_by: 'stage_id',
            params: {
                action: 548,
                active_id: teamId,
                cids: base.allowed_company_ids.join(','),
                menu_id: 366,
                model: 'helpdesk.ticket',
                view_type: 'list'
            },
            search_default_active_cycle: 1,
            search_default_unassigned: 1
        };
    }

    async function rpc(model, method, args = [], kwargs = {}) {
        const response = await fetch(
            `/web/dataset/call_kw/${model}/${method}`,
            {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: { model, method, args, kwargs },
                    id: Date.now() + Math.floor(Math.random() * 1000)
                })
            }
        );

        if (!response.ok) {
            throw new Error(`RPC failed (${response.status})`);
        }

        const data = await response.json();

        if (data.error) {
            const error = data.error;

            throw new Error(
                error?.data?.message ||
                error?.data?.arguments?.[0] ||
                error?.data?.name ||
                error?.message ||
                'RPC request failed'
            );
        }

        return data.result;
    }

    async function getLatestMessageId(ticketId) {
        try {
            const messages = await rpc(
                'mail.message',
                'search_read',
                [[
                    ['model', '=', 'helpdesk.ticket'],
                    ['res_id', '=', ticketId]
                ]],
                {
                    fields: ['id'],
                    order: 'id desc',
                    limit: 1,
                    context: getSessionContext()
                }
            );

            return Number(messages?.[0]?.id || 0);
        } catch {
            return null;
        }
    }

    async function callButtonFetch(ticketId) {
        return rpc(
            'helpdesk.ticket',
            'action_fetch_suitable_alternatives',
            [[ticketId]],
            { context: getActionContext() }
        );
    }

    async function readWizard(wizardId) {
        const result = await rpc(
            'alternative.wizard',
            'read',
            [[wizardId]],
            {
                fields: [
                    'non_selected_drugs',
                    'alternative_lines_ids',
                    'available_lines_ids',
                    'display_name'
                ],
                context: getSessionContext()
            }
        );

        return result?.[0] || {};
    }

    async function getWizardLineModel() {
        const result = await rpc(
            'alternative.wizard',
            'fields_get',
            [['alternative_lines_ids']],
            {
                attributes: ['relation'],
                context: getSessionContext()
            }
        );

        const relation = result?.alternative_lines_ids?.relation;

        if (!relation) {
            throw new Error('Could not determine alternative lines model');
        }

        return relation;
    }

    async function readWizardLines(lineIds) {
        if (!Array.isArray(lineIds) || !lineIds.length) return [];

        const lineModel = await getWizardLineModel();

        return rpc(
            lineModel,
            'read',
            [lineIds],
            {
                fields: [
                    'is_header',
                    'alt_drug_in_available',
                    'limited_drug',
                    'replace_or_delete_line',
                    'select_alternative',
                    'alternative_drug_id',
                    'alternative_uom',
                    'alternative_hzb',
                    'alternative_qty',
                    'stock_available',
                    'label'
                ],
                context: getSessionContext()
            }
        );
    }

    function cleanDrugName(text) {
        return normalizeText(text)
            .replace(/^Limited\s+(?:Drug|Item)\s*:\s*/i, '')
            .trim();
    }

    function extractDrug(text) {
        const value = cleanDrugName(text);

        if (!value) return null;

        const match = value.match(/^(.+),\s*[^,\n]+,\s*(\d+)\s*$/);

        if (!match) return null;

        const name = normalizeText(match[1]);
        const hzb = normalizeText(match[2]);

        if (!name || name.length > 250 || !hzb) return null;

        return {
            name,
            hzb,
            limited: `Limited Drug: ${value}`
        };
    }

    function parseFetchedDrugs(value) {
        const drugs = [];

        const raw = String(value || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/li>\s*<li>/gi, '\n')
            .replace(/<li>/gi, '\n')
            .replace(/<\/li>/gi, '\n')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ');

        for (const line of raw.split(/\r?\n/).map(normalizeText).filter(Boolean)) {
            const drug = extractDrug(line);

            if (drug) {
                drugs.push({
                    ...drug,
                    odooIndex: drugs.length
                });
            }
        }

        if (!drugs.length) {
            const drug = extractDrug(raw);

            if (drug) {
                drugs.push({
                    ...drug,
                    odooIndex: 0
                });
            }
        }

        return drugs;
    }

    function isFetchGeneratedMessageBody(body, ticketId, drugs = []) {
        const html = String(body || '');
        const plain = html
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;|&#160;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#0*39;|&#x27;/gi, "'");
        const normalized = normalizeText(plain).toLowerCase();

        if (!normalized) return false;

        const payloadMessage =
            normalized.includes('ticket:' + String(ticketId).toLowerCase()) &&
            normalized.includes('identifier') &&
            normalized.includes('drugs') &&
            normalized.includes('payer');

        if (payloadMessage) return true;
        if (!/<table[\s>]/i.test(html) || !Array.isArray(drugs) || !drugs.length) return false;

        const targets = drugs.map(drug => ({
            name: normalizeText(drug?.name).toLowerCase(),
            hzb: String(drug?.hzb || '').trim()
        }));

        return targets.every(target =>
            target.name &&
            /^\d+$/.test(target.hzb) &&
            normalized.includes(target.name) &&
            normalized.includes(target.hzb)
        );
    }
    function removeFetchMessageFromDOM(messageElement, ticketId, drugs) {
        if (!messageElement) return;

        const body =
            messageElement.querySelector('.o_Message_prettyBody') ||
            messageElement.querySelector('[class*="prettyBody"]') ||
            messageElement;

        const html = body?.innerHTML || body?.textContent || '';

        if (isFetchGeneratedMessageBody(html, ticketId, drugs)) {
            messageElement.remove();
        }
    }

    function scanFetchMessagesInDOM() {
        if (!cleanupState) return;

        const seen = new Set();

        for (const selector of ['.o_Message', '.o-mail-Message']) {
            for (const message of document.querySelectorAll(selector)) {
                if (seen.has(message)) continue;
                seen.add(message);

                if (cleanupState.initialMessageElements.has(message)) continue;

                removeFetchMessageFromDOM(
                    message,
                    cleanupState.ticketId,
                    cleanupState.drugs
                );
            }
        }
    }

    function startDOMCleanup(ticketId, drugs, initialMessageElements, initialMessageId) {
        if (chatterObserver) {
            chatterObserver.disconnect();
            chatterObserver = null;
        }

        cleanupState = {
            ticketId,
            drugs: Array.isArray(drugs) ? drugs : [],
            initialMessageElements: initialMessageElements || new Set(),
            initialMessageId
        };

        chatterObserver = new MutationObserver(mutations => {
            if (!cleanupState) return;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    if (
                        node.matches?.('.o_Message, .o-mail-Message') &&
                        !cleanupState.initialMessageElements.has(node)
                    ) {
                        removeFetchMessageFromDOM(
                            node,
                            cleanupState.ticketId,
                            cleanupState.drugs
                        );
                    }

                    for (const message of node.querySelectorAll?.(
                        '.o_Message, .o-mail-Message'
                    ) || []) {
                        if (cleanupState.initialMessageElements.has(message)) {
                            continue;
                        }

                        removeFetchMessageFromDOM(
                            message,
                            cleanupState.ticketId,
                            cleanupState.drugs
                        );
                    }
                }
            }
        });

        const chatter = document.querySelector('.o_chatter') || document.body;

        chatterObserver.observe(chatter, {
            childList: true,
            subtree: true
        });
    }

    function stopDOMCleanup() {
        cleanupState = null;

        if (chatterObserver) {
            chatterObserver.disconnect();
            chatterObserver = null;
        }
    }

    async function removeFetchMessagesFromServer(ticketId, drugs, initialMessageId) {
        if (initialMessageId === null || initialMessageId === undefined || initialMessageId === '') return false;
        const baseline = Number(initialMessageId);
        if (!Number.isInteger(baseline) || baseline < 0) return false;

        try {
            const messages = await rpc(
                'mail.message',
                'search_read',
                [[
                    ['model', '=', 'helpdesk.ticket'],
                    ['res_id', '=', ticketId],
                    ['id', '>', baseline]
                ]],
                {
                    fields: ['id', 'body'],
                    order: 'id desc',
                    limit: 30,
                    context: getSessionContext()
                }
            );

            if (!Array.isArray(messages) || !messages.length) return false;

            const foundIds = messages
                .filter(message =>
                    Number.isInteger(Number(message?.id)) &&
                    Number(message.id) > baseline &&
                    isFetchGeneratedMessageBody(message?.body, ticketId, drugs)
                )
                .map(message => Number(message.id));

            if (!foundIds.length) return false;

            await rpc(
                'mail.message',
                'unlink',
                [foundIds],
                { context: getSessionContext() }
            );

            return true;
        } catch {
            return false;
        }
    }

    async function cleanupFetchMessagesFast(ticketId, drugs, initialMessageId) {
        if (!cleanupState || cleanupState.ticketId !== ticketId) return false;

        cleanupState.drugs = Array.isArray(drugs) ? drugs : [];
        scanFetchMessagesInDOM();

        return removeFetchMessagesFromServer(
            ticketId,
            cleanupState.drugs,
            initialMessageId
        );
    }

    function validateUniqueDrugHzbs(drugs) {
        const seen = new Map();
        const duplicates = [];

        for (const drug of drugs) {
            const hzb = String(drug?.hzb || '').trim();
            if (!hzb) throw new Error('Missing HZB for ' + (drug?.name || 'Unknown drug'));
            if (seen.has(hzb)) duplicates.push(hzb);
            else seen.set(hzb, drug.name);
        }

        if (duplicates.length) {
            throw new Error(
                'Duplicate HZB values were returned by Odoo Fetch: ' +
                [...new Set(duplicates)].join(', ') +
                '. Split stopped because the Portal backup requires a unique HZB for each selected medication.'
            );
        }
    }

    async function fetchSplitDrugs() {
        const ticketId = getTicketId();

        if (!ticketId) throw new Error('Ticket ID Not Found');

        const initialMessageElements = new Set(
            document.querySelectorAll('.o_Message, .o-mail-Message')
        );
        const initialMessageId = await getLatestMessageId(ticketId);

        startDOMCleanup(ticketId, [], initialMessageElements, initialMessageId);

        try {
            const action = await callButtonFetch(ticketId);
            const wizardId = Number(action?.res_id || 0);

            if (!wizardId) throw new Error('Fetch did not return a wizard');

            const wizard = await readWizard(wizardId);
            let drugs = parseFetchedDrugs(wizard.non_selected_drugs);

            if (
                !drugs.length &&
                Array.isArray(wizard.alternative_lines_ids) &&
                wizard.alternative_lines_ids.length
            ) {
                const lines = await readWizardLines(wizard.alternative_lines_ids);

                for (const line of lines) {
                    if (!line?.is_header) continue;
                    const drug = extractDrug(line.limited_drug);
                    if (drug) drugs.push({ ...drug, odooIndex: drugs.length });
                }
            }

            if (!drugs.length) throw new Error('No missing drugs were returned by FETCH');

            validateUniqueDrugHzbs(drugs);

            if (cleanupState) cleanupState.drugs = drugs;
            await cleanupFetchMessagesFast(ticketId, drugs, initialMessageId);

            return drugs;
        } catch (error) {
            await cleanupFetchMessagesFast(
                ticketId,
                cleanupState?.drugs || [],
                initialMessageId
            );
            throw error;
        } finally {
            stopDOMCleanup();
        }
    }

    function getBaseDrugName(name) {
        let value = normalizeText(name)
            .replace(/\([^)]*\)/g, ' ')
            .trim();

        const strengthRegex =
            /\b\d+(?:\.\d+)?\s*(?:MG|MCG|G|GM|GRAM|KG|ML|L|IU|UI|%|MG\/ML|MCG\/ML|MG\/5ML|MG\/10ML)\b/i;

        const match = value.match(strengthRegex);

        if (match) {
            value = value.slice(0, match.index).trim();
        }

        return normalizeText(value)
            .replace(/[\s\-\/]+$/, '')
            .toLowerCase();
    }

    function getDuplicateGroups(drugs) {
        const groups = new Map();

        for (const drug of drugs) {
            const base = getBaseDrugName(drug.name);

            if (!base) continue;

            if (!groups.has(base)) {
                groups.set(base, {
                    name: drug.name
                        .replace(
                            /\b\d+(?:\.\d+)?\s*(?:MG|MCG|G|GM|GRAM|KG|ML|L|IU|UI|%)\b.*$/i,
                            ''
                        )
                        .trim(),
                    items: []
                });
            }

            groups.get(base).items.push(drug);
        }

        return [...groups.values()].filter(group => group.items.length > 1);
    }

    function findLogNoteButton() {
        for (const selector of [
            'button[data-original-title="Log note"]',
            'button[title="Log note"]',
            'button.o_ChatterTopbar_buttonLogNote',
            'button.o-mail-Chatter-topbar_logNote',
            'button:has(i.fa-pencil-square-o)',
            'button:has(i.fa-edit)'
        ]) {
            try {
                const button = [...document.querySelectorAll(selector)]
                    .find(isVisible);

                if (button) return button;
            } catch {}
        }

        return [...document.querySelectorAll('button')].find(button =>
            isVisible(button) &&
            getText(button).toLowerCase() === 'log note'
        ) || null;
    }

    function findLogComposer() {
        for (const selector of [
            '.o_ComposerTextInput_textarea',
            '.o_MessageComposer_input',
            'textarea.o_ComposerTextInput_textarea',
            'textarea[placeholder*="Log note" i]',
            'textarea[placeholder*="Write" i]',
            '[contenteditable="true"].o_ComposerTextInput',
            '[contenteditable="true"]'
        ]) {
            const element = [...document.querySelectorAll(selector)]
                .find(isVisible);

            if (element) return element;
        }

        return null;
    }

    function setComposerValue(element, value) {
        element.focus();

        if (element.isContentEditable) {
            element.textContent = value;

            element.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: value
            }));

            return;
        }

        const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
        )?.set;

        if (setter) {
            setter.call(element, value);
        } else {
            element.value = value;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function waitForElement(fn, timeout = 5000, interval = 50) {
        const start = Date.now();

        while (Date.now() - start < timeout) {
            const element = fn();

            if (element) return element;

            await new Promise(resolve => setTimeout(resolve, interval));
        }

        throw new Error('Log Note composer not found');
    }

    async function createSplitLogNote(drugs) {
        const text = drugs
            .map(drug => `${drug.limited}\nSPLIT`)
            .join('\n\n');

        let composer = findLogComposer();

        if (!composer) {
            const logButton = findLogNoteButton();

            if (logButton) {
                logButton.click();
                await new Promise(resolve => setTimeout(resolve, 120));
            }

            composer = await waitForElement(findLogComposer);
        }

        const current = composer.isContentEditable
            ? composer.textContent || ''
            : composer.value || '';

        const value = current.trim()
            ? `${current.replace(/\s+$/, '')}\n\n${text}`
            : text;

        setComposerValue(composer, value);
    }

    function injectDialogCSS() {
        if (document.getElementById('tmSplitDialogCSS')) return;

        const style = document.createElement('style');

        style.id = 'tmSplitDialogCSS';

        style.textContent = `
#tmSplitDrugDialog,#tmFetchRequiredDialog,#tmNotSupportedDialog{font-family:Roboto,Arial,sans-serif}
#tmSplitDrugDialog{position:fixed;inset:0;z-index:999999999;display:flex;align-items:center;justify-content:left;background:rgba(30,20,30,.58)}
#tmSplitDrugDialog .tm-dialog{width:650px;max-width:calc(100vw - 40px);max-height:calc(100vh - 70px);background:#fff;border:1px solid #68465f;border-radius:10px;margin-left:250px;box-shadow:0 18px 60px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column}
#tmSplitDrugDialog .tm-header{padding:17px 20px;background:#875A7B;color:#fff;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #68465f}
#tmSplitDrugDialog .tm-title{font-size:18px;font-weight:600}
#tmSplitDrugDialog .tm-subtitle{font-size:12px;opacity:.88;margin-top:4px}
#tmSplitDrugDialog .tm-close{width:34px;height:34px;border:1px solid rgba(255,255,255,.35);border-radius:50%;background:rgba(255,255,255,.12);color:#fff;font-size:22px;cursor:pointer}
#tmSplitDrugDialog .tm-body{padding:18px 20px;overflow-y:auto}
#tmSplitDrugDialog .tm-warning{display:flex;align-items:flex-start;gap:12px;padding:13px 15px;margin-bottom:14px;border:1px solid #b71c1c;border-left:5px solid #d32f2f;border-radius:7px;background:#fff0f0;color:#8b0000}
#tmSplitDrugDialog .tm-warning-icon{font-size:23px;line-height:1}
#tmSplitDrugDialog .tm-warning-content{flex:1}
#tmSplitDrugDialog .tm-warning-title{font-size:14px;font-weight:700;color:#b71c1c;margin-bottom:6px}
#tmSplitDrugDialog .tm-warning-item{font-size:13px;line-height:1.6;color:#8b0000}
#tmSplitDrugDialog .tm-warning-item strong{font-weight:700}
#tmSplitDrugDialog .tm-select-all{display:flex;align-items:center;gap:10px;padding:11px 13px;margin-bottom:12px;border:1px solid #68465f;border-radius:7px;background:#faf7f9;color:#3f293a;cursor:pointer;font-weight:600}
#tmSplitDrugDialog .tm-select-all input,#tmSplitDrugDialog .tm-drug input{width:18px;height:18px;accent-color:#875A7B}
#tmSplitDrugDialog .tm-drug{display:flex;align-items:flex-start;gap:12px;padding:13px;margin-bottom:8px;border:1px solid #ddd;border-radius:7px;cursor:pointer;background:#fff}
#tmSplitDrugDialog .tm-drug:hover{background:#faf7f9;border-color:#68465f}
#tmSplitDrugDialog .tm-drug:has(input:checked){background:#f5eef4;border-color:#875A7B}
#tmSplitDrugDialog .tm-drug input{margin-top:2px;cursor:pointer;flex:0 0 auto}
#tmSplitDrugDialog .tm-drug-name{flex:1;font-size:14px;line-height:1.45;color:#292929}
#tmSplitDrugDialog .tm-footer{padding:14px 20px;border-top:1px solid #e5e5e5;display:flex;align-items:center;justify-content:space-between;background:#fafafa}
#tmSplitDrugDialog .tm-count{font-size:13px;color:#666}
#tmSplitDrugDialog .tm-actions{display:flex;gap:8px}
#tmSplitDrugDialog button.tm-action{border:1px solid transparent;border-radius:6px;padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer}
#tmSplitDrugDialog .tm-cancel{background:#eee;color:#333;border-color:#d5d5d5}
#tmSplitDrugDialog .tm-split{background:#875A7B;color:#fff;border-color:#68465f}
#tmSplitDrugDialog .tm-split:disabled{opacity:.55;cursor:not-allowed}
#tmFetchRequiredDialog,#tmNotSupportedDialog{position:fixed;inset:0;z-index:1000000000;display:flex;align-items:center;justify-content:center;background:rgba(30,20,30,.58);backdrop-filter:blur(2px)}
#tmFetchRequiredDialog .tm-fetch-dialog,#tmNotSupportedDialog .tm-support-dialog{width:430px;max-width:calc(100vw - 40px);background:#fff;border:1px solid #68465f;border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.35);overflow:hidden}
#tmFetchRequiredDialog .tm-fetch-header,#tmNotSupportedDialog .tm-support-header{padding:17px 20px;background:#875A7B;color:#fff;display:flex;align-items:center;gap:12px}
#tmFetchRequiredDialog .tm-fetch-icon,#tmNotSupportedDialog .tm-support-icon{font-size:22px}
#tmFetchRequiredDialog .tm-fetch-title,#tmNotSupportedDialog .tm-support-title{font-size:17px;font-weight:600}
#tmFetchRequiredDialog .tm-fetch-body,#tmNotSupportedDialog .tm-support-body{padding:25px 22px 20px;color:#292929}
#tmFetchRequiredDialog .tm-fetch-message,#tmNotSupportedDialog .tm-support-message{font-size:15px;line-height:1.6}
#tmNotSupportedDialog .tm-support-message{display:flex;align-items:center;gap:13px}
#tmNotSupportedDialog .tm-support-badge{width:42px;height:42px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#f5eef4;color:#875A7B;font-size:21px;flex:0 0 auto}
#tmNotSupportedDialog .tm-support-text strong{display:block;color:#68465f;font-size:16px;margin-bottom:4px}
#tmNotSupportedDialog .tm-support-text span{display:block;color:#666;font-size:13px}
#tmFetchRequiredDialog .tm-fetch-footer,#tmNotSupportedDialog .tm-support-footer{padding:13px 20px;border-top:1px solid #e5e5e5;display:flex;justify-content:flex-end;background:#fafafa}
#tmFetchRequiredDialog .tm-fetch-ok,#tmNotSupportedDialog .tm-support-ok{min-width:80px;padding:9px 20px;border:1px solid #68465f;border-radius:6px;background:#875A7B;color:#fff;font-size:13px;font-weight:600;cursor:pointer}
#tmFetchRequiredDialog .tm-fetch-ok:hover,#tmNotSupportedDialog .tm-support-ok:hover{background:#68465f}
`;

        document.head.appendChild(style);
    }

    function showDrugSelector(drugs) {
        injectDialogCSS();

        document.getElementById(CONFIG.DIALOG_ID)?.remove();

        const duplicates = getDuplicateGroups(drugs);

        const warning = duplicates.length ? `
<div class="tm-warning">
    <div class="tm-warning-icon">⚠️</div>
    <div class="tm-warning-content">
        <div class="tm-warning-title">DUPLICATE DRUGS DETECTED</div>
        ${duplicates.map(group => `
        <div class="tm-warning-item">
            <strong>${escapeHtml(group.name)}</strong>
            is repeated
            <strong>${group.items.length} times</strong>
        </div>`).join('')}
    </div>
</div>` : '';

        const dialog = document.createElement('div');

        dialog.id = CONFIG.DIALOG_ID;

        dialog.innerHTML = `
<div class="tm-dialog">
    <div class="tm-header">
        <div>
            <div class="tm-title">Select Drugs To Split</div>
            <div class="tm-subtitle">Select the items you want to send to Portal</div>
        </div>
        <button type="button" class="tm-close" id="tmSplitClose">×</button>
    </div>
    <div class="tm-body">
        ${warning}
        <label class="tm-select-all">
            <input type="checkbox" id="tmSelectAll">
            <span>Select All</span>
        </label>
        <div id="tmDrugList"></div>
    </div>
    <div class="tm-footer">
        <div class="tm-count" id="tmSelectedCount">0 selected</div>
        <div class="tm-actions">
            <button type="button" class="tm-action tm-cancel" id="tmSplitCancel">CANCEL</button>
            <button type="button" class="tm-action tm-split" id="tmSplitConfirm" disabled>SPLIT</button>
        </div>
    </div>
</div>`;

        document.body.appendChild(dialog);

        const list = dialog.querySelector('#tmDrugList');

        drugs.forEach((drug, index) => {
            const label = document.createElement('label');

            label.className = 'tm-drug';

            label.innerHTML = `
<input type="checkbox" class="tm-drug-checkbox" data-index="${index}">
<div class="tm-drug-name">${escapeHtml(drug.name)}</div>`;

            list.appendChild(label);
        });

        const selectAll = dialog.querySelector('#tmSelectAll');

        const checkboxes = [
            ...dialog.querySelectorAll('.tm-drug-checkbox')
        ];

        const countElement = dialog.querySelector('#tmSelectedCount');
        const splitButton = dialog.querySelector('#tmSplitConfirm');

        function updateSelection() {
            const selectedCount = checkboxes.filter(
                checkbox => checkbox.checked
            ).length;

            countElement.textContent = `${selectedCount} selected`;
            splitButton.disabled = selectedCount === 0;

            selectAll.checked =
                checkboxes.length > 0 &&
                selectedCount === checkboxes.length;

            selectAll.indeterminate =
                selectedCount > 0 &&
                selectedCount < checkboxes.length;
        }

        function closeDialog() {
            document.getElementById(CONFIG.DIALOG_ID)?.remove();
            removeKeyHandler(keyboardHandler);
            stopDOMCleanup();
        }

        function keyboardHandler(event) {
            if (!document.getElementById(CONFIG.DIALOG_ID)) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                closeDialog();
                return;
            }

            if (event.key === 'Enter' && !splitButton.disabled) {
                event.preventDefault();
                splitButton.click();
            }
        }

        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updateSelection);
        });

        selectAll.addEventListener('change', () => {
            checkboxes.forEach(checkbox => {
                checkbox.checked = selectAll.checked;
            });

            updateSelection();
        });

        dialog.querySelector('#tmSplitClose')
            .addEventListener('click', closeDialog);

        dialog.querySelector('#tmSplitCancel')
            .addEventListener('click', closeDialog);

        addKeyHandler(keyboardHandler);

        splitButton.addEventListener('click', async () => {
            const selected = checkboxes
                .filter(checkbox => checkbox.checked)
                .map(checkbox => drugs[Number(checkbox.dataset.index)]);

            if (!selected.length || lifecycle.busy) return;

            lifecycle.busy = true;
            let popup = null;

            try {
                const portalUrl = buildPortalUrl(selected);
                popup = window.open('about:blank', '_blank');

                if (!popup) {
                    throw new Error('Browser blocked the Portal tab. Please allow popups for Odoo.');
                }

                splitButton.disabled = true;
                splitButton.textContent = 'WRITING LOG...';

                await createSplitLogNote(selected);

                splitButton.textContent = 'OPENING PORTAL...';
                openPortal(popup, portalUrl);
                closeDialog();
            } catch (error) {
                try {
                    if (popup && !popup.closed) popup.close();
                } catch {}

                alert(
                    'Could not complete Split\n\n' +
                    (error?.message || 'Unknown error')
                );

                splitButton.disabled = false;
                splitButton.textContent = 'SPLIT';
            } finally {
                lifecycle.busy = false;
            }
        });

        updateSelection();
    }

    function showNotSupportedModal() {
        document.getElementById(CONFIG.NOT_SUPPORTED_ID)?.remove();

        injectDialogCSS();

        const overlay = document.createElement('div');

        overlay.id = CONFIG.NOT_SUPPORTED_ID;

        overlay.innerHTML = `
<div class="tm-support-dialog">
    <div class="tm-support-header">
        <div class="tm-support-icon">⚠️</div>
        <div class="tm-support-title">NOT SUPPORTED ACCOUNT</div>
    </div>
    <div class="tm-support-body">
        <div class="tm-support-message">
            <div class="tm-support-badge">×</div>
            <div class="tm-support-text">
                <strong>Splitting is not supported</strong>
                <span>This account does not accept prescription splitting.</span>
            </div>
        </div>
    </div>
    <div class="tm-support-footer">
        <button type="button" id="tmSupportOK" class="tm-support-ok">OK</button>
    </div>
</div>`;

        document.body.appendChild(overlay);

        const close = () => {
            overlay.remove();
            removeKeyHandler(escape);
        };

        const escape = event => {
            if (event.key === 'Escape') close();
        };

        overlay.querySelector('#tmSupportOK')
            .addEventListener('click', close);

        addKeyHandler(escape);
    }

    function showFetchRequiredModal(message) {
        document.getElementById(CONFIG.FETCH_REQUIRED_ID)?.remove();

        injectDialogCSS();

        const overlay = document.createElement('div');

        overlay.id = CONFIG.FETCH_REQUIRED_ID;

        overlay.innerHTML = `
<div class="tm-fetch-dialog">
    <div class="tm-fetch-header">
        <div class="tm-fetch-icon">⚠️</div>
        <div class="tm-fetch-title">FETCH FAILED</div>
    </div>
    <div class="tm-fetch-body">
        <div class="tm-fetch-message">${escapeHtml(
            message || 'Could not fetch missing drugs.'
        )}</div>
    </div>
    <div class="tm-fetch-footer">
        <button type="button" id="tmFetchRequiredOK" class="tm-fetch-ok">OK</button>
    </div>
</div>`;

        document.body.appendChild(overlay);

        const close = () => {
            overlay.remove();
            document.removeEventListener('keydown', escape);
        };

        const escape = event => {
            if (event.key === 'Escape') close();
        };

        overlay.querySelector('#tmFetchRequiredOK')
            .addEventListener('click', close);

        document.addEventListener('keydown', escape);
    }

    function buildPortalUrl(selectedDrugs) {
        const cardNumber = getCardNumber();
        const prescriptionNumber = getPrescriptionNumber();
        const cycle = getCycle();
        const payor = getPayor();
        const employer = getEmployer();
        const company = getCompany();

        if (!company) {
            throw new Error(
                'Unsupported Company\nPayor: ' + payor + '\nCorporate: ' + employer
            );
        }

        if (!cardNumber) throw new Error('Card Number Not Found');
        if (!prescriptionNumber) throw new Error('Prescription Number Not Found');
        if (!cycle) throw new Error('Cycle Not Found');
        if (!Array.isArray(selectedDrugs) || !selectedDrugs.length) {
            throw new Error('No Split Drugs Selected');
        }

        const splitData = selectedDrugs.map((drug, index) => ({
            name: drug.name,
            hzb: String(drug.hzb),
            odooIndex: drug.odooIndex,
            selectedIndex: index
        }));
        const params = new URLSearchParams();

        params.set('tm', 'split');
        params.set('company', company);
        params.set('card', cardNumber);
        params.set('fn', prescriptionNumber);
        params.set('cycle', cycle);
        params.set('payor', payor);
        params.set('employer', employer);
        params.set('splitCount', String(selectedDrugs.length));
        params.set('split', JSON.stringify(splitData));

        return CONFIG.PORTAL_URL + '?' + params.toString();
    }

    function openPortal(popup, url) {
        if (!popup || popup.closed) {
            throw new Error('The Portal tab was closed before it could be opened.');
        }

        popup.location.replace(url);
    }

    async function startSplitFlow() {
        document.getElementById(CONFIG.DIALOG_ID)?.remove();

        const splitting = getAcceptsSplitting();

        if (splitting === 'no') {
            showNotSupportedModal();
            return;
        }

        if (fetchRunning || lifecycle.busy || lifecycle.destroyed) return;

        fetchRunning = true;
        lifecycle.busy = true;

        try {
            const drugs = await fetchSplitDrugs();
            showDrugSelector(drugs);
        } catch (error) {
            stopDOMCleanup();

            showFetchRequiredModal(
                error?.message || 'Could not fetch missing drugs.'
            );
        } finally {
            fetchRunning = false;
            lifecycle.busy = false;
        }
    }

    function createSplitButton() {
        if (document.getElementById(CONFIG.BUTTON_ID)) return;

        const container = [
            ...document.querySelectorAll('.oe_button_box')
        ].find(isVisible);

        if (!container) return;

        const button = document.createElement('button');

        button.id = CONFIG.BUTTON_ID;
        button.type = 'button';
        button.className = 'btn oe_stat_button';
        button.title = 'Fetch Split Drugs';

        button.innerHTML = `
<i class="fa fa-fw fa-exchange o_button_icon"></i>
<div class="o_stat_info">
    <span class="o_stat_text">Split</span>
</div>`;

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            if (button.dataset.loading === '1') return;

            button.dataset.loading = '1';
            button.disabled = true;

            startSplitFlow().finally(() => {
                button.dataset.loading = '0';
                button.disabled = false;
            });
        });

        const confirmationButtons = container.querySelector(
            '#tm-confirmation-buttons'
        );

        if (confirmationButtons) {
            container.insertBefore(
                button,
                confirmationButtons.nextSibling
            );
        } else {
            container.prepend(button);
        }
    }

    function isHelpdeskTicket() {
        return location.href.includes('model=helpdesk.ticket');
    }

    function init() {
        if (lifecycle.destroyed || lifecycle.busy || !isHelpdeskTicket()) return;
        createSplitButton();
    }

    observer = new MutationObserver(() => {
        if (!document.getElementById(CONFIG.BUTTON_ID)) {
            init();
        }
    });

    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    const scheduleInit=()=>{
        for(const timer of initTimers)clearTimeout(timer);
        initTimers.clear();
        for(const delay of [500,1500,3000,5000]){
            const timer=setTimeout(()=>{initTimers.delete(timer);if(!lifecycle.destroyed&&!lifecycle.busy)init();},delay);
            initTimers.add(timer);
        }
    };
    const instance={
        id:TOOL_ID,
        path:'TOOLS/split-alt-1.js',
        suspend(){
            if(lifecycle.busy||fetchRunning||lifecycle.destroyed)return false;
            observer?.disconnect();
            for(const timer of initTimers)clearTimeout(timer);
            initTimers.clear();
            stopDOMCleanup();
            for(const handler of keyHandlers)document.removeEventListener('keydown',handler);
            keyHandlers.clear();
            document.getElementById(CONFIG.BUTTON_ID)?.remove();
            document.getElementById(CONFIG.DIALOG_ID)?.remove();
            document.getElementById(CONFIG.FETCH_REQUIRED_ID)?.remove();
            document.getElementById(CONFIG.NOT_SUPPORTED_ID)?.remove();
            return true;
        },
        resume(){
            if(lifecycle.destroyed)return false;
            if(observer&&document.body)observer.observe(document.body,{childList:true,subtree:true});
            init();
            scheduleInit();
            return true;
        },
        destroy(){
            if(lifecycle.destroyed)return true;
            if(lifecycle.busy||fetchRunning)return false;
            lifecycle.destroyed=true;
            observer?.disconnect();
            observer=null;
            for(const timer of initTimers)clearTimeout(timer);
            initTimers.clear();
            stopDOMCleanup();
            for(const handler of keyHandlers)document.removeEventListener('keydown',handler);
            keyHandlers.clear();
            for(const cleanup of lifecycle.cleanups){try{cleanup();}catch{}}
            lifecycle.cleanups.clear();
            document.getElementById(CONFIG.BUTTON_ID)?.remove();
            document.getElementById(CONFIG.DIALOG_ID)?.remove();
            document.getElementById(CONFIG.FETCH_REQUIRED_ID)?.remove();
            document.getElementById(CONFIG.NOT_SUPPORTED_ID)?.remove();
            document.getElementById('tmSplitDialogCSS')?.remove();
            if(registry[TOOL_ID]===instance)delete registry[TOOL_ID];
            return true;
        }
    };
    registry[TOOL_ID]=instance;
    scheduleInit();
})();

(async function(){
    "use strict";

    const lifecycle=window.__YD_SPLIT_ALT_1_LIFECYCLE__;
    if(!lifecycle||lifecycle.destroyed)return;

    const accounts={
        nextcare:{username:"h.salama_Nextcare",password:""},
        metlife:{username:"h.salama_MetLife",password:""}
    };

    const params=new URLSearchParams(location.search);

    if(params.get("tm")!=="split")return;

    const company=(params.get("company")||"").trim().toLowerCase();
    const card=(params.get("card")||"").trim();
    const prescriptionKey=(params.get("fn")||"").trim();

    const cycle=(params.get("cycle")||"")
    .replace(/\+/g," ")
    .replace(/\s+/g," ")
    .trim();

    const payor=(params.get("payor")||"").trim();
    const employer=(params.get("employer")||"").trim();

    const expectedSplitCount=
          Number.parseInt(
              params.get("splitCount")||"0",
              10
          );

    let splitDrugs=[];

    try{
        const raw=params.get("split")||"";
        splitDrugs=raw?JSON.parse(raw):[];
    }catch{
        return alert("Invalid Split Data");
    }

    if(!Array.isArray(splitDrugs)||!splitDrugs.length){
        return alert("No Split Drugs Found");
    }

    if(
        !Number.isInteger(expectedSplitCount)||
        expectedSplitCount<=0
    ){
        return alert(
            "Invalid Split Count\n\n"+
            "Odoo did not send a valid number of selected drugs."
        );
    }

    if(expectedSplitCount!==splitDrugs.length){
        return alert(
            "Split Count Mismatch\n\n"+
            `Odoo Selected: ${expectedSplitCount}\n`+
            `Split Data: ${splitDrugs.length}`
        );
    }

    const account=accounts[company];

    if(!account)return alert(`Unsupported Company:\n${company}`);
    account.password=prompt("Enter Portal password for "+account.username);
    if(!account.password)return alert("Portal password is required.");
    if(!card)return alert("Card Number Missing");
    if(!prescriptionKey)return alert("Prescription Number / FN Missing");
    if(!cycle)return alert("Cycle Missing\n\nPlease make sure Odoo sends the Cycle.");

    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

    const visible=selector=>
    [...document.querySelectorAll(selector)]
    .filter(el=>el.offsetParent!==null);

    const prescriptionResponses=[];

    function extractPrescriptionDetails(payload){
        const data=payload?.data?.GetPrescriptionDetails;

        if(
            !data||
            !Array.isArray(data.Medications)
        ){
            return null;
        }

        return data;
    }

    function registerPrescriptionDetails(details){
        if(!details)return;

        const existing=prescriptionResponses.find(
            item=>item.id===details.id
        );

        if(existing){
            existing.details=details;
        }else{
            prescriptionResponses.push({
                id:details.id,
                details
            });
        }
    }

    function inspectGraphQLPayload(payload){
        const details=extractPrescriptionDetails(payload);

        if(details){
            registerPrescriptionDetails(details);
        }
    }

    function installFetchInterceptor(){
        if(window.__tmAutoSplitFetchInstalled)return;

        window.__tmAutoSplitFetchInstalled=true;

        const originalFetch=window.fetch;

        const wrappedFetch=async function(...args){
            const response=await originalFetch.apply(
                this,
                args
            );

            try{
                const request=args[0];

                const url=
                      typeof request==="string"
                ?request
                :request?.url||"";

                if(
                    url.includes(
                        "chronicapi.yodawy.com/graphql"
                    )
                ){
                    const clone=response.clone();

                    clone.json()
                        .then(inspectGraphQLPayload)
                        .catch(()=>{});
                }
            }catch{}

            return response;
        };
        window.fetch=wrappedFetch;
        lifecycle.cleanups.add(()=>{
            if(window.fetch===wrappedFetch)window.fetch=originalFetch;
            delete window.__tmAutoSplitFetchInstalled;
        });
    }

    function installXHRInterceptor(){
        if(window.__tmAutoSplitXHRInstalled)return;

        window.__tmAutoSplitXHRInstalled=true;

        const originalOpen=
              XMLHttpRequest.prototype.open;

        const originalSend=
              XMLHttpRequest.prototype.send;

        const wrappedOpen=function(
        method,
         url,
         ...rest
        ){
            this.__tmGraphQLUrl=
                String(url||"");

            return originalOpen.call(
                this,
                method,
                url,
                ...rest
            );
        };

        const wrappedSend=function(body){
            if(
                this.__tmGraphQLUrl?.includes(
                    "chronicapi.yodawy.com/graphql"
                )
            ){
                this.addEventListener(
                    "load",
                    ()=>{
                        try{
                            const payload=
                                  JSON.parse(
                                      this.responseText
                                  );

                            inspectGraphQLPayload(
                                payload
                            );
                        }catch{}
                    }
                );
            }

            return originalSend.call(
                this,
                body
            );
        };
        XMLHttpRequest.prototype.open=wrappedOpen;
        XMLHttpRequest.prototype.send=wrappedSend;
        lifecycle.cleanups.add(()=>{
            if(XMLHttpRequest.prototype.open===wrappedOpen)XMLHttpRequest.prototype.open=originalOpen;
            if(XMLHttpRequest.prototype.send===wrappedSend)XMLHttpRequest.prototype.send=originalSend;
            delete window.__tmAutoSplitXHRInstalled;
        });
    }

    installFetchInterceptor();
    installXHRInterceptor();

    async function waitForElement(
    find,
     timeout=30000,
     interval=200
    ){
        const start=Date.now();

        while(Date.now()-start<timeout){
            try{
                const el=find();

                if(el)return el;
            }catch{}

            await sleep(interval);
        }

        throw new Error("Element Not Found");
    }

    async function waitForCondition(
    condition,
     timeout=30000,
     interval=200
    ){
        const start=Date.now();

        while(Date.now()-start<timeout){
            try{
                const result=condition();

                if(result)return result;
            }catch{}

            await sleep(interval);
        }

        return null;
    }

    function clickLikeUser(el){
        if(!el){
            throw new Error(
                "Cannot click empty element"
            );
        }

        el.dispatchEvent(
            new MouseEvent("mousedown",{
                bubbles:true,
                cancelable:true,
                view:window
            })
        );

        el.dispatchEvent(
            new MouseEvent("mouseup",{
                bubbles:true,
                cancelable:true,
                view:window
            })
        );

        el.dispatchEvent(
            new MouseEvent("click",{
                bubbles:true,
                cancelable:true,
                view:window
            })
        );
    }

    function setReactValue(input,value){
        if(!input){
            throw new Error(
                "Input not found"
            );
        }

        input.setAttribute(
            "autocomplete",
            "off"
        );

        const setter=
              Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value"
              ).set;

        setter.call(input,value);

        input.dispatchEvent(
            new Event("input",{
                bubbles:true
            })
        );

        input.dispatchEvent(
            new Event("change",{
                bubbles:true
            })
        );
    }

    async function login(){
        if(
            document.body.innerText.includes(
                "Search Member"
            )
        ){
            return;
        }

        const inputs=await waitForElement(()=>{
            const list=visible("input");

            return list.length>=2
                ?list
            :null;
        });

        setReactValue(
            inputs[0],
            account.username
        );

        setReactValue(
            inputs[1],
            account.password
        );

        const button=await waitForElement(()=>
                                          [...document.querySelectorAll("button")]
                                          .find(
            b=>
            b.innerText
            .trim()
            .toLowerCase()==="login"
        )
                                         );

        await sleep(300);

        clickLikeUser(button);

        await sleep(3000);
    }

    async function openSearchMember(){
        const span=await waitForElement(()=>
                                        [...document.querySelectorAll("span")]
                                        .find(
            el=>
            el.textContent
            .trim()==="Search Member"
        )
                                       );

        const button=span.closest("button");

        if(!button){
            throw new Error(
                "Search Member button not found"
            );
        }

        clickLikeUser(button);

        await sleep(700);
    }

    async function fillCardNumber(){
        const input=await waitForElement(()=>{
            const inputs=
                  visible("input[type='text']");

            return inputs.length>=7
                ?inputs[6]
            :null;
        });

        setReactValue(
            input,
            card
        );

        await sleep(300);
    }

    async function clickProceed(){
        const span=await waitForElement(()=>
                                        [...document.querySelectorAll("span")]
                                        .find(
            el=>
            el.textContent
            .trim()==="Proceed"
        )
                                       );

        const button=span.closest("button");

        if(!button){
            throw new Error(
                "Proceed button not found"
            );
        }

        clickLikeUser(button);

        await sleep(2500);
    }

    async function getPrescriptionTable(){
        return waitForElement(()=>
                              [...document.querySelectorAll("table")]
                              .find(
            table=>
            table.innerText.includes("Date")&&
            table.innerText.includes("Expire")&&
            table.innerText.includes("Status")&&
            table.querySelector(
                "tbody tr"
            )
        )
                             );
    }

    async function getCurrentPortalFormNumber(){
        return waitForElement(()=>{
            const label=[
                ...document.querySelectorAll("label")
            ].find(
                el=>
                el.textContent.trim()==="Form Number"
            );

            if(!label?.parentElement)return null;

            const value=[
                ...label.parentElement.querySelectorAll(
                    "label"
                )
            ].find(
                el=>
                el!==label&&
                el.textContent.trim()
            );

            return value?.textContent.trim()||null;
        },15000);
    }

    function findCachedPrescriptionByNumber(){
        const target=String(
            prescriptionKey
        )
        .trim()
        .toLowerCase();

        for(const item of prescriptionResponses){
            const details=item.details;

            const candidates=[
                details?.PrescriptionNumber,
                details?.PrescriptionSerial,
                details?.FHIRReference
            ]
            .filter(Boolean)
            .map(
                value=>
                String(value)
                .trim()
                .toLowerCase()
            );

            if(candidates.includes(target)){
                return details;
            }
        }

        return null;
    }

    async function selectCorrectPrescription(){
        const target=prescriptionKey
        .trim()
        .toLowerCase();

        const table=
              await getPrescriptionTable();

        const rows=[
            ...table.querySelectorAll(
                "tbody > tr"
            )
        ];

        if(!rows.length){
            throw new Error(
                "No prescriptions found"
            );
        }

        for(const row of rows){
            const beforeIds=
                  new Set(
                      prescriptionResponses.map(
                          item=>item.id
                      )
                  );

            row.click();

            await sleep(500);

            let current="";

            try{
                current=(
                    await getCurrentPortalFormNumber()
                ).toLowerCase();
            }catch{}

            const response=
                  await waitForCondition(()=>{
                      const cached=
                            findCachedPrescriptionByNumber();

                      if(cached)return cached;

                      const newResponse=
                            prescriptionResponses.find(
                                item=>
                                !beforeIds.has(item.id)
                            );

                      return newResponse?.details||null;
                  },5000,100);

            if(response){
                const responseNumber=
                      String(
                          response.PrescriptionNumber||""
                      )
                .trim()
                .toLowerCase();

                if(
                    responseNumber===target||
                    current===target
                ){
                    return response;
                }
            }

            if(current===target){
                const cached=
                      findCachedPrescriptionByNumber();

                if(cached){
                    return cached;
                }
            }
        }

        throw new Error(
            `Correct prescription was not found.\n\nTarget Form Number: ${prescriptionKey}`
        );
    }

    function isSplitPageOpened(){
        const text=
              document.body.innerText||"";

        return(
            text.includes("Expiry Date")||
            text.includes("Max Amount")||
            text.includes(
                "Directly Sync Prescription After Splitting"
            )||
            [...document.querySelectorAll("label")]
            .some(
                l=>
                l.textContent
                .trim()
                .toLowerCase()==="expiry date"
            )||
            (
                document.querySelectorAll(
                    'input[type="checkbox"]'
                ).length&&
                text.toLowerCase().includes(
                    "split"
                )
            )
        );
    }

    async function clickSplitPrescription(){
        const button=await waitForElement(()=>{
            const span=[
                ...document.querySelectorAll("span")
            ].find(
                el=>
                el.textContent
                .replace(/\s+/g," ")
                .trim()
                .toLowerCase()==="split prescription"
            );

            const button=
                  span?.closest("button");

            if(!button)return null;

            const rect=
                  button.getBoundingClientRect();

            return rect.width&&
                rect.height&&
                !button.disabled
                ?button
            :null;
        });

        button.scrollIntoView({
            behavior:"auto",
            block:"center",
            inline:"center"
        });

        button.focus();

        HTMLButtonElement.prototype.click.call(
            button
        );

        await sleep(1000);

        if(isSplitPageOpened())return;

        const rect=
              button.getBoundingClientRect();

        const options={
            bubbles:true,
            cancelable:true,
            composed:true,
            view:window,
            button:0,
            buttons:1,
            clientX:
            rect.left+
            rect.width/2,
            clientY:
            rect.top+
            rect.height/2
        };

        for(
            const type of[
                "pointerdown",
                "mousedown",
                "pointerup",
                "mouseup",
                "click"
            ]
        ){
            const event=
                  type.startsWith("pointer")
            ?new PointerEvent(
                type,
                options
            )
            :new MouseEvent(
                type,
                options
            );

            button.dispatchEvent(event);

            await sleep(80);
        }

        await sleep(1200);

        if(isSplitPageOpened())return;

        button.click();

        await sleep(1500);

        if(!isSplitPageOpened()){
            throw new Error(
                "Split Prescription button was found but clicking it did not open Split screen"
            );
        }
    }

    function getSplitTable(){
        const tables=[
            ...document.querySelectorAll("table")
        ];

        const candidates=tables.filter(
            table=>
            table.querySelector(
                'tbody tr input[type="checkbox"]'
            )
        );

        if(!candidates.length){
            return null;
        }

        candidates.sort(
            (a,b)=>
            b.querySelectorAll(
                "tbody tr"
            ).length-
            a.querySelectorAll(
                "tbody tr"
            ).length
        );

        return candidates[0];
    }

    function getSplitRows(){
        const table=getSplitTable();

        if(!table)return[];

        return[
            ...table.querySelectorAll(
                "tbody > tr"
            )
        ].filter(
            row=>
            row.querySelector(
                'input[type="checkbox"]'
            )
        );
    }

    function getSelectedSplitRows(rows){
        return rows.filter(
            row=>
            row.querySelector(
                'input[type="checkbox"]'
            )?.checked
        );
    }

    function findMedicationByHZB(
    hzb,
     medications
    ){
        const target=
              String(hzb||"").trim();

        if(!target){
            return{
                valid:false,
                matches:[]
            };
        }

        const matches=[];

        medications.forEach(
            (med,index)=>{
                const medicationHZB=
                      med?.Drug_Dosage_Form_Id;

                if(
                    medicationHZB!==undefined&&
                    medicationHZB!==null&&
                    String(medicationHZB).trim()===target
                ){
                    matches.push({
                        medication:med,
                        index
                    });
                }
            }
        );

        if(matches.length!==1){
            return{
                valid:false,
                matches
            };
        }

        return{
            valid:true,
            ...matches[0]
        };
    }

    async function validatePopupOrder(
    medications,
     rows
    ){
        if(!medications.length){
            throw new Error(
                "Prescription contains no medications"
            );
        }

        if(!rows.length){
            throw new Error(
                "Split Popup contains no medication rows"
            );
        }

        if(
            medications.length!==rows.length
        ){
            throw new Error(
                `Medication / Popup order mismatch.\n\n`+
                `Prescription medications: ${medications.length}\n`+
                `Split popup rows: ${rows.length}`
            );
        }

        return true;
    }

    function validateSelectedCount(rows){
        const selectedRows=
              getSelectedSplitRows(rows);

        const actualCount=
              selectedRows.length;

        if(actualCount!==expectedSplitCount){
            throw new Error(
                `Split Selection Count Mismatch.\n\n`+
                `Odoo Selected: ${expectedSplitCount}\n`+
                `Portal Selected: ${actualCount}\n\n`+
                `The Split process was stopped to prevent an incorrect split.`
            );
        }

        if(actualCount!==splitDrugs.length){
            throw new Error(
                `Split Data / Portal Selection Mismatch.\n\n`+
                `Split Data: ${splitDrugs.length}\n`+
                `Portal Selected: ${actualCount}\n\n`+
                `The Split process was stopped.`
            );
        }

        return actualCount;
    }

    async function selectSplitDrugs(
    prescriptionDetails
    ){
        const medications=
              prescriptionDetails?.Medications;

        if(!Array.isArray(medications)){
            throw new Error(
                "GetPrescriptionDetails did not contain Medications"
            );
        }

        const rows=await waitForElement(()=>{
            const result=getSplitRows();

            return result.length
                ?result
            :null;
        },15000,100);

        await validatePopupOrder(
            medications,
            rows
        );

        const selectedIndexes=
              new Set();

        for(const drug of splitDrugs){
            if(
                drug?.hzb===undefined||
                drug?.hzb===null||
                !String(drug.hzb).trim()
            ){
                throw new Error(
                    `Missing HZB for Odoo drug:\n${drug?.name||"Unknown"}`
                );
            }

            const result=
                  findMedicationByHZB(
                      drug.hzb,
                      medications
                  );

            if(!result?.valid){
                const count=
                      result?.matches?.length||0;

                throw new Error(
                    `HZB not uniquely found in Portal.\n\n`+
                    `Odoo Drug: ${drug.name||"Unknown"}\n`+
                    `HZB: ${drug.hzb}\n`+
                    `Matches: ${count}`
                );
            }

            const medicationIndex=
                  result.index;

            if(
                selectedIndexes.has(
                    medicationIndex
                )
            ){
                throw new Error(
                    `Duplicate Portal medication index detected.\n\n`+
                    `HZB: ${drug.hzb}\n`+
                    `Index: ${medicationIndex+1}`
                );
            }

            const row=
                  rows[medicationIndex];

            if(!row){
                throw new Error(
                    `Popup row not found for medication index ${medicationIndex+1}`
                );
            }

            const checkbox=
                  row.querySelector(
                      'input[type="checkbox"]'
                  );

            if(!checkbox){
                throw new Error(
                    `Checkbox not found for medication index ${medicationIndex+1}`
                );
            }

            if(!checkbox.checked){
                clickLikeUser(checkbox);

                await sleep(100);
            }

            selectedIndexes.add(
                medicationIndex
            );
        }

        if(
            selectedIndexes.size!==expectedSplitCount
        ){
            throw new Error(
                `Odoo / Portal Selection Count Mismatch.\n\n`+
                `Odoo Selected: ${expectedSplitCount}\n`+
                `Portal Intended Selection: ${selectedIndexes.size}`
            );
            }

        await sleep(300);

        validateSelectedCount(rows);
    }

    function parseCycle(value){
        const match=String(value||"")
        .trim()
        .match(
            /^([A-Za-z]+)\s+(\d{4})$/
        );

        if(!match){
            throw new Error(
                `Invalid Cycle Format: ${value}`
            );
        }

        const monthMap={
            january:0,
            february:1,
            march:2,
            april:3,
            may:4,
            june:5,
            july:6,
            august:7,
            september:8,
            october:9,
            november:10,
            december:11
        };

        const month=
              monthMap[
                  match[1].toLowerCase()
              ];

        if(month===undefined){
            throw new Error(
                `Invalid Cycle Month: ${match[1]}`
            );
        }

        return{
            month,
            year:Number(match[2])
        };
    }

    async function fillSplitData(){
        const{month,year}=
              parseCycle(cycle);

        const expiry = new Date(year, month, 22);
        const display = `22 ${expiry.toLocaleString("en-US", { month: "short" })} ${String(expiry.getFullYear()).slice(-2)}`;

        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")]
                                         .find(
            l=>
            l.textContent
            .trim()
            .toLowerCase()==="expiry date"
        )
                                        );

        let input=
            label.parentElement
        ?.querySelector(
            'input[type="text"]'
        );

        if(!input){
            input=
                label.closest("div")
                ?.querySelector(
                'input[type="text"]'
            );
        }

        if(!input){
            input=[
                ...document.querySelectorAll(
                    'input[type="text"]'
                )
            ].find(
                el=>
                /expiry\sdate/i.test(
                    el.parentElement
                    ?.parentElement
                    ?.parentElement
                    ?.innerText||""
                )
            );
        }

        if(!input){
            throw new Error(
                "Expiry Date input not found"
            );
        }

        const setter=
              Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value"
              )?.set;

        if(!setter){
            throw new Error(
                "Native input value setter not found"
            );
        }

        const update=value=>{
            setter.call(input,value);

            input.dispatchEvent(
                new Event("input",{
                    bubbles:true
                })
            );

            input.dispatchEvent(
                new Event("change",{
                    bubbles:true
                })
            );
        };

        input.focus();

        update("");

        await sleep(100);

        update(display);

        input.dispatchEvent(
            new KeyboardEvent(
                "keydown",
                {
                    bubbles:true,
                    key:"Enter",
                    code:"Enter",
                    keyCode:13,
                    which:13
                }
            )
        );

        input.blur();

        await sleep(500);

        if(
            input.value
            .trim()
            .toLowerCase()!==display.toLowerCase()
        ){
            input.focus();

            update(display);

            input.blur();

            await sleep(400);
        }

        if(
            input.value
            .trim()
            .toLowerCase()!==display.toLowerCase()
        ){
            throw new Error(
                `Expiry Date could not be changed.\n\nExpected: ${display}\nCurrent: ${input.value}`
            );
        }
    }

    function generateSerial(){
        const letters=
              "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

        let serial="";

        for(let i=0;i<4;i++){
            serial+=letters[
                Math.floor(
                    Math.random()*
                    letters.length
                )
            ];
        }

        for(let i=0;i<4;i++){
            serial+=Math.floor(
                Math.random()*10
            );
        }

        return serial;
    }

    async function fillSerial(){
        const input=await waitForElement(()=>{
            const labels=[
                ...document.querySelectorAll("label")
            ].filter(
                l=>
                l.textContent.trim()==="Serial"
            );

            return labels[1]
                ?.parentElement
                ?.querySelector("input");
        });

        setReactValue(
            input,
            generateSerial()
        );
    }

    async function fillMaxAmount(){
        const input=await waitForElement(()=>{
            const labels=[
                ...document.querySelectorAll("label")
            ].filter(
                l=>
                l.textContent.trim()==="Max Amount"
            );

            return labels[1]
                ?.parentElement
                ?.querySelector("input");
        });

        setReactValue(
            input,
            "00"
        );
    }

    async function enableDirectSync(){
        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")]
                                         .find(
            l=>
            l.textContent
            .trim()==="Directly Sync Prescription After Splitting"
        )
                                        );

        const checkbox=
              label.parentElement
        ?.parentElement
        ?.querySelector(
            'input[type="checkbox"]'
        );

        if(!checkbox){
            throw new Error(
                "Direct Sync checkbox not found"
            );
        }

        if(!checkbox.checked){
            clickLikeUser(checkbox);
        }

        await sleep(300);
    }

    async function selectDropdown(
    labelText,
     itemText,
     errorText
    ){
        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")]
                                         .find(
            l=>
            l.textContent.trim()===
            labelText
        )
                                        );

        const button=
              label.nextElementSibling
        ?.querySelector("button");

        if(!button){
            throw new Error(
                `${errorText} dropdown not found`
            );
        }

        clickLikeUser(button);

        const item=await waitForElement(()=>
                                        [...document.querySelectorAll(
                                            'span[role="menuitem"]'
                                        )].find(
            el=>
            el.textContent
            .trim()
            .toLowerCase()===
            itemText.toLowerCase()
        )
                                       );

        clickLikeUser(item);

        await sleep(300);
    }

    async function addSplitTag(){
        const input=await waitForElement(()=>
                                         [...document.querySelectorAll("input")]
                                         .find(
            el=>
            el.id?.includes("Tags")
        )
                                        );

        const key=Object.keys(input).find(
            k=>
            k.startsWith(
                "__reactInternalInstance"
            )
        );

        const props=
              input[key]
        ?._currentElement
        ?.props;

        if(!props){
            throw new Error(
                "Tags React props not found"
            );
        }

        props.onChange({
            target:{
                value:"SPLIT"
            }
        });

        props.onKeyUp({
            key:"Enter",
            keyCode:13,
            which:13,
            target:{
                value:"SPLIT"
            },
            preventDefault(){},
            stopPropagation(){}
        });

        await sleep(300);
    }

    async function main(){
        await login();

        await openSearchMember();

        await fillCardNumber();

        await clickProceed();

        const prescriptionDetails=
              await selectCorrectPrescription();

        if(
            !prescriptionDetails||
            !Array.isArray(
                prescriptionDetails.Medications
            )
        ){
            throw new Error(
                "Correct prescription was found but GetPrescriptionDetails data is missing"
            );
        }

        await clickSplitPrescription();

        await selectSplitDrugs(
            prescriptionDetails
        );

        await fillSplitData();

        await fillSerial();

        await fillMaxAmount();

        await enableDirectSync();

        if(company==="metlife"){
            await selectDropdown(
                "Odoo Payer",
                "MetLife",
                "Odoo Payer"
            );

            await selectDropdown(
                "Odoo Corporate",
                "The United Bank",
                "Odoo Corporate"
            );
        }else{
            await selectDropdown(
                "Odoo Payer",
                "Next Care",
                "Odoo Payer"
            );

            await selectDropdown(
                "Odoo Corporate",
                "Alex Bank",
                "Odoo Corporate"
            );
        }

        await selectDropdown(
            "Odoo Cycle",
            cycle,
            "Odoo Cycle"
        );

        await addSplitTag();
    }

    lifecycle.busy=true;
    main().catch(
        error=>alert(`Split Automation Failed\n\n${error.message}`)
    ).finally(()=>{lifecycle.busy=false;});

})();
