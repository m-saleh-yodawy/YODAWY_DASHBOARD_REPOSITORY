// ==UserScript==
// @name         Open Erx
// @namespace    https://odoo.yodawy.com/
// @version      1
// @description  Open the correct prescription from Odoo in Yodawy Portal.
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/*
// @match        https://portal.yodawy.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const TOOL_ID = 'TOOL-002';
    const TOOL_PATH = 'TOOLS/open-erx.js';
    const ACCOUNTS_GLOBAL = 'YODAWY_API_ENGINE';
    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);

    if (registry[TOOL_ID]) return;

    const state = {
        destroyed: false,
        portalStarted: false,
        observer: null,
        handlers: new Map(),
        dialogs: new Set()
    };

    const ensureActive = () => {
        if (state.destroyed) throw new Error('Tool stopped.');
    };

    const normalize = value => String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const sleep = ms => new Promise((resolve, reject) => {
        if (state.destroyed) return reject(new Error('Tool stopped.'));
        setTimeout(() => {
            try {
                ensureActive();
                resolve();
            } catch (error) {
                reject(error);
            }
        }, ms);
    });

    const visible = selector => [...document.querySelectorAll(selector)].filter(element =>
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden' &&
        getComputedStyle(element).display !== 'none'
    );

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

    const setInput = (input, value) => {
        if (!(input instanceof HTMLInputElement)) throw new Error('Input field is unavailable.');
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        descriptor.set.call(input, String(value ?? ''));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const getFieldValue = name => {
        for (const element of document.querySelectorAll('[name="' + name + '"]')) {
            const value = String(element.innerText || element.textContent || '')
                .replace(/\u00a0/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (value) return value;
        }
        return '';
    };

    const showToolDialog = (title, message, actions = []) => new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:rgba(25,18,28,.58);backdrop-filter:blur(3px);font-family:Arial,sans-serif';
        const card = document.createElement('section');
        card.setAttribute('role','dialog');
        card.setAttribute('aria-modal','true');
        card.style.cssText = 'width:min(440px,100%);max-height:80vh;overflow:auto;padding:22px;border:1px solid #e8dfe7;border-radius:13px;background:#fff;color:#302833;box-shadow:0 18px 55px rgba(0,0,0,.24)';
        const heading = document.createElement('h3');
        heading.textContent = title;
        heading.style.cssText = 'margin:0 0 10px;color:#68465f;font-size:17px;font-weight:700';
        const description = document.createElement('p');
        description.textContent = message;
        description.style.cssText = 'margin:0 0 18px;color:#5f5862;font-size:13px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere';
        const actionsBox = document.createElement('div');
        actionsBox.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px';
        const choices = actions.length ? actions : [{ label:'OK', value:null }];
        let closed = false;
        const close = value => {
            if (closed) return;
            closed = true;
            overlay.remove();
            state.dialogs.delete(overlay);
            document.removeEventListener('keydown', keyHandler, true);
            resolve(value);
        };
        const keyHandler = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            close(null);
        };
        for (const choice of choices) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = choice.label;
            button.style.cssText = 'min-height:36px;padding:8px 13px;border:1px solid #875a7b;border-radius:7px;background:' + (choice.primary ? '#875a7b' : '#fff') + ';color:' + (choice.primary ? '#fff' : '#68465f') + ';font-size:12px;font-weight:700;cursor:pointer';
            button.addEventListener('click', () => close(choice.value));
            actionsBox.append(button);
        }
        card.append(heading, description, actionsBox);
        overlay.append(card);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(null); });
        document.body.append(overlay);
        state.dialogs.add(overlay);
        document.addEventListener('keydown', keyHandler, true);
        actionsBox.querySelector('button')?.focus();
    });

    const compact = value => normalize(value)
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');

    const waitForApi = async () => {
        const started = Date.now();
        while (Date.now() - started < 20000) {
            ensureActive();
            const api = window[ACCOUNTS_GLOBAL];
            if (api?.getPortalAccounts && api?.getPortalCredentials) return api;
            await sleep(250);
        }
        throw new Error('Cloud account service is unavailable.');
    };

    const resolvePersonalAccount = async company => {
        const api = await waitForApi();
        const name = normalize(company);
        const provider = name.includes('metlife')
            ? 'METLIFE'
            : /next[\\s_-]*care/.test(name)
                ? 'NEXTCARE'
                : '';
        if (!provider) throw new Error('This insurance company is not supported by the configured Portal accounts.');
        const result = await api.getPortalAccounts();
        if (result?.success !== true || !Array.isArray(result.accounts)) throw new Error(result?.error || 'Your Portal accounts could not be loaded.');
        const accounts = result.accounts.filter(account =>
            account.accountType === 'PERSONAL' &&
            account.enabled !== false
        );
        const companyKey = compact(company);
        const candidates = accounts.map(account => {
            const keys = [account.odooKey, account.label, account.payer].map(compact).filter(Boolean);
            const exact = keys.some(key => key === companyKey);
            const partial = keys.some(key => key.length >= 4 && companyKey.length >= 4 && (companyKey.includes(key) || key.includes(companyKey)));
            const legacyProvider = String(account.provider || '').toUpperCase() === provider;
            const score = exact ? 100 : partial ? 80 : legacyProvider ? 60 : 0;
            return { account, score };
        }).filter(item => item.score > 0).sort((a,b) => b.score-a.score);
        if (!candidates.length) throw new Error('No Personal - Linked Portal account matches "' + company + '". Check the user PORTALS list and its Odoo Key.');
        const bestScore = candidates[0].score;
        const best = candidates.filter(item => item.score === bestScore).map(item => item.account);
        let account = best[0];
        if (best.length > 1) {
            const selected = await showToolDialog(
                'Choose Portal Account',
                'More than one personal account matches ' + company + '. Select the login account to continue.',
                [
                    ...best.map(item => ({
                        label: String(item.username || item.label || 'Portal account'),
                        value: item.id,
                        primary: false
                    })),
                    { label: 'Cancel', value: null }
                ]
            );
            account = best.find(item => item.id === selected);
            if (!account) throw new Error('Portal account selection was cancelled.');
        }
        const response = await api.getPortalCredentials(account.id);
        if (!response.success || !response.credentials?.username || !response.credentials?.password) {
            throw new Error('The selected personal Portal credentials are unavailable.');
        }
        return response.credentials;
    };

    const readPortalFormNumber = () => {
        const formLabel = [...document.querySelectorAll('label')].find(label =>
            normalize(label.textContent) === 'form number'
        );

        if (!formLabel?.parentElement) return '';

        const valueLabel = [...formLabel.parentElement.querySelectorAll('label')].find(label =>
            label !== formLabel && normalize(label.textContent)
        );

        return String(valueLabel?.textContent || '').trim();
    };

    const getPrescriptionTable = () => [...document.querySelectorAll('table')].find(table =>
        table.innerText.includes('Date') &&
        table.innerText.includes('Expire') &&
        table.innerText.includes('Status') &&
        table.querySelector('tbody > tr')
    );

    const findActionButton = text => [...document.querySelectorAll('span')].find(element =>
        normalize(element.textContent) === normalize(text)
    )?.closest('button');

    const setupOdoo = () => {
        if (state.destroyed) return;

        if (!document.getElementById('yd-open-erx-reference-style')) {
            const style = document.createElement('style');
            style.id = 'yd-open-erx-reference-style';
            style.textContent = '[name="user_ref"]:hover{text-decoration:underline!important;text-underline-offset:2px}';
            document.head.append(style);
        }

        for (const [element, item] of state.handlers) {
            if (element.isConnected) continue;
            element.removeEventListener('click', item.handler);
            state.handlers.delete(element);
        }

        const cards = document.querySelectorAll('[name="user_ref"]');

        for (const card of cards) {
            if (state.handlers.has(card)) continue;

            const handler = () => {
                const company = getFieldValue('payor_id');
                const cardNumber = String(card.innerText || card.textContent || '').trim();
                const formNumber = getFieldValue('prescription_number') ||
                    getFieldValue('user_ref_2') ||
                    getFieldValue('prescription_mongo_id');

                if (!company || !cardNumber || !formNumber) {
                    const missing = [
                        !company && 'insurance company',
                        !cardNumber && 'card number',
                        !formNumber && 'prescription reference'
                    ].filter(Boolean);
                    showToolDialog('Open ERX', 'Unable to read the ' + missing.join(', ') + '.');
                    return;
                }

                const params = new URLSearchParams({
                    tm: '1',
                    mode: 'openPortal',
                    company,
                    card: cardNumber,
                    fn: formNumber
                });

                window.open('https://portal.yodawy.com/?' + params.toString(), '_blank');
            };

            const previous = {
                title: card.getAttribute('title'),
                cursor: card.style.cursor
            };

            card.title = 'Open ERX';
            card.style.cursor = 'pointer';
            card.addEventListener('click', handler);
            state.handlers.set(card, { handler, previous });
        }
    };

    const login = async credentials => {
        if (document.body.innerText.includes('Search Member')) return;

        const passwordInput = await waitFor(() => visible('input[type="password"]')[0]);
        const usernameInput = await waitFor(() =>
            visible('input').find(input =>
                input !== passwordInput &&
                !['hidden', 'submit', 'button', 'checkbox', 'password'].includes(normalize(input.type))
            )
        );

        setInput(usernameInput, credentials.username);
        setInput(passwordInput, credentials.password);

        const loginButton = await waitFor(() =>
            [...document.querySelectorAll('button')].find(button =>
                button.getClientRects().length > 0 &&
                normalize(button.textContent) === 'login'
            )
        );

        loginButton.click();
        await waitFor(() => document.body.innerText.includes('Search Member'));
    };

    const continuePrescriptionSelection = async (cardNumber, formNumber) => {
        if (!cardNumber || !formNumber) {
            throw new Error('Card number or Form Number is missing.');
        }

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

        await waitFor(() => getPrescriptionTable());
        await selectPrescriptionByFormNumber(formNumber);
    };

    const selectPrescriptionByFormNumber = async formNumber => {
        const target = normalize(formNumber);
        const table = await waitFor(() => getPrescriptionTable());
        const totalRows = table.querySelectorAll('tbody > tr').length;

        if (normalize(readPortalFormNumber()) === target) return true;

        for (let index = 0; index < totalRows; index++) {
            ensureActive();

            const currentTable = await waitFor(() => getPrescriptionTable());
            const row = currentTable.querySelectorAll('tbody > tr')[index];
            if (!row) continue;

            const previousValue = readPortalFormNumber();
            row.click();

            let displayedFormNumber = '';

            try {
                displayedFormNumber = await waitFor(() => {
                    const value = readPortalFormNumber();
                    return value && value !== previousValue ? value : null;
                }, 6000, 200);
            } catch {
                displayedFormNumber = readPortalFormNumber();
            }

            if (normalize(displayedFormNumber) === target) return true;
            await sleep(250);
        }

        throw new Error('No prescription matched Form Number: ' + formNumber);
    };

    const portalLogin = async () => {
        const params = new URLSearchParams(location.search);

        if (
            params.get('tm') !== '1' ||
            params.get('mode') !== 'openPortal' ||
            params.has('split') ||
            state.portalStarted
        ) {
            return;
        }

        state.portalStarted = true;

        const company = params.get('company') || '';
        const cardNumber = (params.get('card') || '').trim();
        const formNumber = (params.get('fn') || '').trim();

        try {
            if (!company || !cardNumber || !formNumber) {
                throw new Error('The insurance company, card number, or Form Number is missing from the request.');
            }

            const credentials = await resolvePersonalAccount(company);
            await login(credentials);
            await continuePrescriptionSelection(cardNumber, formNumber);
        } catch (error) {
            if (!state.destroyed) {
                showToolDialog('Open ERX Failed', error.message || 'Portal automation could not complete.');
            }
        }
    };

    if (location.hostname === 'odoo.yodawy.com') {
        state.observer = new MutationObserver(setupOdoo);
        state.observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
        setupOdoo();
    }

    if (location.hostname === 'portal.yodawy.com') {
        portalLogin();
    }

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