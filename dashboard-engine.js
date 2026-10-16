 // ==UserScript==
 // @name         YODAWY DASHBOARD
 // @namespace    https://github.com/m-saleh-yodawy/
 // @version      1
 // @author       Mohamed Saleh
 // @match        https://odoo.yodawy.com/*
 // @grant        none
 // ==/UserScript==

 (() => {
     'use strict';

     if (window.__YODAWY_DASHBOARD_RUNNING__) return;
     window.__YODAWY_DASHBOARD_RUNNING__ = true;

     const PURPLE = '#875A7B';
     const DARK = '#68465f';
     const USER_ID = 'Q-001';

     const sections = [
         ['overview', 'Overview'],
         ['tools', 'My Tools'],
         ['settings', 'My Settings'],
         ['users', 'Users Management'],
         ['shared', 'Shared Tools'],
         ['system', 'System Settings'],
         ['logs', 'Activity Logs']
     ];

     const state = {
         section: 'overview',
         name: 'Mohamed Saleh',
         startPage: 'overview',
         tools: [],
         logs: [],
         userId: USER_ID
     };

     const $ = (selector, root = document) => root.querySelector(selector);

     const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
         '&': '&amp;',
         '<': '&lt;',
         '>': '&gt;',
         '"': '&quot;',
         "'": '&#39;'
     })[c]);

     const style = document.createElement('style');

     style.textContent = `
         #yd-launcher {
             position: fixed;
             right: 22px;
             bottom: 22px;
             z-index: 2147483000;
             background: ${PURPLE};
             color: #fff;
             border: 0;
             border-radius: 40px;
             padding: 13px 18px;
             font: 700 13px system-ui;
             cursor: pointer;
             box-shadow: 0 8px 25px #0003;
         }
         #yd-overlay {
             position: fixed;
             inset: 0;
             z-index: 2147483001;
             display: none;
             align-items: center;
             justify-content: center;
             padding: 3vh 3vw;
             background: #17131c99;
         }
         #yd-overlay.open { display: flex; }
         #yd-modal {
             width: 100%;
             height: 100%;
             max-width: 1450px;
             max-height: 920px;
             background: #f7f6f9;
             color: #29242e;
             border-radius: 16px;
             overflow: hidden;
             display: flex;
             flex-direction: column;
             font: 14px/1.5 system-ui;
         }
         #yd-modal * { box-sizing: border-box; }
         #yd-header {
             display: flex;
             align-items: center;
             justify-content: space-between;
             gap: 12px;
             padding: 16px 22px;
             background: #fff;
             border-bottom: 1px solid #e9e4ec;
         }
         #yd-body { display: flex; flex: 1; min-height: 0; }
         #yd-sidebar {
             width: 210px;
             flex-shrink: 0;
             background: #fff;
             padding: 15px 10px;
             border-right: 1px solid #e9e4ec;
         }
         #yd-main { flex: 1; min-width: 0; overflow: auto; padding: 25px; }
         .yd-nav {
             display: block;
             width: 100%;
             text-align: left;
             border: 0;
             border-radius: 8px;
             padding: 12px;
             background: transparent;
             color: #655c6a;
             cursor: pointer;
             margin-bottom: 4px;
         }
         .yd-nav.active {
             background: #f1e8f1;
             color: ${DARK};
             font-weight: 800;
         }
         .yd-title { font-size: 21px; font-weight: 800; }
         .yd-sub { font-size: 11px; color: #8c8492; }
         .yd-grid {
             display: grid;
             grid-template-columns: repeat(4, minmax(0, 1fr));
             gap: 12px;
         }
         .yd-card {
             background: #fff;
             border: 1px solid #eee8f0;
             border-radius: 12px;
             padding: 17px;
             margin-bottom: 15px;
             min-width: 0;
         }
         .yd-value { font-size: 26px; font-weight: 800; margin-top: 8px; }
         .yd-btn {
             border: 1px solid #e5dce8;
             background: #fff;
             color: ${DARK};
             border-radius: 8px;
             padding: 8px 12px;
             font-size: 12px;
             font-weight: 700;
             cursor: pointer;
         }
         .yd-primary { background: ${PURPLE}; color: #fff; border-color: ${PURPLE}; }
         .yd-field { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
         .yd-field input, .yd-field select {
             width: 100%;
             padding: 10px;
             border: 1px solid #e3dce6;
             border-radius: 8px;
             font: 12px system-ui;
         }
         .yd-row {
             display: flex;
             align-items: center;
             gap: 12px;
             padding: 12px 0;
             border-bottom: 1px solid #eee;
         }
         .yd-grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
         .yd-note {
             padding: 12px;
             background: #f1e8f1;
             border-radius: 8px;
             margin-bottom: 14px;
             font-size: 12px;
         }
         .yd-pill {
             display: inline-block;
             padding: 4px 8px;
             background: #eee4ef;
             color: ${DARK};
             border-radius: 7px;
             font-size: 11px;
         }
         .yd-empty { padding: 24px; text-align: center; color: #8c8492; }
         @media(max-width:800px) {
             #yd-overlay { padding: 0; }
             #yd-modal { border-radius: 0; }
             #yd-sidebar { width: 125px; }
             #yd-main { padding: 12px; }
             .yd-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
             #yd-header { padding: 12px; }
         }
     `;

     document.head.appendChild(style);

     const launcher = document.createElement('button');
     launcher.id = 'yd-launcher';
     launcher.textContent = 'YODAWY DASHBOARD';

     const overlay = document.createElement('div');
     overlay.id = 'yd-overlay';

     overlay.innerHTML = `
         <div id="yd-modal" role="dialog" aria-modal="true">
             <header id="yd-header">
                 <div>
                     <div class="yd-title">YODAWY DASHBOARD</div>
                     <div class="yd-sub">Automation Control Center</div>
                 </div>
                 <div>
                     <span class="yd-pill">${USER_ID}</span>
                     <button class="yd-btn" data-action="close">Close</button>
                 </div>
             </header>
             <div id="yd-body">
                 <aside id="yd-sidebar"></aside>
                 <main id="yd-main"></main>
             </div>
         </div>
     `;

     document.body.append(launcher, overlay);

     function header(title, description) {
         return `
             <div style="margin-bottom:20px">
                 <div class="yd-title">${esc(title)}</div>
                 <div class="yd-sub">${esc(description)}</div>
             </div>
         `;
     }

     function card(title, value) {
         return `
             <div class="yd-card">
                 ${esc(title)}
                 <div class="yd-value">${esc(value)}</div>
             </div>
         `;
     }

     function page() {
         switch (state.section) {
             case 'overview':
                 return header('Overview', `Signed in as ${state.name}`) + `
                     <div class="yd-grid">
                         ${card('Available Tools', '0')}
                         ${card('Discovered Tools', '0')}
                         ${card('Registered Users', '0')}
                         <div class="yd-card">
                             GitHub Status
                             <div style="margin-top:8px">
                                 <span class="yd-pill">UI Only</span>
                             </div>
                         </div>
                     </div>
                     <div class="yd-card">
                         <b>Account</b>
                         <div class="yd-row">
                             <div class="yd-grow">
                                 ${esc(state.name)}
                                 <div class="yd-sub">ID: ${USER_ID}</div>
                             </div>
                             <span class="yd-pill">Dashboard Preview</span>
                         </div>
                     </div>
                     <div class="yd-note">
                         This is the simplified dashboard interface.
                     </div>
                 `;

             case 'tools':
                 return header('My Tools', 'Available automation tools.') + `
                     <div class="yd-card">
                         <div class="yd-empty">No tools loaded.</div>
                     </div>
                 `;

             case 'settings':
                 return header('My Settings', 'Personal dashboard preferences.') + `
                     <div class="yd-card">
                         <div class="yd-field">
                             <label>GitHub Owner</label>
                             <input value="m-saleh-yodawy" readonly>
                         </div>
                         <div class="yd-field">
                             <label>User ID</label>
                             <input value="${USER_ID}" readonly>
                         </div>
                         <div class="yd-field">
                             <label>Display Name</label>
                             <input id="yd-name" value="${esc(state.name)}">
                         </div>
                         <div class="yd-field">
                             <label>Default Page</label>
                             <select id="yd-start">
                                 ${sections.slice(0, 3).map(([id, name]) =>
                                     `<option value="${id}" ${state.startPage === id ? 'selected' : ''}>${name}</option>`
                                 ).join('')}
                             </select>
                         </div>
                         <button class="yd-btn yd-primary" data-action="save">
                             Save Settings
                         </button>
                     </div>
                 `;

             case 'users':
                 return header('Users Management', 'User administration.') + `
                     <div class="yd-card">
                         <div class="yd-empty">User management is not connected.</div>
                     </div>
                 `;

             case 'shared':
                 return header('Shared Tools', 'Shared JavaScript tools.') + `
                     <div class="yd-card">
                         <div class="yd-empty">Tool editor is not connected.</div>
                     </div>
                 `;

             case 'system':
                 return header('System Settings', 'Dashboard configuration.') + `
                     <div class="yd-card">
                         <div class="yd-row"><div class="yd-grow">Owner</div>m-saleh-yodawy</div>
                         <div class="yd-row"><div class="yd-grow">Branch</div>main</div>
                         <div class="yd-row"><div class="yd-grow">Dashboard</div>UI Only</div>
                     </div>
                 `;

             case 'logs':
                 return header('Activity Logs', 'Recent dashboard activity.') + `
                     <div class="yd-card">
                         <div class="yd-empty">No activity yet.</div>
                     </div>
                 `;

             default:
                 state.section = 'overview';
                 return page();
         }
     }

     function render() {
         $('#yd-sidebar').innerHTML = sections.map(([id, name]) => `
             <button class="yd-nav ${state.section === id ? 'active' : ''}"
                 data-section="${id}">${name}</button>
         `).join('');

         $('#yd-main').innerHTML = page();
     }

     launcher.addEventListener('click', () => {
         overlay.classList.add('open');
         render();
     });

     overlay.addEventListener('click', event => {
         if (event.target === overlay) overlay.classList.remove('open');
     });

     overlay.addEventListener('click', event => {
         const nav = event.target.closest('[data-section]');
         if (nav) {
             state.section = nav.dataset.section;
             render();
             return;
         }

         const action = event.target.closest('[data-action]')?.dataset.action;

         if (action === 'close') {
             overlay.classList.remove('open');
         }

         if (action === 'save') {
             state.name = $('#yd-name').value.trim() || 'Mohamed Saleh';
             state.startPage = $('#yd-start').value;
             state.section = 'settings';
             render();
         }
     });

     document.addEventListener('keydown', event => {
         if (event.key === 'Escape') overlay.classList.remove('open');
     });
 })();
