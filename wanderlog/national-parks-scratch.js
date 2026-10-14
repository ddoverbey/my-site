(function (root) {
  'use strict';

  const regions = [
    { id: 'northeast', name: 'Northeast', states: ['Maine', 'New Hampshire', 'Vermont', 'Massachusetts', 'Rhode Island', 'Connecticut', 'New York', 'New Jersey', 'Pennsylvania', 'Delaware', 'Maryland', 'Virginia', 'West Virginia'] },
    { id: 'southeast', name: 'Southeast', states: ['Kentucky', 'Tennessee', 'North Carolina', 'South Carolina', 'Georgia', 'Alabama', 'Mississippi', 'Florida', 'Virgin Islands', 'Puerto Rico'] },
    { id: 'midwest', name: 'Midwest', states: ['Ohio', 'Indiana', 'Illinois', 'Michigan', 'Wisconsin', 'Minnesota', 'Iowa', 'Missouri', 'Arkansas', 'Kansas', 'Nebraska', 'North Dakota', 'South Dakota'] },
    { id: 'intermountain', name: 'Intermountain', states: ['Montana', 'Wyoming', 'Utah', 'Colorado', 'Arizona', 'New Mexico', 'Oklahoma', 'Texas'] },
    { id: 'pacific-west', name: 'Pacific West', states: ['Washington', 'Oregon', 'California', 'Nevada', 'Idaho'] },
    { id: 'alaska', name: 'Alaska', states: ['Alaska'] },
    { id: 'pacific-islands', name: 'Pacific Islands', states: ['Hawaii', 'American Samoa', 'Guam', 'Northern Mariana Islands'] }
  ];

  function parks(catalog) {
    return catalog.filter(park => !park.intl &&
      (['National Park', 'National Park & Preserve', 'National Parks'].includes(park.designation) ||
        ['npsa', 'redw'].includes(park.id))).flatMap(park => park.id === 'seki' ? [
      { ...park, id: 'sequ', ledgerId: 'seki', name: 'Sequoia National Park' },
      { ...park, id: 'kica', ledgerId: 'seki', name: 'Kings Canyon National Park' }
    ] : [{ ...park, ledgerId: park.id }]).map(park => {
      const region = park.id === 'yell' ? regions.find(region => region.id === 'intermountain') :
        regions.find(region => region.states.includes(park.states[0]));
      if (!region) throw new Error(`National park region unavailable: ${park.name}`);
      return { ...park, regionId: region.id };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function status(park, state) {
    const ledger = state.pins[park.ledgerId];
    if (ledger === 'l' || state.expeditions.some(trip => trip.parkIds.includes(park.ledgerId))) return 'v';
    const value = park.ledgerId === 'seki' ? state.nationalParkScratch?.[park.id] ?? ledger : ledger;
    return value === 'v' || value === 'l' ? 'v' : value === 'w' ? 'w' : 'un';
  }

  function progress(parks, state) {
    return regions.map(region => {
      const members = parks.filter(park => park.regionId === region.id);
      const visited = members.filter(park => status(park, state) === 'v').length;
      return { ...region, total: members.length, visited,
        tier: members.length && visited === members.length ? 'mastered' : visited ? 'progress' : 'unstarted' };
    });
  }

  const api = { regions, parks, status, progress };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NationalParksScratch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
