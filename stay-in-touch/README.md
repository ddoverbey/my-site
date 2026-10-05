# Cultivate: Connection Garden

Cultivate is a small connection-tracking game. Add people to your garden, log the ways you connect, and use each plant's vitality as a gentle prompt for who might appreciate a check-in.

## Play

Open [`index.html`](index.html) in a browser. No build step or package installation is required.

- Select **Add** to plant a connection. Choose a relationship category, cadence tier, and optional emoji or photo.
- Select **Import** to preview an iOS Contacts vCard (`.vcf`), search contacts, select or deselect people across pages, and import only the selected contacts. Choose a shared relationship category and cadence tier for the batch. Matching email addresses or phone numbers already in your garden are skipped.
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
