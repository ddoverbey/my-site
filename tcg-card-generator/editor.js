const SPRITESHEET_URL = './assets/Modular_Fantasy_Cards_Spritesheet.png';
const DATABASE_NAME = 'card-foundry-workshop';
const DATABASE_VERSION = 1;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const EXPORT_SIZE = 2560;
const CARD_BOUNDS = { x: 359.1, y: 71.3, width: 1841.9, height: 2417.3 };
const NAME_FONT = '"SCR-N Seven Extra", "Courier New", monospace';
const BODY_FONT = '"partita 1990", "Courier New", monospace';
const borderPositions = { copper: 456, steel: 532, gold: 608 };

const rarityStyles = {
  Common: { color: '#f3efe3', label: '#11130e', background: { x: 308, y: 210 }, sparkle: { x: 384, y: 210 }, bannerY: 177 },
  Uncommon: { color: '#55d27d', label: '#16713b', background: { x: 308, y: 4 }, sparkle: { x: 384, y: 4 }, bannerY: 45 },
  Rare: { color: '#55d9e8', label: '#087c91', background: { x: 156, y: 210 }, sparkle: { x: 232, y: 210 }, bannerY: 155 },
  Epic: { color: '#c486ed', label: '#763393', background: { x: 4, y: 107 }, sparkle: { x: 80, y: 107 }, bannerY: 89 },
  Legendary: { color: '#f3c859', label: '#a97a0c', background: { x: 156, y: 107 }, sparkle: { x: 232, y: 107 }, bannerY: 111 },
  Mythic: { color: '#db8eef', label: '#89429a', background: { x: 308, y: 210 }, sparkle: { x: 80, y: 210 }, bannerY: 133 }
};

const sampleBody = 'Global Sprawl: Covers 13.38% of\nclassified biome land\nDiscovery Bonus: +15 XP on first\ncollection';
const sampleCard = {
  id: 'mythic-forest-sample',
  createdAt: 0,
  name: 'Tropical & Subtropical Moist Broadleaf Forests',
  points: '1',
  rarity: 'Mythic',
  moisture: 'wet',
  climate: 'hot',
  finish: 'sparkle',
  border: 'steel',
  body: sampleBody,
  bodyColors: [
    { start: sampleBody.indexOf('13.38%'), end: sampleBody.indexOf('13.38%') + '13.38%'.length, color: '#ffffff' },
    { start: sampleBody.indexOf('+15 XP'), end: sampleBody.indexOf('+15 XP') + '+15 XP'.length, color: '#00a766' }
  ],
  photo: null,
  photoName: ''
};

const form = document.getElementById('card-form');
const cardList = document.getElementById('card-list');
const cardCount = document.getElementById('card-count');
const canvas = document.getElementById('card-preview');
const context = canvas.getContext('2d');
const artInput = document.getElementById('card-art');
const artFilename = document.getElementById('art-filename');
const statusMessage = document.getElementById('status-message');
const storageLabel = document.getElementById('storage-label');
const storageDot = document.querySelector('.storage-dot');
const bodyInput = document.getElementById('card-body');
const bodyColorInput = document.getElementById('body-color');

let database = null;
let cards = [];
let currentCardId = null;
let currentPhoto = null;
let photoRequest = 0;
const saveTimers = new Map();
let savedSelection = null;
let spriteSheet = null;
let climateIcons = {};

