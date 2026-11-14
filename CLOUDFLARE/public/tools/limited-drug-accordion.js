// ==UserScript==
// @name         ODOO >>> LIMITED DRUG ACCORDION
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @description  Limited Drug Accordion with alternative pricing and Log Note actions
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const TOOL_ID = 'TOOL-004';
    const TOOL_PATH = 'TOOLS/limited-drug-accordion.js';
    const STYLE_ID = 'tm-limited-drug-accordion-style';
    const PURPLE = '#875A7B';
    const DARK = '#68465f';
    const ALT_CLASS = 'tm-alt-clickable';
    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);

    if (registry[TOOL_ID]) return;

    const state = {
        initialized: false,
        destroyed: false,
        observer: null,
        controller: null,
        scanTimer: null,
        timers: new Set(),
        waiters: new Map(),
        dialogs: new Set(),
        originals: new Map()
    };

    const STYLE_TEXT = `
.o_Message{min-width:0!important}
.yodawy-limited-accordion button{style:none}
.o_Message_core{width:100%!important;max-width:100%!important;min-width:0!important;flex:1 1 auto!important;align-self:stretch!important;box-sizing:border-box!important}
.o_Message_content,.o_Message_prettyBody{display:block!important;width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important}
.o_Message_prettyBody{flex:1 1 auto!important;align-self:stretch!important;overflow:hidden!important}
.yodawy-limited-accordion{display:block!important;position:relative!important;width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;margin:6px 0 8px!important;overflow:hidden!important}
.yodawy-copy-all{display:flex!important;align-items:center!important;justify-content:space-between!important;width:100%!important;box-sizing:border-box!important;background:#8595a2!important;color:#000!important;border-radius:5px!important;padding:4px 8px!important;margin:0 0 30px!important;font-size:13px!important;font-weight:500!important;line-height:1.2!important;min-height:32px!important;user-select:none!important}
.yodawy-copy-all-title{display:flex;align-items:center;gap:5px;min-width:0;flex:1 1 auto;line-height:1.2}
.yodawy-copy-all-title span{line-height:1.2}
.yodawy-copy-all-button{flex-shrink:0!important;background:#fff!important;color:#000!important;border:1px solid #fff!important;border-radius:4px!important;padding:6px!important;font-size:10px!important;font-weight:bold!important;line-height:1!important;cursor:pointer!important;transition:transform .12s ease}
.yodawy-copy-all-button:active{transform:scale(.96)}
.yodawy-accordion-item{display:block!important;width:100%!important;box-sizing:border-box!important;border-radius:5px!important;overflow:hidden!important;margin-bottom:40px!important;background:#fff!important;box-shadow:0 1px 3px rgba(104,70,95,.1)}
.yodawy-accordion-header,.yodawy-accordion-header:hover,.yodawy-accordion-header.open,.yodawy-accordion-header.open:hover{display:flex!important;align-items:center!important;width:100%!important;box-sizing:border-box!important;overflow:hidden;padding:4px!important;margin:0!important;background:#c5c5c5!important;color:#000!important;cursor:pointer!important;user-select:none!important}
.yodawy-arrow{overflow:hidden;width:30px!important;min-width:10px!important;max-width:10px!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:10px!important;line-height:1!important;color:#000!important;transition:transform .14s ease}
.yodawy-accordion-header.open .yodawy-arrow{transform:rotate(90deg)}
.yodawy-drug-title{flex:1 1 auto!important;min-width:0!important;padding:4px!important;margin:0!important;font-size:13px!important;font-weight:500!important;line-height:1.2!important;word-break:break-word!important;overflow-wrap:anywhere!important;color:#000!important;letter-spacing:1px}
.yodawy-header-actions{display:flex!important;align-items:center!important;gap:16px!important;flex-shrink:0!important;margin-right:5px!important;height:100%!important}
.yodawy-without-alt,.yodawy-copy-one{flex-shrink:0!important;background:#fff!important;color:#000!important;border:1px solid #fff!important;border-radius:4px!important;padding:6px!important;margin:0!important;font-size:10px!important;line-height:1!important;font-weight:bold!important;cursor:pointer!important;pointer-events:auto!important;transition:transform .12s ease}
.yodawy-without-alt:active,.yodawy-copy-one:active{transform:scale(.94)}
.yodawy-accordion-body{display:block!important;width:100%!important;box-sizing:border-box!important;background:#fff!important;overflow:hidden!important;max-height:0!important;opacity:0!important;transform:translateY(-5px)!important;transition:max-height .16s ease,opacity .12s ease,transform .16s ease!important}
.yodawy-accordion-body.open{max-height:1000px!important;opacity:1!important;transform:translateY(0)!important}
.yodawy-table-wrapper{display:block!important;width:100%!important;box-sizing:border-box!important;overflow-x:auto!important;overflow-y:hidden!important}
.yodawy-accordion-body table{display:table!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;border:1px solid #a5a5a5!important;border-collapse:collapse!important;margin:0!important;table-layout:auto!important}
.yodawy-accordion-body table tr{transition:background-color .08s ease}
.yodawy-accordion-body table tr:hover{background-color:#e5e5e5}
.yodawy-accordion-body table th,.yodawy-accordion-body table td{border:1px solid #a5a5a5!important;padding:6px!important;box-sizing:border-box!important;color:#000}
.${ALT_CLASS}{cursor:pointer!important}
.yodawy-price-loading{font-weight:600!important}
.yodawy-price{font-weight:600!important;white-space:nowrap!important}
.yodawy-copy-success{position:fixed;left:50%;bottom:25px;transform:translateX(-50%);z-index:999999999;background:${DARK};color:#fff;border:1px solid ${PURPLE};border-radius:7px;padding:9px 16px;font-size:13px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.2);animation:yodawyCopyPopup .2s ease}
@keyframes yodawyCopyPopup{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
#tm-alt-call-popup{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:999999999;display:flex;align-items:center;justify-content:center}
#tm-alt-call-popup .tm-alt-call-box{width:330px;background:#fff;padding:25px;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.35);text-align:center;font-family:Arial,sans-serif}
#tm-alt-call-popup .tm-alt-call-title{font-size:20px;font-weight:bold;margin-bottom:20px;color:#333}
#tm-alt-call-popup button{width:100%;padding:13px;border:none;border-radius:6px;color:#fff;font-weight:bold;font-size:14px;cursor:pointer}
#tm-alt-call-popup .tm-with-call{background:#33ac48;margin-bottom:10px}
#tm-alt-call-popup .tm-without-call{background:#e41e27}
#tm-alt-call-popup .tm-cancel{width:auto;margin-top:15px;padding:0;background:transparent;color:#000}
`;

    function addStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLE_TEXT;
        document.head.appendChild(style);
    }

    function schedule(callback, delay) {
        const id = setTimeout(() => {
            state.timers.delete(id);
            if (!state.destroyed) callback();
        }, delay);

        state.timers.add(id);
        return id;
    }

    function clearSchedule(id) {
        if (!id) return;
        clearTimeout(id);
        state.timers.delete(id);
    }

    function delay(milliseconds) {
        return new Promise(resolve => {
            if (state.destroyed) {
                resolve(false);
                return;
            }

            const id = setTimeout(() => {
                state.timers.delete(id);
                state.waiters.delete(id);
                resolve(!state.destroyed);
            }, milliseconds);

            state.timers.add(id);
            state.waiters.set(id, resolve);
        });
    }


