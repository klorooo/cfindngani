/* Admin: Returned Items. A record of every item handed back, with a CSV export for reports. */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const ui = CF.admin.ui;
  const PAGE = 15;

  document.addEventListener("cf:ready", function () {
    const q = ui.query();
    const state = { q: q.q || "", shown: PAGE };
    const el = { q: document.getElementById("f-q"), count: document.getElementById("result-count"), rows: document.getElementById("rows"), empty: document.getElementById("empty"), more: document.getElementById("show-more"), exp: document.getElementById("export-btn"), stats: document.getElementById("return-stats") };
    el.q.value = state.q;

    function returnedAt(c) {
      const t = c.timeline.filter((x) => x.kind === "returned").pop();
      return t ? t.at : c.updatedAt || c.createdAt;
    }
    function all() {
      return CF.admin.claimRows().filter((r) => r.claim.status === "returned").map((r) => {
        const at = returnedAt(r.claim);
        return Object.assign({ at, days: r.item ? CF.admin.daysBetween(r.item.createdAt, at) : 0 }, r);
      }).sort((a, b) => new Date(b.at) - new Date(a.at));
    }
    const hay = (r) => [r.claim.ref, r.item && r.item.ref, r.item && r.item.title, r.item && r.item.category, r.claimant && r.claimant.name, r.finder && r.finder.name].join(" ").toLowerCase();
    function filtered() {
      const term = state.q.trim().toLowerCase();
      return all().filter((r) => !term || hay(r).indexOf(term) >= 0);
    }

    function renderStats() {
      const rows = all();
      const month = new Date().toISOString().slice(0, 7);
      const thisMonth = rows.filter((r) => r.at.slice(0, 7) === month).length;
      const avg = rows.length ? Math.round((rows.reduce((s, r) => s + r.days, 0) / rows.length) * 10) / 10 : null;
      const rate = CF.admin.stats(1).returnRate;
      const tile = (num, label, cls) => '<div class="stat ' + cls + '"><div class="stat-num">' + esc(String(num)) + '</div><div class="stat-label">' + esc(label) + "</div></div>";
      el.stats.innerHTML = tile(rows.length, "Items returned", "is-found") + tile(thisMonth, "Returned this month", "is-brand") + tile(avg == null ? "—" : avg, "Average days to return", "is-amber") + tile(rate.pct + "%", "Of found items returned", "");
    }

    function render() {
      renderStats();
      const list = filtered();
      el.rows.innerHTML = list.slice(0, state.shown).map((r) =>
        "<tr><td><strong>" + esc(r.claim.ref) + "</strong></td>" +
        '<td class="wrap"><strong>' + esc(r.item ? r.item.title : "Removed item") + '</strong><div class="meta">' + esc(r.item ? r.item.ref + " · " + r.item.category : "") + "</div></td>" +
        "<td>" + ui.person(r.claimant) + "</td><td>" + ui.person(r.finder) + "</td>" +
        "<td>" + esc(CF.util.formatDate(r.at)) + "</td><td>" + r.days + "</td></tr>").join("");
      el.count.textContent = list.length + " returned item" + (list.length === 1 ? "" : "s");
      el.empty.hidden = list.length > 0;
      el.empty.textContent = all().length ? "No returned items match your search." : "Nothing has been returned yet. Items appear here once you mark an approved claim as returned.";
      el.rows.closest(".table-wrap").hidden = list.length === 0;
      el.more.hidden = list.length <= state.shown;
      ui.setQuery({ q: state.q.trim() });
    }

    el.q.addEventListener("input", function () { state.q = el.q.value; state.shown = PAGE; render(); });
    el.more.addEventListener("click", function () { state.shown += PAGE; render(); });
    el.exp.addEventListener("click", function () {
      const rows = [["Claim", "Item reference", "Item", "Category", "Returned to", "Found by", "Returned on", "Days to return"]];
      filtered().forEach((r) => rows.push([r.claim.ref, r.item ? r.item.ref : "", r.item ? r.item.title : "", r.item ? r.item.category : "", r.claimant ? r.claimant.name : "", r.finder ? r.finder.name : "", CF.util.toDayStr(r.at), r.days]));
      CF.admin.download("campusfind-returned-items.csv", CF.admin.csv(rows));
      CF.ui.toast("Exported " + (rows.length - 1) + " item(s).", "success");
    });
    render();
  });
})();
