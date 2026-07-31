# WristTrack watch screens

Rendered at the Amazfit Bip Max panel size (432x514) from the widget
tree that `page/home/index.page.js` produces. Regenerate with `npm run screens`.

- **Syncing** — The very first launch only, before the watch has ever saved a screen. After that, opening the app draws the saved one instead. (`01-syncing.png`)
- **Restored on launch** — Every launch after the first: the watch draws its saved screen immediately and marks it unconfirmed until the phone answers, usually within a second. (`01b-restored.png`)
- **Connect Toggl** — No API token saved in Zepp yet. (`02-connect-toggl.png`)
- **Ready** — Connected, no timer running, several presets to page through. (`03-ready.png`)
- **Ready, second preset** — After pressing the right arrow once. (`04-ready-second-preset.png`)
- **Ready, entry with no description** — Many Toggl entries are project-only; the project becomes the label. (`04b-ready-no-description.png`)
- **Starting** — START TIMER pressed, waiting on Toggl. (`05-starting.png`)
- **Running** — A timer is running; the elapsed time ticks once a second. (`06-running.png`)
- **Edit a running timer** — EDIT on the running screen re-labels the entry from your recent list. (`06b-edit-running.png`)
- **Stopping** — STOP TIMER pressed, waiting on Toggl. (`07-stopping.png`)
- **Running, sync paused** — Toggl's hourly request allowance is spent, so the phone is serving its last known state. The clock keeps ticking, which is why the screen says so. (`07b-running-stale.png`)
- **Can't sync** — The phone answered with a failure, here an expired token. (`08-error.png`)
- **Offline** — The phone could not reach Toggl. (`09-error-offline.png`)
