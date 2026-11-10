// Full journey through the real UI, one browser, five roles.
const { chromium } = require("playwright");
const S = __dirname + "/shots/", B = "http://localhost:8765/";
let pass = 0, fail = 0;
const check = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : " -> " + x)); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const text = async (sel) => ((await p.locator(sel).first().textContent()) || "").replace(/\s+/g, " ").trim();
  const signOut = async () => { await p.evaluate(() => CF.auth.logout()); };
  const signIn = async (email, pw) => { await signOut(); await p.goto(B + "login.html"); await p.fill("#email", email); await p.fill("#password", pw); await Promise.all([p.waitForURL((u) => !/login\.html/.test(u.pathname)), p.click("#login-form button[type=submit]")]); };

  await p.goto(B + "login.html"); await p.evaluate(() => CF.resetDemoData());

  // 1. Register a brand-new student
  await p.goto(B + "register.html");
  await p.click('label.role-option:has(input[value="student"])');
  await p.fill("#name", "Ana Reyes"); await p.fill("#idNumber", "2024-00555"); await p.fill("#contact", "09171234567");
  await p.fill("#email", "ana@campusfind.test"); await p.fill("#password", "Ana12345"); await p.fill("#confirm", "Ana12345");
  await Promise.all([p.waitForURL(/welcome=1/), p.click("#register-form button[type=submit]")]);
  check("1. registration signs Ana in and lands on the home page", /welcome=1/.test(p.url()) && await text(".avatar") === "AR");

  // 2. Ana reports a lost item
  await p.goto(B + "report-lost.html");
  await p.fill("#title", "Silver laptop charger"); await p.selectOption("#category", "Phones & Gadgets"); await p.selectOption("#location", "Library");
  await p.fill("#color", "Silver"); await p.fill("#brand", "Acer");
  await p.fill("#description", "Acer laptop charger with a small black cable tie around the wire, left on a study table.");
  await p.fill("#identifyingMarks", "Initials AR written in marker on the brick");
  await Promise.all([p.waitForURL(/item-details/), p.click("#submit-btn")]);
  const lostRef = await text(".ref-pill");
  check("2. lost report filed with a reference", /^LST-000\d$/.test(lostRef), lostRef);
  await p.screenshot({ path: S + "e2e-1-lost-filed.png", fullPage: true });

  // 3. Guard finds a matching item
  await signIn("guard@campusfind.test", "Guard@123");
  await p.goto(B + "report-found.html");
  await p.fill("#title", "Acer laptop charger"); await p.selectOption("#category", "Phones & Gadgets"); await p.selectOption("#location", "Library");
  await p.fill("#color", "Silver"); await p.fill("#brand", "Acer");
  await p.fill("#description", "Laptop charger found on a table in the library reading area.");
  await p.fill("#identifyingMarks", "Marker initials on the brick, starts with A");
  await p.selectOption("#storedAt", { index: 1 });
  await Promise.all([p.waitForURL(/item-details/), p.click("#submit-btn")]);
  const foundRef = await text(".ref-pill");
  check("3. guard files a found report", /^FND-000\d$/.test(foundRef), foundRef);
  check("3b. the guard's own page shows the possible match to the lost report", /possible match|match/i.test(await p.locator("#detail-root").textContent()));

  // 4. Ana is alerted
  await signIn("ana@campusfind.test", "Ana12345");
  await p.goto(B + "my-reports.html");
  check("4. Ana's bell shows 1 unread (match alert)", await text(".bell-count") === "1", await text(".bell-count"));
  await p.goto(B + "notifications.html");
  check("4b. the alert names the match and links to it", /New possible match for/.test(await text("#notif-list")) );
  await p.screenshot({ path: S + "e2e-2-alert.png" });

  // 5. Admin confirms the match
  await signIn("admin@campusfind.test", "Admin@123");
  await p.goto(B + "admin/matches.html");
  check("5. admin sees the suggestion", await p.locator(".match-card").count() >= 1 && /Acer|charger/i.test(await p.locator("#match-list").textContent()));
  const card = p.locator(".match-card", { hasText: foundRef }).first();
  await card.locator('[data-act="confirm"]').click();
  check("5b. confirmed -> moves to the Confirmed tab", /Confirmed\s*1/.test(await text('#match-tabs [data-tab="confirmed"]')));

  // 6. Ana claims it
  await signIn("ana@campusfind.test", "Ana12345");
  await p.goto(B + "notifications.html");
  check("6. Ana got 'Match confirmed' too", /Match confirmed/.test(await text("#notif-list")));
  const foundId = await p.evaluate((r) => CF.db.items().find((i) => i.ref === r).id, foundRef);
  await p.goto(B + "item-details.html?id=" + foundId);
  await Promise.all([p.waitForURL(/claim-form/), p.click('.side-actions a[href^="claim-form.html"]')]);
  console.log("DEBUG options:", await p.locator("#lostReportId option").allTextContents(), "url", p.url(), "lostRef", lostRef);
  check("6b. claim form auto-links Ana's lost report", (await p.locator("#lostReportId option:checked").textContent()).startsWith(lostRef));
  await p.fill("#description", "Silver Acer charger with a black cable tie around the wire.");
  await p.fill("#proofDetails", "My initials AR are written in marker on the brick");
  await p.check("#declaration");
  await Promise.all([p.waitForURL(/claim-details/), p.click("#submit-btn")]);
  const claimRef = await text(".ref-pill");
  check("6c. claim submitted (CLM-0001, pending)", claimRef === "CLM-0001" && /Pending review/.test(await text(".badge-lg")), claimRef);
  const claimId = await p.evaluate(() => CF.db.claims()[0].id);

  // 7. Admin verifies: ask, reply, approve
  await signIn("admin@campusfind.test", "Admin@123");
  await p.goto(B + "admin/claims.html");
  check("7. claim is in the admin queue", await p.locator("#rows tr").count() === 1);
  await p.click("#rows a.btn");
  check("7b. quick checks flag the initials overlap", /Private marks:.*(marker|initials|brick)/i.test(await text(".hints")), await text(".hints"));
  await p.screenshot({ path: S + "e2e-3-verify.png", fullPage: true });
  await p.fill("#note", "What brand is printed on the charger?");
  await p.click('[data-act="request_info"]');
  check("7c. info requested", /More info needed/.test(await text(".badge-lg")));

  await signIn("ana@campusfind.test", "Ana12345");
  await p.goto(B + "claim-details.html?id=" + claimId);
  check("7d. Ana sees the question and a reply form", /brand/.test(await text(".quote")) && await p.locator("#reply-form").count() === 1);
  await p.fill("#reply-text", "It says Acer on the front.");
  await p.click("#reply-btn");
  await p.waitForSelector("text=Pending review");
  check("7e. reply sent, claim back to pending", true);

  await signIn("admin@campusfind.test", "Admin@123");
  await p.goto(B + "admin/verify-claim.html?id=" + claimId);
  await p.fill("#note", "Collect it at the guard house with your school ID.");
  await p.click('[data-act="approve"]');
  check("7f. approved", /Approved/.test(await text(".badge-lg")));

  // 8. Ana sees approval; admin hands over
  await signIn("ana@campusfind.test", "Ana12345");
  await p.goto(B + "claim-details.html?id=" + claimId);
  check("8. Ana sees the approval, pickup note and where to collect", /approved/i.test(await text(".callout-good")) && /guard house/i.test(await text(".callout-good")));
  await p.screenshot({ path: S + "e2e-4-approved.png", fullPage: true });
  await signIn("admin@campusfind.test", "Admin@123");
  await p.goto(B + "admin/verify-claim.html?id=" + claimId);
  await p.click('[data-act="return"]');
  check("8b. marked returned", /Returned/.test(await text(".badge-lg")));
  await p.goto(B + "admin/returned-items.html");
  check("8c. appears in Returned Items", await p.locator("#rows tr").count() === 1 && /Ana Reyes/.test(await text("#rows")));
  await p.goto(B + "admin/dashboard.html");
  check("8d. dashboard shows 1 returned", await text("#kpi-returned") === "1");
  await p.screenshot({ path: S + "e2e-5-dashboard.png", fullPage: true });

  await signIn("ana@campusfind.test", "Ana12345");
  await p.goto(B + "notifications.html");
  const n = await text("#notif-list");
  check("9. Ana's notification trail covers the whole story", ["New possible match", "Match confirmed", "submitted", "More information", "approved", "returned"].every((k) => new RegExp(k, "i").test(n)), n);
  await p.goto(B + "my-reports.html");
  check("9b. her lost report now reads Returned", /Returned/.test(await text("#reports-list, main")));

  console.log("errors:", errs.length ? errs : "none");
  check("no page errors during the whole journey", errs.length === 0);
  console.log(pass + " passed, " + fail + " failed");
  await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.message.split("\n").slice(0, 6).join("\n")); process.exit(2); });
