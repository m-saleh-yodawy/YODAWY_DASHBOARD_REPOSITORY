// ==UserScript==
// @name         SCREEN
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @description  Capture and copy a clean screenshot with all active tools temporarily suspended.
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function(){
'use strict';

const TOOL_ID='TOOL-019';
const ITEM_ID='yd-screen-systray-item';
const BUTTON_ID='yd-screen-button';
const STYLE_ID='yd-screen-style';
const MARKER='data-yd-screen-marker';
const LIBRARY_URL='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const registry=window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
if(registry[TOOL_ID])return;

const state={
    destroyed:false,
    suspended:false,
    busy:false,
    item:null,
    button:null,
    style:null,
    observer:null,
    controller:new AbortController(),
    libraryPromise:null,
    toast:null,
    toastTimer:null
};

const waitFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

const removeToast=()=>{
    if(state.toastTimer)clearTimeout(state.toastTimer);
    state.toastTimer=null;
    state.toast?.remove();
    state.toast=null;
};

const showToast=(message,type='success')=>{
    removeToast();
    if(state.destroyed||state.suspended)return;
    const toast=document.createElement('div');
    toast.id='yd-screen-toast';
    toast.dataset.type=type;
    toast.textContent=message;
    document.body.appendChild(toast);
    state.toast=toast;
    state.toastTimer=setTimeout(removeToast,4200);
};

const addStyle=()=>{
    if(state.style?.isConnected)return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=
        '#'+ITEM_ID+'{display:flex!important;align-items:center!important;justify-content:center!important;width:42px!important;height:46px!important;padding:0!important;margin:0!important;flex:0 0 42px!important;order:-998!important}\n'+
        '#'+BUTTON_ID+'{position:relative!important;display:flex!important;align-items:center!important;justify-content:center!important;width:42px!important;height:46px!important;padding:0!important;margin:0!important;border:0!important;border-radius:0!important;background:transparent!important;color:rgba(255,255,255,.88)!important;cursor:pointer!important}\n'+
        '#'+BUTTON_ID+':hover{background:rgba(255,255,255,.08)!important;color:#fff!important}\n'+
        '#'+BUTTON_ID+':disabled{opacity:.55!important;cursor:wait!important}\n'+
        '#'+BUTTON_ID+' i{font-size:18px!important}\n'+
        '#'+BUTTON_ID+'.yd-screen-working i{animation:yd-screen-pulse .8s ease-in-out infinite alternate}\n'+
        '@keyframes yd-screen-pulse{from{opacity:.45;transform:scale(.9)}to{opacity:1;transform:scale(1.08)}}\n'+
        '#yd-screen-toast{position:fixed!important;right:22px!important;bottom:22px!important;z-index:2147483647!important;max-width:min(420px,calc(100vw - 44px))!important;padding:11px 15px!important;border:1px solid #ddd2dc!important;border-radius:9px!important;background:#fff!important;color:#302631!important;box-shadow:0 8px 28px #24162726!important;font:600 13px/1.5 Arial,sans-serif!important;pointer-events:none!important}\n'+
        '#yd-screen-toast[data-type="error"]{border-color:#e8b6bd!important;color:#a21d2d!important}\n'+
        '#yd-screen-toast[data-type="warning"]{border-color:#ead7a8!important;color:#7a5814!important}';
    document.head.appendChild(style);
    state.style=style;
};

const placeButton=()=>{
    if(state.destroyed||state.suspended||!document.body)return false;
    const nav=document.querySelector('ul.o_menu_systray[role="menu"],ul.o_menu_systray');
    if(!nav)return false;
    if(state.item.parentElement!==nav)nav.insertBefore(state.item,nav.firstElementChild);
    return true;
};

const watchNavbar=()=>{
    if(state.observer||state.destroyed||state.suspended||!document.body)return;
    state.observer=new MutationObserver(()=>{
        if(!state.suspended&&!state.destroyed&&!state.item.isConnected)placeButton();
    });
    state.observer.observe(document.body,{childList:true,subtree:true});
    placeButton();
};

const ensureLibrary=async()=>{
    if(typeof window.html2canvas==='function')return window.html2canvas;
    if(!state.libraryPromise){
        state.libraryPromise=new Promise((resolve,reject)=>{
            const script=document.createElement('script');
            let timer=setTimeout(()=>{
                script.remove();
                reject(new Error('SCREENSHOT_LIBRARY_TIMEOUT'));
            },15000);
            script.src=LIBRARY_URL;
            script.async=true;
            script.crossOrigin='anonymous';
            script.onload=()=>{
                clearTimeout(timer);
                timer=null;
                if(typeof window.html2canvas==='function')resolve(window.html2canvas);
                else reject(new Error('SCREENSHOT_LIBRARY_UNAVAILABLE'));
            };
            script.onerror=()=>{
                if(timer)clearTimeout(timer);
                script.remove();
                reject(new Error('SCREENSHOT_LIBRARY_LOAD_FAILED'));
            };
            (document.head||document.documentElement).appendChild(script);
        }).catch(error=>{
            state.libraryPromise=null;
            throw error;
        });
    }
    return state.libraryPromise;
};

const captureCanvas=async()=>{
    await ensureLibrary();
    const root=document.documentElement;
    const body=document.body;
    const fixed=[];
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
        const marker='ydscreen-'+fixed.length;
        fixed.push({element,marker,previous:element.getAttribute(MARKER),left:rect.left+window.scrollX,top:rect.top+window.scrollY});
        element.setAttribute(MARKER,marker);
    }
    try{
        try{await document.fonts?.ready;}catch{}
        await waitFrame();
        const canvas=await window.html2canvas(root,{
            backgroundColor:'#fff',
            scale:Math.min(2,Math.max(1,window.devicePixelRatio||1)),
            useCORS:true,
            allowTaint:false,
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
                clonedDocument.querySelectorAll('body *').forEach(element=>{
                    const marker=element.getAttribute(MARKER);
                    if(!marker)return;
                    const item=fixed.find(entry=>entry.marker===marker);
                    if(!item)return;
                    element.style.setProperty('position','absolute','important');
                    element.style.setProperty('left',item.left+'px','important');
                    element.style.setProperty('top',item.top+'px','important');
                    element.style.setProperty('right','auto','important');
                    element.style.setProperty('bottom','auto','important');
                    element.style.setProperty('transform','none','important');
                });
            },
            ignoreElements:element=>{
                const selector='#yd-screen-toast,#noitems-panel,#noitems-systray-item,#ordered-panel,#ordered-systray-item,#ms-stock-hzb-checker,#ms-stock-hzb-systray-item,#ydDirectSplitButton,#ydDirectSplitDialog,#tm-confirmation-buttons,#tmSplitButton,#tm-split-selector-button';
                return element.id===ITEM_ID||element.matches?.(selector)||element.closest?.(selector);
            }
        });
        return await new Promise((resolve,reject)=>{
            canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('SCREENSHOT_IMAGE_CREATION_FAILED')),'image/png');
        });
    }finally{
        fixed.forEach(({element,previous})=>{
            if(previous===null)element.removeAttribute(MARKER);
            else element.setAttribute(MARKER,previous);
        });
    }
};

