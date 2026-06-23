# Offline Compass — Specification

> This document describes what the app currently does, based on a full read-through of the code. It is written for a non-technical reader (e.g. the business owner) as well as anyone picking up the codebase.

## 1. What this app is

**Offline Compass** is a private, single-business mobile web app (installable on a phone like a real app) for **Offline Compass Ltd**, a hiking/canyoning tour operator in Mauritius. It is a combined **booking calendar, expense tracker, cash-flow dashboard, guide-pay tracker, and invoice generator** for a small team running a handful of fixed activities (Pieter Both, 7 Cascades Hiking, Canyoning 7 Cascades, Le Morne, Le Pouce).

It is built as a single-page React app (Vite), stores all data on the device (browser local storage) so it works without internet, and also syncs to a cloud database (Supabase) so the same data shows up on multiple devices when online. Only one person/email is allowed to log in.

## 2. Main features

### 2.1 Login (`src/AuthScreen.jsx`, `src/main.jsx`)
- A simple email + password sign-in screen.
- Hard-coded to only accept one email address (`offlinehike@gmail.com`); any other email is rejected before even trying to log in.
- Once signed in, the user sees the main app; signing out returns to this screen.

### 2.2 Booking Calendar (tab: "Calendar")
- A monthly calendar where each day shows how many bookings exist on it, and flags (in orange) any day that has a booking with no guide assigned yet.
- Tapping a day opens a list of that day's bookings, or a form to add a new one.
- A "+ New booking" floating button always lets you log a booking for today.
- **Paste from WhatsApp**: a box where you can paste a forwarded booking message and have the app try to read it automatically, in three modes:
  - **Quick** — informal messages (activity on line 1, name on line 2, then phone/pax/date in any order). If everything needed is present, it saves the booking immediately (guide assigned later); if something's missing, it opens the form pre-filled so you can complete it.
  - **Labelled** — messages with explicit labels like "Hike:", "Date:", "Name:". 
  - **Operator** — bulk-import format used by the tour operator partner ("Freshverde"), where several bookings can be pasted at once; the app splits them into separate bookings and reports which ones it could not read.
- **Upcoming bookings** — a list of the next 20 bookings from today onward, with quick indicators for "no guide" and Freshverde-sourced bookings.
- **Alerts banner** — a dropdown listing every booking (past or future) missing a guide, and a separate dropdown listing guide payments that are due.

### 2.3 Booking form (the "Sheet")
For each booking you record: activity, booking source (Direct vs. the Freshverde operator), client name, number of people (pax), price per person, phone/email, payment method (Cash/Card/Transfer/Unpaid), which cash account the costs come out of, notes, which guide(s) worked the trip, and expenses (food, fuel, staff cost override, commission). Price, food cost, fuel cost and staff cost are pre-filled automatically based on rules described in §3, but can be overridden by hand. The form shows running income and profit as you fill it in.

### 2.4 Dashboard (tab: "Dashboard")
A monthly business summary, including:
- Headline KPIs (profit, revenue, margin, bookings, customers, cash, runway, share of revenue from Freshverde) with month-over-month comparisons.
- A cash-on-hand vs. cash-in-bank snapshot.
- Profit and revenue broken down by activity.
- A dedicated section for Freshverde performance.
- A full cost report (by category and by activity, with a "break-even" progress bar against fixed monthly costs).
- Data tools: back up all data to a file, restore from a backup file, export the month as a CSV (for accounting), and a "clear everything" button.
- Account info and a sign-out button.

### 2.5 Cash Flow (tab: "Cash Flow")
- Lets you set starting cash-in-bank and cash-in-hand balances; the app then tracks running balances automatically as bookings are added.
- Shows current cash position, money owed to the business ("receivables" — unpaid direct bookings and unsettled Freshverde income), and money the business owes to guides.
- Estimates **monthly cash burn** and **runway** (how many months of cash are left at the current rate).
- A **"Mark Freshverde paid"** tool: pick a past revenue month, see how much Freshverde owes for that month, and mark it as received (adds the amount to the bank balance).
- An **invoice generator** for Freshverde: pick a date range, generate a one-line-per-activity invoice with a sequential invoice number, preview/print/download it as an HTML document.
- A chart of cash balance over the last 6 months plus a 3-month forward projection.
- A place to record fixed monthly costs (rent, salaries, insurance, etc.) that aren't tied to any one trip.