const clean=t=>(t||'').replace(/\s+/g,' ').trim();
const normalize=t=>clean(t).replace(/^Limited\s+Drug\s*:\s*/i,'');
const isTitle=t=>{t=normalize(t);return t.length>3&&/,\s*\d+\s*$/.test(t)};

function success(message) {
    if (state.destroyed) return;

    document.querySelectorAll('.yodawy-copy-success').forEach(item => item.remove());

    const popup = document.createElement('div');
    popup.className = 'yodawy-copy-success';
    popup.textContent = `✓ ${message}`;
    document.body.appendChild(popup);

    schedule(() => {
        popup.style.opacity = '0';
        popup.style.transition = 'opacity .2s ease';
        schedule(() => popup.remove(), 200);
    }, 1200);
}

async function copy(text,message){
    if(state.destroyed)return;

    if(navigator.clipboard&&window.isSecureContext){
        await navigator.clipboard.writeText(text);
    }else{
        const t=document.createElement('textarea');
        t.value=text;
        t.style.cssText='position:fixed;left:-9999px';
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        t.remove();
    }
    success(message);
}

function validTable(table){
    const h=[...table.querySelectorAll('th')].map(x=>clean(x.textContent).toLowerCase());
    return h.includes('alternative name')&&h.includes('form');
}

