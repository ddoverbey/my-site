# Cartovella

Cartovella is a browser-based travel atlas and journal. Explore a fog-of-war map, record places and
expeditions, track parks and regions, and earn achievements from your travel history.

## Features

- An RPG world map with visit statuses, a travel ledger, and country, state, province, and county views.
- Custom places and expedition logs with ordered stops, travel modes, route previews, and journal entries.
- KML and GeoJSON route imports, a Global Route Map, and PNG route-poster export. Water Transit
  routes are blue, while flights use a neutral gray in the map and trip logs.
- The Explorers' Guild refreshes its directory when opened and shows opted-in explorers' character
  scenes and compressed snapshots of the same complete Global Route Map, including its trip routes
  and stops.
- Progress for parks, regions, elevations, rarity, and terrestrial biomes.
- Clickable biome and destination pins show the trips, stops, and saved places contributing to them.
- Achievements are grouped into expandable milestone classes and sorted by rarity, with unmet classes
  at the bottom. Expanded tiers run highest to lowest, omit the highest earned tier already shown in
  the class summary, and keep an unearned capstone at the bottom. Single-tier achievements show their
  descriptions without a dropdown; rarity colors style labels and borders, while each achievement
  has its own background art palette. International country milestones, including Terra Incognita,
  Globetrotter, and How????, share one class.
- Waterfall achievements automatically recognize visited locations whose names or categories include
  “waterfall”; Focal Length counts photos saved to trip journals.

The Biome Pokédex uses the matching badge art from `assets/biome-badges/`; uncollected biomes
show their badges in grayscale and dimmed, while collected badges retain their full color.

Biome credit comes from logged stops and sampled land routes. Road, AWD, rail, and walking route
geometry can count; flight and Water Transit geometry does not. Flight and Water Transit stops can still count.

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

Questlines are available both on the Explorer Profile and on their own Main Questlines page. Open a
quest card to see its exact requirement, park visit statuses, and the saved expedition logs that
qualify or are closest to qualifying.

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
including other NPS designations such as monuments and historic sites. Both join **Grand Voyager**
in the expandable Park Explorer path, so the full park progression is visible together.

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
sprite layers from the bundled GandalfHardcore asset packs. The 58x Hair bundle supplies 28 male
and 30 female hairstyles plus three shared extra styles. The original character pack supplies the
first five hairstyles for both sprites. The catalog also includes a Bald option for each sprite.
One appearance picker combines each available hairstyle with its hair color, with labels such as
“Hairstyle 1: Chestnut.” Hair color palettes are normalized across the differently colored source
sheets, so each color choice is consistent between styles. Ranger hats are centered on the character.
Character sprite catalogs, layer composition, unlock rules,
backgrounds, and companion rendering live in `character-creator.js`;
character settings are stored in the passport and included in local, cloud, export, and shared saves.
The sprite picker is labeled Sprite A and Sprite B; internal male/female keys remain for mapping
each choice to its source art. Ranger hats mask the upper edge of hairstyles, while allowing hair to
show below the hat. Shirts, bottoms, and shoes can be unequipped independently, including
when a one-piece outfit such as a bikini is selected. The wardrobe includes skirt, black short skirt,
and pants options.
GandalfHardcore asset folders are grouped under `assets/gandalfhardcore/`; source ZIP archives remain
in `assets/Zips/`.
The character layers use aligned 800×448 sheets and a 32×48 crop around the first character
frame. Character, hairstyle, wardrobe, companion, and background selectors show visual previews.
Opening the character editor focuses and jumps directly to the customization controls above the
character stage. Appearance contains skin tones and special skins, plus a compact full-width
hairstyle picker that keeps its preview, name, and arrows separate. Hairstyle arrows cycle through
unlocked style/color choices; expand "Browse all hairstyles" for the optional visual dropdown.
Character Effects are selectable in Appearance and animate automatically when equipped; they remain
available in Wardrobe and the Coin Shop for browsing and purchase.
Pets and their accessories are available only in Pets.
Wardrobe and Coin Shop use one compact outfit-layer selector at a time, with previous/next
arrows and an optional "Browse all" list. The live character preview stays beside the editor
on wide screens and stacks above it on smaller screens. Arrows only equip owned items or
unlocked progression gear; they never purchase items. Unowned shop items remain in "Browse all"
with their coin prices, where selecting an affordable item explicitly purchases and equips it.
The Pets panel includes a pet-specific Animation style selector; changing it previews the selected
sequence on the live stage and stores the choice with the character. Dog coats share the five-frame
Walk and six-frame Leap sequences from rows 0 and 1 of
`assets/gandalfhardcore/GandalfHardcore Pet companion/GandalfHardcore Pet companion/GandalfHardcore doggy sheet*.png`.
Dog hats and backpacks follow the selected dog frame and row; their selectors are disabled when no
dog is equipped. The Trail Fox has matching five-frame Walk and six-frame Leap sequences. Both Wisp
companions use their five-frame Float sequence.

