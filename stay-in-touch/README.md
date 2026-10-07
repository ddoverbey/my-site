# Cultivate: Connection Garden

Cultivate is a small connection-tracking game. Add people to your garden, log the ways you connect, and use each plant's vitality as a gentle prompt for who might appreciate a check-in.

## Play

Open [`index.html`](index.html) in a browser. No build step or package installation is required.

- Select **Add** to plant a connection. Choose a relationship category, cadence tier, and optional emoji or photo.
- Select **Import** to preview an iOS Contacts vCard (`.vcf`), search the list, and check each person you want to add. Selection is retained across pages. Repeated records in the file stay visible and are marked for review. Imported contacts default to Friends/Close; matching email addresses or matching name-and-phone pairs already in your garden are skipped.
- The garden at the top shows up to 10 plants, one per connection, prioritising Inner circle, then Close circle, Wider network and Long range, with the lowest vitality first within a tier. Inner Circle connections are dead trees, Close Circle connections are birches, Wider Network connections are bushes, and Long Range connections are sunflowers. Each plant's season reflects its vitality: spring (Thriving), summer (Good), autumn (Wilting), or winter (Dormant); these are vitality stages, not the calendar season. Tap a plant to see its name and vitality and to water it. Use **Hide icons** to remove the small avatar circles. The background grass, flowers and fallen leaves grow or fade with the garden's average vitality.
- Connections are listed from lowest vitality to highest. Open a connection to see its journal, edit it, or remove it.
- Select **Water** to record an in-person hangout, virtual hangout, long call, quick call, or text. Add an optional reflection.
- Use the category filters to narrow the garden, or **Roll Dice** to pick a connection with low vitality for a possible check-in.
- Open **Cadence Settings** to change the target interval for each tier.

## Vitality and watering

Vitality ranges from 0% to 100% and decays between interactions at a rate set by that connection's cadence target. Default targets are 14 days for Inner Circle, 30 days for Close Circle, 90 days for Wider Network, and 180 days for Long Range. Inner Circle vitality has a 30% floor and Close Circle has a 15% floor; Wider Network and Long Range can decay to 0%.

Watering adds vitality to the amount that remains, up to a maximum of 100%:

- In-person hangout: +100%
- Virtual hangout, video/long call, or quick call: +50%
- Text, DM, or meme: +40%

The game replays a connection's interactions in date order, applying decay between them and then adding each interaction's recharge. New connections start with a full in-person interaction on the date you enter. Plant art shows Thriving (75%+), Good (30-74%), Wilting (1-29%), or Dormant (0%). Imported contacts start with no interaction history; the game does not invent a last-contact date. The garden's overall vitality and appearance reflect the average vitality of all connections.

## Data and sync

Connections and cadence settings are saved in this browser's local storage. vCard files are parsed in the browser; only contacts you select are added. Data is not automatically shared between browsers or devices. Use **Account & Cloud Sync** to sign in and sync through the Supabase service configured in the page, or use **Export JSON** and **Import JSON** for a portable backup.

The page can request browser notification permission for check-in reminders. Availability and behavior depend on browser support and permission settings.

## Interest tracking and waitlists

The **Pro** button and the **Auto-Sync** button in the Add dialog open a waitlist form. The share icon beside the vitality score opens the native share sheet or copies a snippet with a link to devonoverbey.com/tools.

Waitlist emails and a few anonymous events (`page_visit`, `first_seed_planted`, `first_plant_watered`, `pro_click`, `autosync_click`, `share_click`, `waitlist_submitted`) are written to Supabase. Events carry a random per-browser id and never include contact names or notes. Nothing is sent when the page is opened from `file:` or `localhost`. Run this once in the Supabase SQL editor to create the tables. The anon key can insert but not read:

```sql
create table public.cultivate_waitlist (
  id bigint generated always as identity primary key,
  email text not null check (position('@' in email) > 1 and length(email) <= 254),
  source text not null check (source in ('pro', 'autosync')),
  anon_id text,
  created_at timestamptz not null default now(),
  unique (email, source)
);
create table public.cultivate_events (
  id bigint generated always as identity primary key,
  anon_id text not null,
  event text not null check (length(event) <= 64),
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.cultivate_waitlist enable row level security;
alter table public.cultivate_events enable row level security;
create policy "anon can join waitlist" on public.cultivate_waitlist for insert to anon with check (true);
create policy "anon can log events" on public.cultivate_events for insert to anon with check (true);
```

View results in the Supabase table editor, for example the number of distinct `anon_id` values per event.
