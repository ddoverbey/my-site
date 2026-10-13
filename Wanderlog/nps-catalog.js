(function (root) {
  'use strict';

  // Legacy IDs and game biome tags are not official NPS metadata.
  const legacyParks = [
    ['acadia', 'acad', ['fo', 'co']], ['samoa', 'npsa', ['tr', 'is', 'co']],
    ['arches', 'arch', ['de']], ['badlands', 'badl', ['gr']],
    ['bigbend', 'bibe', ['de']], ['biscayne', 'bisc', ['co', 'is']],
    ['blackcanyon', 'blca', ['al']], ['bryce', 'brca', ['de', 'al']],
    ['canyonlands', 'cany', ['de']], ['capitolreef', 'care', ['de']],
    ['carlsbad', 'cave', ['ca', 'de']], ['channel', 'chis', ['is', 'ch', 'co']],
    ['congaree', 'cong', ['we', 'fo']], ['crater', 'crla', ['vo', 'al']],
    ['cuyahoga', 'cuva', ['fo']], ['deathvalley', 'deva', ['de']],
    ['denali', 'dena', ['tu', 'gl', 'al']], ['drytortugas', 'drto', ['is', 'co']],
    ['everglades', 'ever', ['we', 'tr']], ['gatesarctic', 'gaar', ['tu', 'al']],
    ['gatewayarch', 'jeff', ['ur']], ['glacier', 'glac', ['al', 'gl', 'fo']],
    ['glacierbay', 'glba', ['gl', 'co', 'rf']], ['grandcanyon', 'grca', ['de', 'fo']],
    ['grandteton', 'grte', ['al', 'fo']], ['greatbasin', 'grba', ['de', 'al']],
    ['greatsand', 'grsa', ['de', 'gr']], ['smokies', 'grsm', ['fo']],
    ['guadalupe', 'gumo', ['de']], ['haleakala', 'hale', ['vo', 'is', 'tr']],
    ['hawaiivolc', 'havo', ['vo', 'is', 'tr']], ['hotsprings', 'hosp', ['fo', 'vo']],
    ['indianadunes', 'indu', ['co', 'fo']], ['isleroyale', 'isro', ['is', 'fo']],
    ['joshuatree', 'jotr', ['de']], ['katmai', 'katm', ['vo', 'tu', 'co']],
    ['kenai', 'kefj', ['gl', 'co', 'rf']], ['kingscanyon', 'seki', ['al', 'fo']],
    ['kobuk', 'kova', ['tu', 'de']], ['lakeclark', 'lacl', ['vo', 'tu']],
    ['lassen', 'lavo', ['vo', 'al']], ['mammoth', 'maca', ['ca', 'fo']],
    ['mesaverde', 'meve', ['de', 'ch']], ['rainier', 'mora', ['gl', 'al', 'fo']],
    ['newriver', 'neri', ['fo']], ['northcascades', 'noca', ['gl', 'al', 'rf']],
    ['olympic', 'olym', ['rf', 'al', 'co']], ['petrified', 'pefo', ['de']],
    ['pinnacles', 'pinn', ['ch']], ['redwood', 'redw', ['rf', 'co']],
    ['rockymtn', 'romo', ['al', 'fo']], ['saguaro', 'sagu', ['de']],
    ['sequoia', 'seki', ['al', 'fo']], ['shenandoah', 'shen', ['fo']],
    ['roosevelt', 'thro', ['gr']], ['virginislands', 'viis', ['tr', 'is', 'co']],
    ['voyageurs', 'voya', ['we', 'fo']], ['whitesands', 'whsa', ['de']],
    ['windcave', 'wica', ['ca', 'gr']], ['wrangell', 'wrst', ['gl', 'al', 'tu']],
    ['yellowstone', 'yell', ['vo', 'al', 'fo']], ['yosemite', 'yose', ['al', 'fo']],
    ['zion', 'zion', ['de']]
  ];
  const aliases = Object.fromEntries(legacyParks.map(([id, code]) => [id, code]));
  const curatedBiomes = Object.fromEntries(legacyParks.map(([, code, biomes]) => [code, biomes]));
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
  const topicBiomes = {
    'Forests and Woodlands': 'fo', 'Grasslands': 'gr', 'Oceans': 'co',
    'Deserts': 'de', 'Mountains': 'al', 'Wetlands': 'we',
    'Islands': 'is', 'Glaciers': 'gl', 'Volcanoes': 'vo', 'Caves': 'ca', 'Tundra': 'tu'
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
        biomes: curatedBiomes[p.parkCode] ||
          [...new Set(topics.map(topic => topicBiomes[topic]).filter(Boolean))]
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
