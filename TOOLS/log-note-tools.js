// ==UserScript==
// @name         Log Note Tools
// @version      1
// @namespace    http://tampermonkey.net/
// @description  Add Edit & Delete buttons to Odoo Log Notes
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/*
// @grant        none
// ==/UserScript==

(function(){'use strict';

            const TOOL_ID='TOOL-010';
            const registry=window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
            if(registry[TOOL_ID])return;
            let destroyed=false;
            let controller=new AbortController();
            const BUTTON_STYLE='color:#b71c1c;font-weight:bold;cursor:pointer;margin-left:10px;font-size:13px;user-select:none;';

            function getMessageId(message){return Number(message.dataset.messageLocalId.replace('mail.message_',''))}
            function getMessageBody(message){return message.querySelector('.o_Message_prettyBody')}

            async function rpc(method,id,values=null){
                const payload={
                    jsonrpc:'2.0',
                    method:'call',
                    params:{
                        model:'mail.message',
                        method,
                        args:values?[[id],values]:[[id]],
                        kwargs:{context:odoo.session_info.user_context}
                    },
                    id:Date.now()
                };
                return (await fetch(`/web/dataset/call_kw/mail.message/${method}`,{
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify(payload),
                    signal:controller.signal
                })).json();
            }

            function createButton(text,marginLeft,callback){
                const btn=document.createElement('span');
                btn.textContent=text;
                btn.dataset.ydLogNoteTool=text.toLowerCase();
                btn.setAttribute('data-yd-screenshot-exclude','true');
                btn.style.cssText=BUTTON_STYLE+`margin-left:${marginLeft}px;`;
                btn.onmouseenter=()=>btn.style.textDecoration='underline';
                btn.onmouseleave=()=>btn.style.textDecoration='none';
                btn.onclick=e=>{e.stopPropagation();callback()};
                return btn;
            }

            async function editMessage(message){
                const body=getMessageBody(message);
                if(!body)return;
                const currentText=body.innerText.trim();
                const newText=prompt('Edit Message',currentText);
                if(newText===null)return;
                const html=`<p>${newText.replace(/\n/g,'<br>')}</p>`;
                const result=await rpc('write',getMessageId(message),{body:html});
                if(result.error)return alert(result.error.data.message);
                body.innerHTML=html;
            }

            async function deleteMessage(message){
                if(!confirm('Delete this message?'))return;
                const result=await rpc('unlink',getMessageId(message));
                if(result.error)return alert(result.error.data.message);
                message.remove();
            }

            function addButtons(){
                document.querySelectorAll('.o_Message').forEach(message=>{
                    if(destroyed||message.dataset.ydLogNoteToolsAdded)return;
                    const commands=message.querySelector('.o_Message_commands');
                    if(!commands)return;
                    message.dataset.ydLogNoteToolsAdded='1';
                    commands.append(
                        createButton('Edit',10,()=>editMessage(message)),
                        createButton('Delete',12,()=>deleteMessage(message))
                    );
                });
            }

            const observer=new MutationObserver(addButtons);
            const clean=()=>{
                observer.disconnect();
                document.querySelectorAll('[data-yd-log-note-tool]').forEach(button=>button.remove());
                document.querySelectorAll('.o_Message').forEach(message=>delete message.dataset.ydLogNoteToolsAdded);
            };
            const instance={
                id:TOOL_ID,
                path:'TOOLS/log-note-tools.js',
                screenshotBehavior:'hide-only',
                supportsPause:true,
                pause(){clean();return true;},
                suspend(){clean();return true;},
                resume(){
                    if(destroyed)return false;
                    addButtons();
                    observer.observe(document.body,{childList:true,subtree:true});
                    return true;
                },
                refresh(){
                    if(destroyed)return false;
                    addButtons();
                    return true;
                },
                destroy(){
                    if(destroyed)return true;
                    destroyed=true;
                    controller.abort();
                    clean();
                    if(registry[TOOL_ID]===instance)delete registry[TOOL_ID];
                    return true;
                }
            };
            registry[TOOL_ID]=instance;
            addButtons();
            observer.observe(document.body,{childList:true,subtree:true});

           })();
