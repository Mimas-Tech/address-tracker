// Smoke test for the engine (shared/*). Run: node test/engine.test.js
// The shared files are classic scripts that attach to globalThis.AT, so we
// just require them in load order and exercise the namespace.
require('../shared/constants.js');
require('../shared/detect.js');
require('../shared/address.js');
require('../shared/storage.js');

const { detect, address, storage } = AT;

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

// A page context: visible text + discrete form-field values, both normalized.
const ctx = (text, fields = []) => ({
  text: detect.normalize(text),
  fields: (fields || []).map(detect.normalize),
});

const SMITH = { id: 'a1', street: '12 Smith St', suburb: 'Adelaide', state: 'SA', postcode: '5000', flaggedVariants: [] };
const SMITH_UNIT = { id: 'a4', line2: 'Unit 3', street: '12 Smith St', suburb: 'Adelaide', state: 'SA', postcode: '5000', flaggedVariants: [] };
const profile = address.buildProfile(SMITH);
const unitProfile = address.buildProfile(SMITH_UNIT);

console.log('\nMatching');
ok('full address in free text', detect.matchAddress(profile, ctx('Ship to 12 Smith Street, Adelaide SA 5000.')).matched);
ok('expanded street + full state', detect.matchAddress(profile, ctx('12 Smith Street, Adelaide South Australia 5000')).matched);
ok('split form fields', detect.matchAddress(profile, ctx('Account details', ['12 Smith St', 'Adelaide', 'SA', '5000'])).matched);
ok('unit change still anchors', detect.matchAddress(profile, ctx('Unit 3, 12 Smith St, Adelaide SA 5000')).matched);
ok('street + suburb, no postcode', detect.matchAddress(profile, ctx('Smith Street Adelaide branch, 12 in stock')).matched);

ok('lone postcode, no street -> no match', !detect.matchAddress(profile, ctx('Win 5000 dollars today!')).matched);

// line2 (unit/apt) field
ok('line2 + street in free text', detect.matchAddress(unitProfile, ctx('Unit 3, 12 Smith Street, Adelaide SA 5000')).matched);
ok('street only still matches when line2 set', detect.matchAddress(unitProfile, ctx('12 Smith St Adelaide SA 5000')).matched);
ok('line2 in separate form field', detect.matchAddress(unitProfile, ctx('Account details', ['Unit 3', '12 Smith St', 'Adelaide', 'SA', '5000'])).matched);
ok('format includes line2', address.format(SMITH_UNIT) === 'Unit 3, 12 Smith St, Adelaide SA 5000');
ok('format without line2 unchanged', address.format(SMITH) === '12 Smith St, Adelaide SA 5000');
ok('street name alone is not enough', !detect.matchAddress(profile, ctx('the smith street band plays tonight')).matched);
ok('postcode far from context is ignored', !detect.matchAddress(profile, ctx('smith street is lovely. unrelated 5000 here.')).matched);
ok('unrelated page', !detect.matchAddress(profile, ctx('Today in tech news, nothing relevant.')).matched);

// "St Kilda Rd" — leading St means Saint and must survive normalization.
const KILDA = { id: 'a2', street: '10 St Kilda Rd', suburb: 'Melbourne', state: 'VIC', postcode: '3004', flaggedVariants: [] };
const kProfile = address.buildProfile(KILDA);
ok('Saint-prefixed street matches', detect.matchAddress(kProfile, ctx('10 St Kilda Road, Melbourne VIC 3004')).matched);
ok('St Kilda core has no leading number stripped wrong', kProfile.streetCoreForms.includes('st kilda road'));

// Flagged variant (e.g. a PO box) with no street name.
const PO = { id: 'a3', street: '5 King St', suburb: 'Perth', state: 'WA', postcode: '6000', flaggedVariants: ['PO Box 99, Perth WA 6000'] };
const poProfile = address.buildProfile(PO);
ok('flagged variant matches verbatim', detect.matchAddress(poProfile, ctx('Mail to PO Box 99 Perth WA 6000')).matched);

console.log('\nProfile generation');
ok('state expands to both forms', address.stateForms('SA').includes('south australia') && address.stateForms('SA').includes('sa'));
ok('street number extracted', profile.number === '12');
ok('street core has both type forms', profile.streetCoreForms.includes('smith st') && profile.streetCoreForms.includes('smith street'));

