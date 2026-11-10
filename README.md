# CampusFind — complete build (Days 1–7)

Lost-and-found web app for the University of Rizal System Binangonan community.
Frontend-only prototype: HTML + CSS + vanilla JS, data stored in the browser's `localStorage`.

## Run it
Open `index.html` in a browser (double-click works). For best results serve the folder:

```
python3 -m http.server 8000      # then visit http://localhost:8000
```

## Demo accounts
| Role        | Email                        | Password     |
|-------------|------------------------------|--------------|
| Admin       | admin@campusfind.test        | Admin@123    |
| Student     | student@campusfind.test      | Student@123  |
| Faculty     | faculty@campusfind.test      | Faculty@123  |
| Guard       | guard@campusfind.test        | Guard@123    |
| Maintenance | maintenance@campusfind.test  | Maint@123    |

The login page has one-click buttons that fill these in. Admins land on `admin/dashboard.html`; everyone else lands on `index.html`.
Admin dashboard → "Reset demo data" restores the seed data.

## What works on Day 1
- Design system (`css/styles.css`): colour tokens, type pairing, buttons, forms, cards, tables, badges, toasts, responsive layout
- Data layer (`js/app.js`): localStorage wrapper, seed data (5 users, 6 items, 11 categories, 11 locations), reference-number generator, helpers
- Auth (`js/auth.js`): register, log in, log out, validation, role guards, safe `?next=` redirect
- Shared layout (`js/layout.js`): navbar for visitors/users, sidebar for admins, footer, mobile menus, account dropdown
- Pages: landing, login, register, admin dashboard (live counts + latest reports)
- Every menu link resolves to a "Coming on Day N" placeholder so nothing 404s

## What works on Day 2
- **Report a lost item** (`report-lost.html`) and **report a found item** (`report-found.html`): validated forms (name, category, colour, brand, place, date, description, private identifying marks, optional photo; found reports also record where the item is now)
- Photos are resized in the browser (max 900 px JPEG, about 260 KB) before saving; JPG, PNG and WebP accepted
- Sequential reference numbers: `LST-0004`, `FND-0004`, …
- **My Reports** (`my-reports.html`): your reports as cards with Lost/Found and status badges, type tabs with counts, text search, status filter, and Withdraw
- **Item details** (`item-details.html?id=…` or `?ref=LST-0004`): full details; contact info and identifying marks are visible only to the reporter and administrators; found items show a "start a claim" link (the claim form arrives on Day 4)
- Safer storage: if the browser's storage is full, a report is rejected cleanly instead of being half-saved

Statuses in use: Open, Matched, Claimed, Returned, Withdrawn (Matched/Claimed/Returned get set by Days 3–5).

## What works on Day 3
- **Search** (`search.html`, public): keyword search across name, description, category, place, colour, brand and reference number; filters for type, category, place and date range; "include claimed & returned"; sort by newest, oldest or best match; "Show more" paging. Filters are kept in the URL, so a search can be bookmarked or shared (`search.html?q=wallet&type=found`).
- Search understands plurals, partial words and common variants, including a few everyday Filipino terms: "cellphone" finds "iPhone", "payong" finds umbrellas, "susi" finds keys, "pitaka" finds wallets.
- **Match engine** (`js/search-match.js`): scores a lost report against a found report from 0–100 using category (35), name (18), shared details (12), place (15), date (10), colour (±) and brand (±). Suggestions start at 40 and are labelled Possible / Good / Strong. Each suggestion lists its reasons ("Same place (Canteen)", "Found 1 day after it was lost", …).
- **Possible matches panel** on the item details page (only the person who filed the report sees it), a **match pill** on My Reports cards, a "Possible matches for your reports" strip on the search page, and a match count in the banner right after submitting a report.
- Matching only uses public fields. The private identifying marks never affect the score and are never shown in search results or match panels.
- Suggestions are saved (`cf_matches`) so the admin Matches page on Day 5 can confirm or dismiss them.
- The home page has a search box, and logging in from a protected link now returns you to that exact page.
- Fixed: elements with the `hidden` attribute (for example "Show more") were still showing because of a CSS rule.

