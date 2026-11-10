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
  w.__prompts = [];
  w.prompt = (msg) => { w.__prompts.push(msg); return opts.prompt === undefined ? "ok thanks" : (typeof opts.prompt === "function" ? opts.prompt(msg) : opts.prompt); };
  const load = (f) => w.eval(fs.readFileSync(path.join(ROOT, "js", f), "utf8"));
  const scripts = [...html.matchAll(/<script src="(?:\.\.\/)?js\/([^"]+)"/g)].map((m) => m[1]);
  w.__nav = nav; w.__errs = errs;
  const early = ["app.js", "auth.js", "reports.js", "search-match.js", "claims.js"].filter((f) => ["app.js", "auth.js"].includes(f) || scripts.includes(f));
  early.forEach(load);
  if (opts.before) opts.before(w);
  scripts.filter((s) => !early.includes(s)).forEach(load);
  if (w.document.readyState !== "complete") await new Promise((r) => w.addEventListener("load", r));
  return w;
}

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const login = (email, pw) => (w) => w.CF.auth.login(email, pw);
const asStudent = login("student@campusfind.test", "Student@123");
const asGuard = login("guard@campusfind.test", "Guard@123");
const asFaculty = login("faculty@campusfind.test", "Faculty@123");
const asMaint = login("maintenance@campusfind.test", "Maint@123");
const asAdmin = login("admin@campusfind.test", "Admin@123");
const text = (n) => n.textContent.replace(/\s+/g, " ").trim();
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

const day = (w, n) => w.CF.util.toDayStr(w.CF.util.daysAgoISO(n));
const proof = (w, over) => Object.assign({
  description: "Black leather bi-fold wallet, a bit worn at the edges.",
  proofDetails: "Photo of my dog in the card slot",
  lostDate: day(w, 2), lostLocation: "Canteen", lostReportId: "", evidence: [], declaration: true,
}, over || {});
const user = (w, id) => w.CF.db.userById(id);
const item = (w, ref) => w.CF.reports.find(ref);
const claimIt = (w, userId, ref, over) => w.CF.claims.submit(item(w, ref).id, proof(w, over), user(w, userId));
const mkItem = (w, over) => {
  const CF = w.CF;
  const it = Object.assign({ id: CF.util.uid("item"), ref: CF.util.nextRef(over.type === "lost" ? "LST" : "FND"), type: "found", title: "Thing", category: "Others", color: "", brand: "", location: "Library", locationDetail: "", dateOccurred: CF.util.todayStr(), description: "A plain description here.", identifyingMarks: "", storedAt: "Guard house / Main Gate", photo: null, status: "open", reporterId: "u_guard", createdAt: new Date().toISOString() }, over);
  CF.db.saveItems(CF.db.items().concat(it));
  return it;
};

