// Local AU address matching: profiles (from address.js) vs a page context of
// visible text + form-field values. The street name — and the street number,
// when the address has one — is the required anchor.
globalThis.AT = globalThis.AT || {};

AT.detect = (() => {
  // Both stored variants and page text pass through this, so punctuation and
  // whitespace never affect a match.
  function normalize(str) {
    return String(str == null ? '' : str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Whole-word containment: padding with spaces stops "smith st" matching
  // inside "blacksmith stay". Both arguments must already be normalized.
  function containsPhrase(haystack, phrase) {
    if (!phrase) return false;
    return (' ' + haystack + ' ').includes(' ' + phrase + ' ');
  }

  // containsPhrase, minus occurrences claimed by a different unit: with unit 1,
  // "2 108 north tce" ("Unit 2" / "2/108") is someone else's address, while
  // "1 108 north tce" and a bare "108 north tce" still count.
  function containsOwnPhrase(haystack, phrase, unit) {
    if (!phrase) return false;
    if (!unit) return containsPhrase(haystack, phrase);
    const toks = haystack.split(' ');
    const want = phrase.split(' ');
    outer:
    for (let i = 0; i + want.length <= toks.length; i++) {
      for (let j = 0; j < want.length; j++) {
        if (toks[i + j] !== want[j]) continue outer;
      }
      const prev = i > 0 ? toks[i - 1] : '';
      if (prev && /^\d+[a-z]?$/.test(prev) && prev !== unit) continue;
      return true;
    }
    return false;
  }

  // A lone 4-digit number proves nothing: the postcode only counts when it
  // sits within a few tokens of the suburb or a state form.
  function postcodeHasContext(text, postcode, contextPhrases, window = 4) {
    const toks = text.split(' ');
    const anchors = contextPhrases.filter(Boolean).map((p) => p.split(' ')[0]);
    if (anchors.length === 0) return false;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i] !== postcode) continue;
      const near = toks.slice(Math.max(0, i - window), i + window + 1);
      if (anchors.some((a) => near.includes(a))) return true;
    }
    return false;
  }

  // ctx = { text: normalizedString, fields: [normalizedString, ...] }
  function matchAddress(profile, ctx) {
    const inText = (p) => containsPhrase(ctx.text, p);
    const inField = (p) => ctx.fields.some((f) => containsPhrase(f, p));
    const anywhere = (p) => inText(p) || inField(p);
    // For phrases that begin with the street number, apply the unit guard.
    const anywhereOwn = (p) => containsOwnPhrase(ctx.text, p, profile.unit) ||
      ctx.fields.some((f) => containsOwnPhrase(f, p, profile.unit));

    // Whole-string fast path — also how user-flagged variants with no street
    // name (e.g. a PO box) get recognized.
    const whole = profile.wholeVariants.some((v) =>
      profile.number && v.split(' ')[0] === profile.number ? anywhereOwn(v) : anywhere(v));

    const street = profile.streetCoreForms.some(anywhere);
    if (!whole && !street) return { matched: false };

    const number = !!profile.number &&
      profile.streetCoreForms.some((core) => anywhereOwn(profile.number + ' ' + core));

    const suburb = !!profile.suburb && anywhere(profile.suburb);
    const state = profile.stateForms.some(anywhere);

    // Postcode counts only as a whole form-field value or next to context.
    let postcode = false;
    if (profile.postcode) {
      const asField = ctx.fields.some((f) => f === profile.postcode);
      postcode = asField ||
        postcodeHasContext(ctx.text, profile.postcode, [profile.suburb, ...profile.stateForms]);
    }

    // The street number, when known, is required — suburb and postcode confirm
    // locality but can't substitute for it (neighbours share both).
    const matched = whole ||
      (street && (postcode || suburb) && (!profile.number || number));
    return { matched, signals: { whole, street, number, postcode, suburb, state } };
  }

  function scan(profiles, ctx) {
    return profiles.filter((p) => matchAddress(p, ctx).matched).map((p) => p.id);
  }

  return { normalize, containsPhrase, containsOwnPhrase, postcodeHasContext, matchAddress, scan };
})();
