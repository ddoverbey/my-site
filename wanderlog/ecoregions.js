(function (root) {
  'use strict';

  const SOURCE = 'https://storage.googleapis.com/teow2016/Ecoregions2017.zip';
  const names = [
    'Tropical & Subtropical Moist Broadleaf Forests',
    'Tropical & Subtropical Dry Broadleaf Forests',
    'Tropical & Subtropical Coniferous Forests',
    'Temperate Broadleaf & Mixed Forests',
    'Temperate Conifer Forests', 'Boreal Forests/Taiga',
    'Tropical & Subtropical Grasslands, Savannas & Shrublands',
    'Temperate Grasslands, Savannas & Shrublands',
    'Flooded Grasslands & Savannas', 'Montane Grasslands & Shrublands',
    'Tundra', 'Mediterranean Forests, Woodlands & Scrub',
    'Deserts & Xeric Shrublands', 'Mangroves'
  ];
  const colors = ['#22c55e', '#a3e635', '#16a34a', '#10b981', '#059669', '#0d9488',
    '#eab308', '#84cc16', '#14b8a6', '#06b6d4', '#c084fc', '#d97706', '#f59e0b', '#38bdf8'];
  const icons = ['🌴', '🌳', '🌲', '🌳', '🌲', '🌲', '🌾', '🌾', '🐊', '⛰️', '❄️', '🌿', '🏜️', '🌱'];

  function rarityForShare(share) {
    if (!Number.isFinite(share) || share < 0 || share > 100) {
      throw new Error('Biome area share must be between 0 and 100 percent.');
    }
    return share < 2 ? 'rare' : share < 10 ? 'uncommon' : 'common';
  }

  function biomeDefinitions() {
    return Object.fromEntries(names.map((name, index) => [String(index + 1), {
      name, color: colors[index], icon: icons[index], rarity: 'unavailable', xp: 0, areaShare: null
    }]));
  }

  function validateSnapshot(snapshot) {
    if (!snapshot || snapshot.source !== SOURCE || snapshot.version !== 1 ||
        snapshot.license !== 'CC-BY-4.0' || !Number.isFinite(Date.parse(snapshot.generatedAt)) ||
        !Array.isArray(snapshot.biomes) || snapshot.biomes.length !== 14 ||
        !Number.isInteger(snapshot.ecoregionCount) || snapshot.ecoregionCount < 800 ||
        !snapshot.locations || typeof snapshot.locations !== 'object' || Array.isArray(snapshot.locations)) {
      throw new Error('Invalid RESOLVE ecoregion snapshot.');
    }
    const ids = new Set();
    let shareTotal = 0;
    for (const biome of snapshot.biomes) {
      if (!Number.isInteger(biome.id) || biome.id < 1 || biome.id > 14 || ids.has(biome.id) ||
          biome.name !== names[biome.id - 1] || !Number.isFinite(biome.areaKm2) || biome.areaKm2 <= 0 ||
          !Number.isFinite(biome.areaShare) || biome.areaShare <= 0 ||
          biome.rarity !== rarityForShare(biome.areaShare)) {
        throw new Error('Invalid RESOLVE biome areas or rarity.');
      }
      ids.add(biome.id);
      shareTotal += biome.areaShare;
    }
    if (Math.abs(shareTotal - 100) > 0.001) throw new Error('Biome area shares must sum to 100 percent.');
    const totalArea = snapshot.biomes.reduce((sum, biome) => sum + biome.areaKm2, 0);
    if (snapshot.biomes.some(biome => Math.abs(biome.areaShare - biome.areaKm2 / totalArea * 100) > 0.000001)) {
      throw new Error('Biome shares do not match the recorded areas.');
    }
    for (const [id, location] of Object.entries(snapshot.locations)) {
      if (!location || !Array.isArray(location.ecoregions) ||
          !['matched', 'no-terrestrial-match', 'missing-coordinates'].includes(location.status) ||
          !(location.lat === null || (Number.isFinite(location.lat) && Math.abs(location.lat) <= 90)) ||
          !(location.lng === null || (Number.isFinite(location.lng) && Math.abs(location.lng) <= 180))) {
        throw new Error(`Invalid ecoregion mapping for ${id}.`);
      }
      if ((location.status === 'matched') !== (location.ecoregions.length > 0) ||
          (location.status === 'missing-coordinates') !== (location.lat === null || location.lng === null)) {
        throw new Error(`Inconsistent ecoregion mapping for ${id}.`);
      }
      const regions = new Set();
      for (const region of location.ecoregions) {
        if (!Number.isInteger(region.id) || regions.has(region.id) ||
            typeof region.name !== 'string' || !region.name.trim() ||
            typeof region.realm !== 'string' || !ids.has(region.biomeId)) {
          throw new Error(`Invalid ecoregion for ${id}.`);
        }
        regions.add(region.id);
      }
    }
    return snapshot;
  }

  function applySnapshot(parks, snapshot) {
    validateSnapshot(snapshot);
    const biomes = biomeDefinitions();
    snapshot.biomes.forEach(biome => {
      Object.assign(biomes[biome.id], {
        rarity: biome.rarity, areaShare: biome.areaShare,
        xp: biome.rarity === 'rare' ? 65 : biome.rarity === 'uncommon' ? 30 : 15
      });
    });
    const locations = parks.map(park => {
      const mapping = snapshot.locations[park.id];
      const current = mapping && mapping.lat === park.lat && mapping.lng === park.lng;
      const ecoregions = current ? mapping.ecoregions : [];
      return {
        ...park, ecoregions,
        biomes: [...new Set(ecoregions.map(region => String(region.biomeId)))],
        biomeStatus: current ? mapping.status : 'mapping-outdated'
      };
    });
    return { parks: locations, biomes };
  }

  const api = { SOURCE, names, rarityForShare, biomeDefinitions, validateSnapshot, applySnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ecoregions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
