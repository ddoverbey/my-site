let expeditionDraft = [];
let expeditionPending = false;
let expeditionPreview = null;
let citySearchPending = false;
let lastCitySearch = 0;

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
    expeditionDraft.push(expeditionStop(kind, id));
    renderExpeditionStops();
  } catch (error) {
    console.error('Expedition selection failed', error);
    showNotification('Route selection failed', error.message, '⚠️');
  }
}

function renderExpeditionStops() {
  const list = document.getElementById('expeditionStops');
  list.replaceChildren();
  expeditionDraft.forEach((stop, index) => {
    const item = document.createElement('li');
    item.className = 'flex items-center justify-between gap-2 rounded-lg bg-slate-900 p-2';
    const name = document.createElement('span');
    name.textContent = `${index + 1}. ${stop.name}`;
    item.appendChild(name);
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
      button.addEventListener('click', () => { action(); renderExpeditionStops(); });
      controls.appendChild(button);
    }
    item.appendChild(controls);
    list.appendChild(item);
  });
  document.getElementById('expeditionMapCount').textContent = `${expeditionDraft.length} stops selected`;
  if (expeditionPreview && map) map.removeLayer(expeditionPreview);
  expeditionPreview = map && expeditionPicking && expeditionDraft.length >= 2
    ? L.polyline(expeditionDraft.map(stop => stop.coords), { color: '#facc15', dashArray: '6 6', interactive: false }).addTo(map) : null;
}

function renderExpeditionSearch() {
  const results = document.getElementById('expeditionSearchResults');
  results.replaceChildren();
  const query = document.getElementById('expeditionSearch').value.trim().toLowerCase();
  if (!query) return;
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
  if (!count) results.textContent = 'No matching locations. Retry datasets if geography is unavailable.';
}

function openExpedition() {
  if (AppState.viewOnly || expeditionPending) return;
  expeditionDraft = [];
  document.getElementById('expeditionForm').reset();
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  document.getElementById('expeditionStart').value = today;
  document.getElementById('expeditionEnd').value = today;
  document.getElementById('expeditionStatus').textContent = '';
  renderExpeditionStops();
  renderExpeditionSearch();
  resumeExpedition();
  document.getElementById('expeditionName').focus();
}

function resumeExpedition() {
  expeditionPicking = false;
  document.getElementById('expeditionMapPicker').classList.add('hidden');
  document.getElementById('expeditionModal').classList.remove('hidden');
  renderExpeditionStops();
  if (map) {
    renderParkMarkers();
    renderCountyHitboxes();
  }
}

function closeExpedition() {
  if (expeditionPending) return;
  expeditionPicking = false;
  expeditionDraft = [];
  document.getElementById('expeditionModal').classList.add('hidden');
  document.getElementById('expeditionMapPicker').classList.add('hidden');
  renderExpeditionStops();
  if (map) {
    renderParkMarkers();
    renderCountyHitboxes();
  }
  document.getElementById('btnExpedition').focus();
}

