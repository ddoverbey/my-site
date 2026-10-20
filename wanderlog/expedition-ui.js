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
const EXPEDITION_DRAFT_DB = 'wanderlog-local-recovery';
let expeditionDraftDbPromise = null;
let savedExpeditionDraft = null;
let expeditionDraftSaveTimer = null;

function expeditionDraftDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser does not support IndexedDB.'));
  if (!expeditionDraftDbPromise) {
    expeditionDraftDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(EXPEDITION_DRAFT_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local draft storage.'));
      request.onblocked = () => reject(new Error('Local draft storage is blocked by another open Wanderlog tab.'));
    });
  }
  return expeditionDraftDbPromise;
}

async function readExpeditionDraftRecovery() {
  const database = await expeditionDraftDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction('drafts', 'readonly').objectStore('drafts').get('current');
    request.onsuccess = () => resolve(request.result?.draft || null);
    request.onerror = () => reject(request.error || new Error('Could not read the saved expedition draft.'));
  });
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
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').delete('current');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not clear the saved expedition draft.'));
    transaction.onabort = () => reject(transaction.error || new Error('Clearing the expedition draft was aborted.'));
  });
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
  if (typeof text !== 'string' || text.length > 20_000_000) throw new Error('The route file is empty or too large (20 MB maximum).');
  if (typeof filename !== 'string') throw new Error('Choose a GeoJSON or KML route file.');
  const extension = /\.([^.]+)$/.exec(filename.trim().toLowerCase())?.[1];
  const lines = [];
  const addLine = tuples => {
    if (!Array.isArray(tuples)) throw new Error('Invalid route geometry.');
    const points = tuples.map(uploadedRoutePoint);
    if (points.length < 2) throw new Error('Each route line must contain at least two points.');
    lines.push(points);
  };
  if (extension === 'geojson' || extension === 'json') {
    let data;
    try { data = JSON.parse(text); }
    catch (error) { throw new Error(`Invalid GeoJSON: ${error.message}`); }
    const visitGeometry = geometry => {
      if (!geometry || typeof geometry !== 'object') return;
      if (geometry.type === 'FeatureCollection') {
        if (!Array.isArray(geometry.features)) throw new Error('Invalid GeoJSON FeatureCollection.');
        geometry.features.forEach(feature => {
          if (feature?.type === 'Feature') visitGeometry(feature.geometry);
        });
      } else if (geometry.type === 'Feature') visitGeometry(geometry.geometry);
      else if (geometry.type === 'GeometryCollection') {
        if (!Array.isArray(geometry.geometries)) throw new Error('Invalid GeoJSON GeometryCollection.');
        geometry.geometries.forEach(visitGeometry);
      } else if (geometry.type === 'LineString') addLine(geometry.coordinates);
      else if (geometry.type === 'MultiLineString') {
        if (!Array.isArray(geometry.coordinates)) throw new Error('Invalid GeoJSON MultiLineString.');
        geometry.coordinates.forEach(addLine);
      }
    };
    visitGeometry(data);
  } else if (extension === 'kml') {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('KML files with document type or entity declarations are not supported.');
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('Invalid KML XML.');
    const descendants = element => Array.from(element.getElementsByTagName('*'));
    for (const element of descendants(xml)) {
      const name = element.localName || element.tagName?.split(':').pop();
      if (name === 'LineString') {
        const coordinates = descendants(element).find(child =>
          (child.localName || child.tagName?.split(':').pop()) === 'coordinates');
        if (!coordinates) throw new Error('KML LineString has no coordinates.');
        const tuples = coordinates.textContent.trim().split(/\s+/).filter(Boolean).map(token => {
          const values = token.split(',');
          if (values.length < 2 || !values[0].trim() || !values[1].trim()) throw new Error('Invalid KML coordinate.');
          const longitude = Number(values[0]), latitude = Number(values[1]);
          if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new Error('Invalid KML coordinate.');
          return [longitude, latitude];
        });
        addLine(tuples);
      } else if (name === 'Track') {
        const tuples = descendants(element).filter(child =>
          (child.localName || child.tagName?.split(':').pop()) === 'coord').map(coord => {
          const values = coord.textContent.trim().split(/\s+/);
          if (values.length < 2 || !values[0] || !values[1]) throw new Error('Invalid KML gx:coord.');
          const longitude = Number(values[0]), latitude = Number(values[1]);
          if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new Error('Invalid KML gx:coord.');
          return [longitude, latitude];
        });
        addLine(tuples);
      }
    }
  } else throw new Error('Choose a .geojson, .json, or .kml route file.');
  if (!lines.length) throw new Error('No LineString or gx:Track route was found in the file.');
  return downsampleUploadedRoute(lines.flat());
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
  document.getElementById('expeditionReason').value = existing?.reason ??
    (existing?.purposeTags || []).map(tag => TravelLedger.purposeTags[tag]).join(', ');
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
    transitTags: [...new Set(legs.map(leg => leg.mode))], purposeTags: [],
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
        const terrestrial = CoordinateLookups.biomeRegion(...stop.coords, coordinateIndexes.ecoregions, d3.geoContains).biomes.length > 0;
        const poi = stop.kind === 'poi' ? AppState.customPois.find(poi => poi.id === stop.id) : null;
        const elevationFt = stop.elevationFt ?? poi?.elevationFt ?? (await CoordinateLookups.lookupElevation(...stop.coords)).feet;
        return { ...stop, terrestrial, elevationFt };
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
    AudioEngine.playChime('discover');
    showNotification(editing ? 'Expedition updated' : 'Expedition logged', `${exp.name}: ${stops.length} stops.`, '🗺️');
  } catch (error) {
    console.error('Expedition save failed', error);
    status.textContent = `Not saved: ${error.message} Your draft is retained in this tab${savedExpeditionDraft ? ' and separately on this device' : ''}; retry or download a recovery file.`;
  } finally {
    setExpeditionBusy(false);
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
    `wanderlog-recovery-${new Date().toISOString().slice(0, 10)}.json`
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
    const route = parseUploadedRouteFile(await file.text(), file.name);
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
const TRAVEL_ROUTE_COLORS = { road: '#22d3ee', awd: '#22d3ee', ferry: '#38bdf8',
  flight: '#e879f9', rail: '#a78bfa', foot: '#4ade80' };
const GLOBAL_ROUTE_COLORS = {
  road: '#f59e0b', awd: '#f59e0b', flight: '#38bdf8',
  ferry: '#10b981', rail: '#c084fc', foot: '#f472b6'
};
let globalRoutesOpen = false;
let globalRoutesZoomBehavior = null;

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
    return { icon: '🏞️', label: park?.name || `Park ${id}`, tone: 'bg-emerald-950 text-emerald-300 border-emerald-500/40' };
  });
  exp.customPoiIds.forEach(id => {
    const poi = AppState.customPois.find(p => p.id === id);
    badges.push({ icon: '📌', label: poi?.name || `POI ${id}`, tone: 'bg-violet-950 text-violet-300 border-violet-500/40' });
  });
  exp.transitTags.forEach(tag => {
    badges.push({ icon: TravelLedger.transitIcons[tag], label: TravelLedger.transitTags[tag], tone: 'bg-sky-950 text-sky-300 border-sky-500/40' });
  });
  exp.purposeTags.forEach(tag => {
    badges.push({ icon: '✨', label: TravelLedger.purposeTags[tag], tone: 'bg-amber-950 text-amber-300 border-amber-500/40' });
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
  if (exp.countyIds.length) countries.add('United States of America');
  const home = AppState.homeBase;
  const homeCountries = home ? cachedPoliticalAt(home.lat, home.lng)?.countries ||
    (home.countyId ? ['United States of America'] : []) : [];
  const homeKeys = new Set(homeCountries.map(country => InternationalParks.countryCode(country) || country));
  return profileCountryFlags([...countries]).filter(flag => !homeKeys.has(flag.code || flag.name));
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
  return exp.routeLegs?.map((leg, index) => ({
    mode: leg.mode,
    routeSource: leg.routeSource ?? (leg.mode === 'flight' ? 'none' :
      ['road', 'awd'].includes(leg.mode) ? 'routed' : 'direct'),
    coords: leg.routeSource === 'uploaded' ? leg.routeCoords :
      ['ferry', 'flight', 'rail'].includes(leg.mode)
        ? [exp.routeStops?.[index]?.coords, exp.routeStops?.[index + 1]?.coords] : leg.routeCoords
  })) || (route.length > 1 ? [{
    mode: exp.transitTags.some(mode => !['road', 'awd'].includes(mode)) ? 'flight' : 'road',
    routeSource: exp.transitTags.every(mode => ['road', 'awd'].includes(mode)) ? 'routed' : 'direct',
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

function renderTravelLogMiniMap(exp) {
  const host = document.getElementById(`mini-map-${exp.id}`);
  if (typeof L === 'undefined' || typeof L.map !== 'function') {
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

function renderGlobalRoutesMap() {
  const svg = document.getElementById('svgGlobalRoutesMap');
  const features = worldGeoJson || [];
  const collection = { type: 'FeatureCollection', features };
  const projection = d3.geoNaturalEarth1();
  if (features.length) projection.fitExtent([[24, 24], [1176, 560]], collection);
  const path = d3.geoPath(projection);
  const stats = calculateStats();
  const visitedCountries = new Set(stats.visitedCountries);
  const countries = features.filter(feature => feature?.geometry).map(feature => {
    const name = feature.properties?.name || 'Unknown country';
    const fill = visitedCountries.has(name) ? '#13233f' : '#0f172a';
    return `<path class="global-country" fill="${fill}" stroke="#1e293b" stroke-width="0.8" d="${path(feature) || ''}"><title>${escapeHtml(name)}</title></path>`;
  }).join('');
  const graticule = path(d3.geoGraticule()) || '';
  const routes = [];
  const markers = [];

  AppState.expeditions.forEach(exp => {
    const title = `${exp.name || 'Expedition'} · ${travelLogDateRange(exp)}`;
    travelLogLegs(exp).forEach(leg => {
      if (!Array.isArray(leg.coords) || leg.coords.length < 2 || !leg.coords.every(travelLogPoint)) return;
      const isDirect = leg.routeSource === 'direct' && leg.coords.length === 2;
      const coordinates = leg.mode === 'flight' || isDirect
        ? (() => {
          const interpolate = d3.geoInterpolate(
            [leg.coords[0][1], leg.coords[0][0]],
            [leg.coords.at(-1)[1], leg.coords.at(-1)[0]]
          );
          return Array.from({ length: 25 }, (_, index) => interpolate(index / 24));
        })()
        : leg.coords.map(([lat, lng]) => [lng, lat]);
      const routePath = path({ type: 'LineString', coordinates });
      if (!routePath) return;
      const color = GLOBAL_ROUTE_COLORS[leg.mode] || '#94a3b8';
      routes.push(`<path class="global-route" data-mode="${escapeHtml(leg.mode)}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"${leg.mode === 'flight' ? ' stroke-dasharray="6 5"' : ''} d="${routePath}"><title>${escapeHtml(title)}</title></path>`);
    });
    (exp.routeStops || []).forEach(stop => {
      if (!travelLogPoint(stop?.coords)) return;
      const [cx, cy] = projection([stop.coords[1], stop.coords[0]]);
      markers.push(`<circle class="global-route-stop" cx="${cx}" cy="${cy}" r="2.5" fill="#e2e8f0" stroke="#020617" stroke-width="1"><title>${escapeHtml(`${exp.name || 'Expedition'} · ${stop.name || 'Stop'}`)}</title></circle>`);
    });
  });

  const home = AppState.homeBase && travelLogPoint([AppState.homeBase.lat, AppState.homeBase.lng])
    ? projection([AppState.homeBase.lng, AppState.homeBase.lat]) : null;
  const homeMarker = home
    ? `<g class="global-route-home"><title>${escapeHtml(`Home Base · ${AppState.homeBase.name}`)}</title><circle cx="${home[0]}" cy="${home[1]}" r="11" fill="#f59e0b" fill-opacity="0.2" stroke="#fbbf24" stroke-width="1.5"></circle><text x="${home[0]}" y="${home[1] + 6}" text-anchor="middle" font-size="17" fill="#fbbf24">★</text></g>`
    : '';

  svg.innerHTML = `<rect class="global-routes-ocean" width="1200" height="630" fill="#040814"></rect><g class="global-routes-zoom"><path class="global-routes-graticule" fill="none" stroke="#1e293b" stroke-width="0.6" d="${graticule}"></path>${countries}${routes.join('')}${markers.join('')}${homeMarker}</g>`;
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
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', '2400');
  svg.setAttribute('height', '1260');
  svg.querySelector('.global-routes-zoom')?.setAttribute('transform', 'translate(0,0) scale(1)');

  const stats = calculateStats();
  const footer = appendSvgElement(svg, 'g', { class: 'global-routes-export-footer' });
  appendSvgElement(footer, 'rect', { x: 0, y: 570, width: 1200, height: 60, fill: '#0b1220' });
  const banner = appendSvgElement(footer, 'text', {
    x: 32, y: 608, fill: '#e2e8f0', 'font-family': 'Inter, Arial, sans-serif',
    'font-size': 20, 'font-weight': 600
  });
  banner.textContent = `WANDERLOG • ${stats.cls} (Level ${stats.level}) • ${AppState.expeditions.length} Expeditions • ${stats.countriesCount} Countries`;

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
  download.download = `wanderlog_routes_${localExportTimestamp()}.png`;
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
  const sorted = [...AppState.expeditions].sort((a, b) =>
    (b.startDate || b.endDate || '').localeCompare(a.startDate || a.endDate || ''));
  for (const id of travelJournalDrafts.keys()) {
    if (!sorted.some(exp => exp.id === id)) travelJournalDrafts.delete(id);
  }
  let period = null;
  container.innerHTML = sorted.map(exp => {
    const names = travelLogStopNames(exp);
    const regions = travelLogRegions(exp);
    const badges = travelLogBadges(exp);
    const metrics = travelLogMetrics(exp);
    const flags = travelLogCountryFlags(exp);
    const badgeMarkup = badges.map(badge =>
      `<span class="px-2 py-0.5 rounded-full text-[11px] border ${badge.tone}">${badge.icon} ${escapeHtml(badge.label)}</span>`);
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
          ${flags.length ? `<ul class="passport-flags" data-trip-flags aria-label="Countries visited outside your home country">${countryFlagMarkup(flags)}</ul>` : ''}
          <span class="travel-journal-toggle text-xs text-sky-300">Open journal <span aria-hidden="true">⌄</span></span>
          <span class="travel-journal-collapse-hint text-xs text-sky-300">Collapse journal <span aria-hidden="true">⌃</span></span>
        </div>
        ${exp.photos?.length ? `<img class="travel-journal-highlight" src="${exp.photos[0]}" alt="Highlight from ${escapeHtml(exp.name)}" loading="lazy">` : ''}
      </summary>
      <div class="travel-journal-body" data-journal-body="${escapeHtml(exp.id)}"></div>
      <div class="travel-journal-details">
        <details><summary class="text-xs text-slate-400">Itinerary &amp; trip details</summary>
          ${regions ? `<p class="text-xs text-slate-300">${escapeHtml(regions)}</p>` : ''}
          <ol class="travel-journal-itinerary">${names.map((name, index) => `<li>${escapeHtml(name)}${exp.routeLegs?.[index] ? `<small>${escapeHtml(TravelLedger.transitTags[exp.routeLegs[index].mode])}</small>` : ''}</li>`).join('')}</ol>
          <div class="flex flex-wrap gap-1.5">${badgeMarkup.join('')}</div>
          ${exp.reason ? `<p class="text-xs text-slate-400">${escapeHtml(exp.reason)}</p>` : ''}
        </details>
        ${AppState.viewOnly ? '' : `<button type="button" data-edit-expedition="${escapeHtml(exp.id)}" class="rounded-lg bg-slate-800 px-3 py-2 text-xs text-amber-200">Edit trip &amp; route</button>`}
        <button type="button" data-collapse-journal class="rounded-lg bg-slate-800 px-3 py-2 text-xs text-sky-300">Collapse journal ↑</button>
      </div>
    </details>`;
  }).join('');
  container.querySelectorAll('[data-edit-expedition]').forEach(button => {
    button.addEventListener('click', () => openExpedition(button.dataset.editExpedition));
  });
  container.querySelectorAll('[data-trip-flags]').forEach(wireCountryFlagFallbacks);
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
    draft = { source: exp, journal: exp.journal || '', photos: [...(exp.photos || [])], busy: false };
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
    draft.photos.splice(Number(button.dataset.removePhoto), 1);
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
      updateExpedition({ ...current, ...TravelLedger.validateJournal(draft.journal, draft.photos) });
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
  for (const [id, tags] of [
    ['customPurposeTags', TravelLedger.purposeTags]
  ]) {
    document.getElementById(id).innerHTML = Object.entries(tags).map(([value, label]) =>
      `<label class="flex items-center gap-1"><input type="checkbox" value="${value}">${label}</label>`).join('');
  }
});
