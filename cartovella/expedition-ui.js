let expeditionDraft = [];
let expeditionPending = false;
let expeditionEditingId = null;
let expeditionPreparedLegs = null;
let expeditionPreparedKey = null;
let expeditionUploadedRoute = null;
let expeditionPreviewMap = null;
let expeditionPreviewLayers = null;
let expeditionSearchVersion = 0;
let expeditionSearchTimer = null;
let homeSearchVersion = 0;
let homeSearchTimer = null;
let expeditionReturnFocus = null;
const expeditionRoadCache = new Map();
let lastRoadRequest = 0;
const EXPEDITION_DRAFT_DB = 'cartovella-local-recovery';
const LEGACY_EXPEDITION_DRAFT_DB = 'wanderlog-local-recovery';
let expeditionDraftDbPromise = null;
let savedExpeditionDraft = null;
let expeditionDraftSaveTimer = null;

function rarityBadgeMarkup(tier) {
  const rarity = CoordinateLookups.RARITY_TIERS[tier];
  if (!rarity) return '';
  return `<span class="inline-flex items-center gap-1 rounded-full border bg-slate-950/70 px-2 py-0.5 text-[10px] font-semibold" data-rarity-tier="${escapeHtml(tier)}" style="color:${rarity.color};border-color:${rarity.color}" title="Location rarity: ${escapeHtml(tier)}">${escapeHtml(rarity.icon)} ${escapeHtml(tier)}</span>`;
}

function expeditionDraftDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser does not support IndexedDB.'));
  if (!expeditionDraftDbPromise) {
    expeditionDraftDbPromise = openExpeditionDraftDatabase(EXPEDITION_DRAFT_DB);
  }
  return expeditionDraftDbPromise;
}

function openExpeditionDraftDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local draft storage.'));
    request.onblocked = () => reject(new Error('Local draft storage is blocked by another open Cartovella tab.'));
  });
}

function readDraftFromDatabase(database) {
  return new Promise((resolve, reject) => {
    const request = database.transaction('drafts', 'readonly').objectStore('drafts').get('current');
    request.onsuccess = () => resolve(request.result?.draft || null);
    request.onerror = () => reject(request.error || new Error('Could not read the saved expedition draft.'));
  });
}

function deleteDraftFromDatabase(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').delete('current');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not clear the saved expedition draft.'));
    transaction.onabort = () => reject(transaction.error || new Error('Clearing the expedition draft was aborted.'));
  });
}

async function readExpeditionDraftRecovery() {
  const database = await expeditionDraftDatabase();
  const draft = await readDraftFromDatabase(database);
  if (draft) return draft;

  if (typeof indexedDB.databases === 'function') {
    const existingDatabases = await indexedDB.databases();
    if (!existingDatabases.some(database => database.name === LEGACY_EXPEDITION_DRAFT_DB)) return null;
  }

  const legacyDatabase = await openExpeditionDraftDatabase(LEGACY_EXPEDITION_DRAFT_DB);
  try {
    const legacyDraft = await readDraftFromDatabase(legacyDatabase);
    if (!legacyDraft) return null;
    await writeExpeditionDraftRecovery(legacyDraft);
    await deleteDraftFromDatabase(legacyDatabase);
    return legacyDraft;
  } finally {
    if (typeof legacyDatabase.close === 'function') legacyDatabase.close();
  }
}

async function writeExpeditionDraftRecovery(draft) {
  const database = await expeditionDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put({ id: 'current', draft });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not save the expedition draft.'));
    transaction.onabort = () => reject(transaction.error || new Error('Saving the expedition draft was aborted.'));
  });
}

async function deleteExpeditionDraftRecovery() {
  const database = await expeditionDraftDatabase();
  return deleteDraftFromDatabase(database);
}

function setExpeditionRecoveryAvailable(draft) {
  savedExpeditionDraft = draft;
  const visible = !!draft && !AppState.viewOnly;
  document.getElementById('expeditionRecoveryPanel').classList.toggle('hidden', !visible);
  document.getElementById('unfinishedDraftNotice').classList.toggle('hidden', !visible);
  document.getElementById('btnDownloadExpeditionRecovery').disabled =
    !visible || draft.stops.length < 2 || !Array.isArray(draft.preparedLegs) ||
    draft.preparedLegs.length !== draft.stops.length - 1;
}

function expeditionRecoverySnapshot() {
  return {
    name: document.getElementById('expeditionName').value,
    reason: document.getElementById('expeditionReason').value,
    startDate: document.getElementById('expeditionStart').value || null,
    endDate: document.getElementById('expeditionEnd').value || null,
    dayTrip: document.getElementById('expeditionDayTrip').checked,
    stops: expeditionDraft.map(stop => ({ ...stop, coords: [...stop.coords] })),
    preparedLegs: expeditionPreparedLegs?.map(leg => ({
      ...leg, routeCoords: leg.routeCoords.map(point => [...point]), countyIds: [...leg.countyIds]
    })) || null,
    uploadedRoute: expeditionUploadedRoute?.map(point => [...point]) || null
  };
}

async function persistExpeditionDraftRecovery() {
  if (AppState.viewOnly || expeditionEditingId || !expeditionDraft.length || expeditionPending) return;
  const draft = expeditionRecoverySnapshot();
  try {
    await writeExpeditionDraftRecovery(draft);
    setExpeditionRecoveryAvailable(draft);
    document.getElementById('expeditionRecoveryStatus').textContent =
      'This unfinished trip is being saved separately from your passport on this device.';
  } catch (error) {
    console.error('Expedition draft autosave failed', error);
    document.getElementById('expeditionRecoveryPanel').classList.remove('hidden');
    document.getElementById('unfinishedDraftNotice').classList.add('hidden');
    document.getElementById('expeditionRecoveryStatus').textContent =
      `Automatic draft recovery is unavailable: ${error.message}. Download a trip recovery file after previewing the routes.`;
    document.getElementById('btnDownloadExpeditionRecovery').disabled =
      draft.stops.length < 2 || !Array.isArray(draft.preparedLegs) ||
      draft.preparedLegs.length !== draft.stops.length - 1;
  }
}

function scheduleExpeditionDraftRecovery() {
  clearTimeout(expeditionDraftSaveTimer);
  if (AppState.viewOnly || expeditionEditingId || !expeditionDraft.length || expeditionPending) return;
  expeditionDraftSaveTimer = setTimeout(() => { persistExpeditionDraftRecovery(); }, 500);
}

async function discardExpeditionDraftRecovery() {
  clearTimeout(expeditionDraftSaveTimer);
  if (!savedExpeditionDraft && !expeditionDraft.length) return;
  try {
    await deleteExpeditionDraftRecovery();
    setExpeditionRecoveryAvailable(null);
  } catch (error) {
    console.error('Expedition draft cleanup failed', error);
    document.getElementById('expeditionRecoveryStatus').textContent =
      `The trip was closed, but its recovery copy could not be removed: ${error.message}`;
  }
}

function restoreSavedExpeditionDraft() {
  const draft = savedExpeditionDraft;
  if (!draft) return;
  expeditionEditingId = null;
  expeditionUploadedRoute = draft.uploadedRoute?.map(point => [...point]) || null;
  expeditionDraft = draft.stops.map(stop => ({ ...stop, coords: [...stop.coords] }));
  document.getElementById('expeditionName').value = draft.name || '';
  document.getElementById('expeditionReason').value = draft.reason || '';
  document.getElementById('expeditionStart').value = draft.startDate || '';
  document.getElementById('expeditionEnd').value = draft.endDate || '';
  document.getElementById('expeditionDayTrip').checked = !!draft.dayTrip;
  syncExpeditionDayTrip();
  if (Array.isArray(draft.preparedLegs) && draft.preparedLegs.length === draft.stops.length - 1) {
    expeditionPreparedLegs = draft.preparedLegs.map(leg => ({
      ...leg, routeCoords: leg.routeCoords.map(point => [...point]), countyIds: [...leg.countyIds]
    }));
    expeditionPreparedKey = expeditionRouteKey();
    displayExpeditionPreview(expeditionPreparedLegs);
  } else {
    expeditionPreparedLegs = null;
    expeditionPreparedKey = null;
  }
  document.getElementById('expeditionTitle').textContent = 'Resume Expedition';
  document.getElementById('btnSaveExpedition').textContent = 'Save expedition';
  document.getElementById('expeditionStatus').textContent = 'Recovered unfinished trip. Review the stops and routes before saving.';
  document.getElementById('btnSaveExpedition').disabled = expeditionDraft.length > 1 &&
    (!expeditionPreparedLegs || expeditionPreparedLegs.length !== expeditionDraft.length - 1);
  document.getElementById('btnPreviewExpedition').disabled = !expeditionDraft.length;
  updateUploadedRouteStatus();
  renderExpeditionStops();
  document.getElementById('expeditionModal').classList.remove('hidden');
  document.getElementById('expeditionName').focus();
}

function uploadedRoutePoint(tuple) {
  if (!Array.isArray(tuple) || tuple.length < 2 ||
      typeof tuple[0] !== 'number' || !Number.isFinite(tuple[0]) ||
      typeof tuple[1] !== 'number' || !Number.isFinite(tuple[1])) {
    throw new Error('Route coordinates must contain numeric longitude and latitude values.');
  }
  const point = [tuple[1], tuple[0]];
  CoordinateLookups.validateCoordinates(...point);
  return point;
}

function uploadedRouteDistanceKm(a, b) {
  const radians = Math.PI / 180;
  const lat1 = a[0] * radians, lat2 = b[0] * radians;
  const deltaLat = (b[0] - a[0]) * radians;
  const deltaLng = (b[1] - a[1]) * radians;
  const haversine = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function downsampleUploadedRoute(points) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('The uploaded route must contain at least two points.');
  const sampled = [points[0]];
  for (let index = 1; index < points.length - 1; index++) {
    if (uploadedRouteDistanceKm(sampled[sampled.length - 1], points[index]) >= 0.5) sampled.push(points[index]);
  }
  sampled.push(points[points.length - 1]);
  if (sampled.length <= 350) return sampled.map(point => [...point]);
  const reduced = [sampled[0]];
  for (let index = 1; index < 349; index++) {
    const pointIndex = Math.round(index * (sampled.length - 1) / 349);
    if (pointIndex > 0 && pointIndex < sampled.length - 1) reduced.push(sampled[pointIndex]);
  }
  reduced.push(sampled[sampled.length - 1]);
  return reduced.map(point => [...point]);
}

function parseUploadedRouteFile(text, filename) {
  if (typeof text !== 'string' || !text.length || text.length > 20_000_000) throw new Error('The route file is empty or too large (20 MB maximum).');
  if (typeof filename !== 'string') throw new Error('Choose a GeoJSON or KML stops or route file.');
  const extension = /\.([^.]+)$/.exec(filename.trim().toLowerCase())?.[1];
  const lines = [];
  const stops = [];
  const addLine = tuples => {
    if (!Array.isArray(tuples)) throw new Error('Invalid route geometry.');
    const points = tuples.map(uploadedRoutePoint);
    if (points.length < 2) throw new Error('Each route line must contain at least two points.');
    lines.push(points);
  };
  const addStop = (tuple, name = '') => {
    if (stops.length >= 100) throw new Error('Imported itineraries can contain at most 100 stops.');
    const coords = uploadedRoutePoint(tuple);
    const label = typeof name === 'string' ? name.trim() : '';
    if (label.length > 100) throw new Error('Imported stop names must be 100 characters or fewer.');
    stops.push({ name: label || `Stop ${stops.length + 1}`, coords });
  };
  const geoJsonName = properties =>
    [properties.name, properties.title, properties.label]
      .find(value => typeof value === 'string' && value.trim()) || '';
  if (extension === 'geojson' || extension === 'json') {
    let data;
    try { data = JSON.parse(text); }
    catch (error) { throw new Error(`Invalid GeoJSON: ${error.message}`); }
    const visitGeoJson = (value, properties = {}) => {
      if (!value || typeof value !== 'object') return;
      if (value.type === 'FeatureCollection') {
        if (!Array.isArray(value.features)) throw new Error('Invalid GeoJSON FeatureCollection.');
        value.features.forEach(feature => {
          if (feature?.type === 'Feature') visitGeoJson(feature);
        });
      } else if (value.type === 'Feature') visitGeoJson(value.geometry, value.properties || {});
      else if (value.type === 'GeometryCollection') {
        if (!Array.isArray(value.geometries)) throw new Error('Invalid GeoJSON GeometryCollection.');
        value.geometries.forEach(geometry => visitGeoJson(geometry, properties));
      } else if (value.type === 'Point') addStop(value.coordinates, geoJsonName(properties));
      else if (value.type === 'MultiPoint') {
        if (!Array.isArray(value.coordinates)) throw new Error('Invalid GeoJSON MultiPoint.');
        value.coordinates.forEach((coordinates, index) => {
          const baseName = geoJsonName(properties);
          addStop(coordinates, value.coordinates.length > 1 && baseName
            ? `${baseName} ${index + 1}` : baseName);
        });
      } else if (value.type === 'LineString') addLine(value.coordinates);
      else if (value.type === 'MultiLineString') {
        if (!Array.isArray(value.coordinates)) throw new Error('Invalid GeoJSON MultiLineString.');
        value.coordinates.forEach(addLine);
      }
    };
    visitGeoJson(data);
  } else if (extension === 'kml') {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('KML files with document type or entity declarations are not supported.');
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('Invalid KML XML.');
    const descendants = element => Array.from(element.getElementsByTagName('*'));
    const localName = element => element.localName || element.tagName?.split(':').pop();
    const parseKmlCoordinate = (text, isTrack = false) => {
      const values = text.trim().split(isTrack ? /\s+/ : ',');
      if (values.length < 2 || !values[0].trim() || !values[1].trim()) {
        throw new Error(isTrack ? 'Invalid KML gx:coord.' : 'Invalid KML coordinate.');
      }
      const longitude = Number(values[0]), latitude = Number(values[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        throw new Error(isTrack ? 'Invalid KML gx:coord.' : 'Invalid KML coordinate.');
      }
      return [longitude, latitude];
    };
    const placemarks = descendants(xml).filter(element => localName(element) === 'Placemark');
    for (const placemark of placemarks) {
      const elements = descendants(placemark);
      const nameElement = elements.find(element => localName(element) === 'name');
      const placemarkName = nameElement?.textContent?.trim() || '';
      for (const element of elements) {
        const name = localName(element);
        if (name === 'Point') {
          const coordinateElement = descendants(element).find(child => localName(child) === 'coordinates');
          if (!coordinateElement) throw new Error('KML Point has no coordinates.');
          const tokens = coordinateElement.textContent.trim().split(/\s+/).filter(Boolean);
          if (tokens.length !== 1) throw new Error('Each KML Point must contain exactly one coordinate.');
          addStop(parseKmlCoordinate(tokens[0]), placemarkName);
        } else if (name === 'LineString') {
          const coordinateElement = descendants(element).find(child => localName(child) === 'coordinates');
          if (!coordinateElement) throw new Error('KML LineString has no coordinates.');
          const tuples = coordinateElement.textContent.trim().split(/\s+/).filter(Boolean)
            .map(token => parseKmlCoordinate(token));
          addLine(tuples);
        } else if (name === 'Track') {
          const tuples = descendants(element).filter(child => localName(child) === 'coord')
            .map(coord => parseKmlCoordinate(coord.textContent, true));
          addLine(tuples);
        }
      }
    }
  } else throw new Error('Choose a .geojson, .json, or .kml stops or route file.');
  if (stops.length && lines.length) {
    throw new Error('This file contains both stops and a track. Import a points-only file for stops or a track-only file for route geometry.');
  }
  if (lines.length > 1) {
    throw new Error('This file contains multiple route lines. Import one track at a time.');
  }
  if (stops.length) return { stops, route: null };
  if (lines.length) return { stops: [], route: downsampleUploadedRoute(lines[0]) };
  throw new Error('No Point, LineString, or gx:Track geometry was found in the file.');
}

function trackEndpointStop(name, coords, id) {
  const political = cachedPoliticalAt(...coords);
  const region = [...new Set([
    ...(political?.counties || []).map(county => county.name),
    ...(political?.states || []),
    ...(political?.countries || [])
  ].filter(part => typeof part === 'string' && part.trim()))];
  return {
    kind: 'place', id, name: region.length ? region.join(', ') : name,
    coords: [...coords], travelMode: 'road'
  };
}

function updateUploadedRouteStatus(message = null) {
  const route = expeditionUploadedRoute;
  document.getElementById('expeditionRouteFileStatus').textContent =
    message || (route ? `Loaded track: ${route.length} points.` : 'No route imported.');
  document.getElementById('btnClearExpeditionRoute').classList.toggle('hidden', !route);
}

function dismissPlaceSuggestions(home, clearInput = false) {
  if (home) {
    clearTimeout(homeSearchTimer);
    homeSearchVersion++;
  } else {
    clearTimeout(expeditionSearchTimer);
    expeditionSearchVersion++;
  }
  const input = document.getElementById(home ? 'cityInput' : 'expeditionSearch');
  document.getElementById(home ? 'citySearchResults' : 'expeditionSearchResults').replaceChildren();
  document.getElementById(home ? 'homeLookupStatus' : 'expeditionStatus').textContent = '';
  if (clearInput) input.value = '';
}

async function lookupPhotonPlaces(query) {
  const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`,
    { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Place search failed (HTTP ${response.status}).`);
  const data = await response.json();
  if (!data || !Array.isArray(data.features)) throw new Error('Invalid place search response.');
  return data.features.map(feature => {
    const props = feature?.properties;
    const coords = feature?.geometry?.coordinates;
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(coords) || coords.length !== 2 ||
        typeof props?.name !== 'string' || !props.name.trim()) throw new Error('Invalid place search result.');
    const [lng, lat] = coords;
    CoordinateLookups.validateCoordinates(lat, lng);
    const parts = [...new Set([props.name, props.city, props.state, props.country]
      .filter(part => typeof part === 'string' && part.trim()).map(part => part.trim()))];
    return { name: parts.join(', ').slice(0, 250), coords: [lat, lng] };
  });
}

