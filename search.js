/* Search page controller (Day 3). The page is public: `user` may be null. */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const PAGE_SIZE = 9;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const SORTS = ["newest", "oldest", "relevance"];

  document.addEventListener("cf:ready", function (e) {
    const user = e.detail.user;
    const form = document.getElementById("search-form");
    const grid = document.getElementById("results");
    const summary = document.getElementById("summary");
    const chips = document.getElementById("chips");
    const moreBtn = document.getElementById("load-more");
    const tabs = Array.prototype.slice.call(form.querySelectorAll(".tab[data-type]"));
    const el = (id) => document.getElementById(id);

    // fill the dropdowns from the shared reference data
    el("category").insertAdjacentHTML("beforeend", CF.db.categories().map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join(""));
    el("location").insertAdjacentHTML("beforeend", CF.db.locations().map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join(""));
    if (!user) el("guest-note").hidden = false;

    /* ---------- state <-> URL ---------- */
    const state = { q: "", type: "all", category: "", location: "", from: "", to: "", closed: false, sort: "" };
    let shown = PAGE_SIZE;

    (function readUrl() {
      const p = new URLSearchParams(window.location.search);
      state.q = (p.get("q") || "").slice(0, 100);
      if (["lost", "found"].indexOf(p.get("type")) !== -1) state.type = p.get("type");
      if (CF.db.categories().indexOf(p.get("category")) !== -1) state.category = p.get("category");
      if (CF.db.locations().indexOf(p.get("location")) !== -1) state.location = p.get("location");
      if (DAY_RE.test(p.get("from") || "")) state.from = p.get("from");
      if (DAY_RE.test(p.get("to") || "")) state.to = p.get("to");
      state.closed = p.get("closed") === "1";
      if (SORTS.indexOf(p.get("sort")) !== -1) state.sort = p.get("sort");
    })();

    function writeUrl() {
      const p = new URLSearchParams();
      if (state.q) p.set("q", state.q);
      if (state.type !== "all") p.set("type", state.type);
      if (state.category) p.set("category", state.category);
      if (state.location) p.set("location", state.location);
      if (state.from) p.set("from", state.from);
      if (state.to) p.set("to", state.to);
      if (state.closed) p.set("closed", "1");
      if (state.sort) p.set("sort", state.sort);
      const qs = p.toString();
      try { window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "")); } catch (err) { /* ignore */ }
    }

    function syncForm() {
      el("q").value = state.q;
      el("category").value = state.category;
      el("location").value = state.location;
      el("from").value = state.from;
      el("to").value = state.to;
      el("closed").checked = state.closed;
      el("sort").value = state.sort || (state.q ? "relevance" : "newest");
      tabs.forEach((t) => t.setAttribute("aria-pressed", String(t.dataset.type === state.type)));
    }

    /* ---------- rendering ---------- */
    function card(row) {
      const item = row.item;
      const url = "item-details.html?id=" + encodeURIComponent(item.id);
      const mine = user && user.id === item.reporterId;
      const cta = user ? "View details" : "Log in to view";
      return (
        '<article class="report-card">' +
        '<a class="report-thumb" href="' + url + '" tabindex="-1" aria-hidden="true">' + CF.reports.thumbHtml(item) + "</a>" +
        '<div class="report-body"><div class="report-top">' +
        '<span class="badge badge-' + item.type + '">' + (item.type === "lost" ? "Lost" : "Found") + "</span>" +
        (item.status !== "open" ? '<span class="badge badge-' + item.status + '">' + esc(CF.reports.STATUS_LABELS[item.status] || item.status) + "</span>" : "") +
        (mine ? '<span class="badge badge-open">Your report</span>' : "") +
        "</div>" +
        '<h3><a href="' + url + '">' + esc(item.title) + "</a></h3>" +
        '<p class="meta">' + esc(item.ref) + " · " + esc(item.category) + "</p>" +
        '<p class="meta">' + esc(item.location) + " · " + esc(CF.util.formatDate(item.dateOccurred)) + "</p></div>" +
        '<div class="report-actions"><a class="btn btn-primary btn-sm" href="' + url + '">' + cta + "</a></div></article>"
      );
    }

    function chipList() {
      const out = [];
      if (state.q) out.push(["q", "“" + state.q + "”"]);
      if (state.type !== "all") out.push(["type", state.type === "lost" ? "Lost items" : "Found items"]);
      if (state.category) out.push(["category", state.category]);
      if (state.location) out.push(["location", state.location]);
      if (state.from) out.push(["from", "From " + CF.util.formatDate(state.from)]);
      if (state.to) out.push(["to", "To " + CF.util.formatDate(state.to)]);
      if (state.closed) out.push(["closed", "Including closed"]);
      return out;
    }

    function emptyState(hasFilters) {
      const reportLinks = user
        ? '<a class="btn btn-lost" href="report-lost.html">Report a lost item</a><a class="btn btn-found" href="report-found.html">Report a found item</a>'
        : '<a class="btn btn-primary" href="register.html">Create an account</a>';
      return (
        '<div class="empty" style="grid-column:1/-1"><h3>No items found</h3>' +
        "<p>" + (hasFilters ? "Try fewer words or remove a filter." : "Nothing has been reported yet.") + " Items are added as people report them, so check back soon.</p>" +
        '<div class="hero-cta" style="justify-content:center;margin-top:12px">' + reportLinks + "</div></div>"
      );
    }

    function render() {
      const out = CF.match.search({
        q: state.q, type: state.type, category: state.category, location: state.location,
        from: state.from, to: state.to, includeClosed: state.closed, sort: state.sort || undefined,
      });
      const total = out.results.length;
      const visible = out.results.slice(0, shown);
      const filters = chipList();

      grid.innerHTML = total ? visible.map(card).join("") : emptyState(filters.length > 0);
      summary.textContent = total ? "Showing " + visible.length + " of " + total + " item" + (total === 1 ? "" : "s") : "No matching items";
      chips.innerHTML = filters
        .map((f) => '<li><button type="button" class="chip" data-clear="' + f[0] + '" aria-label="Remove filter: ' + esc(f[1]) + '">' + esc(f[1]) + " <span aria-hidden=\"true\">×</span></button></li>")
        .join("");
      el("clear-all").hidden = filters.length === 0;
      moreBtn.hidden = visible.length >= total;
      if (!moreBtn.hidden) moreBtn.textContent = "Show more (" + (total - visible.length) + " left)";
    }

    function apply(resetPaging) {
      if (resetPaging !== false) shown = PAGE_SIZE;
      writeUrl();
      render();
    }

    /* ---------- "for you": matches for the signed-in user's own open reports ---------- */
    function renderForYou() {
      const box = el("for-you");
      if (!user || user.role === "admin") return;
      const rows = CF.reports
        .forUser(user.id)
        .filter((i) => i.status === "open")
        .map((i) => ({ item: i, matches: CF.match.candidatesFor(i) }))
        .filter((r) => r.matches.length);
      if (!rows.length) return;
      box.innerHTML =
        "<h2>Possible matches for your reports</h2><ul>" +
        rows
          .map((r) => {
            const n = r.matches.length;
            return (
              '<li><a href="item-details.html?id=' + encodeURIComponent(r.item.id) + '#matches"><strong>' + esc(r.item.ref) + "</strong> · " + esc(r.item.title) + "</a>" +
              ' <span class="muted">— ' + n + " possible match" + (n === 1 ? "" : "es") + ", best " + r.matches[0].score + "%</span></li>"
            );
          })
          .join("") + "</ul>";
      box.hidden = false;
    }

    /* ---------- events ---------- */
    // sort is "auto" (best match while searching, newest otherwise) until the user picks one or the URL sets one
    let sortTouched = !!state.sort;
    const autoSort = () => (state.q ? "relevance" : "newest");
    function updateSortSelect() { el("sort").value = state.sort || autoSort(); }

    form.addEventListener("submit", function (ev) { ev.preventDefault(); state.q = el("q").value.trim(); apply(); });
    el("q").addEventListener("input", function () {
      state.q = el("q").value.trim(); // not written back into the box, so trailing spaces survive while typing
      if (!sortTouched) state.sort = "";
      updateSortSelect();
      apply();
    });
    tabs.forEach((t) => t.addEventListener("click", function () { state.type = t.dataset.type; syncForm(); apply(); }));
    el("category").addEventListener("change", function () { state.category = el("category").value; apply(); });
    el("location").addEventListener("change", function () { state.location = el("location").value; apply(); });
    el("from").addEventListener("change", function () { state.from = DAY_RE.test(el("from").value) ? el("from").value : ""; apply(); });
    el("to").addEventListener("change", function () { state.to = DAY_RE.test(el("to").value) ? el("to").value : ""; apply(); });
    el("closed").addEventListener("change", function () { state.closed = el("closed").checked; apply(); });
    el("sort").addEventListener("change", function () { sortTouched = true; state.sort = el("sort").value; apply(); });
    moreBtn.addEventListener("click", function () { shown += PAGE_SIZE; apply(false); });

    function resetAll() {
      state.q = ""; state.type = "all"; state.category = ""; state.location = ""; state.from = ""; state.to = ""; state.closed = false; state.sort = "";
      sortTouched = false;
    }
    el("clear-all").addEventListener("click", function () { resetAll(); syncForm(); apply(); });
    chips.addEventListener("click", function (ev) {
      const b = ev.target.closest("[data-clear]");
      if (!b) return;
      const k = b.dataset.clear;
      if (k === "type") state.type = "all";
      else if (k === "closed") state.closed = false;
      else state[k] = "";
      if (k === "q" && !sortTouched) state.sort = "";
      syncForm();
      apply();
    });

    syncForm();
    CF.match.syncAll();
    renderForYou();
    render();
  });
})();
