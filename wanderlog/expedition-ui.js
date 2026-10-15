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
  return `${feature?.properties.name || `County ${id}`}, ${state?.properties.name || id}`;
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
  const fallback = document.getElementById(AppState.currentTab === 'passport' ? 'btnHistoryExpedition' : 'btnExpedition');
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
    [...places].reverse().forEach(place => {
      const button = suggestionButton(place, () => {
        if (AppState.viewOnly || expeditionPending) return;
        expeditionDraft.push({ kind: 'place', name: place.name, coords: [...place.coords],
          travelMode: 'road', id: `place_${crypto.randomUUID()}` });
        invalidateExpeditionRoutes();
        renderExpeditionStops();
        dismissPlaceSuggestions(false, true);
      });
      results.prepend(button);
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
  legs.forEach(leg => {
    if (leg.mode !== 'flight') L.polyline(leg.routeCoords, {
      color: leg.mode === 'ferry' ? '#38bdf8' : '#fbbf24', weight: 3
    }).addTo(expeditionPreviewLayers);
  });
  expeditionDraft.forEach(stop => L.circleMarker(stop.coords, { radius: 5, color: '#10b981' })
    .bindTooltip(escapeHtml(stop.name)).addTo(expeditionPreviewLayers));
  expeditionPreviewMap.invalidateSize();
  expeditionPreviewMap.fitBounds(expeditionPreviewLayers.getBounds(), { padding: [20, 20], maxZoom: 12, animate: false });
  const counties = new Set(legs.flatMap(leg => leg.countyIds));
  document.getElementById('expeditionRouteSummary').textContent =
    `${legs.length} travel leg${legs.length === 1 ? '' : 's'} · ${counties.size} counties along road routes. Flights have no path; only their stops count.`;
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
    for (let index = 0; index < expeditionDraft.length - 1; index++) {
      const from = expeditionDraft[index], to = expeditionDraft[index + 1];
      const mode = from.travelMode || 'road';
      let routeCoords = [];
      let countyIds = [];
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
      } else if (mode !== 'flight') routeCoords = [[...from.coords], [...to.coords]];
      legs.push({ mode, routeCoords, countyIds });
    }
    // Validation also rejects road routes snapped too far from the requested endpoints.
    TravelLedger.validateExpeditions([draftExpedition(legs)], CoordinateLookups);
    displayExpeditionPreview(legs);
    expeditionPreparedLegs = legs;
    expeditionPreparedKey = expeditionRouteKey();
    status.textContent = 'Review the routes, then save.';
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

function renderExpeditionHistory() {
  const container = document.getElementById('expeditionHistory');
  if (!AppState.expeditions.length) {
    container.innerHTML = '<p class="text-sm text-slate-400">No expeditions yet. Log your first trip.</p>';
    return;
  }
  container.innerHTML = [...AppState.expeditions].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')).map(exp => {
    const names = exp.routeStops?.map(stop => stop.name || `${stop.kind} ${stop.id}`) || [
      ...exp.countyIds.map(id => countyFeaturesById[id]?.properties?.name || `County ${id}`),
      ...exp.parkIds.map(id => PARKS.find(p => p.id === id)?.name || `Park ${id}`),
      ...exp.customPoiIds.map(id => AppState.customPois.find(p => p.id === id)?.name || `POI ${id}`)
    ];
    return `<article class="rpg-panel rounded-2xl p-4 space-y-2">
      <h4 class="font-bold text-amber-200">${escapeHtml(exp.name)}</h4>
      <p class="text-xs text-slate-400">${exp.startDate || exp.endDate
        ? `${escapeHtml(exp.startDate || '?')} – ${escapeHtml(exp.endDate || '?')}` : 'Dates not specified'}${exp.dayTrip ? ' · Day trip' : ''}</p>
      ${exp.reason ? `<p class="text-xs text-slate-300">${escapeHtml(exp.reason)}</p>` : ''}
      <p class="text-xs text-slate-300">${names.map(escapeHtml).join(' → ')}</p>
      ${exp.minElevationFt === null ? '' : `<p class="text-xs text-slate-400">Elevation: ${Math.round(exp.minElevationFt).toLocaleString('en')} to ${Math.round(exp.maxElevationFt).toLocaleString('en')} ft</p>`}
      <div class="flex flex-wrap gap-2">${[
        ...exp.transitTags.map(tag => TravelLedger.transitTags[tag]), ...exp.purposeTags.map(tag => TravelLedger.purposeTags[tag])
      ].map(label => `<span class="text-xs rounded-full px-2 py-1 bg-slate-800 text-amber-200">${escapeHtml(label)}</span>`).join('')}</div>
      ${exp.routeLegs?.length ? `<p class="text-xs text-slate-400">${exp.routeLegs.map((leg, index) =>
        `${escapeHtml(names[index])} → ${escapeHtml(names[index + 1])}: ${escapeHtml(TravelLedger.transitTags[leg.mode])}`).join('<br>')}</p>` : ''}
      ${AppState.viewOnly ? '' : `<button type="button" data-edit-expedition="${escapeHtml(exp.id)}" class="rounded-lg bg-slate-800 px-3 py-2 text-xs text-amber-200">Edit expedition</button>`}
    </article>`;
  }).join('');
  container.querySelectorAll('[data-edit-expedition]').forEach(button => {
    button.addEventListener('click', () => openExpedition(button.dataset.editExpedition));
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
  switchTab('passport');
  document.getElementById('expeditionHistory').scrollIntoView({ block: 'start' });
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
