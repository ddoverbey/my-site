import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

check('frame-only recoloring matches the full sheet and shares whole-sheet luminance analysis', () => {
  const previous = globalThis.OffscreenCanvas;
  const reads = [];
  class PixelCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
    getContext() {
      return {
        drawImage: image => {
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          for (let y = 0; y < Math.min(height, this.height); y++) {
            this.data.set(image.data.subarray(y * width * 4,
              (y * width + Math.min(width, this.width)) * 4), y * this.width * 4);
          }
        },
        getImageData: () => {
          reads.push([this.width, this.height]);
          return { data: new Uint8ClampedArray(this.data) };
        },
        putImageData: image => this.data.set(image.data)
      };
    }
  }
  globalThis.OffscreenCanvas = PixelCanvas;
  try {
    const source = {
      src: 'frame-performance-fixture.png', naturalWidth: 160, naturalHeight: 128,
      data: new Uint8ClampedArray(160 * 128 * 4)
    };
    source.data.set([110, 110, 110, 255], (20 * 160 + 30) * 4);
    source.data.set([255, 255, 255, 255], (100 * 160 + 100) * 4);
    source.data.set([39, 19, 15, 255], (27 * 160 + 37) * 4);
    const variant = {
      palette: { outline: '#101112', shadow: '#202122', base: '#404142', highlight: '#808182' },
      colorizeByLuminance: true
    };
    const frame = characterCreator.processSpriteVariant(source, variant, true);
    assert.equal(frame.width, 80);
    assert.equal(frame.height, 64);
    assert.equal(reads.filter(([width]) => width === 160).length, 1);
    const second = characterCreator.processSpriteVariant(source, {
      ...variant, palette: { ...variant.palette, base: '#445566' }
    }, true);
    assert.equal(second.width, 80);
    assert.equal(reads.filter(([width]) => width === 160).length, 1,
      'another hair color must not reread the entire sheet');
    assert.strictEqual(characterCreator.processSpriteVariant(source, variant, true), frame);
    const full = characterCreator.processSpriteVariant(source, variant);
    for (let y = 0; y < 64; y++) {
      assert.deepEqual(frame.data.subarray(y * 80 * 4, (y + 1) * 80 * 4),
        full.data.subarray(y * 160 * 4, (y * 160 + 80) * 4));
    }
    const eyeFrame = characterCreator.processSpriteEyeColor(source, 'blue', 'male', undefined, true);
    const eyeSheet = characterCreator.processSpriteEyeColor(source, 'blue', 'male');
    assert.equal(eyeFrame.width, 80);
    assert.equal(eyeFrame.height, 64);
    for (let y = 0; y < 64; y++) {
      assert.deepEqual(eyeFrame.data.subarray(y * 80 * 4, (y + 1) * 80 * 4),
        eyeSheet.data.subarray(y * 160 * 4, (y * 160 + 80) * 4));
    }
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previous;
  }
});
check('customization previews wait for visible intersections and release observers on rerender', () => {
  const previous = globalThis.IntersectionObserver;
  const observers = [];
  let draws = 0;
  const canvas = {
    dataset: { petPreview: 'pet_none' }, isConnected: true,
    getContext() {
      draws++;
      return { clearRect() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {} };
    }
  };
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.unobserved = [];
      this.disconnected = false;
      observers.push(this);
    }
    observe(target) { this.observed.push(target); }
    unobserve(target) { this.unobserved.push(target); }
    disconnect() { this.disconnected = true; }
  };
  const controls = {
    dataset: { activeTab: 'pets' }, hidden: true, innerHTML: '',
    querySelectorAll(selector) { return selector === 'canvas[data-pet-preview]' ? [canvas] : []; }
  };
  const customizeButton = { setAttribute() {} };
  try {
    characterCreator.render({ controls, customizeButton });
    assert.equal(draws, 0);
    assert.equal(observers.length, 0, 'collapsed customization does no preview work');
    customizeButton.onclick();
    assert.equal(observers.length, 1);
    assert.deepEqual(observers[0].observed, [canvas]);
    observers[0].callback([{ target: canvas, isIntersecting: false }]);
    assert.equal(draws, 0);
    observers[0].callback([{ target: canvas, isIntersecting: true }]);
    assert.equal(draws, 1);
    assert.deepEqual(observers[0].unobserved, [canvas]);
    characterCreator.render({ controls, customizeButton });
    assert.equal(observers[0].disconnected, true);
    canvas.isConnected = false;
    observers[1].callback([{ target: canvas, isIntersecting: true }]);
    assert.equal(draws, 1, 'stale detached previews do not render');
  } finally {
    if (previous === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = previous;
  }
});
check('catalogs share one coin calculation per controls render', () => {
  let regionReads = 0;
  const appState = { character: characterCreator.DEFAULT_CHARACTER };
  Object.defineProperty(appState, 'regions', { get() { regionReads++; return {}; } });
  const controls = { dataset: { activeTab: 'shop' }, hidden: true, innerHTML: '' };
  characterCreator.render({ controls, appState });
  assert.equal(regionReads, 2, 'one coinSummary pass, not one pass per purchasable item');
});

