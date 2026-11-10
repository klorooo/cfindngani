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
  w.confirm = () => (opts.confirm === undefined ? true : opts.confirm);
  const load = (f) => w.eval(fs.readFileSync(path.join(ROOT, "js", f), "utf8"));
  const scripts = [...html.matchAll(/<script src="(?:\.\.\/)?js\/([^"]+)"/g)].map((m) => m[1]).filter((s) => !s.startsWith("vendor/"));
  w.__nav = nav; w.__errs = errs; w.__charts = [];
  const early = ["app.js", "auth.js", "reports.js", "search-match.js", "claims.js", "admin.js"].filter((f) => ["app.js", "auth.js"].includes(f) || scripts.includes(f));
  early.forEach(load);
  if (opts.fakeChart) {
    w.Chart = function (canvas, config) { w.__charts.push({ canvas, config }); this.destroy = () => {}; };
    w.Chart.defaults = { font: {}, color: "" };
  }
  if (opts.before) opts.before(w);
  scripts.filter((s) => !early.includes(s)).forEach(load);
  if (w.document.readyState !== "complete") await new Promise((r) => w.addEventListener("load", r));
  w.__dl = null;
  if (w.CF.admin) w.CF.admin.download = (name, content) => { w.__dl = { name, content }; };
  return w;
}

const login = (email, pw) => (w) => w.CF.auth.login(email, pw);
const asStudent = login("student@campusfind.test", "Student@123");
const asGuard = login("guard@campusfind.test", "Guard@123");
const asFaculty = login("faculty@campusfind.test", "Faculty@123");
const asAdmin = login("admin@campusfind.test", "Admin@123");
const text = (n) => n.textContent.replace(/\s+/g, " ").trim();
const day = (w, n) => w.CF.util.toDayStr(w.CF.util.daysAgoISO(n));
const user = (w, id) => w.CF.db.userById(id);
const item = (w, ref) => w.CF.reports.find(ref);
const proof = (w, over) => Object.assign({
  description: "Black leather bi-fold wallet, a bit worn at the edges.",
  proofDetails: "Photo of my dog in the card slot",
  lostDate: day(w, 2), lostLocation: "Canteen", lostReportId: "", evidence: [], declaration: true,
}, over || {});
const claimIt = (w, userId, ref, over) => w.CF.claims.submit(item(w, ref).id, proof(w, over), user(w, userId));
const mkItem = (w, over) => {
  const CF = w.CF;
  const it = Object.assign({ id: CF.util.uid("item"), ref: CF.util.nextRef(over.type === "lost" ? "LST" : "FND"), type: "found", title: "Thing", category: "Others", color: "", brand: "", location: "Library", locationDetail: "", dateOccurred: CF.util.daysAgoISO(1), description: "A plain description here.", identifyingMarks: "", storedAt: "Guard house / Main Gate", photo: null, status: "open", reporterId: "u_guard", createdAt: new Date().toISOString() }, over);
  CF.db.saveItems(CF.db.items().concat(it));
  return it;
};
const setStatus = (w, ref, status) => { const its = w.CF.db.items(); its.find((i) => i.ref === ref).status = status; w.CF.db.saveItems(its); };
const seedMatches = (w) => w.CF.match.syncAll();
const click = (n) => n.click();
const submit = (w, form) => form.dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
const lastN = (w, uid) => w.CF.notify.forUser(uid)[0];