function nextTable(nodes,index){
    for(let i=index+1;i<nodes.length;i++){
        const n=nodes[i];

        if(n.nodeType===Node.TEXT_NODE){
            if(clean(n.textContent))return null;
            continue;
        }

        if(n.nodeType!==Node.ELEMENT_NODE)continue;
        if(n.tagName==='BR')continue;

        if(n.tagName==='TABLE')return validTable(n)?n:null;

        if(n.tagName==='P'){
            if(clean(n.textContent))return null;
            continue;
        }

        if(clean(n.textContent))return null;
    }

    return null;
}

function sections(body){
    const nodes=[...body.childNodes],result=[],used=new Set();

    for(let i=0;i<nodes.length;i++){
        const n=nodes[i];

        if(n.nodeType===Node.ELEMENT_NODE&&n.classList?.contains('yodawy-limited-accordion'))continue;

        const title=normalize(n.textContent);

        if(!isTitle(title))continue;

        const table=nextTable(nodes,i);

        if(!table||used.has(table))continue;

        used.add(table);
        result.push({node:n,table,title});
    }

    return result;
}

function hideOriginal(body,data){
    const keep=new Set(data.map(x=>x.table));

    data.forEach(x=>{
        const start=[...body.childNodes].indexOf(x.node);

        if(start<0)return;

        for(let i=start;i<body.childNodes.length;i++){
            const n=body.childNodes[i];

            if(n===x.table)break;
            if(n.classList?.contains('yodawy-limited-accordion'))continue;

            if(n.nodeType===Node.ELEMENT_NODE)n.style.display='none';
            else if(n.nodeType===Node.TEXT_NODE)n.textContent='';
        }
    });

    body.querySelectorAll('table').forEach(t=>{
        if(keep.has(t))t.style.display='none';
    });
}

