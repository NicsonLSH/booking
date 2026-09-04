# Booking page

A self-hosted booking page. Static front end on GitHub Pages, Google Apps Script
back end. Visitors choose a location, pick a date and time, and enter their name,
email and Discord ID. Each booking writes a row to a Google Sheet, creates a
Google Calendar event with a Meet link, and emails the guest an invite.

No build step, no npm, no API keys, no server to pay for.

## How it fits together

```
GitHub Pages (static)  ──GET──▶  Apps Script Web App  ──▶  Sheet: Settings, BlockedDates
  index.html                       doGet / doPost      ──▶  Calendar: busy times
  assets/app.js        ◀─JSON──                        ──▶  Sheet: Bookings
                       ──POST─▶                        ──▶  Calendar: event + Meet + invite
```

The browser never decides which hours are open — it asks the backend and renders
the answer. That keeps all timezone handling on the server and means the rules
cannot be edited from the console.

## Setup

### 1. Create the spreadsheet

Make a new Google Sheet. Name it anything. This is where bookings land and where
you will edit your hours.

### 2. Add the script

In that Sheet: **Extensions ▸ Apps Script**. Then:

1. Delete the placeholder `Code.gs` contents.
2. Create two script files matching this repo — `Code.gs` and `Config.gs` — and
   paste in the contents of `apps-script/Code.gs` and `apps-script/Config.gs`.
3. Click the gear (**Project Settings**) and tick *Show "appsscript.json"
   manifest file*, then paste in `apps-script/appsscript.json`.
4. Set the project timezone to **(GMT-05:00) Eastern Time** if it is not already.

### 3. Enable the Calendar advanced service

In the editor sidebar, **Services ▸ +**, choose **Google Calendar API**, leave
the identifier as `Calendar`, and click Add.

This is what creates the Meet link. Without it the page still works and still
creates events and invites — just with no video link attached.

### 4. Create the tabs

In the editor, select the `setup` function from the dropdown and click **Run**.
Approve the permissions prompt (it is your own script asking for access to your
own Sheet and Calendar).

This creates three tabs:

- **Settings** — your availability rules, seeded with the defaults below
- **BlockedDates** — days off and holidays
- **Bookings** — one row per booking

### 5. Deploy

**Deploy ▸ New deployment ▸ Web app**, then:

| Field | Value |
| --- | --- |
| Execute as | **Me** |
| Who has access | **Anyone** |

Copy the **Web app URL** — it ends in `/exec`.

### 6. Point the page at it

Paste that URL into `assets/config.js` as `API_URL`, then commit and push.

### 7. Turn on GitHub Pages

Repo **Settings ▸ Pages ▸ Source: Deploy from a branch**, branch `main`, folder
`/ (root)`. The page goes live at `https://<user>.github.io/<repo>/` within a
minute or two.

## Editing your hours

Open the **Settings** tab in the Sheet and change the numbers. No redeploy, no
commit — reload the booking page and the slots have changed.

| location | label | start_times | slot_minutes | gap_minutes | weekdays | max_per_day | active |
| --- | --- | --- | --- | --- | --- | --- | --- |
| philippines | Philippines | 13,14,15,16 | 60 | 60 | Mon,Tue,Wed,Thu,Fri | | TRUE |
| others | Others | 8,9,10,11,13,14,15,16 | 60 | 60 | Mon,Tue,Wed,Thu,Fri | 4 | TRUE |

- **`start_times`** is the literal list of times someone can pick, on a 24-hour
  US Eastern clock. `13,14,15,16` offers 1PM, 2PM, 3PM and 4PM. Gaps in the list
  are gaps in the day — Others skips `12`, so nothing can be booked at noon.
  Half hours work too: `8:30,9:30`.
- **`gap_minutes`** is the breathing room kept either side of a booked call. At
  `60`, booking 2PM closes 1PM and 3PM, and 4PM stays open. Set it to `0` to
  allow back-to-back calls.
- **`max_per_day`** caps how many calls that location can take in a day. Leave it
  blank for no cap. It is counted per location, so Philippines and Others each
  keep their own tally.
- **`weekdays`** is a comma-separated list. Leave it blank for Mon–Fri.
- **`active`** set to `FALSE` hides that location from the page entirely.
- Adding a row adds a new location option. Nothing else needs to change.

The gap crosses locations even though the cap does not — a Philippines call at
2PM closes the 1PM and 3PM slots for Others too, because it is the same hour of
the same person's day. Only calls booked through this page create a gap;
unrelated meetings on your calendar block the slot they actually cover and
nothing more. Set `GAP_AROUND_ALL_EVENTS` to `true` in `Config.gs` if you would
rather every meeting on the calendar reserve room around itself.

**To cancel a booking, delete its event from the HR Calendar.** The slot and its
gap reopen straight away. The calendar is what availability reads; the Bookings
tab is a record of what was booked, and editing it changes nothing about which
hours are offered.

