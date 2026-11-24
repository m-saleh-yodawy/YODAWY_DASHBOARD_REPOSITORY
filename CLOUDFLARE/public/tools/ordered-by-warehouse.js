// ==UserScript==
// @name         Ordered By Warehouse
// @namespace    http://tampermonkey.net/
// @version      1
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// ==/UserScript==

(function () {
    'use strict';

    const INSTANCE_KEY = '__MS_ORDERED_BY_WH__';

    if (window[INSTANCE_KEY]?.destroy) {
        window[INSTANCE_KEY].destroy();
    }

    const ORDERED_STAGE_ID = 458;
    const PREVIOUS_STATE_ID = 467;
    const MAX_CONCURRENT = 10;

    let ORDERED_CODES = new Set();
    let running = false;
    let paused = false;
    let processing = false;
    let destroyed = false;

    let total = 0;
    let completed = 0;
    let orderedFound = 0;
    let orderedProgress = 0;
    let deletedLogs = 0;

    let report = [];
    let lastLogFormat = 0;

    let xlsxPromise = null;

    async function ensureXLSX() {
        if (window.XLSX?.read && window.XLSX?.utils?.sheet_to_json) return window.XLSX;
        if (!xlsxPromise) {
            xlsxPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                const finish = error => {
                    script.onload = null;
                    script.onerror = null;
                    if (error) {
                        xlsxPromise = null;
                        script.remove();
                        reject(error);
                    } else {
                        resolve(window.XLSX);
                    }
                };
                script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
                script.async = true;
                script.onload = () => window.XLSX?.read && window.XLSX?.utils?.sheet_to_json
                    ? finish()
                    : finish(new Error('Excel library loaded but is unavailable'));
                script.onerror = () => finish(new Error('Unable to load Excel library. Check the network connection and try again.'));
                (document.head || document.documentElement).appendChild(script);
            });
        }
        return xlsxPromise;
    }

    let alternativeLineModel = null;
    let systrayTimer = null;

    const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

    function getContext() {
        const context =
              window.odoo?.session_info?.user_context || {};

        return {
            ...context,
            uid: window.odoo?.session_info?.uid,
            allowed_company_ids: [2],
            active_id: 69,
            active_ids: [69]
        };
    }

    async function rpc(url, model, method, args, kwargs = {}) {
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs }, id: Date.now() + Math.random() })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) throw new Error(`Odoo RPC request failed (${response.status})`);
        if (data.error) {
            const details = data.error.data || {};
            const error = new Error(details.message || data.error.message || 'Odoo RPC Error');
            error.data = details;
            error.odooError = data.error;
            throw error;
        }
        return data.result;
    }

    function getVisibleTickets() {
        const ids = [];

        document.querySelectorAll('tr.o_data_row').forEach(row => {
            const match =
                  (row.textContent || '').match(/#(\d+)/);

            if (!match) {
                return;
            }

            const id = Number(match[1]);

            if (id && !ids.includes(id)) {
                ids.push(id);
            }
        });

        return ids;
    }

    async function fetchSuitableAlternatives(ticketId) {
        const context = {
            ...getContext(),
            active_id: ticketId,
            active_ids: [ticketId],
            active_model: 'helpdesk.ticket'
        };

        return await rpc(
            '/web/dataset/call_button',
            'helpdesk.ticket',
            'action_fetch_suitable_alternatives',
            [[ticketId]],
            { context }
        );
    }

    async function readWizard(wizardId) {
        const result = await rpc(
            '/web/dataset/call_kw/alternative.wizard/read',
            'alternative.wizard',
            'read',
            [[wizardId]],
            {
                fields: [
                    'alternatives',
                    'non_selected_drugs',
                    'alternative_lines_ids',
                    'available_lines_ids',
                    'display_name'
                ],
                context: getContext()
            }
        );

        return result?.[0] || null;
    }

    async function getAlternativeLineModel() {
        if (alternativeLineModel) {
            return alternativeLineModel;
        }

        const fields = await rpc(
            '/web/dataset/call_kw/alternative.wizard/fields_get',
            'alternative.wizard',
            'fields_get',
            [],
            {
                attributes: [
                    'type',
                    'relation'
                ],
                context: getContext()
            }
        );

        alternativeLineModel =
            fields?.alternative_lines_ids?.relation ||
            'alternative.wizard.line';

        return alternativeLineModel;
    }

    async function readAlternativeLines(ids) {
        if (!ids?.length) {
            return [];
        }

        const model =
              await getAlternativeLineModel();

        return await rpc(
            `/web/dataset/call_kw/${model}/read`,
            model,
            'read',
            [ids],
            {
                fields: [
                    'is_header',
                    'limited_drug',
                    'replace_or_delete_line',
                    'select_alternative',
                    'alternative_drug_id',
                    'alternative_uom',
                    'alternative_hzb',
                    'alternative_qty',
                    'stock_available',
                    'label'
                ],
                context: getContext()
            }
        );
    }

    function extractHZB(value) {
        if (!value) {
            return null;
        }

        const matches =
              String(value).match(/\b\d+\b/g);

        if (!matches?.length) {
            return null;
        }

        return matches[matches.length - 1];
    }

    function getMatchedLimitedDrugs(lines) {
        const matches = [];
        const seen = new Set();

        for (const line of lines || []) {
            if (!line.is_header) {
                continue;
            }

            const limitedDrug =
                  String(line.limited_drug || '').trim();

            if (!limitedDrug) {
                continue;
            }

            const hzb =
                  extractHZB(limitedDrug);

            if (
                !hzb ||
                !ORDERED_CODES.has(hzb) ||
                seen.has(hzb)
            ) {
                continue;
            }

            seen.add(hzb);

            matches.push({
                hzb,
                limitedDrug
            });
        }

        return matches;
    }

    function cleanDrugName(value) {
        return String(value || '')
            .replace(
            /^\s*\*limited\s+drug\s*:\s*/i,
            ''
        )
            .replace(
            /\s+ordered\s*$/i,
            ''
        )
            .trim();
    }

    function addReportRows(ticketId, matches) {
        for (const item of matches || []) {
            report.push({
                'Ticket ID': ticketId,
                'HZB': item.hzb,
                'Product Name': cleanDrugName(
                    item.limitedDrug
                )
            });
        }
    }

    async function downloadReport() {
        if (!report.length) {
            return;
        }

        const library = await ensureXLSX();
        const worksheet =
              library.utils.json_to_sheet(
                  report
              );

        worksheet['!cols'] = [
            { wch: 14 },
            { wch: 14 },
            { wch: 60 }
        ];

        const workbook =
              library.utils.book_new();

        library.utils.book_append_sheet(
            workbook,
            worksheet,
            'Ordered'
        );

        const now =
              new Date();

        const date =
              [
                  now.getFullYear(),
                  String(now.getMonth() + 1).padStart(2, '0'),
                  String(now.getDate()).padStart(2, '0')
              ].join('-');

        const time =
              [
                  String(now.getHours()).padStart(2, '0'),
                  String(now.getMinutes()).padStart(2, '0'),
                  String(now.getSeconds()).padStart(2, '0')
              ].join('-');

        const fileName =
              `ORDERED_BY_WH_${date}_${time}.xlsx`;

        library.writeFile(
            workbook,
            fileName
        );
    }

    async function postLogNote(ticketId, matches) {
        if (!matches.length) return;
        const escapeHtml = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const fullNames = matches.map(item => cleanDrugName(item.limitedDrug));
        const shortNames = fullNames.map(value => value.replace(/,\\s*\\d+(?:\\.\\d+)?\\s+(?:(?:pack|strip|box|bottle|vial|sachet)\\s+of\\b|(?:unit|tablet|capsule)\\b).*$/i, '').trim());
        const format = Math.floor(Math.random() * 6) + 1;
        lastLogFormat = format;
        const full = fullNames.map(escapeHtml);
        const short = shortNames.map(escapeHtml);
        let body = '';
        if (format === 1) body = full.map(name => `Limited Drug: ${name}<br>ORDERED`).join('<br><br>');
        else if (format === 2) body = full.map(name => `Limited Drug: ${name}`).join('<br>') + '<br>ORDERED';
        else if (format === 3) body = short.join('<br>') + '<br>ORDERED';
        else if (format === 4) body = short.map(name => `${name} &gt;&gt;&gt; ORDERED`).join('<br>');
        else if (format === 5) body = 'ORDERED<br>' + short.join('<br>');
        else body = short.map(name => `${name} &gt;&gt;&gt; ORDERED`).join('<br><br>');
        const context = { ...getContext(), active_id: ticketId, active_ids: [ticketId], active_model: 'helpdesk.ticket' };
        await rpc('/web/dataset/call_kw/helpdesk.ticket/message_post', 'helpdesk.ticket', 'message_post', [[ticketId]], { body, message_type: 'comment', subtype_xmlid: 'mail.mt_note', context });
    }

    async function moveToOrderedByWH(ticketId) {
        const context = {
            ...getContext(),
            active_id: ticketId,
            active_ids: [ticketId],
            active_model: 'helpdesk.ticket'
        };

        const result = await rpc(
            '/web/dataset/call_kw/helpdesk.ticket/write',
            'helpdesk.ticket',
            'write',
            [
                [ticketId],
                {
                    stage_id: ORDERED_STAGE_ID,
                    previous_state_id: PREVIOUS_STATE_ID
                }
            ],
            { context }
        );

        if (result !== true) {
            throw new Error(
                `Stage write failed for ticket ${ticketId}`
            );
        }

        return true;
    }

    async function getFetchMessages(ticketId, baseline) {
        const domain = [['model', '=', 'helpdesk.ticket'], ['res_id', '=', ticketId]];
        if (baseline && Number.isSafeInteger(baseline.id)) domain.push(['id', '>', baseline.id]);
        if (baseline?.partnerId) domain.push(['author_id', '=', baseline.partnerId]);
        const messages = await rpc('/web/dataset/call_kw/mail.message/search_read', 'mail.message', 'search_read', [domain], {
            fields: ['id', 'body', 'date', 'author_id'],
            order: 'id desc',
            limit: 500,
            context: getContext()
        });
        return Array.isArray(messages) ? messages : [];
    }

    async function getMessageBaseline(ticketId) {
        const partnerId = Number(window.odoo?.session_info?.partner_id || 0);
        if (!partnerId) return null;
        const messages = await getFetchMessages(ticketId);
        return { id: Math.max(0, ...messages.map(message => Number(message.id) || 0)), partnerId, startedAt: Date.now() };
    }

    function isFetchTable(body) {
        return /<table[\s>]/i.test(String(body || '')) && !/No items need to check/i.test(String(body || ''));
    }

    function isFetchPayload(body, ticketId) {
        const text = String(body || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        return text.includes(`ticket:${ticketId}`) && ['payer', 'corporate', 'identifier', 'drugs'].every(key => text.includes(`'${key}'`) || text.includes(`"${key}"`));
    }

    function messageTimestamp(message) {
        const value = String(message?.date || '').trim();
        if (!value) return NaN;
        const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
        const timestamp = Date.parse(normalized);
        return Number.isFinite(timestamp) ? timestamp : NaN;
    }

    function isFreshFetchMessage(message, baseline, now = Date.now()) {
        const id = Number(message?.id);
        const timestamp = messageTimestamp(message);
        if (!Number.isSafeInteger(id) || id <= baseline.id || !Number.isFinite(timestamp)) return false;
        const age = now - timestamp;
        return timestamp >= baseline.startedAt - 10000 && age >= -10000 && age <= 5 * 60 * 1000;
    }

    function getMessageAuthorId(message) {
        return Number(Array.isArray(message?.author_id) ? message.author_id[0] : message?.author_id) || 0;
    }

    function getFetchTableHeaders(body) {
        const parsed = new DOMParser().parseFromString(String(body || ''), 'text/html');
        const headers = [];
        for (const table of parsed.querySelectorAll('table')) {
            let node = table.previousSibling;
            let limitedDrug = '';
            while (node) {
                if (node.nodeType === 1 && node.tagName === 'BR') {
                    node = node.previousSibling;
                    continue;
                }
                limitedDrug = String(node.textContent || '').replace(/\s+/g, ' ').trim();
                if (limitedDrug) break;
                node = node.previousSibling;
            }
            if (!limitedDrug) continue;
            const hzb = extractHZB(limitedDrug);
            if (hzb) headers.push({ hzb, limitedDrug });
        }
        return headers;
    }

    function getFetchPayloadDrugIds(body) {
        return [...String(body || '').matchAll(/['"]id['"]\s*:\s*(\d+)/g)].map(match => match[1]);
    }

    async function getFetchChatter(ticketId, baseline) {
        if (!baseline?.partnerId || !Number.isSafeInteger(baseline.id)) return null;
        const rows = await getFetchMessages(ticketId, baseline);
        const fresh = rows.filter(message => isFreshFetchMessage(message, baseline) && getMessageAuthorId(message) === baseline.partnerId);
        const tables = fresh.filter(message => isFetchTable(message.body)).sort((a, b) => Number(b.id) - Number(a.id));
        if (!tables.length) return null;
        const payloads = fresh.filter(message => isFetchPayload(message.body, ticketId));
        const pairs = [];
        for (const table of tables) {
            const tableHeaders = new Set(getFetchTableHeaders(table.body).map(item => item.hzb));
            const tableId = Number(table.id), tableTime = messageTimestamp(table);
            const payload = payloads
                .filter(item => Number(item.id) < tableId && Math.abs(tableTime - messageTimestamp(item)) <= 5 * 60 * 1000)
                .filter(item => getFetchPayloadDrugIds(item.body).some(id => tableHeaders.has(id)))
                .sort((a, b) => Math.abs(tableTime - messageTimestamp(a)) - Math.abs(tableTime - messageTimestamp(b)))[0];
            if (payload) pairs.push({ payload, table });
        }
        return { table: tables[0], pairs };
    }

    async function deleteGeneratedLogs(ticketId, baseline) {
        const chatter = await getFetchChatter(ticketId, baseline);
        if (!chatter?.pairs?.length) return false;
        const now = Date.now();
        const ids = [...new Set(chatter.pairs.filter(pair => isFreshFetchMessage(pair.payload, baseline, now) && isFreshFetchMessage(pair.table, baseline, now)).flatMap(pair => [Number(pair.payload.id), Number(pair.table.id)]))];
        if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= baseline.id)) return false;
        const result = await rpc('/web/dataset/call_kw/mail.message/unlink', 'mail.message', 'unlink', [ids], { context: getContext() });
        return result === true;
    }

    function getMatchedLimitedDrugsFromTable(body) {
        const matches = [], seen = new Set();
        for (const item of getFetchTableHeaders(body)) {
            if (!ORDERED_CODES.has(item.hzb) || seen.has(item.hzb)) continue;
            seen.add(item.hzb);
            matches.push({ hzb: item.hzb, limitedDrug: item.limitedDrug });
        }
        return matches;
    }

    function getFetchOutcomeText(value) {
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value ?? {}); } catch { return String(value || ''); }
    }

    function getFetchErrorText(error) {
        const details = error?.data || error?.odooError?.data || {};
        return [error?.message, details.message, details.debug, error?.odooError?.message].filter(Boolean).join(' ');
    }

    async function fetchWithRetry(ticketId) {
        const baseline = await getMessageBaseline(ticketId);
        if (!baseline) return null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            if (!running || destroyed) return null;
            const existing = await getFetchChatter(ticketId, baseline).catch(() => null);
            if (existing?.table) return { kind: 'CHATTER', chatter: existing, baseline };
            try {
                const action = await fetchSuitableAlternatives(ticketId);
                if (action?.res_id) return { kind: 'WIZARD', action, baseline };
                const chatter = await getFetchChatter(ticketId, baseline).catch(() => null);
                if (chatter?.table) return { kind: 'CHATTER', chatter, baseline };
                const text = getFetchOutcomeText(action);
                if (/No items need to check/i.test(text)) return null;
                if (!/Failed to get alternative|Odoo Error|Odoo Server Error/i.test(text)) return null;
                if (attempt === 3) return null;
            } catch (error) {
                const chatter = await getFetchChatter(ticketId, baseline).catch(() => null);
                if (chatter?.table) return { kind: 'CHATTER', chatter, baseline };
                if (/No items need to check/i.test(getFetchErrorText(error))) return null;
                if (attempt === 3) return null;
            }
            await sleep(10000);
            const delayed = await getFetchChatter(ticketId, baseline).catch(() => null);
            if (delayed?.table) return { kind: 'CHATTER', chatter: delayed, baseline };
        }
        return null;
    }

    async function processTicket(ticketId) {
        if (!running || destroyed) return;
        const outcome = await fetchWithRetry(ticketId);
        if (!outcome) return false;
        let matches = [];
        if (outcome.kind === 'WIZARD') {
            try {
                const wizard = await readWizard(Number(outcome.action.res_id));
                const lineIds = wizard?.alternative_lines_ids || [];
                if (lineIds.length) {
                    const lines = await readAlternativeLines(lineIds);
                    matches = getMatchedLimitedDrugs(lines);
                }
            } catch {}
            if (!matches.length) {
                const chatter = await getFetchChatter(ticketId, outcome.baseline).catch(() => null);
                if (chatter?.table) matches = getMatchedLimitedDrugsFromTable(chatter.table.body);
            }
        } else if (outcome.kind === 'CHATTER') {
            matches = getMatchedLimitedDrugsFromTable(outcome.chatter.table.body);
        }
        if (!matches.length) {
            const deleted = await deleteGeneratedLogs(ticketId, outcome.baseline).catch(() => false);
            if (deleted) {
                deletedLogs++;
                updateStats();
            }
            return false;
        }
        await postLogNote(ticketId, matches);
        await moveToOrderedByWH(ticketId);
        addReportRows(ticketId, matches);
        orderedFound++;
        orderedProgress++;
        updateStats();
        return true;
    }

    function updateStats() {
        const totalEl =
              document.getElementById(
                  'ordered-total'
              );

        const foundEl =
              document.getElementById(
                  'ordered-found'
              );

        const fetchEl =
              document.getElementById(
                  'ordered-fetch-count'
              );

        const progressEl =
              document.getElementById(
                  'ordered-progress-count'
              );

        const deletedEl =
              document.getElementById(
                  'ordered-deleted'
              );

        const codeEl =
              document.getElementById(
                  'ordered-code-count'
              );

        if (totalEl) {
            totalEl.textContent =
                total;
        }

        if (foundEl) {
            foundEl.textContent =
                orderedFound;
        }

        if (fetchEl) {
            fetchEl.textContent =
                `${completed}/${total}`;
        }

        if (progressEl) {
            progressEl.textContent =
                `${orderedProgress}/${orderedFound}`;
        }

        if (deletedEl) {
            deletedEl.textContent =
                deletedLogs;
        }

        if (codeEl) {
            codeEl.textContent =
                `${ORDERED_CODES.size} HZB`;
        }

        updateCounter();
        updateControls();
    }

    function updateStatus(text) {
        const status =
              document.getElementById(
                  'ordered-status-text'
              );

        if (status) {
            status.textContent =
                text;
        }

        const dot =
              document.getElementById(
                  'ordered-status-dot'
              );

        if (dot) {
            dot.style.background =
                text === 'RUNNING'
                ? '#28a745'
            : text === 'PAUSED'
                ? '#f0ad4e'
            : text === 'ERROR'
                ? '#d9534f'
            : text === 'FINISHED'
                ? '#28a745'
            : '#666';
        }

        updateCounter();
    }

    function updateControls() {
        const start =
              document.getElementById(
                  'ordered-start'
              );

        const pause =
              document.getElementById(
                  'ordered-pause'
              );

        const resume =
              document.getElementById(
                  'ordered-resume'
              );

        if (!start || !pause || !resume) {
            return;
        }

        start.disabled =
            running;

        pause.disabled =
            !running;

        resume.disabled =
            !running;
    }

    function updateCounter() {
        const counter =
              document.getElementById(
                  'ordered-counter'
              );

        if (counter) {
            counter.textContent =
                orderedFound > 99
                ? '99+'
            : orderedFound;
        }
    }

    async function loadExcel(file) {
        if (!file || destroyed) {
            return;
        }

        try {
            updateStatus(
                'LOADING EXCEL LIBRARY'
            );

            const library = await ensureXLSX();
            if (destroyed) return;

            updateStatus(
                'READING EXCEL'
            );

            const buffer =
                  await file.arrayBuffer();

            const workbook =
                  library.read(
                      buffer,
                      {
                          type: 'array'
                      }
                  );

            const sheetName =
                  workbook.SheetNames[0];

            if (!sheetName) {
                throw new Error(
                    'Excel file is empty'
                );
            }

            const sheet =
                  workbook.Sheets[
                      sheetName
                  ];

            const rows =
                  library.utils.sheet_to_json(
                      sheet,
                      {
                          header: 1,
                          defval: ''
                      }
                  );

            if (!rows.length) {
                throw new Error(
                    'Excel file is empty'
                );
            }

            const headers =
                  rows[0].map(value =>
                              String(value)
                              .trim()
                              .toLowerCase()
                             );

            const hzbIndex =
                  headers.findIndex(
                      header =>
                      header === 'hzb'
                  );

            if (hzbIndex === -1) {
                throw new Error(
                    'HZB column not found'
                );
            }

            const codes =
                  new Set();

            for (
                let i = 1;
                i < rows.length;
                i++
            ) {
                const value =
                      rows[i]?.[hzbIndex];

                if (
                    value === '' ||
                    value === null ||
                    value === undefined
                ) {
                    continue;
                }

                const text =
                      String(value).trim();

                const matches =
                      text.match(/\b\d+\b/g);

                if (!matches) {
                    continue;
                }

                for (const code of matches) {
                    codes.add(code);
                }
            }

            if (!codes.size) {
                throw new Error(
                    'No HZB values found'
                );
            }

            ORDERED_CODES =
                codes;

            updateStats();

            updateStatus(
                'EXCEL LOADED'
            );

            const fileName =
                  document.getElementById(
                      'ordered-file-name'
                  );

            if (fileName) {
                fileName.textContent =
                    `${file.name} • ${ORDERED_CODES.size} HZB`;
            }

            const input =
                  document.getElementById(
                      'ordered-excel-file'
                  );

            if (input) {
                input.value = '';
            }
        } catch (error) {
            ORDERED_CODES =
                new Set();

            updateStats();

            updateStatus(
                'ERROR'
            );

            const fileName =
                  document.getElementById(
                      'ordered-file-name'
                  );

            if (fileName) {
                fileName.textContent =
                    error.message ||
                    'Excel error';
            }
        }
    }

    function createPanel() {
        if (
            document.getElementById(
                'ordered-panel'
            )
        ) {
            return;
        }

        document
            .getElementById(
            'ordered-style'
        )
            ?.remove();

        const style =
              document.createElement('style');

        style.id =
            'ordered-style';

        style.textContent = `
            #ordered-systray-item{
                display:flex!important;
                align-items:center!important;
                justify-content:center!important;
                width:42px!important;
                height:46px!important;
                padding:0!important;
                margin:0!important;
                flex:0 0 42px!important;
                order:-999!important
            }

            #ordered-systray-button{
                position:relative!important;
                display:flex!important;
                align-items:center!important;
                justify-content:center!important;
                width:42px!important;
                height:46px!important;
                padding:0!important;
                margin:0!important;
                border:0!important;
                background:transparent!important;
                color:rgba(255,255,255,.8)!important;
                cursor:pointer!important;
                outline:0!important
            }

            #ordered-systray-button:hover{
                background:rgba(255,255,255,.08)!important;
                color:#fff!important
            }

            #ordered-systray-button i{
                font-size:18px!important;
                line-height:46px!important
            }

            #ordered-counter{
                position:absolute;
                top:6px;
                right:4px;
                min-width:14px;
                height:14px;
                padding:0 3px;
                display:flex;
                align-items:center;
                justify-content:center;
                box-sizing:border-box;
                border-radius:50%;
                background:#875A7B;
                color:#fff;
                font:700 8px/14px Arial,sans-serif;
                pointer-events:none
            }

            #ordered-panel{
                display:none;
                position:fixed;
                right:20px;
                bottom:20px;
                width:430px;
                z-index:999999;
                background:#fff;
                color:#666;
                border:1px solid #68465f;
                border-radius:6px;
                box-shadow:0 4px 12px rgba(0,0,0,.15);
                font-family:-apple-system,BlinkMacSystemFont,
                    "Segoe UI",Roboto,Arial,sans-serif;
                overflow:hidden
            }

            #ordered-panel.open{
                display:block
            }

            #ordered-header{
                height:48px;
                display:flex;
                align-items:center;
                justify-content:space-between;
                padding:0 12px;
                background:#875A7B;
                color:#fff
            }

            #ordered-title{
                display:flex;
                align-items:center;
                gap:9px
            }

            #ordered-logo{
                width:28px;
                height:28px;
                display:flex;
                align-items:center;
                justify-content:center;
                border-radius:4px;
                background:#68465f;
                font-size:13px;
                font-weight:700
            }

            #ordered-name{
                display:flex;
                flex-direction:column;
                line-height:1.2
            }

            #ordered-name strong{
                font-size:13px
            }

            #ordered-name span{
                margin-top:2px;
                font-size:10px;
                color:rgba(255,255,255,.75)
            }

            #ordered-close{
                width:28px;
                height:28px;
                border:1px solid rgba(255,255,255,.35);
                border-radius:4px;
                background:transparent;
                color:#fff;
                cursor:pointer;
                font-size:17px
            }

            #ordered-body{
                padding:12px
            }

            #ordered-code-info{
                display:flex;
                align-items:center;
                justify-content:space-between;
                min-height:42px;
                padding:7px 9px;
                margin-bottom:10px;
                border:1px solid #d9d9d9;
                border-radius:4px
            }

            #ordered-code-label{
                font-size:11px;
                font-weight:600
            }

            #ordered-code-count{
                color:#875A7B;
                font-size:11px;
                font-weight:700
            }

            #ordered-upload{
                display:flex;
                align-items:center;
                gap:8px;
                min-height:42px;
                padding:7px 9px;
                margin-bottom:10px;
                border:1px solid #d9d9d9;
                border-radius:4px;
                background:#fff
            }

            #ordered-upload-button{
                flex:0 0 auto;
                height:28px;
                padding:0 10px;
                border:1px solid #68465f;
                border-radius:4px;
                background:#875A7B;
                color:#fff;
                font-size:10px;
                font-weight:600;
                cursor:pointer
            }

            #ordered-upload-button:hover{
                background:#68465f
            }

            #ordered-file-name{
                min-width:0;
                flex:1;
                overflow:hidden;
                white-space:nowrap;
                text-overflow:ellipsis;
                font-size:10px;
                color:#888
            }

            #ordered-excel-file{
                display:none
            }

            #ordered-stats{
                display:grid;
                grid-template-columns:1fr 1fr;
                gap:7px;
                margin-bottom:10px
            }

            .ordered-stat{
                min-height:52px;
                padding:7px 9px;
                border:1px solid #d9d9d9;
                border-radius:4px;
                background:#fff;
                box-sizing:border-box
            }

            .ordered-stat-label{
                font-size:9px;
                font-weight:600;
                color:#777;
                line-height:1.2
            }

            .ordered-stat-value{
                margin-top:4px;
                color:#875A7B;
                font-size:15px;
                font-weight:700;
                line-height:1
            }

            #ordered-status{
                display:flex;
                align-items:center;
                gap:7px;
                height:32px;
                padding:0 9px;
                margin-bottom:10px;
                background:#f8f8f8;
                border:1px solid #e3e3e3;
                border-radius:4px
            }

            #ordered-status-dot{
                width:7px;
                height:7px;
                border-radius:50%;
                background:#666
            }

            #ordered-status-text{
                font-size:11px;
                font-weight:600
            }

            .ordered-progress-row{
                display:flex;
                align-items:center;
                justify-content:space-between;
                margin-bottom:4px
            }

            .ordered-progress-label{
                font-size:9px;
                font-weight:600;
                color:#777
            }

            .ordered-progress-value{
                font-size:9px;
                font-weight:700;
                color:#875A7B
            }

            .ordered-progress{
                height:4px;
                margin-bottom:9px;
                background:#eee;
                border-radius:3px;
                overflow:hidden
            }

            .ordered-progress-bar{
                width:0;
                height:100%;
                background:#875A7B;
                transition:width .2s ease
            }

            #ordered-controls{
                display:flex;
                gap:7px;
                margin-top:2px
            }

            .ordered-btn{
                height:36px;
                flex:1;
                border:1px solid #68465f;
                border-radius:4px;
                font-size:11px;
                font-weight:600;
                cursor:pointer
            }

            #ordered-start,
            #ordered-resume{
                background:#875A7B;
                color:#fff
            }

            #ordered-pause{
                background:#fff;
                color:#875A7B
            }

            .ordered-btn:hover{
                opacity:.9
            }

            #ordered-start:disabled,
            #ordered-pause:disabled,
            #ordered-resume:disabled{
                background:#aaa;
                border-color:#aaa;
                color:#fff;
                opacity:1;
                cursor:not-allowed
            }

            #ordered-start:disabled:hover,
            #ordered-pause:disabled:hover,
            #ordered-resume:disabled:hover{
                background:#aaa;
                border-color:#aaa;
                color:#fff;
                opacity:1
            }

            #ordered-footer{
                height:26px;
                display:flex;
                align-items:center;
                justify-content:center;
                border-top:1px solid #e6e6e6;
                background:#fafafa;
                color:#999;
                font-size:9px
            }

            @media(max-width:600px){
                #ordered-panel{
                    right:10px;
                    bottom:10px;
                    width:calc(100vw - 20px)
                }
            }
        `;

        document.head.appendChild(
            style
        );

        const panel =
              document.createElement('div');

        panel.id =
            'ordered-panel';

        panel.innerHTML = `
            <div id="ordered-header">
                <div id="ordered-title">
                    <div id="ordered-logo">O</div>

                    <div id="ordered-name">
                        <strong>ORDERED AUTOMATION</strong>
                        <span>Ordered By WH</span>
                    </div>
                </div>

                <button
                    id="ordered-close"
                    type="button"
                >
                    ×
                </button>
            </div>

            <div id="ordered-body">

                <div id="ordered-code-info">
                    <span id="ordered-code-label">
                        EXCEL HZB
                    </span>

                    <span id="ordered-code-count">
                        0 HZB
                    </span>
                </div>

                <div id="ordered-upload">
                    <button
                        id="ordered-upload-button"
                        type="button"
                    >
                        UPLOAD EXCEL
                    </button>

                    <span id="ordered-file-name">
                        No Excel loaded
                    </span>

                    <input
                        id="ordered-excel-file"
                        type="file"
                        accept=".xlsx,.xls"
                    >
                </div>

                <div id="ordered-stats">

                    <div class="ordered-stat">
                        <div class="ordered-stat-label">
                            TOTAL TICKETS
                        </div>

                        <div
                            id="ordered-total"
                            class="ordered-stat-value"
                        >
                            0
                        </div>
                    </div>

                    <div class="ordered-stat">
                        <div class="ordered-stat-label">
                            ORDERED FOUND
                        </div>

                        <div
                            id="ordered-found"
                            class="ordered-stat-value"
                        >
                            0
                        </div>
                    </div>

                    <div class="ordered-stat">
                        <div class="ordered-stat-label">
                            DELETED LOGS
                        </div>

                        <div
                            id="ordered-deleted"
                            class="ordered-stat-value"
                        >
                            0
                        </div>
                    </div>

                    <div class="ordered-stat">
                        <div class="ordered-stat-label">
                            ORDERED PROGRESS
                        </div>

                        <div
                            id="ordered-progress-count"
                            class="ordered-stat-value"
                        >
                            0/0
                        </div>
                    </div>

                </div>

                <div class="ordered-progress-row">
                    <span class="ordered-progress-label">
                        FETCH PROGRESS
                    </span>

                    <span
                        id="ordered-fetch-count"
                        class="ordered-progress-value"
                    >
                        0/0
                    </span>
                </div>

                <div class="ordered-progress">
                    <div
                        id="ordered-fetch-bar"
                        class="ordered-progress-bar"
                    ></div>
                </div>

                <div class="ordered-progress-row">
                    <span class="ordered-progress-label">
                        ORDERED PROGRESS
                    </span>

                    <span
                        id="ordered-ordered-count"
                        class="ordered-progress-value"
                    >
                        0/0
                    </span>
                </div>

                <div class="ordered-progress">
                    <div
                        id="ordered-ordered-bar"
                        class="ordered-progress-bar"
                    ></div>
                </div>

                <div id="ordered-status">
                    <div id="ordered-status-dot"></div>

                    <div id="ordered-status-text">
                        IDLE
                    </div>
                </div>

                <div id="ordered-controls">
                    <button
                        id="ordered-start"
                        class="ordered-btn"
                        type="button"
                    >
                        ▶ START ORDERED
                    </button>

                    <button
                        id="ordered-pause"
                        class="ordered-btn"
                        type="button"
                        disabled
                    >
                        Ⅱ PAUSE
                    </button>

                    <button
                        id="ordered-resume"
                        class="ordered-btn"
                        type="button"
                        disabled
                    >
                        ▶ RESUME
                    </button>
                </div>
            </div>

            <div id="ordered-footer">
                YODAWY • ORDERED BY WH
            </div>
        `;

        document.body.appendChild(
            panel
        );

        document
            .getElementById(
            'ordered-upload-button'
        )
            .onclick = () =>
        document
            .getElementById(
            'ordered-excel-file'
        )
            .click();

        document
            .getElementById(
            'ordered-excel-file'
        )
            .addEventListener(
            'change',
            event =>
            loadExcel(
                event.target.files[0]
            )
        );

        document
            .getElementById(
            'ordered-close'
        )
            .onclick = () =>
        panel.classList.remove(
            'open'
        );

        document
            .getElementById(
            'ordered-start'
        )
            .onclick = () =>
        startAutomation();

        document
            .getElementById(
            'ordered-pause'
        )
            .onclick = () => {
            if (!running) {
                return;
            }

            paused = true;

            updateStatus(
                'PAUSED'
            );

            updateControls();
        };

        document
            .getElementById(
            'ordered-resume'
        )
            .onclick = () => {
            if (!running) {
                return;
            }

            if (!paused) {
                return;
            }

            paused = false;

            updateStatus(
                'RUNNING'
            );

            updateControls();
        };

        updateStats();
        updateProgress();
        updateStatus('IDLE');
        updateControls();
    }

    function createSystray() {
        if (destroyed) {
            return false;
        }

        const systray =
              document.querySelector(
                  'ul.o_menu_systray'
              );

        if (!systray) {
            return false;
        }

        let item =
            document.getElementById(
                'ordered-systray-item'
            );

        if (
            item &&
            item.parentElement !== systray
        ) {
            item.remove();
            item = null;
        }

        if (!item) {
            item =
                document.createElement(
                'li'
            );

            item.id =
                'ordered-systray-item';

            item.className =
                'o_ordered_systray_item';

            item.setAttribute(
                'role',
                'menuitem'
            );

            item.innerHTML = `
                <a
                    id="ordered-systray-button"
                    href="#"
                    role="button"
                    title="Ordered By WH"
                    aria-label="Ordered By WH"
                >
                    <i
                        class="yd-custom-icon fa fa-shopping-cart"
                        role="img"
                        aria-label="Ordered By WH"
                    ></i>

                    <span id="ordered-counter">
                        0
                    </span>
                </a>
            `;

            const first =
                  systray.firstElementChild;

            if (first) {
                systray.insertBefore(
                    item,
                    first
                );
            } else {
                systray.appendChild(
                    item
                );
            }

            const button =
                  document.getElementById(
                      'ordered-systray-button'
                  );

            if (button) {
                button.addEventListener(
                    'click',
                    event => {
                        event.preventDefault();
                        event.stopPropagation();

                        const panel =
                              document.getElementById(
                                  'ordered-panel'
                              );

                        if (!panel) {
                            return;
                        }

                        panel.classList.toggle(
                            'open'
                        );
                    }
                );
            }
        }

        updateCounter();

        return true;
    }