function getBoxFactor(name){
    const text=clean(name)
        .toUpperCase()
        .replace(/[–—]/g,'-')
        .replace(/\s+/g,' ');

    const patterns=[
        /(?:\/|\(|-|\b)\s*(\d+(?:\.\d+)?)\s*STRIPS?\b/i,
        /(?:\/|\(|-|\b)\s*(\d+(?:\.\d+)?)\s*FLEX\s*PENS?\b/i,
        /(?:\/|\(|-|\b)\s*(\d+(?:\.\d+)?)\s*PENFILS?\b/i,
        /(?:\/|\(|-|\b)\s*(\d+(?:\.\d+)?)\s*AMPOULES?\b/i,
        /(?:\/|\(|-|\b)\s*(\d+(?:\.\d+)?)\s*PATCH(?:ES)?\b/i
    ];

    for(const regex of patterns){
        const match=text.match(regex);

        if(match){
            const value=Number(match[1]);
            if(Number.isFinite(value)&&value>0)return value;
        }
    }

    return 1;
}

async function getPrices(rows){
    const ids=[
        ...new Set(
            rows
                .map(row=>clean(row.querySelector('td:nth-child(3)')?.textContent))
                .filter(Boolean)
        )
    ];

    if(!ids.length)return;

    const numericIds=ids
        .filter(x=>/^\d+$/.test(x))
        .map(Number);

    if(!numericIds.length)return;

    try{
        const response=await fetch('/web/dataset/call_kw/product.product/search_read',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            credentials:'same-origin',
            signal:state.controller?.signal,
            body:JSON.stringify({
                jsonrpc:'2.0',
                method:'call',
                params:{
                    model:'product.product',
                    method:'search_read',
                    args:[
                        [["hb_id","in",numericIds]],
                        ["name","hb_id","list_price"]
                    ],
                    kwargs:{limit:1000}
                },
                id:Date.now()
            })
        });

        const data=await response.json();
        const records=data?.result||[];
        const prices=new Map();

        records.forEach(r=>{
            if(r.hb_id===false||r.hb_id===undefined)return;

            const key=String(
                Array.isArray(r.hb_id)?r.hb_id[0]:r.hb_id
            );

            const unitPrice=Number(r.list_price);

            if(!Number.isFinite(unitPrice)||unitPrice<=0)return;

            const factor=getBoxFactor(r.name);

            prices.set(key,unitPrice*factor);
        });

        rows.forEach(row=>{
            const hzb=clean(
                row.querySelector('td:nth-child(3)')?.textContent
            );

            const cell=row.querySelector('.yodawy-price');

            if(!cell)return;

            const price=prices.get(hzb);

            cell.textContent=price===undefined
                ?'N/A'
                :`${price.toLocaleString('en-US',{
                    minimumFractionDigits:2,
                    maximumFractionDigits:2
                })} EGP`;

            cell.classList.remove('yodawy-price-loading');
        });

    }catch{
        if(state.destroyed)return;

        rows.forEach(row=>{
            const cell=row.querySelector('.yodawy-price');

            if(cell){
                cell.textContent='N/A';
                cell.classList.remove('yodawy-price-loading');
            }
        });
    }
}

function prepareTable(table,drug){
    const clone=table.cloneNode(true);
    clone.style.display='';

    const head=clone.querySelector('thead tr')||clone.querySelector('tr');

    if(head){
        const th=document.createElement('th');
        th.style.padding='10px';
        th.textContent='Box Price';
        head.appendChild(th);
    }

    const rows=[...clone.querySelectorAll('tbody tr')];

    rows.forEach(row=>{
        const cells=row.querySelectorAll('td');
        const cell=cells[0];

        if(!cell)return;

        const alt=clean(cell.textContent);

        if(!alt)return;

        cell.dataset.tmAltReady='1';
        cell.classList.add(ALT_CLASS);
        cell.dataset.limitedDrug=clean(drug);
        cell.dataset.alternative=alt;
        cell.title='Click to add Alternative to Log Note';

        const price=document.createElement('td');
        price.style.padding='10px';
        price.className='yodawy-price yodawy-price-loading';
        price.textContent='...';

        row.appendChild(price);
    });

    getPrices(rows);

    return clone;
}

function processTables(){
    document.querySelectorAll('.yodawy-accordion-body table').forEach(table=>{
        const drug=table
            .closest('.yodawy-accordion-item')
            ?.querySelector('.yodawy-drug-title')
            ?.textContent;

        if(!drug)return;

        table.querySelectorAll('tbody tr').forEach(row=>{
            const cell=row.querySelector('td');

            if(!cell||cell.dataset.tmAltReady==='1')return;

            const alt=clean(cell.textContent);

            if(!alt)return;

            cell.dataset.tmAltReady='1';
            cell.classList.add(ALT_CLASS);
            cell.dataset.limitedDrug=clean(drug);
            cell.dataset.alternative=alt;
            cell.title='Click to add Alternative to Log Note';
        });
    });
}

function askCallStatus() {
    return new Promise(resolve => {
        if (state.destroyed) {
            resolve(null);
            return;
        }

        document.getElementById('tm-alt-call-popup')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'tm-alt-call-popup';

        const box = document.createElement('div');
        box.className = 'tm-alt-call-box';

        const title = document.createElement('div');
        title.className = 'tm-alt-call-title';
        title.textContent = 'CALL STATUS';

        const withCall = document.createElement('button');
        withCall.className = 'tm-with-call';
        withCall.textContent = 'WITH CALL';

        const withoutCall = document.createElement('button');
        withoutCall.className = 'tm-without-call';
        withoutCall.textContent = 'WITHOUT CALL';

        const cancel = document.createElement('button');
        cancel.className = 'tm-cancel';
        cancel.textContent = 'CANCEL';

        let closed = false;

        const close = result => {
            if (closed) return;

            closed = true;
            document.removeEventListener('keydown', keys, true);
            state.dialogs.delete(close);
            overlay.remove();
            resolve(result);
        };

        const keys = event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                withCall.click();
            } else if (event.code === 'Space') {
                event.preventDefault();
                event.stopPropagation();
                withoutCall.click();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancel.click();
            }
        };

        withCall.onclick = () => close('WITH CALL');
        withoutCall.onclick = () => close('WITHOUT CALL');
        cancel.onclick = () => close(null);

        state.dialogs.add(close);
        box.append(title, withCall, withoutCall, cancel);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        document.addEventListener('keydown', keys, true);
    });
}

async function textarea(timeout=5000){
    const started=Date.now();

    while(!state.destroyed&&Date.now()-started<timeout){
        const el=document.querySelector('.o_ComposerTextInput_textarea');

        if(el)return el;

        if(!await delay(100))return null;
    }

    return null;
}

async function openLog(){
    if(state.destroyed)return null;

    const el=document.querySelector('.o_ComposerTextInput_textarea');

    if(el)return el;

    const button=document.querySelector('.o_ChatterTopbar_buttonLogNote');

    if(!button)return null;

    button.click();

    return textarea();
}

function append(el,text){
    if(state.destroyed||!el)return;

    const value=el.value?.trim()
        ?`${el.value.trimEnd()}\n\n${text}`
        :text;

    const set=Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
    ).set;

    set.call(el,value);

    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));

    el.focus();
    el.selectionStart=el.selectionEnd=el.value.length;
}