Black (Cat 1), ginger (Cat 2), and white (Cat 3) companions expose every occupied animation row from
their respective `assets/cat-PACK/PACK/cat N (64х64).png` sprite atlases. The existing Lick Paw ·
Front animation (row 13) remains the default. Bunny exposes every populated sequence from
`assets/Bunny/Bunny 1 16x16 animation.png`; each animation frame spans two 16px atlas rows, so the
full 32×32 frame is used to keep the Bunny's head and body together. The atlas exposes 34 animation
sequences, including the paired rows 32–33, 36–37, and 38–39. Recognizable motions such as turning,
scurrying, running, and hopping use inferred names; unclear sequences keep their row labels. The
default animation uses rows 32–33.
These atlas files contain no animation tags or action labels; choices use an inferred name where the
motion is recognizable and otherwise include the sequence number and source row.
Legacy puppy/kitten pet IDs migrate to the golden dog
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

The Explorer Profile's Cabinet of Curiosities lists visited and lived parks and custom places,
shows their rarity badges and rarity-coin totals, and lets you filter discoveries by tier. The
Travel Ledger can filter by a specific rarity tier or sort destinations from rarest to most common;
destinations without rarity data sort last. When a visited custom place receives its first rarity
appraisal, Cartovella shows the tier, available review/popularity and highway-distance provenance,
and the existing rarity coin and visit-XP rewards. Rarity coins are 10 for Tourist Trap, 15 for
Beaten Path, 20 for Regional Staple, 25 for Deep Cut, 30 for Hidden Gem, and 35 for Uncharted.

Rarity lookups use the browser's validated local cache first, then the shared
`cartovella_rarity_cache` table in Supabase, then the configured rarity provider. The shared table
must be provisioned with the coordinate key, rounded latitude/longitude, rarity tier, rarity JSON,
and update timestamp fields, with the public app role allowed to read and upsert cache rows. Cache
read/write failures are logged and do not prevent provider lookups. The Worker can optionally use
Google Places review counts when its `GOOGLE_PLACES_API_KEY` secret is configured; without it, the
Worker uses open-data classification. Named custom places, Photon places, and expedition stops
include their name and coordinates in the lookup. The Worker only accepts a nearby Google result
whose name matches the query; otherwise, it falls back to an open-data density estimate. Named
lookup cache entries are separate from coordinate-only entries so a nearby attraction's reviews
aren't reused for a different place. Open-data fallbacks for named lookups are not treated as
confirmed name matches or cached as named appraisals, so saved custom places keep their retry
control until Google confirms the place. Failed coordinate-entry appraisals leave the location
saved and report that the rarity lookup needs a retry. Deploy the updated rarity Worker as well as
the browser app to enable named Google searches. The Worker also allows the Cartovella preview
origins `http://127.0.0.1:8766` and `http://localhost:8766`. The optional Esri imagery token can be set as
`CartovellaConfig.esriApiKey` in
`rarity-config.js`.

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

If Cloud Sync reports that the session needs reconnection or that a refresh token was not found,
open **Account and cloud sync** and sign in again. The rejected cloud session is cleared, but your
local passport is kept. Do not clear browser storage just to fix a cloud sign-in problem.

Searches and some coordinate lookups contact external services. The app's **Map services & privacy**
section describes which information is sent for each feature. Imported route files are processed
locally; imported driving and AWD tracks are not sent to the road router.

Public Explorer Directory listings include the saved character scene (including its selected
background), summary stats, recent shared expedition details, and a low-resolution image of logged
routes. Only profiles explicitly marked public appear in the directory; route previews reveal
approximate travel geography, so keep the listing private if you do not want that shared.

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
