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
const OVERLAY_ID='yd-screen-overlay';
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
    captureAbortController:null,
    libraryPromise:null,
    toast:null,
    toastTimer:null,
    overlay:null
};

const waitFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

const removeOverlay=()=>{
    if(state.overlay){
        state.overlay.remove();
        state.overlay=null;
    }
};

const showOverlay=onCancel=>{
    removeOverlay();
    if(state.destroyed||state.suspended)return;
    const overlay=document.createElement('div');
    overlay.id=OVERLAY_ID;
    overlay.setAttribute('data-yd-screenshot-exclude','true');
    overlay.className='yd-screenshot-exclude';
    overlay.innerHTML=`
        <button id="yd-screen-overlay-cancel" type="button" title="Cancel Screenshot" aria-label="Cancel Screenshot">
            <i class="yd-fa-icon fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
        <div id="yd-screen-overlay-content">
            <div id="yd-screen-spinner">
                <i class="yd-fa-icon fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            </div>
            <div id="yd-screen-overlay-text">Taking screenshot...</div>
        </div>
    `;
    overlay.querySelector('#yd-screen-overlay-cancel')?.addEventListener('click',e=>{
        e.preventDefault();
        e.stopPropagation();
        onCancel?.();
    });
    document.body.appendChild(overlay);
    state.overlay=overlay;
};

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
    toast.setAttribute('data-yd-screenshot-exclude','true');
    toast.className='yd-screenshot-exclude';
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
        '#'+OVERLAY_ID+'{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;background:rgba(0,0,0,.68)!important;backdrop-filter:blur(2px)!important;-webkit-backdrop-filter:blur(2px)!important;z-index:2147483646!important;display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;pointer-events:all!important;user-select:none!important}\n'+
        '#yd-screen-overlay-cancel{position:absolute!important;top:18px!important;right:22px!important;width:38px!important;height:38px!important;border:0!important;border-radius:50%!important;background:rgba(255,255,255,.18)!important;color:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;transition:background .2s,transform .15s!important;z-index:2147483647!important}\n'+
        '#yd-screen-overlay-cancel:hover{background:rgba(255,255,255,.32)!important;transform:scale(1.08)!important}\n'+
        '#yd-screen-overlay-cancel i{font-size:18px!important;line-height:1!important}\n'+
        '#yd-screen-overlay-content{display:flex!important;flex-direction:column!important;align-items:center!important;gap:14px!important;color:#fff!important;text-align:center!important}\n'+
        '#yd-screen-spinner{font-size:42px!important;color:#fff!important;line-height:1!important}\n'+
        '#yd-screen-overlay-text{font:600 15px/1.4 Arial,sans-serif!important;letter-spacing:.3px!important;color:#f0eaf0!important}\n'+
        '#yd-screen-toast{position:fixed!important;right:22px!important;bottom:22px!important;z-index:2147483647!important;max-width:min(420px,calc(100vw - 44px))!important;padding:11px 15px!important;border:1px solid #ddd2dc!important;border-radius:9px!important;background:#fff!important;color:#302631!important;box-shadow:0 8px 28px #24162726!important;font:600 13px/1.5 Arial,sans-serif!important;pointer-events:none!important}\n'+
        '#yd-screen-toast[data-type="error"]{border-color:#e8b6bd!important;color:#a21d2d!important}\n'+
        '#yd-screen-toast[data-type="warning"]{border-color:#ead7a8!important;color:#7a5814!important}';
    document.head.appendChild(style);
    state.style=style;
};

const hasCentralSystray=()=>Boolean(window.YODAWY_TOOLS_MANAGER?.systrayMenu?.isActive);

const registerCentralLauncher=()=>{
    window.YODAWY_TOOLS_MANAGER?.systrayMenu?.register?.(TOOL_ID,{
        launch:()=>handleClick()
    });
};

const placeButton=()=>{
    if(state.destroyed||state.suspended||!document.body)return false;
    if(hasCentralSystray()){
        state.item?.remove();
        registerCentralLauncher();
        return true;
    }
    const nav=document.querySelector('ul.o_menu_systray[role="menu"],ul.o_menu_systray');
    if(!nav)return false;
    if(state.item.parentElement!==nav)nav.insertBefore(state.item,nav.firstElementChild);
    return true;
};