function suggestionButton(place, select) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'block text-left w-full rounded-lg bg-slate-800 hover:bg-slate-700 focus:bg-slate-700 p-3 text-xs';
  button.textContent = place.name;
  button.addEventListener('click', select);
  return button;
}

function refreshTravelUI() {
  if (map) {
    renderParkMarkers();
    drawFogOfWar();
  }
  updateAllUI();
}

function countyLabel(id) {
  const feature = countyFeaturesById[id];
  if (CoordinateLookups.validSubdivisionId(id)) {
    const country = feature?.properties?.country || 'Unknown country';
    const countryName = /^[A-Z]{3}$/.test(country)
      ? worldSubdivisionGeoJson?.find(entry => entry.properties.isoA3 === country)?.properties.country || country
      : country;
    return `${feature?.properties?.name || id}, ${countryName}`;
  }
  const state = usaRegionGeoJson?.find(state => String(state.id).padStart(2, '0') === id.slice(0, 2));
  return `${feature?.properties?.name || `County ${id}`}, ${state?.properties?.name || id}`;
}

function expeditionStop(kind, id) {
  if (kind === 'county') {
    const feature = countyFeaturesById[id];
    if (!feature) throw new Error('County geography is unavailable. Retry datasets.');
    const [lng, lat] = d3.geoCentroid(CoordinateLookups.normalizeFeature(feature, d3.geoArea));
    CoordinateLookups.validateCoordinates(lat, lng);
    return { kind, id, name: countyLabel(id), coords: [lat, lng] };
  }
  const place = (kind === 'poi' ? AppState.customPois : PARKS).find(place => place.id === id);
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) throw new Error('This destination has no route coordinates.');
  return { kind, id, name: place.name, coords: [place.lat, place.lng] };
}

function addExpeditionStop(kind, id) {
  if (AppState.viewOnly || expeditionPending) return;
  try {
    expeditionDraft.push({ ...expeditionStop(kind, id), travelMode: 'road' });
    invalidateExpeditionRoutes();
    renderExpeditionStops();
    dismissPlaceSuggestions(false, true);
  } catch (error) {
    console.error('Expedition selection failed', error);
    showNotification('Route selection failed', error.message, '⚠️');
  }
}

function addMicroStateStop(entry) {
  if (AppState.viewOnly || expeditionPending) return;
  // A place stop at the interior label point resolves to the micro-state via polygon lookup when the trip is saved.
  expeditionDraft.push({ kind: 'place', id: `place_${crypto.randomUUID()}`, name: entry.name,
    coords: [entry.lat, entry.lng], travelMode: 'road' });
  invalidateExpeditionRoutes();
  renderExpeditionStops();
  dismissPlaceSuggestions(false, true);
}

function addCustomCoordinateStop() {
  if (AppState.viewOnly || expeditionPending) return;
  const nameInput = document.getElementById('expeditionCoordinateName');
  const latInput = document.getElementById('expeditionCoordinateLat');
  const lngInput = document.getElementById('expeditionCoordinateLng');
  try {
    if (!latInput.value.trim() || !lngInput.value.trim()) {
      throw new Error('Enter both a latitude and longitude.');
    }
    const lat = Number(latInput.value);
    const lng = Number(lngInput.value);
    CoordinateLookups.validateCoordinates(lat, lng);
    const name = nameInput.value.trim() || `Coordinates ${lat}, ${lng}`;
    if (name.length > 100) throw new Error('Stop names must be 100 characters or fewer.');
    expeditionDraft.push({
      kind: 'place', id: `coord_${crypto.randomUUID()}`, name, coords: [lat, lng], travelMode: 'road'
    });
    nameInput.value = '';
    latInput.value = '';
    lngInput.value = '';
    invalidateExpeditionRoutes();
    renderExpeditionStops();
    document.getElementById('expeditionStatus').textContent = `${name} added. Preview routes before saving.`;
  } catch (error) {
    console.error('Custom coordinate stop rejected', error);
    document.getElementById('expeditionStatus').textContent = `Coordinate stop not added: ${error.message}`;
  }
}

function invalidateExpeditionRoutes() {
  expeditionPreparedLegs = null;
  expeditionPreparedKey = null;
  document.getElementById('expeditionRoutePreview').classList.add('hidden');
  document.getElementById('expeditionRouteSummary').textContent = '';
  document.getElementById('btnSaveExpedition').disabled = expeditionDraft.length !== 1;
  document.getElementById('btnPreviewExpedition').disabled = !expeditionDraft.length;
  scheduleExpeditionDraftRecovery();
}

function expeditionRouteKey() {
  return JSON.stringify([
    expeditionDraft.map(stop => [stop.kind, stop.id, stop.coords, stop.travelMode || 'road']),
    expeditionUploadedRoute
  ]);
}

function moveExpeditionStop(from, to) {
  if (AppState.viewOnly || expeditionPending || from === to ||
      from < 0 || to < 0 || from >= expeditionDraft.length || to >= expeditionDraft.length) return false;
  const [stop] = expeditionDraft.splice(from, 1);
  expeditionDraft.splice(to, 0, stop);
  invalidateExpeditionRoutes();
  renderExpeditionStops();
  document.getElementById('expeditionStatus').textContent =
    `${stop.name} moved to stop ${to + 1}. Preview routes again before saving.`;
  return true;
}

function wireExpeditionStopDrag(handle, item, list, index) {
  let drag = null;
  const clear = () => {
    item.style.transform = '';
    item.style.position = '';
    item.style.zIndex = '';
    item.style.opacity = '';
    for (const row of list.children) row.style.boxShadow = '';
    handle.setAttribute('aria-pressed', 'false');
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || expeditionPending || AppState.viewOnly) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, startY: event.clientY, target: index };
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute('aria-pressed', 'true');
    item.style.position = 'relative';
    item.style.zIndex = '1';
    item.style.opacity = '0.8';
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    item.style.transform = `translateY(${event.clientY - drag.startY}px)`;
    const rows = Array.from(list.children);
    let target = 0;
    rows.forEach((row, rowIndex) => {
      if (rowIndex === index) return;
      const bounds = row.getBoundingClientRect();
      if (event.clientY > bounds.top + bounds.height / 2) target++;
    });
    drag.target = target;
    for (const row of rows) row.style.boxShadow = '';
    if (target !== index) {
      rows[target].style.boxShadow = target < index
        ? '0 -3px 0 #fbbf24' : '0 3px 0 #fbbf24';
    }
    const form = document.getElementById('expeditionForm');
    const bounds = form.getBoundingClientRect();
    if (event.clientY < bounds.top + 48) form.scrollBy(0, -20);
    else if (event.clientY > bounds.bottom - 48) form.scrollBy(0, 20);
  });
  const finish = (event, cancelled) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { target, pointerId } = drag;
    drag = null;
    clear();
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (!cancelled && moveExpeditionStop(index, target)) {
      list.children[target].querySelector('[data-stop-drag]').focus();
    }
  };
  handle.addEventListener('pointerup', event => finish(event, false));
  handle.addEventListener('pointercancel', event => finish(event, true));
  handle.addEventListener('lostpointercapture', event => finish(event, true));
  handle.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const target = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (moveExpeditionStop(index, target)) list.children[target].querySelector('[data-stop-drag]').focus();
  });
}

