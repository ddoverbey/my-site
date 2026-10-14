# my-site

## Wanderlog NPS catalog

Wanderlog loads a static snapshot fetched directly from the [NPS API](https://www.nps.gov/subjects/developer/get-started.htm).
Players do not need an API key, and no key is included in the site.

### One-time setup (or a later refresh)

1. Obtain a free NPS API key. Do **not** put it in a text file or commit it.
2. In this GitHub repository, open **Settings > Secrets and variables > Actions > New repository secret**.
   Name the secret `NPS_API_KEY` and paste the key into its value.
3. Push the importer and workflow changes, then open **Actions > Import NPS catalog > Run workflow**.
4. Download the successful run's `nps-catalog` artifact, unzip it, and add both `nps-parks.json` and
   `ecoregion-mapping.json` to the
   tracked [`wanderlog/`](wanderlog/) directory (capitalization matters on GitHub Pages).
5. Commit and deploy that dataset with the site. Repeat steps 3-5 only when you want a refresh.

The importer paginates the complete `/parks` endpoint, checks for 400+ unique records and valid metadata,
and preserves the API's official names, designations, coordinates, descriptions, topics, activities, and other fields.
The endpoint includes NPS listings of multiple designations and related areas; its record count is not
necessarily the administrative count of NPS units. Combined API listings such as Sequoia and Kings Canyon
count once. Missing coordinates remain in the ledger but do not get invented map locations.

Existing saves, imports, and shared passports migrate to NPS park codes. Visited status takes precedence
when old IDs map to a combined listing. Quest targets and completion totals use those same listing IDs.
International destinations remain curated separately. The snapshot date and any catalog-loading failure are visible in the game.
Until the generated dataset is published, only the international destinations are available.

For local generation, set `NPS_API_KEY` in the current shell and run `node .\wanderlog\import-nps.mjs`.
Node 16+ is sufficient; the workflow uses Node 22. Test without a key using
`node .\wanderlog\nps-catalog.test.mjs`. That test needs no packages; the ecoregion importer and full
test suite use the development dependencies in `wanderlog/package.json`.

## Real terrestrial biomes and ecoregions

Dataset load status and retry controls are available in the click/keyboard-accessible Settings menu,
not over the map legend. The header is layered above the map/fog. Fog uses an overscanned canvas
that follows Leaflet's animated zoom transform before repainting at the final zoom, with
geographic-radius scaling and radius-aware offscreen clearing.
The fog-removal checkbox, its JavaScript hooks, and classic-mode fog removal are commented out
for optional restoration; the map stays shrouded in either mode. Destination pins default to
**None**, with **All**, **Visited**, and **Wishlist** still selectable. Hiding pins does not hide
the home marker, erase visits, or stop visited destinations from clearing their fog.

Wanderlog maps NPS and international destination **coordinates**, not park boundaries, to the
[RESOLVE Ecoregions 2017](https://ecoregions.appspot.com/) polygons, an update of WWF's 2001
Terrestrial Ecoregions framework. The 14 biome types replace all former curated game biome tags.
Ecoregion names and realms are shown in popups and the searchable ledger. Visited destinations
collect their intersected biome(s); wishlist entries do not. Saved visits remain intact, but biome
collections, biome XP, achievements, and related character classes are recalculated under the new framework.
No coastline, cave, volcanic, urban, or island label is passed off as a WWF terrestrial biome.

The published [`ecoregion-mapping.json`](wanderlog/ecoregion-mapping.json) is a small derived snapshot,
so browsers never download or process the 243 MB source shapefile. The initial snapshot matches
459 of 486 destination points. The other 27 points have no terrestrial intersection, including
some offshore/coastal NPS coordinates and two curated international coordinates. These points
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
publishing them in the same artifact. Deploy the two JSON files together.

For an offline/local mapping refresh:

1. Download the [RESOLVE 2017 shapefile ZIP](https://storage.googleapis.com/teow2016/Ecoregions2017.zip)
   and extract it **outside the repository**. Keep the `.shp`, `.dbf`, and `.prj` files together.
2. From `wanderlog`, run `npm ci` (Node 16+), then
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

## Homepage analytics

`index.html` logs anonymous `page_visit` and `link_click` events (`href`, `label`, `section`) to the Supabase `site_events` table. Events are skipped on localhost/file previews and when the owner account (`devonoverbey@gmail.com`) is signed in on this browser.

- Setup: run [`site-analytics.sql`](site-analytics.sql) once in the Supabase SQL editor.
- Dashboard: `/site-admin.html` (unlisted, `noindex`). Shows homepage analytics plus collapsible Cultivate (`cultivate_events`, `cultivate_waitlist`) and 12-Week Year (`twelve_week_year_events`) sections. Only the admin email can sign in or read the data.