const watchNavbar=()=>{
    if(hasCentralSystray()){
        state.item?.remove();
        registerCentralLauncher();
        return;
    }
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
    // Viewport-only dimensions: capture strictly visible webpage viewport inside the active tab
    const viewportWidth=Math.max(1,Math.round(window.visualViewport?.width||window.innerWidth||root.clientWidth||0));
    const viewportHeight=Math.max(1,Math.round(window.visualViewport?.height||window.innerHeight||root.clientHeight||0));
    const scrollX=Math.round(window.scrollX??window.pageXOffset??root.scrollLeft??0);
    const scrollY=Math.round(window.scrollY??window.pageYOffset??root.scrollTop??0);
    const scale=window.devicePixelRatio||1;

    try{
        try{await document.fonts?.ready;}catch{}
        await waitFrame();
        const rawCanvas=await window.html2canvas(root,{
            backgroundColor:'#fff',
            scale,
            useCORS:true,
            allowTaint:false,
            logging:false,
            imageTimeout:0,
            x:scrollX,
            y:scrollY,
            width:viewportWidth,
            height:viewportHeight,
            windowWidth:window.innerWidth||viewportWidth,
            windowHeight:window.innerHeight||viewportHeight,
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
                const selector='#yd-screen-toast,#yd-screen-overlay,#yd-tools-systray-item,#yd-tools-systray-dropdown,#noitems-panel,#noitems-systray-item,#ordered-panel,#ordered-systray-item,#ms-stock-hzb-checker,#ms-stock-hzb-systray-item,#ydDirectSplitButton,#ydDirectSplitDialog,#tm-confirmation-buttons,#tmSplitButton,#tm-split-selector-button';
                return element.id===ITEM_ID||element.matches?.(selector)||element.closest?.(selector);
            }
        });

        const targetPixelWidth=Math.max(1,Math.round(viewportWidth*scale));
        const targetPixelHeight=Math.max(1,Math.round(viewportHeight*scale));
        let finalCanvas=rawCanvas;
        if(rawCanvas&&(rawCanvas.width!==targetPixelWidth||rawCanvas.height!==targetPixelHeight)){
            const normalizedCanvas=document.createElement('canvas');
            normalizedCanvas.width=targetPixelWidth;
            normalizedCanvas.height=targetPixelHeight;
            const ctx=normalizedCanvas.getContext('2d');
            if(ctx){
                ctx.imageSmoothingEnabled=true;
                ctx.imageSmoothingQuality='high';
                const sourceX=rawCanvas.width>targetPixelWidth?Math.min(Math.max(0,Math.round(scrollX*scale)),rawCanvas.width-targetPixelWidth):0;
                const sourceY=rawCanvas.height>targetPixelHeight?Math.min(Math.max(0,Math.round(scrollY*scale)),rawCanvas.height-targetPixelHeight):0;
                const sourceWidth=Math.min(rawCanvas.width-sourceX,targetPixelWidth);
                const sourceHeight=Math.min(rawCanvas.height-sourceY,targetPixelHeight);
                ctx.drawImage(rawCanvas,sourceX,sourceY,sourceWidth,sourceHeight,0,0,sourceWidth,sourceHeight);
                finalCanvas=normalizedCanvas;
            }
        }

        return await new Promise((resolve,reject)=>{
            finalCanvas.toBlob(blob=>blob?resolve(blob):reject(new Error('SCREENSHOT_IMAGE_CREATION_FAILED')),'image/png');
        });
    }finally{
        fixed.forEach(({element,previous})=>{
            if(previous===null)element.removeAttribute(MARKER);
            else element.setAttribute(MARKER,previous);
        });
    }
};