To take a day off, add a row to **BlockedDates**:

| date | location | reason |
| --- | --- | --- |
| 2026-12-25 | all | Christmas |
| 2026-11-03 | philippines | Conference |

Use `all` to block a date for every location, or a specific location id.

## Branding

Colours are taken from legalsupporthelp.com and live as CSS custom properties at
the top of `assets/styles.css`.

**The page is dark for every visitor**, whatever their device is set to. There is
no `prefers-color-scheme` block — `:root` holds the only palette, so changing a
token there changes the page for everyone.

| Token | Value | Role |
| --- | --- | --- |
| `--accent` | `#E28A45` | Brand orange, lifted for a dark ground — buttons, borders, selected states |
| `--bg` | `#1B1E2B` | Page ground, built down from the brand navy |
| `--card` | `#252939` | Panel surface |
| `--ink` | `#F2F3F6` | Text |
| `--logo-plate` | `#FFFFFF` | The light panel the logo sits on |

The source brand colours (`--navy: #2A2E40`, `--orange: #D7782E`) are kept as
tokens for reference even though the dark palette is derived from them.

The logo keeps its exact brand colours — navy `#2A2E40` wordmark, orange
`#D7782E` mark — and therefore sits on a white plate, since navy on the dark
ground is effectively invisible. The alternative would have been recolouring the
wordmark white; the plate was chosen so the asset stays untouched. Adjust the
plate through `--logo-plate` and the `.logo-link` padding and radius.

`assets/logo.svg` is the same file, also used as the favicon.

To go back to a light page, or to following the visitor's device setting, the
whole change is in that one `:root` block.

## Settings that live in code

These change rarely, so they are in `apps-script/Config.gs`. Editing them means
pasting the file back into the editor and redeploying (see below).

| Setting | Default | What it does |
| --- | --- | --- |
| `MIN_NOTICE_HOURS` | `24` | How far ahead someone must book |
| `HORIZON_DAYS` | `60` | How far into the future the calendar opens |
| `CALENDAR_ID` | HR Calendar | Where bookings are written, and the first calendar checked for conflicts |
| `BUSY_CALENDAR_IDS` | `[]` | Extra calendars checked for conflicts but never written to |
| `EVENT_TITLE` | `Call — {name}` | Event title template |
| `BLOCK_ON_ALL_DAY_EVENTS` | `false` | Whether all-day events wipe out a day |

## Which calendars are consulted

**The HR Calendar decides availability, on its own.** Bookings are written
there, and it is the only calendar read when working out which hours are free.

Nothing on the primary calendar counts, in either direction. A personal
reminder there cannot remove a bookable hour — which is the point — but neither
will an internal meeting there stop a client booking over it. If an hour is
free on the HR Calendar, it can be booked.

`BUSY_CALENDAR_IDS` exists to widen that check to other calendars and is left
empty on purpose. Anything listed in it is read only; bookings still land on
`CALENDAR_ID` alone.

Three kinds of event are ignored on the HR Calendar: all-day events (unless
`BLOCK_ON_ALL_DAY_EVENTS` is on), invitations you have declined, and anything
marked **Show as: Free**. That last one is the escape hatch for a reminder you
want on the calendar without it costing you a bookable hour.

## Two things that will otherwise cost you an hour

**Redeploying.** Editing the script does *not* change what the live URL serves.
Go to **Deploy ▸ Manage deployments**, click the pencil on the existing
deployment, set Version to **New version**, and Deploy. If you instead create a
*new* deployment you get a **different URL**, which then has to be re-pasted into
`assets/config.js`.

**CORS.** The page POSTs with `Content-Type: text/plain` on purpose. That makes
it a "simple request" so the browser skips the preflight, which Apps Script
cannot answer. Switching it to `application/json` breaks booking with an opaque
network error. The server parses the body by hand to match.

## Testing it

Before touching the UI, check the backend directly in a browser tab:

```
<your /exec URL>?action=slots&location=philippines&date=2026-09-11
```

You should get JSON with four slots, 1:00–4:00 PM. Change `start_hour` to `14`
in the Settings tab, reload — three slots. That one test proves the whole
config-in-the-Sheet loop.

Other things worth checking once:

- A Saturday returns an empty slot list.
- A date past the horizon returns an empty list.
- After a real booking: the row appears in **Bookings** with the Discord ID, the
  event is on your calendar with that ID in its description, the guest has an
  invite, and the Meet link shows on the confirmation screen.
- Re-fetch slots for that day — the booked hour is gone.

## Files

```
index.html               the page
assets/styles.css        styling, light and dark
assets/app.js            step flow, fetch calls, validation
assets/config.js         API_URL and page copy  ← the only file you edit
apps-script/Code.gs      backend  ← paste into script.google.com
apps-script/Config.gs    backend settings
apps-script/appsscript.json
.nojekyll                stops Pages processing the assets folder
```

The Apps Script files are kept here for version history even though deploying
them is a manual paste.
