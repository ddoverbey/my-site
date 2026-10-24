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
check('starter character is complete and defaults to the original pixel companion', () => {
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
    skinTone: 'deep', hairStyle: 'curls', outfit: 'outfit_parka',
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
  assert.equal(fox.spriteSheet.frameCount, 6);
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
    characterCreator.drawPet(context, wisp, () => {}, 4);
    characterCreator.drawPet(context, outlinedWisp, () => {}, 1);
    assert.deepEqual(drawCalls[0].slice(1), [65, 13, 29, 19, 103, 67, 20, 13]);
    assert.deepEqual(drawCalls[1].slice(1), [77, 851, 36, 28, 102, 63, 22, 17]);
    assert.deepEqual(drawCalls[2].slice(1), [65, 14, 29, 18, 103, 68, 20, 12]);
    assert.deepEqual(drawCalls[3].slice(1), [137, 5, 14, 22, 107, 60, 12, 18]);
    assert.deepEqual(drawCalls[4].slice(1), [40, 4, 16, 24, 107, 60, 12, 18]);
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
    characterCreator.BACKGROUND_CATALOG.find(entry => entry.id === 'bg_aurora'),
    characterCreator.OUTFIT_CATALOG.find(entry => entry.id === 'outfit_rain')
  ]) {
    assert.equal(characterCreator.unlockStatus(item.unlock, {}, character, progress).unlocked, true);
  }
});
check('national park dioramas are deferred while generic backgrounds remain selectable', () => {
  assert.deepEqual(characterCreator.BACKGROUND_CATALOG.map(item => item.id), [
    'bg_campfire', 'bg_aurora', 'bg_observatory', 'bg_sanctuary', 'bg_pro_celestial'
  ]);
  assert.ok(characterCreator.BACKGROUND_CATALOG.every(item => item.id.startsWith('bg_')));
});
check('Campfire Night uses the supplied 320x180 background art', () => {
  const background = characterCreator.BACKGROUND_CATALOG.find(item => item.id === 'bg_campfire');
  assert.equal(background.imageSrc, './assets/backgrounds/campfire-night-320px.png');
  const png = readFileSync(new URL(background.imageSrc, import.meta.url));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [320, 180]);
});
check('procedural stage renderer paints a pixel character and companion', () => {
  let pixels = 0;
  let maxX = 0;
  let scaleX = 0;
  let scaleY = 0;
  const context = {
    clearRect() {}, save() {}, scale(x, y) { scaleX = x; scaleY = y; }, restore() {},
    fillRect(x, y, width) { pixels++; maxX = Math.max(maxX, x + width); }
  };
  characterCreator.drawStage({
    width: 320, height: 180, getContext: () => context
  }, characterCreator.DEFAULT_CHARACTER);
  assert.equal(scaleX, 2);
  assert.equal(scaleY, 2);
  assert.equal(maxX, 160, 'drawing keeps the original 160×90 logical stage');
  assert.ok(pixels > 100);
});
check('avatar proportions use longer legs and a ranger hat brim seated on the head', () => {
  const fills = [];
  const context = {
    fillStyle: '',
    clearRect() {}, save() {}, scale() {}, restore() {},
    fillRect(x, y, width, height) { fills.push({ x, y, width, height, color: this.fillStyle }); }
  };
  characterCreator.drawStage({
    width: 320, height: 180, getContext: () => context
  }, { ...characterCreator.DEFAULT_CHARACTER, hat: 'hat_ranger_brown' });
  const torsoRows = new Set(fills
    .filter(fill => fill.color === '#5d9d79' && fill.height === 1 && fill.y >= 45 && fill.y <= 65)
    .map(fill => fill.y));
  assert.equal(torsoRows.size, 13);
  assert.ok(fills.some(fill => fill.color === '#33475a' && fill.height === 17));
  assert.ok(fills.some(fill =>
    fill.color === '#3a2d29' && fill.x === 68 && fill.y === 41 && fill.width === 22 && fill.height === 2
  ));
});
check('campfire flames stay clear of the explorer and legs', () => {
  const fills = [];
  const context = {
    fillStyle: '',
    clearRect() {}, save() {}, scale() {}, restore() {},
    fillRect(x, y, width, height) { fills.push({ x, y, width, height, color: this.fillStyle }); }
  };
  characterCreator.drawStage({
    width: 320, height: 180, getContext: () => context
  }, characterCreator.DEFAULT_CHARACTER);
  const flames = fills.filter(fill => ['#d78339', '#f3bd59', '#df6136'].includes(fill.color));
  assert.equal(flames.length, 3);
  assert.ok(flames.every(fill => fill.x + fill.width < 60));
  assert.deepEqual(flames.map(({ x, y }) => [x, y]), [[22, 63], [28, 60], [32, 64]]);
});
check('arms remain visible while stray skin pixels stay off the shoulders', () => {
  const fills = [];
  const context = {
    fillStyle: '',
    clearRect() {}, save() {}, scale() {}, restore() {},
    fillRect(x, y, width, height) { fills.push({ x, y, width, height, color: this.fillStyle }); }
  };
  characterCreator.drawStage({
    width: 320, height: 180, getContext: () => context
  }, characterCreator.DEFAULT_CHARACTER);
  const skin = characterCreator.SKIN_TONES.find(tone => tone.id === 'warm').color;
  assert.ok(fills.some(fill =>
    fill.color === skin && fill.x === 69 && fill.y === 52 && fill.width === 3 && fill.height === 1
  ));
  assert.ok(fills.some(fill =>
    fill.color === skin && fill.x === 86 && fill.y === 52 && fill.width === 3 && fill.height === 1
  ));
  assert.equal(fills.some(fill =>
    fill.color === skin && fill.y === 50 && (fill.x < 73 || fill.x >= 85)
  ), false);
});

console.log(`\n${checks} character creator checks passed.`);
