// ==UserScript==
// @name         Open ERX
// @namespace    https://odoo.yodawy.com/
// @version      1
// @description  Open the matching Yodawy Portal account and prescription from Odoo.
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/*
// @match        https://portal.yodawy.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const TOOL_ID = 'TOOL-015';
    const TOOL_PATH = 'TOOLS/open-erx.js';
    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    if (registry[TOOL_ID]) return;

    const ODOO_KEYS = [
        'Administrative control Authority (ACA)',
        'Ahly Medical',
        'Ain Shams University',
        'Al-Mohandes for Chemical Trade and Industry',
        'Amiantit FiberGlass Lokma Group',
        'Amis',
        'Apatch Petroleum',
        'ARDISEIS P',
        'AUC',
        'AXA Services Egypt',
        'AXON',
        'Bank Misr',
        'Baraka Bank',
        'Bash Hakeem',
        'Bayer PSP',
        'Bupa',
        'Care Plus',
        'Central Bank of Egypt',
        'Cheiron - Pico petroleum',
        'CIAF',
        'Cinema syndicate',
        'Cinnabon',
        'Coca-Cola',
        'Coca Cola Digital Hub',
        'DES',
        'DMS',
        'EGY-Care',
        'EgyMed',
        'Egyptian Football Association',
        'EL Doha - Direct',
        'El Mashreq',
        'El Mrasem 5th installment ( Mivida)',
        'El Mrasem For Construction',
        'ElTawon',
        'EMC',
        'EMC Pensioners',
        'Eshpetco',
        'GASCO',
        'General Organization for Government Printing Offices',
        'GlobeMed',
        'HDB',
        'Health and Wealth',
        'Housing and Building Research Center',
        'HyperOne',
        'INAYA EGYPT CO.',
        'IQVIA PSP',
        'Journalist Syndicate',
        'Libano-Suisse',
        'Life Healthcare',
        'Limitless Care',
        'Masr El Khier',
        'Medicard',
        'Medicare',
        'MediConsult',
        'MediGold',
        'MedMark',
        'MedMisr',
        'Mednet',
        'Medright',
        'MedRight HPM',
        'MedRight TPA',
        'Medsure',
        'MetLife',
        'Midor',
        'MISR HEALTH CARE',
        'Movenpick - Self Insured',
        'MSD PSP',
        'MY PHARMACY CASH ORDER',
        'Nabd Misr Clinics',
        'NASR MINING',
        'National Authority For Printing &Publishing',
        'Neqabty',
        'Next Care',
        'NextCare 2',
        'NileSat',
        'Omega Care',
        'Oriental Weavers _ 10th Ramadan',
        'Petrojet',
        'Pfizer PSP',
        'Prime Health',
        'Prime Health Insurance',
        'Reliance Healthcare',
        'Roche PSP',
        'Rome Catholic NGO',
        'Sanofi',
        'SEDICO',
        'Seha One',
        'Sheraton',
        'Smart Medical Services',
        'SUEZ CANAL LIFE INSURANCE',
        'Tri-Star',
        'Unicare',
        'Unimed',
        'Veterinaries Syndicate',
        'Wadi El Neel',
        'Yodawy Direct Orders'
    ];

    const state = {
        destroyed: false,
        portalStarted: false,
        observer: null,
        handlers: new Map(),
        dialogs: new Set()
    };

    const ensureActive = () => {
        if (state.destroyed) throw new Error('Open ERX was stopped.');
    };

    const normalize = value => String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const normalizeKey = value => normalize(value)
        .replace(/\s*\(\d+\)\s*$/, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');

    const sleep = ms => new Promise((resolve, reject) => {
        if (state.destroyed) return reject(new Error('Open ERX was stopped.'));
        setTimeout(() => {
            try {
                ensureActive();
                resolve();
            } catch (error) {
                reject(error);
            }
        }, ms);
    });

    const visible = selector => [...document.querySelectorAll(selector)].filter(element => {
        const style = getComputedStyle(element);
        return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    });

    const waitFor = async (find, timeout = 30000, interval = 250) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
            ensureActive();
            try {
                const result = find();
                if (result) return result;
            } catch {}
            await sleep(interval);
        }
        throw new Error('Required page element was not found.');
    };

    const showDialog = (title, message, choices = []) => new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:rgba(25,18,28,.58);backdrop-filter:blur(3px);font-family:Arial,sans-serif';
        const card = document.createElement('section');
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.style.cssText = 'width:min(480px,100%);max-height:82vh;overflow:auto;padding:22px;border:1px solid #e8dfe7;border-radius:13px;background:#fff;color:#302833;box-shadow:0 18px 55px rgba(0,0,0,.24)';
        const heading = document.createElement('h3');
        heading.textContent = title;
        heading.style.cssText = 'margin:0 0 10px;color:#68465f;font-size:17px;font-weight:700';
        const description = document.createElement('p');
        description.textContent = message;
        description.style.cssText = 'margin:0 0 18px;color:#5f5862;font-size:13px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere';
        const actions = document.createElement('div');
        actions.style.cssText = 'display:grid;grid-template-columns:1fr;gap:8px';
        const options = choices.length ? choices : [{ label: 'OK', value: null }];
        let closed = false;
        const close = value => {
            if (closed) return;
            closed = true;
            overlay.remove();
            state.dialogs.delete(overlay);
            document.removeEventListener('keydown', onKeydown, true);
            resolve(value);
        };
        const onKeydown = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            close(null);
        };
        for (const choice of options) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = choice.label;
            button.style.cssText = 'min-height:38px;padding:9px 12px;border:1px solid #875a7b;border-radius:7px;background:' + (choice.primary ? '#875a7b' : '#fff') + ';color:' + (choice.primary ? '#fff' : '#68465f') + ';font-size:12px;font-weight:700;text-align:left;cursor:pointer';
            button.addEventListener('click', () => close(choice.value));
            actions.append(button);
        }
        card.append(heading, description, actions);
        overlay.append(card);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close(null);
        });
        document.body.append(overlay);
        state.dialogs.add(overlay);
        document.addEventListener('keydown', onKeydown, true);
        actions.querySelector('button')?.focus();
    });

    const setInput = (input, value) => {
        if (!(input instanceof HTMLInputElement)) throw new Error('Input field is unavailable.');
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        descriptor.set.call(input, String(value ?? ''));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const getFieldValue = name => {
        const element = [...document.querySelectorAll('[name="' + name + '"]')].find(node => normalize(node.innerText || node.textContent));
        return String(element?.innerText || element?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    };

    const resolveOdooKey = company => {
        const target = normalizeKey(company);
        if (!target) return '';
        return ODOO_KEYS.find(key => normalizeKey(key) === target) || '';
    };

    const waitForApi = async () => {
        const started = Date.now();
        while (Date.now() - started < 30000) {
            ensureActive();
            const api = window.YODAWY_API_ENGINE;
            if (api?.getPortalAccounts && api?.getPortalCredentials) return api;
            await sleep(250);
        }
        throw new Error('The Dashboard account service is not loaded on this page.');
    };

    const resolvePortalCredentials = async company => {
        const api = await waitForApi();
        const odooKey = resolveOdooKey(company);
        if (!odooKey) throw new Error('The Odoo company is not included in the supported Odoo Keys list: ' + company);
        const result = await api.getPortalAccounts(true);
        if (result?.success !== true || !Array.isArray(result.accounts)) throw new Error(result?.error || 'Your PORTALS accounts could not be loaded.');
        const key = normalizeKey(odooKey);
        const accounts = result.accounts.filter(account =>
            normalizeKey(account.odooKey) === key &&
            ['PERSONAL', 'NON-PERSONAL'].includes(String(account.accountType || '').toUpperCase())
        );
        if (!accounts.length) throw new Error('No linked Portal account was found for "' + odooKey + '" in your PORTALS list.');
        let account = accounts[0];
        if (accounts.length > 1) {
            const selected = await showDialog(
                'Select Portal Account',
                'More than one linked account matches "' + odooKey + '". Choose the account to use for this ERX.',
                accounts.map(item => ({
                    label: (item.accountType === 'PERSONAL' ? 'Personal' : 'Non-Personal') + ' · ' + (item.username || item.label || item.id),
                    value: item.id
                })).concat([{ label: 'Cancel', value: null }])
            );
            account = accounts.find(item => item.id === selected);
            if (!account) throw new Error('Portal account selection was cancelled.');
        }
        const response = await api.getPortalCredentials(account.id);
        if (!response?.success || !response.credentials?.username || !response.credentials?.password) {
            throw new Error('The selected Portal account credentials are unavailable.');
        }
        return response.credentials;
    };

    const readPortalFormNumber = () => {
        const formLabel = [...document.querySelectorAll('label')].find(label => normalize(label.textContent) === 'form number');
        if (!formLabel?.parentElement) return '';
        const value = [...formLabel.parentElement.querySelectorAll('label')].find(label => label !== formLabel && normalize(label.textContent));
        return String(value?.textContent || '').trim();
    };

    const getPrescriptionTable = () => [...document.querySelectorAll('table')].find(table =>
        /date/i.test(table.innerText) &&
        /expire/i.test(table.innerText) &&
        /status/i.test(table.innerText) &&
        table.querySelector('tbody > tr')
    );

    const findActionButton = text => [...document.querySelectorAll('span,button')].find(element =>
        normalize(element.textContent) === normalize(text)
    )?.closest('button');

    const login = async credentials => {
        if (document.body.innerText.includes('Search Member')) return true;
        const passwordInput = await waitFor(() => visible('input[type="password"]')[0]);
        const usernameInput = await waitFor(() => visible('input').find(input =>
            input !== passwordInput &&
            ['text', 'email'].includes(normalize(input.type)) &&
            !input.disabled
        ));
        setInput(usernameInput, credentials.username);
        setInput(passwordInput, credentials.password);
        const loginButton = await waitFor(() => [...document.querySelectorAll('button')].find(button =>
            button.getClientRects().length > 0 && normalize(button.textContent) === 'login'
        ));
        loginButton.click();
        await waitFor(() => document.body.innerText.includes('Search Member'), 45000);
        return true;
    };

    const selectPrescriptionByFormNumber = async formNumber => {
        const target = normalize(formNumber);
        const table = await waitFor(() => getPrescriptionTable(), 45000);
        const rows = table.querySelectorAll('tbody > tr');
        if (normalize(readPortalFormNumber()) === target) return true;
        for (let index = 0; index < rows.length; index++) {
            ensureActive();
            const current = await waitFor(() => getPrescriptionTable(), 15000);
            const row = current.querySelectorAll('tbody > tr')[index];
            if (!row) continue;
            row.click();
            let value = '';
            try {
                value = await waitFor(() => {
                    const currentValue = readPortalFormNumber();
                    return currentValue && normalize(currentValue) === target ? currentValue : null;
                }, 4500, 150);
            } catch {}
            if (normalize(value || readPortalFormNumber()) === target) return true;
        }
        throw new Error('No prescription matched Form Number: ' + formNumber);
    };

    const continuePrescriptionSelection = async (cardNumber, formNumber) => {
        if (!cardNumber || !formNumber) throw new Error('Card number or Form Number is missing.');
        if (!getPrescriptionTable()) {
            const searchButton = await waitFor(() => findActionButton('Search Member'));
            searchButton.click();
            const cardInput = await waitFor(() => {
                const inputs = visible('input[type="text"]');
                return inputs.length >= 7 ? inputs[6] : null;
            });
            setInput(cardInput, cardNumber);
            const proceedButton = await waitFor(() => findActionButton('Proceed'));
            proceedButton.click();
        }
        await selectPrescriptionByFormNumber(formNumber);
    };

    const setupOdoo = () => {
        if (state.destroyed) return;
        if (!document.getElementById('yd-open-erx-reference-style')) {
            const style = document.createElement('style');
            style.id = 'yd-open-erx-reference-style';
            style.textContent = '[name="user_ref"]:hover{text-decoration:underline!important;text-underline-offset:2px}';
            document.head.append(style);
        }
        for (const [element, item] of state.handlers) {
            if (!element.isConnected) {
                element.removeEventListener('click', item.handler);
                state.handlers.delete(element);
            }
        }
        for (const card of document.querySelectorAll('[name="user_ref"]')) {
            if (state.handlers.has(card)) continue;
            const handler = () => {
                const companyRaw = getFieldValue('payor_id');
                const company = resolveOdooKey(companyRaw);
                const cardNumber = String(card.innerText || card.textContent || '').trim();
                const formNumber = getFieldValue('prescription_number') || getFieldValue('user_ref_2') || getFieldValue('prescription_mongo_id');
                if (!company || !cardNumber || !formNumber) {
                    const missing = [
                        !company && (companyRaw ? 'supported Odoo Key for ' + companyRaw : 'insurance company'),
                        !cardNumber && 'card number',
                        !formNumber && 'prescription reference'
                    ].filter(Boolean);
                    showDialog('Unable to Open ERX', 'Missing or unsupported data: ' + missing.join(', ') + '.');
                    return;
                }
                const params = new URLSearchParams({
                    tm: '1',
                    mode: 'openPortal',
                    company,
                    card: cardNumber,
                    fn: formNumber
                });
                const tab = window.open('https://portal.yodawy.com/?' + params.toString(), '_blank');
                if (!tab) showDialog('Popup Blocked', 'Allow popups for odoo.yodawy.com to open the Portal in a new tab.');
            };
            const previous = { title: card.getAttribute('title'), cursor: card.style.cursor };
            card.title = 'Open ERX';
            card.style.cursor = 'pointer';
            card.addEventListener('click', handler);
            state.handlers.set(card, { handler, previous });
        }
    };

    const startPortal = async () => {
        const params = new URLSearchParams(location.search);
        if (params.get('tm') !== '1' || params.get('mode') !== 'openPortal' || params.has('split') || state.portalStarted) return;
        state.portalStarted = true;
        const company = params.get('company') || '';
        const cardNumber = (params.get('card') || '').trim();
        const formNumber = (params.get('fn') || '').trim();
        try {
            if (!company || !cardNumber || !formNumber) throw new Error('Company, card number, or Form Number is missing from the Open ERX request.');
            const credentials = await resolvePortalCredentials(company);
            await login(credentials);
            await continuePrescriptionSelection(cardNumber, formNumber);
            const cleanUrl = new URL(location.href);
            ['tm', 'mode', 'company', 'card', 'fn'].forEach(key => cleanUrl.searchParams.delete(key));
            history.replaceState(history.state, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
        } catch (error) {
            if (!state.destroyed) await showDialog('Open ERX Failed', error?.message || 'Portal automation could not complete.');
        }
    };

    if (location.hostname === 'odoo.yodawy.com') {
        state.observer = new MutationObserver(setupOdoo);
        state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        setupOdoo();
    }

    if (location.hostname === 'portal.yodawy.com') startPortal();

    const instance = Object.freeze({
        id: TOOL_ID,
        path: TOOL_PATH,
        destroy: async () => {
            if (state.destroyed) return true;
            state.destroyed = true;
            state.observer?.disconnect();
            for (const [element, item] of state.handlers) {
                element.removeEventListener('click', item.handler);
                if (item.previous.title === null) element.removeAttribute('title');
                else element.setAttribute('title', item.previous.title);
                element.style.cursor = item.previous.cursor;
            }
            state.handlers.clear();
            state.dialogs.forEach(dialog => dialog.remove());
            state.dialogs.clear();
            document.getElementById('yd-open-erx-reference-style')?.remove();
            if (registry[TOOL_ID] === instance) delete registry[TOOL_ID];
            return true;
        }
    });

    registry[TOOL_ID] = instance;
})();