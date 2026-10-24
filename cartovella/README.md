# Cartovella

Cartovella is a browser-based travel atlas and journal. Explore a fog-of-war map, record places and
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

### XP and leveling

XP is recalculated from your saved travel progress; it is not a separate spendable balance. Repeated
visits to the same place do not award duplicate location XP. Every saved expedition also contributes
XP based on its recorded distance; trips are recalculated from the passport, so editing or removing a
trip updates its XP rather than leaving a separate balance behind.

| Progress | XP |
| --- | ---: |
| Each visited park destination | 25 |
| Each visited custom location | 25 |
| Each distinct visited US state | 10 |
| Each distinct visited country | 20 |
| Establishing a home Citadel | 50 |
| First collection of a biome | 15–200, based on its rarity tier above |
| Each logged expedition | 5 base XP, plus 1 XP per full 25 route miles (up to 30 distance XP) |
| Completing a questline | Varies by questline |

An expedition can earn up to 35 XP. Distance is summed across its route legs; when route geometry is
unavailable, Cartovella estimates each leg between its ordered stops. Flight and ferry distances count
for expedition XP even though those modes do not count toward land-route biome credit. A trip without
measurable distance still earns the 5 base XP.

Home-base geography can also count its state, country, and home-county biome. The Citadel bonus is
included while a home base is set; changing the home location does not award another 50 XP. Quest
bonuses are calculated once from the current passport. Park questlines complete when every listed
destination is visited; expedition questlines use distinct saved trip records:

| Questline | Bonus XP |
| --- | ---: |
| The Mighty 5 | 150 |
| Cascade Volcanoes | 120 |
| The Last Frontier | 250 |
| Subterranean Odyssey | 140 |
| The Desert Furnace | 180 |
| Realm of the Ancients | 150 |
| Archipelago Wanderer | 200 |
| Local Rambler — log 3 trips of 100 miles or less | 75 |
| Long Haul — complete one trip of at least 500 miles | 100 |
| Crossing Paths — one trip with stops in 3 US states or 2 countries | 125 |

Local Rambler counts trips with measurable route distance; a trip with no recorded stops or route
geometry earns its base expedition XP but cannot count toward the 100-mile quest.

Level 1 begins at 0 XP. Level 2 requires 300 XP, so establishing a home Citadel alone will not
advance a new explorer to Level 2. Later thresholds rise quadratically:

| Level reached | Total XP required |
| ---: | ---: |
| 2 | 300 |
| 3 | 405 |
| 4 | 580 |
| 5 | 825 |
| 6 | 1,140 |
| 7 | 1,525 |
| 8 | 1,980 |
| 9 | 2,505 |
| 10 | 3,100 |

For level `n` (2 or higher), the threshold is `265 + 35 × (n − 1)²` total XP. The XP bar shows
progress from the current level's threshold to the next one. Gaining a level displays a top-center
level-up banner with a chime; newly earned achievements appear separately in a centered, dismissible
notification with their artwork.

**America the Beautiful** is a Legendary achievement for visiting all 64 US National Parks.
It uses the National Parks scratch-map ledger, including separate Sequoia and Kings Canyon
statuses; visited and lived locations count, but wishlist and transit locations do not.
**Completionist Legend** is Mythic and requires every non-international NPS catalog listing,
including other NPS designations such as monuments and historic sites.

Numeric levels do not have individual hard-coded names or a maximum level. The Explorer Class shown
alongside a level is a separate title based on travel progress; for example, **Level 9 · Park
Completionist** means the explorer has reached the Level 9 XP threshold and currently has the Park
Completionist class. The current hard-coded Explorer Classes are:

| Explorer Class | Description |
| --- | --- |
| Fresh Recruit | Default class before establishing a home Citadel. |
| Scout | Default class after establishing a home Citadel, until a travel archetype qualifies. |
| Alpine Ranger | Explorer of conifer forests, montane grasslands, and arid shrublands. |
| Park Completionist | Devoted explorer of national preserves and wild sanctuaries. |
| Biome Hunter | Explorer of boreal forests and tundra ecoregions. |
| Globetrotter | Crosser of oceans and student of international cultures. |
| Pioneer Wayfarer | Master of highways, state borders, and open skylines. |

