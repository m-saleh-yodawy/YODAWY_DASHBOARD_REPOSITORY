// ==UserScript==
// @name         PORTAL TOOL OLD
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/*
// @match        https://portal.yodawy.com/*
// @grant        none
// ==/UserScript==

(()=>{'use strict';

const TOOL_ID='TOOL-017';
const registry=window.YODAWY_TOOL_INSTANCES||=Object.create(null);
if(registry[TOOL_ID])return;

const companyMap={
'administrative control authority (aca)':'administrative control authority (aca)',
'ahly medical':'al ahly medical company',
'amis':'amis',
'apatch petroleum':'apatch petroleum',
'axa services egypt':'axa',
'bupa':'bupa',
'des':'diamond electronic services',
'dms':'dms',
'egy-care':'egycare',
'emc':'emc',
'emc pensioners':'emc individuals',
'journalist syndicate':'journalist syndicate',
'libano-suisse':'libano suisse',
'medicare':'medicare',
'mednet':'mednet',
'medright':'medright',
'medright tpa':'medright tpa',
'metlife':'metlife',
'misr health care':'misr healthcare',
'neqabty':'neqabty',
'next care':'nextcare',
'nilesat':'nilesat',
'seha one':'seha one',
'unicare':'unicare',
'unimed':'unimed',
'medicard':'yodawy'
};

const state={destroyed:false,suspended:false,observer:null,handlers:new Map(),originals:new Map(),style:null};
const normalize=value=>String(value??'').normalize('NFKC').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const visible=selector=>[...document.querySelectorAll(selector)].filter(element=>element.offsetParent!==null);
const waitFor=async(fn,timeout=30000)=>{const start=Date.now();while(Date.now()-start<timeout){if(state.destroyed)throw new Error('Portal Tool Old was stopped.');const result=fn();if(result)return result;await delay(250)}throw new Error('The required Portal page element was not found in time.')};
const setValue=(input,value)=>{input.setAttribute('autocomplete','off');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))};

const restoreCard=element=>{
const original=state.originals.get(element);
if(!original)return;
const handler=state.handlers.get(element);
if(handler)element.removeEventListener('click',handler);
state.handlers.delete(element);
if(original.marker===null)element.removeAttribute('data-portal-tool-old');
else element.setAttribute('data-portal-tool-old',original.marker);
if(original.title===null)element.removeAttribute('title');
else element.setAttribute('title',original.title);
if(original.cursor)element.style.setProperty('cursor',original.cursor,original.cursorPriority);
else element.style.removeProperty('cursor');
state.originals.delete(element);
};
const restoreOdoo=()=>{
state.observer?.disconnect();
state.observer=null;
for(const element of [...state.handlers.keys()])restoreCard(element);
state.style?.remove();
state.style=null;
};
const startOdoo=()=>{
if(state.destroyed||state.suspended||location.hostname!=='odoo.yodawy.com')return;
if(!state.style){
state.style=document.createElement('style');
state.style.textContent='span[name="user_ref"][data-portal-tool-old="true"]{cursor:pointer!important}span[name="user_ref"][data-portal-tool-old="true"]:hover{text-decoration:underline!important}';
document.head.append(state.style);
}
if(!state.observer){
state.observer=new MutationObserver(setupOdoo);
state.observer.observe(document.body,{childList:true,subtree:true});
}
setupOdoo();
};
const cleanup=async()=>{
if(state.destroyed)return true;
state.destroyed=true;
state.suspended=true;
restoreOdoo();
if(registry[TOOL_ID]===instance)delete registry[TOOL_ID];
return true;
};
const instance=Object.freeze({
id:TOOL_ID,
path:'TOOLS/portal-tool-old.js',
suspend(){
if(state.destroyed)return true;
if(state.suspended)return true;
state.suspended=true;
restoreOdoo();
return true;
},
resume(){
if(state.destroyed)return false;
if(!state.suspended)return true;
state.suspended=false;
startOdoo();
return true;
},
destroy:cleanup
});
registry[TOOL_ID]=instance;

function setupOdoo(){
if(state.destroyed||state.suspended)return;
for(const element of [...state.handlers.keys()])if(!element.isConnected)restoreCard(element)
for(const card of document.querySelectorAll('span[name="user_ref"]')){
if(state.handlers.has(card))continue;
const handler=event=>{
event.preventDefault();
event.stopPropagation();
const payer=normalize(document.querySelector('span[name="payor_id"] span')?.textContent);
const company=companyMap[payer];
if(!company)return alert(`Unsupported Company: ${payer||'Unknown'}`);
const cardNumber=card.textContent.trim();
const formNumber=document.querySelector('span[name="prescription_number"]')?.textContent.trim()||'';
if(!cardNumber)return alert('Card Number is missing from Reference.');
const url=`https://portal.yodawy.com/?tm=1&mode=openPortal&company=${encodeURIComponent(company)}&card=${encodeURIComponent(cardNumber)}&fn=${encodeURIComponent(formNumber)}`;
window.open(url,'_blank');
};
state.originals.set(card,{marker:card.getAttribute('data-portal-tool-old'),title:card.getAttribute('title'),cursor:card.style.getPropertyValue('cursor'),cursorPriority:card.style.getPropertyPriority('cursor')});
card.dataset.portalToolOld='true';
card.title='Open ERX';
card.style.setProperty('cursor','pointer');
card.addEventListener('click',handler);
state.handlers.set(card,handler);
}
}

async function loadAccounts(){
const context=window.YODAWY_CLOUD_CONTEXT;
if(!context?.request)throw new Error('Dashboard session is unavailable. Sign in to the Yodawy Dashboard and retry.');
const data=await context.request('/api/portal-accounts');
if(data?.success!==true||!Array.isArray(data.accounts))throw new Error(data?.error||'Portal accounts could not be loaded.');
const accounts=data.accounts.filter(account=>account&&account.provider==='PORTAL'&&typeof account.username==='string'&&typeof account.password==='string');
if(!accounts.length)throw new Error('No Portal accounts were found for your Dashboard user. Import your PORTALS JSON first.');
return accounts;
}

function getUsernameCompany(username){
const value=String(username||'');
const index=value.indexOf('_');
return index<0?value:value.slice(index+1);
}

function findAccount(accounts,company){
const target=normalize(company);
const matches=accounts.map(account=>{
const suffix=normalize(getUsernameCompany(account.username));
const odooKey=normalize(account.odooKey);
const label=normalize(account.label);
const rank=suffix===target?3:odooKey===target?2:label===target?1:0;
return{account,rank};
}).filter(item=>item.rank>0);
if(!matches.length)throw new Error(`No Portal account matches company: ${company}`);
const highest=Math.max(...matches.map(item=>item.rank));
const best=matches.filter(item=>item.rank===highest);
if(best.length!==1)throw new Error(`Multiple Portal accounts match company: ${company}. Check the account usernames and Odoo Keys in PORTALS.`);
return best[0].account;
}

async function login(account){
if(document.body.innerText.includes('Search Member'))return;
const inputs=await waitFor(()=>{const items=visible('input');return items.length>=2?items:null});
setValue(inputs[0],account.username);
setValue(inputs[1],account.password);
(await waitFor(()=>[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==='Login'))).click();
}

async function searchMember(){
(await waitFor(()=>[...document.querySelectorAll('span')].find(element=>element.textContent.trim()==='Search Member'))).closest('button')?.click();
await delay(1000);
}

async function enterCardNumber(card){
const input=await waitFor(()=>{const items=visible('input[type="text"]');return items.length>=7?items[6]:null});
setValue(input,card);
await delay(500);
}

async function proceed(){
(await waitFor(()=>[...document.querySelectorAll('span')].find(element=>element.textContent.trim()==='Proceed'))).closest('button')?.click();
await delay(1500);
}

async function getFormNumber(){
return waitFor(()=>{
const label=[...document.querySelectorAll('label')].find(element=>element.textContent.trim()==='Form Number');
if(!label)return null;
const value=[...label.parentElement.querySelectorAll('label')].find(element=>element!==label&&element.textContent.trim());
return value?.textContent.trim()||null;
});
}

async function selectPrescription(formNumber){
if(!formNumber)throw new Error('The prescription number is missing.');
const target=normalize(formNumber);
const table=await waitFor(()=>[...document.querySelectorAll('table')].find(element=>element.innerText.includes('Date')&&element.innerText.includes('Expire')&&element.innerText.includes('Status')&&element.querySelector('tbody tr')));
const rows=[...table.querySelectorAll('tbody>tr')];
for(let index=0;index<rows.length;index++){
rows[index].click();
if(normalize(await getFormNumber())===target)return;
if(index<rows.length-1)await delay(300);
}
throw new Error(`Prescription number not found: ${formNumber}`);
}

async function runPortal(){
const params=new URLSearchParams(location.search);
if(params.get('tm')!=='1'||params.get('mode')!=='openPortal'||params.has('split'))return;
const card=(params.get('card')||'').trim();
const formNumber=(params.get('fn')||'').trim();
if(!card)throw new Error('The card number is missing from the link.');
const accounts=await loadAccounts();
const account=findAccount(accounts,params.get('company')||'');
await login(account);
await delay(2000);
await searchMember();
await enterCardNumber(card);
await proceed();
if(formNumber)await selectPrescription(formNumber);
}

if(location.hostname==='odoo.yodawy.com'){
startOdoo();
}else if(location.hostname==='portal.yodawy.com'){
runPortal().catch(error=>{if(!state.destroyed)alert(`PORTAL TOOL OLD FAILED\n\n${error.message||'Unexpected error.'}`)});
}
})();
