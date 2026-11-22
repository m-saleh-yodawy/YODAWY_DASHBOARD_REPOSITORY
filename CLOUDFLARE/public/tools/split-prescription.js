// ==UserScript==
// @name         Split Prescription
// @namespace    https://odoo.yodawy.com/
// @version      1
// @description  Create split prescriptions with exact Portal matching and live Odoo ticket fields.
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(async function () {
    'use strict';

    const TOOL_ID = 'TOOL-018';
    const host = location.hostname.toLowerCase();
    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    if (registry[TOOL_ID] || host !== 'odoo.yodawy.com') return;
    registry[TOOL_ID] = true;

    const CONFIG = {
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
        ticketId: 0,
        corporate: null,
        payer: null,
        cycle: null,
        expiryInfo: null,
        portalAccounts: [],
        accountId: '',
        api: null
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

    const getApi = () => window.YODAWY_API_ENGINE;
    async function waitForApi() {
        if (state.api?.getOpenErxAccounts && state.api?.runSplitGraphQL) return state.api;
        const started = Date.now();
        while (Date.now() - started < 15000) {
            const api = getApi();
            if (api?.getOpenErxAccounts && api?.runSplitGraphQL) {
                state.api = api;
                return api;
            }
            await sleep(200);
        }
        throw new Error('Dashboard API is not ready. Refresh Odoo and try again.');
    }

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

    async function getCorporateInfo() {
        const ticketId = state.ticketId || getTicketId();
        if (!ticketId) throw new Error('Ticket ID was not found while reading Corporate data.');
        const metadata = await rpc('helpdesk.ticket', 'fields_get', [[]], {
            attributes: ['string', 'type', 'relation'],
            context: getSessionContext()
        });
        const candidates = Object.entries(metadata || {}).map(([name, field]) => {
            const label = normalize(field?.string || name);
            const key = normalizeKey(name);
            const labelKey = normalizeKey(label);
            let score = 0;
            if (key === 'insuranceagency') score = 120;
            if (labelKey === 'corporate' || key === 'corporate' || key.endsWith('corporateid')) score = Math.max(score, 130);
            if (labelKey.includes('corporate') || key.includes('corporate')) score = Math.max(score, 125);
            if (labelKey.includes('employer') || key.includes('employer')) score = Math.max(score, 110);
            if (labelKey.includes('insuranceagency') || key.includes('insuranceagency')) score = Math.max(score, 100);
            if (labelKey.includes('agency') || key.includes('agency')) score = Math.max(score, 75);
            if (!score || ['payorid', 'payerid', 'companyid', 'insurancecompanyid'].includes(key)) return null;
            if (!['many2one', 'char', 'selection'].includes(field?.type)) return null;
            return { name, label, type: field.type, score };
        }).filter(Boolean).sort((a, b) => b.score - a.score);
        if (!candidates.length) throw new Error('Odoo did not expose a Corporate/Employer field on the Helpdesk ticket.');
        const record = (await rpc('helpdesk.ticket', 'read', [[ticketId], candidates.map(item => item.name)], {
            context: getSessionContext()
        }))?.[0];
        if (!record) throw new Error('Odoo could not read the current Helpdesk ticket Corporate data.');
        for (const candidate of candidates) {
            const value = record[candidate.name];
            if (Array.isArray(value) && value.length > 1 && value[0] && normalize(value[1])) {
                return { id: String(value[0]), name: normalize(value[1]), field: candidate.name, label: candidate.label };
            }
            if (typeof value === 'string' && normalize(value)) {
                return { id: '', name: normalize(value), field: candidate.name, label: candidate.label };
            }
        }
        const visible = getField('insurance_agency');
        if (visible) return { id: '', name: visible, field: 'insurance_agency', label: 'Insurance Agency' };
        throw new Error('Corporate field was found in Odoo metadata, but its value was empty. Checked: ' + candidates.map(item => item.label + ' (' + item.name + ')').join(', '));
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

    async function rpcButton(model, method, args = [], context = {}) {
        const response = await fetch('/web/dataset/call_button', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'call',
                params: { args, kwargs: { context }, method, model },
                id: Date.now()
            })
        });
        if (!response.ok) throw new Error('Odoo button request failed (' + response.status + ').');
        const data = await response.json();
        if (data.error) {
            const error = data.error;
            throw new Error(error?.data?.message || error?.data?.arguments?.[0] || error?.data?.name || error?.message || 'Odoo button request failed.');
        }
        return data.result;
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
        if (!state.accountId) throw new Error('Select a saved Portal account before continuing.');
        const operationName = query.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/)?.[1] || '';
        if (!operationName) throw new Error('GraphQL operation name could not be determined.');
        const api = await waitForApi();
        const response = await api.runSplitGraphQL(state.accountId, operationName, query, variables);
        if (response?.success !== true) {
            const error = new Error(response?.details?.errors?.map(item => item.message).filter(Boolean).join('\n') || response?.error || 'Portal request failed.');
            error.status = Number(response?.status || 0);
            error.data = response?.details || null;
            throw error;
        }
        return response.data || {};
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

    function getExpiryInfo(cycle, payer, corporate) {
        const isAlexBank = normalizeKey(corporate?.name).includes('alexbank');
        let expiryDate;
        if (payer.key === 'nextcare' && isAlexBank) {
            const nextCycle = new Date(cycle.year, cycle.month + 1, 1);
            expiryDate = new Date(nextCycle.getFullYear(), nextCycle.getMonth(), 22);
        } else if (payer.key === 'metlife' || payer.expiryDay === 'last') {
            expiryDate = new Date(cycle.year, cycle.month + 1, 0);
        } else {
            expiryDate = new Date(cycle.year, cycle.month, Number(payer.expiryDay));
        }
        const apiDate = new Date(expiryDate);
        apiDate.setDate(apiDate.getDate() - 1);
        const day = String(expiryDate.getDate()).padStart(2, '0');
        const month = String(expiryDate.getMonth() + 1).padStart(2, '0');
        const year = expiryDate.getFullYear();
        return {
            displayDate: day + '/' + month + '/' + year,
            apiDate: String(apiDate.getMonth() + 1).padStart(2, '0') + '/' + String(apiDate.getDate()).padStart(2, '0') + '/' + apiDate.getFullYear()
        };
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
        const payer = state.payer || getPayerConfig();
        if (!payer.insuranceCompanyId) throw new Error(`${payer.name} has no verified Agency ID in the supplied HAR. Use a backup engine for this payer until its mapping is captured.`);
        const cardNumber = getField('user_ref');
        const formNumber = getField('prescription_number');
        const corporateInfo = state.corporate || await getCorporateInfo();
        const employer = corporateInfo.name;
        const cycle = state.cycle || await getCycleInfo();
        if (!cardNumber) throw new Error('Odoo Card Number is missing.');
        if (!formNumber) throw new Error('Odoo Prescription Number is missing.');
        if (!employer) throw new Error('Odoo Corporate is missing.');
        if (!selectedDrugs.length) throw new Error('Select at least one medication.');
        if (new Set(selectedDrugs.map(item => item.hzb)).size !== selectedDrugs.length) throw new Error('Duplicate HZB values were selected. The split was stopped.');

        const expiryInfo = getExpiryInfo(cycle, payer, corporateInfo);
        state.expiryInfo = expiryInfo;
        const [corporate, prescription] = await Promise.all([
            resolveCorporate(payer, employer),
            resolvePrescription(payer, cardNumber, formNumber)
        ]);
        if (!/^[a-f\d]{24}$/i.test(String(prescription.id || ''))) throw new Error('Portal returned an invalid prescription identifier.');
        const detailsData = await graphQL(PRESCRIPTION_DETAILS_QUERY(prescription.id));
        const details = detailsData.GetPrescriptionDetails;
        if (!details || !Array.isArray(details.Medications)) throw new Error('Portal prescription details are incomplete.');
        const claimFormType = normalize(details.ClaimFormType || '').toLowerCase();
        const isChronic = claimFormType === 'chronic' || details.IsChronic === true;
        if (!isChronic) throw new Error(`The selected Portal prescription is not Chronic. ClaimFormType: ${details.ClaimFormType ?? 'missing'}; IsChronic: ${details.IsChronic ?? 'missing'}.`);

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
            expiryDate: expiryInfo.apiDate,
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
        return { input, payer, corporate, cycle, prescription, details, selectedDrugs, expiryDate: expiryInfo.displayDate };
    }

    function getTicketFormContext(ticketId) {
        const context = getSessionContext();
        const action = getActionContext();
        return {
            ...context,
            params: {
                ...(action.params || {}),
                model: 'helpdesk.ticket',
                view_type: 'form'
            },
            active_model: 'helpdesk.ticket',
            active_id: Number(ticketId),
            active_ids: [Number(ticketId)]
        };
    }

    function getHbzFromWizardLine(line) {
        const drug = extractDrug(line?.limited_drug);
        return drug?.hzb || '';
    }

    function getPlainMessage(body) {
        const template = document.createElement('template');
        template.innerHTML = String(body || '');
        return normalize(template.content.textContent || '');
    }

    async function waitForRemovedLimitedDrugsNote(ticketId, baselineId, targets, timeout = 12000) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            const messages = await rpc('mail.message', 'search_read', [[
                ['model', '=', 'helpdesk.ticket'],
                ['res_id', '=', ticketId],
                ...(baselineId ? [['id', '>', baselineId]] : [])
            ]], {
                fields: ['id', 'body'],
                order: 'id desc',
                limit: 40,
                context: getSessionContext()
            });
            const note = (messages || []).find(message => {
                const text = getPlainMessage(message.body);
                if (!/Removed Limited Drugs/i.test(text)) return false;
                const noteHzbs = [...text.matchAll(/HZB ID\s*:\s*(\d+)/gi)].map(match => match[1]);
                return targets.every(target => noteHzbs.includes(target.hzb));
            });
            if (note) return note;
            await sleep(180);
        }
        throw new Error('Odoo did not publish the Removed Limited Drugs Chatter note for every selected HZB. Verify the ticket before retrying.');
    }

    async function deleteSplitItemsFromOdoo(prepared) {
        const ticketId = Number(state.ticketId || getTicketId());
        if (!ticketId) throw new Error('Current Odoo ticket ID is unavailable.');

        const targets = [...new Map(prepared.selectedDrugs.map(drug => [normalize(drug.hzb), {
            name: normalize(drug.name),
            hzb: normalize(drug.hzb)
        }])).values()];
        if (!targets.length || targets.some(target => !/^\d+$/.test(target.hzb))) throw new Error('Selected medications do not contain valid HZB values.');

        const baselineId = await getLatestMessageId(ticketId);
        const context = getTicketFormContext(ticketId);
        const fetchContext = getActionContext();
        fetchContext.params = { ...(fetchContext.params || {}), view_type: 'form' };
        const action = await rpcButton('helpdesk.ticket', 'action_fetch_suitable_alternatives', [[ticketId]], fetchContext);
        const wizardId = Number(action?.res_id || 0);
        if (!wizardId) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('Odoo Fetch did not return an alternatives wizard after the Portal split.');
        }

        const wizard = (await rpc('alternative.wizard', 'read', [[wizardId], ['alternative_lines_ids']], { context }))?.[0];
        const lineIds = Array.isArray(wizard?.alternative_lines_ids) ? wizard.alternative_lines_ids.map(Number).filter(id => id > 0) : [];
        if (!lineIds.length) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('Odoo Fetch returned no alternative wizard lines. No Limited Drugs were removed.');
        }

        const relation = await rpc('alternative.wizard', 'fields_get', [['alternative_lines_ids']], {
            attributes: ['relation'],
            context
        });
        const lineModel = relation?.alternative_lines_ids?.relation;
        if (!lineModel) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('Could not identify Odoo alternative wizard line model.');
        }

        const fields = ['is_header', 'limited_drug', 'replace_or_delete_line'];
        const lines = await rpc(lineModel, 'read', [lineIds, fields], { context });
        if (!Array.isArray(lines) || !lines.length) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('Odoo returned no readable alternative wizard lines.');
        }

        const selectedHeaders = new Map();
        for (const target of targets) {
            const matches = lines.filter(line => line?.is_header === true && getHbzFromWizardLine(line) === target.hzb);
            if (matches.length !== 1) {
                await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
                throw new Error('Odoo could not uniquely match ' + target.name + ' (HZB ' + target.hzb + ') in the fresh Fetch. Matches: ' + matches.length + '. No deletion was submitted.');
            }
            selectedHeaders.set(target.hzb, Number(matches[0].id));
        }

        const selectedLineIds = new Set(selectedHeaders.values());
        const commands = lines.map(line => {
            const id = Number(line.id);
            return selectedLineIds.has(id)
                ? [1, id, { replace_or_delete_line: 'del' }]
                : [4, id, false];
        });
        if (commands.length !== lineIds.length || commands.some(command => !command[1])) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('The Odoo wizard line update could not be prepared safely.');
        }

        const written = await rpc('alternative.wizard', 'write', [[wizardId], {
            alternative_lines_ids: commands
        }], { context });
        if (written !== true) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('Odoo did not confirm the selected Limited Drug deletion flags.');
        }

        const verifiedLines = await rpc(lineModel, 'read', [[...selectedLineIds], ['replace_or_delete_line']], { context });
        const verifiedIds = new Set((verifiedLines || []).filter(line => line.replace_or_delete_line === 'del').map(line => Number(line.id)));
        if (verifiedIds.size !== selectedLineIds.size) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('Odoo did not preserve every selected deletion flag. The delete action was not submitted.');
        }

        let actionError = null;
        try {
            await rpcButton('alternative.wizard', 'action_add_alternatives', [[wizardId]], context);
        } catch (error) {
            actionError = error;
        }
        let note;
        try {
            note = await waitForRemovedLimitedDrugsNote(ticketId, baselineId, targets);
        } catch (error) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error(actionError
                ? 'Odoo action response was uncertain: ' + (actionError.message || 'Unknown error') + '. ' + error.message
                : error.message);
        }

        return {
            success: true,
            count: targets.length,
            names: targets.map(target => target.name),
            noteId: Number(note.id)
        };
    }

    async function prepareLogNote(prepared) {
        const rows = prepared.selectedDrugs.map(drug => {
            const limited = cleanDrugName(drug.limited) || [drug.name, drug.hzb].join(', ');
            return 'Limited Drug: ' + limited + '\nSPLIT';
        });
        const note = rows.join('\n\n');
        const findComposer = () => [...document.querySelectorAll('.o_ComposerTextInput_textarea')].find(isVisible) || null;
        const findAction = () => [...document.querySelectorAll('.o_Composer_buttonSend')].find(isVisible) || null;
        const originalComposer = findComposer();
        const originalText = String(originalComposer?.value || '');
        let composer = originalComposer;
        let action = findAction();

        if (!composer || getText(action).toLowerCase() !== 'log') {
            const button = [...document.querySelectorAll('.o_ChatterTopbar_buttonLogNote')].find(isVisible);
            if (!button) throw new Error('The Odoo Log Note button was not found.');
            button.click();
            const end = Date.now() + 5000;
            while (Date.now() < end) {
                composer = findComposer();
                action = findAction();
                if (composer && getText(action).toLowerCase() === 'log') break;
                await sleep(100);
            }
        }

        if (!composer || getText(action).toLowerCase() !== 'log') throw new Error('Could not open the Odoo Log Note composer. The Split was completed, but no note was posted or replaced.');
        const currentText = String(composer.value || '');
        let existingText = currentText || originalText;
        if (originalText && currentText && originalText !== currentText && !originalText.startsWith(currentText) && !currentText.startsWith(originalText)) {
            const previousSeparator = originalText.endsWith('\n\n') ? '' : originalText.endsWith('\n') ? '\n' : '\n\n';
            existingText = originalText + previousSeparator + currentText;
        } else if (originalText.length > currentText.length && originalText.startsWith(currentText)) {
            existingText = originalText;
        }
        const separator = !existingText ? '' : existingText.endsWith('\n\n') ? '' : existingText.endsWith('\n') ? '\n' : '\n\n';
        const combined = existingText + separator + note;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setter) throw new Error('The Odoo Log Note editor could not be updated.');
        setter.call(composer, combined);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
        if (composer.value !== combined) throw new Error('The Split Log Note could not be verified in the Odoo editor.');
        composer.focus();
        composer.setSelectionRange(combined.length, combined.length);
        return { prepared: true, appended: Boolean(existingText), length: combined.length };
    }

    function injectStyles() {
        if (document.getElementById('ydDirectSplitStyles')) return;
        const style = document.createElement('style');
        style.id = 'ydDirectSplitStyles';
        style.textContent = `
#${CONFIG.DIALOG_ID}{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:22px;background:rgba(22,17,25,.62);backdrop-filter:blur(3px);font-family:Nunito,Arial,sans-serif}
#${CONFIG.DIALOG_ID} *{box-sizing:border-box;font-family:Nunito,Arial,sans-serif}
#${CONFIG.DIALOG_ID} .yds-panel{width:min(600px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 32px));display:flex;flex-direction:column;gap:0;overflow:hidden;padding:0;border:1px solid #bfaebe;border-radius:14px;background:#fff;box-shadow:0 22px 70px rgba(25,15,25,.32);color:#332b36;animation:yds-modal-enter .18s cubic-bezier(.2,.8,.2,1) both}
#${CONFIG.DIALOG_ID} .yds-head{display:flex;align-items:center;gap:12px;min-width:0;padding:17px 22px;border-bottom:1px solid #d9cbd7;background:#fff;color:#332b36}
#${CONFIG.DIALOG_ID} .yds-brand-mark{display:grid;place-items:center;flex:0 0 38px;width:38px;height:38px;border:1px solid #68465f;border-radius:9px;background:#875a7b;color:#fff;font-size:19px;font-weight:700;line-height:1;box-shadow:0 2px 5px rgba(104,70,95,.18)}
#${CONFIG.DIALOG_ID} .yds-head-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0}
#${CONFIG.DIALOG_ID} .yds-kicker{display:block;color:#875a7b;font-size:9px;font-weight:700;letter-spacing:1.1px;line-height:1.3}
#${CONFIG.DIALOG_ID} .yds-title{margin:0;color:#3d3040;font-size:18px;font-weight:600;letter-spacing:-.015em;line-height:1.3}
#${CONFIG.DIALOG_ID} .yds-subtitle{margin:1px 0 0;color:#706775;font-size:11px;font-weight:400;line-height:1.45}
#${CONFIG.DIALOG_ID} .yds-account{display:flex;flex-direction:column;gap:7px;padding:14px 20px;background:#E1E1E1}
#${CONFIG.DIALOG_ID} .yds-account label{display:block;margin:0;color:#514653;font-size:11px;font-weight:600}
#${CONFIG.DIALOG_ID} .yds-account select{width:100%;height:38px;min-height:38px;padding:0 12px;border:1px solid #b9a9b8;border-radius:6px;outline:0;background:#fff;color:#332b36;font-size:12px;font-weight:400}
#${CONFIG.DIALOG_ID} .yds-account select:focus{border-color:#875a7b;box-shadow:0 0 0 2px rgba(135,90,123,.18)}
#${CONFIG.DIALOG_ID} .yds-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:14px 20px;border-bottom:1px solid #c9bbc8;background:#E1E1E1}
#${CONFIG.DIALOG_ID} .yds-summary-card{display:flex;flex-direction:column;gap:5px;min-width:0;padding:11px 12px;border:1px solid #c7b9c6;border-radius:7px;background:#fff}
#${CONFIG.DIALOG_ID} .yds-summary-card:nth-child(2){border-color:#c7b9c6}
#${CONFIG.DIALOG_ID} .yds-summary-label{display:block;color:#68465f;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase}
#${CONFIG.DIALOG_ID} .yds-summary-value{display:block;margin:0;color:#302833;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
#${CONFIG.DIALOG_ID} .yds-body{display:flex;flex:1;flex-direction:column;gap:9px;min-height:0;padding:14px 20px 17px;overflow:auto;background:#E1E1E1}
#${CONFIG.DIALOG_ID} .yds-select-all{display:flex;align-items:center;gap:9px;min-height:38px;padding:8px 10px;margin:0;border:1px solid #c7b9c6;border-radius:7px;background:#fff;color:#443a48;font-size:11px;font-weight:500;cursor:pointer}
#${CONFIG.DIALOG_ID} .yds-list{display:flex;flex-direction:column;gap:8px}
#${CONFIG.DIALOG_ID} .yds-drug{display:flex;align-items:center;gap:10px;min-width:0;min-height:52px;padding:10px 11px;border:1px solid #c7b9c6;border-radius:7px;background:#fff;cursor:pointer;transition:border-color .15s,background-color .15s,box-shadow .15s}
#${CONFIG.DIALOG_ID} .yds-drug:hover{border-color:#a88da4;background:#fff;box-shadow:0 2px 7px rgba(25,15,25,.08)}
#${CONFIG.DIALOG_ID} .yds-drug:has(input:checked){border-color:#875a7b;background:#f8f3f7;box-shadow:0 0 0 1px rgba(135,90,123,.16)}
#${CONFIG.DIALOG_ID} .yds-drug input,#${CONFIG.DIALOG_ID} .yds-select-all input{width:15px;height:15px;margin:0;accent-color:#875a7b;flex:0 0 auto}
#${CONFIG.DIALOG_ID} .yds-drug-copy{display:flex;flex:1;flex-direction:column;gap:3px;min-width:0}
#${CONFIG.DIALOG_ID} .yds-drug-name{color:#302833;font-size:11.5px;font-weight:600;line-height:1.4;overflow-wrap:anywhere}
#${CONFIG.DIALOG_ID} .yds-drug-hzb{margin:0;color:#665c69;font-size:10px;font-weight:400}
#${CONFIG.DIALOG_ID} .yds-drug-state{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;margin-left:auto;padding:5px 8px;border:1px solid #b9dac7;border-radius:5px;background:#e8f5ed;color:#257346;font-size:9px;font-weight:600;white-space:nowrap}
#${CONFIG.DIALOG_ID} .yds-drug-state[hidden]{display:none}
#${CONFIG.DIALOG_ID} .yds-drug-state[data-kind="error"]{border-color:#e3b8bc;background:#fff0f0;color:#a92b35}
#${CONFIG.DIALOG_ID} .yds-row-state-icon{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;background:#257346;color:#fff;font-size:10px;font-weight:700}
#${CONFIG.DIALOG_ID} .yds-drug-state[data-kind="error"] .yds-row-state-icon{background:#a92b35}
#${CONFIG.DIALOG_ID} .yds-footer{display:flex;flex-direction:column;gap:10px;padding:13px 20px 15px;border-top:1px solid #c9bbc8;background:#fff}
#${CONFIG.DIALOG_ID} .yds-status{display:none;align-items:center;justify-content:center;gap:9px;min-height:40px;padding:8px 12px;margin:0;border:1px solid #c7b9c6;border-radius:6px;background:#f8f5f7;color:#68465f;font-size:11px;font-weight:600;letter-spacing:.01em}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="error"],#${CONFIG.DIALOG_ID} .yds-status[data-kind="success"],#${CONFIG.DIALOG_ID} .yds-status[data-kind="info"]{display:flex}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="error"]{border-color:#e3b8bc;background:#fff0f0;color:#a92b35}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="success"]{border-color:#b9dac7;background:#e8f5ed;color:#257346}
#${CONFIG.DIALOG_ID} .yds-status-icon{display:inline-grid;place-items:center;flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:#35678f;color:#fff;font-size:14px;font-weight:700;line-height:1}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="success"] .yds-status-icon{background:#257346}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="error"] .yds-status-icon{background:#a92b35}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="info"] .yds-status-icon{width:16px;height:16px;flex-basis:16px;border:2px solid currentColor;border-right-color:transparent;background:transparent;animation:yds-rotate .7s linear infinite}
#${CONFIG.DIALOG_ID} .yds-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
#${CONFIG.DIALOG_ID} .yds-count{color:#665c69;font-size:11px;font-weight:400}
#${CONFIG.DIALOG_ID} .yds-buttons{display:flex;justify-content:flex-end;gap:9px}
#${CONFIG.DIALOG_ID} .yds-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:92px;min-height:38px;padding:8px 15px;border:1px solid #bfaebe;border-radius:7px;background:#fff;color:#68465f;font-size:11px;font-weight:600;cursor:pointer;transition:all .15s}
#${CONFIG.DIALOG_ID} .yds-button:hover:not(:disabled){border-color:#875a7b;background:#f8f3f7}
#${CONFIG.DIALOG_ID} .yds-button-primary{border-color:#875a7b;background:#875a7b;color:#fff;box-shadow:0 2px 5px rgba(135,90,123,.16)}
#${CONFIG.DIALOG_ID} .yds-button-primary:hover:not(:disabled){border-color:#68465f;background:#68465f;box-shadow:0 3px 8px rgba(104,70,95,.2)}
#${CONFIG.DIALOG_ID} .yds-button:disabled{border-color:#bcaabb;background:#bcaabb;color:#fff;opacity:1;cursor:not-allowed}
#${CONFIG.DIALOG_ID} .yds-spin{display:inline-block;width:13px;height:13px;margin-right:7px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:yds-rotate .7s linear infinite}
@keyframes yds-rotate{to{transform:rotate(360deg)}}
@keyframes yds-modal-enter{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:translateY(0) scale(1)}}
#${CONFIG.BUTTON_ID}{cursor:pointer}
@media(max-width:520px){
#${CONFIG.DIALOG_ID}{padding:12px}
#${CONFIG.DIALOG_ID} .yds-panel{width:100%;max-height:calc(100vh - 24px);border-radius:12px}
#${CONFIG.DIALOG_ID} .yds-head{padding:14px 15px}
#${CONFIG.DIALOG_ID} .yds-title{font-size:16px}
#${CONFIG.DIALOG_ID} .yds-account{padding:12px 14px}
#${CONFIG.DIALOG_ID} .yds-summary{gap:8px;padding:12px 14px}
#${CONFIG.DIALOG_ID} .yds-summary-card{padding:9px}
#${CONFIG.DIALOG_ID} .yds-body{padding:12px 14px}
#${CONFIG.DIALOG_ID} .yds-footer{padding:11px 14px 13px}
#${CONFIG.DIALOG_ID} .yds-drug{align-items:flex-start;flex-wrap:wrap}
#${CONFIG.DIALOG_ID} .yds-drug-state{margin-left:25px}
#${CONFIG.DIALOG_ID} .yds-buttons{gap:6px}
#${CONFIG.DIALOG_ID} .yds-button{min-width:82px;padding:8px 12px}
}
`;
        document.head.appendChild(style);
    }

    function setStatus(message, kind = 'info', detail = '') {
        const element = state.dialog?.querySelector('.yds-status');
        if (!element) return;
        const icon = element.querySelector('.yds-status-icon');
        const text = element.querySelector('.yds-status-text');
        if (icon) icon.textContent = kind === 'success' ? '✓' : kind === 'error' ? '×' : '';
        if (text) text.textContent = message;
        element.dataset.kind = kind;
        element.title = detail || '';
    }

    function markSelectedDrugs(drugs, kind) {
        const selectedHzbs = new Set(drugs.map(drug => normalize(drug.hzb)));
        state.dialog?.querySelectorAll('[data-drug-status]').forEach(badge => {
            const row = badge.closest('.yds-drug');
            const checkbox = row?.querySelector('[data-drug-index]');
            const drug = checkbox ? state.dialog._ydsDrugList?.[Number(checkbox.dataset.drugIndex)] : null;
            const selected = Boolean(drug && selectedHzbs.has(normalize(drug.hzb)));
            badge.hidden = !selected;
            if (!selected) return;
            badge.dataset.kind = kind;
            badge.innerHTML = kind === 'success'
                ? '<span class="yds-row-state-icon">✓</span><span>SPLIT &amp; DELETED</span>'
                : '<span class="yds-row-state-icon">×</span><span>FAILED</span>';
        });
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
        const cycleLabel = state.cycle?.label || 'Unknown';
        const expiryLabel = state.expiryInfo?.displayDate || 'Unknown';
        const accountOptions = state.portalAccounts.map(account => `<option value="${escapeHTML(account.id)}">${escapeHTML((account.accountType === 'PERSONAL' ? 'Personal' : 'Non-Personal') + ' · ' + (account.username || account.label || account.id))}</option>`).join('');
        const accountControl = state.portalAccounts.length > 1 ? `<div class="yds-account"><label for="yds-portal-account">PORTAL ACCOUNT</label><select id="yds-portal-account" data-portal-account><option value="">Select Portal account...</option>${accountOptions}</select></div>` : '';
        overlay.innerHTML = `<section class="yds-panel" role="dialog" aria-modal="true" aria-labelledby="yds-title"><header class="yds-head"><span class="yds-brand-mark" aria-label="S for Split">S</span><div class="yds-head-copy"><span class="yds-kicker">SPLIT WORKSPACE</span><div class="yds-title" id="yds-title">Direct Prescription Split</div><div class="yds-subtitle">Select the medications to include in the new prescription.</div></div></header><div class="yds-summary"><div class="yds-summary-card"><span class="yds-summary-label">Expiry Date</span><strong class="yds-summary-value">${escapeHTML(expiryLabel)}</strong></div><div class="yds-summary-card"><span class="yds-summary-label">Cycle</span><strong class="yds-summary-value">${escapeHTML(cycleLabel)}</strong></div></div>${accountControl}<div class="yds-body"><label class="yds-select-all"><input type="checkbox" data-select-all><span>Select All</span></label><div class="yds-list">${drugs.map((drug,index) => `<label class="yds-drug"><input type="checkbox" data-drug-index="${index}"><span class="yds-drug-copy"><span class="yds-drug-name">${escapeHTML(drug.name)}</span><span class="yds-drug-hzb">HZB: ${escapeHTML(drug.hzb)}</span></span><span class="yds-drug-state" data-drug-status hidden></span></label>`).join('')}</div></div><footer class="yds-footer"><div class="yds-status" aria-live="polite"><span class="yds-status-icon" aria-hidden="true"></span><span class="yds-status-text"></span></div><div class="yds-actions"><span class="yds-count" data-count>0 selected</span><div class="yds-buttons"><button type="button" class="yds-button" data-cancel>CANCEL</button><button type="button" class="yds-button yds-button-primary" data-submit disabled> SPLIT </button></div></div></footer></section>`;
        document.body.appendChild(overlay);
        state.dialog = overlay;
        const checkboxes = [...overlay.querySelectorAll('[data-drug-index]')];
        const selectAll = overlay.querySelector('[data-select-all]');
        const count = overlay.querySelector('[data-count]');
        const submit = overlay.querySelector('[data-submit]');
        const update = () => {
            const selected = checkboxes.filter(item => item.checked).length;
            count.textContent = `${selected} selected`;
            const accountReady = state.portalAccounts.length === 1 || Boolean(overlay.querySelector('[data-portal-account]')?.value || state.accountId);
            submit.disabled = selected === 0 || state.busy || !accountReady;
            selectAll.checked = selected === checkboxes.length && selected > 0;
            selectAll.indeterminate = selected > 0 && selected < checkboxes.length;
        };
        checkboxes.forEach(item => item.addEventListener('change', update));
        selectAll.addEventListener('change', () => { checkboxes.forEach(item => { item.checked = selectAll.checked; }); update(); });
        overlay.querySelector('[data-portal-account]')?.addEventListener('change', event => { state.accountId = event.target.value; update(); });
        overlay.querySelector('[data-cancel]').addEventListener('click', closeDialog);
        overlay.addEventListener('click', event => { if (event.target === overlay) closeDialog(); });
        submit.addEventListener('click', async () => {
            const selected = checkboxes.filter(item => item.checked).map(item => drugs[Number(item.dataset.drugIndex)]);
            if (!selected.length || state.busy) return;
            overlay._ydsDrugList = drugs;
            const selectedAccount = overlay.querySelector('[data-portal-account]')?.value || state.accountId;
            if (!selectedAccount) { setStatus('Select the saved Portal account linked to this Odoo payer.', 'error'); return; }
            state.accountId = selectedAccount;
            state.busy = true;
            submit.disabled = true;
            overlay.querySelector('[data-cancel]').disabled = true;
            submit.innerHTML = '<span class="yds-spin"></span>PREPARING';
            try {
                const prepared = await prepareSplit(selected);
                const summary = `${prepared.selectedDrugs.length} medication(s)\nPayer: ${prepared.payer.name}\nCorporate: ${prepared.corporate.name}\nCycle: ${prepared.cycle.label}\nExpiry Date: ${prepared.expiryDate}\nSerial: ${prepared.input.serial}\nMax Amount: 00\nTag: SPLIT\n\nCreate the new prescription now?`;
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
                setStatus('Portal confirmed the split. Removing the selected items from this Odoo ticket...', 'info');
                submit.innerHTML = '<span class="yds-spin"></span>CLEANING ODOO';
                let cleanup = { success: false, error: '' };
                try {
                    cleanup = await deleteSplitItemsFromOdoo(prepared);
                } catch (error) {
                    cleanup.error = error?.message || 'Odoo item deletion failed.';
                }
                let noteError = '';
                if (cleanup.success) {
                    try {
                        await prepareLogNote(prepared);
                    } catch (error) {
                        noteError = error?.message || 'Odoo Log Note could not be prepared.';
                    }
                } else {
                    noteError = 'SPLIT Log Note was not prepared because Odoo removal was not verified.';
                }
                state.busy = false;
                if (cleanup.success) {
                    markSelectedDrugs(selected, 'success');
                    setStatus('SUCCESS', 'success');
                } else {
                    markSelectedDrugs(selected, 'error');
                    setStatus('FAILED', 'error', cleanup.error || noteError || 'Odoo item deletion was not verified.');
                }
                if (noteError) {
                    const statusElement = state.dialog?.querySelector('.yds-status');
                    if (statusElement) statusElement.title = noteError;
                }

                submit.textContent = 'COMPLETED';
                checkboxes.forEach(item => { item.disabled = true; });
                selectAll.disabled = true;
                overlay.querySelector('[data-cancel]').textContent = 'CLOSE';
                overlay.querySelector('[data-cancel]').disabled = false;
                submit.disabled = true;
            } catch (error) {
                const status = Number(error?.status || 0);
                const rejectedBeforeCreate = status >= 400 && status < 500;
                const uncertain = state.mutationAttempted && !state.completed && !rejectedBeforeCreate;
                markSelectedDrugs(selected, 'error');
                setStatus('FAILED', 'error', (error?.message || 'Split failed.') + (uncertain ? ' The request may have reached Portal. Check prescription history before retrying.' : ''));
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
        state.corporate = null;
        state.payer = null;
        state.cycle = null;
        state.expiryInfo = null;
        state.portalAccounts = [];
        state.accountId = '';
        state.mutationAttempted = false;
        state.completed = false;
        const button = document.getElementById(CONFIG.BUTTON_ID);
        if (button) { button.disabled = true; button.dataset.loading = '1'; }
        try {
            const api = await waitForApi();
            const accountResponse = await api.getOpenErxAccounts(getField('payor_id'));
            state.portalAccounts = accountResponse?.success === true && Array.isArray(accountResponse.accounts) ? accountResponse.accounts : [];
            if (!state.portalAccounts.length) throw new Error('No saved Portal account matches this Odoo payer in your PORTALS list.');
            state.accountId = state.portalAccounts.length === 1 ? state.portalAccounts[0].id : '';
            const drugs = await fetchSplitDrugs();
            const [corporate, cycle] = await Promise.all([getCorporateInfo(), getCycleInfo()]);
            state.corporate = corporate;
            state.cycle = cycle;
            state.payer = getPayerConfig();
            state.expiryInfo = getExpiryInfo(cycle, state.payer, corporate);
            showDrugDialog(drugs);
        } catch (error) {
            window.alert('Could not prepare Split.\n\n' + (error?.message || 'Unknown error'));
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
