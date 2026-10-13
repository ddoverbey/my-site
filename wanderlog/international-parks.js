(function (root) {
  'use strict';
  const parks = [
    { id: 'banff', name: 'Banff', lat: 51.5, lng: -116.15, country: 'Canada', intl: true, desc: 'Glacial lakes of the Canadian Rockies' },
    { id: 'torres', name: 'Torres del Paine', lat: -51.0, lng: -73.0, country: 'Chile', intl: true, desc: 'Patagonian granite horns and ice sheets' },
    { id: 'serengeti', name: 'Serengeti', lat: -2.33, lng: 34.83, country: 'Tanzania', intl: true, desc: 'The great wildebeest migration plains' },
    { id: 'galapagos', name: 'Galápagos', lat: -0.67, lng: -90.55, country: 'Ecuador', intl: true, desc: 'Volcanic sanctuary of evolutionary wonder' },
    { id: 'iguazu', name: 'Iguazú Falls', lat: -25.69, lng: -54.44, country: 'Argentina', intl: true, desc: 'Curtain of 275 waterfalls in subtropical jungle' },
    { id: 'fiordland', name: 'Fiordland', lat: -45.4, lng: 167.7, country: 'New Zealand', intl: true, desc: 'Mitre peak towering over Milford Sound' },
    { id: 'plitvice', name: 'Plitvice Lakes', lat: 44.88, lng: 15.62, country: 'Croatia', intl: true, desc: 'Cascading terraced turquoise lakes' },
    { id: 'thingvellir', name: 'Þingvellir / Iceland', lat: 64.26, lng: -21.12, country: 'Iceland', intl: true, desc: 'Tectonic rift valley where continental plates split' },
    { id: 'halong', name: 'Hạ Long Bay', lat: 20.91, lng: 107.18, country: 'Vietnam', intl: true, desc: 'Emerald waters and thousands of limestone pillars' },
    { id: 'kruger', name: 'Kruger', lat: -23.99, lng: 31.55, country: 'South Africa', intl: true, desc: 'Expansive African bushveld wildlife reserve' },
    { id: 'uluru', name: 'Uluṟu-Kata Tjuṯa', lat: -25.34, lng: 131.04, country: 'Australia', intl: true, desc: 'Red heart monolith of the Australian Outback' },
    { id: 'jungfrau', name: 'Swiss Alps / Jungfrau-Aletsch', lat: 46.54, lng: 7.96, country: 'Switzerland', intl: true, desc: 'Glaciated backbone of the high European Alps' }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = parks;
  else root.InternationalParks = parks;
})(typeof globalThis !== 'undefined' ? globalThis : this);