function startSystrayWatcher() {
    createSystray();

    if (systrayTimer) {
        clearInterval(
            systrayTimer
        );
    }

    systrayTimer =
        setInterval(
        createSystray,
        1500
    );
}

function updateProgress() {
    const fetchBar =
          document.getElementById(
              'ordered-fetch-bar'
          );

    const orderedBar =
          document.getElementById(
              'ordered-ordered-bar'
          );

    if (fetchBar) {
        const percent =
              total
        ? Math.min(
            100,
            Math.round(
                completed /
                total *
                100
            )
        )
        : 0;

        fetchBar.style.width =
            `${percent}%`;
    }

    if (orderedBar) {
        const percent =
              orderedFound
        ? Math.min(
            100,
            Math.round(
                orderedProgress /
                orderedFound *
                100
            )
        )
        : 0;

        orderedBar.style.width =
            `${percent}%`;
    }

    const fetchCount =
          document.getElementById(
              'ordered-fetch-count'
          );

    const orderedCount =
          document.getElementById(
              'ordered-ordered-count'
          );

    if (fetchCount) {
        fetchCount.textContent =
            `${completed}/${total}`;
    }

    if (orderedCount) {
        orderedCount.textContent =
            `${orderedProgress}/${orderedFound}`;
    }
}

async function runWorker(queue) {
    while (
        queue.length &&
        running &&
        !destroyed
    ) {
        while (
            paused &&
            running &&
            !destroyed
        ) {
            await sleep(500);
        }

        if (
            !running ||
            destroyed
        ) {
            return;
        }

        const ticketId =
              queue.shift();

        try {
            await processTicket(
                ticketId
            );
        } catch (error) {
        }

        completed++;

        updateProgress();
        updateStats();

        if (completed < total) {
            updateStatus(
                `FETCH ${completed}/${total}`
                );
            }
        }
    }

