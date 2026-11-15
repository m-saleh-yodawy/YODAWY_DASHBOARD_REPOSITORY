// ==UserScript==
// @name         Odoo Split Selector
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(async function () {
    'use strict';

    const CONFIG = {
        DIALOG_ID: 'tmSplitDrugDialog',
        FETCH_REQUIRED_ID: 'tmFetchRequiredDialog',
        NOT_SUPPORTED_ID: 'tmNotSupportedDialog',
        BUTTON_ID: 'tmLetsSplit',
        PORTAL_URL: 'https://portal.yodawy.com/'
    };

    let fetchRunning = false;

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
            return 0;
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

            if (drug && !drugs.some(item => item.hzb === drug.hzb)) {
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

    async function getFetchMessages(ticketId, baseline) {
        const domain = [['model', '=', 'helpdesk.ticket'], ['res_id', '=', ticketId]];
        if (baseline && Number.isSafeInteger(baseline.id)) domain.push(['id', '>', baseline.id]);
        if (baseline?.partnerId) domain.push(['author_id', '=', baseline.partnerId]);
        return rpc('mail.message', 'search_read', [domain], { fields: ['id', 'body', 'date', 'author_id'], order: 'id asc', limit: 50, context: getSessionContext() });
    }

    async function getMessageBaseline(ticketId) {
        const partnerId = Number(odoo?.session_info?.partner_id || 0);
        if (!partnerId) return null;
        const messages = await getFetchMessages(ticketId);
        return { id: Math.max(0, ...messages.map(message => Number(message.id) || 0)), partnerId };
    }

    function isFetchTable(body) {
        return /<table[\s>]/i.test(String(body || '')) && !/No items need to check/i.test(String(body || ''));
    }

    function isFetchPayload(body, ticketId) {
        const text = normalizeText(String(body || '').replace(/<[^>]*>/g, ' ')).toLowerCase();
        return text.includes(`ticket:${ticketId}`) && ['payer', 'corporate', 'identifier', 'drugs'].every(key => text.includes(`'${key}'`) || text.includes(`"${key}"`));
    }

    async function cleanupFetchMessages(ticketId, baseline) {
        if (!baseline?.partnerId || !Number.isSafeInteger(baseline.id)) return false;
        const messages = await getFetchMessages(ticketId, baseline);
        const tables = messages.filter(message => isFetchTable(message.body));
        const payloads = messages.filter(message => isFetchPayload(message.body, ticketId));
        if (messages.length !== 2 || tables.length !== 1 || payloads.length !== 1) return false;
        const table = tables[0], payload = payloads[0];
        const drugIds = [...String(payload.body || '').matchAll(/['"]id['"]\s*:\s*(\d+)/g)].map(match => match[1]);
        const tableText = String(table.body || '').replace(/<[^>]*>/g, ' ');
        if (!drugIds.length || !drugIds.some(id => new RegExp(`(?:^|\D)${id}(?:\D|$)`).test(tableText))) return false;
        const ids = [Number(table.id), Number(payload.id)];
        if (ids.some(id => !Number.isSafeInteger(id) || id <= baseline.id)) return false;
        const result = await rpc('mail.message', 'unlink', [ids], { context: getSessionContext() });
        return result === true;
    }

    function startDOMCleanup() {}
    function stopDOMCleanup() {}
    function scanFetchMessagesInDOM() {}
    function cleanupFetchMessagesFast() {}

    async function fetchSplitDrugs() {
        const ticketId = getTicketId();
        if (!ticketId) throw new Error('Ticket ID Not Found');
        const baseline = await getMessageBaseline(ticketId);
        if (!baseline) throw new Error('Could not establish Fetch message baseline');
        const action = await callButtonFetch(ticketId);
        const wizardId = Number(action?.res_id || 0);
        if (!wizardId) throw new Error('Fetch did not return a wizard');
        const wizard = await readWizard(wizardId);
        let drugs = parseFetchedDrugs(wizard.non_selected_drugs);
        if (!drugs.length && Array.isArray(wizard.alternative_lines_ids) && wizard.alternative_lines_ids.length) {
            const lines = await readWizardLines(wizard.alternative_lines_ids);
            for (const line of lines) {
                if (!line?.is_header) continue;
                const drug = extractDrug(line.limited_drug);
                if (drug && !drugs.some(item => item.hzb === drug.hzb)) drugs.push({ ...drug, odooIndex: drugs.length });
            }
        }
        if (!drugs.length) throw new Error('No missing drugs were returned by FETCH');
        await cleanupFetchMessages(ticketId, baseline);
        return drugs;
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
            document.removeEventListener('keydown', keyboardHandler);
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

        document.addEventListener('keydown', keyboardHandler);

        splitButton.addEventListener('click', async () => {
            const selected = checkboxes
                .filter(checkbox => checkbox.checked)
                .map(checkbox => drugs[Number(checkbox.dataset.index)]);

            if (!selected.length) return;

            splitButton.disabled = true;
            splitButton.textContent = 'WRITING LOG...';

            try {
                await createSplitLogNote(selected);

                splitButton.textContent = 'OPENING PORTAL...';

                await openPortal(selected);

                closeDialog();
            } catch (error) {
                alert(
                    'Could not complete Split\n\n' +
                    error.message
                );

                splitButton.disabled = false;
                splitButton.textContent = 'SPLIT';
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
            document.removeEventListener('keydown', escape);
        };

        const escape = event => {
            if (event.key === 'Escape') close();
        };

        overlay.querySelector('#tmSupportOK')
            .addEventListener('click', close);

        document.addEventListener('keydown', escape);
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

    async function openPortal(selectedDrugs) {
        const cardNumber = getCardNumber();
        const prescriptionNumber = getPrescriptionNumber();
        const cycle = getCycle();
        const payor = getPayor();
        const employer = getEmployer();
        const company = getCompany();

        if (!company) {
            throw new Error(
                `Unsupported Company\nPayor: ${payor}\nCorporate: ${employer}`
            );
        }

        if (!cardNumber) throw new Error('Card Number Not Found');
        if (!prescriptionNumber) {
            throw new Error('Prescription Number Not Found');
        }
        if (!cycle) throw new Error('Cycle Not Found');
        if (!selectedDrugs.length) {
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

        const popup = window.open(
            `${CONFIG.PORTAL_URL}?${params.toString()}`,
            '_blank'
        );

        if (!popup) {
            throw new Error(
                'Browser blocked the Portal popup. Please allow popups for Odoo.'
            );
        }
    }

    async function startSplitFlow() {
        document.getElementById(CONFIG.DIALOG_ID)?.remove();

        const splitting = getAcceptsSplitting();

        if (splitting === 'no') {
            showNotSupportedModal();
            return;
        }

        if (fetchRunning) return;

        fetchRunning = true;

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
<i class="yd-custom-icon fa fa-fw fa-exchange o_button_icon"></i>
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
        if (!isHelpdeskTicket()) return;
        createSplitButton();
    }

    let suspended = false;
    const observer = new MutationObserver(() => {
        if (!suspended && !document.getElementById(CONFIG.BUTTON_ID)) init();
    });
    const initTimers = [500,1500,3000,5000].map(delay => setTimeout(() => { if (!suspended) init(); }, delay));
    const suspend = () => {
        suspended = true;
        initTimers.forEach(clearTimeout);
        observer.disconnect();
        document.getElementById(CONFIG.BUTTON_ID)?.remove();
        document.querySelectorAll('#tmSplitDialog,#tmSupportOverlay,#tmFetchRequiredOverlay').forEach(element => element.remove());
        return true;
    };
    const resume = () => {
        suspended = false;
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
        init();
        return true;
    };
    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    registry['ODOO-SPLIT-SELECTOR'] = { suspend, resume };

    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

})();
