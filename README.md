# my-site

## Wanderlog NPS catalog

Wanderlog loads a static snapshot fetched directly from the [NPS API](https://www.nps.gov/subjects/developer/get-started.htm).
Players do not need an API key, and no key is included in the site.

### One-time setup (or a later refresh)

1. Obtain a free NPS API key. Do **not** put it in a text file or commit it.
2. In this GitHub repository, open **Settings > Secrets and variables > Actions > New repository secret**.
   Name the secret `NPS_API_KEY` and paste the key into its value.
3. Push the importer and workflow changes, then open **Actions > Import NPS catalog > Run workflow**.
4. Download the successful run's `nps-catalog` artifact, unzip it, and add `nps-parks.json`,
   `ecoregion-mapping.json`, `nps-boundaries.topojson`, and `ecoregions.topojson` to the
   tracked [`wanderlog/`](wanderlog/) directory (capitalization matters on GitHub Pages).
5. Commit and deploy that dataset with the site. Repeat steps 3-5 only when you want a refresh.

The importer paginates the complete `/parks` endpoint, checks for 400+ unique records and valid metadata,
and preserves the API's official names, designations, coordinates, descriptions, topics, activities, and other fields.
The endpoint includes NPS listings of multiple designations and related areas; its record count is not
necessarily the administrative count of NPS units. Combined API listings such as Sequoia and Kings Canyon
count once. Missing coordinates remain in the ledger but do not get invented map locations.

Existing saves, imports, and shared passports migrate to NPS park codes. The highest status tier takes precedence
when old IDs map to a combined listing. Quest targets and completion totals use those same listing IDs.
International destinations come from the user-supplied Parks of the World and Wikidata datasets described below.
The snapshot date and any catalog-loading failure are visible in the game.
Until the generated dataset is published, only the international destinations are available.

For local generation, set `NPS_API_KEY` in the current shell and run `node .\wanderlog\import-nps.mjs`.
Node 16+ is sufficient; the workflow uses Node 22. Test without a key using
`node .\wanderlog\nps-catalog.test.mjs`. That test needs no packages; the ecoregion importer and full
test suite use the development dependencies in `wanderlog/package.json`.

## International national parks

[`worldwide-national-parks.json`](wanderlog/worldwide-national-parks.json) is the supplied
[Parks of the World](https://github.com/RohanNagar/parksoftheworld) curated dataset. It is not an
official global park registry. Its current 73 entries cover a subset of the world's parks, and
country fields use two-letter region codes, including dependencies and territories.

The game excludes `US`, `AS`, `GU`, `MP`, `PR`, `VI`, and `UM` entries **before merging**.
All U.S./U.S.-territory destinations remain sourced exclusively from `nps-parks.json`, even if
the NPS catalog fails to load; there is no worldwide-data fallback for U.S. parks.
The supplied American Samoa entry and 127 U.S. Wikidata rows are excluded.
The merged catalog contains 3,388 international destinations and 474 NPS listings: 3,862 total.

[`wikidata-national-parks-query.json`](wanderlog/wikidata-national-parks-query.json) supplies
4,784 query rows, not 4,784 unique parks. Wikidata structured data is
[CC0](https://www.wikidata.org/wiki/Wikidata:Licensing), but the query is not an official global
registry: classifications, labels and current designation/status may be incomplete or inaccurate.
This export contains only `parkLabel`, `countryLabel`, `lat` and `lon`, with **no entity IDs or
coordinate ranks**. Repeated rows are grouped by normalized country/name, removing the phrase
"National Park" and normalizing accents/punctuation. Identical name and full coordinate sets
under multiple country labels are also grouped, retaining those labels in data-quality notes.
Country aliases use canonical region codes; historical, non-country and missing country labels
are retained explicitly rather than silently guessed or discarded.

After U.S. exclusion and grouping, the query contributes 3,369 destinations. Country-aware exact
name matching and explicit aliases merge 53 curated overlaps, preserving curated IDs, metadata
and coordinates. Aliases include Tajik/Pamir, Shebenik-Jabllanice/Shebenik, Fir of Drenova/Drenove,
Fir of Hotove/Hotova, Theth/Thethi and Tynwald's longer query name. Territory-aware matches cover
Guadeloupe/France and Green Mountain/United Kingdom. Aoraki's punctuation variant normalizes
directly; Australia's Mount Cook is not merged with New Zealand's Aoraki Mount Cook.
No broad substring, fuzzy proximity or nearest-park matching is used.
All 19 identified Wikidata blind spots remain as curated supplements.

Where a query group has multiple coordinates, the lowest latitude/longitude source point is
selected deterministically, independent of row order; no averaged or invented point is used.
Alternative coordinates remain in normalized metadata and a warning appears on the park.
This is a reproducibility policy, **not evidence that one source point is more accurate**.
Same-name parks within a country cannot always be distinguished without entity IDs; large
coordinate spreads are flagged rather than treated as verified identities.
Curated/query conflicts over 50 km are shown using the nearest query point, with curated
coordinates retained: Nosy Ve-Androka (265.4 km), Hwange (52.9 km), and Tajik/Pamir (91.7 km).
Raw Q-number labels and uncertain country fields are also shown with quality notes.
Unknown/non-country labels can count as park visits but do not award country collection credit or country XP.

This file **replaces**, rather than supplements, the former 12 curated international destinations.
Fiordland retains its existing saved ID, but uses the supplied file's name, coordinates and metadata.
Other retired destination IDs remain in saved/imported/shared passports and exports, but do not
count toward active progress. Settings reports saved records outside the loaded catalogs.
Curated international IDs use `world-<country-code>-<normalized-name>`; new query-only IDs use
an encoded `wiki-<country>:<normalized-name>` key. IDs do not depend on array order or coordinates.
Returning Banff, Torres del Paine, Serengeti, Plitvice, Thingvellir, Kruger and Uluru query entries
retain their original saved IDs. Other retired IDs remain retained but inactive.
Renaming a park changes its ID, so deliberate renames require a saved-ID migration.
Duplicate curated normalized country/name IDs fail explicitly.

Country names, coordinates, descriptions, establishment dates, areas, visitor estimates and
memberships are normalized for the map/ledger. Source links are labeled **Park information source**,
not **Official NPS site**. Dark Sky Reserve/Sanctuary distinctions are retained. Memberships and
visitor counts are curated source claims, not independently verified/current annual measurements.
Images are not hotlinked or redistributed by the UI. Credits distinguish Parks of the World
from Wikidata. Since named query rows lack entity IDs, their source links lead to Wikidata searches;
raw Q-number labels link to their entity pages. NPS counts/quests remain NPS-only; international visits
contribute to global visits, country counts, fog clearings and their mapped terrestrial biomes.

Each international source loads independently; failures are reported separately in Settings,
do not erase saves, and leave the other international source and NPS available. Retry reloads
both sources and the biome mappings.
To update, replace the supplied JSON files, regenerate `ecoregion-mapping.json` using the combined
refresh workflow or local importer, run `npm test` in `wanderlog`, and deploy the files together.
The workflow reads both checked-in international files through the same merge helper used by
the browser; it does not download or silently replace them.

## Real terrestrial biomes and ecoregions

Dataset load status and retry controls are available in the click/keyboard-accessible Settings menu,
not over the map legend. The header is layered above the map/fog. Fog uses an overscanned canvas
that follows Leaflet's animated zoom transform before repainting at the final zoom, with
geographic-radius scaling and radius-aware offscreen clearing.
The fog-removal checkbox and its JavaScript hooks remain commented out.
The header uses compact emoji buttons: Explore (the RPG map), Travel Ledger (Classic mode),
Scratch Map, Explorer Profile (character/stats), and Achievements. Explore is the only main-map navigation button;
entering that map always enables RPG fog. Reloading or importing restores the saved mode's matching
page (Explore or Travel Ledger), body styling and HUD together. Each button has a tooltip and accessible
label, visible keyboard focus, and an active-state indicator. Navigation wraps onto its own row
on small screens; mode behavior and saved travel records are unchanged.
**Classic mode hides the fog**: CSS hides the canvas, and hidden-map rendering is deferred.
Returning to RPG mode restores exploration fog. Destination pins default to
**None**, with **All**, **Visited**, **Wishlist**, **Transit**, and **Lived** selectable. Hiding pins does not hide
the home marker, erase visits, or stop visited destinations from clearing their fog.

### Travel Ledger and rendering performance

Local JavaScript URLs share a release query (`?v=20261015-ui2`) to prevent GitHub Pages'
10-minute asset cache from combining newly deployed HTML with older scripts. Bump this release
query on all local scripts when changing their code or dependent markup. No cache or saved
passport reset is required.

The Travel Ledger renders **50 destinations per page**, with Previous/Next controls and matching
result/range counts. Search and status/type filters still cover the **entire loaded catalog**, not just
the visible page. Changing a filter returns to page one; status edits retain the page when possible,
or clamp it when the result set shrinks. Search waits 150 ms after typing stops.
Repeated destination cards use solid backgrounds without backdrop blur.

Map markers, county hitboxes, canvas resizing and fog painting are skipped while another page is
open; returning to Explore refreshes deferred layers. Stats and fog-county membership are cached
against their relevant travel values and dataset identities, so edits, imports, persistence rollbacks
and dataset reloads cannot reuse stale results. Coordinate containment is reused across calculations
until the geography index changes. Map move events coalesce to one scheduled redraw per animation
frame. Fog polygon paths are cached at the current zoom, translated during pans and culled outside
the overscanned canvas; routes and auras are also culled without changing their reveal extents.
These optimizations do not change saved records, achievement rules or geography snapshots.

Wanderlog maps NPS and international destination **coordinates**, not park boundaries, to the
[RESOLVE Ecoregions 2017](https://ecoregions.appspot.com/) polygons, an update of WWF's 2001
Terrestrial Ecoregions framework. The 14 biome types replace all former curated game biome tags.
Ecoregion names and realms are shown in popups and the searchable ledger. Visited destinations
collect their intersected biome(s); wishlist entries do not. Saved visits remain intact, but biome
collections, biome XP, achievements, and related character classes are recalculated under the new framework.
No coastline, cave, volcanic, urban, or island label is passed off as a WWF terrestrial biome.

The published [`ecoregion-mapping.json`](wanderlog/ecoregion-mapping.json) is a small derived snapshot,
so browsers never download or process the 243 MB source shapefile. The current snapshot matches
3,624 of 3,862 destination points after merging the Wikidata query. The other 238 points have no terrestrial
intersection, including offshore/coastal NPS and international coordinates. These points
still count as visits but earn no terrestrial biome. No nearest-land snapping is performed.
Mappings include their sampled coordinates; new/changed coordinates are explicitly marked as
needing a refresh and cannot award stale biome credit.

### Rarity and limitations

Rarity is **game logic**, not an official WWF/RESOLVE conservation designation:

- Rare: less than 2% of classified biome land area, 65 XP on first collection.
- Uncommon: at least 2% but less than 10%, 30 XP.
- Common: at least 10%, 15 XP.

Global biome area shares are computed from unsimplified WGS84 polygons using Turf's spherical
geodesic area calculation (not the shapefile's square-degree `SHAPE_AREA`). Polygon holes and
multipart geometries are respected. Rock/ice and water classes 98/99 are excluded from the
14-biome denominator. Thresholds use unrounded area shares; displayed percentages are rounded.
This describes geographic extent, not remaining habitat, conservation threat, or rarity of wildlife.
Ecoregion membership describes the regional ecological framework, not a survey of present-day habitat
at an urban historic site or proof that a traveler encountered every ecosystem inside a park.
All 14 biome types are visible, including types with zero destinations in this catalog; collecting
every type may require expanding the destination catalog.

### Regenerating after destination/catalog changes

For a combined refresh, run **Actions > Import NPS catalog**. The workflow downloads NPS data,
regenerates biome mappings from the licensed RESOLVE source, and tests both datasets before
publishing them with compact boundary/coordinate geography in the same artifact. Deploy all four files together.

For an offline/local mapping refresh:

1. Download the [RESOLVE 2017 shapefile ZIP](https://storage.googleapis.com/teow2016/Ecoregions2017.zip)
   and extract it **outside the repository**. Keep the `.shp`, `.dbf`, and `.prj` files together.
2. From `wanderlog`, run `npm ci` (Node 22+ for the current data tooling), then
   `npm run import:ecoregions -- "C:\path\to\Ecoregions2017.shp"`.
3. Run `npm test`. Commit the regenerated `ecoregion-mapping.json` together with any changed
   `nps-parks.json` or international destination coordinates and deploy them together.

The importer streams source features, requires WGS84 and the source's CC-BY-4.0 license attribute,
and records provenance, the shapefile SHA-256, methods, areas, and generation time.
The downloadable source currently contains 847 distinct classified ecoregion IDs;
the [Earth Engine catalog](https://developers.google.com/earth-engine/datasets/catalog/RESOLVE_ECOREGIONS_2017)
describes 846. The generated snapshot records the actual source count, not a fabricated count.
Biome data failures disable biome collection/bonuses explicitly while keeping park visits working.
Home coordinates and scratch-map regions do not award biomes: their area/region selections are not
equivalent to verified visits at the mapped destination points.

### Attribution

Derived from **RESOLVE Ecoregions 2017**, Dinerstein et al. (2017),
[An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm](https://doi.org/10.1093/biosci/bix014),
updating WWF Terrestrial Ecoregions. Source geometry is licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Changes: point-intersection mappings and aggregated geodesic biome areas/game rarity.
Attribution and licensing are also displayed in the game and included in the derived dataset.

## NPS boundaries and custom coordinates (Step 2)

Fog remains entirely in the existing overscanned canvas. Visited NPS listings use polygons from
[`nps-boundaries.topojson`](wanderlog/nps-boundaries.topojson) when available, **instead of** an
85 km point aura. A 10 km-equivalent canvas shadow softens their edges at the current zoom.
International point-only destinations, and NPS listings with no matching boundary, retain their
existing auras. County hitboxes, cleared polygons, route corridors, zoom animation, and the home
aura continue using the same canvas. The tiered ledger now also promotes a custom point's containing county.

The source is the official [NPS Land Resources Division boundary service](https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2),
linked through [NPS GIS data resources](https://www.nps.gov/subjects/gisandmapping/tools-and-data.htm).
It contains legislative boundaries, not necessarily NPS-owned land, legal surveys, or navigational
guidance. Four-letter `UNIT_CODE` values match catalog IDs where possible. The combined API listing
`seki` explicitly uses both `sequ` and `kica` boundary geometries; other unmatched listings are
not guessed from names, nearby points, or parent parks. Multiple polygons per code are retained.
Settings reports mapped listings and loading failures; failure leaves point-aura fog functional.

### Logging a custom coordinate

Choose **Add custom location** or right-click/long-press the world map, enter a name and WGS84
latitude/longitude, and select Wishlist, Transited, Visited, or Lived. Optional category and purpose
tags attach to the POI itself. For trip dates, transit tags, and multiple stops, use Log Expedition.
Before saving a custom point, `Promise.all()` resolves:

- **Elevation:** the keyless [Open-Meteo elevation API](https://open-meteo.com/en/docs/elevation-api).
  Stored as meters and feet (`meters * 3.28084`); this is terrain elevation, not building height.
- **Political geography:** local D3 spherical containment against the loaded world/state/county
  atlases. Countries can be global; state and county coverage is U.S. only. Unmatched points remain
  unmatched, not snapped to a nearby landmass. Simplified atlases can miss small islands and give
  approximate coastal/border matches.
- **Biome/ecoregion:** local containment against [`ecoregions.topojson`](wanderlog/ecoregions.topojson),
  derived from the same CC-BY-4.0 RESOLVE source as the catalog snapshot. D3 ring winding is normalized
  and holes, multipart polygons, and antimeridian bounds are respected. Simplification makes this
  an approximate classification, **not guaranteed exact near a boundary**. Rock/ice and water
  are excluded. Existing catalog points still use their unsimplified precomputed mappings.
- **Location rarity estimate:** a direct, keyless [Overpass](https://overpass-api.de/) request for
  distinct tourism/amenity **nodes** and motorway/trunk ways within 5 km. The label uses mapped
  POI density with the requested bands: Uncharted `<10`, Hidden Gem `10–29`, Deep Cut `30–99`,
  Regional Staple `100–999`, Beaten Path `1,000–10,000`, Tourist Trap `>10,000`. These counts
  **are not review counts, visitor counts, or evidence of verified popularity**. OSM coverage
  varies, and node-only counts omit amenities represented only as ways/relations. Highway distance
  is a local point-to-segment estimate, reported separately; no road within the query radius means
  "not detected within 5 km", not a guessed wilderness-distance score.

Elevation and rarity requests disclose coordinates to their providers; the form explains this before
submission. No geocoding, Google/Mapbox keys, billing, or deployed Worker is added. Direct OSM fallback results use
a versioned 30-day browser cache keyed to a 0.001-degree coordinate grid (about 111 m north/south).
The query uses that same rounded point, avoiding inconsistent cache samples. No external requests
run merely for browsing saved pins. Failed/partial lookups do not save a pin or invent metadata:
the form reports a retryable error. Overpass may rate-limit or time out, especially in dense cities.
This personal-use fallback cache is separate from the shared Worker cache described in Step 3 below.

Use an HTTP development server or the deployed HTTPS site for API testing; external providers
can reject requests from a `file://` preview's null origin. The app still reports such failures
instead of saving incomplete data.

Custom locations live separately from catalog IDs and survive local storage, export/import,
shared read-only passports, and dataset retries. Reset removes them. Visited/Lived customs clear point auras and
contribute their real biomes/countries/states to the existing collection and XP calculations.
Wishlist/Transited customs do not earn visit credit. They appear in map filters and the searchable ledger but **do not count
as NPS/park visits or satisfy park-specific quests/achievements**. Elevation and density estimates
are displayed and power the progressive achievements described below. Open-Meteo and
OpenStreetMap contributor/ODbL credits appear with custom metadata.

### Regenerating compact geography

Run `npm ci` in `wanderlog` using Node 22+, extract the licensed RESOLVE ZIP outside the repository,
then run:

```sh
npm run import:geography -- "/path/to/Ecoregions2017.shp"
npm test
```

[`import-geography.mjs`](wanderlog/import-geography.mjs) paginates the current NPS service in WGS84,
checks completeness and exact unit codes, and simplifies locally with Mapshaper weighted
Visvalingam and `keep-shapes`. No data is uploaded to mapshaper.org. NPS keeps 1.5% of vertices;
fine TopoJSON quantization preserves tiny historic-site polygons. RESOLVE keeps 0.8% to meet the
1.8 MB uncompressed download budget (the published file is approximately 1.64 MiB, substantially
smaller over HTTP compression). NPS is approximately 559 KiB with a 750 KB uncompressed budget. These are measured limits,
not a promise that every future source refresh will fit the same size. Generation fails rather
than silently removing small boundaries or exceeding the budgets. Source hashes, dates, methods,
attribution, and RESOLVE licensing are embedded in both snapshots.

The **Import NPS catalog** workflow regenerates and tests all four datasets together.
Public datasets and API metadata can change; regenerate explicitly rather than relying on
runtime downloads of the large source geometries. Custom-coordinate classifications are retained
as their original sampled metadata, rather than silently rewritten when a dataset refreshes.

## Provider-agnostic rarity proxy and AppState v2 (Step 3)

[`rarity-config.js`](wanderlog/rarity-config.js) configures `rarityEndpoint`, defaulting to
`https://api.devonoverbey.com/rarity`. Set it to another HTTPS URL or `''` for direct OSM only.
There are no provider secrets in this configuration. New custom-coordinate lookups call the endpoint
with `lat` and `lng`. Saved-pin browsing, map redraws, and passport migration do not call it.
The client validates the returned contract before saving:

```json
{
  "placeName": "OSM vicinity (not a matched place)",
  "reviewCount": null,
  "popularityScore": 19,
  "rarityTier": "Hidden Gem",
  "matchedLat": 45.727,
  "matchedLng": -121.636,
  "cached": true,
  "source": "OpenStreetMap contributors (ODbL)"
}
```

`reviewCount` is a nonnegative integer **or null**, never fabricated from open data.
`popularityScore` is a nonnegative count-like integer; tiers use `reviewCount` when present,
otherwise this score. Thresholds are unambiguous: `<10`, `10–29`, `30–99`, `100–999`,
`1,000–10,000`, and `>10,000`. The source and sampled/matched coordinates are shown alongside the
metadata. The current match-distance guard is 1 km; a provider must resolve the intended POI
rather than substitute a famous nearby place. A proximity check alone cannot establish POI identity.
For the included Worker, these coordinates identify a **grid sample**, not an actual place match.

On timeout (35 seconds), HTTP error, invalid metadata, or a match over 1 km away, the client logs
the error and the form explicitly reports a switch to the direct Overpass lookup. It retains the
30-day browser-cached OSM density estimate and contributor attribution. If both paths fail, the
location remains unsaved. There is no automatic switch to Google, Mapbox, scraping, or paid APIs.
Any future review-count endpoint must independently license indefinite storage, derived tiers,
map display, exports, and share links; the adapter itself grants no data-use rights.

### Included open-data Cloudflare Worker

[`rarity-worker/worker.mjs`](wanderlog/rarity-worker/worker.mjs) uses only OpenStreetMap data
under ODbL. It returns `reviewCount: null`, a mapped tourism/amenity node count within 5 km,
and the corresponding **density estimate**. It includes source attribution, query time,
OSM database timestamp where provided, and separately calculated motorway/trunk proximity.
No Google/Mapbox credential, request, or review data is included. No Wikidata lookup is needed
for this density-based default.

The approximately 500 m grid adjusts longitude spacing to latitude, wraps the antimeridian,
and handles polar coordinates. The query always uses the cell's reported sample coordinates;
the versioned KV key refers to that same sample. This is not three-decimal rounding.
Successful OSM-derived results are written without KV expiration. They are historical samples,
not promises of current popularity; refresh/delete entries manually or change the versioned key
when a new snapshot is wanted. Neither HTTP nor failed/partial Overpass results are cached.
Concurrent misses are deduplicated within a Worker isolate, but KV is eventually consistent:
different isolates can still issue duplicate misses.

Responses include ODbL contributor attribution; retain it when displaying, exporting, or
redistributing this derived dataset and meet the applicable ODbL obligations. Open-data licensing
does not guarantee provider availability, current data, unlimited upstream usage, or legal
compliance for every future use.

The Worker restricts browser origins, accepts only `GET /rarity`, validates coordinates, and uses
a Cloudflare rate-limiting binding (20 requests/minute per client IP, per Cloudflare location).
CORS is not authentication; non-browser callers can still access this open endpoint. Rate
limiting is not a global quota guarantee. Configure Cloudflare account-level budgets/limits as
appropriate. The Worker never accepts a user-supplied upstream URL.

### Deployment (not performed automatically)

From `wanderlog`, install the declared tooling with `npm ci`, then:

```sh
npx wrangler login
npx wrangler kv namespace create RARITY_CACHE --config rarity-worker/wrangler.jsonc
```

Replace `REPLACE_WITH_CREATED_KV_NAMESPACE_ID` in
[`wrangler.jsonc`](wanderlog/rarity-worker/wrangler.jsonc) with the returned namespace ID.
Verify the custom domain route and `ALLOWED_ORIGINS` for your deployed site, and ensure rate-limit
namespace `1001` does not unintentionally share counters with another Worker. For local browser
testing, use a separate config with a localhost origin in the allowlist; never allow the `null`
origin in production just to accommodate `file://` previews.

```sh
npx wrangler deploy --dry-run --config rarity-worker/wrangler.jsonc
npx wrangler deploy --config rarity-worker/wrangler.jsonc
```

Deployment requires your authorized Cloudflare account and zone. Neither a KV namespace nor a
production Worker/custom domain is created by the source change. Until deployed, the default
endpoint can fail and trigger direct OSM fallback. Worker requests, KV reads/writes/storage,
and upstream capacity have separate limits; permanent caching is not a guarantee of zero cost
or a fixed 10 ms latency. Check your current plan before deployment. Development secrets/state
are ignored through `.dev.vars*` and `.wrangler/`.

### Passport versioning

AppState and new local saves, exports, and shared passports use `version: 2`.
Legacy/unversioned and version-1 passports migrate their existing OSM metadata to the canonical
rarity fields, preserving their coordinates, visits, biomes, counties, routes, and other records.
Old OSM counts remain density scores and **never become review counts**. Migration is idempotent
and does not re-query or reclassify saved visits. New provider metadata retains its source and
matched coordinates through imports/exports/shares.

Invalid/custom future-version passports produce visible errors. A stored unsupported version is
not overwritten by a new empty v2 save; editing is disabled until the issue is resolved.
Step 3 introduced rarity migration. The next phase extends the same v2 envelope with a compatible
trip ledger, tiered counties/custom POIs, and progressive achievements as described below.

Run `npm test` for repository and Worker tests. The tests mock upstream providers and KV:
they do not incur provider charges or deploy resources. `wrangler deploy --dry-run` verifies
the Worker bundle and declared bindings without a production deployment.

## Tiered travel ledger, expeditions and progressive achievements

[`travel-ledger.js`](wanderlog/travel-ledger.js) defines the four status tiers for catalog pins,
custom POIs, county FIPS codes and state/country keys:

| Tier | Color | Map and completion behavior |
| --- | --- | --- |
| `w` Wishlist | Pink | No fog clearing, XP or visited completion |
| `t` Transited | Slate | Point aura is 60% of the normal 85 km radius; no visited XP/stats |
| `v` Visited | Emerald | Full point/boundary clearing and visit XP/stats |
| `l` Lived / Home Base | Blue | Full clearing and credit for pins/POIs; manual county marks do not clear fog |

Expedition promotion respects `w < t < v < l` unless the explorer explicitly chooses a map status.
Map choices for parks, countries, states and counties are stored separately as status overrides,
including an explicit Unexplored choice, and take precedence over travel-derived display statuses.
They cycle Unexplored → Visited → Wishlist → Transited → Lived → Unexplored; park popups also have
direct status buttons. Changing a map status never edits or removes the original trip/location
records, and later ledger synchronization preserves the explorer's choice. The map's Visited filter
includes both Visited and Lived. Clearing a custom POI that belongs to a trip is disallowed to
prevent dangling history references.

Geolocation, quick picks, and **Photon by Komoot autocomplete with explicit result selection**
establish home. City and expedition searches send typed search text to `https://photon.komoot.io`
after a 300 ms input debounce. Click a suggestion to select its coordinates; typing or pressing
Enter never establishes home automatically. Enter/Escape dismiss suggestions and blur the search.
Selection clears the input and suggestions. Stale responses after typing, dismissal or selection
are ignored. Quick-pick buttons remain local. Unknown searches never invent a home location.
Local containment automatically sets the home county, state, and country to `l`; previous home
territories remain Lived. All homes use a 15-mile-diameter circular aura (7.5-mile / 12.07 km radius);
existing saved homes are normalized on load/import without losing their coordinates or Lived tiers. Missing geography
blocks a new home save with a visible retry message. Simplified coast/border coverage can leave
some parent matches unavailable; no county is guessed.
Successful registration flies to zoom 8 over 1.8 seconds, then briefly pulses the home aura on the
existing fog canvas. The pulse respects reduced-motion preferences and settles at the saved radius;
it adds no separate reveal layer. The Citadel grants a single derived +50 XP bonus, not another
bonus each time home changes.
Level 2 begins at 100 XP so establishing a Citadel (including its automatically credited home
state/country) advances the first level bar without immediately skipping the first level; later
thresholds continue quadratic growth. New explorers unlock **Scout**; established explorer classes
are still determined by their accumulated travel. Storage failures roll back home and region changes
before any camera flight, pulse, or success notification.
The Citadel onboarding dialog opens only when the saved browser passport has no home, decided
from local storage before the geography datasets finish loading. Returning explorers can choose
**Import Passport (.json)** there instead; the import waits for startup datasets, then closes the
dialog when the imported passport includes a home. A home chosen while datasets are still
loading is saved as soon as they finish. County biomes are resolved lazily for logged counties
only, rather than for the entire county atlas at startup.
New Visited/Lived park and custom-POI discoveries run a 1.2-second reveal pulse on the same canvas.
Point auras animate radius/opacity; NPS boundary reveals animate opacity and feathering without
distorting their geometry. Pulses begin only after successful persistence, including new POIs and
expedition promotions, and do not retrigger when an already visited location becomes Lived.
Reduced-motion preferences and Classic mode skip discovery animation.

County hitboxes use the existing `us-atlas@3/counties-10m.json` atlas. They remain transparent,
with hover outlines/tooltips only for travel-backed counties in RPG mode. Unexplored counties
have no hover targets or tooltips. Normal main-map clicks never edit county statuses.
Expedition map picking is temporarily unavailable; the itinerary uses searchable stops instead.
County polygons clear only from logged parks/custom POIs or expeditions, not manual Scratch Map
statuses or home selection alone. Home still marks its county Lived, with hover context and Scratch Map
completion, but starts with only the small circular aura. Any logged park/POI transit, visit or Lived
record, expedition, or legacy route/polygon clearing unlocks the entire home county, even if travel
is elsewhere. Wishlist and manual county/state/country marks do not trigger this growth. The reveal
is derived from saved travel records on reload/import; removing all qualifying travel restores the
starting circle. Travel records clear their exact county polygon with a feathered canvas fill.
State/country tiers describe completion in the Scratch Map; they do not erase
entire nations on the canvas merely because home marks their parents Lived.
Existing NPS/RESOLVE snapshots are reused without regeneration.

The Scratch Map offers **World Nations**, **United States**, and **US Counties**, reusing the
already-loaded atlas features. County mode uses Albers USA with a faint, noninteractive state-border
mesh for context. Colors are blue for Lived, emerald for Visited, slate for Transited, and pink
for Wishlist; Lived polygons have a lighter blue border. Countries, states, and counties all use
**Unexplored → Visited → Wishlist → Transited → Lived → Unexplored**. Map choices override
travel-derived statuses, including an explicit Unexplored choice, without modifying trips.
County edits use zero-padded FIPS IDs in `counties`; nation/state edits use `regions`.
The counter reports Visited/Lived and Transited totals for the current dataset only.
Edits persist transactionally and refresh Passport stats without revealing county fog.
Shared passports are read-only. No TopoJSON generation is needed for this view.

### 63 National Parks scratch-off

The **US National Parks (63)** toggle inside the existing Scratch Map includes only
the 63 National Parks, not monuments, historic sites, or other NPS units. It reuses the official
catalog and existing boundary snapshot; no geography import or regeneration is needed.
Redwood and American Samoa are included despite their unusual API designations.
It sits alongside World Nations, United States, and US Counties, without a separate navigation
page or header icon. Its 63-park checklist starts expanded.

Park clicks cycle **Unexplored → Visited → Wishlist → Transited → Lived → Unexplored**. Wishlist
is pink, Visited is emerald, Transited is slate, and Lived is blue. Map choices override
travel-derived statuses without changing expedition records. Ordinary park marks share the main
travel ledger and therefore reveal the corresponding park on the RPG map.

Sequoia and Kings Canyon have separate shapes and scratch records, although the NPS API/main
ledger combines them as `seki`. Existing combined visits initially count for both. The two
scratch statuses persist in `nationalParkScratch`; the combined ledger remains Visited if
either is visited, or Wishlist if either is wishlisted. Editing the combined ledger entry
resets the split override. Its existing combined RPG boundary behavior remains unchanged.

Regional backdrops and counters show **unstarted**, **in progress**, and **mastered** (every
park in that region visited). These geographic collection groups use traditional NPS regional
groupings, with Pacific Islands separated from Pacific West; they are not current administrative
boundaries. National Capital has none of the 63 parks and has no completion counter.
Yellowstone belongs to Intermountain and Cuyahoga Valley to Midwest.

The SVG supports scroll-wheel zoom, drag pan, and Reset zoom. Tiny or point-only parks have
clickable halos; American Samoa and the US Virgin Islands have labeled insets. An accessible
63-park checklist provides keyboard-friendly controls even where shapes overlap.
Missing boundaries are explicitly reported and use location badges; missing catalog/map
data shows retry guidance instead of a misleading completion count.

### Logging and editing expeditions

**🗺️ Log Expedition** on the map opens the wizard implemented in
[`expedition-ui.js`](wanderlog/expedition-ui.js):

1. Enter a trip name and an optional free-text **Reason for travel**. Start/end dates are optional;
   undated trips still earn location credit. **Day Trip?** sets both dates to the selected start date
   (or today if blank), keeps them synchronized, and records a single calendar day.
2. Search parks, saved POIs or counties locally. City/airport suggestions appear automatically
   through Photon after a 300 ms debounce; click a result to add it and clear the search.
   No separate search button is needed. `SAN` and `DEN` expand to
   their full airport names; other airports can be searched by full name or code.
3. Add stops in travel order, with a separate mode between each pair:
   **Drive / Road Trip**, **AWD/Off-Road**, **Flight**, **Ferry / Boat**, **Rail / Train**, or **Walk / Hike**.
   Reorder/remove stops as needed. Changing the itinerary invalidates its old preview.
4. **Preview routes**, then save. Driving/AWD legs use the FOSSGIS public OSRM road-routing
   service, with cached responses and requests spaced at least 1.1 seconds apart. Add intermediate
   stops if the suggested road route differs from your actual drive. US county credit uses segment
   intersections with the existing simplified county polygons, including narrow crossed counties.
   Ferry, rail, walking, and flight legs never call the road router. Ferry, rail, and walking
   legs use two-point direct approximations; flights use a dashed connector for orientation only.
   All these modes are dashed in previews and Travel Log mini-maps. Previously saved road-routed
   ferry legs are normalized to direct stop-to-stop geometry on load/import and when reopened.
   Ferry, rail, walking, and flight routes do not clear route fog or award intermediate counties;
   only their stops count.

The preview does not save visits or clear fog. No map picker is displayed.
For SAN → DEN → Aspen → DEN, select Flight, Drive, Drive: credit the airport/destination
counties and the counties on the approved drives, not those between San Diego and Denver.
The existing 40 km fog corridor follows routed driving/AWD legs only. Ferry, flight, rail, and walking
lines do not clear route fog.
The modal's collapsed **Map services & privacy** section explains which services receive searches
or coordinates and includes attribution. Road routing failure is explicit, never replaced with a fake
straight-line road route; ferry and rail lines are always approximate, dashed connectors, not routed paths.

Saving samples terrestrial stop elevations through Open-Meteo in batches of four, reusing existing
stop/POI elevations. These are stop samples, not terrain extremes along the drive; ocean-only
samples do not earn terrestrial elevation badges. A failed route/elevation/storage operation
retains the draft, displays the error, and saves no partial expedition or tier promotions.

**View logged expeditions** opens the profile's **Expedition History**, which lists locations,
per-leg modes, optional dates/reason, elevations and an **Edit expedition** button. History also
has a Log Expedition button. Editing a new-format trip restores its approved preview without
requiring another routing request unless its itinerary changes. Edits replace the original record,
not append a duplicate. Shared passports display history but cannot edit it.
Old imports without stop snapshots use their ordered coordinates as editable stops.
Saving promotes stops, driven counties and their known parent regions to `v`, preserving `l`.
New expedition-only promotions are tracked and recalculated on edits without deleting separate
manual visits, home credit or other trips' credit. Older ambiguous marks are preserved because
their original manual-versus-expedition source cannot be recovered.
Custom visited/lived POIs earn the same 25 base visit XP as catalog stops plus existing region/
biome collection credit; they remain excluded from NPS/park completion. Expeditions do not add
duplicate base XP for locations already visited, and badges do not add a separate XP bonus.

### Schema and migration

New v2 saves, exports and shares serialize `counties`, `customPois`, `expeditions` and
`expeditionPromotions` (prior-tier provenance for reversible trip edits) alongside
`pins`, `regions`, `homeBase`, legacy `routes` and `clearedPolygons`. `customLocations` remains an
internal compatibility accessor, not a second serialized ledger. Legacy `customLocations` retain
their rich lookup/provenance metadata and gain flat fields (`elevationFt`, `countyId`, `rarityTier`,
etc.); legacy `clearedCounties: {FIPS: true}` becomes Visited unless a stronger tier already exists.
New expeditions store optional `reason`, nullable start/end dates, `dayTrip`, and `routeLegs`
(`mode`, path `routeCoords`, crossed `countyIds`). Top-level `routeCoords` remain ordered stop
coordinates for location achievements; they are not a mixed-mode fog path. Flight legs store empty
path/county arrays. Route stops can be searchable `place` records as well as county/park/POI records.
Rich provider metadata remains intact; imported flat POIs without provider provenance are labeled
as such rather than given invented sources. Conflicting dual POI ledgers are rejected.
Migration is idempotent and performs no API lookups. Imports are validated before transactional
application; storage failures roll back the ledger and its derived tiers. Shared passports stay
read-only, and invalid/future saves remain protected from overwrite.
Browser-local saves compact long expedition paths with 1e-5-degree polyline encoding to reduce
storage use; geometry is expanded in memory on load and normal passport exports remain unchanged.
Recovery bundles that include `_unsavedExpeditionDraft` import that draft as a regular expedition,
so it can be restored after a failed quota-limited save.
The Travel Log estimates the encoded passport's local-storage use and warns around 3.5 MiB; saves
above a conservative 4.5 MiB budget are stopped before the browser's typical 5 MiB local-storage
ceiling. Browser quotas vary, so users should still export backups regularly. New unfinished
expeditions are autosaved separately in IndexedDB and can be restored after a refresh; the form
also offers a downloadable recovery JSON once its routes have been previewed. If IndexedDB is
unavailable, the form reports that and keeps the in-memory draft available for manual recovery.

### Progressive achievements

Every achievement family uses numeric `progress(stats)` and a `tiers` array, rather than a boolean
requirement. Achievements with zero progress are **not created in the DOM**. If none have started,
the dedicated **Achievements** page (🏆 in the header) displays:
*Venture out into the fog to uncover hidden achievements.* The profile retains biomes, quests and
expedition history; special achievement cards live on their own page. Each started family
shows only its highest completed tier and its next goal, with numeric counts and accessible progress
bars; later tiers stay hidden. For example, one park visit shows **First Steps** complete and
**Trailblazer** at 1/5, not the 15- and 30-visit goals. At the final tier only that completed milestone
remains. Park (1/5/15/30), biome (3 / total−1 / total), and state (10/50) milestones are grouped; NPS completion,
rare biomes, nations and metadata badges retain their separate families.

Each family has distinct emoji artwork on a colored tile (Earth Sandwich uses 🌍🥪 on dark blue).
Tier rarity represents achievement difficulty, not random drops or stat/XP multipliers:
**Common** gray/white, **Uncommon** green, **Rare** blue, **Epic** purple, **Legendary** gold,
and **Mythic / Exotic** a rainbow-gradient border/label. Rarity increases across multi-tier families.
The character banner displays earned badge icons only, using the highest completed tier per family;
partially progressed badges appear only on the Achievements page. Badge tooltips and accessible names
include the earned title, rarity and requirement; clicking one opens Achievements. Badges are derived
from saved progress rather than separately persisted, so edits/imports update them without duplicates.
NPS completion uses the loaded catalog size and is unavailable when its source fails.
Incomplete **Legendary** and **Mythic** tiers show their titles, achievement-specific cryptic hints
blurred with CSS, and a single unitless milestone count/percentage instead of exact criteria or a
progress bar. The exact completion criteria are omitted from the rendered card until earned. **Epic**
and lower tiers retain their explicit criteria and progress bars. Completing a secret tier reveals its exact
criteria, illuminates the card gold and unlocks its class-title badge; newly completed secret tiers
also trigger the level-up chime (when sound is enabled) and a notification. Reloading does not
replay completion effects. These display rules do not change saved progress or unlock requirements.
Lived grants the same completion credit as Visited. Metadata badges:

- **Under Pressure:** a visited/lived terrestrial POI or expedition stop below 0 ft.
- **Thin Air:** a visited/lived POI or sampled terrestrial expedition stop at or above 10,000 ft.
- **Whisper in the Woods:** a visited/lived Uncharted or Hidden Gem custom POI.
- **The Overlander:** 5 distinct stops on AWD/Off-Road legs; legacy trip-wide AWD tags remain supported.
- **The Mariner:** 3 expeditions tagged Ferry / Boat (the existing `ferry` tag).
- **Focal Length:** 10 photography-tagged visited/lived POIs and/or expeditions whose reason includes
  the word Photography. Legacy expedition purpose tags remain supported until edited.
- **Chasing Waterfalls:** 1, 5, and 10 visited/lived custom POIs whose category is exactly
  `waterfall` after trimming and case normalization. Wishlist/transit POIs do not count.
- **Southern Cross:** a multi-day expedition with a southern-hemisphere stop. Overnight stays
  default to the calendar-day difference between start and end dates; this is an itinerary-based
  inference, not verified overnight GPS data. Undated or single-day southern trips do not qualify.
- **Local Lore:** 5 distinct visited/lived Hidden Gem POIs in the current home county.
- **Zero Meridian:** establish a home base.
- **Junior Ecologist / Almost There! / Gaia Wanderer:** collect 3, all-but-one, and all
  terrestrial biomes, including existing expedition coordinate samples.
- **Beyond the Horizon:** a visited/lived coordinate more than 1,000 miles from the current home.
- **A Whole New World:** a visited/lived coordinate in a known country other than the home country;
  requires country containment for home and never guesses from missing labels.
- **Touch Grass:** visit a catalog entry designated as a National, State or Provincial Park.
  This uses catalog classification, not a new protected-area containment dataset; international
  catalog classifications remain subject to their existing source-quality caveats.
- **Fast Travel:** two stops more than 500 miles apart on the same calendar day, using single-day
  expeditions only. Stops from separate expeditions on the same date can qualify. Undated pins and
  undated expeditions and multi-day itinerary stops never receive fabricated visit dates.
- **Earth Sandwich:** two visited/lived points within 100 miles of exact antipodes.
- **The Long Dark:** a visited/lived point strictly north of 66.5° N or south of 66.5° S.
- **Pole to Pole:** at least 60 degrees between the northernmost and southernmost logged points.
- **Manifest Destiny:** visited/lived completion across the loaded US county atlas.
- **Fifty-Nifty:** visited/lived completion of all 50 US states.
- **How????:** complete all countries/territories represented in the loaded
  World Nations atlas. This is atlas coverage, not a complete sovereign-country census.
- **Country Roads, Take Me Home (Rare, 🛣️🏡):** visit/live in West Virginia and Shenandoah
  National Park, **or** West Virginia plus Blue Ridge Mountains (Blue Ridge Parkway qualifies)
  / Great Smoky Mountains National Park **and** Shenandoah River. Custom POIs qualify through
  exact trimmed, case-insensitive categories `Blue Ridge Mountains` and `Shenandoah River`.
  Progress has two milestones: West Virginia and the destination combination; mountains and river
  each supply half of the second milestone unless Shenandoah NP completes it outright.
- **Rocky Mountain High (Uncommon, 🏔️🎵):** visit/live in any Colorado county except Logan,
  Morgan, Sedgwick, Phillips, Washington, Yuma, Kit Carson, Cheyenne, Lincoln, Elbert, Kiowa,
  Crowley, Baca, Bent, Otero and Prowers. Matches known Colorado FIPS IDs, using county records,
  full custom POI counties, logged expedition counties and coordinate containment. Wishlist/transit
  county marks do not qualify; a home county marked Lived does. State-only Colorado marks do not
  establish which county was visited.

Transit and wishlist records cannot unlock full-visit achievements. Photography counts a tagged
POI and a tagged expedition as independent logged records; repeating a POI across expeditions
does not create extra POI records. Distance/span badges use coordinates from full-visited catalog
entries, custom POIs and logged expeditions, not the home point alone. County expedition coordinates
remain representative centroids. All progress is derived from saved records and updates after
edits, imports and home changes; no new passport fields or external requests are required.
**Deferred:** Borderlands (international-border metadata), Off the Grid (highway/city distances),
Ghost Town (settlement/population evidence), Standing on the Edge of Tomorrow (timezone crossing),
Mr. Worldwide and Pangea Reconstructed (continent mapping).
These badges have no cards until their prerequisites can be supported.
Run `npm test` for migration, rank, threshold, fog, persistence,
wizard-failure, and disclosure regression tests; no geography import is needed.

### Bucket List filtering

The Bucket List's **Destination type** filter combines with search and travel status, with a live
matching-result count. **US National Parks (NPS)** selects only official NPS national-park
designations, including combined Park & Preserve listings. **All NPS Sites** includes every NPS
designation. Both exclude international and custom locations, include U.S. territories, and count
combined API listings once (not necessarily the administrative count of national parks).
American Samoa is included explicitly because its official NPS record leaves `designation` blank.
The other designation filters are explicitly labeled **NPS**.
**National Parks — Worldwide** includes international catalog entries with the existing
curated/Wikidata classification caveats. NPS categories use official `designation`, not words in
the destination name: monuments, historic sites/parks, memorials, battlefields, preserves,
shores, recreation areas, rivers, trails and parkways are selectable. Combined designations
can appear in multiple applicable groups (e.g. National Park & Preserve). Other NPS designations,
the international catalog, and custom locations have separate options. Filters stay selected
while marking destinations off; changing a visit status can remove it from the current results.

### Radar contributions

The radar preserves existing scales and adds custom visits and expedition metadata:

- **Nature:** (visited catalog/custom locations + Photography expeditions) / 25.
- **Adventure:** (visited locations in biomes 5/10/13 + AWD or Foot expeditions) / 10.
- **Remoteness:** (visited locations in biomes 6/11 + Foot expeditions) / 6.
- **Worldly:** (visited nations + Ferry, Rail or Flight expeditions) / 15.
- **Roadtrip:** visited states / 30 + visited/lived loaded counties / 100 + Road/AWD expeditions / 30.

Each axis is capped at 1. Multiple matching tags within one axis count an expedition only once;
the same expedition can contribute to different axes. Wishlist/transit locations do not earn
full-visit radar credit, and unknown/unloaded county IDs do not count. Radar contributions affect
the displayed archetype, not base visit XP or the one-time Citadel bonus. New road legs follow
OSRM road geometry; legacy road-only routes retain their stored paths. Legacy mixed-mode trips
with a Flight, Ferry, Rail, or Walk tag conservatively draw no land corridor until edited into explicit
legs; legacy ferry-only routes may still clear sampled offshore water through the water mask.
GPX/KML import is not included.

## Homepage analytics

`index.html` logs anonymous `page_visit` and `link_click` events (`href`, `label`, `section`) to the Supabase `site_events` table. Events are skipped on localhost/file previews and when the owner account (`devonoverbey@gmail.com`) is signed in on this browser.

- Setup: run [`site-analytics.sql`](site-analytics.sql) once in the Supabase SQL editor.
- Dashboard: `/site-admin.html` (unlisted, `noindex`). Shows homepage analytics plus collapsible Cultivate (`cultivate_events`, `cultivate_waitlist`) and 12-Week Year (`twelve_week_year_events`) sections. Only the admin email can sign in or read the data.