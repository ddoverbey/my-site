# Cultivate: Connection Garden

Cultivate is a small connection-tracking game. Add people to your garden, log the ways you connect, and use each plant's vitality as a gentle prompt for who might appreciate a check-in.

## Play

Open [`index.html`](index.html) in a browser. No build step or package installation is required.

- Select **Add** to plant a connection. Choose a relationship category, cadence tier, and optional emoji or photo.
- Connections are listed from lowest vitality to highest. Open a connection to see its journal, edit it, or remove it.
- Select **Water** to record an in-person hangout, virtual hangout, long call, quick call, or text. Add an optional reflection.
- Use the category filters to narrow the garden, or **Roll Dice** to pick a connection with low vitality for a possible check-in.
- Open **Cadence Settings** to change the target interval for each tier.

## Vitality and watering

Vitality ranges from 0% to 100% and decays between interactions at a rate set by that connection's cadence target. With no new interaction, a full connection reaches 0% over one target interval. For example, a 7-day target loses about 14% per day; a 45-day target loses about 2.2% per day.

Watering adds vitality to the amount that remains, up to a maximum of 100%:

- In-person hangout: +100%
- Virtual hangout, video/long call, or quick call: +50%
- Text, DM, or meme: +25%

The game replays a connection's interactions in date order, applying decay between them and then adding each interaction's recharge. New connections start with a full in-person interaction on the date you enter. The garden's overall vitality and appearance reflect the average vitality of all connections.

## Data and sync

Connections and cadence settings are saved in this browser's local storage. They are not automatically shared between browsers or devices. Use **Account & Cloud Sync** to sign in and sync through the Supabase service configured in the page, or use **Export JSON** and **Import JSON** for a portable backup.

The page can request browser notification permission for check-in reminders. Availability and behavior depend on browser support and permission settings.
