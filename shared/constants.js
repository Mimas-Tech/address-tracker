// AU reference data. Classic script (no ES modules) so the same file loads in
// content scripts, extension pages, and the service worker via the AT global.
globalThis.AT = globalThis.AT || {};

AT.constants = (() => {
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

  // Abbreviation -> full word; several abbreviations may share one full word.
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

  // Skipped when finding the street-name anchor: "Unit 3, 12 Smith St".
  const UNIT_WORDS = new Set(['unit', 'apt', 'apartment', 'flat', 'level', 'lvl', 'suite', 'ste']);

  const POSTCODE_RE = /^\d{4}$/;

  return { AU_STATES, STREET_TYPES, UNIT_WORDS, POSTCODE_RE };
})();
