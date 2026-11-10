const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = (process.env.CF_ROOT || require("path").resolve(__dirname, ".."));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " -> " + extra : "")); }
}

async function makeDom(page, opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");
  const nav = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { if (/navigation/i.test(e.message)) nav.push(e.message); else console.log("   jsdomError:", e.message); });
  vc.on("error", (e) => console.log("   console.error:", e));
  const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ""), {
    url: "http://localhost/" + page + (opts.query || ""),
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  const load = (f) => w.eval(fs.readFileSync(path.join(ROOT, "js", f), "utf8"));
  const scripts = [...html.matchAll(/<script src="(?:\.\.\/)?js\/([^"]+)"/g)].map((m) => m[1]);
  w.__nav = nav;
  w.__scripts = scripts;
  // load core first so the test can sign in before layout runs
  load("app.js"); load("auth.js");
  if (opts.before) opts.before(w);
  scripts.filter((s) => s !== "app.js" && s !== "auth.js").forEach(load);
  if (w.document.readyState !== "complete") await new Promise((r) => w.addEventListener("load", r));
  return w;
}

(async () => {
console.log("\n[1] data layer + auth logic");
{
  const w = await makeDom("login.html");
  const CF = w.CF;
  check("seeded 5 users", CF.db.users().length === 5);
  check("seeded 6 items", CF.db.items().length === 6);
  check("11 categories", CF.db.categories().length === 11);
  const refs = CF.db.items().map((i) => i.ref);
  check("reference numbers unique", new Set(refs).size === refs.length, refs.join());
  check("next LST ref continues sequence", CF.util.nextRef("LST") === "LST-0004", "");
  check("hash deterministic", CF.util.hash("abc") === CF.util.hash("abc") && CF.util.hash("abc") !== CF.util.hash("abd"));
  check("escapeHtml", CF.util.escapeHtml('<a href="x">&</a>') === "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");

  let r = CF.auth.login("student@campusfind.test", "Student@123");
  check("student login ok", r.ok && r.user.role === "student");
  check("session persisted", CF.auth.currentUser().id === "u_student");
  CF.auth.logout();
  check("logout clears session", CF.auth.currentUser() === null);
  check("email case-insensitive", CF.auth.login("ADMIN@campusfind.test", "Admin@123").ok);
  CF.auth.logout();
  r = CF.auth.login("student@campusfind.test", "wrong");
  check("wrong password rejected", !r.ok && /Incorrect/.test(r.message));
  r = CF.auth.login("nobody@x.com", "whatever1");
  check("unknown email rejected", !r.ok);
  r = CF.auth.login("", "");
  check("empty fields give field errors", !r.ok && r.errors.email && r.errors.password);
  r = CF.auth.login("not-an-email", "x");
  check("bad email format flagged", r.errors.email);

  check("homeFor admin", CF.auth.homeFor({ role: "admin" }, "") === "admin/dashboard.html");
  check("homeFor student", CF.auth.homeFor({ role: "student" }, "") === "index.html");

  const good = { name: "Ana Reyes", email: "ana@example.com", role: "student", idNumber: "2024-1", contact: "0917 123 4567", password: "Passw0rd1", confirm: "Passw0rd1" };
  check("valid registration has no errors", Object.keys(CF.auth.validateRegistration(good).errors).length === 0, JSON.stringify(CF.auth.validateRegistration(good).errors));
  const bad = CF.auth.validateRegistration({ name: "A", email: "x", role: "admin", idNumber: "", contact: "123", password: "short", confirm: "no" }).errors;
  check("bad registration flags 7 fields", Object.keys(bad).length === 7, JSON.stringify(bad));
  check("cannot self-register as admin", !!bad.role);
  check("duplicate email blocked", !!CF.auth.validateRegistration({ ...good, email: "STUDENT@campusfind.test" }).errors.email);
  check("password needs a digit", !!CF.auth.validateRegistration({ ...good, password: "Passwordd", confirm: "Passwordd" }).errors.password);
  r = CF.auth.register(good);
  check("register ok and signed in", r.ok && CF.auth.currentUser().email === "ana@example.com");
  check("password stored hashed", CF.db.userById(r.user.id).passwordHash !== "Passw0rd1");
  check("user count now 6", CF.db.users().length === 6);
  CF.auth.logout();
  check("new user can log in again", CF.auth.login("ana@example.com", "Passw0rd1").ok);
  CF.resetDemoData();
  check("reset restores 5 users", CF.db.users().length === 5);
}

console.log("\n[2] public landing page (signed out)");
{
  const w = await makeDom("index.html");
  const d = w.document;
  check("header rendered", !!d.querySelector(".site-header"));
  check("footer rendered", !!d.querySelector(".site-footer"));
  const links = [...d.querySelectorAll("#primary-nav a.nav-link")].map((a) => a.textContent.trim());
  check("public menu = Home, Search Items, Log in", links.join("|") === "Home|Search Items|Log in", links.join("|"));
  check("Create account button", !!d.querySelector('a.btn[href="register.html"]'));
  check("Home marked active", d.querySelector("a.is-active").textContent === "Home");
  check("stats: 3 open lost", d.getElementById("stat-lost").textContent === "3", d.getElementById("stat-lost").textContent);
  check("stats: 3 open found", d.getElementById("stat-found").textContent === "3");
  check("5 recent items listed", d.querySelectorAll("#recent-items .item-row").length === 5);
  check("signed-out CTA = Get started / Log in", /Get started/.test(d.getElementById("hero-cta").textContent));
}

console.log("\n[3] landing page signed in as student");
{
  const w = await makeDom("index.html", { query: "?welcome=1", before: (w) => w.CF.auth.login("student@campusfind.test", "Student@123") });
  const d = w.document;
  const links = [...d.querySelectorAll("#primary-nav a.nav-link")].map((a) => a.textContent.trim());
  check("user menu has 6 links", links.join("|") === "Home|Report Lost|Report Found|Search Items|My Reports|My Claims", links.join("|"));
  check("user dropdown shows Profile + Log out", !!d.querySelector('.menu-panel a[href="profile.html"]') && !!d.querySelector('[data-action="logout"]'));
  check("avatar initials JC (first+last)", d.querySelector(".avatar").textContent === "JC", d.querySelector(".avatar").textContent);
  check("personalised eyebrow", /Welcome back, Juan/.test(d.getElementById("hero-eyebrow").textContent));
  check("CTA has report buttons", !!d.querySelector('#hero-cta a[href="report-lost.html"]') && !!d.querySelector('#hero-cta a[href="report-found.html"]'));
  check("welcome toast shown", !!d.querySelector(".toast"));
  // mobile nav toggle
  d.querySelector(".nav-toggle").click();
  check("mobile nav toggle opens", d.getElementById("primary-nav").classList.contains("is-open") && d.querySelector(".nav-toggle").getAttribute("aria-expanded") === "true");
  // logout
  d.querySelector('[data-action="logout"]').click();
  check("logout clears session", w.CF.auth.currentUser() === null);
  check("logout navigates", w.__nav.length >= 1);
}

console.log("\n[4] route guards");
{
  let w = await makeDom("my-reports.html");
  check("signed-out user bounced from user page", w.__nav.length >= 1 && !w.document.querySelector(".site-header"));
  w = await makeDom("my-reports.html", { before: (w) => w.CF.auth.login("guard@campusfind.test", "Guard@123") });
  check("guard may open user page", !!w.document.querySelector(".site-header") && w.__nav.length === 0);
  w = await makeDom("my-reports.html", { before: (w) => w.CF.auth.login("admin@campusfind.test", "Admin@123") });
  check("admin bounced from user page", w.__nav.length >= 1);
  w = await makeDom("admin/dashboard.html".replace("admin/", "admin/"), { before: (w) => w.CF.auth.login("student@campusfind.test", "Student@123") });
  check("student bounced from admin page", w.__nav.length >= 1 && !w.document.querySelector(".sidebar a.side-link"));
  w = await makeDom("admin/dashboard.html");
  check("signed-out bounced from admin page", w.__nav.length >= 1);
  w = await makeDom("search.html");
  check("search page is public", !!w.document.querySelector(".site-header") && w.__nav.length === 0);
}

console.log("\n[5] admin dashboard");
{
  const w = await makeDom("admin/dashboard.html", { before: (w) => w.CF.auth.login("admin@campusfind.test", "Admin@123") });
  const d = w.document;
  const side = [...d.querySelectorAll(".sidebar a.side-link")].map((a) => a.textContent.trim());
  check("7 sidebar items", side.join("|") === "Dashboard|Lost Reports|Found Reports|Matches|Claims & Verification|Returned Items|Users", side.join("|"));
  check("Dashboard active", d.querySelector(".side-link.is-active").textContent.trim() === "Dashboard");
  check("sidebar links point at ../admin/", d.querySelector(".side-link").getAttribute("href") === "../admin/dashboard.html");
  check("greeting", /Hello, Campus/.test(d.getElementById("admin-greeting").textContent), d.getElementById("admin-greeting").textContent);
  check("KPI lost=3 found=3 claims=0 returned=0 users=4",
    ["kpi-lost", "kpi-found", "kpi-claims", "kpi-returned", "kpi-users"].map((i) => d.getElementById(i).textContent).join() === "3,3,0,0,4");
  check("6 rows in latest reports", d.querySelectorAll("#recent-body tr").length === 6);
  d.querySelector(".side-toggle").click();
  check("mobile sidebar toggle", d.getElementById("cf-sidebar").classList.contains("is-open"));
}

console.log("\n[6] login page");
{
  const w = await makeDom("login.html");
  const d = w.document;
  d.querySelector('[data-demo="admin"]').click();
  check("demo chip fills admin credentials", d.getElementById("email").value === "admin@campusfind.test" && d.getElementById("password").value === "Admin@123");
  d.querySelector(".pw-toggle").click();
  check("show password toggles type", d.getElementById("password").type === "text");
  d.getElementById("password").value = "bad";
  d.getElementById("login-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
  check("wrong password shows alert", !d.getElementById("form-alert").hidden && /Incorrect/.test(d.getElementById("form-alert").textContent));
  d.getElementById("email").value = "";
  d.getElementById("login-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
  check("empty email shows field error", /Enter your email/.test(d.querySelector("#email").closest(".field").querySelector(".field-error").textContent));
  d.getElementById("email").value = "admin@campusfind.test";
  d.getElementById("password").value = "Admin@123";
  d.getElementById("login-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
  check("good login sets session + redirects", w.CF.auth.currentUser().role === "admin" && w.__nav.length >= 1);

  const w2 = await makeDom("login.html", { query: "?loggedout=1" });
  check("loggedout notice", /logged out/.test(w2.document.getElementById("form-alert").textContent));
}

console.log("\n[7] register page");
{
  const w = await makeDom("register.html");
  const d = w.document;
  check("role picker shows 4 roles (no admin)", d.querySelectorAll('input[name="role"]').length === 4 && !d.querySelector('input[value="admin"]'));
  d.getElementById("register-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
  check("empty submit flags 6 fields", d.querySelectorAll(".field.has-error").length === 6, String(d.querySelectorAll(".field.has-error").length));
  check("error banner shown", !d.getElementById("form-alert").hidden);
  const set = (id, v) => { d.getElementById(id).value = v; };
  const radio = d.querySelector('input[name="role"][value="faculty"]');
  radio.checked = true;
  radio.dispatchEvent(new w.Event("change", { bubbles: true }));
  check("ID label adapts for faculty", d.getElementById("id-label").textContent === "Employee ID number");
  set("name", "Pedro Penduko"); set("idNumber", "FAC-9"); set("contact", "09181234567");
  set("email", "pedro@example.com"); set("password", "Secret123"); set("confirm", "Secret123");
  d.getElementById("register-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
  check("valid submit creates user + signs in", w.CF.auth.currentUser() && w.CF.auth.currentUser().email === "pedro@example.com");
  check("no field errors left", d.querySelectorAll(".field.has-error").length === 0);
  check("redirect fired", w.__nav.length >= 1);
}

console.log("\n[8] placeholder pages + links");
{
  const allHtml = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith(".html")) allHtml.push(p);
    });
  })(ROOT);
  const existing = new Set(allHtml.map((p) => path.relative(ROOT, p)));
  // every href in layout menus must resolve to a real file
  const layoutSrc = fs.readFileSync(path.join(ROOT, "js/layout.js"), "utf8");
  const hrefs = [...layoutSrc.matchAll(/href: "([^"]+\.html)"/g)].map((m) => m[1]);
  const missing = hrefs.filter((h) => !existing.has(h));
  check("all " + hrefs.length + " menu hrefs exist", missing.length === 0, missing.join());
  // every page references scripts/styles that exist
  const broken = [];
  allHtml.forEach((p) => {
    const html = fs.readFileSync(p, "utf8");
    [...html.matchAll(/(?:src|href)="((?:\.\.\/)?(?:js|css)\/[^"]+)"/g)].forEach((m) => {
      if (!fs.existsSync(path.join(path.dirname(p), m[1]))) broken.push(path.relative(ROOT, p) + " -> " + m[1]);
    });
  });
  check("no broken css/js references across " + allHtml.length + " pages", broken.length === 0, broken.join("; "));
  const w = await makeDom("admin/claims.html", { before: (w) => w.CF.auth.login("admin@campusfind.test", "Admin@123") });
  check("admin stub renders with active 'Claims & Verification'", w.document.querySelector(".side-link.is-active").textContent.trim() === "Claims & Verification");
  const w2 = await makeDom("report-lost.html", { before: (w) => w.CF.auth.login("student@campusfind.test", "Student@123") });
  check("user stub marks Report Lost active", w2.document.querySelector("a.is-active").textContent === "Report Lost");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
})();