function renderExpeditionStops() {
  const list = document.getElementById('expeditionStops');
  list.replaceChildren();
  expeditionDraft.forEach((stop, index) => {
    const item = document.createElement('li');
    item.className = 'rounded-lg bg-slate-900 p-3 space-y-2';
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2';
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.textContent = '⠿';
    handle.className = 'shrink-0 cursor-grab rounded px-3 py-2 text-lg text-amber-200 active:cursor-grabbing disabled:opacity-30';
    handle.style.touchAction = 'none';
    handle.style.userSelect = 'none';
    handle.setAttribute('data-stop-drag', '');
    handle.setAttribute('aria-label', `Reorder ${stop.name}. Drag or use the up and down arrow keys.`);
    handle.setAttribute('aria-pressed', 'false');
    handle.disabled = expeditionPending || AppState.viewOnly;
    wireExpeditionStopDrag(handle, item, list, index);
    row.appendChild(handle);
    const name = document.createElement('span');
    name.className = 'flex-1';
    name.textContent = `${index + 1}. ${stop.name}`;
    row.appendChild(name);
    const controls = document.createElement('span');
    for (const [text, label, action, disabled] of [
      ['Remove', `Remove ${stop.name}`, () => { expeditionDraft.splice(index, 1); }, false]
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.className = 'px-2 py-1 text-amber-200 disabled:opacity-30';
      button.setAttribute('aria-label', label);
      button.disabled = disabled || expeditionPending;
      button.addEventListener('click', () => { action(); invalidateExpeditionRoutes(); renderExpeditionStops(); });
      controls.appendChild(button);
    }
    row.appendChild(controls);
    item.appendChild(row);
    if (index < expeditionDraft.length - 1) {
      const label = document.createElement('label');
      label.className = 'block text-slate-400';
      label.textContent = `To ${expeditionDraft[index + 1].name}: `;
      const select = document.createElement('select');
      select.className = 'mt-1 max-w-full rounded-lg bg-slate-800 px-2 py-2 text-slate-200';
      select.setAttribute('aria-label', `Travel from ${stop.name} to ${expeditionDraft[index + 1].name}`);
      for (const [value, text] of Object.entries(TravelLedger.transitTags)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      }
      select.value = stop.travelMode || 'road';
      select.disabled = expeditionPending;
      select.addEventListener('change', () => {
        stop.travelMode = select.value;
        invalidateExpeditionRoutes();
      });
      label.appendChild(select);
      item.appendChild(label);
    }
    list.appendChild(item);
  });
  scheduleExpeditionDraftRecovery();
}

function renderExpeditionSearch() {
  clearTimeout(expeditionSearchTimer);
  const results = document.getElementById('expeditionSearchResults');
  results.replaceChildren();
  const query = document.getElementById('expeditionSearch').value.trim().toLowerCase();
  expeditionSearchVersion++;
  if (!expeditionPending) document.getElementById('expeditionStatus').textContent = '';
  if (!query || AppState.viewOnly || expeditionPending) return;
  const candidates = [
    ...Object.keys(countyFeaturesById).map(id => ({ kind: 'county', id, name: countyLabel(id) })),
    ...PARKS.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map(p => ({ kind: 'park', id: p.id, name: p.name })),
    ...AppState.customPois.map(p => ({ kind: 'poi', id: p.id, name: p.name }))
  ];
  let count = 0;
  const rawQuery = document.getElementById('expeditionSearch').value.trim();
  for (const entry of (typeof microStateCatalog !== 'undefined' ? microStateCatalog : [])) {
    if (!MicroStates.matches(entry.name, rawQuery)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.micro = '';
    button.className = 'block text-left w-full rounded bg-slate-800 p-2 text-xs';
    button.textContent = `${entry.name} (micro-state)`;
    button.addEventListener('click', () => addMicroStateStop(entry));
    results.appendChild(button);
    if (++count === 10) break;
  }
  count = 0;
  for (const candidate of candidates) {
    const stop = candidate;
    if (!`${stop.name} ${stop.id}`.toLowerCase().includes(query)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'block text-left w-full rounded bg-slate-800 p-2 text-xs';
    button.textContent = `${stop.name} (${stop.kind})`;
    button.addEventListener('click', () => addExpeditionStop(stop.kind, stop.id));
    results.appendChild(button);
    if (++count === 30) break;
  }
  expeditionSearchTimer = setTimeout(searchExpeditionPlaces, 300);
}

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function syncExpeditionDayTrip() {
  const dayTrip = document.getElementById('expeditionDayTrip').checked;
  const start = document.getElementById('expeditionStart');
  const end = document.getElementById('expeditionEnd');
  if (dayTrip) {
    start.value = start.value || end.value || localDate();
    end.value = start.value;
  }
  end.disabled = dayTrip;
  scheduleExpeditionDraftRecovery();
}

function openExpedition(id = null) {
  if (AppState.viewOnly || expeditionPending) return;
  const existing = id ? AppState.expeditions.find(exp => exp.id === id) : null;
  if (id && !existing) {
    showNotification('Expedition unavailable', 'This expedition no longer exists.', '⚠️');
    return;
  }
  expeditionEditingId = id;
  expeditionUploadedRoute = null;
  expeditionReturnFocus = document.activeElement;
  document.getElementById('expeditionForm').reset();
  document.getElementById('expeditionFileInput').value = '';
  document.getElementById('expeditionName').value = existing?.name || '';
  document.getElementById('expeditionReason').value = existing?.reason || '';
  document.getElementById('expeditionStart').value = existing?.startDate || '';
  document.getElementById('expeditionEnd').value = existing?.endDate || '';
  document.getElementById('expeditionDayTrip').checked = existing?.dayTrip ||
    !!(existing?.startDate && existing.startDate === existing.endDate);
  document.getElementById('expeditionTitle').textContent = existing ? 'Edit Expedition' : 'New Expedition';
  document.getElementById('btnSaveExpedition').textContent = existing ? 'Save changes' : 'Save expedition';
  const legacyMode = existing?.transitTags.includes('flight') ? 'flight' : existing?.transitTags[0] || 'road';
  expeditionDraft = existing ? (existing.routeStops?.length ? existing.routeStops.map((stop, index) => ({
    ...stop, coords: [...stop.coords], travelMode: existing.routeLegs?.[index]?.mode || legacyMode
  })) : existing.routeCoords.map((coords, index) => ({
    kind: 'place', id: `legacy_${index}`, name: `Stop ${index + 1}`, coords: [...coords], travelMode: legacyMode
  }))) : [];
  if (existing && !expeditionDraft.length) {
    try {
      expeditionDraft = [
        ...existing.countyIds.map(id => ({ ...expeditionStop('county', id), travelMode: legacyMode })),
        ...existing.parkIds.map(id => ({ ...expeditionStop('park', id), travelMode: legacyMode })),
        ...existing.customPoiIds.map(id => ({ ...expeditionStop('poi', id), travelMode: legacyMode }))
      ];
    } catch (error) {
      console.error('Expedition edit failed', error);
      showNotification('Expedition unavailable', error.message, '⚠️');
      return;
    }
  }
  const importedLeg = existing?.routeLegs?.length === 1 && existing.routeLegs[0].routeSource === 'uploaded'
    ? existing.routeLegs[0] : null;
  if (importedLeg) expeditionUploadedRoute = importedLeg.routeCoords.map(point => [...point]);
  updateUploadedRouteStatus();
  document.getElementById('expeditionSearch').value = '';
  document.getElementById('expeditionStatus').textContent = '';
  invalidateExpeditionRoutes();
  syncExpeditionDayTrip();
  renderExpeditionStops();
  renderExpeditionSearch();
  document.getElementById('expeditionModal').classList.remove('hidden');
  if (existing?.routeLegs) {
    expeditionPreparedLegs = TravelLedger.validateExpeditions([existing], CoordinateLookups)[0].routeLegs;
    expeditionPreparedKey = expeditionRouteKey();
    displayExpeditionPreview(expeditionPreparedLegs);
    document.getElementById('btnSaveExpedition').disabled = false;
  }
  document.getElementById('expeditionName').focus();
}

function closeExpedition() {
  if (expeditionPending) return;
  const discardRecovery = !expeditionEditingId;
  expeditionPicking = false;
  expeditionDraft = [];
  expeditionUploadedRoute = null;
  expeditionEditingId = null;
  document.getElementById('expeditionFileInput').value = '';
  updateUploadedRouteStatus();
  dismissPlaceSuggestions(false, true);
  invalidateExpeditionRoutes();
  document.getElementById('expeditionModal').classList.add('hidden');
  renderExpeditionStops();
  if (discardRecovery) discardExpeditionDraftRecovery();
  const fallback = document.getElementById(AppState.currentTab === 'travel' ? 'btnHistoryExpedition' : 'btnExpedition');
  (expeditionReturnFocus?.isConnected && expeditionReturnFocus.offsetParent !== null ? expeditionReturnFocus : fallback).focus();
  expeditionReturnFocus = null;
}

async function searchExpeditionPlaces() {
  if (AppState.viewOnly || expeditionPending) return;
  const query = document.getElementById('expeditionSearch').value.trim();
  const version = ++expeditionSearchVersion;
  const status = document.getElementById('expeditionStatus');
  const results = document.getElementById('expeditionSearchResults');
  try {
    if (!query) return;
    status.textContent = 'Searching places...';
    const airports = { SAN: 'San Diego International Airport', DEN: 'Denver International Airport' };
    const places = await lookupPhotonPlaces(airports[query.toUpperCase()] ||
      (/^[A-Z]{3}$/.test(query) ? `${query} airport` : query));
    if (version !== expeditionSearchVersion || expeditionPending || AppState.viewOnly) return;
    if (!places.length) {
      status.textContent = 'No cities or airports found. Try a more specific name.';
      return;
    }
    const microButtons = results.querySelectorAll(':scope > [data-micro]');
    let anchor = microButtons[microButtons.length - 1] || null;
    places.forEach(place => {
      const button = suggestionButton(place, () => {
        if (AppState.viewOnly || expeditionPending) return;
        expeditionDraft.push({ kind: 'place', name: place.name, coords: [...place.coords],
          travelMode: 'road', id: `place_${crypto.randomUUID()}` });
        invalidateExpeditionRoutes();
        renderExpeditionStops();
        dismissPlaceSuggestions(false, true);
      });
      if (anchor) anchor.after(button);
      else results.prepend(button);
      anchor = button;
    });
    status.textContent = 'Choose a place to add it.';
  } catch (error) {
    console.error('Expedition place search failed', error);
    if (version === expeditionSearchVersion) status.textContent = error.message;
  }
}

function setExpeditionBusy(busy) {
  expeditionPending = busy;
  for (const control of document.getElementById('expeditionForm').querySelectorAll('input, button, select, textarea')) control.disabled = busy;
  if (!busy) {
    syncExpeditionDayTrip();
    document.getElementById('btnSaveExpedition').disabled = !expeditionDraft.length ||
      (expeditionDraft.length > 1 && (!expeditionPreparedLegs || expeditionPreparedKey !== expeditionRouteKey()));
    document.getElementById('btnPreviewExpedition').disabled = !expeditionDraft.length;
  }
  renderExpeditionStops();
}

function expeditionLegIsApproximation(leg) {
  return leg.routeSource === 'direct' || (leg.mode === 'flight' && leg.routeSource === 'none') ||
    (leg.mode === 'ferry' && leg.routeSource === 'routed');
}

function displayExpeditionPreview(legs) {
  const container = document.getElementById('expeditionRoutePreview');
  container.classList.remove('hidden');
  if (!expeditionPreviewMap) {
    expeditionPreviewMap = L.map('expeditionRoutePreview', { attributionControl: true, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors'
    }).addTo(expeditionPreviewMap);
  }
  if (expeditionPreviewLayers) expeditionPreviewMap.removeLayer(expeditionPreviewLayers);
  expeditionPreviewLayers = L.featureGroup().addTo(expeditionPreviewMap);
  legs.forEach((leg, index) => {
    const route = leg.routeSource === 'uploaded' ? leg.routeCoords :
      ['ferry', 'flight', 'rail'].includes(leg.mode)
      ? [expeditionDraft[index].coords, expeditionDraft[index + 1].coords]
      : leg.routeCoords;
    const approximation = expeditionLegIsApproximation(leg);
    L.polyline(route, { color: '#020617', weight: 7, opacity: 0.9 }).addTo(expeditionPreviewLayers);
    L.polyline(route, {
      color: TRAVEL_ROUTE_COLORS[leg.mode] || '#22d3ee',
      weight: 3, opacity: 1,
      dashArray: approximation ? '8, 8' : null
    }).addTo(expeditionPreviewLayers);
  });
  expeditionDraft.forEach(stop => L.circleMarker(stop.coords, { radius: 5, color: '#10b981' })
    .bindTooltip(escapeHtml(stop.name)).addTo(expeditionPreviewLayers));
  expeditionPreviewMap.invalidateSize();
  expeditionPreviewMap.fitBounds(expeditionPreviewLayers.getBounds(), { padding: [20, 20], maxZoom: 12, animate: false });
  const counties = new Set(legs.flatMap(leg => leg.countyIds));
  document.getElementById('expeditionRouteSummary').textContent =
    `${legs.length} travel leg${legs.length === 1 ? '' : 's'} · ${counties.size} driving counties. Each boat trip reduces ocean fog by 10 percentage points to a 50% minimum (99% before the first trip). Ferry/flight routes fully clear water within 100 miles on either side when the world atlas is loaded; unvisited land stays shrouded; flights clear only a small area around each airport stop on land. Non-driving routes award no intermediate counties; rail/walking clear no route fog. Dashed lines are direct approximations.`;
}

async function previewExpeditionRoutes() {
  if (AppState.viewOnly || expeditionPending) return;
  const status = document.getElementById('expeditionStatus');
  try {
    if (!expeditionDraft.length) throw new Error('Add at least one stop.');
    if (!coordinateIndexes) throw new Error('Geography is not ready. Retry datasets.');
    if (expeditionDraft.length > 100) throw new Error('Use at most 100 stops per expedition.');
    setExpeditionBusy(true);
    status.textContent = 'Preparing route preview...';
    const legs = [];
    const countyIndex = coordinateIndexes.counties;
    if (expeditionUploadedRoute && expeditionDraft.length !== 2) {
      throw new Error('An imported track needs exactly two expedition stops. Remove intermediate stops or clear the track.');
    }
    for (let index = 0; index < expeditionDraft.length - 1; index++) {
      const from = expeditionDraft[index], to = expeditionDraft[index + 1];
      const mode = from.travelMode || 'road';
      let routeCoords = [];
      let countyIds = [];
      let routeSource = 'direct';
      if (expeditionUploadedRoute) {
        routeCoords = expeditionUploadedRoute.map(point => [...point]);
        if (uploadedRouteDistanceKm(routeCoords[0], from.coords) > 1.609344 ||
            uploadedRouteDistanceKm(routeCoords[routeCoords.length - 1], to.coords) > 1.609344) {
          throw new Error('The imported track endpoints must match the first and last expedition stops.');
        }
        routeSource = 'uploaded';
        if (mode === 'road' || mode === 'awd') {
          countyIds = CoordinateLookups.routeCountyIds(routeCoords, countyIndex, d3.geoContains);
        }
      } else if (mode === 'road' || mode === 'awd') {
        const key = JSON.stringify([from.coords, to.coords]);
        if (!expeditionRoadCache.has(key)) {
          const wait = Math.max(0, 1100 - (Date.now() - lastRoadRequest));
          if (wait) await new Promise(resolve => setTimeout(resolve, wait));
          lastRoadRequest = Date.now();
          expeditionRoadCache.set(key, await CoordinateLookups.lookupRoadRoute(from.coords, to.coords));
        }
        routeCoords = expeditionRoadCache.get(key).map(point => [...point]);
        countyIds = CoordinateLookups.routeCountyIds(routeCoords, countyIndex, d3.geoContains);
        routeSource = 'routed';
      } else if (['ferry', 'foot', 'rail'].includes(mode)) routeCoords = [[...from.coords], [...to.coords]];
      else routeSource = 'none';
      legs.push({ mode, routeSource, routeCoords, countyIds });
    }
    // Validation also rejects road routes snapped too far from the requested endpoints.
    TravelLedger.validateExpeditions([draftExpedition(legs)], CoordinateLookups);
    displayExpeditionPreview(legs);
    expeditionPreparedLegs = legs;
    expeditionPreparedKey = expeditionRouteKey();
    status.textContent = 'Review the routes, then save. Dashed lines are direct approximations, not routed paths.';
  } catch (error) {
    console.error('Expedition route preview failed', error);
    invalidateExpeditionRoutes();
    status.textContent = `Routes not ready: ${error.message}`;
  } finally {
    setExpeditionBusy(false);
  }
}

function draftExpedition(legs) {
  const stops = expeditionDraft.map(({ travelMode, ...stop }) => ({ ...stop, coords: [...stop.coords] }));
  const existing = AppState.expeditions.find(exp => exp.id === expeditionEditingId);
  return {
    id: expeditionEditingId || `exp_${crypto.randomUUID()}`, name: document.getElementById('expeditionName').value.trim() || 'Expedition',
    reason: document.getElementById('expeditionReason').value.trim(),
    startDate: document.getElementById('expeditionStart').value || null,
    endDate: document.getElementById('expeditionEnd').value || null,
    dayTrip: !!document.getElementById('expeditionDayTrip').checked,
    transitTags: [...new Set(legs.map(leg => leg.mode))],
    countyIds: [...new Set(stops.filter(stop => stop.kind === 'county').map(stop => stop.id))],
    parkIds: [...new Set(stops.filter(stop => stop.kind === 'park').map(stop => stop.id))],
    customPoiIds: [...new Set(stops.filter(stop => stop.kind === 'poi').map(stop => stop.id))],
    routeCoords: stops.map(stop => [...stop.coords]), routeStops: stops, routeLegs: legs,
    minElevationFt: null, maxElevationFt: null,
    journal: existing?.journal || '', photos: [...(existing?.photos || [])]
  };
}

async function saveExpedition(event) {
  event.preventDefault();
  if (AppState.viewOnly || expeditionPending) return;
  const status = document.getElementById('expeditionStatus');
  try {
    if (!document.getElementById('expeditionName').value.trim()) throw new Error('Enter a trip name.');
    syncExpeditionDayTrip();
    if (expeditionDraft.length > 1 &&
        (!expeditionPreparedLegs || expeditionPreparedKey !== expeditionRouteKey())) throw new Error('Preview your routes before saving.');
    const exp = draftExpedition(expeditionPreparedLegs || []);
    const stops = exp.routeStops;
    TravelLedger.validateExpeditions([exp], CoordinateLookups);
    if (!coordinateIndexes) throw new Error('Geography is not ready. Retry datasets before saving.');
    const projectedExpeditions = [...AppState.expeditions];
    if (expeditionEditingId) {
      const index = projectedExpeditions.findIndex(item => item.id === expeditionEditingId);
      if (index < 0) throw new Error('This expedition no longer exists.');
      projectedExpeditions[index] = exp;
    } else projectedExpeditions.push(exp);
    await persistExpeditionDraftRecovery();
    assertPassportStorageCapacity({ ...passportPayload(), expeditions: projectedExpeditions });
    setExpeditionBusy(true);
    status.textContent = 'Sampling stop elevations. The expedition is not saved yet...';
    // Bounded batches avoid sending one hundred concurrent public API requests.
    const elevations = [];
    for (let offset = 0; offset < stops.length; offset += 4) {
      const batch = await Promise.all(stops.slice(offset, offset + 4).map(async stop => {
        const terrestrial = CoordinateLookups.biomeRegion(...stop.coords, coordinateIndexes.ecoregions,
          d3.geoContains, coordinateIndexes.mangroves).biomes.length > 0;
        const poi = stop.kind === 'poi' ? AppState.customPois.find(poi => poi.id === stop.id) : null;
        const parkRarity = stop.kind === 'park'
          ? AppState.parkRarity?.[stop.id] || window.catalogParkRarityFor?.(stop.id)
          : null;
        const rarity = stop.rarity || poi?.rarity || parkRarity?.rarity ||
          CoordinateLookups.cachedRarity(...stop.coords, localStorage);
        const rarityTier = stop.rarityTier || rarity?.rarityTier || poi?.rarityTier || parkRarity?.rarityTier;
        const elevationFt = stop.elevationFt ?? poi?.elevationFt ?? (await CoordinateLookups.lookupElevation(...stop.coords)).feet;
        return { ...stop, terrestrial, elevationFt, ...(rarity ? { rarity } : {}),
          ...(CoordinateLookups.RARITY_TIERS[rarityTier] ? { rarityTier } : {}) };
      }));
      elevations.push(...batch);
    }
    exp.routeStops = elevations;
    const terrestrialElevations = elevations.filter(stop => stop.terrestrial).map(stop => stop.elevationFt);
    if (terrestrialElevations.length) {
      exp.minElevationFt = Math.min(...terrestrialElevations);
      exp.maxElevationFt = Math.max(...terrestrialElevations);
    }
    const editing = !!expeditionEditingId;
    if (editing) updateExpedition(exp);
    else addExpedition(exp);
    setExpeditionBusy(false);
    closeExpedition();
    refreshTravelUI();
    void enrichExpeditionStopRarities(exp.id);
    AudioEngine.playChime('discover');
    showNotification(editing ? 'Expedition updated' : 'Expedition logged', `${exp.name}: ${stops.length} stops.`, '🗺️');
  } catch (error) {
    console.error('Expedition save failed', error);
    status.textContent = `Not saved: ${error.message} Your draft is retained in this tab${savedExpeditionDraft ? ' and separately on this device' : ''}; retry or download a recovery file.`;
  } finally {
    setExpeditionBusy(false);
  }
}

async function enrichExpeditionStopRarities(expeditionId) {
  if (AppState.viewOnly) return;
  const expedition = AppState.expeditions.find(item => item.id === expeditionId);
  if (!expedition) return;
  const stops = [...(expedition.routeStops || [])];
  const rarityStorage = window.coordinateRarityStorage?.() || null;
  let updated = false;
  for (let offset = 0; offset < stops.length; offset += 2) {
    const batch = await Promise.all(stops.slice(offset, offset + 2).map(async stop => {
      if (!stop.coords) return stop;
      if (stop.kind === 'poi') {
        const linkedPoi = AppState.customPois.find(poi => poi.id === stop.id);
        if (linkedPoi) {
          await window.enrichCustomPoiRarity?.(linkedPoi.id);
          const resolvedPoi = AppState.customPois.find(poi => poi.id === linkedPoi.id);
          if (resolvedPoi?.rarity && CoordinateLookups.RARITY_TIERS[resolvedPoi.rarityTier]) {
            if (stop.rarityTier === resolvedPoi.rarityTier && stop.rarity) return stop;
            updated = true;
            return { ...stop, rarity: resolvedPoi.rarity, rarityTier: resolvedPoi.rarityTier };
          }
        }
      }
      if (stop.kind === 'park') {
        const rarity = window.catalogParkRarityFor?.(stop.id);
        if (rarity?.rarityTier && CoordinateLookups.RARITY_TIERS[rarity.rarityTier]) {
          if (stop.rarityTier === rarity.rarityTier && stop.rarity) return stop;
          updated = true;
          return { ...stop, ...(rarity.rarity ? { rarity: rarity.rarity } : {}), rarityTier: rarity.rarityTier };
        }
      }
      if (stop.rarityTier && stop.rarity) {
        if (stop.photonId || stop.kind === 'place') {
          window.showFieldAppraisal?.({ ...stop, status: 'v' }, stop.rarity,
            `${expeditionId}:${stop.photonId || stop.id || stop.coords.join(',')}`);
        }
        return stop;
      }
      try {
      const rarity = window.lookupCachedOrSharedRarity
        ? await window.lookupCachedOrSharedRarity(stop.coords[0], stop.coords[1], stop.name)
        : CoordinateLookups.cachedRarity(stop.coords[0], stop.coords[1], rarityStorage, Date.now(), stop.name) ||
          await CoordinateLookups.lookupRarityWithFallback(...stop.coords, {
            storage: rarityStorage, rarityEndpoint: CartovellaConfig.rarityEndpoint,
            placeName: stop.name
          });
      if (!rarity?.rarityTier || !CoordinateLookups.RARITY_TIERS[rarity.rarityTier]) return stop;
      updated = true;
      if (stop.photonId || stop.kind === 'place') {
        window.showFieldAppraisal?.({ ...stop, status: 'v' }, rarity,
          `${expeditionId}:${stop.photonId || stop.id || stop.coords.join(',')}`);
      }
      return { ...stop, rarity, rarityTier: rarity.rarityTier };
      } catch (error) {
        console.error('Expedition stop rarity lookup unavailable', expeditionId, stop.name, error);
        return stop;
      }
    }));
    stops.splice(offset, batch.length, ...batch);
  }
  if (updated) {
    const current = AppState.expeditions.find(item => item.id === expeditionId);
    if (current) {
      try {
        updateExpedition({ ...current, routeStops: stops });
        refreshTravelUI();
      } catch (error) {
        console.error('Expedition rarity metadata could not be saved', expeditionId, error);
        showNotification('Rarity badges not saved', error.message, '⚠️');
      }
    }
  }
}

function downloadExpeditionRecovery() {
  const draft = expeditionRecoverySnapshot();
  if (draft.stops.length < 2 || !Array.isArray(draft.preparedLegs) ||
      draft.preparedLegs.length !== draft.stops.length - 1) {
    document.getElementById('expeditionRecoveryStatus').textContent =
      'Preview the complete route before downloading an importable recovery file.';
    return;
  }
  const recoveryDraft = {
    ...draft,
    stops: draft.stops.map(({ travelMode, ...stop }) => ({ ...stop, travelMode })),
    legs: draft.preparedLegs,
    uploadedRoute: draft.uploadedRoute
  };
  downloadJsonFile(
    { ...passportPayload(), _unsavedExpeditionDraft: recoveryDraft },
    `cartovella-recovery-${new Date().toISOString().slice(0, 10)}.json`
  );
  document.getElementById('expeditionRecoveryStatus').textContent =
    'Recovery file downloaded. Keep it somewhere safe; import it after deploying the updated app.';
}

async function importExpeditionRoute(event) {
  if (AppState.viewOnly || expeditionPending) return;
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 20_000_000) throw new Error('The route file is too large (20 MB maximum).');
    const imported = parseUploadedRouteFile(await file.text(), file.name);
    if (imported.stops.length) {
      if (expeditionDraft.length && !window.confirm(
        'Replace the current expedition stops with the imported stops?'
      )) return;
      expeditionDraft = imported.stops.map(stop => ({
        kind: 'place',
        id: `file_${crypto.randomUUID()}`,
        name: stop.name,
        coords: [...stop.coords],
        travelMode: 'road'
      }));
      expeditionUploadedRoute = null;
      invalidateExpeditionRoutes();
      renderExpeditionStops();
      updateUploadedRouteStatus(`${imported.stops.length} stops imported. Choose a transit type for each leg, then preview routes.`);
      return;
    }
    const route = imported.route;
    if (expeditionDraft.length > 2) {
      throw new Error('An imported track needs exactly two expedition stops. Remove intermediate stops before importing.');
    }
    if (expeditionDraft.length < 2) {
      expeditionDraft = [
        trackEndpointStop('Track Start', route[0], `track_start_${crypto.randomUUID()}`),
        trackEndpointStop('Track End', route[route.length - 1], `track_end_${crypto.randomUUID()}`)
      ];
      renderExpeditionStops();
    } else {
      const startMatches = uploadedRouteDistanceKm(route[0], expeditionDraft[0].coords) <= 1.609344;
      const endMatches = uploadedRouteDistanceKm(route[route.length - 1], expeditionDraft[1].coords) <= 1.609344;
      const reversedStartMatches = uploadedRouteDistanceKm(route[route.length - 1], expeditionDraft[0].coords) <= 1.609344;
      const reversedEndMatches = uploadedRouteDistanceKm(route[0], expeditionDraft[1].coords) <= 1.609344;
      if (!startMatches || !endMatches) {
        if (reversedStartMatches && reversedEndMatches) route.reverse();
        else throw new Error('The imported track endpoints must match the first and last expedition stops.');
      }
    }
    expeditionUploadedRoute = route;
    updateUploadedRouteStatus();
    invalidateExpeditionRoutes();
    renderExpeditionStops();
    await previewExpeditionRoutes();
  } catch (error) {
    console.error('Expedition route import failed', error);
    updateUploadedRouteStatus(`Route not imported: ${error.message}`);
  } finally {
    input.value = '';
  }
}

function clearExpeditionRoute() {
  if (expeditionPending) return;
  expeditionUploadedRoute = null;
  document.getElementById('expeditionFileInput').value = '';
  updateUploadedRouteStatus();
  invalidateExpeditionRoutes();
}

let travelLogMaps = {};
let travelLogResizeObserver = null;
const openTravelLogs = new Set();
const travelJournalDrafts = new Map();
const confirmingTravelLogDeletion = new Set();
const TRAVEL_ROUTE_COLORS = { road: '#22d3ee', awd: '#22d3ee', ferry: '#38bdf8',
  flight: '#94a3b8', rail: '#a78bfa', foot: '#4ade80' };
const GLOBAL_ROUTE_COLORS = {
  road: '#f59e0b', awd: '#f59e0b', flight: '#94a3b8',
  ferry: '#38bdf8', rail: '#c084fc', foot: '#f472b6'
};
const TRAVEL_TRANSIT_BADGE_TONES = Object.freeze({
  road: 'bg-amber-950 text-amber-300 border-amber-500/40',
  awd: 'bg-amber-950 text-amber-300 border-amber-500/40',
  ferry: 'bg-sky-950 text-sky-300 border-sky-500/40',
  flight: 'bg-slate-800 text-slate-300 border-slate-500/40',
  rail: 'bg-purple-950 text-purple-300 border-purple-500/40',
  foot: 'bg-pink-950 text-pink-300 border-pink-500/40'
});
const GLOBAL_ROUTE_MAP_STYLES = Object.freeze({
  midnight: {
    ocean: '#040814', land: '#0f172a', visited: '#13233f',
    border: '#1e293b', graticule: '#1e293b', text: '#e2e8f0',
    routes: GLOBAL_ROUTE_COLORS
  },
  classic: {
    ocean: '#dceaf2', land: '#f5f1e6', visited: '#c6dfc4',
    border: '#82919c', graticule: '#afbdc4', text: '#1e293b',
    routes: { road: '#b45309', awd: '#b45309', flight: '#64748b',
      ferry: '#0369a1', rail: '#7e22ce', foot: '#be185d' }
  },
  parchment: {
    ocean: '#e9dec5', land: '#d3c19d', visited: '#a7bd91',
    border: '#907d5a', graticule: '#bcac8c', text: '#3b3428',
    routes: { road: '#92400e', awd: '#92400e', flight: '#475569',
      ferry: '#1d4ed8', rail: '#6b21a8', foot: '#9d174d' }
  }
});
// Continent membership follows Annexare Countries (MIT): https://github.com/annexare/Countries.
const ROUTE_MAP_CONTINENT_COUNTRIES = Object.freeze({
  Africa: 'AC AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TA TD TG TN TZ UG YT ZA ZM ZW',
  Asia: 'AE AF AM AZ BD BH BN BT CC CN CX GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA RU SA SG SY TH TJ TM TR TW UZ VN YE',
  Europe: 'AD AL AT AX BA BE BG CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS SE SI SJ SK SM UA VA XK',
  'North America': 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  'South America': 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  Oceania: 'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TL TO TV UM VU WF WS',
  Antarctica: 'AQ BV GS HM TF'
});
const ROUTE_MAP_CONTINENT_BY_COUNTRY = new Map();
Object.entries(ROUTE_MAP_CONTINENT_COUNTRIES).forEach(([continent, countryCodes]) => {
  countryCodes.split(' ').forEach(code => ROUTE_MAP_CONTINENT_BY_COUNTRY.set(code, continent));
});
let globalRoutesOpen = false;
let globalRoutesZoomBehavior = null;
let globalRoutesScope = 'global';
let globalRoutesYear = 'all';
let globalRoutesAtlasStyle = 'midnight';
let globalRoutesVisibleExpeditions = [];
const travelLogCountyIdCache = new WeakMap();

const TRAVEL_LOG_MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function travelLogPeriod(exp) {
  const date = exp.startDate || exp.endDate;
  const match = /^(\d{4})-(\d{2})/.exec(date || '');
  if (!match) return 'UNDATED';
  return `${TRAVEL_LOG_MONTHS[Number(match[2]) - 1] || match[2]} ${match[1]}`;
}

function travelLogDateRange(exp) {
  if (!exp.startDate && !exp.endDate) return 'Dates not specified';
  return `${exp.startDate || '?'} – ${exp.endDate || '?'}`;
}

function routeMapYearFromDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? Number(date.slice(0, 4)) : null;
}