const cleanCapture=async()=>{
    const entries=Object.entries(registry).filter(([,instance])=>instance&&typeof instance==='object');
    for(const [id,instance] of entries){
        if(typeof instance.suspend!=='function'||typeof instance.resume!=='function'){
            throw new Error('TOOL_LIFECYCLE_UNAVAILABLE: '+id);
        }
    }
    const targets=entries.reverse();
    const suspended=[];
    let blob=null;
    let captureError=null;
    const restoreErrors=[];
    try{
        await ensureLibrary();
        for(const [id,instance] of targets){
            const result=await instance.suspend();
            if(result===false)throw new Error('TOOL_BUSY: '+id);
            suspended.push({id,instance});
        }
        removeToast();
        await waitFrame();
        blob=await captureCanvas();
    }catch(error){
        captureError=error;
    }finally{
        for(const item of suspended.reverse()){
            try{
                const result=await item.instance.resume();
                if(result===false)restoreErrors.push(item.id);
            }catch{
                restoreErrors.push(item.id);
            }
        }
        await waitFrame();
    }
    if(restoreErrors.length)throw new Error('RESTORE_FAILED: '+restoreErrors.join(', '));
    if(captureError)throw captureError;
    if(!blob)throw new Error('SCREENSHOT_EMPTY');
    return blob;
};