### 2.6 Guides (tab: "Guides")
- Lists wages owed to guides that haven't been paid yet, with a "Mark paid" button (which debits the cash-in-bank balance) and the ability to undo a payment.
- A team summary (active guides, trips run, revenue, total wages).
- Per-guide ranking by profit generated, with a detail view per guide showing trips, pax guided, revenue, profit, and a day-by-day log.

### 2.7 Offline support and cloud sync
- The app works fully offline; all data is saved to the browser's local storage instantly.
- When signed in and online, changes are also pushed to a Supabase cloud database a couple of seconds after each change, so the same data is available on other devices.
- On login, the app merges whatever is on the device with whatever is in the cloud (rather than one overwriting the other), specifically to avoid ever losing bookings — see §5 for a caveat about this.
- The app is installable as a Progressive Web App (PWA) — "Add to Home Screen" on a phone — so it behaves like a native app icon.

## 3. User flows (step by step)

### Logging in
1. Open the app.
2. Enter the registered email and password.
3. On success, the dashboard loads automatically (no separate "go to app" step).

### Adding a booking by hand
1. Go to the Calendar tab.
2. Tap a date (or the "+ New booking" button for today).
3. Fill in activity, source, client, pax, price (auto-filled, editable), payment method, who's paying the costs, notes, and which guide(s) are on the trip.
4. Review the auto-calculated income and profit at the bottom.
5. Tap "Add booking" to save.

### Adding a booking by pasting a WhatsApp message
1. Go to the Calendar tab and tap "Paste from WhatsApp".
2. Choose a mode: Quick, Labelled, or Operator (bulk).
3. Paste the message (or use "Paste clipboard").
4. Tap "Read & fill" / "Import all".
5. Depending on the mode and how complete the message was, the booking is either saved straight away or the form opens for you to fix any missing details (e.g. add a guide, fix a date).

### Editing or deleting a booking
1. Tap the date on the Calendar, or tap the booking in "Upcoming bookings".
2. Tap the booking row to open it for editing.
3. Change fields and tap "Save changes", or tap "Delete booking" to remove it.

### Assigning a guide later (closing an "Action required" alert)
1. The Calendar tab shows a banner if any bookings have no guide.
2. Tap the banner, pick the booking from the list.
3. The form opens directly to that booking; pick guide(s) and save.

### Recording that Freshverde paid you
1. Go to Cash Flow → "Mark Freshverde paid".
2. Pick the revenue month they're settling (they typically pay ~5th of the next month).
3. Check the calculated amount due, adjust if needed, tap "Confirm payment received". This marks those bookings as paid and adds the amount to the bank balance.

### Generating a Freshverde invoice
1. Go to Cash Flow → "Freshverde invoice".
2. Pick a from/to date range and tap "Generate invoice".
3. Tap "View invoice" to preview, then "Print / PDF" or "Download" to get the file.

### Paying a guide
1. Go to the Guides tab (or tap the "guide payments due" banner on Calendar).
2. Find the guide/day in the "Guide pay due" list and tap "Mark paid" (this debits the bank balance). It can be undone.

### Backing up / restoring / exporting data
1. Go to Dashboard → "Data & backup".
2. "Back up" downloads a JSON file with everything.
3. "Restore" loads a JSON backup, either replacing all data or merging it with what's already there.
4. "Export CSV" downloads the current month's bookings as a spreadsheet file.
5. "Clear all" wipes all data on the device (requires a confirm tap).

## 4. Where the calculations live

