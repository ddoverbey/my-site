# my-site

## Wanderlog NPS catalog

Wanderlog loads a static snapshot fetched directly from the [NPS API](https://www.nps.gov/subjects/developer/get-started.htm).
Players do not need an API key, and no key is included in the site.

### One-time setup (or a later refresh)

1. Obtain a free NPS API key. Do **not** put it in a text file or commit it.
2. In this GitHub repository, open **Settings > Secrets and variables > Actions > New repository secret**.
   Name the secret `NPS_API_KEY` and paste the key into its value.
3. Push the importer and workflow changes, then open **Actions > Import NPS catalog > Run workflow**.
4. Download the successful run's `nps-catalog` artifact, unzip it, and add `nps-parks.json` to the
   tracked [`wanderlog/`](wanderlog/) directory (capitalization matters on GitHub Pages).
5. Commit and deploy that dataset with the site. Repeat steps 3-5 only when you want a refresh.

The importer paginates the complete `/parks` endpoint, checks for 400+ unique records and valid metadata,
and preserves the API's official names, designations, coordinates, descriptions, topics, activities, and other fields.
The endpoint includes NPS listings of multiple designations and related areas; its record count is not
necessarily the administrative count of NPS units. Combined API listings such as Sequoia and Kings Canyon
count once. Missing coordinates remain in the ledger but do not get invented map locations.

Existing saves, imports, and shared passports migrate to NPS park codes. Visited status takes precedence
when old IDs map to a combined listing. Quest targets and completion totals use those same listing IDs.
International destinations remain curated separately. Biome tags are game metadata: existing curated
tags are retained, and other listings use matching NPS topics where available; these are not official
NPS biome classifications. The snapshot date and any catalog-loading failure are visible in the game.
Until the generated dataset is published, only the international destinations are available.

For local generation, set `NPS_API_KEY` in the current shell and run `node .\wanderlog\import-nps.mjs`.
Node 16+ is sufficient; the workflow uses Node 22. Test without a key using
`node .\wanderlog\nps-catalog.test.mjs`. No packages need installing.

## Homepage analytics

`index.html` logs anonymous `page_visit` and `link_click` events (`href`, `label`, `section`) to the Supabase `site_events` table. Events are skipped on localhost/file previews and when the owner account (`devonoverbey@gmail.com`) is signed in on this browser.

- Setup: run [`site-analytics.sql`](site-analytics.sql) once in the Supabase SQL editor.
- Dashboard: `/site-admin.html` (unlisted, `noindex`). Shows homepage analytics plus collapsible Cultivate (`cultivate_events`, `cultivate_waitlist`) and 12-Week Year (`twelve_week_year_events`) sections. Only the admin email can sign in or read the data.