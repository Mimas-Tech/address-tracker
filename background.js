// background.js — MV3 service worker (classic, so importScripts works).
//
// The single writer. Content scripts and UI pages send messages or write their
// own address/move records; this worker serializes every storage mutation it
// performs, owns the right-click "this is my address" menu, and keeps the
// toolbar badge in sync. It holds no in-memory state — everything rehydrates
// from chrome.storage on wake.
importScripts('shared/constants.js', 'shared/detect.js', 'shared/address.js', 'shared/storage.js');

const { storage, address } = AT;

// ---- serialized writes -----------------------------------------------------
// Messages can arrive concurrently; each storage.update is load->mutate->save,
// so we chain them to prevent lost updates.
let writeChain = Promise.resolve();
function mutate(fn) {
  const next = writeChain.then(() => storage.update(fn));
  writeChain = next.catch((e) => console.error('[AddressTracker] write failed', e));
  return next;
}

// ---- messages from content script & UI -------------------------------------

chrome.runtime.onMessage.addListener((msg, sender) => {
  handleMessage(msg, sender); // fire-and-forget; senders don't await a reply
  return false;
});

async function handleMessage(msg) {
  const now = Date.now();
  switch (msg.type) {
    case 'scan':
      await mutate((s) => storage.recordScan(
        s, { url: msg.url, rawUrl: msg.url, title: msg.title }, msg.matchedIds, now
      ));
      break;
    case 'override':
      await mutate((s) => storage.setOverride(s, storage.normalizeUrl(msg.url), msg.status, now));
      break;
    case 'ignore':
      await mutate((s) => storage.setIgnored(s, storage.normalizeUrl(msg.url), true));
      break;
    default:
      return;
  }
  await refreshBadge();
}

// ---- right-click context menu ----------------------------------------------
// Two actions when text is selected:
//   "Add as variant"  — saves the selection as a known form of the current address
//                       AND records this page as holding that address.
//   "Add page only"   — records this page under the current address without a variant.
// The "page only" action also appears when no text is selected.

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const state = await storage.load();
  const current = storage.currentAddress(state);
  if (!current) return;

  chrome.contextMenus.create({
    id: 'at-parent',
    title: 'Address Tracker',
    contexts: ['all'],
  });

  // Known forms of the address the user can confirm a match against
  const known = [address.format(current), ...(current.flaggedVariants || [])];
  for (let i = 0; i < known.length; i++) {
    chrome.contextMenus.create({
      id: `at-match:${i}`,
      parentId: 'at-parent',
      title: known[i],
      contexts: ['selection'],
    });
  }

  chrome.contextMenus.create({ id: 'at-sep1', parentId: 'at-parent', type: 'separator', contexts: ['selection'] });

  // Add the selected text as a new (unconfirmed) variant — opens management page modal
  chrome.contextMenus.create({
    id: 'at-variant-new',
    parentId: 'at-parent',
    title: 'Add "%s" as new variant…',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({ id: 'at-sep2', parentId: 'at-parent', type: 'separator', contexts: ['all'] });

  chrome.contextMenus.create({
    id: 'at-page',
    parentId: 'at-parent',
    title: 'Add this page to address tracker',
    contexts: ['all'],
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (typeof info.menuItemId !== 'string') return;
  const now = Date.now();
  const state = await storage.load();
  const current = storage.currentAddress(state);
  if (!current) return;

  const pageInfo = { url: info.pageUrl, rawUrl: info.pageUrl, title: tab?.title || '' };

  if (info.menuItemId.startsWith('at-match:')) {
    // User confirmed the selected text matches an existing known form — just record the page
    await mutate((s) => storage.recordScan(s, pageInfo, [current.id], now));
    await refreshBadge();
  } else if (info.menuItemId === 'at-variant-new') {
    // Open management page so the user can confirm/edit before saving
    const text = (info.selectionText || '').trim();
    if (!text) return;
    const url = chrome.runtime.getURL('management/management.html') +
      `?action=addVariant&addressId=${encodeURIComponent(current.id)}&text=${encodeURIComponent(text)}&pageUrl=${encodeURIComponent(info.pageUrl)}&pageTitle=${encodeURIComponent(tab?.title || '')}`;
    chrome.tabs.create({ url });
  } else if (info.menuItemId === 'at-page') {
    await mutate((s) => storage.recordScan(s, pageInfo, [current.id], now));
    await refreshBadge();
  }
});

// ---- toolbar badge ---------------------------------------------------------
// During a move, show the count of pages still needing an update.

async function refreshBadge() {
  const state = await storage.load();
  const prog = storage.progress(state);
  if (prog && prog.needs > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    await chrome.action.setBadgeText({ text: String(prog.needs) });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// ---- lifecycle -------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  await buildMenus();
  await refreshBadge();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await buildMenus();
  await refreshBadge();
});

// React to writes made by UI pages (e.g. Start Move from the popup), which this
// worker didn't perform itself. refreshBadge only reads, so there's no loop.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.addresses) buildMenus();
  if (changes.moves || changes.pages || changes.addresses) refreshBadge();
});
