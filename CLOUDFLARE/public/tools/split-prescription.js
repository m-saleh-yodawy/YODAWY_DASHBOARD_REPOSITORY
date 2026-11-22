// ==UserScript==
// @name         Split Prescription
// @namespace    https://odoo.yodawy.com/
// @version      1
// @description  Create split prescriptions directly from Odoo with exact Portal medication matching.
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(async function () {
    'use strict';

    const TOOL_ID = 'TOOL-018';
    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    if (registry[TOOL_ID] || location.hostname !== 'odoo.yodawy.com') return;
    registry[TOOL_ID] = true;

    const CONFIG = {
        API_URL: 'https://chronicapi.yodawy.com/graphql',
        BUTTON_ID: 'ydDirectSplitButton',
        DIALOG_ID: 'ydDirectSplitDialog',
        NEXTCARE: {
            payerRef: 'next_care',
            insuranceCompanyId: '5fe1dd72b67e934e07563d84',
            expiryDay: 22
        },
        METLIFE: {
            payerRef: 'metlife',
            insuranceCompanyId: '',
            expiryDay: 'last'
        }
    };

    const state = {
        busy: false,
        dialog: null,
        observer: null,
        fetchRunning: false,
        mutationAttempted: false,
        completed: false,
        ticketId: 0
    };

    const normalize = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const normalizeKey = value => normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const getText = element => normalize(element?.innerText || element?.textContent || '');
    const isVisible = element => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && element.offsetParent !== null;
    };

    function getField(name) {
        const element = document.querySelector(`[name="${name}"]`);
        return getText(element);
    }

    function getFieldRaw(name) {
        const element = document.querySelector(`[name="${name}"]`);
        if (!element) return '';
        return normalize(element.getAttribute('raw-value') || element.getAttribute('data-id') || element.getAttribute('data-value') || element.value || '');
    }

    function getTicketId() {
        const values = [
            new URLSearchParams(location.search).get('id'),
            new URLSearchParams(location.search).get('active_id'),
            new URLSearchParams(location.search).get('res_id'),
            location.hash.match(/(?:^|[?&#])id=(\d+)/)?.[1]
        ];
        for (const value of values) if (/^\d+$/.test(String(value || ''))) return Number(value);
        for (const element of document.querySelectorAll('[data-res-id], [data-oe-id], [data-id]')) {
            for (const name of ['data-res-id', 'data-oe-id', 'data-id']) {
                const value = element.getAttribute(name);
                if (/^\d+$/.test(String(value || ''))) return Number(value);
            }
        }
        return 0;
    }

    function getSessionContext() {
        const session = window.odoo?.session_info || window.odoo?.__session_info__ || {};
        const userContext = { ...(session.user_context || {}) };
        const companies = session.user_companies || session.companies || {};
        let allowedCompanyIds = userContext.allowed_company_ids;
        if (!Array.isArray(allowedCompanyIds)) {
            const current = companies.current_company || companies.current_company_id || session.company_id;
            const id = typeof current === 'object' ? current?.id : current;
            if (id) allowedCompanyIds = [Number(id)];
        }
        if (!Array.isArray(allowedCompanyIds) || !allowedCompanyIds.length) allowedCompanyIds = [2];
        return {
            ...userContext,
            lang: userContext.lang || 'en_US',
            tz: userContext.tz || 'Africa/Cairo',
            uid: userContext.uid || session.uid || 0,
            allowed_company_ids: allowedCompanyIds.map(Number).filter(Boolean)
        };
    }

    function getActionContext() {
        const base = getSessionContext();
        const team = document.querySelector('span[name="team_id"]');
        const raw = normalize(team?.getAttribute('raw-value') || team?.getAttribute('data-id') || '');
        const match = getText(team).match(/^(\d+)\s*-/);
        const teamId = Number(/^\d+$/.test(raw) ? raw : match?.[1] || 69) || 69;
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
        const response = await fetch(`/web/dataset/call_kw/${model}/${method}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'call',
                params: { model, method, args, kwargs },
                id: Date.now()
            })
        });
        if (!response.ok) throw new Error(`Odoo request failed (${response.status}).`);
        const data = await response.json();
        if (data.error) {
            const error = data.error;
            throw new Error(error?.data?.message || error?.data?.arguments?.[0] || error?.data?.name || error?.message || 'Odoo request failed.');
        }
        return data.result;
    }

    async function graphQL(query, variables = {}) {
        let response;
        try {
            response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, variables })
            });
        } catch {
            throw new Error('The Portal API could not be reached from Odoo. Check the connection or API CORS access.');
        }
        if (!response.ok) throw new Error(`Portal API request failed (${response.status}).`);
        let payload;
        try {
            payload = await response.json();
        } catch {
            throw new Error('The Portal API returned an invalid response.');
        }
        if (Array.isArray(payload.errors) && payload.errors.length) {
            throw new Error(payload.errors.map(item => item.message).filter(Boolean).join('\n') || 'Portal API rejected the request.');
        }
        if (!payload.data) throw new Error('The Portal API response did not contain data.');
        return payload.data;
    }

    function cleanDrugName(value) {
        return normalize(value).replace(/^Limited\s+(?:Drug|Item)\s*:\s*/i, '').trim();
    }

    function extractDrug(value) {
        const text = cleanDrugName(value);
        if (!text) return null;
        const match = text.match(/^(.+?),\s*([^,\n]+),\s*(\d+)\s*$/);
        if (!match) return null;
        const name = normalize(match[1]);
        const hzb = normalize(match[3]);
        if (!name || name.length > 250 || !/^\d+$/.test(hzb)) return null;
        return { name, hzb, limited: text };
    }

    function parseFetchedDrugs(value) {
        const template = document.createElement('template');
        template.innerHTML = String(value || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/li>\s*<li>/gi, '\n')
            .replace(/<li>/gi, '\n')
            .replace(/<\/li>/gi, '\n');
        const raw = (template.content.textContent || '').replace(/\u00a0/g, ' ');
        const lines = raw.split(/\r?\n/).map(normalize).filter(Boolean);
        const drugs = [];
        for (const line of lines) {
            const drug = extractDrug(line);
            if (drug && !drugs.some(item => item.hzb === drug.hzb)) drugs.push({ ...drug, odooIndex: drugs.length });
        }
        if (!drugs.length) {
            const drug = extractDrug(raw);
            if (drug) drugs.push({ ...drug, odooIndex: 0 });
        }
        return drugs;
    }

    function getLatestMessageId(ticketId) {
        return rpc('mail.message', 'search_read', [[['model', '=', 'helpdesk.ticket'], ['res_id', '=', ticketId]]], {
            fields: ['id'], order: 'id desc', limit: 1, context: getSessionContext()
        }).then(messages => Number(messages?.[0]?.id || 0)).catch(() => 0);
    }

    function isFetchMessage(body, ticketId, drugs = []) {
        const html = String(body || '');
        const normalized = normalize(html).toLowerCase();
        if (!normalized) return false;
        if (normalized.includes(`ticket:${ticketId}`.toLowerCase()) && normalized.includes('identifier') && normalized.includes('drugs') && normalized.includes('payer')) return true;
        if (!/<table[\s>]/i.test(html) || !/Limited\s+Drug\s*:/i.test(html)) return false;
        return !drugs.length || drugs.some(drug => normalize(drug.limited).toLowerCase() && normalized.includes(normalize(drug.limited).toLowerCase()));
    }

    async function removeFetchMessages(ticketId, drugs, initialMessageId) {
        try {
            await sleep(350);
            const messages = await rpc('mail.message', 'search_read', [[
                ['model', '=', 'helpdesk.ticket'],
                ['res_id', '=', ticketId],
                ...(initialMessageId ? [['id', '>', initialMessageId]] : [])
            ]], { fields: ['id', 'body'], order: 'id desc', limit: 30, context: getSessionContext() });
            const ids = (messages || []).filter(item => Number(item?.id) && isFetchMessage(item.body, ticketId, drugs)).map(item => Number(item.id));
            if (ids.length) await rpc('mail.message', 'unlink', [ids], { context: getSessionContext() });
        } catch {}
    }

    async function fetchSplitDrugs() {
        const ticketId = getTicketId();
        if (!ticketId) throw new Error('Ticket ID was not found. Open the Helpdesk ticket form and try again.');
        state.ticketId = ticketId;
        const initialMessageId = await getLatestMessageId(ticketId);
        const action = await rpc('helpdesk.ticket', 'action_fetch_suitable_alternatives', [[ticketId]], { context: getActionContext() });
        const wizardId = Number(action?.res_id || 0);
        if (!wizardId) {
            await removeFetchMessages(ticketId, [], initialMessageId);
            throw new Error('Fetch did not return an alternatives wizard.');
        }
        const result = await rpc('alternative.wizard', 'read', [[wizardId]], {
            fields: ['non_selected_drugs', 'alternative_lines_ids', 'available_lines_ids', 'display_name'],
            context: getSessionContext()
        });
        const wizard = result?.[0] || {};
        let drugs = parseFetchedDrugs(wizard.non_selected_drugs);
        if (!drugs.length && Array.isArray(wizard.alternative_lines_ids) && wizard.alternative_lines_ids.length) {
            try {
                const fields = await rpc('alternative.wizard', 'fields_get', [['alternative_lines_ids']], {
                    attributes: ['relation'], context: getSessionContext()
                });
                const model = fields?.alternative_lines_ids?.relation;
                if (model) {
                    const lines = await rpc(model, 'read', [wizard.alternative_lines_ids], {
                        fields: ['is_header', 'limited_drug', 'alternative_hzb', 'label'],
                        context: getSessionContext()
                    });
                    for (const line of lines || []) {
                        if (!line?.is_header) continue;
                        const drug = extractDrug(line.limited_drug);
                        if (drug && !drugs.some(item => item.hzb === drug.hzb)) drugs.push({ ...drug, odooIndex: drugs.length });
                    }
                }
            } catch {}
        }
        await removeFetchMessages(ticketId, drugs, initialMessageId);
        if (!drugs.length) throw new Error('Fetch completed but no valid medication/HZB pairs were returned.');
        return drugs;
    }

    function getPayerConfig() {
        const payer = getField('payor_id');
        const key = normalizeKey(payer);
        if (key.includes('nextcare')) return { ...CONFIG.NEXTCARE, name: payer, key: 'nextcare' };
        if (key.includes('metlife')) return { ...CONFIG.METLIFE, name: payer, key: 'metlife' };
        throw new Error(`Unsupported Odoo Payer: ${payer || 'not found'}.`);
    }

    async function getCycleInfo() {
        const element = document.querySelector('span[name="cycle_id"]') || document.querySelector('[name="cycle_id"]');
        let label = getText(element) || getField('cycle_id');
        let numeric = '';
        const ticketId = state.ticketId || getTicketId();
        if (ticketId) {
            try {
                const records = await rpc('helpdesk.ticket', 'read', [[ticketId]], {
                    fields: ['cycle_id'],
                    context: getSessionContext()
                });
                const cycleField = records?.[0]?.cycle_id;
                if (Array.isArray(cycleField)) {
                    numeric = String(cycleField[0] || '').match(/^\d+$/)?.[0] || '';
                    if (!label && cycleField[1]) label = normalize(cycleField[1]);
                } else {
                    numeric = String(cycleField || '').match(/^\d+$/)?.[0] || '';
                }
            } catch {}
        }
        if (!numeric) {
            const raw = normalize(element?.getAttribute('raw-value') || element?.getAttribute('data-id') || element?.getAttribute('data-value') || element?.getAttribute('data-oe-id') || '');
            numeric = raw.match(/^\d+$/)?.[0] || '';
            if (!numeric && /^\[/.test(raw)) {
                try { numeric = String(JSON.parse(raw)[0] || '').match(/^\d+$/)?.[0] || ''; } catch {}
            }
        }
        const match = label.match(/^([A-Za-z]+)\s+(\d{4})$/);
        if (!match) throw new Error(`Invalid Cycle value: ${label || 'not found'}.`);
        const monthMap = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
        const month = monthMap[match[1].toLowerCase()];
        if (month === undefined) throw new Error(`Unsupported Cycle month: ${match[1]}.`);
        if (!numeric) throw new Error('The Cycle ID was not returned by Odoo. The split was stopped to avoid sending an incorrect cycle.');
        return { label, month, year: Number(match[2]), cycleNumber: numeric };
    }

    function getApiExpiryDate(cycle, payer) {
        const lastDay = new Date(cycle.year, cycle.month + 1, 0).getDate();
        const displayDay = payer.expiryDay === 'last' ? lastDay : payer.expiryDay;
        const apiDay = displayDay - 1;
        return `${String(cycle.month + 1).padStart(2, '0')}/${String(apiDay).padStart(2, '0')}/${cycle.year}`;
    }

    function generateSerial() {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const random = new Uint32Array(8);
        crypto.getRandomValues(random);
        return Array.from(random, (value, index) => index < 4 ? letters[value % letters.length] : String(value % 10)).join('');
    }

    const CORPORATE_QUERY = `query GetOdooPayerCorporate($parent_reference: String!) {
        GetOdooPayerCorporate(parent_reference: $parent_reference) { name ref id __typename }
    }`;

    const PRESCRIPTIONS_QUERY = `query InsuranceAgencyPrescription($filter: AgencyPrescriptionsFilterInput!) {
        InsuranceAgencyPrescription(filter: $filter) {
            id PrescriptionNumber CreationDate ExpiryDate StartDate PrescriptionSerial
            Medications { Quantity IsDisposed DisposedQuantity __typename }
            DisposingMaxValue IsStoped Note CoPayment Status { id StatusName Enum ColorCode __typename }
            Source IsExpired __typename
        }
    }`;

    const PRESCRIPTION_DETAILS_QUERY = id => `query GetPrescriptionDetails {
        GetPrescriptionDetails(ePrescriptionId:"${id}") {
            id
            Medications {
                DrugId DrugName Form SubForm { id Name } Quantity IsDisposed DisposedQuantity Price DisposedBy ActiveIngred
                DrugForm { id Key Name } SubFormQuantity QuantityType SubformSoldInPart FormSoldInPart FormQuantity MainForm
                Note CombinedSentence DrugTotal IsRejected OrderId DispensePrice MRFHIRReference Drug_Dosage_Form_Id
            }
            CoPayment Note ScannedPrescriptions ApprovalNumber IssuingDate IsChronic Tags RelativeDocumentId ApprovalResponse
            DisposingMaxValue DateOfBirth BranchId BranchName DoctorName Location { coordinates } Source PrescriptionSerial
            ClaimFormType InsuranceCardNumber PatientNameEn PatientName CreationDate ExpiryDate PrescriptionNumber StartDate
            MobileNumber Status { id StatusName } FHIRReference
        }
    }`;

    const CREATE_PRESCRIPTION_MUTATION = `mutation addNewChronicPrescription($input: newPrescriptionInput!) {
        addNewChronicPrescription(input: $input) { isSuccess message __typename }
    }`;

    async function resolveCorporate(payer, employer) {
        const data = await graphQL(CORPORATE_QUERY, { parent_reference: payer.payerRef });
        const corporates = data.GetOdooPayerCorporate;
        if (!Array.isArray(corporates)) throw new Error('Portal did not return the Corporate list.');
        const key = normalizeKey(employer);
        const matches = corporates.filter(item => normalizeKey(item?.name) === key && item?.ref);
        if (matches.length !== 1) throw new Error(`Corporate could not be matched uniquely.\\nOdoo Corporate: ${employer || 'not found'}\\nMatches: ${matches.length}`);
        return matches[0];
    }

    async function resolvePrescription(payer, cardNumber, formNumber) {
        const data = await graphQL(PRESCRIPTIONS_QUERY, {
            filter: { AgencyId: payer.insuranceCompanyId, CardNumber: cardNumber, AgentType: '4' }
        });
        const prescriptions = data.InsuranceAgencyPrescription;
        if (!Array.isArray(prescriptions)) throw new Error('Portal did not return the prescription history.');
        const target = normalize(formNumber).toLowerCase();
        const matches = prescriptions.filter(item => normalize(item?.PrescriptionNumber).toLowerCase() === target);
        if (matches.length !== 1) throw new Error(`The exact Odoo Prescription Number was not found uniquely in Portal.\\nForm Number: ${formNumber}\\nMatches: ${matches.length}`);
        return matches[0];
    }

    async function prepareSplit(selectedDrugs) {
        const payer = getPayerConfig();
        if (!payer.insuranceCompanyId) throw new Error(`${payer.name} has no verified Agency ID in the supplied HAR. Use a backup engine for this payer until its mapping is captured.`);
        const cardNumber = getField('user_ref');
        const formNumber = getField('prescription_number');
        const employer = getField('insurance_agency');
        const cycle = await getCycleInfo();
        if (!cardNumber) throw new Error('Odoo Card Number is missing.');
        if (!formNumber) throw new Error('Odoo Prescription Number is missing.');
        if (!employer) throw new Error('Odoo Corporate is missing.');
        if (!selectedDrugs.length) throw new Error('Select at least one medication.');
        if (new Set(selectedDrugs.map(item => item.hzb)).size !== selectedDrugs.length) throw new Error('Duplicate HZB values were selected. The split was stopped.');

        const [corporate, prescription] = await Promise.all([
            resolveCorporate(payer, employer),
            resolvePrescription(payer, cardNumber, formNumber)
        ]);
        if (!/^[a-f\d]{24}$/i.test(String(prescription.id || ''))) throw new Error('Portal returned an invalid prescription identifier.');
        const detailsData = await graphQL(PRESCRIPTION_DETAILS_QUERY(prescription.id));
        const details = detailsData.GetPrescriptionDetails;
        if (!details || !Array.isArray(details.Medications)) throw new Error('Portal prescription details are incomplete.');
        if (details.IsChronic !== true) throw new Error('The selected Portal prescription is not marked as Chronic.');

        const medications = selectedDrugs.map(drug => {
            const matches = details.Medications.filter(item => String(item?.Drug_Dosage_Form_Id ?? '').trim() === String(drug.hzb).trim());
            if (matches.length !== 1) throw new Error(`HZB could not be matched uniquely.\\n${drug.name}\\nHZB: ${drug.hzb}\\nMatches: ${matches.length}`);
            const medication = matches[0];
            const quantity = Number(medication.Quantity);
            const quantityType = normalize(medication.QuantityType);
            if (!medication.DrugId || !Number.isFinite(quantity) || quantity <= 0 || !quantityType) throw new Error(`Portal medication data is incomplete for ${drug.name}.`);
            return { DrugId: String(medication.DrugId), Quantity: quantity, QuantityType: quantityType };
        });

        const treatDate = details.IssuingDate || details.StartDate || prescription.StartDate;
        if (!treatDate) throw new Error('The Portal prescription does not contain a treatment date.');
        const input = {
            cardNumber,
            birthDate: null,
            patientName: normalize(details.PatientName || details.PatientNameEn),
            maxAmount: '00',
            serial: generateSerial(),
            coPayment: String(details.CoPayment ?? '0'),
            expiryDate: getApiExpiryDate(cycle, payer),
            medications,
            insuranceCompanyId: payer.insuranceCompanyId,
            note: '',
            isChronic: true,
            branchId: '',
            groupId: '',
            syncToOdoo: true,
            corporateRef: corporate.ref,
            cycleNumber: cycle.cycleNumber,
            payerRef: payer.payerRef,
            treatDate,
            tags: ['SPLIT']
        };
        if (!input.patientName) throw new Error('Patient Name was not returned by Portal.');
        return { input, payer, corporate, cycle, prescription, details, selectedDrugs };
    }

    async function createLogNote(prepared) {
        const rows = prepared.selectedDrugs.map(drug => `<li>${escapeHTML(drug.name)} · HZB ${escapeHTML(drug.hzb)}</li>`).join('');
        const body = `<p><strong>Prescription Split Completed — ORIGINAL</strong></p><ul>${rows}</ul><p>Serial: ${escapeHTML(prepared.input.serial)}</p><p>Payer: ${escapeHTML(prepared.payer.name)} · Corporate: ${escapeHTML(prepared.corporate.name)} · Cycle: ${escapeHTML(prepared.cycle.label)}</p>`;
        await rpc('helpdesk.ticket', 'message_post', [[state.ticketId]], {
            body,
            message_type: 'comment',
            subtype_xmlid: 'mail.mt_note'
        });
    }

    function injectStyles() {
        if (document.getElementById('ydDirectSplitStyles')) return;
        const style = document.createElement('style');
        style.id = 'ydDirectSplitStyles';
        style.textContent = `
#${CONFIG.DIALOG_ID}{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(20,18,22,.48);font-family:inherit}
#${CONFIG.DIALOG_ID} .yds-panel{width:min(680px,96vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;background:#fff;border:1px solid #d8cbd5;border-radius:10px;box-shadow:0 18px 55px rgba(0,0,0,.28);color:#303039}
#${CONFIG.DIALOG_ID} .yds-head{padding:18px 22px;background:#875A7B;color:#fff}
#${CONFIG.DIALOG_ID} .yds-title{font-size:18px;font-weight:700}
#${CONFIG.DIALOG_ID} .yds-subtitle{margin-top:4px;font-size:12px;opacity:.9}
#${CONFIG.DIALOG_ID} .yds-meta{display:flex;flex-wrap:wrap;gap:7px;padding:12px 20px;background:#faf8fa;border-bottom:1px solid #eee7ed}
#${CONFIG.DIALOG_ID} .yds-pill{padding:5px 9px;border:1px solid #e4d9e2;border-radius:16px;background:#fff;font-size:11px;color:#68465f}
#${CONFIG.DIALOG_ID} .yds-body{padding:14px 20px;overflow:auto}
#${CONFIG.DIALOG_ID} .yds-select-all{display:flex;align-items:center;gap:9px;padding:9px 10px;margin-bottom:8px;background:#f8f5f7;border:1px solid #eee7ed;border-radius:6px;font-size:13px;font-weight:600}
#${CONFIG.DIALOG_ID} .yds-list{display:flex;flex-direction:column;gap:6px}
#${CONFIG.DIALOG_ID} .yds-drug{display:flex;align-items:center;gap:11px;padding:11px 10px;border:1px solid #e8e8e8;border-radius:6px;cursor:pointer}
#${CONFIG.DIALOG_ID} .yds-drug:hover{border-color:#b89caf;background:#fcfafc}
#${CONFIG.DIALOG_ID} .yds-drug input,#${CONFIG.DIALOG_ID} .yds-select-all input{width:16px;height:16px;accent-color:#875A7B;flex:0 0 auto}
#${CONFIG.DIALOG_ID} .yds-drug-copy{min-width:0;flex:1}
#${CONFIG.DIALOG_ID} .yds-drug-name{font-size:13px;font-weight:600;overflow-wrap:anywhere}
#${CONFIG.DIALOG_ID} .yds-drug-hzb{margin-top:3px;color:#777;font-size:11px}
#${CONFIG.DIALOG_ID} .yds-footer{padding:13px 20px;border-top:1px solid #eee7ed;background:#fafafa}
#${CONFIG.DIALOG_ID} .yds-status{display:none;margin-bottom:10px;padding:9px 11px;border-radius:6px;background:#f8f5f7;color:#68465f;font-size:12px;white-space:pre-wrap;line-height:1.5}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="error"]{display:block;background:#fff1f1;color:#a12e2e}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="success"]{display:block;background:#edf8f0;color:#236b3c}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="info"]{display:block}
#${CONFIG.DIALOG_ID} .yds-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
#${CONFIG.DIALOG_ID} .yds-count{font-size:12px;color:#777}
#${CONFIG.DIALOG_ID} .yds-buttons{display:flex;gap:8px}
#${CONFIG.DIALOG_ID} .yds-button{min-width:104px;padding:9px 16px;border:1px solid #aaa;border-radius:5px;background:#fff;color:#555;font-size:12px;font-weight:700;cursor:pointer}
#${CONFIG.DIALOG_ID} .yds-button-primary{border-color:#68465f;background:#875A7B;color:#fff}
#${CONFIG.DIALOG_ID} .yds-button-primary:hover{background:#68465f}
#${CONFIG.DIALOG_ID} .yds-button:disabled{opacity:.5;cursor:not-allowed}
#${CONFIG.DIALOG_ID} .yds-spin{display:inline-block;width:13px;height:13px;margin-right:7px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:yds-rotate .7s linear infinite}
@keyframes yds-rotate{to{transform:rotate(360deg)}}
#${CONFIG.BUTTON_ID}{cursor:pointer}
`;
        document.head.appendChild(style);
    }

    function setStatus(message, kind = 'info') {
        const element = state.dialog?.querySelector('.yds-status');
        if (!element) return;
        element.textContent = message;
        element.dataset.kind = kind;
    }

    function closeDialog() {
        if (state.busy) return;
        state.dialog?.remove();
        state.dialog = null;
        document.removeEventListener('keydown', state.keydown, true);
    }

    function showDrugDialog(drugs) {
        injectStyles();
        state.dialog?.remove();
        const overlay = document.createElement('div');
        overlay.id = CONFIG.DIALOG_ID;
        const payer = getField('payor_id') || 'Unknown';
        const employer = getField('insurance_agency') || 'Unknown';
        const cycleLabel = getText(document.querySelector('span[name="cycle_id"]')) || getField('cycle_id') || 'Unknown';
        overlay.innerHTML = `<section class="yds-panel" role="dialog" aria-modal="true" aria-labelledby="yds-title"><header class="yds-head"><div class="yds-title" id="yds-title">Direct Prescription Split</div><div class="yds-subtitle">Select the medications to include in the new prescription.</div></header><div class="yds-meta"><span class="yds-pill">Payer: ${escapeHTML(payer)}</span><span class="yds-pill">Corporate: ${escapeHTML(employer)}</span><span class="yds-pill">Cycle: ${escapeHTML(cycleLabel)}</span><span class="yds-pill">Max Amount: 00</span><span class="yds-pill">Tag: SPLIT</span></div><div class="yds-body"><label class="yds-select-all"><input type="checkbox" data-select-all><span>Select All</span></label><div class="yds-list">${drugs.map((drug,index) => `<label class="yds-drug"><input type="checkbox" data-drug-index="${index}"><span class="yds-drug-copy"><span class="yds-drug-name">${escapeHTML(drug.name)}</span><span class="yds-drug-hzb">HZB: ${escapeHTML(drug.hzb)}</span></span></label>`).join('')}</div></div><footer class="yds-footer"><div class="yds-status" aria-live="polite"></div><div class="yds-actions"><span class="yds-count" data-count>0 selected</span><div class="yds-buttons"><button type="button" class="yds-button" data-cancel>CANCEL</button><button type="button" class="yds-button yds-button-primary" data-submit disabled> SPLIT </button></div></div></footer></section>`;
        document.body.appendChild(overlay);
        state.dialog = overlay;
        const checkboxes = [...overlay.querySelectorAll('[data-drug-index]')];
        const selectAll = overlay.querySelector('[data-select-all]');
        const count = overlay.querySelector('[data-count]');
        const submit = overlay.querySelector('[data-submit]');
        const update = () => {
            const selected = checkboxes.filter(item => item.checked).length;
            count.textContent = `${selected} selected`;
            submit.disabled = selected === 0 || state.busy;
            selectAll.checked = selected === checkboxes.length && selected > 0;
            selectAll.indeterminate = selected > 0 && selected < checkboxes.length;
        };
        checkboxes.forEach(item => item.addEventListener('change', update));
        selectAll.addEventListener('change', () => { checkboxes.forEach(item => { item.checked = selectAll.checked; }); update(); });
        overlay.querySelector('[data-cancel]').addEventListener('click', closeDialog);
        overlay.addEventListener('click', event => { if (event.target === overlay) closeDialog(); });
        submit.addEventListener('click', async () => {
            const selected = checkboxes.filter(item => item.checked).map(item => drugs[Number(item.dataset.drugIndex)]);
            if (!selected.length || state.busy) return;
            state.busy = true;
            submit.disabled = true;
            overlay.querySelector('[data-cancel]').disabled = true;
            submit.innerHTML = '<span class="yds-spin"></span>PREPARING';
            try {
                const prepared = await prepareSplit(selected);
                const summary = `${prepared.selectedDrugs.length} medication(s)\nPayer: ${prepared.payer.name}\nCorporate: ${prepared.corporate.name}\nCycle: ${prepared.cycle.label}\nExpiry Date: ${prepared.input.expiryDate}\nSerial: ${prepared.input.serial}\nMax Amount: 00\nTag: SPLIT\n\nCreate the new prescription now?`;
                if (!window.confirm(summary)) {
                    state.busy = false;
                    submit.disabled = false;
                    overlay.querySelector('[data-cancel]').disabled = false;
                    submit.textContent = 'SPLIT';
                    update();
                    setStatus('Ready. No prescription was created.', 'info');
                    return;
                }
                submit.innerHTML = '<span class="yds-spin"></span>CREATING';
                setStatus('Sending the creation request directly to the Portal API...', 'info');
                state.mutationAttempted = true;
                const result = await graphQL(CREATE_PRESCRIPTION_MUTATION, { input: prepared.input });
                const created = result.addNewChronicPrescription;
                if (created?.isSuccess !== true) {
                    state.mutationAttempted = false;
                    throw new Error(created?.message || 'Portal did not confirm prescription creation.');
                }
                state.completed = true;
                state.busy = false;
                try {
                    await createLogNote(prepared);
                    setStatus(`${created.message || 'Prescription saved successfully.'}\nOdoo Log Note added.\nSerial: ${prepared.input.serial}`, 'success');
                } catch {
                    setStatus(`${created.message || 'Prescription saved successfully.'}\nThe prescription was created, but the Odoo Log Note could not be added.\nSerial: ${prepared.input.serial}`, 'success');
                }
                submit.textContent = 'COMPLETED';
                overlay.querySelector('[data-cancel]').textContent = 'CLOSE';
                overlay.querySelector('[data-cancel]').disabled = false;
                submit.disabled = true;
            } catch (error) {
                const uncertain = state.mutationAttempted && !state.completed;
                setStatus(`${error?.message || 'Split failed.'}${uncertain ? '\n\nThe request may have reached Portal. Check the prescription history before attempting another split.' : ''}`, 'error');
                submit.textContent = uncertain ? 'CHECK PORTAL' : 'SPLIT';
                submit.disabled = uncertain;
                overlay.querySelector('[data-cancel]').disabled = false;
                state.busy = false;
                if (!uncertain) update();
            }
        });
        state.keydown = event => {
            if (event.key === 'Escape' && state.dialog === overlay && !state.busy) closeDialog();
            if (event.key === 'Enter' && state.dialog === overlay && !submit.disabled && !state.busy) submit.click();
        };
        document.addEventListener('keydown', state.keydown, true);
        update();
    }

    async function startSplit() {
        if (state.fetchRunning || state.busy) return;
        const accepts = getField('accepts_splitting').toLowerCase();
        const acceptsRaw = normalize(document.querySelector('[name="accepts_splitting"]')?.getAttribute('raw-value')).toLowerCase();
        if (['no', 'false'].includes(accepts) || ['no', 'false'].includes(acceptsRaw)) {
            window.alert('This ticket does not allow prescription splitting.');
            return;
        }
        state.fetchRunning = true;
        state.mutationAttempted = false;
        state.completed = false;
        const button = document.getElementById(CONFIG.BUTTON_ID);
        if (button) { button.disabled = true; button.dataset.loading = '1'; }
        try {
            const drugs = await fetchSplitDrugs();
            showDrugDialog(drugs);
        } catch (error) {
            window.alert(`Could not prepare Split.\n\n${error?.message || 'Unknown error'}`);
        } finally {
            state.fetchRunning = false;
            if (button) { button.disabled = false; button.dataset.loading = '0'; }
        }
    }

    function createButton() {
        if (document.getElementById(CONFIG.BUTTON_ID)) return;
        const container = [...document.querySelectorAll('.oe_button_box')].find(isVisible);
        if (!container) return;
        const button = document.createElement('button');
        button.id = CONFIG.BUTTON_ID;
        button.type = 'button';
        button.className = 'btn oe_stat_button';
        button.title = 'Create split prescription directly';
        button.innerHTML = '<i class="fa fa-fw fa-exchange o_button_icon"></i><div class="o_stat_info"><span class="o_stat_text">Direct Split</span></div>';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled || button.dataset.loading === '1') return;
            startSplit();
        });
        const anchor = container.querySelector('#tm-confirmation-buttons');
        if (anchor) container.insertBefore(button, anchor.nextSibling);
        else container.prepend(button);
    }

    function isTicketForm() {
        return location.href.includes('model=helpdesk.ticket') && Boolean(document.querySelector('.o_form_view, .o_form_renderer'));
    }

    function init() {
        if (isTicketForm()) createButton();
    }

    state.observer = new MutationObserver(() => {
        if (!document.getElementById(CONFIG.BUTTON_ID)) init();
    });
    if (document.body) state.observer.observe(document.body, { childList: true, subtree: true });
    init();
    setTimeout(init, 700);
    setTimeout(init, 1800);
})();
