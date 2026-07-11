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
ok('drops all query params', n('https://x.com/a?utm_source=g&account=2') === 'x.com/a');
ok('same page regardless of params', n('https://x.com/a?b=2') === n('https://x.com/a?session=xyz'));

console.log('\nIgnore rules');
const r = storage.normalizeRule;
ok('rule strips scheme, www, trailing slash', r('https://www.Google.com/Maps/') === 'google.com/maps');
ok('domain rule matches its pages', storage.ruleMatches('google.com', 'google.com/maps/place'));
ok('domain rule matches bare domain', storage.ruleMatches('google.com', 'google.com'));
ok('domain rule does not swallow longer TLD', !storage.ruleMatches('google.com', 'google.com.au/maps'));
ok('prefix rule matches startswith', storage.ruleMatches('google.com/map', 'google.com/maps/place'));
ok('prefix rule rejects other paths', !storage.ruleMatches('google.com/map', 'google.com/search'));
ok('rule matching is case-insensitive on key', storage.ruleMatches('x.com/profile', 'x.com/Profile'));

{
  const st = storage.defaultState();
  storage.setInitialAddress(st, SMITH, 1000);
  const cur2 = storage.currentAddress(st);
  storage.recordScan(st, { url: 'https://google.com/maps/place/x', title: 'Maps' }, [cur2.id], 1000);
  storage.recordScan(st, { url: 'https://news.com.au/story', title: 'News' }, [cur2.id], 1000);
  storage.addIgnoreRule(st, 'google.com/maps', true);
  ok('applyToExisting flags matching pages', st.pages['google.com/maps/place/x'].ignored === true);
  ok('non-matching pages untouched', st.pages['news.com.au/story'].ignored === false);
  const res = storage.recordScan(st, { url: 'https://google.com/maps/place/y', title: 'Maps' }, [cur2.id], 2000);
  ok('rule-ignored scan records nothing', res === null && !st.pages['google.com/maps/place/y']);
  ok('rule is ignored for matching key', storage.isRuleIgnored(st, 'google.com/maps/anything'));
  storage.removeIgnoreRule(st, 'google.com/maps');
  ok('rule removed', !storage.isRuleIgnored(st, 'google.com/maps/anything'));
  ok('removing rule does not un-hide pages', st.pages['google.com/maps/place/x'].ignored === true);
}

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

console.log('\nScan decision (confirm-first detection)');
{
  const st = storage.defaultState();
  storage.setInitialAddress(st, SMITH, 1000);
  const cur = storage.currentAddress(st);
  const k = storage.normalizeUrl('https://bank.com.au/profile');
  ok('new site with match -> prompt', storage.scanDecision(st, k, [cur.id]) === 'prompt');
  ok('no match on unknown page -> skip', storage.scanDecision(st, k, []) === 'skip');
  st.settings.confirmDetections = false;
  ok('confirmation off -> record', storage.scanDecision(st, k, [cur.id]) === 'record');
  st.settings.confirmDetections = true;
  storage.recordScan(st, { url: 'https://bank.com.au/profile', title: 'Bank' }, [cur.id], 1000);
  ok('already-tracked page -> record', storage.scanDecision(st, k, [cur.id]) === 'record');
  storage.setIgnored(st, k, true);
  ok('ignored page -> skip', storage.scanDecision(st, k, [cur.id]) === 'skip');
  storage.addIgnoreRule(st, 'news.com.au', false);
  ok('rule-excluded page -> skip',
    storage.scanDecision(st, storage.normalizeUrl('https://news.com.au/story'), [cur.id]) === 'skip');
  const mv = storage.startMove(st, NEW, 2000);
  const k2 = storage.normalizeUrl('https://ato.gov.au/details');
  ok('old address during move -> record (never prompted away)',
    storage.scanDecision(st, k2, [mv.fromAddressId]) === 'record');
  ok('new address during move on unknown page -> prompt',
    storage.scanDecision(st, k2, [mv.toAddressId]) === 'prompt');
  const ik = storage.ignorePage(st, { url: 'https://maps.google.com/place/1', title: 'Maps' }, 3000);
  ok('ignorePage creates a flagged entry', !!st.pages[ik] && st.pages[ik].ignored === true);
  ok('ignorePage key skipped afterwards', storage.scanDecision(st, ik, [mv.toAddressId]) === 'skip');
}

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
