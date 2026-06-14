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

// ---- right-click "this is my address" --------------------------------------
// Rebuilt whenever the address list changes so each known address is offered.

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const state = await storage.load();
  if (state.addresses.length === 0) return;

  chrome.contextMenus.create({
    id: 'at-parent',
    title: 'Address Tracker: this is my address',
    contexts: ['selection'],
  });
  for (const a of state.addresses) {
    const prefix = a.status === 'current' ? 'Current' : 'Old';
    chrome.contextMenus.create({
      id: 'flag:' + a.id,
      parentId: 'at-parent',
      title: `${prefix}: ${address.format(a)}`,
      contexts: ['selection'],
    });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (typeof info.menuItemId !== 'string' || !info.menuItemId.startsWith('flag:')) return;
  const addressId = info.menuItemId.slice('flag:'.length);
  const text = (info.selectionText || '').trim();
  const now = Date.now();
  // Save the selection as a variant AND log this page as holding that address.
  await mutate((s) => {
    storage.addVariant(s, addressId, text);
    storage.recordScan(s, { url: info.pageUrl, rawUrl: info.pageUrl, title: tab?.title || '' }, [addressId], now);
  });
  await refreshBadge();
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
