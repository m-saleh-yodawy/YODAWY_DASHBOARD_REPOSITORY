// ==UserScript==
// @name         Move Communication
// @namespace    http://tampermonkey.net/
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/*
// @grant        none
// ==/UserScript==

(function(){'use strict';

            const original=new Map();
            const remember=el=>{
                if(el&&!original.has(el))original.set(el,{parent:el.parentNode,next:el.nextSibling,style:el.getAttribute('style'),title:el.getAttribute('title'),onclick:el.onclick});
            };
            const setupCopy=el=>{
                if(!el||el.dataset.tmCopy)return;
                remember(el);
                el.dataset.tmCopy=1;
                Object.assign(el.style,{color:'#d60000',fontWeight:'bold',fontSize:'14px',cursor:'pointer',userSelect:'text'});
                el.title='Click to copy';
                el.onclick=async e=>{
                    e.preventDefault();
                    e.stopPropagation();
                    let n=(el.textContent||'').trim().replace(/[^\d+]/g,'');
                    if(n.startsWith('+20'))n='0'+n.slice(3);
                    else if(n.startsWith('20')&&n.length===12)n='0'+n.slice(2);
                    try{
                        await navigator.clipboard.writeText(n);
                        const c=el.style.color;
                        el.style.color='#16a34a';
                        setTimeout(()=>el.style.color=c,600);
                    }catch{}
                };
            };

            const move=()=>{
                const q=document.querySelector('span[name="quotation_type"]')?.closest('table');
                const mobile=document.querySelector('span[name="mobile"]');
                const mobile2=document.querySelector('span[name="ticket_mobile2"]');
                const phone=document.querySelector('span[name="ticket_phone"]');
                if(!q||!mobile||!phone)return;

                const communication=mobile.closest('table');
                const phoneTable=phone.closest('table');
                const admin=document.querySelector('span[name="payor_id"]')?.closest('table');
                if(!communication||!phoneTable)return;

                remember(communication);
                remember(phoneTable);
                remember(phone.closest('tr'));
                if(admin&&!communication.dataset.tmMoved&&communication!==admin){
                    const body=admin.querySelector('tbody');
                    if(body){
                        body.appendChild(communication);
                        communication.dataset.tmMoved=1;
                    }
                }

                if(!communication.dataset.tmPhoneMerged){
                    const row=phone.closest('tr');
                    const body=communication.querySelector('tbody');
                    if(row&&body){
                        body.appendChild(row);
                        phoneTable.remove();
                        communication.dataset.tmPhoneMerged=1;
                    }
                }

                setupCopy(mobile);
                setupCopy(mobile2);
                setupCopy(phone);
            };

            const observer=new MutationObserver(move);
            const registry=window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
            registry['TOOL-011']={
                suspend(){
                    observer.disconnect();
                    for(const [element,snapshot] of original){
                        if(snapshot.parent?.isConnected)snapshot.parent.insertBefore(element,snapshot.next?.parentNode===snapshot.parent?snapshot.next:null);
                        if(snapshot.style===null)element.removeAttribute('style');else element.setAttribute('style',snapshot.style);
                        if(snapshot.title===null)element.removeAttribute('title');else element.setAttribute('title',snapshot.title);
                        element.onclick=snapshot.onclick;
                        delete element.dataset.tmCopy;
                        delete element.dataset.tmMoved;
                        delete element.dataset.tmPhoneMerged;
                    }
                    original.clear();
                    return true;
                },
                resume(){observer.observe(document.body,{childList:true,subtree:true});move();return true;}
            };
            move();
            observer.observe(document.body,{childList:true,subtree:true});

           })();
