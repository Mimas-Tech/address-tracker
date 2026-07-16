// Turns structured AU address fields into a display string and the matcher's
// "profile". Generated forms live in memory; only user-flagged variants persist.
globalThis.AT = globalThis.AT || {};

AT.address = (() => {
  const { AU_STATES, STREET_TYPES, UNIT_WORDS } = AT.constants;
  const norm = AT.detect.normalize;
  const unique = (arr) => [...new Set(arr.filter(Boolean))];

  // "avenue" -> [ave, av]
  const FULL_TO_ABBRS = {};
  for (const [abbr, full] of Object.entries(STREET_TYPES)) {
    (FULL_TO_ABBRS[full] ||= []).push(abbr);
  }

  // "12 Smith St" -> ["12 smith st", "12 smith street"]. Only the LAST token is
  // treated as a street type, so a leading "St" (Saint, as in "St Kilda Rd")
  // survives untouched.
  function streetForms(street) {
    const toks = norm(street).split(' ');
    if (toks.length < 2) return unique([toks.join(' ')]);

    const last = toks[toks.length - 1];
    const base = toks.slice(0, -1).join(' ');
    let full = null;
    if (STREET_TYPES[last]) full = STREET_TYPES[last];
    else if (FULL_TO_ABBRS[last]) full = last;
    if (!full) return unique([toks.join(' ')]);

    return unique([base + ' ' + full, ...FULL_TO_ABBRS[full].map((a) => base + ' ' + a)]);
  }

  // "unit 3 12 smith st" -> "smith st"
  function stripNumber(form) {
    const toks = form.split(' ');
    let i = 0;
    while (i < toks.length && (/^\d+[a-z]?$/.test(toks[i]) || UNIT_WORDS.has(toks[i]))) i++;
    return toks.slice(i).join(' ');
  }

  // The unit number in line2 ("Unit 3" -> "3", "Apt 12B" -> "12b"); lets the
  // matcher reject sightings of a different unit at the same street number.
  function unitNumber(line2) {
    const toks = norm(line2).split(' ');
    for (let i = toks.length - 1; i >= 0; i--) {
      if (/^\d+[a-z]?$/.test(toks[i])) return toks[i];
    }
    return '';
  }

  // The last numeric token before the street name ("unit 3, 12 smith st" -> "12").
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

  // "SA" <-> "south australia"
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

  // Whole normalized address strings for the matcher's fast path; never persisted.
  function generatedVariants(address) {
    const out = [];
    const suburb = norm(address.suburb);
    const postcode = norm(address.postcode);
    // With line2 set, both the bare street and line2+street forms are hits.
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

  function format(address) {
    const streetLine = address.line2 ? `${address.line2}, ${address.street}` : address.street;
    return `${streetLine}, ${address.suburb} ${address.state} ${address.postcode}`.trim();
  }

  function buildProfile(address) {
    const flagged = (address.flaggedVariants || []).map(norm);
    return {
      id: address.id,
      streetCoreForms: unique(streetForms(address.street).map(stripNumber)),
      number: streetNumber(address.street),
      unit: unitNumber(address.line2),
      suburb: norm(address.suburb),
      stateForms: stateForms(address.state),
      postcode: norm(address.postcode),
      wholeVariants: unique([...generatedVariants(address), ...flagged]),
    };
  }

  return { format, buildProfile, generatedVariants, streetForms, stateForms, streetNumber, unitNumber };
})();
