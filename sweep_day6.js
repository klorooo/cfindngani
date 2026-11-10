const { chromium } = require("playwright");
const B = "http://localhost:8765/";
const S = __dirname + "/shots/";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const errs = [], failedReq = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("requestfailed", (r) => { if (r.url().startsWith(B)) failedReq.push(r.url()); });
  p.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_TUNNEL|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  // ---------- seed a heavy, awkward data set ----------
  await p.goto(B + "login.html"); await p.evaluate(() => { CF.resetDemoData(); CF.auth.login("student@campusfind.test", "Student@123"); });
  await p.goto(B + "claim-form.html");
  const ids = await p.evaluate(() => {
    const day = (n) => CF.util.toDayStr(CF.util.daysAgoISO(n));
    const A = CF.db.userById("u_admin");
    const long = "Very long item title that keeps going and going to test wrapping inside cards, tables and the header ";
    const mk = (type, i, title) => { const it = { id: CF.util.uid("item"), ref: CF.util.nextRef(type === "lost" ? "LST" : "FND"), type, title, category: CF.db.categories()[i % 9], color: "Blue", brand: "Brand" + i, location: CF.db.locations()[i % 11], locationDetail: "Near the stairs", dateOccurred: CF.util.daysAgoISO(i % 6), description: "Description for item number " + i + ". " + long.repeat(3), identifyingMarks: "Marks " + i, storedAt: "Guard house / Main Gate", photo: null, status: "open", reporterId: type === "lost" ? "u_student" : "u_guard", createdAt: CF.util.daysAgoISO(i % 12) }; return it; };
    const extra = [];
    for (let i = 0; i < 14; i++) extra.push(mk(i % 2 ? "lost" : "found", i + 10, i === 0 ? long.repeat(4) : i === 1 ? "🎒 Mochila azul — 青いリュック عربي" : i === 2 ? "Supercalifragilisticexpialidocious_unbreakable_word_without_spaces_1234567890" : "Item " + i));
    CF.db.saveItems(CF.db.items().concat(extra));
    const found = CF.db.items().filter((i) => i.type === "found" && i.reporterId === "u_guard");
    const mkClaim = (it, over) => CF.claims.submit(it.id, Object.assign({ description: "Black leather wallet with a worn edge and a long note. ".repeat(6), proofDetails: "Photo of my dog in the card slot", lostDate: day(8), lostLocation: "Canteen", declaration: true, evidence: [], lostReportId: "" }, over || {}), CF.db.userById("u_student"));
    const c = []; for (let i = 0; i < 6; i++) c.push(mkClaim(found[i]).claim);
    CF.claims.review(c[1].id, "request_info", A, "What is the lock screen picture? ".repeat(3));
    CF.claims.review(c[2].id, "approve", A, "Collect at the guard house.");
    CF.claims.review(c[3].id, "approve", A, ""); CF.claims.markReturned(c[3].id, A);
    CF.claims.review(c[4].id, "reject", A, "Does not match the finder's record. ".repeat(3));
    CF.claims.cancel(c[5].id, CF.db.userById("u_student"));
    for (let i = 0; i < 14; i++) CF.notify.add("u_student", { type: "info", title: "Notification " + i + " " + (i % 3 ? "" : long), body: "Body " + i, link: i % 2 ? "my-claims.html" : "" });
    CF.match.syncAll();
    return { claimId: c[0].id, foundId: found[0].id, lostId: CF.db.items().find((i) => i.type === "lost" && i.reporterId === "u_student").id, needsInfo: c[1].id };
  });

  const PAGES = {
    public: ["index.html", "search.html", "search.html?q=wallet", "login.html", "register.html"],
    student: ["index.html", "search.html?q=item", "report-lost.html", "report-found.html", "my-reports.html", "my-claims.html", "notifications.html", "profile.html", "item-details.html?id=" + ids.foundId, "item-details.html?id=" + ids.lostId, "claim-form.html?item=" + ids.foundId, "claim-details.html?id=" + ids.claimId, "claim-details.html?id=" + ids.needsInfo],
    admin: ["admin/dashboard.html", "admin/lost-reports.html", "admin/found-reports.html", "admin/matches.html", "admin/claims.html?status=all", "admin/verify-claim.html?id=" + ids.claimId, "admin/returned-items.html", "admin/users.html"],
  };
  const CREDS = { student: ["student@campusfind.test", "Student@123"], admin: ["admin@campusfind.test", "Admin@123"] };
  const WIDTHS = [[360, 740], [768, 1024], [1280, 800]];
  const findings = [];
  let visits = 0;

  async function audit(url, w) {
    return p.evaluate((w) => {
      const out = [];
      const de = document.documentElement;
      if (de.scrollWidth > de.clientWidth + 1) {
        const bad = [];
        document.querySelectorAll("body *").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width && r.right > innerWidth + 1) {
            let p = el.parentElement, scrollParent = false;
            while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll" || o === "hidden") && p.getBoundingClientRect().right <= innerWidth + 1) { scrollParent = true; break; } p = p.parentElement; }
            if (!scrollParent) bad.push(el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : "") + (el.id ? "#" + el.id : ""));
          }
        });
        out.push("horizontal scroll (" + de.scrollWidth + ">" + de.clientWidth + ") " + bad.slice(0, 4).join(", "));
      }
      const h1 = document.querySelectorAll("h1").length;
      if (h1 !== 1) out.push(h1 + " <h1> elements");
      if (!document.title.trim()) out.push("empty <title>");
      if (!document.documentElement.lang) out.push("no lang attribute");
      document.querySelectorAll("img").forEach((i) => { if (i.closest("[hidden]") || i.hidden || !i.offsetParent) return; if (!i.hasAttribute("alt")) out.push("img without alt"); else if (i.complete && !i.naturalWidth) out.push("broken image " + i.src.slice(0, 40)); });
      const seen = {}; document.querySelectorAll("[id]").forEach((e) => { if (seen[e.id]) out.push("duplicate id #" + e.id); seen[e.id] = 1; });
      const nameOf = (el) => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (el.labels && el.labels.length && el.labels[0].textContent) || el.textContent || "").trim();
      document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea").forEach((el) => {
        if (el.closest("[hidden]") || el.hidden) return;
        const style = getComputedStyle(el); if (style.display === "none" || style.visibility === "hidden") return;
        if (!nameOf(el) && !(el.tagName === "A" && el.querySelector("img[alt]"))) out.push("no accessible name: " + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className ? "." + String(el.className).split(" ")[0] : ""));
      });
      if (w <= 400) {
        const small = [...document.querySelectorAll("button, a.btn, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.height < 32) && getComputedStyle(el).visibility !== "hidden"; });
        if (small.length) out.push("tap targets under 32px: " + small.slice(0, 3).map((e) => (e.id || e.className || e.tagName)).join(", "));
      }
      const t = document.body.innerText;
      if (/undefined|\[object Object\]|NaN\b/.test(t)) out.push("page text contains undefined/NaN/[object Object]");
      return out;
    }, w);
  }

  for (const role of ["public", "student", "admin"]) {
    await p.goto(B + "search.html"); await p.evaluate(() => CF.auth.logout());
    if (CREDS[role]) await p.evaluate((c) => CF.auth.login(c[0], c[1]), CREDS[role]);
    for (const url of PAGES[role]) {
      for (const [w, h] of WIDTHS) {
        await p.setViewportSize({ width: w, height: h });
        await p.goto(B + url); await p.waitForTimeout(250);
        const before = errs.length;
        const issues = await audit(url, w);
        visits++;
        if (process.env.AXE && w !== 768) {
          await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
          const r = await p.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }));
          r.violations.forEach((v) => issues.push("AXE " + v.id + " (" + v.impact + ", " + v.nodes.length + "): " + v.nodes[0].target.join(" ").slice(0, 70) + " | " + v.help));
        }
        const landed = new URL(p.url()).pathname.split("/").pop();
        if (errs.length > before) issues.push("script error: " + errs.slice(before).join(" | "));
        if (landed !== url.split("?")[0].split("/").pop()) issues.push("redirected to " + landed);
        issues.forEach((i) => findings.push(role + " " + url + " @" + w + ": " + i));
        if (url.includes("verify-claim") || url.includes("dashboard") || url.includes("claim-details.html?id=" + ids.needsInfo)) await p.screenshot({ path: S + "sweep-" + url.replace(/[^\w]+/g, "_") + "-" + w + ".png", fullPage: true });
      }
    }
  }
  console.log("visited", visits, "page views");
  console.log("failed local requests:", failedReq.length ? [...new Set(failedReq)] : "none");
  const uniq = [...new Set(findings)];
  console.log("findings:", uniq.length); uniq.forEach((f) => console.log(" - " + f));
  console.log("page errors:", errs.length ? errs.slice(0, 5) : "none");
  await b.close();
})().catch((e) => { console.error("CRASH", e.message.split("\n").slice(0, 8).join("\n")); process.exit(2); });
