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
  characterCreator.BACKGROUND_CATALOG, characterCreator.LEVEL_ITEMS,
  characterCreator.PARK_MILESTONE_ITEMS, characterCreator.ACHIEVEMENT_ITEMS,
  characterCreator.SHOP_WARDROBE, characterCreator.PET_ACCESSORY_CATALOG
];

check('every customization option supports a future image override', () => {
  allCatalogs.flat().forEach(item => assert.equal(Object.hasOwn(item, 'imageSrc'), true, item.id));
});
check('character appearance, wardrobe, companions, and scene choices render as dropdowns', () => {
  const controls = { dataset: {}, innerHTML: '' };
  const expectedFields = {
    appearance: ['gender', 'skinTone', 'hairPreset', 'specialSkin'],
    wardrobe: ['top'],
    pets: ['pet', 'petAnimation', 'petHat', 'petBackpack'],
    backgrounds: ['background'],
    shop: ['top'],
    patron: []
  };
  const visualFields = new Set([
    'gender', 'skinTone', 'hairPreset', 'top', 'bottoms', 'shoes', 'headwear',
    'handItem', 'backLayer', 'arms', 'face', 'ears', 'effect', 'specialSkin',
    'pet', 'petHat', 'petBackpack', 'background'
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
      if (tab === 'wardrobe' || tab === 'shop') {
        for (const field of ['top', 'bottoms', 'shoes', 'headwear', 'handItem',
          'backLayer', 'arms', 'face', 'ears', 'effect']) {
          assert.match(controls.innerHTML, new RegExp(`<option value="${field}"`));
        }
        assert.equal((controls.innerHTML.match(/data-character-cycle="true"/g) || []).length, 2);
      }
    }
    for (const field of ['pet', 'petHat', 'petBackpack']) {
      if (tab !== 'pets') assert.doesNotMatch(controls.innerHTML, new RegExp(`data-character-field="${field}"`));
    }
    if (tab !== 'appearance') assert.doesNotMatch(controls.innerHTML, /data-character-field="specialSkin"/);
  }
  controls.dataset.activeTab = 'appearance';
  characterCreator.render({ controls, character: characterCreator.DEFAULT_CHARACTER });
  assert.match(controls.innerHTML, /Male%20Skin2\.png/);
  assert.match(controls.innerHTML, /Female%20Skin2\.png/);
  assert.match(controls.innerHTML, /data-hair-preview="true"/);
  assert.match(controls.innerHTML, /data-hair-style="hair_6"/);
  assert.match(controls.innerHTML, /data-hair-color="brown"/);
  assert.match(controls.innerHTML, /background-color:#dba77e/);
  assert.match(controls.innerHTML, /Chestnut/);
  assert.match(controls.innerHTML, /Black/);
  assert.match(controls.innerHTML, /Blonde/);
  assert.match(controls.innerHTML, /Hairstyle/);
  assert.doesNotMatch(controls.innerHTML, /Hair color/);
  assert.match(controls.innerHTML, /Porcelain/);
  assert.match(controls.innerHTML, /Warm/);
  assert.match(controls.innerHTML, /Hairstyle 1: Chestnut/);
  assert.match(controls.innerHTML, /Hairstyle 28: Teal/);
  assert.match(controls.innerHTML, /data-character-id="hair_shield_maiden::teal"/);
  assert.equal((controls.innerHTML.match(/data-character-field="hairPreset"/g) || []).length, 170);
  assert.match(controls.innerHTML, /aria-label="Previous hairstyle"/);
  assert.match(controls.innerHTML, /aria-label="Next hairstyle"/);
  assert.match(controls.innerHTML, /<details class="mt-2">\s*<summary[^>]*>Browse all hairstyles/);
  assert.match(controls.innerHTML, /class="sm:col-span-2">[\s\S]*?aria-label="Hairstyle picker"/);
  assert.match(controls.innerHTML, /class="min-w-0 truncate text-center" title="Hairstyle 1: Chestnut"/);
  assert.match(controls.innerHTML, /h-16/);
  assert.match(controls.innerHTML, /h-10 w-10/);
  controls.dataset.activeTab = 'shop';
  characterCreator.render({ controls, character: characterCreator.DEFAULT_CHARACTER });
  assert.match(controls.innerHTML, /Wayfarer Coins/);
  assert.match(controls.innerHTML, /\d+ coins/);
});
check('hairstyle arrows cycle unlocked options, wrap around, and respect view-only mode', () => {
  for (const gender of ['male', 'female']) {
    const controls = { dataset: {}, innerHTML: '' };
    let character = characterCreator.normalizeCharacter({ gender });
    let next;
    const render = (viewOnly = false) => characterCreator.render({
      controls, character, stats: { level: 1 }, viewOnly,
      onChange: value => { next = value; }
    });
    const arrowId = label => controls.innerHTML.match(new RegExp(
      `data-character-field="hairPreset"\\s+data-character-id="([^"]+)" aria-label="${label}"`
    ))[1];
    const choose = id => controls.onclick({ target: { closest(selector) {
      return selector === 'button[data-character-field][data-character-id]'
        ? { dataset: { characterField: 'hairPreset', characterId: id }, disabled: false } : null;
    } } });
    render();
    const first = `${character.hairStyle}::${character.hairColor}`;
    choose(arrowId('Previous hairstyle'));
    assert.ok(next);
    assert.notEqual(`${next.hairStyle}::${next.hairColor}`, first);
    assert.doesNotMatch(next.hairStyle, /fancy|queen|shield_maiden/);
    character = next;
    render();
    assert.equal(arrowId('Next hairstyle'), first);
    choose(arrowId('Next hairstyle'));
    assert.equal(`${next.hairStyle}::${next.hairColor}`, first);
    character = next;
    render(true);
    assert.match(controls.innerHTML, /aria-label="Next hairstyle"\s+disabled/);
    next = null;
    choose(arrowId('Next hairstyle'));
    assert.equal(next, null);
  }
});
check('wardrobe and shop expose one compact layer picker at a time', () => {
  const fields = ['top', 'bottoms', 'shoes', 'headwear', 'handItem', 'backLayer',
    'arms', 'face', 'ears', 'effect'];
  for (const tab of ['wardrobe', 'shop']) {
    const controls = { dataset: { activeTab: tab }, innerHTML: '' };
    let changed;
    characterCreator.render({
      controls, stats: { level: 10 }, character: characterCreator.DEFAULT_CHARACTER,
      onChange: next => { changed = next; }
    });
    assert.equal((controls.innerHTML.match(/data-character-cycle="true"/g) || []).length, 2);
    assert.equal((controls.innerHTML.match(/>Browse all /g) || []).length, 1);
    for (const field of fields) assert.match(controls.innerHTML, new RegExp(`<option value="${field}"`));
    assert.match(controls.innerHTML, /appearance-none[^"]*pr-10/);
    assert.match(controls.innerHTML, /absolute right-3 top-1\/2/);
    controls.onchange({ target: { dataset: { characterWardrobeCategory: 'true' }, value: 'headwear' } });
    assert.equal(controls.dataset.activeWardrobeField, 'headwear');
    assert.match(controls.innerHTML, /data-character-field="headwear"[^>]*aria-label="Next hats/);
    const nextId = controls.innerHTML.match(
      /data-character-field="headwear"[^>]*data-character-id="([^"]*)"[^>]*aria-label="Next/
    )[1];
    controls.onclick({ target: { closest(selector) {
      return selector === 'button[data-character-field][data-character-id]'
        ? { dataset: { characterField: 'headwear', characterId: nextId }, disabled: false } : null;
    } } });
    assert.equal(changed.headwear, nextId);
    characterCreator.render({ controls, viewOnly: true });
    assert.match(controls.innerHTML, /aria-label="Next hats &amp; helmets"\s+disabled/);
  }
});
check('wardrobe arrows never purchase, cycle owned gear and None, and leave purchases to browse-all', () => {
  const fields = ['top', 'bottoms', 'shoes', 'headwear', 'handItem', 'backLayer',
    'arms', 'face', 'ears', 'effect'];
  for (const gender of ['male', 'female']) {
    for (const tab of ['wardrobe', 'shop']) {
      for (const field of fields) {
        const shopItems = characterCreator.SHOP_WARDROBE.filter(item =>
          item.field === field && item.paths[gender]);
        const purchasedItems = shopItems.slice(0, 1).map(item => item.id);
        let character = characterCreator.normalizeCharacter({ gender, purchasedItems });
        const controls = { dataset: { activeTab: tab }, innerHTML: '' };
        let changed;
        const render = () => characterCreator.render({
          controls, character, stats: { level: 100 },
          onChange: next => { changed = next; }
        });
        const selectField = () => controls.onchange({
          target: { dataset: { characterWardrobeCategory: 'true' }, value: field }
        });
        const choose = (id, cycle) => controls.onclick({ target: { closest(selector) {
          return selector === 'button[data-character-field][data-character-id]'
            ? { dataset: { characterField: field, characterId: id, characterCycle: cycle ? 'true' : undefined },
              disabled: false } : null;
        } } });
        const seen = new Set();
        for (let step = 0; step < characterCreator.EQUIPMENT_CATALOG.length + 1; step++) {
          render();
          selectField();
          const arrows = [...controls.innerHTML.matchAll(new RegExp(
            `data-character-cycle="true" data-character-field="${field}"\\s+data-character-id="([^"]*)" aria-label="(Previous|Next) [^"]+"\\s*(disabled)?`, 'g'
          ))];
          assert.equal(arrows.length, 2);
          for (const arrow of arrows) {
            const item = characterCreator.EQUIPMENT_CATALOG.find(item => item.id === arrow[1]);
            assert.ok(!item || item.unlock.type !== 'coin' || purchasedItems.includes(item.id));
          }
          const next = arrows.find(arrow => arrow[2] === 'Next');
          if (next[3] || seen.has(next[1])) break;
          seen.add(next[1]);
          choose(next[1], true);
          assert.ok(changed);
          assert.deepEqual(changed.purchasedItems, purchasedItems);
          assert.equal(changed[field], next[1]);
          character = changed;
        }
        if (shopItems.length) assert.ok(seen.has(shopItems[0].id), `${gender} ${tab} ${field}: owned gear`);
        if (!['top', 'bottoms', 'shoes'].includes(field)) assert.ok(seen.has(''), `${field}: None`);
        const unowned = shopItems[1];
        if (unowned) {
          render();
          selectField();
          assert.ok(controls.innerHTML.includes(`data-character-id="${unowned.id}"`));
          changed = null;
          choose(unowned.id, true);
          assert.equal(changed, null);
          choose(unowned.id, false);
          assert.equal(changed[field], unowned.id);
          assert.deepEqual(changed.purchasedItems, [...purchasedItems, unowned.id]);
        }
      }
    }
  }
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
  choose('hairPreset', 'hair_10::teal');
  assert.equal(changedCharacter.hairColor, 'teal');
  assert.equal(changedCharacter.hairStyle, 'hair_10');
  choose('gender', 'female');
  assert.equal(changedCharacter.gender, 'female');
});
check('pet animation selection is validated, persisted, and resets to the new pet default', () => {
  const dog = characterCreator.PET_CATALOG.find(item => item.id === 'pet_trail_dog');
  const cat = characterCreator.PET_CATALOG.find(item => item.id === 'pet_black_cat');
  const dogWithLeap = characterCreator.normalizeCharacter({
    ...characterCreator.DEFAULT_CHARACTER,
    pet: dog.id, purchasedItems: [dog.id], petAnimation: 'leap'
  });
  assert.equal(dogWithLeap.petAnimation, 'leap');
  assert.equal(characterCreator.normalizeCharacter({
    ...dogWithLeap, pet: cat.id, purchasedItems: [dog.id, cat.id]
  }).petAnimation, 'cat-13');
  assert.equal(characterCreator.normalizeCharacter({
    ...dogWithLeap, pet: 'pet_none'
  }).petAnimation, '');

  const controls = { dataset: { activeTab: 'pets' }, innerHTML: '' };
  let changedCharacter;
  characterCreator.render({
    controls, character: dogWithLeap,
    onChange: character => { changedCharacter = character; }
  });
  assert.match(controls.innerHTML, /data-character-field="petAnimation"/);
  assert.match(controls.innerHTML, /<option value="leap" selected>Leap<\/option>/);
  controls.onchange({
    target: { dataset: { characterField: 'petAnimation' }, value: 'walk' }
  });
  assert.equal(changedCharacter.petAnimation, 'walk');
});
check('opening customization scrolls to and focuses the editor; closing does not scroll', () => {
  const scrollCalls = [];
  const focusCalls = [];
  const controls = {
    dataset: {}, innerHTML: '', hidden: true,
    focus(options) { focusCalls.push(options); },
    scrollIntoView(options) { scrollCalls.push(options); }
  };
  const attributes = {};
  const customizeButton = { setAttribute(key, value) { attributes[key] = value; } };
  characterCreator.render({ controls, customizeButton });
  customizeButton.onclick();
  assert.equal(controls.hidden, false);
  assert.equal(attributes['aria-expanded'], 'true');
  assert.deepEqual(focusCalls, [{ preventScroll: true }]);
  assert.deepEqual(scrollCalls, [{ behavior: 'instant', block: 'start' }]);
  customizeButton.onclick();
  assert.equal(controls.hidden, true);
  assert.equal(attributes['aria-expanded'], 'false');
  assert.equal(scrollCalls.length, 1);
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
    characterCreator.drawStage(canvas, { ...character, background: 'bg_green_hills' });
    characterCreator.drawStage(canvas, { ...character, background: 'bg_yosemite' });
    assert.equal(pendingImages.length, 7);
    pendingImages.forEach(image => image.load());
    assert.equal(drawCalls.length, 6);
    assert.equal(drawCalls.filter(src => src.includes('Female')).length, 5);
    assert.equal(drawCalls.filter(src => src.includes('yosemite-bg')).length, 1);
    assert.equal(drawCalls.some(src => src.includes('/campfire/')), false);
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
check('starter character uses sprite-pack gear and starts without a companion', () => {
  assert.equal(characterCreator.normalizeCharacter().gender, 'male');
  assert.equal(characterCreator.normalizeCharacter().outfit, 'outfit_recruit');
  assert.equal(characterCreator.normalizeCharacter().top, 'starter_shirt');
  assert.equal(characterCreator.normalizeCharacter().bottoms, 'starter_pants');
  assert.equal(characterCreator.normalizeCharacter().shoes, 'simple_shoes');
  assert.equal(characterCreator.normalizeCharacter().pet, 'pet_none');
  assert.equal(characterCreator.normalizeCharacter().background, 'bg_campfire');
  assert.equal(characterCreator.normalizeCharacter().bodyShape, 'straight');
  assert.equal(characterCreator.normalizeCharacter().proUnlocked, false);
});
check('character migration clamps invalid values and preserves safe selections', () => {
  assert.deepEqual(characterCreator.normalizeCharacter({
    skinTone: 'deep', hairStyle: 'curls', outfit: 'outfit_parka',
    pet: 'pet_kitten_gray', background: 'bg_citadel',
    purchasedItems: ['orange_shirt', 'orange_pants', 'pet_black_cat'],
    proUnlocked: 'true', donationUsd: 100000000, unknown: 'discard'
  }), {
    ...characterCreator.DEFAULT_CHARACTER,
    skinTone: 'deep', hairStyle: 'hair_6', outfit: 'outfit_parka',
    top: 'orange_shirt', bottoms: 'orange_pants', pet: 'pet_black_cat',
    petAnimation: 'cat-13',
    purchasedItems: ['orange_shirt', 'orange_pants', 'pet_black_cat'],
    background: 'bg_campfire',
    proUnlocked: false, donationUsd: 1000000
  });
  assert.equal(characterCreator.normalizeCharacter({ hat: 'not-a-hat' }).hat, 'hat_none');
  assert.equal(characterCreator.normalizeCharacter({ background: 'bg_citadel' }).background, 'bg_campfire');
  assert.equal(characterCreator.normalizeCharacter({
    pet: 'pet_puppy_gold', purchasedItems: ['pet_trail_dog']
  }).pet, 'pet_trail_dog');
  assert.equal(characterCreator.normalizeCharacter({
    pet: 'pet_kitten_gray', purchasedItems: ['pet_black_cat']
  }).pet, 'pet_black_cat');
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
check('sprite hairstyle assets are available for their matching character sprites', () => {
  const maleStyles = characterCreator.HAIR_STYLES.filter(style => style.genders.includes('male'));
  const femaleStyles = characterCreator.HAIR_STYLES.filter(style => style.genders.includes('female'));
  assert.equal(maleStyles.length, 28);
  assert.equal(femaleStyles.length, 33);
  assert.equal(maleStyles.length * characterCreator.HAIR_COLORS.length, 168);
  assert.equal(femaleStyles.length * characterCreator.HAIR_COLORS.length, 198);
  assert.ok(characterCreator.characterSpriteAssets({
    ...characterCreator.DEFAULT_CHARACTER, hairStyle: 'hair_fancy'
  })[4].imageSrc.endsWith('/Fancy%20Hair.png'));
  assert.ok(characterCreator.characterSpriteAssets({
    ...characterCreator.DEFAULT_CHARACTER, gender: 'female', hairStyle: 'hair_35'
  })[4].imageSrc.endsWith('/Female%20Hair35.png'));
});
check('low-resolution frame profiles keep the V-taper broad at the shoulders and hourglass defined', () => {
  const { straight, vTaper, hourglass } = characterCreator.BODY_SHAPE_PROFILES;
  assert.equal(straight.length, 13);
  assert.ok(straight.every(width => width === straight[0]));
  assert.ok(Math.max(...vTaper.slice(0, 5)) > Math.max(...vTaper.slice(12)));
  assert.ok(Math.min(...hourglass.slice(5, 11)) < hourglass[0]);
  assert.ok(Math.max(...hourglass.slice(12)) <= hourglass[0]);
});
check('every bundled dog, cat, bunny, fox, and wisp has a valid animated sprite-sheet crop', () => {
  const dogs = characterCreator.PET_CATALOG.filter(item => item.id.startsWith('pet_trail_dog'));
  const cats = characterCreator.PET_CATALOG.filter(item => item.id.endsWith('_cat'));
  const bunny = characterCreator.PET_CATALOG.find(item => item.id === 'pet_bunny');
  const fox = characterCreator.PET_CATALOG.find(item => item.id === 'pet_trail_fox');
  const wisps = characterCreator.PET_CATALOG.filter(item => item.id.startsWith('pet_blue_wisp'));
  assert.deepEqual(dogs.map(pet => pet.name), [
    'Golden Trail Dog', 'Slate Trail Dog', 'Sandy Trail Dog', 'Cream Trail Dog', 'Shadow Trail Dog'
  ]);
  assert.deepEqual(cats.map(pet => pet.name), [
    'Black Cat', 'Ginger Cat', 'White Cat'
  ]);
  assert.equal(bunny.name, 'Bunny');
  assert.equal(fox.name, 'Trail Fox');
  assert.deepEqual(wisps.map(pet => pet.name), ['Blue Wisp', 'Outlined Blue Wisp']);
  const spritePets = [...dogs, ...cats, bunny, fox, ...wisps];
  for (const pet of spritePets) {
    assert.equal(pet.kind, 'sprite');
    const png = readFileSync(new URL(pet.imageSrc, import.meta.url));
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    const dimensions = pet.id.startsWith('pet_trail_dog') || pet === fox
      ? [192, 64]
      : pet === bunny ? [352, 1088]
      : pet.id.endsWith('_cat') ? [896, 4608] : [160, 32];
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], dimensions);
  }
  assert.ok(dogs.every(pet => pet.spriteSheet.frameCount === 5));
  assert.ok(cats.every(pet => pet.spriteSheet.frameCount === 8));
  assert.ok(cats.every(pet => pet.spriteSheet.row === 13), 'cat frames use the labeled Lick paw lie front row');
  assert.deepEqual(
    Object.fromEntries(['frameWidth', 'frameHeight', 'frameCount', 'row', 'sourceX',
      'sourceY', 'sourceWidth', 'sourceHeight', 'targetX', 'targetY', 'targetWidth',
      'targetHeight'].map(key => [key, bunny.spriteSheet[key]])),
    {
      frameWidth: 32, frameHeight: 16, frameCount: 9,
      row: 33, sourceX: 8, sourceY: 0, sourceWidth: 16, sourceHeight: 10,
      targetX: 101, targetY: 72, targetWidth: 16, targetHeight: 10
    }
  );
  assert.equal(fox.spriteSheet.frameCount, 5);
  assert.ok(spritePets.every(pet => pet.unlock.type === 'coin'));
  assert.ok(dogs.every(pet => pet.cost === 150));
  assert.ok(cats.every(pet => pet.cost === 150));
  assert.equal(fox.cost, 300);
  assert.ok(wisps.every(pet => pet.cost === 500));
  assert.ok(dogs.every(pet =>
    pet.spriteSheet.targetWidth === 24 && pet.spriteSheet.targetHeight === 16
  ));
  for (const pet of [...dogs, bunny, fox]) {
    assert.equal(
      pet.spriteSheet.targetY + pet.spriteSheet.targetHeight,
      82,
      `${pet.name} should meet the stage floor`
    );
  }
  assert.equal(cats[0].spriteSheet.targetY +
    47 * cats[0].spriteSheet.targetHeight / cats[0].spriteSheet.frameHeight, 81.5);
  assert.deepEqual([fox.spriteSheet.targetWidth, fox.spriteSheet.targetHeight], [15, 10]);
  assert.ok(spritePets.every(pet => pet.spriteSheet.sourceWidth > 0 && pet.spriteSheet.sourceHeight > 0));
  assert.ok(wisps.every(pet => pet.spriteSheet.frameCount === 5));
});
check('each pet exposes every configured atlas animation sequence and a valid default', () => {
  const dogs = characterCreator.PET_CATALOG.filter(item => item.id.startsWith('pet_trail_dog'));
  const cats = characterCreator.PET_CATALOG.filter(item => item.id.endsWith('_cat'));
  const bunny = characterCreator.PET_CATALOG.find(item => item.id === 'pet_bunny');
  const fox = characterCreator.PET_CATALOG.find(item => item.id === 'pet_trail_fox');
  const wisps = characterCreator.PET_CATALOG.filter(item => item.id.startsWith('pet_blue_wisp'));
  assert.deepEqual(dogs[0].spriteSheet.animations.map(({ id, row, frameColumns }) =>
    [id, row, frameColumns.length]), [
    ['walk', 0, 5], ['leap', 1, 6]
  ]);
  assert.ok(dogs.every(pet =>
    JSON.stringify(pet.spriteSheet.animations) === JSON.stringify(dogs[0].spriteSheet.animations)));
  assert.equal(cats[0].spriteSheet.animations.length, 66);
  assert.deepEqual(cats[0].spriteSheet.animations.find(animation => animation.id === 'cat-13'), {
    id: 'cat-13', name: 'Lick Paw · Front', row: 13,
    frameColumns: [0, 1, 2, 3, 4, 5, 6, 7]
  });
  assert.ok(cats.every(pet =>
    JSON.stringify(pet.spriteSheet.animations) === JSON.stringify(cats[0].spriteSheet.animations)));
  assert.equal(bunny.spriteSheet.animations.length, 68);
  assert.deepEqual(bunny.spriteSheet.animations.find(animation => animation.id === 'bunny-33'), {
    id: 'bunny-33', name: 'Sequence 34 (row 33)', row: 33,
    frameColumns: [0, 1, 2, 3, 4, 5, 6, 7, 8]
  });
  assert.deepEqual(fox.spriteSheet.animations.map(({ id, row, frameColumns }) =>
    [id, row, frameColumns.length]), [['walk', 0, 5], ['leap', 1, 6]]);
  assert.ok(wisps.every(pet => pet.spriteSheet.animations.map(animation => animation.id)
    .join(',') === 'float'));
  for (const pet of [...dogs, ...cats, bunny, fox, ...wisps]) {
    const animation = pet.spriteSheet.animations.find(
      item => item.id === pet.spriteSheet.defaultAnimationId);
    assert.ok(animation, `${pet.id} has a default animation`);
    assert.ok(animation.frameColumns.length > 1, `${pet.id} default animates multiple frames`);
  }
});
check('companion sprite sheets crop the selected animation frame', () => {
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
    const bunny = characterCreator.PET_CATALOG.find(item => item.id === 'pet_bunny');
    const fox = characterCreator.PET_CATALOG.find(item => item.id === 'pet_trail_fox');
    const wisp = characterCreator.PET_CATALOG.find(item => item.id === 'pet_blue_wisp');
    const outlinedWisp = characterCreator.PET_CATALOG.find(item => item.id === 'pet_blue_wisp_outline');
    characterCreator.drawPet(context, dog, () => {}, 2);
    characterCreator.drawPet(context, cat, () => {}, 1);
    characterCreator.drawPet(context, bunny, () => {}, 8);
    characterCreator.drawPet(context, fox, () => {}, 2);
    characterCreator.drawPet(context, fox, () => {}, 5);
    characterCreator.drawPet(context, wisp, () => {}, 4);
    characterCreator.drawPet(context, outlinedWisp, () => {}, 1);
    characterCreator.drawPet(context, dog, () => {}, 5, 'leap');
    characterCreator.drawPet(context, cat, () => {}, 5, 'cat-2');
    characterCreator.drawPet(context, bunny, () => {}, 4, 'bunny-8');
    characterCreator.drawPet(context, fox, () => {}, 5, 'leap');
    characterCreator.drawPet(context, bunny, () => {}, 4, 'bunny-36');
    characterCreator.drawPet(context, bunny, () => {}, 8, 'bunny-38');
    assert.deepEqual(drawCalls[0].slice(1), [65, 13, 29, 19, 101, 66, 24, 16]);
    assert.deepEqual(drawCalls[1].slice(1), [64, 832, 64, 64, 96, 58, 32, 32]);
    assert.deepEqual(drawCalls[2].slice(1), [264, 528, 16, 10, 101, 72, 16, 10]);
    assert.deepEqual(drawCalls[3].slice(1), [65, 14, 29, 18, 103, 72, 15, 10]);
    assert.deepEqual(drawCalls[4].slice(1), [1, 14, 29, 18, 103, 72, 15, 10]);
    assert.deepEqual(drawCalls[5].slice(1), [137, 5, 14, 22, 107, 62, 7, 11]);
    assert.deepEqual(drawCalls[6].slice(1), [40, 4, 16, 24, 107, 62, 7, 11]);
    assert.deepEqual(drawCalls[7].slice(1), [161, 45, 29, 19, 101, 66, 24, 16]);
    assert.deepEqual(drawCalls[8].slice(1), [320, 128, 64, 64, 96, 58, 32, 32]);
    assert.deepEqual(drawCalls[9].slice(1), [168, 128, 16, 10, 101, 72, 16, 10]);
    assert.deepEqual(drawCalls[10].slice(1), [161, 46, 29, 18, 103, 72, 15, 10]);
    assert.deepEqual(drawCalls[11].slice(1), [128, 576, 16, 16, 94, 66, 16, 16]);
    assert.deepEqual(drawCalls[12].slice(1), [272, 608, 16, 16, 107, 66, 16, 16]);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});
check('character effects use their own animation frames while the explorer gently bobs', () => {
  const originalImage = globalThis.Image;
  globalThis.Image = class {
    constructor() {
      this.complete = true;
      this.naturalWidth = 896;
      this.src = '';
    }
  };
  try {
    const effect = characterCreator.SHOP_WARDROBE.find(item => item.field === 'effect');
    const character = characterCreator.normalizeCharacter({
      ...characterCreator.DEFAULT_CHARACTER, effect: effect.id, purchasedItems: [effect.id]
    });
    const effectLayer = characterCreator.characterSpriteAssets(character)
      .find(layer => layer.layer === 'effect');
    const drawCalls = [];
    const context = {
      save() {},
      restore() {},
      set filter(_) {},
      drawImage(...args) { drawCalls.push(args); }
    };
    characterCreator.drawCharacterSprite(context, character, () => {}, 2, 1);
    const effectCall = drawCalls.find(call => call[0].src === effectLayer.imageSrc);
    assert.ok(effectCall);
    assert.deepEqual(effectCall.slice(1), [184, 16, 32, 48, 62, 40, 36, 43]);
    assert.ok(drawCalls.every(call => call[6] === 40));
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
  ), { unlocked: false, description: 'Visit 50 Global Parks (12/50).' });
});
check('the explorer track contains paired gender gear for all ten levels', () => {
  assert.deepEqual(characterCreator.LEVEL_TRACK.map(reward => reward.level),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(characterCreator.LEVEL_ITEMS.every(item =>
    item.unlock.type === 'level' && item.paths.male && item.paths.female));
  assert.deepEqual(characterCreator.LEVEL_TRACK[0].itemIds,
    ['starter_shirt', 'starter_pants', 'simple_shoes']);
  assert.ok(characterCreator.LEVEL_TRACK[9].itemIds.includes('diamond_sword'));
  assert.ok(characterCreator.LEVEL_TRACK[9].itemIds.includes('hair_shield_maiden'));
  for (const reward of characterCreator.LEVEL_TRACK.slice(1)) {
    assert.ok(reward.itemIds.some(id => characterCreator.LEVEL_ITEMS.some(item =>
      item.id === id && item.variantSpec && item.unlock.goal === reward.level)),
    `level ${reward.level} includes a generated clothing reward`);
  }
});
check('variant clothing includes all requested rewards and valid paired sprite-sheet paths', () => {
  const levelIds = [
    'pine_trail_flannel', 'scout_cargo_pants', 'meadow_forager_tunic',
    'wayfarer_field_vest', 'canyon_work_denim', 'redwood_flannel_jacket',
    'vanguard_tabard', 'highlander_gilded_pants', 'sovereign_cartographer_coat'
  ];
  const parkIds = [
    'volunteer_park_tee', 'ranger_hat_brown', 'park_ranger_uniform', 'ranger_trail_pants',
    'ranger_hat_silver', 'ranger_hat_gold', 'grand_warden_cloak', 'ranger_hat_diamond'
  ];
  const achievementIds = [
    'khaki_trail_pants', 'mist_rain_poncho', 'cavern_miner_suit', 'summit_down_parka',
    'overland_canvas_jacket', 'mariner_pea_coat', 'photographer_vest', 'arctic_aurora_cloak',
    'blue_ridge_flannel', 'alpine_timberline_jacket', 'continental_cape',
    'centennial_ranger_coat', 'gaia_druid_mantle'
  ];
  assert.deepEqual(characterCreator.LEVEL_ITEMS.filter(item => item.variantSpec)
    .map(item => item.id), levelIds);
  assert.deepEqual(characterCreator.PARK_MILESTONE_ITEMS.map(item => item.id), parkIds);
  assert.deepEqual(characterCreator.ACHIEVEMENT_ITEMS.map(item => item.id), achievementIds);
  const rangerHats = characterCreator.PARK_MILESTONE_ITEMS.filter(item =>
    item.variantSpec.pattern === 'hatBand');
  assert.equal(rangerHats.length, 4);
  assert.ok(rangerHats.every(item =>
    item.variantSpec.bandRowsByGender.male.join(',') === '21' &&
    item.variantSpec.bandRowsByGender.female.join(',') === '22' &&
    item.variantSpec.bandXRange.join(',') === '39,46'));
  const allVariantItems = [
    ...characterCreator.LEVEL_ITEMS.filter(item => item.variantSpec),
    ...characterCreator.PARK_MILESTONE_ITEMS, ...characterCreator.ACHIEVEMENT_ITEMS
  ];
  const checkedPaths = new Set();
  for (const item of allVariantItems) {
    assert.deepEqual(item.genders, ['male', 'female'], item.id);
    for (const gender of item.genders) {
      const path = item.paths[gender];
      assert.ok(path, `${item.id} has a ${gender} sprite path`);
      const png = readFileSync(new URL(path, import.meta.url));
      assert.equal(png.toString('ascii', 1, 4), 'PNG', `${item.id} ${gender} image`);
      const dimensions = [png.readUInt32BE(16), png.readUInt32BE(20)];
      assert.equal(dimensions[0] % 80, 0, `${item.id} ${gender} frame width`);
      assert.equal(dimensions[1] % 64, 0, `${item.id} ${gender} frame height`);
      checkedPaths.add(path);
      const layer = characterCreator.characterSpriteAssets({
        ...characterCreator.DEFAULT_CHARACTER, gender, [item.field]: item.id
      }).find(candidate => candidate.variantSpec?.palette === item.variantSpec.palette);
      assert.ok(layer, `${item.id} reaches the ${gender} character sprite layers`);
    }
  }
  assert.ok([...checkedPaths].some(path => path.endsWith('Cape green.png')),
    'cape template is included');
});
check('park and achievement clothing unlock at their exact requirements', () => {
  const character = characterCreator.normalizeCharacter();
  const parkGoals = [5, 10, 15, 25, 35, 50, 75, 100];
  characterCreator.PARK_MILESTONE_ITEMS.forEach((item, index) => {
    assert.equal(item.unlock.goal, parkGoals[index], item.id);
    assert.equal(characterCreator.unlockStatus(item.unlock, {
      visitedParks: Array(parkGoals[index] - 1).fill('park')
    }, character, new Map()).unlocked, false, item.id);
    assert.equal(characterCreator.unlockStatus(item.unlock, {
      visitedParks: Array(parkGoals[index]).fill('park')
    }, character, new Map()).unlocked, true, item.id);
  });
  const titles = new Map([
    ['firstSteps', 'First Steps'], ['waterfalls_1', 'Chasing Waterfalls'],
    ['subterranean', 'Subterranean'], ['thinAir', 'Thin Air'],
    ['overlander', 'Overlander'], ['mariner', 'Mariner'],
    ['focal', 'Focal Point'], ['longDark', 'The Long Dark'],
    ['countryRoads', 'Country Roads'], ['rockyMountainHigh', 'Rocky Mountain High'],
    ['fiftyNifty', 'Fifty Nifty'], ['americaTheBeautiful', 'America the Beautiful'],
    ['gaiaWanderer', 'Gaia Wanderer']
  ]);
  const definitions = [...titles].map(([id, title]) => ({
    id, title, progress: stats => stats.achievementsDone ? 1 : 0, tiers: [{ goal: 1 }]
  }));
  const incomplete = characterCreator.achievementProgress({}, definitions);
  const complete = characterCreator.achievementProgress({ achievementsDone: true }, definitions);
  const recorded = characterCreator.achievementProgress({
    completedAchievementTiers: [...titles.keys()].map(id => ({ key: `${id}:0` }))
  }, definitions);
  for (const item of characterCreator.ACHIEVEMENT_ITEMS) {
    assert.equal(characterCreator.unlockStatus(item.unlock, {}, character, incomplete).unlocked,
      false, item.id);
    assert.equal(characterCreator.unlockStatus(item.unlock, {}, character, complete).unlocked,
      true, item.id);
    assert.equal(characterCreator.unlockStatus(item.unlock, {}, character, recorded).unlocked,
      true, `${item.id} unlocks from recorded achievement tier`);
  }
  assert.equal(characterCreator.unlockStatus(
    { type: 'achievement', id: 'thinAir' }, {}, character, incomplete
  ).description, 'Unlock Achievement: Thin Air (0/1).');
  const controls = { dataset: { activeTab: 'wardrobe' }, innerHTML: '' };
  characterCreator.render({
    controls, character, stats: { level: 1, visitedParks: [] }, achievements: definitions
  });
  assert.match(controls.innerHTML, /Unlock Achievement: Thin Air \(0\/1\)/);
  controls.dataset.activeWardrobeField = 'headwear';
  characterCreator.render({
    controls, character, stats: { level: 1, visitedParks: [] }, achievements: definitions
  });
  assert.match(controls.innerHTML, /Visit 10 Global Parks \(0\/10\)/);
});
check('sprite palette shader recolors frames, preserves outlines and transparency, and caches variants', () => {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
      this.context = {
        drawImage: image => { this.data.set(image.data); },
        getImageData: () => ({ data: this.data }),
        putImageData: imageData => { this.data.set(imageData.data); },
        clearRect() {}
      };
    }
    getContext() { return this.context; }
  }
  globalThis.OffscreenCanvas = FakeOffscreenCanvas;
  const source = {
    src: 'fixture-sheet.png', naturalWidth: 160, naturalHeight: 64,
    data: new Uint8ClampedArray(160 * 64 * 4)
  };
  const setPixel = (x, y, rgba) => source.data.set(rgba, (y * source.naturalWidth + x) * 4);
  const pixelAt = (canvas, x, y) =>
    [...canvas.data.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)];
  setPixel(0, 0, [240, 240, 240, 0]);
  setPixel(1, 0, [0, 0, 0, 255]);
  setPixel(2, 2, [150, 150, 150, 255]);
  setPixel(4, 1, [150, 150, 150, 255]);
  setPixel(3, 3, [230, 230, 230, 255]);
  setPixel(7, 2, [90, 90, 90, 255]);
  setPixel(84, 2, [150, 150, 150, 255]);
  setPixel(30, 2, [150, 150, 150, 255]);
  setPixel(31, 2, [150, 150, 150, 255]);
  setPixel(36, 2, [150, 150, 150, 255]);
  setPixel(39, 5, [150, 150, 150, 255]);
  setPixel(40, 21, [150, 150, 150, 255]);
  setPixel(40, 22, [150, 150, 150, 255]);
  setPixel(39, 44, [150, 150, 150, 255]);
  setPixel(34, 40, [150, 150, 150, 255]);
  setPixel(38, 40, [150, 150, 150, 255]);
  setPixel(40, 40, [150, 150, 150, 255]);
  setPixel(42, 40, [150, 150, 150, 255]);
  setPixel(38, 38, [150, 150, 150, 255]);
  setPixel(40, 38, [150, 150, 150, 255]);
  setPixel(42, 38, [150, 150, 150, 255]);
  setPixel(39, 39, [150, 150, 150, 255]);
  setPixel(40, 39, [150, 150, 150, 255]);
  setPixel(39, 40, [150, 150, 150, 255]);
  setPixel(37, 39, [150, 150, 150, 255]);
  setPixel(43, 39, [150, 150, 150, 255]);
  setPixel(38, 36, [150, 150, 150, 255]);
  setPixel(40, 36, [150, 150, 150, 255]);
  try {
    const plaid = {
      palette: { shadow: '#112233', base: '#445566', highlight: '#aabbcc', accent: '#deadde' },
      pattern: 'plaid'
    };
    const processed = characterCreator.processSpriteVariant(source, plaid);
    assert.deepEqual(pixelAt(processed, 0, 0), [240, 240, 240, 0]);
    assert.deepEqual(pixelAt(processed, 1, 0), [0, 0, 0, 255]);
    assert.deepEqual(pixelAt(processed, 2, 2), [0x44, 0x55, 0x66, 255]);
    assert.deepEqual(pixelAt(processed, 4, 1), [0xde, 0xad, 0xde, 255]);
    assert.deepEqual(pixelAt(processed, 3, 3), [0xaa, 0xbb, 0xcc, 255]);
    assert.deepEqual(pixelAt(processed, 7, 2), [0x11, 0x22, 0x33, 255]);
    assert.deepEqual(pixelAt(processed, 84, 2), [0xde, 0xad, 0xde, 255]);
    assert.strictEqual(characterCreator.processSpriteVariant(source, plaid), processed);
    const vest = characterCreator.processSpriteVariant(source, {
      palette: {
        shadow: '#112233', base: '#445566', highlight: '#aabbcc',
        sleeve: '#123456', accent: '#654321'
      },
      pattern: 'vest'
    });
    assert.deepEqual(pixelAt(vest, 2, 2), [0x12, 0x34, 0x56, 255]);
    assert.deepEqual(pixelAt(vest, 38, 38), [0x44, 0x55, 0x66, 255]);
    assert.deepEqual(pixelAt(vest, 42, 38), [0x44, 0x55, 0x66, 255]);
    assert.deepEqual(pixelAt(vest, 40, 38), [0x44, 0x55, 0x66, 255]);
    assert.deepEqual(pixelAt(vest, 40, 40), [0x44, 0x55, 0x66, 255]);
    assert.deepEqual(pixelAt(vest, 38, 40), [0x44, 0x55, 0x66, 255]);
    assert.deepEqual(pixelAt(vest, 42, 40), [0x44, 0x55, 0x66, 255]);
    assert.deepEqual(pixelAt(vest, 37, 39), [0x65, 0x43, 0x21, 255]);
    assert.deepEqual(pixelAt(vest, 43, 39), [0x65, 0x43, 0x21, 255]);
    assert.deepEqual(pixelAt(vest, 38, 36), [0x44, 0x55, 0x66, 255]);
    assert.deepEqual(pixelAt(vest, 40, 36), [0x12, 0x34, 0x56, 255]);
    assert.deepEqual(pixelAt(vest, 34, 40), [0x12, 0x34, 0x56, 255]);
    const jacket = characterCreator.processSpriteVariant(source, {
      palette: { shadow: '#112233', base: '#445566', highlight: '#aabbcc', accent: '#deadde' },
      pattern: 'jacket'
    });
    assert.deepEqual(pixelAt(jacket, 39, 5), [0x44, 0x55, 0x66, 255]);
    assert.deepEqual(pixelAt(jacket, 39, 44), [0x44, 0x55, 0x66, 255]);
    const buttoned = characterCreator.processSpriteVariant(source, {
      palette: { shadow: '#112233', base: '#445566', highlight: '#aabbcc', accent: '#435238' },
      pattern: 'buttons'
    });
    assert.deepEqual(pixelAt(buttoned, 40, 40), [0x43, 0x52, 0x38, 255]);
    assert.deepEqual(pixelAt(buttoned, 39, 40), [0x44, 0x55, 0x66, 255]);
    const hat = characterCreator.processSpriteVariant(source, {
      palette: { shadow: '#112233', base: '#445566', highlight: '#aabbcc', band: ['#00ffff', '#ffffff'] },
      pattern: 'hatBand', bandRows: [2], bandXRange: [29, 50]
    });
    assert.deepEqual(pixelAt(hat, 30, 2), [0x00, 0xff, 0xff, 255]);
    assert.deepEqual(pixelAt(hat, 31, 2), [0xff, 0xff, 0xff, 255]);
    const rangerHat = characterCreator.PARK_MILESTONE_ITEMS.find(item =>
      item.id === 'ranger_hat_gold').variantSpec;
    const maleHat = characterCreator.processSpriteVariant(source, { ...rangerHat, gender: 'male' });
    const femaleHat = characterCreator.processSpriteVariant(source, { ...rangerHat, gender: 'female' });
    assert.deepEqual(pixelAt(maleHat, 40, 21), [0xed, 0xc0, 0x4d, 255]);
    assert.deepEqual(pixelAt(maleHat, 40, 22), [0xb7, 0x95, 0x61, 255]);
    assert.deepEqual(pixelAt(femaleHat, 40, 21), [0xb7, 0x95, 0x61, 255]);
    assert.deepEqual(pixelAt(femaleHat, 40, 22), [0xed, 0xc0, 0x4d, 255]);
    const cape = characterCreator.processSpriteVariant({
      src: 'cape-sheet.png', naturalWidth: 720, naturalHeight: 448,
      data: new Uint8ClampedArray(720 * 448 * 4)
    }, { palette: { shadow: '#112233', base: '#445566', highlight: '#aabbcc' } });
    assert.deepEqual([cape.width, cape.height], [720, 448]);
  } finally {
    if (originalOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalOffscreenCanvas;
  }
});
check('Wayfarer Coins deterministically sum travel, rarity, regions, levels, achievements, and purchases', () => {
  const summary = characterCreator.coinSummary({
    level: 4,
    visitedParks: ['park_1', 'park_2'],
    visitedCountries: ['United States'],
    visitedStates: ['California'],
    metadataProgress: {
      rarityEntities: [
        { kind: 'poi', tier: 'Tourist Trap' },
        { kind: 'photon', tier: 'Uncharted' },
        { kind: 'park', tier: 'Hidden Gem' }
      ],
      visitedSubdivisionIds: ['California', 'New South Wales'],
      visitedCountyIds: ['06001']
    },
    completedAchievementTiers: [{ rarity: 'common' }, { rarity: 'rare' }]
  }, {
    expeditions: [
      { startDate: '2024-01-01', endDate: '2024-01-03' },
      {}
    ],
    regions: {
      'c:United States': 'v',
      'c:Canada': 'v',
      's:California': 'v',
      's:New South Wales': 'l'
    },
    counties: { '06003': 'l' },
    character: {
      ...characterCreator.DEFAULT_CHARACTER,
      purchasedItems: ['dog_hat', 'pet_trail_fox', 'blue_bodice']
    }
  });
  assert.deepEqual(summary, { earnedCoins: 454, spentCoins: 500, availableCoins: 0 });
});
check('coin purchases require enough coins, equip on purchase, and charge only once', () => {
  const choosePet = (level, character = characterCreator.DEFAULT_CHARACTER) => {
    const controls = { dataset: { activeTab: 'shop' }, innerHTML: '' };
    let changedCharacter;
    characterCreator.render({
      controls, character, stats: { level },
      appState: { character },
      onChange: next => { changedCharacter = next; }
    });
    controls.onclick({
      target: {
        closest(selector) {
          if (selector === '[data-character-tab]') return null;
          if (selector === 'button[data-character-field][data-character-id]') {
            return { dataset: { characterField: 'pet', characterId: 'pet_trail_dog' }, disabled: false };
          }
          return null;
        }
      }
    });
    return changedCharacter;
  };
  assert.equal(choosePet(3), undefined);
  const purchased = choosePet(4);
  assert.equal(purchased.pet, 'pet_trail_dog');
  assert.deepEqual(purchased.purchasedItems, ['pet_trail_dog']);
  assert.deepEqual(characterCreator.coinSummary({ level: 4 }, { character: purchased }), {
    earnedCoins: 150, spentCoins: 150, availableCoins: 0
  });
  assert.equal(characterCreator.normalizeCharacter({
    top: 'blue_shirt'
  }).top, 'starter_shirt');
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
check('backgrounds include a free Green Hills scene and park-visit gated scenes', () => {
  assert.deepEqual(characterCreator.BACKGROUND_CATALOG.map(item => item.id), [
    'bg_campfire', 'bg_green_hills', 'bg_yellowstone', 'bg_grand_canyon',
    'bg_redwood', 'bg_arches', 'bg_yosemite'
  ]);
  assert.equal(characterCreator.BACKGROUND_CATALOG[1].unlock.type, 'starter');
  const expectedParkCodes = ['yell', 'grca', 'redw', 'arch', 'yose'];
  assert.deepEqual(characterCreator.BACKGROUND_CATALOG.slice(2)
    .map(item => item.unlock.parkId), expectedParkCodes);
  for (const background of characterCreator.BACKGROUND_CATALOG.slice(2)) {
    const code = background.unlock.parkId;
    assert.equal(characterCreator.unlockStatus(
      background.unlock, { visitedParks: [] }, characterCreator.DEFAULT_CHARACTER, new Map()
    ).unlocked, false);
    assert.equal(characterCreator.unlockStatus(
      background.unlock, { visitedParks: [{ id: code }] },
      characterCreator.DEFAULT_CHARACTER, new Map()
    ).unlocked, true);
    assert.equal(characterCreator.unlockStatus(
      background.unlock, { visitedParks: [code] },
      characterCreator.DEFAULT_CHARACTER, new Map()
    ).unlocked, true);
  }
});
check('all supplied stage backgrounds use valid 3200x1800 PNG art', () => {
  for (const background of characterCreator.BACKGROUND_CATALOG) {
    const png = readFileSync(new URL(background.imageSrc, import.meta.url));
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [3200, 1800]);
  }
});
check('Campfire Night slices its eight-frame sprite over the background glow', () => {
  const background = characterCreator.BACKGROUND_CATALOG.find(item => item.id === 'bg_campfire');
  assert.equal(background.imageSrc, './assets/backgrounds/campfire-night.png');
  const sprite = readFileSync(new URL('./assets/campfire/Small_sheet.png', import.meta.url));
  assert.equal(sprite.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([sprite.readUInt32BE(16), sprite.readUInt32BE(20)], [256, 32]);
  const originalImage = globalThis.Image;
  globalThis.Image = class {
    constructor() { this.complete = true; this.naturalWidth = 256; this.src = ''; }
  };
  try {
    const drawCalls = [];
    characterCreator.drawCampfire({ drawImage(...args) { drawCalls.push(args); } }, () => {}, 5);
    assert.deepEqual(drawCalls[0].slice(1), [160, 0, 32, 32, 38, 59, 20, 20]);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});
check('the shared stage animation loop advances pets, effects, and character bob on resume', () => {
  const originalImage = globalThis.Image;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const intervalCallbacks = [];
  const clearedIntervals = [];
  let reducedMotion = true;
  globalThis.Image = class {
    constructor() {
      this.complete = true;
      this.naturalWidth = 896;
      this.src = '';
    }
  };
  globalThis.window = {
    setInterval(callback, delay) {
      assert.equal(delay, 110);
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    clearInterval(id) { clearedIntervals.push(id); },
    matchMedia: () => ({ matches: reducedMotion })
  };
  globalThis.document = { visibilityState: 'hidden' };
  try {
    const dog = characterCreator.PET_CATALOG.find(item => item.id === 'pet_trail_dog');
    const effect = characterCreator.SHOP_WARDROBE.find(item => item.field === 'effect');
    const character = characterCreator.normalizeCharacter({
      ...characterCreator.DEFAULT_CHARACTER,
      background: 'bg_green_hills',
      pet: dog.id,
      effect: effect.id,
      petHat: 'dog_hat',
      petBackpack: 'dog_backpack',
      purchasedItems: [dog.id, effect.id, 'dog_hat', 'dog_backpack']
    });
    const drawCalls = [];
    const context = {
      clearRect() {},
      save() {},
      scale() {},
      restore() {},
      fillRect() {},
      drawImage(...args) { drawCalls.push(args); }
    };
    const canvas = {
      width: 320, height: 180, isConnected: true,
      getClientRects: () => [{}],
      getContext: () => context
    };
    characterCreator.drawStage(canvas, character);
    assert.equal(intervalCallbacks.length, 1);
    const dogCall = () => drawCalls.findLast(call => call[0].src === dog.imageSrc);
    const effectPath = characterCreator.characterSpriteAssets(character)
      .find(layer => layer.layer === 'effect').imageSrc;
    const effectCall = () => drawCalls.findLast(call => call[0].src === effectPath);
    const petAccessoryCalls = () => drawCalls.filter(call =>
      /doggy%20(?:hat|backpack)\.png$/.test(call[0].src));
    const currentPetAccessoryCalls = () => petAccessoryCalls().slice(-2);
    assert.deepEqual(dogCall().slice(1, 5), [1, 13, 29, 19]);
    assert.deepEqual(effectCall().slice(1, 5), [24, 16, 32, 48]);
    const hiddenDrawCount = drawCalls.length;
    intervalCallbacks[0]();
    assert.equal(drawCalls.length, hiddenDrawCount);
    globalThis.document.visibilityState = 'visible';
    intervalCallbacks[0]();
    assert.equal(drawCalls.length, hiddenDrawCount);
    reducedMotion = false;
    intervalCallbacks[0]();
    intervalCallbacks[0]();
    intervalCallbacks[0]();
    assert.deepEqual(dogCall().slice(1, 5), [33, 13, 29, 19]);
    assert.deepEqual(effectCall().slice(1, 5), [104, 16, 32, 48]);
    assert.equal(effectCall()[6], 40);
    assert.equal(currentPetAccessoryCalls().length, 2);
    assert.ok(currentPetAccessoryCalls().every(call => call[1] === 32));
    canvas.isConnected = false;
    intervalCallbacks[0]();
    assert.deepEqual(clearedIntervals, [1]);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
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
      outfit: 'outfit_vest',
      top: 'blue_shirt',
      purchasedItems: ['blue_shirt']
    };
    const assets = characterCreator.characterSpriteAssets(character);
    assert.deepEqual(assets.map(layer =>
      decodeURIComponent(layer.imageSrc.split('/').at(-1))), [
      'Female Skin5.png', 'Skirt.png', 'Boots.png', 'Blue Corset v2.png', 'Female Hair10.png'
    ]);
    for (const asset of assets) {
      const png = readFileSync(new URL(asset.imageSrc, import.meta.url));
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
      call.length === 9 && call.slice(1).join(',') === '24,16,32,48,62,39,36,43'
    ));
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});

check('dog accessories share the dog frame origin and scale for every coat', () => {
  const originalImage = globalThis.Image;
  globalThis.Image = class {
    constructor() { this.complete = true; this.naturalWidth = 192; this.src = ''; }
  };
  try {
    const calls = [];
    const context = {
      clearRect() {}, save() {}, scale() {}, restore() {}, fillRect() {},
      drawImage(...args) { calls.push(args); }
    };
    const canvas = { width: 320, height: 180, getContext: () => context };
    for (const dog of characterCreator.PET_CATALOG.filter(pet => pet.id.startsWith('pet_trail_dog'))) {
      calls.length = 0;
      characterCreator.drawStage(canvas, {
        ...characterCreator.DEFAULT_CHARACTER, background: 'bg_green_hills',
        pet: dog.id, petHat: 'dog_hat', petBackpack: 'dog_backpack',
        purchasedItems: [dog.id, 'dog_hat', 'dog_backpack']
      });
      const body = calls.find(call => call[0].src === dog.imageSrc);
      const accessories = calls.filter(call => /doggy%20(hat|backpack)\.png$/.test(call[0].src));
      assert.ok(body, dog.id);
      assert.equal(accessories.length, 2, dog.id);
      for (const accessory of accessories) {
        const [, sx, sy, sw, sh, dx, dy, dw, dh] = accessory;
        assert.deepEqual([sx, sy, sw, sh], [0, 0, 32, 32]);
        const sprite = dog.spriteSheet;
        assert.equal(dw / sw, sprite.targetWidth / sprite.sourceWidth);
        assert.equal(dh / sh, sprite.targetHeight / sprite.sourceHeight);
        assert.equal(dx + sprite.sourceX * dw / sw, sprite.targetX);
        assert.equal(dy + sprite.sourceY * dh / sh, sprite.targetY);
      }
    }
    const dog = characterCreator.PET_CATALOG.find(pet => pet.id === 'pet_trail_dog');
    calls.length = 0;
    characterCreator.drawStage(canvas, {
      ...characterCreator.DEFAULT_CHARACTER, background: 'bg_green_hills',
      pet: dog.id, petAnimation: 'leap', petHat: 'dog_hat', petBackpack: 'dog_backpack',
      purchasedItems: [dog.id, 'dog_hat', 'dog_backpack']
    }, {}, 10);
    const leapBody = calls.find(call => call[0].src === dog.imageSrc);
    const leapAccessories = calls.filter(call =>
      /doggy%20(hat|backpack)\.png$/.test(call[0].src));
    assert.deepEqual(leapBody.slice(1, 5), [161, 45, 29, 19]);
    assert.equal(leapAccessories.length, 2);
    assert.ok(leapAccessories.every(call => call[1] === 160 && call[2] === 32));
    const controls = { dataset: { activeTab: 'pets' }, innerHTML: '' };
    characterCreator.render({ controls, character: characterCreator.DEFAULT_CHARACTER });
    for (const field of ['petHat', 'petBackpack']) {
      assert.match(controls.innerHTML,
        new RegExp(`data-character-field="${field}"[\\s\\S]*?aria-pressed="true"\\s+disabled`));
    }
    assert.match(controls.innerHTML, /width:240px;height:80px/);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});

console.log(`\n${checks} character creator checks passed.`);
