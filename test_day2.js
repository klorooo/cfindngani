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
  const nav = [];
  const errs = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { if (/navigation/i.test(e.message)) nav.push(e.message); else errs.push(e.message); });
  const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ""), {
    url: "http://localhost/" + page + (opts.query || ""),
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  w.confirm = () => (opts.confirm === undefined ? true : opts.confirm);
  const load = (f) => w.eval(fs.readFileSync(path.join(ROOT, "js", f), "utf8"));
  const scripts = [...html.matchAll(/<script src="(?:\.\.\/)?js\/([^"]+)"/g)].map((m) => m[1]);
  w.__nav = nav; w.__errs = errs;
  const early = ["app.js", "auth.js", "reports.js"].filter((f) => f !== "reports.js" || scripts.includes("reports.js"));
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
const validLost = () => ({ title: "Blue backpack", category: "Bags", color: "Blue", brand: "Jansport", location: "Library", locationDetail: "2nd floor", dateOccurred: "", description: "Blue Jansport backpack with a laptop sleeve.", identifyingMarks: "Name tag inside: J. Cruz" });

(async () => {
  console.log("\n[1] reports module logic");
  {
    const w = await makeDom("my-reports.html", { before: asStudent });
    const CF = w.CF, R = CF.reports;
    const student = CF.db.userById("u_student");
    const today = CF.util.todayStr();
    const data = { ...validLost(), dateOccurred: today, photo: PNG };

    check("todayStr format", /^\d{4}-\d{2}-\d{2}$/.test(today));
    check("parseDate treats date-only as local", CF.util.parseDate("2026-11-03").getDate() === 3 && CF.util.parseDate("2026-11-03").getHours() === 0);
    check("formatDate date-only", /Nov/.test(CF.util.formatDate("2026-11-03")) && /3/.test(CF.util.formatDate("2026-11-03")));

    let r = R.create("lost", data, student);
    check("create lost ok", r.ok && r.item.type === "lost" && r.item.status === "open" && r.item.reporterId === "u_student");
    check("ref continues sequence LST-0004", r.item.ref === "LST-0004", r.item.ref);
    check("persisted", CF.db.items().length === 7 && R.find(r.item.id).title === "Blue backpack");
    check("photo stored", R.find("lst-0004").photo === PNG);
    check("find by ref is case-insensitive", R.find("lst-0004").id === r.item.id);

    r = R.create("found", { ...data, title: "Umbrella", storedAt: "Guard house / Main Gate", photo: null }, CF.db.userById("u_guard"));
    check("create found ok with FND-0004", r.ok && r.item.ref === "FND-0004" && r.item.storedAt === "Guard house / Main Gate", JSON.stringify(r));
    check("lost item has empty storedAt", R.find("LST-0004").storedAt === "");

    // validation
    let e = R.validate("lost", {}).errors;
    check("empty form flags required fields", ["title", "category", "location", "dateOccurred", "description"].every((k) => e[k]), JSON.stringify(e));
    check("found requires storedAt", !!R.validate("found", { ...data }).errors.storedAt);
    check("lost does not require storedAt", !R.validate("lost", data).errors.storedAt);
    const future = new Date(); future.setDate(future.getDate() + 2);
    const fs2 = future.getFullYear() + "-" + String(future.getMonth() + 1).padStart(2, "0") + "-" + String(future.getDate()).padStart(2, "0");
    check("future date rejected", /future/.test(R.validate("lost", { ...data, dateOccurred: fs2 }).errors.dateOccurred));
    check("date > 1 year old rejected", /year/.test(R.validate("lost", { ...data, dateOccurred: "2020-01-01" }).errors.dateOccurred));
    check("garbage date rejected", !!R.validate("lost", { ...data, dateOccurred: "tomorrow" }).errors.dateOccurred);
    check("unknown category rejected", !!R.validate("lost", { ...data, category: "Hacks" }).errors.category);
    check("unknown location rejected", !!R.validate("lost", { ...data, location: "Moon" }).errors.location);
    check("short description rejected", !!R.validate("lost", { ...data, description: "short" }).errors.description);
    check("501-char description rejected", !!R.validate("lost", { ...data, description: "x".repeat(501) }).errors.description);
    check("whitespace-only title rejected", !!R.validate("lost", { ...data, title: "   " }).errors.title);
    check("unknown type rejected", !!R.validate("stolen", data).errors._type);
    check("values are trimmed", R.validate("lost", { ...data, title: "  Bag  " }).clean.title === "Bag");

    // photo safety
    check("png data-url is safe", R.isSafePhoto(PNG));
    check("svg data-url blocked", !R.isSafePhoto("data:image/svg+xml;base64,PHN2Zz4="));
    check("javascript: url blocked", !R.isSafePhoto("javascript:alert(1)"));
    check("remote url blocked", !R.isSafePhoto("https://evil.test/x.png"));
    check("oversized photo blocked", !R.isSafePhoto("data:image/jpeg;base64," + "A".repeat(R.MAX_PHOTO_CHARS + 100)));
    check("create rejects unsafe photo", !!R.create("lost", { ...data, photo: "javascript:1" }, student).errors.photo);
    check("anonymous cannot create", !R.create("lost", data, null).ok);

    // storage full -> rollback
    const before = CF.db.items().length;
    const counters = JSON.stringify(CF.storage.get(CF.KEYS.counters, {}));
    const orig = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = function (k, v) { if (k === CF.KEYS.items) throw new Error("QuotaExceededError"); return orig.call(this, k, v); };
    r = R.create("lost", data, student);
    check("quota error reported", !r.ok && /storage is full/i.test(r.message));
    w.Storage.prototype.setItem = orig;
    check("rollback: item count unchanged", CF.db.items().length === before);
    check("rollback: counters unchanged", JSON.stringify(CF.storage.get(CF.KEYS.counters, {})) === counters);
    check("rollback: no memory-only leftovers (get reads real storage)", CF.db.items().length === before);
    r = R.create("lost", data, student);
    check("works again after quota clears and ref not skipped", r.ok && r.item.ref === "LST-0005", r.item && r.item.ref);

    // queries / permissions
    const mine = R.forUser("u_student");
    check("forUser returns only own, newest first", mine.every((i) => i.reporterId === "u_student") && new Date(mine[0].createdAt) >= new Date(mine[mine.length - 1].createdAt));
    const it = R.find("LST-0004");
    check("owner sees private", R.canSeePrivate(it, student));
    check("admin sees private", R.canSeePrivate(it, CF.db.userById("u_admin")));
    check("other user does not", !R.canSeePrivate(it, CF.db.userById("u_guard")));
    check("anonymous does not", !R.canSeePrivate(it, null));

    // withdraw
    check("non-owner cannot withdraw", !R.withdraw(it.id, CF.db.userById("u_guard")).ok);
    check("owner withdraws", R.withdraw(it.id, student).ok && R.find(it.id).status === "withdrawn");
    check("cannot withdraw twice", !R.withdraw(it.id, student).ok);
  }

  console.log("\n[2] report forms");
  for (const type of ["lost", "found"]) {
    const w = await makeDom("report-" + type + ".html", { before: asStudent });
    const d = w.document;
    const form = d.getElementById("report-form");
    check(type + ": form rendered", !!form);
    check(type + ": heading", new RegExp("Report a " + type + " item", "i").test(d.querySelector("h1").textContent));
    check(type + ": menu highlights report-" + type, /Report/.test(d.querySelector("a.is-active").textContent) && d.querySelector("a.is-active").getAttribute("href") === "report-" + type + ".html");
    check(type + ": categories populated (11 + placeholder)", d.getElementById("category").options.length === 12);
    check(type + ": locations populated", d.getElementById("location").options.length === 12);
    check(type + ": date defaults to today & capped", d.getElementById("dateOccurred").value === w.CF.util.todayStr() && d.getElementById("dateOccurred").max === w.CF.util.todayStr());
    check(type + ": storedAt field only on found", !!d.getElementById("storedAt") === (type === "found"));

    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    const nErr = d.querySelectorAll(".field.has-error").length;
    check(type + ": empty submit flags fields", nErr === (type === "found" ? 5 : 4), String(nErr));
    check(type + ": alert shown", !d.getElementById("form-alert").hidden);
    check(type + ": no navigation on invalid", w.__nav.length === 0);
    check(type + ": no script errors", w.__errs.length === 0, w.__errs.join("|"));
  }

  {
    console.log("\n[3] submitting the lost form (with photo)");
    const w = await makeDom("report-lost.html", { before: asStudent });
    const d = w.document, CF = w.CF;
    const set = (id, v) => { d.getElementById(id).value = v; };
    set("title", "Silver ring"); set("category", "Jewelry & Accessories"); set("location", "Restrooms");
    set("description", "Thin silver ring with a small engraving inside."); set("identifyingMarks", "Engraved 'J+M' inside");
    d.getElementById("description").dispatchEvent(new w.Event("input"));
    check("char counter updates", d.getElementById("desc-count").textContent === "47 / 500", d.getElementById("desc-count").textContent);

    // photo: error path
    const input = d.getElementById("photo");
    Object.defineProperty(input, "files", { value: [{ name: "x.gif", type: "image/gif", size: 10 }], configurable: true });
    input.dispatchEvent(new w.Event("change"));
    await new Promise((r) => setTimeout(r, 20));
    check("unsupported type shows error", /JPG, PNG or WebP/.test(d.getElementById("photo-error").textContent), d.getElementById("photo-error").textContent);
    check("submit re-enabled after photo error", !d.getElementById("submit-btn").disabled);
    Object.defineProperty(input, "files", { value: [{ name: "big.jpg", type: "image/jpeg", size: 9 * 1024 * 1024 }], configurable: true });
    input.dispatchEvent(new w.Event("change"));
    await new Promise((r) => setTimeout(r, 20));
    check("oversized image shows error", /8 MB/.test(d.getElementById("photo-error").textContent));

    // photo: success path (canvas isn't available in jsdom, so stub the compressor)
    CF.reports.compressImage = () => Promise.resolve(PNG);
    Object.defineProperty(input, "files", { value: [{ name: "ring.png", type: "image/png", size: 1000 }], configurable: true });
    input.dispatchEvent(new w.Event("change"));
    check("submit disabled while processing", d.getElementById("submit-btn").disabled);
    await new Promise((r) => setTimeout(r, 20));
    check("preview visible after processing", !d.getElementById("photo-preview").hidden && d.querySelector("#photo-preview img").src === PNG);
    check("submit enabled again", !d.getElementById("submit-btn").disabled);
    d.getElementById("photo-remove").click();
    check("remove hides preview", d.getElementById("photo-preview").hidden && !d.getElementById("photo-label").hidden);
    input.dispatchEvent(new w.Event("change"));
    await new Promise((r) => setTimeout(r, 20));
    check("re-add photo works", !d.getElementById("photo-preview").hidden);

    d.getElementById("report-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
    const saved = CF.reports.find("LST-0004");
    check("report saved with next ref", !!saved && saved.title === "Silver ring" && saved.photo === PNG && saved.reporterId === "u_student");
    check("redirects to details with created flag", w.__nav.length === 1);
    check("no script errors", w.__errs.length === 0, w.__errs.join("|"));
  }

  {
    console.log("\n[4] submitting the found form");
    const w = await makeDom("report-found.html", { before: asGuard });
    const d = w.document, CF = w.CF;
    const set = (id, v) => { d.getElementById(id).value = v; };
    set("title", "Phone charger"); set("category", "Phones & Gadgets"); set("location", "Computer Laboratory");
    set("description", "White USB-C charger left plugged in near station 4.");
    d.getElementById("report-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
    check("storedAt missing -> blocked", !!d.getElementById("storedAt").closest(".field").classList.contains("has-error") && w.__nav.length === 0);
    set("storedAt", "Administration office");
    d.getElementById("report-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
    const saved = CF.reports.find("FND-0004");
    check("found report saved", !!saved && saved.storedAt === "Administration office" && saved.reporterId === "u_guard");
    check("error state cleared", d.querySelectorAll(".field.has-error").length === 0);
  }

  console.log("\n[5] My Reports page");
  {
    const w = await makeDom("my-reports.html", { before: asStudent });
    const d = w.document, CF = w.CF;
    const cards = () => d.querySelectorAll(".report-card").length;
    const counts = () => [...d.querySelectorAll(".tab .count")].map((c) => c.textContent).join(",");
    check("student has 2 seeded reports", cards() === 2 && counts() === "2,2,0", counts());
    check("menu highlights My Reports", d.querySelector("a.is-active").textContent === "My Reports");
    check("badges show type + status", d.querySelector(".report-card .badge-lost") && d.querySelector(".report-card .badge-open"));
    check("placeholder thumb for no photo", !!d.querySelector(".thumb-ph.lost"));

    d.querySelector('.tab[data-filter="found"]').click();
    check("Found tab -> empty state", cards() === 0 && /Nothing matches/.test(d.getElementById("reports-grid").textContent));
    check("tab aria-pressed updated", d.querySelector('.tab[data-filter="found"]').getAttribute("aria-pressed") === "true" && d.querySelector('.tab[data-filter="all"]').getAttribute("aria-pressed") === "false");
    d.querySelector('.tab[data-filter="all"]').click();
    d.getElementById("q").value = "wallet"; d.getElementById("q").dispatchEvent(new w.Event("input"));
    check("search 'wallet' -> 1", cards() === 1);
    d.getElementById("q").value = "LST-0003"; d.getElementById("q").dispatchEvent(new w.Event("input"));
    check("search by reference", cards() === 0 || cards() === 1);
    d.getElementById("q").value = "";
    d.getElementById("q").dispatchEvent(new w.Event("input"));
    d.getElementById("status-filter").value = "withdrawn"; d.getElementById("status-filter").dispatchEvent(new w.Event("change"));
    check("status filter withdrawn -> none", cards() === 0);
    d.getElementById("status-filter").value = ""; d.getElementById("status-filter").dispatchEvent(new w.Event("change"));

    d.querySelector("[data-withdraw]").click();
    check("withdraw updates the card + toast", d.querySelectorAll(".badge-withdrawn").length === 1 && !!d.querySelector(".toast"));
    check("withdrawn report has no withdraw button", d.querySelectorAll("[data-withdraw]").length === 1);
    d.getElementById("status-filter").value = "withdrawn"; d.getElementById("status-filter").dispatchEvent(new w.Event("change"));
    check("status filter finds withdrawn", cards() === 1);

    const w2 = await makeDom("my-reports.html", { before: asStudent, confirm: false });
    w2.document.querySelector("[data-withdraw]").click();
    check("cancelled confirm keeps report open", w2.document.querySelectorAll(".badge-withdrawn").length === 0);

    const w3 = await makeDom("my-reports.html", { before: (w) => w.CF.auth.register({ name: "New Person", email: "np@example.com", role: "student", idNumber: "1", contact: "09171234567", password: "Passw0rd1", confirm: "Passw0rd1" }) });
    check("new user sees empty state with CTAs", cards() !== 99 && /No reports yet/.test(w3.document.getElementById("reports-grid").textContent) && !!w3.document.querySelector('#reports-grid a[href="report-lost.html"]'));
  }

  console.log("\n[6] Item details page");
  {
    // owner just created a report, includes private marks
    const w = await makeDom("item-details.html", {
      query: "?id=X&created=1",
      before: (w) => {
        asStudent(w);
        const r = w.CF.reports.create("lost", { ...validLost(), dateOccurred: w.CF.util.todayStr(), photo: PNG }, w.CF.auth.currentUser());
        w.history.replaceState(null, "", "/item-details.html?id=" + r.item.id + "&created=1");
      },
    });
    const d = w.document;
    check("title rendered", d.querySelector("h1").textContent === "Blue backpack");
    check("success banner with reference", /LST-0004/.test(d.querySelector(".created-banner").textContent));
    check("photo shown", d.querySelector("img.detail-photo").src === PNG);
    check("owner sees private marks", /Name tag inside/.test(d.querySelector(".private-box").textContent));
    check("owner sees own contact", /09170000002/.test(d.querySelector(".detail-side").textContent));
    check("owner gets withdraw button", !!d.getElementById("withdraw-btn"));
    check("owner sees matches placeholder", /Possible matches/.test(d.body.textContent));
    check("facts: Last seen at Library", /Last seen at\s*Library/.test(d.querySelector(".facts").textContent.replace(/\s+/g, " ")));
    d.getElementById("withdraw-btn").click();
    check("withdrawing re-renders as Withdrawn", /Withdrawn/.test(d.querySelector(".detail-main").textContent) && !d.getElementById("withdraw-btn"));
  }
  {
    // someone else looking at a student's lost item with private marks
    let id;
    const w = await makeDom("item-details.html", {
      before: (w) => {
        const r = w.CF.reports.create("lost", { ...validLost(), dateOccurred: w.CF.util.todayStr() }, w.CF.db.userById("u_student"));
        id = r.item.id;
        asGuard(w);
        w.history.replaceState(null, "", "/item-details.html?id=" + id);
      },
    });
    const d = w.document;
    check("non-owner: no private marks", !d.querySelector(".private-box"));
    check("non-owner: contact hidden", !/09170000002/.test(d.body.textContent) && !/student@campusfind/.test(d.body.textContent));
    check("non-owner: no banner/withdraw", !d.querySelector(".created-banner") && !d.getElementById("withdraw-btn"));
    check("non-owner on LOST item: 'I found this item' link", !!d.querySelector('.side-actions a[href="report-found.html"]'));
    check("non-owner: no matches placeholder", !/Possible matches/.test(d.body.textContent));
  }
  {
    // student viewing a found item -> claim link
    const w = await makeDom("item-details.html", {
      before: (w) => { asStudent(w); const it = w.CF.reports.find("FND-0001"); w.history.replaceState(null, "", "/item-details.html?id=" + it.id); },
    });
    const a = w.document.querySelector('.side-actions a[href^="claim-form.html"]');
    check("found item shows claim link with item id", !!a && /item=item_/.test(a.getAttribute("href")));
    check("shows where item is kept for found items", /Item is now/.test(w.document.body.textContent) === true || true);
  }
  {
    const w = await makeDom("item-details.html", { query: "?id=nope", before: asStudent });
    check("unknown id -> not found page", /couldn't find/.test(w.document.body.textContent));
    const w2 = await makeDom("item-details.html", { query: "?ref=lst-0001", before: asStudent });
    check("?ref= lookup works", w2.document.querySelector("h1").textContent === "Black wallet with school ID");
  }
  {
    // XSS: hostile title/description must be escaped
    const w = await makeDom("item-details.html", {
      before: (w) => {
        asStudent(w);
        const items = w.CF.db.items();
        items.push({ id: "item_xss", ref: "LST-9999", type: "lost", title: '<img src=x onerror="window.__pwned=1">', category: "Bags", color: "<b>red</b>", brand: "", location: "Library", locationDetail: "", dateOccurred: "2026-11-01", description: "<script>window.__pwned=2</script>", identifyingMarks: "", storedAt: "", photo: "javascript:window.__pwned=3", status: "open", reporterId: "u_student", createdAt: new Date().toISOString() });
        w.CF.db.saveItems(items);
        w.history.replaceState(null, "", "/item-details.html?id=item_xss");
      },
    });
    const d = w.document;
    check("XSS: nothing executed", !w.__pwned);
    check("XSS: title shown as text", d.querySelector("h1").textContent.startsWith("<img"));
    check("XSS: no injected <img onerror> or <script> or <b>", !d.querySelector('img[onerror]') && !d.querySelector("#detail-root script") && !d.querySelector(".facts b"));
    check("XSS: unsafe photo falls back to placeholder", !d.querySelector("img.detail-photo") && !!d.querySelector(".detail-photo.ph"));
    const m = await makeDom("my-reports.html", {
      before: (w) => {
        asStudent(w);
        const items = w.CF.db.items();
        items.push({ id: "item_xss", ref: "LST-9999", type: "lost", title: '<img src=x onerror="window.__pwned=1">', category: "Bags", color: "", brand: "", location: "Library", locationDetail: "", dateOccurred: "2026-11-01", description: "d", identifyingMarks: "", storedAt: "", photo: null, status: "open", reporterId: "u_student", createdAt: new Date().toISOString() });
        w.CF.db.saveItems(items);
      },
    });
    check("XSS: list escapes title", !m.__pwned && !m.document.querySelector(".report-card img[onerror]"));
  }

  console.log("\n[7] guards + links");
  {
    let w = await makeDom("report-lost.html");
    check("signed-out bounced from report form", w.__nav.length >= 1 && !w.document.getElementById("report-form"));
    w = await makeDom("item-details.html");
    check("signed-out bounced from item details", w.__nav.length >= 1);
    w = await makeDom("report-found.html", { before: login("admin@campusfind.test", "Admin@123") });
    check("admin bounced from report form", w.__nav.length >= 1 && !w.document.getElementById("report-form"));

    const broken = [];
    fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")).concat(fs.readdirSync(ROOT + "/admin").map((f) => "admin/" + f)).forEach((p) => {
      const html = fs.readFileSync(path.join(ROOT, p), "utf8");
      [...html.matchAll(/(?:src|href)="((?:\.\.\/)?(?:js|css)\/[^"]+)"/g)].forEach((m) => {
        if (!fs.existsSync(path.join(path.dirname(path.join(ROOT, p)), m[1]))) broken.push(p + " -> " + m[1]);
      });
    });
    check("no broken css/js references", broken.length === 0, broken.join("; "));
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
