// shared/storage.js — the single source of truth.
//
// Everything lives in one flat chrome.storage.local store. This file owns:
//   - load/save and the default shape
//   - URL normalization (the `pages` key)
//   - status derivation (no status is ever stored on a detected page)
//   - state transitions (start/complete/cancel move, record a scan, etc.)
//
// Transitions are plain functions that mutate and return a state object, so the
// service worker can load -> transform -> save, and they can be unit-tested
// without Chrome. Nothing here touches the DOM.
globalThis.AT = globalThis.AT || {};

AT.storage = (() => {
  const KEYS = ['schemaVersion', 'addresses', 'moves', 'pages', 'settings'];
  const SCHEMA_VERSION = 1;

  const uid = () => crypto.randomUUID();

  function defaultSettings() {
    return {
      scanVisibleText: true,
      scanFormValues: true,
      skipFooterHeader: true,
      rescanOnDomMutation: true,
      showBanner: true,
    };
  }

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      addresses: [],
      moves: [],
      pages: {},
      settings: defaultSettings(),
    };
  }

  // ---- persistence ---------------------------------------------------------

  async function load() {
    const stored = await chrome.storage.local.get(KEYS);
    const state = defaultState();
    // Merge so a partially-written store (e.g. from import) still gets defaults.
    return {
      ...state,
      ...stored,
      settings: { ...state.settings, ...(stored.settings || {}) },
    };
  }

  async function save(state) {
    await chrome.storage.local.set({
      schemaVersion: state.schemaVersion ?? SCHEMA_VERSION,
      addresses: state.addresses,
      moves: state.moves,
      pages: state.pages,
      settings: state.settings,
    });
  }

  // Load, apply a transition, save — the one pattern callers use.
  async function update(fn) {
    const state = await load();
    const result = fn(state);
    await save(state);
    return result; // whatever the transition chose to return (or undefined)
  }

  // ---- URL normalization (the pages key) -----------------------------------

  // Params that change per visit/session but not the page identity.
  const VOLATILE_PARAM = [
    /^utm_/, /^fbclid$/, /^gclid$/, /^gbraid$/, /^wbraid$/, /^msclkid$/,
    /^mc_eid$/, /^_ga$/, /^ref$/, /sessionid/i, /^sid$/i, /^phpsessid$/i,
  ];

  function normalizeUrl(raw) {
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      const params = new URLSearchParams(u.search);
      for (const key of [...params.keys()]) {
        if (VOLATILE_PARAM.some((re) => re.test(key))) params.delete(key);
      }
      params.sort();
      const query = params.toString();
      const path = u.pathname.replace(/\/+$/, '') || '/';
      return host + path + (query ? '?' + query : ''); // fragment dropped
    } catch {
      return String(raw || '');
    }
  }

  const domainOf = (key) => key.split('/')[0];

  // ---- selectors -----------------------------------------------------------

  const activeMove = (state) => state.moves.find((m) => m.status === 'in_progress') || null;
  const currentAddress = (state) => state.addresses.find((a) => a.status === 'current') || null;
  const addressById = (state, id) => state.addresses.find((a) => a.id === id) || null;

  // Is this page part of the active move? Old address was once seen here, or it
  // was added manually during this move. Ignored pages are never in scope.
  function inScope(page, move) {
    if (!move || page.ignored) return false;
    return page.everDetected.includes(move.fromAddressId) || page.moveId === move.id;
  }

  // Status is always derived (see Status Lifecycle). Precedence:
  //   1. old address on the page right now  -> needs_update (beats an override)
  //   2. explicit user override
  //   3. new address has been seen          -> done
  //   4. otherwise                          -> needs_update
  function deriveStatus(page, move) {
    if (!move || !inScope(page, move)) return 'up_to_date';
    if (page.lastDetected.includes(move.fromAddressId)) return 'needs_update';
    if (page.statusOverride) return page.statusOverride;
    if (page.everDetected.includes(move.toAddressId)) return 'done';
    return 'needs_update';
  }

  // { done, needs, total } over in-scope entries, or null with no move.
  function progress(state) {
    const move = activeMove(state);
    if (!move) return null;
    let done = 0, needs = 0;
    for (const page of Object.values(state.pages)) {
      if (!inScope(page, move)) continue;
      if (deriveStatus(page, move) === 'done') done++;
      else needs++;
    }
    return { done, needs, total: done + needs };
  }

  // ---- factories -----------------------------------------------------------

  function makeAddress(fields, status, now) {
    return {
      id: uid(),
      street: fields.street.trim(),
      suburb: fields.suburb.trim(),
      state: fields.state.trim(),
      postcode: fields.postcode.trim(),
      country: 'Australia',
      flaggedVariants: [],
      status,
      createdAt: now,
    };
  }

  function makePage(over, now) {
    return {
      kind: 'web',
      domain: '',
      url: null,
      rawUrl: null,
      title: '',
      label: '',
      everDetected: [],
      lastDetected: [],
      statusOverride: null,
      note: '',
      addedManually: false,
      moveId: null,
      ignored: false,
      firstDetected: now,
      lastVisited: now,
      statusChangedAt: now,
      ...over,
    };
  }

  // ---- transitions: addresses ----------------------------------------------

  // First-ever address (onboarding "not moving yet").
  function setInitialAddress(state, fields, now) {
    const addr = makeAddress(fields, 'current', now);
    state.addresses.push(addr);
    return addr;
  }

  function editAddress(state, id, fields) {
    const addr = addressById(state, id);
    if (!addr) return null;
    Object.assign(addr, {
      street: fields.street.trim(),
      suburb: fields.suburb.trim(),
      state: fields.state.trim(),
      postcode: fields.postcode.trim(),
    });
    return addr;
  }

  function deleteAddress(state, id) {
    state.addresses = state.addresses.filter((a) => a.id !== id);
    sweepAddressId(state, id);
  }

  // Drop a now-deleted address id from every page's detection sets.
  function sweepAddressId(state, id) {
    for (const page of Object.values(state.pages)) {
      page.everDetected = page.everDetected.filter((x) => x !== id);
      page.lastDetected = page.lastDetected.filter((x) => x !== id);
    }
  }

  function addVariant(state, id, text) {
    const addr = addressById(state, id);
    const v = AT.detect.normalize(text);
    if (!addr || !v || addr.flaggedVariants.includes(v)) return null;
    addr.flaggedVariants.push(v);
    return v;
  }

  function deleteVariant(state, id, variant) {
    const addr = addressById(state, id);
    if (addr) addr.flaggedVariants = addr.flaggedVariants.filter((v) => v !== variant);
  }

  // ---- transitions: moves --------------------------------------------------

  // Promote the new address to current, demote the old to past, open a move.
  // No bulk status write: in-scope pages derive to needs_update automatically.
  function startMove(state, newFields, now) {
    const from = currentAddress(state);
    if (!from) return null; // need a current address to move away from
    const to = makeAddress(newFields, 'current', now);
    from.status = 'past';
    state.addresses.push(to);
    const move = {
      id: uid(),
      fromAddressId: from.id,
      toAddressId: to.id,
      startedAt: now,
      completedAt: null,
      status: 'in_progress',
    };
    state.moves.push(move);
    clearOverrides(state); // clear anything stale from a prior move
    return move;
  }

  function completeMove(state, now) {
    const move = activeMove(state);
    if (!move) return null;
    move.status = 'completed';
    move.completedAt = now;
    clearOverrides(state);
    removeMoveTasks(state, move.id); // one-time to-dos don't outlive the move
    return move;
  }

  // Undo the swap and delete the address record created for the move.
  function cancelMove(state, now) {
    const move = activeMove(state);
    if (!move) return null;
    move.status = 'cancelled';
    move.completedAt = now;
    const from = addressById(state, move.fromAddressId);
    if (from) from.status = 'current';
    deleteAddress(state, move.toAddressId); // also sweeps dangling ids
    clearOverrides(state);
    removeMoveTasks(state, move.id);
    return move;
  }

  function clearOverrides(state) {
    for (const page of Object.values(state.pages)) page.statusOverride = null;
  }

  function removeMoveTasks(state, moveId) {
    for (const [key, page] of Object.entries(state.pages)) {
      if (page.kind === 'manual' && page.moveId === moveId) delete state.pages[key];
    }
  }

  // ---- transitions: pages --------------------------------------------------

  // Record a content-script scan. `matchedIds` are the addresses found now.
  // Creates a page only when something matched; ignored pages are left alone.
  function recordScan(state, { url, rawUrl, title }, matchedIds, now) {
    const key = normalizeUrl(url);
    const existing = state.pages[key];

    if (existing) {
      if (existing.ignored) return null; // not monitored
      existing.lastDetected = [...matchedIds];
      for (const id of matchedIds) {
        if (!existing.everDetected.includes(id)) existing.everDetected.push(id);
      }
      existing.lastVisited = now;
      if (title && !existing.title) existing.title = title;
      return key;
    }

    if (matchedIds.length === 0) return null; // nothing to track yet
    state.pages[key] = makePage({
      domain: domainOf(key),
      url: key,
      rawUrl: rawUrl || url,
      title: title || '',
      everDetected: [...matchedIds],
      lastDetected: [...matchedIds],
    }, now);
    return key;
  }

  // A site you remember but haven't visited. In scope if a move is active.
  function addManualSite(state, { rawUrl, title, note }, now) {
    const key = normalizeUrl(rawUrl);
    if (state.pages[key]) return key; // already tracked
    const move = activeMove(state);
    state.pages[key] = makePage({
      domain: domainOf(key),
      url: key,
      rawUrl,
      title: title || '',
      note: note || '',
      addedManually: true,
      moveId: move ? move.id : null,
    }, now);
    return key;
  }

  // An off-web task (phone call, in person, mail). Only meaningful in a move.
  function addManualTask(state, { label, note }, now) {
    const move = activeMove(state);
    if (!move) return null;
    const key = 'task:' + uid();
    state.pages[key] = makePage({
      kind: 'manual',
      label,
      note: note || '',
      addedManually: true,
      moveId: move.id,
    }, now);
    return key;
  }

  function setOverride(state, key, status, now) {
    const page = state.pages[key];
    if (!page) return;
    page.statusOverride = status; // 'needs_update' | 'done' | null
    page.statusChangedAt = now;
  }

  function setIgnored(state, key, ignored) {
    const page = state.pages[key];
    if (page) page.ignored = ignored;
  }

  // Hard delete — only for manually-added entries (detected pages would just
  // come back; those use ignore instead).
  function removePage(state, key) {
    const page = state.pages[key];
    if (page && page.addedManually) delete state.pages[key];
  }

  function setNote(state, key, note) {
    const page = state.pages[key];
    if (page) page.note = note;
  }

  return {
    KEYS, SCHEMA_VERSION, defaultState, defaultSettings,
    load, save, update,
    normalizeUrl, domainOf,
    activeMove, currentAddress, addressById, inScope, deriveStatus, progress,
    setInitialAddress, editAddress, deleteAddress, addVariant, deleteVariant,
    startMove, completeMove, cancelMove,
    recordScan, addManualSite, addManualTask, setOverride, setIgnored, removePage, setNote,
  };
})();
