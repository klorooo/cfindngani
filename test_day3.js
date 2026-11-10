const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = (process.env.CF_ROOT || require("path").resolve(__dirname, ".."));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? " -> " + extra : "")); }
}

async function makeDom(page, opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");
  const nav = [], errs = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { if (/navigation/i.test(e.message)) nav.push(e.message); else errs.push(e.message); });
  const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ""), {
    url: "http://localhost/" + page + (opts.query || ""),
    runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  w.confirm = () => true;
  const load = (f) => w.eval(fs.readFileSync(path.join(ROOT, "js", f), "utf8"));
  const scripts = [...html.matchAll(/<script src="(?:\.\.\/)?js\/([^"]+)"/g)].map((m) => m[1]);
  w.__nav = nav; w.__errs = errs;
  const early = ["app.js", "auth.js", "reports.js", "search-match.js"].filter((f) => ["app.js", "auth.js"].includes(f) || scripts.includes(f));
  early.forEach(load);
  if (opts.before) opts.before(w);
  scripts.filter((s) => !early.includes(s)).forEach(load);
  if (w.document.readyState !== "complete") await new Promise((r) => w.addEventListener("load", r));
  return w;
}

const login = (email, pw) => (w) => w.CF.auth.login(email, pw);
const asStudent = login("student@campusfind.test", "Student@123");
const asGuard = login("guard@campusfind.test", "Guard@123");
const asFaculty = login("faculty@campusfind.test", "Faculty@123");
const asAdmin = login("admin@campusfind.test", "Admin@123");

const day = (w, n) => w.CF.util.toDayStr(w.CF.util.daysAgoISO(n));
const mk = (w, over) => {
  const CF = w.CF;
  const base = { id: CF.util.uid("item"), ref: CF.util.nextRef(over.type === "found" ? "FND" : "LST"), type: "lost", title: "Thing", category: "Others", color: "", brand: "", location: "Library", locationDetail: "", dateOccurred: CF.util.todayStr(), description: "A plain description here.", identifyingMarks: "", storedAt: "", photo: null, status: "open", reporterId: "u_student", createdAt: new Date().toISOString() };
  const it = Object.assign(base, over);
  CF.db.saveItems(CF.db.items().concat(it));
  return it;
};
const text = (n) => n.textContent.replace(/\s+/g, " ").trim();