async function runQueue() {
    if (
        processing ||
        destroyed
    ) {
        return;
    }

    if (!ORDERED_CODES.size) {
        updateStatus(
            'UPLOAD EXCEL'
        );

        return;
    }

    processing = true;

    const tickets =
          getVisibleTickets();

    if (!tickets.length) {
        updateStatus(
            'NO TICKETS'
        );

        processing = false;
        running = false;
        paused = false;

        updateControls();

        return;
    }

    total =
        tickets.length;

    completed = 0;
    orderedFound = 0;
    orderedProgress = 0;
    deletedLogs = 0;
    report = [];
    lastLogFormat = 0;

    updateStats();
    updateProgress();

    updateStatus(
        `FETCH 0/${total}`
        );

    const queue =
          [...tickets];

    const workers = [];

    for (
        let i = 0;
        i <
        Math.min(
            MAX_CONCURRENT,
            queue.length
        );
        i++
    ) {
        workers.push(
            runWorker(queue)
        );
    }

    await Promise.all(
        workers
    );

    if (
        running &&
        !paused &&
        !destroyed
    ) {
        completed =
            total;

        updateStats();
        updateProgress();

        updateStatus(
            `FINISHED • ${orderedFound} ORDERED`
            );

        running = false;
        paused = false;

        updateControls();

        await downloadReport();
    }

    processing = false;
}

