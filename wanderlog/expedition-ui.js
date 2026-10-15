let expeditionDraft = [];
let expeditionPending = false;
let expeditionEditingId = null;
let expeditionPreparedLegs = null;
let expeditionPreparedKey = null;
let expeditionPreviewMap = null;
let expeditionPreviewLayers = null;
let expeditionSearchVersion = 0;
let expeditionSearchTimer = null;
let homeSearchVersion = 0;
let homeSearchTimer = null;
let expeditionReturnFocus = null;
const expeditionRoadCache = new Map();
let lastRoadRequest = 0;

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

function invalidateExpeditionRoutes() {
  expeditionPreparedLegs = null;
  expeditionPreparedKey = null;
  document.getElementById('expeditionRoutePreview').classList.add('hidden');
  document.getElementById('expeditionRouteSummary').textContent = '';
  document.getElementById('btnSaveExpedition').disabled = expeditionDraft.length !== 1;
  document.getElementById('btnPreviewExpedition').disabled = !expeditionDraft.length;
}

function expeditionRouteKey() {
  return JSON.stringify(expeditionDraft.map(stop => [stop.kind, stop.id, stop.coords, stop.travelMode || 'road']));
}

function renderExpeditionStops() {
  const list = document.getElementById('expeditionStops');
  list.replaceChildren();
  expeditionDraft.forEach((stop, index) => {
    const item = document.createElement('li');
    item.className = 'rounded-lg bg-slate-900 p-3 space-y-2';
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2';
    const name = document.createElement('span');
    name.textContent = `${index + 1}. ${stop.name}`;
    row.appendChild(name);
    const controls = document.createElement('span');
    for (const [text, label, action, disabled] of [
      ['↑', `Move ${stop.name} earlier`, () => {
        [expeditionDraft[index - 1], expeditionDraft[index]] = [expeditionDraft[index], expeditionDraft[index - 1]];
      }, index === 0],
      ['↓', `Move ${stop.name} later`, () => {
        [expeditionDraft[index + 1], expeditionDraft[index]] = [expeditionDraft[index], expeditionDraft[index + 1]];
      }, index === expeditionDraft.length - 1],
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
}

function openExpedition(id = null) {
  if (AppState.viewOnly || expeditionPending) return;
  const existing = id ? AppState.expeditions.find(exp => exp.id === id) : null;
  if (id && !existing) {
    showNotification('Expedition unavailable', 'This expedition no longer exists.', '⚠️');
    return;
  }
  expeditionEditingId = id;
  expeditionReturnFocus = document.activeElement;
  document.getElementById('expeditionForm').reset();
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
  document.getElementById('expeditionSearch').value = '';
  document.getElementById('expeditionStatus').textContent = '';
  invalidateExpeditionRoutes();
  syncExpeditionDayTrip();
  renderExpeditionStops();
  renderExpeditionSearch();
  document.getElementById('expeditionModal').classList.remove('hidden');
  if (existing?.routeLegs) {
    expeditionPreparedLegs = existing.routeLegs.map(leg => ({
      mode: leg.mode, routeCoords: leg.routeCoords.map(point => [...point]), countyIds: [...leg.countyIds]
    }));
    expeditionPreparedKey = expeditionRouteKey();
    displayExpeditionPreview(expeditionPreparedLegs);
    document.getElementById('btnSaveExpedition').disabled = false;
  }
  document.getElementById('expeditionName').focus();
}

function closeExpedition() {
  if (expeditionPending) return;
  expeditionPicking = false;
  expeditionDraft = [];
  expeditionEditingId = null;
  dismissPlaceSuggestions(false, true);
  invalidateExpeditionRoutes();
  document.getElementById('expeditionModal').classList.add('hidden');
  renderExpeditionStops();
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
    const route = leg.mode === 'flight'
      ? [expeditionDraft[index].coords, expeditionDraft[index + 1].coords]
      : leg.routeCoords;
    L.polyline(route, {
      color: leg.mode === 'ferry' ? '#38bdf8' : leg.mode === 'flight' ? '#94a3b8' : '#fbbf24',
      weight: 3, opacity: leg.routeSource === 'direct' || leg.mode === 'flight' ? 0.7 : 0.95,
      dashArray: leg.routeSource === 'direct' || leg.mode === 'flight' ? '8 8' : null
    }).addTo(expeditionPreviewLayers);
  });
  expeditionDraft.forEach(stop => L.circleMarker(stop.coords, { radius: 5, color: '#10b981' })
    .bindTooltip(escapeHtml(stop.name)).addTo(expeditionPreviewLayers));
  expeditionPreviewMap.invalidateSize();
  expeditionPreviewMap.fitBounds(expeditionPreviewLayers.getBounds(), { padding: [20, 20], maxZoom: 12, animate: false });
  const counties = new Set(legs.flatMap(leg => leg.countyIds));
  document.getElementById('expeditionRouteSummary').textContent =
    `${legs.length} travel leg${legs.length === 1 ? '' : 's'} · ${counties.size} counties along driving routes. Ferry routes clear fog only well offshore; ferry and flight routes do not award route counties. Dashed lines are direct approximations.`;
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
    let ferryFallbacks = 0;
    for (let index = 0; index < expeditionDraft.length - 1; index++) {
      const from = expeditionDraft[index], to = expeditionDraft[index + 1];
      const mode = from.travelMode || 'road';
      let routeCoords = [];
      let countyIds = [];
      let routeSource = 'direct';
      if (mode === 'road' || mode === 'awd') {
        const key = JSON.stringify([from.coords, to.coords]);
        if (!expeditionRoadCache.has(key)) {
          const wait = Math.max(0, 1100 - (Date.now() - lastRoadRequest));
          if (wait) await new Promise(resolve => setTimeout(resolve, wait));
          lastRoadRequest = Date.now();
          expeditionRoadCache.set(key, await CoordinateLookups.lookupRoadRoute(from.coords, to.coords));
        }
        routeCoords = expeditionRoadCache.get(key).map(point => [...point]);
        countyIds = CoordinateLookups.routeCountyIds(routeCoords, coordinateIndexes.counties, d3.geoContains);
        routeSource = 'routed';
      } else if (mode === 'ferry') {
        const key = JSON.stringify([from.coords, to.coords]);
        try {
          if (!expeditionRoadCache.has(key)) {
            const wait = Math.max(0, 1100 - (Date.now() - lastRoadRequest));
            if (wait) await new Promise(resolve => setTimeout(resolve, wait));
            lastRoadRequest = Date.now();
            expeditionRoadCache.set(key, await CoordinateLookups.lookupRoadRoute(from.coords, to.coords));
          }
          routeCoords = expeditionRoadCache.get(key).map(point => [...point]);
          routeSource = 'routed';
        } catch (error) {
          console.error('Ferry route unavailable; using a direct visual approximation', error);
          routeCoords = [[...from.coords], [...to.coords]];
          ferryFallbacks++;
        }
      } else if (mode === 'foot') routeCoords = [[...from.coords], [...to.coords]];
      else routeSource = 'none';
      legs.push({ mode, routeSource, routeCoords, countyIds });
    }
    // Validation also rejects road routes snapped too far from the requested endpoints.
    TravelLedger.validateExpeditions([draftExpedition(legs)], CoordinateLookups);
    displayExpeditionPreview(legs);
    expeditionPreparedLegs = legs;
    expeditionPreparedKey = expeditionRouteKey();
    status.textContent = ferryFallbacks
      ? `${ferryFallbacks} ferry route${ferryFallbacks === 1 ? '' : 's'} could not be routed; dashed line${ferryFallbacks === 1 ? ' is' : 's are'} a direct approximation. Review before saving.`
      : 'Review the routes, then save.';
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
    minElevationFt: null, maxElevationFt: null
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
    status.textContent = `Not saved: ${error.message} Your draft is retained; retry or cancel.`;
  } finally {
    setExpeditionBusy(false);
  }
}

let travelLogMaps = {};

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
    badges.push({ icon: '🚙', label: TravelLedger.transitTags[tag], tone: 'bg-sky-950 text-sky-300 border-sky-500/40' });
  });
  exp.purposeTags.forEach(tag => {
    badges.push({ icon: '✨', label: TravelLedger.purposeTags[tag], tone: 'bg-amber-950 text-amber-300 border-amber-500/40' });
  });
  return badges.filter(badge => badge.label);
}