function makeId() {
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneSampleCard() {
  return { ...sampleCard, bodyColors: sampleCard.bodyColors.map((range) => ({ ...range })) };
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('error', isError);
}

function setStorageWarning(message) {
  storageLabel.textContent = message;
  storageDot.classList.add('warning');
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image asset: ${url}`));
    image.src = url;
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('cards', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open card storage.'));
    request.onblocked = () => reject(new Error('Card storage is blocked by another open tab.'));
  });
}

function getStoredCards(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction('cards', 'readonly').objectStore('cards').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not read saved cards.'));
  });
}

function storeCard(db, card) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('cards', 'readwrite');
    transaction.objectStore('cards').put(card);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not save this card.'));
    transaction.onabort = () => reject(transaction.error || new Error('Saving this card was cancelled.'));
  });
}

function removeStoredCard(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('cards', 'readwrite');
    transaction.objectStore('cards').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not delete this card.'));
    transaction.onabort = () => reject(transaction.error || new Error('Deleting this card was cancelled.'));
  });
}

function activeCard() {
  return cards.find((card) => card.id === currentCardId) || null;
}

function normalizeCard(card) {
  const rarity = rarityStyles[card.rarity] ? card.rarity : 'Common';
  return {
    ...card,
    name: card.name ?? 'Untitled card',
    points: String(card.points ?? '1'),
    rarity,
    moisture: card.moisture === 'dry' ? 'dry' : 'wet',
    climate: ['cool', 'temperate', 'hot'].includes(card.climate) ? card.climate : 'temperate',
    finish: card.finish === 'sparkle' || (!card.finish && rarity === 'Mythic') ? 'sparkle' : 'classic',
    border: borderPositions[card.border] ? card.border : 'steel',
    body: card.body ?? '',
    bodyColors: Array.isArray(card.bodyColors) ? card.bodyColors : [],
    photo: card.photo ?? null,
    photoName: card.photoName ?? ''
  };
}

function rarityColor(rarity) {
  return rarityStyles[rarity]?.color || rarityStyles.Common.color;
}

function makeLibraryButton(card) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'library-card';
  button.setAttribute('aria-current', String(card.id === currentCardId));
  button.setAttribute('aria-label', `${card.name || 'Untitled card'}, ${card.rarity}`);
  button.style.setProperty('--rarity-color', rarityColor(card.rarity));

  const dot = document.createElement('span');
  dot.className = 'rarity-dot';
  dot.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  copy.className = 'library-card-copy';
  const name = document.createElement('span');
  name.className = 'library-card-name';
  name.textContent = card.name || 'Untitled card';
  const rarity = document.createElement('span');
  rarity.className = 'library-card-rarity';
  rarity.textContent = card.rarity;
  copy.append(name, rarity);
  button.append(dot, copy);
  button.addEventListener('click', () => selectCard(card.id));
  return button;
}

function renderLibrary() {
  cardList.replaceChildren(...cards.map(makeLibraryButton));
  cardCount.textContent = String(cards.length);
  document.getElementById('delete-card').disabled = cards.length < 2;
}

function setFormValues(card) {
  form.elements.name.value = card.name;
  form.elements.points.value = card.points;
  form.elements.rarity.value = card.rarity;
  form.elements.moisture.value = card.moisture;
  form.elements.climate.value = card.climate;
  form.elements.finish.value = card.finish;
  form.elements.border.value = card.border;
  bodyInput.value = card.body;
  artFilename.textContent = card.photoName || 'Choose a photo for this card';
  document.getElementById('clear-art').disabled = !card.photo;
  document.getElementById('clear-body-colors').disabled = card.bodyColors.length === 0;
  savedSelection = null;
}

function paintCardListAndPreview() {
  renderLibrary();
  const card = activeCard();
  if (!card || !spriteSheet) return;
  setFormValues(card);
  drawCard(context, card, currentPhoto, canvas.width);
  canvas.setAttribute('aria-label', `Preview of ${card.name || 'Untitled card'}, ${card.rarity}`);
}

function updateCardView() {
  renderLibrary();
  const card = activeCard();
  if (!card || !spriteSheet) return;
  drawCard(context, card, currentPhoto, canvas.width);
  canvas.setAttribute('aria-label', `Preview of ${card.name || 'Untitled card'}, ${card.rarity}`);
}

async function loadPhoto(card) {
  const request = ++photoRequest;
  if (currentPhoto) currentPhoto.close();
  currentPhoto = null;
  if (!card.photo) {
    paintCardListAndPreview();
    return;
  }
  try {
    const bitmap = await createImageBitmap(card.photo);
    if (request !== photoRequest || card.id !== currentCardId) {
      bitmap.close();
      return;
    }
    currentPhoto = bitmap;
    paintCardListAndPreview();
  } catch (error) {
    console.error('Could not decode card artwork.', error);
    if (request === photoRequest) showStatus('The saved artwork could not be opened. Remove it or choose another image.', true);
    paintCardListAndPreview();
  }
}

function selectCard(id) {
  if (currentPhoto) currentPhoto.close();
  currentPhoto = null;
  currentCardId = id;
  const card = activeCard();
  if (!card) return;
  paintCardListAndPreview();
  showStatus('');
  loadPhoto(card);
}

function queueSave(card) {
  if (!database) return;
  window.clearTimeout(saveTimers.get(card.id));
  storageLabel.textContent = 'Saving on this device…';
  const timer = window.setTimeout(async () => {
    saveTimers.delete(card.id);
    try {
      await storeCard(database, card);
      if (activeCard()?.id === card.id) {
        storageLabel.textContent = 'Saved on this device';
        showStatus('Saved on this device.');
      }
    } catch (error) {
      console.error('Could not save card.', error);
      setStorageWarning('Local save failed');
      if (activeCard()?.id === card.id) showStatus('Could not save this card. Check available browser storage.', true);
    }
  }, 250);
  saveTimers.set(card.id, timer);
}

function createNewCard(overrides = {}) {
  if (currentPhoto) currentPhoto.close();
  const card = {
    id: makeId(),
    createdAt: Date.now(),
    name: 'New card',
    points: '1',
    rarity: 'Common',
    moisture: 'wet',
    climate: 'temperate',
    finish: 'classic',
    border: 'steel',
    body: '',
    bodyColors: [],
    photo: null,
    photoName: '',
    ...overrides
  };
  cards.push(card);
  currentCardId = card.id;
  currentPhoto = null;
  paintCardListAndPreview();
  showStatus('New card created.');
  queueSave(card);
  return card;
}

function saveFormToCard() {
  const card = activeCard();
  if (!card) return;
  card.name = form.elements.name.value;
  card.points = form.elements.points.value || '0';
  card.rarity = form.elements.rarity.value;
  card.moisture = form.elements.moisture.value;
  card.climate = form.elements.climate.value;
  card.finish = form.elements.finish.value;
  card.border = form.elements.border.value;
  card.body = bodyInput.value;
  updateCardView();
  queueSave(card);
}

function mergeColorRanges(ranges) {
  const sorted = ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && previous.end === range.start && previous.color === range.color) {
      previous.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function adjustColorRangesForEdit(oldText, newText, ranges) {
  let prefix = 0;
  while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) prefix += 1;
  let oldSuffix = oldText.length;
  let newSuffix = newText.length;
  while (oldSuffix > prefix && newSuffix > prefix && oldText[oldSuffix - 1] === newText[newSuffix - 1]) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }
  const delta = newText.length - oldText.length;
  const adjusted = [];
  for (const range of ranges) {
    if (range.end <= prefix) {
      adjusted.push(range);
      continue;
    }
    if (range.start >= oldSuffix) {
      adjusted.push({ ...range, start: range.start + delta, end: range.end + delta });
      continue;
    }
    if (range.start < prefix) adjusted.push({ ...range, end: prefix });
    if (range.end > oldSuffix) adjusted.push({ ...range, start: newSuffix, end: range.end + delta });
  }
  return mergeColorRanges(adjusted);
}

function applyColorToSelection() {
  const card = activeCard();
  const selection = savedSelection || { start: bodyInput.selectionStart, end: bodyInput.selectionEnd };
  if (!card || selection.end <= selection.start) {
    showStatus('Select some body text before applying a color.', true);
    return;
  }
  const next = [];
  for (const range of card.bodyColors) {
    if (range.end <= selection.start || range.start >= selection.end) {
      next.push(range);
      continue;
    }
    if (range.start < selection.start) next.push({ ...range, end: selection.start });
    if (range.end > selection.end) next.push({ ...range, start: selection.end });
  }
  next.push({ start: selection.start, end: selection.end, color: bodyColorInput.value });
  card.bodyColors = mergeColorRanges(next);
  drawCard(context, card, currentPhoto, canvas.width);
  document.getElementById('clear-body-colors').disabled = false;
  bodyInput.focus();
  bodyInput.setSelectionRange(selection.start, selection.end);
  queueSave(card);
  showStatus('Color applied to the selected text.');
}

function drawSprite(ctx, x, y, width, height, sx, sy, sw, sh, composite = 'source-over') {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = composite;
  ctx.drawImage(spriteSheet, sx, sy, sw, sh, x, y, width, height);
  ctx.restore();
}

function drawPlaceholder(ctx) {
  const gradient = ctx.createLinearGradient(6, 8, 70, 54);
  gradient.addColorStop(0, '#9cc2b0');
  gradient.addColorStop(.52, '#719081');
  gradient.addColorStop(1, '#31483d');
  ctx.fillStyle = gradient;
  ctx.fillRect(6, 6, 64, 49);
  ctx.fillStyle = 'rgba(230,211,148,.85)';
  ctx.beginPath();
  ctx.arc(51, 18, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#415644';
  ctx.beginPath();
  ctx.moveTo(6, 43);
  ctx.lineTo(22, 27);
  ctx.lineTo(33, 39);
  ctx.lineTo(47, 24);
  ctx.lineTo(70, 43);
  ctx.lineTo(70, 55);
  ctx.lineTo(6, 55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#29392f';
  ctx.beginPath();
  ctx.moveTo(6, 48);
  ctx.lineTo(25, 37);
  ctx.lineTo(42, 48);
  ctx.lineTo(56, 38);
  ctx.lineTo(70, 47);
  ctx.lineTo(70, 55);
  ctx.lineTo(6, 55);
  ctx.closePath();
  ctx.fill();
  ctx.font = `2px ${NAME_FONT}`;
  ctx.fillStyle = '#f2ead8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('YOUR ART HERE', 38, 50.5);
}

function drawArtwork(ctx, photo) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(22, 6);
  ctx.quadraticCurveTo(6, 6, 6, 23);
  ctx.lineTo(6, 54);
  ctx.lineTo(70, 54);
  ctx.lineTo(70, 23);
  ctx.quadraticCurveTo(70, 6, 54, 6);
  ctx.closePath();
  ctx.clip();
  if (!photo) {
    drawPlaceholder(ctx);
  } else {
    const scale = Math.max(64 / photo.width, 48 / photo.height);
    const width = photo.width * scale;
    const height = photo.height * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo, 6 + (64 - width) / 2, 6 + (48 - height) / 2, width, height);
  }
  ctx.restore();
}

function colorAt(ranges, index) {
  const range = ranges.find((item) => item.start <= index && index < item.end);
  return range ? range.color : '#181911';
}

function drawColoredBody(ctx, text, ranges, x, startY, maxWidth, lineHeight, maxLines) {
  const font = `2.65px ${BODY_FONT}`;
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let line = 0;
  let cursorX = x;
  let clipped = false;
  const tokens = [...text.matchAll(/\n|[^\S\n]+|[^\s]+/g)];

  for (const match of tokens) {
    const token = match[0];
    const start = match.index;
    if (token === '\n') {
      line += 1;
      cursorX = x;
      if (line >= maxLines) { clipped = true; break; }
      continue;
    }
    if (/^\s+$/.test(token)) {
      const gap = ctx.measureText(token).width;
      if (cursorX + gap > x + maxWidth) {
        line += 1;
        cursorX = x;
        if (line >= maxLines) { clipped = true; break; }
      } else {
        cursorX += gap;
      }
      continue;
    }

    const chunks = [];
    let chunkStart = 0;
    let chunkColor = colorAt(ranges, start);
    for (let offset = 1; offset <= token.length; offset += 1) {
      const nextColor = offset < token.length ? colorAt(ranges, start + offset) : null;
      if (nextColor !== chunkColor) {
        chunks.push({ text: token.slice(chunkStart, offset), color: chunkColor });
        chunkStart = offset;
        chunkColor = nextColor;
      }
    }
    const wordWidth = chunks.reduce((width, chunk) => width + ctx.measureText(chunk.text).width, 0);
    if (cursorX > x && cursorX + wordWidth > x + maxWidth) {
      line += 1;
      cursorX = x;
      if (line >= maxLines) { clipped = true; break; }
    }

    for (const chunk of chunks) {
      ctx.fillStyle = chunk.color;
      ctx.fillText(chunk.text, cursorX, startY + line * lineHeight);
      cursorX += ctx.measureText(chunk.text).width;
    }
    if (cursorX > x + maxWidth) {
      line += 1;
      cursorX = x;
      if (line >= maxLines) { clipped = true; break; }
    }
  }

  if (clipped && maxLines > 0) {
    ctx.fillStyle = '#181911';
    ctx.fillText('…', x + maxWidth - ctx.measureText('…').width, startY + (maxLines - 1) * lineHeight);
  }
}

function drawCard(ctx, card, photo, outputWidth) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const previewScale = outputWidth / EXPORT_SIZE;
  ctx.setTransform(previewScale, 0, 0, previewScale, 0, 0);
  ctx.save();
  ctx.translate(CARD_BOUNDS.x, CARD_BOUNDS.y);
  ctx.scale(CARD_BOUNDS.width / 76, CARD_BOUNDS.height / 103);

  const style = rarityStyles[card.rarity] || rarityStyles.Common;
  const background = card.finish === 'sparkle' ? style.sparkle : style.background;
  if (card.rarity === 'Mythic') {
    const rainbow = ctx.createLinearGradient(4, 4, 72, 99);
    rainbow.addColorStop(0, '#ff5757');
    rainbow.addColorStop(.17, '#ffb34e');
    rainbow.addColorStop(.34, '#f4e96e');
    rainbow.addColorStop(.51, '#63d779');
    rainbow.addColorStop(.68, '#59d6e8');
    rainbow.addColorStop(.84, '#6988f2');
    rainbow.addColorStop(1, '#d477ed');
    ctx.fillStyle = rainbow;
    ctx.fillRect(4, 4, 68, 95);
    drawSprite(ctx, 4, 4, 68, 95, background.x, background.y, 68, 95, 'multiply');
  } else {
    drawSprite(ctx, 4, 4, 68, 95, background.x, background.y, 68, 95);
  }

  drawArtwork(ctx, photo);

  drawSprite(ctx, 7, 60, 62, 36, 463, 164, 62, 36);
  drawSprite(ctx, 6, 52, 64, 10, 536, 231, 64, 10);

  ctx.save();
  const title = card.name || 'Untitled card';
  const titleWords = title.split(/\s+/);
  const titleLines = [];
  let titleLine = '';
  ctx.font = `4.2px ${NAME_FONT}`;
  for (const word of titleWords) {
    const candidate = titleLine ? `${titleLine} ${word}` : word;
    if (ctx.measureText(candidate).width > 59 && titleLine) {
      titleLines.push(titleLine);
      titleLine = word;
    } else {
      titleLine = candidate;
    }
  }
  if (titleLine) titleLines.push(titleLine);
  if (titleLines.length > 2) {
    titleLines.splice(1, titleLines.length - 1, titleLines.slice(1).join(' '));
    while (titleLines[1].length > 0 && ctx.measureText(`${titleLines[1]}…`).width > 59) {
      titleLines[1] = titleLines[1].slice(0, -1);
    }
    titleLines[1] = `${titleLines[1].trimEnd()}…`;
  }
  let titleSize = 4.2;
  while (titleLines.some((line) => ctx.measureText(line).width > 59) && titleSize > 2.2) {
    titleSize -= .1;
    ctx.font = `${titleSize}px ${NAME_FONT}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#171610';
  if (titleLines.length === 1) {
    ctx.fillText(titleLines[0], 38, 57);
  } else {
    ctx.fillText(titleLines[0], 38, 54.8);
    ctx.fillText(titleLines[1], 38, 59.2);
  }
  ctx.restore();

  ctx.save();
  ctx.font = `2.65px ${BODY_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = style.label;
  ctx.fillText(`Rarity: ${card.rarity}`, 10, 62.5);
  drawColoredBody(ctx, card.body, card.bodyColors || [], 10, 67, 55, 5.2, 5);
  ctx.restore();

  const banner = style.bannerY;
  drawSprite(ctx, 2, 0, 12, 20, 685, banner, 15, 20);
  ctx.save();
  ctx.font = `5px ${NAME_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = .4;
  ctx.strokeStyle = '#17140d';
  ctx.fillStyle = '#fffdf5';
  ctx.strokeText(String(card.points || '0'), 8, 7.5);
  ctx.fillText(String(card.points || '0'), 8, 7.5);
  ctx.restore();

  const moistureIcon = climateIcons[card.moisture === 'dry' ? 'dry' : 'wet'];
  const climateIcon = climateIcons[card.climate] || climateIcons.temperate;
  if (moistureIcon) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(moistureIcon, 61, 3, 12, 12);
    ctx.restore();
  }
  if (climateIcon) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(climateIcon, -1, 80, 13, 13);
    ctx.restore();
  }

  drawSprite(ctx, 0, 0, 76, 103, borderPositions[card.border] || borderPositions.steel, 0, 76, 103);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

async function persistCardImmediately(card) {
  if (!database) return;
  try {
    await storeCard(database, card);
    storageLabel.textContent = 'Saved on this device';
  } catch (error) {
    console.error('Could not save card.', error);
    setStorageWarning('Local save failed');
    showStatus('Could not save this card. Check available browser storage.', true);
  }
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom-card';
}

function canvasToBlob(target) {
  return new Promise((resolve, reject) => {
    target.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not create a PNG image.'));
    }, 'image/png');
  });
}

