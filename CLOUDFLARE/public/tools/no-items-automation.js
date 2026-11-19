// ==UserScript==
// @name         No Items Automation
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// ==/UserScript==

(async()=>{

'use strict';

const state={
    running:false,
    paused:false,
    noItems:0,
    deletedLogs:0,
    total:0,
    fetchProgress:0,
    screenshotProgress:0,
    screenshotTotal:0,
    confirm:false,
    report:[],
    noItemTickets:new Set(),
    pausedStatus:''
};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const waitFor=async(fn,timeout=5000,interval=25)=>{
    const end=Date.now()+timeout;
    while(Date.now()<end){
        if(state.paused){
            await sleep(100);
            continue;
        }
        const result=fn();
        if(result)return result;
        await sleep(interval);
    }
    return null;
};

const getContext=id=>({
    ...odoo.session_info.user_context,
    uid:odoo.session_info.uid,
    allowed_company_ids:[2],
    active_id:id
});

const getConfirmContext=()=>({
    ...odoo.session_info.user_context,
    uid:odoo.session_info.uid,
    allowed_company_ids:[2]
});

const rpc=async(url,model,method,args,kwargs={})=>{
    const response=await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            jsonrpc:'2.0',
            method:'call',
            params:{model,method,args,kwargs},
            id:Date.now()+Math.random()
        })
    });
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return response.json();
};

const fetchTicket=id=>rpc(
    '/web/dataset/call_button',
    'helpdesk.ticket',
    'action_fetch_suitable_alternatives',
    [[id]],
    {context:getContext(id)}
);

const hasNoItems=result=>{
    try{return /No items need to check/i.test(JSON.stringify(result||{}));}
    catch{return false;}
};

const getRpcErrorMessage=result=>{
    const error=result?.error;
    return String(
        error?.data?.message||
        error?.data?.arguments?.[0]||
        error?.message||
        'Fetch request failed'
    );
};

const getRows=()=>document.querySelectorAll('tr.o_data_row');

