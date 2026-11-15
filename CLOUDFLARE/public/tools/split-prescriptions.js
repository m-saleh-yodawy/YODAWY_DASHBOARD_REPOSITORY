// ==UserScript==
// @name         Split Prescriptions
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function(){
    'use strict';

    const CONFIG={
        DIALOG_ID:'tmSplitDrugDialog',
        FETCH_REQUIRED_ID:'tmFetchRequiredDialog',
        NOT_SUPPORTED_ID:'tmNotSupportedDialog',
        BUTTON_ID:'tmLetsSplit',
        PORTAL_URL:'https://portal.yodawy.com/'
    };

    const normalizeText=t=>String(t||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();

    const escapeHtml=t=>String(t||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');

    const isVisible=el=>{
        if(!el)return false;
        const r=el.getBoundingClientRect();
        return r.width>0&&r.height>0&&el.offsetParent!==null;
    };

    const getText=el=>normalizeText(el?.innerText||el?.textContent||'');

    function getFieldValue(name){
        for(const el of document.querySelectorAll(`span[name="${name}"],[name="${name}"]`)){
            const value=getText(el);
            if(value)return value;
        }
        return'';
    }

    function getAcceptsSplitting(){
        for(const el of document.querySelectorAll('span[name="accepts_splitting"],[name="accepts_splitting"]')){
            const raw=normalizeText(el.getAttribute('raw-value')||'').toLowerCase();
            const value=getText(el).toLowerCase();
            if(raw==='no'||value==='no')return'no';
            if(raw==='yes'||value==='yes')return'yes';
        }
        return'';
    }

    const getCardNumber=()=>getFieldValue('user_ref');
    const getPrescriptionNumber=()=>getFieldValue('prescription_number');
    const getPayor=()=>getFieldValue('payor_id');
    const getEmployer=()=>getFieldValue('insurance_agency');

    function getCycle(){
        const direct=document.querySelector('span[name="cycle_id"]');

        if(direct){
            const value=getText(direct);
            if(value)return value;
        }

        for(const row of document.querySelectorAll('tr')){
            const text=getText(row);

            if(!/\bcycle\b/i.test(text))continue;

            const span=row.querySelector('span[name="cycle_id"]');

            if(span){
                const value=getText(span);
                if(value)return value;
            }

            const cells=row.querySelectorAll('td');

            if(cells.length>=2){
                const value=getText(cells[1]);
                if(value&&!/^cycle$/i.test(value))return value;
            }
        }

        return'';
    }

    function getCompany(){
        const payor=getPayor().toLowerCase();

        if(payor.includes('next care'))return'nextcare';
        if(payor.includes('metlife'))return'metlife';

        return'';
    }

    function cleanDrugName(text){
        return normalizeText(text)
            .replace(/^Limited\s+(?:Drug|Item)\s*:\s*/i,'')
            .trim();
    }

    function extractDrug(text){
        const value=cleanDrugName(text);

        if(!value)return null;

        const match=value.match(/^(.+),\s*[^,\n]+,\s*(\d+)\s*$/);

        if(!match)return null;

        const name=normalizeText(match[1]);
        const code=match[2];

        if(!name||name.length>250)return null;

        if(/^(Alternative Name|Form|Hzb ID|Qty|Stock Available)$/i.test(name))return null;

        return{
            name,
            code,
            limited:`Limited Drug: ${value}`
        };
    }

    function addDrug(drugs,drug){
        if(!drug?.name)return;

        if(!drugs.some(x=>x.name.toLowerCase()===drug.name.toLowerCase())){
            drugs.push(drug);
        }
    }

    function getBaseDrugName(name){
        let value=normalizeText(name)
        .replace(/\([^)]*\)/g,' ')
        .trim();

        const strengthRegex=/\b\d+(?:\.\d+)?\s*(?:MG|MCG|G|GM|GRAM|KG|ML|L|IU|UI|%|MG\/ML|MCG\/ML|MG\/5ML|MG\/10ML)\b/i;
        const match=value.match(strengthRegex);

        if(match)value=value.slice(0,match.index).trim();

        return normalizeText(value)
            .replace(/[\s\-\/]+$/,'')
            .toLowerCase();
    }

    function getDuplicateGroups(drugs){
        const groups=new Map();

        for(const drug of drugs){
            const base=getBaseDrugName(drug.name);

            if(!base)continue;

            if(!groups.has(base)){
                groups.set(base,{
                    name:drug.name.replace(/\b\d+(?:\.\d+)?\s*(?:MG|MCG|G|GM|GRAM|KG|ML|L|IU|UI|%)\b.*$/i,'').trim(),
                    items:[]
                });
            }

            groups.get(base).items.push(drug);
        }

        return[...groups.values()].filter(group=>group.items.length>1);
    }

    function isAlternativeTable(table){
        const headers=[...table.querySelectorAll('th')]
        .map(x=>normalizeText(x.textContent).toLowerCase());

        return headers.includes('alternative name')&&headers.includes('form');
    }

    function getMessageId(message){
        const value=message?.getAttribute('data-message-local-id')||'';
        const match=value.match(/(\d+)$/);
        return match?Number(match[1]):0;
    }

    function parseAccordion(body){
        const drugs=[];
        const titles=body.querySelectorAll('.yodawy-drug-title');

        for(const title of titles){
            const drug=extractDrug(getText(title));
            if(drug)addDrug(drugs,drug);
        }

        return drugs;
    }

    function parseRawFetch(body){
        const drugs=[];
        const clone=body.cloneNode(true);

        clone.querySelectorAll('table').forEach(x=>x.remove());

        clone.querySelectorAll('br').forEach(br=>{
            br.replaceWith(document.createTextNode('\n'));
        });

        const raw=clone.innerText||clone.textContent||'';

        const lines=String(raw)
        .split(/\r?\n/)
        .map(x=>x.trim())
        .filter(Boolean);

        for(const line of lines){
            const drug=extractDrug(line);
            if(drug)addDrug(drugs,drug);
        }

        const regex=/Limited\s+(?:Drug|Item)\s*:\s*([\s\S]*?)(?=\s*(?:Limited\s+(?:Drug|Item)\s*:)|\n|$)/gi;

        let match;

        while((match=regex.exec(raw))!==null){
            const drug=extractDrug(match[1]);
            if(drug)addDrug(drugs,drug);
        }

        return drugs;
    }

    function getFetchCandidate(body){
        if(!body)return{drugs:[],valid:false,score:0};

        const tables=[...body.querySelectorAll('table')];
        const alternativeTables=tables.filter(isAlternativeTable);
        const accordionDrugs=parseAccordion(body);
        const rawDrugs=parseRawFetch(body);
        const drugs=accordionDrugs.length?accordionDrugs:rawDrugs;

        if(!drugs.length)return{drugs:[],valid:false,score:0};

        const hasAccordion=body.querySelector('.yodawy-limited-accordion');
        const hasAlternativeTable=alternativeTables.length>0;

        if(!hasAccordion&&!hasAlternativeTable){
            return{drugs:[],valid:false,score:0};
        }

        return{
            drugs,
            valid:true,
            score:drugs.length*100+alternativeTables.length
        };
    }

    function getOdooMessages(){
        return[...document.querySelectorAll('.o_Message')]
            .filter(isVisible)
            .map((element,index)=>({
            element,
            body:element.querySelector('.o_Message_prettyBody'),
            id:getMessageId(element),
            index
        }))
            .filter(x=>x.body);
    }

    function findLatestFetchResult(){
        const candidates=[];

        for(const message of getOdooMessages()){
            const result=getFetchCandidate(message.body);

            if(!result.valid)continue;

            candidates.push({
                ...message,
                drugs:result.drugs,
                score:result.score
            });
        }

        if(!candidates.length){
            return{
                found:false,
                drugs:[],
                note:null
            };
        }

        candidates.sort((a,b)=>{
            if(a.id&&b.id&&a.id!==b.id)return b.id-a.id;
            return b.index-a.index;
        });

        const latest=candidates[0];

        return{
            found:true,
            drugs:latest.drugs,
            note:latest
        };
    }

    function injectDialogCSS(){
        if(document.getElementById('tmSplitDialogCSS'))return;

        const style=document.createElement('style');

        style.id='tmSplitDialogCSS';

        style.textContent=`
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
#tmFetchRequiredDialog .tm-fetch-message strong{color:#875A7B}
#tmFetchRequiredDialog .tm-fetch-submessage{margin-top:10px;font-size:13px;line-height:1.6;color:#666}
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

function findLogNoteButton(){
const selectors=[
'button[data-original-title="Log note"]',
'button[title="Log note"]',
'button.o_ChatterTopbar_buttonLogNote',
'button.o-mail-Chatter-topbar_logNote',
'button:has(i.fa-pencil-square-o)',
'button:has(i.fa-edit)'
];

for(const selector of selectors){
try{
const button=[...document.querySelectorAll(selector)].find(isVisible);
if(button)return button;
}catch{}
}

return[...document.querySelectorAll('button')].find(button=>{
const text=getText(button).toLowerCase();
return isVisible(button)&&text==='log note';
})||null;
}

function findLogComposer(){
const selectors=[
'.o_ComposerTextInput_textarea',
'.o_MessageComposer_input',
'textarea.o_ComposerTextInput_textarea',
'textarea[placeholder*="Log note" i]',
'textarea[placeholder*="Write" i]',
'[contenteditable="true"].o_ComposerTextInput',
'[contenteditable="true"]'
];

for(const selector of selectors){
const element=[...document.querySelectorAll(selector)].find(isVisible);
if(element)return element;
}

return null;
}

function setComposerValue(element,value){
element.focus();

if(element.isContentEditable){
element.textContent=value;
element.dispatchEvent(new InputEvent('input',{
bubbles:true,
inputType:'insertText',
data:value
}));
}else{
const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;

if(setter)setter.call(element,value);
else element.value=value;

element.dispatchEvent(new Event('input',{bubbles:true}));
element.dispatchEvent(new Event('change',{bubbles:true}));
}
}

async function waitForElement(fn,timeout=5000,interval=50){
const start=Date.now();

while(Date.now()-start<timeout){
const element=fn();

if(element)return element;

await new Promise(resolve=>setTimeout(resolve,interval));
}

throw new Error('Log Note composer not found');
}

async function createSplitLogNote(drugs){
const text=drugs.map(drug=>drug.limited).join('\n')+'\nSPLIT';

let composer=findLogComposer();

if(!composer){
const logButton=findLogNoteButton();

if(logButton){
logButton.click();
await new Promise(resolve=>setTimeout(resolve,120));
}

composer=await waitForElement(findLogComposer,5000);
}

setComposerValue(composer,text);
}

function showDrugSelector(drugs){
injectDialogCSS();

document.getElementById(CONFIG.DIALOG_ID)?.remove();

const duplicates=getDuplicateGroups(drugs);

const warning=duplicates.length?`
    <div class="tm-warning">
        <div class="tm-warning-icon">⚠️</div>
<div class="tm-warning-content">
    <div class="tm-warning-title">DUPLICATE DRUGS DETECTED</div>
${duplicates.map(group=>`
<div class="tm-warning-item">
<strong>${escapeHtml(group.name)}</strong> is repeated <strong>${group.items.length} times</strong>
</div>
`).join('')}
</div>
</div>
`:'';

const dialog=document.createElement('div');

dialog.id=CONFIG.DIALOG_ID;

dialog.innerHTML=`
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
</div>
`;

document.body.appendChild(dialog);

const list=dialog.querySelector('#tmDrugList');

drugs.forEach((drug,index)=>{
const label=document.createElement('label');

label.className='tm-drug';

label.innerHTML=`
    <input type="checkbox" class="tm-drug-checkbox" data-index="${index}">
        <div class="tm-drug-name">${escapeHtml(drug.name)}</div>
`;

list.appendChild(label);
});

const selectAll=dialog.querySelector('#tmSelectAll');
const checkboxes=[...dialog.querySelectorAll('.tm-drug-checkbox')];
const countElement=dialog.querySelector('#tmSelectedCount');
const splitButton=dialog.querySelector('#tmSplitConfirm');

function updateSelection(){
const selectedCount=checkboxes.filter(x=>x.checked).length;

countElement.textContent=`${selectedCount} selected`;
splitButton.disabled=selectedCount===0;
selectAll.checked=checkboxes.length>0&&selectedCount===checkboxes.length;
selectAll.indeterminate=selectedCount>0&&selectedCount<checkboxes.length;
}

function closeDialog(){
document.getElementById(CONFIG.DIALOG_ID)?.remove();
document.removeEventListener('keydown',keyboardHandler);
}

function keyboardHandler(event){
if(!document.getElementById(CONFIG.DIALOG_ID))return;

if(event.key==='Escape'){
event.preventDefault();
closeDialog();
return;
}

if(event.key==='Enter'&&!splitButton.disabled){
event.preventDefault();
splitButton.click();
}
}

checkboxes.forEach(x=>x.addEventListener('change',updateSelection));

selectAll.addEventListener('change',()=>{
checkboxes.forEach(x=>x.checked=selectAll.checked);
updateSelection();
});

dialog.querySelector('#tmSplitClose').addEventListener('click',closeDialog);
dialog.querySelector('#tmSplitCancel').addEventListener('click',closeDialog);

document.addEventListener('keydown',keyboardHandler);

splitButton.addEventListener('click',async()=>{
const selected=checkboxes
.filter(x=>x.checked)
.map(x=>drugs[Number(x.dataset.index)]);

if(!selected.length)return;

splitButton.disabled=true;
splitButton.textContent='WRITING LOG...';

try{
await createSplitLogNote(selected);

splitButton.textContent='OPENING PORTAL...';

await openPortal(selected.map(x=>x.name));

closeDialog();
}catch(error){
alert('Could not complete Split\n\n'+error.message);
splitButton.disabled=false;
splitButton.textContent='SPLIT';
}
});

updateSelection();
}

function showNotSupportedModal(){
document.getElementById(CONFIG.NOT_SUPPORTED_ID)?.remove();
injectDialogCSS();

const overlay=document.createElement('div');

overlay.id=CONFIG.NOT_SUPPORTED_ID;

overlay.innerHTML=`
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
</div>
`;

document.body.appendChild(overlay);

const close=()=>{
overlay.remove();
document.removeEventListener('keydown',escape);
};

const escape=e=>{
if(e.key==='Escape')close();
};

overlay.querySelector('#tmSupportOK').addEventListener('click',close);
document.addEventListener('keydown',escape);
}

function showFetchRequiredModal(){
document.getElementById(CONFIG.FETCH_REQUIRED_ID)?.remove();
injectDialogCSS();

const overlay=document.createElement('div');

overlay.id=CONFIG.FETCH_REQUIRED_ID;

overlay.innerHTML=`
    <div class="tm-fetch-dialog">
        <div class="tm-fetch-header">
            <div class="tm-fetch-icon">⚠️</div>
<div class="tm-fetch-title">FETCH REQUIRED</div>
</div>
<div class="tm-fetch-body">
    <div class="tm-fetch-message">Please click <strong>FETCH</strong> first.</div>
        <div class="tm-fetch-submessage">After FETCH finishes, click <strong>LET'S SPLIT</strong> again.</div>
</div>
<div class="tm-fetch-footer">
    <button type="button" id="tmFetchRequiredOK" class="tm-fetch-ok">OK</button>
</div>
</div>
`;

document.body.appendChild(overlay);

const close=()=>{
overlay.remove();
document.removeEventListener('keydown',escape);
};

const escape=e=>{
if(e.key==='Escape')close();
};

overlay.querySelector('#tmFetchRequiredOK').addEventListener('click',close);
document.addEventListener('keydown',escape);
}

async function resolveSplitAccountType(company){
const provider=company.toLowerCase().includes('metlife')?'METLIFE':company.toLowerCase().includes('nextcare')?'NEXTCARE':'';
if(!provider)throw new Error('Unsupported insurance provider');
if(provider!=='METLIFE')return'PERSONAL';
const started=Date.now();
let api;
while(Date.now()-started<15000){
api=window.YODAWY_API_ENGINE;
if(api?.getPortalAccounts&&api?.get&&api?.put)break;
await new Promise(resolve=>setTimeout(resolve,200));
}
if(!api?.getPortalAccounts)throw new Error('Cloud account service is unavailable');
const accountResponse=await api.getPortalAccounts();
const accountData=accountResponse?.data||accountResponse;
if(accountData?.success!==true)throw new Error(accountData?.error||'Portal accounts could not be loaded');
const accounts=(accountData.accounts||[]).filter(item=>item.provider===provider);
const available=[...new Set(accounts.map(item=>item.accountType).filter(type=>['PERSONAL','ALTERNATIVE'].includes(type)))];
if(!available.length)throw new Error('No MetLife split accounts are configured');
const settingsResponse=await api.get('/api/dashboard/settings');
const settingsData=settingsResponse?.data||settingsResponse;
const settings=settingsData?.settings||{};
let selected=String(settings.preferences?.metlifeSplitAccount||'').toUpperCase();
if(!available.includes(selected))throw new Error('Choose your MetLife Split Account from Dashboard > Tools > Split Prescriptions settings first.');
return selected;
}

async function openPortal(selectedDrugs){
const cardNumber=getCardNumber();
const prescriptionNumber=getPrescriptionNumber();
const cycle=getCycle();
const payor=getPayor();
const employer=getEmployer();
const company=getCompany();

if(!company)throw new Error(`Unsupported Company\nPayor: ${payor}\nCorporate: ${employer}`);
if(!cardNumber)throw new Error('Card Number Not Found');
if(!prescriptionNumber)throw new Error('Prescription Number Not Found');
if(!cycle)throw new Error('Cycle Not Found');
if(!selectedDrugs.length)throw new Error('No Split Drugs Selected');

const accountType=await resolveSplitAccountType(company);

const params=new URLSearchParams();

params.set('tm','1');
params.set('company',company);
params.set('accountType',accountType);
params.set('card',cardNumber);
params.set('fn',prescriptionNumber);
params.set('cycle',cycle);
params.set('payor',payor);
params.set('employer',employer);
params.set('split',selectedDrugs.join('||'));

const popup=window.open(
`${CONFIG.PORTAL_URL}?${params.toString()}`,
'_blank'
);

if(!popup){
throw new Error('Browser blocked the Portal popup. Please allow popups for Odoo.');
}
}

function startSplitFlow(){
document.getElementById(CONFIG.DIALOG_ID)?.remove();

const splitting=getAcceptsSplitting();

if(splitting==='no'){
showNotSupportedModal();
return;
}

const result=findLatestFetchResult();

if(!result.found||!result.drugs.length){
showFetchRequiredModal();
return;
}

showDrugSelector(result.drugs);
}

function createSplitButton(){
if(document.getElementById(CONFIG.BUTTON_ID))return;

const container=[...document.querySelectorAll('.oe_button_box')].find(isVisible);

if(!container)return;

const button=document.createElement('button');

button.id=CONFIG.BUTTON_ID;
button.type='button';
button.className='btn oe_stat_button';
button.title='Fetch Split Drugs';

button.innerHTML=`
    <i class="yd-custom-icon fa fa-fw fa-exchange o_button_icon"></i>
<div class="o_stat_info">
    <span class="o_stat_text">Let's Split</span>
</div>
`;

button.addEventListener('click',event=>{
event.preventDefault();
event.stopPropagation();
startSplitFlow();
});

const confirmationButtons=container.querySelector('#tm-confirmation-buttons');

if(confirmationButtons){
container.insertBefore(button,confirmationButtons.nextSibling);
}else{
container.prepend(button);
}
}

function isHelpdeskTicket(){
return location.href.includes('model=helpdesk.ticket');
}

function init(){
if(!isHelpdeskTicket())return;
createSplitButton();
}

const observer=new MutationObserver(()=>{
if(!document.getElementById(CONFIG.BUTTON_ID))init();
});

if(document.body){
observer.observe(document.body,{
childList:true,
subtree:true
});
}

setTimeout(init,500);
setTimeout(init,1500);
setTimeout(init,3000);
setTimeout(init,5000);

})();

(async function(){
    "use strict";

    const params=new URLSearchParams(location.search);
    if(params.get("tm")!=="1")return;

    const company=(params.get("company")||"").trim().toLowerCase();
    const card=(params.get("card")||"").trim();
    const prescriptionKey=(params.get("fn")||"").trim();
    const cycle=(params.get("cycle")||"").replace(/\+/g," ").replace(/\s+/g," ").trim();
    const payor=(params.get("payor")||"").trim();
    const employer=(params.get("employer")||"").trim();
    const splitDrugs=(params.get("split")||"").split("||").map(x=>x.trim()).filter(Boolean);
    const requestedAccountType=(params.get("accountType")||"").trim().toUpperCase();

    if(!params.has("split")||!params.get("split").trim())return;

    history.replaceState(null,"",location.pathname+location.hash);

    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const waitForApi=async()=>{
        const started=Date.now();
        while(Date.now()-started<20000){
            const api=window.YODAWY_API_ENGINE;
            if(api?.getPortalAccounts&&api?.getPortalCredentials)return api;
            await sleep(250);
        }
        throw new Error("Cloud account service is unavailable.");
    };
    const resolveAccount=async()=>{
        const api=await waitForApi();
        const provider=company.includes("metlife")?"METLIFE":company.includes("nextcare")?"NEXTCARE":"";
        if(!provider)throw new Error("Unsupported Company: "+company);
        const accountResponse=await api.getPortalAccounts();
        const result=accountResponse?.data||accountResponse;
        if(result?.success!==true)throw new Error(result?.error||"Portal accounts could not be loaded.");
        const accounts=(result.accounts||[]).filter(item=>item.provider===provider);
        const settingsResponse=await api.get("/api/dashboard/settings");
        const settingsData=settingsResponse?.data||settingsResponse;
        const settings=settingsData?.settings||{};
        const preference=String(settings.preferences?.metlifeSplitAccount||"").toUpperCase();
        const accountType=provider==="METLIFE"?(requestedAccountType||preference||""):"PERSONAL";
        const candidates=accounts.filter(item=>item.accountType===accountType);
        if(!accountType)throw new Error("Select a MetLife split account in Dashboard settings first.");
        if(!candidates.length)throw new Error("The selected "+accountType+" "+provider+" account is not configured.");
        const credentialResponse=await api.getPortalCredentials(candidates[0].id);
        const response=credentialResponse?.data||credentialResponse;
        if(response?.success!==true||!response.credentials?.username||!response.credentials?.password)throw new Error("Portal credentials are unavailable.");
        return response.credentials;
    };

    if(!card)return alert("Card Number Missing");
    if(!prescriptionKey)return alert("Prescription Number / FN Missing");
    if(!cycle)return alert("Cycle Missing\\n\\nPlease make sure Odoo sends the Cycle.");
    if(!splitDrugs.length)return alert("No Split Drugs Found");

    let account;
    try{account=await resolveAccount();}catch(error){alert(error.message||"Portal account is unavailable.");return;}

    const visible=selector=>
    [...document.querySelectorAll(selector)].filter(el=>el.offsetParent!==null);

    async function waitForElement(find,timeout=30000,interval=200){
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

    function clickLikeUser(el){
        if(!el)throw new Error("Cannot click empty element");

        el.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,view:window}));
        el.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true,view:window}));
        el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));
    }

    function setReactValue(input,value){
        if(!input)throw new Error("Input not found");

        input.setAttribute("autocomplete","off");

        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;

        setter.call(input,value);
        input.dispatchEvent(new Event("input",{bubbles:true}));
        input.dispatchEvent(new Event("change",{bubbles:true}));
    }

    function normalizeDrugName(name){
        return String(name||"")
            .toUpperCase()
            .replace(/[µμ]/g,"MCG")
            .replace(/[^A-Z]/g,"")
            .slice(0,5);
    }

    function parseCycle(value){
        const match=String(value||"").trim().match(/^([A-Za-z]+)\s+(\d{4})$/);

        if(!match)throw new Error(`Invalid Cycle Format: ${value}`);

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

        const month=monthMap[match[1].toLowerCase()];

        if(month===undefined)throw new Error(`Invalid Cycle Month: ${match[1]}`);

        return{month,year:Number(match[2])};
    }

    function generateSerial(){
        const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let serial="";

        for(let i=0;i<4;i++)serial+=letters[Math.floor(Math.random()*letters.length)];
        for(let i=0;i<4;i++)serial+=Math.floor(Math.random()*10);

        return serial;
    }

    async function login(){
        if(document.body.innerText.includes("Search Member"))return;

        const inputs=await waitForElement(()=>{
            const list=visible("input");
            return list.length>=2?list:null;
        });

        setReactValue(inputs[0],account.username);
        setReactValue(inputs[1],account.password);

        const button=await waitForElement(()=>
                                          [...document.querySelectorAll("button")].find(
            b=>b.innerText.trim().toLowerCase()==="login"
        )
                                         );

        await sleep(300);
        clickLikeUser(button);
        await sleep(3000);
    }

    async function openSearchMember(){
        const span=await waitForElement(()=>
                                        [...document.querySelectorAll("span")].find(
            el=>el.textContent.trim()==="Search Member"
        )
                                       );

        const button=span.closest("button");

        if(!button)throw new Error("Search Member button not found");

        clickLikeUser(button);
        await sleep(700);
    }

    async function fillCardNumber(){
        const input=await waitForElement(()=>{
            const inputs=visible("input[type='text']");
            return inputs.length>=7?inputs[6]:null;
        });

        setReactValue(input,card);
        await sleep(300);
    }

    async function clickProceed(){
        const span=await waitForElement(()=>
                                        [...document.querySelectorAll("span")].find(
            el=>el.textContent.trim()==="Proceed"
        )
                                       );

        const button=span.closest("button");

        if(!button)throw new Error("Proceed button not found");

        clickLikeUser(button);
        await sleep(2500);
    }

    async function getPrescriptionTable(){
        return waitForElement(()=>
                              [...document.querySelectorAll("table")].find(
            table=>
            table.innerText.includes("Date")&&
            table.innerText.includes("Expire")&&
            table.innerText.includes("Status")&&
            table.querySelector("tbody tr")
        )
                             );
    }

    async function getCurrentPortalFormNumber(){
        return waitForElement(()=>{
            const label=[...document.querySelectorAll("label")].find(
                el=>el.textContent.trim()==="Form Number"
            );

            if(!label?.parentElement)return null;

            const value=[...label.parentElement.querySelectorAll("label")].find(
                el=>el!==label&&el.textContent.trim()
            );

            return value?.textContent.trim()||null;
        },15000);
    }

    async function selectCorrectPrescription(){
        const target=prescriptionKey.toLowerCase();
        const table=await getPrescriptionTable();
        const rows=[...table.querySelectorAll("tbody > tr")];

        for(const row of rows){
            row.click();
            await sleep(500);

            const current=(await getCurrentPortalFormNumber()).toLowerCase();

            if(current===target)return;
        }

        throw new Error(`Correct prescription was not found. Target Form Number: ${prescriptionKey}`);
    }

    function isSplitPageOpened(){
        const text=document.body.innerText||"";

        return(
            text.includes("Expiry Date")||
            text.includes("Max Amount")||
            text.includes("Directly Sync Prescription After Splitting")||
            [...document.querySelectorAll("label")].some(
                l=>l.textContent.trim().toLowerCase()==="expiry date"
            )||
            (document.querySelectorAll('input[type="checkbox"]').length&&
             text.toLowerCase().includes("split"))
        );
    }

    async function clickSplitPrescription(){
        const button=await waitForElement(()=>{
            const span=[...document.querySelectorAll("span")].find(
                el=>el.textContent.replace(/\s+/g," ").trim().toLowerCase()==="split prescription"
            );

            const button=span?.closest("button");

            if(!button)return null;

            const rect=button.getBoundingClientRect();

            return rect.width&&rect.height&&!button.disabled?button:null;
        });

        button.scrollIntoView({behavior:"auto",block:"center",inline:"center"});
        button.focus();

        HTMLButtonElement.prototype.click.call(button);
        await sleep(1000);

        if(isSplitPageOpened())return;

        const rect=button.getBoundingClientRect();

        const options={
            bubbles:true,
            cancelable:true,
            composed:true,
            view:window,
            button:0,
            buttons:1,
            clientX:rect.left+rect.width/2,
            clientY:rect.top+rect.height/2
        };

        for(const type of["pointerdown","mousedown","pointerup","mouseup","click"]){
            const event=type.startsWith("pointer")
            ?new PointerEvent(type,options)
            :new MouseEvent(type,options);

            button.dispatchEvent(event);
            await sleep(80);
        }

        await sleep(1200);

        if(isSplitPageOpened())return;

        button.click();
        await sleep(1500);

        if(!isSplitPageOpened()){
            throw new Error("Split Prescription button was found but clicking it did not open Split screen");
        }
    }

    async function selectSplitDrugs(){
        const table=await waitForElement(()=>
                                         [...document.querySelectorAll("table")].find(
            table=>table.querySelector('input[type="checkbox"]')
        )
                                        );

        const rows=[...table.querySelectorAll("tbody tr")];
        let selected=0;

        for(const drug of splitDrugs){
            const target=normalizeDrugName(drug);
            let matched=false;

            for(const row of rows){
                const cell=row.cells[1];

                if(!cell)continue;

                const rowName=cell.innerText||"";
                const normalized=normalizeDrugName(rowName);

                if(!normalized.includes(target)&&!target.includes(normalized))continue;

                const checkbox=row.querySelector('input[type="checkbox"]');

                if(!checkbox)continue;

                if(!checkbox.checked){
                    clickLikeUser(checkbox);
                    await sleep(100);
                }

                selected++;
                matched=true;
                break;
            }

            if(!matched)throw new Error(`Drug not found: ${drug}`);
        }

        if(selected!==splitDrugs.length){
            throw new Error("Not all split drugs were found");
        }

        await sleep(300);
    }

    async function fillSplitData(){
        const{month,year}=parseCycle(cycle);

        let display;

        if(company==="metlife"){
            const expiry=new Date(year,month+1,0);
            display=`${expiry.getDate()} ${expiry.toLocaleString("en-US",{month:"short"})} ${String(expiry.getFullYear()).slice(-2)}`;
        }else{
            const expiry=new Date(year,month,22);
            display=`22 ${expiry.toLocaleString("en-US",{month:"short"})} ${String(expiry.getFullYear()).slice(-2)}`;
        }

        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")].find(
            l=>l.textContent.trim().toLowerCase()==="expiry date"
        )
                                        );

        let input=label.parentElement?.querySelector('input[type="text"]');

        if(!input){
            input=label.closest("div")?.querySelector('input[type="text"]');
        }

        if(!input){
            input=[...document.querySelectorAll('input[type="text"]')].find(
                el=>/expiry\s*date/i.test(el.parentElement?.parentElement?.parentElement?.innerText||"")
            );
        }

        if(!input)throw new Error("Expiry Date input not found");

        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;

        if(!setter)throw new Error("Native input value setter not found");

        const update=value=>{
            setter.call(input,value);
            input.dispatchEvent(new Event("input",{bubbles:true}));
            input.dispatchEvent(new Event("change",{bubbles:true}));
        };

        input.focus();
        update("");
        await sleep(100);
        update(display);

        input.dispatchEvent(new KeyboardEvent("keydown",{
            bubbles:true,
            key:"Enter",
            code:"Enter",
            keyCode:13,
            which:13
        }));

        input.blur();
        await sleep(500);

        if(input.value.trim().toLowerCase()!==display.toLowerCase()){
            input.focus();
            update(display);
            input.blur();
            await sleep(400);
        }

        if(input.value.trim().toLowerCase()!==display.toLowerCase()){
            throw new Error(`Expiry Date could not be changed.\n\nExpected: ${display}\nCurrent: ${input.value}`);
        }
    }

    async function fillSerial(){
        const input=await waitForElement(()=>{
            const labels=[...document.querySelectorAll("label")].filter(
                l=>l.textContent.trim()==="Serial"
            );

            return labels[1]?.parentElement?.querySelector("input");
        });

        setReactValue(input,generateSerial());
    }

    async function fillMaxAmount(){
        const input=await waitForElement(()=>{
            const labels=[...document.querySelectorAll("label")].filter(
                l=>l.textContent.trim()==="Max Amount"
            );

            return labels[1]?.parentElement?.querySelector("input");
        });

        setReactValue(input,"00");
    }

    async function enableDirectSync(){
        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")].find(
            l=>l.textContent.trim()==="Directly Sync Prescription After Splitting"
        )
                                        );

        const checkbox=label.parentElement?.parentElement?.querySelector('input[type="checkbox"]');

        if(!checkbox)throw new Error("Direct Sync checkbox not found");

        if(!checkbox.checked)clickLikeUser(checkbox);

        await sleep(300);
    }

    async function selectDropdown(labelText,itemText,errorText){
        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")].find(
            l=>l.textContent.trim()===labelText
        )
                                        );

        const button=label.nextElementSibling?.querySelector("button");

        if(!button)throw new Error(`${errorText} dropdown not found`);

        clickLikeUser(button);

        const item=await waitForElement(()=>
                                        [...document.querySelectorAll('span[role="menuitem"]')].find(
            el=>el.textContent.trim().toLowerCase()===itemText.toLowerCase()
        )
                                       );

        clickLikeUser(item);
        await sleep(300);
    }

    async function addSplitTag(){
        const input=await waitForElement(()=>
                                         [...document.querySelectorAll("input")].find(
            el=>el.id?.includes("Tags")
        )
                                        );

        const key=Object.keys(input).find(
            k=>k.startsWith("__reactInternalInstance")
        );

        const props=input[key]?._currentElement?.props;

        if(!props)throw new Error("Tags React props not found");

        props.onChange({target:{value:"SPLIT"}});

        props.onKeyUp({
            key:"Enter",
            keyCode:13,
            which:13,
            target:{value:"SPLIT"},
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
        await selectCorrectPrescription();
        await clickSplitPrescription();
        await selectSplitDrugs();
        await fillSplitData();
        await fillSerial();
        await fillMaxAmount();
        await enableDirectSync();

        if(company==="metlife"){
            await selectDropdown("Odoo Payer","MetLife","Odoo Payer");
            await selectDropdown("Odoo Corporate","The United Bank","Odoo Corporate");
        }else{
            await selectDropdown("Odoo Payer","Next Care","Odoo Payer");
            await selectDropdown("Odoo Corporate","Alex Bank","Odoo Corporate");
        }

        await selectDropdown("Odoo Cycle",cycle,"Odoo Cycle");
        await addSplitTag();
    }

    main().catch(error=>alert(`Split Automation Failed\n\n${error.message}`));

})();