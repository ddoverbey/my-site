(function (root) {
  'use strict';

  const SKIN_TONES = [
    { id: 'porcelain', name: 'Porcelain', color: '#f5d6bd', imageSrc: null },
    { id: 'warm', name: 'Warm', color: '#dba77e', imageSrc: null },
    { id: 'golden', name: 'Golden', color: '#bd8055', imageSrc: null },
    { id: 'umber', name: 'Umber', color: '#87583f', imageSrc: null },
    { id: 'deep', name: 'Deep', color: '#57372f', imageSrc: null }
  ];
  const HAIR_STYLES = [
    { id: 'short', name: 'Short', imageSrc: null },
    { id: 'bob', name: 'Bob', imageSrc: null },
    { id: 'long', name: 'Long', imageSrc: null },
    { id: 'curls', name: 'Curls', imageSrc: null }
  ];
  const HAIR_COLORS = [
    { id: 'brown', name: 'Chestnut', color: '#603c2e', imageSrc: null },
    { id: 'black', name: 'Black', color: '#292b35', imageSrc: null },
    { id: 'blonde', name: 'Blonde', color: '#e4bd68', imageSrc: null },
    { id: 'red', name: 'Copper', color: '#a84e36', imageSrc: null },
    { id: 'silver', name: 'Silver', color: '#b7c3cd', imageSrc: null },
    { id: 'teal', name: 'Teal', color: '#53b8aa', imageSrc: null }
  ];
  const EYE_COLORS = [
    { id: 'brown', name: 'Brown', color: '#754532', imageSrc: null },
    { id: 'blue', name: 'Blue', color: '#5ba9dc', imageSrc: null },
    { id: 'green', name: 'Green', color: '#68a867', imageSrc: null },
    { id: 'violet', name: 'Violet', color: '#9c79c8', imageSrc: null }
  ];
  const BODY_SHAPES = [
    { id: 'slender', name: 'Slender', imageSrc: null },
    { id: 'balanced', name: 'Balanced', imageSrc: null },
    { id: 'sturdy', name: 'Sturdy', imageSrc: null }
  ];
  const HEIGHTS = [
    { id: 'compact', name: 'Compact', imageSrc: null },
    { id: 'standard', name: 'Standard', imageSrc: null },
    { id: 'tall', name: 'Tall', imageSrc: null }
  ];

  const OUTFIT_CATALOG = [
    { id: 'outfit_recruit', name: 'Recruit Tee & Cargo Shorts', slot: 'outfit', unlock: { type: 'level', goal: 1 }, color: '#5d9d79', imageSrc: null },
    { id: 'outfit_flannel', name: 'Trail Flannel', slot: 'outfit', unlock: { type: 'level', goal: 3 }, color: '#b95848', imageSrc: null },
    { id: 'outfit_vest', name: 'Ranger Field Vest', slot: 'outfit', unlock: { type: 'level', goal: 5 }, color: '#a17b41', imageSrc: null },
    { id: 'outfit_parka', name: 'Alpine Parka', slot: 'outfit', unlock: { type: 'level', goal: 7 }, color: '#4d829b', imageSrc: null },
    { id: 'outfit_sovereign', name: 'Sovereign Cartographer Coat', slot: 'outfit', unlock: { type: 'level', goal: 10 }, color: '#594c83', imageSrc: null },
    { id: 'outfit_naturalist', name: 'Naturalist Field Clothes', slot: 'outfit', unlock: { type: 'worldParks', goal: 25 }, color: '#658448', imageSrc: null },
    { id: 'outfit_master_naturalist', name: 'Master Naturalist Cape', slot: 'outfit', unlock: { type: 'worldParks', goal: 75 }, color: '#397768', imageSrc: null },
    { id: 'outfit_rain', name: 'Rain Poncho', slot: 'outfit', unlock: { type: 'achievement', id: 'waterfalls_1' }, color: '#6988aa', imageSrc: null },
    { id: 'outfit_astral', name: 'Astral Explorer Set', slot: 'outfit', unlock: { type: 'pro' }, color: '#775ec4', imageSrc: null },
    { id: 'outfit_sequoia', name: 'Golden Sequoia Cloak', slot: 'outfit', unlock: { type: 'donation', goal: 25 }, color: '#a98745', imageSrc: null }
  ];
  const HAT_CATALOG = [
    { id: 'hat_none', name: 'No Hat', slot: 'hat', unlock: { type: 'starter' }, color: '#b68655', imageSrc: null },
    { id: 'hat_pith', name: 'Trail Pith Hat', slot: 'hat', unlock: { type: 'level', goal: 2 }, color: '#d6bd81', imageSrc: null },
    { id: 'hat_volunteer', name: 'Volunteer Cap', slot: 'hat', unlock: { type: 'worldParks', goal: 5 }, color: '#668f79', imageSrc: null },
    { id: 'hat_ranger_brown', name: 'Brown-Band Ranger Hat', slot: 'hat', unlock: { type: 'worldParks', goal: 10 }, color: '#bd9a5e', imageSrc: null },
    { id: 'hat_summit', name: 'Mountaineer Goggles', slot: 'hat', unlock: { type: 'achievement', id: 'thinAir' }, color: '#8bb9c8', imageSrc: null },
    { id: 'hat_captain', name: "The Mariner's Cap", slot: 'hat', unlock: { type: 'achievement', id: 'mariner' }, color: '#496d94', imageSrc: null },
    { id: 'hat_ranger_silver', name: 'Silver-Band Ranger Hat', slot: 'hat', unlock: { type: 'worldParks', goal: 35 }, color: '#aeb8c2', imageSrc: null },
    { id: 'hat_ranger_gold', name: 'Golden Ranger Hat', slot: 'hat', unlock: { type: 'worldParks', goal: 50 }, color: '#e3b648', imageSrc: null },
    { id: 'hat_ranger_diamond', name: 'Diamond Ranger Hat', slot: 'hat', unlock: { type: 'worldParks', goal: 100 }, color: '#a2e8ee', imageSrc: null },
    { id: 'hat_golden_halo', name: 'Golden Compass Halo', slot: 'hat', unlock: { type: 'pro' }, color: '#f3ca63', imageSrc: null }
  ];
  const ACCESSORY_CATALOG = [
    { id: 'accessory_none', name: 'No Accessory', slot: 'accessory', unlock: { type: 'starter' }, color: '#64748b', imageSrc: null },
    { id: 'accessory_stick', name: 'Walking Stick', slot: 'accessory', unlock: { type: 'level', goal: 4 }, color: '#8e613c', imageSrc: null },
    { id: 'accessory_lantern', name: 'Trail Lantern', slot: 'accessory', unlock: { type: 'level', goal: 6 }, color: '#e7ad4d', imageSrc: null },
    { id: 'accessory_spyglass', name: 'Field Spyglass', slot: 'accessory', unlock: { type: 'level', goal: 9 }, color: '#b88654', imageSrc: null },
    { id: 'accessory_binoculars', name: 'Field Binoculars', slot: 'accessory', unlock: { type: 'worldParks', goal: 20 }, color: '#536b66', imageSrc: null },
    { id: 'accessory_camera', name: 'Vintage Camera', slot: 'accessory', unlock: { type: 'achievement', id: 'focal' }, color: '#414957', imageSrc: null },
    { id: 'accessory_patron_pin', name: 'Park Patron Ranger Pin', slot: 'accessory', unlock: { type: 'donation', goal: 5 }, color: '#dcaa4a', imageSrc: null },
    { id: 'accessory_compass', name: 'Conservation Compass', slot: 'accessory', unlock: { type: 'donation', goal: 50 }, color: '#d6bd81', imageSrc: null }
  ];
  const PET_CATALOG = [
    { id: 'pet_none', name: 'No Companion', unlock: { type: 'starter' }, kind: 'none', imageSrc: null },
    { id: 'pet_pufflin_blue', name: 'Blue Pufflin', unlock: { type: 'starter' }, kind: 'pufflin', color: '#59a9d7', imageSrc: null },
    { id: 'pet_puppy_gold', name: 'Golden Retriever Puppy', unlock: { type: 'starter' }, kind: 'puppy', color: '#dca957', imageSrc: null },
    { id: 'pet_kitten_gray', name: 'Gray Tabby Kitten', unlock: { type: 'starter' }, kind: 'kitten', color: '#8796a6', imageSrc: null },
    { id: 'pet_pufflin_forest', name: 'Forest Pufflin', unlock: { type: 'achievement', id: 'whispers' }, kind: 'pufflin', color: '#63a978', imageSrc: null },
    { id: 'pet_pufflin_gold', name: 'Golden Pufflin', unlock: { type: 'achievement', id: 'masterRanger' }, kind: 'pufflin', color: '#e3b648', imageSrc: null },
    { id: 'pet_pufflin_gaia', name: 'Gaia Pufflin', unlock: { type: 'achievement', id: 'gaiaWanderer' }, kind: 'pufflin', color: '#ba8cd7', imageSrc: null },
    { id: 'pet_red_panda', name: 'Red Panda Companion', unlock: { type: 'pro' }, kind: 'redPanda', color: '#ca7047', imageSrc: null }
  ];
  const BACKGROUND_CATALOG = [
    { id: 'bg_campfire', name: 'Campfire Night', unlock: { type: 'starter' }, palette: 'campfire', imageSrc: null },
    { id: 'bg_citadel', name: 'Home Citadel', unlock: { type: 'starter' }, palette: 'citadel', imageSrc: null },
    { id: 'bg_aurora', name: 'Aurora Borealis', unlock: { type: 'achievement', id: 'longDark' }, palette: 'aurora', imageSrc: null },
    { id: 'bg_observatory', name: 'Celestial Observatory', unlock: { type: 'achievement', id: 'worldAtlas' }, palette: 'observatory', imageSrc: null },
    { id: 'bg_sanctuary', name: 'Conservation Sanctuary', unlock: { type: 'donation', goal: 50 }, palette: 'sanctuary', imageSrc: null },
    { id: 'bg_pro_celestial', name: 'Astral Horizon', unlock: { type: 'pro' }, palette: 'pro', imageSrc: null }
  ];

  const DEFAULT_CHARACTER = Object.freeze({
    skinTone: 'warm',
    hairStyle: 'short',
    hairColor: 'brown',
    eyeColor: 'brown',
    bodyShape: 'balanced',
    height: 'standard',
    hat: 'hat_none',
    outfit: 'outfit_recruit',
    accessory: 'accessory_none',
    pet: 'pet_pufflin_blue',
    background: 'bg_campfire',
    proUnlocked: false,
    donationUsd: 0
  });

  const catalogsBySlot = {
    hat: HAT_CATALOG,
    outfit: OUTFIT_CATALOG,
    accessory: ACCESSORY_CATALOG,
    pet: PET_CATALOG,
    background: BACKGROUND_CATALOG
  };
  const imageCache = new Map();
  const stages = new WeakMap();
  const tabs = ['appearance', 'wardrobe', 'pets', 'backgrounds', 'patron'];

  function normalizeCharacter(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const knownIds = catalog => new Set(catalog.map(item => item.id));
    const normalizeId = (raw, allowed, fallback) => allowed.has(raw) ? raw : fallback;
    const validColorId = (raw, catalog, fallback) =>
      normalizeId(raw, knownIds(catalog), fallback);
    return {
      skinTone: validColorId(source.skinTone, SKIN_TONES, DEFAULT_CHARACTER.skinTone),
      hairStyle: normalizeId(source.hairStyle, knownIds(HAIR_STYLES), DEFAULT_CHARACTER.hairStyle),
      hairColor: validColorId(source.hairColor, HAIR_COLORS, DEFAULT_CHARACTER.hairColor),
      eyeColor: validColorId(source.eyeColor, EYE_COLORS, DEFAULT_CHARACTER.eyeColor),
      bodyShape: normalizeId(source.bodyShape, knownIds(BODY_SHAPES), DEFAULT_CHARACTER.bodyShape),
      height: normalizeId(source.height, knownIds(HEIGHTS), DEFAULT_CHARACTER.height),
      hat: normalizeId(source.hat, knownIds(HAT_CATALOG), DEFAULT_CHARACTER.hat),
      outfit: normalizeId(source.outfit, knownIds(OUTFIT_CATALOG), DEFAULT_CHARACTER.outfit),
      accessory: normalizeId(source.accessory, knownIds(ACCESSORY_CATALOG), DEFAULT_CHARACTER.accessory),
      pet: normalizeId(source.pet, knownIds(PET_CATALOG), DEFAULT_CHARACTER.pet),
      background: normalizeId(source.background, knownIds(BACKGROUND_CATALOG), DEFAULT_CHARACTER.background),
      proUnlocked: source.proUnlocked === true,
      donationUsd: Number.isFinite(Number(source.donationUsd))
        ? Math.max(0, Math.min(1000000, Number(source.donationUsd))) : 0
    };
  }

  function achievementProgress(stats = {}, achievements = []) {
    const progress = new Map();
    achievements.forEach(achievement => {
      const amount = Number(achievement.progress(stats));
      (achievement.tiers || []).forEach(tier => {
        const goal = Number(typeof tier.goal === 'function' ? tier.goal(stats) : tier.goal);
        if (Number.isFinite(amount) && Number.isFinite(goal)) {
          progress.set(achievement.id, {
            progress: Math.max(0, amount),
            goal: Math.max(0, goal),
            name: tier.title || achievement.title
          });
        }
      });
    });
    return progress;
  }

  function unlockStatus(unlock, stats, character, achievements) {
    if (!unlock || unlock.type === 'starter') return { unlocked: true, description: 'Available from the start.' };
    if (unlock.type === 'level') {
      const current = Number(stats.level) || 1;
      return {
        unlocked: current >= unlock.goal,
        description: `Reach level ${unlock.goal} (${Math.min(current, unlock.goal)}/${unlock.goal}).`
      };
    }
    if (unlock.type === 'worldParks') {
      const current = Array.isArray(stats.visitedParks) ? stats.visitedParks.length : 0;
      return {
        unlocked: current >= unlock.goal,
        description: `Visit ${unlock.goal} worldwide parks (${Math.min(current, unlock.goal)}/${unlock.goal}).`
      };
    }
    if (unlock.type === 'achievement') {
      const result = achievements.get(unlock.id);
      return {
        unlocked: !!result && result.progress >= result.goal,
        description: result
          ? `Earn ${result.name} (${Math.min(result.progress, result.goal)}/${result.goal}).`
          : 'Earn the linked achievement.'
      };
    }
    if (unlock.type === 'pro') {
      return { unlocked: character.proUnlocked, description: 'Requires Cartovella Pro.' };
    }
    if (unlock.type === 'donation') {
      const current = character.donationUsd;
      return {
        unlocked: current >= unlock.goal,
        description: `Requires $${unlock.goal} in recorded donations ($${Math.min(current, unlock.goal)}/$${unlock.goal}).`
      };
    }
    return { unlocked: false, description: 'Unlock requirement unavailable.' };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function getItem(catalog, id) {
    return catalog.find(item => item.id === id) || catalog[0];
  }

  function getImage(item, redraw) {
    if (!item?.imageSrc || typeof Image === 'undefined') return null;
    if (!imageCache.has(item.imageSrc)) {
      const image = new Image();
      image.onload = () => redraw();
      image.onerror = () => imageCache.set(item.imageSrc, null);
      image.src = item.imageSrc;
      imageCache.set(item.imageSrc, image);
    }
    const image = imageCache.get(item.imageSrc);
    return image && image.complete && image.naturalWidth ? image : null;
  }

  function pixel(ctx, x, y, width, height, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  }

  function drawBackground(ctx, background, redraw) {
    const image = getImage(background, redraw);
    if (image) {
      ctx.drawImage(image, 0, 0, 160, 90);
      return;
    }
    const palettes = {
      campfire: ['#101a35', '#26364d', '#406044'],
      citadel: ['#233b62', '#657d9a', '#48634f'],
      aurora: ['#091d3c', '#386b78', '#304c54'],
      observatory: ['#111332', '#51426d', '#313b59'],
      sanctuary: ['#1f3a35', '#52765a', '#405c42'],
      pro: ['#171234', '#624d83', '#393956']
    };
    const colors = palettes[background.palette] || palettes.campfire;
    pixel(ctx, 0, 0, 160, 90, colors[0]);
    pixel(ctx, 0, 57, 160, 33, colors[1]);
    pixel(ctx, 0, 72, 160, 18, colors[2]);
    for (let index = 0; index < 22; index++) {
      pixel(ctx, (index * 37 + 11) % 158, (index * 19 + 5) % 43, index % 4 === 0 ? 2 : 1, 1, '#e8dfae');
    }
    if (background.palette === 'campfire') {
      pixel(ctx, 12, 42, 36, 17, '#1d2b40');
      pixel(ctx, 100, 38, 48, 21, '#1d2b40');
      pixel(ctx, 25, 52, 20, 7, '#304057');
      pixel(ctx, 112, 49, 30, 9, '#304057');
      pixel(ctx, 69, 67, 20, 3, '#553b2f');
      pixel(ctx, 73, 60, 4, 9, '#d78339');
      pixel(ctx, 79, 57, 4, 12, '#f3bd59');
      pixel(ctx, 83, 61, 3, 8, '#df6136');
    } else if (background.palette === 'citadel') {
      pixel(ctx, 17, 42, 23, 27, '#374967');
      pixel(ctx, 22, 35, 13, 9, '#b8a57b');
      pixel(ctx, 120, 38, 24, 31, '#3a4a68');
      pixel(ctx, 124, 31, 16, 9, '#c1ae83');
      pixel(ctx, 65, 35, 30, 35, '#7b765e');
      pixel(ctx, 70, 28, 20, 9, '#b8a57b');
      pixel(ctx, 76, 55, 8, 15, '#382f34');
      pixel(ctx, 71, 43, 4, 6, '#e9d18e');
      pixel(ctx, 84, 43, 4, 6, '#e9d18e');
    } else if (background.palette === 'aurora') {
      pixel(ctx, 0, 18, 67, 3, '#58c5a1');
      pixel(ctx, 12, 22, 53, 2, '#58c5a1');
      pixel(ctx, 87, 15, 73, 3, '#9a7fd0');
      pixel(ctx, 95, 19, 57, 2, '#9a7fd0');
      pixel(ctx, 0, 54, 59, 8, '#1b3448');
      pixel(ctx, 111, 53, 49, 9, '#1b3448');
    } else if (background.palette === 'observatory' || background.palette === 'pro') {
      pixel(ctx, 113, 25, 28, 28, '#515273');
      pixel(ctx, 119, 18, 16, 9, '#9d8a9d');
      pixel(ctx, 121, 34, 4, 5, '#e8d78f');
      pixel(ctx, 130, 34, 4, 5, '#e8d78f');
      pixel(ctx, 16, 49, 28, 20, '#394058');
      pixel(ctx, 22, 43, 16, 8, '#857d91');
    } else {
      pixel(ctx, 12, 54, 30, 16, '#29483f');
      pixel(ctx, 19, 46, 16, 11, '#315641');
      pixel(ctx, 115, 50, 34, 20, '#29483f');
      pixel(ctx, 122, 42, 18, 12, '#315641');
      pixel(ctx, 0, 67, 160, 3, '#779366');
    }
  }

  function drawHair(ctx, style, color, center, top) {
    if (style === 'short') {
      pixel(ctx, center - 5, top, 10, 3, color);
      pixel(ctx, center - 6, top + 2, 3, 5, color);
    } else if (style === 'bob') {
      pixel(ctx, center - 6, top, 12, 4, color);
      pixel(ctx, center - 6, top + 3, 3, 8, color);
      pixel(ctx, center + 3, top + 3, 3, 8, color);
    } else if (style === 'long') {
      pixel(ctx, center - 6, top, 12, 4, color);
      pixel(ctx, center - 6, top + 3, 3, 14, color);
      pixel(ctx, center + 3, top + 3, 3, 14, color);
    } else {
      pixel(ctx, center - 6, top, 4, 4, color);
      pixel(ctx, center - 2, top - 2, 5, 5, color);
      pixel(ctx, center + 2, top, 4, 4, color);
      pixel(ctx, center - 6, top + 3, 3, 8, color);
      pixel(ctx, center + 3, top + 3, 3, 8, color);
    }
  }

  function drawPerson(ctx, character, redraw) {
    const skin = getItem(SKIN_TONES, character.skinTone).color;
    const hair = getItem(HAIR_COLORS, character.hairColor).color;
    const eyes = getItem(EYE_COLORS, character.eyeColor).color;
    const outfit = getItem(OUTFIT_CATALOG, character.outfit);
    const hat = getItem(HAT_CATALOG, character.hat);
    const accessory = getItem(ACCESSORY_CATALOG, character.accessory);
    const center = 79;
    const ground = 80;
    const legScale = character.height === 'compact' ? 0.85 : character.height === 'tall' ? 1.15 : 1;
    const torsoScale = character.height === 'compact' ? 0.92 : character.height === 'tall' ? 1.08 : 1;
    const width = character.bodyShape === 'slender' ? 8 : character.bodyShape === 'sturdy' ? 13 : 10;
    const legHeight = Math.round(12 * legScale);
    const torsoHeight = Math.round(16 * torsoScale);
    const headHeight = 11;
    const headTop = ground - legHeight - torsoHeight - headHeight;
    const torsoTop = ground - legHeight - torsoHeight;
    const imageFor = (item, x, y, w, h) => {
      const image = getImage(item, redraw);
      if (!image) return false;
      ctx.drawImage(image, x, y, w, h);
      return true;
    };
    pixel(ctx, center - width / 2 - 2, ground - 2, width + 4, 2, '#253444');
    pixel(ctx, center - width / 2 + 1, ground - legHeight, 3, legHeight, '#33475a');
    pixel(ctx, center + width / 2 - 4, ground - legHeight, 3, legHeight, '#33475a');
    pixel(ctx, center - width / 2 + 1, ground - 2, 4, 2, '#4d3c35');
    pixel(ctx, center + width / 2 - 4, ground - 2, 4, 2, '#4d3c35');
    pixel(ctx, center - width / 2 - 3, torsoTop, width + 6, torsoHeight, outfit.color);
    pixel(ctx, center - width / 2 - 5, torsoTop + 2, 3, Math.max(5, torsoHeight - 4), skin);
    pixel(ctx, center + width / 2 + 2, torsoTop + 2, 3, Math.max(5, torsoHeight - 4), skin);
    pixel(ctx, center - width / 2 - 3, torsoTop + torsoHeight - 4, width + 6, 2, '#384c42');
    pixel(ctx, center - width / 2 - 1, headTop + headHeight - 1, 3, 4, skin);
    pixel(ctx, center + width / 2 - 2, headTop + headHeight - 1, 3, 4, skin);
    pixel(ctx, center - 5, headTop, 10, headHeight, skin);
    pixel(ctx, center - 3, headTop + 5, 2, 2, eyes);
    pixel(ctx, center + 2, headTop + 5, 2, 2, eyes);
    pixel(ctx, center - 1, headTop + 9, 2, 1, '#9c5a56');
    const hairStyle = getItem(HAIR_STYLES, character.hairStyle);
    if (!imageFor(hairStyle, center - 8, headTop - 4, 16, 18)) {
      drawHair(ctx, character.hairStyle, hair, center, headTop - 1);
    }
    if (hat.id !== 'hat_none' && !imageFor(hat, center - 8, headTop - 7, 16, 8)) {
      pixel(ctx, center - 8, headTop - 6, 16, 4, hat.color);
      pixel(ctx, center - 10, headTop - 3, 20, 2, '#594638');
      if (hat.id.includes('ranger')) pixel(ctx, center - 3, headTop - 5, 6, 1, '#e6d194');
      if (hat.id === 'hat_summit') {
        pixel(ctx, center - 8, headTop - 1, 16, 2, '#d1e9e7');
        pixel(ctx, center - 5, headTop - 1, 4, 2, '#3f6e80');
        pixel(ctx, center + 1, headTop - 1, 4, 2, '#3f6e80');
      }
    }
    if (outfit.id === 'outfit_flannel') {
      pixel(ctx, center - 1, torsoTop + 1, 2, torsoHeight - 2, '#e6c484');
      pixel(ctx, center - width / 2 - 2, torsoTop + 7, width + 4, 2, '#754944');
    } else if (outfit.id === 'outfit_vest' || outfit.id === 'outfit_naturalist') {
      pixel(ctx, center - 2, torsoTop + 4, 4, torsoHeight - 5, '#d7b66d');
      pixel(ctx, center - width / 2, torsoTop + 7, 3, 4, '#594e37');
      pixel(ctx, center + width / 2 - 3, torsoTop + 7, 3, 4, '#594e37');
    } else if (outfit.id === 'outfit_parka') {
      pixel(ctx, center - width / 2 - 1, torsoTop + 2, width + 2, 2, '#d7e1df');
    } else if (outfit.id === 'outfit_rain') {
      pixel(ctx, center - width / 2 - 4, torsoTop + 1, width + 8, 3, '#9bbbd0');
    } else if (outfit.id === 'outfit_astral' || outfit.id === 'outfit_sovereign') {
      pixel(ctx, center - 1, torsoTop + 3, 2, torsoHeight - 5, '#e1c779');
    }
    imageFor(outfit, center - 12, torsoTop, 24, torsoHeight + legHeight / 2);
    if (accessory.id !== 'accessory_none' && !imageFor(accessory, center - 14, torsoTop + 5, 24, torsoHeight)) {
      if (accessory.id === 'accessory_stick') {
        pixel(ctx, center + 11, torsoTop + 3, 1, torsoHeight + legHeight, accessory.color);
        pixel(ctx, center + 10, torsoTop + 2, 3, 2, '#c7ad7b');
      } else if (accessory.id === 'accessory_lantern') {
        pixel(ctx, center + 10, torsoTop + 7, 5, 7, '#7b5636');
        pixel(ctx, center + 11, torsoTop + 8, 3, 4, '#f3cf76');
        pixel(ctx, center + 11, torsoTop + 5, 3, 2, '#c1904d');
      } else if (accessory.id === 'accessory_spyglass' || accessory.id === 'accessory_binoculars') {
        pixel(ctx, center - 13, torsoTop + 4, 6, 3, accessory.color);
        pixel(ctx, center - 14, torsoTop + 3, 2, 5, '#d5bd7b');
      } else {
        pixel(ctx, center + 9, torsoTop + 5, 6, 5, accessory.color);
        pixel(ctx, center + 10, torsoTop + 6, 2, 2, '#d6bd81');
      }
    }
  }

  function drawPet(ctx, pet, redraw) {
    if (pet.id === 'pet_none') return;
    const image = getImage(pet, redraw);
    if (image) {
      ctx.drawImage(image, 102, 64, 20, 16);
      return;
    }
    if (pet.kind === 'pufflin') {
      pixel(ctx, 105, 68, 15, 10, pet.color);
      pixel(ctx, 108, 64, 4, 5, pet.color);
      pixel(ctx, 115, 63, 4, 6, pet.color);
      pixel(ctx, 108, 71, 2, 2, '#17283b');
      pixel(ctx, 115, 71, 2, 2, '#17283b');
      pixel(ctx, 111, 75, 4, 2, '#f2d8cc');
      pixel(ctx, 110, 78, 3, 2, pet.color);
      pixel(ctx, 115, 78, 3, 2, pet.color);
    } else if (pet.kind === 'puppy') {
      pixel(ctx, 105, 68, 15, 10, pet.color);
      pixel(ctx, 105, 65, 4, 8, '#a8753d');
      pixel(ctx, 117, 65, 4, 8, '#a8753d');
      pixel(ctx, 109, 70, 2, 2, '#372f32');
      pixel(ctx, 115, 70, 2, 2, '#372f32');
      pixel(ctx, 112, 74, 3, 2, '#704747');
      pixel(ctx, 118, 69, 4, 2, pet.color);
    } else if (pet.kind === 'kitten') {
      pixel(ctx, 106, 68, 15, 10, pet.color);
      pixel(ctx, 106, 64, 5, 6, pet.color);
      pixel(ctx, 116, 64, 5, 6, pet.color);
      pixel(ctx, 108, 65, 2, 3, '#d98d91');
      pixel(ctx, 117, 65, 2, 3, '#d98d91');
      pixel(ctx, 109, 71, 2, 2, '#252d34');
      pixel(ctx, 116, 71, 2, 2, '#252d34');
      pixel(ctx, 112, 74, 3, 2, '#d98d91');
      pixel(ctx, 119, 74, 4, 2, pet.color);
    } else {
      pixel(ctx, 105, 68, 15, 10, pet.color);
      pixel(ctx, 106, 64, 5, 5, pet.color);
      pixel(ctx, 115, 64, 5, 5, pet.color);
      pixel(ctx, 109, 71, 2, 2, '#252d34');
      pixel(ctx, 116, 71, 2, 2, '#252d34');
      pixel(ctx, 112, 74, 3, 2, '#e5d7c4');
      pixel(ctx, 118, 69, 5, 3, '#b75f39');
    }
  }

  function drawStage(canvas, value, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const character = normalizeCharacter(value);
    const stats = options.stats || {};
    const achievements = achievementProgress(stats, options.achievements || []);
    const activeBackground = getItem(BACKGROUND_CATALOG, character.background);
    const activePet = getItem(PET_CATALOG, character.pet);
    const activeOutfit = getItem(OUTFIT_CATALOG, character.outfit);
    const activeHat = getItem(HAT_CATALOG, character.hat);
    const activeAccessory = getItem(ACCESSORY_CATALOG, character.accessory);
    const redraw = () => {
      if (stages.get(canvas) === renderId) drawStage(canvas, character, options);
    };
    const renderId = (stages.get(canvas) || 0) + 1;
    stages.set(canvas, renderId);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(canvas.width / 160, canvas.height / 90);
    drawBackground(ctx, activeBackground, redraw);
    drawPerson(ctx, character, redraw);
    drawPet(ctx, activePet, redraw);
    pixel(ctx, 0, 82, 160, 8, '#17212d');
    pixel(ctx, 0, 82, 160, 1, '#84946d');
    ctx.restore();
  }

  function optionMarkup(label, field, options, value, disabled) {
    return `<label class="block text-xs text-slate-300">${escapeHtml(label)}
      <select data-character-field="${escapeHtml(field)}" ${disabled ? 'disabled' : ''}
        class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-50">
        ${options.map(option => `<option value="${escapeHtml(option.id)}" ${option.id === value ? 'selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}
      </select>
    </label>`;
  }

  function colorPickerMarkup(label, field, options, value, disabled) {
    return `<div role="group" aria-label="${escapeHtml(label)}">
      <span class="block text-xs text-slate-300 mb-1">${escapeHtml(label)}</span>
      <div class="flex flex-wrap gap-2">${options.map(option => `<button type="button"
        data-character-field="${escapeHtml(field)}" data-character-id="${escapeHtml(option.id)}"
        aria-label="${escapeHtml(`${label}: ${option.name}`)}" aria-pressed="${option.id === value}"
        ${disabled ? 'disabled' : ''}
        class="h-9 w-9 rounded-full border-2 ${option.id === value ? 'border-amber-300 ring-2 ring-amber-300/40' : 'border-slate-600'} disabled:opacity-50"
        style="background-color:${option.color}" title="${escapeHtml(option.name)}"></button>`).join('')}</div>
    </div>`;
  }

  function itemCards(catalog, field, value, stats, character, achievements, disabled) {
    return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${catalog.map(item => {
      const status = unlockStatus(item.unlock, stats, character, achievements);
      const selected = item.id === value;
      return `<button type="button" data-character-field="${escapeHtml(field)}" data-character-id="${escapeHtml(item.id)}"
        aria-pressed="${selected}" ${!status.unlocked || disabled ? 'disabled' : ''}
        class="rounded-xl border p-3 text-left transition ${status.unlocked
          ? selected ? 'border-amber-300 bg-amber-950/60' : 'border-slate-700 bg-slate-950/60 hover:border-slate-500'
          : 'border-slate-800 bg-slate-950/40 opacity-60'} disabled:cursor-not-allowed">
        <span class="block text-sm font-semibold text-slate-100">${status.unlocked ? '' : '🔒 '}${escapeHtml(item.name)}</span>
        <span class="block mt-1 text-[11px] ${status.unlocked ? 'text-slate-400' : 'text-amber-200/80'}">${escapeHtml(status.unlocked ? selected ? 'Equipped' : 'Unlocked' : status.description)}</span>
      </button>`;
    }).join('')}</div>`;
  }

  function renderControls(container, character, stats, achievements, disabled) {
    const activeTab = tabs.includes(container.dataset.activeTab) ? container.dataset.activeTab : 'appearance';
    const completedAchievements = achievementProgress(stats, achievements);
    const sections = {
      appearance: `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        ${colorPickerMarkup('Skin tone', 'skinTone', SKIN_TONES, character.skinTone, disabled)}
        ${optionMarkup('Hair style', 'hairStyle', HAIR_STYLES, character.hairStyle, disabled)}
        ${colorPickerMarkup('Hair color', 'hairColor', HAIR_COLORS, character.hairColor, disabled)}
        ${colorPickerMarkup('Eye color', 'eyeColor', EYE_COLORS, character.eyeColor, disabled)}
        ${optionMarkup('Body shape', 'bodyShape', BODY_SHAPES, character.bodyShape, disabled)}
        ${optionMarkup('Height', 'height', HEIGHTS, character.height, disabled)}
      </div>`,
      wardrobe: `<div class="space-y-5">
        <section><h4 class="text-sm font-bold text-amber-200 mb-2">Outfits</h4>${itemCards(OUTFIT_CATALOG, 'outfit', character.outfit, stats, character, completedAchievements, disabled)}</section>
        <section><h4 class="text-sm font-bold text-amber-200 mb-2">Hats</h4>${itemCards(HAT_CATALOG, 'hat', character.hat, stats, character, completedAchievements, disabled)}</section>
        <section><h4 class="text-sm font-bold text-amber-200 mb-2">Accessories</h4>${itemCards(ACCESSORY_CATALOG, 'accessory', character.accessory, stats, character, completedAchievements, disabled)}</section>
      </div>`,
      pets: `<p class="text-xs text-slate-400 mb-3">Choose one companion to appear beside your explorer.</p>
        ${itemCards(PET_CATALOG, 'pet', character.pet, stats, character, completedAchievements, disabled)}`,
      backgrounds: `<p class="text-xs text-slate-400 mb-3">Choose a scene for your stage. National Park dioramas are deferred for now.</p>
        ${itemCards(BACKGROUND_CATALOG, 'background', character.background, stats, character, completedAchievements, disabled)}`,
      patron: `<div class="rounded-xl border border-amber-800/60 bg-amber-950/20 p-3 mb-4 text-xs text-amber-100">
          Pro and donation rewards are listed for the future catalog. Payment and donation verification are not connected yet, so these profile values do not grant verified purchase entitlements.
        </div>
        <div class="space-y-5">
          <section><h4 class="text-sm font-bold text-amber-200 mb-2">Cartovella Pro</h4>
            ${itemCards([...OUTFIT_CATALOG, ...HAT_CATALOG, ...PET_CATALOG, ...BACKGROUND_CATALOG].filter(item =>
              item.unlock.type === 'pro'), 'proReward', '', stats, character, completedAchievements, true)}
          </section>
          <section><h4 class="text-sm font-bold text-amber-200 mb-2">Park Foundation Patron</h4>
            ${itemCards([...ACCESSORY_CATALOG, ...OUTFIT_CATALOG, ...BACKGROUND_CATALOG].filter(item =>
              item.unlock.type === 'donation'), 'donationReward', '', stats, character, completedAchievements, true)}
          </section>
        </div>`
    };
    container.innerHTML = `<div class="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Character customization">
      ${tabs.map(tab => `<button type="button" role="tab" data-character-tab="${tab}" aria-selected="${tab === activeTab}"
        class="rounded-lg px-3 py-2 text-xs font-semibold ${tab === activeTab ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">${{
          appearance: 'Appearance', wardrobe: 'Wardrobe', pets: 'Pets', backgrounds: 'Backgrounds', patron: 'Patron & Pro'
        }[tab]}</button>`).join('')}
      </div><div role="tabpanel">${sections[activeTab]}</div>`;
  }

  function renderProgressSummary(container, stats, character, achievements) {
    if (!container) return;
    const progress = achievementProgress(stats, achievements);
    const parks = Array.isArray(stats.visitedParks) ? stats.visitedParks.length : 0;
    const nextReward = [...OUTFIT_CATALOG, ...HAT_CATALOG, ...ACCESSORY_CATALOG]
      .filter(item => item.unlock.type === 'worldParks' && item.unlock.goal > parks)
      .sort((left, right) => left.unlock.goal - right.unlock.goal)[0];
    const unlockedWardrobe = [...OUTFIT_CATALOG, ...HAT_CATALOG, ...ACCESSORY_CATALOG]
      .filter(item => unlockStatus(item.unlock, stats, character, progress).unlocked).length;
    const wardrobeTotal = OUTFIT_CATALOG.length + HAT_CATALOG.length + ACCESSORY_CATALOG.length;
    const parkProgress = nextReward
      ? `<span class="block text-[10px] text-slate-400 mt-1">Next: ${escapeHtml(nextReward.name)} at ${nextReward.unlock.goal}</span>
        <progress class="w-full h-1.5 mt-2 accent-amber-400" aria-label="Progress to next worldwide park reward"
          value="${Math.min(parks, nextReward.unlock.goal)}" max="${nextReward.unlock.goal}"></progress>`
      : '<span class="block text-[10px] text-slate-400 mt-1">All catalog milestones reached</span>';
    container.innerHTML = `<div class="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
        <span class="block text-[10px] uppercase tracking-wide text-slate-400">Worldwide parks</span>
        <strong class="block text-lg font-mono text-amber-200">${parks}</strong>${parkProgress}
      </div>
      <div class="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
        <span class="block text-[10px] uppercase tracking-wide text-slate-400">Wardrobe unlocked</span>
        <strong class="block text-lg font-mono text-emerald-300">${unlockedWardrobe} / ${wardrobeTotal}</strong>
        <span class="block text-[10px] text-slate-400 mt-1">Level ${Number(stats.level) || 1} · ${PET_CATALOG.filter(item =>
          unlockStatus(item.unlock, stats, character, progress).unlocked).length} companions available</span>
      </div>`;
  }

  function render(options = {}) {
    const canvas = options.canvas;
    const controls = options.controls;
    const character = normalizeCharacter(options.character);
    const stats = options.stats || {};
    const achievements = options.achievements || [];
    const disabled = !!options.viewOnly;
    drawStage(canvas, character, { stats, achievements });
    renderProgressSummary(options.summary, stats, character, achievements);
    if (!controls) return;
    renderControls(controls, character, stats, achievements, disabled);
    controls.onclick = event => {
      const tabButton = event.target.closest('[data-character-tab]');
      if (tabButton) {
        controls.dataset.activeTab = tabButton.dataset.characterTab;
        renderControls(controls, character, stats, achievements, disabled);
        return;
      }
      const itemButton = event.target.closest('button[data-character-field][data-character-id]');
      if (!itemButton || disabled || itemButton.disabled) return;
      options.onChange?.(normalizeCharacter({ ...character, [itemButton.dataset.characterField]: itemButton.dataset.characterId }));
    };
    controls.onchange = event => {
      const field = event.target.dataset.characterField;
      if (!field || disabled) return;
      options.onChange?.(normalizeCharacter({ ...character, [field]: event.target.value }));
    };
  }

  const api = {
    DEFAULT_CHARACTER, SKIN_TONES, HAIR_STYLES, HAIR_COLORS, EYE_COLORS, BODY_SHAPES, HEIGHTS,
    OUTFIT_CATALOG, HAT_CATALOG, ACCESSORY_CATALOG, PET_CATALOG, BACKGROUND_CATALOG,
    normalizeCharacter, achievementProgress, unlockStatus, drawStage, render
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CharacterCreator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