function routeMapExpeditionYears(exp) {
  const startYear = routeMapYearFromDate(exp.startDate);
  const endYear = routeMapYearFromDate(exp.endDate);
  if (startYear === null && endYear === null) return [];
  const firstYear = Math.min(startYear ?? endYear, endYear ?? startYear);
  const lastYear = Math.max(startYear ?? endYear, endYear ?? startYear);
  return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);
}

function routeMapAvailableYears() {
  const years = new Set();
  AppState.expeditions.forEach(exp => routeMapExpeditionYears(exp).forEach(year => years.add(year)));
  return [...years].sort((a, b) => b - a);
}

function globalRoutesExportYearLabel() {
  return globalRoutesYear === 'all' ? 'ALL YEARS' : globalRoutesYear;
}

function travelLogStopNames(exp) {
  return exp.routeStops?.map(stop => stop.name || `${stop.kind} ${stop.id}`) || [
    ...exp.countyIds.map(id => countyFeaturesById[id]?.properties?.name || `County ${id}`),
    ...exp.parkIds.map(id => PARKS.find(p => p.id === id)?.name || `Park ${id}`),
    ...exp.customPoiIds.map(id => AppState.customPois.find(p => p.id === id)?.name || `POI ${id}`)
  ];
}

function travelLogRegions(exp) {
  const states = [];
  const counties = [];
  exp.countyIds.forEach(id => {
    const label = countyLabel(id);
    const [county, state] = label.split(', ');
    if (state && !states.includes(state)) states.push(state);
    if (!counties.includes(county)) counties.push(county);
  });
  return [states.join(' · '), counties.join(', ')].filter(Boolean).join(' — ');
}

