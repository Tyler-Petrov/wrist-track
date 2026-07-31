# WristTrack watch screens

Rendered at the Amazfit Bip Max panel size (432x514) from the widget
tree that `page/home/index.page.js` produces. Regenerate with `npm run screens`.

- **Syncing** — Shown while the watch waits for the phone to answer. (`01-syncing.png`)
- **Connect Toggl** — No API token saved in Zepp yet. (`02-connect-toggl.png`)
- **Ready** — Connected, no timer running, several presets to page through. (`03-ready.png`)
- **Ready, second preset** — After pressing the right arrow once. (`04-ready-second-preset.png`)
- **Ready, entry with no description** — Many Toggl entries are project-only; the project becomes the label. (`04b-ready-no-description.png`)
- **Starting** — START TIMER pressed, waiting on Toggl. (`05-starting.png`)
- **Running** — A timer is running; the elapsed time ticks once a second. (`06-running.png`)
- **Edit a running timer** — EDIT on the running screen re-labels the entry from your recent list. (`06b-edit-running.png`)
- **Stopping** — STOP TIMER pressed, waiting on Toggl. (`07-stopping.png`)
- **Can't sync** — The phone answered with a failure, here an expired token. (`08-error.png`)
- **Offline** — The phone could not reach Toggl. (`09-error-offline.png`)
