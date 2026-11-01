/* =========================================================
   YODAWY CENTRAL ERROR MESSAGE ENGINE
   Version: 1.0.0
   Purpose: Centralized error popup for all Yodawy tools
   ========================================================= */

(function (global) {
    'use strict';

    if (global.YODAWY_ERROR_ENGINE) return;

    const CONFIG = {
        VERSION: '1.0.0',
        POPUP_ID: 'yd-central-error-overlay',
        STYLE_ID: 'yd-central-error-styles',
        DEFAULT_TITLE: 'SYSTEM ERROR',
        DEFAULT_MESSAGE: 'AN UNEXPECTED ERROR OCCURRED.',
        BRAND: '#875A7B',
        BRAND_DARK: '#68465F'
    };

    let messages = {};
    let currentOverlay = null;

    // ---------------------------------------------------------
    // 1. CENTRAL MESSAGE CONFIGURATION
    // Messages are supplied by the Loader from auth-messages.json.
    // ---------------------------------------------------------
    function configure(options = {}) {
        if (
            options.messages &&
            typeof options.messages === 'object' &&
            !Array.isArray(options.messages)
        ) {
            messages = options.messages;
        }
    }

    function resolveMessage(input = {}) {
        const code = String(input.code || 'UNKNOWN_ERROR').trim();
        const entry = messages[code];

        const entryTitle =
            entry && typeof entry === 'object'
                ? entry.title
                : '';

        const entryMessage =
            entry && typeof entry === 'object'
                ? entry.message
                : (typeof entry === 'string' ? entry : '');

        return {
            code,
            title: String(
                input.title ||
                entryTitle ||
                CONFIG.DEFAULT_TITLE
            ),
            message: String(
                input.message ||
                entryMessage ||
                CONFIG.DEFAULT_MESSAGE
            )
        };
    }

    // ---------------------------------------------------------
    // 2. STYLES
    // ---------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(CONFIG.STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = CONFIG.STYLE_ID;

        style.textContent = `
            #${CONFIG.POPUP_ID} {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                box-sizing: border-box;
                background: rgba(24, 19, 27, 0.60);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                font-family: system-ui, -apple-system, BlinkMacSystemFont,
                    "Segoe UI", sans-serif;
            }

            #${CONFIG.POPUP_ID} * {
                box-sizing: border-box;
            }

            #${CONFIG.POPUP_ID} .yd-error-card {
                width: min(460px, 100%);
                max-height: min(80vh, 620px);
                overflow-y: auto;
                background: #ffffff;
                color: #34303a;
                border: 1px solid #e8dce7;
                border-top: 5px solid ${CONFIG.BRAND};
                border-radius: 14px;
                box-shadow: 0 24px 75px rgba(0, 0, 0, 0.30);
                animation: ydErrorEnter 160ms ease-out;
            }

            #${CONFIG.POPUP_ID} .yd-error-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 22px 24px 14px;
            }

            #${CONFIG.POPUP_ID} .yd-error-icon {
                display: flex;
                flex: 0 0 42px;
                width: 42px;
                height: 42px;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                background: #f8edf2;
                color: ${CONFIG.BRAND_DARK};
                font-size: 23px;
                font-weight: 800;
            }

            #${CONFIG.POPUP_ID} .yd-error-heading {
                min-width: 0;
                color: ${CONFIG.BRAND_DARK};
                font-size: 16px;
                line-height: 1.4;
                font-weight: 800;
                overflow-wrap: anywhere;
            }

            #${CONFIG.POPUP_ID} .yd-error-body {
                padding: 0 24px 22px;
            }

            #${CONFIG.POPUP_ID} .yd-error-message {
                margin: 0;
                color: #5d5660;
                font-size: 13px;
                line-height: 1.8;
                font-weight: 500;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
            }

            #${CONFIG.POPUP_ID} .yd-error-code {
                margin-top: 14px;
                color: #8a818c;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.8px;
                overflow-wrap: anywhere;
            }

            #${CONFIG.POPUP_ID} .yd-error-footer {
                display: flex;
                justify-content: flex-end;
                padding: 14px 24px 20px;
                border-top: 1px solid #f0eaf0;
            }

            #${CONFIG.POPUP_ID} .yd-error-close {
                min-width: 110px;
                padding: 10px 20px;
                border: 0;
                border-radius: 7px;
                background: ${CONFIG.BRAND};
                color: #ffffff;
                font-size: 12px;
                font-weight: 800;
                letter-spacing: 0.4px;
                cursor: pointer;
                transition: background 120ms ease;
            }

            #${CONFIG.POPUP_ID} .yd-error-close:hover {
                background: ${CONFIG.BRAND_DARK};
            }

            #${CONFIG.POPUP_ID} .yd-error-close:focus-visible {
                outline: 3px solid #c9a9c1;
                outline-offset: 3px;
            }

            @keyframes ydErrorEnter {
                from {
                    opacity: 0;
                    transform: translateY(8px) scale(0.985);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            @media (max-width: 480px) {
                #${CONFIG.POPUP_ID} .yd-error-header {
                    padding: 18px 18px 12px;
                }

                #${CONFIG.POPUP_ID} .yd-error-body {
                    padding: 0 18px 18px;
                }

                #${CONFIG.POPUP_ID} .yd-error-footer {
                    padding: 12px 18px 18px;
                }
            }

            @media (prefers-reduced-motion: reduce) {
                #${CONFIG.POPUP_ID} .yd-error-card {
                    animation: none;
                }
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    // ---------------------------------------------------------
    // 3. CLOSE POPUP
    // ---------------------------------------------------------
    function close() {
        const overlay = document.getElementById(CONFIG.POPUP_ID);

        if (overlay) overlay.remove();

        if (currentOverlay === overlay) {
            currentOverlay = null;
        }
    }

    // ---------------------------------------------------------
    // 4. DISPLAY CENTRAL ERROR POPUP
    // ---------------------------------------------------------
    function show(input = {}) {
        if (!document.body && !document.documentElement) {
            console.error('[YODAWY ERROR ENGINE] No document root available.');
            return false;
        }

        const error = resolveMessage(input);

        close();
        injectStyles();

        const overlay = document.createElement('div');
        overlay.id = CONFIG.POPUP_ID;
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'yd-error-title');
        overlay.setAttribute('aria-describedby', 'yd-error-message');

        const card = document.createElement('section');
        card.className = 'yd-error-card';

        const header = document.createElement('div');
        header.className = 'yd-error-header';

        const icon = document.createElement('div');
        icon.className = 'yd-error-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '!';

        const heading = document.createElement('div');
        heading.className = 'yd-error-heading';
        heading.id = 'yd-error-title';
        heading.textContent = error.title;

        header.append(icon, heading);

        const body = document.createElement('div');
        body.className = 'yd-error-body';

        const message = document.createElement('p');
        message.className = 'yd-error-message';
        message.id = 'yd-error-message';
        message.textContent = error.message;

        const code = document.createElement('div');
        code.className = 'yd-error-code';
        code.textContent = `ERROR CODE: ${error.code}`;

        body.append(message, code);

        const footer = document.createElement('div');
        footer.className = 'yd-error-footer';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'yd-error-close';
        button.textContent = 'CLOSE';
        button.addEventListener('click', close);

        footer.appendChild(button);
        card.append(header, body, footer);
        overlay.appendChild(card);

        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });

        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') close();
        });

        (document.body || document.documentElement).appendChild(overlay);
        currentOverlay = overlay;

        button.focus();

        return true;
    }

    // ---------------------------------------------------------
    // 5. PUBLIC API
    // ---------------------------------------------------------
    const API = Object.freeze({
        version: CONFIG.VERSION,
        configure,
        show,
        close
    });

    global.YODAWY_ERROR_ENGINE = API;

})(window);