const getVisibleTickets=()=>{
    const tickets=[];
    getRows().forEach(row=>{
        const match=(row.innerText||'').match(/#(\d+)/);
        if(match){
            const id=Number(match[1]);
            if(id&&!tickets.includes(id))tickets.push(id);
        }
    });
    return tickets;
};

const getRow=id=>{
    for(const row of getRows()){
        if(new RegExp(`#${id}\\b`).test(row.innerText||''))return row;
    }
    return null;
};

const getForm=()=>document.querySelector('.o_form_view');

const isFormView=()=>!!getForm();

const isListView=()=>!isFormView()&&!!document.querySelector('tr.o_data_row');

const getCurrentTicketId=()=>{
    const form=getForm();
    if(!form)return null;

    for(const attribute of ['data-res-id','data-id','data-record-id','data-resid']){
        const value=form.getAttribute(attribute);
        if(value&&/^\d+$/.test(value))return Number(value);
    }

    const input=form.querySelector('input[name="id"]');
    if(input&&/^\d+$/.test(input.value||''))return Number(input.value);

    const href=location.href.match(/[?&#]id=(\d+)/);
    if(href)return Number(href[1]);

    const hash=(location.hash||'').match(/(?:^|&)id=(\d+)(?:&|$)/);
    if(hash)return Number(hash[1]);

    const text=(form.innerText||'').match(/#(\d+)/);
    return text?Number(text[1]):null;
};

const addReport=(ticketId,action)=>{
    const existing=state.report.find(x=>x.ticketId===ticketId);
    if(existing){
        existing.action=action;
        return;
    }
    state.report.push({ticketId,action});
};

const getSaleOrderId=async()=>{
    return waitFor(()=>{
        const link=document.querySelector('a[name="sale_order_id"][href*="model=sale.order"]');
        if(!link)return null;
        const match=(link.getAttribute('href')||'').match(/[?&#]id=(\d+)/);
        return match?Number(match[1]):null;
    },3000,25);
};

const confirmSaleOrder=async()=>{
    if(!state.confirm)return true;

    const saleOrderId=await getSaleOrderId();
    if(!saleOrderId)return false;

    const result=await rpc(
        '/web/dataset/call_button',
        'sale.order',
        'action_confirm',
        [[saleOrderId]],
        {context:getConfirmContext()}
    );

    return !result?.error;
};

const getFetchMessages=async(ticketId,baseline)=>{
    const domain=[['model','=','helpdesk.ticket'],['res_id','=',ticketId]];
    if(baseline&&Number.isSafeInteger(baseline.id))domain.push(['id','>',baseline.id]);
    const result=await rpc('/web/dataset/call_kw/mail.message/search_read','mail.message','search_read',[domain],{fields:['id','body','date','author_id'],order:'id asc',limit:100,context:getContext(ticketId)});
    if(result?.error)throw new Error('Could not read Fetch messages');
    return result?.result||[];
};

const getMessageBaseline=async ticketId=>{
    const partnerId=Number(window.odoo?.session_info?.partner_id||0);
    if(!partnerId)return null;
    const messages=await getFetchMessages(ticketId);
    return {id:Math.max(0,...messages.map(message=>Number(message.id)||0)),partnerId,startedAt:Date.now()};
};

const getMessageAuthorId=message=>Number(Array.isArray(message?.author_id)?message.author_id[0]:message?.author_id||0);

const getMessageTimestamp=message=>{
    const value=String(message?.date||'').trim();
    if(!value)return NaN;
    const normalized=value.includes('T')?value:value.replace(' ','T')+'Z';
    const timestamp=Date.parse(normalized);
    return Number.isFinite(timestamp)?timestamp:NaN;
};

const isRecentFetchMessage=message=>{
    const timestamp=getMessageTimestamp(message);
    const age=Date.now()-timestamp;
    return Number.isFinite(timestamp)&&age>=-120000&&age<=120000;
};

const isTableFetchMessage=body=>/<table[\s>]/i.test(String(body||''));
const isNoItemsFetchMessage=body=>/No items need to check/i.test(String(body||''));

const isFetchPayloadMessage=(body,ticketId)=>{
    const text=String(body||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim().toLowerCase();
    const ticketPattern=new RegExp(`["']?ticket(?:_id)?["']?\\s*[:=]\\s*["']?${ticketId}(?:\\D|$)`,'i');
    return ticketPattern.test(text)&&['payer','corporate','identifier','drugs'].every(key=>new RegExp(`["']${key}["']\\s*:`).test(text));
};

const getFetchDrugIds=body=>[...String(body||'').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").matchAll(/["']id["']\s*:\s*(\d+)/g)].map(match=>match[1]);

const deleteGeneratedLogs=async(ticketId,baseline)=>{
    if(!baseline||!Number.isSafeInteger(baseline.id)||!baseline.partnerId)return 0;
    const messages=(await getFetchMessages(ticketId,baseline)).filter(message=>
        Number(message.id)>baseline.id&&
        getMessageAuthorId(message)===baseline.partnerId&&
        isRecentFetchMessage(message)
    );
    if(!messages.length)return 0;
    const payloads=messages
        .filter(message=>isFetchPayloadMessage(message.body,ticketId))
        .map(message=>({message,ids:getFetchDrugIds(message.body),time:getMessageTimestamp(message)}))
        .filter(item=>item.ids.length&&Number.isFinite(item.time));
    const outputs=messages.filter(message=>isTableFetchMessage(message.body)||isNoItemsFetchMessage(message.body));
    const pairs=[];
    for(const output of outputs){
        const outputId=Number(output.id);
        const outputTime=getMessageTimestamp(output);
        if(!Number.isSafeInteger(outputId)||!Number.isFinite(outputTime))continue;
        const matches=payloads.filter(item=>{
            const payloadId=Number(item.message.id);
            if(payloadId>=outputId||outputTime<item.time||outputTime-item.time>120000)return false;
            if(isNoItemsFetchMessage(output.body))return true;
            const tableText=String(output.body||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ');
            return item.ids.some(id=>new RegExp(`(?:^|\\\\D)${id}(?:\\\\D|$)`).test(tableText));
        }).sort((x,y)=>y.time-x.time||Number(y.message.id)-Number(x.message.id));
        if(matches.length)pairs.push({payload:matches[0].message,output,outputTime});
    }
    if(!pairs.length)return 0;
    pairs.sort((x,y)=>y.outputTime-x.outputTime||Number(y.output.id)-Number(x.output.id));
    const pair=pairs[0];
    if(!isRecentFetchMessage(pair.payload)||!isRecentFetchMessage(pair.output))return 0;
    const ids=[Number(pair.payload.id),Number(pair.output.id)];
    if(ids.some(id=>!Number.isSafeInteger(id)||id<=baseline.id))return 0;
    const result=await rpc('/web/dataset/call_kw/mail.message/unlink','mail.message','unlink',[ids],{context:getContext(ticketId)});
    if(result?.error||result?.result!==true)throw new Error('FETCH LOG CLEANUP FAILED');
    return ids.length;
};

const openTicket=async id=>{
    const row=getRow(id);
    if(!row)return false;
    const link=row.querySelector('a[href*="id="]')||row.querySelector('.o_data_cell');
    if(link)link.click();
    else row.click();
    return !!await waitFor(()=>isFormView()&&getCurrentTicketId()===id,7000,25);
};

const backToList=async()=>{
    if(!isFormView())return true;

    history.back();

    const returned=await waitFor(
        ()=>!isFormView()&&document.querySelector('tr.o_data_row'),
        5000,
        25
    );

    if(returned)return true;

    location.hash='action=548&active_id=69&cids=2&menu_id=366&model=helpdesk.ticket&view_type=list';

    return !!await waitFor(
        ()=>!isFormView()&&document.querySelector('tr.o_data_row'),
        5000,
        25
    );
};

const clickFetch=async()=>{
    const button=await waitFor(()=>{
        const element=document.querySelector(
            'button[name="action_fetch_suitable_alternatives"]'
        );
        return element&&!element.disabled?element:null;
    },3000,25);

    if(!button)return false;

    button.click();
    return true;
};

const isVisible=element=>{
    if(!element)return false;
    const rect=element.getBoundingClientRect();
    const style=getComputedStyle(element);
    return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0;
};

const findNoItemsPopup=()=>{
    const selector='.modal,.modal-dialog,[role="dialog"],.o_dialog,.o_notification,.o_notification_content,.swal2-popup,.alert,.toast';
    for(const element of document.querySelectorAll(selector)){
        if(isVisible(element)&&/No items need to check/i.test(element.innerText||''))return element;
    }
    for(const element of document.querySelectorAll('body *')){
        if(!isVisible(element)||!/No items need to check/i.test(element.innerText||''))continue;
        if([...element.children].some(child=>/No items need to check/i.test(child.innerText||'')))continue;
        return element.closest('.modal,.modal-dialog,[role="dialog"],.o_dialog,.o_notification,.swal2-popup,.alert,.toast')||element.parentElement||element;
    }
    return null;
};

const waitForPopup=async()=>waitFor(findNoItemsPopup,10000,25);

const closePopup=async popup=>{
    if(!popup)return;
    const root=popup.closest?.('.modal,.modal-dialog,[role="dialog"],.o_dialog,.o_notification,.swal2-popup,.alert,.toast')||popup;
    const close=root.querySelector?.('.close,[data-dismiss="modal"],[aria-label="Close"],.o_notification_close,.btn-close,button.btn-secondary');
    if(close)close.click();
    else if(root.matches?.('.modal,.modal-dialog,[role="dialog"],.o_dialog,.swal2-popup')){
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27,bubbles:true}));
    }
    await waitFor(()=>!findNoItemsPopup(),2000,25);
};

const blobToFile=blob=>new File(
    [blob],
    'No items need to check.png',
    {type:'image/png'}
);

const openLogNote=async()=>{
    const button=await waitFor(
        ()=>{
            const element=document.querySelector('.o_ChatterTopbar_buttonLogNote');
            return element&&!element.disabled?element:null;
        },
        3000,
        25
    );

    if(!button)return null;

    button.click();

    return waitFor(
        ()=>document.querySelector('.o_ComposerTextInput_textarea'),
        3000,
        25
    );
};

const attachFileToLogNote=async file=>{
    const input=await waitFor(
        ()=>document.querySelector('.o_FileUploader_input'),
        3000,
        25
    );

    if(!input)return false;

    const dataTransfer=new DataTransfer();
    dataTransfer.items.add(file);
    input.files=dataTransfer.files;

    input.dispatchEvent(new Event('change',{bubbles:true}));

    return !!await waitFor(
        ()=>input.files?.length,
        1500,
        25
    );
};

const typeLogNote=async(textarea,text)=>{
    if(!textarea)return false;

    const setter=Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
    ).set;

    setter.call(textarea,text);
    textarea.dispatchEvent(new Event('input',{bubbles:true}));

    return textarea.value===text;
};

const clickLog=async()=>{
    const button=await waitFor(()=>{
        const buttons=document.querySelectorAll('.o_Composer_buttonSend');

        for(const element of buttons){
            const text=(element.innerText||'').trim();
            if(!element.disabled&&/^(Log|Send)$/i.test(text)){
                return element;
            }
        }

        return null;
    },10000,25);

    if(!button)return false;

    button.click();
    return true;
};

const waitForLogSaved=async()=>{
    return !!await waitFor(
        ()=>!document.querySelector('.o_ComposerTextInput_textarea'),
        3000,
        25
    );
};

const saveScreenshotManual=async(blob,message='No items need to check')=>{
    if(!blob)return false;
    if(!await openLogNote())return false;
    if(!await attachFileToLogNote(blobToFile(blob)))return false;
    await sleep(300);
    const textarea=await waitFor(()=>document.querySelector('.o_ComposerTextInput_textarea'),5000,25);
    if(!textarea||!typeLogNote(textarea,message))return false;
    if(!await clickLog())return false;
    return waitForLogSaved();
};

const takeScreenshot=async()=>{
    const root=document.documentElement;
    const body=document.body;
    const fixed=[];
    const markers=[];
    const scrollables=[...document.querySelectorAll('body *')].filter(element=>{
        const style=getComputedStyle(element);
        return element.scrollHeight>element.clientHeight+20&&['auto','scroll'].includes(style.overflowY);
    });
    const width=Math.max(root.scrollWidth,body.scrollWidth,window.innerWidth,...scrollables.map(element=>element.scrollWidth+Math.max(0,element.getBoundingClientRect().left+window.scrollX)));
    const height=Math.max(root.scrollHeight,body.scrollHeight,window.innerHeight,...scrollables.map(element=>element.scrollHeight+Math.max(0,element.getBoundingClientRect().top+window.scrollY)));
    for(const element of document.querySelectorAll('body *')){
        const style=getComputedStyle(element);
        if(style.position!=='fixed'&&style.position!=='sticky')continue;
        const rect=element.getBoundingClientRect();
        if(!rect.width||!rect.height)continue;
        const marker=`noitems-${markers.length}`;
        element.setAttribute('data-noitems-capture',marker);
        markers.push({element,marker});
        fixed.push({marker,left:rect.left+window.scrollX,top:rect.top+window.scrollY});
    }
    try{
        const canvas=await html2canvas(root,{
            backgroundColor:'#fff',
            scale:1,
            useCORS:true,
            logging:false,
            imageTimeout:0,
            x:0,
            y:0,
            width,
            height,
            windowWidth:width,
            windowHeight:window.innerHeight,
            scrollX:0,
            scrollY:0,
            onclone:clonedDocument=>{
                const selectors='.o_web_client,.o_action_manager,.o_content,.o_form_view,.o_form_sheet_bg,.o_chatter,.o-mail-ChatterContainer';
                clonedDocument.querySelectorAll(selectors).forEach(element=>{
                    element.style.setProperty('height','auto','important');
                    element.style.setProperty('max-height','none','important');
                    element.style.setProperty('overflow','visible','important');
                });
                clonedDocument.querySelectorAll('[data-noitems-capture]').forEach(element=>{
                    const item=fixed.find(entry=>entry.marker===element.getAttribute('data-noitems-capture'));
                    if(!item)return;
                    element.style.setProperty('position','absolute','important');
                    element.style.setProperty('left',`${item.left}px`,'important');
                    element.style.setProperty('top',`${item.top}px`,'important');
                    element.style.setProperty('right','auto','important');
                    element.style.setProperty('bottom','auto','important');
                    element.style.setProperty('transform','none','important');
                });
            },
            ignoreElements:element=>
                element.id==='noitems-panel'||
                element.id==='noitems-systray-item'||
                element.matches?.('#ordered-panel,#ordered-systray-item,#ms-stock-hzb-checker,#ms-stock-hzb-systray-item,#tm-confirmation-buttons,#tmSplitButton,#tm-split-selector-button')||
                element.closest?.('#ordered-panel,#ordered-systray-item,#ms-stock-hzb-checker,#ms-stock-hzb-systray-item,#tm-confirmation-buttons,#tmSplitButton,#tm-split-selector-button')
        });
        return await new Promise(resolve=>canvas.toBlob(resolve,'image/png',0.9));
    }finally{
        markers.forEach(({element})=>element.removeAttribute('data-noitems-capture'));
    }
};

const downloadExcelReport=()=>{
    const rows=state.report.map(item=>({
        'Ticket ID':item.ticketId,
        'Action':item.action
    }));

    if(!rows.length){
        rows.push({
            'Ticket ID':'',
            'Action':'No No-Items tickets'
        });
    }

    const worksheet=XLSX.utils.json_to_sheet(rows);

    worksheet['!cols']=[
        {wch:15},
        {wch:38}
    ];

    const workbook=XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        'No Items'
    );

    const now=new Date();
    const pad=value=>String(value).padStart(2,'0');

    XLSX.writeFile(
        workbook,
        `NO_ITEMS_REPORT_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.xlsx`
    );
};

const panel=document.createElement('div');

panel.id='noitems-panel';

panel.innerHTML=`
<div id="noitems-header">
<div id="noitems-title">
<div id="noitems-logo">N</div>
<div id="noitems-name">
<strong>NO ITEMS AUTOMATION</strong>
<span>No Items Screenshot</span>
</div>
</div>
<button id="noitems-close" type="button">×</button>
</div>
<div id="noitems-body">
<div id="noitems-info">
<span id="noitems-info-label">No items need to check</span>
<strong id="noitems-noitems">0</strong>
</div>
<div id="noitems-confirm">
<div id="noitems-confirm-text-box">
<strong>CONFIRM SALES ORDER</strong>
<span id="noitems-confirm-text">OFF • SCREENSHOT + LOG NOTE ONLY</span>
</div>
<label id="noitems-switch">
<input id="noitems-confirm-toggle" type="checkbox">
<span></span>
</label>
</div>
<div id="noitems-stats">
<div class="noitems-stat">
<div class="noitems-stat-label">TOTAL TICKETS</div>
<div id="noitems-total" class="noitems-stat-value">0</div>
</div>
<div class="noitems-stat">
<div class="noitems-stat-label">NO ITEMS FOUND</div>
<div id="noitems-found" class="noitems-stat-value">0</div>
</div>
<div class="noitems-stat">
<div class="noitems-stat-label">DELETED LOGS</div>
<div id="noitems-deleted" class="noitems-stat-value">0</div>
</div>
<div class="noitems-stat">
<div class="noitems-stat-label">NO ITEMS PROGRESS</div>
<div id="noitems-progress-count" class="noitems-stat-value">0/0</div>
</div>
</div>
<div class="noitems-progress-row">
<span class="noitems-progress-label">FETCH PROGRESS</span>
<span id="noitems-fetch-count" class="noitems-progress-value">0/0</span>
</div>
<div class="noitems-progress">
<div id="noitems-fetch-bar" class="noitems-progress-bar"></div>
</div>
<div class="noitems-progress-row">
<span class="noitems-progress-label">NO ITEMS PROGRESS</span>
<span id="noitems-screenshot-count" class="noitems-progress-value">0/0</span>
</div>
<div class="noitems-progress">
<div id="noitems-screenshot-bar" class="noitems-progress-bar"></div>
</div>
<div id="noitems-status">
<div id="noitems-status-dot"></div>
<div id="noitems-status-text">IDLE</div>
</div>
<div id="noitems-controls">
<button id="noitems-start" class="noitems-btn" type="button">▶ START NO ITEMS</button>
<button id="noitems-pause" class="noitems-btn" type="button">Ⅱ PAUSE</button>
<button id="noitems-resume" class="noitems-btn" type="button">▶ RESUME</button>
</div>
</div>
<div id="noitems-footer">YODAWY • NO ITEMS</div>
`;

document.body.appendChild(panel);

const totalElement=panel.querySelector('#noitems-total');
const noItemsElement=panel.querySelector('#noitems-noitems');
const foundElement=panel.querySelector('#noitems-found');
const deletedElement=panel.querySelector('#noitems-deleted');
const progressCountElement=panel.querySelector('#noitems-progress-count');
const fetchCountElement=panel.querySelector('#noitems-fetch-count');
const screenshotCountElement=panel.querySelector('#noitems-screenshot-count');
const fetchBar=panel.querySelector('#noitems-fetch-bar');
const screenshotBar=panel.querySelector('#noitems-screenshot-bar');
const statusElement=panel.querySelector('#noitems-status-text');
const statusDot=panel.querySelector('#noitems-status-dot');
const startButton=panel.querySelector('#noitems-start');
const pauseButton=panel.querySelector('#noitems-pause');
const resumeButton=panel.querySelector('#noitems-resume');
const confirmToggle=panel.querySelector('#noitems-confirm-toggle');
const confirmText=panel.querySelector('#noitems-confirm-text');

const setStatus=text=>{
    if(state.paused){
        state.pausedStatus=text;
        return;
    }
    statusElement.textContent=text;
};

const updatePauseUI=()=>{
    pauseButton.disabled=!state.running||state.paused;
    resumeButton.disabled=!state.running;

    statusDot.style.background=
        state.paused?'#68465f':
        state.running?'#875A7B':'#666';
};

const pauseAutomation=()=>{
    if(!state.running||state.paused)return;

    state.pausedStatus=statusElement.textContent||'RUNNING';
    state.paused=true;
    statusElement.textContent='PAUSED';
    updatePauseUI();
};

const resumeAutomation=()=>{
    if(!state.running||!state.paused)return;

    state.paused=false;
    statusElement.textContent=state.pausedStatus||'RESUMING';
    state.pausedStatus='';
    updatePauseUI();
};

const updateConfirmUI=()=>{
    state.confirm=confirmToggle.checked;

    confirmText.textContent=state.confirm
        ?'ON • SCREENSHOT + LOG NOTE + CONFIRM'
        :'OFF • SCREENSHOT + LOG NOTE ONLY';
};

const updateCounter=()=>{
    const counter=document.querySelector('#noitems-counter');
    if(counter)counter.textContent=state.noItems;
};

const updateStats=()=>{
    totalElement.textContent=state.total;
    noItemsElement.textContent=state.noItems;
    foundElement.textContent=state.noItems;
    deletedElement.textContent=state.deletedLogs;

    progressCountElement.textContent=
        `${state.screenshotProgress}/${state.screenshotTotal}`;

    fetchCountElement.textContent=
        `${state.fetchProgress}/${state.total}`;

    screenshotCountElement.textContent=
        `${state.screenshotProgress}/${state.screenshotTotal}`;

    fetchBar.style.width=
        `${state.total?Math.min(100,state.fetchProgress/state.total*100):0}%`;

    screenshotBar.style.width=
        `${state.screenshotTotal?Math.min(100,state.screenshotProgress/state.screenshotTotal*100):0}%`;

    updateCounter();
    updatePauseUI();
};

const style=document.createElement('style');

style.id='noitems-style';

style.textContent=`
#noitems-panel{display:none;position:fixed;right:20px;bottom:20px;width:430px;z-index:999999;background:#fff;color:#666;border:1px solid #68465f;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;overflow:hidden}
#noitems-panel.open{display:block}
#noitems-header{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;background:#875A7B;color:#fff}
#noitems-title{display:flex;align-items:center;gap:9px}
#noitems-logo{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;background:#68465f;font-size:13px;font-weight:700}
#noitems-name{display:flex;flex-direction:column;line-height:1.2}
#noitems-name strong{font-size:13px}
#noitems-name span{margin-top:2px;font-size:10px;color:rgba(255,255,255,.75)}
#noitems-close{width:28px;height:28px;border:1px solid rgba(255,255,255,.35);border-radius:4px;background:transparent;color:#fff;cursor:pointer;font-size:17px}
#noitems-body{padding:12px}
#noitems-info,#noitems-confirm{display:flex;align-items:center;justify-content:space-between;min-height:42px;padding:7px 9px;margin-bottom:10px;border:1px solid #d9d9d9;border-radius:4px}
#noitems-info-label{font-size:11px;font-weight:600}
#noitems-info strong{color:#875A7B;font-size:11px}
#noitems-confirm-text-box{min-width:0;display:flex;flex-direction:column;line-height:1.2}
#noitems-confirm-text-box strong{font-size:11px;font-weight:600}
#noitems-confirm-text{margin-top:3px;font-size:9px;color:#888;font-weight:600}
#noitems-switch{position:relative;width:38px;height:20px;flex:0 0 38px;cursor:pointer}
#noitems-switch input{display:none}
#noitems-switch span{position:absolute;inset:0;background:#aaa;border-radius:12px}
#noitems-switch span:before{content:"";position:absolute;width:14px;height:14px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s}
#noitems-switch input:checked+span{background:#875A7B}
#noitems-switch input:checked+span:before{transform:translateX(18px)}
#noitems-stats{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}
.noitems-stat{min-height:52px;padding:7px 9px;border:1px solid #d9d9d9;border-radius:4px}
.noitems-stat-label{font-size:9px;font-weight:600;color:#777}
.noitems-stat-value{margin-top:4px;color:#875A7B;font-size:15px;font-weight:700}
.noitems-progress-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.noitems-progress-label,.noitems-progress-value{font-size:9px;font-weight:600}
.noitems-progress-value{color:#875A7B}
.noitems-progress{height:4px;margin-bottom:9px;background:#eee;border-radius:3px;overflow:hidden}
.noitems-progress-bar{width:0;height:100%;background:#875A7B}
#noitems-status{display:flex;align-items:center;gap:7px;height:32px;padding:0 9px;margin-bottom:10px;background:#f8f8f8;border:1px solid #e3e3e3;border-radius:4px}
#noitems-status-dot{width:7px;height:7px;border-radius:50%;background:#666}
#noitems-status-text{font-size:11px;font-weight:600}
#noitems-controls{display:flex;gap:7px}
.noitems-btn{height:36px;flex:1;border:1px solid #68465f;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer}
#noitems-start,#noitems-resume{background:#875A7B;color:#fff}
#noitems-pause{background:#fff;color:#875A7B}
.noitems-btn:hover{opacity:.9}
.noitems-btn:disabled{background:#aaa!important;border-color:#aaa!important;color:#fff!important;opacity:1;cursor:not-allowed}
#noitems-footer{height:26px;display:flex;align-items:center;justify-content:center;border-top:1px solid #e6e6e6;background:#fafafa;color:#999;font-size:9px}
#noitems-systray-item{display:flex!important;align-items:center!important;justify-content:center!important;width:42px!important;height:46px!important;padding:0!important;margin:0!important;flex:0 0 42px!important;order:-999!important}
#noitems-systray-button{position:relative!important;display:flex!important;align-items:center!important;justify-content:center!important;width:42px!important;height:46px!important;padding:0!important;margin:0!important;border:0!important;background:transparent!important;color:rgba(255,255,255,.8)!important;cursor:pointer!important}
#noitems-systray-button i{font-size:18px!important}
#noitems-counter{position:absolute;top:6px;right:4px;min-width:14px;height:14px;padding:0 3px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#875A7B;color:#fff;font:700 8px/14px Arial,sans-serif;pointer-events:none}
@media(max-width:600px){#noitems-panel{right:10px;bottom:10px;width:calc(100vw - 20px)}}
`;

document.head.appendChild(style);

const systray=document.createElement('li');

systray.id='noitems-systray-item';
systray.setAttribute('role','menuitem');

systray.innerHTML=`
<button id="noitems-systray-button" type="button" title="No Items Automation" aria-label="No Items Automation">
<i class="yd-custom-icon fa fa-camera"></i>
<span id="noitems-counter">0</span>
</button>
`;

let systrayPlaced=false;

const placeSystrayFirst=()=>{
    const ul=document.querySelector('ul.o_menu_systray[role="menu"],ul.o_menu_systray');
    if(!ul)return;

    if(ul.firstElementChild!==systray){
        ul.insertBefore(systray,ul.firstElementChild);
    }

    systrayPlaced=true;
};

placeSystrayFirst();

const systrayTimer=setInterval(()=>{
    if(!systrayPlaced||!document.body.contains(systray)){
        placeSystrayFirst();
        systrayPlaced=document.body.contains(systray);
    }
},1500);

confirmToggle.addEventListener('change',()=>{
    if(!state.running){
        updateConfirmUI();
    }else{
        confirmToggle.checked=state.confirm;
    }
});

panel.querySelector('#noitems-close').addEventListener('click',e=>{
    e.preventDefault();
    e.stopImmediatePropagation();
    panel.classList.remove('open');
},true);

systray.querySelector('#noitems-systray-button').addEventListener('click',e=>{
    e.preventDefault();
    e.stopImmediatePropagation();
    panel.classList.toggle('open');
},true);

pauseButton.addEventListener('click',e=>{
    e.preventDefault();
    e.stopImmediatePropagation();
    pauseAutomation();
},true);

resumeButton.addEventListener('click',e=>{
    e.preventDefault();
    e.stopImmediatePropagation();
    resumeAutomation();
},true);

startButton.addEventListener('click',e=>{
    e.preventDefault();
    e.stopImmediatePropagation();

    if(state.running)return;

    const mode=state.confirm
        ?'ON — Screenshot + Log Note + Confirm'
        :'OFF — Screenshot + Log Note ONLY';

    if(!window.confirm(
        `⚠️ CONFIRM SWITCH IS ${state.confirm?'ON':'OFF'}\n\n${mode}\n\nAre you sure you want to START?`
    ))return;

    run();
},true);

const processCurrentTicket=async()=>{
    const ticketId=getCurrentTicketId();

    if(!ticketId){
        setStatus('TICKET ID NOT FOUND');
        return false;
    }

    state.total=1;
    state.fetchProgress=0;
    state.screenshotTotal=1;
    state.screenshotProgress=0;

    updateStats();

    setStatus(`FETCHING #${ticketId}`);

    const beforeIds=await getMessageBaseline(ticketId);
    if(!beforeIds){setStatus('FETCH BASELINE FAILED');return false;}
    const clicked=await clickFetch();

    if(!clicked){
        addReport(ticketId,'FETCH BUTTON NOT FOUND');
        state.fetchProgress=1;
        state.screenshotProgress=1;
        updateStats();
        return false;
    }

    const popup=await waitForPopup();

    if(!popup){
        const deleted=await deleteGeneratedLogs(ticketId,beforeIds);

        if(deleted)state.deletedLogs++;

        state.fetchProgress=1;
        state.screenshotProgress=1;

        addReport(ticketId,'ITEMS FOUND');
        updateStats();

        return false;
    }

    state.fetchProgress=1;
    state.noItems=1;

    updateStats();

    setStatus('CAPTURING SCREEN');

    const suspended=await suspendTools();
    let blob=null;
    try{
        blob=await takeScreenshot();
    }finally{
        await resumeTools(suspended);
    }

    await closePopup(popup);

    if(!blob){
        addReport(ticketId,'SCREENSHOT FAILED');
        state.screenshotProgress=1;
        updateStats();
        setStatus('SCREENSHOT FAILED');
        return false;
    }

    const deleted=await deleteGeneratedLogs(ticketId,beforeIds);
    if(deleted)state.deletedLogs++;

    setStatus('ADDING LOG NOTE');

    const saved=await saveScreenshotManual(blob);

    if(!saved){
        addReport(ticketId,'LOG NOTE FAILED');
        state.screenshotProgress=1;
        updateStats();
        setStatus('LOG NOTE FAILED');
        return false;
    }

    if(!state.confirm){
        addReport(ticketId,'SCREENSHOT + LOG NOTE');
        state.screenshotProgress=1;
        updateStats();
        setStatus('DONE • 1 NO ITEMS • LOGGED ONLY');
        return true;
    }

    setStatus('CONFIRMING SALES ORDER');

    const confirmed=await confirmSaleOrder();

    state.screenshotProgress=1;
    updateStats();

    addReport(
        ticketId,
        confirmed
            ?'SCREENSHOT + LOG NOTE + CONFIRMED'
            :'SCREENSHOT + LOG NOTE + CONFIRM FAILED'
    );

    setStatus(
        confirmed
            ?'DONE • 1 NO ITEMS • CONFIRMED'
            :'CONFIRM FAILED'
    );

    return confirmed;
};

const suspendTools=async()=>{
    const registry=window.YODAWY_TOOL_INSTANCES||{};
    const suspended=[];
    for(const instance of Object.values(registry)){
        if(typeof instance?.suspend!=='function')continue;
        try{if(await instance.suspend()!==false)suspended.push(instance);}catch{}
    }
    const ordered=window.__MS_ORDERED_BY_WH__;
    if(typeof ordered?.suspend==='function'){
        try{if(await ordered.suspend()!==false)suspended.push(ordered);}catch{}
    }
    return suspended;
};

const resumeTools=async suspended=>{
    for(const instance of suspended.reverse()){
        try{await instance.resume?.();}catch{}
    }
};

const processTicketAttempt=async(ticketId,index,totalTargets,attempt)=>{
    let opened=false;
    let popup=null;
    let popupClosed=false;
    let suspended=[];
    let baseline=null;
    try{
        setStatus(`FETCHING #${ticketId} • ${index}/${totalTargets}`);
        baseline=await getMessageBaseline(ticketId);
        if(!baseline)throw new Error('FETCH BASELINE FAILED');
        const result=await fetchTicket(ticketId);
        const noItems=hasNoItems(result);
        if(result?.error&&!noItems)throw new Error(getRpcErrorMessage(result));
        state.fetchProgress++;
        updateStats();
        if(!noItems){
            addReport(ticketId,'ITEMS FOUND');
            return;
        }
        if(!state.noItemTickets.has(ticketId)){
            state.noItemTickets.add(ticketId);
            state.noItems++;
            updateStats();
        }
        opened=await openTicket(ticketId);
        if(!opened||getCurrentTicketId()!==ticketId)throw new Error('OPEN NO-ITEM TICKET FAILED');
        suspended=await suspendTools();
        setStatus(`CAPTURING • NO ITEM #${ticketId}`);
        if(!await clickFetch())throw new Error('NO-ITEM FETCH DISPLAY FAILED');
        popup=await waitForPopup();
        if(!popup)throw new Error('NO-ITEM FETCH RESULT NOT FOUND');
        const blob=await takeScreenshot();
        if(!blob)throw new Error('FULL PAGE SCREENSHOT FAILED');
        await closePopup(popup);
        popupClosed=true;
        setStatus(`ADDING SCREENSHOT • #${ticketId}`);
        const saved=await saveScreenshotManual(blob);
        if(!saved)throw new Error('LOG NOTE FAILED');
        if(!state.confirm){
            addReport(ticketId,'FULL PAGE SCREENSHOT + LOG NOTE');
            return;
        }
        setStatus(`CONFIRMING • #${ticketId}`);
        const confirmed=await confirmSaleOrder();
        addReport(ticketId,confirmed?'FULL PAGE SCREENSHOT + LOG NOTE + CONFIRMED':'FULL PAGE SCREENSHOT + LOG NOTE + CONFIRM FAILED');
    }finally{
        if(popup&&!popupClosed)await closePopup(popup);
        if(baseline){
            const deleted=await deleteGeneratedLogs(ticketId,baseline);
            if(deleted){
                state.deletedLogs+=deleted;
                updateStats();
            }
        }
        await resumeTools(suspended);
        if(opened)await backToList();
    }
};

const captureFailureEvidence=async(ticketId,error)=>{
    let opened=false;
    let suspended=[];
    try{
        opened=await openTicket(ticketId);
        if(!opened)return false;
        suspended=await suspendTools();
        const blob=await takeScreenshot();
        if(!blob)return false;
        const message=`Automation error after retry: ${String(error?.message||error||'Unknown error').slice(0,500)}`;
        return await saveScreenshotManual(blob,message);
    }catch{
        return false;
    }finally{
        await resumeTools(suspended);
        if(opened)await backToList();
    }
};

const processTicket=async(ticketId,index,totalTargets)=>{
    let lastError=null;
    for(let attempt=1;attempt<=2;attempt++){
        try{
            await processTicketAttempt(ticketId,index,totalTargets,attempt);
            state.screenshotProgress++;
            updateStats();
            return;
        }catch(error){
            lastError=error;
            if(attempt===1){
                setStatus(`RETRY #${ticketId} • 2/2`);
                await sleep(250);
            }
        }
    }
    const captured=await captureFailureEvidence(ticketId,lastError);
    addReport(ticketId,captured?'ERROR SCREENSHOT + LOG NOTE':'PROCESS FAILED AFTER RETRY');
    state.screenshotProgress++;
    updateStats();
};

const runListAutomation=async tickets=>{
    state.fetchProgress=0;
    state.screenshotProgress=0;
    state.screenshotTotal=tickets.length;
    state.noItems=0;
    state.noItemTickets.clear();
    updateStats();
    for(let index=0;index<tickets.length;index++){
        while(state.paused)await sleep(100);
        await processTicket(tickets[index],index+1,tickets.length);
    }
    return state.report.filter(item=>item.action.startsWith('SCREENSHOT')).map(item=>item.ticketId);
};
const finish=()=>{
    state.running=false;
    state.paused=false;
    state.pausedStatus='';

    startButton.disabled=false;
    pauseButton.disabled=true;
    resumeButton.disabled=true;
    confirmToggle.disabled=false;

    updatePauseUI();
};

const run=async()=>{
    if(state.running)return;

    state.running=true;
    state.paused=false;
    state.pausedStatus='';
    state.noItems=0;
    state.deletedLogs=0;
    state.total=0;
    state.fetchProgress=0;
    state.screenshotProgress=0;
    state.screenshotTotal=0;
    state.report=[];
    state.noItemTickets.clear();

    startButton.disabled=true;
    pauseButton.disabled=false;
    resumeButton.disabled=false;
    confirmToggle.disabled=true;

    panel.classList.add('open');

    updateStats();

    if(!isListView()){
        setStatus('OPEN LIST VIEW OR TICKET');
        finish();
        return;
    }

    const tickets=getVisibleTickets();

    state.total=tickets.length;
    updateStats();

    if(!tickets.length){
        setStatus('NO TICKETS');
        finish();
        return;
    }

    setStatus(`FETCHING ${tickets.length} TICKETS`);

    const targets=await runListAutomation(tickets);

    setStatus(
        state.confirm
            ?`DONE • ${targets.length} NO ITEMS • CONFIRMED`
            :`DONE • ${targets.length} NO ITEMS • LOGGED ONLY`
    );

    downloadExcelReport();
    finish();
};

updateConfirmUI();
updateStats();

})();
