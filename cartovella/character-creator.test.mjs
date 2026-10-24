import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import characterCreator from './character-creator.js';

let checks = 0;
function check(name, action) {
  action();
  checks++;
  console.log(`PASS ${name}`);
}

const allCatalogs = [
  characterCreator.SKIN_TONES, characterCreator.HAIR_STYLES, characterCreator.HAIR_COLORS,
  characterCreator.EYE_COLORS, characterCreator.BODY_SHAPES, characterCreator.HEIGHTS,
  characterCreator.OUTFIT_CATALOG, characterCreator.HAT_CATALOG,
  characterCreator.ACCESSORY_CATALOG, characterCreator.PET_CATALOG,
  characterCreator.BACKGROUND_CATALOG
];

check('every customization option supports a future image override', () => {
  allCatalogs.flat().forEach(item => assert.equal(Object.hasOwn(item, 'imageSrc'), true, item.id));
});
check('character appearance, outfit, companion, and scene choices render as dropdowns', () => {
  const controls = { dataset: {}, innerHTML: '' };
  const expectedFields = {
    appearance: ['gender', 'skinTone', 'hairColor', 'hairStyle'],
    wardrobe: ['outfit', 'hat', 'accessory'],
    pets: ['pet'],
    backgrounds: ['background'],
    patron: ['proReward', 'donationReward']
  };
  const visualFields = new Set([
    'gender', 'skinTone', 'hairColor', 'hairStyle', 'outfit', 'hat', 'accessory', 'pet', 'background'
  ]);
  for (const [tab, fields] of Object.entries(expectedFields)) {
    controls.dataset.activeTab = tab;
    characterCreator.render({ controls, character: characterCreator.DEFAULT_CHARACTER, stats: { level: 1 } });
    for (const field of fields) {
      const controlTag = visualFields.has(field) ? 'details' : 'select';
      if (controlTag === 'details') {
        assert.match(controls.innerHTML, new RegExp(`<details[^>]*>[\\s\\S]*?data-character-field="${field}"`));
      } else {
        assert.match(controls.innerHTML, new RegExp(`<select[^>]*data-character-field="${field}"`));
      }
    }
  }
  controls.dataset.activeTab = 'appearance';
  characterCreator.render({ controls, character: characterCreator.DEFAULT_CHARACTER });
  assert.match(controls.innerHTML, /Male%20Skin2\.png/);
  assert.match(controls.innerHTML, /Female%20Skin2\.png/);
  assert.match(controls.innerHTML, /Male%20Hair6\.png/);
  assert.match(controls.innerHTML, /Female%20Hair6\.png/);
  assert.match(controls.innerHTML, /background-color:#dba77e/);
  assert.match(controls.innerHTML, /Hair color/);
  assert.match(controls.innerHTML, /Hairstyle/);
  assert.match(controls.innerHTML, /Porcelain/);
  assert.match(controls.innerHTML, /Warm/);
  assert.match(controls.innerHTML, /Hairstyle 6/);
  assert.match(controls.innerHTML, /No reward selected/);
});
check('dropdown changes update the selected character field', () => {
  const controls = { dataset: {}, innerHTML: '' };
  let changedCharacter;
  characterCreator.render({
    controls,
    character: characterCreator.DEFAULT_CHARACTER,
    onChange: character => { changedCharacter = character; }
  });
  const choose = (field, id) => controls.onclick({
    target: {
      closest(selector) {
        if (selector === '[data-character-tab]') return null;
        if (selector === 'button[data-character-field][data-character-id]') {
          return { dataset: { characterField: field, characterId: id }, disabled: false };
        }
        return null;
      }
    }
  });
  choose('hairColor', 'teal');
  assert.equal(changedCharacter.hairColor, 'teal');
  choose('hairStyle', 'hair_10');
  assert.equal(changedCharacter.hairStyle, 'hair_10');
  choose('gender', 'female');
  assert.equal(changedCharacter.gender, 'female');
});
check('late character sprite loads redraw the most recently rendered stage', () => {
  const originalImage = globalThis.Image;
  const pendingImages = [];
  const drawCalls = [];
  globalThis.Image = class {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.src = '';
      pendingImages.push(this);
    }
    load() {
      this.complete = true;
      this.naturalWidth = 800;
      this.onload();
    }
  };
  try {
    const context = {
      clearRect() { drawCalls.length = 0; },
      save() {},
      scale() {},
      restore() {},
      fillRect() {},
      drawImage(image) { drawCalls.push(image.src); }
    };
    const canvas = { width: 320, height: 180, isConnected: true, getContext: () => context };
    const character = { ...characterCreator.DEFAULT_CHARACTER, gender: 'female', pet: 'pet_none' };
    characterCreator.drawStage(canvas, { ...character, background: 'bg_aurora' });
    characterCreator.drawStage(canvas, { ...character, background: 'bg_observatory' });
    assert.equal(pendingImages.length, 6);
    pendingImages.forEach(image => image.load());
    assert.equal(drawCalls.length, 6);
    assert.equal(drawCalls.filter(src => src.includes('Female')).length, 5);
    assert.equal(drawCalls.filter(src => src.includes('campfire-night')).length, 1);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});
check('a shared sprite-sheet load redraws both the stage and its pet preview', () => {
  const originalImage = globalThis.Image;
  const pendingImages = [];
  globalThis.Image = class {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.src = '';
      pendingImages.push(this);
    }
    load() {
      this.complete = true;
      this.naturalWidth = 192;
      this.onload();
    }
  };
  try {
    const pet = characterCreator.PET_CATALOG.find(item => item.id === 'pet_trail_dog');
    let stageRedraws = 0;
    let previewRedraws = 0;
    const context = { drawImage() {} };
    characterCreator.drawPet(context, pet, () => { stageRedraws++; }, 0);
    characterCreator.drawPet(context, pet, () => { previewRedraws++; }, 0);
    assert.equal(pendingImages.length, 1);
    pendingImages[0].load();
    assert.equal(stageRedraws, 1);
    assert.equal(previewRedraws, 1);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});
check('starter character uses a sprite-pack explorer and the original pixel companion', () => {
  assert.equal(characterCreator.normalizeCharacter().gender, 'male');
  assert.equal(characterCreator.normalizeCharacter().outfit, 'outfit_recruit');
  assert.equal(characterCreator.normalizeCharacter().pet, 'pet_pufflin_blue');
  assert.equal(characterCreator.normalizeCharacter().background, 'bg_campfire');
  assert.equal(characterCreator.normalizeCharacter().bodyShape, 'straight');
  assert.equal(characterCreator.normalizeCharacter().proUnlocked, false);
});
check('character migration clamps invalid values and preserves safe selections', () => {
  assert.deepEqual(characterCreator.normalizeCharacter({
    skinTone: 'deep', hairStyle: 'curls', outfit: 'outfit_parka',
    pet: 'pet_kitten_gray', background: 'bg_citadel',
    proUnlocked: 'true', donationUsd: 100000000, unknown: 'discard'
  }), {
    ...characterCreator.DEFAULT_CHARACTER,
    skinTone: 'deep', hairStyle: 'hair_6', outfit: 'outfit_parka',
    pet: 'pet_black_cat', background: 'bg_campfire',
    proUnlocked: false, donationUsd: 1000000
  });
  assert.equal(characterCreator.normalizeCharacter({ hat: 'not-a-hat' }).hat, 'hat_none');
  assert.equal(characterCreator.normalizeCharacter({ background: 'bg_citadel' }).background, 'bg_campfire');
  assert.equal(characterCreator.normalizeCharacter({ pet: 'pet_puppy_gold' }).pet, 'pet_trail_dog');
  assert.equal(characterCreator.normalizeCharacter({ pet: 'pet_kitten_gray' }).pet, 'pet_black_cat');
});
check('inclusive body frames migrate legacy selections', () => {
  assert.deepEqual(characterCreator.BODY_SHAPES.map(frame => [frame.id, frame.name]), [
    ['straight', 'Classic / Straight Frame'],
    ['vTaper', 'Broad / V-Taper Frame'],
    ['hourglass', 'Curved / Hourglass Frame']
  ]);
  assert.equal(characterCreator.normalizeCharacter({ bodyShape: 'balanced' }).bodyShape, 'straight');
  assert.equal(characterCreator.normalizeCharacter({ bodyShape: 'slender' }).bodyShape, 'straight');
  assert.equal(characterCreator.normalizeCharacter({ bodyShape: 'broad' }).bodyShape, 'vTaper');
  assert.equal(characterCreator.normalizeCharacter({ bodyShape: 'sturdy' }).bodyShape, 'vTaper');
  assert.equal(characterCreator.normalizeCharacter({ bodyShape: 'hourglass' }).bodyShape, 'hourglass');
});
check('the 58 hairstyle assets are available for their matching character sprites', () => {
  const maleStyles = characterCreator.HAIR_STYLES.filter(style => style.genders.includes('male'));
  const femaleStyles = characterCreator.HAIR_STYLES.filter(style => style.genders.includes('female'));
  assert.equal(maleStyles.length, 28);
  assert.equal(femaleStyles.length, 30);
  assert.ok(characterCreator.characterSpriteAssets({
    ...characterCreator.DEFAULT_CHARACTER, hairStyle: 'hair_fancy'
  })[4].endsWith('/Fancy%20Hair.png'));
  assert.ok(characterCreator.characterSpriteAssets({
    ...characterCreator.DEFAULT_CHARACTER, gender: 'female', hairStyle: 'hair_35'
  })[4].endsWith('/Female%20Hair35.png'));
});
check('low-resolution frame profiles keep the V-taper broad at the shoulders and hourglass defined', () => {
  const { straight, vTaper, hourglass } = characterCreator.BODY_SHAPE_PROFILES;
  assert.equal(straight.length, 13);
  assert.ok(straight.every(width => width === straight[0]));
  assert.ok(Math.max(...vTaper.slice(0, 5)) > Math.max(...vTaper.slice(12)));
  assert.ok(Math.min(...hourglass.slice(5, 11)) < hourglass[0]);
  assert.ok(Math.max(...hourglass.slice(12)) <= hourglass[0]);
});
check('every bundled dog, cat, fox, and wisp has a valid animated sprite sheet', () => {
  const dogs = characterCreator.PET_CATALOG.filter(item => item.id.startsWith('pet_trail_dog'));
  const cats = characterCreator.PET_CATALOG.filter(item => item.id.endsWith('_cat'));
  const fox = characterCreator.PET_CATALOG.find(item => item.id === 'pet_trail_fox');
  const wisps = characterCreator.PET_CATALOG.filter(item => item.id.startsWith('pet_blue_wisp'));
  assert.deepEqual(dogs.map(pet => pet.name), [
    'Golden Trail Dog', 'Slate Trail Dog', 'Sandy Trail Dog', 'Cream Trail Dog', 'Shadow Trail Dog'
  ]);
  assert.deepEqual(cats.map(pet => pet.name), [
    'Black Cat (Cat 1)', 'Ginger Cat (Cat 2)', 'White Cat (Cat 3)'
  ]);
  assert.equal(fox.name, 'Trail Fox');
  assert.deepEqual(wisps.map(pet => pet.name), ['Blue Wisp', 'Outlined Blue Wisp']);
  const spritePets = [...dogs, ...cats, fox, ...wisps];
  for (const pet of spritePets) {
    assert.equal(pet.kind, 'sprite');
    const png = readFileSync(new URL(pet.imageSrc, import.meta.url));
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    const dimensions = pet.id.startsWith('pet_trail_dog') || pet === fox
      ? [192, 64]
      : pet.id.endsWith('_cat') ? [896, 4608] : [160, 32];
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], dimensions);
  }
  assert.ok(dogs.every(pet => pet.spriteSheet.frameCount === 5));
  assert.ok(cats.every(pet => pet.spriteSheet.frameCount === 8));
  assert.ok(cats.every(pet => pet.spriteSheet.row === 13), 'cat frames use the labeled Lick paw lie front row');
  assert.equal(fox.spriteSheet.frameCount, 5);
  assert.ok(dogs.every(pet =>
    pet.spriteSheet.targetWidth === 26 && pet.spriteSheet.targetHeight === 17
  ));
  assert.deepEqual([fox.spriteSheet.targetWidth, fox.spriteSheet.targetHeight], [20, 12]);
  assert.ok(wisps.every(pet => pet.spriteSheet.frameCount === 5));
});
check('companion sprite animations crop requested dog, cat, fox, and wisp frames', () => {
  const originalImage = globalThis.Image;
  const drawCalls = [];
  globalThis.Image = class {
    constructor() {
      this.complete = true;
      this.naturalWidth = 896;
      this.src = '';
    }
  };
  try {
    const context = { drawImage(...args) { drawCalls.push(args); } };
    const dog = characterCreator.PET_CATALOG.find(item => item.id === 'pet_trail_dog');
    const cat = characterCreator.PET_CATALOG.find(item => item.id === 'pet_black_cat');
    const fox = characterCreator.PET_CATALOG.find(item => item.id === 'pet_trail_fox');
    const wisp = characterCreator.PET_CATALOG.find(item => item.id === 'pet_blue_wisp');
    const outlinedWisp = characterCreator.PET_CATALOG.find(item => item.id === 'pet_blue_wisp_outline');
    characterCreator.drawPet(context, dog, () => {}, 2);
    characterCreator.drawPet(context, cat, () => {}, 1);
    characterCreator.drawPet(context, fox, () => {}, 2);
    characterCreator.drawPet(context, fox, () => {}, 5);
    characterCreator.drawPet(context, wisp, () => {}, 4);
    characterCreator.drawPet(context, outlinedWisp, () => {}, 1);
    assert.deepEqual(drawCalls[0].slice(1), [65, 13, 29, 19, 100, 63, 26, 17]);
    assert.deepEqual(drawCalls[1].slice(1), [77, 851, 36, 28, 102, 63, 22, 17]);
    assert.deepEqual(drawCalls[2].slice(1), [65, 14, 29, 18, 103, 68, 20, 12]);
    assert.deepEqual(drawCalls[3].slice(1), [1, 14, 29, 18, 103, 68, 20, 12]);
    assert.deepEqual(drawCalls[4].slice(1), [137, 5, 14, 22, 107, 60, 12, 18]);
    assert.deepEqual(drawCalls[5].slice(1), [40, 4, 16, 24, 107, 60, 12, 18]);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});
check('level and destination unlocks show exact current progress', () => {
  const character = characterCreator.normalizeCharacter();
  const achievements = new Map();
  assert.deepEqual(characterCreator.unlockStatus(
    { type: 'level', goal: 7 }, { level: 4 }, character, achievements
  ), { unlocked: false, description: 'Reach level 7 (4/7).' });
  assert.deepEqual(characterCreator.unlockStatus(
    { type: 'worldParks', goal: 50 }, { visitedParks: Array(12).fill('park') }, character, achievements
  ), { unlocked: false, description: 'Visit 50 worldwide parks (12/50).' });
});
check('existing achievement IDs drive character rewards', () => {
  const definitions = [
    { id: 'thinAir', title: 'Thin Air', progress: () => 1, tiers: [{ goal: 1 }] },
    { id: 'longDark', title: 'The Long Dark', progress: () => 1, tiers: [{ goal: 1 }] },
    { id: 'waterfalls_1', title: 'Chasing Waterfalls', progress: () => 1, tiers: [{ goal: 1 }] }
  ];
  const progress = characterCreator.achievementProgress({}, definitions);
  const character = characterCreator.normalizeCharacter();
  for (const item of [
    characterCreator.HAT_CATALOG.find(entry => entry.id === 'hat_summit'),
    characterCreator.OUTFIT_CATALOG.find(entry => entry.id === 'outfit_rain')
  ]) {
    assert.equal(characterCreator.unlockStatus(item.unlock, {}, character, progress).unlocked, true);
  }
});
check('Campfire Night is the only available character background', () => {
  assert.deepEqual(characterCreator.BACKGROUND_CATALOG.map(item => item.id), ['bg_campfire']);
});
check('Campfire Night uses the supplied 320x180 background art', () => {
  const background = characterCreator.BACKGROUND_CATALOG.find(item => item.id === 'bg_campfire');
  assert.equal(background.imageSrc, './assets/backgrounds/campfire-night-320px.png');
  const png = readFileSync(new URL(background.imageSrc, import.meta.url));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [320, 180]);
});
check('sprite character selects matching gender, skin, hair, and outfit layers', () => {
  const originalImage = globalThis.Image;
  const drawCalls = [];
  globalThis.Image = class {
    constructor() {
      this.complete = true;
      this.naturalWidth = 800;
      this.naturalHeight = 448;
      this.src = '';
    }
  };
  try {
    const character = {
      ...characterCreator.DEFAULT_CHARACTER,
      gender: 'female',
      skinTone: 'deep',
      hairStyle: 'hair_10',
      hairColor: 'teal',
      outfit: 'outfit_vest'
    };
    const assets = characterCreator.characterSpriteAssets(character);
    assert.deepEqual(assets.map(path => decodeURIComponent(path.split('/').at(-1))), [
      'Female Skin5.png', 'Skirt.png', 'Blue Corset v2.png', 'Boots.png', 'Female Hair10.png'
    ]);
    for (const asset of assets) {
      const png = readFileSync(new URL(asset, import.meta.url));
      assert.equal(png.toString('ascii', 1, 4), 'PNG');
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [800, 448]);
    }
    let hairFilter = 'none';
    characterCreator.drawCharacterSprite({
      save() {},
      restore() {},
      set filter(value) { hairFilter = value; },
      drawImage(...args) { drawCalls.push(args); }
    }, character);
    assert.equal(drawCalls.length, 5);
    assert.match(hairFilter, /hue-rotate\(130deg\)/);
    assert.ok(drawCalls.every(call =>
      call.length === 9 && call.slice(1).join(',') === '24,16,32,48,60,34,40,48'
    ));
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});

console.log(`\n${checks} character creator checks passed.`);