(async () => {
  console.log("\n[1] text normalisation");
  {
    const w = await makeDom("search.html");
    const T = w.CF.match.tokens;
    check("drops stopwords + short words, keeps 'id'", T("Black wallet with school ID").join() === "black,wallet,school,id", T("Black wallet with school ID").join());
    check("plural stemming: keys/wallets", T("Keys").join() === "key" && T("wallets").join() === "wallet");
    check("-sses and -ies stemming", T("glasses").join() === "eyeglass" && T("batteries").join() === "battery");
    check("synonyms: cellphone/iPhone -> phone", T("Cellphone").join() === "phone" && T("iPhone").join() === "phone");
    check("synonyms: backpack -> bag", T("backpack").join() === "bag");
    check("Filipino terms: payong, pitaka, susi", T("payong").join() === "umbrella" && T("pitaka").join() === "wallet" && T("susi").join() === "key");
    check("grey == gray, hoodie == jacket", T("Grey").join() === "gray" && T("Hoodie").join() === "jacket");
    check("accents stripped", T("Café").join() === "cafe");
    check("deduplicates", T("wallet wallet wallets").join() === "wallet");
    check("null/empty safe", T(null).length === 0 && T("").length === 0 && T("a an the").length === 0);
  }

  console.log("\n[2] scoring");
  {
    const w = await makeDom("search.html");
    const CF = w.CF, M = CF.match;
    const L = CF.reports.find("LST-0001"), F = CF.reports.find("FND-0001");
    const s = M.score(L, F);
    check("seed wallet pair is a strong match (>=75)", s.score >= 75 && s.tier === "strong" && s.label === "Strong match", JSON.stringify(s));
    check("reasons explain why", ["Same category", "Same place (Canteen)", "Same colour"].every((r) => s.reasons.includes(r)) && s.reasons.some((r) => /Similar name: .*wallet/.test(r)), s.reasons.join("|"));
    check("parts sum to score", Math.round(Object.values(s.parts).reduce((a, b) => a + b, 0)) === s.score);
    check("score is 0..100", s.score >= 0 && s.score <= 100);
    check("umbrella vs keys is not a match (<40)", M.score(CF.reports.find("LST-0002"), CF.reports.find("FND-0002")).score < 40);
    check("calculator vs hoodie is not a match", M.score(CF.reports.find("LST-0003"), CF.reports.find("FND-0003")).score < 40);

    // privacy: identifying marks never affect the score
    const a = M.score({ ...L, identifyingMarks: "scratch on corner" }, { ...F, identifyingMarks: "scratch on corner" }).score;
    const b = M.score({ ...L, identifyingMarks: "" }, { ...F, identifyingMarks: "totally different" }).score;
    check("identifying marks are ignored by the scorer", a === b && a === s.score);

    // individual signals
    check("colour mismatch lowers score by 13", s.score - M.score(L, { ...F, color: "Red" }).score === 13);
    check("brand match adds 5, mismatch subtracts 6", M.score({ ...L, brand: "Nike" }, { ...F, brand: "Nike" }).score - s.score === 5 && s.score - M.score({ ...L, brand: "Nike" }, { ...F, brand: "Adidas" }).score === 6);
    check("related category = 15 pts", M.score({ ...L, category: "IDs & Documents" }, F).parts.category === 15);
    check("'Others' category = 12 pts", M.score({ ...L, category: "Others" }, F).parts.category === 12);
    check("unrelated category = 0 pts", M.score({ ...L, category: "Keys" }, F).parts.category === 0);
    check("nearby place = 7 pts", M.score({ ...L, location: "Quadrangle / Covered Court" }, F).parts.location === 7);
    check("far place = 0 pts", M.score({ ...L, location: "Main Gate" }, F).parts.location === 0);
    const dt = (lost, found) => M.score({ ...L, dateOccurred: lost }, { ...F, dateOccurred: found }).parts.date;
    check("same day = 10", dt("2026-11-01", "2026-11-01") === 10);
    check("found 3 days later = 10, 7 days = 7, 14 = 4, 30 = 2, 40 = 0", dt("2026-11-01", "2026-11-04") === 10 && dt("2026-11-01", "2026-11-08") === 7 && dt("2026-11-01", "2026-11-15") === 4 && dt("2026-11-01", "2026-12-01") === 2 && dt("2026-11-01", "2026-12-11") === 0);
    check("found 1 day before = 6, 5 days before = 0", dt("2026-11-02", "2026-11-01") === 6 && dt("2026-11-06", "2026-11-01") === 0);
    check("mixed date formats (ISO timestamp vs date-only)", dt("2026-11-01T10:00:00.000Z", "2026-11-01") >= 6);
    check("score clamps at 0", M.score({ ...L, category: "Keys", location: "Main Gate", color: "Red", brand: "A", title: "zzz", description: "qqq", dateOccurred: "2026-01-01" }, { ...F, brand: "B", dateOccurred: "2026-01-01" }).score >= 0);
    check("tierOf boundaries", M.tierOf(75).tier === "strong" && M.tierOf(74).tier === "good" && M.tierOf(55).tier === "good" && M.tierOf(54).tier === "possible");

    // a similar-sounding item described with synonyms still matches
    const mobileLost = { ...L, title: "Cellphone", category: "Phones & Gadgets", color: "Black", brand: "", description: "Black smartphone with cracked screen", location: "Library", dateOccurred: "2026-11-01" };
    const phoneFound = { ...F, title: "iPhone", category: "Phones & Gadgets", color: "Black", brand: "", description: "Found a black phone near the shelves", location: "Library", dateOccurred: "2026-11-02" };
    check("synonyms count as a name match (cellphone ~ iPhone)", M.score(mobileLost, phoneFound).parts.title === 18 && M.score(mobileLost, phoneFound).score >= 75, JSON.stringify(M.score(mobileLost, phoneFound)));
  }

  console.log("\n[2b] login redirect helpers");
  {
    const w = await makeDom("item-details.html", { query: "?id=abc&created=1" });
    const A = w.CF.auth;
    check("loginUrl keeps the query string", A.loginUrl("") === "login.html?next=item-details.html%3Fid%3Dabc%26created%3D1", A.loginUrl(""));
    check("round-trips through safeNext", A.safeNext(decodeURIComponent(A.loginUrl("").split("next=")[1])) === "item-details.html?id=abc&created=1");
    const w2 = await makeDom("admin/dashboard.html");
    check("admin loginUrl uses ../ and admin/ prefix", w2.CF.auth.loginUrl("../") === "../login.html?next=admin%2Fdashboard.html", w2.CF.auth.loginUrl("../"));
    check("safeNext accepts plain pages, queries, admin/", A.safeNext("search.html") === "search.html" && A.safeNext("admin/claims.html") === "admin/claims.html" && A.safeNext("my-reports.html?x=1") === "my-reports.html?x=1");
    check("safeNext rejects schemes, // and ..", !A.safeNext("javascript:alert(1)") && !A.safeNext("//evil.com/a.html") && !A.safeNext("http://evil.com/a.html") && !A.safeNext("../x.html") && !A.safeNext("a.html?x=<script>") && !A.safeNext("a.html?x=1#h") && !A.safeNext("") && !A.safeNext(null));
  }

  console.log("\n[3] candidates, privacy and persistence");
  {
    const w = await makeDom("search.html");
    const CF = w.CF, M = CF.match;
    const L = CF.reports.find("LST-0001"), F = CF.reports.find("FND-0001");
    check("lost wallet -> found wallet only", M.candidatesFor(L).map((r) => r.item.ref).join() === "FND-0001");
    check("found wallet -> lost wallet only", M.candidatesFor(F).map((r) => r.item.ref).join() === "LST-0001");
    check("lost umbrella has no candidates", M.candidatesFor(CF.reports.find("LST-0002")).length === 0);

    // same reporter is never matched with themselves
    const own = mk(w, { type: "found", title: "Black wallet", category: "Wallets & Cards", color: "Black", location: "Canteen", reporterId: "u_student", description: "Black wallet found at the canteen" });
    check("own found report is not suggested to the same user", !M.candidatesFor(L).some((r) => r.item.id === own.id));
    check("results sorted best first", (function () { const c = M.candidatesFor(CF.db.userById ? L : L); return c.every((r, i) => i === 0 || c[i - 1].score >= r.score); })());

    // status handling
    const other = mk(w, { type: "found", title: "Black wallet", category: "Wallets & Cards", color: "Black", location: "Canteen", reporterId: "u_maint", description: "Black wallet found at the canteen" });
    check("second counterpart appears", M.candidatesFor(L).length === 2);
    const items = CF.db.items(); items.find((i) => i.id === other.id).status = "claimed"; CF.db.saveItems(items);
    check("claimed items are not suggested", M.candidatesFor(L).length === 1);
    const items2 = CF.db.items(); items2.find((i) => i.id === other.id).status = "withdrawn"; CF.db.saveItems(items2);
    check("withdrawn items are not suggested", M.candidatesFor(L).length === 1);
    const items3 = CF.db.items(); items3.find((i) => i.ref === "LST-0001").status = "withdrawn"; CF.db.saveItems(items3);
    check("a withdrawn report gets no suggestions", M.candidatesFor(CF.reports.find("LST-0001")).length === 0);
    const items4 = CF.db.items(); items4.find((i) => i.ref === "LST-0001").status = "open"; CF.db.saveItems(items4);

    // persistence
    check("search page load already synced the suggestion", CF.db.matches().length === 1);
    CF.db.saveMatches([]);
    check("sync stores a suggestion record", M.sync(CF.reports.find("LST-0001")) === 1 && CF.db.matches().length === 1);
    const rec = CF.db.matches()[0];
    check("record shape", rec.status === "suggested" && rec.lostId === L.id && rec.foundId === F.id && rec.score === M.score(L, F).score && !!rec.id && !!rec.createdAt);
    check("sync is idempotent", M.sync(CF.reports.find("LST-0001")) === 0 && CF.db.matches().length === 1);
    check("syncAll from the found side adds nothing new", M.syncAll() === 0);
    check("syncing a found item finds the same pair", M.sync(CF.reports.find("FND-0001")) === 0);

    // dismissed pairs disappear
    const recs = CF.db.matches(); recs[0].status = "dismissed"; CF.db.saveMatches(recs);
    check("dismissed pair is hidden for both sides", M.candidatesFor(CF.reports.find("LST-0001")).length === 0 && M.candidatesFor(CF.reports.find("FND-0001")).length === 0);
    check("a dismissed pair is not re-added as a new suggestion", M.sync(CF.reports.find("LST-0001")) === 0 && CF.db.matches().length === 1);
  }

  console.log("\n[4] search engine");
  {
    const w = await makeDom("search.html");
    const CF = w.CF, M = CF.match;
    const refs = (f) => M.search(f).results.map((r) => r.item.ref).sort().join();
    check("no filters -> all 6", M.search({}).results.length === 6);
    check("type lost -> 3, found -> 3", M.search({ type: "lost" }).results.length === 3 && M.search({ type: "found" }).results.length === 3);
    check("q 'wallet' -> both wallets", refs({ q: "wallet" }) === "FND-0001,LST-0001", refs({ q: "wallet" }));
    check("plural 'wallets' matches", refs({ q: "wallets" }) === "FND-0001,LST-0001");
    check("prefix 'walle' matches", refs({ q: "walle" }) === "FND-0001,LST-0001");
    check("all words must match: 'black wallet' ok, 'black umbrella' none", M.search({ q: "black wallet" }).results.length === 2 && M.search({ q: "black umbrella" }).results.length === 0);
    check("reference number search", refs({ q: "LST-0003" }) === "LST-0003");
    check("synonym search: jacket -> hoodie, susi -> keys, payong -> umbrella", refs({ q: "jacket" }) === "FND-0003" && refs({ q: "susi" }) === "FND-0002" && refs({ q: "payong" }) === "LST-0002");
    check("matches on colour/brand/place fields", refs({ q: "casio" }) === "LST-0003" && refs({ q: "gymnasium" }) === "FND-0003");
    check("query of only stopwords = no query", M.search({ q: "the and with" }).results.length === 6);
    check("category filter", refs({ category: "Keys" }) === "FND-0002");
    check("place filter", refs({ location: "Canteen" }) === "FND-0001,LST-0001");
    check("combined filters narrow", refs({ q: "wallet", type: "found", location: "Canteen" }) === "FND-0001");
    check("unknown category yields nothing", M.search({ category: "Nope" }).results.length === 0);

    const d = (n) => day(w, n);
    check("date from (last 2 days)", refs({ from: d(2) }) === "FND-0001,FND-0003,LST-0001", refs({ from: d(2) }));
    check("date to (4+ days ago)", refs({ to: d(4) }) === "LST-0002,LST-0003", refs({ to: d(4) }));
    check("date range of one day", refs({ from: d(3), to: d(3) }) === "FND-0002");

    // status visibility
    const items = CF.db.items();
    items.find((i) => i.ref === "FND-0002").status = "claimed";
    items.find((i) => i.ref === "FND-0003").status = "withdrawn";
    items.find((i) => i.ref === "LST-0003").status = "returned";
    items.find((i) => i.ref === "LST-0002").status = "matched";
    CF.db.saveItems(items);
    check("closed + withdrawn hidden by default, matched shown", refs({}) === "FND-0001,LST-0001,LST-0002", refs({}));
    check("includeClosed adds claimed + returned but never withdrawn", refs({ includeClosed: true }) === "FND-0001,FND-0002,LST-0001,LST-0002,LST-0003", refs({ includeClosed: true }));

    // sorting
    const t1 = new Date(Date.now() - 5000).toISOString(), t2 = new Date().toISOString();
    mk(w, { type: "lost", title: "Brown pouch", description: "Has a wallet inside it", createdAt: t1, category: "Bags" });
    check("relevance: title hit ranks above description-only hit", M.search({ q: "wallet", sort: "relevance" }).results.slice(-1)[0].item.title === "Brown pouch" && M.search({ q: "wallet" }).sort === "relevance");
    check("description-only hit is still found", refs({ q: "wallet" }).includes("LST-0004"));
    const newest = M.search({ sort: "newest" }).results, oldest = M.search({ sort: "oldest" }).results;
    check("newest/oldest sorts are reverses", newest[0].item.id === oldest[oldest.length - 1].item.id && newest.length === oldest.length);
    check("sort=relevance without q falls back to newest", M.search({ sort: "relevance" }).sort === "newest");
  }

  console.log("\n[5] search page (signed out)");
  {
    const w = await makeDom("search.html");
    const d = w.document;
    const cards = () => d.querySelectorAll("#results .report-card").length;
    check("public: header + search nav active", !!d.querySelector(".site-header") && d.querySelector("a.is-active").textContent === "Search Items" && w.__nav.length === 0);
    check("guest note visible", !d.getElementById("guest-note").hidden);
    check("6 cards + summary", cards() === 6 && text(d.getElementById("summary")) === "Showing 6 of 6 items", text(d.getElementById("summary")));
    check("dropdowns populated", d.getElementById("category").options.length === 12 && d.getElementById("location").options.length === 12);
    check("CTA says 'Log in to view'", /Log in to view/.test(d.querySelector(".report-actions").textContent));
    check("no private data on cards", !/identif|contact|@campusfind|09170/i.test(d.getElementById("results").textContent));
    check("no for-you strip for guests", d.getElementById("for-you").hidden);

    const q = d.getElementById("q");
    q.value = "wallet"; q.dispatchEvent(new w.Event("input"));
    check("typing filters live", cards() === 2);
    check("sort auto-switches to best match", d.getElementById("sort").value === "relevance");
    check("chip for the query", /“wallet”/.test(d.getElementById("chips").textContent));
    check("URL mirrors state", w.location.search === "?q=wallet", w.location.search);
    q.value = "wallet "; q.dispatchEvent(new w.Event("input"));
    check("trailing space survives while typing", q.value === "wallet ");

    d.querySelector('.tab[data-type="found"]').click();
    check("type tab narrows and updates aria-pressed", cards() === 1 && d.querySelector('.tab[data-type="found"]').getAttribute("aria-pressed") === "true" && d.querySelector('.tab[data-type="all"]').getAttribute("aria-pressed") === "false");
    check("URL has q + type", w.location.search === "?q=wallet&type=found", w.location.search);
    d.querySelector('[data-clear="type"]').click();
    check("removing the type chip widens results", cards() === 2 && d.querySelector('.tab[data-type="all"]').getAttribute("aria-pressed") === "true");

    const cat = d.getElementById("category"); cat.value = "Keys"; cat.dispatchEvent(new w.Event("change"));
    check("category + query (no overlap) -> empty state", cards() === 0 && /No items found/.test(d.getElementById("results").textContent) && /No matching/.test(text(d.getElementById("summary"))));
    check("empty state offers sign-up for guests", !!d.querySelector('#results a[href="register.html"]'));
    d.getElementById("clear-all").click();
    check("clear all resets everything", cards() === 6 && d.getElementById("q").value === "" && d.getElementById("category").value === "" && w.location.search === "" && d.getElementById("clear-all").hidden);

    const sort = d.getElementById("sort"); sort.value = "oldest"; sort.dispatchEvent(new w.Event("change"));
    q.value = "wallet"; q.dispatchEvent(new w.Event("input"));
    check("explicit sort choice is kept while typing", sort.value === "oldest");
    d.getElementById("clear-all").click();

    const from = d.getElementById("from"); from.value = day(w, 2); from.dispatchEvent(new w.Event("change"));
    check("date-from filter", cards() === 3 && /From/.test(d.getElementById("chips").textContent));
    const to = d.getElementById("to"); to.value = day(w, 1); to.dispatchEvent(new w.Event("change"));
    check("date-to filter", cards() === 3);
    d.querySelector('[data-clear="from"]').click(); d.querySelector('[data-clear="to"]').click();
    check("date chips removable", cards() === 6);

    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));
  }
  {
    // load more
    const w = await makeDom("search.html", { before: (w) => { for (let i = 0; i < 12; i++) mk(w, { type: i % 2 ? "found" : "lost", title: "Item " + i, category: "Others" }); } });
    const d = w.document;
    check("paging: 9 shown of 18, button says 9 left", d.querySelectorAll("#results .report-card").length === 9 && !d.getElementById("load-more").hidden && /9 left/.test(d.getElementById("load-more").textContent) && /Showing 9 of 18/.test(text(d.getElementById("summary"))), text(d.getElementById("summary")));
    d.getElementById("load-more").click();
    check("paging: show more reveals the rest", d.querySelectorAll("#results .report-card").length === 18 && d.getElementById("load-more").hidden);
    d.getElementById("q").value = "Item 3"; d.getElementById("q").dispatchEvent(new w.Event("input"));
    check("paging resets when filters change", d.querySelectorAll("#results .report-card").length <= 9);
  }
  {
    // state from URL
    const w = await makeDom("search.html", { query: "?q=umbrella&type=lost&category=Bottles%20%26%20Umbrellas&sort=oldest" });
    const d = w.document;
    check("URL state restores results", d.querySelectorAll("#results .report-card").length === 1);
    check("URL state restores controls", d.getElementById("q").value === "umbrella" && d.getElementById("category").value === "Bottles & Umbrellas" && d.getElementById("sort").value === "oldest" && d.querySelector('.tab[data-type="lost"]').getAttribute("aria-pressed") === "true");
    const w2 = await makeDom("search.html", { query: "?category=Hacks&location=Moon&from=notadate&to=2026-13-99x&type=stolen&sort=chaos" });
    check("invalid URL params are ignored", w2.document.querySelectorAll("#results .report-card").length === 6 && w2.document.getElementById("category").value === "");
    const w3 = await makeDom("search.html", { query: "?q=" + encodeURIComponent('<img src=x onerror="window.__pwned=1">') });
    check("XSS via ?q= is inert", !w3.__pwned && !w3.document.querySelector("img[onerror]") && /No items found/.test(w3.document.getElementById("results").textContent) && w3.document.getElementById("chips").querySelector("img") === null);
    check("q is length-capped", (await makeDom("search.html", { query: "?q=" + "a".repeat(500) })).document.getElementById("q").value.length === 100);
  }
  {
    // XSS via stored item text on the search page; private marks never rendered
    const w = await makeDom("search.html", { before: (w) => mk(w, { title: '<img src=x onerror="window.__pwned=1">', identifyingMarks: "SECRETMARK123", photo: "javascript:window.__pwned=2" }) });
    check("stored XSS title escaped + unsafe photo ignored", !w.__pwned && !w.document.querySelector("#results img[onerror]") && !w.document.querySelector('#results img[src^="javascript"]'));
    check("private identifying marks never appear in results", !/SECRETMARK123/.test(w.document.body.innerHTML));
  }

  console.log("\n[6] search page (signed in)");
  {
    const w = await makeDom("search.html", { before: asStudent });
    const d = w.document;
    check("guest note hidden for members", d.getElementById("guest-note").hidden);
    check("CTA 'View details'", /View details/.test(d.querySelector(".report-actions").textContent));
    check("own reports flagged 'Your report'", d.querySelectorAll("#results .badge-open").length === 2, String(d.querySelectorAll("#results .badge-open").length));
    const fy = d.getElementById("for-you");
    check("for-you strip lists LST-0001 with 1 match", !fy.hidden && /LST-0001/.test(fy.textContent) && /1 possible match/.test(fy.textContent) && !/LST-0003/.test(fy.textContent), text(fy));
    check("for-you link targets #matches", /item-details\.html\?id=item_[^"]+#matches/.test(fy.innerHTML));
    check("syncAll stored the suggestion", w.CF.db.matches().length === 1);
    const g = await makeDom("search.html", { before: asGuard });
    check("guard sees FND-0001 match strip", /FND-0001/.test(g.document.getElementById("for-you").textContent));
    const f = await makeDom("search.html", { before: asFaculty });
    check("no strip when nothing matches", f.document.getElementById("for-you").hidden);
    const a = await makeDom("search.html", { before: asAdmin });
    check("no strip for admins", a.document.getElementById("for-you").hidden);
    // signed-in user + empty state shows report CTAs
    const q = d.getElementById("q"); q.value = "zzzz"; q.dispatchEvent(new w.Event("input"));
    check("empty state offers report buttons to members", !!d.querySelector('#results a[href="report-lost.html"]') && !!d.querySelector('#results a[href="report-found.html"]'));
  }

  console.log("\n[7] possible matches on item details");
  {
    const w = await makeDom("item-details.html", { before: (w) => { asStudent(w); w.history.replaceState(null, "", "/item-details.html?ref=LST-0001"); } });
    const d = w.document;
    const panel = d.getElementById("matches");
    check("owner sees the matches panel", !!panel && /Possible matches/.test(panel.textContent));
    check("count badge", /1 found/.test(text(panel.querySelector(".matches-head"))));
    check("shows the found wallet with tier, score and reasons", /Black bi-fold wallet/.test(panel.textContent) && /Strong match/.test(panel.textContent) && /\d{2,3}%/.test(panel.textContent) && panel.querySelectorAll(".reason-chips li").length >= 4);
    check("meter exposes the score to assistive tech", /Match score \d+ out of 100/.test(panel.querySelector(".meter").getAttribute("aria-label")));
    check("link opens the found item", /item-details\.html\?id=item_/.test(panel.querySelector(".match-info h4 a").getAttribute("href")));
    check("matched item's private marks not leaked in panel", !/identifying/i.test(panel.textContent));
    check("suggestion persisted on view", w.CF.db.matches().length === 1);
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));
  }
  {
    const w = await makeDom("item-details.html", { before: (w) => { asGuard(w); w.history.replaceState(null, "", "/item-details.html?ref=FND-0001"); } });
    const panel = w.document.getElementById("matches");
    check("finder sees matching LOST reports", !!panel && /Black wallet with school ID/.test(panel.textContent) && /Lost/.test(panel.querySelector(".match-item .badge").textContent));
  }
  {
    const w = await makeDom("item-details.html", { before: (w) => { asFaculty(w); w.history.replaceState(null, "", "/item-details.html?ref=LST-0002"); } });
    const panel = w.document.getElementById("matches");
    check("no matches -> friendly empty state", !!panel && /No likely matches yet/.test(panel.textContent));
    check("empty state links to a pre-filtered search", !!panel.querySelector('a[href="search.html?type=found&category=Bottles%20%26%20Umbrellas"]'), panel.innerHTML.slice(0, 300));
  }
  {
    const w = await makeDom("item-details.html", { before: (w) => { asFaculty(w); w.history.replaceState(null, "", "/item-details.html?ref=LST-0001"); } });
    check("non-owner gets NO matches panel and no private marks", !w.document.getElementById("matches") && !w.document.querySelector(".private-box"));
  }
  {
    const w = await makeDom("item-details.html", { before: (w) => { asStudent(w); w.CF.reports.withdraw(w.CF.reports.find("LST-0001").id, w.CF.db.userById("u_student")); w.history.replaceState(null, "", "/item-details.html?ref=LST-0001"); } });
    check("withdrawn report shows no matches panel", !w.document.getElementById("matches"));
  }
  {
    // freshly created report: banner mentions matches
    let created;
    const w = await makeDom("item-details.html", {
      query: "?created=1",
      before: (w) => {
        asStudent(w);
        created = w.CF.reports.create("lost", { title: "Gray hoodie", category: "Clothing", color: "Gray", brand: "", location: "Gymnasium", locationDetail: "", dateOccurred: w.CF.util.todayStr(), description: "Medium gray hoodie, left on the bleachers.", identifyingMarks: "", photo: null }, w.CF.auth.currentUser());
        w.history.replaceState(null, "", "/item-details.html?id=" + created.item.id + "&created=1");
      },
    });
    const d = w.document;
    check("banner announces the match right after submitting", /1 possible match/.test(text(d.querySelector(".created-banner"))) && !!d.querySelector('.created-banner a[href="#matches"]'), text(d.querySelector(".created-banner")));
    check("hoodie report matched the found hoodie (synonym-free, same place)", /Gray hoodie/.test(d.getElementById("matches").textContent) && /FND-0003/.test(d.getElementById("matches").textContent));
  }

  console.log("\n[8] matches flow through the report form");
  {
    const w = await makeDom("report-lost.html", { before: asFaculty });
    const d = w.document, CF = w.CF;
    const set = (id, v) => { d.getElementById(id).value = v; };
    set("title", "Keys on a red keychain"); set("category", "Keys"); set("location", "Main Gate"); set("color", "Silver");
    set("description", "Three keys on a red keychain, dropped near the main gate.");
    d.getElementById("report-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
    const saved = CF.reports.find("LST-0004");
    check("report saved", !!saved && saved.reporterId === "u_faculty");
    check("suggestions stored at submit time", CF.db.matches().length === 1 && CF.db.matches()[0].lostId === saved.id && CF.db.matches()[0].foundId === CF.reports.find("FND-0002").id, JSON.stringify(CF.db.matches()));
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));
  }

  console.log("\n[9] My Reports + home");
  {
    const w = await makeDom("my-reports.html", { before: asStudent });
    const d = w.document;
    const pills = [...d.querySelectorAll(".match-pill")];
    check("only LST-0001 has a match pill", pills.length === 1 && /1 possible match/.test(pills[0].textContent) && /#matches$/.test(pills[0].getAttribute("href")));
    check("pill sits in the LST-0001 card", /LST-0001/.test(pills[0].closest(".report-card").textContent));
    d.querySelector("[data-withdraw]").click();
    check("pill disappears after withdrawing", d.querySelectorAll(".match-pill").length === 0 || !/LST-0001/.test([...d.querySelectorAll(".match-pill")].map((p) => p.closest(".report-card").textContent).join()));
  }
  {
    const w = await makeDom("index.html");
    const f = w.document.querySelector("form.hero-search");
    check("home hero has a GET search form to search.html", !!f && f.getAttribute("action") === "search.html" && f.getAttribute("method") === "get" && f.querySelector("input[name=q]"));
    const ids = ["header rendered"]; check(ids[0], !!w.document.querySelector(".site-header"));
  }

  console.log("\n[10] files");
  {
    const broken = [];
    const all = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")).concat(fs.readdirSync(ROOT + "/admin").map((f) => "admin/" + f));
    all.forEach((p) => {
      const html = fs.readFileSync(path.join(ROOT, p), "utf8");
      [...html.matchAll(/(?:src|href)="((?:\.\.\/)?(?:js|css)\/[^"]+)"/g)].forEach((m) => {
        if (!fs.existsSync(path.join(path.dirname(path.join(ROOT, p)), m[1]))) broken.push(p + " -> " + m[1]);
      });
    });
    check("no broken css/js references across " + all.length + " pages", broken.length === 0, broken.join("; "));
    const order = (p) => { const s = [...fs.readFileSync(path.join(ROOT, p), "utf8").matchAll(/js\/([\w-]+)\.js/g)].map((m) => m[1]); return s; };
    const ok = ["search.html", "item-details.html", "my-reports.html", "report-lost.html", "report-found.html"].every((p) => { const o = order(p); return o.indexOf("search-match") > o.indexOf("reports") && o.indexOf("search-match") < o.indexOf("layout"); });
    check("search-match.js loads after reports.js and before layout.js everywhere", ok);
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
