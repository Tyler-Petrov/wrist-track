# WristTrack watch screens

Rendered at the Amazfit Bip Max panel size (432x514) from the widget
tree the page modules produce. Regenerate with `npm run screens`.

- **Syncing** — The very first launch only, before the watch has ever saved a screen. After that, opening the app draws the saved one instead. (`01-syncing.png`)
- **Syncing, with the reason** — When the watch had nothing to draw, the spinner says why — so a storage failure, which would otherwise look exactly like a first launch, is visible without attaching the developer bridge. (`01c-syncing-reason.png`)
- **Restored on launch** — Every launch after the first: the watch draws its saved screen immediately and marks it unconfirmed until the phone answers, usually within a second. (`01b-restored.png`)
- **Connect Toggl** — No API token saved in Zepp yet. (`02-connect-toggl.png`)
- **Ready** — Connected, no timer running, the past month of recordings as a scrolling list. A tap starts that job again. (`03-ready.png`)
- **Ready, entry with no description** — Many Toggl entries are project-only; the project becomes the label. (`04b-ready-no-description.png`)
- **Starting** — A recording tapped, waiting on Toggl. (`05-starting.png`)
- **Running** — A timer is running. The live entry is a row like the others, with a stop mark and the elapsed time ticking once a second; the history stays on screen below it, and tapping a row switches the running timer to that job without resetting the clock. (`06-running.png`)
- **Stopping** — The live row tapped, waiting on Toggl. (`07-stopping.png`)
- **Running, sync paused** — Toggl's hourly request allowance is spent, so the phone is serving its last known state. The clock keeps ticking, which is why the screen says so. (`07b-running-stale.png`)
- **Can't sync** — The phone answered with a failure, here an expired token. (`08-error.png`)
- **Offline** — The phone could not reach Toggl. (`09-error-offline.png`)
- **Report** — The second tab, one swipe left of the month: two cards, the calendar week Sunday to Saturday and then today, each with its own total and its own breakdown by project. They count the very list the first tab is drawing, so they cost no request, and the timer still running is counted into both. (`10-report.png`)
- **Report, a busy week** — Rendered whole rather than a panel at a time, to show what scrolling reaches: the cards are as tall as what is in them, so a week spread over more projects makes a longer report, and the tab bar comes along at the end of it. (`12-report-busy.png`)
- **Report, nothing tracked** — Nothing inside any of the stretches the report totals, which it says once rather than four times over. The month tab next door may still have plenty in it. (`11-report-empty.png`)
