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
        handlers: new Map()
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
            : /next[\s_-]*care/.test(name)
                ? 'NEXTCARE'
                : '';

        if (!provider) throw new Error('This insurance company is not supported by the configured Portal accounts.');

        const result = await api.getPortalAccounts();
        const accounts = (result.accounts || []).filter(account =>
            account.provider === provider &&
            account.accountType === 'PERSONAL'
        );

        if (!accounts.length) {
            throw new Error('Your personal ' + provider + ' account is not configured.');
        }

        const account = accounts.find(item => /personal/i.test(item.label || '')) || accounts[0];
        const response = await api.getPortalCredentials(account.id);

        if (
            !response.success ||
            !response.credentials?.username ||
            !response.credentials?.password
        ) {
            throw new Error('Personal insurance credentials are unavailable.');
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
                const formNumber = getFieldValue('prescription_number');

                if (!company || !cardNumber || !formNumber) {
                    alert('Unable to read the insurance company, card number, or Form Number.');
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
                alert(error.message || 'Portal automation could not complete.');
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
            if (registry[TOOL_ID] === instance) delete registry[TOOL_ID];
            return true;
        }
    });

    registry[TOOL_ID] = instance;
})();