#!/usr/bin/env bash
# Runs every suite. Needs: npm i jsdom playwright axe-core  (and `npx playwright install chromium`)
# Browser suites need a server:  python3 -m http.server 8765   (run from the project folder)
cd "$(dirname "$0")"
for f in test_day1 test_day2 test_day3 test_day4 test_day5 test_profile sample_data e2e_journey edge_day6; do
  echo "== $f"; node $f.js | tail -1
done
echo "== accessibility + responsive sweep"; AXE=1 node sweep_day6.js | tail -4
