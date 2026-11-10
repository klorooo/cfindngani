/* Admin: Matches. Confirm or dismiss suggestions, undo, or link two reports by hand. */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const ui = CF.admin.ui;
  const TABS = [["suggested", "Suggested"], ["confirmed", "Confirmed"], ["dismissed", "Dismissed"], ["closed", "Closed"]];
  const EMPTY = {
    suggested: "No suggestions to review. New ones appear when someone files a report.",
    confirmed: "No confirmed matches yet.",
    dismissed: "Nothing dismissed.",
    closed: "Nothing here. Suggestions land here when one of the reports is no longer open.",
  };

  document.addEventListener("cf:ready", function (e) {
    const admin = e.detail.user;
    const q = ui.query();
    let tab = TABS.some((t) => t[0] === q.tab) ? q.tab : "suggested";
    const el = {
      tabs: document.getElementById("match-tabs"), list: document.getElementById("match-list"), refresh: document.getElementById("refresh-btn"),
      form: document.getElementById("link-form"), lost: document.getElementById("link-lost"), found: document.getElementById("link-found"), err: document.getElementById("link-error"), panel: document.getElementById("link-panel"),
    };

    function side(item, kind) {
      const r = CF.db.userById(item.reporterId);
      return '<section class="match-side side-' + kind + '"><div class="side-head"><span class="badge badge-' + kind + '">' + (kind === "lost" ? "Lost" : "Found") + "</span> <strong>" + esc(item.ref) + "</strong></div>" +
        "<h4>" + esc(item.title) + "</h4>" +
        '<p class="meta">' + esc(item.category) + " · " + esc(item.location) + " · " + esc(CF.util.formatDate(item.dateOccurred)) + "</p>" +
        '<p class="small">' + esc(item.description) + "</p>" +
        '<p class="small"><span class="muted">Private marks:</span> ' + esc(item.identifyingMarks || "(none given)") + "</p>" +
        (kind === "found" && item.storedAt ? '<p class="small"><span class="muted">Kept at:</span> ' + esc(item.storedAt) + "</p>" : "") +
        '<p class="meta">Reported by ' + esc(r ? r.name : "Unknown") + "</p></section>";
    }

    function actions(r) {
      const id = esc(r.rec.id);
      if (r.state === "suggested") return '<button class="btn btn-found btn-sm" type="button" data-act="confirm" data-id="' + id + '">Confirm match</button><button class="btn btn-ghost btn-sm" type="button" data-act="dismiss" data-id="' + id + '">Dismiss</button>';
      if (r.state === "confirmed") return (r.lost.status === "matched" || r.found.status === "matched") && r.lost.status !== "claimed" && r.found.status !== "claimed" && r.lost.status !== "returned" && r.found.status !== "returned"
        ? '<button class="btn btn-ghost btn-sm" type="button" data-act="reopen" data-id="' + id + '">Undo match</button>'
        : '<span class="muted small">Item already claimed</span>';
      if (r.state === "dismissed") return '<button class="btn btn-ghost btn-sm" type="button" data-act="reopen" data-id="' + id + '">Restore as suggestion</button>';
      return '<span class="muted small">One of these reports is no longer open</span>';
    }

    function card(r) {
      const note = r.rec.manual ? " · linked by an administrator" : "";
      return '<article class="card match-card" data-match="' + esc(r.rec.id) + '"><header class="match-head">' +
        '<span class="tier tier-' + r.tier.tier + '">' + r.score + "% · " + esc(r.tier.label) + "</span>" +
        '<span class="muted small">Suggested ' + esc(CF.util.timeAgo(r.rec.createdAt)) + esc(note) + "</span></header>" +
        '<div class="match-sides">' + side(r.lost, "lost") + side(r.found, "found") + "</div>" +
        (r.reasons && r.reasons.length ? '<ul class="reasons">' + r.reasons.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") +
        '<footer class="match-actions">' + actions(r) + "</footer></article>";
    }

    function fillLinkLists() {
      const mk = (type) => CF.db.items().filter((i) => i.type === type && i.status === "open").sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((i) => '<option value="' + esc(i.id) + '">' + esc(i.ref + " · " + i.title) + "</option>").join("");
      el.lost.innerHTML = '<option value="">Choose a lost report</option>' + mk("lost");
      el.found.innerHTML = '<option value="">Choose a found report</option>' + mk("found");
    }

    function render() {
      const rows = CF.admin.matchRows();
      ui.tabs(el.tabs, TABS.map((t) => ({ key: t[0], label: t[1], count: rows.filter((r) => r.state === t[0]).length })), tab);
      const list = rows.filter((r) => r.state === tab);
      el.list.innerHTML = list.length ? list.map(card).join("") : '<div class="empty">' + esc(EMPTY[tab]) + "</div>";
      fillLinkLists();
      ui.setQuery({ tab: tab === "suggested" ? "" : tab });
    }

    el.tabs.addEventListener("click", function (ev) {
      const b = ev.target.closest("[data-tab]");
      if (b) { tab = b.dataset.tab; render(); }
    });

    el.list.addEventListener("click", function (ev) {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      const fn = { confirm: CF.admin.confirmMatch, dismiss: CF.admin.dismissMatch, reopen: CF.admin.reopenMatch }[b.dataset.act];
      if (!fn) return;
      const res = fn(b.dataset.id, admin);
      const ok = { confirm: "Match confirmed. Both reporters have been notified.", dismiss: "Dismissed. It won't be suggested again.", reopen: "Moved back to suggestions." }[b.dataset.act];
      CF.ui.toast(res.ok ? ok : res.message, res.ok ? "success" : "error");
      render();
    });

    el.refresh.addEventListener("click", function () {
      const before = CF.db.matches().length;
      CF.match.syncAll();
      const added = CF.db.matches().length - before;
      CF.ui.toast(added ? added + " new suggestion" + (added === 1 ? "" : "s") + " found." : "No new suggestions.", "success");
      render();
    });

    el.form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      el.err.textContent = "";
      if (!el.lost.value || !el.found.value) { el.err.textContent = "Choose one lost report and one found report."; return; }
      const res = CF.admin.linkMatch(el.lost.value, el.found.value, admin);
      if (!res.ok) { el.err.textContent = res.message; return; }
      CF.ui.toast("Linked and confirmed. Both reporters have been notified.", "success");
      el.panel.open = false;
      tab = "confirmed";
      render();
    });

    CF.match.syncAll(); // make sure suggestions exist for every open lost report
    render();
  });
})();