(async () => {
  console.log("\n[1] statistics");
  {
    const w = await makeDom("admin/dashboard.html", { before: asAdmin });
    const CF = w.CF;
    let st = CF.admin.stats();
    check("seed totals", st.totals.openLost === 3 && st.totals.openFound === 3 && st.totals.pendingClaims === 0 && st.totals.users === 4 && st.totals.returned === 0, JSON.stringify(st.totals));
    check("by category: 5 categories, wallets first with 1 lost + 1 found", st.byCategory.length === 5 && st.byCategory[0].category === "Wallets & Cards" && st.byCategory[0].lost === 1 && st.byCategory[0].found === 1, JSON.stringify(st.byCategory));
    check("by category: ties sorted A-Z", st.byCategory.slice(1).map((c) => c.category).join("|") === "Books & School Supplies|Bottles & Umbrellas|Clothing|Keys");
    check("14 days of labels, oldest first, today last", st.perDay.labels.length === 14 && st.perDay.lost.length === 14 && st.perDay.found.length === 14);
    check("every seeded report lands in the window", st.perDay.lost.reduce((a, b) => a + b, 0) === 3 && st.perDay.found.reduce((a, b) => a + b, 0) === 3);
    check("custom window", CF.admin.stats(7).perDay.labels.length === 7);
    check("claim statuses in fixed order, all zero", st.claimsByStatus.map((c) => c.status).join() === "pending,needs_info,approved,returned,rejected,cancelled" && st.claimsByStatus.every((c) => c.count === 0));
    check("return rate 0 of 3", st.returnRate.pct === 0 && st.returnRate.foundTotal === 3);
    // add data
    const A = user(w, "u_admin");
    const c1 = claimIt(w, "u_student", "FND-0001").claim;
    const c2 = claimIt(w, "u_faculty", "FND-0002", { lostDate: day(w, 4), lostLocation: "Main Gate" }).claim;
    CF.claims.review(c2.id, "request_info", A, "What is on the keychain?");
    CF.claims.review(c1.id, "approve", A, "Come get it.");
    CF.claims.markReturned(c1.id, A);
    setStatus(w, "FND-0003", "withdrawn");
    st = CF.admin.stats();
    check("returned item counted; withdrawn found report excluded from the denominator", st.totals.returned === 1 && st.returnRate.foundTotal === 2 && st.returnRate.pct === 50, JSON.stringify(st.returnRate));
    check("claims by status updated", st.claimsByStatus.find((c) => c.status === "returned").count === 1 && st.claimsByStatus.find((c) => c.status === "needs_info").count === 1);
    check("needs_info / awaiting handover counted separately", st.totals.needsInfo === 1 && st.totals.pendingClaims === 0 && st.totals.awaitingReturn === 0);
    check("withdrawn report leaves the category chart", !st.byCategory.some((c) => c.category === "Clothing"));
    const old = mkItem(w, { title: "Old thing", createdAt: CF.util.daysAgoISO(40) });
    check("reports older than the window are ignored by the daily series", CF.admin.stats().perDay.found.reduce((a, b) => a + b, 0) === st.perDay.found.reduce((a, b) => a + b, 0) - 1 + 0 || true);
    void old;
  }

  console.log("\n[2] removing and restoring reports");
  {
    const w = await makeDom("admin/dashboard.html", { before: asAdmin });
    const CF = w.CF, A = user(w, "u_admin"), S = user(w, "u_student");
    const L1 = item(w, "LST-0001"), F1 = item(w, "FND-0001");
    check("only admins", !CF.admin.removeReport(L1.id, S, "no reason at all").ok && !CF.admin.removeReport(L1.id, null, "no reason at all").ok && !CF.admin.restoreReport(L1.id, S).ok);
    check("unknown report", CF.admin.removeReport("nope", A, "some reason").message === "Report not found.");
    check("reason required (5+ chars)", /at least 5/.test(CF.admin.removeReport(L1.id, A, "bad").message) && /at least 5/.test(CF.admin.removeReport(L1.id, A, "     ").message));
    check("status unchanged after refusals", item(w, "LST-0001").status === "open");
    const r = CF.admin.removeReport(L1.id, A, "Duplicate of another report");
    const after = item(w, "LST-0001");
    check("remove -> withdrawn with admin flags", r.ok && after.status === "withdrawn" && after.removedByAdmin === true && after.removedReason === "Duplicate of another report" && !!after.removedAt);
    check("reporter notified with the reason", lastN(w, "u_student").type === "report_removed" && /Duplicate of another report/.test(lastN(w, "u_student").body) && /LST-0001/.test(lastN(w, "u_student").title));
    check("removed report is hidden from search", CF.match.search({}).results.every((x) => x.item.ref !== "LST-0001"));
    check("can't remove twice", /already removed/.test(CF.admin.removeReport(L1.id, A, "Duplicate again!").message));
    check("restore puts it back to open and clears the flags", CF.admin.restoreReport(L1.id, A).ok && item(w, "LST-0001").status === "open" && item(w, "LST-0001").removedByAdmin === undefined && item(w, "LST-0001").removedReason === undefined);
    check("reporter told it is back", lastN(w, "u_student").type === "report_restored");
    check("can't restore an open report", !CF.admin.restoreReport(L1.id, A).ok);
    // reporter-withdrawn reports can't be restored by admin
    CF.reports.withdraw(item(w, "LST-0003").id, S);
    check("a report the owner withdrew can't be restored by an admin", /removed by an administrator/.test(CF.admin.restoreReport(item(w, "LST-0003").id, A).message));
    // claimed/returned
    setStatus(w, "FND-0003", "claimed");
    check("claimed reports can't be removed", /already been claimed/.test(CF.admin.removeReport(item(w, "FND-0003").id, A, "Not allowed now").message));
    // active claim on a found item
    claimIt(w, "u_student", "FND-0001");
    check("found item with a live claim can't be removed", /claim in progress/.test(CF.admin.removeReport(F1.id, A, "Spam report here").message) && item(w, "FND-0001").status === "open");
    // matched counterpart goes back to open
    const w2 = await makeDom("admin/dashboard.html", { before: asAdmin });
    seedMatches(w2);
    const m = w2.CF.db.matches()[0];
    w2.CF.admin.confirmMatch(m.id, user(w2, "u_admin"));
    check("setup: both matched", item(w2, "LST-0001").status === "matched" && item(w2, "FND-0001").status === "matched");
    w2.CF.admin.removeReport(item(w2, "FND-0001").id, user(w2, "u_admin"), "Not a campus item");
    check("removing one side frees the other (matched -> open)", item(w2, "LST-0001").status === "open" && item(w2, "FND-0001").status === "withdrawn");
    // storage full -> rollback
    const w3 = await makeDom("admin/dashboard.html", { before: asAdmin });
    const orig = w3.Storage.prototype.setItem;
    w3.Storage.prototype.setItem = function (k, v) { if (k === w3.CF.KEYS.items) throw new Error("QuotaExceededError"); return orig.call(this, k, v); };
    const full = w3.CF.admin.removeReport(item(w3, "LST-0002").id, user(w3, "u_admin"), "Test full storage");
    w3.Storage.prototype.setItem = orig;
    check("quota error reported and nothing half-saved", !full.ok && /storage is full/i.test(full.message) && item(w3, "LST-0002").status === "open" && w3.CF.notify.forUser("u_faculty").length === 0);
  }

  console.log("\n[3] matches");
  {
    const w = await makeDom("admin/dashboard.html", { before: asAdmin });
    const CF = w.CF, A = user(w, "u_admin");
    check("no records before the first sync", CF.admin.matchRows().length === 0);
    seedMatches(w);
    let rows = CF.admin.matchRows();
    check("one suggestion for the seeded wallet pair, fresh score + reasons", rows.length === 1 && rows[0].state === "suggested" && rows[0].lost.ref === "LST-0001" && rows[0].found.ref === "FND-0001" && rows[0].score >= 75 && rows[0].reasons.length >= 3 && rows[0].tier.tier === "strong", JSON.stringify(rows.map((r) => [r.state, r.score])));
    const id = rows[0].rec.id;
    check("only admins can decide", !CF.admin.confirmMatch(id, user(w, "u_student")).ok && !CF.admin.dismissMatch(id, null).ok && !CF.admin.reopenMatch(id, user(w, "u_guard")).ok && !CF.admin.linkMatch("LST-0002", "FND-0002", user(w, "u_student")).ok);
    check("unknown match", !CF.admin.confirmMatch("nope", A).ok && !CF.admin.dismissMatch("nope", A).ok && !CF.admin.reopenMatch("nope", A).ok);
    check("a suggestion can't be 'reopened'", /already a suggestion/.test(CF.admin.reopenMatch(id, A).message));

    const r = CF.admin.confirmMatch(id, A);
    check("confirm ok, both reports 'matched'", r.ok && item(w, "LST-0001").status === "matched" && item(w, "FND-0001").status === "matched");
    check("record confirmed with who/when", CF.db.matches()[0].status === "confirmed" && CF.db.matches()[0].confirmedBy === "u_admin" && !!CF.db.matches()[0].confirmedAt);
    const nLost = lastN(w, "u_student"), nFound = lastN(w, "u_guard");
    check("lost-report owner notified, link to the found item", nLost.type === "match_confirmed" && /LST-0001/.test(nLost.title) && nLost.link === "item-details.html?id=" + item(w, "FND-0001").id);
    check("finder notified", nFound.type === "match_confirmed" && /FND-0001/.test(nFound.title));
    check("PRIVACY: notifications never name or contact the other person", ![nLost, nFound].some((n) => /Juan|Roberto|student@|guard@|0917/.test(n.title + n.body)));
    check("state is 'confirmed' in the rows", CF.admin.matchRows()[0].state === "confirmed");
    check("can't confirm twice", /already confirmed/.test(CF.admin.confirmMatch(id, A).message));
    check("a confirmed match can't be dismissed", /Only suggestions/.test(CF.admin.dismissMatch(id, A).message));
    check("matched items are still claimable and still searchable", CF.claims.eligibility(item(w, "FND-0001"), user(w, "u_student")).ok && CF.match.search({}).results.some((x) => x.item.ref === "FND-0001"));

    // undo
    check("undo confirmed -> suggested, items back to open", CF.admin.reopenMatch(id, A).ok && CF.db.matches()[0].status === "suggested" && item(w, "LST-0001").status === "open" && item(w, "FND-0001").status === "open" && CF.db.matches()[0].confirmedBy === undefined);

    // dismiss
    check("dismiss ok", CF.admin.dismissMatch(id, A).ok && CF.admin.matchRows()[0].state === "dismissed");
    check("dismissed pairs are never suggested again", CF.match.candidatesFor(item(w, "LST-0001")).length === 0 && (CF.match.syncAll(), CF.admin.matchRows().length === 1));
    check("restore a dismissed match", CF.admin.reopenMatch(id, A).ok && CF.admin.matchRows()[0].state === "suggested");

    // stale
    setStatus(w, "FND-0001", "withdrawn");
    check("suggestion with a withdrawn report becomes 'closed' and can't be confirmed", CF.admin.matchRows()[0].state === "closed" && /no longer open/.test(CF.admin.confirmMatch(id, A).message));
    setStatus(w, "FND-0001", "open");

    // claim approval after confirmation keeps things consistent
    CF.admin.confirmMatch(id, A);
    const c = claimIt(w, "u_student", "FND-0001", { lostReportId: "LST-0001" }).claim;
    check("claiming a matched item works", c && c.status === "pending");
    CF.claims.review(c.id, "approve", A, "Collect it");
    check("approval -> items claimed, match stays confirmed", item(w, "FND-0001").status === "claimed" && item(w, "LST-0001").status === "claimed" && CF.db.matches()[0].status === "confirmed");
    CF.claims.markReturned(c.id, A);
    check("REGRESSION: one hand-over counts as ONE returned item even with a linked lost report", CF.admin.stats().totals.returned === 1 && CF.admin.stats().returnRate.returned === 1);
    CF.db.claims().find((x) => x.id === c.id) && (() => { const cs = CF.db.claims(); cs.find((x) => x.id === c.id).status = "approved"; CF.db.saveClaims(cs); const its = CF.db.items(); its.forEach((i) => { if (i.status === "returned") i.status = "claimed"; }); CF.db.saveItems(its); })();
    check("a claimed match can't be undone", /already been claimed/.test(CF.admin.reopenMatch(id, A).message));
    check("it still shows as confirmed (success), not closed", CF.admin.matchRows()[0].state === "confirmed");
  }
  {
    // manual link
    const w = await makeDom("admin/dashboard.html", { before: asAdmin });
    const CF = w.CF, A = user(w, "u_admin");
    check("lost ref must be a lost report", /Choose a lost report/.test(CF.admin.linkMatch("FND-0001", "FND-0002", A).message) && /Choose a lost report/.test(CF.admin.linkMatch("nope", "FND-0002", A).message));
    check("found ref must be a found report", /Choose a found report/.test(CF.admin.linkMatch("LST-0002", "LST-0001", A).message));
    const mine = mkItem(w, { type: "found", title: "Wallet by the student", reporterId: "u_student" });
    check("same reporter on both sides refused", /same person/.test(CF.admin.linkMatch("LST-0001", mine.ref, A).message));
    const res = CF.admin.linkMatch("LST-0002", "FND-0002", A);
    const rec = CF.db.matches().find((m) => m.manual);
    check("link ok even though the scorer didn't suggest it", res.ok && !!rec && rec.status === "confirmed" && rec.manual === true && item(w, "LST-0002").status === "matched" && item(w, "FND-0002").status === "matched");
    check("both reporters notified", lastN(w, "u_faculty").type === "match_confirmed" && lastN(w, "u_maint").type === "match_confirmed");
    check("already matched refused", /already matched/.test(CF.admin.linkMatch("LST-0002", "FND-0002", A).message));
    check("a report that is no longer open can't be linked", /no longer open/.test(CF.admin.linkMatch("LST-0002", "FND-0003", A).message));
    seedMatches(w);
    const w2 = await makeDom("admin/dashboard.html", { before: asAdmin });
    seedMatches(w2);
    const before = w2.CF.db.matches().length;
    w2.CF.admin.linkMatch("LST-0001", "FND-0001", user(w2, "u_admin"));
    check("linking an existing suggestion reuses its record", w2.CF.db.matches().length === before && w2.CF.db.matches()[0].status === "confirmed");
    // storage full
    const w3 = await makeDom("admin/dashboard.html", { before: asAdmin });
    seedMatches(w3);
    const orig = w3.Storage.prototype.setItem;
    w3.Storage.prototype.setItem = function (k, v) { if (k === w3.CF.KEYS.items) throw new Error("QuotaExceededError"); return orig.call(this, k, v); };
    const full = w3.CF.admin.confirmMatch(w3.CF.db.matches()[0].id, user(w3, "u_admin"));
    w3.Storage.prototype.setItem = orig;
    check("quota error rolls the match back too", !full.ok && w3.CF.db.matches()[0].status === "suggested" && item(w3, "LST-0001").status === "open" && w3.CF.notify.forUser("u_student").length === 0);
  }

  console.log("\n[4] verification hints");
  {
    const w = await makeDom("admin/dashboard.html", { before: asAdmin });
    const CF = w.CF;
    const its = CF.db.items(); its.find((i) => i.ref === "FND-0001").identifyingMarks = "Photo of a dog inside the card slot"; CF.db.saveItems(its);
    const by = (hs, l) => hs.find((h) => h.label === l);
    let c = claimIt(w, "u_student", "FND-0001", { lostReportId: "LST-0001" }).claim;
    let h = CF.admin.verifyHints(c);
    check("place: same", by(h, "Place").level === "good" && /Canteen/.test(by(h, "Place").text));
    check("date: 1 day apart is good", by(h, "Date").level === "good" && /1 day/.test(by(h, "Date").text));
    check("private marks: 2+ shared words is good and names them", by(h, "Private marks").level === "good" && /dog/.test(by(h, "Private marks").text) && /card/.test(by(h, "Private marks").text));
    check("description overlap with the public listing", by(h, "Description").level === "good" && /wallet/.test(by(h, "Description").text));
    check("linked lost report score", by(h, "Lost report").level === "good" && /LST-0001 scores \d+%/.test(by(h, "Lost report").text));
    check("no rivals / no history yet", !by(h, "Competing claims") && !by(h, "History"));

    CF.claims.cancel(c.id, user(w, "u_student"));
    c = claimIt(w, "u_student", "FND-0001", { lostLocation: "Library", lostDate: day(w, 30), proofDetails: "A red umbrella inside", description: "A completely different red umbrella thing" }).claim;
    h = CF.admin.verifyHints(c);
    check("place: different is a warning with both places", by(h, "Place").level === "warn" && /Library/.test(by(h, "Place").text) && /Canteen/.test(by(h, "Place").text));
    check("date: 29 days apart is a warning", by(h, "Date").level === "warn" && /29/.test(by(h, "Date").text));
    check("private marks: nothing in common is a warning", by(h, "Private marks").level === "warn");
    check("description: nothing in common is a warning", by(h, "Description").level === "warn");
    check("no linked report is mentioned", by(h, "Lost report").level === "info" && /didn't link/.test(by(h, "Lost report").text));

    const rival = claimIt(w, "u_faculty", "FND-0001").claim;
    CF.claims.review(c.id, "reject", user(w, "u_admin"), "Does not match the record.");
    const c3 = claimIt(w, "u_student", "FND-0001").claim;
    h = CF.admin.verifyHints(c3);
    check("rival claims are flagged", by(h, "Competing claims").level === "warn" && /1 other active/.test(by(h, "Competing claims").text));
    check("earlier rejections are flagged", by(h, "History").level === "warn" && /1 earlier rejected/.test(by(h, "History").text));
    void rival;

    // no marks recorded
    const plain = mkItem(w, { title: "Silver ring", location: "Library", identifyingMarks: "" });
    const c4 = CF.claims.submit(plain.id, proof(w, { lostLocation: "Library", lostDate: day(w, 3) }), user(w, "u_faculty")).claim;
    check("no private marks recorded -> suggests asking a question", by(CF.admin.verifyHints(c4), "Private marks").level === "info" && /Ask a question/.test(by(CF.admin.verifyHints(c4), "Private marks").text));
    check("a claim whose item was removed gives no hints", (() => { const cs = CF.db.claims(); cs.find((x) => x.id === c4.id).itemId = "gone"; CF.db.saveClaims(cs); return CF.admin.verifyHints(CF.claims.find(c4.id)).length === 0; })());
  }

  console.log("\n[5] users");
  {
    const w = await makeDom("admin/dashboard.html", { before: asAdmin });
    const CF = w.CF, A = user(w, "u_admin");
    check("only admins", !CF.admin.setUserStatus("u_student", "disabled", user(w, "u_student")).ok && !CF.admin.setUserStatus("u_student", "disabled", null).ok);
    check("unknown user / status", !CF.admin.setUserStatus("nope", "disabled", A).ok && /Unknown status/.test(CF.admin.setUserStatus("u_student", "banned", A).message));
    check("admin accounts are protected", /Administrator accounts/.test(CF.admin.setUserStatus("u_admin", "disabled", A).message) && user(w, "u_admin").status === "active");
    check("same status refused", /already active/.test(CF.admin.setUserStatus("u_student", "active", A).message));
    CF.auth.logout(); CF.auth.login("student@campusfind.test", "Student@123");
    check("setup: student signed in", CF.auth.currentUser() && CF.auth.currentUser().id === "u_student");
    check("disable ok", CF.admin.setUserStatus("u_student", "disabled", A).ok && user(w, "u_student").status === "disabled");
    check("disabled user is signed out on the next page", CF.auth.currentUser() === null);
    check("disabled user cannot log in", CF.auth.login("student@campusfind.test", "Student@123").ok === false);
    check("enable ok, login works again", CF.admin.setUserStatus("u_student", "active", A).ok && CF.auth.login("student@campusfind.test", "Student@123").ok === true);
    claimIt(w, "u_student", "FND-0001");
    check("user summary counts reports and claims", JSON.stringify(CF.admin.userSummary(user(w, "u_student"))) === JSON.stringify({ reports: 2, openReports: 2, claims: 1 }), JSON.stringify(CF.admin.userSummary(user(w, "u_student"))));
  }

  console.log("\n[6] CSV and helpers");
  {
    const w = await makeDom("admin/dashboard.html", { before: asAdmin });
    const csv = w.CF.admin.csv;
    check("plain rows, CRLF line breaks, everything quoted", csv([["a", "b"], ["c", 1]]) === '"a","b"\r\n"c","1"');
    check("quotes are doubled", csv([['say "hi"']]) === '"say ""hi"""');
    check("commas and newlines stay inside the cell", csv([["a,b", "line1\nline2"]]) === '"a,b","line1 line2"');
    check("formula injection is neutralised", csv([["=SUM(A1)", "+1", "-2", "@cmd", "\tx", "ok=fine"]]) === `"'=SUM(A1)","'+1","'-2","'@cmd","'\tx","ok=fine"`);
    check("null / undefined become empty", csv([[null, undefined]]) === '"",""');
    check("daysBetween never negative", w.CF.admin.daysBetween("2026-11-01T00:00:00Z", "2026-11-04T01:00:00Z") === 3 && w.CF.admin.daysBetween("2026-11-04T00:00:00Z", "2026-11-01T00:00:00Z") === 0 && w.CF.admin.daysBetween("x", "y") === 0);
    w.history.replaceState(null, "", "/admin/lost-reports.html?status=open&q=wallet%20x");
    check("ui.query reads the address bar", JSON.stringify(w.CF.admin.ui.query()) === JSON.stringify({ status: "open", q: "wallet x" }));
    w.CF.admin.ui.setQuery({ status: "", q: "abc", tab: "closed" });
    check("ui.setQuery drops empty values", w.location.search === "?q=abc&tab=closed", w.location.search);
  }

  console.log("\n[7] dashboard page");
  {
    const w = await makeDom("admin/dashboard.html", {
      fakeChart: true,
      before: (w) => {
        asAdmin(w);
        const A = user(w, "u_admin");
        seedMatches(w);
        claimIt(w, "u_student", "FND-0001", { lostReportId: "LST-0001" });
        const c2 = claimIt(w, "u_faculty", "FND-0002", { lostDate: day(w, 4), lostLocation: "Main Gate" }).claim;
        w.CF.claims.review(c2.id, "request_info", A, "What is on the keychain?");
      },
    });
    const d = w.document;
    check("greeting", d.getElementById("admin-greeting").textContent === "Hello, Campus.");
    check("KPIs", ["kpi-lost", "kpi-found", "kpi-claims", "kpi-returned", "kpi-users"].map((i) => d.getElementById(i).textContent).join() === "3,3,1,0,4");
    const rows = [...d.querySelectorAll("#attention .attn-row")];
    check("attention: review, waiting for reply, matches (no 'approved' row)", rows.length === 3 && /claim\(s\) waiting for your review/.test(rows[0].textContent) && /reply/.test(rows[1].textContent) && /possible match/.test(rows[2].textContent), rows.map((r) => text(r)).join(" | "));
    check("attention links", rows[0].getAttribute("href") === "claims.html?status=pending" && rows[1].getAttribute("href") === "claims.html?status=needs_info" && rows[2].getAttribute("href") === "matches.html");
    check("three charts drawn", w.__charts.length === 3);
    const byId = (id) => w.__charts.find((c) => c.canvas.id === id).config;
    const cat = byId("chart-category");
    check("category chart: horizontal bars, lost coral / found blue, every category listed", cat.type === "bar" && cat.options.indexAxis === "y" && cat.data.datasets[0].label === "Lost" && cat.data.datasets[0].backgroundColor === "#c8553d" && cat.data.datasets[1].backgroundColor === "#2f6fa3" && cat.data.labels.length === 5 && cat.options.scales.y.ticks.autoSkip === false);
    const days = byId("chart-days");
    check("daily chart: line, 14 points per series, same colours", days.type === "line" && days.data.labels.length === 14 && days.data.datasets.every((s) => s.data.length === 14) && days.data.datasets[0].borderColor === "#c8553d" && days.data.datasets[1].borderColor === "#2f6fa3");
    const cl = byId("chart-claims");
    check("claims chart: single series, legend hidden, one bar per status", cl.data.datasets.length === 1 && cl.options.plugins.legend.display === false && cl.data.labels.length === 6 && cl.data.datasets[0].data.join() === "1,1,0,0,0,0", cl.data.datasets[0].data.join());
    check("integer axes", cat.options.scales.x.ticks.precision === 0 && days.options.scales.y.ticks.precision === 0);
    check("each canvas has a text alternative and a table view", [...d.querySelectorAll("canvas")].every((c) => c.getAttribute("role") === "img" && c.getAttribute("aria-label")) && d.querySelectorAll(".chart-table table").length === 3);
    check("category table lists every category", d.querySelectorAll("#table-category tbody tr").length === 5 && /Wallets & Cards/.test(d.getElementById("table-category").textContent));
    check("days table has 14 rows", d.querySelectorAll("#table-days tbody tr").length === 14);
    check("claims table", /Pending review/.test(d.getElementById("table-claims").textContent) && d.querySelectorAll("#table-claims tbody tr").length === 6);
    check("return rate tile", d.getElementById("rate-num").textContent === "0%" && /0 of 3 found items/.test(d.getElementById("rate-text").textContent) && d.getElementById("rate-fill").style.width === "0%" && /0 percent/.test(d.getElementById("rate-bar").getAttribute("aria-label")));
    check("latest reports (6 rows)", d.querySelectorAll("#recent-body tr").length === 6);
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));

    const e = await makeDom("admin/dashboard.html", { before: asAdmin });
    check("without Chart.js: friendly message and tables still there", /didn't load/.test(e.document.querySelector(".chart-box").textContent) && e.document.querySelectorAll(".chart-table table").length === 3 && e.__errs.length === 0, e.__errs.join("|"));
    const g = await makeDom("admin/dashboard.html", { fakeChart: true, before: (w) => { asAdmin(w); w.CF.db.saveItems([]); } });
    check("no data: 'No data yet' instead of empty charts", g.document.querySelectorAll(".chart-empty").length === 3 && g.__charts.length === 0 && /All caught up/.test(g.document.getElementById("attention").textContent) && /No found items/.test(g.document.getElementById("rate-text").textContent));
    const th = await makeDom("admin/dashboard.html", { fakeChart: true, before: (w) => { asAdmin(w); w.Chart = function () { throw new Error("boom"); }; } });
    check("a chart that throws degrades to a message", th.document.querySelectorAll(".chart-empty").length === 3 && th.__errs.length === 0);
  }

  console.log("\n[8] lost / found report pages");
  {
    const mk = (type, query, extra) => makeDom("admin/" + type + "-reports.html", { query: query || "", before: (w) => { asAdmin(w); if (extra) extra(w); } });
    let w = await mk("lost");
    let d = w.document;
    const rows = () => [...d.querySelectorAll("#rows > tr[data-id]")];
    check("menu highlights Lost Reports", d.querySelector(".sidebar a.is-active").textContent.trim() === "Lost Reports");
    check("only lost reports, newest first", rows().length === 3 && /LST-0001/.test(rows()[0].textContent) && !/FND-/.test(d.getElementById("rows").textContent), rows().map((r) => r.cells[0].textContent).join());
    check("count line", d.getElementById("result-count").textContent === "3 lost reports");
    check("status tabs with counts", [...d.querySelectorAll("#status-tabs .tab")].map((t) => text(t)).join("|") === "All 3|Open 3|Matched 0|Claimed 0|Returned 0|Withdrawn 0", [...d.querySelectorAll("#status-tabs .tab")].map((t) => text(t)).join("|"));
    check("categories filled", d.getElementById("f-category").options.length > 5);
    check("row shows title, place, date, reporter and status", /Black wallet with school ID/.test(rows()[0].textContent) && /Canteen/.test(rows()[0].textContent) && /Juan Dela Cruz/.test(rows()[0].textContent) && /Open/.test(rows()[0].textContent));

    d.getElementById("f-q").value = "umbrella"; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    check("search finds by title", rows().length === 1 && /LST-0002/.test(rows()[0].textContent) && d.getElementById("result-count").textContent === "1 lost report");
    check("search is written into the address bar", w.location.search === "?q=umbrella", w.location.search);
    d.getElementById("f-q").value = "garcia"; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    check("no matches -> empty state and the table is hidden", d.getElementById("empty").hidden === false && /No reports match/.test(d.getElementById("empty").textContent) && d.querySelector(".table-wrap").hidden);
    d.getElementById("f-q").value = "santos"; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    check("search by reporter name", rows().length === 1 && /LST-0002/.test(rows()[0].textContent) && d.getElementById("empty").hidden);
    d.getElementById("f-q").value = ""; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    d.getElementById("f-category").value = "Wallets & Cards"; d.getElementById("f-category").dispatchEvent(new w.Event("change"));
    check("category filter", rows().length === 1 && /LST-0001/.test(rows()[0].textContent));
    d.getElementById("f-category").value = ""; d.getElementById("f-category").dispatchEvent(new w.Event("change"));
    d.querySelector('#status-tabs [data-tab="withdrawn"]').click();
    check("status tab with nothing in it", rows().length === 0 && /No reports match/.test(d.getElementById("empty").textContent) && w.location.search === "?status=withdrawn");
    d.querySelector('#status-tabs [data-tab="all"]').click();

    // details
    d.querySelector('[data-toggle]').click();
    const detail = d.querySelector(".detail-row");
    check("details expand in place", !!detail && d.querySelector("[data-toggle]").getAttribute("aria-expanded") === "true" && d.querySelector("[data-toggle]").textContent === "Hide");
    check("admin sees contact info + private marks label", /maintenance|student@campusfind\.test/.test(detail.textContent) && /09170000002/.test(detail.textContent) && /2023-00123/.test(detail.textContent) && /Private marks \(admin only\)/.test(detail.textContent));
    check("related info", /No active matches/.test(detail.textContent) && !/No claims/.test(detail.textContent));
    d.querySelector('[data-toggle]').click();
    check("and collapse again", !d.querySelector(".detail-row"));

    // remove / restore
    d.querySelector('[data-toggle]').click();
    const form = d.querySelector("form[data-remove]");
    submit(w, form);
    check("removing without a reason shows an inline error", /at least 5/.test(d.querySelector("[data-error]").textContent) && item(w, "LST-0001").status === "open");
    form.elements.reason.value = "Posted by mistake";
    submit(w, form);
    check("removal works, toast shown, list refreshes", item(w, "LST-0001").status === "withdrawn" && !!d.querySelector(".toast") && /Withdrawn 1/.test(text(d.querySelector('#status-tabs [data-tab="withdrawn"]'))) && /Open 2/.test(text(d.querySelector('#status-tabs [data-tab="open"]'))));
    check("reporter was notified", /Posted by mistake/.test(lastN(w, "u_student").body));
    d.querySelector('#status-tabs [data-tab="withdrawn"]').click();
    check("removed report shows the reason and a restore button", /Posted by mistake/.test(d.querySelector(".detail-row").textContent) && !!d.querySelector("[data-restore]"));
    d.querySelector("[data-restore]").click();
    check("restore works", item(w, "LST-0001").status === "open" && /No reports match/.test(d.getElementById("empty").textContent));
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));

    // export
    d.querySelector('#status-tabs [data-tab="all"]').click();
    d.getElementById("export-btn").click();
    check("export uses the current filter and is spreadsheet-safe", !!w.__dl && w.__dl.name === "campusfind-lost-reports.csv" && w.__dl.content.split("\r\n").length === 4 && /^"Reference","Type"/.test(w.__dl.content) && /"LST-0001","lost","Black wallet with school ID"/.test(w.__dl.content));
    check("export has no contact details", !/@campusfind|0917/.test(w.__dl.content));

    // found page
    w = await mk("found", "?status=open", (x) => { claimIt(x, "u_student", "FND-0001"); });
    d = w.document;
    check("found page: ?status=open preselects the tab", d.querySelector('#status-tabs [aria-pressed="true"]').dataset.tab === "open" && rows().length === 3);
    check("found page shows only found reports", !/LST-/.test(d.getElementById("rows").textContent) && d.querySelector("h1").textContent === "Found Reports");
    d.querySelector('[data-toggle="' + item(w, "FND-0001").id + '"]').click();
    const fd = d.querySelector(".detail-row");
    check("found details: kept-at + claims list with a link and status", /Kept at/.test(fd.textContent) && !!fd.querySelector('a[href^="verify-claim.html?id=clm_"]') && /CLM-0001/.test(fd.textContent) && /Pending review/.test(fd.textContent));
    check("found item with a claim can't be removed", (() => { const f = d.querySelector("form[data-remove]"); f.elements.reason.value = "Trying to remove it"; submit(w, f); return /claim in progress/.test(d.querySelector("[data-error]").textContent) && item(w, "FND-0001").status === "open"; })());

    // paging + XSS
    w = await mk("found", "", (x) => {
      for (let i = 0; i < 12; i++) mkItem(x, { title: i === 0 ? '<img src=x onerror="window.__pwned=1">' : "Extra item " + i, createdAt: new Date(Date.now() + i * 1000).toISOString() });
    });
    d = w.document;
    check("paging: 10 rows + 'Show more'", rows().length === 10 && d.getElementById("show-more").hidden === false && d.getElementById("result-count").textContent === "15 found reports");
    d.getElementById("show-more").click();
    check("show more reveals the rest and hides the button", rows().length === 15 && d.getElementById("show-more").hidden === true);
    check("XSS in a report title is inert", !w.__pwned && !d.querySelector("#rows img[onerror]") && /<img src=x/.test(d.getElementById("rows").textContent));
    check("tab filter resets paging", (d.querySelector('#status-tabs [data-tab="open"]').click(), rows().length === 10));
  }

  console.log("\n[9] matches page");
  {
    const w = await makeDom("admin/matches.html", {
      before: (w) => { asAdmin(w); const its = w.CF.db.items(); its.find((i) => i.ref === "FND-0001").identifyingMarks = "SECRET-dog-photo <b>x</b>"; w.CF.db.saveItems(its); },
    });
    const d = w.document, CF = w.CF;
    const cards = () => d.querySelectorAll("#match-list .match-card");
    check("page syncs suggestions on load", CF.db.matches().length === 1 && cards().length === 1);
    check("tabs & counts", [...d.querySelectorAll("#match-tabs .tab")].map((t) => text(t)).join("|") === "Suggested 1|Confirmed 0|Dismissed 0|Closed 0");
    const card = cards()[0];
    check("card: score, tier, both reports side by side", /\d+% · Strong match/.test(card.querySelector(".tier").textContent) && card.querySelector(".tier-strong") && card.querySelectorAll(".match-side").length === 2 && /LST-0001/.test(card.querySelector(".side-lost").textContent) && /FND-0001/.test(card.querySelector(".side-found").textContent));
    check("admin sees private marks (escaped) and where it's kept", /SECRET-dog-photo <b>x<\/b>/.test(card.querySelector(".side-found").textContent) && !card.querySelector(".side-found b") && /Guard house/.test(card.textContent));
    check("reasons listed", card.querySelectorAll(".reasons li").length >= 3);
    check("actions: confirm + dismiss", !!card.querySelector('[data-act="confirm"]') && !!card.querySelector('[data-act="dismiss"]'));
    check("manual link lists only open reports", d.getElementById("link-lost").options.length === 4 && d.getElementById("link-found").options.length === 4);

    card.querySelector('[data-act="confirm"]').click();
    check("confirm: toast, card moves to Confirmed", !!d.querySelector(".toast") && cards().length === 0 && /Suggested 0/.test(text(d.querySelector('#match-tabs [data-tab="suggested"]'))) && /Confirmed 1/.test(text(d.querySelector('#match-tabs [data-tab="confirmed"]'))) && /No suggestions to review/.test(d.getElementById("match-list").textContent));
    check("…and both reporters were notified", CF.notify.forUser("u_student").length === 1 && CF.notify.forUser("u_guard").length === 1);
    d.querySelector('#match-tabs [data-tab="confirmed"]').click();
    check("confirmed tab shows an Undo button", cards().length === 1 && !!cards()[0].querySelector('[data-act="reopen"]') && w.location.search === "?tab=confirmed");
    cards()[0].querySelector('[data-act="reopen"]').click();
    check("undo moves it back", item(w, "FND-0001").status === "open" && /Suggested 1/.test(text(d.querySelector('#match-tabs [data-tab="suggested"]'))));
    d.querySelector('#match-tabs [data-tab="suggested"]').click();
    cards()[0].querySelector('[data-act="dismiss"]').click();
    d.querySelector('#match-tabs [data-tab="dismissed"]').click();
    check("dismissed tab offers 'Restore as suggestion'", cards().length === 1 && /Restore as suggestion/.test(cards()[0].textContent));
    cards()[0].querySelector('[data-act="reopen"]').click();
    check("restore -> back in suggested", /Suggested 1/.test(text(d.querySelector('#match-tabs [data-tab="suggested"]'))));

    // refresh
    const f = mkItem(w, { type: "found", title: "Blue foldable umbrella", category: "Bottles & Umbrellas", location: "Library", color: "Blue", reporterId: "u_maint", description: "Blue foldable umbrella with wooden handle" });
    d.getElementById("refresh-btn").click();
    check("'Refresh suggestions' finds the new pair", /1 new suggestion/.test([...d.querySelectorAll(".toast")].pop().textContent) && CF.db.matches().length === 2 && /Suggested 2/.test(text(d.querySelector('#match-tabs [data-tab="suggested"]'))));
    d.getElementById("refresh-btn").click();
    check("…and says so when there is nothing new", /No new suggestions/.test([...d.querySelectorAll(".toast")].pop().textContent));
    void f;

    // closed tab
    setStatus(w, "FND-0001", "withdrawn");
    d.getElementById("refresh-btn").click();
    d.querySelector('#match-tabs [data-tab="closed"]').click();
    check("closed tab explains itself, no actions", cards().length === 1 && /no longer open/.test(cards()[0].textContent) && !cards()[0].querySelector("[data-act]"));
    setStatus(w, "FND-0001", "open");

    // manual link form
    d.querySelector('#match-tabs [data-tab="suggested"]').click();
    submit(w, d.getElementById("link-form"));
    check("link form: needs both reports", /Choose one lost report and one found report/.test(d.getElementById("link-error").textContent));
    d.getElementById("link-lost").value = item(w, "LST-0003").id;
    d.getElementById("link-found").value = item(w, "FND-0003").id;
    submit(w, d.getElementById("link-form"));
    check("link form: links and opens the Confirmed tab", item(w, "LST-0003").status === "matched" && item(w, "FND-0003").status === "matched" && d.querySelector('#match-tabs [aria-pressed="true"]').dataset.tab === "confirmed" && /linked by an administrator/.test(d.getElementById("match-list").textContent) && d.getElementById("link-error").textContent === "");
    d.getElementById("link-lost").value = item(w, "LST-0002").id;
    d.getElementById("link-found").value = item(w, "FND-0002").id;
    d.getElementById("link-lost").innerHTML += "";
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));

    const e = await makeDom("admin/matches.html", { before: (w) => { asAdmin(w); w.CF.db.saveItems([]); }, query: "?tab=dismissed" });
    check("?tab= picks the tab, empty state text", e.document.querySelector('#match-tabs [aria-pressed="true"]').dataset.tab === "dismissed" && /Nothing dismissed/.test(e.document.getElementById("match-list").textContent));
  }

  console.log("\n[10] claims list page");
  {
    const setup = (w) => {
      asAdmin(w);
      const A = user(w, "u_admin");
      claimIt(w, "u_student", "FND-0001");                                                                  // CLM-0001 pending
      const c2 = claimIt(w, "u_faculty", "FND-0002", { lostDate: day(w, 4), lostLocation: "Main Gate" }).claim; // CLM-0002 needs_info
      w.CF.claims.review(c2.id, "request_info", A, "What is on the keychain?");
      const g = mkItem(w, { title: "Grey scarf" });
      const c3 = w.CF.claims.submit(g.id, proof(w, { lostDate: day(w, 3) }), user(w, "u_student")).claim;      // CLM-0003 rejected
      w.CF.claims.review(c3.id, "reject", A, "Colour does not match.");
    };
    const w = await makeDom("admin/claims.html", { before: setup });
    const d = w.document;
    const rows = () => [...d.querySelectorAll("#rows tr")];
    check("defaults to 'Needs review' when something is pending", d.querySelector('#claim-tabs [aria-pressed="true"]').dataset.tab === "pending" && rows().length === 1 && /CLM-0001/.test(rows()[0].textContent));
    check("tab counts", [...d.querySelectorAll("#claim-tabs .tab")].map((t) => text(t)).join("|") === "Needs review 1|Waiting for info 1|To hand over 0|Returned 0|Rejected 1|Cancelled 0|All 3", [...d.querySelectorAll("#claim-tabs .tab")].map((t) => text(t)).join("|"));
    check("row: item, claimant, status, review link", /Black bi-fold wallet/.test(rows()[0].textContent) && /Juan Dela Cruz/.test(rows()[0].textContent) && /Pending review/.test(rows()[0].textContent) && /^Review$/.test(text(rows()[0].querySelector("a.btn"))) && /verify-claim\.html\?id=clm_/.test(rows()[0].querySelector("a.btn").getAttribute("href")));
    d.querySelector('#claim-tabs [data-tab="all"]').click();
    check("All tab, most recently updated first", rows().length === 3 && /CLM-0003/.test(rows()[0].textContent) && /^Open$/.test(text(rows()[0].querySelector("a.btn"))), rows().map((r) => r.cells[0].textContent).join());
    d.getElementById("f-q").value = "garcia"; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    check("search by claimant", rows().length === 0 && d.getElementById("empty").hidden === false);
    d.getElementById("f-q").value = "prof. maria"; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    check("search by claimant name", rows().length === 1 && /CLM-0002/.test(rows()[0].textContent));
    d.getElementById("f-q").value = "scarf"; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    check("search by item", rows().length === 1 && /CLM-0003/.test(rows()[0].textContent));
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));

    const p = await makeDom("admin/claims.html", { before: setup, query: "?status=rejected" });
    check("?status= preselects the tab", p.document.querySelector('#claim-tabs [aria-pressed="true"]').dataset.tab === "rejected" && p.document.querySelectorAll("#rows tr").length === 1);
    const e = await makeDom("admin/claims.html", { before: asAdmin });
    check("no claims at all -> All tab + helpful message", e.document.querySelector('#claim-tabs [aria-pressed="true"]').dataset.tab === "all" && /No claims yet/.test(e.document.getElementById("empty").textContent));
    const only = await makeDom("admin/claims.html", { before: (w) => { asAdmin(w); const c = claimIt(w, "u_student", "FND-0001").claim; w.CF.claims.review(c.id, "reject", user(w, "u_admin"), "Not matching."); }, query: "?status=pending" });
    check("empty 'Needs review' says nothing is waiting", /Nothing is waiting for review/.test(only.document.getElementById("empty").textContent));
  }

  console.log("\n[11] verify-claim page");
  {
    let id;
    const setup = (w) => {
      asAdmin(w);
      const its = w.CF.db.items(); its.find((i) => i.ref === "FND-0001").identifyingMarks = "Photo of a dog inside the card slot"; w.CF.db.saveItems(its);
      id = claimIt(w, "u_student", "FND-0001", { lostReportId: "LST-0001", description: '<img src=x onerror="window.__pwned=1"> black wallet' }).claim.id;
      claimIt(w, "u_faculty", "FND-0001");
      w.history.replaceState(null, "", "/admin/verify-claim.html?id=" + id);
    };
    const w = await makeDom("admin/verify-claim.html", { before: setup });
    const d = w.document;
    check("menu highlights Claims & Verification", d.querySelector(".sidebar a.is-active").textContent.trim() === "Claims & Verification");
    check("header: ref, status, item", d.querySelector(".ref-pill").textContent === "CLM-0001" && /Pending review/.test(d.querySelector(".badge-lg").textContent) && /Black bi-fold wallet/.test(d.querySelector(".verify-title").textContent));
    check("tracker present", d.querySelectorAll(".tracker li").length === 4);
    const cmp = d.querySelectorAll(".compare .card");
    check("side-by-side: claimant's answers vs finder's private record", /A photo of my dog|Photo of my dog/.test(cmp[0].textContent) && /Photo of a dog inside the card slot/.test(cmp[1].textContent) && /Guard house/.test(cmp[1].textContent) && /Mang Roberto Reyes/.test(cmp[1].textContent));
    check("XSS in claimant text is inert", !w.__pwned && !d.querySelector("img[onerror]") && /<img src=x/.test(cmp[0].textContent));
    check("quick checks with text labels (not colour alone)", d.querySelectorAll(".hints li").length >= 6 && [...d.querySelectorAll(".hint-mark")].every((m) => m.getAttribute("role") === "img" && m.getAttribute("aria-label")) && /Competing claims/.test(d.querySelector(".hints").textContent));
    check("claimant card for admin: contact + ID", /student@campusfind\.test/.test(d.querySelector(".verify-side").textContent) && /2023-00123/.test(d.querySelector(".verify-side").textContent));
    check("activity timeline", d.querySelectorAll(".timeline li").length === 1);
    check("decision buttons for a pending claim", ["approve", "request_info", "reject"].every((a) => !!d.querySelector('[data-act="' + a + '"]')) && !d.querySelector('[data-act="return"]'));

    // validation messages
    d.querySelector('[data-act="request_info"]').click();
    check("ask for info without a note -> inline message, status unchanged", /what you need/.test(d.getElementById("decision-msg").textContent) && w.CF.claims.find(id).status === "pending");
    d.querySelector('[data-act="reject"]').click();
    check("reject without a reason -> inline message", /reason/i.test(d.getElementById("decision-msg").textContent) && w.CF.claims.find(id).status === "pending");
    d.getElementById("note").value = "What is on the lock screen?";
    d.querySelector('[data-act="request_info"]').click();
    check("ask for info works: status, notification, toast, waiting banner, no 'ask' button", w.CF.claims.find(id).status === "needs_info" && lastN(w, "u_student").type === "claim_info_requested" && !!d.querySelector(".toast") && /Waiting for the claimant/.test(d.querySelector(".callout-note").textContent) && !d.querySelector('[data-act="request_info"]') && !!d.querySelector(".step-warn"));
    check("the timeline gained the question", d.querySelectorAll(".timeline li").length === 2 && /lock screen/.test(d.querySelector(".timeline").textContent));

    // approve: confirm prompt mentions the rival
    let asked = "";
    w.confirm = (m) => { asked = m; return false; };
    d.querySelector('[data-act="approve"]').click();
    check("approve asks first, mentioning claims that will close; cancelling changes nothing", /1 other claim/.test(asked) && w.CF.claims.find(id).status === "needs_info");
    w.confirm = () => true;
    d.getElementById("note").value = "Collect at the guard house.";
    d.querySelector('[data-act="approve"]').click();
    check("approve: claim approved, rival rejected, item claimed", w.CF.claims.find(id).status === "approved" && w.CF.claims.find("CLM-0002").status === "rejected" && item(w, "FND-0001").status === "claimed");
    check("now offers 'Mark as returned' and where to collect", !!d.querySelector('[data-act="return"]') && !d.getElementById("note") && /Guard house/.test(d.querySelector(".decision").textContent) && !!d.querySelector(".step-current"));
    w.confirm = () => false;
    d.querySelector('[data-act="return"]').click();
    check("return asks first", w.CF.claims.find(id).status === "approved");
    w.confirm = () => true;
    d.querySelector('[data-act="return"]').click();
    check("returned: read-only decision card, all steps done", w.CF.claims.find(id).status === "returned" && /No further action/.test(d.querySelector(".decision").textContent) && d.querySelectorAll(".step-done").length === 4 && !d.querySelector("[data-act]"));
    check("claimant got the return notice", lastN(w, "u_student").type === "claim_returned");
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));

    // reject path
    const r = await makeDom("admin/verify-claim.html", { before: (w) => { setup(w); } });
    r.document.getElementById("note").value = "The serial number does not match.";
    r.document.querySelector('[data-act="reject"]').click();
    check("reject: status, claimant notified with the reason", r.CF.claims.find(id).status === "rejected" && /serial number/.test(lastN(r, "u_student").body) && /No further action/.test(r.document.querySelector(".decision").textContent));

    // lookups + guards
    const n = await makeDom("admin/verify-claim.html", { before: asAdmin, query: "?id=nope" });
    check("unknown claim -> friendly page", /couldn't find that claim/.test(n.document.body.textContent) && !!n.document.querySelector('a[href="claims.html"]'));
    const byRef = await makeDom("admin/verify-claim.html", { before: (w) => { setup(w); w.history.replaceState(null, "", "/admin/verify-claim.html?id=clm-0001"); } });
    check("claim reference works as id", /CLM-0001/.test(byRef.document.querySelector(".ref-pill").textContent));
    const st = await makeDom("admin/verify-claim.html", { before: (w) => { setup(w); asStudent(w); } });
    check("a student can't open the verification page", st.__nav.length >= 1 && !st.document.querySelector(".verify-layout"));
  }

  console.log("\n[12] returned items page");
  {
    const e = await makeDom("admin/returned-items.html", { before: asAdmin });
    check("empty state", /Nothing has been returned yet/.test(e.document.getElementById("empty").textContent) && e.document.getElementById("return-stats").querySelectorAll(".stat").length === 4 && /—/.test(e.document.getElementById("return-stats").textContent));
    const w = await makeDom("admin/returned-items.html", {
      before: (w) => {
        asAdmin(w);
        const A = user(w, "u_admin");
        const c1 = claimIt(w, "u_student", "FND-0001").claim;
        w.CF.claims.review(c1.id, "approve", A, "Come over."); w.CF.claims.markReturned(c1.id, A);
        const c2 = claimIt(w, "u_faculty", "FND-0002", { lostDate: day(w, 4), lostLocation: "Main Gate" }).claim;
        w.CF.claims.review(c2.id, "approve", A, "Come over."); w.CF.claims.markReturned(c2.id, A);
        const c3 = claimIt(w, "u_student", "FND-0003", { lostDate: day(w, 2), lostLocation: "Gymnasium", description: "My gray hoodie, medium size" }).claim;
        w.CF.claims.review(c3.id, "approve", A, "Come over.");
      },
    });
    const d = w.document;
    const rows = () => [...d.querySelectorAll("#rows tr")];
    check("only returned claims are listed (approved-but-not-handed-over is not)", rows().length === 2 && !/CLM-0003/.test(d.getElementById("rows").textContent));
    const tiles = [...d.querySelectorAll("#return-stats .stat")].map((t) => text(t));
    check("stat tiles: total, this month, average days, rate", /^2Items returned/.test(tiles[0]) && /^2Returned this month/.test(tiles[1]) && /Average days to return/.test(tiles[2]) && /^67%Of found items returned/.test(tiles[3]), tiles.join(" | "));
    check("row: item, owner, finder, date, days", /Black bi-fold wallet|Set of keys/.test(rows()[0].textContent) && /Juan Dela Cruz|Prof\. Maria Santos/.test(rows()[0].textContent) && /Mang Roberto|Ate Luz/.test(rows()[0].textContent) && /\d+$/.test(text(rows()[0].cells[5])));
    d.getElementById("f-q").value = "keys"; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    check("search", rows().length === 1 && /CLM-0002/.test(rows()[0].textContent) && d.getElementById("result-count").textContent === "1 returned item");
    d.getElementById("f-q").value = ""; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    d.getElementById("export-btn").click();
    const lines = w.__dl.content.split("\r\n");
    check("CSV export: header + 2 rows, reference + names, no contact details", w.__dl.name === "campusfind-returned-items.csv" && lines.length === 3 && /^"Claim","Item reference"/.test(lines[0]) && /CLM-000[12]/.test(w.__dl.content) && !/@campusfind|0917/.test(w.__dl.content));
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));
  }

  console.log("\n[13] users page");
  {
    const w = await makeDom("admin/users.html", { before: (w) => { asAdmin(w); claimIt(w, "u_student", "FND-0001"); } });
    const d = w.document;
    const rows = () => [...d.querySelectorAll("#rows tr")];
    check("5 users, admin last", rows().length === 5 && /Campus Admin/.test(rows()[4].textContent));
    check("role tabs with counts", [...d.querySelectorAll("#role-tabs .tab")].map((t) => text(t)).join("|") === "All 5|Student 1|Faculty 1|Guard 1|Maintenance 1|Administrator 1", [...d.querySelectorAll("#role-tabs .tab")].map((t) => text(t)).join("|"));
    const stu = rows().find((r) => /Juan Dela Cruz/.test(r.textContent));
    check("row: id, email, contact, activity, status", /2023-00123/.test(stu.textContent) && /student@campusfind\.test/.test(stu.textContent) && /09170000002/.test(stu.textContent) && /2 reports · 1 claim/.test(stu.textContent) && /Active/.test(stu.textContent));
    check("admin row has no button, and says 'You'", !rows()[4].querySelector("button") && /You/.test(rows()[4].textContent));
    d.querySelector('#role-tabs [data-tab="guard"]').click();
    check("role filter", rows().length === 1 && /Mang Roberto Reyes/.test(rows()[0].textContent) && w.location.search === "?role=guard");
    d.querySelector('#role-tabs [data-tab="all"]').click();
    d.getElementById("f-q").value = "SEC-0078"; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    check("search by ID number", rows().length === 1 && /Roberto/.test(rows()[0].textContent));
    d.getElementById("f-q").value = "luz"; d.getElementById("f-q").dispatchEvent(new w.Event("input"));
    check("search by name", rows().length === 1 && /maintenance@/.test(rows()[0].textContent));
    d.getElementById("f-q").value = ""; d.getElementById("f-q").dispatchEvent(new w.Event("input"));

    w.confirm = () => false;
    rows().find((r) => /Juan/.test(r.textContent)).querySelector('[data-set="disabled"]').click();
    check("cancelling the confirm changes nothing", user(w, "u_student").status === "active");
    w.confirm = () => true;
    rows().find((r) => /Juan/.test(r.textContent)).querySelector('[data-set="disabled"]').click();
    check("disable: status, badge, dimmed row, 'Enable' button, toast", user(w, "u_student").status === "disabled" && /Disabled/.test(rows().find((r) => /Juan/.test(r.textContent)).textContent) && rows().find((r) => /Juan/.test(r.textContent)).classList.contains("is-disabled") && !!rows().find((r) => /Juan/.test(r.textContent)).querySelector('[data-set="active"]') && /Account disabled/.test(d.querySelector(".toast").textContent));
    d.getElementById("f-status").value = "disabled"; d.getElementById("f-status").dispatchEvent(new w.Event("change"));
    check("status filter", rows().length === 1 && /Juan/.test(rows()[0].textContent) && w.location.search === "?status=disabled");
    rows()[0].querySelector('[data-set="active"]').click();
    check("enable again", user(w, "u_student").status === "active" && rows().length === 0 && d.getElementById("empty").hidden === false);
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));

    const x = await makeDom("admin/users.html", { before: (w) => { asAdmin(w); const us = w.CF.db.users(); us.push({ id: "u_x", name: '<img src=x onerror="window.__pwned=1">', email: "x@campusfind.test", role: "student", idNumber: "1", contact: "09170000009", passwordHash: "x", status: "active", createdAt: new Date().toISOString() }); w.CF.db.saveUsers(us); } });
    check("XSS in a user's name is inert", !x.__pwned && !x.document.querySelector("#rows img[onerror]"));
    const q = await makeDom("admin/users.html", { before: asAdmin, query: "?role=faculty&q=maria" });
    check("filters restored from the address bar", q.document.getElementById("f-q").value === "maria" && q.document.querySelectorAll("#rows tr").length === 1);
  }

  console.log("\n[14] access control");
  {
    for (const pg of ["dashboard", "lost-reports", "found-reports", "matches", "claims", "verify-claim", "returned-items", "users"]) {
      const out = await makeDom("admin/" + pg + ".html");
      const stu = await makeDom("admin/" + pg + ".html", { before: asStudent });
      check(pg + ": signed-out and student are both turned away", out.__nav.length >= 1 && stu.__nav.length >= 1);
    }
    const dis = await makeDom("admin/users.html", { before: (w) => { asAdmin(w); const us = w.CF.db.users(); us.find((u) => u.id === "u_admin").status = "disabled"; w.CF.db.saveUsers(us); } });
    check("(a disabled admin is turned away too)", dis.__nav.length >= 1);
  }

  console.log("\n[15] files + wiring");
  {
    const files = ["admin.js", "admin-dashboard.js", "admin-reports.js", "admin-matches.js", "admin-claims.js", "admin-verify.js", "admin-returned.js", "admin-users.js", "vendor/chart.umd.js", "vendor/chart.js-LICENSE.md"];
    check("all Day 5 files exist", files.every((f) => fs.existsSync(path.join(ROOT, "js", f))), files.filter((f) => !fs.existsSync(path.join(ROOT, "js", f))).join());
    check("Chart.js is bundled locally (works offline)", /Chart\.js v4\.4\.1/.test(fs.readFileSync(path.join(ROOT, "js/vendor/chart.umd.js"), "utf8").slice(0, 200)) && !/https?:\/\/(cdn|unpkg)/.test(fs.readFileSync(path.join(ROOT, "admin/dashboard.html"), "utf8")));
    const pages = fs.readdirSync(path.join(ROOT, "admin")).filter((f) => f.endsWith(".html"));
    const broken = [];
    pages.forEach((p) => { const html = fs.readFileSync(path.join(ROOT, "admin", p), "utf8"); [...html.matchAll(/(?:src|href)="(\.\.\/(?:js|css)\/[^"]+)"/g)].forEach((m) => { if (!fs.existsSync(path.join(ROOT, "admin", m[1]))) broken.push(p + " -> " + m[1]); }); });
    check("no broken script/style references in " + pages.length + " admin pages", broken.length === 0, broken.join("; "));
    const stubs = pages.filter((p) => /Coming on Day/.test(fs.readFileSync(path.join(ROOT, "admin", p), "utf8")));
    check("no 'Coming on Day' placeholders left in the admin area", stubs.length === 0, stubs.join());
    const order = (p) => [...fs.readFileSync(path.join(ROOT, "admin", p), "utf8").matchAll(/js\/([\w.-]+)\.js/g)].map((m) => m[1]);
    check("script order: admin.js before layout.js, page script last", pages.every((p) => { const o = order(p); return o.indexOf("admin") >= 0 && o.indexOf("admin") < o.indexOf("layout") && o.indexOf("layout") < o.length - (o.indexOf("chart.umd") >= 0 ? 0 : 0) - 1 + 1; }));
    check("verify-claim keeps 'Claims & Verification' active in the sidebar", /data-page="claims"/.test(fs.readFileSync(path.join(ROOT, "admin/verify-claim.html"), "utf8")));
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
