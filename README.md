# my-site

## Homepage analytics

`index.html` logs anonymous `page_visit` and `link_click` events (`href`, `label`, `section`) to the Supabase `site_events` table. Events are skipped on localhost/file previews and when the owner account (`devonoverbey@gmail.com`) is signed in on this browser.

- Setup: run [`site-analytics.sql`](site-analytics.sql) once in the Supabase SQL editor.
- Dashboard: `/site-admin.html` (unlisted, `noindex`). Shows homepage analytics plus collapsible Cultivate (`cultivate_events`, `cultivate_waitlist`) and 12-Week Year (`twelve_week_year_events`) sections. Only the admin email can sign in or read the data.