const cleanCapture=async(signal)=>{
    const coordinator=window.YODAWY_SCREENSHOT_COORDINATOR;
    if(coordinator&&typeof coordinator.capture==='function'){
        return coordinator.capture({
            requesterToolId:TOOL_ID,
            scale:Math.min(2,Math.max(1,window.devicePixelRatio||1)),
            renderer:typeof window.html2canvas==='function'?window.html2canvas:undefined
        });
    }
    const excludedSelectors=[
        '#yd-dashboard-menu-item','#yd-launcher','#yd-dashboard-root','.yd-select-portal-menu',
        '#yodawy-dev-mode-banner','#yd-cloud-error','#yd-screen-systray-item','#yd-screen-toast',
        '#yd-screen-overlay','#yd-tools-systray-item','#yd-tools-menu-item',
        '#noitems-panel','#noitems-systray-item','#ordered-panel','#ordered-systray-item',
        '#ms-stock-hzb-checker','#ms-stock-hzb-systray-item','#ydDirectSplitButton','#ydDirectSplitDialog',
        '#tm-confirmation-buttons','#tm-alt-call-popup','.yodawy-copy-success','.yd-open-erx-backdrop',
        '[data-yd-log-note-tool]','.ms-alt-qty-warning','.yd-mc-layer','[data-yd-screenshot-exclude="true"]','.yd-screenshot-exclude'
    ].join(',');
    const entries=Object.entries(registry).filter(([id,instance])=>id!==TOOL_ID&&instance&&typeof instance==='object'&&instance.screenshotBehavior==='pause-required');
    const paused=[];
    const hidden=[];
    let blob=null;
    let captureError=null;
    const restoreErrors=[];
    try{
        if(signal?.aborted)throw new DOMException('Screenshot cancelled','AbortError');
        await ensureLibrary();
        if(signal?.aborted)throw new DOMException('Screenshot cancelled','AbortError');
        for(const [id,instance] of entries){
            const pauseFn=typeof instance.pause==='function'?instance.pause.bind(instance):typeof instance.suspend==='function'?instance.suspend.bind(instance):null;
            if(!pauseFn)continue;
            const result=await pauseFn();
            if(result===false)throw new Error('TOOL_BUSY: '+id);
            paused.push({id,instance});
        }
        document.querySelectorAll(excludedSelectors).forEach(el=>{
            hidden.push({el,d:el.style.getPropertyValue('display'),dp:el.style.getPropertyPriority('display'),v:el.style.getPropertyValue('visibility'),vp:el.style.getPropertyPriority('visibility')});
            el.style.setProperty('display','none','important');
            el.style.setProperty('visibility','hidden','important');
        });
        await waitFrame();
        if(signal?.aborted)throw new DOMException('Screenshot cancelled','AbortError');
        blob=await captureCanvas();
    }catch(error){
        captureError=error;
    }finally{
        for(const s of hidden.reverse()){
            if(s.d)s.el.style.setProperty('display',s.d,s.dp);else s.el.style.removeProperty('display');
            if(s.v)s.el.style.setProperty('visibility',s.v,s.vp);else s.el.style.removeProperty('visibility');
        }
        for(const item of paused.reverse()){
            try{
                const result=await item.instance.resume?.();
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

const runCapture=async(signal)=>{
    const capturePromise=cleanCapture(signal);
    let copied=false;
    if(navigator.clipboard?.write&&typeof ClipboardItem==='function'){
        try{
            // Rapid clipboard write with direct Promise resolving
            const item=new ClipboardItem({'image/png':capturePromise});
            await navigator.clipboard.write([item]);
            copied=true;
        }catch{
            // Fallback: wait for blob and write
            try{
                const blob=await capturePromise;
                if(signal?.aborted)throw new DOMException('Screenshot cancelled','AbortError');
                const item=new ClipboardItem({'image/png':blob});
                await navigator.clipboard.write([item]);
                copied=true;
            }catch{}
        }
    }
    if(signal?.aborted)throw new DOMException('Screenshot cancelled','AbortError');
    const blob=await capturePromise;
    if(copied){
        showToast('Clean screenshot copied to clipboard');
        return;
    }
    downloadBlob(blob);
    showToast('Clipboard unavailable — clean screenshot downloaded','warning');
};

const handleClick=()=>{
    if(state.destroyed||state.suspended||state.busy)return;
    state.busy=true;
    if(state.button){
        state.button.disabled=true;
        state.button.classList.add('yd-screen-working');
    }
    removeToast();

    const abortController=new AbortController();
    state.captureAbortController=abortController;

    showOverlay(()=>{
        abortController.abort();
        removeOverlay();
        showToast('Screenshot cancelled','warning');
    });

    runCapture(abortController.signal).catch(error=>{
        if(abortController.signal.aborted||error?.name==='AbortError')return;
        const message=String(error?.message||'SCREENSHOT_FAILED');
        const detail=message==='SCREENSHOT_CAPTURE_IN_PROGRESS'?'A screenshot capture is already in progress.':message.startsWith('TOOL_BUSY:')?'A tool is currently running: '+message.slice(10)+'. Stop it and try again.':message.startsWith('RESTORE_FAILED:')?'Some tools did not resume: '+message.slice(15)+'. Refresh Odoo before continuing.':message;
        showToast(detail,'error');
    }).finally(()=>{
        state.busy=false;
        state.captureAbortController=null;
        removeOverlay();
        if(state.button){
            state.button.disabled=false;
            state.button.classList.remove('yd-screen-working');
        }
    });
};

const item=document.createElement('li');
item.id=ITEM_ID;
item.setAttribute('data-yd-screenshot-exclude','true');
item.setAttribute('role','menuitem');
item.innerHTML='<button id="'+BUTTON_ID+'" type="button" title="Clean Screenshot" aria-label="Clean Screenshot"><i class="yd-custom-icon yd-fa-icon fa-solid fa-camera" aria-hidden="true"></i></button>';
state.item=item;
state.button=item.querySelector('button');
state.button.addEventListener('click',handleClick,{signal:state.controller.signal});
const unregisterExclusion=window.YODAWY_SCREENSHOT_COORDINATOR?.registerElement?.(item,{toolId:TOOL_ID});

const instance={
    id:TOOL_ID,
    path:'TOOLS/screen.js',
    icon:'fa-solid fa-camera',
    screenshotBehavior:'hide-only',
    supportsPause:false,
    suspend(){
        if(state.destroyed)return true;
        state.suspended=true;
        state.captureAbortController?.abort();
        removeOverlay();
        removeToast();
        state.item.style.setProperty('display','none','important');
        return true;
    },
    resume(){
        if(state.destroyed)return false;
        state.suspended=false;
        state.item.style.removeProperty('display');
        addStyle();
        watchNavbar();
        state.button.disabled=state.busy;
        return true;
    },
    refresh(){
        if(state.destroyed)return false;
        addStyle();
        placeButton();
        return true;
    },
    destroy(){
        if(state.destroyed)return true;
        if(state.busy)return false;
        state.destroyed=true;
        state.suspended=true;
        try{unregisterExclusion?.();}catch{}
        window.YODAWY_TOOLS_MANAGER?.systrayMenu?.unregister?.(TOOL_ID);
        state.controller.abort();
        state.captureAbortController?.abort();
        removeOverlay();
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