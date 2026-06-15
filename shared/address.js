// shared/address.js — structured AU address handling.
//
// Turns the stored {street, suburb, state, postcode} fields into:
//   - a readable canonical string (for display), and
//   - a normalized "profile" the matcher consumes.
// Auto-generated forms live only in memory; only user-flagged variants persist.
globalThis.AT = globalThis.AT || {};

AT.address = (() => {
  const { AU_STATES, STREET_TYPES, UNIT_WORDS } = AT.constants;
  const norm = AT.detect.normalize;
  const unique = (arr) => [...new Set(arr.filter(Boolean))];

  // full word -> every abbreviation that expands to it ("avenue" -> [ave, av]).
  const FULL_TO_ABBRS = {};
  for (const [abbr, full] of Object.entries(STREET_TYPES)) {
    (FULL_TO_ABBRS[full] ||= []).push(abbr);
  }

  // All written forms of a street line, differing only in the street-type word:
  //   "12 Smith St" -> ["12 smith st", "12 smith street"]
  // Leading "St" (Saint, as in "St Kilda Rd") is the first token, never the
  // last, so it is left untouched.
  function streetForms(street) {
    const toks = norm(street).split(' ');
    if (toks.length < 2) return unique([toks.join(' ')]);

    const last = toks[toks.length - 1];
    const base = toks.slice(0, -1).join(' ');
    let full = null;
    if (STREET_TYPES[last]) full = STREET_TYPES[last];        // last token is an abbreviation
    else if (FULL_TO_ABBRS[last]) full = last;                 // last token is already the full word
    if (!full) return unique([toks.join(' ')]);

    return unique([base + ' ' + full, ...FULL_TO_ABBRS[full].map((a) => base + ' ' + a)]);
  }

  // Drop the leading unit/number prefix to get the street-name anchor:
  //   "unit 3 12 smith st" -> "smith st"
  function stripNumber(form) {
    const toks = form.split(' ');
    let i = 0;
    while (i < toks.length && (/^\d+[a-z]?$/.test(toks[i]) || UNIT_WORDS.has(toks[i]))) i++;
    return toks.slice(i).join(' ');
  }

  // The primary street number — the last numeric token before the street name.
  function streetNumber(street) {
    const toks = norm(street).split(' ');
    let num = '';
    for (const t of toks) {
      if (/^\d+[a-z]?$/.test(t)) num = t;
      else if (UNIT_WORDS.has(t)) continue;
      else break;
    }
    return num;
  }

  // Both written forms of a state: code and full name ("SA" <-> "south australia").
  function stateForms(state) {
    const n = norm(state);
    const forms = new Set([n].filter(Boolean));
    for (const [full, code] of Object.entries(AU_STATES)) {
      if (n === full || n === norm(code)) {
        forms.add(full);
        forms.add(norm(code));
      }
    }
    return [...forms];
  }

  // Whole normalized address strings, every street/state form combined. Used as
  // the matcher's fast path; never persisted.
  function generatedVariants(address) {
    const out = [];
    const suburb = norm(address.suburb);
    const postcode = norm(address.postcode);
    // Generate variants for both the bare street and (when line2 present) line2+street combined,
    // so "Unit 3 12 Smith St Adelaide SA 5000" is a fast-path hit in addition to the bare form.
    const streetInputs = [address.street];
    if (address.line2 && address.line2.trim()) {
      streetInputs.push(address.line2.trim() + ' ' + address.street);
    }
    for (const streetVal of streetInputs) {
      for (const s of streetForms(streetVal)) {
        for (const st of stateForms(address.state)) {
          out.push([s, suburb, st, postcode].filter(Boolean).join(' '));
        }
      }
    }
    return unique(out);
  }

  // Readable canonical form for display.
  function format(address) {
    const streetLine = address.line2 ? `${address.line2}, ${address.street}` : address.street;
    return `${streetLine}, ${address.suburb} ${address.state} ${address.postcode}`.trim();
  }

  // The matcher's input. Combines generated forms with persisted user variants.
  function buildProfile(address) {
    const flagged = (address.flaggedVariants || []).map(norm);
    return {
      id: address.id,
      streetCoreForms: unique(streetForms(address.street).map(stripNumber)),
      number: streetNumber(address.street),
      suburb: norm(address.suburb),
      stateForms: stateForms(address.state),
      postcode: norm(address.postcode),
      wholeVariants: unique([...generatedVariants(address), ...flagged]),
    };
  }

  return { format, buildProfile, generatedVariants, streetForms, stateForms, streetNumber };
})();
