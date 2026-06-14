// content.js — runs on every page (top frame only).
//
// Responsibilities:
//   1. Walk the rendered DOM for visible text + form-field values, descending
//      into open shadow roots and same-origin iframes.
//   2. Match against the addresses we're hunting (current; both during a move).
//   3. Report matches to the background worker (which owns all writes).
//   4. Re-scan on SPA navigation and (debounced) DOM mutations.
//   5. During a move, show a Shadow-DOM banner when the old address is present.
(() => {
  if (window.top !== window) return; // top frame only; it reaches into same-origin iframes itself

  const BANNER_HOST_ID = '__address_tracker_banner__';
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME']);
  const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
  const FOOTER_HEADER = 'footer, header, [role="contentinfo"], [role="banner"]';

  let settings = AT.storage.defaultSettings();
  let profiles = [];            // address profiles we're hunting right now
  let move = null;              // { fromId, toId, newAddressText } while moving
  let bannerDismissed = false;  // reset on navigation
  let lastUrl = location.href;

  // ---- config (kept fresh from storage) ------------------------------------

  async function loadConfig() {
    const state = await AT.storage.load();
    settings = state.settings;
    const active = AT.storage.activeMove(state);
    if (active) {
      const to = AT.storage.addressById(state, active.toAddressId);
      move = { fromId: active.fromAddressId, toId: active.toAddressId, newAddressText: to ? AT.address.format(to) : '' };
      profiles = state.addresses
        .filter((a) => a.id === active.fromAddressId || a.id === active.toAddressId)
        .map(AT.address.buildProfile);
    } else {
      move = null;
      const current = AT.storage.currentAddress(state);
      profiles = current ? [AT.address.buildProfile(current)] : [];
    }
  }

  // ---- DOM walking ---------------------------------------------------------

  function isHidden(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  }

  // Collect visible text and form values into `acc`, recursing through open
  // shadow roots and same-origin iframes.
  function walk(node, acc) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue.trim();
      if (text) acc.text.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node;
    if (SKIP_TAGS.has(el.tagName) && el.tagName !== 'IFRAME') return;
    if (el.id === BANNER_HOST_ID) return;
    if (settings.skipFooterHeader && el.matches(FOOTER_HEADER)) return;
    if (isHidden(el)) return;

    if (el.tagName === 'IFRAME') {
      walkIframe(el, acc);
      return;
    }

    if (settings.scanFormValues && FIELD_TAGS.has(el.tagName)) {
      collectFieldValue(el, acc);
    }

    if (el.shadowRoot) {
      for (const child of el.shadowRoot.childNodes) walk(child, acc);
    }
    for (const child of el.childNodes) walk(child, acc);
  }

  function walkIframe(iframe, acc) {
    try {
      const doc = iframe.contentDocument; // throws for cross-origin (accepted gap)
      if (doc && doc.body) walk(doc.body, acc);
    } catch {
      /* cross-origin iframe — unreachable */
    }
  }

  function collectFieldValue(el, acc) {
    if (el.type === 'password' || el.type === 'hidden') return;
    const value = (el.value || '').trim();
    if (value) acc.fields.push(value);
    if (el.tagName === 'SELECT' && el.selectedOptions[0]) {
      acc.fields.push(el.selectedOptions[0].textContent.trim());
    }
  }

  // ---- scanning ------------------------------------------------------------

  function scan() {
    if (!profiles.length || !document.body) return;

    const acc = { text: [], fields: [] };
    if (settings.scanVisibleText) walk(document.body, acc);
    else if (settings.scanFormValues) collectFieldsOnly(document.body, acc);

    const ctx = {
      text: AT.detect.normalize(acc.text.join(' ')),
      fields: acc.fields.map(AT.detect.normalize).filter(Boolean),
    };
    const matchedIds = AT.detect.scan(profiles, ctx);

    chrome.runtime.sendMessage({
      type: 'scan',
      url: location.href,
      title: document.title,
      matchedIds,
    }).catch(() => { /* worker asleep or context gone */ });

    updateBanner(matchedIds);
  }

  // When visible-text scanning is off we still want form values.
  function collectFieldsOnly(root, acc) {
    for (const el of root.querySelectorAll('input, textarea, select')) {
      collectFieldValue(el, acc);
    }
  }

  // ---- banner (Shadow DOM, top frame) --------------------------------------

  function updateBanner(matchedIds) {
    const shouldShow = move && settings.showBanner && !bannerDismissed &&
      matchedIds.includes(move.fromId);
    if (shouldShow) showBanner();
    else removeBanner();
  }

  function showBanner() {
    if (document.getElementById(BANNER_HOST_ID)) return;

    const host = document.createElement('div');
    host.id = BANNER_HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .bar { position: fixed; top: 12px; right: 12px; z-index: 2147483647;
               max-width: 360px; font: 13px/1.4 system-ui, sans-serif;
               background: #1f2937; color: #f9fafb; border-radius: 10px;
               box-shadow: 0 6px 24px rgba(0,0,0,.35); padding: 12px 14px; }
        .title { font-weight: 600; margin-bottom: 4px; }
        .addr { color: #fcd34d; margin-bottom: 10px; word-break: break-word; }
        .row { display: flex; gap: 6px; flex-wrap: wrap; }
        button { font: inherit; border: 0; border-radius: 6px; padding: 5px 9px;
                 cursor: pointer; background: #374151; color: #f9fafb; }
        button.primary { background: #2563eb; }
        button:hover { filter: brightness(1.1); }
      </style>
      <div class="bar">
        <div class="title">🏠 Address Tracker · old address found here</div>
        <div class="addr">${escapeHtml(move.newAddressText)}</div>
        <div class="row">
          <button class="primary" data-act="copy">Copy new address</button>
          <button data-act="done">Mark as Done</button>
          <button data-act="ignore">Not mine</button>
          <button data-act="dismiss">✕</button>
        </div>
      </div>`;

    root.querySelector('[data-act="copy"]').addEventListener('click', () => {
      navigator.clipboard.writeText(move.newAddressText).catch(() => {});
    });
    root.querySelector('[data-act="done"]').addEventListener('click', () => {
      send('override', { status: 'done' });
      removeBanner();
    });
    root.querySelector('[data-act="ignore"]').addEventListener('click', () => {
      send('ignore');
      bannerDismissed = true;
      removeBanner();
    });
    root.querySelector('[data-act="dismiss"]').addEventListener('click', () => {
      bannerDismissed = true; // this session only; page stays in the list
      removeBanner();
    });

    (document.body || document.documentElement).appendChild(host);
  }

  function removeBanner() {
    document.getElementById(BANNER_HOST_ID)?.remove();
  }

  function send(type, extra = {}) {
    chrome.runtime.sendMessage({ type, url: location.href, ...extra }).catch(() => {});
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
  }

  // ---- triggers ------------------------------------------------------------

  const debounce = (fn, ms) => {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  };
  const scanSoon = debounce(scan, 800);

  function onNavigation() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    bannerDismissed = false; // new page, banner may apply again
    scanSoon();
  }

  function injectPageHook() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('page-hook.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  function watchMutations() {
    if (!settings.rescanOnDomMutation) return;
    new MutationObserver(scanSoon).observe(document.body, { childList: true, subtree: true });
  }

  // ---- init ----------------------------------------------------------------

  async function init() {
    await loadConfig();
    injectPageHook();
    window.addEventListener('at:navigation', onNavigation);
    watchMutations();

    // Rebuild config when addresses/move/settings change (e.g. move started
    // in another tab), then re-scan.
    chrome.storage.onChanged.addListener(async (_changes, area) => {
      if (area !== 'local') return;
      await loadConfig();
      scan();
    });

    scan();
  }

  init();
})();
