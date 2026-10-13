(function (root) {
  'use strict';

  const aliases = {
    acadia: 'acad', samoa: 'npsa', arches: 'arch', badlands: 'badl', bigbend: 'bibe',
    biscayne: 'bisc', blackcanyon: 'blca', bryce: 'brca', canyonlands: 'cany', capitolreef: 'care',
    carlsbad: 'cave', channel: 'chis', congaree: 'cong', crater: 'crla', cuyahoga: 'cuva',
    deathvalley: 'deva', denali: 'dena', drytortugas: 'drto', everglades: 'ever', gatesarctic: 'gaar',
    gatewayarch: 'jeff', glacier: 'glac', glacierbay: 'glba', grandcanyon: 'grca', grandteton: 'grte',
    greatbasin: 'grba', greatsand: 'grsa', smokies: 'grsm', guadalupe: 'gumo', haleakala: 'hale',
    hawaiivolc: 'havo', hotsprings: 'hosp', indianadunes: 'indu', isleroyale: 'isro', joshuatree: 'jotr',
    katmai: 'katm', kenai: 'kefj', kingscanyon: 'seki', kobuk: 'kova', lakeclark: 'lacl',
    lassen: 'lavo', mammoth: 'maca', mesaverde: 'meve', rainier: 'mora', newriver: 'neri',
    northcascades: 'noca', olympic: 'olym', petrified: 'pefo', pinnacles: 'pinn', redwood: 'redw',
    rockymtn: 'romo', saguaro: 'sagu', sequoia: 'seki', shenandoah: 'shen', roosevelt: 'thro',
    virginislands: 'viis', voyageurs: 'voya', whitesands: 'whsa', windcave: 'wica', wrangell: 'wrst',
    yellowstone: 'yell', yosemite: 'yose', zion: 'zion'
  };
  const stateNames = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
    KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
    MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
    MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
    NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
    ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
    RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
    TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
    WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
    AS: 'American Samoa', GU: 'Guam', MP: 'Northern Mariana Islands',
    PR: 'Puerto Rico', VI: 'Virgin Islands'
  };
  const usStates = new Set(Object.entries(stateNames)
    .filter(([code]) => !['DC', 'AS', 'GU', 'MP', 'PR', 'VI'].includes(code))
    .map(([, name]) => name));

  function migratePins(pins) {
    const migrated = {};
    for (const [id, status] of Object.entries(pins)) {
      const code = aliases[id] || id;
      // Combined NPS units retain a visit if either legacy park was visited.
      if (migrated[code] !== 'v') migrated[code] = status;
    }
    return migrated;
  }

  function normalizeParks(records) {
    if (!Array.isArray(records) || records.length < 400) {
      throw new Error('Expected the complete NPS catalog (400+ records).');
    }
    const codes = new Set();
    return records.map(p => {
      if (!p || !/^[a-z0-9]{4}$/.test(p.parkCode) || codes.has(p.parkCode) ||
          typeof p.fullName !== 'string' || !p.fullName.trim() ||
          typeof p.designation !== 'string' || typeof p.description !== 'string' ||
          typeof p.states !== 'string' || !/^https:\/\/www\.nps\.gov\//.test(p.url) ||
          !Array.isArray(p.topics) || !Array.isArray(p.activities) ||
          !p.topics.every(t => t && typeof t.name === 'string') ||
          !p.activities.every(a => a && typeof a.name === 'string')) {
        throw new Error('Invalid or duplicate NPS park record.');
      }
      codes.add(p.parkCode);
      const stateCodes = p.states.split(',').map(s => s.trim()).filter(Boolean);
      if (stateCodes.some(code => !stateNames[code])) {
        throw new Error(`Unknown state code for ${p.parkCode}.`);
      }
      const coordinate = (value, limit) => {
        if (value === '' || value === null || value === undefined) return null;
        const number = Number(value);
        if (!Number.isFinite(number) || Math.abs(number) > limit) {
          throw new Error(`Invalid coordinates for ${p.parkCode}.`);
        }
        return number;
      };
      const lat = coordinate(p.latitude, 90);
      const lng = coordinate(p.longitude, 180);
      const topics = p.topics.map(t => t.name);
      return {
        id: p.parkCode, npsId: p.id, name: p.fullName, designation: p.designation,
        desc: p.description, url: p.url, lat, lng,
        states: stateCodes.map(code => stateNames[code]),
        state: stateCodes.map(code => stateNames[code]).join(', '),
        topics, activities: p.activities.map(a => a.name),
        biomes: [], ecoregions: [], biomeStatus: 'unavailable'
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  const catalog = { aliases, migratePins, normalizeParks, escapeHtml, isUsState: name => usStates.has(name) };
  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
  else root.NpsCatalog = catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this);
