# Cultivate: Connection Garden

Cultivate is a small connection-tracking game. Add people to your garden, log the ways you connect, and use each plant's vitality as a gentle prompt for who might appreciate a check-in.

## Play

Open [`index.html`](index.html) in a browser. No build step or package installation is required.

- Select **Add** to plant a connection. Choose a relationship category, cadence tier, and optional emoji or photo.
- Connections are listed from lowest vitality to highest. Open a connection to see its journal, edit it, or remove it.
- Select **Water** to record an in-person hangout, virtual hangout, long call, quick call, or text. Add an optional reflection.
- Use the category filters to narrow the garden, or **Roll Dice** to pick a connection with low vitality for a possible check-in.
- Open **Cadence Settings** to change the target interval for each tier.

Vitality starts from the strength of the most recent interaction: hangouts restore 100%, long calls 75%, quick calls 50%, and texts 25%. It then declines according to the connection's cadence target. The garden's overall vitality and appearance change with the average vitality of all connections.

## Data and sync

Connections and cadence settings are saved in this browser's local storage. They are not automatically shared between browsers or devices. Use **Account & Cloud Sync** to sign in and sync through the Supabase service configured in the page, or use **Export JSON** and **Import JSON** for a portable backup.

The page can request browser notification permission for check-in reminders. Availability and behavior depend on browser support and permission settings.
