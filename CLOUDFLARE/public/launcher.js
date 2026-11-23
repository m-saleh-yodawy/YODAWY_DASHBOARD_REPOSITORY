(function () {
    'use strict';
    const host = location.hostname;
    if (!['odoo.yodawy.com', 'portal.yodawy.com'].includes(host)) return;
    if (window.__YD_CLOUD_LAUNCHER__) return;
    window.__YD_CLOUD_LAUNCHER__ = true;
    const script = document.createElement('script');
    script.src = 'https://yodawy-dashboard.m-saleh-yodawy.workers.dev/bookmark-bootstrap.js?v=20261123-fa-self-hosted-4';
    script.async = true;
    script.onload = () => {
        window.__YD_CLOUD_LAUNCHER__ = false;
        script.remove();
    };
    script.onerror = () => {
        window.__YD_CLOUD_LAUNCHER__ = false;
        script.remove();
        const node = document.createElement('div');
        node.textContent = 'YODAWY TOOLS COULD NOT START. PLEASE TRY AGAIN.';
        node.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:14px 18px;border-radius:8px;background:#68465f;color:#fff;font:600 13px Arial,sans-serif;box-shadow:0 4px 18px #0003';
        document.body.append(node);
        setTimeout(() => node.remove(), 6000);
    };
    (document.head || document.documentElement).append(script);
})();
