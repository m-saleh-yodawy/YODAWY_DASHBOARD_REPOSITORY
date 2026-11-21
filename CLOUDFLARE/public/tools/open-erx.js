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

    const state = { destroyed: false, observer: null, handlers: new Map(), modal: null, accounts: [], ticket: null, busy: false, searchTimer: null, searchSequence: 0, loadSequence: 0, loadedAccountId: '' };

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
    const getTicketId = () => {
        const urls = [location.href, location.hash.startsWith('#') ? location.hash.slice(1) : location.hash];
        for (const raw of urls) { try { const params = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw); const id = Number(params.get('id') || params.get('active_id') || params.get('res_id') || 0); if (id > 0) return id; } catch {} }
        const text = normalize(document.querySelector('.o_control_panel .breadcrumb, .o_form_view .o_form_sheet, body')?.innerText || '');
        const match = text.match(/#(\\d{4,})/);
        return Number(match?.[1] || 0);
    };
    const getTicketData = card => {
        const companyNode = document.querySelector('span[name="payor_id"] span') || document.querySelector('span[name="payor_id"]');
        const companyRaw = normalize(companyNode?.innerText || companyNode?.textContent || '');
        const company = keyFor(companyRaw);
        return { company, companyRaw, cardNumber: normalize(card?.innerText || card?.textContent || ''), formNumber: getField('prescription_number'), ticketId: getTicketId() };
    };
    const getApi = () => window.YODAWY_API_ENGINE;
    const getOdooUserContext = async () => {
        const direct = window.odoo?.__session_info__?.user_context;
        if (direct && Array.isArray(direct.allowed_company_ids) && direct.allowed_company_ids.length) return { ...direct };
        const response = await fetch('/web/session/get_session_info', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {}, id: Date.now() }) });
        if (!response.ok) throw new Error('Unable to retrieve the Odoo session context.');
        const payload = await response.json();
        if (payload?.error) throw new Error(payload.error?.data?.message || payload.error?.message || 'Unable to retrieve the Odoo session context.');
        const info = payload?.result;
        if (!info?.uid) throw new Error('Odoo session has expired. Reload Odoo and sign in again.');
        const context = { ...(info.user_context || {}) };
        let companyIds = context.allowed_company_ids;
        const companyId = company => Number(Array.isArray(company) ? company[0] : company && typeof company === 'object' ? company.id ?? company[0] : company);
        if (!Array.isArray(companyIds) || !companyIds.length) {
            const allowed = info.user_companies?.allowed_companies || [];
            companyIds = Array.isArray(allowed) ? allowed.map(companyId) : Object.keys(allowed).map(Number);
            companyIds = [...new Set(companyIds.filter(id => Number.isInteger(id) && id > 0))];
            if (!companyIds.length) {
                const current = companyId(info.user_companies?.current_company) || Number(info.company_id || 0);
                if (Number.isInteger(current) && current > 0) companyIds = [current];
            }
            if (companyIds.length) context.allowed_company_ids = companyIds;
        }
        if (!Array.isArray(context.allowed_company_ids) || !context.allowed_company_ids.length) throw new Error('Odoo did not return the active company access context.');
        return context;
    };
    const getPrescriptionId = async ticketId => {
        if (!Number.isInteger(ticketId) || ticketId <= 0) throw new Error('Odoo ticket ID is unavailable.');
        const context = await getOdooUserContext();
        const response = await fetch('/web/dataset/call_button', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { args: [[ticketId]], kwargs: { context }, method: 'open_erx_link', model: 'helpdesk.ticket' }, id: Date.now() }) });
        if (!response.ok) throw new Error('Odoo could not resolve the ERX link.');
        const payload = await response.json();
        if (payload?.error) throw new Error(payload.error?.data?.message || payload.error?.message || 'Odoo could not resolve the ERX link.');
        const url = payload?.result?.url;
        if (!url) throw new Error('Odoo could not resolve the ERX link.');
        const match = url.match(/\/OdooRoute\/\.\/([0-9a-f-]{36})\/([^/?#]+)/i);
        if (!match) throw new Error('The Odoo ERX link format was not recognized.');
        return { prescriptionId: match[1], cardNumber: decodeURIComponent(match[2]) };
    };
    const waitForApi = async () => {
        const started = Date.now();
        while (Date.now() - started < 15000) {
            if (state.destroyed) throw new Error('Open ERX was stopped.');
            const api = getApi();
            if (api?.getOpenErxAccounts && api?.runOpenErx) return api;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error('Dashboard API is not ready. Refresh Odoo and try again.');
    };
    const setBusy = (busy, message = '') => {
        state.busy = busy;
        const select = state.modal?.querySelector('[data-open-erx-account]');
        const status = state.modal?.querySelector('[data-open-erx-status]');
        const close = state.modal?.querySelector('[data-open-erx-close]');
        if (select) select.disabled = busy || state.accounts.length < 2;
        if (close) close.disabled = busy;
        if (status) {
            status.hidden = !message;
            status.classList.toggle('is-loading', busy);
            status.textContent = message;
            if (busy) {
                const icon = document.createElement('i');
                icon.className = 'yd-fa-icon fa-spinner fa-spin';
                icon.setAttribute('aria-hidden', 'true');
                status.prepend(icon);
            }
        }
    };
    const closeModal = () => {
        if (state.busy) return;
        state.modal?._ydRemoveKeydown?.();
        state.modal?.remove();
        state.modal = null;
        state.loadedAccountId = '';
        state.loadSequence++;
    };
    const renderResult = data => {
        const target = state.modal?.querySelector('[data-open-erx-result]');
        if (!target) return;
        const prescription = data.prescription || {};
        const patient = data.patient || {};
        const originalMedications = (prescription.medications || []).map(m => ({ DrugId: String(m.DrugId), Quantity: Number(m.Quantity) }));
        state.edit = { prescription, originalMedications, medications: (prescription.medications || []).map((m,i)=>({...m,_index:i,_originalQuantity:Number(m.Quantity),_added:false,_deleted:false})) };
        const rows = state.edit.medications.map((m,i)=>'<tr data-med-row="'+i+'"><td>'+(i+1)+'</td><td><strong>'+escapeHTML(m.DrugName||'')+'</strong><small>'+escapeHTML(m.Form||'')+'</small></td><td><input type="number" min="1" step="1" value="'+escapeHTML(m.Quantity||1)+'" data-med-qty="'+i+'" class="yd-open-erx-edit-qty"></td><td><button type="button" data-med-delete="'+i+'" class="yd-open-erx-edit-delete">Delete</button></td></tr>').join('');
        target.innerHTML='<div class="yd-open-erx-portal-head"><div class="yd-open-erx-portal-brand"><span class="yd-open-erx-brand-mark">Y</span><div><strong>Yodawy Portal</strong><small>Prescription Editor</small></div></div><div class="yd-open-erx-portal-head-meta"><span>EDIT MODE</span></div></div><section class="yd-open-erx-patient-card"><div class="yd-open-erx-patient-copy"><span>PATIENT</span><strong>'+escapeHTML(patient.name||'Patient')+'</strong><small>'+escapeHTML(patient.mobileNumber||'')+'</small></div></section><section class="yd-open-erx-portal-section"><div class="yd-open-erx-portal-section-head"><h3>Medications</h3></div><div class="yd-open-erx-table-wrap"><table><thead><tr><th>#</th><th>Medication</th><th>Quantity</th><th></th></tr></thead><tbody data-edit-med-list>'+rows+'</tbody></table></div><div class="yd-open-erx-edit-search"><input type="search" data-edit-search placeholder="Search medication name"></div><div data-edit-search-results class="yd-open-erx-search-results"></div><div class="yd-open-erx-edit-actions"><button type="button" data-edit-save>Validate & Save Changes</button></div><div data-edit-save-status class="yd-open-erx-status" hidden></div></section>';
        target.hidden=false;
        state.modal?.querySelector('[data-open-erx-run]')?.setAttribute('hidden','hidden');
        state.modal?.querySelector('[data-open-erx-status]')?.setAttribute('hidden','hidden');
        state.modal?.querySelector('[data-open-erx-account-wrap]')?.setAttribute('hidden','hidden');
        target.querySelectorAll('[data-med-qty]').forEach(input=>input.addEventListener('change',()=>{const m=state.edit.medications[Number(input.dataset.medQty)];m.Quantity=Math.max(1,Number(input.value)||1);}));
        target.querySelectorAll('[data-med-delete]').forEach(btn=>btn.addEventListener('click',()=>{const m=state.edit.medications[Number(btn.dataset.medDelete)];m._deleted=!m._deleted;btn.textContent=m._deleted?'Undo':'Delete';btn.closest('tr').classList.toggle('yd-open-erx-deleted',m._deleted);}));
        target.querySelector('[data-edit-search]').addEventListener('input',e=>{clearTimeout(state.searchTimer);const value=normalize(e.target.value);state.searchSequence++;const box=target.querySelector('[data-edit-search-results]');box.innerHTML='';editStatus('');if(value.length<2)return;state.searchTimer=setTimeout(()=>searchEditDrugs(value,state.searchSequence),350);});
        target.querySelector('[data-edit-save]').addEventListener('click',saveEdit);
    };
    const editStatus = text => { const el=state.modal?.querySelector('[data-edit-save-status]');if(el){el.hidden=!text;el.textContent=text||'';} };
    const searchEditDrugs = async (text, sequence) => {
        if (text.length < 2 || sequence !== state.searchSequence) return;
        const account = state.modal?.querySelector('[data-open-erx-account]')?.value;
        try {
            const api = await waitForApi();
            const response = await api.editOpenErx(account, state.edit.prescription.id, 'search', { text });
            if (sequence !== state.searchSequence) return;
            const box = state.modal?.querySelector('[data-edit-search-results]');
            if (!box) return;
            box.innerHTML = (response.drugs || []).map((drug, index) => {
                const subForm = normalize(drug.drugSubForm?.name || drug.subform || 'Sub Form');
                const mainForm = normalize(drug.mainForm?.name || drug.form || drug.medicalForm || 'Main Form');
                const detail = normalize(drug.drugNameandForm || drug.form || drug.medicalForm || '');
                const subQuantity = Number(drug.subformQuantity || 0);
                const mainQuantity = Number(drug.mainQuantity || 0);
                return '<article class="yd-open-erx-search-item" data-drug-result="' + index + '">' +
                    '<div class="yd-open-erx-search-item-info"><strong>' + escapeHTML(drug.drugName || '') + '</strong><small>' + escapeHTML(detail) + (drug.price !== undefined && drug.price !== null ? ' · EGP ' + escapeHTML(drug.price) : '') + '</small></div>' +
                    '<div class="yd-open-erx-add-config">' +
                    '<label><span>FORM</span><select data-add-form="' + index + '"><option value="SUB">SUB · ' + escapeHTML(subForm) + (subQuantity ? ' (' + escapeHTML(subQuantity) + ')' : '') + '</option><option value="MAIN">MAIN · ' + escapeHTML(mainForm) + (mainQuantity ? ' (' + escapeHTML(mainQuantity) + ')' : '') + '</option></select></label>' +
                    '<label><span>QUANTITY</span><input type="number" min="1" step="1" value="1" data-add-qty="' + index + '"></label>' +
                    '<button type="button" class="yd-open-erx-add-button" data-add-drug="' + index + '"><i class="yd-fa-icon fa-plus" aria-hidden="true"></i><span>ADD</span></button>' +
                    '</div><div class="yd-open-erx-add-error" data-add-error="' + index + '" hidden></div></article>';
            }).join('') || '<div class="yd-open-erx-empty">No matching medications found.</div>';
            box.querySelectorAll('[data-add-drug]').forEach(button => button.addEventListener('click', () => {
                const index = Number(button.dataset.addDrug);
                const drug = response.drugs[index];
                const card = button.closest('[data-drug-result]');
                const error = card?.querySelector('[data-add-error]');
                const form = card?.querySelector('[data-add-form]');
                const quantity = Number(card?.querySelector('[data-add-qty]')?.value);
                if (!drug || !Number.isInteger(quantity) || quantity < 1) {
                    if (error) { error.hidden = false; error.textContent = 'Enter a valid quantity of at least 1.'; }
                    return;
                }
                if (state.edit.medications.some(item => item.DrugId === String(drug.id) && !item._deleted)) {
                    if (error) { error.hidden = false; error.textContent = 'This medication is already in the prescription.'; }
                    return;
                }
                const formType = form?.value === 'MAIN' ? 'MAIN' : 'SUB';
                const subForm = normalize(drug.drugSubForm?.name || drug.subform || 'Sub Form');
                const mainForm = normalize(drug.mainForm?.name || drug.form || drug.medicalForm || 'Main Form');
                state.edit.medications.push({
                    ...drug,
                    DrugId: String(drug.id),
                    DrugName: drug.drugName,
                    Form: drug.form || drug.medicalForm || drug.drugNameandForm || '',
                    Quantity: quantity,
                    QuantityType: formType,
                    _formLabel: formType === 'MAIN' ? mainForm : subForm,
                    _index: state.edit.medications.length,
                    _added: true,
                    _deleted: false
                });
                renderEditRows();
                button.disabled = true;
                button.innerHTML = '<i class="yd-fa-icon fa-check" aria-hidden="true"></i><span>ADDED</span>';
                if (error) error.hidden = true;
            }));
        } catch (error) {
            if (sequence === state.searchSequence) {
                const box = state.modal?.querySelector('[data-edit-search-results]');
                if (box) box.innerHTML = '<div class="yd-open-erx-empty">' + escapeHTML(error.message || 'Search failed.') + '</div>';
            }
        }
    };
    const renderEditRows = () => {
        const body = state.modal?.querySelector('[data-edit-med-list]');
        if (!body) return;
        body.innerHTML = state.edit.medications.map((medication, index) => {
            const formLabel = medication._formLabel || medication.SubForm?.Name || medication.Form || medication.QuantityType || '';
            return '<tr class="' + (medication._deleted ? 'yd-open-erx-deleted' : '') + '">' +
                '<td>' + (index + 1) + '</td><td><strong>' + escapeHTML(medication.DrugName || '') + '</strong><small>' + escapeHTML(formLabel) + '</small></td>' +
                '<td><input type="number" min="1" step="1" value="' + escapeHTML(medication.Quantity || 1) + '" data-med-qty="' + index + '" class="yd-open-erx-edit-qty"></td>' +
                '<td><button type="button" data-med-delete="' + index + '" class="yd-open-erx-edit-delete">' + (medication._deleted ? 'Undo' : 'Delete') + '</button></td></tr>';
        }).join('');
        body.querySelectorAll('[data-med-qty]').forEach(input => input.addEventListener('change', () => {
            state.edit.medications[Number(input.dataset.medQty)].Quantity = Math.max(1, Number(input.value) || 1);
        }));
        body.querySelectorAll('[data-med-delete]').forEach(button => button.addEventListener('click', () => {
            const medication = state.edit.medications[Number(button.dataset.medDelete)];
            medication._deleted = !medication._deleted;
            renderEditRows();
        }));
    };
    const saveEdit = async () => {
        if(state.busy)return;const button=state.modal?.querySelector('[data-edit-save]');button.disabled=true;state.busy=true;editStatus('Saving prescription changes...');
        try{
            const api=await waitForApi(),account=state.modal?.querySelector('[data-open-erx-account]')?.value,p=state.edit.prescription,meds=state.edit.medications;
            const changed=meds.filter(m=>m._added?!m._deleted:(m._deleted||Number(m.Quantity)!==Number(m._originalQuantity)));const ordered=[...changed.filter(m=>m._added&&!m._deleted),...changed.filter(m=>m._deleted&&!m._added),...changed.filter(m=>!m._added&&!m._deleted)];const payload=ordered.map((m,i)=>({DrugId:String(m.DrugId),Quantity:Number(m.Quantity),ReplacementId:'',ReplacementIndex:-1,DeleteIt:Boolean(m._deleted),AddIt:Boolean(m._added),QuantityType:m.QuantityType||'SUB',Index:m._index??i}));if(!payload.length)throw new Error('No prescription changes to save.');
            const validation=await api.editOpenErx(account,p.id,'validate',{medications:state.edit.originalMedications});if(validation.validation?.isSuccess!==true)throw new Error(validation.validation?.message||'Prescription validation failed.');const sr=await api.editOpenErx(account,p.id,'save',{medications:payload,MaxAmount:String(p.disposingMaxValue??'0'),CoPayment:String(p.coPayment??'0'),Note:p.note??null,Diagnosis:[],ApprovalNumber:String(p.approvalNumber??'')});if(sr.result?.isSuccess!==true)throw new Error(sr.result?.message||'Save failed.');
            editStatus('Saved successfully. Reloading prescription...');const dr=await api.editOpenErx(account,p.formNumber,'details');if(!dr.prescription)throw new Error('Saved, but refreshed details unavailable.');renderResult({prescription:dr.prescription,patient:state.modal?.dataset.patient||{}});
        }catch(e){const d=e?.data?.details||e?.details||e?.data||null;const messages=Array.isArray(d?.errors)?d.errors.map(x=>[x.message,x.code?'['+x.code+']':'',x.path?'PATH '+x.path:'',x.reason?'REASON '+x.reason:''].filter(Boolean).join(' ')).join(' | '):'';const details=[d?.operation?'Operation '+d.operation:'',messages,d?.status?'HTTP '+d.status+(d.statusText?' '+d.statusText:''):'',d?.contentType?'Content-Type '+d.contentType:'',d?.message||'',d?.response||''].filter(Boolean).join(' | ');const schema=d?.schema;const schemaText=schema?.available?['INPUT '+(schema.input?.name||''),...(schema.input?.fields||[]).map(x=>x.name+':'+x.type),'MEDICATION '+(schema.medicationInput?.name||'UNKNOWN'),...(schema.medicationInput?.fields||[]).map(x=>x.name+':'+x.type),'MUTATION '+(schema.mutation?.name||'MISSING'),...(schema.mutation?.args||[]).map(x=>x.name+':'+x.type)].join(', '):schema?.errors?.join(' | ')||schema?.error||'';const payload=d?.payload;const payloadText=payload?'PAYLOAD '+payload.medicationCount+' MEDS, '+payload.deletedCount+' DELETED, '+payload.addedCount+' ADDED; KEYS '+(payload.medicationKeys||[]).join(',')+'; META '+(payload.metadataKeys||[]).join(','):'';editStatus([e.message||'Unable to save changes.',details,schemaText,payloadText].filter(Boolean).join(' · '));editStatus([e.message||'Unable to save changes.',details].filter(Boolean).join(' · '));}finally{state.busy=false;button.disabled=false;}
    };
    const showFailure = (message, code = '', retry = false) => {
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
        target.innerHTML = '<div class="yd-open-erx-error"><i class="yd-fa-icon fa-circle-exclamation" aria-hidden="true"></i><strong>Unable to Open ERX</strong><p>' + escapeHTML(text) + '</p>' +
            (retry ? '<button type="button" data-open-erx-retry class="yd-open-erx-retry">RETRY</button>' : '') + '</div>';
        target.hidden = false;
        target.querySelector('[data-open-erx-retry]')?.addEventListener('click', loadPrescription);
    };
    const loadPrescription = async () => {
        if (state.busy) return;
        const selected = state.modal?.querySelector('[data-open-erx-account]')?.value || '';
        if (!selected) return showFailure('Select a linked Portal account first.');
        if (state.loadedAccountId === selected) return;
        const sequence = ++state.loadSequence;
        state.loadedAccountId = selected;
        const result = state.modal?.querySelector('[data-open-erx-result]');
        if (result) { result.hidden = true; result.innerHTML = ''; }
        setBusy(true, 'Loading the prescription from Portal...');
        let completed = false;
        try {
            const api = await waitForApi();
            const data = state.ticket;
            if (!data?.cardNumber) throw new Error('Card Number is missing from the Odoo ticket.');
            const ticketId = Number(data.ticketId || getTicketId());
            if (!ticketId) throw new Error('Unable to identify the Odoo ticket ID from this page.');
            const erx = await getPrescriptionId(ticketId);
            const response = await api.runOpenErx(selected, erx.cardNumber || data.cardNumber, erx.prescriptionId);
            if (sequence !== state.loadSequence || !state.modal?.isConnected) return;
            if (response?.success !== true) {
                showFailure(response?.message || response?.error || 'Open ERX request failed.', response?.error || '', true);
                return;
            }
            completed = true;
            renderResult(response);
        } catch (error) {
            if (sequence === state.loadSequence && state.modal?.isConnected) showFailure(error?.message || 'The Open ERX request failed.', error?.code || '', true);
        } finally {
            if (sequence === state.loadSequence) {
                setBusy(false, '');
                if (!completed) state.loadedAccountId = '';
            }
        }
    };
    const loadAccounts = async () => {
        const data = state.ticket;
        let api;
        try { api = await waitForApi(); }
        catch (error) { return showFailure(error?.message || 'Dashboard account service is not ready.'); }
        const select = state.modal?.querySelector('[data-open-erx-account]');
        const status = state.modal?.querySelector('[data-open-erx-status]');
        if (!select) return;
        select.disabled = true;
        if (status) { status.hidden = false; status.textContent = 'Loading matching Portal accounts...'; }
        try {
            const response = await api.getOpenErxAccounts(data.company);
            if (response?.success !== true) throw new Error(response?.error || 'Portal accounts could not be loaded.');
            state.accounts = Array.isArray(response.accounts) ? response.accounts : [];
            if (!state.accounts.length) {
                if (status) { status.hidden = false; status.textContent = 'No linked Portal account matches this Odoo Key in your PORTALS list.'; }
                showFailure('No linked Portal account matches this Odoo Key in your PORTALS list.');
                return;
            }
            select.innerHTML = '<option value="">Choose a Portal account...</option>' + state.accounts.map(account => '<option value="' + escapeHTML(account.id) + '">' + escapeHTML((account.accountType === 'PERSONAL' ? 'Personal' : 'Non-Personal') + ' · ' + (account.username || account.label || account.id)) + '</option>').join('');
            if (state.accounts.length === 1) {
                select.value = state.accounts[0].id;
                select.disabled = true;
                loadPrescription();
                return;
            }
            select.value = '';
            select.disabled = false;
            if (status) {
                status.hidden = false;
                status.textContent = 'Select the Portal account to load the prescription.';
            }
        } catch (error) {
            if (status) { status.hidden = false; status.textContent = error?.message || 'Unable to load Portal accounts.'; }
            showFailure(error?.message || 'Unable to load Portal accounts.');
        }
    };
    const openModal = async data => {
        closeModal();
        state.ticket = data;
        state.accounts = [];
        state.loadedAccountId = '';
        const overlay = document.createElement('div');
        overlay.className = 'yd-open-erx-backdrop';
        overlay.innerHTML = '<section class="yd-open-erx-modal" role="dialog" aria-modal="true" aria-labelledby="yd-open-erx-title">' +
            '<header class="yd-open-erx-header"><div class="yd-open-erx-brand"><span class="yd-open-erx-brand-mark">Y</span><div><span class="yd-open-erx-kicker">YODAWY WORKSPACE</span><h2 id="yd-open-erx-title">Open ERX</h2><p>Open the linked Portal prescription directly from this ticket.</p></div></div><button type="button" data-open-erx-close aria-label="Close"><i class="yd-fa-icon fa-xmark" aria-hidden="true"></i></button></header>' +
            '<div class="yd-open-erx-content"><section class="yd-open-erx-ticket"><div><span>INSURANCE COMPANY</span><strong>' + escapeHTML(data.company) + '</strong></div><div><span>CARD NUMBER</span><strong>' + escapeHTML(data.cardNumber) + '</strong></div><div><span>REFERENCE</span><strong>' + escapeHTML(data.formNumber) + '</strong></div></section>' +
            '<section class="yd-open-erx-account-card"><div class="yd-open-erx-section-head"><div><span class="yd-open-erx-section-kicker">PORTAL CONNECTION</span><h3>Portal Account</h3></div><span class="yd-open-erx-status-pill">READY TO LOAD</span></div><label for="yd-open-erx-account">Select account</label><select id="yd-open-erx-account" data-open-erx-account disabled><option>Loading accounts...</option></select></section>' +
            '<div class="yd-open-erx-status" data-open-erx-status><i class="yd-fa-icon fa-spinner fa-spin" aria-hidden="true"></i> Loading matching Portal accounts...</div><div class="yd-open-erx-result" data-open-erx-result hidden></div></div>' +
            '<footer class="yd-open-erx-footer"><span>YODAWY PORTAL · PRESCRIPTION WORKSPACE</span><button type="button" class="yd-open-erx-secondary" data-open-erx-close>Close</button></footer></section>';
        document.body.append(overlay);
        state.modal = overlay;
        overlay.querySelectorAll('[data-open-erx-close]').forEach(button => button.addEventListener('click', closeModal));
        overlay.addEventListener('click', event => { if (event.target === overlay && !state.busy) closeModal(); });
        overlay.querySelector('[data-open-erx-account]').addEventListener('change', () => {
            state.loadedAccountId = '';
            const result = overlay.querySelector('[data-open-erx-result]');
            if (result) { result.hidden = true; result.innerHTML = ''; }
            loadPrescription();
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
            style.textContent = String.raw`
@font-face{font-family:"YD Font Awesome 6";src:url("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/webfonts/fa-solid-900.woff2") format("woff2"),url("https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/webfonts/fa-solid-900.woff2") format("woff2");font-style:normal;font-weight:900;font-display:block}
.yd-open-erx-backdrop,.yd-open-erx-backdrop *{box-sizing:border-box;font-family:"Nunito Sans","Cairo",system-ui,-apple-system,sans-serif}
.yd-open-erx-backdrop{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(24,18,28,.58);backdrop-filter:blur(5px);font-size:12px;color:#18181b}
.yd-open-erx-modal{display:flex;flex-direction:column;width:min(1040px,100%);max-height:calc(100vh - 40px);overflow:hidden;border:1px solid #e7dce7;border-radius:16px;background:#f7f6f8;box-shadow:0 24px 80px rgba(24,18,28,.3)}
.yd-open-erx-header{display:flex;align-items:center;justify-content:space-between;gap:18px;flex:0 0 auto;padding:17px 22px;border-bottom:1px solid #e9e1e9;background:#fff}
.yd-open-erx-brand{display:flex;align-items:center;gap:12px;min-width:0}
.yd-open-erx-brand-mark{display:grid;place-items:center;width:42px;height:42px;flex:0 0 42px;border-radius:12px;background:#875a7b;color:#fff;font-size:19px;font-weight:900;box-shadow:0 4px 10px #875a7b24}
.yd-open-erx-brand>div{display:flex;flex-direction:column;gap:2px;min-width:0}
.yd-open-erx-kicker,.yd-open-erx-section-kicker{color:#9b8498;font-size:9px;font-weight:800;letter-spacing:1.1px}
.yd-open-erx-header h2{margin:1px 0 0;color:#68465f;font-size:19px;font-weight:800;line-height:1.25}
.yd-open-erx-header p{margin:3px 0 0;color:#77717a;font-size:11px}
.yd-open-erx-header>button{display:grid;place-items:center;width:34px;height:34px;flex:0 0 34px;border:1px solid #e4dbe4;border-radius:9px;background:#fff;color:#68465f;cursor:pointer;transition:.16s}
.yd-open-erx-header>button:hover{border-color:#d8c7d7;background:#f4eff2;color:#875a7b}
.yd-open-erx-content{min-height:0;overflow:auto;padding:18px 20px;scrollbar-width:thin;scrollbar-color:#d7cfd9 transparent}
.yd-open-erx-ticket{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:13px}
.yd-open-erx-ticket>div{display:flex;flex-direction:column;gap:6px;min-width:0;padding:12px 14px;border:1px solid #e5dce6;border-radius:10px;background:#fff;box-shadow:0 2px 5px #29242e08}
.yd-open-erx-ticket span,.yd-open-erx-account-card label{color:#88808c;font-size:9px;font-weight:800;letter-spacing:.55px}
.yd-open-erx-ticket strong{overflow-wrap:anywhere;color:#302833;font-size:12px;font-weight:700}
.yd-open-erx-account-card{padding:15px;border:1px solid #e5dce6;border-radius:11px;background:#fff;box-shadow:0 2px 5px #29242e08}
.yd-open-erx-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.yd-open-erx-section-head h3{margin:3px 0 0;color:#302833;font-size:14px;font-weight:800}
.yd-open-erx-status-pill{padding:5px 9px;border:1px solid #d7eadf;border-radius:999px;background:#eef8f2;color:#247a53;font-size:9px;font-weight:800}
.yd-open-erx-account-card label{display:block;margin-bottom:6px}
.yd-open-erx-account-card select{display:block;width:100%;height:39px;padding:0 11px;border:1px solid #d9d9de;border-radius:8px;background:#fff;color:#302833;font-size:11px;font-weight:600;outline:0}
.yd-open-erx-account-card select:focus{border-color:#875a7b;box-shadow:0 0 0 3px #875a7b18}
.yd-open-erx-account-card select:disabled{background:#f8f6f8;color:#77717a;opacity:1}
.yd-open-erx-status{display:flex;align-items:center;gap:8px;margin:12px 0;padding:10px 12px;border:1px solid #e5dce6;border-radius:8px;background:#f1edf2;color:#68465f;font-size:11px;font-weight:600}
.yd-open-erx-status[hidden],.yd-open-erx-result[hidden]{display:none}
.yd-open-erx-status.is-loading{border-color:#d8c7d7;background:#f4eff2}
.yd-open-erx-result{padding:0 0 2px}
.yd-open-erx-portal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border:1px solid #e5dce6;border-radius:11px 11px 0 0;background:#fff}
.yd-open-erx-portal-brand{display:flex;align-items:center;gap:10px}
.yd-open-erx-portal-brand>div{display:flex;flex-direction:column;gap:3px}
.yd-open-erx-portal-brand strong{color:#302833;font-size:12px;font-weight:800}
.yd-open-erx-portal-brand small{color:#89818c;font-size:10px}
.yd-open-erx-portal-head-meta>span:first-child{color:#8c7a8c;font-size:9px;font-weight:800;letter-spacing:.8px}
.yd-open-erx-patient-card{display:flex;align-items:center;gap:12px;padding:13px 15px;border:1px solid #e5dce6;border-top:0;background:#fff}
.yd-open-erx-patient-copy{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.yd-open-erx-patient-copy>span{color:#9b8498;font-size:9px;font-weight:800;letter-spacing:.8px}
.yd-open-erx-patient-copy strong{color:#302833;font-size:14px;font-weight:800;overflow-wrap:anywhere}
.yd-open-erx-patient-copy small{color:#857987;font-size:10px}
.yd-open-erx-portal-section{margin-top:12px;padding:15px;border:1px solid #e5dce6;border-radius:11px;background:#fff;box-shadow:0 2px 5px #29242e08}
.yd-open-erx-portal-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.yd-open-erx-portal-section-head h3{margin:0;color:#302833;font-size:14px;font-weight:800}
.yd-open-erx-table-wrap{overflow:auto;border:1px solid #e8e0e9;border-radius:8px}
.yd-open-erx-table-wrap table{width:100%;border-collapse:collapse;font-size:11px}
.yd-open-erx-table-wrap th{padding:10px 11px;background:#f4eff4;color:#68465f;text-align:left;white-space:nowrap;font-size:9px;font-weight:800;letter-spacing:.5px}
.yd-open-erx-table-wrap td{padding:10px 11px;border-top:1px solid #f0eaf0;color:#403744;vertical-align:middle}
.yd-open-erx-table-wrap td strong{display:block;color:#302833;font-size:11px;font-weight:700}
.yd-open-erx-table-wrap td small{display:block;margin-top:4px;color:#918692;font-size:9px;line-height:1.4}
.yd-open-erx-edit-qty{width:76px;height:32px;padding:0 8px;border:1px solid #d9d9de;border-radius:7px;background:#fff;color:#302833;text-align:center;font-size:11px;font-weight:700}
.yd-open-erx-edit-qty:focus{border-color:#875a7b;outline:0;box-shadow:0 0 0 3px #875a7b18}
.yd-open-erx-edit-delete{padding:6px 9px;border:1px solid #f0d7d9;border-radius:7px;background:#fff;color:#b42318;font-size:10px;font-weight:700;cursor:pointer}
.yd-open-erx-edit-delete:hover{background:#fff0f0}
.yd-open-erx-deleted{opacity:.45}
.yd-open-erx-deleted td:nth-child(2){text-decoration:line-through}
.yd-open-erx-edit-search{display:flex;align-items:center;gap:9px;margin-top:14px}
.yd-open-erx-edit-search input{width:100%;min-width:0;height:38px;padding:0 12px;border:1px solid #d9d9de;border-radius:8px;background:#fff;color:#302833;font-size:11px;outline:0}
.yd-open-erx-edit-search input:focus{border-color:#875a7b;box-shadow:0 0 0 3px #875a7b18}
.yd-open-erx-search-results{display:grid;gap:8px;margin-top:9px}
.yd-open-erx-search-item{display:grid;gap:10px;padding:12px;border:1px solid #e5dce6;border-radius:9px;background:#fff}
.yd-open-erx-search-item-info{display:flex;flex-direction:column;gap:4px;min-width:0}
.yd-open-erx-search-item-info strong{color:#302833;font-size:11px;font-weight:800;overflow-wrap:anywhere}
.yd-open-erx-search-item-info small{color:#89818c;font-size:9px}
.yd-open-erx-add-config{display:grid;grid-template-columns:minmax(180px,1fr) 110px auto;align-items:end;gap:9px}
.yd-open-erx-add-config label{display:flex;flex-direction:column;gap:5px;min-width:0}
.yd-open-erx-add-config label>span{color:#88808c;font-size:9px;font-weight:800;letter-spacing:.5px}
.yd-open-erx-add-config select,.yd-open-erx-add-config input{width:100%;height:35px;min-width:0;padding:0 9px;border:1px solid #d9d9de;border-radius:7px;background:#fff;color:#302833;font-size:10px;outline:0}
.yd-open-erx-add-config select:focus,.yd-open-erx-add-config input:focus{border-color:#875a7b;box-shadow:0 0 0 3px #875a7b18}
.yd-open-erx-add-button,.yd-open-erx-edit-actions button,.yd-open-erx-retry{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:35px;padding:0 13px;border:1px solid #875a7b;border-radius:7px;background:#875a7b;color:#fff;font-size:10px;font-weight:800;cursor:pointer;transition:.16s}
.yd-open-erx-add-button:hover,.yd-open-erx-edit-actions button:hover,.yd-open-erx-retry:hover{border-color:#68465f;background:#68465f}
.yd-open-erx-add-button:disabled{opacity:.55;cursor:not-allowed}
.yd-open-erx-add-error{color:#b42318;font-size:10px;font-weight:600}
.yd-open-erx-edit-actions{display:flex;justify-content:flex-end;margin-top:14px}
.yd-open-erx-count,.yd-open-erx-readonly{padding:5px 8px;border-radius:6px;background:#f4eff4;color:#68465f;font-size:9px;font-weight:800}
.yd-open-erx-empty{padding:12px;border:1px solid #e8e0e9;border-radius:8px;background:#faf8fa;color:#867c87;font-size:11px}
.yd-open-erx-error{display:grid;justify-items:center;gap:8px;padding:24px;border:1px solid #f0d7d9;border-radius:10px;background:#fff7f7;color:#b42318;text-align:center}
.yd-open-erx-error .yd-fa-icon{font-size:22px}
.yd-open-erx-error strong{font-size:13px;font-weight:800}
.yd-open-erx-error p{max-width:620px;margin:0;color:#756a75;font-size:11px;line-height:1.6}
.yd-open-erx-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-top:1px solid #e9e1e9;background:#fff}
.yd-open-erx-footer>span{color:#aaa1ab;font-size:8px;font-weight:800;letter-spacing:.8px}
.yd-open-erx-modal .yd-open-erx-secondary{min-height:34px;padding:0 14px;border:1px solid #ded3de;border-radius:7px;background:#fff;color:#68465f;font-size:10px;font-weight:800;cursor:pointer}
.yd-open-erx-modal .yd-open-erx-secondary:hover{border-color:#cbb8ca;background:#f7f2f7}
.yd-open-erx-modal button:disabled{opacity:.5;cursor:not-allowed}
.yd-open-erx-backdrop .yd-fa-icon{display:inline-block;flex:0 0 auto;font-family:"YD Font Awesome 6"!important;font-style:normal;font-weight:900;font-variant:normal;line-height:1;text-rendering:auto;-webkit-font-smoothing:antialiased}
.yd-open-erx-backdrop .yd-fa-icon.fa-circle-exclamation:before{content:"\f06a"}
.yd-open-erx-backdrop .yd-fa-icon.fa-xmark:before{content:"\f00d"}
.yd-open-erx-backdrop .yd-fa-icon.fa-spinner:before{content:"\f110"}
.yd-open-erx-backdrop .yd-fa-icon.fa-plus:before{content:"\f067"}
.yd-open-erx-backdrop .yd-fa-icon.fa-check:before{content:"\f00c"}
.yd-open-erx-backdrop .fa-spin{animation:yd-open-erx-spin .9s linear infinite}
@keyframes yd-open-erx-spin{to{transform:rotate(360deg)}}
@media(max-width:700px){.yd-open-erx-backdrop{padding:8px}.yd-open-erx-modal{max-height:calc(100vh - 16px);border-radius:11px}.yd-open-erx-header{padding:13px}.yd-open-erx-content{padding:12px}.yd-open-erx-ticket{grid-template-columns:1fr}.yd-open-erx-add-config{grid-template-columns:minmax(0,1fr) 92px}.yd-open-erx-add-button{grid-column:1/-1}.yd-open-erx-footer{padding:10px 12px}.yd-open-erx-footer>span{display:none}}
`;
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
                if (!data.company || !data.cardNumber) {
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