async function downloadCard() {
  const card = activeCard();
  if (!card) return;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = EXPORT_SIZE;
  exportCanvas.height = EXPORT_SIZE;
  const exportContext = exportCanvas.getContext('2d');
  if (!exportContext) {
    showStatus('PNG export is unavailable in this browser.', true);
    return;
  }
  drawCard(exportContext, card, currentPhoto, EXPORT_SIZE);
  try {
    const blob = await canvasToBlob(exportCanvas);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${slugify(card.name)}.png`;
    link.href = url;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus('Your 2560 × 2560 card PNG is ready.');
  } catch (error) {
    console.error('Could not export card.', error);
    showStatus('The card could not be exported. Please try again.', true);
  }
}

function rememberBodySelection() {
  savedSelection = { start: bodyInput.selectionStart, end: bodyInput.selectionEnd };
}

async function initialize() {
  try {
    [spriteSheet, climateIcons.wet, climateIcons.dry, climateIcons.cool, climateIcons.temperate, climateIcons.hot] = await Promise.all([
      loadImage(SPRITESHEET_URL),
      loadImage('./assets/tcg-icons/wet-icon01.png'),
      loadImage('./assets/tcg-icons/dry-icon-1.png'),
      loadImage('./assets/tcg-icons/cool-icon-1.png'),
      loadImage('./assets/tcg-icons/temperate-icon.png'),
      loadImage('./assets/tcg-icons/heat-icon-1.png')
    ]);
  } catch (error) {
    console.error('Could not load the card art assets.', error);
    setStorageWarning('Card assets unavailable');
    showStatus('Some card art assets could not be loaded. Check the assets folder and reload.', true);
    return;
  }

  try {
    database = await openDatabase();
    cards = (await getStoredCards(database)).map(normalizeCard);
    if (cards.length === 0) {
      const firstCard = cloneSampleCard();
      cards = [firstCard];
      await storeCard(database, firstCard);
    }
    cards.sort((a, b) => a.createdAt - b.createdAt);
    storageLabel.textContent = 'Saved on this device';
  } catch (error) {
    console.error('Browser card storage is unavailable.', error);
    database = null;
    cards = [cloneSampleCard()];
    setStorageWarning('Session only — storage unavailable');
    showStatus('Local card storage is unavailable. You can still edit and export, but changes will not persist after reload.', true);
  }

  currentCardId = cards[0].id;
  paintCardListAndPreview();
  await loadPhoto(cards[0]);
}

document.getElementById('new-card').addEventListener('click', () => createNewCard());
document.getElementById('duplicate-card').addEventListener('click', () => {
  const card = activeCard();
  if (!card) return;
  const copy = {
    ...card,
    id: makeId(),
    createdAt: Date.now(),
    name: `${card.name || 'Untitled card'} copy`,
    bodyColors: card.bodyColors.map((range) => ({ ...range }))
  };
  cards.push(copy);
  currentCardId = copy.id;
  paintCardListAndPreview();
  if (currentPhoto) drawCard(context, copy, currentPhoto, canvas.width);
  queueSave(copy);
  showStatus('Card duplicated.');
});

document.getElementById('delete-card').addEventListener('click', async () => {
  const card = activeCard();
  if (!card || cards.length < 2) return;
  if (!window.confirm(`Delete “${card.name || 'Untitled card'}” from this browser?`)) return;
  window.clearTimeout(saveTimers.get(card.id));
  saveTimers.delete(card.id);
  cards = cards.filter((item) => item.id !== card.id);
  currentCardId = cards[0].id;
  if (currentPhoto) currentPhoto.close();
  currentPhoto = null;
  paintCardListAndPreview();
  await loadPhoto(cards[0]);
  if (database) {
    try {
      await removeStoredCard(database, card.id);
      showStatus('Card deleted.');
    } catch (error) {
      console.error('Could not delete card.', error);
      showStatus('Card was removed from the list, but could not be deleted from browser storage.', true);
    }
  }
});

form.addEventListener('input', (event) => {
  const card = activeCard();
  if (!card) return;
  if (event.target === bodyInput) {
    const oldBody = card.body;
    card.bodyColors = adjustColorRangesForEdit(oldBody, bodyInput.value, card.bodyColors);
  }
  saveFormToCard();
  if (event.target === bodyInput) rememberBodySelection();
});

bodyInput.addEventListener('select', rememberBodySelection);
bodyInput.addEventListener('keyup', rememberBodySelection);
bodyInput.addEventListener('mouseup', rememberBodySelection);
bodyColorInput.addEventListener('pointerdown', rememberBodySelection);
document.getElementById('apply-body-color').addEventListener('pointerdown', rememberBodySelection);
document.getElementById('apply-body-color').addEventListener('click', applyColorToSelection);
document.getElementById('clear-body-colors').addEventListener('click', () => {
  const card = activeCard();
  if (!card) return;
  card.bodyColors = [];
  document.getElementById('clear-body-colors').disabled = true;
  drawCard(context, card, currentPhoto, canvas.width);
  queueSave(card);
  showStatus('Body text colors cleared.');
});

artInput.addEventListener('change', async () => {
  const file = artInput.files && artInput.files[0];
  const card = activeCard();
  artInput.value = '';
  if (!file || !card) return;
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
    showStatus('Choose a PNG, JPG, GIF, or WebP image.', true);
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showStatus('That image is over 10 MB. Choose a smaller file.', true);
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    card.photo = file;
    card.photoName = file.name;
    if (activeCard()?.id === card.id) {
      if (currentPhoto) currentPhoto.close();
      currentPhoto = bitmap;
      paintCardListAndPreview();
      showStatus('Photo added to this card.');
    } else {
      bitmap.close();
    }
    queueSave(card);
  } catch (error) {
    console.error('Could not open selected card artwork.', error);
    showStatus('This image could not be opened. Try another file.', true);
  }
});

document.getElementById('clear-art').addEventListener('click', () => {
  const card = activeCard();
  if (!card) return;
  card.photo = null;
  card.photoName = '';
  if (currentPhoto) currentPhoto.close();
  currentPhoto = null;
  paintCardListAndPreview();
  queueSave(card);
  showStatus('Photo removed from this card.');
});

document.getElementById('download-card').addEventListener('click', downloadCard);
window.addEventListener('resize', () => {
  const card = activeCard();
  if (card && spriteSheet) drawCard(context, card, currentPhoto, canvas.width);
});
window.addEventListener('pagehide', () => {
  for (const [id, timer] of saveTimers) {
    window.clearTimeout(timer);
    const card = cards.find((item) => item.id === id);
    if (card && database) {
      storeCard(database, card).catch((error) => console.error('Could not save card before closing.', error));
    }
  }
  if (database) database.close();
  if (currentPhoto) currentPhoto.close();
});

initialize();
