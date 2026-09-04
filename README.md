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

| location | label | start_hour | end_hour | slot_minutes | weekdays | active |
| --- | --- | --- | --- | --- | --- | --- |
| philippines | Philippines | 13 | 17 | 60 | Mon,Tue,Wed,Thu,Fri | TRUE |
| others | Others | 8 | 17 | 60 | Mon,Tue,Wed,Thu,Fri | TRUE |

- **Hours are 24-hour, US Eastern.** `13`–`17` produces 1PM, 2PM, 3PM, 4PM — the
  last slot ends at 5PM.
- **`weekdays`** is a comma-separated list. Leave it blank for Mon–Fri.
- **`active`** set to `FALSE` hides that location from the page entirely.
- Adding a row adds a new location option. Nothing else needs to change.

To take a day off, add a row to **BlockedDates**:

| date | location | reason |
| --- | --- | --- |
| 2026-12-25 | all | Christmas |
| 2026-11-03 | philippines | Conference |

Use `all` to block a date for every location, or a specific location id.

## Settings that live in code

These change rarely, so they are in `apps-script/Config.gs`. Editing them means
pasting the file back into the editor and redeploying (see below).

| Setting | Default | What it does |
| --- | --- | --- |
| `MIN_NOTICE_HOURS` | `24` | How far ahead someone must book |
| `HORIZON_DAYS` | `60` | How far into the future the calendar opens |
| `CALENDAR_ID` | `primary` | Which calendar events land on |
| `EVENT_TITLE` | `Call — {name}` | Event title template |
| `BLOCK_ON_ALL_DAY_EVENTS` | `false` | Whether all-day events wipe out a day |

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