function destroyTravelLogMaps() {
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

function renderTravelLogMiniMap(exp) {
  if (typeof L === 'undefined' || typeof L.map !== 'function') return;
  const route = (exp.routeCoords || []).filter(travelLogPoint);
  const stops = (exp.routeStops || []).map(stop => stop?.coords).filter(travelLogPoint);
  const legs = exp.routeLegs?.map((leg, index) => ({
    mode: leg.mode,
    routeSource: leg.routeSource ?? (leg.mode === 'flight' ? 'none' :
      ['road', 'awd'].includes(leg.mode) ? 'routed' : 'direct'),
    coords: leg.mode === 'flight'
      ? [exp.routeStops?.[index]?.coords, exp.routeStops?.[index + 1]?.coords]
      : leg.routeCoords
  })) || (route.length > 1 ? [{
    mode: exp.transitTags.some(mode => !['road', 'awd'].includes(mode)) ? 'flight' : 'road',
    routeSource: exp.transitTags.every(mode => ['road', 'awd'].includes(mode)) ? 'routed' : 'direct',
    coords: route
  }] : []);
  const displayLegs = legs.filter(leg => Array.isArray(leg.coords) &&
    leg.coords.length > 1 && leg.coords.every(travelLogPoint));
  const hasPolyline = displayLegs.length > 0;
  const points = [...(hasPolyline ? displayLegs.flatMap(leg => leg.coords) : route), ...stops];
  // Without route geometry every logged stop still needs a marker and must be included in the frame.
  if (!points.length) return;
  const miniMap = L.map(`mini-map-${exp.id}`, {
    zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
    doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false
  });
  travelLogMaps[exp.id] = miniMap;
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  }).addTo(miniMap);
  if (hasPolyline) {
    displayLegs.forEach(leg => L.polyline(leg.coords, {
      color: leg.mode === 'ferry' ? '#38bdf8' : leg.mode === 'flight' ? '#94a3b8' : '#f59e0b',
      weight: 3, opacity: leg.routeSource === 'direct' || leg.mode === 'flight' ? 0.7 : 0.95,
      dashArray: leg.routeSource === 'direct' || leg.mode === 'flight' ? '8 8' : null
    }).addTo(miniMap));
    stops.forEach(coords => L.circleMarker(coords,
      { radius: 4, fillColor: '#10b981', color: '#fff', weight: 1, fillOpacity: 1 }).addTo(miniMap));
  } else {
    points.forEach(coords => L.circleMarker(coords,
      { radius: 6, fillColor: '#10b981', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(miniMap));
  }
  if (points.length > 1) miniMap.fitBounds(L.latLngBounds(points), { padding: [15, 15], maxZoom: 12 });
  else miniMap.setView(points[0], 8);
}

function renderExpeditionHistory() {
  const container = document.getElementById('travelLogFeed');
  // Leaflet instances must be torn down before their containers are discarded.
  destroyTravelLogMaps();
  if (!AppState.expeditions.length) {
    container.innerHTML = '<p class="text-sm text-slate-400">No expeditions yet. Log your first trip.</p>';
    return;
  }
  const sorted = [...AppState.expeditions].sort((a, b) =>
    (b.startDate || b.endDate || '').localeCompare(a.startDate || a.endDate || ''));
  let period = null;
  container.innerHTML = sorted.map(exp => {
    const names = travelLogStopNames(exp);
    const regions = travelLogRegions(exp);
    const badges = travelLogBadges(exp);
    let divider = '';
    const current = travelLogPeriod(exp);
    if (current !== period) {
      period = current;
      divider = `<div class="flex items-center gap-3 pt-2"><span class="text-xs font-mono text-amber-400">${escapeHtml(current)}</span><div class="flex-1 h-px bg-slate-800"></div></div>`;
    }
    return `${divider}<article class="rpg-panel rounded-2xl p-4 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
      <div id="mini-map-${escapeHtml(exp.id)}" class="h-44 w-full rounded-xl overflow-hidden border border-slate-700/60 bg-slate-950"></div>
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h4 class="font-bold text-amber-200 text-base">${escapeHtml(exp.name)}</h4>
          <span class="text-xs text-slate-400 font-mono">${escapeHtml(travelLogDateRange(exp))}${exp.dayTrip ? ' · Day trip' : ''}</span>
        </div>
        <p class="text-xs text-slate-300">${names.map(escapeHtml).join(' → ')}</p>
        ${regions ? `<p class="text-xs text-slate-300">📍 ${escapeHtml(regions)}</p>` : ''}
        ${badges.length ? `<div class="flex flex-wrap gap-1.5">${badges.map(badge =>
          `<span class="px-2 py-0.5 rounded-full text-[11px] border ${badge.tone}">${badge.icon} ${escapeHtml(badge.label)}</span>`).join('')}</div>` : ''}
        ${exp.minElevationFt === null ? '' : `<p class="text-xs text-slate-400">Elevation: ${Math.round(exp.minElevationFt).toLocaleString('en')} to ${Math.round(exp.maxElevationFt).toLocaleString('en')} ft</p>`}
        ${exp.routeLegs?.length ? `<p class="text-xs text-slate-400">${exp.routeLegs.map((leg, index) =>
          `${escapeHtml(names[index])} → ${escapeHtml(names[index + 1])}: ${escapeHtml(TravelLedger.transitTags[leg.mode])}`).join('<br>')}</p>` : ''}
        ${exp.reason ? `<p class="text-xs text-slate-400 italic">${escapeHtml(exp.reason)}</p>` : ''}
        ${AppState.viewOnly ? '' : `<button type="button" data-edit-expedition="${escapeHtml(exp.id)}" class="self-start rounded-lg bg-slate-800 px-3 py-2 text-xs text-amber-200">Edit expedition</button>`}
      </div>
    </article>`;
  }).join('');
  container.querySelectorAll('[data-edit-expedition]').forEach(button => {
    button.addEventListener('click', () => openExpedition(button.dataset.editExpedition));
  });
  sorted.forEach(exp => {
    try { renderTravelLogMiniMap(exp); }
    catch (error) { console.error('Mini-map render failed', exp.id, error); }
  });
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
document.getElementById('btnExpeditionHistory').addEventListener('click', () => {
  if (expeditionPending) return;
  closeExpedition();
  switchTab('travel');
  document.getElementById('travelLogFeed').scrollIntoView({ block: 'start' });
});
document.getElementById('btnCancelExpedition').addEventListener('click', closeExpedition);
document.getElementById('expeditionSearch').addEventListener('input', renderExpeditionSearch);
document.getElementById('expeditionForm').addEventListener('submit', saveExpedition);
document.getElementById('btnPreviewExpedition').addEventListener('click', previewExpeditionRoutes);
document.getElementById('expeditionDayTrip').addEventListener('change', syncExpeditionDayTrip);
document.getElementById('expeditionStart').addEventListener('change', syncExpeditionDayTrip);
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
  for (const [id, tags] of [
    ['customPurposeTags', TravelLedger.purposeTags]
  ]) {
    document.getElementById(id).innerHTML = Object.entries(tags).map(([value, label]) =>
      `<label class="flex items-center gap-1"><input type="checkbox" value="${value}">${label}</label>`).join('');
  }
});