Everything lives in **`src/TrailLedger.jsx`** (a single ~3,200-line file holding the whole app's logic and UI). The key pricing/cost rules:

| What | Where (function / constant) |
|---|---|
| List of activities and their direct (walk-in) prices per person | `ACTIVITIES`, `ACTIVITY_PRICE` (top of file, ~line 11) |
| Prices when the booking comes through the Freshverde operator | `FRESHVERDE_PRICE` (~line 21) |
| Picking the right price for a booking (direct vs. Freshverde) | `priceFor()` (~line 31) |
| Per-guide day rate by activity (and pax threshold for higher rate) | `staffRate()` (~line 39) |
| Food cost per person (flat Rs 200) | `FOOD_PER_PAX` (~line 54) |
| Fuel cost rule (Rs 700, only if guide "Darryl" is on the trip) | `fuelRate()` (~line 369) |
| Booking income (pax × price) | `incomeOf()` (~line 380) |
| Per-booking expense total | `expenseTotal()` (~line 357) and `expenseTotalWith()` (~line 361) |
| Grouping same-day, same-activity, same-guide bookings into one "trip" so staff pay and fuel are only charged once | `dayCosts()` (~line 405) — this is the most complex/important function in the app |
| Splitting a day's combined guide pay across the guides who worked it | `guidePayForDay()` (~line 447) |
| Which cash account a booking's income lands in (Cash→hand, Card/Transfer→bank, Unpaid→nothing yet, Freshverde→always bank) | `incomeAccount()` (~line 389) |
| Which account a booking's costs come out of | `costsAccount()` (~line 396) |
| Monthly dashboard rollups (income, expenses, profit, margin, per-guide stats, busiest day, etc.) | the `stats` calculation inside `TrailLedger()` (~line 583) |
| Cash position, receivables, guide-pay-owed, burn rate, runway, 6-month trend + 3-month forecast | the `cashflow` calculation inside `TrailLedger()` (~line 700) |
| Building a Freshverde invoice (grouping by activity for a date range) | `buildInvoice()` (~line 954) |
| Invoice numbering (e.g. `OFF26-06`) | `nextInvoiceNo()` (~line 974) |
| Reading a forwarded WhatsApp message into a booking ("Labelled" mode) | `parseWhatsApp()` (~line 159) |
| Reading an informal, label-free message ("Quick" mode) | `parseSmart()` (~line 212) |
| Reading the operator's bulk booking format ("Operator" mode) | `parseOperatorBlock()` / `parseOperatorMulti()` (~lines 306–355) |
| Merging local and cloud data without losing bookings | `mergeReports()` (~line 101) and the sync `useEffect`s inside `TrailLedger()` (~lines 488–576) |

Supporting/non-calculation files:
- `src/supabase.js` — connects to the Supabase backend using keys from environment variables.
- `src/main.jsx` — decides whether to show the login screen or the main app, based on whether someone is signed in.
- `supabase-setup.sql` — the SQL script meant to create the cloud database table (see issue below).
- `vite.config.js` — build configuration, including the "installable app" (PWA) setup.

## 5. Things that look unfinished or broken

- **Cloud sync likely doesn't work as set up.** The app code reads and writes to a Supabase table called `app_state` (`src/TrailLedger.jsx`, lines 494 and 516), but the provided setup script (`supabase-setup.sql`) creates a table called `user_data` instead. Unless a matching `app_state` table was created some other way outside this script, every sync attempt will fail and the app will silently fall back to "offline" / device-only storage.
- **Login method doesn't match the deployment instructions.** `DEPLOY.md` describes logging in with a "magic link" emailed to you, but the actual login screen (`src/AuthScreen.jsx`) only offers email + password sign-in — there's no magic-link button or flow anywhere in the code. The deployment guide is out of date relative to the app.
- **Missing app icons.** `index.html`, `vite.config.js`'s PWA manifest, and the "Add to Home Screen" experience all reference `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, and `icon-512.png`, but there is no `public/` folder and none of these image files exist anywhere in the repository. The installed app icon and browser tab icon are likely broken or missing, and the PWA asset-caching step may also fail to find these files at build time.
- **Stale/misleading text in the app itself.** The "Data & backup" card on the Dashboard says "Your data is saved on this device only" — but the app actually also syncs to the cloud when signed in. This message was probably written before cloud sync was added and never updated.
- **Dead code.** Several components are fully written but never displayed anywhere: `ActionRequired`, `Insights`, `Kpis`/`Kpi`, and `StaffSummary` (all in `src/TrailLedger.jsx`). They appear to have been superseded by newer components (the alert banner, `CeoOverview`, and `GuidesTab` respectively) but were never deleted.
- **Silent activity mis-tagging risk in WhatsApp parsing.** `matchActivity()` (~line 147) always falls back to "Pieter Both" if it can't recognize the activity from the pasted text — it has no way to flag "I'm not sure." The "Quick" paste mode separately checks for this (via `matchActivityStrict`) and asks the user to confirm if it's unsure, but the "Labelled" paste mode (`parseWhatsApp`) does not — a booking with an unrecognized activity name typed in a labelled message could get silently saved as "Pieter Both" without any warning.
- **Single hard-coded user.** The app is built for exactly one person (`offlinehike@gmail.com` is hard-coded into the login screen). This is presumably intentional for a single-operator business, but it means there's no way to add a second team member's login without changing code.
- **No automated tests.** There is no test setup (no test runner, no test files) in the project, so correctness of the calculations described in §4 — especially the trip-grouping logic in `dayCosts()`, which is the most complex part of the app — relies entirely on manual checking.