async function saveExpedition(event) {
  event.preventDefault();
  if (AppState.viewOnly || expeditionPending) return;
  const status = document.getElementById('expeditionStatus');
  const controls = [...document.getElementById('expeditionForm').querySelectorAll('input, button')];
  const tags = id => [...document.querySelectorAll(`#${id} input:checked`)].map(input => input.value);
  const stops = expeditionDraft.map(stop => ({ ...stop, coords: [...stop.coords] }));
  const exp = {
    id: `exp_${crypto.randomUUID()}`, name: document.getElementById('expeditionName').value.trim(),
    startDate: document.getElementById('expeditionStart').value, endDate: document.getElementById('expeditionEnd').value,
    transitTags: tags('expeditionTransitTags'), purposeTags: tags('expeditionPurposeTags'),
    countyIds: [...new Set(stops.filter(stop => stop.kind === 'county').map(stop => stop.id))],
    parkIds: [...new Set(stops.filter(stop => stop.kind === 'park').map(stop => stop.id))],
    customPoiIds: [...new Set(stops.filter(stop => stop.kind === 'poi').map(stop => stop.id))],
    routeCoords: stops.map(stop => stop.coords), routeStops: stops, minElevationFt: null, maxElevationFt: null
  };
  try {
    TravelLedger.validateExpeditions([exp], CoordinateLookups);
    if (!coordinateIndexes) throw new Error('Geography is not ready. Retry datasets before saving.');
    expeditionPending = true;
    controls.forEach(control => { control.disabled = true; });
    status.textContent = 'Sampling stop elevations. The expedition is not saved yet...';
    // Bounded batches avoid sending one hundred concurrent public API requests.
    const elevations = [];
    for (let offset = 0; offset < stops.length; offset += 4) {
      const batch = await Promise.all(stops.slice(offset, offset + 4).map(async stop => {
        const terrestrial = CoordinateLookups.biomeRegion(...stop.coords, coordinateIndexes.ecoregions, d3.geoContains).biomes.length > 0;
        const poi = stop.kind === 'poi' ? AppState.customPois.find(poi => poi.id === stop.id) : null;
        const elevationFt = poi?.elevationFt ?? (await CoordinateLookups.lookupElevation(...stop.coords)).feet;
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
    addExpedition(exp);
    expeditionPending = false;
    closeExpedition();
    refreshTravelUI();
    AudioEngine.playChime('discover');
    showNotification('Expedition logged', `${exp.name}: ${stops.length} stops visited. Lived tiers preserved.`, '🗺️');
  } catch (error) {
    console.error('Expedition save failed', error);
    status.textContent = `Not saved: ${error.message} Your draft is retained; retry or cancel.`;
  } finally {
    expeditionPending = false;
    controls.forEach(control => { control.disabled = false; });
    renderExpeditionStops();
  }
}

function renderExpeditionHistory() {
  const container = document.getElementById('expeditionHistory');
  if (!AppState.expeditions.length) {
    container.innerHTML = '<p class="text-sm text-slate-400">No expeditions logged yet. Build your first route from the map.</p>';
    return;
  }
  container.innerHTML = [...AppState.expeditions].sort((a, b) => b.startDate.localeCompare(a.startDate)).map(exp => {
    const names = exp.routeStops?.map(stop => stop.name || `${stop.kind} ${stop.id}`) || [
      ...exp.countyIds.map(id => countyFeaturesById[id]?.properties?.name || `County ${id}`),
      ...exp.parkIds.map(id => PARKS.find(p => p.id === id)?.name || `Park ${id}`),
      ...exp.customPoiIds.map(id => AppState.customPois.find(p => p.id === id)?.name || `POI ${id}`)
    ];
    return `<article class="rpg-panel rounded-2xl p-4 space-y-2">
      <h4 class="font-bold text-amber-200">${escapeHtml(exp.name)}</h4>
      <p class="text-xs text-slate-400">${escapeHtml(exp.startDate)} – ${escapeHtml(exp.endDate)}</p>
      <p class="text-xs text-slate-300">${names.map(escapeHtml).join(' → ')}</p>
      <p class="text-xs text-slate-400">${exp.minElevationFt === null ? 'No terrestrial stop elevations available' :
        `Sampled terrestrial stop elevations: ${Math.round(exp.minElevationFt).toLocaleString('en')} to ${Math.round(exp.maxElevationFt).toLocaleString('en')} ft`}</p>
      <div class="flex flex-wrap gap-2">${[
        ...exp.transitTags.map(tag => TravelLedger.transitTags[tag]), ...exp.purposeTags.map(tag => TravelLedger.purposeTags[tag])
      ].map(label => `<span class="text-xs rounded-full px-2 py-1 bg-slate-800 text-amber-200">${escapeHtml(label)}</span>`).join('')}</div>
    </article>`;
  }).join('');
}

async function searchHometown() {
  if (AppState.viewOnly || citySearchPending) return;
  const status = document.getElementById('homeLookupStatus');
  const results = document.getElementById('citySearchResults');
  const query = document.getElementById('cityInput').value.trim();
  results.replaceChildren();
  try {
    if (!query) throw new Error('Enter a city name.');
    const knownCity = [...document.querySelectorAll('.quick-city-chip')].find(chip =>
      [chip.dataset.name, chip.textContent.trim()].some(name => name.toLowerCase() === query.toLowerCase()));
    if (knownCity) {
      setHometownCoordinates(knownCity.dataset.name, Number(knownCity.dataset.lat), Number(knownCity.dataset.lng));
      return;
    }
    if (Date.now() - lastCitySearch < 1100) throw new Error('Wait a moment before searching again (Nominatim rate limit).');
    citySearchPending = true;
    document.getElementById('btnSubmitCity').disabled = true;
    lastCitySearch = Date.now();
    status.textContent = 'Searching OpenStreetMap Nominatim...';
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({
      q: query, format: 'jsonv2', limit: '5'
    })}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`City search failed (HTTP ${response.status}).`);
    const matches = await response.json();
    if (!Array.isArray(matches) || !matches.length) throw new Error('No city found. Try including the state or country.');
    matches.forEach(match => {
      if (!match || typeof match.lat !== 'string' || !match.lat.trim() ||
          typeof match.lon !== 'string' || !match.lon.trim()) throw new Error('Invalid city search coordinates.');
      CoordinateLookups.validateCoordinates(Number(match.lat), Number(match.lon));
      if (typeof match.display_name !== 'string') throw new Error('Invalid city search result.');
    });
    matches.forEach(match => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'block w-full rounded-lg bg-slate-800 p-2 text-xs text-left';
      button.textContent = match.display_name;
      button.addEventListener('click', () => {
        try { setHometownCoordinates(match.display_name, Number(match.lat), Number(match.lon)); }
        catch (error) { console.error('Home save failed', error); status.textContent = `Home not saved: ${error.message}`; }
      });
      results.appendChild(button);
    });
    status.textContent = 'Choose your city. © OpenStreetMap contributors (ODbL).';
  } catch (error) {
    console.error('Home search failed', error);
    status.textContent = error.message;
  } finally {
    citySearchPending = false;
    document.getElementById('btnSubmitCity').disabled = false;
  }
}

document.getElementById('btnExpedition').addEventListener('click', openExpedition);
document.getElementById('btnResumeExpedition').addEventListener('click', resumeExpedition);
document.getElementById('btnCancelExpedition').addEventListener('click', closeExpedition);
document.getElementById('expeditionSearch').addEventListener('input', renderExpeditionSearch);
document.getElementById('expeditionForm').addEventListener('submit', saveExpedition);
document.getElementById('btnPickExpeditionMap').addEventListener('click', () => {
  if (AppState.viewOnly || expeditionPending) return;
  expeditionPicking = true;
  document.getElementById('expeditionModal').classList.add('hidden');
  document.getElementById('expeditionMapPicker').classList.remove('hidden');
  switchTab('map');
  renderParkMarkers();
  renderCountyHitboxes();
  renderExpeditionStops();
  document.getElementById('btnResumeExpedition').focus();
});
document.getElementById('expeditionModal').addEventListener('keydown', event => {
  if (event.key === 'Escape') closeExpedition();
  if (event.key === 'Tab') {
    const controls = [...document.getElementById('expeditionForm').querySelectorAll('input, button')].filter(control => !control.disabled);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
window.addEventListener('DOMContentLoaded', () => {
  for (const [id, tags] of [
    ['expeditionTransitTags', TravelLedger.transitTags], ['expeditionPurposeTags', TravelLedger.purposeTags],
    ['customPurposeTags', TravelLedger.purposeTags]
  ]) {
    document.getElementById(id).innerHTML = Object.entries(tags).map(([value, label]) =>
      `<label class="flex items-center gap-1"><input type="checkbox" value="${value}">${label}</label>`).join('');
  }
});