async function addAll(drugs){
    if(state.destroyed||!drugs?.length)return;

    const el=await openLog();

    if(state.destroyed)return;
    if(!el)return alert('Log Note box was not found.');

    append(
        el,
        drugs.map(d=>`Limited Drug: ${d}`).join('\n')
    );

    success(`${drugs.length} Limited Drug(s) added to Log Note`);
}

async function withoutAlt(drug){
    if(state.destroyed)return;

    const status=await askCallStatus();

    if(!status||state.destroyed)return;

    const el=await openLog();

    if(state.destroyed)return;
    if(!el)return alert('Log Note box was not found.');

    append(
        el,
        `Limited Drug: ${drug}\nWITHOUT ALT - ${status}`
    );
}

async function alternative(drug,alt){
    if(state.destroyed)return;

    const status=await askCallStatus();

    if(!status||state.destroyed)return;

    const el=await openLog();

    if(state.destroyed)return;
    if(!el)return alert('Log Note box was not found.');

    append(
        el,
        `Limited Drug: ${drug}\n${alt}\nWITH ALT - ${status}`
    );
}

function build(body){
    if(body.dataset.yodawyAccordionDone==='1')return;

    const data=sections(body);

    if(!data.length)return;

    state.originals.set(body, {
        html: body.innerHTML,
        done: body.dataset.yodawyAccordionDone,
        drugs: body._yodawyLimitedDrugs
    });

    body.dataset.yodawyAccordionDone='1';

    const drugs=data.map(x=>x.title);
    body._yodawyLimitedDrugs=drugs;

    const accordion=document.createElement('div');
    accordion.className='yodawy-limited-accordion';

    const bar=document.createElement('div');
    bar.className='yodawy-copy-all';

    const title=document.createElement('div');
    title.className='yodawy-copy-all-title';
    title.innerHTML=`<span>💊</span><span>Limited Drugs</span><span style="opacity:.75">(${drugs.length})</span>`;

    const copyAll=document.createElement('button');
    copyAll.className='yodawy-copy-all-button';
    copyAll.type='button';
    copyAll.textContent='📋';

    copyAll.onclick=async e=>{
        e.preventDefault();
        e.stopPropagation();
        await addAll(drugs);
    };

    bar.append(title,copyAll);
    accordion.appendChild(bar);

    data.forEach(x=>{
        const item=document.createElement('div');
        item.className='yodawy-accordion-item';

        const header=document.createElement('div');
        header.className='yodawy-accordion-header';

        const arrow=document.createElement('span');
        arrow.className='yodawy-arrow';
        arrow.textContent='▶';

        const drugTitle=document.createElement('span');
        drugTitle.className='yodawy-drug-title';
        drugTitle.textContent=x.title;

        const actions=document.createElement('div');
        actions.className='yodawy-header-actions';

        const wout=document.createElement('button');
        wout.className='yodawy-without-alt';
        wout.type='button';
        wout.textContent='WOUT';

        wout.onclick=async e=>{
            e.preventDefault();
            e.stopPropagation();
            await withoutAlt(x.title);
        };

        const copyOne=document.createElement('button');
        copyOne.className='yodawy-copy-one';
        copyOne.type='button';
        copyOne.textContent='📋';

        copyOne.onclick=async e=>{
            e.preventDefault();
            e.stopPropagation();

            await copy(
                `Limited Drug: ${x.title}`,
                'Limited Drug copied'
            );
        };

        actions.append(wout,copyOne);
        header.append(arrow,drugTitle,actions);

        const bodyBox=document.createElement('div');
        bodyBox.className='yodawy-accordion-body';

        const wrapper=document.createElement('div');
        wrapper.className='yodawy-table-wrapper';
        wrapper.appendChild(
            prepareTable(x.table,x.title)
        );

        bodyBox.appendChild(wrapper);
        item.append(header,bodyBox);
        accordion.appendChild(item);

        header.onclick=e=>{
            if(e.target.closest('button'))return;

            const open=bodyBox.classList.contains('open');

            bodyBox.classList.toggle('open',!open);
            header.classList.toggle('open',!open);
        };
    });

    body.insertBefore(accordion,body.firstChild);
    hideOriginal(body,data);
    processTables();
}

