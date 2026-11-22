// ==UserScript==
// @name         Move Communication
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @description  Move the Communication section above Reference with aligned fields and phone copy.
// @match        https://odoo.yodawy.com/web*
// @grant        none
// ==/UserScript==

(function(){
    'use strict';

    const TOOL_ID='TOOL-011';
    const LEGACY_KEY='ODOO-MOVE-COMMUNICATION';
    const registry=window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    const previousTool=registry['TOOL-016'];
    try{
        if(typeof previousTool?.destroy==='function')previousTool.destroy();
        else if(typeof previousTool?.suspend==='function')previousTool.suspend();
    }catch{}
    if(registry[TOOL_ID])return;

    const state={
        observer:null,
        resizeObserver:null,
        style:null,
        layer:null,
        communication:null,
        communicationPlaceholder:null,
        communicationParent:null,
        communicationNext:null,
        phoneTable:null,
        phonePlaceholder:null,
        phoneRow:null,
        phoneRowParent:null,
        phoneRowNext:null,
        copyHandlers:new Map(),
        legacy:null,
        legacyPaused:false,
        suspended:false,
        destroyed:false,
        scheduled:false
    };

    const normalize=value=>String(value||'').replace(/\s+/g,' ').trim().toLowerCase();

    const findElements=()=>{
        const sheet=document.querySelector('.o_form_sheet');
        if(!sheet)return null;
        const tables=[...sheet.querySelectorAll('table.o_inner_group')];
        const quotation=tables.find(table=>normalize(table.querySelector('strong')?.textContent)==='quotation criteria:');
        const reference=tables.find(table=>normalize(table.querySelector('strong')?.textContent)==='reference:');
        const mobile=sheet.querySelector('span[name="mobile"]');
        const mobile2=sheet.querySelector('span[name="ticket_mobile2"]');
        const phone=sheet.querySelector('span[name="ticket_phone"]');
        const communication=mobile?.closest('table');
        if(!quotation||!reference||!communication)return null;
        return{sheet,quotation,reference,communication,mobile,mobile2,phone};
    };

    const makePlaceholder=table=>{
        const rect=table.getBoundingClientRect();
        const placeholder=table.cloneNode(false);
        placeholder.removeAttribute('id');
        placeholder.innerHTML='<tbody><tr><td></td></tr></tbody>';
        const cell=placeholder.querySelector('td');
        if(cell)cell.style.cssText='height:1px!important;padding:0!important;border:0!important;line-height:0!important;font-size:0!important';
        placeholder.setAttribute('aria-hidden','true');
        placeholder.style.setProperty('height',rect.height+'px','important');
        placeholder.style.setProperty('min-height',rect.height+'px','important');
        placeholder.style.setProperty('max-height',rect.height+'px','important');
        placeholder.style.setProperty('visibility','hidden','important');
        placeholder.style.setProperty('pointer-events','none','important');
        placeholder.style.setProperty('overflow','hidden','important');
        return placeholder;
    };

    const injectStyle=()=>{
        if(state.style?.isConnected)return;
        state.style=document.createElement('style');
        state.style.id='yd-move-communication-style';
        state.style.textContent=".yd-mc-layer{position:absolute!important;display:block!important;z-index:3!important;box-sizing:border-box!important;overflow:visible!important;pointer-events:auto!important;margin:0!important;padding:0!important;background:transparent!important}.yd-mc-layer>table{display:table!important;width:100%!important;max-width:100%!important;height:auto!important;margin:0!important;padding:0!important;border-collapse:collapse!important;table-layout:auto!important}.yd-mc-layer>table>tbody>tr{height:auto!important;max-height:none!important}.yd-mc-layer>table>tbody>tr>td{height:auto!important;max-height:none!important;padding:2px 5px!important;vertical-align:middle!important;line-height:1.5!important;overflow:visible!important}.yd-mc-layer>table>tbody>tr:first-child>td{width:50%!important;padding:0 0 3px!important}.yd-mc-layer>table>tbody>tr:not(:first-child)>td.o_td_label{width:var(--yd-mc-label-width,165px)!important;min-width:var(--yd-mc-label-width,165px)!important;max-width:var(--yd-mc-label-width,165px)!important;padding:0 15px 0 0!important;box-sizing:border-box!important}.yd-mc-layer>table>tbody>tr:not(:first-child)>td:not(.o_td_label){width:100%!important;padding:0!important}.yd-mc-layer .oe_title{margin:0!important;padding:0!important;line-height:1.5!important}.yd-mc-layer .oe_title strong{font-size:1.08333333rem!important;font-weight:bold!important;line-height:1.5!important}.yd-mc-layer .o_horizontal_separator{height:1px!important;min-height:1px!important;margin:2px 0 0!important;padding:0!important}.yd-mc-layer .o_form_label{margin:0 5px 0 0!important;font-size:1.08333333rem!important;line-height:1.5!important;font-weight:bold!important;white-space:nowrap!important}.yd-mc-layer .o_field_widget{display:inline-block!important;max-width:calc(100% - 30px)!important;margin:0!important;padding:0!important;line-height:1.5!important;overflow:visible!important;text-overflow:clip!important;white-space:nowrap!important;vertical-align:middle!important}.yd-mc-layer span[name=\"mobile\"],.yd-mc-layer span[name=\"ticket_mobile2\"],.yd-mc-layer span[name=\"ticket_phone\"]{color:#212529!important;font-weight:700!important;cursor:pointer!important;user-select:text!important}.yd-mc-layer span[name=\"ticket_phone\"]{display:block!important;width:100%!important;max-width:100%!important;min-width:0!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:normal!important;vertical-align:top!important;line-height:1.45!important;box-sizing:border-box!important}";
        (document.head||document.documentElement).appendChild(state.style);
    };

    const setupCopy=element=>{
        if(!element||state.copyHandlers.has(element))return;
        if(!(element.textContent||'').trim())return;
        const original={
            style:element.getAttribute('style'),
            title:element.getAttribute('title'),
            onclick:element.onclick
        };
        const handler=async event=>{
            event.preventDefault();
            event.stopPropagation();
            let number=(element.textContent||'').trim().replace(/[^\d+]/g,'');
            if(number.startsWith('+20'))number='0'+number.slice(3);
            else if(number.startsWith('20')&&number.length===12)number='0'+number.slice(2);
            if(!number)return;
            try{
                if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(number);
                else{
                    const input=document.createElement('textarea');
                    input.value=number;
                    input.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
                    document.body.appendChild(input);
                    input.select();
                    if(!document.execCommand('copy'))throw new Error('Copy failed');
                    input.remove();
                }
                element.style.setProperty('color','#16a34a','important');
                await new Promise(resolve=>setTimeout(resolve,450));
                if(element.isConnected)element.style.setProperty('color','#212529','important');
            }catch{
                element.style.setProperty('color','#212529','important');
            }
        };
        element.style.setProperty('color','#212529','important');
        element.style.setProperty('font-weight','700','important');
        element.style.setProperty('cursor','pointer','important');
        element.style.setProperty('user-select','text','important');
        element.addEventListener('click',handler);
        state.copyHandlers.set(element,{handler,original});
    };

    const setupCopyFields=elements=>{
        setupCopy(elements.mobile);
        setupCopy(elements.mobile2);
        setupCopy(elements.phone);
    };

    const restoreCopyFields=()=>{
        for(const [element,item] of state.copyHandlers){
            element.removeEventListener('click',item.handler);
            if(item.original.style===null)element.removeAttribute('style');
            else element.setAttribute('style',item.original.style);
            if(item.original.title===null)element.removeAttribute('title');
            else element.setAttribute('title',item.original.title);
            element.onclick=item.original.onclick;
        }
        state.copyHandlers.clear();
    };

    const restoreLayout=resumeLegacy=>{
        restoreCopyFields();

        if(state.phonePlaceholder?.parentNode&&state.phoneTable){
            state.phonePlaceholder.replaceWith(state.phoneTable);
        }
        if(state.phoneRow&&state.phoneRowParent){
            const next=state.phoneRowNext?.parentNode===state.phoneRowParent?state.phoneRowNext:null;
            state.phoneRowParent.insertBefore(state.phoneRow,next);
        }

        if(state.communicationPlaceholder?.parentNode&&state.communication){
            state.communicationPlaceholder.replaceWith(state.communication);
        }else if(state.communicationParent?.isConnected&&state.communication){
            const next=state.communicationNext?.parentNode===state.communicationParent?state.communicationNext:null;
            state.communicationParent.insertBefore(state.communication,next);
        }

        state.layer?.remove();
        state.style?.remove();
        state.layer=null;
        state.style=null;
        state.communication=null;
        state.communicationPlaceholder=null;
        state.communicationParent=null;
        state.communicationNext=null;
        state.phoneTable=null;
        state.phonePlaceholder=null;
        state.phoneRow=null;
        state.phoneRowParent=null;
        state.phoneRowNext=null;

        if(resumeLegacy&&state.legacyPaused&&state.legacy&&registry[LEGACY_KEY]===state.legacy&&typeof state.legacy.resume==='function'){
            try{state.legacy.resume()}catch{}
            state.legacyPaused=false;
            state.legacy=null;
        }
    };

    const pauseLegacy=()=>{
        const legacy=registry[LEGACY_KEY];
        if(!legacy||legacy===state.legacy||typeof legacy.suspend!=='function')return;
        if(state.communication)restoreLayout(false);
        try{
            if(legacy.suspend()!==false){
                state.legacy=legacy;
                state.legacyPaused=true;
            }
        }catch{}
    };

    const updatePosition=elements=>{
        if(!state.layer?.isConnected)return;
        const sheetRect=elements.sheet.getBoundingClientRect();
        const quotationRect=elements.quotation.getBoundingClientRect();
        const referenceRect=elements.reference.getBoundingClientRect();
        const sourceLabel=elements.quotation.querySelector('td.o_td_label');
        const labelWidth=sourceLabel?.getBoundingClientRect().width||165;
        state.layer.style.setProperty('--yd-mc-label-width',Math.ceil(labelWidth)+'px');
        const gap=referenceRect.top-quotationRect.bottom;
        const height=Math.min(108,gap-16);
        if(height<70){
            state.layer.style.display='none';
            return;
        }
        const width=Math.min(referenceRect.width-8,Math.max(180,referenceRect.width*.76));
        const top=quotationRect.bottom-sheetRect.top+(gap-height)/2-elements.sheet.clientTop;
        const left=referenceRect.left-sheetRect.left-elements.sheet.clientLeft;
        state.layer.style.display='block';
        state.layer.style.top=top+'px';
        state.layer.style.left=left+'px';
        state.layer.style.width=width+'px';
        state.layer.style.height=height+'px';
    };

    const place=elements=>{
        const communication=elements.communication;
        state.communication=communication;
        state.communicationParent=communication.parentNode;
        state.communicationNext=communication.nextSibling;
        state.communicationPlaceholder=makePlaceholder(communication);
        communication.replaceWith(state.communicationPlaceholder);

        const phoneRow=elements.phone?.closest('tr');
        const phoneTable=elements.phone?.closest('table');
        if(phoneRow&&phoneTable&&phoneTable!==communication){
            state.phoneTable=phoneTable;
            state.phonePlaceholder=makePlaceholder(phoneTable);
            state.phoneRow=phoneRow;
            state.phoneRowParent=phoneRow.parentNode;
            state.phoneRowNext=phoneRow.nextSibling;
            phoneTable.replaceWith(state.phonePlaceholder);
            const body=communication.querySelector('tbody');
            if(body)body.appendChild(phoneRow);
        }

        state.layer=document.createElement('div');
        state.layer.className='yd-mc-layer';
        state.layer.setAttribute('data-tool',TOOL_ID);
        elements.sheet.appendChild(state.layer);
        state.layer.appendChild(communication);
        injectStyle();
        setupCopyFields(elements);
        updatePosition(elements);
    };

    const run=()=>{
        if(state.suspended||state.destroyed)return;
        pauseLegacy();
        const elements=findElements();
        if(!elements)return;
        if(state.communication&&state.communication!==elements.communication){
            restoreLayout(false);
        }
        if(!state.communication)place(elements);
        else{
            if(state.communication.parentNode!==state.layer)state.layer?.appendChild(state.communication);
            setupCopyFields(elements);
            updatePosition(elements);
        }
    };

    const schedule=()=>{
        if(state.scheduled||state.suspended||state.destroyed)return;
        state.scheduled=true;
        Promise.resolve().then(()=>{
            state.scheduled=false;
            run();
        });
    };

    const suspend=()=>{
        if(state.suspended)return true;
        state.suspended=true;
        state.observer?.disconnect();
        state.resizeObserver?.disconnect();
        window.removeEventListener('resize',schedule);
        restoreLayout(true);
        return true;
    };

    const resume=()=>{
        if(state.destroyed)return false;
        state.suspended=false;
        run();
        state.observer?.observe(document.body,{childList:true,subtree:true});
        const sheet=document.querySelector('.o_form_sheet');
        if(sheet&&state.resizeObserver)state.resizeObserver.observe(sheet);
        window.addEventListener('resize',schedule);
        return true;
    };

    const instance=Object.freeze({
        id:TOOL_ID,
        path:'TOOLS/move-communication.js',
        suspend,
        resume,
        destroy(){
            suspend();
            state.destroyed=true;
            if(registry[TOOL_ID]===instance)delete registry[TOOL_ID];
            return true;
        }
    });

    registry[TOOL_ID]=instance;
    state.observer=new MutationObserver(schedule);
    state.resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
    state.observer.observe(document.body,{childList:true,subtree:true});
    const sheet=document.querySelector('.o_form_sheet');
    if(sheet&&state.resizeObserver)state.resizeObserver.observe(sheet);
    window.addEventListener('resize',schedule);
    run();
})();