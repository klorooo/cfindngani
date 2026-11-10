/* Admin: verify one claim. Compares the claimant's proof with the finder's private record, then decides. */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const KIND = { submitted: "Claim submitted", info_requested: "Asked for more information", reply: "Claimant replied", approved: "Approved", rejected: "Rejected", auto_rejected: "Closed automatically", cancelled: "Cancelled by claimant", returned: "Marked as returned" };
  const MARK = { good: ["✓", "Looks consistent"], warn: ["!", "Check this"], info: ["i", "For your information"] };

  document.addEventListener("cf:ready", function (e) {
    const admin = e.detail.user;
    const root = document.getElementById("verify-root");
    const key = CF.admin.ui.query().id;
    let message = "";

    const row = (k, v) => (v ? "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>" : "");
    const safe = (list) => (list || []).filter((p) => CF.reports.isSafePhoto(p));
    const photos = (list, label) => {
      const s = safe(list);
      return s.length ? '<ul class="evidence-list static big">' + s.map((p, i) => '<li><img src="' + p + '" alt="' + esc(label) + " " + (i + 1) + '"></li>').join("") + "</ul>" : "";
    };

    function timeline(c) {
      return '<ol class="timeline">' + c.timeline.map((t) => {
        const who = t.byRole === "admin" ? "Administrator" : t.byRole === "system" ? "System" : (CF.db.userById(t.byId) || { name: "Claimant" }).name;
        return '<li class="tl-' + esc(t.kind) + '"><span class="tl-dot" aria-hidden="true"></span><div class="tl-body"><div class="tl-head"><strong>' + esc(KIND[t.kind] || t.kind) + '</strong><span class="muted">' + esc(who) + " · " + esc(CF.util.timeAgo(t.at)) + "</span></div>" +
          (t.text && t.kind !== "submitted" ? "<p>" + esc(t.text) + "</p>" : "") + photos(t.photos, "Attachment") + "</div></li>";
      }).join("") + "</ol>";
    }

    function decision(c, item) {
      const s = c.status;
      if (["returned", "rejected", "cancelled"].indexOf(s) >= 0) {
        return '<section class="card decision"><h3>Decision</h3><p class="muted" style="margin:0">This claim is ' + esc(CF.claims.STATUS_LABELS[s].toLowerCase()) + ". No further action is needed.</p></section>";
      }
      if (s === "approved") {
        return '<section class="card decision"><h3>Hand over the item</h3><p class="small muted">The claimant has been told to collect it from <strong>' + esc(item ? item.storedAt || "the finder" : "the finder") +
          '</strong>. Once they have it, record the hand-over.</p><p class="field-error" id="decision-msg" role="alert">' + esc(message) + '</p>' +
          '<button class="btn btn-primary" type="button" data-act="return">Mark as returned</button></section>';
      }
      const waiting = s === "needs_info" ? '<p class="callout-note small">Waiting for the claimant to reply. You can still approve or reject.</p>' : "";
      return '<section class="card decision"><h3>Decision</h3>' + waiting +
        '<div class="field"><label for="note">Note to the claimant</label><textarea class="textarea" id="note" rows="4" maxlength="500" placeholder="Pickup instructions, the question you need answered, or the reason for rejecting"></textarea>' +
        '<span class="hint">Required for “Ask for info” and “Reject”. Optional for “Approve”. The claimant sees this note.</span></div>' +
        '<p class="field-error" id="decision-msg" role="alert">' + esc(message) + "</p>" +
        '<div class="decision-actions"><button class="btn btn-found" type="button" data-act="approve">Approve claim</button>' +
        (s === "pending" ? '<button class="btn btn-ghost" type="button" data-act="request_info">Ask for info</button>' : "") +
        '<button class="btn btn-ghost btn-danger-ghost" type="button" data-act="reject">Reject claim</button></div></section>';
    }

    function render() {
      const c = CF.claims.find(key);
      if (!c) {
        root.innerHTML = '<div class="coming"><h2>We couldn\'t find that claim</h2><p class="muted">It may have been removed.</p><a class="btn btn-primary" href="claims.html">Back to claims</a></div>';
        return;
      }
      const item = CF.reports.find(c.itemId);
      const who = CF.db.userById(c.claimantId);
      const finder = item ? CF.db.userById(item.reporterId) : null;
      const linked = c.lostReportId ? CF.reports.find(c.lostReportId) : null;
      const hints = CF.admin.verifyHints(c);
      const role = who && CF.ROLES[who.role] ? CF.ROLES[who.role].label : "";
      const otherClaims = who ? CF.db.claims().filter((x) => x.claimantId === who.id && x.id !== c.id).length : 0;

      root.innerHTML =
        '<a class="back-link" href="claims.html">← Claims &amp; Verification</a>' +
        '<div class="verify-head"><div><span class="ref-pill">' + esc(c.ref) + '</span> <span class="badge badge-' + esc(c.status) + ' badge-lg">' + esc(CF.claims.STATUS_LABELS[c.status]) + "</span>" +
        '<h2 class="verify-title">' + esc(item ? item.title : "Removed item") + '</h2><p class="muted">' + esc(item ? item.ref + " · " + item.category : "") + " · submitted " + esc(CF.util.timeAgo(c.createdAt)) + "</p></div></div>" +
        CF.claims.trackerHtml(c, false) +

        '<div class="verify-layout"><div class="verify-main">' +
        '<div class="compare"><section class="card"><h3>What the claimant says</h3><dl class="facts compact">' +
        row("Description", c.description) + row("Contents / marks", c.proofDetails) + row("Lost on", CF.util.formatDate(c.lostDate)) + row("Lost at", c.lostLocation) +
        row("Linked report", linked ? linked.ref + " · " + linked.title : "") + "</dl>" + photos(c.evidence, "Evidence") + "</section>" +
        '<section class="card"><h3>What the finder recorded</h3>' + (item
          ? '<dl class="facts compact">' + row("Public description", item.description) + row("Colour", item.color) + row("Brand", item.brand) +
            row("Private marks", item.identifyingMarks || "(none given)") + row("Found at", item.location + (item.locationDetail ? " — " + item.locationDetail : "") + " · " + CF.util.formatDate(item.dateOccurred)) +
            row("Kept at", item.storedAt) + row("Found by", finder ? finder.name : "") + "</dl>" + (CF.reports.isSafePhoto(item.photo) ? '<ul class="evidence-list static big"><li><img src="' + item.photo + '" alt="Finder\'s photo"></li></ul>' : "")
          : '<p class="muted">This report no longer exists.</p>') + "</section></div>" +

        '<section class="card"><h3>Quick checks</h3><p class="muted small">Automatic comparisons to help you decide. They are hints, not a verdict.</p><ul class="hints">' +
        hints.map((h) => '<li class="hint-' + h.level + '"><span class="hint-mark" role="img" aria-label="' + esc(MARK[h.level][1]) + '">' + MARK[h.level][0] + "</span><span><strong>" + esc(h.label) + ":</strong> " + esc(h.text) + "</span></li>").join("") + "</ul></section>" +
        '<section class="card"><h3>Activity</h3>' + timeline(c) + "</section></div>" +

        '<aside class="verify-side">' + decision(c, item) +
        '<section class="card"><h3>Claimant</h3><dl class="facts compact">' + row("Name", who ? who.name : "Unknown") + row("Role", role) + row("ID number", who && who.idNumber) + row("Email", who && who.email) + row("Mobile", who && who.contact) +
        row("Other claims", String(otherClaims)) + "</dl></section>" +
        (item ? '<a class="btn btn-ghost" href="' + (item.type === "found" ? "found-reports.html" : "lost-reports.html") + "?q=" + encodeURIComponent(item.ref) + '">Open the found report</a>' : "") +
        "</aside></div>";
    }

    root.addEventListener("click", function (ev) {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      const c = CF.claims.find(key);
      if (!c) return;
      const act = b.dataset.act;
      const note = document.getElementById("note") ? document.getElementById("note").value : "";
      if (act === "approve") {
        const rivals = CF.db.claims().filter((x) => x.itemId === c.itemId && x.id !== c.id && ["pending", "needs_info"].indexOf(x.status) >= 0).length;
        if (!window.confirm("Approve " + c.ref + "?" + (rivals ? " " + rivals + " other claim(s) on this item will be closed." : "") + " The claimant will be notified.")) return;
      }
      if (act === "return" && !window.confirm("Mark this item as handed over to its owner?")) return;
      const res = act === "return" ? CF.claims.markReturned(c.id, admin) : CF.claims.review(c.id, act, admin, note);
      if (!res.ok) {
        message = res.message;
        const m = document.getElementById("decision-msg");
        if (m) m.textContent = message;
        return;
      }
      message = "";
      CF.ui.toast({ approve: "Approved. The claimant has been notified.", reject: "Rejected. The claimant has been notified.", request_info: "Question sent to the claimant.", return: "Marked as returned." }[act], "success");
      render();
    });

    render();
  });
})();