function startAutomation() {
    if (
        processing ||
        destroyed
    ) {
        return;
    }

    if (!ORDERED_CODES.size) {
        updateStatus(
            'UPLOAD EXCEL'
        );

        return;
    }

    running = true;
    paused = false;

    total = 0;
    completed = 0;
    orderedFound = 0;
    orderedProgress = 0;
    deletedLogs = 0;
    report = [];

    updateStats();
    updateProgress();
    updateControls();

    updateStatus(
        'RUNNING'
    );

    runQueue();
}

function destroy() {
    if (destroyed) {
        return;
    }

    destroyed = true;
    running = false;
    paused = false;

    if (systrayTimer) {
        clearInterval(
            systrayTimer
        );

        systrayTimer = null;
    }

    document
        .getElementById(
        'ordered-panel'
    )
        ?.remove();

    document
        .getElementById(
        'ordered-systray-item'
    )
        ?.remove();

    document
        .getElementById(
        'ordered-style'
    )
        ?.remove();

    if (
        window[INSTANCE_KEY] === api
    ) {
        delete window[
            INSTANCE_KEY
        ];
    }
}

const api = {
    destroy,
    async suspend() {
        if (destroyed) return true;
        destroy();
        destroyed = false;
        window[INSTANCE_KEY] = api;
        return true;
    },
    async resume() {
        if (destroyed) return false;
        if (!document.getElementById('ordered-panel')) init();
        return true;
    }
};

window[INSTANCE_KEY] =
    api;

function init() {
    if (destroyed) {
        return;
    }

    createPanel();
    startSystrayWatcher();
}

if (
    document.readyState ===
    'loading'
) {
    document.addEventListener(
        'DOMContentLoaded',
        init,
        {
            once: true
        }
    );
} else {
    init();
}
})();