function travelLogBadges(exp) {
  const badges = exp.parkIds.map(id => {
    const park = PARKS.find(p => p.id === id);
    return {
      icon: '🏞️', label: park?.name || `Park ${id}`, kind: 'destination', id,
      tone: 'bg-emerald-950 text-emerald-300 border-emerald-500/40'
    };
  });
  exp.customPoiIds.forEach(id => {
    const poi = AppState.customPois.find(p => p.id === id);
    badges.push({
      icon: '📌', label: poi?.name || `POI ${id}`, kind: 'destination', id,
      tone: 'bg-violet-950 text-violet-300 border-violet-500/40'
    });
  });
  exp.transitTags.forEach(tag => {
    badges.push({
      icon: TravelLedger.transitIcons[tag],
      label: TravelLedger.transitTags[tag],
      tone: TRAVEL_TRANSIT_BADGE_TONES[tag] || 'bg-slate-800 text-slate-300 border-slate-500/40'
    });
  });
  return badges.filter(badge => badge.label);
}

function travelLogCountryFlags(exp) {
  const countries = new Set();
  const add = values => (values || []).forEach(country => countries.add(country));
  // Only logged stops count: route interiors can cross countries without a visit.
  (exp.routeStops?.length ? exp.routeStops.map(stop => stop.coords) : exp.routeCoords || [])
    .filter(travelLogPoint).forEach(coords => add(cachedPoliticalAt(...coords)?.countries));
  exp.parkIds.forEach(id => {
    const park = PARKS.find(item => item.id === id);
    if (park) add(park.intl ? park.countryCode ? [park.country] : [] : ['United States of America']);
  });
  exp.customPoiIds.forEach(id => add(AppState.customPois.find(poi => poi.id === id)?.political?.countries));
  travelLogCountyRegions(exp).countries.forEach(country => countries.add(country));
  const home = AppState.homeBase;
  const homeCountries = home ? cachedPoliticalAt(home.lat, home.lng)?.countries ||
    (home.countyId ? ['United States of America'] : []) : [];
  const homeKeys = new Set(homeCountries.map(country => InternationalParks.countryCode(country) || country));
  return profileCountryFlags([...countries]).filter(flag => !homeKeys.has(flag.code || flag.name));
}

function travelLogStateFlags(exp) {
  const states = new Set();
  const add = values => (values || []).forEach(state => {
    if (NpsCatalog.isUsState(state)) states.add(state);
  });
  (exp.routeStops?.length ? exp.routeStops.map(stop => stop.coords) : exp.routeCoords || [])
    .filter(travelLogPoint).forEach(coords => add(cachedPoliticalAt(...coords)?.states));
  exp.parkIds.forEach(id => {
    const park = PARKS.find(item => item.id === id);
    if (park) add(park.states || (park.state ? park.state.split(',').map(state => state.trim()) : []));
  });
  exp.customPoiIds.forEach(id => add(AppState.customPois.find(poi => poi.id === id)?.political?.states));
  travelLogCountyRegions(exp).states.forEach(state => states.add(state));
  return profileStateFlags([...states]);
}

function travelLogCountyRegions(exp) {
  const states = new Set();
  const countries = new Set();
  for (const id of travelLogCountyIds(exp)) {
    if (CoordinateLookups.validSubdivisionId(id)) {
      const country = countyFeaturesById[id]?.properties?.country || id.slice(0, 3);
      const countryName = /^[A-Z]{3}$/.test(country)
        ? worldSubdivisionGeoJson?.find(feature => feature.properties.isoA3 === country)?.properties.country || country
        : country;
      countries.add(countryName);
      continue;
    }
    countries.add('United States of America');
    const label = countyLabel(id);
    const state = label.slice(label.lastIndexOf(', ') + 2);
    if (NpsCatalog.isUsState(state)) states.add(state);
  }
  return { states, countries };
}

function travelLogCountyIds(exp) {
  const routeLegs = exp.routeLegs || [];
  const cached = travelLogCountyIdCache.get(exp);
  if (cached && cached.routeLegs === exp.routeLegs && cached.countyIds === exp.countyIds &&
      cached.indexes === coordinateIndexes) return cached.ids;

  const ids = new Set(exp.countyIds || []);
  routeLegs.forEach(leg => {
    (leg.countyIds || []).forEach(id => ids.add(id));
    if (leg.routeSource === 'uploaded' && !leg.countyIds?.length &&
        coordinateIndexes?.counties?.length && leg.routeCoords?.length >= 2) {
      CoordinateLookups.routeCountyIds(leg.routeCoords, coordinateIndexes.counties, d3.geoContains)
        .forEach(id => ids.add(id));
    }
  });
  const values = [...ids];
  travelLogCountyIdCache.set(exp, {
    routeLegs: exp.routeLegs, countyIds: exp.countyIds, indexes: coordinateIndexes, ids: values
  });
  return values;
}

function destroyTravelLogMaps() {
  travelLogResizeObserver?.disconnect();
  travelLogResizeObserver = null;
  Object.values(travelLogMaps).forEach(instance => {
    try { instance.remove(); }
    catch (error) { console.error('Mini-map teardown failed', error); }
  });
  travelLogMaps = {};
}

function travelLogPoint(coords) {
  return Array.isArray(coords) && coords.length === 2 &&
    Number.isFinite(coords[0]) && Number.isFinite(coords[1]) &&
    Math.abs(coords[0]) <= 90 && Math.abs(coords[1]) <= 180;
}

function travelLogLegs(exp) {
  const route = (exp.routeCoords || []).filter(travelLogPoint);
  return (Array.isArray(exp.routeLegs) ? exp.routeLegs.map((leg, index) => ({
    mode: leg.mode,
    routeSource: leg.routeSource ?? (leg.mode === 'flight' ? 'none' :
      ['road', 'awd'].includes(leg.mode) ? 'routed' : 'direct'),
    coords: leg.routeSource === 'uploaded' ? leg.routeCoords :
      ['ferry', 'flight', 'rail'].includes(leg.mode)
        ? [exp.routeStops?.[index]?.coords, exp.routeStops?.[index + 1]?.coords] : leg.routeCoords
  })) : null) || (route.length > 1 ? [{
    mode: (exp.transitTags || []).some(mode => !['road', 'awd'].includes(mode)) ? 'flight' : 'road',
    routeSource: (exp.transitTags || []).every(mode => ['road', 'awd'].includes(mode)) ? 'routed' : 'direct',
    coords: route
  }] : []);
}

function travelLogMetrics(exp) {
  const legs = travelLogLegs(exp).filter(leg => leg.coords?.length > 1 && leg.coords.every(travelLogPoint));
  const miles = legs.reduce((sum, leg) => sum + leg.coords.slice(1).reduce((length, point, index) =>
    length + TravelLedger.distanceMiles({ lat: leg.coords[index][0], lng: leg.coords[index][1] },
      { lat: point[0], lng: point[1] }), 0), 0);
  const approximate = legs.some(leg => leg.routeSource !== 'uploaded' && leg.routeSource !== 'routed');
  const elevation = Number.isFinite(exp.minElevationFt) && Number.isFinite(exp.maxElevationFt)
    ? `${Math.round(exp.minElevationFt).toLocaleString('en')} to ${Math.round(exp.maxElevationFt).toLocaleString('en')} ft`
    : 'Not recorded';
  let gain = 0, loss = 0, pairs = 0;
  const stops = exp.routeStops || [];
  for (let index = 1; index < stops.length; index++) {
    if (!Number.isFinite(stops[index - 1].elevationFt) || !Number.isFinite(stops[index].elevationFt)) continue;
    const delta = stops[index].elevationFt - stops[index - 1].elevationFt;
    gain += Math.max(0, delta);
    loss += Math.max(0, -delta);
    pairs++;
  }
  return { mileage: legs.length ? `${approximate ? '≈ ' : ''}${Math.round(miles).toLocaleString('en')} mi` : 'Not recorded',
    elevation, changes: pairs ? `+${Math.round(gain).toLocaleString('en')} / −${Math.round(loss).toLocaleString('en')} ft between logged stops` : '' };
}