(async () => {
  console.log("\n[1] notifications core");
  {
    const w = await makeDom("claim-form.html", { before: asStudent });
    const N = w.CF.notify;
    check("starts empty", N.unreadCount("u_student") === 0 && N.forUser("u_student").length === 0);
    const a = N.add("u_student", { type: "info", title: "First", body: "one", link: "my-claims.html" });
    N.add("u_student", { type: "info", title: "Second", body: "two" });
    N.add("u_guard", { type: "info", title: "Other user's", body: "x" });
    check("add returns the entry", a.title === "First" && a.read === false && !!a.id && !!a.createdAt);
    check("scoped per user", N.forUser("u_student").length === 2 && N.forUser("u_guard").length === 1);
    check("unread count", N.unreadCount("u_student") === 2);
    check("newest first", N.forUser("u_student")[0].title === "Second");
    check("markRead works once", N.markRead(a.id, "u_student") === true && N.markRead(a.id, "u_student") === false && N.unreadCount("u_student") === 1);
    check("cannot mark someone else's notification", N.markRead(N.forUser("u_guard")[0].id, "u_student") === false && N.unreadCount("u_guard") === 1);
    check("markAllRead returns how many", N.markAllRead("u_student") === 1 && N.unreadCount("u_student") === 0 && N.unreadCount("u_guard") === 1);
    check("add ignores missing user / payload", N.add(null, { title: "x" }) === null && N.add("u_student", null) === null);
    check("long text is truncated", N.add("u_student", { title: "t".repeat(500), body: "b".repeat(900) }).title.length === 120);
    for (let i = 0; i < 120; i++) N.add("u_faculty", { title: "n" + i, body: "" });
    check("keeps at most 100 per user, dropping the oldest", N.forUser("u_faculty").length === 100 && N.forUser("u_faculty")[0].title === "n119" && !N.forUser("u_faculty").some((n) => n.title === "n0"));
    check("cap does not touch other users", N.forUser("u_guard").length === 1);
  }

  console.log("\n[2] who may claim");
  {
    const w = await makeDom("claim-form.html", { before: asStudent });
    const C = w.CF.claims, F1 = item(w, "FND-0001");
    check("student can claim a found item", C.eligibility(F1, user(w, "u_student")).ok);
    check("the finder cannot claim their own item", C.eligibility(F1, user(w, "u_guard")).code === "own");
    check("lost reports cannot be claimed", C.eligibility(item(w, "LST-0001"), user(w, "u_faculty")).code === "type");
    check("admins cannot claim", C.eligibility(F1, user(w, "u_admin")).code === "admin");
    check("missing item", C.eligibility(null, user(w, "u_student")).code === "notfound");
    check("signed-out", C.eligibility(F1, null).code === "login");
    const closed = mkItem(w, { status: "claimed", title: "Closed thing" });
    check("claimed items are closed", C.eligibility(closed, user(w, "u_student")).code === "closed");
    check("matched items are still claimable", C.eligibility(mkItem(w, { status: "matched" }), user(w, "u_student")).ok);
    const r = claimIt(w, "u_student", "FND-0001");
    check("after claiming: 'active' with the claim attached", C.eligibility(F1, user(w, "u_student")).code === "active" && C.eligibility(F1, user(w, "u_student")).claim.id === r.claim.id);
    check("other people can still claim the same item", C.eligibility(F1, user(w, "u_faculty")).ok);
    // attempts limit: 3 rejected claims then blocked
    const A = user(w, "u_admin"), T = mkItem(w, { title: "Limit thing" });
    for (let i = 0; i < 3; i++) {
      const c = C.submit(T.id, proof(w, { lostDate: day(w, 3) }), user(w, "u_faculty"));
      check("attempt " + (i + 1) + " accepted", c.ok, JSON.stringify(c));
      C.review(c.claim.id, "reject", A, "Not enough proof");
    }
    const fourth = C.eligibility(T, user(w, "u_faculty"));
    check("4th claim on the same item is blocked", fourth.code === "limit" && /3 claims/.test(fourth.message));
  }

  console.log("\n[3] validation");
  {
    const w = await makeDom("claim-form.html", { before: asStudent });
    const C = w.CF.claims, F1 = item(w, "FND-0001"), u = user(w, "u_student");
    const errs = (over) => C.validate(F1, proof(w, over), u).errors;
    check("valid proof has no errors", Object.keys(errs()).length === 0, JSON.stringify(errs()));
    const empty = C.validate(F1, {}, u).errors;
    check("empty form flags every required field", ["description", "proofDetails", "lostDate", "lostLocation", "declaration"].every((k) => empty[k]), JSON.stringify(empty));
    check("short description", !!errs({ description: "too short" }).description);
    check("501-char description", !!errs({ description: "x".repeat(501) }).description);
    check("short proof details", !!errs({ proofDetails: "no" }).proofDetails);
    check("whitespace-only proof", !!errs({ proofDetails: "     " }).proofDetails);
    check("bad date", !!errs({ lostDate: "yesterday" }).lostDate);
    const fut = new Date(); fut.setDate(fut.getDate() + 1);
    check("future date", /future/.test(errs({ lostDate: w.CF.util.toDayStr(fut) }).lostDate));
    check("more than a year ago", /year/.test(errs({ lostDate: "2020-01-01" }).lostDate));
    check("cannot be lost AFTER it was found", /after it was found/.test(errs({ lostDate: w.CF.util.todayStr() }).lostDate));
    check("same day as found is fine", !errs({ lostDate: day(w, 1) }).lostDate);
    check("unknown place", !!errs({ lostLocation: "Moon" }).lostLocation);
    check("declaration must be exactly true", !!errs({ declaration: false }).declaration && !!errs({ declaration: "yes" }).declaration);
    check("values are trimmed", C.validate(F1, proof(w, { description: "   " + "d".repeat(20) + "   " }), u).clean.description === "d".repeat(20));

    // linked lost report rules
    check("own open lost report may be linked", !errs({ lostReportId: "LST-0001" }).lostReportId);
    check("linked report is normalised to its id", C.validate(F1, proof(w, { lostReportId: "LST-0001" }), u).clean.lostReportId === item(w, "LST-0001").id);
    check("someone else's lost report is rejected", !!errs({ lostReportId: "LST-0002" }).lostReportId);
    check("a found report can't be linked", !!errs({ lostReportId: "FND-0002" }).lostReportId);
    check("unknown report id is rejected", !!errs({ lostReportId: "nope" }).lostReportId);
    const items = w.CF.db.items(); items.find((i) => i.ref === "LST-0001").status = "withdrawn"; w.CF.db.saveItems(items);
    check("withdrawn lost report can't be linked", !!errs({ lostReportId: "LST-0001" }).lostReportId);

    // evidence
    check("2 photos ok", !errs({ evidence: [PNG, PNG] }).evidence);
    check("3 photos rejected", !!errs({ evidence: [PNG, PNG, PNG] }).evidence);
    check("unsafe photo rejected", !!errs({ evidence: ["javascript:alert(1)"] }).evidence && !!errs({ evidence: ["data:image/svg+xml;base64,PHN2Zz4="] }).evidence && !!errs({ evidence: ["https://evil.test/a.png"] }).evidence);
  }

  console.log("\n[4] submitting a claim");
  {
    const w = await makeDom("claim-form.html", { before: asStudent });
    const C = w.CF.claims, u = user(w, "u_student");
    const before = JSON.stringify(item(w, "FND-0001"));
    const r = claimIt(w, "u_student", "FND-0001", { lostReportId: "LST-0001", evidence: [PNG] });
    check("submit ok with reference CLM-0001", r.ok && r.claim.ref === "CLM-0001" && r.claim.status === "pending", JSON.stringify(r));
    check("record fields", r.claim.claimantId === "u_student" && r.claim.itemId === item(w, "FND-0001").id && r.claim.lostReportId === item(w, "LST-0001").id && r.claim.evidence.length === 1 && r.claim.declaration === true);
    check("timeline starts with 'submitted'", r.claim.timeline.length === 1 && r.claim.timeline[0].kind === "submitted" && r.claim.timeline[0].byRole === "claimant");
    check("persisted + findable by ref (any case) and id", C.find("clm-0001").id === r.claim.id && C.find(r.claim.id).ref === "CLM-0001");
    check("submitting does NOT change the item's status", JSON.stringify(item(w, "FND-0001")) === before);
    const n = w.CF.notify.forUser("u_student");
    check("claimant gets a confirmation notification", n.length === 1 && n[0].type === "claim_submitted" && /CLM-0001/.test(n[0].title) && n[0].link === "claim-details.html?id=" + r.claim.id && /Black bi-fold wallet/.test(n[0].body));
    check("duplicate active claim blocked", claimIt(w, "u_student", "FND-0001").code === "active");
    check("own item blocked with message", /can't claim it/.test(claimIt(w, "u_guard", "FND-0001").message));
    check("validation errors returned, nothing saved", !!claimIt(w, "u_faculty", "FND-0001", { description: "x" }).errors.description && C.forUser("u_faculty").length === 0);
    check("second claimant allowed (competing claim)", claimIt(w, "u_faculty", "FND-0001").ok && C.forItem(item(w, "FND-0001").id).length === 2);
    check("forUser is scoped and newest first", C.forUser("u_student").length === 1 && C.forUser("u_faculty")[0].ref === "CLM-0002");

    // storage full -> rolled back
    const counters = JSON.stringify(w.CF.storage.get(w.CF.KEYS.counters, {}));
    const before2 = C.forUser("u_maint").length;
    const orig = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = function (k, v) { if (k === w.CF.KEYS.claims) throw new Error("QuotaExceededError"); return orig.call(this, k, v); };
    const full = claimIt(w, "u_maint", "FND-0001");
    w.Storage.prototype.setItem = orig;
    check("quota error is reported", !full.ok && /storage is full/i.test(full.message));
    check("rollback: no claim, counter unchanged", C.forUser("u_maint").length === before2 && JSON.stringify(w.CF.storage.get(w.CF.KEYS.counters, {})) === counters);
    const again = claimIt(w, "u_maint", "FND-0001");
    check("works afterwards and the reference isn't skipped", again.ok && again.claim.ref === "CLM-0003", again.claim && again.claim.ref);
    check("evidence is stored as safe photos only", C.submit(item(w, "FND-0002").id, proof(w, { lostDate: day(w, 4), evidence: [PNG] }), u).claim.evidence.every((p) => w.CF.reports.isSafePhoto(p)));
  }

  console.log("\n[5] review flow (admin) + notifications");
  {
    const w = await makeDom("claim-form.html", { before: asStudent });
    const C = w.CF.claims, A = user(w, "u_admin"), S = user(w, "u_student"), N = w.CF.notify;
    w.CF.match.syncAll();
    const mine = claimIt(w, "u_student", "FND-0001", { lostReportId: "LST-0001" }).claim;
    const rival = claimIt(w, "u_faculty", "FND-0001").claim;
    const lastN = (uid) => N.forUser(uid)[0];

    check("non-admin cannot review", !C.review(mine.id, "approve", S, "").ok && !C.review(mine.id, "approve", null, "").ok);
    check("unknown action / claim", !C.review(mine.id, "explode", A, "x").ok && !C.review("nope", "approve", A, "x").ok);

    // request more info
    check("request_info needs a note", !C.review(mine.id, "request_info", A, "").ok && /what you need/.test(C.review(mine.id, "request_info", A, "no").message));
    let r = C.review(mine.id, "request_info", A, "What is on the lock screen of the phone?");
    check("request_info -> needs_info", r.ok && C.find(mine.id).status === "needs_info");
    check("claimant notified with the question", lastN("u_student").type === "claim_info_requested" && /lock screen/.test(lastN("u_student").body) && /CLM-0001/.test(lastN("u_student").title));
    check("timeline records the request by the admin", C.find(mine.id).timeline.slice(-1)[0].kind === "info_requested" && C.find(mine.id).timeline.slice(-1)[0].byRole === "admin");
    check("cannot request twice", /Already waiting/.test(C.review(mine.id, "request_info", A, "Another question here").message));

    // reply
    check("others cannot reply", !C.reply(mine.id, { text: "hello there" }, user(w, "u_faculty")).ok);
    check("cannot reply on a pending claim", !C.reply(rival.id, { text: "hello there" }, user(w, "u_faculty")).ok);
    check("reply needs text", !!C.reply(mine.id, { text: "no" }, S).errors.text && !!C.reply(mine.id, { text: "x".repeat(501) }, S).errors.text);
    check("reply rejects bad photos", !!C.reply(mine.id, { text: "It shows a beach", photos: ["javascript:1"] }, S).errors.photo && !!C.reply(mine.id, { text: "It shows a beach", photos: [PNG, PNG] }, S).errors.photo);
    r = C.reply(mine.id, { text: "It shows a beach at sunset", photos: [PNG] }, S);
    check("reply -> back to pending", r.ok && C.find(mine.id).status === "pending");
    check("reply recorded with photo", C.find(mine.id).timeline.slice(-1)[0].kind === "reply" && C.find(mine.id).timeline.slice(-1)[0].photos.length === 1);
    check("can't reply when nothing was asked", !C.reply(mine.id, { text: "another message here" }, S).ok);

    // approve
    r = C.review(mine.id, "approve", A, "Pick it up at the admin office.");
    const it = item(w, "FND-0001");
    check("approve -> approved", r.ok && C.find(mine.id).status === "approved");
    check("found item becomes 'claimed'", it.status === "claimed");
    check("linked lost report becomes 'claimed'", item(w, "LST-0001").status === "claimed");
    check("stored match suggestion is confirmed", w.CF.db.matches().find((m) => m.foundId === it.id && m.lostId === item(w, "LST-0001").id).status === "confirmed");
    check("rival claim auto-rejected", C.find(rival.id).status === "rejected" && C.find(rival.id).timeline.slice(-1)[0].kind === "auto_rejected" && C.find(rival.id).timeline.slice(-1)[0].byRole === "system");
    check("rival notified", lastN("u_faculty").type === "claim_rejected" && /Another claim/.test(lastN("u_faculty").body));
    check("winner notified with the pickup note", lastN("u_student").type === "claim_approved" && /admin office/.test(lastN("u_student").body));
    check("approved item leaves default search", w.CF.match.search({}).results.every((x) => x.item.ref !== "FND-0001"));
    check("can't approve twice / reject after approve", !C.review(mine.id, "approve", A, "").ok && !C.review(mine.id, "reject", A, "Too late for that").ok);
    check("a new claim on a claimed item is closed", claimIt(w, "u_maint", "FND-0001").code === "closed");

    // return
    check("only admins mark returned", !C.markReturned(mine.id, S).ok);
    check("can't return a claim that isn't approved", !C.markReturned(rival.id, A).ok);
    r = C.markReturned(mine.id, A);
    check("markReturned -> returned + items returned", r.ok && C.find(mine.id).status === "returned" && item(w, "FND-0001").status === "returned" && item(w, "LST-0001").status === "returned");
    check("claimant notified of the return", lastN("u_student").type === "claim_returned");
    check("can't return twice", !C.markReturned(mine.id, A).ok);

    // reject path
    const G = mkItem(w, { title: "Grey scarf", category: "Clothing" });
    const c2 = C.submit(G.id, proof(w, { lostDate: day(w, 3) }), user(w, "u_maint")).claim;
    check("reject needs a reason", !C.review(c2.id, "reject", A, "").ok);
    r = C.review(c2.id, "reject", A, "Colour does not match our record.");
    check("reject -> rejected, item stays open", r.ok && C.find(c2.id).status === "rejected" && item(w, G.ref).status === "open");
    check("rejection notifies with the reason", lastN("u_maint").type === "claim_rejected" && /Colour does not match/.test(lastN("u_maint").body));
    check("rejected claimant may try again", C.eligibility(G, user(w, "u_maint")).ok);

    // approving something no longer available
    const H = mkItem(w, { title: "Blue pen case" });
    const c3 = C.submit(H.id, proof(w, { lostDate: day(w, 3) }), user(w, "u_maint")).claim;
    const its = w.CF.db.items(); its.find((i) => i.id === H.id).status = "withdrawn"; w.CF.db.saveItems(its);
    check("can't approve when the item is gone", /no longer available/.test(C.review(c3.id, "approve", A, "").message) && C.find(c3.id).status === "pending");

    // cancel
    const J = mkItem(w, { title: "Silver ring" });
    const c4 = C.submit(J.id, proof(w, { lostDate: day(w, 3) }), user(w, "u_faculty")).claim;
    check("only the claimant may cancel", !C.cancel(c4.id, S).ok && !C.cancel(c4.id, null).ok);
    check("cancel works", C.cancel(c4.id, user(w, "u_faculty")).ok && C.find(c4.id).status === "cancelled" && C.find(c4.id).timeline.slice(-1)[0].kind === "cancelled");
    check("can't cancel twice", !C.cancel(c4.id, user(w, "u_faculty")).ok);
    check("can claim again after cancelling", C.eligibility(J, user(w, "u_faculty")).ok);
    check("approved/rejected claims can't be cancelled", !C.cancel(mine.id, S).ok && !C.cancel(c2.id, user(w, "u_maint")).ok);

    // finder can't withdraw a found item that has a live claim
    const K = mkItem(w, { title: "Green notebook", reporterId: "u_guard" });
    const c5 = C.submit(K.id, proof(w, { lostDate: day(w, 3) }), S).claim;
    check("finder can't withdraw an item under claim", /claim under review/.test(w.CF.reports.withdraw(K.id, user(w, "u_guard")).message) && item(w, K.ref).status === "open");
    C.cancel(c5.id, S);
    check("…but can once the claim is gone", w.CF.reports.withdraw(K.id, user(w, "u_guard")).ok);
  }

  console.log("\n[5b] progress tracker states");
  {
    const w = await makeDom("claim-form.html", { before: asStudent });
    const T = (status) => w.CF.claims.tracker({ status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).map((s) => s.state).join();
    check("pending", T("pending") === "done,current,todo,todo", T("pending"));
    check("needs_info", T("needs_info") === "done,warn,todo,todo", T("needs_info"));
    check("approved", T("approved") === "done,done,done,current", T("approved"));
    check("returned", T("returned") === "done,done,done,done", T("returned"));
    check("rejected", T("rejected") === "done,done,bad,skipped", T("rejected"));
    check("cancelled", T("cancelled") === "done,skipped,skipped,skipped", T("cancelled"));
    const html = w.CF.claims.trackerHtml({ status: "needs_info", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, false);
    check("tracker markup: 4 steps, one aria-current", (html.match(/<li /g) || []).length === 4 && (html.match(/aria-current="step"/g) || []).length === 1 && /More info needed/.test(html));
    check("compact tracker has no hints", !/<small>/.test(w.CF.claims.trackerHtml({ status: "pending", createdAt: new Date().toISOString() }, true)));
  }

  console.log("\n[6] match notifications");
  {
    const w = await makeDom("report-lost.html", { before: asFaculty });
    const d = w.document, CF = w.CF;
    const set = (id, v) => { d.getElementById(id).value = v; };
    set("title", "Keys on a red keychain"); set("category", "Keys"); set("location", "Main Gate"); set("color", "Silver");
    set("description", "Three keys on a red keychain, dropped near the main gate.");
    d.getElementById("report-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
    const n = CF.notify.forUser("u_maint");
    check("owner of the matching FOUND report is alerted", n.length === 1 && n[0].type === "match" && /FND-0002/.test(n[0].title) && /Keys on a red keychain/.test(n[0].body) && /\d+% match/.test(n[0].body), JSON.stringify(n));
    check("alert links to the matches panel", /^item-details\.html\?id=item_[\w]+#matches$/.test(n[0].link), n[0].link);
    check("the reporter is not alerted about their own report", CF.notify.forUser("u_faculty").length === 0);
    check("nobody else is alerted", CF.notify.forUser("u_guard").length === 0 && CF.notify.forUser("u_student").length === 0);
  }
  {
    // viewing pages (syncAll) must not create alerts
    const w = await makeDom("search.html", { before: asStudent });
    check("loading the search page creates no notifications", w.CF.db.notifications().length === 0 && w.CF.db.matches().length === 1);
    const w2 = await makeDom("report-found.html", { before: asMaint });
    const d = w2.document;
    const set = (id, v) => { d.getElementById(id).value = v; };
    set("title", "Umbrella blue"); set("category", "Bottles & Umbrellas"); set("location", "Library"); set("color", "Blue");
    set("description", "Blue foldable umbrella with a wooden handle."); set("storedAt", "Library counter");
    d.getElementById("report-form").dispatchEvent(new w2.Event("submit", { cancelable: true }));
    const n = w2.CF.notify.forUser("u_faculty");
    check("a new FOUND report alerts the owner of the matching LOST report", n.length === 1 && /LST-0002/.test(n[0].title) && /may match your lost report/.test(n[0].body), JSON.stringify(n));
  }

  console.log("\n[7] claim form page");
  {
    let w = await makeDom("claim-form.html", { query: "?item=FND-0001", before: asGuard });
    check("own item -> friendly block", /your own report/i.test(w.document.querySelector(".coming h1").textContent) && !w.document.getElementById("claim-form"));
    w = await makeDom("claim-form.html", { query: "?item=nope", before: asStudent });
    check("unknown item -> not found", /couldn't find/.test(w.document.querySelector(".coming h1").textContent));
    w = await makeDom("claim-form.html", { query: "?item=LST-0001", before: asFaculty });
    check("lost report -> can't be claimed", /can't be claimed/.test(w.document.querySelector(".coming h1").textContent) && !w.document.getElementById("claim-form"));
    w = await makeDom("claim-form.html", { before: asStudent });
    check("no ?item= -> not found", /couldn't find/.test(w.document.querySelector(".coming h1").textContent));
    w = await makeDom("claim-form.html", { query: "?item=FND-0001" });
    check("signed-out bounced to login", w.__nav.length >= 1 && !w.document.getElementById("claim-form"));
    w = await makeDom("claim-form.html", { query: "?item=FND-0001", before: asAdmin });
    check("admin bounced away", w.__nav.length >= 1);
    w = await makeDom("claim-form.html", { query: "?item=FND-0001", before: (w) => { asStudent(w); claimIt(w, "u_student", "FND-0001"); } });
    check("existing claim -> link to it", /already have a claim/.test(w.document.querySelector(".coming h1").textContent) && /CLM-0001/.test(w.document.querySelector(".coming a.btn").textContent) && /claim-details\.html\?id=clm_/.test(w.document.querySelector(".coming a.btn").getAttribute("href")));
  }
  {
    const w = await makeDom("claim-form.html", { query: "?item=FND-0001", before: (w) => { asStudent(w); const it = item(w, "FND-0001"); const items = w.CF.db.items(); items.find((i) => i.id === it.id).identifyingMarks = "SECRETMARK-DOG-PHOTO"; w.CF.db.saveItems(items); } });
    const d = w.document, form = d.getElementById("claim-form");
    check("form rendered with heading", !!form && /Prove it's yours/.test(d.querySelector("h1").textContent));
    check("menu highlights My Claims", d.querySelector("a.is-active").textContent === "My Claims");
    check("item summary shows public facts", /Black bi-fold wallet/.test(d.querySelector(".claim-item-card").textContent) && /Canteen/.test(d.querySelector(".claim-item-card").textContent) && /Guard house/.test(d.querySelector(".claim-item-card").textContent));
    check("PRIVACY: finder's private marks never shown to the claimant", !/SECRETMARK/.test(d.body.innerHTML));
    check("places populated", d.getElementById("lostLocation").options.length === 12);
    check("date picker capped at the day it was found", d.getElementById("lostDate").max === day(w, 1), d.getElementById("lostDate").max);
    const sel = d.getElementById("lostReportId");
    check("lost-report dropdown lists the student's open lost reports", [...sel.options].map((o) => o.value && o.textContent).filter(Boolean).join("|") === "LST-0001 · Black wallet with school ID|LST-0003 · Scientific calculator", [...sel.options].map((o) => o.textContent).join("|"));
    check("best-matching report is preselected", sel.selectedOptions[0].textContent.startsWith("LST-0001"));
    check("date + place prefilled from it", form.elements.lostDate.value === day(w, 2) && form.elements.lostLocation.value === "Canteen");
    check("hint explains the prefill", /picked the report that best matches/.test(d.getElementById("link-hint").textContent));

    sel.value = "";
    form.elements.lostDate.value = ""; form.elements.lostLocation.value = "";
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    check("empty submit flags 5 fields", d.querySelectorAll(".field.has-error").length === 5, String(d.querySelectorAll(".field.has-error").length));
    check("alert shown and no navigation", !d.getElementById("form-alert").hidden && w.__nav.length === 0);

    form.elements.lostDate.value = w.CF.util.todayStr();
    form.elements.lostDate.dispatchEvent(new w.Event("blur"));
    check("blur flags a date after the found date", /after it was found/.test(text(form.elements.lostDate.closest(".field").querySelector(".field-error"))));

    // picking a report refills date/place
    sel.value = item(w, "LST-0003").id; sel.dispatchEvent(new w.Event("change"));
    check("choosing a report refills date + place", form.elements.lostLocation.value === "Computer Laboratory" && form.elements.lostDate.value === day(w, 5));

    // evidence photos
    w.CF.reports.compressImage = () => Promise.resolve(PNG);
    const ev = d.getElementById("evidence");
    const pick = async (n) => { Object.defineProperty(ev, "files", { value: Array.from({ length: n }, (_, i) => ({ name: "p" + i + ".png", type: "image/png", size: 100 })), configurable: true }); ev.dispatchEvent(new w.Event("change")); await tick(); };
    await pick(1);
    check("1 photo added", d.querySelectorAll("#evidence-list li").length === 1 && !d.getElementById("evidence-label").hidden);
    await pick(2);
    check("capped at 2 with a message", d.querySelectorAll("#evidence-list li").length === 2 && /Only 2 photos/.test(d.getElementById("evidence-error").textContent) && d.getElementById("evidence-label").hidden);
    d.querySelector('#evidence-list [data-remove="0"]').click();
    check("remove frees a slot", d.querySelectorAll("#evidence-list li").length === 1 && !d.getElementById("evidence-label").hidden && d.getElementById("evidence-error").textContent === "");
    w.CF.reports.compressImage = () => Promise.reject(new Error("Use a JPG, PNG or WebP image."));
    await pick(1);
    check("bad image shows its error, submit re-enabled", /JPG, PNG or WebP/.test(d.getElementById("evidence-error").textContent) && !d.getElementById("submit-btn").disabled && d.querySelectorAll("#evidence-list li").length === 1);

    // valid submit
    sel.value = item(w, "LST-0001").id; sel.dispatchEvent(new w.Event("change"));
    form.elements.description.value = "Black leather bi-fold wallet, worn at the edges.";
    form.elements.description.dispatchEvent(new w.Event("input"));
    check("char counter", /^\d+ \/ 500$/.test(d.getElementById("desc-count").textContent) && d.getElementById("desc-count").textContent !== "0 / 500");
    form.elements.proofDetails.value = "A photo of my dog in the card slot";
    form.elements.declaration.checked = true;
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    const saved = w.CF.claims.find("CLM-0001");
    check("claim saved with everything", !!saved && saved.lostReportId === item(w, "LST-0001").id && saved.evidence.length === 1 && saved.status === "pending" && saved.proofDetails === "A photo of my dog in the card slot");
    check("redirects to the claim page", w.__nav.length >= 1);
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));
  }

  console.log("\n[8] My Claims page");
  {
    let w = await makeDom("my-claims.html", { before: asStudent });
    check("empty state with a link to found items", /No claims yet/.test(w.document.getElementById("claims-list").textContent) && !!w.document.querySelector('#claims-list a[href="search.html?type=found"]'));
    check("counts are zero", [...w.document.querySelectorAll(".tab .count")].map((c) => c.textContent).join() === "0,0,0");

    w = await makeDom("my-claims.html", {
      before: (w) => {
        asStudent(w);
        const A = user(w, "u_admin");
        const a = claimIt(w, "u_student", "FND-0001").claim;                               // CLM-0001 -> needs_info
        w.CF.claims.review(a.id, "request_info", A, "What is on the lock screen?");
        const b = mkItem(w, { title: "Gray scarf", category: "Clothing" });                // CLM-0002 -> rejected
        const cb = w.CF.claims.submit(b.id, proof(w, { lostDate: day(w, 3) }), user(w, "u_student")).claim;
        w.CF.claims.review(cb.id, "reject", A, "Colour does not match.");
        const c = mkItem(w, { title: "Silver ring" });                                     // CLM-0003 -> pending
        w.CF.claims.submit(c.id, proof(w, { lostDate: day(w, 3) }), user(w, "u_student"));
        const e = mkItem(w, { title: "Phone charger" });                                   // CLM-0004 -> approved
        const ce = w.CF.claims.submit(e.id, proof(w, { lostDate: day(w, 3) }), user(w, "u_student")).claim;
        w.CF.claims.review(ce.id, "approve", A, "Collect at the office.");
        claimIt(w, "u_faculty", "FND-0002");                                               // someone else's claim
      },
    });
    const d = w.document;
    const cards = () => d.querySelectorAll("#claims-list .claim-card");
    check("only my 4 claims are listed", cards().length === 4);
    check("tab counts (all/active/closed)", [...d.querySelectorAll(".tab .count")].map((c) => c.textContent).join() === "4,3,1", [...d.querySelectorAll(".tab .count")].map((c) => c.textContent).join());
    check("claims needing a reply come first and are highlighted", cards()[0].classList.contains("needs-action") && /CLM-0001/.test(cards()[0].textContent));
    check("needs-info card shows the question + 'Reply now'", /Action needed/.test(cards()[0].textContent) && /lock screen/.test(cards()[0].textContent) && /Reply now/.test(cards()[0].textContent));
    check("status badges", ["More info needed", "Pending review", "Approved", "Rejected"].every((s) => d.getElementById("claims-list").textContent.includes(s)));
    check("every card has a compact 4-step tracker", [...cards()].every((c) => c.querySelectorAll(".tracker.compact li").length === 4));
    check("approved/rejected notes shown", /Collect at the office/.test(d.getElementById("claims-list").textContent) && /Colour does not match/.test(d.getElementById("claims-list").textContent));
    check("card links to claim details", /claim-details\.html\?id=clm_/.test(cards()[0].querySelector("a.btn").getAttribute("href")));
    d.querySelector('.tab[data-filter="closed"]').click();
    check("Closed tab -> the rejected one", cards().length === 1 && /Rejected/.test(cards()[0].textContent));
    d.querySelector('.tab[data-filter="active"]').click();
    check("Active tab -> 3", cards().length === 3 && d.querySelector('.tab[data-filter="active"]').getAttribute("aria-pressed") === "true");
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));
  }

  console.log("\n[9] claim details page");
  {
    let id;
    const w = await makeDom("claim-details.html", {
      before: (w) => {
        asStudent(w);
        const c = claimIt(w, "u_student", "FND-0001", { lostReportId: "LST-0001", evidence: [PNG], description: '<img src=x onerror="window.__pwned=1"> black wallet, worn edges' }).claim;
        id = c.id;
        const stored = w.CF.db.claims(); stored.find((x) => x.id === c.id).evidence.push("javascript:window.__pwned=2"); w.CF.db.saveClaims(stored);
        w.history.replaceState(null, "", "/claim-details.html?id=" + id + "&created=1");
      },
    });
    const d = w.document;
    check("heading shows reference + status badge", d.querySelector(".ref-pill").textContent === "CLM-0001" && /Pending review/.test(d.querySelector(".badge-lg").textContent));
    check("created banner", /Claim submitted/.test(d.querySelector(".created-banner").textContent));
    check("tracker: 4 steps, 'Under review' current", d.querySelectorAll(".tracker li").length === 4 && /Under review/.test(d.querySelector(".step-current").textContent));
    check("pending panel", /Waiting for review/.test(d.querySelector(".callout").textContent));
    check("proof shown to the claimant", /Photo of my dog/.test(d.body.textContent) && /Canteen/.test(d.querySelector(".proof-facts").textContent) && /LST-0001/.test(d.querySelector(".proof-facts").textContent));
    check("evidence photo shown, unsafe photo ignored", d.querySelectorAll(".evidence-list img").length === 1);
    check("XSS in description is inert", !w.__pwned && !d.querySelector("img[onerror]") && /<img src=x/.test(d.querySelector(".proof-facts").textContent));
    check("timeline has the submission", d.querySelectorAll(".timeline li").length === 1 && /Claim submitted/.test(d.querySelector(".timeline").textContent));
    check("item card + cancel button", /Black bi-fold wallet/.test(d.querySelector(".detail-side").textContent) && !!d.getElementById("cancel-btn"));
    check("no reply form yet", !d.getElementById("reply-form"));
    d.getElementById("cancel-btn").click();
    check("cancel -> cancelled, button gone, timeline updated", /Cancelled/.test(d.querySelector(".badge-lg").textContent) && !d.getElementById("cancel-btn") && /You cancelled/.test(d.querySelector(".timeline").textContent) && /You cancelled this claim/.test(d.querySelector(".callout").textContent));
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));
  }
  {
    // someone else's claim is invisible
    const w = await makeDom("claim-details.html", { before: (w) => { const c = claimIt(w, "u_student", "FND-0001").claim; asFaculty(w); w.history.replaceState(null, "", "/claim-details.html?id=" + c.id); } });
    check("another user gets 'not found' and no proof", /couldn't find that claim/.test(w.document.body.textContent) && !/Photo of my dog/.test(w.document.body.textContent));
    const w2 = await makeDom("claim-details.html", { query: "?id=nope", before: asStudent });
    check("unknown claim -> not found", /couldn't find that claim/.test(w2.document.body.textContent));
    const w3 = await makeDom("claim-details.html", { query: "?id=x" });
    check("signed-out bounced to login", w3.__nav.length >= 1);
  }
  {
    // needs_info -> reply via the page
    let id;
    const w = await makeDom("claim-details.html", {
      before: (w) => {
        asStudent(w);
        const c = claimIt(w, "u_student", "FND-0001").claim; id = c.id;
        w.CF.claims.review(c.id, "request_info", user(w, "u_admin"), "<b>What colour</b> is the lining?");
        w.history.replaceState(null, "", "/claim-details.html?id=" + id);
      },
    });
    const d = w.document;
    check("needs-info: warning tracker step + question + reply form", !!d.querySelector(".step-warn") && /What colour/.test(d.querySelector(".quote").textContent) && !d.querySelector(".quote b") && !!d.getElementById("reply-form"));
    check("needs-info badge", /More info needed/.test(d.querySelector(".badge-lg").textContent));
    d.getElementById("reply-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
    check("empty reply -> inline error, still needs_info", /at least 5/.test(text(d.querySelector("#reply-text").closest(".field").querySelector(".field-error"))) && w.CF.claims.find(id).status === "needs_info");
    w.CF.reports.compressImage = () => Promise.resolve(PNG);
    const input = d.getElementById("reply-photo");
    Object.defineProperty(input, "files", { value: [{ name: "a.png", type: "image/png", size: 10 }], configurable: true });
    input.dispatchEvent(new w.Event("change")); await tick();
    check("reply photo preview", !d.getElementById("reply-preview").hidden && d.getElementById("reply-photo-label").hidden);
    d.getElementById("reply-text").value = "The lining is dark green.";
    d.getElementById("reply-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
    check("reply sent -> back to pending, form gone", w.CF.claims.find(id).status === "pending" && !d.getElementById("reply-form") && /Pending review/.test(d.querySelector(".badge-lg").textContent));
    check("reply appears in the timeline with its photo", /You replied/.test(d.querySelector(".timeline").textContent) && /dark green/.test(d.querySelector(".timeline").textContent) && d.querySelectorAll(".timeline img").length === 1);
    check("toast shown", !!d.querySelector(".toast"));
  }
  {
    // approved / rejected / returned panels
    const mkClaimPage = async (finish) => {
      let id;
      const w = await makeDom("claim-details.html", { before: (w) => { asStudent(w); const c = claimIt(w, "u_student", "FND-0001").claim; id = c.id; finish(w, c); w.history.replaceState(null, "", "/claim-details.html?id=" + id); } });
      return w.document;
    };
    let d = await mkClaimPage((w, c) => w.CF.claims.review(c.id, "approve", user(w, "u_admin"), "Collect it at the admin office."));
    check("approved panel: pickup note, where to collect, step 'Ready for pickup'", /Your claim was approved/.test(d.querySelector(".callout-good").textContent) && /admin office/.test(d.querySelector(".callout-good").textContent) && /Guard house/.test(d.querySelector(".callout-good").textContent) && /Ready for pickup/.test(d.querySelector(".step-current").textContent) && !d.getElementById("cancel-btn"));
    d = await mkClaimPage((w, c) => { w.CF.claims.review(c.id, "approve", user(w, "u_admin"), ""); w.CF.claims.markReturned(c.id, user(w, "u_admin")); });
    check("returned panel + all steps done", /Item returned/.test(d.querySelector(".callout-good").textContent) && d.querySelectorAll(".step-done").length === 4);
    d = await mkClaimPage((w, c) => w.CF.claims.review(c.id, "reject", user(w, "u_admin"), "The serial number does not match."));
    check("rejected panel: reason + 'Submit a new claim'", /serial number/.test(d.querySelector(".callout-bad").textContent) && /Submit a new claim/.test(d.querySelector(".callout-bad").textContent) && !!d.querySelector('.callout-bad a[href^="claim-form.html?item="]') && !!d.querySelector(".step-bad"));
  }

  console.log("\n[10] header bell + notifications page");
  {
    const w = await makeDom("my-reports.html", { before: (w) => { asStudent(w); w.CF.notify.add("u_student", { title: "One", body: "a" }); w.CF.notify.add("u_student", { title: "Two", body: "b" }); } });
    const d = w.document;
    const bell = d.querySelector(".bell-link");
    check("bell shows the unread count", !!bell && d.querySelector(".bell-count").textContent === "2" && !d.querySelector(".bell-count").hidden);
    check("bell label for screen readers", bell.getAttribute("aria-label") === "Notifications, 2 unread" && bell.getAttribute("href") === "notifications.html");
    check("bell is not part of the main nav links", [...d.querySelectorAll("#primary-nav a.nav-link")].length === 6);
    w.CF.notify.markAllRead("u_student"); w.CF.layout.updateBell(user(w, "u_student"));
    check("updateBell hides the badge at zero", d.querySelector(".bell-count").hidden && d.querySelector(".bell-link").getAttribute("aria-label") === "Notifications");
    const a = await makeDom("search.html", { before: asAdmin });
    check("admins get no bell", !a.document.querySelector(".bell-link"));
    const g = await makeDom("search.html");
    check("signed-out visitors get no bell", !g.document.querySelector(".bell-link"));
  }
  {
    const w = await makeDom("notifications.html", {
      before: (w) => {
        asStudent(w);
        const N = w.CF.notify;
        N.add("u_student", { type: "claim_approved", title: "Claim CLM-0001 approved", body: "Collect it at the office.", link: "claim-details.html?id=clm_abc" });
        N.add("u_student", { type: "match", title: "New possible match for LST-0001", body: "A found item may match (81% match).", link: "item-details.html?id=item_x#matches" });
        N.add("u_student", { type: "info", title: '<img src=x onerror="window.__pwned=1">', body: "<script>window.__pwned=2</script>", link: "javascript:window.__pwned=3" });
        const old = N.add("u_student", { type: "info", title: "Old one", body: "read already" });
        N.markRead(old.id, "u_student");
        N.add("u_guard", { title: "Not mine", body: "x" });
      },
    });
    const d = w.document;
    const items = () => d.querySelectorAll("#notif-list .notif");
    check("lists only my notifications, newest first", items().length === 4 && /Old one/.test(items()[0].textContent) && !/Not mine/.test(d.body.textContent));
    check("unread are highlighted, read are not", d.querySelectorAll(".notif.unread").length === 3 && !items()[0].classList.contains("unread"));
    check("links are anchors", items()[2].tagName === "A" && items()[2].getAttribute("href") === "item-details.html?id=item_x#matches");
    check("unsafe link renders as plain text, not an anchor", items()[1].tagName === "DIV" && !d.querySelector('a[href^="javascript"]'));
    check("XSS in title/body is inert", !w.__pwned && !d.querySelector("#notif-list img") && !d.querySelector("#notif-list script"));
    check("page: Notifications highlighted in the header", d.querySelector(".bell-link").classList.contains("is-active") && d.querySelector(".bell-count").textContent === "3");
    check("mark-all button visible", !d.getElementById("mark-all").hidden);
    items()[3].click();
    check("opening a notification marks it read + updates the badge", w.CF.notify.unreadCount("u_student") === 2 && d.querySelector(".bell-count").textContent === "2");
    d.getElementById("mark-all").click();
    check("mark all as read", w.CF.notify.unreadCount("u_student") === 0 && d.querySelector(".bell-count").hidden && d.querySelectorAll(".notif.unread").length === 0 && d.getElementById("mark-all").hidden);
    check("toast confirms", /marked as read/.test(d.querySelector(".toast").textContent));
    const e = await makeDom("notifications.html", { before: asGuard });
    check("empty state", /all caught up/.test(e.document.getElementById("notif-list").textContent) && e.document.getElementById("mark-all").hidden);
    const x = await makeDom("notifications.html");
    check("signed-out bounced", x.__nav.length >= 1);
    const adm = await makeDom("notifications.html", { before: asAdmin });
    check("admin bounced to dashboard", adm.__nav.length >= 1);
  }

  console.log("\n[11] item details: claim states");
  {
    const open = async (ref, before) => (await makeDom("item-details.html", { before: (w) => { before(w); w.history.replaceState(null, "", "/item-details.html?ref=" + ref); } })).document;
    let d = await open("FND-0001", asStudent);
    check("claimable: 'start a claim' link", !!d.querySelector('.side-actions a[href^="claim-form.html?item="]'));
    d = await open("FND-0001", (w) => { asStudent(w); claimIt(w, "u_student", "FND-0001"); });
    check("after claiming: 'View my claim · Pending review'", /View my claim · Pending review/.test(d.querySelector(".side-actions").textContent) && !d.querySelector('.side-actions a[href^="claim-form.html"]'));
    d = await open("FND-0001", (w) => { asGuard(w); claimIt(w, "u_student", "FND-0001"); });
    check("finder is told someone claimed it, with no names", /Someone has\s+claimed this item/.test(text(d.querySelector(".side-actions"))) && !/Juan|student@/.test(d.body.textContent));
    check("finder still sees the withdraw button", !!d.getElementById("withdraw-btn"));
    d = await open("FND-0001", (w) => { asFaculty(w); claimIt(w, "u_student", "FND-0001"); });
    check("a competing user can still start their own claim", !!d.querySelector('.side-actions a[href^="claim-form.html"]'));
    d = await open("FND-0001", (w) => { asStudent(w); const c = claimIt(w, "u_student", "FND-0001").claim; w.CF.claims.review(c.id, "approve", user(w, "u_admin"), "ok then"); });
    check("claimed item: claimant sees 'View my claim · Approved'", /View my claim · Approved/.test(d.querySelector(".side-actions").textContent) && /Claimed/.test(d.querySelector(".detail-main").textContent));
    d = await open("FND-0001", (w) => { asFaculty(w); const c = claimIt(w, "u_student", "FND-0001").claim; w.CF.claims.review(c.id, "approve", user(w, "u_admin"), "ok then"); });
    check("claimed item: other users get no claim button", !d.querySelector(".side-actions a"));
    d = await open("LST-0001", asFaculty);
    check("lost items still offer 'I found this item'", !!d.querySelector('.side-actions a[href="report-found.html"]'));
    d = await open("FND-0001", (w) => { asFaculty(w); const T = item(w, "FND-0001"); const A = user(w, "u_admin"); for (let i = 0; i < 3; i++) { const c = w.CF.claims.submit(T.id, proof(w), user(w, "u_faculty")).claim; w.CF.claims.review(c.id, "reject", A, "Not enough proof"); } });
    check("after 3 rejections: limit notice instead of a button", /limit of 3/.test(d.querySelector(".side-actions").textContent) && !d.querySelector('.side-actions a[href^="claim-form.html"]'));
  }

  console.log("\n[13] files + script order");
  {
    const all = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")).concat(fs.readdirSync(ROOT + "/admin").map((f) => "admin/" + f));
    const broken = [];
    all.forEach((p) => {
      const html = fs.readFileSync(path.join(ROOT, p), "utf8");
      [...html.matchAll(/(?:src|href)="((?:\.\.\/)?(?:js|css)\/[^"]+)"/g)].forEach((m) => { if (!fs.existsSync(path.join(path.dirname(path.join(ROOT, p)), m[1]))) broken.push(p + " -> " + m[1]); });
    });
    check("no broken css/js references across " + all.length + " pages", broken.length === 0, broken.join("; "));
    const order = (p) => [...fs.readFileSync(path.join(ROOT, p), "utf8").matchAll(/js\/([\w-]+)\.js/g)].map((m) => m[1]);
    const ok = ["claim-form.html", "claim-details.html", "my-claims.html", "item-details.html", "admin/dashboard.html"].every((p) => { const o = order(p); return o.indexOf("claims") > o.indexOf("reports") && o.indexOf("claims") < o.indexOf("layout"); });
    check("claims.js loads after reports.js and before layout.js everywhere it's used", ok);
    const menuHrefs = [...fs.readFileSync(path.join(ROOT, "js/layout.js"), "utf8").matchAll(/href: "([^"]+\.html)"/g)].map((m) => m[1]);
    check("every menu href exists", menuHrefs.every((h) => fs.existsSync(path.join(ROOT, h))), menuHrefs.filter((h) => !fs.existsSync(path.join(ROOT, h))).join());
    check("new pages exist", ["claim-form.html", "claim-details.html", "my-claims.html", "notifications.html"].every((f) => fs.existsSync(path.join(ROOT, f))));
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
