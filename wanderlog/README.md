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
- `ecoregion-mapping.json` and `ecoregions.topojson` for park biome mappings and coordinate lookups.
- `world-subdivisions.topojson`, `world-admin2.topojson`, and `micro-states.topojson` for map boundaries.

Biome and political-boundary matching uses simplified geographic data and may be approximate near
coasts or borders. See the [repository README](../README.md) for data sources, attribution, refresh
procedures, and implementation details.

## Development and tests

Use Node.js 22 or newer for the development tools and test suite. From this directory:

```sh
npm ci
npm test
```

The tests cover park catalogs, ecoregions, coordinate lookup, geography, rarity, and the travel
ledger. Data importers are available through the scripts in `package.json`; consult the repository
README before regenerating or replacing checked-in data.