function scan(){
    if(state.destroyed)return;

    document.querySelectorAll('.o_Message_prettyBody').forEach(build);
    processTables();
}


const events = {
    async click(event) {
        if (state.destroyed) return;

        const target = event.target;
        if (!(target instanceof Element)) return;

        const cell = target.closest(`.${ALT_CLASS}`);
        if (!cell) return;

        event.preventDefault();
        event.stopPropagation();

        const drug = clean(cell.dataset.limitedDrug);
        const alt = clean(cell.dataset.alternative);

        if (drug && alt) await alternative(drug, alt);
    }
};

const instance = {
    id: TOOL_ID,
    path: TOOL_PATH,

    init() {
        if (state.destroyed) return false;
        if (state.initialized) return true;
        if (!document.body || !document.head) return false;

        state.initialized = true;
        state.controller = new AbortController();

        addStyle();

        document.addEventListener('click', events.click, {
            capture: true,
            signal: state.controller.signal
        });

        state.observer = new MutationObserver(() => {
            if (state.destroyed) return;

            clearSchedule(state.scanTimer);
            state.scanTimer = schedule(() => {
                state.scanTimer = null;
                scan();
            }, 150);
        });

        state.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        scan();

        return true;
    },

    async suspend() {
        if (!state.initialized) return true;
        await this.destroy();
        state.destroyed = false;
        return true;
    },

    async resume() {
        if (state.initialized) return true;
        state.destroyed = false;
        return this.init();
    },

    async destroy() {
        if (state.destroyed) return true;

        state.destroyed = true;
        state.controller?.abort();
        state.controller = null;

        state.observer?.disconnect();
        state.observer = null;

        for (const timer of state.timers) clearTimeout(timer);
        state.timers.clear();

        for (const resolve of state.waiters.values()) resolve(false);
        state.waiters.clear();

        for (const close of [...state.dialogs]) close(null);
        state.dialogs.clear();

        for (const [body, original] of state.originals) {
            if (!body.isConnected) continue;

            body.innerHTML = original.html;

            if (original.done === undefined) {
                delete body.dataset.yodawyAccordionDone;
            } else {
                body.dataset.yodawyAccordionDone = original.done;
            }

            if (original.drugs === undefined) {
                delete body._yodawyLimitedDrugs;
            } else {
                body._yodawyLimitedDrugs = original.drugs;
            }
        }

        state.originals.clear();

        document.querySelectorAll('.yodawy-copy-success, #tm-alt-call-popup').forEach(item => item.remove());
        document.getElementById(STYLE_ID)?.remove();

        state.scanTimer = null;
        state.initialized = false;

        return true;
    },

    get status() {
        return state.destroyed ? 'STOPPED' : state.initialized ? 'RUNNING' : 'IDLE';
    }
};

registry[TOOL_ID] = instance;

try {
    if (instance.init() !== true) {
        throw new Error('Limited Drug Accordion initialization failed.');
    }
} catch (error) {
    instance.destroy();
    delete registry[TOOL_ID];
    throw error;
}})();
