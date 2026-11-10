/* Admin: Claims & Verification list. The review itself happens on verify-claim.html. */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const ui = CF.admin.ui;
  const PAGE = 15;
  const TABS = [
    ["pending", "Needs review"], ["needs_info", "Waiting for info"], ["approved", "To hand over"],
    ["returned", "Returned"], ["rejected", "Rejected"], ["cancelled", "Cancelled"], ["all", "All"],
  ];

  document.addEventListener("cf:ready", function () {
    const q = ui.query();
    const rowsAll = () => CF.admin.claimRows();
    const hasPending = rowsAll().some((r) => r.claim.status === "pending");
    const state = { tab: TABS.some((t) => t[0] === q.status) ? q.status : hasPending ? "pending" : "all", q: q.q || "", shown: PAGE };
    const el = { tabs: document.getElementById("claim-tabs"), q: document.getElementById("f-q"), count: document.getElementById("result-count"), rows: document.getElementById("rows"), empty: document.getElementById("empty"), more: document.getElementById("show-more") };
    el.q.value = state.q;

    const hay = (r) => [r.claim.ref, r.item && r.item.ref, r.item && r.item.title, r.claimant && r.claimant.name, r.claimant && r.claimant.email].join(" ").toLowerCase();
    function filtered(ignoreTab) {
      const term = state.q.trim().toLowerCase();
      return rowsAll().filter((r) => (ignoreTab || state.tab === "all" || r.claim.status === state.tab) && (!term || hay(r).indexOf(term) >= 0));
    }

    function row(r) {
      const c = r.claim;
      return '<tr><td><strong>' + esc(c.ref) + "</strong></td>" +
        '<td class="wrap">' + (r.item ? "<strong>" + esc(r.item.title) + '</strong><div class="meta">' + esc(r.item.ref) + "</div>" : '<span class="muted">Removed item</span>') + "</td>" +
        "<td>" + ui.person(r.claimant) + "</td>" +
        "<td>" + esc(CF.util.timeAgo(c.createdAt)) + "</td><td>" + esc(CF.util.timeAgo(c.updatedAt || c.createdAt)) + "</td>" +
        "<td>" + ui.badge(c.status, c.status, CF.claims.STATUS_LABELS[c.status]) + "</td>" +
        '<td><a class="btn btn-primary btn-sm" href="verify-claim.html?id=' + encodeURIComponent(c.id) + '">' + (c.status === "pending" ? "Review" : "Open") + "</a></td></tr>";
    }

    function render() {
      const base = filtered(true);
      ui.tabs(el.tabs, TABS.map((t) => ({ key: t[0], label: t[1], count: t[0] === "all" ? base.length : base.filter((r) => r.claim.status === t[0]).length })), state.tab);
      const list = filtered(false);
      el.rows.innerHTML = list.slice(0, state.shown).map(row).join("");
      el.count.textContent = list.length + " claim" + (list.length === 1 ? "" : "s");
      el.empty.hidden = list.length > 0;
      el.empty.textContent = rowsAll().length ? (state.tab === "pending" && !state.q ? "Nothing is waiting for review. Nice work." : "No claims match these filters.") : "No claims yet. They appear here when someone claims a found item.";
      el.rows.closest(".table-wrap").hidden = list.length === 0;
      el.more.hidden = list.length <= state.shown;
      ui.setQuery({ status: state.tab, q: state.q.trim() });
    }

    el.tabs.addEventListener("click", function (ev) { const b = ev.target.closest("[data-tab]"); if (b) { state.tab = b.dataset.tab; state.shown = PAGE; render(); } });
    el.q.addEventListener("input", function () { state.q = el.q.value; state.shown = PAGE; render(); });
    el.more.addEventListener("click", function () { state.shown += PAGE; render(); });
    render();
  });
})();
