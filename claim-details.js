/* Claim details page controller (Day 4): tracker, proof, timeline, reply and cancel. */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const rootEl = document.getElementById("claim-detail-root");

  const KIND = {
    submitted: "Claim submitted",
    info_requested: "Administrator asked for more information",
    reply: "You replied",
    approved: "Claim approved",
    rejected: "Claim rejected",
    auto_rejected: "Claim closed",
    cancelled: "Claim cancelled",
    returned: "Item returned",
  };
  const WHO = { claimant: "You", admin: "Administrator", system: "CampusFind" };

  function notFound() {
    rootEl.innerHTML =
      '<div class="coming"><span class="pill">Not found</span><h1 style="font-size:2rem">We couldn\'t find that claim</h1>' +
      '<p class="muted">It may not exist, or it belongs to someone else.</p><a class="btn btn-primary" href="my-claims.html">Go to My Claims</a></div>';
  }

  const row = (label, value) => (value ? "<div><dt>" + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>" : "");
  const photos = (list) =>
    list && list.length
      ? '<ul class="evidence-list static">' + list.filter((p) => CF.reports.isSafePhoto(p)).map((p, i) => '<li><img src="' + p + '" alt="Evidence photo ' + (i + 1) + '"></li>').join("") + "</ul>"
      : "";

  function lastNote(claim, kinds) {
    for (let i = claim.timeline.length - 1; i >= 0; i--) if (kinds.indexOf(claim.timeline[i].kind) !== -1) return claim.timeline[i];
    return null;
  }

  function statusPanel(claim, item, user) {
    const s = claim.status;
    if (s === "needs_info") {
      const req = lastNote(claim, ["info_requested"]);
      return (
        '<section class="card callout callout-warn" id="reply-panel"><h3>The administrator needs more information</h3>' +
        '<blockquote class="quote">' + esc(req ? req.text : "") + "</blockquote>" +
        '<form id="reply-form" class="form" novalidate><div id="reply-alert" class="alert alert-error" role="alert" hidden></div>' +
        '<div class="field"><label for="reply-text">Your reply</label>' +
        '<textarea class="textarea" id="reply-text" rows="3" maxlength="500" placeholder="Answer the question above as specifically as you can."></textarea>' +
        '<div class="field-error" aria-live="polite"></div></div>' +
        '<div class="field"><div class="photo-drop"><input type="file" id="reply-photo" accept="image/jpeg,image/png,image/webp" class="sr-only">' +
        '<label for="reply-photo" class="photo-label" id="reply-photo-label"><strong>Attach a photo</strong><span class="muted">Optional</span></label>' +
        '<div class="photo-preview" id="reply-preview" hidden><img alt="Attached photo preview"><button class="btn btn-ghost" type="button" id="reply-remove">Remove photo</button></div></div>' +
        '<div class="field-error" id="reply-photo-error" aria-live="polite"></div></div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit" id="reply-btn">Send reply</button></div></form></section>'
      );
    }
    if (s === "approved") {
      const note = lastNote(claim, ["approved"]);
      return (
        '<section class="card callout callout-good"><h3>Your claim was approved</h3>' +
        "<p>" + esc(note ? note.text : "") + "</p>" +
        (item && item.storedAt ? '<p><strong>Where to collect:</strong> ' + esc(item.storedAt) + "</p>" : "") +
        '<p class="muted" style="margin:0">Bring a valid school or employee ID so staff can confirm it\'s you.</p></section>'
      );
    }
    if (s === "rejected") {
      const note = lastNote(claim, ["rejected", "auto_rejected"]);
      const again = item && CF.claims.eligibility(item, user).ok;
      return (
        '<section class="card callout callout-bad"><h3>This claim wasn\'t approved</h3>' +
        "<p>" + esc(note ? note.text : "") + "</p>" +
        (again ? '<a class="btn btn-primary" href="claim-form.html?item=' + encodeURIComponent(item.id) + '">Submit a new claim with more evidence</a>' : '<p class="muted" style="margin:0">Visit the administration office if you think this is a mistake.</p>') +
        "</section>"
      );
    }
    if (s === "returned") return '<section class="card callout callout-good"><h3>Item returned</h3><p style="margin:0">This item has been handed back to you. Thank you for using CampusFind!</p></section>';
    if (s === "cancelled") return '<section class="card callout"><h3>You cancelled this claim</h3><p class="muted" style="margin:0">You can submit a new claim if the item is still available.</p></section>';
    return '<section class="card callout"><h3>Waiting for review</h3><p class="muted" style="margin:0">An administrator will check your answers. You\'ll get a notification as soon as something changes.</p></section>';
  }

  function timelineHtml(claim) {
    return (
      '<ol class="timeline">' +
      claim.timeline.map(function (t) {
        return (
          '<li class="tl-' + esc(t.kind) + '"><span class="tl-dot" aria-hidden="true"></span><div class="tl-body">' +
          '<div class="tl-head"><strong>' + esc(KIND[t.kind] || t.kind) + '</strong><span class="muted">' + esc(WHO[t.byRole] || "") + " · " + esc(CF.util.timeAgo(t.at)) + "</span></div>" +
          (t.text && t.kind !== "submitted" ? "<p>" + esc(t.text) + "</p>" : "") + photos(t.photos) + "</div></li>"
        );
      }).join("") + "</ol>"
    );
  }

  function render(user) {
    const params = new URLSearchParams(window.location.search);
    const claim = CF.claims.find(params.get("id") || params.get("ref"));
    if (!claim || claim.claimantId !== user.id) return notFound();
    const item = CF.reports.find(claim.itemId);
    document.title = "Claim " + claim.ref + " — CampusFind";

    const created = params.get("created")
      ? '<div class="alert alert-success created-banner" role="status"><strong>Claim submitted.</strong> Your reference number is <span class="ref-pill">' + esc(claim.ref) + "</span>. An administrator will review it soon.</div>"
      : "";
    const linked = claim.lostReportId ? CF.reports.find(claim.lostReportId) : null;
    const active = CF.claims.ACTIVE.indexOf(claim.status) !== -1;

    rootEl.innerHTML =
      '<a class="back-link" href="my-claims.html">← My Claims</a>' + created +
      '<div class="page-head"><div><p class="eyebrow">Claim</p><h1><span class="ref-pill ref-lg">' + esc(claim.ref) + "</span></h1></div>" +
      '<span class="badge badge-' + esc(claim.status) + ' badge-lg">' + esc(CF.claims.STATUS_LABELS[claim.status]) + "</span></div>" +
      '<section class="card" aria-label="Progress">' + CF.claims.trackerHtml(claim, false) + "</section>" +
      statusPanel(claim, item, user) +
      '<div class="detail-layout" style="margin-top:20px"><div>' +

      '<article class="card"><h3>Your proof</h3><p class="muted small">Only you and administrators can see this.</p>' +
      '<dl class="facts proof-facts">' +
      row("Your description", claim.description) + row("Contents / marks", claim.proofDetails) +
      row("Lost on", CF.util.formatDate(claim.lostDate)) + row("Lost at", claim.lostLocation) +
      (linked ? '<div><dt>Linked report</dt><dd><a href="item-details.html?id=' + encodeURIComponent(linked.id) + '">' + esc(linked.ref + " · " + linked.title) + "</a></dd></div>" : "") +
      "</dl>" + photos(claim.evidence) + "</article>" +

      '<article class="card" style="margin-top:20px"><h3>Activity</h3>' + timelineHtml(claim) + "</article>" +
      "</div>" +

      '<aside class="card detail-side"><h3>The item</h3>' +
      (item
        ? '<div class="claim-item-thumb">' + CF.reports.thumbHtml(item) + '</div><div class="report-top"><span class="badge badge-found">Found</span><span class="badge badge-' + esc(item.status) + '">' + esc(CF.reports.STATUS_LABELS[item.status] || item.status) + "</span></div>" +
          "<h4>" + esc(item.title) + "</h4>" +
          '<p class="meta">' + esc(item.ref) + " · " + esc(item.category) + "</p>" +
          '<p class="meta">Found at ' + esc(item.location) + " on " + esc(CF.util.formatDate(item.dateOccurred)) + "</p>" +
          '<a class="btn btn-ghost btn-block" href="item-details.html?id=' + encodeURIComponent(item.id) + '" style="margin-top:12px">View listing</a>'
        : '<p class="muted">This item is no longer listed.</p>') +
      (active ? '<button class="btn btn-ghost btn-block" type="button" id="cancel-btn" style="margin-top:10px">Cancel this claim</button>' : "") +
      "</aside></div>";

    if (params.get("created")) CF.ui.toast("Claim " + claim.ref + " submitted.", "success");

    const cancel = document.getElementById("cancel-btn");
    if (cancel) {
      cancel.addEventListener("click", function () {
        if (!window.confirm("Cancel this claim? You can file a new one later if the item is still available.")) return;
        const res = CF.claims.cancel(claim.id, user);
        CF.ui.toast(res.ok ? "Claim cancelled." : res.message, res.ok ? "success" : "error");
        if (res.ok) { window.history.replaceState(null, "", "claim-details.html?id=" + encodeURIComponent(claim.id)); render(user); }
      });
    }

    const form = document.getElementById("reply-form");
    if (form) {
      let photo = null, busy = false;
      const input = document.getElementById("reply-photo");
      const preview = document.getElementById("reply-preview");
      const label = document.getElementById("reply-photo-label");
      const photoError = document.getElementById("reply-photo-error");
      const btn = document.getElementById("reply-btn");
      const textarea = document.getElementById("reply-text");
      const field = textarea.closest(".field");

      function setPhoto(data) {
        photo = data;
        preview.hidden = !data; label.hidden = !!data;
        if (data) preview.querySelector("img").src = data; else input.value = "";
      }
      input.addEventListener("change", function () {
        photoError.textContent = "";
        const f = input.files && input.files[0];
        if (!f) return;
        busy = true; btn.disabled = true;
        CF.reports.compressImage(f, CF.claims.EVIDENCE_OPTS).then(
          function (d) { busy = false; btn.disabled = false; setPhoto(d); },
          function (err) { busy = false; btn.disabled = false; input.value = ""; photoError.textContent = err.message; }
        );
      });
      document.getElementById("reply-remove").addEventListener("click", function () { setPhoto(null); });

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (busy) return;
        const alertBox = document.getElementById("reply-alert");
        alertBox.hidden = true;
        const res = CF.claims.reply(claim.id, { text: textarea.value, photos: photo ? [photo] : [] }, user);
        field.classList.toggle("has-error", !!(res.errors && res.errors.text));
        field.querySelector(".field-error").textContent = (res.errors && res.errors.text) || "";
        photoError.textContent = (res.errors && res.errors.photo) || "";
        if (!res.ok) {
          if (res.message) { alertBox.textContent = res.message; alertBox.hidden = false; }
          return;
        }
        CF.ui.toast("Reply sent. An administrator will take another look.", "success");
        render(user);
      });
    }
  }

  document.addEventListener("cf:ready", function (e) { render(e.detail.user); });
})();
