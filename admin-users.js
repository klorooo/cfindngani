/* Admin: Users. Search, filter by role and status, disable or re-enable accounts. */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const ui = CF.admin.ui;
  const PAGE = 15;

  document.addEventListener("cf:ready", function (e) {
    const admin = e.detail.user;
    const q = ui.query();
    const roles = ["all"].concat(Object.keys(CF.ROLES));
    const state = { role: roles.indexOf(q.role) >= 0 ? q.role : "all", status: q.status === "active" || q.status === "disabled" ? q.status : "", q: q.q || "", shown: PAGE };
    const el = { tabs: document.getElementById("role-tabs"), q: document.getElementById("f-q"), status: document.getElementById("f-status"), count: document.getElementById("result-count"), rows: document.getElementById("rows"), empty: document.getElementById("empty"), more: document.getElementById("show-more") };
    el.q.value = state.q; el.status.value = state.status;

    const all = () => CF.db.users().slice().sort((a, b) => (a.role === "admin") - (b.role === "admin") || new Date(b.createdAt) - new Date(a.createdAt));
    const hay = (u) => [u.name, u.email, u.idNumber, u.contact].join(" ").toLowerCase();
    function filtered(ignoreRole) {
      const term = state.q.trim().toLowerCase();
      return all().filter((u) => (ignoreRole || state.role === "all" || u.role === state.role) && (!state.status || u.status === state.status) && (!term || hay(u).indexOf(term) >= 0));
    }

    function row(u) {
      const s = CF.admin.userSummary(u);
      const self = u.id === admin.id;
      let action = '<span class="muted small">' + (self ? "You" : "—") + "</span>";
      if (u.role !== "admin") {
        action = u.status === "active"
          ? '<button class="btn btn-ghost btn-sm btn-danger-ghost" type="button" data-set="disabled" data-id="' + esc(u.id) + '">Disable</button>'
          : '<button class="btn btn-ghost btn-sm" type="button" data-set="active" data-id="' + esc(u.id) + '">Enable</button>';
      }
      return "<tr" + (u.status === "disabled" ? ' class="is-disabled"' : "") + '><td><strong>' + esc(u.name) + '</strong><div class="meta">' + esc(CF.ROLES[u.role] ? CF.ROLES[u.role].label : u.role) + "</div></td>" +
        "<td>" + esc(u.idNumber || "—") + "</td><td>" + esc(u.email) + "</td><td>" + esc(u.contact || "—") + "</td><td>" + esc(CF.util.formatDate(u.createdAt)) + "</td>" +
        '<td class="meta-cell">' + s.reports + " report" + (s.reports === 1 ? "" : "s") + " · " + s.claims + " claim" + (s.claims === 1 ? "" : "s") + "</td>" +
        '<td><span class="badge ' + (u.status === "active" ? "badge-approved" : "badge-rejected") + '">' + (u.status === "active" ? "Active" : "Disabled") + "</span></td><td>" + action + "</td></tr>";
    }

    function render() {
      const base = filtered(true);
      ui.tabs(el.tabs, roles.map((r) => ({ key: r, label: r === "all" ? "All" : CF.ROLES[r].label, count: r === "all" ? base.length : base.filter((u) => u.role === r).length })), state.role);
      const list = filtered(false);
      el.rows.innerHTML = list.slice(0, state.shown).map(row).join("");
      el.count.textContent = list.length + " user" + (list.length === 1 ? "" : "s");
      el.empty.hidden = list.length > 0;
      el.empty.textContent = "No users match these filters.";
      el.rows.closest(".table-wrap").hidden = list.length === 0;
      el.more.hidden = list.length <= state.shown;
      ui.setQuery({ role: state.role === "all" ? "" : state.role, status: state.status, q: state.q.trim() });
    }

    el.tabs.addEventListener("click", function (ev) { const b = ev.target.closest("[data-tab]"); if (b) { state.role = b.dataset.tab; state.shown = PAGE; render(); } });
    el.q.addEventListener("input", function () { state.q = el.q.value; state.shown = PAGE; render(); });
    el.status.addEventListener("change", function () { state.status = el.status.value; state.shown = PAGE; render(); });
    el.more.addEventListener("click", function () { state.shown += PAGE; render(); });

    el.rows.addEventListener("click", function (ev) {
      const b = ev.target.closest("[data-set]");
      if (!b) return;
      const u = CF.db.userById(b.dataset.id);
      if (!u) return;
      if (b.dataset.set === "disabled" && !window.confirm("Disable " + u.name + "? They will be signed out and won't be able to log in until you enable the account again.")) return;
      const res = CF.admin.setUserStatus(u.id, b.dataset.set, admin);
      CF.ui.toast(res.ok ? (b.dataset.set === "disabled" ? "Account disabled." : "Account enabled.") : res.message, res.ok ? "success" : "error");
      render();
    });
    render();
  });
})();
