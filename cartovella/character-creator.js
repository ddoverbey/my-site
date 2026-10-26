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
    ...Array.from({ length: 30 }, (_, index) => {
      const sheet = index + 6;
      return {
        id: `hair_${sheet}`,
        name: `Hairstyle ${index + 1}`,
        sheet,
        genders: sheet <= 30 ? ['male', 'female'] : ['female'],
        imageSrc: null
      };
    }),
    { id: 'hair_fancy', name: 'Hairstyle 26', fileName: 'Fancy Hair.png', genders: ['male', 'female'], imageSrc: null },
    { id: 'hair_queen', name: 'Hairstyle 27', fileName: 'Queen hair.png', genders: ['male', 'female'], imageSrc: null },
    { id: 'hair_shield_maiden', name: 'Hairstyle 28', fileName: 'Shield Maiden hair.png', genders: ['male', 'female'], imageSrc: null }
  ];
  const HAIR_COLORS = [
    { id: 'black', name: 'Black', color: '#292b35', imageSrc: null },
    { id: 'brown', name: 'Chestnut', color: '#603c2e', imageSrc: null },
    { id: 'blonde', name: 'Blonde', color: '#e4bd68', imageSrc: null },
    { id: 'red', name: 'Red', color: '#a84e36', imageSrc: null },
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
    { id: 'straight', name: 'Classic / Straight Frame', imageSrc: null },
    { id: 'vTaper', name: 'Broad / V-Taper Frame', imageSrc: null },
    { id: 'hourglass', name: 'Curved / Hourglass Frame', imageSrc: null }
  ];
  const BODY_SHAPE_PROFILES = Object.freeze({
    straight: Object.freeze(Array(13).fill(12)),
    vTaper: Object.freeze([15, 15, 15, 14, 13, 12, 11, 10, 10, 10, 11, 11, 12]),
    hourglass: Object.freeze([13, 13, 12, 12, 11, 10, 9, 9, 9, 10, 11, 12, 13])
  });
  const BODY_SHAPE_ALIASES = new Map([
    ['balanced', 'straight'],
    ['slender', 'straight'],
    ['broad', 'vTaper'],
    ['sturdy', 'vTaper']
  ]);
  const HEIGHTS = [
    { id: 'compact', name: 'Compact', imageSrc: null },
    { id: 'standard', name: 'Standard', imageSrc: null },
    { id: 'tall', name: 'Tall', imageSrc: null }
  ];

  const OUTFIT_CATALOG = [
    { id: 'outfit_recruit', name: 'Classic Adventurer', spriteStyle: 'classic', slot: 'outfit', unlock: { type: 'starter' }, color: '#5d9d79', imageSrc: null },
    { id: 'outfit_flannel', name: 'Forest Green', spriteStyle: 'green', slot: 'outfit', unlock: { type: 'level', goal: 3 }, color: '#658448', imageSrc: null },
    { id: 'outfit_vest', name: 'River Blue', spriteStyle: 'blue', slot: 'outfit', unlock: { type: 'level', goal: 5 }, color: '#4d829b', imageSrc: null },
    { id: 'outfit_parka', name: 'Ember Orange', spriteStyle: 'orange', slot: 'outfit', unlock: { type: 'level', goal: 7 }, color: '#b95848', imageSrc: null },
    { id: 'outfit_sovereign', name: 'Royal Purple', spriteStyle: 'purple', slot: 'outfit', unlock: { type: 'level', goal: 10 }, color: '#775ec4', imageSrc: null },
    { id: 'outfit_naturalist', name: 'Naturalist Green', spriteStyle: 'green', slot: 'outfit', unlock: { type: 'worldParks', goal: 25 }, color: '#658448', imageSrc: null },
    { id: 'outfit_master_naturalist', name: 'Master Ranger Blue', spriteStyle: 'blue', slot: 'outfit', unlock: { type: 'worldParks', goal: 75 }, color: '#397768', imageSrc: null },
    { id: 'outfit_rain', name: 'Rain Trail Orange', spriteStyle: 'orange', slot: 'outfit', unlock: { type: 'achievement', id: 'waterfalls_1' }, color: '#6988aa', imageSrc: null },
    { id: 'outfit_astral', name: 'Astral Purple', spriteStyle: 'purple', slot: 'outfit', unlock: { type: 'pro' }, color: '#775ec4', imageSrc: null },
    { id: 'outfit_sequoia', name: 'Sequoia Green', spriteStyle: 'green', slot: 'outfit', unlock: { type: 'donation', goal: 25 }, color: '#a98745', imageSrc: null }
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
  const spritePet = (id, name, imageSrc, spriteSheet, cost) => ({
    id, name, unlock: { type: 'coin', cost, itemId: id }, cost, kind: 'sprite', imageSrc,
    spriteSheet: { ...spriteSheet }
  });
  const frameSequence = (id, name, row, frameColumns, geometry = {}) => ({
    id, name, row, frameColumns, ...geometry
  });
  const createAtlasSequences = (prefix, label, frameCounts, labels = {}, specialColumns = {}) =>
    frameCounts.flatMap((frameCount, row) => {
      if (!frameCount) return [];
      const frameColumns = specialColumns[row] ||
        Array.from({ length: frameCount }, (_, column) => column);
      return [frameSequence(`${prefix}-${row}`, labels[row] || `${label} ${row + 1} (row ${row})`,
        row, frameColumns)];
    });
  const fullFramePetSequence = (id, name, row, frameColumns, sprite) => {
    const scaleX = sprite.targetWidth / sprite.sourceWidth;
    const scaleY = sprite.targetHeight / sprite.sourceHeight;
    return frameSequence(id, name, row, frameColumns, {
      sourceX: 0, sourceY: 0, sourceWidth: sprite.frameWidth, sourceHeight: sprite.frameHeight,
      targetX: Math.round(sprite.targetX - sprite.sourceX * scaleX),
      targetY: Math.round(sprite.targetY - sprite.sourceY * scaleY),
      targetWidth: Math.round(sprite.frameWidth * scaleX),
      targetHeight: Math.round(sprite.frameHeight * scaleY)
    });
  };
  const DOG_SPRITE_GEOMETRY = Object.freeze({
    frameWidth: 32, frameHeight: 32, frameCount: 5,
    row: 0, sourceX: 1, sourceY: 13, sourceWidth: 29, sourceHeight: 19,
    targetX: 101, targetY: 66, targetWidth: 24, targetHeight: 16
  });
  const DOG_ANIMATIONS = [
    frameSequence('walk', 'Walk', 0, [0, 1, 2, 3, 4]),
    fullFramePetSequence('leap', 'Leap', 1, [0, 1, 2, 3, 4, 5], DOG_SPRITE_GEOMETRY)
  ];
  const DOG_SPRITE_SHEET = Object.freeze({
    ...DOG_SPRITE_GEOMETRY, defaultAnimationId: 'walk', animations: DOG_ANIMATIONS
  });
  const CAT_ANIMATION_FRAME_COUNTS = [
    4, 4, ...Array(4).fill(6), 14, 3, 4, 4, 5, 5, 8, 8, 3, 3, 3, 8, 8,
    ...Array(8).fill(5), 3, 3, 11, 11, 5, ...Array(6).fill(11), 5,
    ...Array(4).fill(11), 7, ...Array(12).fill(2), 10, 8, 10, 10, 3, 2, 3, 5, 5, 4
  ];
  const CAT_ANIMATIONS = createAtlasSequences('cat', 'Sequence',
    CAT_ANIMATION_FRAME_COUNTS,
    {
      2: 'Walk · Front', 3: 'Walk · Back',
      4: 'Walk · Right', 5: 'Walk · Left',
      13: 'Lick Paw · Front'
    },
    { 60: [0, 1, 5] });
  const CAT_SPRITE_SHEET = Object.freeze({
    frameWidth: 64, frameHeight: 64, frameCount: 8,
    row: 13, sourceX: 0, sourceY: 0, sourceWidth: 64, sourceHeight: 64,
    targetX: 96, targetY: 58, targetWidth: 32, targetHeight: 32,
    defaultAnimationId: 'cat-13', animations: CAT_ANIMATIONS
  });
  const BUNNY_ANIMATION_ROWS = [
    8, 8, 6, 6, 6, 6, 6, 6, 5, 6, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 9, 9, 9, 9, 0, 9, 0, 9,
    9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 4, 4, 8, 8, 5, 5, 6, 6, 8, 8,
    5, 5, 6, 6, 11, 11, 11, 11
  ];
  const BUNNY_ANIMATION_LABELS = {
    0: 'Turn Around',
    2: 'Scurry',
    8: 'Run · Side View',
    10: 'Run · Side View · Alternate',
    32: 'Hop · Front View',
  };
  const BUNNY_ANIMATIONS = Array.from(
    { length: BUNNY_ANIMATION_ROWS.length / 2 }, (_, sequenceIndex) => sequenceIndex
  ).flatMap(sequenceIndex => {
    const sourceRow = sequenceIndex * 2;
    const frameCount = Math.max(
      BUNNY_ANIMATION_ROWS[sourceRow], BUNNY_ANIMATION_ROWS[sourceRow + 1]
    );
    if (!frameCount) return [];
    return [frameSequence(
      `bunny-${sourceRow}`,
      BUNNY_ANIMATION_LABELS[sourceRow] ||
        `Sequence ${sequenceIndex + 1} (rows ${sourceRow}-${sourceRow + 1})`,
      sequenceIndex,
      Array.from({ length: frameCount }, (_, index) => index)
    )];
  });
  const BUNNY_SPRITE_SHEET = Object.freeze({
    frameWidth: 32, frameHeight: 32, frameCount: 9,
    row: 16, sourceX: 0, sourceY: 0, sourceWidth: 32, sourceHeight: 32,
    targetX: 96, targetY: 58, targetWidth: 32, targetHeight: 32,
    defaultAnimationId: 'bunny-32', animations: BUNNY_ANIMATIONS
  });
  const FOX_SPRITE_GEOMETRY = Object.freeze({
    frameWidth: 32, frameHeight: 32, frameCount: 5,
    row: 0, sourceX: 1, sourceY: 14, sourceWidth: 29, sourceHeight: 18,
    targetX: 103, targetY: 72, targetWidth: 15, targetHeight: 10
  });
  const FOX_ANIMATIONS = [
    frameSequence('walk', 'Walk', 0, [0, 1, 2, 3, 4]),
    fullFramePetSequence('leap', 'Leap', 1, [0, 1, 2, 3, 4, 5], FOX_SPRITE_GEOMETRY)
  ];
  const FOX_SPRITE_SHEET = Object.freeze({
    ...FOX_SPRITE_GEOMETRY, defaultAnimationId: 'walk', animations: FOX_ANIMATIONS
  });
  const WISP_ANIMATIONS = [frameSequence('float', 'Float', 0, [0, 1, 2, 3, 4])];
  const WISP_SPRITE_SHEET = Object.freeze({
    frameWidth: 32, frameHeight: 32, frameCount: 5,
    row: 0, sourceX: 9, sourceY: 5, sourceWidth: 14, sourceHeight: 22,
    targetX: 107, targetY: 62, targetWidth: 7, targetHeight: 11,
    defaultAnimationId: 'float', animations: WISP_ANIMATIONS
  });
  const OUTLINED_WISP_SPRITE_SHEET = Object.freeze({
    ...WISP_SPRITE_SHEET, sourceX: 8, sourceY: 4, sourceWidth: 16, sourceHeight: 24
  });
  const CHARACTER_EFFECT_FRAME_COUNT = 5;
  const ASSET_ROOT = './assets/gandalfhardcore/';
  const assetUrl = path => encodeURI(path);
  const COMPANION_ASSET_PATH = `${ASSET_ROOT}GandalfHardcore Pet companion/GandalfHardcore Pet companion/`;
  const CAT_ASSET_PATH = './assets/cat-PACK/PACK/';
  const dogVariants = [
    ['pet_trail_dog', 'Golden Trail Dog', 'GandalfHardcore doggy sheet.png'],
    ['pet_trail_dog_slate', 'Slate Trail Dog', 'GandalfHardcore doggy sheet 2.png'],
    ['pet_trail_dog_sandy', 'Sandy Trail Dog', 'GandalfHardcore doggy sheet 3.png'],
    ['pet_trail_dog_cream', 'Cream Trail Dog', 'GandalfHardcore doggy sheet 4.png'],
    ['pet_trail_dog_shadow', 'Shadow Trail Dog', 'GandalfHardcore doggy sheet 5.png']
  ].map(([id, name, file]) =>
    spritePet(id, name, assetUrl(`${COMPANION_ASSET_PATH}${file}`), DOG_SPRITE_SHEET, 150));
  const catVariants = [
    ['pet_black_cat', 'Black Cat', 'cat 1 (64х64).png'],
    ['pet_ginger_cat', 'Ginger Cat', 'cat 2 (64х64).png'],
    ['pet_white_cat', 'White Cat', 'cat 3 (64х64).png']
  ].map(([id, name, file]) =>
    spritePet(id, name, assetUrl(`${CAT_ASSET_PATH}${file}`), CAT_SPRITE_SHEET, 150));
  const bunny = spritePet('pet_bunny', 'Bunny',
    assetUrl('./assets/Bunny/Bunny 1 16x16 animation.png'), BUNNY_SPRITE_SHEET, 150);
  const foxAndWispPets = [
    spritePet('pet_trail_fox', 'Trail Fox', assetUrl(`${COMPANION_ASSET_PATH}GandalfHardcore fox.png`), FOX_SPRITE_SHEET, 300),
    spritePet('pet_blue_wisp', 'Blue Wisp', assetUrl(`${COMPANION_ASSET_PATH}GandalfHardcore Wisp.png`), WISP_SPRITE_SHEET, 500),
    spritePet('pet_blue_wisp_outline', 'Outlined Blue Wisp', assetUrl(`${COMPANION_ASSET_PATH}Wisp with outline.png`), OUTLINED_WISP_SPRITE_SHEET, 500)
  ];
  const PET_CATALOG = [
    { id: 'pet_none', name: 'No Companion', unlock: { type: 'starter' }, kind: 'none', imageSrc: null },
    ...dogVariants,
    ...catVariants,
    bunny,
    ...foxAndWispPets
  ];
  const PET_ID_ALIASES = new Map([
    ['pet_puppy_gold', 'pet_trail_dog'],
    ['pet_kitten_gray', 'pet_black_cat']
  ]);
  const BACKGROUND_CATALOG = [
    { id: 'bg_campfire', name: 'Campfire Night', unlock: { type: 'starter' }, imageSrc: './assets/backgrounds/campfire-night.png' },
    { id: 'bg_green_hills', name: 'Green Hills', unlock: { type: 'starter' }, imageSrc: './assets/backgrounds/green-hills-bg.png' },
    { id: 'bg_yellowstone', name: 'Yellowstone National Park', unlock: { type: 'park', parkId: 'yell' }, imageSrc: './assets/backgrounds/yellowstone-bg.png' },
    { id: 'bg_grand_canyon', name: 'Grand Canyon National Park', unlock: { type: 'park', parkId: 'grca' }, imageSrc: './assets/backgrounds/grand-canyon-bg.png' },
    { id: 'bg_redwood', name: 'Redwood National Park', unlock: { type: 'park', parkId: 'redw' }, imageSrc: './assets/backgrounds/redwood-bg.png' },
    { id: 'bg_arches', name: 'Arches National Park', unlock: { type: 'park', parkId: 'arch' }, imageSrc: './assets/backgrounds/arches-bg.png' },
    { id: 'bg_yosemite', name: 'Yosemite National Park', unlock: { type: 'park', parkId: 'yose' }, imageSrc: './assets/backgrounds/yosemite-bg.png' }
  ];
  const CAMPFIRE_SPRITE = Object.freeze({
    imageSrc: './assets/campfire/Small_sheet.png',
    frameWidth: 32,
    frameHeight: 32,
    frameCount: 8,
    frameDurationMs: 110,
    targetX: 38,
    targetY: 59,
    targetWidth: 20,
    targetHeight: 20
  });
  const STAGE_ANIMATION_INTERVAL_MS = CAMPFIRE_SPRITE.frameDurationMs;

  const CHARACTER_ASSET_ROOT = `${ASSET_ROOT}GandalfHardcore Character Asset Pack/GandalfHardcore Character Asset Pack/`;
  const HAIRSTYLE_ASSET_ROOT = `${ASSET_ROOT}GandalfHardcore 58x Hair/`;
  const spritePath = (folder, file) => `${folder}${file}`;
  const pairedPaths = (folder, maleFile, femaleFile = maleFile) => ({
    male: spritePath(folder, maleFile),
    female: spritePath(folder, femaleFile)
  });
  const oneGenderPath = (gender, path) => ({ [gender]: path });
  const equipmentItem = (id, name, field, paths, unlock = { type: 'coin', cost: 100 }) => ({
    id, name, field, paths, genders: Object.keys(paths),
    unlock: unlock.type === 'coin' ? { ...unlock, itemId: id } : unlock,
    imageSrc: null,
    ...(unlock.type === 'coin' ? { cost: unlock.cost } : {})
  });
  const levelItem = (id, name, field, paths, goal) =>
    equipmentItem(id, name, field, paths, { type: 'level', goal });
  const PACK = CHARACTER_ASSET_ROOT;
  const VARIANT_ASSET_ROOTS = {
    hats: `${ASSET_ROOT}GandalfHardcore 41x Hats/`,
    backLayers: `${ASSET_ROOT}GandalfHardcore Back layers s/`
  };
  const VARIANT_BASE_PATHS = Object.freeze({
    top: Object.freeze(pairedPaths(PACK, 'Male Clothing/Shirt v2.png',
      'Female Clothing/Green Corset v2.png')),
    bottoms: Object.freeze(pairedPaths(PACK, 'Male Clothing/Green Pants.png',
      'Female Clothing/Skirt.png')),
    backLayer: Object.freeze(pairedPaths(VARIANT_ASSET_ROOTS.backLayers, 'Cape green.png')),
    headwear: Object.freeze(pairedPaths(VARIANT_ASSET_ROOTS.hats,
      'Male Hat/Farming Hat M.png', 'Female Hat/Farming Hat F.png'))
  });
  const makeVariantItem = (id, name, field, unlock, palette, pattern = null) => ({
    ...equipmentItem(id, name, field, VARIANT_BASE_PATHS[field], unlock),
    variantSpec: { palette, ...(pattern ? { pattern } : {}),
      ...(pattern === 'hatBand' ? {
        bandRowsByGender: { male: [21], female: [22] },
        bandXRange: [39, 46]
      } : {}) }
  });
  const variantSpecForGender = (item, gender) => item.variantSpec?.bandRowsByGender
    ? { ...item.variantSpec, gender } : item.variantSpec;
  const palette = (shadow, base, highlight, extra = {}) => ({
    shadow, base, highlight, ...extra
  });
  const LEVEL_ITEMS = [
    levelItem('starter_shirt', 'Starter Shirt', 'top',
      pairedPaths(PACK, 'Male Clothing/Shirt v2.png', 'Female Clothing/Corset v2.png'), 1),
    levelItem('starter_pants', 'Starter Pants', 'bottoms',
      pairedPaths(PACK, 'Male Clothing/Pants.png', 'Female Clothing/Skirt.png'), 1),
    levelItem('simple_shoes', 'Simple Shoes', 'shoes',
      pairedPaths(PACK, 'Male Clothing/Shoes.png', 'Female Clothing/Boots.png'), 1),
    levelItem('walking_stick', 'Walking Stick', 'handItem',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 35x Hand Items/`,
        'Male Hand/Stick.png', 'Female Hand/Stick.png'), 2),
    levelItem('trail_boots', 'Trail Boots', 'shoes',
      pairedPaths(PACK, 'Male Clothing/Boots.png', 'Female Clothing/Boots.png'), 2),
    levelItem('explorer_backpack', 'Explorer Backpack', 'backLayer',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore Back layers s/`, 'Backpack.png'), 3),
    levelItem('traveler_cap', 'Traveler Cap', 'headwear',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 41x Hats/`, 'Male Hat/Male Blue cap.png',
        'Female Hat/Female Blue cap.png'), 3),
    levelItem('farming_hat', 'Forager Sun Hat', 'headwear',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 41x Hats/`, 'Male Hat/Farming Hat M.png',
        'Female Hat/Farming Hat F.png'), 4),
    levelItem('basket', 'Forager Basket', 'handItem',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 35x Hand Items/Female Hand/`, 'Basket.png'), 4),
    levelItem('flower', 'Forager Flower', 'handItem',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 35x Hand Items/Female Hand/`, 'Flower.png'), 4),
    levelItem('wayfarer_lantern', 'Back Lantern', 'backLayer',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore Back layers s/`, 'Male Lantern.png',
        'Female Lantern.png'), 5),
    levelItem('wayfarer_gloves', 'Wayfarer Gloves', 'arms',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore Arm Layers/Male/`, 'Gloves.png',
        '../Female/Opera Gloves.png'), 5),
    levelItem('mining_helmet', 'Mining Helmet', 'headwear',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 41x Hats/`, 'Male Hat/Male Mining Helmet.png',
        'Female Hat/Female Mining Helmet.png'), 6),
    levelItem('iron_pickaxe', 'Iron Pickaxe', 'handItem',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 35x Hand Items/Male Hand/`, 'Iron Pickaxe.png',
        '../Female Hand/Iron Pickaxe.png'), 6),
    levelItem('iron_axe', 'Iron Axe', 'handItem',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 35x Hand Items/Male Hand/`, 'Iron Axe.png',
        '../Female Hand/Iron Axe.png'), 6),
    levelItem('traveler_cape', 'Traveler Cape', 'backLayer',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore Back layers s/`, 'Cape green.png'), 7),
    levelItem('bandit_scarf', 'Bandit Scarf', 'face',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore Masks/`, 'Male Bandit Scarf.png',
        'Female Mask.png'), 7),
    levelItem('guard_helmet', 'Guard Helmet', 'headwear',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 41x Hats/Male Hat/`, 'Guard Helmet.png',
        '../Female Hat/Female Hat5.png'), 8),
    levelItem('circle_shield', 'Circle Shield', 'backLayer',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore Back layers s/`, 'Male Circle Shield.png',
        'Female Circle Shield.png'), 8),
    levelItem('iron_sword', 'Iron Sword', 'handItem',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 35x Hand Items/Male Hand/`, 'Iron Sword.png',
        '../Female Hand/Iron Sword.png'), 8),
    levelItem('chainmail_tunic', 'Chainmail Tunic', 'top',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 7x Male Clothing/`, 'Chainmail.png',
        '../GandalfHardcore 43x Female Clothing/Armored Corset.png'), 9),
    levelItem('viking_helmet', 'Viking Helmet', 'headwear',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 41x Hats/Male Hat/`, 'Viking Helmet.png',
        '../Female Hat/Headdress.png'), 9),
    levelItem('golden_pickaxe', 'Golden Pickaxe', 'handItem',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 35x Hand Items/Male Hand/`, 'Golden Pickaxe.png',
        '../Female Hand/Golden Pickaxe.png'), 9),
    levelItem('golden_sword', 'Golden Sword', 'handItem',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 35x Hand Items/Male Hand/`, 'Golden Sword.png',
        '../Female Hand/Golden Sword.png'), 9),
    levelItem('royal_headwear', 'Royal Chaperon / Headdress', 'headwear',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 41x Hats/Male Hat/`, 'Chaperon.png',
        '../Female Hat/Headdress.png'), 10),
    levelItem('diamond_sword', 'Diamond Sword', 'handItem',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 35x Hand Items/Male Hand/`, 'Diamond Sword.png',
        '../Female Hand/Diamond Sword.png'), 10),
    levelItem('diamond_pickaxe', 'Diamond Pickaxe', 'handItem',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore 35x Hand Items/Male Hand/`, 'Diamond Pickaxe.png',
        '../Female Hand/Diamond Pickaxe.png'), 10)
  ];
  const VARIANT_LEVEL_ITEMS = [
    makeVariantItem('pine_trail_flannel', 'Pine Trail Flannel', 'top', { type: 'level', goal: 2 },
      palette('#1d2921', '#4d704e', '#a5b694', { accent: '#29372d' }), 'plaid'),
    makeVariantItem('scout_cargo_pants', 'Scout Cargo Pants', 'bottoms', { type: 'level', goal: 3 },
      palette('#26291d', '#687249', '#b1ae80')),
    makeVariantItem('meadow_forager_tunic', 'Meadow Forager Tunic', 'top', { type: 'level', goal: 4 },
      palette('#30382d', '#849a73', '#d6ddbd', { accent: '#ede8cf' }), 'jacket'),
    makeVariantItem('wayfarer_field_vest', 'Wayfarer Field Vest', 'top', { type: 'level', goal: 5 },
      palette('#252b31', '#a39469', '#ded0a1', {
        sleeve: '#34475f', accent: '#665536'
      }), 'vest'),
    makeVariantItem('canyon_work_denim', 'Canyon Work Denim', 'bottoms', { type: 'level', goal: 6 },
      palette('#20283a', '#4c6388', '#9aaec9')),
    makeVariantItem('redwood_flannel_jacket', 'Redwood Flannel Jacket', 'top', { type: 'level', goal: 7 },
      palette('#321e23', '#8d454b', '#c7867d', { accent: '#36292d' }), 'plaid'),
    makeVariantItem('vanguard_tabard', 'Vanguard Tabard', 'top', { type: 'level', goal: 8 },
      palette('#323945', '#71849c', '#d4dbe4', { accent: '#3b5ba8' }), 'jacket'),
    makeVariantItem('highlander_gilded_pants', 'Highlander Breeches', 'bottoms', { type: 'level', goal: 9 },
      palette('#29241f', '#675642', '#b49a70')),
    makeVariantItem('sovereign_cartographer_coat', 'Sovereign Cartographer Coat', 'top',
      { type: 'level', goal: 10 },
      palette('#1d202b', '#41475c', '#c6b987', { accent: '#e1b94f' }), 'jacket')
  ];
  LEVEL_ITEMS.push(...VARIANT_LEVEL_ITEMS);
  const PARK_MILESTONE_ITEMS = [
    makeVariantItem('volunteer_park_tee', 'Volunteer Park Tee', 'top',
      { type: 'worldParks', goal: 5 },
      palette('#1c3429', '#365e45', '#88a36c', { accent: '#dfc05b' }), 'jacket'),
    makeVariantItem('ranger_hat_brown', 'Brown-Band Ranger Hat', 'headwear',
      { type: 'worldParks', goal: 10 },
      palette('#51402d', '#b79561', '#e0c88f', { band: '#684529' }), 'hatBand'),
    makeVariantItem('park_ranger_uniform', 'Park Ranger Uniform', 'top',
      { type: 'worldParks', goal: 15 },
      palette('#32372c', '#a49260', '#ded0a0', { accent: '#435238' }), 'buttons'),
    makeVariantItem('ranger_trail_pants', 'Ranger Trail Breeches', 'bottoms',
      { type: 'worldParks', goal: 25 },
      palette('#1e2a24', '#355b43', '#77926c')),
    makeVariantItem('ranger_hat_silver', 'Silver-Band Ranger Hat', 'headwear',
      { type: 'worldParks', goal: 35 },
      palette('#51402d', '#b79561', '#e0c88f', { band: '#c6d1dc' }), 'hatBand'),
    makeVariantItem('ranger_hat_gold', 'Golden Ranger Hat', 'headwear',
      { type: 'worldParks', goal: 50 },
      palette('#51402d', '#b79561', '#e0c88f', { band: '#edc04d' }), 'hatBand'),
    makeVariantItem('grand_warden_cloak', 'Grand Warden Cloak', 'backLayer',
      { type: 'worldParks', goal: 75 },
      palette('#172a21', '#315841', '#9d9b54', { accent: '#d0ae48' })),
    makeVariantItem('ranger_hat_diamond', 'Diamond Ranger Hat', 'headwear',
      { type: 'worldParks', goal: 100 },
      palette('#51402d', '#b79561', '#e0c88f', { band: ['#48d8e8', '#f5ffff'] }), 'hatBand')
  ];
  const ACHIEVEMENT_ITEMS = [
    makeVariantItem('khaki_trail_pants', 'Khaki Trail Pants', 'bottoms',
      { type: 'achievement', id: 'firstSteps' },
      palette('#363126', '#9d8a5d', '#d6c79b')),
    makeVariantItem('mist_rain_poncho', 'Mist Rain Poncho', 'top',
      { type: 'achievement', id: 'waterfalls_1' },
      palette('#39362a', '#bd9942', '#e8d181', { accent: '#43a5a1' }), 'jacket'),
    makeVariantItem('cavern_miner_suit', 'Deep Cavern Suit', 'top',
      { type: 'achievement', id: 'subterranean' },
      palette('#292e36', '#59616d', '#c89b49', { accent: '#d29d3e' }), 'jacket'),
    makeVariantItem('summit_down_parka', 'Summit Down Parka', 'top',
      { type: 'achievement', id: 'thinAir' },
      palette('#33424a', '#9ac6cf', '#f1f6f5', {
        sleeve: '#e4f1f2', accent: '#58777d'
      }), 'vest'),
    makeVariantItem('overland_canvas_jacket', 'Overland Canvas Jacket', 'top',
      { type: 'achievement', id: 'overlander' },
      palette('#382621', '#9b6042', '#d4aa74', { accent: '#cba46f' }), 'jacket'),
    makeVariantItem('mariner_pea_coat', 'Mariner Pea Coat', 'top',
      { type: 'achievement', id: 'mariner' },
      palette('#202b3a', '#344866', '#8395aa', { accent: '#d5b64e' }), 'jacket'),
    makeVariantItem('photographer_vest', "Photographer's Utility Vest", 'top',
      { type: 'achievement', id: 'focal' },
      palette('#292b2c', '#55594d', '#a5a58a', {
        sleeve: '#777552', accent: '#393c34'
      }), 'vest'),
    makeVariantItem('arctic_aurora_cloak', 'Arctic Aurora Cloak', 'backLayer',
      { type: 'achievement', id: 'longDark' },
      palette('#22263d', '#397d83', '#b694d0', { accent: '#6dd5cf' })),
    makeVariantItem('blue_ridge_flannel', 'Blue Ridge Flannel', 'top',
      { type: 'achievement', id: 'countryRoads' },
      palette('#25313b', '#4d6c91', '#a9bad0', { accent: '#d5b857' }), 'plaid'),
    makeVariantItem('alpine_timberline_jacket', 'Alpine Timberline Jacket', 'top',
      { type: 'achievement', id: 'rockyMountainHigh' },
      palette('#3a3020', '#b08a3e', '#e0c879', { accent: '#385641' }), 'jacket'),
    makeVariantItem('continental_cape', 'Continental Voyager Cape', 'backLayer',
      { type: 'achievement', id: 'fiftyNifty' },
      palette('#252636', '#35466e', '#a35a61', { accent: '#b34854' })),
    makeVariantItem('centennial_ranger_coat', 'Centennial Ranger Coat', 'top',
      { type: 'achievement', id: 'americaTheBeautiful' },
      palette('#191b20', '#383a3b', '#b49a53', { accent: '#e4c55a' }), 'jacket'),
    makeVariantItem('gaia_druid_mantle', 'Gaia Druid Mantle', 'backLayer',
      { type: 'achievement', id: 'gaiaWanderer' },
      palette('#1b3026', '#28734e', '#c7b34e', { accent: '#78b967' }))
  ];

  const SHOP_WARDROBE = [];
  const addShopItem = (id, name, field, paths, cost = 100) =>
    SHOP_WARDROBE.push(equipmentItem(id, name, field, paths, { type: 'coin', cost }));
  [
    ['green_shirt', 'Forest Shirt', 'Green Shirt v2.png', 'Green Corset v2.png'],
    ['blue_shirt', 'River Shirt', 'Blue Shirt v2.png', 'Blue Corset v2.png'],
    ['orange_shirt', 'Ember Shirt', 'orange Shirt v2.png', 'Orange Corset v2.png'],
    ['purple_shirt', 'Violet Shirt', 'Purple Shirt v2.png', 'Purple Corset v2.png']
  ].forEach(([id, name, male, female]) =>
    addShopItem(id, name, 'top', pairedPaths(PACK, `Male Clothing/${male}`,
      `Female Clothing/${female}`), 100));
  [
    ['green_pants', 'Forest Pants', 'Green Pants.png'],
    ['blue_pants', 'River Pants', 'Blue Pants.png'],
    ['orange_pants', 'Ember Pants', 'Orange Pants.png'],
    ['purple_pants', 'Violet Pants', 'Purple Pants.png']
  ].forEach(([id, name, file]) =>
    addShopItem(id, name, 'bottoms',
      oneGenderPath('male', `${PACK}Male Clothing/${file}`), 100));
  [
    ['blue_bodice', 'Blue Bodice', 'Blue Bodice.png'],
    ['green_bodice', 'Green Bodice', 'Green Bodice.png'],
    ['orange_bodice', 'Orange Bodice', 'Orange Bodice.png'],
    ['purple_bodice', 'Purple Bodice', 'Purple Bodice.png'],
    ['red_bodice', 'Red Bodice', 'Red Bodice.png'],
    ['blue_bodice_long_sleeves', 'Blue Bodice (Long Sleeves)', 'Blue Bodice Long Sleeves.png'],
    ['blue_bodice_mid_sleeves', 'Blue Bodice (Mid Sleeves)', 'Blue Bodice Mid Sleeves.png'],
    ['green_bodice_long_sleeves', 'Green Bodice (Long Sleeves)', 'Green Bodice Long Sleeves.png'],
    ['green_bodice_mid_sleeves', 'Green Bodice (Mid Sleeves)', 'Green Bodice Mid Sleeves.png'],
    ['orange_bodice_long_sleeves', 'Orange Bodice (Long Sleeves)', 'Orange Bodice Long Sleeves.png'],
    ['orange_bodice_mid_sleeves', 'Orange Bodice (Mid Sleeves)', 'Orange Bodice Mid Sleeves.png'],
    ['purple_bodice_long_sleeves', 'Purple Bodice (Long Sleeves)', 'Purple Bodice Long Sleeves.png'],
    ['purple_bodice_mid_sleeves', 'Purple Bodice (Mid Sleeves)', 'Purple Bodice Mid Sleeves.png'],
    ['red_bodice_long_sleeves', 'Red Bodice (Long Sleeves)', 'Red Bodice Long Sleeves.png'],
    ['red_bodice_mid_sleeves', 'Red Bodice (Mid Sleeves)', 'Red Bodice Mid Sleeves.png'],
    ['blue_corset_long_sleeves', 'Blue Corset (Long Sleeves)', 'Blue Corset Long Sleeves.png'],
    ['blue_corset_v2_long_sleeves', 'Blue Corset v2 (Long Sleeves)', 'Blue Corset v2 Long Sleeves.png'],
    ['green_corset_long_sleeves', 'Green Corset (Long Sleeves)', 'Green Corset Long Sleeves.png'],
    ['green_corset_v2_long_sleeves', 'Green Corset v2 (Long Sleeves)', 'Green Corset v2 Long Sleeves.png'],
    ['orange_corset_long_sleeves', 'Orange Corset (Long Sleeves)', 'Orange Corset Long Sleeves.png'],
    ['orange_corset_v2_long_sleeves', 'Orange Corset v2 (Long Sleeves)', 'Orange Corset v2 Long Sleeves.png'],
    ['purple_corset_long_sleeves', 'Purple Corset (Long Sleeves)', 'Purple Corset Long Sleeves.png'],
    ['purple_corset_v2_long_sleeves', 'Purple Corset v2 (Long Sleeves)', 'Purple Corset v2 Long Sleeves.png'],
    ['blue_bikini', 'Blue Bikini', 'Blue bikini.png'],
    ['green_bikini', 'Green Bikini', 'Green bikini.png'],
    ['orange_bikini', 'Orange Bikini', 'Orange bikini.png'],
    ['purple_bikini', 'Purple Bikini', 'Purple bikini.png'],
    ['red_bikini', 'Red Bikini', 'Red bikini.png'],
    ['blue_dress', 'Blue Dress', 'Blue dress.png'],
    ['fancy_blue_dress', 'Fancy Blue Dress', 'Fancy Blue Dress.png'],
    ['long_dress_blue', 'Long Blue Dress', 'Long dress blue.png'],
    ['long_dress_green', 'Long Green Dress', 'Long dress green.png'],
    ['long_dress_orange', 'Long Orange Dress', 'Long dress orange.png'],
    ['long_dress_purple', 'Long Purple Dress', 'Long dress purple.png'],
    ['long_dress_red', 'Long Red Dress', 'Long dress red.png'],
    ['queen_dress', 'Queen Dress', 'Queen Dress.png'],
    ['armored_corset', 'Armored Corset', 'Armored Corset.png']
  ].forEach(([id, name, file]) =>
    addShopItem(id, name, 'top', oneGenderPath('female',
      `${ASSET_ROOT}GandalfHardcore 43x Female Clothing/${file}`), 125));
  [
    ['short_skirt', 'Short Skirt', 'Short Skirt.png']
  ].forEach(([id, name, file]) =>
    addShopItem(id, name, 'bottoms', oneGenderPath('female',
      `${ASSET_ROOT}GandalfHardcore 43x Female Clothing/${file}`), 100));
  [
    ['black_thigh_high_boots', 'Black Thigh-High Boots', 'Black Thigh-High Boots.png'],
    ['brown_thigh_high_boots', 'Brown Thigh-High Boots', 'Brown Thigh-High Boots.png'],
    ['pink_thigh_high_boots', 'Pink Thigh-High Boots', 'Pink Thigh-High Boots.png'],
    ['red_thigh_high_boots', 'Red Thigh-High Boots', 'Red Thigh-High Boots.png']
  ].forEach(([id, name, file]) =>
    addShopItem(id, name, 'shoes', oneGenderPath('female',
      `${ASSET_ROOT}GandalfHardcore 43x Female Clothing/${file}`), 100));

  const hatFolder = `${ASSET_ROOT}GandalfHardcore 41x Hats/`;
  const addHat = (id, name, male, female, cost = 100) => addShopItem(id, name, 'headwear', {
    ...(male ? { male: `${hatFolder}${male}` } : {}),
    ...(female ? { female: `${hatFolder}${female}` } : {})
  }, cost);
  addHat('witch_hat', 'Witch Hat', null, 'Female Hat/Witch hat.png');
  addHat('santa_hat', 'Santa Hat', 'Male Hat/Male Santa hat.png', 'Female Hat/Female Santa hat.png');
  addHat('pumpkin_hat', 'Pumpkin Hat', 'Male Hat/Pumpkin hat.png', null);
  addHat('viking_horns', 'Viking Helmet with Horns',
    'Male Hat/Viking Helmet with horns.png', 'Female Hat/Headdress.png', 125);
  [
    ['green_cap', 'Green Cap', 'Green'],
    ['orange_cap', 'Orange Cap', 'Orange'],
    ['purple_cap', 'Purple Cap', 'Purple'],
    ['red_cap', 'Red Cap', 'Red']
  ].forEach(([id, name, color]) =>
    addHat(id, name, `Male Hat/Male ${color} cap.png`, `Female Hat/Female ${color} cap.png`));
  for (let index = 1; index <= 10; index++) {
    addHat(`male_hat_${index}`, `Wayfarer Hat ${index}`,
      `Male Hat/Male Hat${index}.png`, null);
  }
  for (let index = 1; index <= 5; index++) {
    addHat(`female_hat_${index}`, `Wayfarer Headdress ${index}`,
      null, `Female Hat/Female Hat${index}.png`);
    addHat(`bunny_ears_${index}`, `Bunny Ears ${index}`,
      null, `Female Hat/Bunny ears${index}.png`);
  }
  [
    ['plague_mask', 'Plague Mask', 'Male Plague Mask.png', 'Female Plague Mask.png'],
    ['face_mask', 'Face Mask', 'Male Mask.png', 'Female Mask.png'],
    ['face_paint', 'Blue Face Paint', 'Male Mask.png', 'Female Blue Face paint.png']
  ].forEach(([id, name, male, female]) =>
    addShopItem(id, name, 'face', pairedPaths(`${ASSET_ROOT}GandalfHardcore Masks/`, male, female), 125));

  for (let index = 1; index <= 5; index++) {
    addShopItem(`elven_ears_${index}`, `Elven Ears ${index}`, 'ears', pairedPaths(
      `${ASSET_ROOT}GandalfHardcore 10x Elven ears/`,
      `Male Ears/Elven Ears${index}.png`, `Female Ears/Elven Ears${index}.png`), 150);
  }
  [
    'Character effects blood.png', 'Character effects blood blue.png', 'Character effects blood green.png',
    'Character effects buff.png', 'Character effects buff blue.png', 'Character effects buff red.png',
    'Character effects curved blue.png', 'Character effects curved lines.png', 'Character effects curved orange.png',
    'Character effects debuff black.png', 'Character effects debuff gray brown.png', 'Character effects debuff.png',
    'Character effects hearts blue.png', 'Character effects hearts pink.png', 'Character effects hearts.png',
    'Character effects lines green.png', 'Character effects lines yellow.png', 'Character effects lines.png',
    'Character effects stars blue.png', 'Character effects stars pink.png', 'Character effects stars teal.png',
    'Character effects stars v2.png', 'Character effects stars white.png', 'Character effects stars.png'
  ].forEach((file, index) => addShopItem(`effect_${index + 1}`,
    file.replace(/^Character effects /, '').replace(/\.png$/, '').replace(/\b\w/g, letter => letter.toUpperCase()),
    'effect', pairedPaths(`${ASSET_ROOT}GandalfHardcore character effects/`, file), 125));
  [
    ['ghost', 'Ghost', 'Male Ghost skin.png', 'Female Ghost skin.png'],
    ['orc', 'Orc', 'Male Orc skin.png', 'Female Orc skin.png'],
    ['zombie', 'Zombie', 'Male Zombie skin.png', 'Female Zombie skin.png'],
    ['demon', 'Demon', 'Male Demon skin.png', 'Female Demon skin.png'],
    ['devil', 'Devil', 'Male Devil skin.png', 'Female Devil skin.png']
  ].forEach(([id, name, male, female]) =>
    addShopItem(`special_${id}`, `${name} Skin`, 'specialSkin',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore Special skin/`, male, female), 300));
  addShopItem('small_backpack', 'Small Backpack', 'backLayer',
    pairedPaths(`${ASSET_ROOT}GandalfHardcore Back layers s/`, 'Small Backpack.png'), 100);
  [
    ['cape_blue', 'Blue Cape', 'Cape blue.png'],
    ['cape_orange', 'Orange Cape', 'Cape orange.png'],
    ['cape_purple', 'Purple Cape', 'Cape purple.png'],
    ['cape_red', 'Red Cape', 'Cape red.png']
  ].forEach(([id, name, file]) =>
    addShopItem(id, name, 'backLayer',
      pairedPaths(`${ASSET_ROOT}GandalfHardcore Back layers s/`, file), 125));

  const PET_ACCESSORY_CATALOG = [
    equipmentItem('dog_hat', 'Dog Hat', 'petHat', pairedPaths(
      COMPANION_ASSET_PATH, 'GandalfHardcore doggy hat.png'), { type: 'coin', cost: 75 }),
    equipmentItem('dog_backpack', 'Dog Backpack', 'petBackpack', pairedPaths(
      COMPANION_ASSET_PATH, 'GandalfHardcore doggy backpack.png'), { type: 'coin', cost: 75 })
  ];
  const EQUIPMENT_CATALOG = [
    ...LEVEL_ITEMS, ...PARK_MILESTONE_ITEMS, ...ACHIEVEMENT_ITEMS,
    ...SHOP_WARDROBE, ...PET_ACCESSORY_CATALOG
  ];
  const EQUIPMENT_BY_FIELD = Object.freeze(Object.fromEntries(
    [...new Set(EQUIPMENT_CATALOG.map(item => item.field))].map(field =>
      [field, EQUIPMENT_CATALOG.filter(item => item.field === field)])));
  const EQUIPMENT_DEFAULTS = Object.freeze({
    top: 'starter_shirt', bottoms: 'starter_pants', shoes: 'simple_shoes',
    backLayer: '', effect: '', specialSkin: '', ears: '', arms: '', face: '',
    headwear: '', handItem: '', petHat: '', petBackpack: ''
  });
  const LEVEL_TRACK = Object.freeze([
    { level: 1, title: 'Fresh Recruit', itemIds: ['starter_shirt', 'starter_pants', 'simple_shoes'] },
    { level: 2, title: 'Trailwalker', itemIds: ['walking_stick', 'trail_boots', 'pine_trail_flannel'] },
    { level: 3, title: 'Scout', itemIds: ['explorer_backpack', 'traveler_cap', 'scout_cargo_pants'] },
    { level: 4, title: 'Forager', itemIds: ['farming_hat', 'basket', 'flower', 'meadow_forager_tunic'] },
    { level: 5, title: 'Wayfarer', itemIds: ['wayfarer_lantern', 'wayfarer_gloves', 'wayfarer_field_vest'] },
    { level: 6, title: 'Prospector', itemIds: ['mining_helmet', 'iron_pickaxe', 'iron_axe', 'canyon_work_denim'] },
    { level: 7, title: 'Ranger', itemIds: ['traveler_cape', 'bandit_scarf', 'redwood_flannel_jacket'] },
    { level: 8, title: 'Vanguard', itemIds: ['guard_helmet', 'circle_shield', 'iron_sword', 'vanguard_tabard'] },
    { level: 9, title: 'Highlander', itemIds: ['chainmail_tunic', 'viking_helmet', 'golden_pickaxe', 'golden_sword', 'highlander_gilded_pants'] },
    { level: 10, title: 'Cartographer Royal', itemIds: [
      'royal_headwear', 'diamond_sword', 'diamond_pickaxe', 'sovereign_cartographer_coat',
      'hair_fancy', 'hair_queen', 'hair_shield_maiden'
    ] }
  ]);
  const LEVEL_HAIR_REWARDS = Object.freeze([
    { id: 'hair_fancy', name: 'Fancy Hair', level: 10 },
    { id: 'hair_queen', name: 'Queen Hair', level: 10 },
    { id: 'hair_shield_maiden', name: 'Shield Maiden Hair', level: 10 }
  ]);

  const LEGACY_HAIR_STYLE_IDS = new Set(['short', 'bob', 'long', 'curls', 'braided']);
  const HAIR_COLOR_FILTERS = Object.freeze({
    brown: 'none',
    black: 'grayscale(1) brightness(.38)',
    blonde: 'sepia(1) saturate(2.2) hue-rotate(350deg) brightness(1.18)',
    red: 'sepia(1) saturate(3) hue-rotate(330deg)',
    silver: 'grayscale(1) brightness(1.45)',
    teal: 'sepia(1) saturate(2) hue-rotate(130deg)'
  });
  const CHARACTER_SPRITE_FRAME = Object.freeze({
    x: 24, y: 16, width: 32, height: 48, sheetWidth: 80
  });
  const CHARACTER_SPRITE_TARGET = Object.freeze({ x: 62, y: 39, width: 36, height: 43 });

  const DEFAULT_CHARACTER = Object.freeze({
    gender: 'male',
    skinTone: 'warm',
    hairStyle: 'hair_6',
    hairColor: 'brown',
    eyeColor: 'brown',
    bodyShape: 'straight',
    height: 'standard',
    hat: 'hat_none',
    outfit: 'outfit_recruit',
    accessory: 'accessory_none',
    pet: 'pet_none',
    petAnimation: '',
    background: 'bg_campfire',
    ...EQUIPMENT_DEFAULTS,
    purchasedItems: [],
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
  const imageLoadRedraws = new Map();
  const spriteVariantCache = new Map();
  const stageRenderers = new WeakMap();
  const stageAnimations = new WeakMap();
  const tabs = ['appearance', 'wardrobe', 'pets', 'backgrounds', 'shop', 'patron'];

  function normalizeCharacter(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const knownIds = catalog => new Set(catalog.map(item => item.id));
    const normalizeId = (raw, allowed, fallback) => allowed.has(raw) ? raw : fallback;
    const validColorId = (raw, catalog, fallback) =>
      normalizeId(raw, knownIds(catalog), fallback);
    const gender = source.gender === 'female' ? 'female' : 'male';
    const bodyShape = BODY_SHAPE_ALIASES.get(source.bodyShape) || source.bodyShape;
    const pet = PET_ID_ALIASES.get(source.pet) || source.pet;
    const legacyHairStyle = LEGACY_HAIR_STYLE_IDS.has(source.hairStyle);
    const hairStylesForGender = new Set(HAIR_STYLES
      .filter(style => style.genders.includes(gender))
      .map(style => style.id));
    const legacyOutfit = {
      outfit_recruit: ['starter_shirt', 'starter_pants'],
      outfit_flannel: ['green_shirt', 'green_pants'],
      outfit_vest: ['blue_shirt', 'blue_pants'],
      outfit_parka: ['orange_shirt', 'orange_pants'],
      outfit_sovereign: ['purple_shirt', 'purple_pants'],
      outfit_naturalist: ['green_shirt', 'green_pants'],
      outfit_master_naturalist: ['blue_shirt', 'blue_pants']
    }[source.outfit] || ['starter_shirt', 'starter_pants'];
    const availablePurchasedIds = new Set(EQUIPMENT_CATALOG
      .filter(item => item.unlock.type === 'coin').map(item => item.id)
      .concat(PET_CATALOG.filter(item => item.unlock.type === 'coin').map(item => item.id)));
    const purchasedItems = Array.isArray(source.purchasedItems)
      ? [...new Set(source.purchasedItems.filter(id => availablePurchasedIds.has(id)))]
      : [];
    const equipment = Object.fromEntries(Object.entries(EQUIPMENT_DEFAULTS).map(([field, fallback]) => {
      const legacyValue = field === 'top' ? legacyOutfit[0] :
        field === 'bottoms' ? legacyOutfit[1] : fallback;
      const allowed = EQUIPMENT_BY_FIELD[field] || [];
      const isOwned = candidate => candidate.unlock.type !== 'coin' ||
        purchasedItems.includes(candidate.id);
      const item = allowed.find(candidate =>
        candidate.id === source[field] && candidate.paths[gender] && isOwned(candidate));
      const defaultItem = allowed.find(candidate =>
        candidate.id === (source[field] == null ? legacyValue : source[field]) &&
        candidate.paths[gender] && isOwned(candidate));
      return [field, item?.id || defaultItem?.id || fallback];
    }));
    const selectedPet = PET_CATALOG.find(item => item.id === pet);
    const petAnimations = selectedPet?.spriteSheet?.animations || [];
    const defaultPetAnimation = petAnimations.find(animation =>
      animation.id === selectedPet.spriteSheet.defaultAnimationId) || petAnimations[0];
    const legacyBunnyRow = selectedPet?.id === 'pet_bunny' &&
      /^bunny-\d+$/.test(source.petAnimation || '')
      ? Number(source.petAnimation.slice('bunny-'.length)) : null;
    const requestedPetAnimation = Number.isInteger(legacyBunnyRow)
      ? `bunny-${legacyBunnyRow - legacyBunnyRow % 2}` : source.petAnimation;
    const petAnimation = petAnimations.some(animation => animation.id === requestedPetAnimation)
      ? requestedPetAnimation : defaultPetAnimation?.id || '';
    return {
      gender,
      skinTone: validColorId(source.skinTone, SKIN_TONES, DEFAULT_CHARACTER.skinTone),
      hairStyle: legacyHairStyle
        ? DEFAULT_CHARACTER.hairStyle
        : normalizeId(source.hairStyle, hairStylesForGender, DEFAULT_CHARACTER.hairStyle),
      hairColor: validColorId(source.hairColor, HAIR_COLORS, DEFAULT_CHARACTER.hairColor),
      eyeColor: validColorId(source.eyeColor, EYE_COLORS, DEFAULT_CHARACTER.eyeColor),
      bodyShape: normalizeId(bodyShape, knownIds(BODY_SHAPES), DEFAULT_CHARACTER.bodyShape),
      height: normalizeId(source.height, knownIds(HEIGHTS), DEFAULT_CHARACTER.height),
      hat: normalizeId(source.hat, knownIds(HAT_CATALOG), DEFAULT_CHARACTER.hat),
      outfit: normalizeId(source.outfit, knownIds(OUTFIT_CATALOG), DEFAULT_CHARACTER.outfit),
      accessory: normalizeId(source.accessory, knownIds(ACCESSORY_CATALOG), DEFAULT_CHARACTER.accessory),
      pet: (() => {
        return selectedPet && (selectedPet.unlock.type !== 'coin' ||
          purchasedItems.includes(selectedPet.id))
          ? selectedPet.id : DEFAULT_CHARACTER.pet;
      })(),
      petAnimation,
      background: normalizeId(source.background, knownIds(BACKGROUND_CATALOG), DEFAULT_CHARACTER.background),
      ...equipment,
      purchasedItems,
      proUnlocked: source.proUnlocked === true,
      donationUsd: Number.isFinite(Number(source.donationUsd))
        ? Math.max(0, Math.min(1000000, Number(source.donationUsd))) : 0
    };
  }

  function achievementProgress(stats = {}, achievements = []) {
    const progress = new Map();
    const completedTiers = new Set(Array.isArray(stats.completedAchievementTiers)
      ? stats.completedAchievementTiers.map(tier => tier?.key).filter(Boolean) : []);
    achievements.forEach(achievement => {
      const amount = Number(achievement.progress(stats));
      (achievement.tiers || []).forEach((tier, index) => {
        const goal = Number(typeof tier.goal === 'function' ? tier.goal(stats) : tier.goal);
        const completed = completedTiers.has(`${achievement.id}:${index}`);
        if ((Number.isFinite(amount) || completed) && Number.isFinite(goal)) {
          progress.set(achievement.id, {
            progress: Math.max(0, completed ? Math.max(Number.isFinite(amount) ? amount : 0, goal) : amount),
            goal: Math.max(0, goal),
            name: tier.title || achievement.title
          });
        }
      });
    });
    return progress;
  }

  const COINS_PER_RARITY = Object.freeze({
    'Tourist Trap': 10,
    'Beaten Path': 15,
    'Regional Staple': 20,
    'Deep Cut': 25,
    'Hidden Gem': 30,
    Uncharted: 35
  });
  const COINS_PER_ACHIEVEMENT_RARITY = Object.freeze({
    common: 25, uncommon: 50, rare: 100, epic: 200, legendary: 350, mythic: 500
  });
  const SHOP_ITEMS_BY_ID = new Map([
    ...EQUIPMENT_CATALOG.filter(item => item.unlock.type === 'coin'),
    ...PET_CATALOG.filter(item => item.unlock.type === 'coin')
  ].map(item => [item.id, item]));

  function coinSummary(stats = {}, appState = {}) {
    const expeditions = Array.isArray(appState.expeditions) ? appState.expeditions : [];
    const expeditionCoins = expeditions.reduce((total, expedition) => {
      const multiDay = typeof expedition.startDate === 'string' &&
        typeof expedition.endDate === 'string' && expedition.endDate > expedition.startDate;
      return total + 25 + (multiDay ? 10 : 0);
    }, 0);
    const parks = Array.isArray(stats.visitedParks) ? stats.visitedParks.length : 0;
    const rarityPlaces = stats.metadataProgress?.rarityEntities || [];
    const placeCoins = rarityPlaces.reduce((total, entity) => {
      if (!['poi', 'photon', 'place'].includes(entity.kind)) return total;
      return total + (COINS_PER_RARITY[entity.tier] || 0);
    }, 0);
    const countries = new Set(stats.visitedCountries || []);
    Object.entries(appState.regions || {}).forEach(([key, status]) => {
      if (key.startsWith('c:') && (status === 'v' || status === 'l')) countries.add(key.slice(2));
    });
    const visitedStates = new Set(stats.visitedStates || []);
    const subdivisions = new Set();
    Object.entries(appState.regions || {}).forEach(([key, status]) => {
      if (!key.startsWith('s:') || (status !== 'v' && status !== 'l')) return;
      const name = key.slice(2);
      if (!visitedStates.has(name)) subdivisions.add(name);
    });
    (stats.metadataProgress?.visitedSubdivisionIds || []).forEach(id => {
      if (typeof id === 'string' && id && !visitedStates.has(id)) subdivisions.add(id);
    });
    const counties = new Set(stats.metadataProgress?.visitedCountyIds || []);
    const directCounties = Object.entries(appState.counties || {})
      .filter(([, status]) => status === 'v' || status === 'l').map(([id]) => id);
    directCounties.forEach(id => counties.add(id));
    const levelCoins = Math.max(0, (Number(stats.level) || 1) - 1) * 50;
    const achievementCoins = (stats.completedAchievementTiers || []).reduce((total, achievement) =>
      total + (COINS_PER_ACHIEVEMENT_RARITY[String(achievement.rarity || '').toLowerCase()] || 0), 0);
    const earnedCoins = expeditionCoins + parks * 15 + placeCoins + countries.size * 15 +
      visitedStates.size * 5 + subdivisions.size * 5 + counties.size * 2 +
      levelCoins + achievementCoins;
    const purchasedItems = [...new Set(normalizeCharacter(appState.character).purchasedItems)];
    const spentCoins = purchasedItems.reduce((total, id) =>
      total + (SHOP_ITEMS_BY_ID.get(id)?.cost || 0), 0);
    return {
      earnedCoins,
      spentCoins,
      availableCoins: Math.max(0, earnedCoins - spentCoins)
    };
  }

  function unlockStatus(unlock, stats, character, achievements, appState = { character }) {
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
        description: `Visit ${unlock.goal} Global Parks (${Math.min(current, unlock.goal)}/${unlock.goal}).`
      };
    }
    if (unlock.type === 'park') {
      const visited = Array.isArray(stats.visitedParks) && stats.visitedParks.some(park =>
        (typeof park === 'string' ? park : park?.id) === unlock.parkId);
      const parkName = BACKGROUND_CATALOG.find(item => item.unlock?.parkId === unlock.parkId)?.name
        .replace(/ National Park$/, '') || 'the linked national park';
      return {
        unlocked: visited,
        description: visited ? `Visit recorded for ${parkName}.` : `Visit ${parkName} to unlock this scene.`
      };
    }
    if (unlock.type === 'achievement') {
      const result = achievements.get(unlock.id);
      return {
        unlocked: !!result && result.progress >= result.goal,
        description: result
          ? `Unlock Achievement: ${result.name} (${Math.min(result.progress, result.goal)}/${result.goal}).`
          : 'Unlock the linked achievement.'
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
    if (unlock.type === 'coin') {
      const owned = character.purchasedItems.includes(unlock.itemId);
      const available = coinSummary(stats, appState).availableCoins;
      return {
        unlocked: owned || available >= unlock.cost,
        description: owned ? 'Purchased.' : `${unlock.cost} Wayfarer Coins.`
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
      const redraws = new Set();
      if (redraw) redraws.add(redraw);
      imageLoadRedraws.set(item.imageSrc, redraws);
      image.onload = () => {
        const callbacks = imageLoadRedraws.get(item.imageSrc) || [];
        imageLoadRedraws.delete(item.imageSrc);
        callbacks.forEach(callback => callback());
      };
      image.onerror = () => {
        imageCache.set(item.imageSrc, null);
        imageLoadRedraws.delete(item.imageSrc);
        console.error(`Cartovella character asset failed to load: ${item.imageSrc}`);
      };
      imageCache.set(item.imageSrc, image);
      image.src = item.imageSrc;
    }
    const image = imageCache.get(item.imageSrc);
    if (image && !image.complete && redraw) imageLoadRedraws.get(item.imageSrc)?.add(redraw);
    return image && image.complete && image.naturalWidth ? image : null;
  }

  function parsePaletteColor(color) {
    const match = /^#([0-9a-f]{6})$/i.exec(color || '');
    if (!match) throw new Error(`Invalid sprite palette color: ${color}`);
    const value = Number.parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function processSpriteVariant(baseImage, variantSpec) {
    const sourcePath = baseImage?.currentSrc || baseImage?.src;
    const cacheKey = `${sourcePath}|${JSON.stringify(variantSpec)}`;
    if (spriteVariantCache.has(cacheKey)) return spriteVariantCache.get(cacheKey);
    const width = baseImage?.naturalWidth || baseImage?.width || 0;
    const height = baseImage?.naturalHeight || baseImage?.height || 0;
    if (!sourcePath || width < 80 || height < 64 || width % 80 !== 0 || height % 64 !== 0) {
      throw new Error(`Sprite variant source must be an aligned 80x64 sheet: ${sourcePath || 'unknown source'}`);
    }
    if (!variantSpec?.palette) throw new Error(`Sprite variant palette missing: ${sourcePath}`);
    const colors = Object.fromEntries(['shadow', 'base', 'highlight', 'accent', 'sleeve', 'band']
      .filter(key => variantSpec.palette[key] &&
        !(key === 'band' && Array.isArray(variantSpec.palette[key])))
      .map(key => [key, parsePaletteColor(variantSpec.palette[key])]));
    const bandColors = Array.isArray(variantSpec.palette.band)
      ? variantSpec.palette.band.map(parsePaletteColor)
      : colors.band ? [colors.band] : [];
    if (!colors.shadow || !colors.base || !colors.highlight) {
      throw new Error(`Sprite variant requires shadow, base, and highlight colors: ${sourcePath}`);
    }
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : typeof document !== 'undefined' && typeof document.createElement === 'function'
        ? document.createElement('canvas') : null;
    if (!canvas) throw new Error('Canvas support is required to render sprite variants.');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error(`2D canvas context unavailable for sprite variant: ${sourcePath}`);
    context.drawImage(baseImage, 0, 0);
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;
    const selectedBandRows = variantSpec.bandRowsByGender?.[variantSpec.gender] ||
      variantSpec.bandRows || [];
    const bandRows = new Set(selectedBandRows);
    const [bandLeft, bandRight] = variantSpec.bandXRange || [0, 79];
    for (let y = 0; y < height; y++) {
      const localY = y % 64;
      for (let x = 0; x < width; x++) {
        const localX = x % 80;
        const index = (y * width + x) * 4;
        const alpha = data[index + 3];
        if (alpha === 0) continue;
        const luminance = (0.2126 * data[index] + 0.7152 * data[index + 1] +
          0.0722 * data[index + 2]) / 255;
        if (luminance < 0.20) continue;
        const mapped = luminance < 0.42 ? colors.shadow
          : luminance < 0.74 ? colors.base : colors.highlight;
        let output = mapped;
        const isMidtone = luminance >= 0.20 && luminance < 0.74;
        switch (variantSpec.pattern) {
          case 'plaid':
            if (isMidtone && (localX % 4 === 0 || localY % 4 === 0)) output = colors.accent;
            break;
          case 'vest':
            {
              const vestPanel = localY === 36
                ? localX === 38 || localX === 42
                : localY === 37
                  ? (localX >= 37 && localX <= 38) || (localX >= 42 && localX <= 43)
                  : localY === 46
                    ? localX >= 37 && localX <= 43
                    : localY >= 38 && localY <= 45 && localX >= 35 && localX <= 45;
              output = vestPanel ? mapped : colors.sleeve;
              const pocket = (localY === 39 &&
                  (localX === 37 || localX === 38 || localX === 42 || localX === 43)) ||
                (localY === 40 && (localX === 37 || localX === 43));
              if (vestPanel && pocket && colors.accent) {
                output = colors.accent;
              }
            }
            break;
          case 'buttons':
            if (localX === (variantSpec.buttonX ?? 40) &&
                (variantSpec.buttonRows || [37, 40, 43, 46]).includes(localY)) {
              output = colors.accent;
            }
            break;
          case 'jacket':
            break;
          case 'hatBand':
            if (bandRows.has(localY) && localX >= bandLeft && localX <= bandRight) {
              if (!bandColors.length) throw new Error(`Sprite hat-band color missing: ${sourcePath}`);
              output = bandColors[localX % bandColors.length];
            }
            break;
          case undefined:
          case null:
          case 'solid':
            break;
          default:
            throw new Error(`Unsupported sprite pattern "${variantSpec.pattern}" for ${sourcePath}`);
        }
        if (!output) throw new Error(`Sprite variant palette incomplete for pattern "${variantSpec.pattern}".`);
        data[index] = output[0];
        data[index + 1] = output[1];
        data[index + 2] = output[2];
        data[index + 3] = alpha;
      }
    }
    context.putImageData(imageData, 0, 0);
    spriteVariantCache.set(cacheKey, canvas);
    return canvas;
  }

  function characterSpriteAssets(value) {
    const character = normalizeCharacter(value);
    const genderName = character.gender === 'female' ? 'Female' : 'Male';
    const skinIndex = SKIN_TONES.findIndex(tone => tone.id === character.skinTone) + 1;
    const hairCatalog = HAIR_STYLES.filter(style => style.genders.includes(character.gender));
    const hair = getItem(hairCatalog, character.hairStyle);
    const hairFolder = hair.fileName
      ? '28x Male Hair' : character.gender === 'female' ? '30x Female Hair' : '28x Male Hair';
    const hairFile = hair.fileName || `${genderName} Hair${hair.sheet}.png`;
    const equipmentLayer = (field, layer) => {
      const item = (EQUIPMENT_BY_FIELD[field] || []).find(candidate => candidate.id === character[field]);
      const path = item?.paths[character.gender];
      return path ? {
        layer, imageSrc: assetUrl(path),
        ...(item.variantSpec ? {
          variantSpec: variantSpecForGender(item, character.gender)
        } : {})
      } : null;
    };
    const specialSkin = equipmentLayer('specialSkin', 'base');
    const layers = [
      equipmentLayer('backLayer', 'back'),
      equipmentLayer('effect', 'effect'),
      specialSkin || {
        layer: 'base',
        imageSrc: assetUrl(`${CHARACTER_ASSET_ROOT}Character skin colors/${genderName} Skin${skinIndex}.png`)
      },
      equipmentLayer('ears', 'ears'),
      equipmentLayer('bottoms', 'bottoms'),
      equipmentLayer('shoes', 'shoes'),
      equipmentLayer('top', 'top'),
      equipmentLayer('arms', 'arms'),
      {
        layer: 'hair',
        imageSrc: assetUrl(`${HAIRSTYLE_ASSET_ROOT}${hairFolder}/${hairFile}`),
        filter: hairColorFilter(character.hairColor)
      },
      equipmentLayer('face', 'face'),
      equipmentLayer('headwear', 'headwear'),
      equipmentLayer('handItem', 'hand')
    ].filter(Boolean);
    return layers;
  }

  function hairColorFilter(colorId) {
    return HAIR_COLOR_FILTERS[colorId] || 'none';
  }

  function pixel(ctx, x, y, width, height, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  }

  function drawCampfire(ctx, redraw, frameIndex = 0) {
    const image = getImage(CAMPFIRE_SPRITE, redraw);
    if (!image) return;
    const frame = Math.max(0, frameIndex) % CAMPFIRE_SPRITE.frameCount;
    ctx.drawImage(
      image,
      frame * CAMPFIRE_SPRITE.frameWidth, 0,
      CAMPFIRE_SPRITE.frameWidth, CAMPFIRE_SPRITE.frameHeight,
      CAMPFIRE_SPRITE.targetX, CAMPFIRE_SPRITE.targetY,
      CAMPFIRE_SPRITE.targetWidth, CAMPFIRE_SPRITE.targetHeight
    );
  }

  function stopStageAnimation(canvas) {
    const animation = stageAnimations.get(canvas);
    if (animation && typeof window !== 'undefined') window.clearInterval(animation.intervalId);
    stageAnimations.delete(canvas);
  }

  function isStageVisible(canvas) {
    return canvas.isConnected !== false &&
      (typeof canvas.getClientRects !== 'function' || canvas.getClientRects().length > 0);
  }

  function startStageAnimation(canvas) {
    if (typeof window === 'undefined' || stageAnimations.has(canvas) || canvas.isConnected === false) return;
    const animation = { tick: 0, intervalId: 0 };
    const tick = () => {
      if (canvas.isConnected === false || !stageRenderers.has(canvas)) {
        stopStageAnimation(canvas);
        return;
      }
      if (!isStageVisible(canvas) ||
        (typeof document !== 'undefined' && document.visibilityState === 'hidden') ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      animation.tick++;
      stageRenderers.get(canvas)?.();
    };
    stageAnimations.set(canvas, animation);
    animation.intervalId = window.setInterval(tick, STAGE_ANIMATION_INTERVAL_MS);
  }

  function drawBackground(ctx, background, redraw) {
    const image = getImage(background, redraw);
    if (image) {
      ctx.drawImage(image, 0, 0, 160, 90);
      return;
    }
    pixel(ctx, 0, 0, 160, 90, '#101a35');
    pixel(ctx, 0, 57, 160, 33, '#26364d');
    pixel(ctx, 0, 72, 160, 18, '#406044');
    for (let index = 0; index < 22; index++) {
      pixel(ctx, (index * 37 + 11) % 158, (index * 19 + 5) % 43, index % 4 === 0 ? 2 : 1, 1, '#e8dfae');
    }
    pixel(ctx, 12, 42, 36, 17, '#1d2b40');
    pixel(ctx, 100, 38, 48, 21, '#1d2b40');
    pixel(ctx, 25, 52, 20, 7, '#304057');
    pixel(ctx, 112, 49, 30, 9, '#304057');
    pixel(ctx, 18, 70, 20, 3, '#553b2f');
    pixel(ctx, 22, 63, 4, 9, '#d78339');
    pixel(ctx, 28, 60, 4, 12, '#f3bd59');
    pixel(ctx, 32, 64, 3, 8, '#df6136');
  }

  function drawCharacterSprite(ctx, value, redraw = () => {}, effectFrame = 0, bobOffset = 0) {
    const target = CHARACTER_SPRITE_TARGET;
    const character = normalizeCharacter(value);
    characterSpriteAssets(character).forEach(layer => {
      const baseImage = getImage(layer, redraw);
      const image = baseImage && layer.variantSpec
        ? processSpriteVariant(baseImage, layer.variantSpec) : baseImage;
      if (image) {
        if (layer.filter) {
          ctx.save();
          ctx.filter = layer.filter;
        }
        const layerFrame = layer.layer === 'effect'
          ? ((Math.max(0, effectFrame) % CHARACTER_EFFECT_FRAME_COUNT) * CHARACTER_SPRITE_FRAME.sheetWidth)
          : 0;
        ctx.drawImage(
          image,
          layerFrame + CHARACTER_SPRITE_FRAME.x,
          CHARACTER_SPRITE_FRAME.y,
          CHARACTER_SPRITE_FRAME.width, CHARACTER_SPRITE_FRAME.height,
          target.x, target.y + bobOffset, target.width, target.height
        );
        if (layer.filter) ctx.restore();
      }
    });
  }

  function petAnimationFor(pet, animationId = '') {
    const sprite = pet?.spriteSheet;
    if (!sprite) return null;
    return sprite.animations?.find(animation => animation.id === animationId) ||
      sprite.animations?.find(animation => animation.id === sprite.defaultAnimationId) ||
      sprite.animations?.[0] ||
      frameSequence('default', 'Default', sprite.row || 0,
        Array.from({ length: sprite.frameCount }, (_, index) => index));
  }

  function drawPet(ctx, pet, redraw, frameIndex = 0, animationId = '') {
    if (pet.id === 'pet_none') return;
    const image = getImage(pet, redraw);
    if (pet.spriteSheet) {
      if (!image) return;
      const sprite = pet.spriteSheet;
      const animation = petAnimationFor(pet, animationId);
      const frameColumns = animation?.frameColumns ||
        Array.from({ length: sprite.frameCount }, (_, index) => index);
      const frame = frameColumns[Math.max(0, frameIndex) % frameColumns.length];
      ctx.drawImage(
        image,
        frame * (animation?.frameStride ?? sprite.frameWidth) +
          (animation?.sourceX ?? sprite.sourceX ?? 0),
        (animation?.row ?? sprite.row ?? 0) * sprite.frameHeight +
          (animation?.sourceY ?? sprite.sourceY),
        animation?.sourceWidth ?? sprite.sourceWidth,
        animation?.sourceHeight ?? sprite.sourceHeight,
        animation?.targetX ?? sprite.targetX,
        animation?.targetY ?? sprite.targetY,
        animation?.targetWidth ?? sprite.targetWidth,
        animation?.targetHeight ?? sprite.targetHeight
      );
    }
  }

  function drawPetAccessory(ctx, character, field, redraw, frameIndex = 0, animationId = '') {
    if (!character.pet.startsWith('pet_trail_dog')) return;
    const item = PET_ACCESSORY_CATALOG.find(candidate => candidate.id === character[field]);
    const path = item?.paths[character.gender];
    if (!path) return;
    const image = getImage({ imageSrc: assetUrl(path) }, redraw);
    if (!image) return;
    const sprite = getItem(PET_CATALOG, character.pet).spriteSheet;
    const scaleX = sprite.targetWidth / sprite.sourceWidth;
    const scaleY = sprite.targetHeight / sprite.sourceHeight;
    // Preserve the sheet's shared origin, including hat pixels above the dog's crop.
    const animation = petAnimationFor(getItem(PET_CATALOG, character.pet), animationId);
    const frameColumns = animation?.frameColumns ||
      Array.from({ length: sprite.frameCount }, (_, index) => index);
    const frame = frameColumns[Math.max(0, frameIndex) % frameColumns.length];
    ctx.drawImage(image, frame * sprite.frameWidth,
      (animation?.row ?? sprite.row ?? 0) * sprite.frameHeight,
      sprite.frameWidth, sprite.frameHeight,
      sprite.targetX - sprite.sourceX * scaleX,
      sprite.targetY - sprite.sourceY * scaleY,
      sprite.frameWidth * scaleX, sprite.frameHeight * scaleY);
  }

  function drawStage(canvas, value, options = {}, animationTick = 0) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const character = normalizeCharacter(value);
    const activeBackground = getItem(BACKGROUND_CATALOG, character.background);
    const activePet = getItem(PET_CATALOG, character.pet);
    const redraw = () => {
      if (canvas.isConnected !== false) stageRenderers.get(canvas)?.();
    };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    stageRenderers.set(canvas, () => drawStage(canvas, character, options,
      stageAnimations.get(canvas)?.tick ?? 0));
    const tick = Math.max(0, animationTick);
    const petFrame = Math.floor(tick / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(canvas.width / 160, canvas.width / 160);
    drawBackground(ctx, activeBackground, redraw);
    if (activeBackground.id === 'bg_campfire') {
      drawCampfire(ctx, redraw, tick % CAMPFIRE_SPRITE.frameCount);
    }
    drawCharacterSprite(ctx, character, redraw, petFrame % CHARACTER_EFFECT_FRAME_COUNT);
    drawPet(ctx, activePet, redraw, petFrame, character.petAnimation);
    drawPetAccessory(ctx, character, 'petBackpack', redraw, petFrame, character.petAnimation);
    drawPetAccessory(ctx, character, 'petHat', redraw, petFrame, character.petAnimation);
    pixel(ctx, 0, 89, 160, 1, '#84946d');
    ctx.restore();
    startStageAnimation(canvas);
  }

  function renderAvatar(canvas, value) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const character = normalizeCharacter(value);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const redraw = () => {
      if (canvas.isConnected !== false) renderAvatar(canvas, character);
    };
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    const scale = Math.min(canvas.width / 80, canvas.height / 48);
    ctx.translate((canvas.width - 80 * scale) / 2, (canvas.height - 48 * scale) / 2);
    ctx.scale(scale, scale);
    characterSpriteAssets(character).forEach(layer => {
      const baseImage = getImage(layer, redraw);
      const image = baseImage && layer.variantSpec
        ? processSpriteVariant(baseImage, layer.variantSpec) : baseImage;
      if (!image) return;
      if (layer.filter) {
        ctx.save();
        ctx.filter = layer.filter;
      }
      ctx.drawImage(image, 0, 0, 80, 48, 0, 0, 80, 48);
      if (layer.filter) ctx.restore();
    });
    ctx.restore();
  }

  function optionMarkup(label, field, options, value, disabled, includeLockedOptions = false, placeholder = '') {
    return `<label class="block text-xs text-slate-300">${escapeHtml(label)}
      <select data-character-field="${escapeHtml(field)}" ${disabled ? 'disabled' : ''}
        class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-50">
        ${placeholder ? `<option value="" selected disabled>${escapeHtml(placeholder)}</option>` : ''}
        ${options.map(option => `<option value="${escapeHtml(option.id)}" ${option.id === value ? 'selected' : ''}
          ${includeLockedOptions && option.disabled ? 'disabled' : ''}>${escapeHtml(option.name)}</option>`).join('')}
      </select>
    </label>`;
  }

  function characterThumbnailMarkup(character) {
    const assets = characterSpriteAssets(character);
    return `<span aria-hidden="true" class="relative block h-10 w-10 shrink-0 overflow-hidden rounded bg-slate-900">
      ${assets.map(layer => `<img src="${escapeHtml(layer.imageSrc)}" alt="" class="absolute left-0 top-0 max-w-none"
        loading="lazy" style="width:400px;height:224px;image-rendering:pixelated;${layer.filter ? `filter:${layer.filter}` : ''}">`).join('')}
    </span>`;
  }

  function hairPresetOptions(character) {
    const styles = HAIR_STYLES.filter(style => style.genders.includes(character.gender));
    return styles.flatMap((style, index) => HAIR_COLORS.map(color => {
      const levelReward = LEVEL_HAIR_REWARDS.find(reward => reward.id === style.id);
      return {
        id: `${style.id}::${color.id}`,
        name: `Hairstyle ${index + 1}: ${color.name}`,
        hairStyle: style.id,
        hairColor: color.id,
        unlock: levelReward ? { type: 'level', goal: levelReward.level } : { type: 'starter' }
      };
    }));
  }

  function hairThumbnailMarkup(character) {
    return `<canvas data-hair-preview="true" data-gender="${escapeHtml(character.gender)}"
      data-skin-tone="${escapeHtml(character.skinTone)}" data-outfit="${escapeHtml(character.outfit)}"
      data-hair-style="${escapeHtml(character.hairStyle)}" data-hair-color="${escapeHtml(character.hairColor)}"
      width="40" height="40" aria-hidden="true"
      class="block h-10 w-10 shrink-0 rounded bg-slate-900"></canvas>`;
  }

  function renderHairPreview(canvas) {
    if (!canvas || canvas.isConnected === false) return;
    const character = normalizeCharacter({
      gender: canvas.dataset.gender,
      skinTone: canvas.dataset.skinTone,
      outfit: canvas.dataset.outfit,
      hairStyle: canvas.dataset.hairStyle,
      hairColor: canvas.dataset.hairColor
    });
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(1.25, 1.25);
    ctx.translate(-60, -34);
    drawCharacterSprite(ctx, character, () => renderHairPreview(canvas));
    ctx.restore();
  }

  function renderHairPreviews(container) {
    if (typeof container.querySelectorAll !== 'function') return;
    container.querySelectorAll('canvas[data-hair-preview]').forEach(canvas => {
      const details = canvas.closest('details');
      if (details && !details.open && !canvas.closest('summary')) return;
      renderHairPreview(canvas);
    });
  }

  function wardrobeSwatchMarkup(item, symbol) {
    return `<span aria-hidden="true" class="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-slate-500 text-lg"
      style="background-color:${escapeHtml(item.color || '#475569')}">${symbol}</span>`;
  }

  function visualDropdownMarkup(label, field, options, value, disabled, renderChoice) {
    const selected = options.find(option => option.id === value) || options[0] ||
      { id: '', name: 'None' };
    return `<div class="block text-xs text-slate-300">
      <span class="block">${escapeHtml(label)}</span>
      <details class="relative mt-1">
        <summary ${disabled ? 'aria-disabled="true"' : ''}
          class="flex h-16 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 ${disabled ? 'opacity-50' : 'hover:border-slate-500'}">
          <span class="flex min-w-0 items-center gap-2">${renderChoice(selected, true)}
            <span class="truncate">${escapeHtml(selected.name)}</span>
          </span>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" class="h-4 w-4 shrink-0 text-slate-400">
            <path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </summary>
        <div class="visual-dropdown-options absolute left-0 right-0 z-[70] mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl">
          ${options.map(option => `<button type="button" data-character-field="${escapeHtml(field)}"
            data-character-id="${escapeHtml(option.id)}" aria-pressed="${option.id === value}"
            ${disabled || option.disabled ? 'disabled' : ''}
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${option.id === value ? 'bg-amber-950/60 text-amber-200' : 'text-slate-200 hover:bg-slate-800'} disabled:cursor-not-allowed disabled:opacity-50">
            ${renderChoice(option, false)}<span>${escapeHtml(option.name)}</span>
          </button>`).join('')}
        </div>
      </details>
    </div>`;
  }

  function catalogOptions(catalog, value, stats, character, achievements,
    selectedLabel = 'Selected', appState = { character }) {
    return catalog.map(item => {
        const status = unlockStatus(item.unlock, stats, character, achievements, appState);
        const selected = item.id === value;
        const isCoinItem = item.unlock?.type === 'coin';
        const owned = isCoinItem && character.purchasedItems.includes(item.id);
        const description = isCoinItem
          ? owned ? selected ? ` — ${selectedLabel}` : ' — Owned'
            : status.unlocked ? ` — ${item.cost} coins` : ` — 🔒 ${item.cost} coins`
          : status.unlocked ? selected ? ` — ${selectedLabel}` : ''
            : ` — 🔒 ${status.description}`;
        return {
          ...item, name: item.name + description, disabled: !status.unlocked,
          canCycle: status.unlocked && (!isCoinItem || owned)
        };
      });
  }

  function equipmentOptions(field, character, stats, achievements, appState) {
    const choices = (EQUIPMENT_BY_FIELD[field] || [])
      .filter(item => item.paths[character.gender]);
    const canClear = !['top', 'bottoms', 'shoes'].includes(field);
    if (canClear) choices.unshift({
      id: '', name: 'None', field, paths: {}, unlock: { type: 'starter' }, imageSrc: null
    });
    return catalogOptions(choices, character[field], stats, character, achievements, 'Equipped', appState);
  }

  function equipmentThumbnailMarkup(item, gender) {
    const path = item.paths?.[gender];
    const isPetAccessory = item.field === 'petHat' || item.field === 'petBackpack';
    if (path && item.variantSpec) {
      return `<canvas data-sprite-variant-preview="${escapeHtml(item.id)}"
        data-gender="${escapeHtml(gender)}" width="40" height="40" aria-hidden="true"
        class="block h-10 w-10 shrink-0 rounded bg-slate-900"></canvas>`;
    }
    return `<span aria-hidden="true" class="relative block h-10 w-10 shrink-0 overflow-hidden rounded bg-slate-900">
      ${path ? `<img src="${escapeHtml(assetUrl(path))}" alt="" class="absolute left-0 top-0 max-w-none"
        style="width:${isPetAccessory ? 240 : 400}px;height:${isPetAccessory ? 80 : 224}px;image-rendering:pixelated">` : ''}
    </span>`;
  }

  function renderSpriteVariantPreviews(container) {
    if (typeof container.querySelectorAll !== 'function') return;
    container.querySelectorAll('canvas[data-sprite-variant-preview]').forEach(canvas => {
      const details = canvas.closest('details');
      if (details && !details.open && !canvas.closest('summary')) return;
      const item = EQUIPMENT_CATALOG.find(candidate =>
        candidate.id === canvas.dataset.spriteVariantPreview);
      const path = item?.paths?.[canvas.dataset.gender];
      if (!item?.variantSpec || !path) return;
      const baseImage = getImage({ imageSrc: assetUrl(path) },
        () => renderSpriteVariantPreviews(container));
      if (!baseImage) return;
      const image = processSpriteVariant(baseImage, variantSpecForGender(item, canvas.dataset.gender));
      const context = canvas.getContext('2d');
      if (!context) return;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, 80, 64, 0, 4, 40, 32);
    });
  }

  function coinIconMarkup() {
    const path = assetUrl(`${ASSET_ROOT}GandalfHardcore Emojis and Icons/Coin.png`);
    return `<span aria-hidden="true" class="inline-block h-4 w-4 shrink-0 bg-no-repeat"
      style="background-image:url('${path}');background-size:192px 16px;background-position:0 0"></span>`;
  }

  function petThumbnailMarkup(pet) {
    return `<canvas data-pet-preview="${escapeHtml(pet.id)}" width="72" height="48"
      aria-hidden="true" class="h-12 w-[72px] shrink-0 rounded bg-slate-900"></canvas>`;
  }

  function renderPetPreview(canvas, pet) {
    if (!canvas || canvas.isConnected === false) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pet.kind === 'none') {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(36, 24, 12, 0, Math.PI * 2);
      ctx.moveTo(27, 33);
      ctx.lineTo(45, 15);
      ctx.stroke();
      return;
    }
    ctx.save();
    ctx.scale(2, 2);
    ctx.translate(-96, -55);
    drawPet(ctx, pet, () => renderPetPreview(canvas, pet));
    ctx.restore();
  }

  function renderPetPreviews(container) {
    if (typeof container.querySelectorAll !== 'function') return;
    container.querySelectorAll('canvas[data-pet-preview]').forEach(canvas => {
      const details = canvas.closest('details');
      if (details && !details.open && !canvas.closest('summary')) return;
      const pet = getItem(PET_CATALOG, canvas.dataset.petPreview);
      renderPetPreview(canvas, pet);
    });
  }

  function positionDropdown(details, container) {
    if (!details.open) {
      details.classList.remove('drop-up');
      return;
    }
    const list = details.querySelector('.visual-dropdown-options');
    const panel = container.closest('#tabContent-passport');
    if (!list || !panel) return;
    const dropdown = details.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const menuHeight = Math.min(list.scrollHeight, 256);
    const spaceBelow = Math.min(bounds.bottom, window.innerHeight) - dropdown.bottom;
    const spaceAbove = dropdown.top - Math.max(bounds.top, 0);
    details.classList.toggle('drop-up', spaceBelow < menuHeight + 8 && spaceAbove > spaceBelow);
  }

  function backgroundThumbnailMarkup(background) {
    return `<span aria-hidden="true" class="block h-12 w-[72px] shrink-0 overflow-hidden rounded bg-slate-900">
      ${background.imageSrc
        ? `<img src="${escapeHtml(background.imageSrc)}" alt="" class="h-full w-full object-cover">`
        : ''}
    </span>`;
  }

  function cyclePickerMarkup(label, field, value, options, disabled, renderChoice, browseLabel) {
    const available = options.filter(option => option.canCycle);
    const currentIndex = available.findIndex(option => option.id === value);
    const selected = options.find(option => option.id === value);
    const selectedName = selected?.name.replace(/ — Equipped$/, '') || label;
    const arrow = direction => {
      const index = (Math.max(0, currentIndex) + direction + available.length) % available.length;
      const option = available[index];
      return `<button type="button" data-character-cycle="true" data-character-field="${escapeHtml(field)}"
        data-character-id="${escapeHtml(option?.id ?? value)}" aria-label="${direction < 0 ? 'Previous' : 'Next'} ${escapeHtml(label.toLowerCase())}"
        ${disabled || available.length < 2 ? 'disabled' : ''}
        title="${escapeHtml(option?.name || label)}"
        class="shrink-0 rounded-lg border border-slate-700 px-3 py-3 text-lg text-amber-200 hover:bg-slate-800 disabled:opacity-50">
        ${direction < 0 ? '&larr;' : '&rarr;'}
      </button>`;
    };
    return `<div class="min-w-0 text-xs text-slate-300">
      <span class="block">${escapeHtml(label)}</span>
      <div class="mt-1 flex min-h-16 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 p-2"
        role="group" aria-label="${escapeHtml(label)} picker">
        ${arrow(-1)}
        <span class="flex min-w-0 flex-1 items-center justify-center gap-2">
          ${selected ? renderChoice(selected) : ''}
          <span class="min-w-0 truncate text-center" title="${escapeHtml(selectedName)}">${escapeHtml(selectedName)}</span>
        </span>
        ${arrow(1)}
      </div>
      <details class="mt-2">
        <summary class="cursor-pointer text-amber-200">${escapeHtml(browseLabel)}</summary>
        ${visualDropdownMarkup(label, field, options, value, disabled, renderChoice)}
      </details>
    </div>`;
  }

  function renderControls(container, character, stats, achievements, disabled, appState) {
    const activeTab = tabs.includes(container.dataset.activeTab) ? container.dataset.activeTab : 'appearance';
    const completedAchievements = achievementProgress(stats, achievements);
    const dropdown = (field, label, current, choices, renderChoice, fieldDisabled = false) =>
      visualDropdownMarkup(label, field, choices, current, disabled || fieldDisabled, renderChoice);
    const equipmentDropdown = (field, label, fieldDisabled = false) => dropdown(
      field, label, character[field],
      equipmentOptions(field, character, stats, completedAchievements, appState),
      option => equipmentThumbnailMarkup(option, character.gender),
      disabled || fieldDisabled
    );
    const petOptions = catalogOptions(PET_CATALOG, character.pet, stats, character,
      completedAchievements, 'Equipped', appState);
    const selectedPet = getItem(PET_CATALOG, character.pet);
    const petAnimations = selectedPet.spriteSheet?.animations || [];
    const petAnimationOptions = petAnimations.map(animation =>
      `<option value="${escapeHtml(animation.id)}" ${animation.id === character.petAnimation ? 'selected' : ''}>${escapeHtml(animation.name)}</option>`
    ).join('');
    const petAnimationControl = `<label class="block text-xs font-medium text-slate-300">
        Animation style
        <span class="relative mt-1 block">
          <select data-character-field="petAnimation" ${disabled || !petAnimations.length ? 'disabled' : ''}
            class="block w-full appearance-none rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-3 pr-10 text-sm text-slate-100 focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300">
            ${petAnimationOptions || '<option value="">Choose a companion to see its animations</option>'}
          </select>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"
            class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
            <path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </label>`;
    const hairValue = `${character.hairStyle}::${character.hairColor}`;
    const hairOptions = catalogOptions(hairPresetOptions(character), hairValue,
      stats, character, completedAchievements, 'Equipped', appState);
    const hairPicker = cyclePickerMarkup('Hairstyle', 'hairPreset', hairValue, hairOptions, disabled,
      option => hairThumbnailMarkup({
        ...character, hairStyle: option.hairStyle, hairColor: option.hairColor
      }), 'Browse all hairstyles');
    const coinBalance = coinSummary(stats, appState);
    const wardrobeFields = [
      ['top', 'Shirts, Bodices & Dresses'], ['bottoms', 'Pants & Skirts'], ['shoes', 'Footwear'],
      ['headwear', 'Hats & Helmets'], ['handItem', 'Hand Items'], ['backLayer', 'Back Layers'],
      ['arms', 'Arm Layers'], ['face', 'Masks & Face Paint'], ['ears', 'Elven Ears'],
      ['effect', 'Character Effects']
    ];
    const selectedWardrobeField = wardrobeFields.some(([field]) =>
      field === container.dataset.activeWardrobeField)
      ? container.dataset.activeWardrobeField : 'top';
    container.dataset.activeWardrobeField = selectedWardrobeField;
    const selectedWardrobeLabel = wardrobeFields.find(([field]) =>
      field === selectedWardrobeField)[1];
    const selectedWardrobeOptions = equipmentOptions(
      selectedWardrobeField, character, stats, completedAchievements, appState);
    const purchaseControls = `<div class="space-y-3">
      <label class="block text-xs font-medium text-slate-300">
        Outfit layer
        <span class="relative mt-1 block">
          <select data-character-wardrobe-category="true" ${disabled ? 'disabled' : ''}
            class="block w-full appearance-none rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-3 pr-10 text-sm text-slate-100 focus:border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300">
            ${wardrobeFields.map(([field, label]) =>
              `<option value="${field}" ${field === selectedWardrobeField ? 'selected' : ''}>${escapeHtml(label)}</option>`
            ).join('')}
          </select>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"
            class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
            <path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </label>
      ${cyclePickerMarkup(
        selectedWardrobeLabel, selectedWardrobeField, character[selectedWardrobeField],
        selectedWardrobeOptions, disabled,
        option => equipmentThumbnailMarkup(option, character.gender),
        `Browse all ${selectedWardrobeLabel.toLowerCase()}`
      )}
    </div>`;
    const sections = {
      appearance: `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        ${dropdown('gender', 'Character sprite', character.gender, [
          { id: 'male', name: 'Male sprite' }, { id: 'female', name: 'Female sprite' }
        ], option => characterThumbnailMarkup({ ...character, gender: option.id }))}
        ${dropdown('skinTone', 'Skin tone', character.skinTone, SKIN_TONES, option =>
          `<span aria-hidden="true" class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-900">
            <span class="h-6 w-6 rounded-full border border-slate-500" style="background-color:${escapeHtml(option.color)}"></span>
          </span>`)}
        <div class="sm:col-span-2">${hairPicker}</div>
        <div class="sm:col-span-2">${equipmentDropdown('specialSkin', 'Special Skins')}</div>
      </div>`,
      wardrobe: `<div class="space-y-3">
        <p class="text-xs text-slate-400">Choose a layer to preview and cycle through your unlocked gear. Browse all to shop.</p>
        ${purchaseControls}
      </div>`,
      pets: `<p class="mb-3 text-xs text-slate-400">Companions are purchased with Wayfarer Coins and animate alongside your explorer.</p>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          ${dropdown('pet', 'Companion', character.pet, petOptions, option => petThumbnailMarkup(option))}
          ${petAnimationControl}
          ${equipmentDropdown('petHat', 'Dog Hat', !character.pet.startsWith('pet_trail_dog'))}
          ${equipmentDropdown('petBackpack', 'Dog Backpack', !character.pet.startsWith('pet_trail_dog'))}
        </div>`,
      backgrounds: `<p class="mb-3 text-xs text-slate-400">Campfire Night is your current scene.</p>
        ${dropdown('background', 'Scene', character.background,
          catalogOptions(BACKGROUND_CATALOG, character.background, stats, character,
            completedAchievements, 'Equipped', appState),
          option => backgroundThumbnailMarkup(option))}`,
      shop: `<div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-950/20 p-4">
          <span class="text-sm font-semibold text-amber-100">Wayfarer Coins</span>
          <strong class="flex items-center gap-2 font-mono text-lg text-amber-200">${coinIconMarkup()}${coinBalance.availableCoins.toLocaleString('en')}</strong>
        </div>
        <p class="text-xs text-slate-400">Choose a layer to preview owned gear. Use Browse all to purchase and equip a new item.</p>
        ${purchaseControls}
      </div>`,
      patron: `<div class="rounded-xl border border-amber-800/60 bg-amber-950/20 p-3 mb-4 text-xs text-amber-100">
          Pro and donation rewards are not connected to verified purchases; Wayfarer Coin items are available in the Shop.
        </div>`
    };
    const tabLabels = {
      appearance: 'Appearance', wardrobe: 'Wardrobe', pets: 'Pets',
      backgrounds: 'Backgrounds', shop: 'Coin Shop', patron: 'Patron & Pro'
    };
    container.innerHTML = `<div class="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Character customization">
      ${tabs.map(tab => `<button type="button" role="tab" data-character-tab="${tab}" aria-selected="${tab === activeTab}"
        class="rounded-lg px-3 py-2 text-xs font-semibold ${tab === activeTab ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">${tabLabels[tab]}</button>`).join('')}
      </div><div role="tabpanel">${sections[activeTab]}</div>`;
    renderPetPreviews(container);
    renderHairPreviews(container);
    renderSpriteVariantPreviews(container);
    if (typeof container.querySelectorAll === 'function') {
      container.querySelectorAll('details').forEach(details => {
        details.addEventListener('toggle', () => {
          positionDropdown(details, container);
          renderPetPreviews(details);
          renderHairPreviews(details);
          renderSpriteVariantPreviews(details);
        });
      });
    }
  }

  function renderProgressSummary(container, stats, character, achievements, appState) {
    if (!container) return;
    const balance = coinSummary(stats, appState);
    const parks = Array.isArray(stats.visitedParks) ? stats.visitedParks.length : 0;
    const level = Math.max(1, Number(stats.level) || 1);
    const currentLevel = [...LEVEL_TRACK].reverse().find(reward => reward.level <= level) || LEVEL_TRACK[0];
    const xp = Math.max(0, Number(stats.xp) || 0).toLocaleString('en');
    container.innerHTML = `<div class="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
        <span class="block text-[10px] uppercase tracking-wide text-slate-400">Worldwide parks</span>
        <strong class="block text-lg font-mono text-amber-200">${parks}</strong>
      </div>
      <div class="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
        <span class="block text-[10px] uppercase tracking-wide text-slate-400">Explorer level</span>
        <strong class="block text-lg font-mono text-emerald-300">Level ${level} · ${escapeHtml(currentLevel.title)}</strong>
        <span class="block text-[10px] text-slate-400 mt-1">${xp} XP</span>
      </div>
      <div class="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
        <span class="block text-[10px] uppercase tracking-wide text-slate-400">Wayfarer Coins</span>
        <strong class="flex items-center gap-2 text-lg font-mono text-amber-200">${coinIconMarkup()}${balance.availableCoins.toLocaleString('en')}</strong>
        <span class="block text-[10px] text-slate-400 mt-1">${balance.earnedCoins.toLocaleString('en')} earned · ${balance.spentCoins.toLocaleString('en')} spent</span>
      </div>`;
  }

  function render(options = {}) {
    const canvas = options.canvas;
    const controls = options.controls;
    const customizeButton = options.customizeButton;
    const character = normalizeCharacter(options.character);
    const stats = options.stats || {};
    const achievements = options.achievements || [];
    const appState = options.appState || { character };
    const disabled = !!options.viewOnly;
    drawStage(canvas, character, { stats, achievements });
    renderAvatar(options.avatarCanvas, character);
    renderProgressSummary(options.summary, stats, character, achievements, appState);
    if (customizeButton && controls) {
      customizeButton.onclick = () => {
        controls.hidden = !controls.hidden;
        customizeButton.setAttribute('aria-expanded', String(!controls.hidden));
        if (!controls.hidden) {
          renderPetPreviews(controls);
          renderHairPreviews(controls);
          renderSpriteVariantPreviews(controls);
          controls.focus?.({ preventScroll: true });
          controls.scrollIntoView?.({
            behavior: 'instant',
            block: 'start'
          });
        }
      };
    }
    if (!controls) return;
    renderControls(controls, character, stats, achievements, disabled, appState);
    const completedAchievements = achievementProgress(stats, achievements);
    controls.onclick = event => {
      const tabButton = event.target.closest('[data-character-tab]');
      if (tabButton) {
        controls.dataset.activeTab = tabButton.dataset.characterTab;
        renderControls(controls, character, stats, achievements, disabled, appState);
        return;
      }
      const choiceButton = event.target.closest('button[data-character-field][data-character-id]');
      if (choiceButton) {
        if (disabled || choiceButton.disabled) return;
        const field = choiceButton.dataset.characterField;
        const id = choiceButton.dataset.characterId;
        if (field === 'hairPreset') {
          const option = hairPresetOptions(character).find(item => item.id === id);
          if (!option || !unlockStatus(option.unlock, stats, character,
            completedAchievements, appState).unlocked) return;
          const [hairStyle, hairColor] = id.split('::');
          options.onChange?.(normalizeCharacter({ ...character, hairStyle, hairColor }));
          return;
        }
        if (field === 'gender' || field === 'skinTone') {
          options.onChange?.(normalizeCharacter({ ...character, [field]: id }));
          return;
        }
        const catalog = field === 'pet' ? PET_CATALOG :
          field === 'background' ? BACKGROUND_CATALOG : EQUIPMENT_BY_FIELD[field] || [];
        const selected = catalog.find(item => item.id === id);
        if (id && (!selected || !unlockStatus(selected.unlock, stats, character,
          completedAchievements, appState).unlocked)) return;
        const next = { ...character, [field]: id };
        if (selected?.unlock.type === 'coin' && !character.purchasedItems.includes(selected.id)) {
          if (choiceButton.dataset.characterCycle === 'true') return;
          const balance = coinSummary(stats, appState);
          if (balance.availableCoins < selected.cost) return;
          next.purchasedItems = [...character.purchasedItems, selected.id];
        }
        if (field === 'pet' && !id.startsWith('pet_trail_dog')) {
          next.petHat = '';
          next.petBackpack = '';
        }
        options.onChange?.(normalizeCharacter(next));
      }
    };
    controls.onchange = event => {
      if (event.target.dataset.characterWardrobeCategory === 'true') {
        controls.dataset.activeWardrobeField = event.target.value;
        renderControls(controls, character, stats, achievements, disabled, appState);
        return;
      }
      const field = event.target.dataset.characterField;
      if (!field || disabled) return;
      options.onChange?.(normalizeCharacter({ ...character, [field]: event.target.value }));
    };
  }

  const api = {
    DEFAULT_CHARACTER, SKIN_TONES, HAIR_STYLES, HAIR_COLORS, EYE_COLORS, BODY_SHAPES, HEIGHTS,
    OUTFIT_CATALOG, HAT_CATALOG, ACCESSORY_CATALOG, PET_CATALOG, BACKGROUND_CATALOG,
    LEVEL_ITEMS, PARK_MILESTONE_ITEMS, ACHIEVEMENT_ITEMS,
    SHOP_WARDROBE, PET_ACCESSORY_CATALOG, EQUIPMENT_CATALOG, LEVEL_TRACK,
    BODY_SHAPE_PROFILES, normalizeCharacter, characterSpriteAssets, achievementProgress,
    unlockStatus, coinSummary, processSpriteVariant, drawPet, drawCharacterSprite, drawCampfire,
    drawStage, renderAvatar, render
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CharacterCreator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
