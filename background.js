// MV3 service worker: handles messages, context menus and the badge.
// No in-memory state — the worker is killed when idle and rehydrates from storage.
importScripts('shared/constants.js', 'shared/detect.js', 'shared/address.js', 'shared/storage.js');

const { storage, address } = AT;

// update() is load->mutate->save; concurrent messages must be chained or writes get lost.
let writeChain = Promise.resolve();
function mutate(fn) {
  const next = writeChain.then(() => storage.update(fn));
  writeChain = next.catch((e) => console.error('[AddressTracker] write failed', e));
  return next;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse, () => sendResponse({}));
  return true; // keep the channel open for the async reply
});

async function handleMessage(msg) {
  const now = Date.now();
  const pageInfo = { url: msg.url, rawUrl: msg.url, title: msg.title };
  let reply = {};
  switch (msg.type) {
    case 'scan': {
      // New sites are confirmed on-page unless confirmation is off or it's the move's old address.
      const state = await storage.load();
      const decision = storage.scanDecision(state, storage.normalizeUrl(msg.url), msg.matchedIds);
      if (decision === 'record') {
        await mutate((s) => storage.recordScan(s, pageInfo, msg.matchedIds, now));
      }
      reply = { prompt: decision === 'prompt' };
      break;
    }
    case 'save-page': // user confirmed the toast
      await mutate((s) => storage.recordScan(s, pageInfo, msg.matchedIds || [], now));
      break;
    case 'override':
      await mutate((s) => storage.setOverride(s, storage.normalizeUrl(msg.url), msg.status, now));
      break;
    case 'ignore':
      await mutate((s) => storage.ignorePage(s, pageInfo, now));
      break;
    case 'ignore-rule':
      await mutate((s) => storage.addIgnoreRule(s, msg.rule, true));
      break;
    default:
      return reply;
  }
  await refreshBadge();
  return reply;
}

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
    // Selection matches a known form — record the page.
    await mutate((s) => storage.recordScan(s, pageInfo, [current.id], now));
    await refreshBadge();
  } else if (info.menuItemId === 'at-variant-new') {
    // Management page opens so the user can review the variant before saving.
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

// Badge: count of pages still needing an update during a move.
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

// React to writes made directly by UI pages. refreshBadge only reads, so no loop.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.addresses) buildMenus();
  if (changes.moves || changes.pages || changes.addresses) refreshBadge();
});
