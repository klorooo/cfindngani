# CampusFind – Test cases

Every row in `TEST-CASES.csv` is a check that ran against the delivered code (889 checks, all passing at hand-over). Re-generate by running `tests/run_all.sh`.

| Area | Method | Checks | Failed |
|---|---|---:|---:|
| Day 1 – Foundation, auth, layout | Automated (jsdom) | 75 | 0 |
| Day 2 – Reporting lost/found | Automated (jsdom) | 121 | 0 |
| Day 3 – Search and matching | Automated (jsdom) | 144 | 0 |
| Day 4 – Claims, tracker, notifications | Automated (jsdom) | 218 | 0 |
| Day 5 – Admin module | Automated (jsdom) | 238 | 0 |
| Profile and password | Automated (jsdom) | 14 | 0 |
| Sample data loader | Automated (jsdom) | 7 | 0 |
| End-to-end journey | Automated (Chromium) | 24 | 0 |
| Edge cases and hostile input | Automated (Chromium) | 48 | 0 |
| **Total** | | **889** | **0** |

## Accessibility and responsive sweep

`sweep_day6.js` opens 78 page views (student and admin, 360 px and 1280 px wide) in Chromium and checks for horizontal scrolling, broken local requests, script errors, tap-target size and, with `AXE=1`, WCAG 2.0/2.1 A and AA rules using axe-core. Result: **0 findings**.

## Manual checks recommended before the demo

| # | Case | Expected |
|---|---|---|
| M1 | Open the site on a real phone | Menu opens, forms are usable, no sideways scrolling |
| M2 | Keyboard only: Tab from the top of any page | "Skip to main content" appears first; focus is always visible |
| M3 | Print the Returned Items page | Sidebar and buttons are hidden |
| M4 | Turn on "reduce motion" in the operating system | Animations stop |
| M5 | Open the site with no internet | Everything works; only the web fonts fall back |