function renderPublicExpeditionSummary(profile, expedition) {
  const username = String(profile.username || '');
  const stats = profile.summary_stats || {};
  const detailsShared = expedition.detailsShared !== false;
  const dates = [expedition.startDate, expedition.endDate].filter(Boolean).join(' – ');
  const transitTags = (detailsShared && Array.isArray(expedition.transitTags) ? expedition.transitTags : [])
    .map(mode => TravelLedger.transitTags[mode] || mode);
  const stopNames = (detailsShared && Array.isArray(expedition.stopNames) ? expedition.stopNames : [])
    .filter(name => typeof name === 'string' && name.trim());
  const photos = (Array.isArray(expedition.photos) ? expedition.photos :
    typeof expedition.highlightPhoto === 'string' ? [expedition.highlightPhoto] : [])
    .filter(photo => typeof photo === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo));
  const distance = detailsShared && Number.isFinite(expedition.distanceMiles)
    ? `${expedition.distanceMiles.toLocaleString('en', { maximumFractionDigits: 1 })} mi`
    : '';
  const title = detailsShared ? expedition.name || 'Untitled expedition' : 'Shared expedition';
  return `<article class="rpg-panel overflow-hidden rounded-2xl p-4">
    <div class="flex items-center gap-3">
      <canvas width="80" height="48" data-guild-avatar="${escapeHtml(username)}" class="h-12 w-12 shrink-0 rounded-full bg-slate-950 object-cover" aria-hidden="true"></canvas>
      <div class="min-w-0"><p class="truncate text-xs font-semibold text-sky-200">@${escapeHtml(username)}</p>
        <p class="truncate text-[11px] text-slate-400">${escapeHtml(profile.display_name || stats.cls || 'Explorer')}</p></div>
    </div>
    <h4 class="mt-3 text-base font-bold text-amber-200">${escapeHtml(title)}</h4>
    ${detailsShared ? `<p class="mt-1 text-xs text-slate-400">${escapeHtml(dates || 'Dates not set')}${expedition.dayTrip ? ' · Day trip' : ''} · ${escapeHtml(distance || 'Distance not recorded')}</p>` : ''}
    ${transitTags.length ? `<p class="mt-2 text-xs text-sky-200">Transit: ${escapeHtml(transitTags.join(' · '))}</p>` : ''}
    ${stopNames.length ? `<p class="mt-2 text-xs text-slate-300"><span class="font-semibold text-slate-400">Stops:</span> ${escapeHtml(stopNames.join(' · '))}</p>` : ''}
    ${detailsShared && expedition.reason ? `<p class="mt-2 text-xs text-slate-400">${escapeHtml(expedition.reason)}</p>` : ''}
    ${expedition.journalSnippet ? `<p class="mt-2 whitespace-pre-line text-sm text-slate-200">${escapeHtml(expedition.journalSnippet)}</p>` : ''}
    ${photos.length ? `<div class="mt-3 flex flex-wrap gap-2">${photos.map((photo, index) =>
      `<figure class="rotate-1 rounded bg-white p-2 pb-3 shadow-lg"><img src="${photo}" alt="Shared trip photo ${index + 1}" class="max-h-40 max-w-full object-cover" loading="lazy" decoding="async"></figure>`
    ).join('')}</div>` : ''}
    ${detailsShared ? `<button type="button" data-guild-open-travel="${escapeHtml(username)}" class="mt-3 rounded-lg border border-sky-400/40 bg-sky-950/40 px-3 py-2 text-xs text-sky-200 hover:bg-sky-900/50">Open in Explorer's Travel Log (📖)</button>` : ''}
  </article>`;
}

function renderTravelLogMiniMap(exp) {
  const host = document.getElementById(`mini-map-${exp.id}`);
  if (!L || typeof L.map !== 'function') {
    host.textContent = 'Map unavailable. Reopen Travel Log to retry.';
    return;
  }
  if (host.getBoundingClientRect && !host.getBoundingClientRect().width) return;
  const route = (exp.routeCoords || []).filter(travelLogPoint);
  const stops = (exp.routeStops || []).map(stop => stop?.coords).filter(travelLogPoint);
  const legs = travelLogLegs(exp);
  const displayLegs = legs.filter(leg => Array.isArray(leg.coords) &&
    leg.coords.length > 1 && leg.coords.every(travelLogPoint));
  const hasPolyline = displayLegs.length > 0;
  const points = [...(hasPolyline ? displayLegs.flatMap(leg => leg.coords) : route), ...stops];
  // Without route geometry every logged stop still needs a marker and must be included in the frame.
  if (!points.length) {
    host.textContent = 'No route coordinates recorded.';
    return;
  }
  if (travelLogMaps[exp.id]) {
    travelLogMaps[exp.id].invalidateSize({ animate: false, pan: false });
    if (points.length > 1) travelLogMaps[exp.id].fitBounds(L.latLngBounds(points), { padding: [15, 15], maxZoom: 10, animate: false });
    else travelLogMaps[exp.id].setView(points[0], 8, { animate: false });
    return;
  }
  const miniMap = L.map(`mini-map-${exp.id}`, {
    zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
    doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false
  });
  travelLogMaps[exp.id] = miniMap;
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  }).addTo(miniMap);
  if (hasPolyline) {
    displayLegs.forEach(leg => {
      const approximation = expeditionLegIsApproximation(leg);
      L.polyline(leg.coords, { color: '#020617', weight: 7, opacity: 0.9, interactive: false }).addTo(miniMap);
      L.polyline(leg.coords, {
      color: TRAVEL_ROUTE_COLORS[leg.mode] || '#22d3ee',
      weight: 3, opacity: 1, interactive: false,
      dashArray: approximation ? '8, 8' : null
      }).addTo(miniMap);
    });
    stops.forEach(coords => L.circleMarker(coords,
      { radius: 4, fillColor: '#10b981', color: '#fff', weight: 1, fillOpacity: 1 }).addTo(miniMap));
  } else {
    points.forEach(coords => L.circleMarker(coords,
      { radius: 6, fillColor: '#10b981', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(miniMap));
  }
  if (points.length > 1) miniMap.fitBounds(L.latLngBounds(points), { padding: [15, 15], maxZoom: 10, animate: false });
  else miniMap.setView(points[0], 8);
}

function routeMapCountryCode(feature) {
  return feature?.properties?.name ? InternationalParks.countryCode(feature.properties.name) : null;
}

function routeMapCountryCodesAt(coords, features, cache) {
  const key = `${coords[0]},${coords[1]}`;
  if (cache.has(key)) return cache.get(key);
  const codes = new Set((cachedPoliticalAt(coords[0], coords[1])?.countries || [])
    .map(country => InternationalParks.countryCode(country)).filter(Boolean));
  if (!codes.size) {
    const feature = features.find(candidate => candidate?.geometry &&
      d3.geoContains(candidate, [coords[1], coords[0]]));
    const code = routeMapCountryCode(feature);
    if (code) codes.add(code);
  }
  const result = [...codes];
  cache.set(key, result);
  return result;
}

function routeMapExpeditionPoints(exp) {
  const stops = (exp.routeStops || []).map(stop => stop?.coords).filter(travelLogPoint);
  return stops.length ? stops : (exp.routeCoords || []).filter(travelLogPoint);
}

function renderGlobalRoutesMap() {
  const svg = document.getElementById('svgGlobalRoutesMap');
  const allFeatures = worldGeoJson || [];
  const countryCache = new Map();
  const home = AppState.homeBase && travelLogPoint([AppState.homeBase.lat, AppState.homeBase.lng])
    ? AppState.homeBase : null;
  const homeCodes = home
    ? routeMapCountryCodesAt([home.lat, home.lng], allFeatures, countryCache) : [];
  if (home?.countyId && !homeCodes.includes('US')) homeCodes.push('US');
  const homeCountryCode = homeCodes.find(code =>
    allFeatures.some(feature => routeMapCountryCode(feature) === code)) || null;
  const homeFeature = homeCountryCode
    ? allFeatures.find(feature => routeMapCountryCode(feature) === homeCountryCode) : null;
  const homeCountryName = homeFeature?.properties?.name ||
    (homeCountryCode ? new Intl.DisplayNames(['en'], { type: 'region' }).of(homeCountryCode) : null);
  const homeContinent = homeCountryCode ? ROUTE_MAP_CONTINENT_BY_COUNTRY.get(homeCountryCode) : null;
  const domesticCodes = homeCountryCode ? new Set([homeCountryCode]) : null;
  const continentCodes = homeContinent
    ? new Set(ROUTE_MAP_CONTINENT_COUNTRIES[homeContinent].split(' ')) : null;
  const domesticFeatures = domesticCodes
    ? allFeatures.filter(feature => domesticCodes.has(routeMapCountryCode(feature))) : [];
  const continentFeatures = continentCodes
    ? allFeatures.filter(feature => continentCodes.has(routeMapCountryCode(feature))) : [];

  const scopeControl = document.getElementById('globalRoutesScope');
  const domesticOption = document.getElementById('globalRoutesDomesticOption');
  const continentOption = document.getElementById('globalRoutesContinentOption');
  const yearControl = document.getElementById('globalRoutesYear');
  const atlasStyleControl = document.getElementById('globalRoutesAtlasStyle');
  domesticOption.textContent = homeCountryName ? `Domestic · ${homeCountryName}` :
    AppState.homeBase ? 'Domestic (unavailable)' : 'Domestic (set home base)';
  continentOption.textContent = homeContinent ? `Continental · ${homeContinent}` :
    AppState.homeBase ? 'Continental (unavailable)' : 'Continental (set home base)';
  domesticOption.disabled = !domesticFeatures.length;
  continentOption.disabled = !continentFeatures.length;

  const availableYears = routeMapAvailableYears();
  let yearNotice = '';
  if (globalRoutesYear !== 'all' &&
      (!/^\d{4}$/.test(globalRoutesYear) || !availableYears.includes(Number(globalRoutesYear)))) {
    globalRoutesYear = 'all';
    yearNotice = 'The selected year is no longer available. Showing all years.';
  }
  yearControl.innerHTML = `<option value="all">All years</option>${availableYears
    .map(year => `<option value="${year}">${year}</option>`).join('')}`;
  yearControl.value = globalRoutesYear;
  atlasStyleControl.value = globalRoutesAtlasStyle;
  const yearFilteredExpeditions = globalRoutesYear === 'all'
    ? AppState.expeditions
    : AppState.expeditions.filter(exp => routeMapExpeditionYears(exp).includes(Number(globalRoutesYear)));

  let scope = globalRoutesScope;
  let mapFeatures = allFeatures;
  let scopeCodes = null;
  let scopeLabel = 'Global';
  let scopeNotice = '';
  if (scope === 'domestic') {
    if (!domesticFeatures.length) {
      scope = 'global';
      scopeNotice = 'Domestic view needs a recognized home country and loaded map boundaries.';
    } else {
      mapFeatures = domesticFeatures;
      scopeCodes = domesticCodes;
      scopeLabel = `Domestic · ${homeCountryName}`;
    }
  } else if (scope === 'continental') {
    if (!continentFeatures.length) {
      scope = 'global';
      scopeNotice = homeCountryCode
        ? 'A continental view is not available for this home country.'
        : 'Continental view needs a recognized home country and loaded map boundaries.';
    } else {
      mapFeatures = continentFeatures;
      scopeCodes = continentCodes;
      scopeLabel = `Continental · ${homeContinent}`;
    }
  }
  globalRoutesScope = scope;
  scopeControl.value = scope;

  const expeditionInScope = exp => scopeCodes && routeMapExpeditionPoints(exp).some(coords =>
    routeMapCountryCodesAt(coords, allFeatures, countryCache).some(code => scopeCodes.has(code)));
  const expeditions = scopeCodes
    ? yearFilteredExpeditions.filter(expeditionInScope) : yearFilteredExpeditions;
  globalRoutesVisibleExpeditions = expeditions;
  const yearLabel = globalRoutesYear === 'all' ? 'all years' : globalRoutesYear;
  const notices = [yearNotice, scopeNotice].filter(Boolean).join(' ');
  document.getElementById('globalRoutesScopeStatus').textContent = notices ||
    (scopeCodes
      ? `Showing ${expeditions.length} of ${yearFilteredExpeditions.length} expeditions with a stop in ${scopeLabel} for ${yearLabel}. Cross-region routes may be clipped at the map edge.`
      : homeCountryCode
        ? `Showing ${expeditions.length} expeditions worldwide for ${yearLabel}.`
        : `Showing ${expeditions.length} expeditions worldwide for ${yearLabel}. Set a home base to enable domestic and continental views.`);

  const features = mapFeatures;
  const collection = { type: 'FeatureCollection', features };
  const projection = scope === 'domestic' && homeCountryCode === 'US'
    ? d3.geoAlbersUsa() : d3.geoNaturalEarth1();
  if (features.length) projection.fitExtent([[24, 24], [1176, 560]], collection);
  const path = d3.geoPath(projection);
  const mapStyle = GLOBAL_ROUTE_MAP_STYLES[globalRoutesAtlasStyle];
  const stats = calculateStats();
  const visitedCountries = new Set(stats.visitedCountries);
  const countries = features.filter(feature => feature?.geometry).map(feature => {
    const name = feature.properties?.name || 'Unknown country';
    const fill = visitedCountries.has(name) ? mapStyle.visited : mapStyle.land;
    return `<path class="global-country" fill="${fill}" stroke="${mapStyle.border}" stroke-width="0.8" d="${path(feature) || ''}"><title>${escapeHtml(name)}</title></path>`;
  }).join('');
  const graticule = path(d3.geoGraticule()) || '';
  const routes = [];
  const markers = [];

  expeditions.forEach(exp => {
    const title = `${exp.name || 'Expedition'} · ${travelLogDateRange(exp)}`;
    travelLogLegs(exp).forEach(leg => {
      if (!Array.isArray(leg.coords) || leg.coords.length < 2 || !leg.coords.every(travelLogPoint)) return;
      const segments = leg.mode === 'flight' && leg.routeSource === 'direct'
        ? leg.coords.slice(1).map((point, index) => [leg.coords[index], point])
        : [leg.coords];
      const routePath = segments.map(segment => {
        const isDirect = leg.routeSource === 'direct' && segment.length === 2;
        const coordinates = leg.mode === 'flight' || isDirect
          ? (() => {
          const interpolate = d3.geoInterpolate(
            [segment[0][1], segment[0][0]],
            [segment.at(-1)[1], segment.at(-1)[0]]
          );
          return Array.from({ length: 25 }, (_, index) => interpolate(index / 24));
        })()
          : segment.map(([lat, lng]) => [lng, lat]);
        return path({ type: 'LineString', coordinates }) || '';
      }).join('');
      if (!routePath) return;
      const color = mapStyle.routes[leg.mode] || '#94a3b8';
      routes.push(`<path class="global-route" data-mode="${escapeHtml(leg.mode)}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"${leg.mode === 'flight' ? ' stroke-dasharray="6 5"' : ''} d="${routePath}"><title>${escapeHtml(title)}</title></path>`);
    });
    (exp.routeStops || []).forEach(stop => {
      if (!travelLogPoint(stop?.coords)) return;
      if (scopeCodes &&
          !routeMapCountryCodesAt(stop.coords, allFeatures, countryCache).some(code => scopeCodes.has(code))) return;
      const projected = projection([stop.coords[1], stop.coords[0]]);
      if (!projected) return;
      const [cx, cy] = projected;
      markers.push(`<circle class="global-route-stop" cx="${cx}" cy="${cy}" r="2.5" fill="#e2e8f0" stroke="#020617" stroke-width="1"><title>${escapeHtml(`${exp.name || 'Expedition'} · ${stop.name || 'Stop'}`)}</title></circle>`);
    });
  });

  const homePosition = AppState.homeBase && travelLogPoint([AppState.homeBase.lat, AppState.homeBase.lng])
    ? projection([AppState.homeBase.lng, AppState.homeBase.lat]) : null;
  const homeMarker = homePosition
    ? `<g class="global-route-home"><title>${escapeHtml(`Home Base · ${AppState.homeBase.name}`)}</title><circle cx="${homePosition[0]}" cy="${homePosition[1]}" r="11" fill="#f59e0b" fill-opacity="0.2" stroke="#fbbf24" stroke-width="1.5"></circle><text x="${homePosition[0]}" y="${homePosition[1] + 6}" text-anchor="middle" font-size="17" fill="#fbbf24">★</text></g>`
    : '';

  svg.innerHTML = `<rect class="global-routes-ocean" width="1200" height="630" fill="${mapStyle.ocean}"></rect><g class="global-routes-zoom"><path class="global-routes-graticule" fill="none" stroke="${mapStyle.graticule}" stroke-width="0.6" d="${graticule}"></path>${countries}${routes.join('')}${markers.join('')}${homeMarker}</g>`;
  svg.setAttribute('aria-label', `${scopeLabel} route map showing ${expeditions.length} expeditions`);
  svg.setAttribute('data-atlas-style', globalRoutesAtlasStyle);
  globalRoutesZoomBehavior = d3.zoom().scaleExtent([1, 14]).on('zoom', event => {
    d3.select(svg).select('.global-routes-zoom').attr('transform', event.transform);
  });
  d3.select(svg).call(globalRoutesZoomBehavior);
  d3.select(svg).select('.global-routes-zoom').attr('transform', d3.zoomTransform(svg));
}

function setGlobalRoutesView(open) {
  globalRoutesOpen = open;
  document.getElementById('travelGlobalRoutesPanel').classList.toggle('hidden', !open);
  document.getElementById('travelLogFeed').classList.toggle('hidden', open);
  document.getElementById('btnExportRoutesPng').classList.toggle('hidden', !open);
  const toggle = document.getElementById('btnToggleTravelRoutes');
  toggle.textContent = open ? '📖 Travel Log' : '🗺️ Route Map';
  toggle.setAttribute('aria-label', open ? 'Return to Travel Log' : 'Show Route Map');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-pressed', String(open));
  if (open) renderGlobalRoutesMap();
}

function resetGlobalRoutesZoom() {
  if (!globalRoutesZoomBehavior) return;
  d3.select(document.getElementById('svgGlobalRoutesMap'))
    .call(globalRoutesZoomBehavior.transform, d3.zoomIdentity);
}

function appendSvgElement(parent, name, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  parent.appendChild(element);
  return element;
}

function prepareGlobalRoutesExportSvg(svg) {
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', '0 0 1200 750');
  svg.setAttribute('width', '2400');
  svg.setAttribute('height', '1500');
  svg.querySelector('.global-routes-ocean')?.setAttribute('height', '750');
  svg.querySelector('.global-routes-zoom')?.setAttribute('transform', 'translate(0,120) scale(1)');
}

function appendGlobalRoutesExportYearTitle(svg, mapStyle) {
  const group = appendSvgElement(svg, 'g', { class: 'global-routes-export-year' });
  appendSvgElement(group, 'rect', {
    x: 360, y: 10, width: 480, height: 100, rx: 14,
    fill: mapStyle.land, 'fill-opacity': 0.94, stroke: mapStyle.border, 'stroke-width': 2
  });
  const title = appendSvgElement(group, 'text', {
    x: 600, y: 80, fill: mapStyle.text, 'font-family': 'Inter, Arial, sans-serif',
    'font-size': globalRoutesYear === 'all' ? 58 : 78, 'font-weight': 700, 'text-anchor': 'middle'
  });
  title.textContent = globalRoutesExportYearLabel();
  return title;
}

function canvasPngBlob(canvas) {
  const fallback = () => {
    const dataUrl = canvas.toDataURL('image/png');
    const encoded = dataUrl.split(',')[1];
    if (!encoded) throw new Error('The route map image could not be encoded as PNG.');
    return new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: 'image/png' });
  };
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      try { resolve(fallback()); } catch (error) { reject(error); }
      return;
    }
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
        return;
      }
      try { resolve(fallback()); } catch (error) { reject(error); }
    }, 'image/png');
  });
}

async function exportGlobalRoutesPng() {
  renderGlobalRoutesMap();
  const svg = document.getElementById('svgGlobalRoutesMap').cloneNode(true);
  prepareGlobalRoutesExportSvg(svg);

  const mapStyle = GLOBAL_ROUTE_MAP_STYLES[globalRoutesAtlasStyle];
  const stats = calculateStats();
  appendGlobalRoutesExportYearTitle(svg, mapStyle);
  const footer = appendSvgElement(svg, 'g', { class: 'global-routes-export-footer' });
  appendSvgElement(footer, 'rect', { x: 0, y: 690, width: 1200, height: 60, fill: mapStyle.land });
  const banner = appendSvgElement(footer, 'text', {
    x: 32, y: 728, fill: mapStyle.text, 'font-family': 'Inter, Arial, sans-serif',
    'font-size': 20, 'font-weight': 600
  });
  banner.textContent = `${stats.cls} (Level ${stats.level}) • ${globalRoutesVisibleExpeditions.length} Expeditions • ${stats.countriesCount} Countries`;
  const watermark = appendSvgElement(footer, 'text', {
    x: 1168, y: 728, fill: mapStyle.text, 'fill-opacity': 0.7,
    'font-family': 'Cinzel, Georgia, serif', 'font-size': 14, 'font-weight': 600, 'text-anchor': 'end'
  });
  watermark.textContent = 'Cartovella';

  const svgBlob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);
  let png;
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The route map could not be rendered for export.'));
      image.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1260;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    png = await canvasPngBlob(canvas);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }

  const objectUrl = URL.createObjectURL(png);
  const download = document.createElement('a');
  download.href = objectUrl;
  download.download = `cartovella_routes_${localExportTimestamp()}.png`;
  document.body.appendChild(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function renderExpeditionHistory() {
  const container = document.getElementById('travelLogFeed');
  // Leaflet instances must be torn down before their containers are discarded.
  destroyTravelLogMaps();
  if (!AppState.expeditions.length) {
    container.innerHTML = '<p class="text-sm text-slate-400">No expeditions yet. Log your first trip.</p>';
    if (globalRoutesOpen) renderGlobalRoutesMap();
    return;
  }
  const biomesByExpedition = calculateStats().metadataProgress.biomesByExpedition;
  const sorted = [...AppState.expeditions].sort((a, b) =>
    (b.startDate || b.endDate || '').localeCompare(a.startDate || a.endDate || ''));
  for (const id of confirmingTravelLogDeletion) {
    if (!sorted.some(exp => exp.id === id)) confirmingTravelLogDeletion.delete(id);
  }
  for (const id of travelJournalDrafts.keys()) {
    if (!sorted.some(exp => exp.id === id)) travelJournalDrafts.delete(id);
  }
  let period = null;
  container.innerHTML = sorted.map(exp => {
    const sharing = TravelLedger.normalizePublicSharing(exp.publicSharing, exp.photos?.length || 0);
    const names = travelLogStopNames(exp);
    const regions = travelLogRegions(exp);
    const badges = travelLogBadges(exp);
    const metrics = travelLogMetrics(exp);
    const flags = travelLogCountryFlags(exp);
    const stateFlags = travelLogStateFlags(exp);
    const biomeMarkup = (biomesByExpedition[exp.id] || [])
      .filter(id => BIOMES[id])
      .map(id => {
        const biome = BIOMES[id];
        return `<button type="button" data-atlas-pin-kind="biome" data-atlas-pin-id="${escapeHtml(id)}" aria-label="View trips and locations for ${escapeHtml(biome.name)}" class="px-2 py-0.5 rounded-full text-[11px] border border-emerald-500/30 bg-emerald-950/40 text-emerald-200 hover:border-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400" title="${escapeHtml(biome.name)}">${escapeHtml(biome.icon)} ${escapeHtml(biome.name)}</button>`;
      }).join('');
    const badgeMarkup = badges.map(badge => badge.kind
      ? `<button type="button" data-atlas-pin-kind="${badge.kind}" data-atlas-pin-id="${escapeHtml(badge.id)}" aria-label="View trips and locations for ${escapeHtml(badge.label)}" class="px-2 py-0.5 rounded-full text-[11px] border ${badge.tone} hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">${badge.icon} ${escapeHtml(badge.label)}</button>`
      : `<span class="px-2 py-0.5 rounded-full text-[11px] border ${badge.tone}">${badge.icon} ${escapeHtml(badge.label)}</span>`);
    let divider = '';
    const current = travelLogPeriod(exp);
    if (current !== period) {
      period = current;
      divider = `<div class="flex items-center gap-3 pt-2"><span class="text-xs font-mono text-amber-400">${escapeHtml(current)}</span><div class="flex-1 h-px bg-slate-800"></div></div>`;
    }
    return `${divider}<details class="travel-journal-card rpg-panel rounded-2xl" data-trip="${escapeHtml(exp.id)}"${openTravelLogs.has(exp.id) ? ' open' : ''}>
      <summary class="travel-journal-summary${exp.photos?.length ? ' has-highlight' : ''}">
        <div id="mini-map-${escapeHtml(exp.id)}" class="travel-journal-map" aria-label="Route for ${escapeHtml(exp.name)}"></div>
        <div class="travel-journal-overview">
          <h4 class="font-bold text-amber-200 text-base">${escapeHtml(exp.name)}</h4>
          <p class="text-xs text-slate-400 font-mono">${escapeHtml(travelLogDateRange(exp))}${exp.dayTrip ? ' · Day trip' : ''}</p>
          <div class="travel-journal-metrics"><span><small>Total mileage</small>${metrics.mileage}</span><span><small>Elevation range</small>${metrics.elevation}</span></div>
          ${metrics.changes ? `<p class="text-xs text-slate-400">${metrics.changes}</p>` : ''}
          <div class="flex flex-wrap gap-1.5">${badgeMarkup.slice(0, 4).join('')}${badges.length > 4 ? `<span class="text-xs text-slate-400">+${badges.length - 4}</span>` : ''}</div>
          ${biomeMarkup ? `<div class="flex flex-wrap items-center gap-1.5" data-trip-biomes aria-label="Biomes recorded on this trip"><span class="text-[11px] text-emerald-300">Biomes</span>${biomeMarkup}</div>` : ''}
          ${flags.length ? `<ul class="passport-flags" data-trip-flags aria-label="Countries traversed outside your home country">${countryFlagMarkup(flags)}</ul>` : ''}
          ${stateFlags.length ? `<ul class="passport-flags" data-trip-state-flags aria-label="US states visited or traversed on this trip">${stateFlagMarkup(stateFlags)}</ul>` : ''}
          <span class="travel-journal-toggle text-xs text-sky-300">Open journal <span aria-hidden="true">⌄</span></span>
          <span class="travel-journal-collapse-hint text-xs text-sky-300">Collapse journal <span aria-hidden="true">⌃</span></span>
        </div>
        ${exp.photos?.length ? `<img class="travel-journal-highlight" src="${exp.photos[0]}" alt="Highlight from ${escapeHtml(exp.name)}" loading="lazy">` : ''}
      </summary>
      <div class="travel-journal-body" data-journal-body="${escapeHtml(exp.id)}"></div>
      <div class="travel-journal-details">
        <details><summary class="text-xs text-slate-400">Itinerary &amp; trip details</summary>
          ${regions ? `<p class="text-xs text-slate-300">${escapeHtml(regions)}</p>` : ''}
          <ol class="travel-journal-itinerary">${names.map((name, index) => {
            const stop = exp.routeStops?.[index];
            const catalogRarity = stop?.kind === 'park' ? window.catalogParkRarityFor?.(stop.id) : null;
            return `<li>${escapeHtml(name)}${rarityBadgeMarkup(stop?.rarityTier || stop?.rarity?.rarityTier || catalogRarity?.rarityTier)}${exp.routeLegs?.[index] ? `<small>${escapeHtml(TravelLedger.transitTags[exp.routeLegs[index].mode])}</small>` : ''}</li>`;
          }).join('')}</ol>
          <div class="flex flex-wrap gap-1.5">${badgeMarkup.join('')}</div>
          ${exp.reason ? `<p class="text-xs text-slate-400">${escapeHtml(exp.reason)}</p>` : ''}
        </details>
        ${AppState.viewOnly ? '' : `<fieldset class="mt-3 space-y-2 rounded-xl border border-sky-400/20 bg-slate-950/40 p-3" aria-label="Public sharing choices for ${escapeHtml(exp.name)}">
          <label class="flex items-start gap-2 text-xs text-slate-200">
            <input type="checkbox" data-sharing-trip="${escapeHtml(exp.id)}" data-sharing-field="enabled" class="mt-0.5 accent-sky-400"${sharing.enabled ? ' checked' : ''}>
            <span><b>Share this trip publicly</b><span class="mt-1 block text-slate-400">Trips start private. Shared content appears in the Explorers' Guild and public Atlas only when your profile is public.</span></span>
          </label>
          <label class="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" data-sharing-trip="${escapeHtml(exp.id)}" data-sharing-field="includeDetails" class="accent-sky-400"${sharing.includeDetails ? ' checked' : ''}${sharing.enabled ? '' : ' disabled'}>
            <span>Include trip details, stops, dates, and route</span>
          </label>
          <label class="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" data-sharing-trip="${escapeHtml(exp.id)}" data-sharing-field="includeJournal" class="accent-sky-400"${sharing.includeJournal ? ' checked' : ''}${sharing.enabled ? '' : ' disabled'}>
            <span>Include journal</span>
          </label>
          ${exp.photos?.length ? `<div class="flex flex-wrap gap-2">${exp.photos.map((photo, index) => `<label class="flex items-center gap-1.5 rounded-lg border border-slate-700 p-1.5 text-[11px] text-slate-300">
            <input type="checkbox" data-sharing-trip="${escapeHtml(exp.id)}" data-sharing-field="photo" data-sharing-photo="${index}" class="accent-sky-400"${sharing.photoIndexes.includes(index) ? ' checked' : ''}${sharing.enabled ? '' : ' disabled'}>
            <img src="${photo}" alt="" class="h-10 w-10 rounded object-cover" loading="lazy">Photo ${index + 1}
          </label>`).join('')}</div>` : '<p class="text-[11px] text-slate-400">No photos on this trip.</p>'}
        </fieldset>`}
        <div class="flex flex-wrap items-center gap-2">
          ${AppState.viewOnly ? '' : `<button type="button" data-edit-expedition="${escapeHtml(exp.id)}" class="rounded-lg bg-slate-800 px-3 py-2 text-xs text-amber-200">Edit trip &amp; route</button>`}
          ${AppState.viewOnly ? '' : confirmingTravelLogDeletion.has(exp.id)
            ? `<span class="text-xs text-rose-200">Delete this travel log? This cannot be undone.</span>
              <button type="button" data-confirm-delete-expedition="${escapeHtml(exp.id)}" aria-label="Confirm deletion of ${escapeHtml(exp.name)}" class="rounded-lg bg-rose-800 px-3 py-2 text-xs font-semibold text-white">Confirm delete</button>
              <button type="button" data-cancel-delete-expedition="${escapeHtml(exp.id)}" class="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200">Cancel</button>`
            : `<button type="button" data-delete-expedition="${escapeHtml(exp.id)}" aria-label="Delete ${escapeHtml(exp.name)}" class="rounded-lg bg-slate-800 px-3 py-2 text-xs text-rose-300">Delete trip</button>`}
          <button type="button" data-collapse-journal class="rounded-lg bg-slate-800 px-3 py-2 text-xs text-sky-300">Collapse journal ↑</button>
        </div>
      </div>
    </details>`;
  }).join('');
  container.querySelectorAll('[data-edit-expedition]').forEach(button => {
    button.addEventListener('click', () => openExpedition(button.dataset.editExpedition));
  });
  container.querySelectorAll('[data-sharing-trip]').forEach(input => {
    input.addEventListener('change', () => {
      if (AppState.viewOnly) return;
      const { sharingTrip: id, sharingField: field, sharingPhoto } = input.dataset;
      const current = AppState.expeditions.find(exp => exp.id === id);
      if (!current) return;
      try {
        const sharing = TravelLedger.normalizePublicSharing(current.publicSharing, current.photos?.length || 0);
        if (field === 'photo') {
          const index = Number(sharingPhoto);
          sharing.photoIndexes = input.checked
            ? [...sharing.photoIndexes, index].sort((a, b) => a - b)
            : sharing.photoIndexes.filter(photoIndex => photoIndex !== index);
        } else sharing[field] = input.checked;
        updateExpedition({ ...current, publicSharing: sharing });
        renderExpeditionHistory();
        Array.from(container.querySelectorAll('[data-sharing-trip]'))
          .find(control => control.dataset.sharingTrip === id &&
            control.dataset.sharingField === field && control.dataset.sharingPhoto === sharingPhoto)?.focus();
      } catch (error) {
        showNotification('Sharing settings not saved', error.message, '⚠️');
        renderExpeditionHistory();
      }
    });
  });
  container.querySelectorAll('[data-delete-expedition]').forEach(button => {
    button.addEventListener('click', () => {
      if (AppState.viewOnly) return;
      const id = button.dataset.deleteExpedition;
      confirmingTravelLogDeletion.add(id);
      renderExpeditionHistory();
      Array.from(container.querySelectorAll('[data-confirm-delete-expedition]'))
        .find(action => action.dataset.confirmDeleteExpedition === id)?.focus();
    });
  });
  container.querySelectorAll('[data-cancel-delete-expedition]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.cancelDeleteExpedition;
      confirmingTravelLogDeletion.delete(id);
      renderExpeditionHistory();
      Array.from(container.querySelectorAll('[data-delete-expedition]'))
        .find(action => action.dataset.deleteExpedition === id)?.focus();
    });
  });
  container.querySelectorAll('[data-confirm-delete-expedition]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.confirmDeleteExpedition;
      const expedition = AppState.expeditions.find(exp => exp.id === id);
      if (!expedition) {
        confirmingTravelLogDeletion.delete(id);
        refreshTravelUI();
        return;
      }
      try {
        const deleted = deleteExpeditionRecord(id);
        confirmingTravelLogDeletion.delete(id);
        openTravelLogs.delete(id);
        travelJournalDrafts.delete(id);
        refreshTravelUI();
        showNotification('Travel log deleted', `${deleted.name} was deleted.`, '🗑️');
      } catch (error) {
        console.error('Travel log deletion failed', error);
        confirmingTravelLogDeletion.delete(id);
        refreshTravelUI();
        showNotification('Travel log not deleted', error.message, '⚠️');
      }
    });
  });
  container.querySelectorAll('[data-trip-flags]').forEach(wireCountryFlagFallbacks);
  container.querySelectorAll('[data-trip-state-flags]').forEach(wireStateFlagInteractions);
  container.querySelectorAll('[data-trip]').forEach(card => {
    const exp = sorted.find(item => item.id === card.dataset.trip);
    const reveal = () => {
      if (card.open) {
        openTravelLogs.add(exp.id);
        renderTravelJournal(exp);
      } else openTravelLogs.delete(exp.id);
    };
    card.addEventListener('toggle', reveal);
    card.querySelector('[data-collapse-journal]').addEventListener('click', () => collapseTravelJournal(card));
    if (card.open) reveal();
  });
  if (typeof ResizeObserver !== 'undefined') {
    travelLogResizeObserver = new ResizeObserver(entries => {
      entries.forEach(entry => {
        const exp = sorted.find(item => `mini-map-${item.id}` === entry.target.id);
        if (exp && entry.contentRect.width && entry.contentRect.height) {
          try { renderTravelLogMiniMap(exp); }
          catch (error) { showTravelLogMapError(exp, error); }
        }
      });
    });
    sorted.forEach(exp => travelLogResizeObserver.observe(document.getElementById(`mini-map-${exp.id}`)));
  }
  sorted.forEach(exp => {
    try { renderTravelLogMiniMap(exp); }
    catch (error) { showTravelLogMapError(exp, error); }
  });
  if (globalRoutesOpen) renderGlobalRoutesMap();
}

function collapseTravelJournal(card) {
  card.open = false;
  openTravelLogs.delete(card.dataset.trip);
  card.querySelector('summary').focus({ preventScroll: true });
  card.scrollIntoView({ block: 'nearest' });
}

function showTravelLogMapError(exp, error) {
  console.error('Mini-map render failed', exp.id, error);
  document.getElementById(`mini-map-${exp.id}`).textContent = 'Map unavailable. Reopen Travel Log to retry.';
}

function travelJournalDraft(exp) {
  let draft = travelJournalDrafts.get(exp.id);
  const matches = draft && draft.source.journal === exp.journal &&
    (draft.source.photos || []).length === (exp.photos || []).length &&
    (draft.source.photos || []).every((photo, index) => photo === exp.photos[index]);
  if (!matches) {
    draft = {
      source: exp, journal: exp.journal || '', photos: [...(exp.photos || [])],
      photoOrigins: (exp.photos || []).map((_, index) => index), busy: false
    };
    travelJournalDrafts.set(exp.id, draft);
  } else draft.source = exp;
  return draft;
}

function travelJournalPhotos(photos, editable) {
  return photos.map((photo, index) => `<figure class="travel-journal-photo">
    <button type="button" data-view-photo="${index}" aria-label="Enlarge trip photo ${index + 1}"><img src="${photo}" alt="Trip photo ${index + 1}" loading="lazy"></button>
    <figcaption>${index === 0 ? 'Highlight' : `Memory ${index + 1}`}${editable ? `<button type="button" data-remove-photo="${index}" aria-label="Remove trip photo ${index + 1}">Remove</button>` : ''}</figcaption>
  </figure>`).join('');
}

function journalMarkup(text) {
  const blocks = [];
  let bullets = [];
  const flush = () => {
    if (bullets.length) blocks.push(`<ul>${bullets.join('')}</ul>`);
    bullets = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const bullet = /^\s*[-*] (.*)$/.exec(line);
    if (bullet) {
      bullets.push(`<li>${escapeHtml(bullet[1])}</li>`);
      continue;
    }
    flush();
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length + 2;
      blocks.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
    } else if (line.trim()) blocks.push(`<p>${escapeHtml(line)}</p>`);
    else blocks.push('<br>');
  }
  flush();
  return blocks.join('');
}

function journalFormatLines(text, start, end, format) {
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const next = text.indexOf('\n', last);
  const to = next < 0 ? text.length : next;
  const prefix = format === 'heading' ? '# ' : '- ';
  const lines = text.slice(from, to).split('\n');
  const remove = lines.every(line => line.startsWith(prefix));
  const replacement = lines.map(line => remove ? line.slice(prefix.length) :
    prefix + line.replace(/^(?:#{1,3}|[-*]) /, '')).join('\n');
  return { value: text.slice(0, from) + replacement + text.slice(to), start: from, end: from + replacement.length };
}

function renderTravelJournal(exp) {
  const body = document.querySelector(`[data-journal-body="${exp.id}"]`);
  if (!body || body.dataset.rendered === 'true') return;
  body.dataset.rendered = 'true';
  const draft = travelJournalDraft(exp);
  body.innerHTML = `<h5 class="cinzel text-amber-200">Journal</h5>
    ${AppState.viewOnly ? `<div class="travel-journal-prose">${journalMarkup(exp.journal || 'No journal entry yet.')}</div>
      <div class="travel-journal-photos">${travelJournalPhotos(exp.photos || [], false)}</div>` :
      `<form class="travel-journal-form">
        <label class="block text-xs" for="journal-${exp.id}">The story of your trip</label>
        <div class="travel-journal-toolbar" role="group" aria-label="Journal formatting">
          <button type="button" data-journal-format="heading">Heading</button>
          <button type="button" data-journal-format="bullets">Bullet list</button>
        </div>
        <textarea id="journal-${exp.id}" name="journal" maxlength="${TravelLedger.journalLimits.text}" rows="6" placeholder="Favorite moments, unexpected detours, places to return to…">${escapeHtml(draft.journal)}</textarea>
        <p class="text-xs text-slate-400">Select lines or place your cursor, then choose a format. You can also type # Heading or - Bullet.</p>
        <details><summary class="text-xs text-sky-300">Formatted preview</summary>
          <div class="travel-journal-prose" data-journal-preview>${journalMarkup(draft.journal)}</div>
        </details>
        <div class="travel-journal-photos">${travelJournalPhotos(draft.photos, true)}</div>
        <label class="travel-journal-upload">Add photos
          <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple>
        </label>
        <p class="text-xs text-slate-400">Up to four photos, compressed on this device. First photo is the highlight. Save to include your journal and photos in Passport backups.</p>
        <button type="submit" class="rounded-lg bg-sky-700 px-3 py-2 text-xs">Save journal</button>
        <p class="text-xs text-slate-400" role="status" aria-live="polite"></p>
      </form>`}`;
  body.querySelector('.travel-journal-photos').addEventListener('click', event => {
    const button = event.target.closest('[data-view-photo]');
    if (!button) return;
    const photos = AppState.viewOnly ? exp.photos || [] : draft.photos;
    const dialog = document.createElement('dialog');
    dialog.className = 'travel-journal-photo-dialog';
    dialog.setAttribute('aria-label', 'Trip photo viewer');
    dialog.innerHTML = `<button type="button" aria-label="Close photo">Close photo</button><img src="${photos[Number(button.dataset.viewPhoto)]}" alt="Trip memory">`;
    document.body.appendChild(dialog);
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  });
  if (AppState.viewOnly) return;
  const form = body.querySelector('form');
  const status = form.querySelector('[role="status"]');
  const gallery = form.querySelector('.travel-journal-photos');
  const fileInput = form.elements.photos;
  const save = form.querySelector('[type="submit"]');
  fileInput.disabled = draft.busy;
  save.disabled = draft.busy;
  if (draft.busy) status.textContent = 'Preparing photos on this device…';
  else if (draft.journal !== (exp.journal || '') || draft.photos.length !== (exp.photos || []).length ||
      draft.photos.some((photo, index) => photo !== exp.photos[index])) status.textContent = 'Unsaved changes';
  const updateGallery = () => { gallery.innerHTML = travelJournalPhotos(draft.photos, true); };
  form.elements.journal.addEventListener('input', () => {
    draft.journal = form.elements.journal.value;
    form.querySelector('[data-journal-preview]').innerHTML = journalMarkup(draft.journal);
    status.textContent = 'Unsaved changes';
  });
  form.querySelectorAll('[data-journal-format]').forEach(button => {
    button.addEventListener('click', () => {
      const input = form.elements.journal;
      const result = journalFormatLines(input.value, input.selectionStart, input.selectionEnd, button.dataset.journalFormat);
      if (result.value.length > TravelLedger.journalLimits.text) {
        status.textContent = 'This formatting would exceed the journal character limit.';
        return;
      }
      input.value = result.value;
      input.focus();
      input.setSelectionRange(result.start, result.end);
      draft.journal = result.value;
      form.querySelector('[data-journal-preview]').innerHTML = journalMarkup(draft.journal);
      status.textContent = 'Unsaved changes';
    });
  });
  gallery.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-photo]');
    if (!button || draft.busy) return;
    const index = Number(button.dataset.removePhoto);
    draft.photos.splice(index, 1);
    draft.photoOrigins.splice(index, 1);
    updateGallery();
    status.textContent = 'Photo removed from draft. Save journal to keep this change.';
  });
  fileInput.addEventListener('change', async () => {
    if (AppState.viewOnly || draft.busy) return;
    draft.busy = true;
    fileInput.disabled = true;
    save.disabled = true;
    status.textContent = 'Preparing photos on this device…';
    try {
      const files = [...fileInput.files];
      if (files.length + draft.photos.length > TravelLedger.journalLimits.photos) throw new Error('Choose up to four photos per trip.');
      const additions = [];
      for (const file of files) additions.push(await compressJournalPhoto(file));
      draft.photos.push(...additions);
      updateGallery();
      status.textContent = 'Photos ready. Save journal to keep them.';
    } catch (error) {
      console.error('Journal photo attachment failed', error);
      status.textContent = error.message;
    } finally {
      draft.busy = false;
      fileInput.disabled = false;
      save.disabled = false;
      fileInput.value = '';
      const active = document.querySelector(`[data-journal-body="${exp.id}"]`);
      if (active && active !== body) {
        active.dataset.rendered = '';
        const current = AppState.expeditions.find(item => item.id === exp.id);
        if (current) renderTravelJournal(current);
      }
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (AppState.viewOnly || draft.busy) return;
    try {
      const current = AppState.expeditions.find(item => item.id === exp.id);
      if (!current) throw new Error('This trip no longer exists.');
      draft.journal = form.elements.journal.value;
      const sharing = TravelLedger.normalizePublicSharing(current.publicSharing, current.photos?.length || 0);
      sharing.photoIndexes = sharing.photoIndexes.flatMap(index => {
        const newIndex = draft.photoOrigins.indexOf(index);
        return newIndex < 0 ? [] : [newIndex];
      });
      updateExpedition({
        ...current, ...TravelLedger.validateJournal(draft.journal, draft.photos),
        publicSharing: sharing
      });
      travelJournalDrafts.delete(exp.id);
      renderExpeditionHistory();
      showNotification('Journal saved', 'Your memories and photos are included in Passport backups.', '📖');
    } catch (error) {
      console.error('Journal save failed', error);
      status.textContent = `Not saved: ${error.message} Your journal draft is still here; remove a photo or export a backup before retrying.`;
    }
  });
}

async function compressJournalPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15_000_000) {
    throw new Error('Choose a JPEG, PNG, or WebP photo smaller than 15 MB.');
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('This photo could not be read. Try exporting it as JPEG.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Photo compression is unavailable in this browser.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5, 0.35]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= TravelLedger.journalLimits.photoCharacters) {
        TravelLedger.validateJournal('', [data]);
        return data;
      }
    }
    throw new Error('This photo is still too large after compression. Try a smaller or cropped image.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function searchHometown() {
  if (AppState.viewOnly) return;
  const version = ++homeSearchVersion;
  const status = document.getElementById('homeLookupStatus');
  const results = document.getElementById('citySearchResults');
  const query = document.getElementById('cityInput').value.trim();
  results.replaceChildren();
  try {
    if (!query) return;
    status.textContent = 'Searching cities...';
    const places = await lookupPhotonPlaces(query);
    if (version !== homeSearchVersion || AppState.viewOnly) return;
    if (!places.length) {
      status.textContent = 'No city found. Try including the state or country.';
      return;
    }
    places.forEach(place => {
      const button = suggestionButton(place, () => {
        if (AppState.viewOnly) return;
        dismissPlaceSuggestions(true, true);
        try { setHometownCoordinates(place.name, ...place.coords); }
        catch (error) { console.error('Home save failed', error); status.textContent = `Home not saved: ${error.message}`; }
      });
      results.appendChild(button);
    });
    status.textContent = 'Choose your city. © OpenStreetMap contributors (ODbL).';
  } catch (error) {
    console.error('Home search failed', error);
    if (version === homeSearchVersion) status.textContent = error.message;
  }
}

document.getElementById('btnExpedition').addEventListener('click', () => openExpedition());
document.getElementById('btnHistoryExpedition').addEventListener('click', () => openExpedition());
document.getElementById('btnToggleTravelRoutes').addEventListener('click', () =>
  setGlobalRoutesView(!globalRoutesOpen));
document.getElementById('btnReturnToTravelLog').addEventListener('click', () =>
  setGlobalRoutesView(false));
document.getElementById('globalRoutesScope').addEventListener('change', event => {
  const scope = event.currentTarget.value;
  if (!['global', 'domestic', 'continental'].includes(scope)) {
    event.currentTarget.value = globalRoutesScope;
    document.getElementById('globalRoutesScopeStatus').textContent = 'Choose a valid route map area.';
    return;
  }
  globalRoutesScope = scope;
  renderGlobalRoutesMap();
  resetGlobalRoutesZoom();
});
document.getElementById('globalRoutesYear').addEventListener('change', event => {
  const year = event.currentTarget.value;
  if (year !== 'all' &&
      (!/^\d{4}$/.test(year) || !routeMapAvailableYears().includes(Number(year)))) {
    event.currentTarget.value = globalRoutesYear;
    document.getElementById('globalRoutesScopeStatus').textContent =
      'Choose a year with at least one dated expedition.';
    return;
  }
  globalRoutesYear = year;
  renderGlobalRoutesMap();
  resetGlobalRoutesZoom();
});
document.getElementById('globalRoutesAtlasStyle').addEventListener('change', event => {
  const style = event.currentTarget.value;
  if (!Object.prototype.hasOwnProperty.call(GLOBAL_ROUTE_MAP_STYLES, style)) {
    event.currentTarget.value = globalRoutesAtlasStyle;
    document.getElementById('globalRoutesScopeStatus').textContent = 'Choose a valid atlas style.';
    return;
  }
  globalRoutesAtlasStyle = style;
  renderGlobalRoutesMap();
});
document.getElementById('btnResetGlobalRoutesZoom').addEventListener('click', resetGlobalRoutesZoom);
document.getElementById('btnExportRoutesPng').addEventListener('click', () => {
  exportGlobalRoutesPng().catch(error => {
    console.error('Global route map export failed', error);
    window.alert(`Could not export the route map: ${error.message}`);
  });
});
document.getElementById('btnExpeditionHistory').addEventListener('click', () => {
  if (expeditionPending) return;
  closeExpedition();
  switchTab('travel');
  document.getElementById('travelLogFeed').scrollIntoView({ block: 'start' });
});
document.getElementById('btnCancelExpedition').addEventListener('click', closeExpedition);
document.getElementById('btnRestoreExpeditionDraft').addEventListener('click', restoreSavedExpeditionDraft);
document.getElementById('btnRestoreDraftFromTravel').addEventListener('click', restoreSavedExpeditionDraft);
document.getElementById('btnDownloadExpeditionRecovery').addEventListener('click', downloadExpeditionRecovery);
document.getElementById('expeditionSearch').addEventListener('input', renderExpeditionSearch);
document.getElementById('btnAddExpeditionCoordinate').addEventListener('click', addCustomCoordinateStop);
document.getElementById('expeditionForm').addEventListener('submit', saveExpedition);
document.getElementById('btnPreviewExpedition').addEventListener('click', previewExpeditionRoutes);
document.getElementById('btnImportExpeditionRoute').addEventListener('click', () =>
  document.getElementById('expeditionFileInput').click());
document.getElementById('expeditionFileInput').addEventListener('change', importExpeditionRoute);
document.getElementById('btnClearExpeditionRoute').addEventListener('click', clearExpeditionRoute);
document.getElementById('expeditionDayTrip').addEventListener('change', syncExpeditionDayTrip);
document.getElementById('expeditionStart').addEventListener('change', syncExpeditionDayTrip);
for (const id of ['expeditionName', 'expeditionReason', 'expeditionEnd']) {
  document.getElementById(id).addEventListener('input', scheduleExpeditionDraftRecovery);
  document.getElementById(id).addEventListener('change', scheduleExpeditionDraftRecovery);
}
for (const id of ['expeditionStart', 'expeditionDayTrip']) {
  document.getElementById(id).addEventListener('input', scheduleExpeditionDraftRecovery);
}
document.getElementById('expeditionSearch').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    dismissPlaceSuggestions(false);
    document.getElementById('expeditionSearch').blur();
  }
});
document.getElementById('cityInput').addEventListener('input', () => {
  dismissPlaceSuggestions(true);
  if (document.getElementById('cityInput').value.trim() && !AppState.viewOnly) {
    homeSearchTimer = setTimeout(searchHometown, 300);
  }
});
document.getElementById('cityInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    dismissPlaceSuggestions(true);
    document.getElementById('cityInput').blur();
  }
});
document.getElementById('expeditionModal').addEventListener('keydown', event => {
  if (event.key === 'Escape') closeExpedition();
  if (event.key === 'Tab') {
    const controls = [...document.getElementById('expeditionForm').querySelectorAll('input, button, select, textarea, summary, a[href]')].filter(control => !control.disabled);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
window.addEventListener('DOMContentLoaded', () => {
  readExpeditionDraftRecovery().then(setExpeditionRecoveryAvailable).catch(error => {
    if (typeof indexedDB !== 'undefined') {
      console.error('Expedition draft recovery could not be loaded', error);
      document.getElementById('expeditionRecoveryStatus').textContent =
        `Saved-trip recovery could not be checked: ${error.message}`;
    }
  });
});
