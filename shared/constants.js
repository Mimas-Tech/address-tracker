// shared/constants.js — AU-specific reference data for the matcher.
//
// Classic script (no ES modules) so the same file loads in content scripts,
// extension pages, and the service worker. Everything hangs off a single
// global `AT` namespace.
globalThis.AT = globalThis.AT || {};

AT.constants = (() => {
  // Full state/territory name -> canonical code.
  const AU_STATES = {
    'new south wales': 'NSW',
    'victoria': 'VIC',
    'queensland': 'QLD',
    'south australia': 'SA',
    'western australia': 'WA',
    'tasmania': 'TAS',
    'northern territory': 'NT',
    'australian capital territory': 'ACT',
  };

  // Street-type abbreviation -> full word. Several abbreviations may share a
  // full word (e.g. av/ave -> avenue); address.js generates every form.
  const STREET_TYPES = {
    st: 'street',
    rd: 'road',
    ave: 'avenue',
    av: 'avenue',
    ct: 'court',
    cres: 'crescent',
    cr: 'crescent',
    dr: 'drive',
    drv: 'drive',
    pl: 'place',
    ln: 'lane',
    tce: 'terrace',
    hwy: 'highway',
    pde: 'parade',
    cl: 'close',
    blvd: 'boulevard',
    bvd: 'boulevard',
    gr: 'grove',
    cct: 'circuit',
  };

  // Words that precede a street number and should be skipped when finding the
  // street name anchor: "Unit 3, 12 Smith St", "Level 2, 12 Smith St".
  const UNIT_WORDS = new Set(['unit', 'apt', 'apartment', 'flat', 'level', 'lvl', 'suite', 'ste']);

  const POSTCODE_RE = /^\d{4}$/;

  return { AU_STATES, STREET_TYPES, UNIT_WORDS, POSTCODE_RE };
})();
