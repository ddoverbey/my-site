# Wanderlog

Wanderlog is a browser-based travel atlas and journal. Explore a fog-of-war map, record places and
expeditions, track parks and regions, and earn achievements from your travel history.

## Features

- An RPG world map with visit statuses, a travel ledger, and country, state, province, and county views.
- Custom places and expedition logs with ordered stops, travel modes, route previews, and journal entries.
- KML and GeoJSON route imports, a Global Route Map, and PNG route-poster export.
- Progress for parks, regions, elevations, rarity, and terrestrial biomes.

Biome credit comes from logged stops and sampled land routes. Road, AWD, rail, and walking route
geometry can count; flight and ferry transit geometry does not. Flight and ferry stops can still count.

### Biome rarity

Biome rarity is based on each biome's share of classified terrestrial land area. First-time biome
collections award XP according to the same tier:

| Tier | Share of classified biome land | First collection XP |
| --- | ---: | ---: |
| Common | 10% or more | 15 |
| Uncommon | 2% to less than 10% | 30 |
| Rare | 0.5% to less than 2% | 65 |
| Epic | 0.25% to less than 0.5% | 100 |
| Legendary | 0.1% to less than 0.25% | 150 |
| Mythic | Less than 0.1% | 200 |

The **Rare+ Biomes** statistic and **Anomaly Seeker** achievement count Rare, Epic, Legendary, and
Mythic biomes. The current dataset has no Mythic biome.

### Location rarity

Catalog parks use saved rarity data when available and otherwise derive a consistent badge from
their local catalog metadata, so opening a passport or viewing the Travel Ledger does not need
network rarity lookups. Newly saved custom and Photon places, and expedition stops, can be enriched
in the background; if a rarity service is unavailable, the place remains saved and usable without
a rarity badge.

## Run locally

There is no build step or `npm start` script. Serve this directory over HTTP; opening `index.html`
directly as a `file://` URL can prevent the app from loading its local geography files.

On Windows, from this directory:

```powershell
py -m http.server 8000
```

On macOS or Linux:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000> and stop the server with `Ctrl+C` when finished. The app loads some
libraries, map tiles, and lookup services from external providers, so those features require an
internet connection.

## Passport data

Your editable passport is saved in the browser. Use the in-app JSON export to create a backup or
move it to another browser or device; import that file there to continue. Keep backups before
resetting browser data.

Searches and some coordinate lookups contact external services. The app's **Map services & privacy**
section describes which information is sent for each feature. Imported route files are processed
locally; imported driving and AWD tracks are not sent to the road router.

## Data files

The app loads its catalog and compact geography snapshots from this directory. Key files include:

- `nps-parks.json` and `nps-boundaries.topojson` for the National Park Service catalog and boundaries.
- `worldwide-national-parks.json` and `wikidata-national-parks-query.json` for international park data.
- `ecoregion-mapping.json` for park biome mappings, and `ecoregions.topojson` plus `mangroves.topojson` for coordinate lookups.
- `world-subdivisions.topojson`, `world-admin2.topojson`, and `micro-states.topojson` for map boundaries.

Biome and political-boundary matching uses simplified geographic data and may be approximate near
coasts or borders; mangrove matches use a separate detailed coastline layer. See the [repository README](../README.md) for
data sources, attribution, refresh procedures, and implementation details.

## Development and tests

Use Node.js 22 or newer for the development tools and test suite. From this directory:

```sh
npm ci
npm test
```

The tests cover park catalogs, ecoregions, coordinate lookup, geography, rarity, and the travel
ledger. Data importers are available through the scripts in `package.json`; consult the repository
README before regenerating or replacing checked-in data.
