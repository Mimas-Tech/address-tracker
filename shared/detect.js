// shared/detect.js — local text normalization + AU address matching.
//
// No API, no libpostal. Addresses arrive as a prepared "profile" (built by
// address.js) and are matched against a page context: visible text plus the
// values of individual form fields. The street name is the required anchor.
globalThis.AT = globalThis.AT || {};

AT.detect = (() => {
  // Lowercase, turn every run of non-alphanumerics into a single space.
  // Both stored variants and page text go through this, so punctuation,
  // commas and odd whitespace never affect a match.
  function normalize(str) {
    return String(str == null ? '' : str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Whole-word phrase containment. Both arguments must already be normalized.
  // Padding with spaces means "smith st" never matches inside "blacksmith stay".
  function containsPhrase(haystack, phrase) {
    if (!phrase) return false;
    return (' ' + haystack + ' ').includes(' ' + phrase + ' ');
  }

  // Does `postcode` appear within `window` tokens of a context word (the first
  // token of the suburb or a state form)? A lone 4-digit number proves nothing,
  // so the postcode only counts when it sits next to where it belongs.
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

  // Match one prepared address profile against a page context.
  //   ctx = { text: normalizedString, fields: [normalizedString, ...] }
  // Returns { matched, signals } where signals records which parts fired.
  function matchAddress(profile, ctx) {
    const inText = (p) => containsPhrase(ctx.text, p);
    const inField = (p) => ctx.fields.some((f) => containsPhrase(f, p));
    const anywhere = (p) => inText(p) || inField(p);

    // Fast path: a known whole-string form present verbatim is a definite hit.
    // This is also how user-flagged variants (which may have no street name,
    // e.g. a PO box) get recognized.
    const whole = profile.wholeVariants.some(anywhere);

    // Street name is the anchor. Try every abbreviated/expanded form.
    const street = profile.streetCoreForms.some(anywhere);
    if (!whole && !street) return { matched: false };

    // Street number sitting immediately before the street name ("12 smith st").
    const number = !!profile.number &&
      profile.streetCoreForms.some((core) => anywhere(profile.number + ' ' + core));

    const suburb = !!profile.suburb && anywhere(profile.suburb);
    const state = profile.stateForms.some(anywhere);

    // Postcode counts only as a discrete form-field value or next to context.
    let postcode = false;
    if (profile.postcode) {
      const asField = ctx.fields.some((f) => f === profile.postcode);
      postcode = asField ||
        postcodeHasContext(ctx.text, profile.postcode, [profile.suburb, ...profile.stateForms]);
    }

    // Anchor + at least one confirming signal. With no stored postcode this
    // degrades naturally to street + number/suburb.
    const matched = whole || (street && (postcode || number || suburb));
    return { matched, signals: { whole, street, number, postcode, suburb, state } };
  }

  // Return the ids of every profile that matches the context.
  function scan(profiles, ctx) {
    return profiles.filter((p) => matchAddress(p, ctx).matched).map((p) => p.id);
  }

  return { normalize, containsPhrase, postcodeHasContext, matchAddress, scan };
})();