console.log('\nURL normalization');
const n = storage.normalizeUrl;
ok('strips www, trailing slash, fragment', n('https://www.ato.gov.au/your-details/#tab') === 'ato.gov.au/your-details');
ok('drops volatile params, keeps real ones', n('https://x.com/a?utm_source=g&account=2') === 'x.com/a?account=2');
ok('sorts params for stability', n('https://x.com/a?b=2&a=1') === n('https://x.com/a?a=1&b=2'));

console.log('\nMove lifecycle');
const now = 1000;
const state = storage.defaultState();
const cur = storage.setInitialAddress(state, SMITH, now);
ok('initial address is current', storage.currentAddress(state).id === cur.id);

// Browse: a site shows the current address.
storage.recordScan(state, { url: 'https://commbank.com.au/profile', title: 'Profile' }, [cur.id], now);
const key = storage.normalizeUrl('https://commbank.com.au/profile');
ok('scan created a tracked page', !!state.pages[key]);
ok('no move -> page is up_to_date', storage.deriveStatus(state.pages[key], storage.activeMove(state)) === 'up_to_date');

// Start a move to a new address.
const NEW = { street: '14 Jones Ave', suburb: 'Adelaide', state: 'SA', postcode: '5001' };
const move = storage.startMove(state, NEW, now + 1);
ok('old address demoted to past', storage.addressById(state, cur.id).status === 'past');
ok('page in scope (held old address)', storage.inScope(state.pages[key], move));
ok('old address still on page -> needs_update', storage.deriveStatus(state.pages[key], move) === 'needs_update');

// Manual site + task added during the move.
const mSite = storage.addManualSite(state, { rawUrl: 'https://energyco.com.au/account', title: 'Energy' }, now + 2);
ok('manual site scoped to move via moveId', storage.inScope(state.pages[mSite], move));
const mTask = storage.addManualTask(state, { label: 'Call insurer' }, now + 2);
ok('manual task created', !!state.pages[mTask]);

// Revisit after updating: old gone, new address now present.
storage.recordScan(state, { url: 'https://commbank.com.au/profile' }, [move.toAddressId], now + 3);
ok('old gone + new seen -> done', storage.deriveStatus(state.pages[key], move) === 'done');

const p = storage.progress(state);
ok('progress counts in-scope only', p.total === 3 && p.done === 1 && p.needs === 2);

// Complete the move: tasks removed, web entries persist, no current/past flip.
storage.completeMove(state, now + 4);
ok('manual task removed on complete', !state.pages[mTask]);
ok('manual site persists', !!state.pages[mSite]);
ok('no active move after complete', storage.activeMove(state) === null);
ok('new address is current', storage.currentAddress(state).id === move.toAddressId);

// Cancel path on a fresh move.
const state2 = storage.defaultState();
storage.setInitialAddress(state2, SMITH, now);
const move2 = storage.startMove(state2, NEW, now + 1);
const newId = move2.toAddressId;
storage.cancelMove(state2, now + 2);
ok('cancel reverts to old current', storage.currentAddress(state2).street === '12 Smith St');
ok('cancel deletes the new address', !storage.addressById(state2, newId));

// ---- update() writes only changed keys (the anti-loop guarantee) ----------
// content.js must never see a `pages`-only scan as an addresses/moves/settings
// change, or it would re-scan forever. That holds because update() writes just
// the keys that changed. Verify with a minimal chrome.storage.local mock.
console.log('\nGranular writes (loop prevention)');
(function () {
  const store = {};
  let lastSet = null;
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) { const o = {}; for (const k of keys) if (k in store) o[k] = store[k]; return o; },
        async set(obj) { lastSet = Object.keys(obj).sort(); Object.assign(store, structuredClone(obj)); },
      },
    },
  };
  return (async () => {
    lastSet = null;
    await storage.update((s) => storage.setInitialAddress(s, SMITH, 1000));
    ok('first write includes addresses, not pages', lastSet.includes('addresses') && !lastSet.includes('pages'));

    lastSet = null;
    await storage.update(() => { /* no-op */ });
    ok('no-op transition writes nothing', lastSet === null);

    lastSet = null;
    await storage.update((s) => storage.recordScan(s, { url: 'https://x.com/a' }, [], 1000));
    ok('empty scan on unknown page writes nothing', lastSet === null);

    lastSet = null;
    await storage.update((s) => storage.recordScan(s, { url: 'https://x.com/a', title: 'A' }, ['zzz'], 1000));
    ok('scan writes pages only, never addresses', lastSet.includes('pages') && !lastSet.includes('addresses'));

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
  })();
})();