### Explorer character

The Explorer Profile character stage composites the gendered base, skin tone, hairstyle, and outfit
sprite layers from the bundled GandalfHardcore asset packs. The 58x Hair bundle supplies 58
gender-specific hairstyle sprites (28 male and 30 female). One appearance picker combines each
available hairstyle with its hair color, with labels such as “Hairstyle 1: Chestnut.” Character sprite catalogs,
layer composition, unlock rules, backgrounds, and companion rendering live in `character-creator.js`;
character settings are stored in the passport and included in local, cloud, export, and shared saves.
GandalfHardcore asset folders are grouped under `assets/gandalfhardcore/`; source ZIP archives remain
in `assets/Zips/`.
The character layers use aligned 800×448 sheets and a 32×48 crop around the first character
frame. Character, hairstyle, wardrobe, companion, and background selectors show visual previews.
Opening the character editor focuses and jumps directly to the customization controls above the
character stage. Appearance contains skin tones and special skins, plus a compact full-width
hairstyle picker that keeps its preview, name, and arrows separate. Hairstyle arrows cycle through
unlocked style/color choices; expand "Browse all hairstyles" for the optional visual dropdown.
Pets and their accessories are available only in Pets.
Wardrobe and Coin Shop use one compact outfit-layer selector at a time, with previous/next
arrows and an optional "Browse all" list. The live character preview stays beside the editor
on wide screens and stacks above it on smaller screens. Arrows only equip owned items or
unlocked progression gear; they never purchase items. Unowned shop items remain in "Browse all"
with their coin prices, where selecting an affordable item explicitly purchases and equips it.
Dog hats and backpacks use the same idle-frame
origin and scale as the equipped dog; their selectors are disabled when no dog is equipped.
Companion catalog entries can use an `imageSrc` PNG or a cropped sprite-sheet animation. All five dog coat variants
(golden, slate, sandy, cream, and shadow) use five 32×32 walking frames from the corresponding
`assets/gandalfhardcore/GandalfHardcore Pet companion/GandalfHardcore Pet companion/GandalfHardcore doggy sheet*.png`
spritesheets and render at 26×17 logical pixels. Black (Cat 1), ginger (Cat 2), and white (Cat 3)
companions use the eight-frame “Lick paw lie front” sequence (row 13) from their respective
`assets/cat-PACK/PACK/cat N (64х64).png` spritesheets. The Trail Fox keeps its 20×12 logical-pixel
size and uses its five populated 32×32 frames; Blue Wisp and Outlined Blue Wisp use five 32×32 frames each from the
same pet bundle. Legacy puppy/kitten pet IDs migrate to the golden dog
and black cat so saved characters continue to load. The bundled dog-asset readme permits use in
projects but prohibits redistributing or repackaging the artwork.
Character-stage backgrounds use the supplied 3200×1800 artwork in
`assets/backgrounds/`, scaled to the stage's 160×90 logical size. Campfire Night includes
the eight-frame `assets/campfire/Small_sheet.png` animation, positioned over the background's
glowing ground area; the animation runs only while Campfire Night is equipped. Green Hills is
available from the start. Yellowstone, Grand Canyon, Redwood, Arches, and Yosemite scenes
unlock individually when their corresponding national park has been visited.

Stats stop resolving county biomes once every catalog biome is already collected. This
avoids redundant polygon lookups when importing completionist or fully unlocked test passports.
Passport imports prepare park geography in small batches, yielding between batches and showing
progress before replacing the current records. Back up real travel data before importing synthetic
test passports, and keep test passports separate from accounts used for real cloud saves.

Level, worldwide-destination, and existing achievement milestones unlock wardrobe and companion
cosmetics. Cartovella does not yet verify Pro purchases or
donations, so client-side profile values do not establish paid entitlements.

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
