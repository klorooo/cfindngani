/* Admin: Lost Reports / Found Reports (one script, the page sets <body data-type="lost|found">). */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const ui = CF.admin.ui;
  const TYPE = document.body.dataset.type === "found" ? "found" : "lost";
  const PAGE = 10;
  const STATUSES = [["all", "All"], ["open", "Open"], ["matched", "Matched"], ["claimed", "Claimed"], ["returned", "Returned"], ["withdrawn", "Withdrawn"]];
  const KIND_WORD = TYPE === "lost" ? "lost" : "found";

  document.addEventListener("cf:ready", function (e) {
    const admin = e.detail.user;
    const q = ui.query();
    const state = { status: STATUSES.some((s) => s[0] === q.status) ? q.status : "all", q: q.q || "", category: q.category || "", shown: PAGE, open: new Set() };

    const el = {
      tabs: document.getElementById("status-tabs"), q: document.getElementById("f-q"), cat: document.getElementById("f-category"),
      count: document.getElementById("result-count"), rows: document.getElementById("rows"), empty: document.getElementById("empty"),
      more: document.getElementById("show-more"), exp: document.getElementById("export-btn"),
    };
    el.q.value = state.q;
    CF.db.categories().forEach((c) => el.cat.insertAdjacentHTML("beforeend", '<option value="' + esc(c) + '">' + esc(c) + "</option>"));
    el.cat.value = state.category;

    const all = () => CF.db.items().filter((i) => i.type === TYPE).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const haystack = (i) => {
      const r = CF.db.userById(i.reporterId);
      return [i.ref, i.title, i.description, i.category, i.location, i.color, i.brand, r ? r.name : ""].join(" ").toLowerCase();
    };
    function filtered(ignoreStatus) {
      const term = state.q.trim().toLowerCase();
      return all().filter((i) =>
        (ignoreStatus || state.status === "all" || i.status === state.status) &&
        (!state.category || i.category === state.category) &&
        (!term || haystack(i).indexOf(term) >= 0));
    }

    /* ---------- detail row ---------- */
    function detail(i) {
      const r = CF.db.userById(i.reporterId);
      const role = r && CF.ROLES[r.role] ? CF.ROLES[r.role].label : "";
      const fact = (k, v) => (v ? "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>" : "");
      const links = CF.admin.matchRows().filter((m) => (m.lost.id === i.id || m.found.id === i.id) && (m.state === "suggested" || m.state === "confirmed"));
      const claims = TYPE === "found" ? CF.db.claims().filter((c) => c.itemId === i.id) : [];

      let actions;
      if (i.status === "withdrawn" && i.removedByAdmin) {
        actions = '<p class="muted small">Removed by an administrator. Reason: ' + esc(i.removedReason || "—") + '</p><button class="btn btn-ghost btn-sm" type="button" data-restore="' + esc(i.id) + '">Restore report</button>';
      } else if (i.status === "withdrawn") {
        actions = '<p class="muted small">Withdrawn by the reporter.</p>';
      } else if (i.status === "claimed" || i.status === "returned") {
        actions = '<p class="muted small">This report is closed, so it can\'t be removed.</p>';
      } else {
        actions = '<form class="inline-form" data-remove="' + esc(i.id) + '" novalidate>' +
          '<label class="sr-only" for="why-' + esc(i.id) + '">Reason for removing</label>' +
          '<input class="input" id="why-' + esc(i.id) + '" name="reason" maxlength="200" placeholder="Reason (the reporter will see it)">' +
          '<button class="btn btn-ghost btn-sm btn-danger-ghost" type="submit">Remove report</button></form>' +
          '<p class="field-error" data-error role="alert"></p>';
      }

      return '<tr class="detail-row" data-detail="' + esc(i.id) + '"><td colspan="6"><div class="detail-grid">' +
        '<div class="detail-photo">' + CF.reports.thumbHtml(i) + "</div>" +
        '<dl class="facts compact">' +
        fact("Description", i.description) + fact("Colour", i.color) + fact("Brand", i.brand) + fact("Exact spot", i.locationDetail) +
        fact("Private marks (admin only)", i.identifyingMarks || "(none given)") + (TYPE === "found" ? fact("Kept at", i.storedAt) : "") +
        fact("Filed", CF.util.formatDate(i.createdAt)) +
        fact("Reporter", r ? r.name + " (" + role + ")" : "Unknown") + fact("Email", r && r.email) + fact("Mobile", r && r.contact) + fact("ID number", r && r.idNumber) +
        "</dl><div class=\"detail-side-box\">" +
        "<h4>Related</h4><p class=\"small\">" + (links.length ? '<a href="matches.html">' + links.length + " possible match" + (links.length === 1 ? "" : "es") + "</a>" : "No active matches") + "</p>" +
        (TYPE === "found"
          ? "<p class=\"small\">" + (claims.length ? claims.map((c) => '<a href="verify-claim.html?id=' + encodeURIComponent(c.id) + '">' + esc(c.ref) + "</a> " + ui.badge(c.status, c.status, CF.claims.STATUS_LABELS[c.status])).join("<br>") : "No claims") + "</p>"
          : "") +
        "<h4>Actions</h4>" + actions + "</div></div></td></tr>";
    }

    function row(i) {
      const open = state.open.has(i.id);
      const r = CF.db.userById(i.reporterId);
      return '<tr data-id="' + esc(i.id) + '"><td><strong>' + esc(i.ref) + '</strong></td>' +
        '<td class="wrap"><strong>' + esc(i.title) + '</strong><div class="meta">' + esc(i.category) + "</div></td>" +
        '<td class="wrap">' + esc(i.location) + '<div class="meta">' + esc(CF.util.formatDate(i.dateOccurred)) + "</div></td>" +
        "<td>" + ui.person(r) + "</td>" +
        "<td>" + ui.badge(i.status, i.status, CF.reports.STATUS_LABELS[i.status] || i.status) + "</td>" +
        '<td><button class="btn btn-ghost btn-sm" type="button" data-toggle="' + esc(i.id) + '" aria-expanded="' + open + '">' + (open ? "Hide" : "Details") + "</button></td></tr>" +
        (open ? detail(i) : "");
    }

    function render() {
      const base = filtered(true);
      ui.tabs(el.tabs, STATUSES.map((s) => ({ key: s[0], label: s[1], count: s[0] === "all" ? base.length : base.filter((i) => i.status === s[0]).length })), state.status);
      const list = filtered(false);
      const page = list.slice(0, state.shown);
      el.rows.innerHTML = page.map(row).join("");
      el.count.textContent = list.length + " " + KIND_WORD + " report" + (list.length === 1 ? "" : "s");
      el.empty.hidden = list.length > 0;
      el.empty.textContent = all().length ? "No reports match these filters." : "No " + KIND_WORD + " reports yet.";
      el.rows.closest(".table-wrap").hidden = list.length === 0;
      el.more.hidden = list.length <= state.shown;
      ui.setQuery({ status: state.status === "all" ? "" : state.status, q: state.q.trim(), category: state.category });
    }

    /* ---------- events ---------- */
    el.tabs.addEventListener("click", function (ev) {
      const b = ev.target.closest("[data-tab]");
      if (!b) return;
      state.status = b.dataset.tab; state.shown = PAGE; render();
    });
    el.q.addEventListener("input", function () { state.q = el.q.value; state.shown = PAGE; render(); });
    el.cat.addEventListener("change", function () { state.category = el.cat.value; state.shown = PAGE; render(); });
    el.more.addEventListener("click", function () { state.shown += PAGE; render(); });

    el.rows.addEventListener("click", function (ev) {
      const t = ev.target.closest("[data-toggle]");
      if (t) {
        const id = t.dataset.toggle;
        if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
        render();
        return;
      }
      const r = ev.target.closest("[data-restore]");
      if (r) {
        const res = CF.admin.restoreReport(r.dataset.restore, admin);
        CF.ui.toast(res.ok ? "Report restored. The reporter has been told." : res.message, res.ok ? "success" : "error");
        render();
      }
    });
    el.rows.addEventListener("submit", function (ev) {
      const f = ev.target.closest("[data-remove]");
      if (!f) return;
      ev.preventDefault();
      const res = CF.admin.removeReport(f.dataset.remove, admin, f.elements.reason.value);
      if (!res.ok) { f.parentElement.querySelector("[data-error]").textContent = res.message; return; }
      CF.ui.toast("Report removed. The reporter has been told.", "success");
      render();
    });

    el.exp.addEventListener("click", function () {
      const rows = [["Reference", "Type", "Title", "Category", "Colour", "Brand", "Place", "Date " + KIND_WORD, "Status", "Reported by", "Role", "Filed on"]];
      filtered(false).forEach((i) => {
        const r = CF.db.userById(i.reporterId);
        rows.push([i.ref, TYPE, i.title, i.category, i.color, i.brand, i.location, CF.util.toDayStr(i.dateOccurred), i.status, r ? r.name : "", r ? r.role : "", CF.util.toDayStr(i.createdAt)]);
      });
      CF.admin.download("campusfind-" + TYPE + "-reports.csv", CF.admin.csv(rows));
      CF.ui.toast("Exported " + (rows.length - 1) + " report(s).", "success");
    });

    render();
  });
})();
