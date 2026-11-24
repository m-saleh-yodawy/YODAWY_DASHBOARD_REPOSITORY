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
        JOURNAL_PREFIX: 'yds.split.journal.v1.',
        NEXTCARE: {
            payerRef: 'next_care',
            insuranceCompanyId: '5fe1dd72b67e934e07563d84',
        },
        METLIFE: {
            payerRef: 'metlife',
            insuranceCompanyId: '',
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
        api: null,
        portalCreated: false,
        logPosted: false,
        ticketClosed: false,
        pendingSplitLog: null,
        splitLogBaselineId: 0,
        deferredChatterObserver: null,
        journal: null,
        componentsRefreshed: false,
        verificationTab: null
    };

    const normalize = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    function readSplitJournal(ticketId) {
        try {
            const value = localStorage.getItem(CONFIG.JOURNAL_PREFIX + Number(ticketId));
            const journal = value ? JSON.parse(value) : null;
            return journal?.version === 1 && Number(journal.ticketId) === Number(ticketId) && Array.isArray(journal.selectedDrugs) ? journal : null;
        } catch { return null; }
    }
    function saveSplitJournal(journal) {
        const cycle = state.cycle || null;
        const next = { ...journal, cycleLabel: journal.cycleLabel || cycle?.label || '', cycleNumber: journal.cycleNumber || cycle?.cycleNumber || '', cycleMonth: journal.cycleMonth ?? cycle?.month ?? null, cycleYear: journal.cycleYear || cycle?.year || 0, cleanupDate: journal.cleanupDate || (cycle ? [cycle.year, String(cycle.month + 1).padStart(2, '0'), '23'].join('-') : ''), updatedAt: Date.now() };
        state.journal = next;
        try { localStorage.setItem(CONFIG.JOURNAL_PREFIX + Number(next.ticketId), JSON.stringify(next)); }
        catch { throw new Error('Could not persist the Split progress in this browser. No further Odoo action was started.'); }
        return next;
    }
    function updateSplitJournal(patch) {
        if (!state.journal) return null;
        return saveSplitJournal({ ...state.journal, ...patch });
    }
    function removeSplitJournal(ticketId) {
        try { localStorage.removeItem(CONFIG.JOURNAL_PREFIX + Number(ticketId)); } catch {}
        if (Number(state.journal?.ticketId) === Number(ticketId)) state.journal = null;
    }
    function runCycleStorageCleanup() {
        const now = new Date();
        const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
        const prefix = CONFIG.JOURNAL_PREFIX;
        const expired = [];
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key?.startsWith(prefix)) continue;
            try {
                const journal = JSON.parse(localStorage.getItem(key) || 'null');
                if (journal?.cleanupDate && journal.cleanupDate <= today) expired.push(key);
            } catch { expired.push(key); }
        }
        if (!expired.length) return false;
        expired.forEach(key => { try { localStorage.removeItem(key); } catch {} });
        const marker = 'yds.split.storage-refresh.' + today;
        if (localStorage.getItem(marker)) return false;
        try { localStorage.setItem(marker, '1'); } catch {}
        return true;
    }
    async function cleanupCycleStorageOnTicket() {
        try {
            state.ticketId = getTicketId();
            if (!state.ticketId) return;
            state.cycle = await getCycleInfo();
            if (runCycleStorageCleanup()) location.reload();
        } catch {}
    }
    function reserveVerificationTab() {
        try {
            const tab = window.open('about:blank', '_blank');
            if (!tab) return null;
            tab.document.title = 'Yodawy ERX Verification';
            tab.document.body.innerHTML = '<main style="font:14px Arial,sans-serif;padding:32px;color:#68465f">Split is running. This tab will open the ticket ERX if verification is needed.</main>';
            return tab;
        } catch { return null; }
    }
    function closeVerificationTab() {
        try { if (state.verificationTab && !state.verificationTab.closed) state.verificationTab.close(); } catch {}
        state.verificationTab = null;
    }
    function buildErxUrl(prescription) {
        const id = normalize(prescription?.id || '');
        const number = normalize(prescription?.PrescriptionNumber || prescription?.prescriptionNumber || '');
        if (!/^[a-f0-9-]{36}$/i.test(id) || !number) return '';
        return 'https://callcenter.yodawy.com/#/Prescription/' + encodeURIComponent(id) + '/' + encodeURIComponent(number) + '?_k=' + Math.random().toString(36).slice(2, 8);
    }
    function openErxAfterFailure(url) {
        if (!url) { closeVerificationTab(); return; }
        try {
            if (state.verificationTab && !state.verificationTab.closed) {
                state.verificationTab.location.replace(url);
                state.verificationTab = null;
                return;
            }
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'OPEN ERX';
            link.dataset.openSplitErx = '1';
            const buttons = state.dialog?.querySelector('.yds-buttons');
            if (buttons && !buttons.querySelector('[data-open-split-erx]')) buttons.prepend(link);
        } catch {}
    }
    async function findCreatedSplitErx(journal) {
        const payer = state.payer || getPayerConfig();
        if (!state.accountId || !journal.cardNumber || !journal.selectedDrugs?.length) return null;
        const data = await graphQL(PRESCRIPTIONS_QUERY, { filter: { AgencyId: payer.insuranceCompanyId, CardNumber: journal.cardNumber, AgentType: '4' } });
        const rows = data.InsuranceAgencyPrescription;
        if (!Array.isArray(rows)) throw new Error('Portal did not return prescription history while verifying the Split.');
        const expected = journal.selectedDrugs.map(drug => normalize(drug.hzb));
        const attemptedAt = Number(journal.portalAttemptedAt || Date.now()) - 120000;
        const candidates = rows.filter(item => String(item?.id || '') !== String(journal.originalPrescriptionId || '') && (!item?.CreationDate || Number.isNaN(Date.parse(item.CreationDate)) || Date.parse(item.CreationDate) >= attemptedAt)).slice(0, 15);
        for (const candidate of candidates) {
            if (!candidate?.id) continue;
            let details;
            try { details = (await graphQL(PRESCRIPTION_DETAILS_QUERY(candidate.id))).GetPrescriptionDetails; } catch { continue; }
            if (!details || !Array.isArray(details.Medications)) continue;
            const tags = Array.isArray(details.Tags) ? details.Tags.map(tag => normalize(typeof tag === 'string' ? tag : tag?.name || tag?.Name)).map(normalizeKey) : [];
            const hzbs = new Set(details.Medications.map(item => normalize(item?.Drug_Dosage_Form_Id)).filter(Boolean));
            if (!tags.includes('split') || !expected.every(hzb => hzbs.has(hzb))) continue;
            return { id: String(details.id || candidate.id), PrescriptionNumber: String(details.PrescriptionNumber || candidate.PrescriptionNumber || ''), formNumber: String(details.FHIRReference || ''), CreationDate: details.CreationDate || candidate.CreationDate || '', tags };
        }
        return null;
    }
    function getPreparedFromJournal(journal) {
        const selectedDrugs = journal.selectedDrugs.map(drug => ({ ...drug }));
        return {
            selectedDrugs,
            input: { medications: Array.from({ length: Number(journal.selectedCount) || selectedDrugs.length }, () => ({})) },
            details: { Medications: Array.from({ length: Number(journal.originalMedicationCount) || selectedDrugs.length + 1 }, () => ({})) },
            messageId: Number(journal.splitLogMessageId || 0),
            input: { medications: Array.from({ length: Number(journal.selectedCount) || selectedDrugs.length }, () => ({})), cardNumber: journal.cardNumber || '' },
            prescription: { id: journal.originalPrescriptionId || '', PrescriptionNumber: journal.formNumber || '' }
        };
    }
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
        const params = new URLSearchParams(location.search);
        const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
        const values = [params.get('id'), params.get('res_id'), hash.get('id')];
        for (const value of values) if (/^\d+$/.test(String(value || ''))) return Number(value);
        const modelNodes = [...document.querySelectorAll('[data-oe-model="helpdesk.ticket"][data-oe-id]')];
        for (const element of modelNodes) {
            const value = element.getAttribute('data-oe-id');
            if (/^\d+$/.test(String(value || ''))) return Number(value);
        }
        const forms = [...document.querySelectorAll('.o_form_view, .o_form_renderer')];
        for (const element of forms) {
            const value = element.getAttribute('data-res-id') || element.getAttribute('data-oe-id');
            if (/^\d+$/.test(String(value || ''))) return Number(value);
        }
        const model = params.get('model') || hash.get('model') || '';
        const activeId = params.get('active_id') || hash.get('active_id') || '';
        return model === 'helpdesk.ticket' && /^\d+$/.test(activeId) ? Number(activeId) : 0;
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

    async function getTicketStage(ticketId) {
        const record = (await rpc('helpdesk.ticket', 'read', [[ticketId], ['stage_id', 'previous_state_id', 'team_id']], { context: getSessionContext() }))?.[0];
        if (!record) throw new Error('Odoo could not read the ticket stage.');
        const teamId = Number(Array.isArray(record.team_id) ? record.team_id[0] : record.team_id) || 69;
        const stages = await rpc('helpdesk.stage', 'search_read', [[['name', '=', 'Confirmed Alternatives']]], {
            fields: ['id', 'name', 'team_ids'],
            limit: 100,
            context: getSessionContext()
        });
        const teamMatches = (stages || []).filter(stage => Array.isArray(stage.team_ids) && stage.team_ids.map(Number).includes(teamId));
        const unassignedMatches = (stages || []).filter(stage => !Array.isArray(stage.team_ids) || !stage.team_ids.length);
        const matches = teamMatches.length ? teamMatches : unassignedMatches.length ? unassignedMatches : stages || [];
        if (matches.length !== 1) throw new Error('Could not uniquely identify the Confirmed Alternatives stage for this ticket team.');
        return { record, teamId, confirmed: matches[0] };
    }

    async function getClosingStage(teamId) {
        const stages = await rpc('helpdesk.stage', 'search_read', [[['is_close', '=', true]]], {
            fields: ['id', 'name', 'team_ids'],
            limit: 100,
            context: getSessionContext()
        });
        if (!Array.isArray(stages)) throw new Error('Odoo did not return closing stages.');
        const teamMatches = stages.filter(stage => Array.isArray(stage.team_ids) && stage.team_ids.map(Number).includes(teamId));
        const unassignedMatches = stages.filter(stage => !Array.isArray(stage.team_ids) || !stage.team_ids.length);
        const matches = teamMatches.length ? teamMatches : unassignedMatches.length ? unassignedMatches : stages;
        if (matches.length !== 1) throw new Error('Could not uniquely identify the closing stage for this ticket team. The ticket was left open.');
        return matches[0];
    }

    async function setConfirmedAlternativesStage() {
        const ticketId = Number(state.ticketId || getTicketId());
        if (!ticketId) throw new Error('Ticket ID is unavailable while changing the stage.');
        const stages = await getTicketStage(ticketId);
        const target = stages.confirmed;
        const currentId = Number(Array.isArray(stages.record.stage_id) ? stages.record.stage_id[0] : stages.record.stage_id || 0);
        if (currentId === Number(target.id)) return { changed: false, stageId: currentId, stageName: target.name };
        const values = { stage_id: Number(target.id) };
        if (currentId > 0) values.previous_state_id = currentId;
        const context = {
            ...getActionContext(),
            active_model: 'helpdesk.team',
            active_id: stages.teamId,
            active_ids: [stages.teamId],
            default_team_id: stages.teamId
        };
        const written = await rpc('helpdesk.ticket', 'write', [[ticketId], values], { context });
        if (written !== true) throw new Error('Odoo did not confirm the ticket stage update.');
        const verified = (await rpc('helpdesk.ticket', 'read', [[ticketId], ['stage_id', 'previous_state_id']], { context: getSessionContext() }))?.[0];
        const verifiedId = Number(Array.isArray(verified?.stage_id) ? verified.stage_id[0] : verified?.stage_id || 0);
        if (verifiedId !== Number(target.id)) throw new Error('The ticket did not reach ' + target.name + '. Split was stopped.');
        return { changed: true, stageId: verifiedId, stageName: target.name };
    }

    async function ensureConfirmedAlternativesStage() {
        return setConfirmedAlternativesStage();
    }

    async function isTicketClosed() {
        const ticketId = Number(state.ticketId || getTicketId());
        const stages = await getTicketStage(ticketId);
        const closing = await getClosingStage(stages.teamId);
        const currentId = Number(Array.isArray(stages.record.stage_id) ? stages.record.stage_id[0] : stages.record.stage_id || 0);
        return currentId === Number(closing.id);
    }

    async function waitForAutomaticTicketClosure(timeout = 8000) {
        const ticketId = Number(state.ticketId || getTicketId());
        if (!ticketId) throw new Error('Ticket ID is unavailable while verifying automatic closure.');
        const stages = await getTicketStage(ticketId);
        const closing = await getClosingStage(stages.teamId);
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            const record = (await rpc('helpdesk.ticket', 'read', [[ticketId], ['stage_id']], { context: getSessionContext() }))?.[0];
            const currentId = Number(Array.isArray(record?.stage_id) ? record.stage_id[0] : record?.stage_id || 0);
            if (currentId === Number(closing.id)) return true;
            await sleep(350);
        }
        return false;
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

    function getExpiryInfo(cycle) {
        const expiryDate = new Date(cycle.year, cycle.month, 22);
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

        const expiryInfo = getExpiryInfo(cycle);
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

        assertSplitLeavesOriginalMedication(medications.length, details.Medications);

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

    function assertSplitLeavesOriginalMedication(selectedCount, originalMedications) {
        if (!Array.isArray(originalMedications) || !originalMedications.length) throw new Error('The original Portal prescription medication list is missing. Split was stopped to protect the original prescription.');
        if (!Number.isInteger(selectedCount) || selectedCount < 1 || selectedCount >= originalMedications.length) throw new Error('Split is not allowed when the selected items are all medications in the original prescription. At least one original medication must remain.');
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
        assertSplitLeavesOriginalMedication(prepared?.input?.medications?.length, prepared?.details?.Medications);
        const ticketId = Number(state.ticketId || getTicketId());
        if (!ticketId) throw new Error('Current Odoo ticket ID is unavailable.');
        const targets = [...new Map(prepared.selectedDrugs.map(drug => [normalize(drug.hzb), { name: normalize(drug.name), hzb: normalize(drug.hzb) }])).values()];
        if (!targets.length || targets.some(target => !/^\d+$/.test(target.hzb))) throw new Error('Selected medications do not contain valid HZB values.');
        const baselineId = await getLatestMessageId(ticketId);
        const context = getTicketFormContext(ticketId);
        const fetchContext = getActionContext();
        fetchContext.params = { ...(fetchContext.params || {}), view_type: 'form' };
        let action;
        try {
            action = await rpcButton('helpdesk.ticket', 'action_fetch_suitable_alternatives', [[ticketId]], fetchContext);
        } catch (error) {
            throw new Error('Odoo fresh Fetch failed before cleanup. ' + (error?.message || 'Failed to get alternative'));
        }
        const actionText = typeof action === 'string' ? action : JSON.stringify(action || {});
        if (/No items need to check/i.test(actionText)) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            return { success: true, count: targets.length, alreadyRemoved: targets.length, names: targets.map(target => target.name), noteId: 0 };
        }
        const wizardId = Number(action?.res_id || 0);
        if (!wizardId) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('Odoo Fetch did not return an alternatives wizard after the Portal split. No delete action was submitted.');
        }
        const wizard = (await rpc('alternative.wizard', 'read', [[wizardId], ['alternative_lines_ids', 'non_selected_drugs']], { context }))?.[0];
        const hasDrugList = typeof wizard?.non_selected_drugs === 'string';
        const listedText = hasDrugList ? normalize(wizard.non_selected_drugs) : '';
        const isListed = target => hasDrugList && new RegExp('(?:^|\\\\D)' + target.hzb + '(?:\\\\D|$)').test(listedText);
        const lineIds = Array.isArray(wizard?.alternative_lines_ids) ? wizard.alternative_lines_ids.map(Number).filter(id => id > 0) : [];
        if (!lineIds.length) {
            const stillPresent = targets.filter(isListed);
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            if (!stillPresent.length && hasDrugList) return { success: true, count: targets.length, alreadyRemoved: targets.length, names: targets.map(target => target.name), noteId: 0 };
            throw new Error(!hasDrugList
                ? 'Odoo returned no alternative wizard lines and no verifiable Limited Drugs list. Cleanup was not repeated.'
                : 'Odoo Fetch returned no alternative wizard lines while selected HZBs are still present: ' + stillPresent.map(target => target.hzb).join(', '));
        }
        const relation = await rpc('alternative.wizard', 'fields_get', [['alternative_lines_ids']], { attributes: ['relation'], context });
        const lineModel = relation?.alternative_lines_ids?.relation;
        if (!lineModel) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('Could not identify Odoo alternative wizard line model.');
        }
        const lines = await rpc(lineModel, 'read', [lineIds, ['is_header', 'limited_drug', 'replace_or_delete_line']], { context });
        if (!Array.isArray(lines) || !lines.length) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('Odoo returned no readable alternative wizard lines.');
        }
        const selectedHeaders = new Map();
        for (const target of targets) {
            const matches = lines.filter(line => line?.is_header === true && getHbzFromWizardLine(line) === target.hzb);
            if (matches.length > 1) {
                await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
                throw new Error('Odoo returned duplicate matches for ' + target.name + ' (HZB ' + target.hzb + '). No delete action was submitted.');
            }
            if (matches.length === 1) selectedHeaders.set(target.hzb, Number(matches[0].id));
        }
        const unmatchedStillPresent = targets.filter(target => !selectedHeaders.has(target.hzb) && isListed(target));
        if (unmatchedStillPresent.length) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('Odoo still lists these selected HZBs, but their wizard header could not be matched safely: ' + unmatchedStillPresent.map(target => target.hzb).join(', ') + '. No deletion was submitted.');
        }
        const pendingTargets = targets.filter(target => selectedHeaders.has(target.hzb));
        if (!pendingTargets.length) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            return { success: true, count: targets.length, alreadyRemoved: targets.length, names: targets.map(target => target.name), noteId: 0 };
        }
        const selectedLineIds = new Set(selectedHeaders.values());
        const commands = lines.map(line => {
            const id = Number(line.id);
            return selectedLineIds.has(id) ? [1, id, { replace_or_delete_line: 'del' }] : [4, id, false];
        });
        if (commands.length !== lineIds.length || commands.some(command => !command[1])) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error('The Odoo wizard line update could not be prepared safely.');
        }
        const written = await rpc('alternative.wizard', 'write', [[wizardId], { alternative_lines_ids: commands }], { context });
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
        try { await rpcButton('alternative.wizard', 'action_add_alternatives', [[wizardId]], context); }
        catch (error) { actionError = error; }
        let note;
        try { note = await waitForRemovedLimitedDrugsNote(ticketId, baselineId, pendingTargets); }
        catch (error) {
            await removeFetchMessages(ticketId, prepared.selectedDrugs, baselineId);
            throw new Error(actionError
                ? 'Odoo delete action response was uncertain: ' + (actionError.message || 'Unknown error') + '. ' + error.message
                : error.message);
        }
        return {
            success: true,
            count: targets.length,
            deletedNow: pendingTargets.length,
            alreadyRemoved: targets.length - pendingTargets.length,
            names: targets.map(target => target.name),
            noteId: Number(note.id)
        };
    }

    async function checkRemainingLimitedDrugs() {
        const ticketId = Number(state.ticketId || getTicketId());
        const baselineId = await getLatestMessageId(ticketId);
        const context = getActionContext();
        context.params = { ...(context.params || {}), view_type: 'form' };
        const action = await rpcButton('helpdesk.ticket', 'action_fetch_suitable_alternatives', [[ticketId]], context);
        if (/No items need to check/i.test(JSON.stringify(action || {}))) {
            await removeFetchMessages(ticketId, [], baselineId);
            return { noItems: true, drugs: [] };
        }
        const wizardId = Number(action?.res_id || 0);
        if (!wizardId) throw new Error('Odoo did not return a verifiable result for the remaining limited drugs.');
        const wizard = (await rpc('alternative.wizard', 'read', [[wizardId]], {
            fields: ['non_selected_drugs', 'alternative_lines_ids'],
            context: getTicketFormContext(ticketId)
        }))?.[0];
        if (!wizard || !Object.prototype.hasOwnProperty.call(wizard, 'non_selected_drugs')) throw new Error('Odoo did not return the remaining limited-drug data.');
        let drugs = parseFetchedDrugs(wizard.non_selected_drugs);
        if (!drugs.length && Array.isArray(wizard.alternative_lines_ids) && wizard.alternative_lines_ids.length) {
            const fields = await rpc('alternative.wizard', 'fields_get', [['alternative_lines_ids']], {
                attributes: ['relation'],
                context: getSessionContext()
            });
            const lineModel = fields?.alternative_lines_ids?.relation;
            if (!lineModel) throw new Error('Could not identify the remaining alternative wizard line model.');
            const lines = await rpc(lineModel, 'read', [wizard.alternative_lines_ids], {
                fields: ['is_header', 'limited_drug'],
                context: getSessionContext()
            });
            drugs = (lines || []).filter(line => line?.is_header === true).map(line => extractDrug(line.limited_drug)).filter(Boolean);
            drugs = [...new Map(drugs.map(drug => [drug.hzb, drug])).values()];
        }
        await removeFetchMessages(ticketId, drugs, baselineId);
        return { noItems: drugs.length === 0, drugs };
    }

    async function findExistingSplitLogNote(ticketId, baselineId, targets) {
        const messages = await rpc('mail.message', 'search_read', [[
            ['model', '=', 'helpdesk.ticket'],
            ['res_id', '=', ticketId]
        ]], {
            fields: ['id', 'body'],
            order: 'id desc',
            limit: 50,
            context: getSessionContext()
        });
        return (messages || []).find(item => {
            const plain = getPlainMessage(item.body);
            if (!/\bSPLIT\b/i.test(plain)) return false;
            const hzbs = [...plain.matchAll(/,\s*(\d+)\b/g)].map(match => match[1]);
            return targets.every(target => hzbs.includes(target.hzb));
        }) || null;
    }

    async function waitForSplitLogNote(ticketId, baselineId, targets, timeout = 12000) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            const messages = await rpc('mail.message', 'search_read', [[
                ['model', '=', 'helpdesk.ticket'],
                ['res_id', '=', ticketId],
                ...(baselineId ? [['id', '>', baselineId]] : [])
            ]], {
                fields: ['id', 'body'],
                order: 'id desc',
                limit: 30,
                context: getSessionContext()
            });
            const message = (messages || []).find(item => {
                const plain = getPlainMessage(item.body);
                if (!/\bSPLIT\b/i.test(plain)) return false;
                const hzbs = [...plain.matchAll(/,\s*(\d+)\b/g)].map(match => match[1]);
                return targets.every(target => hzbs.includes(target.hzb));
            });
            if (message) return message;
            await sleep(180);
        }
        throw new Error('Odoo did not confirm the SPLIT Log Note in Chatter.');
    }

    async function postSplitLogNote(prepared) {
        const ticketId = Number(state.ticketId || getTicketId());
        if (!ticketId) throw new Error('Ticket ID is unavailable while posting the SPLIT note.');
        const targets = prepared.selectedDrugs.map(drug => ({ name: normalize(drug.name), hzb: normalize(drug.hzb) }));
        if (!state.splitLogBaselineId) state.splitLogBaselineId = await getLatestMessageId(ticketId);
        const baselineId = state.splitLogBaselineId;
        const note = prepared.selectedDrugs.map(drug => 'Limited Drug: ' + (cleanDrugName(drug.limited) || [drug.name, drug.hzb].join(', '))).join('\n') + '\nSPLIT';
        const message = await findExistingSplitLogNote(ticketId, baselineId, targets);
        let messageId = Number(message?.id || 0);
        if (!messageId) {
            messageId = Number(await rpc('helpdesk.ticket', 'message_post', [ticketId], {
                attachment_ids: [],
                body: note.replace(/\n/g, '<br>'),
                channel_ids: [],
                message_type: 'comment',
                partner_ids: [],
                subtype_xmlid: 'mail.mt_note',
                context: getSessionContext()
            }) || 0);
        }
        if (!messageId) throw new Error('Odoo did not return a valid SPLIT Chatter message ID.');
        const formatted = await rpc('mail.message', 'message_format', [[messageId]], { context: getSessionContext() });
        if (!Array.isArray(formatted) || !formatted.some(item => Number(item?.id) === messageId)) throw new Error('Odoo did not confirm formatting of the SPLIT Chatter message.');
        state.logPosted = true;
        return { posted: true, messageId, targets };
    }

    async function refreshTicketComponentsWithAssignToMe(prepared) {
        const ticketId = Number(state.ticketId || getTicketId());
        const uid = Number(getSessionContext().uid || 0);
        if (!ticketId || !uid) throw new Error('The ticket or current Odoo user could not be verified for the component refresh.');
        const record = (await rpc('helpdesk.ticket', 'read', [[ticketId], ['user_id']], { context: getSessionContext() }))?.[0];
        const assignedId = Number(Array.isArray(record?.user_id) ? record.user_id[0] : record?.user_id || 0);
        if (!record || assignedId !== uid) throw new Error('The ticket is not assigned to the current user. The Assign to Me refresh was stopped to avoid changing ticket ownership.');
        const selectors = [
            'button[name="assign_ticket_to_self"]',
            'button[data-name="assign_ticket_to_self"]',
            'a[name="assign_ticket_to_self"]',
            '[role="button"][name="assign_ticket_to_self"]'
        ];
        let button = selectors.flatMap(selector => [...document.querySelectorAll(selector)]).find(element => isVisible(element) && !element.disabled);
        if (!button) {
            button = [...document.querySelectorAll('button, a, [role="button"]')].find(element =>
                isVisible(element) && !element.disabled && normalize(getText(element)).toLowerCase() === 'assign to me'
            );
        }
        if (!button) throw new Error('The native Assign to Me button was not found. The Chatter component refresh was not triggered.');
        const targets = prepared.selectedDrugs.map(drug => normalize(drug.hzb));
        const hasSplitNote = () => [...document.querySelectorAll('.o_Message, .o-mail-Message')].some(element => {
            const plain = getText(element);
            return /\bSPLIT\b/i.test(plain) && targets.every(hzb => plain.includes(hzb));
        });
        let changed = false;
        const observer = new MutationObserver(() => { changed = true; });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
        try {
            button.click();
            const end = Date.now() + 12000;
            while (Date.now() < end) {
                if (changed && hasSplitNote()) return { refreshed: true, messageId: prepared.messageId || 0 };
                await sleep(100);
            }
        } finally {
            observer.disconnect();
        }
        if (!hasSplitNote()) throw new Error('Assign to Me was triggered, but Odoo did not refresh the SPLIT note in the Chatter components.');
        if (!changed) throw new Error('The SPLIT note exists, but Odoo component re-render was not detected after Assign to Me.');
        return { refreshed: true, messageId: prepared.messageId || 0 };
    }

    function injectStyles() {
        if (document.getElementById('ydDirectSplitStyles')) return;
        const style = document.createElement('style');
        style.id = 'ydDirectSplitStyles';
        style.textContent = `
#${CONFIG.DIALOG_ID}{--yds-primary:#875A7B;--yds-primary-strong:#68465F;--yds-primary-soft:#EEE7ED;--yds-soft:#E1E1E1;--yds-bg:#FFFFFF;--yds-surface:#FFFFFF;--yds-surface-muted:#E1E1E1;--yds-text:#302632;--yds-muted:#776C78;--yds-border:#E8E0E8;--yds-input-border:#DED5DF;--yds-success:#176B3A;--yds-success-bg:#E3F3E9;--yds-danger:#B42318;--yds-danger-bg:#FDE8E7;--yds-info:#477EAA;position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:20px;background:rgba(28,21,30,.56);backdrop-filter:blur(3px);font-family:"Nunito Sans",Nunito,Arial,sans-serif;color:var(--yds-text);font-size:14px;line-height:20px}
#${CONFIG.DIALOG_ID} *{box-sizing:border-box;font-family:inherit}
#${CONFIG.DIALOG_ID} :lang(ar),#${CONFIG.DIALOG_ID} :lang(ar) input,#${CONFIG.DIALOG_ID} :lang(ar) select{font-family:"Cairo","Noto Sans Arabic",Arial,sans-serif}
#${CONFIG.DIALOG_ID} .yds-panel{width:min(660px,calc(100vw - 32px));max-height:min(780px,calc(100dvh - 32px));display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--yds-border);border-radius:14px;background:var(--yds-bg);color:var(--yds-text);box-shadow:0 20px 56px rgba(24,16,27,.22);animation:yds-modal-enter .16s cubic-bezier(.4,0,.2,1) both}
#${CONFIG.DIALOG_ID} .yds-head{display:flex;align-items:center;gap:12px;min-width:0;padding:18px 20px;border-bottom:1px solid var(--yds-border);background:var(--yds-surface)}
#${CONFIG.DIALOG_ID} .yds-brand-mark{display:grid;place-items:center;flex:0 0 36px;width:36px;height:36px;border:1px solid var(--o-brand-primary,#714B67);border-radius:9px;background:var(--o-brand-primary,#714B67);color:#fff;font-size:16px;font-weight:800;line-height:1}
#${CONFIG.DIALOG_ID} .yds-head-copy{display:flex;flex:1;flex-direction:column;gap:1px;min-width:0}
#${CONFIG.DIALOG_ID} .yds-title{margin:0;color:var(--yds-text);font-size:17px;font-weight:700;letter-spacing:-.01em;line-height:24px}
#${CONFIG.DIALOG_ID} .yds-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px 20px;border-bottom:1px solid var(--yds-border);background:var(--yds-surface)}
#${CONFIG.DIALOG_ID} .yds-summary-card{display:flex;flex-direction:column;gap:3px;min-width:0;padding:9px 12px;border:1px solid var(--yds-border);border-radius:8px;background:var(--yds-surface-muted)}
#${CONFIG.DIALOG_ID} .yds-summary-label{display:block;color:var(--yds-muted);font-size:12px;font-weight:500;line-height:16px}
#${CONFIG.DIALOG_ID} .yds-summary-value{display:block;margin:0;color:var(--yds-text);font-size:14px;font-weight:700;line-height:20px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
#${CONFIG.DIALOG_ID} .yds-account{display:flex;flex-direction:column;gap:6px;padding:12px 20px;border-bottom:1px solid var(--yds-border);background:var(--yds-surface-muted)}
#${CONFIG.DIALOG_ID} .yds-account label{display:block;margin:0;color:var(--yds-text);font-size:13px;font-weight:600;line-height:18px}
#${CONFIG.DIALOG_ID} .yds-account select{width:100%;height:34px;min-height:34px;padding:0 11px;border:1px solid var(--yds-input-border);border-radius:8px;outline:0;background:var(--yds-bg);color:var(--yds-text);font-size:13px;font-weight:400;line-height:20px;transition:border-color .15s,box-shadow .15s}
#${CONFIG.DIALOG_ID} .yds-account select:hover{border-color:#C7B6C8}
#${CONFIG.DIALOG_ID} .yds-account select:focus-visible{border-color:var(--yds-primary);box-shadow:0 0 0 3px rgba(135,90,123,.14)}
#${CONFIG.DIALOG_ID} .yds-body{display:flex;flex:1;flex-direction:column;gap:10px;min-height:0;padding:16px 20px 18px;overflow:auto;background:var(--yds-bg)}
#${CONFIG.DIALOG_ID} .yds-content-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
#${CONFIG.DIALOG_ID} .yds-section-title{color:var(--yds-text);font-size:14px;font-weight:700;line-height:20px}
#${CONFIG.DIALOG_ID} .yds-section-hint{margin-top:1px;color:var(--yds-muted);font-size:12px;font-weight:400;line-height:16px}
#${CONFIG.DIALOG_ID} .yds-select-all{display:flex;align-items:center;gap:9px;min-height:36px;padding:7px 10px;margin:0;border:1px solid var(--o-brand-primary,#714B67);border-radius:8px;background:var(--o-brand-primary,#714B67);color:#fff;font-size:13px;font-weight:700;line-height:20px;cursor:pointer;transition:filter .15s,box-shadow .15s}
#${CONFIG.DIALOG_ID} .yds-select-all:hover{border-color:var(--o-brand-primary,#714B67);background:var(--o-brand-primary,#714B67);filter:brightness(.94)}
#${CONFIG.DIALOG_ID} .yds-select-hint{margin-left:auto;color:rgba(255,255,255,.82);font-size:12px;font-weight:600}
#${CONFIG.DIALOG_ID} .yds-list{display:flex;flex-direction:column;gap:6px}
#${CONFIG.DIALOG_ID} .yds-drug{display:flex;align-items:center;gap:11px;min-width:0;min-height:54px;padding:9px 12px;border:3px solid transparent;border-radius:8px;background:var(--yds-surface-muted);cursor:pointer;transition:border-color .15s,background-color .15s}
#${CONFIG.DIALOG_ID} .yds-drug:hover{border-color:var(--yds-primary);background:var(--yds-surface-muted)}
#${CONFIG.DIALOG_ID} .yds-drug:has(input:checked){border-color:var(--yds-primary);background:var(--yds-surface-muted);box-shadow:none}
#${CONFIG.DIALOG_ID} .yds-drug input,#${CONFIG.DIALOG_ID} .yds-select-all input{width:16px;height:16px;min-width:16px;margin:0;accent-color:var(--yds-primary);flex:0 0 auto;cursor:pointer}
#${CONFIG.DIALOG_ID} .yds-select-all input{accent-color:#fff}
#${CONFIG.DIALOG_ID} .yds-drug-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0}
#${CONFIG.DIALOG_ID} .yds-drug-name{color:var(--yds-text);font-size:14px;font-weight:600;line-height:20px;overflow-wrap:anywhere}
#${CONFIG.DIALOG_ID} .yds-drug-hzb{display:inline-flex;align-items:center;width:max-content;max-width:100%;margin:0;padding:1px 6px;border:1px solid var(--yds-border);border-radius:5px;background:var(--yds-surface-muted);color:var(--yds-muted);font-size:11px;font-weight:500;line-height:16px;font-variant-numeric:tabular-nums}
#${CONFIG.DIALOG_ID} .yds-drug-state{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;margin-left:auto;padding:2px 7px;border:1px solid #A8D5B7;border-radius:999px;background:var(--yds-success-bg);color:var(--yds-success);font-size:11px;font-weight:700;line-height:16px;white-space:nowrap}
#${CONFIG.DIALOG_ID} .yds-drug-state[hidden]{display:none!important}
#${CONFIG.DIALOG_ID} .yds-drug-state[data-kind="error"]{border-color:#E5B1AE;background:var(--yds-danger-bg);color:var(--yds-danger)}
#${CONFIG.DIALOG_ID} .yds-drug-state[data-kind="pending"]{border-color:#D4B46A;background:#FBF4E2;color:#8A641B}
#${CONFIG.DIALOG_ID} .yds-row-state-icon{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;background:var(--yds-success);color:#fff;font-size:10px;font-weight:700}
#${CONFIG.DIALOG_ID} .yds-drug-state[data-kind="error"] .yds-row-state-icon{background:var(--yds-danger)}
#${CONFIG.DIALOG_ID} .yds-footer{display:flex;flex-direction:column;gap:10px;padding:12px 20px 16px;border-top:1px solid var(--yds-border);background:var(--yds-surface)}
#${CONFIG.DIALOG_ID} .yds-status{display:none;align-items:center;gap:9px;min-height:36px;padding:7px 10px;margin:0;border:1px solid var(--yds-border);border-radius:8px;background:var(--yds-surface-muted);color:var(--yds-text);font-size:13px;font-weight:600;line-height:18px}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="error"],#${CONFIG.DIALOG_ID} .yds-status[data-kind="success"],#${CONFIG.DIALOG_ID} .yds-status[data-kind="info"]{display:flex}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="error"]{border-color:#E5B1AE;background:var(--yds-danger-bg);color:var(--yds-danger)}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="success"]{border-color:#A8D5B7;background:var(--yds-success-bg);color:var(--yds-success)}
#${CONFIG.DIALOG_ID} .yds-status-icon{display:inline-grid;place-items:center;flex:0 0 20px;width:20px;height:20px;border-radius:50%;background:var(--yds-info);color:#fff;font-size:13px;font-weight:700;line-height:1}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="success"] .yds-status-icon{background:var(--yds-success)}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="error"] .yds-status-icon{background:var(--yds-danger)}
#${CONFIG.DIALOG_ID} .yds-status[data-kind="info"] .yds-status-icon{width:16px;height:16px;flex-basis:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;background:transparent;animation:yds-rotate .7s linear infinite}
#${CONFIG.DIALOG_ID} .yds-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
#${CONFIG.DIALOG_ID} .yds-count{color:var(--yds-muted);font-size:13px;font-weight:500;line-height:20px;font-variant-numeric:tabular-nums}
#${CONFIG.DIALOG_ID} .yds-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px}
#${CONFIG.DIALOG_ID} .yds-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:88px;min-height:32px;padding:5px 12px;border:1px solid var(--yds-input-border);border-radius:8px;background:var(--yds-bg);color:var(--yds-text);font-size:13px;font-weight:600;line-height:20px;cursor:pointer;transition:background-color .15s,border-color .15s,color .15s,box-shadow .15s}
#${CONFIG.DIALOG_ID} .yds-button:hover:not(:disabled){border-color:#CDBCCD;background:var(--yds-primary-subtle)}
#${CONFIG.DIALOG_ID} .yds-button:focus-visible{outline:0;box-shadow:0 0 0 3px rgba(135,90,123,.18)}
#${CONFIG.DIALOG_ID} .yds-button-primary{min-height:36px;padding:7px 16px;border-color:var(--yds-primary);background:var(--yds-primary);color:#fff;box-shadow:0 1px 2px rgba(104,70,95,.12)}
#${CONFIG.DIALOG_ID} .yds-button-primary:hover:not(:disabled){border-color:var(--yds-primary-strong);background:var(--yds-primary-strong);color:#fff}
#${CONFIG.DIALOG_ID} .yds-button:disabled{border-color:var(--yds-border);background:var(--yds-surface-muted);color:#A69AA7;opacity:1;cursor:not-allowed;box-shadow:none}
#${CONFIG.DIALOG_ID} .yds-spin{display:inline-block;width:14px;height:14px;margin-right:2px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:yds-rotate .7s linear infinite}
#${CONFIG.DIALOG_ID} [hidden]{display:none!important}
@keyframes yds-rotate{to{transform:rotate(360deg)}}
@keyframes yds-modal-enter{from{opacity:0;transform:translateY(5px) scale(.995)}to{opacity:1;transform:translateY(0) scale(1)}}
html.dark #${CONFIG.DIALOG_ID},html[data-theme="dark"] #${CONFIG.DIALOG_ID},body.dark #${CONFIG.DIALOG_ID}{--yds-primary:#A9799C;--yds-primary-strong:#875A7B;--yds-primary-soft:#382B38;--yds-soft:#2B232B;--yds-bg:#19151A;--yds-surface:#211C23;--yds-surface-muted:#2B252E;--yds-text:#F5EFF5;--yds-muted:#B7ABB8;--yds-border:#403543;--yds-input-border:#514353;--yds-success:#63CF91;--yds-success-bg:#203A2D;--yds-danger:#FF7770;--yds-danger-bg:#472625;--yds-info:#78A9D0}
@media(max-width:520px){
#${CONFIG.DIALOG_ID}{padding:12px}
#${CONFIG.DIALOG_ID} .yds-panel{width:100%;max-height:calc(100dvh - 24px);border-radius:12px}
#${CONFIG.DIALOG_ID} .yds-head{padding:14px 15px}
#${CONFIG.DIALOG_ID} .yds-summary{gap:7px;padding:10px 15px}
#${CONFIG.DIALOG_ID} .yds-summary-card{padding:8px 10px}
#${CONFIG.DIALOG_ID} .yds-account{padding:10px 15px}
#${CONFIG.DIALOG_ID} .yds-body{padding:13px 15px 15px}
#${CONFIG.DIALOG_ID} .yds-footer{padding:11px 15px 13px}
#${CONFIG.DIALOG_ID} .yds-drug{align-items:center;padding:9px 10px}
#${CONFIG.DIALOG_ID} .yds-drug-state{margin-left:0}
#${CONFIG.DIALOG_ID} .yds-buttons{gap:6px}
#${CONFIG.DIALOG_ID} .yds-button{min-width:78px;padding:5px 10px}
}
@media(max-width:360px){
#${CONFIG.DIALOG_ID} .yds-summary{grid-template-columns:1fr}
#${CONFIG.DIALOG_ID} .yds-drug{flex-wrap:wrap}
#${CONFIG.DIALOG_ID} .yds-drug-state{margin-left:27px}
#${CONFIG.DIALOG_ID} .yds-actions{align-items:flex-start;flex-direction:column}
#${CONFIG.DIALOG_ID} .yds-buttons{width:100%}
#${CONFIG.DIALOG_ID} .yds-button{flex:1}
}
@media(prefers-reduced-motion:reduce){#${CONFIG.DIALOG_ID} *,#ydDirectSplitButton{animation:none!important;transition:none!important}}
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
                : kind === 'pending' ? '<span class="yds-row-state-icon">!</span><span>SPLIT CREATED</span>'
                : '<span class="yds-row-state-icon">×</span><span>FAILED</span>';
        });
    }

    function revealDeferredChatterMessages() {
        state.deferredChatterObserver?.disconnect();
        state.deferredChatterObserver = null;
        document.querySelectorAll('[data-yds-deferred-chatter="1"]').forEach(element => {
            element.style.display = element.dataset.ydsPreviousDisplay || '';
            delete element.dataset.ydsDeferredChatter;
            delete element.dataset.ydsPreviousDisplay;
        });
    }

    function startDeferredChatterHiding(drugs) {
        revealDeferredChatterMessages();
        const targets = drugs.map(drug => normalize(drug.hzb)).filter(Boolean);
        const inspect = element => {
            if (!element || element.nodeType !== 1) return;
            const roots = new Set();
            const closest = element.closest('.o_Message, .o-mail-Message');
            if (closest) roots.add(closest);
            if (element.matches('.o_Message, .o-mail-Message')) roots.add(element);
            element.querySelectorAll('.o_Message, .o-mail-Message').forEach(root => roots.add(root));
            for (const root of roots) {
                const plain = getText(root);
                if (!/Removed Limited Drugs/i.test(plain) || !targets.every(hzb => plain.includes(hzb))) continue;
                if (root.dataset.ydsDeferredChatter === '1') continue;
                root.dataset.ydsPreviousDisplay = root.style.display || '';
                root.dataset.ydsDeferredChatter = '1';
                root.style.display = 'none';
            }
        };
        state.deferredChatterObserver = new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) inspect(node.nodeType === 1 ? node : node.parentElement);
        });
        state.deferredChatterObserver.observe(document.body, { childList: true, subtree: true });
    }

    function closeDialog() {
        if (state.busy || (state.pendingSplitLog && !state.logPosted)) return;
        revealDeferredChatterMessages();
        state.dialog?.remove();
        state.dialog = null;
        document.removeEventListener('keydown', state.keydown, true);
    }

    async function closeDialogAction() {
        if (state.busy) return;
        if (!state.pendingSplitLog || (state.logPosted && state.componentsRefreshed)) { closeDialog(); return; }
        const button = state.dialog?.querySelector('[data-cancel]');
        state.busy = true;
        if (button) { button.disabled = true; button.innerHTML = '<span class="yds-spin"></span>FINALIZING'; }
        revealDeferredChatterMessages();
        setStatus(state.logPosted ? 'Refreshing the Odoo Chatter components...' : 'Publishing the SPLIT note to Odoo Chatter...', 'info');
        try {
            let posted = { messageId: Number(state.journal?.splitLogMessageId || state.pendingSplitLog.messageId || 0) };
            if (!state.logPosted) {
                posted = await postSplitLogNote(state.pendingSplitLog);
                if (state.journal) updateSplitJournal({ splitLogPosted: true, splitLogMessageId: posted.messageId, phase: 'chatter_pending' });
            }
            if (!state.componentsRefreshed) {
                await refreshTicketComponentsWithAssignToMe({ ...state.pendingSplitLog, messageId: posted.messageId });
                state.componentsRefreshed = true;
                if (state.journal) updateSplitJournal({ componentsRefreshed: true });
            }
            if (state.journal) updateSplitJournal({ completed: true, phase: 'completed' });
            state.pendingSplitLog = null;
            state.busy = false;
            setStatus('SPLIT NOTE SAVED — ODOO COMPONENTS REFRESHED', 'success');
            closeDialog();
        } catch (error) {
            state.busy = false;
            if (button) { button.disabled = false; button.textContent = state.logPosted ? 'RETRY REFRESH' : 'RETRY CHATTER'; }
            setStatus('SPLIT COMPLETED — FINALIZATION NEEDS RETRY', 'error', error?.message || 'The SPLIT note or Odoo Chatter refresh could not be confirmed.');
        }
    }

    async function resumeSplitWorkflow() {
        if (state.busy || !state.journal) return;
        state.busy = true;
        const prepared = getPreparedFromJournal(state.journal);
        const primary = state.dialog?.querySelector('[data-submit]');
        const close = state.dialog?.querySelector('[data-cancel]');
        if (primary) { primary.disabled = true; primary.innerHTML = '<span class="yds-spin"></span>RETRYING'; }
        if (close) close.disabled = true;
        try {
            if (!state.journal.portalCreated) {
                setStatus('Verifying the Portal response before any Odoo action...', 'info');
                const found = await findCreatedSplitErx(state.journal);
                if (!found) throw new Error('Portal has not confirmed a matching SPLIT prescription yet. No Odoo item was deleted. Retry after the Portal history is updated.');
                updateSplitJournal({ portalCreated: true, portalStatus: 'confirmed_by_history', portalResponse: { isSuccess: true, verified: true, prescriptionId: found.id, prescriptionNumber: found.PrescriptionNumber }, portalErx: found, portalErxUrl: buildErxUrl(found), phase: 'cleanup_pending' });
            }
            if (!state.journal.cleanupCompleted) {
                setStatus('Checking the current Odoo items before cleanup...', 'info');
                const cleanup = await deleteSplitItemsFromOdoo(prepared);
                updateSplitJournal({ cleanupCompleted: true, removedNoteId: Number(cleanup.noteId || 0), phase: 'cleanup_complete' });
            }
            if (!state.journal.ticketStatusChecked) {
                let ticketClosed = false;
                let closeError = '';
                try {
                    ticketClosed = await isTicketClosed();
                    if (!ticketClosed) {
                        const remaining = await checkRemainingLimitedDrugs();
                        if (remaining.noItems) {
                            ticketClosed = await waitForAutomaticTicketClosure();
                            if (!ticketClosed) closeError = 'No remaining Limited Drugs were returned, but automatic ticket closure was not confirmed.';
                        }
                    }
                } catch (error) { closeError = error?.message || 'Ticket closure could not be verified.'; }
                updateSplitJournal({ ticketStatusChecked: true, ticketClosed, closeError });
            }
            state.pendingSplitLog = prepared;
            state.splitLogBaselineId = Number(state.journal.baselineMessageId || 0);
            state.logPosted = Boolean(state.journal.splitLogPosted);
            state.componentsRefreshed = Boolean(state.journal.componentsRefreshed);
            if (!state.logPosted) {
                setStatus('Saving the SPLIT note...', 'info');
                const posted = await postSplitLogNote(prepared);
                updateSplitJournal({ splitLogPosted: true, splitLogMessageId: posted.messageId, phase: 'chatter_pending' });
            }
            if (!state.componentsRefreshed) {
                setStatus('Refreshing Odoo Chatter components...', 'info');
                await refreshTicketComponentsWithAssignToMe({ ...prepared, messageId: Number(state.journal.splitLogMessageId || 0) });
                state.componentsRefreshed = true;
                updateSplitJournal({ componentsRefreshed: true });
            }
            updateSplitJournal({ completed: true, phase: 'completed' });
            state.pendingSplitLog = null;
            setStatus('SPLIT COMPLETED — ODOO CLEANUP & CHATTER CONFIRMED', 'success', state.journal.closeError || '');
            if (primary) { primary.disabled = true; primary.textContent = 'COMPLETED'; }
            if (close) { close.disabled = false; close.textContent = 'CLOSE'; }
            markSelectedDrugs(prepared.selectedDrugs, 'success');
            closeVerificationTab();
        } catch (error) {
            setStatus('SPLIT ALREADY CREATED — RETRY REQUIRED', 'error', error?.message || 'The remaining Odoo step could not be confirmed.');
            if (primary) {
                primary.disabled = false;
                primary.textContent = 'RETRY';
            }
            if (close) { close.disabled = false; close.textContent = 'CLOSE'; }
            openErxAfterFailure(state.journal?.portalErxUrl || state.journal?.sourceErxUrl || '');
        } finally { state.busy = false; }
    }

    function showResumeDialog(journal) {
        injectStyles();
        state.dialog?.remove();
        const overlay = document.createElement('div');
        overlay.id = CONFIG.DIALOG_ID;
        const drugs = journal.selectedDrugs || [];
        const completed = Boolean(journal.completed);
        const needsPortalCheck = !journal.portalCreated && ['portal_creation_started', 'portal_creation_uncertain'].includes(journal.phase);
        overlay.innerHTML = `<section class="yds-panel" role="dialog" aria-modal="true" aria-labelledby="yds-title">
            <header class="yds-head"><span class="yds-brand-mark" aria-label="Split Prescription">S</span><div class="yds-head-copy"><div class="yds-title" id="yds-title">Split Prescription Recovery</div></div></header>
            <div class="yds-summary">
                <div class="yds-summary-card"><span class="yds-summary-label">Odoo Ticket</span><strong class="yds-summary-value">${escapeHTML(journal.ticketId)}</strong></div>
                <div class="yds-summary-card"><span class="yds-summary-label">Split status</span><strong class="yds-summary-value">${completed ? 'Completed' : journal.portalCreated ? 'Portal confirmed' : 'Portal verification required'}</strong></div>
            </div>
            <div class="yds-body">
                <div class="yds-content-head"><div><div class="yds-section-title">Medications</div><div class="yds-section-hint">Previously selected items. A new Portal split will not be created.</div></div></div>
                <div class="yds-list">${drugs.map(drug => `<label class="yds-drug"><input type="checkbox" checked disabled><span class="yds-drug-copy"><span class="yds-drug-name">${escapeHTML(drug.name)}</span><span class="yds-drug-hzb">HZB: ${escapeHTML(drug.hzb)}</span></span><span class="yds-drug-state" data-kind="${completed ? 'success' : 'error'}"><span class="yds-row-state-icon">${completed ? '✓' : '!'}</span><span>${completed ? 'COMPLETED' : journal.cleanupCompleted ? 'CLEANUP DONE' : 'SPLIT CREATED'}</span></span></label>`).join('')}</div>
            </div>
            <footer class="yds-footer">
                <div class="yds-status" aria-live="polite"><span class="yds-status-icon"></span><span class="yds-status-text"></span></div>
                <div class="yds-actions"><span class="yds-count">${drugs.length} protected item(s)</span><div class="yds-buttons"><button type="button" class="yds-button" data-cancel>CLOSE</button><button type="button" class="yds-button yds-button-primary" data-submit ${completed ? 'disabled' : ''}>${completed ? 'COMPLETED' : 'RETRY'}</button></div></div>
            </footer>
        </section>`;
        document.body.appendChild(overlay);
        state.dialog = overlay;
        state.ticketId = Number(journal.ticketId);
        state.journal = journal;
        state.accountId = String(journal.portalAccountId || '');
        state.payer = getPayerConfig();
        state.splitLogBaselineId = Number(journal.baselineMessageId || 0);
        state.logPosted = Boolean(journal.splitLogPosted);
        state.componentsRefreshed = Boolean(journal.componentsRefreshed);
        if (journal.cleanupCompleted && !journal.completed) state.pendingSplitLog = getPreparedFromJournal(journal);
        const primary = overlay.querySelector('[data-submit]');
        const close = overlay.querySelector('[data-cancel]');
        if (completed) setStatus('This ticket already has a confirmed Split. Creating another Split is blocked.', 'success');
        else if (needsPortalCheck) setStatus('Portal response was not confirmed. RETRY will check Portal history first and will not delete anything unless the Split is verified.', 'error');
        else setStatus(journal.cleanupCompleted ? 'Portal Split is confirmed. RETRY will continue only the unfinished Chatter step.' : 'Portal Split is confirmed. RETRY will continue Odoo cleanup without creating another prescription.', 'info');
        primary.addEventListener('click', () => { state.verificationTab = reserveVerificationTab(); resumeSplitWorkflow(); });
        close.addEventListener('click', () => {
            if (state.busy) return;
            if (state.pendingSplitLog && (!state.logPosted || !state.componentsRefreshed)) closeDialogAction();
            else closeDialog();
        });
        overlay.addEventListener('click', event => { if (event.target === overlay && !state.busy) close.click(); });
        state.keydown = event => {
            if (event.key === 'Escape' && state.dialog === overlay && !state.busy) close.click();
            if (event.key === 'Enter' && state.dialog === overlay && !primary.disabled && !state.busy) primary.click();
        };
        document.addEventListener('keydown', state.keydown, true);
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
        overlay.innerHTML = `<section class="yds-panel" role="dialog" aria-modal="true" aria-labelledby="yds-title">
            <header class="yds-head">
                <span class="yds-brand-mark" aria-label="Split Prescription">S</span>
                <div class="yds-head-copy">
                    <div class="yds-title" id="yds-title">Split Prescription</div>
                </div>
            </header>
            <div class="yds-summary">
                <div class="yds-summary-card"><span class="yds-summary-label">Expiry date</span><strong class="yds-summary-value">${escapeHTML(expiryLabel)}</strong></div>
                <div class="yds-summary-card"><span class="yds-summary-label">Cycle</span><strong class="yds-summary-value">${escapeHTML(cycleLabel)}</strong></div>
            </div>
            ${accountControl}
            <div class="yds-body">
                <div class="yds-content-head"><div><div class="yds-section-title">Medications</div><div class="yds-section-hint">Select the items you want to split.</div></div></div>
                <label class="yds-select-all"><input type="checkbox" data-select-all><span>Select all medications</span><span class="yds-select-hint">${drugs.length} items</span></label>
                <div class="yds-list">${drugs.map((drug,index) => `<label class="yds-drug"><input type="checkbox" data-drug-index="${index}"><span class="yds-drug-copy"><span class="yds-drug-name">${escapeHTML(drug.name)}</span><span class="yds-drug-hzb">HZB: ${escapeHTML(drug.hzb)}</span></span><span class="yds-drug-state" data-drug-status hidden></span></label>`).join("")}</div>
            </div>
            <footer class="yds-footer">
                <div class="yds-status" aria-live="polite"><span class="yds-status-icon"></span><span class="yds-status-text"></span></div>
                <div class="yds-actions"><span class="yds-count" data-count>0 selected</span><div class="yds-buttons"><button type="button" class="yds-button" data-cancel>Cancel</button><button type="button" class="yds-button yds-button-primary" data-submit disabled>Split</button></div></div>
            </footer>
        </section>`;
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
        overlay.querySelector('[data-cancel]').addEventListener('click', closeDialogAction);
        overlay.addEventListener('click', event => {
            if (event.target !== overlay) return;
            if (state.pendingSplitLog && !state.logPosted) setStatus('Press CLOSE to publish the SPLIT note and show the completed Chatter messages.', 'info');
            else closeDialog();
        });
        submit.addEventListener('click', async () => {
            if (state.journal?.portalCreated || ['portal_creation_started', 'portal_creation_uncertain'].includes(state.journal?.phase)) { state.verificationTab = reserveVerificationTab(); await resumeSplitWorkflow(); return; }
            const selected = checkboxes.filter(item => item.checked).map(item => drugs[Number(item.dataset.drugIndex)]);
            if (!selected.length || state.busy) return;
            overlay._ydsDrugList = drugs;
            const selectedAccount = overlay.querySelector('[data-portal-account]')?.value || state.accountId;
            if (!selectedAccount) { setStatus('Select the saved Portal account linked to this Odoo payer.', 'error'); return; }
            state.accountId = selectedAccount;
            state.verificationTab = reserveVerificationTab();
            state.busy = true;
            submit.disabled = true;
            overlay.querySelector('[data-cancel]').disabled = true;
            submit.innerHTML = '<span class="yds-spin"></span>PREPARING';
            try {
                setStatus('Moving ticket to Confirmed Alternatives...', 'info');
                await ensureConfirmedAlternativesStage();
                const prepared = await prepareSplit(selected);
                saveSplitJournal({
                    version: 1,
                    ticketId: Number(state.ticketId),
                    formNumber: getField('prescription_number'),
                    selectedDrugs: prepared.selectedDrugs.map(drug => ({ name: normalize(drug.name), hzb: normalize(drug.hzb), limited: cleanDrugName(drug.limited) })),
                    selectedCount: prepared.input.medications.length,
                    originalMedicationCount: prepared.details.Medications.length,
                    baselineMessageId: Number(state.splitLogBaselineId || 0),
                    portalAccountId: state.accountId,
                    cardNumber: prepared.input.cardNumber,
                    originalPrescriptionId: prepared.prescription.id,
                    sourceErxUrl: buildErxUrl(prepared.prescription),
                    portalAttemptedAt: 0,
                    portalCreated: false,
                    cleanupCompleted: false,
                    splitLogPosted: false,
                    splitLogMessageId: 0,
                    componentsRefreshed: false,
                    ticketStatusChecked: false,
                    completed: false,
                    phase: 'portal_creation_pending'
                });
                submit.innerHTML = '<span class="yds-spin"></span>CREATING';
                setStatus('Sending the creation request directly to the Portal API...', 'info');
                state.mutationAttempted = true;
                updateSplitJournal({ phase: 'portal_creation_started', mutationAttempted: true, portalAttemptedAt: Date.now() });
                const result = await graphQL(CREATE_PRESCRIPTION_MUTATION, { input: prepared.input });
                const created = result.addNewChronicPrescription;
                if (created?.isSuccess !== true) {
                    state.mutationAttempted = false;
                    updateSplitJournal({ portalCreated: false, portalStatus: 'rejected', portalResponse: created || result || null, phase: 'portal_rejected', mutationAttempted: false });
                    throw new Error(created?.message || 'Portal did not confirm prescription creation.');
                }
                updateSplitJournal({ portalCreated: true, portalStatus: 'confirmed', portalResponse: created, portalResponseReceivedAt: Date.now(), phase: 'cleanup_pending' });
                let portalErx = null;
                try { portalErx = await findCreatedSplitErx(state.journal); } catch {}
                if (portalErx) updateSplitJournal({ portalErx, portalErxUrl: buildErxUrl(portalErx) });
                state.completed = true;
                state.portalCreated = true;

                updateSplitJournal({ portalCreated: true, portalStatus: 'confirmed', phase: 'cleanup_pending', portalCreatedAt: Date.now() });
                submit.innerHTML = '<span class="yds-spin"></span>CLEANING ODOO';
                setStatus('Portal confirmed the split. Removing the selected items from Odoo...', 'info');
                startDeferredChatterHiding(prepared.selectedDrugs);
                let cleanup = { success: false, error: '' };
                try {
                    cleanup = await deleteSplitItemsFromOdoo(prepared);
                } catch (error) {
                    cleanup.error = error?.message || 'Odoo item deletion failed.';
                }
                if (cleanup.success) {
                    state.pendingSplitLog = prepared;
                    updateSplitJournal({ cleanupCompleted: true, removedNoteId: Number(cleanup.noteId || 0), phase: 'cleanup_complete' });
                } else revealDeferredChatterMessages();
                let remaining = null;
                let closeError = '';
                if (cleanup.success) {
                    try {
                        state.ticketClosed = await isTicketClosed();
                        if (!state.ticketClosed) {
                            remaining = await checkRemainingLimitedDrugs();
                            if (remaining.noItems) {
                                state.ticketClosed = await waitForAutomaticTicketClosure();
                                if (!state.ticketClosed) closeError = 'Odoo reported no remaining Limited Drugs, but its native automatic ticket closure was not confirmed. The ticket was not force-closed.';
                            }
                        }
                    } catch (error) {
                        closeError = error?.message || 'Could not verify whether the ticket can be closed.';
                    }
                }
                state.busy = false;
                if (cleanup.success) {
                    updateSplitJournal({ ticketStatusChecked: true, ticketClosed: state.ticketClosed, closeError });
                    markSelectedDrugs(selected, 'success');
                    if (state.ticketClosed) {
                        setStatus('SUCCESS — TICKET CLOSED · PRESS CLOSE FOR CHATTER', 'success');
                    } else if (closeError) {
                        setStatus('SPLIT COMPLETED — AUTO-CLOSE NOT CONFIRMED · PRESS CLOSE FOR CHATTER', 'info', closeError);
                    } else {
                        setStatus('SPLIT COMPLETED — REMAINING ITEMS · PRESS CLOSE FOR CHATTER', 'info', String(remaining?.drugs?.length || 0) + ' limited drugs still need checking.');
                    }
                } else {
                    markSelectedDrugs(selected, 'pending');
                    setStatus('SPLIT CREATED — ODOO CLEANUP FAILED', 'error', cleanup.error || 'Odoo item deletion was not verified.');
                }
                submit.textContent = state.ticketClosed ? 'TICKET CLOSED' : cleanup.success ? 'COMPLETED' : 'RETRY ODOO';
                checkboxes.forEach(item => { item.disabled = true; });
                selectAll.disabled = true;
                overlay.querySelector('[data-cancel]').textContent = 'CLOSE';
                overlay.querySelector('[data-cancel]').disabled = false;
                submit.disabled = cleanup.success;
                if (cleanup.success) closeVerificationTab();
                else openErxAfterFailure(state.journal?.portalErxUrl || state.journal?.sourceErxUrl || '');
            } catch (error) {
                const status = Number(error?.status || 0);
                const rejectedBeforeCreate = status >= 400 && status < 500;
                const uncertain = state.mutationAttempted && !state.portalCreated && !rejectedBeforeCreate;
                const blocked = state.portalCreated || uncertain;
                try {
                    if (uncertain && state.journal) updateSplitJournal({ phase: 'portal_creation_uncertain', portalStatus: 'uncertain', portalResponse: null, portalError: error?.message || 'Portal response was not received.', mutationAttempted: true });
                    else if (!state.portalCreated && state.journal?.phase !== 'portal_rejected') removeSplitJournal(state.ticketId);
                } catch {}
                markSelectedDrugs(selected, state.portalCreated ? 'pending' : 'error');
                setStatus(state.portalCreated ? 'PORTAL CREATED — ODOO CHECK REQUIRED' : 'FAILED', 'error',
                    (error?.message || 'Split failed.') + (state.portalCreated
                        ? ' The Portal prescription already exists. Do not run Split again or a duplicate prescription may be created.'
                        : uncertain ? ' The request may have reached Portal. Check prescription history before retrying.' : ''));
                submit.textContent = 'RETRY';
                submit.disabled = false;
                overlay.querySelector('[data-cancel]').disabled = false;
                state.busy = false;
                if (!blocked) update();
                openErxAfterFailure(state.journal?.portalErxUrl || state.journal?.sourceErxUrl || '');
            }
        });
        state.keydown = event => {
            if (event.key === 'Escape' && state.dialog === overlay && !state.busy) {
                if (state.pendingSplitLog && !state.logPosted) setStatus('Press CLOSE to publish the SPLIT note and show the completed Chatter messages.', 'info');
                else closeDialog();
            }
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
        state.portalCreated = false;
        state.logPosted = false;
        state.ticketClosed = false;
        state.pendingSplitLog = null;
        state.splitLogBaselineId = 0;
        state.journal = null;
        state.componentsRefreshed = false;

        revealDeferredChatterMessages();
        const button = document.getElementById(CONFIG.BUTTON_ID);
        if (button) { button.disabled = true; button.dataset.loading = '1'; }
        try {
            state.ticketId = getTicketId();
            if (!state.ticketId) throw new Error('Ticket ID was not found. Open the Helpdesk ticket form and try again.');
            const savedJournal = readSplitJournal(state.ticketId);
            if (savedJournal) {
                state.journal = savedJournal;
                if (savedJournal.portalCreated || ['portal_creation_started', 'portal_creation_uncertain'].includes(savedJournal.phase)) {
                    showResumeDialog(savedJournal);
                    return;
                }
                removeSplitJournal(state.ticketId);
            }
            state.splitLogBaselineId = await getLatestMessageId(state.ticketId);
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
            state.expiryInfo = getExpiryInfo(cycle);
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
        injectStyles();
        const container = [...document.querySelectorAll('.oe_button_box')].find(isVisible);
        if (!container) return;
        const button = document.createElement('button');
        button.id = CONFIG.BUTTON_ID;
        button.type = 'button';
        button.className = 'btn oe_stat_button';
        button.title = 'Create split prescription directly';
        button.innerHTML = '<i class="yd-fa-icon fa-solid fa-arrows-split-up-and-left fa-fw o_button_icon"></i><div class="o_stat_info"><span class="o_stat_text">Direct Split</span></div>';
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
        if (isTicketForm()) { createButton(); cleanupCycleStorageOnTicket(); }
    }

    state.observer = new MutationObserver(() => {
        if (!document.getElementById(CONFIG.BUTTON_ID)) init();
    });
    if (document.body) state.observer.observe(document.body, { childList: true, subtree: true });
    init();
    setTimeout(init, 700);
    setTimeout(init, 1800);
})();