check('every customization option supports a future image override', () => {
  allCatalogs.flat().forEach(item => assert.equal(Object.hasOwn(item, 'imageSrc'), true, item.id));
});
check('character appearance, wardrobe, companions, and scene choices render as dropdowns', () => {
  const controls = { dataset: {}, innerHTML: '' };
  const expectedFields = {
    appearance: ['gender', 'skinTone', 'eyeColor', 'hairPreset', 'specialSkin', 'effect'],
    wardrobe: ['top'],
    pets: ['pet', 'petAnimation', 'petHat', 'petBackpack'],
    backgrounds: ['background'],
    shop: ['top'],
    patron: []
  };
  const visualFields = new Set([
    'gender', 'skinTone', 'eyeColor', 'hairPreset', 'top', 'bottoms', 'shoes', 'headwear',
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
  assert.ok((controls.innerHTML.match(/data-character-thumbnail=/g) || []).length >= 2);
  assert.match(controls.innerHTML, /&quot;gender&quot;:&quot;male&quot;/);
  assert.match(controls.innerHTML, /&quot;gender&quot;:&quot;female&quot;/);
  assert.match(controls.innerHTML, /data-hair-preview="true"/);
  assert.match(controls.innerHTML, /data-hair-style="hair_6"/);
  assert.match(controls.innerHTML, /data-hair-color="brown"/);
  assert.match(controls.innerHTML, /data-eye-color="dark_brown"/);
  assert.match(controls.innerHTML, /background-color:#dba77e/);
  assert.match(controls.innerHTML, /data-character-id="dark_brown"[^>]*>[\s\S]*?Dark Brown/);
  assert.match(controls.innerHTML, /data-character-id="brown"[^>]*>[\s\S]*?Brown/);
  assert.match(controls.innerHTML, /data-character-id="green"[^>]*>[\s\S]*?Green/);
  assert.match(controls.innerHTML, /data-character-id="blue"[^>]*>[\s\S]*?Blue/);
  assert.match(controls.innerHTML, /data-character-id="gray"[^>]*>[\s\S]*?Gray/);
  assert.match(controls.innerHTML, /Chestnut/);
  assert.match(controls.innerHTML, /Black/);
  assert.match(controls.innerHTML, /Blonde/);
  assert.match(controls.innerHTML, /Hairstyle/);
  assert.doesNotMatch(controls.innerHTML, /Hair color/);
  assert.match(controls.innerHTML, /Porcelain/);
  assert.match(controls.innerHTML, /Warm/);
  assert.match(controls.innerHTML, /Hairstyle 6: Chestnut/);
  assert.match(controls.innerHTML, /Hairstyle 28: Teal/);
  assert.match(controls.innerHTML, /data-character-id="hair_shield_maiden::teal"/);
  assert.match(controls.innerHTML, /Sprite A/);
  assert.match(controls.innerHTML, /Sprite B/);
  assert.equal((controls.innerHTML.match(/data-character-field="hairPreset"/g) || []).length, 201);
  assert.match(controls.innerHTML, /aria-label="Previous hairstyle"/);
  assert.match(controls.innerHTML, /aria-label="Next hairstyle"/);
  assert.match(controls.innerHTML, /<details class="mt-2" data-character-browse="hairPreset">\s*<summary[^>]*>Browse all hairstyles/);
  assert.match(controls.innerHTML, /class="sm:col-span-2">[\s\S]*?aria-label="Hairstyle picker"/);
  assert.match(controls.innerHTML, /class="min-w-0 truncate text-center" title="Hairstyle 6: Chestnut"/);
  assert.match(controls.innerHTML, /h-16/);
  assert.match(controls.innerHTML, /h-10 w-10/);
  assert.match(controls.innerHTML, /data-character-browse="hairPreset"/);
  controls.dataset.activeTab = 'shop';
  characterCreator.render({ controls, character: characterCreator.DEFAULT_CHARACTER });
  assert.match(controls.innerHTML, /Wayfarer Coins/);
  assert.match(controls.innerHTML, /\d+ coins/);
});
check('Browse all remains expanded after choosing a hairstyle or wardrobe item', () => {
  for (const { tab, field, browseId, choiceId } of [
    { tab: 'appearance', field: 'hairPreset', browseId: 'hairPreset', choiceId: 'hair_6::brown' },
    { tab: 'wardrobe', field: 'top', browseId: 'top', choiceId: characterCreator.DEFAULT_CHARACTER.top }
  ]) {
    const controls = {
      dataset: { activeTab: tab }, innerHTML: '', openBrowse: null,
      querySelectorAll(selector) {
        return selector === 'details[data-character-browse][open]' && this.openBrowse?.open
          ? [this.openBrowse] : [];
      }
    };
    let character = characterCreator.normalizeCharacter(characterCreator.DEFAULT_CHARACTER);
    const render = () => characterCreator.render({
      controls, character, stats: { level: 1 }, onChange: next => { character = next; render(); }
    });
    render();
    controls.openBrowse = { open: true, dataset: { characterBrowse: browseId } };
    controls.onclick({ target: { closest(selector) {
      if (selector === '[data-character-tab]') return null;
      return selector === 'button[data-character-field][data-character-id]'
        ? { dataset: { characterField: field, characterId: choiceId }, disabled: false } : null;
    } } });
    assert.match(controls.innerHTML, new RegExp(
      `<details class="mt-2" data-character-browse="${browseId}" open>`
    ));
  }
});
check('opening Browse all closes unrelated visual pickers to prevent overlapping menus', () => {
  const makeDetails = (dataset, open = false) => ({
    dataset, open, toggleHandler: null,
    addEventListener(name, handler) { if (name === 'toggle') this.toggleHandler = handler; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { top: 0, bottom: 0 }; }
  });
  const skinPicker = makeDetails({ characterDropdown: 'true' }, true);
  const hairstyleBrowse = makeDetails({ characterBrowse: 'hairPreset' });
  const details = [skinPicker, hairstyleBrowse];
  const controls = {
    dataset: { activeTab: 'appearance' }, innerHTML: '',
    closest() { return null; },
    querySelectorAll(selector) {
      if (selector === 'details') return details;
      if (selector === 'details[data-character-browse][open]') {
        return details.filter(details => details.dataset.characterBrowse && details.open);
      }
      if (selector === 'details[data-character-dropdown][open]') {
        return details.filter(details => details.dataset.characterDropdown && details.open);
      }
      return [];
    }
  };
  characterCreator.render({ controls, character: characterCreator.DEFAULT_CHARACTER, stats: { level: 1 } });
  hairstyleBrowse.open = true;
  hairstyleBrowse.toggleHandler();
  assert.equal(skinPicker.open, false);
  assert.equal(controls.dataset.openCharacterBrowse, 'hairPreset');
  skinPicker.open = true;
  skinPicker.toggleHandler();
  assert.equal(hairstyleBrowse.open, false);
});
check('character summary groups XP with level and does not show a completed-level message', () => {
  const summary = { innerHTML: '' };
  characterCreator.render({
    summary,
    character: characterCreator.DEFAULT_CHARACTER,
    stats: { level: 55, xp: 104835, visitedParks: [{}, {}] },
    appState: { character: characterCreator.DEFAULT_CHARACTER }
  });
  assert.match(summary.innerHTML, /Explorer level/);
  assert.match(summary.innerHTML, /Level 55/);
  assert.match(summary.innerHTML, /104,835 XP/);
  assert.match(summary.innerHTML, /Worldwide parks[\s\S]*>2</);
  assert.equal((summary.innerHTML.match(/Wayfarer Coins/g) || []).length, 1);
  assert.doesNotMatch(summary.innerHTML, /All ten levels reached/);
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
    assert.match(controls.innerHTML,
      /src="\.\/assets\/custom-gear\/brown-ranger-hat\.png"[^>]*style="width:40px;height:32px;top:4px;image-rendering:pixelated"/);
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
check('Miku locks hair and clothing while keeping scene, sprite, skin, pet and effect choices available', () => {
  const miku = characterCreator.SHOP_WARDROBE.find(item => item.id === 'special_miku');
  assert.ok(miku);
  assert.equal(miku.name, 'Miku');
  assert.equal(miku.fixedAppearance, true);
  assert.deepEqual(miku.unlock, { type: 'easterEgg', id: 'miku' });
  assert.equal(miku.paths.male, './assets/custom-gear/Miku-2.png');
  assert.equal(miku.paths.female, miku.paths.male);
  const png = readFileSync(new URL(miku.paths.male, import.meta.url));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [80, 64]);

  const lockedCharacter = characterCreator.normalizeCharacter({ specialSkin: miku.id });
  assert.equal(lockedCharacter.specialSkin, '', 'Miku cannot be equipped before finding the easter egg');
  assert.deepEqual(lockedCharacter.unlockedEasterEggs, []);
  const lockedControls = { dataset: { activeTab: 'appearance' }, innerHTML: '' };
  characterCreator.render({
    controls: lockedControls, character: lockedCharacter, stats: { level: 10 }
  });
  assert.match(lockedControls.innerHTML, /data-character-id="special_miku"[^>]*disabled/);
  assert.match(lockedControls.innerHTML, /Discover a secret in Cartovella/);

  const character = characterCreator.normalizeCharacter({
    ...characterCreator.DEFAULT_CHARACTER,
    specialSkin: miku.id,
    unlockedEasterEggs: ['miku', 'unknown', 'miku'],
    top: 'green_shirt',
    bottoms: 'green_pants',
    skinTone: 'deep',
    effect: 'effect_1',
    purchasedItems: ['green_shirt', 'green_pants', 'effect_1']
  });
  assert.deepEqual(character.unlockedEasterEggs, ['miku']);
  const layers = characterCreator.characterSpriteAssets(character, new Date(2026, 9, 28));
  assert.deepEqual(layers.map(layer => layer.layer), ['effect', 'base']);
  assert.ok(layers[1].imageSrc.endsWith('/Miku-2.png'));
  assert.equal(layers[1].eyeColor, character.eyeColor);
  assert.deepEqual(layers[1].eyeSourceRgb, [10, 77, 78]);

  const controls = { dataset: { activeTab: 'appearance' }, innerHTML: '' };
  let changed;
  const render = () => characterCreator.render({
    controls, character, stats: { level: 10 },
    onChange: next => { changed = next; }
  });
  render();
  assert.match(controls.innerHTML, /data-character-field="specialSkin"/);
  assert.match(controls.innerHTML, /data-character-field="effect"/);
  for (const field of ['gender', 'skinTone', 'eyeColor']) {
    assert.match(controls.innerHTML, new RegExp(`data-character-field="${field}"`));
  }
  for (const field of ['hairPreset', 'top']) {
    assert.doesNotMatch(controls.innerHTML, new RegExp(`data-character-field="${field}"`));
  }
  controls.onclick({ target: { closest(selector) {
    return selector === 'button[data-character-field][data-character-id]'
      ? { dataset: { characterField: 'top', characterId: 'green_shirt' }, disabled: false }
      : null;
  } } });
  assert.equal(changed, undefined, 'fixed-skin gear cannot be changed through the event handler');
  controls.onchange({ target: { dataset: { characterField: 'skinTone' }, value: 'porcelain' } });
  assert.equal(changed?.skinTone, 'porcelain', 'skin selection remains available for when Miku is deselected');
  changed = undefined;
  controls.onclick({ target: { closest(selector) {
    return selector === 'button[data-character-field][data-character-id]'
      ? { dataset: { characterField: 'eyeColor', characterId: 'green' }, disabled: false }
      : null;
  } } });
  assert.equal(changed?.eyeColor, 'green', 'eye color selection remains available for when Miku is deselected');
  changed = undefined;
  controls.onchange({ target: { dataset: { characterField: 'gender' }, value: 'female' } });
  assert.equal(changed?.gender, 'female', 'sprite selection remains available for when Miku is deselected');
  changed = undefined;
  for (const [field, id] of [['effect', ''], ['pet', 'pet_none']]) {
    render();
    controls.onclick({ target: { closest(selector) {
      return selector === 'button[data-character-field][data-character-id]'
        ? { dataset: { characterField: field, characterId: id }, disabled: false }
        : null;
    } } });
    assert.equal(changed?.[field], id, `${field} remains changeable`);
    changed = undefined;
  }

  controls.dataset.activeTab = 'wardrobe';
  render();
  assert.match(controls.innerHTML, /hats and helmets remain available/);
  assert.match(controls.innerHTML, /data-character-field="headwear"/);
  assert.match(controls.innerHTML, /data-character-field="backLayer"/);
  assert.match(controls.innerHTML, /data-character-field="handItem"/);
  controls.dataset.activeTab = 'shop';
  render();
  assert.doesNotMatch(controls.innerHTML, /data-character-field="top"/);
  controls.dataset.activeTab = 'backgrounds';
  render();
  assert.match(controls.innerHTML, /data-character-field="background"/);
  controls.onclick({ target: { closest(selector) {
    return selector === 'button[data-character-field][data-character-id]'
      ? { dataset: { characterField: 'background', characterId: 'bg_green_hills' }, disabled: false }
      : null;
  } } });
  assert.equal(changed?.background, 'bg_green_hills', 'scene selection remains available');
  controls.dataset.activeTab = 'pets';
  render();
  assert.match(controls.innerHTML, /data-character-field="pet"/);
  assert.match(controls.innerHTML, /data-character-field="petHat"/);
});
check('Ranger Miku unlocks with Miku, allows back and hand items, and blocks headwear', () => {
  const miku = characterCreator.SHOP_WARDROBE.find(item => item.id === 'special_miku');
  const rangerMiku = characterCreator.SHOP_WARDROBE.find(item =>
    item.id === 'special_ranger_miku');
  assert.ok(rangerMiku);
  assert.equal(rangerMiku.name, 'Ranger Miku');
  assert.equal(rangerMiku.fixedAppearance, true);
  assert.deepEqual(rangerMiku.unlock, miku.unlock);
  assert.equal(rangerMiku.paths.male, './assets/custom-gear/ranger-miku.png');
  assert.equal(rangerMiku.paths.female, rangerMiku.paths.male);
  assert.equal(rangerMiku.blocksHeadwear, true);
  const rangerPng = readFileSync(new URL(rangerMiku.paths.male, import.meta.url));
  assert.equal(rangerPng.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([rangerPng.readUInt32BE(16), rangerPng.readUInt32BE(20)], [80, 64]);
  assert.equal(characterCreator.normalizeCharacter({
    specialSkin: rangerMiku.id
  }).specialSkin, '', 'Ranger Miku stays locked until the Miku easter egg is found');

  for (const skin of [miku, rangerMiku]) {
    const character = characterCreator.normalizeCharacter({
      ...characterCreator.DEFAULT_CHARACTER,
      gender: 'male',
      specialSkin: skin.id,
      unlockedEasterEggs: ['miku'],
      backLayer: 'cape_blue',
      handItem: 'walking_stick',
      headwear: 'traveler_cap',
      purchasedItems: ['cape_blue', 'cape_red']
    });
    assert.equal(character.specialSkin, skin.id);
    assert.equal(character.backLayer, 'cape_blue');
    assert.equal(character.handItem, 'walking_stick');
    const layers = characterCreator.characterSpriteAssets(character);
    assert.ok(layers.some(layer => layer.layer === 'back'));
    assert.ok(layers.some(layer => layer.layer === 'hand'));
    if (skin.id === rangerMiku.id) {
      assert.equal(layers.some(layer => layer.layer === 'headwear'), false);
      assert.deepEqual(layers.map(layer => layer.layer), ['back', 'base', 'hand']);
    } else {
      assert.ok(layers.some(layer => layer.layer === 'headwear'));
    }

    const controls = {
      dataset: { activeTab: 'wardrobe', activeWardrobeField: 'backLayer' },
      innerHTML: ''
    };
    let changed;
    characterCreator.render({
      controls, character, stats: { level: 10 }, onChange: next => { changed = next; }
    });
    assert.match(controls.innerHTML, /data-character-field="backLayer"/);
    assert.match(controls.innerHTML, /data-character-field="handItem"/);
    if (skin.id === rangerMiku.id) {
      assert.doesNotMatch(controls.innerHTML, /data-character-field="headwear"/);
      assert.match(controls.innerHTML, /Ranger Miku already wears a hat/);
      controls.onchange({
        target: { dataset: { characterField: 'headwear' }, value: 'green_cap' }
      });
      assert.equal(changed, undefined, 'Ranger Miku cannot equip another hat');
    } else {
      assert.match(controls.innerHTML, /data-character-field="headwear"/);
    }
    controls.onchange({
      target: { dataset: { characterField: 'handItem' }, value: 'iron_sword' }
    });
    assert.equal(changed?.handItem, 'iron_sword', `${skin.name} can equip hand items`);
    changed = undefined;
    controls.onchange({
      target: { dataset: { characterField: 'backLayer' }, value: 'cape_red' }
    });
    assert.equal(changed?.backLayer, 'cape_red', `${skin.name} can equip back items`);
  }
});
check('seasonal hats are free and unlock on their announced 2026 dates', () => {
  const hats = Object.fromEntries(['santa_hat', 'pumpkin_hat', 'witch_hat'].map(id => [
    id, characterCreator.EQUIPMENT_CATALOG.find(item => item.id === id)
  ]));
  assert.equal(hats.santa_hat.unlock.type, 'date');
  assert.deepEqual(
    [hats.santa_hat.unlock.year, hats.santa_hat.unlock.month, hats.santa_hat.unlock.day],
    [2026, 12, 1]
  );
  assert.equal(hats.pumpkin_hat.unlock.type, 'date');
  assert.deepEqual(
    [hats.pumpkin_hat.unlock.year, hats.pumpkin_hat.unlock.month, hats.pumpkin_hat.unlock.day],
    [2026, 10, 30]
  );
  assert.equal(hats.witch_hat.unlock.type, 'date');
  assert.deepEqual(
    [hats.witch_hat.unlock.year, hats.witch_hat.unlock.month, hats.witch_hat.unlock.day],
    [2026, 10, 30]
  );
  for (const hat of Object.values(hats)) assert.equal(hat.cost, undefined);
  const character = characterCreator.DEFAULT_CHARACTER;
  const achievements = new Map();
  assert.equal(characterCreator.unlockStatus(hats.pumpkin_hat.unlock, {}, character, achievements, {
    character, currentDate: new Date(2026, 9, 29)
  }).unlocked, false);
  assert.equal(characterCreator.unlockStatus(hats.pumpkin_hat.unlock, {}, character, achievements, {
    character, currentDate: new Date(2026, 9, 30)
  }).unlocked, true);
  assert.equal(characterCreator.unlockStatus(hats.santa_hat.unlock, {}, character, achievements, {
    character, currentDate: new Date(2026, 11, 1)
  }).unlocked, true);
  assert.equal(characterCreator.unlockStatus(hats.santa_hat.unlock, {}, character, achievements, {
    character, currentDate: new Date(2027, 0, 1)
  }).unlocked, true);
});
check('holiday hats automatically overlay male, female and Miku sprites only on the event dates', () => {
  const makeCharacter = values => characterCreator.normalizeCharacter({
    ...characterCreator.DEFAULT_CHARACTER, headwear: 'traveler_cap', ...values
  });
  const headwearPath = (character, date) => decodeURIComponent(
    characterCreator.characterSpriteAssets(character, date).find(layer => layer.layer === 'headwear').imageSrc
  );
  const halloween = new Date(2026, 9, 30);
  const halloweenEnd = new Date(2026, 9, 31);
  const christmas = new Date(2026, 11, 24);
  const christmasEnd = new Date(2026, 11, 25);
  const male = makeCharacter({ gender: 'male' });
  const female = makeCharacter({ gender: 'female' });
  const miku = makeCharacter({
    specialSkin: 'special_miku', unlockedEasterEggs: ['miku'], gender: 'male'
  });
  assert.ok(headwearPath(male, halloween).endsWith('/Male Hat/Pumpkin hat.png'));
  assert.ok(headwearPath(male, halloweenEnd).endsWith('/Male Hat/Pumpkin hat.png'));
  assert.ok(headwearPath(female, halloween).endsWith('/Female Hat/Witch hat.png'));
  assert.ok(headwearPath(miku, halloween).endsWith('/Female Hat/Witch hat.png'));
  assert.ok(headwearPath(male, christmas).endsWith('/Male Hat/Male Santa hat.png'));
  assert.ok(headwearPath(female, christmasEnd).endsWith('/Female Hat/Female Santa hat.png'));
  assert.ok(headwearPath(miku, christmas).endsWith('/Female Hat/Female Santa hat.png'));
  assert.ok(headwearPath(male, new Date(2026, 10, 1)).endsWith('/Male Hat/Male Blue cap.png'));
  assert.equal(characterCreator.holidayHatFor(male, new Date(2026, 9, 29)), null);
});
check('holiday hat removal restores prior headwear and persists for the active event', () => {
  let character = characterCreator.normalizeCharacter({
    ...characterCreator.DEFAULT_CHARACTER,
    specialSkin: 'special_miku',
    unlockedEasterEggs: ['miku'],
    headwear: 'traveler_cap'
  });
  const currentDate = new Date(2026, 9, 30);
  const controls = { dataset: { activeTab: 'wardrobe' }, innerHTML: '' };
  const render = () => characterCreator.render({
    controls, character, stats: { level: 10 }, currentDate,
    onChange: next => { character = next; render(); }
  });
  render();
  assert.match(controls.innerHTML, /Remove holiday hat/);
  const clickHolidayControl = action => controls.onclick({ target: { closest(selector) {
    if (selector === 'button[data-seasonal-hat-action]') {
      return { dataset: { seasonalHatAction: action } };
    }
    return null;
  } } });
  clickHolidayControl('remove');
  assert.ok(character.seasonalHatDismissals.includes('halloween:2026'));
  assert.equal(character.headwear, 'traveler_cap');
  assert.ok(decodeURIComponent(characterCreator.characterSpriteAssets(character, currentDate)
    .find(layer => layer.layer === 'headwear').imageSrc).endsWith('/Female Hat/Female Blue cap.png'));
  assert.match(controls.innerHTML, /Wear holiday hat/);
  clickHolidayControl('restore');
  assert.equal(character.seasonalHatDismissals.includes('halloween:2026'), false);
  assert.ok(characterCreator.holidayHatFor(character, currentDate));
});
check('wardrobe arrows never purchase, cycle owned gear and None, and leave purchases to browse-all', () => {
  const fields = ['top', 'bottoms', 'shoes', 'headwear', 'handItem', 'backLayer',
    'arms', 'face', 'ears', 'effect'];
  for (const gender of ['male', 'female']) {
    for (const tab of ['wardrobe', 'shop']) {
      for (const field of fields) {
        const shopItems = characterCreator.SHOP_WARDROBE.filter(item =>
          item.field === field && item.paths[gender]);
        const purchasedItems = shopItems.filter(item => item.unlock.type === 'coin')
          .slice(0, 1).map(item => item.id);
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
        if (purchasedItems.length) {
          assert.ok(seen.has(purchasedItems[0]), `${gender} ${tab} ${field}: owned gear`);
        }
        assert.ok(seen.has(''), `${field}: None`);
        const unowned = shopItems.find(item =>
          item.unlock.type === 'coin' && !purchasedItems.includes(item.id));
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
  choose('eyeColor', 'gray');
  assert.equal(changedCharacter.eyeColor, 'gray');
});
check('pet animation selection is validated, persisted, and resets to the new pet default', () => {
  const dog = characterCreator.PET_CATALOG.find(item => item.id === 'pet_trail_dog');
  const cat = characterCreator.PET_CATALOG.find(item => item.id === 'pet_black_cat');
  const bunny = characterCreator.PET_CATALOG.find(item => item.id === 'pet_bunny');
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
  assert.equal(characterCreator.normalizeCharacter({
    ...characterCreator.DEFAULT_CHARACTER,
    pet: bunny.id, purchasedItems: [bunny.id], petAnimation: 'bunny-33'
  }).petAnimation, 'bunny-32');

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
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  const pendingImages = [];
  const drawCalls = [];
  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
    getContext() {
      return {
        drawImage() {},
        getImageData: () => ({ data: this.data }),
        putImageData() {}
      };
    }
  }
  globalThis.OffscreenCanvas = FakeOffscreenCanvas;
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
      this.naturalHeight = 448;
      this.onload();
    }
  };
  try {
    const stageScales = [];
    const context = {
      clearRect() { drawCalls.length = 0; },
      save() {},
      scale(x, y) { stageScales.push([x, y]); },
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
    assert.equal(drawCalls.filter(src => src?.includes('Female')).length, 3);
    assert.equal(drawCalls.filter(src => src?.includes('yosemite-bg')).length, 1);
    assert.equal(drawCalls.some(src => src?.includes('/campfire/')), false);
    assert.ok(stageScales.length >= 2);
    assert.ok(stageScales.every(scale => scale[0] === 2 && scale[1] === 2));
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalOffscreenCanvas;
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
check('shirts, bottoms, and shoes can be cleared, and requested bottom pieces use valid sheets', () => {
  const withoutClothes = characterCreator.normalizeCharacter({ top: '', bottoms: '', shoes: '' });
  assert.equal(withoutClothes.top, '');
  assert.equal(withoutClothes.bottoms, '');
  assert.equal(withoutClothes.shoes, '');
  const bareLayers = characterCreator.characterSpriteAssets(withoutClothes);
  for (const layer of ['top', 'bottoms', 'shoes']) {
    assert.equal(bareLayers.some(entry => entry.layer === layer), false, `${layer} is removed`);
  }

  const bikini = characterCreator.normalizeCharacter({
    gender: 'female', top: 'red_bikini', bottoms: '', purchasedItems: ['red_bikini']
  });
  const bikiniLayers = characterCreator.characterSpriteAssets(bikini);
  assert.equal(bikini.top, 'red_bikini');
  assert.equal(bikini.bottoms, '');
  assert.ok(bikiniLayers.find(entry => entry.layer === 'top').imageSrc.endsWith('/Red%20bikini.png'));
  assert.equal(bikiniLayers.some(entry => entry.layer === 'bottoms'), false);

  for (const id of ['black_short_skirt', 'skirt', 'pants']) {
    const item = characterCreator.SHOP_WARDROBE.find(candidate => candidate.id === id);
    assert.ok(item, `${id} is available in the wardrobe`);
    assert.equal(item.field, 'bottoms');
    for (const gender of ['male', 'female']) {
      const path = item.paths[gender];
      assert.ok(path, `${id} has a ${gender} sprite`);
      const png = readFileSync(new URL(path, import.meta.url));
      assert.equal(png.toString('ascii', 1, 4), 'PNG');
      assert.equal(png.readUInt32BE(16) % 80, 0, `${id} frame width`);
      assert.equal(png.readUInt32BE(20) % 64, 0, `${id} frame height`);
      const character = characterCreator.normalizeCharacter({
        gender, bottoms: id, purchasedItems: [id]
      });
      const layer = characterCreator.characterSpriteAssets(character).find(entry => entry.layer === 'bottoms');
      assert.ok(layer, `${id} renders for ${gender}`);
      if (id === 'black_short_skirt') assert.ok(layer.variantSpec);
    }
  }
  const femalePantsTemplate = './assets/custom-gear/female-ranger-pants.png';
  const femalePantsIds = [
    'starter_pants', 'scout_cargo_pants', 'canyon_work_denim', 'highlander_gilded_pants',
    'ranger_trail_pants', 'khaki_trail_pants', 'green_pants', 'blue_pants', 'orange_pants',
    'purple_pants', 'pants'
  ];
  for (const id of femalePantsIds) {
    const item = characterCreator.EQUIPMENT_CATALOG.find(candidate => candidate.id === id);
    assert.ok(item, `${id} is available`);
    assert.equal(item.paths.female, femalePantsTemplate, `${id} uses ranger-breeches artwork`);
    const character = characterCreator.normalizeCharacter({
      ...characterCreator.DEFAULT_CHARACTER, gender: 'female', bottoms: id, purchasedItems: [id]
    });
    const layer = characterCreator.characterSpriteAssets(character)
      .find(entry => entry.layer === 'bottoms');
    assert.equal(layer?.imageSrc, encodeURI(femalePantsTemplate), `${id} renders as pants`);
  }
  const blackPants = characterCreator.SHOP_WARDROBE.find(item => item.id === 'black_pants');
  assert.ok(blackPants);
  assert.deepEqual(blackPants.genders, ['male']);
  assert.equal(blackPants.paths.male,
    './assets/gandalfhardcore/GandalfHardcore Character Asset Pack/GandalfHardcore Character Asset Pack/Male Clothing/Pants.png');
  assert.equal(blackPants.paths.female, undefined);
  assert.equal(blackPants.variantSpec.palette.colorMap['#b92a3b'], '#626976');
  const blackPantsLayer = characterCreator.characterSpriteAssets({
    ...characterCreator.DEFAULT_CHARACTER, bottoms: blackPants.id,
    purchasedItems: [blackPants.id]
  }).find(entry => entry.layer === 'bottoms');
  assert.ok(blackPantsLayer?.variantSpec, 'Black Pants renders as a recolored male option');
  const pantsColors = {
    green_pants: '#527347', blue_pants: '#41638e',
    orange_pants: '#ad6235', purple_pants: '#654d8b'
  };
  for (const [id, baseColor] of Object.entries(pantsColors)) {
    const item = characterCreator.SHOP_WARDROBE.find(candidate => candidate.id === id);
    assert.equal(item.paths.female, femalePantsTemplate, `${id} female pants artwork`);
    assert.equal(item.variantSpecByGender.male, null, `${id} preserves the original male art`);
    assert.equal(item.variantSpec.palette.base, baseColor, `${id} female color palette`);
    assert.equal(item.variantSpec.palette.colorMap['#446b26'],
      item.variantSpec.palette.highlight, `${id} maps the bright breeches fabric`);
    assert.ok(item.variantSpec.palette.preserveColors.includes('#13131c'),
      `${id} preserves the original outline`);
    const femaleLayer = characterCreator.characterSpriteAssets({
      ...characterCreator.DEFAULT_CHARACTER, gender: 'female', bottoms: id,
      purchasedItems: [id]
    }).find(entry => entry.layer === 'bottoms');
    assert.equal(femaleLayer.variantSpec.palette.base, baseColor, `${id} colors the female pants`);
  }
});
check('Explorer Base Layers are free rewards from level one', () => {
  const ids = [
    'male_base_layer', 'male_blue_base_layer', 'male_green_base_layer',
    'male_orange_base_layer', 'male_purple_base_layer', 'male_red_base_layer',
    'female_blue_base_layer', 'female_green_base_layer', 'female_orange_base_layer',
    'female_purple_base_layer', 'female_red_base_layer', 'female_sky_blue_base_layer'
  ];
  for (const id of ids) {
    const item = characterCreator.LEVEL_ITEMS.find(candidate => candidate.id === id);
    assert.ok(item, `${id} is a level reward`);
    assert.deepEqual(item.unlock, { type: 'level', goal: 1 });
    assert.equal(item.cost, undefined, `${id} has no coin cost`);
    assert.equal(characterCreator.SHOP_WARDROBE.some(candidate => candidate.id === id),
      false, `${id} is not purchase-gated`);
    assert.ok(characterCreator.LEVEL_TRACK[0].itemIds.includes(id),
      `${id} is listed at level one`);
    const gender = id.startsWith('female_') ? 'female' : 'male';
    const field = gender === 'female' ? 'top' : 'bottoms';
    const character = characterCreator.normalizeCharacter({ gender, [field]: id });
    assert.equal(character[field], id, `${id} is selectable without a purchase`);
    assert.ok(characterCreator.characterSpriteAssets(character)
      .some(layer => layer.layer === field), `${id} renders for ${gender}`);
  }
});
check('Simple Shoes and Leather Riding Boots have visible color choices', () => {
  const simpleShoes = characterCreator.LEVEL_ITEMS.find(item => item.id === 'simple_shoes');
  const trailBoots = characterCreator.LEVEL_ITEMS.find(item => item.id === 'trail_boots');
  assert.notEqual(simpleShoes.paths.male, trailBoots.paths.male);
  assert.notEqual(simpleShoes.paths.female, trailBoots.paths.female);
  assert.equal(trailBoots.name, 'Leather Riding Boots');
  assert.ok(trailBoots.paths.female.endsWith('/Brown%20Thigh-High%20Boots.png') ||
    trailBoots.paths.female.endsWith('/Brown Thigh-High Boots.png'));
  const sourceMaps = {
    simple_shoes: { '#261e19': 'shadow', '#3b2d26': 'base' },
    trail_boots: {
      '#261e19': 'shadow', '#3b2d26': 'base', '#593e2d': 'highlight'
    }
  };
  for (const id of Object.keys(sourceMaps)) {
    const choices = characterCreator.SHOP_WARDROBE.filter(item =>
      item.field === 'shoes' && item.id.startsWith(`${id}_`));
    assert.equal(choices.length, 5, `${id} has five color choices`);
    assert.equal(new Set(choices.map(item => JSON.stringify(item.variantSpec.palette))).size, 5);
    assert.ok(choices.every(item => item.paths.male && item.paths.female), `${id} supports both sprites`);
    for (const choice of choices) {
      for (const [source, role] of Object.entries(sourceMaps[id])) {
        assert.equal(choice.variantSpec.palette.colorMap[source],
          choice.variantSpec.palette[role], `${choice.name} recolors source ${source}`);
      }
    }
  }
  assert.equal(characterCreator.SHOP_WARDROBE.filter(item =>
    item.id.startsWith('hiking_boots_') || item.id.startsWith('rain_boots_')).length, 0,
  'custom Hiking Boots and Rain Boots do not get color variants');
  assert.ok(characterCreator.SHOP_WARDROBE.some(item => item.id === 'hiking_boots'));
  assert.ok(characterCreator.SHOP_WARDROBE.some(item => item.id === 'rain_boots'));
  assert.equal(characterCreator.characterSpriteAssets(
    characterCreator.normalizeCharacter({ shoes: '' })
  ).some(layer => layer.layer === 'shoes'), false, 'no footwear remains available');
});
check('all original Gandalf clothing sheets are cataloged and correctly sliced', () => {
  const sourceDirectories = [
    './assets/gandalfhardcore/GandalfHardcore Character Asset Pack/GandalfHardcore Character Asset Pack/Male Clothing/',
    './assets/gandalfhardcore/GandalfHardcore Character Asset Pack/GandalfHardcore Character Asset Pack/Female Clothing/',
    './assets/gandalfhardcore/GandalfHardcore 7x Male Clothing/',
    './assets/gandalfhardcore/GandalfHardcore 43x Female Clothing/'
  ];
  const catalogItems = [
    ...characterCreator.LEVEL_ITEMS,
    ...characterCreator.PARK_MILESTONE_ITEMS,
    ...characterCreator.ACHIEVEMENT_ITEMS,
    ...characterCreator.SHOP_WARDROBE
  ];
  const catalogPaths = new Set(catalogItems.flatMap(item => Object.values(item.paths || {})));
  for (const directory of sourceDirectories) {
    for (const filename of readdirSync(new URL(directory, import.meta.url))) {
      if (!filename.toLowerCase().endsWith('.png') || filename === 'DONT FORGET TO RATE.png') continue;
      const path = `${directory}${filename}`;
      assert.ok(catalogPaths.has(path), `${filename} is available in a clothing catalog`);
      const png = readFileSync(new URL(path, import.meta.url));
      assert.equal(png.toString('ascii', 1, 4), 'PNG', filename);
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [800, 448],
        `${filename} uses the 80x64 clothing grid`);
    }
  }
  const queenDress = characterCreator.SHOP_WARDROBE.find(item => item.id === 'queen_dress');
  assert.equal(queenDress.name, 'Queen Dress');
  assert.equal(queenDress.paths.female,
    `${sourceDirectories[3]}Queen Dress.png`);
  const displayedNames = catalogItems.map(item => item.name).join(' ');
  assert.doesNotMatch(displayedNames, /panties and bra/i);
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
check('inclusive body proportion controls default, clamp, persist and scale every layer together', () => {
  assert.deepEqual([
    characterCreator.DEFAULT_CHARACTER.bodyWidth,
    characterCreator.DEFAULT_CHARACTER.bodyHeight
  ], [100, 100]);
  assert.deepEqual([
    characterCreator.normalizeCharacter({ bodyWidth: 1000, bodyHeight: -20 }).bodyWidth,
    characterCreator.normalizeCharacter({ bodyWidth: 1000, bodyHeight: -20 }).bodyHeight
  ], [120, 90]);
  assert.deepEqual([
    characterCreator.normalizeCharacter({ bodyWidth: 'invalid', bodyHeight: null }).bodyWidth,
    characterCreator.normalizeCharacter({ bodyWidth: 'invalid', bodyHeight: null }).bodyHeight
  ], [100, 100]);

  const controls = { dataset: { activeTab: 'appearance' }, innerHTML: '' };
  let character = characterCreator.normalizeCharacter();
  const render = () => characterCreator.render({
    controls, character, stats: { level: 1 },
    onChange: next => { character = next; render(); }
  });
  render();
  assert.match(controls.innerHTML,
    /type="range" min="85" max="120"\s+step="5" value="100"\s+data-character-field="bodyWidth"/);
  assert.match(controls.innerHTML,
    /type="range" min="90" max="110"\s+step="5" value="100"\s+data-character-field="bodyHeight"/);

  controls.onchange({ target: { dataset: { characterField: 'bodyWidth' }, value: '115' } });
  assert.equal(character.bodyWidth, 115);
  controls.onchange({ target: { dataset: { characterField: 'bodyHeight' }, value: '90' } });
  assert.deepEqual([character.bodyWidth, character.bodyHeight], [115, 90]);

  const transforms = [];
  characterCreator.drawCharacterSprite({
    save() {},
    restore() {},
    translate(...values) { transforms.push(['translate', ...values]); },
    scale(...values) { transforms.push(['scale', ...values]); },
    drawImage() {}
  }, character);
  assert.deepEqual(transforms, [
    ['translate', 80, 58],
    ['scale', 1.15, 0.9],
    ['translate', -80, -58]
  ]);
});
check('sprite hairstyle assets are available for their matching character sprites', () => {
  const maleStyles = characterCreator.HAIR_STYLES.filter(style => style.genders.includes('male'));
  const femaleStyles = characterCreator.HAIR_STYLES.filter(style => style.genders.includes('female'));
  assert.equal(maleStyles.length, 34);
  assert.equal(femaleStyles.length, 39);
  assert.equal((maleStyles.length - 1) * characterCreator.HAIR_COLORS.length + 1, 199);
  assert.equal((femaleStyles.length - 1) * characterCreator.HAIR_COLORS.length + 1, 229);
  for (const color of characterCreator.HAIR_COLORS) {
    const palette = characterCreator.HAIR_COLOR_PALETTES[color.id];
    assert.ok(palette, `${color.id} has a recolor palette`);
    assert.equal(palette.base, color.color, `${color.id} palette matches its swatch`);
  }
  for (const gender of ['male', 'female']) {
    const styles = characterCreator.HAIR_STYLES.filter(style =>
      style.genders.includes(gender) && style.id !== 'hair_bald');
    const layers = styles.map(style => characterCreator.characterSpriteAssets({
      ...characterCreator.DEFAULT_CHARACTER, gender, hairStyle: style.id
    }).find(item => item.layer === 'hair'));
    const paths = layers.map(layer => decodeURIComponent(layer.imageSrc));
    assert.equal(new Set(paths).size, paths.length, `${gender} hairstyles use unique sheets`);
    for (const [index, layer] of layers.entries()) {
      const png = readFileSync(new URL(layer.imageSrc, import.meta.url));
      assert.equal(png.toString('ascii', 1, 4), 'PNG', paths[index]);
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [800, 448], paths[index]);
    }
    for (const style of styles) {
      for (const color of characterCreator.HAIR_COLORS) {
        const layer = characterCreator.characterSpriteAssets({
          ...characterCreator.DEFAULT_CHARACTER, gender, hairStyle: style.id, hairColor: color.id
        }).find(item => item.layer === 'hair');
        assert.deepEqual(layer.variantSpec.palette, characterCreator.HAIR_COLOR_PALETTES[color.id],
          `${gender} ${style.id} ${color.id}`);
        assert.equal(layer.variantSpec.colorizeByLuminance, true);
        assert.equal(layer.filter, undefined);
      }
    }
    for (let sheet = 1; sheet <= 5; sheet++) {
      const style = characterCreator.HAIR_STYLES.find(item => item.id === `hair_${sheet}`);
      assert.ok(style.genders.includes(gender));
      const layer = characterCreator.characterSpriteAssets({
        ...characterCreator.DEFAULT_CHARACTER, gender, hairStyle: style.id
      }).find(item => item.layer === 'hair');
      assert.ok(decodeURIComponent(layer.imageSrc).endsWith(
        `/GandalfHardcore Character Asset Pack/${gender === 'male' ? 'Male' : 'Female'} Hair/${gender === 'male' ? 'Male' : 'Female'} Hair${sheet}.png`
      ));
    }
  }
  assert.ok(characterCreator.characterSpriteAssets({
    ...characterCreator.DEFAULT_CHARACTER, hairStyle: 'hair_fancy'
  }).find(item => item.layer === 'hair').imageSrc.endsWith('/Fancy%20Hair.png'));
  assert.ok(characterCreator.characterSpriteAssets({
    ...characterCreator.DEFAULT_CHARACTER, gender: 'female', hairStyle: 'hair_35'
  })[4].imageSrc.endsWith('/Female%20Hair35.png'));
  for (const gender of ['male', 'female']) {
    assert.equal(characterCreator.characterSpriteAssets({
      ...characterCreator.DEFAULT_CHARACTER, gender, hairStyle: 'hair_bald'
    }).some(layer => layer.layer === 'hair'), false);
  }
  const controls = { dataset: { activeTab: 'appearance' }, innerHTML: '' };
  characterCreator.render({ controls, character: characterCreator.DEFAULT_CHARACTER });
  assert.match(controls.innerHTML, /data-character-id="hair_bald::brown"[^>]*>[\s\S]*?Bald/);
});
check('ranger hats keep every hairstyle below the hat crown in stage and avatar rendering', () => {
  const rangerHatIds = characterCreator.ACHIEVEMENT_ITEMS
    .filter(item => item.id.startsWith('ranger_hat_')).map(item => item.id);
  assert.ok(rangerHatIds.length > 0);
  for (const gender of ['male', 'female']) {
    for (const hat of rangerHatIds) {
      const character = characterCreator.normalizeCharacter({
        ...characterCreator.DEFAULT_CHARACTER, gender, headwear: hat
      });
      const assets = characterCreator.characterSpriteAssets(character);
      const hair = assets
        .find(layer => layer.layer === 'hair');
      assert.equal(hair.clipTopSourceY, 25, `${gender} ${hat}`);
    }
    const clips = [];
    const context = {
      save() {}, restore() {}, beginPath() {},
      rect(...args) { clips.push(args); }, clip() {}, drawImage() {}
    };
    const character = characterCreator.normalizeCharacter({
      ...characterCreator.DEFAULT_CHARACTER, gender, headwear: rangerHatIds[0]
    });
    const hair = characterCreator.characterSpriteAssets(character)
      .find(layer => layer.layer === 'hair');
    characterCreator.drawCharacterLayer(context, {}, hair, 0, 0, 80, 64, 40, 18, 80, 64);
    assert.equal(clips.length, 1);
    assert.equal(clips[0][0], 40);
    assert.equal(clips[0][1], 43);
  }
});
check('ranger hats preserve their shared centered canvas position when drawn', () => {
  const rangerHatIds = characterCreator.ACHIEVEMENT_ITEMS
    .filter(item => item.id.startsWith('ranger_hat_')).map(item => item.id);
  for (const hat of rangerHatIds) {
    const hatLayer = characterCreator.characterSpriteAssets({
      ...characterCreator.DEFAULT_CHARACTER, headwear: hat
    }).find(layer => layer.layer === 'headwear');
    const calls = [];
    characterCreator.drawCharacterLayer({
      drawImage(...args) { calls.push(args); }
    }, {}, hatLayer, 0, 0, 80, 64, 40, 18, 80, 64);
    assert.equal(calls.length, 1, hat);
    assert.equal(calls[0][5] + 40, 80, `${hat} should use the character's shared center`);
  }
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
      frameWidth: 32, frameHeight: 32, frameCount: 9,
      row: 16, sourceX: 0, sourceY: 0, sourceWidth: 32, sourceHeight: 32,
      targetX: 96, targetY: 58, targetWidth: 32, targetHeight: 32
    }
  );
  assert.equal(bunny.spriteSheet.animations.find(animation => animation.id === 'bunny-0').name,
    'Turn Around');
  assert.equal(bunny.spriteSheet.animations.find(animation => animation.id === 'bunny-8').name,
    'Run · Side View');
  assert.equal(fox.spriteSheet.frameCount, 5);
  assert.ok(spritePets.every(pet => pet.unlock.type === 'coin'));
  assert.ok(dogs.every(pet => pet.cost === 150));
  assert.ok(cats.every(pet => pet.cost === 150));
  assert.equal(fox.cost, 300);
  assert.ok(wisps.every(pet => pet.cost === 500));
  assert.ok(dogs.every(pet =>
    pet.spriteSheet.targetWidth === 24 && pet.spriteSheet.targetHeight === 16
  ));
  for (const pet of [...dogs, fox]) {
    assert.equal(
      pet.spriteSheet.targetY + pet.spriteSheet.targetHeight,
      82,
      `${pet.name} should meet the stage floor`
    );
  }
  assert.equal(bunny.spriteSheet.targetY + bunny.spriteSheet.targetHeight, 90);
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
  assert.equal(bunny.spriteSheet.animations.length, 34);
  assert.equal(bunny.spriteSheet.frameHeight, 32);
  assert.equal(bunny.spriteSheet.animations.some(animation => animation.id === 'bunny-37'), false);
  assert.equal(bunny.spriteSheet.animations.some(animation => animation.id === 'bunny-39'), false);
  assert.deepEqual(bunny.spriteSheet.animations.find(animation => animation.id === 'bunny-32'), {
    id: 'bunny-32', name: 'Hop · Front View', row: 16,
    frameColumns: [0, 1, 2, 3, 4, 5, 6, 7, 8]
  });
  assert.deepEqual(bunny.spriteSheet.animations.find(animation => animation.id === 'bunny-36'), {
    id: 'bunny-36', name: 'Sequence 19 (rows 36-37)', row: 18,
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
      this.naturalWidth = 800;
      this.naturalHeight = 448;
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
    characterCreator.drawPet(context, bunny, () => {}, 0, 'bunny-18');
    assert.deepEqual(drawCalls[0].slice(1), [65, 13, 29, 19, 101, 66, 24, 16]);
    assert.deepEqual(drawCalls[1].slice(1), [64, 832, 64, 64, 96, 58, 32, 32]);
    assert.deepEqual(drawCalls[2].slice(1), [256, 512, 32, 32, 96, 58, 32, 32]);
    assert.deepEqual(drawCalls[3].slice(1), [65, 14, 29, 18, 103, 72, 15, 10]);
    assert.deepEqual(drawCalls[4].slice(1), [1, 14, 29, 18, 103, 72, 15, 10]);
    assert.deepEqual(drawCalls[5].slice(1), [137, 5, 14, 22, 107, 62, 7, 11]);
    assert.deepEqual(drawCalls[6].slice(1), [40, 4, 16, 24, 107, 62, 7, 11]);
    assert.deepEqual(drawCalls[7].slice(1), [160, 32, 32, 32, 100, 55, 26, 27]);
    assert.deepEqual(drawCalls[8].slice(1), [320, 128, 64, 64, 96, 58, 32, 32]);
    assert.deepEqual(drawCalls[9].slice(1), [128, 128, 32, 32, 96, 58, 32, 32]);
    assert.deepEqual(drawCalls[10].slice(1), [160, 32, 32, 32, 102, 64, 17, 18]);
    assert.deepEqual(drawCalls[11].slice(1), [128, 576, 32, 32, 96, 58, 32, 32]);
    assert.deepEqual(drawCalls[12].slice(1), [256, 608, 32, 32, 96, 58, 32, 32]);
    assert.deepEqual(drawCalls[13].slice(1), [0, 288, 32, 32, 96, 58, 32, 32]);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});
check('character effects use their own animation frames without shifting the explorer', () => {
  const originalImage = globalThis.Image;
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
    getContext() {
      return {
        drawImage() {},
        getImageData: () => ({ data: this.data }),
        putImageData() {}
      };
    }
  }
  globalThis.OffscreenCanvas = FakeOffscreenCanvas;
  globalThis.Image = class {
    constructor() {
      this.complete = true;
      this.naturalWidth = 800;
      this.naturalHeight = 448;
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
    characterCreator.drawCharacterSprite(context, character, () => {}, 2);
    const effectCall = drawCalls.find(call => call[0].src === effectLayer.imageSrc);
    assert.ok(effectCall);
    assert.deepEqual(effectCall.slice(1), [160, 0, 80, 64, 40, 18, 80, 64]);
    assert.ok(drawCalls.every(call =>
      call.slice(3, 5).join(',') === '80,64' &&
      call.slice(5).join(',') === '40,18,80,64'
    ), 'all character layers draw complete 80x64 cells at the shared native-size target');
    assert.ok(drawCalls.every(call => call[6] === 18));
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalOffscreenCanvas;
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
  assert.equal(characterCreator.unlockStatus(
    { type: 'owner' }, {}, character, achievements
  ).unlocked, false);
  assert.equal(characterCreator.unlockStatus(
    { type: 'owner' }, {}, character, achievements,
    { character, isCartovellaOwner: true }
  ).unlocked, true);
});
check('the explorer track contains paired gear and level-one base layers', () => {
  const underwearIds = new Set([
    'male_base_layer', 'male_blue_base_layer', 'male_green_base_layer',
    'male_orange_base_layer', 'male_purple_base_layer', 'male_red_base_layer',
    'female_blue_base_layer', 'female_green_base_layer', 'female_orange_base_layer',
    'female_purple_base_layer', 'female_red_base_layer', 'female_sky_blue_base_layer'
  ]);
  assert.deepEqual(characterCreator.LEVEL_TRACK.map(reward => reward.level),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(characterCreator.LEVEL_ITEMS.every(item =>
    item.unlock.type === 'level' &&
    (underwearIds.has(item.id)
      ? Object.keys(item.paths).length === 1
      : item.paths.male && item.paths.female)));
  assert.deepEqual(characterCreator.LEVEL_TRACK[0].itemIds,
    [
      'starter_shirt', 'starter_pants', 'simple_shoes',
      'male_base_layer', 'male_blue_base_layer', 'male_green_base_layer',
      'male_orange_base_layer', 'male_purple_base_layer', 'male_red_base_layer',
      'female_blue_base_layer', 'female_green_base_layer', 'female_orange_base_layer',
      'female_purple_base_layer', 'female_red_base_layer', 'female_sky_blue_base_layer'
    ]);
  assert.ok(characterCreator.LEVEL_TRACK[9].itemIds.includes('diamond_sword'));
  assert.ok(characterCreator.LEVEL_TRACK[9].itemIds.includes('hair_shield_maiden'));
  for (const reward of characterCreator.LEVEL_TRACK.slice(1)) {
    const generatedClothing = reward.itemIds.filter(id => characterCreator.LEVEL_ITEMS.some(item =>
      item.id === id && item.variantSpec && item.unlock.goal === reward.level));
    if (reward.level === 8) {
      assert.deepEqual(generatedClothing, [], 'Level 8 has no generated clothing reward');
    } else {
      assert.ok(generatedClothing.length, `level ${reward.level} includes a generated clothing reward`);
    }
  }
});
check('variant clothing includes all requested rewards and valid paired sprite-sheet paths', () => {
  const levelIds = [
    'pine_trail_flannel', 'scout_cargo_pants', 'meadow_forager_tunic',
    'wayfarer_field_vest', 'wayfarer_khaki_field_vest', 'canyon_work_denim', 'redwood_flannel_jacket',
    'highlander_gilded_pants', 'sovereign_cartographer_coat'
  ];
  const parkIds = [
    'volunteer_park_tee', 'park_ranger_uniform', 'ranger_trail_pants', 'grand_warden_cloak'
  ];
  const achievementIds = [
    'ranger_hat_classic_brown', 'ranger_hat_forest_green', 'ranger_hat_green',
    'ranger_hat_navy', 'ranger_hat_navy_banded', 'ranger_hat_purple',
    'ranger_hat_silver', 'ranger_hat_golden', 'ranger_hat_diamond', 'john_denver_guitar',
    'khaki_trail_pants', 'mist_rain_poncho', 'cavern_miner_suit', 'cavern_pink_suit',
    'summit_down_parka', 'summit_bright_red_parka', 'summit_navy_blue_parka',
    'summit_hood_up_parka', 'overland_canvas_jacket',
    'mariner_pea_coat', 'arctic_aurora_cloak',
    'blue_ridge_flannel', 'alpine_timberline_jacket', 'continental_cape',
    'centennial_ranger_coat', 'gaia_druid_mantle'
  ];
  assert.deepEqual(characterCreator.LEVEL_ITEMS.filter(item => item.variantSpec)
    .map(item => item.id), levelIds);
  assert.deepEqual(characterCreator.PARK_MILESTONE_ITEMS.map(item => item.id), parkIds);
  assert.deepEqual(characterCreator.ACHIEVEMENT_ITEMS.map(item => item.id), achievementIds);
  const rangerHats = characterCreator.ACHIEVEMENT_ITEMS.filter(item =>
    item.id.startsWith('ranger_hat_'));
  assert.deepEqual(rangerHats.map(item => item.unlock.id), [
    'firstSteps', 'trailblazer', 'trailblazer', 'masterRanger', 'masterRanger',
    'grandVoyager', 'grandVoyager', 'americaTheBeautiful', 'nps'
  ]);
  assert.equal(rangerHats.every(item => !item.variantSpec), true);
  const rangerHatAssetPaths = [
    'brown-ranger-hat.png', 'forest-green-ranger-hat.png', 'green-ranger-hat.png',
    'navy-ranger-hat.png', 'navy-banded-ranger-hat.png', 'purple-ranger-hat.png',
    'silver-ranger-hat.png', 'golden-ranger-hat.png', 'diamond-ranger-hat.png'
  ];
  rangerHats.forEach((item, index) => {
    const path = `./assets/custom-gear/${rangerHatAssetPaths[index]}`;
    assert.equal(item.paths.male, path, item.id);
    assert.equal(item.paths.female, path, item.id);
    const png = readFileSync(new URL(path, import.meta.url));
    assert.equal(png.toString('ascii', 1, 4), 'PNG', item.id);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [80, 64], item.id);
    for (const gender of ['male', 'female']) {
      const layer = characterCreator.characterSpriteAssets({
        ...characterCreator.DEFAULT_CHARACTER, gender, headwear: item.id
      }).find(candidate => candidate.layer === 'headwear');
      assert.equal(layer?.imageSrc, path, `${item.id} ${gender} sprite layer`);
    }
  });
  const allVariantItems = [
    ...characterCreator.LEVEL_ITEMS.filter(item => item.variantSpec),
    ...characterCreator.PARK_MILESTONE_ITEMS.filter(item => item.variantSpec),
    ...characterCreator.ACHIEVEMENT_ITEMS.filter(item => item.variantSpec)
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
      const variantSpec = Object.prototype.hasOwnProperty.call(item.variantSpecByGender || {}, gender)
        ? item.variantSpecByGender[gender] : item.variantSpec;
      const layer = characterCreator.characterSpriteAssets({
        ...characterCreator.DEFAULT_CHARACTER, gender, [item.field]: item.id
      }).find(candidate => candidate.imageSrc === encodeURI(path));
      assert.ok(layer, `${item.id} reaches the ${gender} character sprite layers`);
      assert.equal(layer.variantSpec?.palette, variantSpec?.palette,
        `${item.id} ${gender} variant handling`);
    }
  }
  assert.ok([...checkedPaths].some(path => path.endsWith('Cape green.png')),
    'cape template is included');
});
check('replacement Summit, Mariner, Ranger, and vest artwork is wired with hood restrictions', () => {
  const achievementItem = id => characterCreator.ACHIEVEMENT_ITEMS.find(item => item.id === id);
  const cavernSuit = achievementItem('cavern_miner_suit');
  const cavernPinkSuit = achievementItem('cavern_pink_suit');
  const summitDown = achievementItem('summit_down_parka');
  const summitRed = achievementItem('summit_bright_red_parka');
  const summitNavy = achievementItem('summit_navy_blue_parka');
  const summitHoodUp = achievementItem('summit_hood_up_parka');
  const mariner = achievementItem('mariner_pea_coat');
  const parkRanger = characterCreator.PARK_MILESTONE_ITEMS.find(item => item.id === 'park_ranger_uniform');
  const rangerPants = characterCreator.PARK_MILESTONE_ITEMS.find(item => item.id === 'ranger_trail_pants');
  const centennialCoat = achievementItem('centennial_ranger_coat');
  const greenVest = characterCreator.LEVEL_ITEMS.find(item => item.id === 'wayfarer_field_vest');
  const khakiVest = characterCreator.LEVEL_ITEMS.find(item => item.id === 'wayfarer_khaki_field_vest');
  const witchHat = characterCreator.SHOP_WARDROBE.find(item => item.id === 'witch_hat');
  const vikingHorns = characterCreator.SHOP_WARDROBE.find(item => item.id === 'viking_horns');
  const facePaint = characterCreator.SHOP_WARDROBE.find(item => item.id === 'face_paint');
  const faceMask = characterCreator.SHOP_WARDROBE.find(item => item.id === 'face_mask');
  assert.equal(cavernSuit.paths.male, './assets/custom-gear/male-cave-suit.png');
  assert.equal(cavernSuit.paths.female, './assets/custom-gear/female-cave-suit.png');
  assert.equal(cavernSuit.variantSpecByGender.male, null);
  assert.equal(cavernSuit.variantSpecByGender.female, null);
  assert.equal(cavernPinkSuit.paths.male, cavernSuit.paths.male);
  assert.equal(cavernPinkSuit.paths.female, cavernSuit.paths.female);
  assert.equal(cavernPinkSuit.variantSpec.palette.base, '#a4538d');
  assert.equal(summitRed.name, 'Bright Red Summit Down Parka');
  assert.equal(summitNavy.name, 'Navy Blue Summit Down Parka');
  assert.equal(summitRed.variantSpec.palette.base, '#c92f3a');
  assert.equal(summitNavy.variantSpec.palette.base, '#254a72');
  assert.deepEqual(summitRed.variantSpec.palette.colorMap, {
    '#27130f': '#70151f', '#291410': '#70151f',
    '#2f1712': '#c92f3a', '#3d1e17': '#ff7479'
  });
  assert.ok(summitRed.variantSpec.palette.preserveColors.includes('#a38a6e'));
  assert.ok(summitNavy.variantSpec.palette.preserveColors.includes('#13131c'));
  for (const item of [summitDown, summitRed, summitNavy]) {
    assert.equal(item.paths.male, './assets/custom-gear/male parka down .png');
    assert.equal(item.paths.female, './assets/custom-gear/female-parka-down.png');
  }
  assert.equal(summitDown.variantSpecByGender.female, null);
  for (const gender of ['male', 'female']) {
    const layer = characterCreator.characterSpriteAssets({
      ...characterCreator.DEFAULT_CHARACTER, gender, top: cavernSuit.id
    }).find(candidate => candidate.layer === 'top');
    assert.equal(layer.imageSrc, encodeURI(cavernSuit.paths[gender]));
    assert.equal(layer.variantSpec, undefined);
    const png = readFileSync(new URL(cavernSuit.paths[gender], import.meta.url));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [80, 64]);
  }
  assert.equal(summitDown.paths.male, './assets/custom-gear/male parka down .png');
  assert.equal(summitDown.paths.female, './assets/custom-gear/female-parka-down.png');
  assert.equal(summitHoodUp.paths.male, './assets/custom-gear/Male Parka up no hat.png');
  assert.equal(achievementItem('summit_red_hood_up_parka'), undefined);
  assert.equal(mariner.paths.male, './assets/custom-gear/Male Mariner Coat.png');
  assert.equal(mariner.paths.female, './assets/custom-gear/Female Mariner Coat.png');
  assert.equal(parkRanger.name, 'Park Ranger Shirt');
  assert.equal(parkRanger.paths.male, './assets/custom-gear/male-ranger-shirt.png');
  assert.equal(parkRanger.paths.female, './assets/custom-gear/female-ranger-shirt.png');
  assert.equal(parkRanger.variantSpecByGender.male, null);
  assert.equal(parkRanger.variantSpecByGender.female, null);
  assert.equal(rangerPants.paths.male, './assets/custom-gear/male-ranger-pants.png');
  assert.equal(rangerPants.paths.female, './assets/custom-gear/female-ranger-pants.png');
  assert.equal(centennialCoat.paths.male, './assets/custom-gear/male-ranger-coat.png');
  assert.deepEqual(centennialCoat.unlock, { type: 'owner' });
  assert.equal(greenVest.paths.male, './assets/custom-gear/male-green-vest-better.png');
  assert.equal(greenVest.paths.female, './assets/custom-gear/female-vest.png');
  assert.equal(greenVest.variantSpecByGender.female, null);
  assert.equal(khakiVest.paths.male, './assets/custom-gear/male-khaki-vest.png');
  assert.equal(khakiVest.name, 'Khaki Wayfarer Field Vest');
  assert.equal(witchHat.paths.female,
    './assets/gandalfhardcore/GandalfHardcore 41x Hats/Female Hat/Witch hat.png');
  assert.equal(vikingHorns.paths.female, vikingHorns.paths.male);
  assert.ok(vikingHorns.paths.female.endsWith('/Male Hat/Viking Helmet with horns.png'));
  assert.equal(facePaint.paths.male, facePaint.paths.female);
  assert.ok(facePaint.paths.male.endsWith('/GandalfHardcore Masks/Female Blue Face paint.png'));
  assert.notEqual(facePaint.paths.male, faceMask.paths.male);
  const witchLayer = characterCreator.characterSpriteAssets({
    ...characterCreator.DEFAULT_CHARACTER, gender: 'female', headwear: witchHat.id,
    purchasedItems: [witchHat.id]
  }).find(layer => layer.layer === 'headwear');
  const femaleVikingLayer = characterCreator.characterSpriteAssets({
    ...characterCreator.DEFAULT_CHARACTER, gender: 'female', headwear: vikingHorns.id,
    purchasedItems: [vikingHorns.id]
  }).find(layer => layer.layer === 'headwear');
  const malePaintLayer = characterCreator.characterSpriteAssets({
    ...characterCreator.DEFAULT_CHARACTER, gender: 'male', face: facePaint.id,
    purchasedItems: [facePaint.id]
  }).find(layer => layer.layer === 'face');
  assert.equal(decodeURIComponent(witchLayer.imageSrc), witchHat.paths.female);
  assert.equal(decodeURIComponent(femaleVikingLayer.imageSrc), vikingHorns.paths.female);
  assert.equal(decodeURIComponent(malePaintLayer.imageSrc), facePaint.paths.male);

  const replacementPaths = [
    cavernSuit.paths.male, cavernSuit.paths.female, summitDown.paths.male, summitDown.paths.female,
    summitRed.paths.male, summitRed.paths.female, summitNavy.paths.male, summitNavy.paths.female,
    cavernPinkSuit.paths.male, cavernPinkSuit.paths.female, summitHoodUp.paths.male,
    mariner.paths.male, mariner.paths.female, parkRanger.paths.male, parkRanger.paths.female,
    rangerPants.paths.male, rangerPants.paths.female, centennialCoat.paths.male,
    greenVest.paths.male, khakiVest.paths.male, witchHat.paths.female,
    vikingHorns.paths.male, facePaint.paths.male
  ];
  for (const path of replacementPaths) {
    const png = readFileSync(new URL(path, import.meta.url));
    assert.equal(png.toString('ascii', 1, 4), 'PNG', path);
    assert.equal(png.readUInt32BE(16) % 80, 0, `${path} frame width`);
    assert.equal(png.readUInt32BE(20) % 64, 0, `${path} frame height`);
  }
  for (const item of [summitHoodUp]) {
    assert.equal(item.blocksHeadwear, true, item.id);
    const character = characterCreator.normalizeCharacter({
      ...characterCreator.DEFAULT_CHARACTER, top: item.id, headwear: 'traveler_cap'
    });
    const layers = characterCreator.characterSpriteAssets(character);
    assert.equal(layers.find(layer => layer.layer === 'top').imageSrc, encodeURI(item.paths.male));
    assert.equal(layers.some(layer => layer.layer === 'headwear'), false, item.id);
    assert.ok(characterCreator.characterSpriteAssets({
      ...character, top: 'summit_down_parka'
    }).some(layer => layer.layer === 'headwear'), 'hood-down parka permits headwear');

    const controls = {
      dataset: { activeTab: 'wardrobe', activeWardrobeField: 'headwear' },
      innerHTML: ''
    };
    let changed;
    characterCreator.render({
      controls, character, stats: { level: 10 }, onChange: next => { changed = next; }
    });
    assert.match(controls.innerHTML, /The hood is up; hats and helmets stay hidden/);
    assert.match(controls.innerHTML,
      /data-character-field="headwear"[^>]*aria-label="Next hats &amp; helmets"[^>]*disabled/);
    controls.onclick({ target: { closest(selector) {
      return selector === 'button[data-character-field][data-character-id]'
        ? { dataset: { characterField: 'headwear', characterId: 'traveler_cap' }, disabled: false }
        : null;
    } } });
    assert.equal(changed, undefined, item.id);
    controls.onchange({ target: { dataset: { characterField: 'headwear' }, value: 'hat_summit' } });
    assert.equal(changed, undefined, item.id);
  }
});
check('new custom gear uses replacement art, multiple colors, and correct poncho layering', () => {
  const levelItem = id => characterCreator.LEVEL_ITEMS.find(item => item.id === id);
  const parkItem = id => characterCreator.PARK_MILESTONE_ITEMS.find(item => item.id === id);
  const achievementItem = id => characterCreator.ACHIEVEMENT_ITEMS.find(item => item.id === id);
  const shopItem = id => characterCreator.SHOP_WARDROBE.find(item => item.id === id);
  const coat = levelItem('sovereign_cartographer_coat');
  const monocle = levelItem('cartographer_monocle');
  const pineFlannel = levelItem('pine_trail_flannel');
  const redwoodFlannel = levelItem('redwood_flannel_jacket');
  const greenVest = levelItem('wayfarer_field_vest');
  const volunteerTee = parkItem('volunteer_park_tee');
  const canvasJacket = achievementItem('overland_canvas_jacket');
  const poncho = achievementItem('mist_rain_poncho');
  const glasses = shopItem('glasses');
  const hikingBoots = shopItem('hiking_boots');
  const rainBoots = shopItem('rain_boots');

  assert.deepEqual(monocle.unlock, coat.unlock);
  assert.equal(monocle.unlock.goal, 10);
  assert.equal(monocle.field, 'face');
  assert.equal(monocle.paths.male, './assets/custom-gear/male-carto-monocle.png');
  assert.equal(monocle.paths.female, './assets/custom-gear/female-carto-monocle.png');
  assert.equal(coat.paths.male, './assets/custom-gear/male-carto-coat.png');
  assert.equal(coat.paths.female, './assets/custom-gear/female-carto-coat.png');
  assert.equal(pineFlannel.paths.male, './assets/custom-gear/male-pine-flannel.png');
  assert.equal(pineFlannel.paths.female, './assets/custom-gear/female-pine-flannel.png');
  assert.equal(redwoodFlannel.paths.male, './assets/custom-gear/male-red-flannel.png');
  assert.equal(redwoodFlannel.paths.female, './assets/custom-gear/female-red-flannel.png');
  assert.equal(greenVest.paths.male, './assets/custom-gear/male-green-vest-better.png');
  assert.equal(greenVest.paths.female, './assets/custom-gear/female-vest.png');
  assert.equal(volunteerTee.paths.male, './assets/custom-gear/male-park-t-shirt.png');
  assert.equal(volunteerTee.paths.female, './assets/custom-gear/female-park-t-shirt.png');
  assert.equal(canvasJacket.paths.male, './assets/custom-gear/male-canvas-jacket.png');
  assert.equal(canvasJacket.paths.female, './assets/custom-gear/female-canvas-jckt.png');

  assert.equal(glasses.name, 'Glasses');
  assert.equal(glasses.paths.male, './assets/custom-gear/male-glasses-1.png');
  assert.deepEqual(glasses.genders, ['male']);
  assert.equal(hikingBoots.paths.male, './assets/custom-gear/male-hiking-boots.png');
  assert.equal(hikingBoots.paths.female, './assets/custom-gear/female-hiking-boots.png');
  assert.equal(rainBoots.paths.male, './assets/custom-gear/male-rain-boots.png');
  assert.equal(rainBoots.paths.female, './assets/custom-gear/female-rain-boots.png');
  const hikingBootColors = characterCreator.SHOP_WARDROBE.filter(item =>
    item.id.startsWith('hiking_boots_'));
  assert.equal(hikingBootColors.length, 0);
  const rainBootColors = characterCreator.SHOP_WARDROBE.filter(item =>
    item.id.startsWith('rain_boots_'));
  assert.equal(rainBootColors.length, 0);

  const shirts = characterCreator.SHOP_WARDROBE.filter(item =>
    item.id === 'short_sleeve_tshirt' || item.id.startsWith('short_sleeve_tshirt_'));
  assert.equal(shirts.length, 6);
  assert.ok(shirts.every(item =>
    item.paths.male === './assets/custom-gear/male-t-shirt.png' &&
    item.paths.female === './assets/custom-gear/female-t-shirt.png'));
  assert.equal(new Set(shirts.filter(item => item.variantSpec)
    .map(item => item.variantSpec.palette.base)).size, 5);

  assert.equal(poncho.paths.male, './assets/custom-gear/male-rain-poncho.png');
  assert.equal(poncho.paths.female, './assets/custom-gear/female-raincoat.png');
  assert.equal(poncho.blocksHeadwear, true);
  assert.equal(poncho.coversHair, true);
  assert.ok(characterCreator.LEVEL_TRACK[9].itemIds.includes(monocle.id));
  const replacementPaths = [
    ...[coat, monocle, pineFlannel, redwoodFlannel, greenVest, volunteerTee, canvasJacket]
      .flatMap(item => Object.values(item.paths)),
    ...Object.values(poncho.paths), ...Object.values(glasses.paths),
    ...Object.values(hikingBoots.paths), ...Object.values(rainBoots.paths),
    ...Object.values(shirts[0].paths)
  ];
  for (const path of new Set(replacementPaths)) {
    const png = readFileSync(new URL(path, import.meta.url));
    assert.equal(png.toString('ascii', 1, 4), 'PNG', path);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [80, 64], path);
  }

  for (const gender of ['male', 'female']) {
    const character = characterCreator.normalizeCharacter({
      ...characterCreator.DEFAULT_CHARACTER, gender, top: poncho.id, headwear: 'traveler_cap'
    });
    const layers = characterCreator.characterSpriteAssets(character);
    const hairIndex = layers.findIndex(layer => layer.layer === 'hair');
    const ponchoIndex = layers.findIndex(layer => layer.layer === 'top');
    assert.ok(hairIndex >= 0 && ponchoIndex > hairIndex, `${gender} poncho covers trailing hair`);
    assert.equal(layers.some(layer => layer.layer === 'headwear'), false,
      `${gender} poncho blocks hats`);
  }
  const controls = {
    dataset: { activeTab: 'wardrobe', activeWardrobeField: 'headwear' },
    innerHTML: ''
  };
  characterCreator.render({
    controls,
    character: { ...characterCreator.DEFAULT_CHARACTER, top: poncho.id },
    stats: { level: 10 }
  });
  assert.match(controls.innerHTML, /The rain poncho covers your head/);
});
check('Alpha Hat uses paired custom art and is available to both sprites', () => {
  const alphaHat = characterCreator.SHOP_WARDROBE.find(item => item.id === 'alpha_hat');
  assert.equal(alphaHat.name, 'Alpha Hat');
  assert.equal(alphaHat.field, 'headwear');
  assert.equal(alphaHat.unlock.type, 'coin');
  assert.equal(alphaHat.cost, 100);
  assert.deepEqual(alphaHat.genders, ['male', 'female']);
  assert.equal(alphaHat.paths.male, './assets/custom-gear/male-alpha-hat.png');
  assert.equal(alphaHat.paths.female, './assets/custom-gear/female-alpha-hat.png');
  for (const gender of alphaHat.genders) {
    const layer = characterCreator.characterSpriteAssets({
      ...characterCreator.DEFAULT_CHARACTER, gender, headwear: alphaHat.id,
      purchasedItems: [alphaHat.id]
    }).find(item => item.layer === 'headwear');
    assert.equal(layer.imageSrc, alphaHat.paths[gender], `${gender} hat art`);
    const png = readFileSync(new URL(alphaHat.paths[gender], import.meta.url));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [80, 64], `${gender} hat size`);
  }
});
check('park and achievement clothing unlock at their exact requirements', () => {
  const character = characterCreator.normalizeCharacter();
  characterCreator.PARK_MILESTONE_ITEMS.forEach(item => {
    const goal = item.unlock.goal;
    assert.equal(item.unlock.type, 'worldParks', item.id);
    assert.equal(characterCreator.unlockStatus(item.unlock, {
      visitedParks: Array(goal - 1).fill('park')
    }, character, new Map()).unlocked, false, item.id);
    assert.equal(characterCreator.unlockStatus(item.unlock, {
      visitedParks: Array(goal).fill('park')
    }, character, new Map()).unlocked, true, item.id);
  });
  const titles = new Map([
    ['firstSteps', 'First Steps'], ['waterfalls_1', 'Chasing Waterfalls'],
    ['subterranean', 'Subterranean'], ['thinAir', 'Thin Air'],
    ['overlander', 'Overlander'], ['mariner', 'Mariner'],
    ['focal', 'Focal Point'], ['longDark', 'The Long Dark'],
    ['countryRoads', 'Country Roads'], ['rockyMountainHigh', 'Rocky Mountain High'],
    ['fiftyNifty', 'Fifty Nifty'], ['americaTheBeautiful', 'America the Beautiful'],
    ['gaiaWanderer', 'Gaia Wanderer'], ['trailblazer', 'Trailblazer'],
    ['masterRanger', 'Master Ranger'], ['grandVoyager', 'Grand Voyager'], ['nps', 'NPS']
  ]);
  const definitions = [...titles].map(([id, title]) => ({
    id, title, progress: stats => stats.achievementsDone ? 1 : 0, tiers: [{ goal: 1 }]
  }));
  const incomplete = characterCreator.achievementProgress({}, definitions);
  const complete = characterCreator.achievementProgress({ achievementsDone: true }, definitions);
  const recorded = characterCreator.achievementProgress({
    completedAchievementTiers: [...titles.keys()].map(id => ({ key: `${id}:0` }))
  }, definitions);
  for (const item of characterCreator.ACHIEVEMENT_ITEMS.filter(item =>
    item.unlock.type === 'achievement')) {
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
  const guitar = characterCreator.ACHIEVEMENT_ITEMS.find(item => item.id === 'john_denver_guitar');
  assert.equal(guitar.name, "John Denver's Guitar");
  assert.equal(guitar.field, 'handItem');
  assert.deepEqual(guitar.unlock, {
    type: 'achievement', ids: ['countryRoads', 'rockyMountainHigh']
  });
  const guitarLockedStatus = characterCreator.unlockStatus(guitar.unlock, {}, character, incomplete);
  assert.equal(guitarLockedStatus.unlocked, false);
  assert.equal(guitarLockedStatus.description,
    'Unlock Achievement: Country Roads (0/1) or Rocky Mountain High (0/1).');
  for (const achievementId of guitar.unlock.ids) {
    const singleAchievement = new Map([[achievementId, { progress: 1, goal: 1, name: achievementId }]]);
    assert.equal(characterCreator.unlockStatus(guitar.unlock, {}, character, singleAchievement).unlocked,
      true, `${achievementId} alone unlocks the guitar`);
  }
  const guitarPath = './assets/custom-gear/guitar-1.png';
  assert.equal(guitar.paths.male, guitarPath);
  assert.equal(guitar.paths.female, guitarPath);
  const guitarPng = readFileSync(new URL(guitarPath, import.meta.url));
  assert.equal(guitarPng.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([guitarPng.readUInt32BE(16), guitarPng.readUInt32BE(20)], [80, 64]);
  for (const gender of ['male', 'female']) {
    const handLayer = characterCreator.characterSpriteAssets({
      ...character, gender, handItem: guitar.id
    }).at(-1);
    assert.equal(handLayer.layer, 'hand');
    assert.equal(handLayer.imageSrc, guitarPath);
  }
  const controls = { dataset: { activeTab: 'wardrobe' }, innerHTML: '' };
  characterCreator.render({
    controls, character, stats: { level: 1, visitedParks: [] }, achievements: definitions
  });
  assert.match(controls.innerHTML, /Unlock Achievement: Thin Air \(0\/1\)/);
  controls.dataset.activeWardrobeField = 'top';
  characterCreator.render({
    controls, character, stats: { level: 1, visitedParks: [] }, achievements: definitions
  });
  assert.match(controls.innerHTML, /Visit 5 Global Parks \(0\/5\)/);
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
  setPixel(8, 2, [75, 75, 75, 255]);
  setPixel(9, 2, [120, 35, 0, 255]);
  setPixel(10, 2, [150, 80, 40, 255]);
  setPixel(11, 2, [40, 140, 60, 255]);
  setPixel(12, 2, [39, 19, 15, 255]);
  setPixel(13, 2, [163, 138, 110, 255]);
  setPixel(14, 2, [19, 19, 28, 255]);
  setPixel(15, 2, [38, 30, 25, 255]);
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
    const colorizedHair = characterCreator.processSpriteVariant(source, {
      palette: {
        outline: '#101112', shadow: '#202122', base: '#404142', highlight: '#808182'
      },
      colorizeByLuminance: true
    });
    assert.deepEqual(pixelAt(colorizedHair, 1, 0), [0x10, 0x11, 0x12, 255]);
    assert.deepEqual(pixelAt(colorizedHair, 8, 2), [0x20, 0x21, 0x22, 255]);
    assert.deepEqual(pixelAt(colorizedHair, 9, 2), [0x20, 0x21, 0x22, 255]);
    assert.deepEqual(pixelAt(colorizedHair, 10, 2), [0x40, 0x41, 0x42, 255]);
    assert.deepEqual(pixelAt(colorizedHair, 11, 2), [0x40, 0x41, 0x42, 255]);
    assert.deepEqual(pixelAt(colorizedHair, 3, 3), [0x80, 0x81, 0x82, 255]);
    const exactMapped = characterCreator.processSpriteVariant(source, {
      palette: {
        shadow: '#70151f', base: '#c92f3a', highlight: '#ff7479',
        colorMap: { '#27130f': '#70151f', '#261e19': '#102030' },
        preserveColors: ['#a38a6e', '#13131c']
      },
      pattern: 'jacket'
    });
    assert.deepEqual(pixelAt(exactMapped, 12, 2), [0x70, 0x15, 0x1f, 255]);
    assert.deepEqual(pixelAt(exactMapped, 15, 2), [0x10, 0x20, 0x30, 255]);
    assert.deepEqual(pixelAt(exactMapped, 13, 2), [0xa3, 0x8a, 0x6e, 255]);
    assert.deepEqual(pixelAt(exactMapped, 14, 2), [0x13, 0x13, 0x1c, 255]);
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
check('the shared stage animation loop advances pets and effects without moving the character', () => {
  const originalImage = globalThis.Image;
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const intervalCallbacks = [];
  const clearedIntervals = [];
  let reducedMotion = true;
  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
    getContext() {
      return {
        drawImage() {},
        getImageData: () => ({ data: this.data }),
        putImageData() {}
      };
    }
  }
  globalThis.OffscreenCanvas = FakeOffscreenCanvas;
  globalThis.Image = class {
    constructor() {
      this.complete = true;
      this.naturalWidth = 800;
      this.naturalHeight = 448;
      this.src = '';
    }
  };
  globalThis.window = {
    devicePixelRatio: 2,
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
      translate() {},
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
    const avatarPath = characterCreator.characterSpriteAssets(character)
      .find(layer => layer.layer === 'base').imageSrc;
    const avatarCall = () => drawCalls.findLast(call => call[0].src === avatarPath);
    const petAccessoryCalls = () => drawCalls.filter(call =>
      /doggy%20(?:hat|backpack)\.png$/.test(call[0].src));
    const currentPetAccessoryCalls = () => petAccessoryCalls().slice(-2);
    assert.deepEqual(dogCall().slice(1, 5), [1, 13, 29, 19]);
    assert.deepEqual(effectCall().slice(1, 5), [0, 0, 80, 64]);
    assert.equal(avatarCall()[6], 18);
    const hiddenDrawCount = drawCalls.length;
    intervalCallbacks[0]();
    assert.equal(drawCalls.length, hiddenDrawCount);
    globalThis.document.visibilityState = 'visible';
    intervalCallbacks[0]();
    assert.ok(drawCalls.length > hiddenDrawCount,
      'stage animations continue when the browser requests reduced motion');
    reducedMotion = false;
    intervalCallbacks[0]();
    intervalCallbacks[0]();
    assert.deepEqual(dogCall().slice(1, 5), [33, 13, 29, 19]);
    assert.deepEqual(effectCall().slice(1, 5), [80, 0, 80, 64]);
    assert.equal(effectCall()[6], 18);
    assert.equal(avatarCall()[6], 18);
    assert.equal(currentPetAccessoryCalls().length, 2);
    assert.ok(currentPetAccessoryCalls().every(call => call[1] === 32));
    canvas.isConnected = false;
    intervalCallbacks[0]();
    assert.deepEqual(clearedIntervals, [1]);
    const thumbnailCanvas = { ...canvas, isConnected: true };
    characterCreator.drawStage(thumbnailCanvas, character, { animate: false });
    assert.equal(intervalCallbacks.length, 1, 'static scene thumbnails do not start an animation timer');
    const avatarDrawCalls = [];
    const avatarCanvas = {
      width: 80, height: 64, isConnected: true,
      getContext: () => ({
        clearRect() {},
        save() {},
        translate() {},
        scale() {},
        restore() {},
        drawImage(...args) { avatarDrawCalls.push(args); }
      })
    };
    characterCreator.renderAvatar(avatarCanvas, character);
    assert.ok(avatarDrawCalls.length > 0);
    assert.ok(avatarDrawCalls.every(call =>
      call.length === 9 && call.slice(1).join(',') === '0,0,80,64,0,0,80,64'
    ), 'avatar thumbnails draw complete 80x64 sprite cells at native proportions');
    const portraitTransforms = [];
    const portraitDrawCalls = [];
    const portraitContext = {
      clearRect() {},
      save() {},
      translate(...values) { portraitTransforms.push(['translate', ...values]); },
      scale(...values) { portraitTransforms.push(['scale', ...values]); },
      restore() {},
      drawImage(...args) { portraitDrawCalls.push(args); }
    };
    const portraitCanvas = {
      width: 24, height: 24, isConnected: true,
      getContext: () => portraitContext
    };
    characterCreator.renderAvatar(portraitCanvas, character, { portrait: true });
    assert.deepEqual(portraitTransforms.slice(0, 2), [
      ['translate', -48, -25.5],
      ['scale', 0.75, 0.75]
    ], 'header portrait frames the character head and shoulders in a 24x24 canvas');
    assert.ok(portraitDrawCalls.some(call => call.slice(5).join(',') === '40,18,80,64'));
    const avatarTransforms = [];
    const guildAvatarContext = {
      clearRect() {},
      save() {},
      translate(...values) { avatarTransforms.push(['translate', ...values]); },
      scale(...values) { avatarTransforms.push(['scale', ...values]); },
      restore() {},
      fillRect() {},
      drawImage() {}
    };
    const guildAvatarCanvas = {
      width: 96, height: 96, dataset: { guildAvatarSize: '96' },
      getContext: () => guildAvatarContext
    };
    characterCreator.drawGuildAvatar(guildAvatarCanvas, character);
    assert.deepEqual([guildAvatarCanvas.width, guildAvatarCanvas.height], [192, 192]);
    assert.deepEqual(avatarTransforms.slice(0, 3), [
      ['translate', -163, -98],
      ['scale', 2.7, 2.7],
      ['scale', 1.2, 1.2]
    ], 'Guild avatars center and zoom the character using the high-DPI canvas scale');
    assert.equal(guildAvatarContext.imageSmoothingEnabled, false);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalOffscreenCanvas;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
check('eye colors recolor only the two source eye pixels for each sprite', () => {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.pixels = new Uint8ClampedArray(width * height * 4);
    }
    getContext() {
      return {
        drawImage: image => this.pixels.set(image.pixels),
        getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }),
        putImageData: imageData => this.pixels.set(imageData.data)
      };
    }
  }
  globalThis.OffscreenCanvas = FakeOffscreenCanvas;
  try {
    const sourceEye = [39, 19, 15, 255];
    const blueEye = [0x47, 0x7b, 0xa7, 255];
    for (const [gender, eyePixels] of [
      ['male', [[37, 27], [40, 27]]],
      ['female', [[37, 28], [40, 28]]]
    ]) {
      const baseLayer = characterCreator.characterSpriteAssets({
        ...characterCreator.DEFAULT_CHARACTER, gender, eyeColor: 'blue'
      }).find(layer => layer.layer === 'base');
      assert.equal(baseLayer.eyeColor, 'blue');
      assert.equal(baseLayer.eyeGender, gender);
      const pixels = new Uint8ClampedArray(80 * 64 * 4);
      const setPixel = (x, y, color) =>
        pixels.set(color, (y * 80 + x) * 4);
      const getPixel = (image, x, y) =>
        [...image.pixels.slice((y * 80 + x) * 4, (y * 80 + x) * 4 + 4)];
      eyePixels.forEach(([x, y]) => setPixel(x, y, sourceEye));
      setPixel(1, 1, sourceEye);
      const image = {
        src: `eye-color-${gender}.png`, naturalWidth: 80, naturalHeight: 64, pixels
      };
      const recolored = characterCreator.processSpriteEyeColor(image, 'blue', gender);
      eyePixels.forEach(([x, y]) => assert.deepEqual(getPixel(recolored, x, y), blueEye));
      assert.deepEqual(getPixel(recolored, 1, 1), sourceEye);
      assert.deepEqual(getPixel(image, eyePixels[0][0], eyePixels[0][1]), sourceEye);
    }

    const mikuPixels = new Uint8ClampedArray(80 * 64 * 4);
    for (const [x, y] of [[37, 28], [40, 28]]) {
      mikuPixels.set([10, 77, 78, 255], (y * 80 + x) * 4);
    }
    const mikuImage = {
      src: 'miku-eye-color.png', naturalWidth: 80, naturalHeight: 64, pixels: mikuPixels
    };
    const recoloredMiku = characterCreator.processSpriteEyeColor(
      mikuImage, 'blue', 'female', [10, 77, 78]
    );
    for (const [x, y] of [[37, 28], [40, 28]]) {
      assert.deepEqual(
        [...recoloredMiku.pixels.slice((y * 80 + x) * 4, (y * 80 + x) * 4 + 4)],
        blueEye
      );
    }
  } finally {
    if (originalOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalOffscreenCanvas;
  }
});
check('sprite character selects matching gender, skin, hair, and outfit layers', () => {
  const originalImage = globalThis.Image;
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  const drawCalls = [];
  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
    getContext() {
      return {
        drawImage() {},
        getImageData: () => ({ data: this.data }),
        putImageData() {}
      };
    }
  }
  globalThis.OffscreenCanvas = FakeOffscreenCanvas;
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
      'Female Skin5.png', 'female-ranger-pants.png', 'Boots.png',
      'Blue Corset v2.png', 'Female Hair10.png'
    ]);
    const hairLayer = assets.find(layer => layer.layer === 'hair');
    assert.equal(hairLayer.variantSpec.colorizeByLuminance, true);
    assert.equal(hairLayer.variantSpec.palette.base, '#53b8aa');
    for (const asset of assets) {
      const png = readFileSync(new URL(asset.imageSrc, import.meta.url));
      assert.equal(png.toString('ascii', 1, 4), 'PNG');
      assert.ok([[80, 64], [800, 448]].some(dimensions =>
        dimensions[0] === png.readUInt32BE(16) && dimensions[1] === png.readUInt32BE(20)));
    }
    characterCreator.drawCharacterSprite({
      save() {},
      restore() {},
      drawImage(...args) { drawCalls.push(args); }
    }, character);
    assert.equal(drawCalls.length, 5);
    assert.equal(drawCalls[4][0].src, undefined, 'hair is rendered from its recolored canvas');
    assert.ok(drawCalls.every(call =>
      call.length === 9 && call.slice(1).join(',') === '0,0,80,64,40,18,80,64'
    ));
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalOffscreenCanvas;
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
    assert.deepEqual(leapBody.slice(1, 5), [160, 32, 32, 32]);
    assert.deepEqual(leapBody.slice(5, 9), [100, 55, 26, 27]);
    assert.equal(leapAccessories.length, 2);
    assert.ok(leapAccessories.every(call => call[1] === 160 && call[2] === 32));
    const fox = characterCreator.PET_CATALOG.find(pet => pet.id === 'pet_trail_fox');
    calls.length = 0;
    characterCreator.drawStage(canvas, {
      ...characterCreator.DEFAULT_CHARACTER, background: 'bg_green_hills',
      pet: fox.id, petAnimation: 'leap', purchasedItems: [fox.id]
    }, {}, 10);
    const leapFox = calls.find(call => call[0].src === fox.imageSrc);
    assert.deepEqual(leapFox.slice(1, 5), [160, 32, 32, 32]);
    assert.deepEqual(leapFox.slice(5, 9), [102, 64, 17, 18]);
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
