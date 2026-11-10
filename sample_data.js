// Checks the admin "Load sample data" action (jsdom).
const { JSDOM } = require("jsdom"); const fs = require("fs"); const path = require("path");
const ROOT = process.env.CF_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log("  ok   " + m)) : (fail++, console.log("  FAIL " + m)); };
const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "http://localhost/", runScripts: "outside-only" });
for (const f of ["app", "auth", "reports", "search-match", "claims", "admin"]) dom.window.eval(fs.readFileSync(path.join(ROOT, "js", f + ".js"), "utf8"));
const CF = dom.window.CF; const admin = CF.db.userById("u_admin");
const before = CF.db.items().length;
let r = CF.admin.loadSampleData(admin); ok(r.ok && r.added === 14, "adds 14 reports");
ok(CF.db.items().length === before + 14, "item count");
ok(CF.db.claims().length === 4, "4 claims: " + CF.db.claims().length);
const st = CF.claims ? CF.db.claims().map((c) => c.status).sort().join() : "";
ok(st === "approved,needs_info,pending,returned", "claim states: " + st);
r = CF.admin.loadSampleData(admin); ok(!r.ok, "second press refused");
ok(!CF.admin.loadSampleData(CF.db.userById("u_student")).ok, "non-admin refused");
ok(CF.admin.stats(14).perDay.lost.some((n) => n > 0), "chart has data");
console.log("sample_data: " + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
