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

    const state = { destroyed: false, observer: null, handlers: new Map(), modal: null, accounts: [], ticket: null, busy: false, searchTimer: null, searchSequence: 0 };

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
    const getPrescriptionId = async ticketId => {
        if (!Number.isInteger(ticketId) || ticketId <= 0) throw new Error('Odoo ticket ID is unavailable.');
        const response = await fetch('/web/dataset/call_button', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { args: [[ticketId]], kwargs: { context: {} }, method: 'open_erx_link', model: 'helpdesk.ticket' }, id: Date.now() }) });
        const payload = await response.json();
        const url = payload?.result?.url;
        if (!url) throw new Error(payload?.error?.data?.message || 'Odoo could not resolve the ERX link.');
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
        const patient = data.patient || {};
        state.edit = { prescription, medications: (prescription.medications || []).map((m,i)=>({...m,_index:i,_added:false,_deleted:false})) };
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
    const searchEditDrugs = async (text,sequence) => {
        if(text.length<2||sequence!==state.searchSequence)return;
        const account=state.modal?.querySelector('[data-open-erx-account]')?.value;const api=await waitForApi();
        try{const r=await api.editOpenErx(account,state.edit.prescription.id,'search',{text});if(sequence!==state.searchSequence)return;const box=state.modal?.querySelector('[data-edit-search-results]');box.innerHTML=(r.drugs||[]).map((d,i)=>'<div class="yd-open-erx-search-item"><div><strong>'+escapeHTML(d.drugName||'')+'</strong><small>'+escapeHTML(d.form||'')+' · EGP '+escapeHTML(d.price||'')+'</small></div><button type="button" data-add-drug="'+i+'">Add</button></div>').join('');box.querySelectorAll('[data-add-drug]').forEach(btn=>btn.addEventListener('click',()=>{const d=r.drugs[Number(btn.dataset.addDrug)];if(state.edit.medications.some(m=>m.DrugId===d.id&&!m._deleted))return;state.edit.medications.push({DrugId:d.id,DrugName:d.drugName,Form:d.form,Price:d.price,Quantity:1,QuantityType:'SUB',_index:state.edit.medications.length,_added:true,_deleted:false});renderEditRows();box.innerHTML='';}));}catch(e){if(sequence===state.searchSequence){const box=state.modal?.querySelector('[data-edit-search-results]');if(box)box.innerHTML='<div class="yd-open-erx-empty">'+escapeHTML(e.message||'Search failed.')+'</div>';}}
    };
    const renderEditRows = () => {
        const body=state.modal?.querySelector('[data-edit-med-list]');if(!body)return;
        body.innerHTML=state.edit.medications.map((m,i)=>'<tr class="'+(m._deleted?'yd-open-erx-deleted':'')+'"><td>'+(i+1)+'</td><td><strong>'+escapeHTML(m.DrugName||'')+'</strong><small>'+escapeHTML(m.Form||'')+'</small></td><td><input type="number" min="1" step="1" value="'+escapeHTML(m.Quantity||1)+'" data-med-qty="'+i+'" class="yd-open-erx-edit-qty"></td><td><button type="button" data-med-delete="'+i+'" class="yd-open-erx-edit-delete">'+(m._deleted?'Undo':'Delete')+'</button></td></tr>').join('');
        body.querySelectorAll('[data-med-qty]').forEach(input=>input.addEventListener('change',()=>{state.edit.medications[Number(input.dataset.medQty)].Quantity=Math.max(1,Number(input.value)||1);}));
        body.querySelectorAll('[data-med-delete]').forEach(btn=>btn.addEventListener('click',()=>{const m=state.edit.medications[Number(btn.dataset.medDelete)];m._deleted=!m._deleted;renderEditRows();}));
    };
    const saveEdit = async () => {
        if(state.busy)return;const button=state.modal?.querySelector('[data-edit-save]');button.disabled=true;editStatus('Saving prescription changes...');
        try{
            const api=await waitForApi(),account=state.modal?.querySelector('[data-open-erx-account]')?.value,p=state.edit.prescription,meds=state.edit.medications;
            const pendingReplacements=meds.filter(m=>m._deleted&&!m._added);let replacementCursor=0;const payload=meds.filter(m=>!(m._added&&m._deleted)).map((m,i)=>{const item={DrugId:String(m.DrugId),Quantity:Number(m.Quantity),DeleteIt:Boolean(m._deleted),AddIt:Boolean(m._added),QuantityType:m.QuantityType||'SUB',...((m.Price??m.price)!=null?{Price:String(m.Price??m.price)}:{}),Index:m._index??i};if(m._added&&pendingReplacements[replacementCursor]){const original=pendingReplacements[replacementCursor++];item.ReplacementId=String(original.DrugId);item.ReplacementIndex=Number(original._index??i);}return item;});
            const sr=await api.editOpenErx(account,p.id,'save',{medications:payload,MaxAmount:String(p.disposingMaxValue??'0'),CoPayment:String(p.coPayment??'0'),Note:p.note??null,Status:p.status||null,ApprovalNumber:p.approvalNumber??null});if(sr.result?.isSuccess!==true)throw new Error(sr.result?.message||'Save failed.');
            editStatus('Saved successfully. Reloading prescription...');const dr=await api.editOpenErx(account,p.id,'details');if(!dr.prescription)throw new Error('Saved, but refreshed details unavailable.');renderResult({prescription:dr.prescription,patient:state.modal?.dataset.patient||{}});
        }catch(e){const d=e?.data?.details||e?.details||e?.data||null;const messages=Array.isArray(d?.errors)?d.errors.map(x=>[x.message,x.code?'['+x.code+']':'',x.path?'PATH '+x.path:'',x.reason?'REASON '+x.reason:''].filter(Boolean).join(' ')).join(' | '):'';const details=[d?.operation?'Operation '+d.operation:'',messages,d?.status?'HTTP '+d.status+(d.statusText?' '+d.statusText:''):'',d?.contentType?'Content-Type '+d.contentType:'',d?.message||'',d?.response||''].filter(Boolean).join(' | ');const schema=d?.schema;const schemaText=schema?.available?['INPUT '+(schema.input?.name||''),...(schema.input?.fields||[]).map(x=>x.name+':'+x.type),'MEDICATION '+(schema.medicationInput?.name||'UNKNOWN'),...(schema.medicationInput?.fields||[]).map(x=>x.name+':'+x.type),'MUTATION '+(schema.mutation?.name||'MISSING'),...(schema.mutation?.args||[]).map(x=>x.name+':'+x.type)].join(', '):schema?.errors?.join(' | ')||schema?.error||'';const payload=d?.payload;const payloadText=payload?'PAYLOAD '+payload.medicationCount+' MEDS, '+payload.deletedCount+' DELETED, '+payload.addedCount+' ADDED; KEYS '+(payload.medicationKeys||[]).join(',')+'; META '+(payload.metadataKeys||[]).join(','):'';editStatus([e.message||'Unable to save changes.',details,schemaText,payloadText].filter(Boolean).join(' · '));editStatus([e.message||'Unable to save changes.',details].filter(Boolean).join(' · '));}finally{button.disabled=false;}
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
        let api;
        try { api = await waitForApi(); }
        catch (error) { return showFailure(error?.message || 'Dashboard API is not ready.'); }
        const data = state.ticket;
        if (!data?.cardNumber) return showFailure('Card Number is missing from the Odoo ticket.');
        const ticketId = Number(data.ticketId || getTicketId());
        if (!ticketId) return showFailure('Unable to identify the Odoo ticket ID from this page.');
        let erx;
        try { erx = await getPrescriptionId(ticketId); } catch (error) { return showFailure(error?.message || 'Could not resolve the Odoo ERX link.'); }
        const result = state.modal?.querySelector('[data-open-erx-result]');
        if (result) { result.hidden = true; result.innerHTML = ''; }
        setBusy(true, 'Resolving the Odoo prescription, signing in and validating the card...');
        try {
            const response = await api.runOpenErx(selected, erx.cardNumber || data.cardNumber, erx.prescriptionId);
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
        let api;
        try { api = await waitForApi(); }
        catch (error) { return showFailure(error?.message || 'Dashboard account service is not ready.'); }
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
            style.textContent = '.yd-open-erx-backdrop{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:22px;background:rgba(22,17,25,.58);backdrop-filter:blur(3px);font-family:Nunito,Arial,sans-serif}.yd-open-erx-modal{width:min(920px,100%);max-height:88vh;overflow:auto;background:#fff;border:1px solid #eadfe8;border-radius:14px;box-shadow:0 22px 70px rgba(25,15,25,.28);color:#302833}.yd-open-erx-modal header{display:flex;justify-content:space-between;gap:20px;padding:22px 24px;border-bottom:1px solid #eee7ed}.yd-open-erx-kicker{font-size:10px;letter-spacing:1.3px;color:#92768d;font-weight:800}.yd-open-erx-modal h2{margin:5px 0;color:#68465f;font-size:22px}.yd-open-erx-modal header p{margin:0;color:#77717a;font-size:12px}.yd-open-erx-modal header button{width:32px;height:32px;border:0;border-radius:7px;background:#eee7ed;color:#68465f;font-size:22px;cursor:pointer}.yd-open-erx-ticket{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:18px 24px;background:#faf8fa}.yd-open-erx-ticket div,.yd-open-erx-summary div{display:flex;flex-direction:column;gap:5px;min-width:0}.yd-open-erx-ticket span,.yd-open-erx-summary span,.yd-open-erx-note span{font-size:10px;color:#8b808b;font-weight:700;text-transform:uppercase;letter-spacing:.4px}.yd-open-erx-ticket strong,.yd-open-erx-summary strong{font-size:12px;color:#403744;overflow-wrap:anywhere}.yd-open-erx-account{padding:18px 24px 0}.yd-open-erx-account label{display:block;margin-bottom:7px;color:#655b66;font-size:12px;font-weight:700}.yd-open-erx-account select{width:100%;height:40px;padding:0 12px;border:1px solid #d8cbd6;border-radius:7px;background:#fff;color:#453b46;font-size:12px}.yd-open-erx-status{margin:14px 24px;padding:10px 12px;border-radius:7px;background:#f8f5f7;color:#68465f;font-size:12px}.yd-open-erx-status[hidden],.yd-open-erx-result[hidden]{display:none}.yd-open-erx-result{padding:0 24px 20px}.yd-open-erx-portal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;background:#faf8fa;border:1px solid #eee7ed;border-radius:10px 10px 0 0}.yd-open-erx-portal-brand{display:flex;align-items:center;gap:10px}.yd-open-erx-brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:#875a7b;color:#fff;font-size:17px;font-weight:900}.yd-open-erx-portal-brand div{display:flex;flex-direction:column;gap:3px}.yd-open-erx-portal-brand strong{color:#493e4a;font-size:13px}.yd-open-erx-portal-brand small{color:#928792;font-size:10px}.yd-open-erx-portal-head-meta{display:flex;align-items:center;gap:9px}.yd-open-erx-portal-head-meta>span:first-child{color:#988b98;font-size:9px;font-weight:800;letter-spacing:.8px}.yd-open-erx-status-pill{padding:5px 9px;border-radius:20px;background:#e8f5ed;color:#257346;font-size:10px;font-weight:800}.yd-open-erx-patient-card{display:flex;align-items:center;gap:13px;padding:17px 18px;border:1px solid #eee7ed;border-top:0;background:#fff}.yd-open-erx-patient-avatar{display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border-radius:50%;background:#eee7ed;color:#875a7b;font-size:16px}.yd-open-erx-patient-copy{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}.yd-open-erx-patient-copy>span,.yd-open-erx-section-kicker{font-size:9px;color:#9a8798;font-weight:800;letter-spacing:.8px}.yd-open-erx-patient-copy strong{font-size:15px;color:#403744;overflow-wrap:anywhere}.yd-open-erx-patient-copy small{font-size:11px;color:#857987}.yd-open-erx-patient-flags{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}.yd-open-erx-patient-flags span,.yd-open-erx-count,.yd-open-erx-readonly{padding:5px 8px;border-radius:6px;background:#f6f1f5;color:#765d73;font-size:9px;font-weight:800}.yd-open-erx-portal-section{margin-top:12px;padding:16px;border:1px solid #ece4eb;border-radius:9px;background:#fff}.yd-open-erx-portal-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:13px}.yd-open-erx-portal-section-head h3{margin:4px 0 0;color:#4b3d4b;font-size:15px;font-weight:800}.yd-open-erx-readonly{display:flex;align-items:center;gap:6px;background:#f3f7f4;color:#36744f}.yd-open-erx-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;padding:2px 0}.yd-open-erx-summary div{display:flex;flex-direction:column;gap:5px;min-width:0}.yd-open-erx-summary span{font-size:9px;color:#9a8f9a;font-weight:700;text-transform:uppercase;letter-spacing:.4px}.yd-open-erx-summary strong{font-size:11px;color:#403744;overflow-wrap:anywhere}.yd-open-erx-count{background:#eee7ed;color:#68465f}.yd-open-erx-table-wrap{overflow:auto;border:1px solid #eee7ed;border-radius:8px}.yd-open-erx-table-wrap table{width:100%;border-collapse:collapse;font-size:11px}.yd-open-erx-table-wrap th{padding:10px;background:#f8f5f7;color:#65596a;text-align:left;white-space:nowrap;font-size:10px}.yd-open-erx-table-wrap td{padding:10px;border-top:1px solid #f0eaf0;color:#403744;vertical-align:top}.yd-open-erx-table-wrap td strong{display:block;font-size:11px}.yd-open-erx-table-wrap td small{display:block;margin-top:4px;color:#918692;font-size:9px;line-height:1.4}.yd-open-erx-medicine-index{color:#9c879a;font-size:10px;font-weight:800}.yd-open-erx-number{text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}.yd-open-erx-item-status{display:inline-block;padding:4px 7px;border-radius:5px;font-size:9px;font-weight:800;white-space:nowrap}.yd-open-erx-item-status.done{background:#eaf5ee;color:#267346}.yd-open-erx-item-status.pending{background:#fff6e8;color:#a96916}.yd-open-erx-item-status.rejected{background:#fff0f0;color:#b42318}.yd-open-erx-empty{padding:12px;color:#867c87;font-size:12px}.yd-open-erx-notes-section{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.yd-open-erx-note{margin:0;padding:12px;border-radius:8px;background:#faf8fa}.yd-open-erx-note span{font-size:10px;color:#8b808b;font-weight:800}.yd-open-erx-note p{margin:6px 0 0;color:#4d434e;font-size:11px;white-space:pre-wrap}.yd-open-erx-edit-search{display:flex;gap:8px;margin-top:14px}.yd-open-erx-edit-search input{flex:1;min-width:0;padding:10px;border:1px solid #d8cbd6;border-radius:7px}.yd-open-erx-search-item{display:flex;align-items:center;justify-content:space-between;padding:9px;border-bottom:1px solid #eee7ed;font-size:11px}.yd-open-erx-search-item small{display:block;color:#857987;margin-top:4px}.yd-open-erx-search-item button,.yd-open-erx-edit-actions button{border:0;border-radius:7px;padding:9px 13px;background:#875a7b;color:white;font-weight:700;cursor:pointer}.yd-open-erx-edit-actions{display:flex;justify-content:flex-end;margin-top:14px}.yd-open-erx-edit-qty{width:70px;padding:7px;border:1px solid #ddd;border-radius:6px}.yd-open-erx-edit-delete{border:0;background:#fff0f0;color:#b42318;padding:7px;border-radius:6px;cursor:pointer}.yd-open-erx-deleted{opacity:.45;text-decoration:line-through}..yd-open-erx-error{padding:20px;text-align:center;color:#a52b35}.yd-open-erx-error i{font-size:24px}.yd-open-erx-error strong{display:block;margin:8px 0 4px;font-size:14px}.yd-open-erx-error p{margin:0;color:#756a75;font-size:12px}.yd-open-erx-modal footer{display:flex;justify-content:flex-end;gap:9px;padding:15px 24px;border-top:1px solid #eee7ed}.yd-open-erx-modal footer button{min-height:38px;padding:8px 15px;border-radius:7px;font-size:12px;font-weight:800;cursor:pointer}.yd-open-erx-primary{border:1px solid #875a7b;background:#875a7b;color:#fff}.yd-open-erx-secondary{border:1px solid #ddd2dc;background:#fff;color:#68465f}.yd-open-erx-modal footer button:disabled{opacity:.55;cursor:not-allowed}.yd-open-erx-spinner{display:inline-block;width:12px;height:12px;margin-right:7px;border:2px solid #e3d5e1;border-top-color:#fff;border-radius:50%;vertical-align:middle;animation:yd-open-erx-spin .7s linear infinite}@keyframes yd-open-erx-spin{to{transform:rotate(360deg)}}@media(max-width:650px){.yd-open-erx-ticket{grid-template-columns:1fr}.yd-open-erx-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.yd-open-erx-modal{max-height:94vh}.yd-open-erx-notes-section{grid-template-columns:1fr}.yd-open-erx-patient-card{align-items:flex-start;flex-wrap:wrap}.yd-open-erx-patient-flags{width:100%;justify-content:flex-start}.yd-open-erx-portal-head-meta>span:first-child{display:none}}';
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