const downloadBlob=blob=>{
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    link.href=url;
    link.download='Odoo-Clean-Screenshot-'+stamp+'.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
};

const runCapture=async()=>{
    const capturePromise=cleanCapture();
    let copied=false;
    if(navigator.clipboard?.write&&typeof ClipboardItem==='function'){
        try{
            const item=new ClipboardItem({'image/png':capturePromise});
            await navigator.clipboard.write([item]);
            await capturePromise;
            copied=true;
        }catch{}
    }
    if(copied){
        showToast('Clean screenshot copied to clipboard');
        return;
    }
    const blob=await capturePromise;
    downloadBlob(blob);
    showToast('Clipboard unavailable — clean screenshot downloaded','warning');
};

const handleClick=()=>{
    if(state.destroyed||state.suspended||state.busy)return;
    state.busy=true;
    state.button.disabled=true;
    state.button.classList.add('yd-screen-working');
    showToast('Preparing clean screenshot...');
    runCapture().catch(error=>{
        const message=String(error?.message||'SCREENSHOT_FAILED');
        const detail=message.startsWith('TOOL_BUSY:')?'A tool is currently running. Stop it and try again.':message.startsWith('TOOL_LIFECYCLE_UNAVAILABLE:')?'A tool cannot be safely suspended. Screenshot cancelled.':message.startsWith('RESTORE_FAILED:')?'Some tools did not resume: '+message.slice(15)+'. Refresh Odoo before continuing.':message;
        showToast(detail,'error');
    }).finally(()=>{
        state.busy=false;
        if(state.button){
            state.button.disabled=false;
            state.button.classList.remove('yd-screen-working');
        }
    });
};

const item=document.createElement('li');
item.id=ITEM_ID;
item.setAttribute('role','menuitem');
item.innerHTML='<button id="'+BUTTON_ID+'" type="button" title="Clean Screenshot" aria-label="Clean Screenshot"><i class="yd-custom-icon fa fa-camera" aria-hidden="true"></i></button>';
state.item=item;
state.button=item.querySelector('button');
state.button.addEventListener('click',handleClick,{signal:state.controller.signal});

const instance={
    id:TOOL_ID,
    path:'TOOLS/screen.js',
    suspend(){
        if(state.destroyed)return true;
        state.suspended=true;
        state.observer?.disconnect();
        state.observer=null;
        removeToast();
        state.item.remove();
        state.style?.remove();
        return true;
    },
    resume(){
        if(state.destroyed)return false;
        state.suspended=false;
        addStyle();
        watchNavbar();
        state.button.disabled=state.busy;
        return true;
    },
    destroy(){
        if(state.destroyed)return true;
        if(state.busy)return false;
        state.destroyed=true;
        state.suspended=true;
        state.controller.abort();
        state.observer?.disconnect();
        state.observer=null;
        removeToast();
        state.item.remove();
        state.style?.remove();
        state.style=null;
        if(registry[TOOL_ID]===instance)delete registry[TOOL_ID];
        return true;
    }
};

registry[TOOL_ID]=instance;
addStyle();
watchNavbar();
ensureLibrary().catch(()=>{});
})();