## What works on Day 4
- **Claim form** (`claim-form.html?item=FND-0001`): the claimant describes the item in their own words, answers "what's inside / what marks it as yours", gives when and where they lost it, optionally attaches up to 2 photos, and ticks a declaration. If they have an open lost report, the best-matching one is linked automatically and the date and place are pre-filled. The finder's private marks are never shown to the claimant.
- **Rules**: you can't claim your own found item, lost reports, or items already claimed; one active claim per item per person; at most 3 claims per person per item; the lost date can't be after the found date.
- **Claim details** (`claim-details.html?id=…`, claimant only): 4-step progress tracker, a panel that changes with the status, the proof submitted, an activity timeline, and Cancel. **More info needed** shows the admin's question and a reply form (text + optional photo).
- **My Claims**: All / Active / Closed tabs, a mini tracker on each card, and claims that need a reply are listed first with "Reply now".
- **Statuses**: Pending review → More info needed ⇄ Pending → Approved → Returned, or Rejected / Cancelled. Approving closes the item as "Claimed", confirms the stored match, marks the linked lost report claimed, and automatically rejects any competing claims. A finder can't withdraw a found item that has a claim under review.
- **Notifications** (`notifications.html` + bell in the header, with an unread dot on the phone menu button): claim submitted, more info requested, reply sent, approved, rejected, returned, and **new possible match** alerts sent to the owner of the other report when a report is filed. Mark one or all as read. Admins don't get notifications; they use the dashboard queue.

## What works on Day 5 — Admin module
- **Dashboard** (`admin/dashboard.html`): five key figures, a "Needs your attention" list (claims to review, approved claims waiting for hand-over, claims waiting for a reply, matches to confirm), three charts (reports by category, reports per day for 14 days, claims by status), a return-rate bar and the latest reports. Every chart has a **View as table** option. Chart.js is bundled in `js/vendor/`, so charts work offline.
- **Lost / Found Reports**: tabs with counts, search and filters (kept in the URL), expandable details, and **Remove** with a written reason (refused for claimed/returned items or found items with an active claim). Admin-removed reports can be restored.
- **Matches**: confirm, dismiss or undo suggested matches, refresh suggestions, or link two reports by hand. Confirming notifies both reporters without revealing who the other person is.
- **Claims & Verification** and **Verify a claim**: the claimant's proof sits side by side with the finder's private record, with automatic quick checks (place, date, private marks, description, competing claims, history), a timeline, and a decision panel: approve, ask for info, reject (a note is required for the last two), then mark as returned.
- **Returned Items**: stat tiles, list and **CSV export** (spreadsheet formulas are neutralised).
- **Users**: role and status filters, activity counts, disable or enable accounts (admins are protected).

## What works on Day 6 — Testing and hardening
- 889 automated checks plus an accessibility/responsive sweep. See `docs/TEST-CASES.md` and `docs/TEST-CASES.csv`.
- Fixed along the way: confirmed matches pre-select the owner's lost report in the claim form; "Items returned" no longer double counts; admin lists no longer scroll sideways on phones; corrupted browser storage no longer crashes pages.

## What works on Day 7 — Polish
- **Accessibility**: "Skip to main content" link, keyboard-focusable scrolling tables, higher-contrast colours (axe-core: 0 findings on 78 page views, phone and desktop widths), reduced-motion support.
- **Print styles** (sidebar and buttons hidden), **favicon**, **404 page**.
- **Load sample data** (admin dashboard → Demo tools): adds 14 backdated reports and 4 claims in different states, so charts and queues look alive. Pressing it twice does nothing. **Reset demo data** restores the original six reports.
- **Profile** page: edit name, mobile number and ID number; change password.

## 5-minute demo script
1. **Home** (visitor): search "wallet". Point out that private details never appear.
2. Log in as **Student**: open the wallet match, **Start a claim**, answer the proof questions, submit. Show the tracker.
3. Log in as **Admin**: dashboard → click **Load sample data** first if you want fuller charts. Open **Claims & Verification** → the pending claim → compare proof and finder's marks → **Approve**.
4. Back as **Student**: the bell shows "approved". Open the claim and show the tracker.
5. Admin again: **Mark as returned**, then **Returned Items** → **Export CSV**.

## Files
```
index, login, register, profile, search, item-details, my-reports, my-claims,
claim-form, claim-details, notifications, report-lost, report-found, 404 .html
admin/    dashboard, lost-reports, found-reports, matches, claims, verify-claim, returned-items, users
css/styles.css
js/       app (data), auth, reports, search-match, claims, admin, layout + one script per page
js/vendor/chart.umd.js   Chart.js 4.4.1 (MIT licence beside it)
docs/     TEST-CASES.md, TEST-CASES.csv
tests/    automated suites; run_all.sh
```
Script order on every page: app, auth, reports, search-match, claims, admin, layout, then the page's own script.

## Running the tests
```
cd tests
npm i jsdom playwright axe-core && npx playwright install chromium
python3 -m http.server 8765 --directory ..   # in another terminal
./run_all.sh
```

## Limits (by design)
Frontend-only prototype. Data lives in each browser's `localStorage`, so reports made on one device are not seen on another, and passwords are only hashed for demonstration. A real deployment needs a server and database. Out of scope: GPS tracking, delivery of items, social-media integration, mobile app. Web fonts load from Google Fonts; offline, system fonts are used.
