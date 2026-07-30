# WristTrack for Amazfit Bip Max

WristTrack is a serverless Zepp OS Mini App that starts and stops Toggl Track
timers from an Amazfit Bip Max. The watch communicates over Bluetooth with a
Side Service inside the Zepp phone app, and the Side Service communicates
directly with Toggl's official API over HTTPS.

## Why setup uses a personal token

Toggl Track does not currently publish OAuth authorization, token, PKCE, or
device-authorization endpoints. A QR approval flow therefore cannot securely
issue credentials to this app. Asking for a Toggl password would be worse.

Each user instead copies their own revocable API token from their Toggl
profile into WristTrack's Zepp settings once. The token remains phone-side and
is never sent to the watch or to a developer-operated service. This supports
any Toggl user without operating a central server.

## Implemented features

- Exact Amazfit Bip Max target: Zepp OS 5, API level 4.4, Pike-compatible
  432 x 514 drawing area.
- Current timer status and locally updating elapsed time.
- Start and stop operations against Toggl Track API v9.
- Configurable default workspace, project, and description.
- Up to six unique recent timer presets selectable on the watch.
- Direct phone-to-Toggl HTTPS requests with no application backend.
- Token validation, disconnect, and deletion controls.
- Friendly authentication, offline, and duplicate-timer errors.
- No analytics, ads, or developer-operated data collection.

## Architecture

```text
Amazfit Bip Max Device App
        | ZML over Bluetooth
Zepp phone app Side Service
        | shared Settings Storage
Zepp phone app Settings UI
        |
        | HTTPS with the user's token
        v
Toggl Track API v9
```

Only timer fields needed by the UI cross Bluetooth. The Toggl token is read
and used exclusively by the phone-side service.

## Developer setup

1. Install the current Node.js LTS release.
2. Install Zeus CLI:

   ```sh
   npm install --global @zeppos/zeus-cli
   ```

3. Install this project's dependencies:

   ```sh
   npm install
   ```

4. Run unit tests:

   ```sh
   npm test
   ```

5. Sign in to your Zepp developer account:

   ```sh
   zeus login
   ```

6. Start the simulator during development:

   ```sh
   npm run dev
   ```

## Install on a Bip Max

1. Install the Zepp app on the phone and pair the Amazfit Bip Max.
2. In Zepp, open **Profile → Settings → About** and tap the Zepp icon seven
   times to enable Developer Mode.
3. From this project directory, run:

   ```sh
   npm run preview
   ```

4. In Zepp Developer Mode, choose **Scan** and scan the QR code printed by
   Zeus. This QR installs the app; it is not a Toggl login QR.
5. Open the Bip Max device page in Zepp, open WristTrack's settings, and tap
   **Open Toggl profile to get token**.
6. Sign in to Toggl if necessary, copy the API token shown near the bottom of
   the Toggl profile page, return to Zepp, and paste it into **API token**.
7. Wait for **Signed in as ...** to appear. Choose a workspace, default
   project, and default description.
8. Open WristTrack on the watch and tap **CHECK AGAIN** or **REFRESH**.
9. Tap **START TIMER**. Use the arrow buttons to select one of the recent
   entry presets. Tap **STOP TIMER** to finish the running entry.

The Zepp phone app must remain paired and able to access the internet when a
watch action is sent to Toggl.

## Prepare for public distribution

1. Create a Zepp developer account at <https://console.zepp.com/>.
2. Create an app named WristTrack and copy its numeric app ID.
3. Replace the placeholder `app.appId` in `app.json` with that assigned ID.
4. Replace `app.vender` with your publisher name.
5. Replace the contact section in `PRIVACY.md` with a real support address.
6. Review `STORE.md`, adapt the listing copy, and avoid suggesting endorsement
   by Toggl. Obtain legal advice if you plan commercial distribution.
7. Run the tests and build the ZAB package:

   ```sh
   npm test
   npm run build
   ```

8. Test the resulting package on a factory-reset or separate Bip Max account,
   including invalid token, no timer, existing timer, phone offline, Bluetooth
   disconnected, and token deletion scenarios.
9. In Zepp Console, upload the ZAB from `dist/`, select the Productivity
   category, provide a 240 x 240 transparent PNG store icon, and provide at
   least three 360 x 360 transparent-background screenshots.
10. Paste the finalized privacy policy, declare the device-information
    permission, and explain personal-token setup in review notes.
11. Submit for review. Zepp documents a typical review time of one to five
    working days.

## Security limitations

- Zepp Settings Storage is app-local storage, not a hardware-backed credential
  vault. The implementation avoids exposing the token to the watch or a third
  party, but a compromised phone or Zepp app could expose it.
- Toggl API tokens are broad, long-lived credentials without OAuth scopes.
- Users should disconnect in WristTrack and rotate the token from Toggl after
  losing a phone or before transferring it to another person.
- Do not add a QR code containing the API token. QR images are easy to capture
  and a Toggl API token is reusable.

## Official references

- Zepp OS quick start: <https://docs.zepp.com/docs/guides/quick-start/>
- Zepp device list: <https://docs.zepp.com/docs/reference/related-resources/device-list/>
- Zepp distribution: <https://docs.zepp.com/docs/distribute/>
- Toggl authentication: <https://engineering.toggl.com/docs/track/authentication/>
- Toggl time entries: <https://engineering.toggl.com/docs/track/api/time_entries/>
