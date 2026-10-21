// ==UserScript==
// @name         CONFIRMATION TYPE BUTTONS
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function(){'use strict';

            const C={
                M:'helpdesk.ticket',
                F:'ticket_confirmation_type',
                I:'tm-confirmation-buttons',
                C:'#875A7B',
                D:300
            },T=[
                [1,'W - W'],
                [2,'WO - W'],
                [3,'UR'],
                [4,'W - WO'],
                [5,'WO - WO']
            ],S={loading:false,observer:null};

            const U={
                p(){return new URLSearchParams(location.hash.replace(/^#/,''));
                   },
                ticket(){
                    const p=this.p();
                    return p.get('model')===C.M&&p.get('view_type')==='form';
                },
                id(){return Number(this.p().get('id'))},
                e(t,p={}){const e=document.createElement(t);Object.assign(e,p);return e},
                all(s){return [...document.querySelectorAll(s)]},
                wait(s,t=10000){
                    return new Promise(r=>{
                        const a=Date.now(),f=()=>{
                            const e=document.querySelector(s);
                            if(e)return r(e);
                            if(Date.now()-a>=t)return r(null);
                            setTimeout(f,200);
                        };
                        f();
                    });
                }
            };

            const API={
                async rpc(data){
                    const r=await fetch('/web/dataset/call_kw',{
                        method:'POST',
                        credentials:'same-origin',
                        headers:{'Content-Type':'application/json'},
                        body:JSON.stringify(data)
                    });
                    if(!r.ok)throw 0;
                    const j=await r.json();
                    if(j.error)throw 0;
                    return j.result;
                },
                async update(id,value){
                    const p=U.p(),c=odoo.session_info;
                    return this.rpc({
                        jsonrpc:'2.0',
                        method:'call',
                        params:{
                            model:C.M,
                            method:'write',
                            args:[[id],{[C.F]:value}],
                            kwargs:{
                                context:{
                                    lang:c.user_context.lang,
                                    tz:c.user_context.tz,
                                    uid:c.uid,
                                    allowed_company_ids:c.user_context.allowed_company_ids,
                                    active_id:id,
                                    active_ids:[id],
                                    params:{
                                        action:Number(p.get('action')),
                                        active_id:id,
                                        cids:Number(p.get('cids')),
                                        id,
                                        menu_id:Number(p.get('menu_id')),
                                        model:C.M,
                                        view_type:'form'
                                    }
                                }
                            }
                        },
                        id:Date.now()
                    });
                },
                controller(){
                    if(!odoo?.__DEBUG__?.services)return null;
                    for(const s of Object.values(odoo.__DEBUG__.services))
                        for(const a of s?.__parentedChildren||[])
                            for(const c of a?.__parentedChildren||[])
                                if(c?.modelName===C.M&&c.handle&&c.saveRecord)return c;
                    return null;
                }
            };

            const UI={
                css(){
                    if(document.getElementById('tm-confirm-style'))return;
                    const s=document.createElement('style');
                    s.id='tm-confirm-style';
                    s.textContent=`#${C.I}{display:contents}.tm-confirm-btn{width:auto;min-width:55px;height:30px;margin:8px 4px;padding:0 8px;border:0;border-radius:4px;background:${C.C};color:#fff;font-size:11px;font-weight:700;cursor:pointer;line-height:30px;text-align:center;transition:opacity .15s,transform .1s,box-shadow .15s}.tm-confirm-btn:hover{opacity:.85}.tm-confirm-btn:active{transform:scale(.96)}.tm-confirm-btn.tm-active{box-shadow:0 0 0 2px #fff inset,0 0 0 3px ${C.C}}.tm-confirm-btn.tm-loading{opacity:.5;pointer-events:none}.tm-confirm-toast{position:fixed;right:20px;bottom:20px;z-index:999999999;background:${C.C};color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;font-weight:600;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s}.tm-confirm-toast.show{opacity:1;transform:translateY(0)}`;
                    document.head.appendChild(s);
                },
                container(){
                    const c=U.e('div',{id:C.I});
                    T.forEach(([id,label])=>{
                        const b=U.e('button',{className:'tm-confirm-btn',textContent:label,type:'button'});
                        b.dataset.id=id;
                        c.appendChild(b);
                    });
                    return c;
                },
                render(){
                    this.remove();
                    const box=document.querySelector('.oe_button_box');
                    if(!box)return;
                    const c=this.container(),split=box.querySelector('#tmLetsSplit');
                    box.prepend(c);
                    if(split)box.insertBefore(split,c.nextSibling);
                },
                remove(){document.getElementById(C.I)?.remove()},
                loading(v){
                    S.loading=v;
                    U.all('.tm-confirm-btn').forEach(b=>{
                        b.disabled=v;
                        b.classList.toggle('tm-loading',v);
                    });
                },
                active(id){
                    U.all('.tm-confirm-btn').forEach(b=>b.classList.toggle('tm-active',Number(b.dataset.id)===Number(id)));
                },
                toast(m){
                    document.querySelector('.tm-confirm-toast')?.remove();
                    const t=U.e('div',{className:'tm-confirm-toast',textContent:m});
                    document.body.appendChild(t);
                    requestAnimationFrame(()=>t.classList.add('show'));
                    setTimeout(()=>{
                        t.classList.remove('show');
                        setTimeout(()=>t.remove(),200);
                    },1800);
                }
            };

            const E={
                bind(){
                    document.addEventListener('click',async e=>{
                        const b=e.target.closest('.tm-confirm-btn');
                        if(!b||S.loading)return;
                        const id=U.id(),value=Number(b.dataset.id);
                        if(!id)return;
                        try{
                            UI.loading(true);
                            await API.update(id,value);
                            const c=API.controller();
                            if(c)await c.reload();
                            UI.active(value);
                            UI.toast('Updated successfully.');
                        }catch{
                            UI.toast('Something went wrong.');
                        }finally{
                            UI.loading(false);
                        }
                    });
                },
                async render(){
                    if(!U.ticket())return UI.remove();
                    if(await U.wait('.oe_button_box'))UI.render();
                },
                watch(){
                    let h=location.hash;
                    setInterval(()=>{
                        if(location.hash===h)return;
                        h=location.hash;
                        this.render();
                    },C.D);
                },
                observe(){
                    S.observer?.disconnect();
                    S.observer=new MutationObserver(()=>{
                        if(U.ticket()&&!document.getElementById(C.I))this.render();
                    });
                    S.observer.observe(document.body,{childList:true,subtree:true});
                },
                init(){
                    UI.css();
                    this.bind();
                    this.watch();
                    this.observe();
                    this.render();
                }
            };

            E.init();
           })();
