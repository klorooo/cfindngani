const { chromium } = require("playwright");
const B = "http://localhost:8765/";
let pass = 0, fail = 0;
const check = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : " -> " + x)); };
const NOFONTS = (ctx) => ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
async function fresh(b, opts) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
  await NOFONTS(ctx);
  const p = await ctx.newPage(); p.__errs = [];
  p.on("pageerror", (e) => p.__errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  return { ctx, p };
}
(async () => {
  const b = await chromium.launch();

  console.log("\n[A] corrupted storage");
  {
    const keys = ["cf_users", "cf_items", "cf_claims", "cf_matches", "cf_notifications", "cf_categories", "cf_locations", "cf_counters", "cf_session", "cf_seed_version"];
    for (const k of keys) {
      const { ctx, p } = await fresh(b);
      await p.goto(B + "login.html"); await p.evaluate(() => CF.resetDemoData());
      await p.evaluate((k) => localStorage.setItem(k, "{not json!!"), k);
      await p.goto(B + "search.html"); await p.waitForTimeout(200);
      const ok = (await p.locator("h1").count()) === 1;
      await p.goto(B + "login.html"); await p.waitForTimeout(150);
      check(k + " = garbage: search + login still render, no script errors", ok && (await p.locator("#login-form").count()) === 1 && p.__errs.length === 0, p.__errs.join("|"));
      await ctx.close();
    }
    // wrong shapes (valid JSON, wrong type)
    for (const [k, v] of [["cf_items", '{"a":1}'], ["cf_users", '"text"'], ["cf_claims", "null"], ["cf_notifications", "42"]]) {
      const { ctx, p } = await fresh(b);
      await p.goto(B + "login.html"); await p.evaluate(() => CF.resetDemoData());
      await p.evaluate(([k, v]) => localStorage.setItem(k, v), [k, v]);
      await p.goto(B + "search.html"); await p.goto(B + "login.html");
      check(k + " = " + v + " (valid JSON, wrong shape): pages survive", (await p.locator("#login-form").count()) === 1 && p.__errs.length === 0, p.__errs.join("|"));
      await ctx.close();
    }
  }

  console.log("\n[B] storage unavailable (private mode / blocked)");
  {
    const { ctx, p } = await fresh(b);
    await p.addInitScript(() => { const bad = () => { throw new DOMException("blocked", "SecurityError"); }; Object.defineProperty(window, "localStorage", { get: bad }); });
    for (const pg of ["index.html", "search.html", "login.html", "register.html"]) { await p.goto(B + pg); await p.waitForTimeout(150); }
    check("public pages load with localStorage blocked", (await p.locator("h1").count()) >= 1 && p.__errs.length === 0, p.__errs.join("|"));
    await p.goto(B + "register.html");
    await p.click('label.role-option:has(input[value="student"])');
    await p.fill("#name", "Temp User"); await p.fill("#idNumber", "1"); await p.fill("#contact", "09171234567"); await p.fill("#email", "t@x.test"); await p.fill("#password", "Temp12345"); await p.fill("#confirm", "Temp12345");
    await p.click("#register-form button[type=submit]"); await p.waitForTimeout(400);
    check("registering still works in memory (no crash)", p.__errs.length === 0, p.__errs.join("|"));
    await ctx.close();
  }

  console.log("\n[C] sessions and tampered URLs");
  {
    const { ctx, p } = await fresh(b);
    await p.goto(B + "login.html"); await p.evaluate(() => { CF.resetDemoData(); CF.auth.login("student@campusfind.test", "Student@123"); });
    await p.evaluate(() => { localStorage.setItem("cf_session", JSON.stringify({ userId: "ghost", at: new Date().toISOString() })); });
    await p.goto(B + "my-reports.html"); await p.waitForURL(/login\.html/, { timeout: 5000 }).catch(() => {});
    check("session for a user that no longer exists is treated as signed out", /login\.html/.test(p.url()) && /next=my-reports/.test(p.url()), p.url());

    await p.evaluate(() => CF.auth.login("student@campusfind.test", "Student@123"));
    const hostile = ["item-details.html?id=%3Cscript%3Ewindow.__x=1%3C/script%3E", "item-details.html?id=" + "A".repeat(3000), "claim-form.html?item=%27%20OR%201%3D1--", "claim-details.html?id=..%2F..%2Fetc%2Fpasswd", "search.html?q=%3Cimg%20src%3Dx%20onerror%3Dwindow.__x%3D1%3E&category=%3Cb%3E&location=zzz&type=lost%22%3E", "search.html?type=found&category=Keys&sort=oldest&page=-5", "login.html?next=javascript:alert(1)", "login.html?next=//evil.test/x.html", "login.html?next=https://evil.test/a.html"];
    for (const u of hostile) {
      await p.evaluate(() => CF.auth.logout()).catch(() => {});
      const bare = u.startsWith("login");
      if (!bare) await p.evaluate(() => CF.auth.login("student@campusfind.test", "Student@123"));
      await p.goto(B + u); await p.waitForTimeout(150);
      const polluted = await p.evaluate(() => window.__x === 1);
      check("hostile URL is harmless: " + u.slice(0, 60), !polluted && p.__errs.length === 0 && new URL(p.url()).hostname === "localhost", p.__errs.join("|") + " " + p.url());
      p.__errs.length = 0;
    }
    // login with next=javascript: must still land on the normal home page
    await p.evaluate(() => CF.auth.logout());
    await p.goto(B + "login.html?next=javascript:alert(1)");
    await p.fill("#email", "student@campusfind.test"); await p.fill("#password", "Student@123");
    await Promise.all([p.waitForURL((u) => !/login\.html/.test(u.pathname)), p.click("#login-form button[type=submit]")]);
    check("login ignores an unsafe ?next= and goes to the user's home", /index\.html|\/$/.test(new URL(p.url()).pathname) || /my-reports/.test(p.url()), p.url());

    // disabled mid-session
    await p.evaluate(() => { const us = CF.db.users(); us.find((u) => u.id === "u_student").status = "disabled"; CF.db.saveUsers(us); });
    await p.goto(B + "my-reports.html"); await p.waitForURL(/login\.html/, { timeout: 5000 }).catch(() => {});
    check("an account disabled mid-session is bounced on the next page", /login\.html/.test(p.url()), p.url());
    await p.fill("#email", "student@campusfind.test"); await p.fill("#password", "Student@123"); await p.click("#login-form button[type=submit]");
    check("…and sees a clear message at login", /disabled/i.test((await p.locator("#form-alert").textContent()) || ""), await p.locator("#form-alert").textContent());
    await ctx.close();
  }

  console.log("\n[D] forms: double submit, huge text, unicode");
  {
    const { ctx, p } = await fresh(b);
    await p.goto(B + "login.html"); await p.evaluate(() => { CF.resetDemoData(); CF.auth.login("student@campusfind.test", "Student@123"); });
    await p.goto(B + "report-lost.html");
    const before = await p.evaluate(() => CF.db.items().length);
    await p.fill("#title", "🎒 Mochila azul — 青いリュック"); await p.selectOption("#category", { index: 3 }); await p.selectOption("#location", { index: 2 });
    await p.fill("#description", "Backpack with unicode ✓ — العربية — 日本語 — emoji 🙂 and a <b>tag</b> & \"quotes\".");
    await p.dblclick("#submit-btn"); await p.waitForURL(/item-details/, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => CF.db.items().length);
    check("double-clicking Submit creates exactly ONE report", after === before + 1, before + " -> " + after);
    check("unicode, emoji and markup survive and render as text", /🎒 Mochila azul — 青いリュック/.test(await p.locator("h1").first().textContent()) && /<b>tag<\/b>/.test(await p.locator("#detail-root").textContent()) && (await p.locator("#detail-root b").count()) === 0);
    await p.goto(B + "search.html?q=" + encodeURIComponent("mochila"));
    check("search finds it by a word in the title", /Mochila/.test(await p.locator("#results, main").first().textContent()));

    await p.goto(B + "report-lost.html");
    const len = await p.evaluate(() => { const t = document.getElementById("title"); return t.maxLength; });
    await p.fill("#title", "X".repeat(5000)); await p.fill("#description", "D".repeat(5000));
    const got = await p.evaluate(() => [document.getElementById("title").value.length, document.getElementById("description").value.length]);
    check("huge text is capped by the form (maxlength " + len + ")", got[0] <= 200 && got[1] <= 1000, got.join());
    // bypass maxlength via the API as a hostile client would
    const res = await p.evaluate(() => CF.reports.create("lost", { title: "T".repeat(5000), category: "Bags", location: CF.db.locations()[0], dateOccurred: CF.util.todayStr(), description: "D".repeat(5000) }, CF.auth.currentUser()));
    check("…and the validator rejects oversize input too (not just the form)", res.ok === false && !!res.errors, JSON.stringify(res).slice(0, 120));
    await ctx.close();
  }

  console.log("\n[E] time zones (UTC-11 and UTC+14)");
  for (const tz of ["Pacific/Pago_Pago", "Pacific/Kiritimati", "Asia/Manila"]) {
    const { ctx, p } = await fresh(b, { timezoneId: tz });
    await p.goto(B + "login.html"); await p.evaluate(() => { CF.resetDemoData(); CF.auth.login("student@campusfind.test", "Student@123"); });
    await p.goto(B + "report-lost.html");
    const localToday = await p.evaluate(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
    const info = await p.evaluate(() => ({ today: CF.util.todayStr(), max: document.getElementById("dateOccurred").max, val: document.getElementById("dateOccurred").value }));
    check(tz + ": todayStr() is the LOCAL date and the date picker agrees", info.today === localToday && info.max === localToday && (info.val === "" || info.val === localToday), JSON.stringify(info) + " local " + localToday);
    await p.fill("#title", "Timezone test item"); await p.selectOption("#category", { index: 2 }); await p.selectOption("#location", { index: 2 });
    await p.fill("#description", "Created to test that today's date is accepted in every time zone.");
    await p.fill("#dateOccurred", localToday);
    await Promise.all([p.waitForURL(/item-details/, { timeout: 8000 }).catch(() => {}), p.click("#submit-btn")]);
    check(tz + ": a report dated today is accepted", /item-details/.test(p.url()), p.url() + " " + (await p.locator("#form-alert").textContent().catch(() => "")));
    await p.evaluate(() => { CF.auth.logout(); CF.auth.login("admin@campusfind.test", "Admin@123"); });
    await p.goto(B + "admin/dashboard.html"); await p.waitForTimeout(300);
    const last = await p.evaluate(() => CF.admin.stats(14));
    const lostToday = last.perDay.lost[13] + last.perDay.found[13];
    check(tz + ": the new report lands on TODAY in the 14-day series", lostToday >= 1, JSON.stringify(last.perDay.lost));
    check(tz + ": no script errors", p.__errs.length === 0, p.__errs.join("|"));
    await ctx.close();
  }

  console.log("\n[F] cross-tab consistency");
  {
    const { ctx, p } = await fresh(b);
    await p.goto(B + "login.html"); await p.evaluate(() => { CF.resetDemoData(); CF.auth.login("student@campusfind.test", "Student@123"); });
    const p2 = await ctx.newPage(); p2.__errs = []; p2.on("pageerror", (e) => p2.__errs.push(e.message));
    await p.goto(B + "my-reports.html");
    await p2.goto(B + "claim-form.html"); // same session, other tab
    await p2.evaluate(() => CF.notify.add("u_student", { title: "From tab two", body: "x" }));
    await p.reload();
    check("a second tab's notification shows after reload", (await p.locator(".bell-count").textContent()) === "1");
    await p2.evaluate(() => CF.auth.logout());
    await p.goto(B + "my-reports.html"); await p.waitForURL(/login\.html/, { timeout: 5000 }).catch(() => {});
    check("logging out in one tab signs out the other on its next page", /login\.html/.test(p.url()));
    await ctx.close();
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.message.split("\n").slice(0, 8).join("\n")); process.exit(2); });
