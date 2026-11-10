/* Item details page controller (Day 2) */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const rootEl = document.getElementById("detail-root");

  function row(label, value) {
    if (!value) return "";
    return "<div><dt>" + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>";
  }

  function notFound() {
    rootEl.innerHTML =
      '<div class="coming"><span class="pill">Not found</span><h1 style="font-size:2rem">We couldn\'t find that report</h1>' +
      '<p class="muted">It may have been removed, or the link is incorrect.</p>' +
      '<a class="btn btn-primary" href="my-reports.html">Go to My Reports</a></div>';
  }

  function matchRow(m) {
    const it = m.item;
    const url = "item-details.html?id=" + encodeURIComponent(it.id);
    return (
      '<li class="match-item">' +
      '<a class="match-thumb" href="' + url + '" tabindex="-1" aria-hidden="true">' + CF.reports.thumbHtml(it) + "</a>" +
      '<div class="match-info"><div class="report-top"><span class="badge badge-' + it.type + '">' + (it.type === "lost" ? "Lost" : "Found") + "</span>" +
      '<span class="tier tier-' + m.tier + '">' + esc(m.label) + "</span>" + (m.confirmed ? ' <span class="badge badge-approved">Confirmed by an administrator</span>' : "") + "</div>" +
      '<h4><a href="' + url + '">' + esc(it.title) + "</a></h4>" +
      '<p class="meta">' + esc(it.ref) + " · " + esc(it.location) + " · " + esc(CF.util.formatDate(it.dateOccurred)) + "</p>" +
      '<ul class="reason-chips">' + m.reasons.map((r) => "<li>" + esc(r) + "</li>").join("") + "</ul></div>" +
      '<div class="match-score"><strong>' + m.score + '%</strong>' +
      '<div class="meter" role="img" aria-label="Match score ' + m.score + ' out of 100"><span style="width:' + m.score + '%"></span></div>' +
      '<a class="btn btn-primary btn-sm" href="' + url + '">View</a></div>' +
      "</li>"
    );
  }

  function renderMatches(item, matches) {
    if (item.status !== "open" && item.status !== "matched") return "";
    const other = item.type === "lost" ? "found" : "lost";
    const head =
      '<div class="matches-head"><h3>Possible matches</h3>' +
      (matches.length ? '<span class="badge badge-matched">' + matches.length + " found</span>" : "") + "</div>";
    if (!matches.length) {
      const browse = "search.html?type=" + other + "&category=" + encodeURIComponent(item.category);
      return (
        '<section class="card matches-card" id="matches">' + head +
        '<p class="muted" style="margin:0">No likely matches yet. We check again whenever someone reports a new ' + other +
        ' item, so come back later — or <a href="' + browse + '">browse ' + other + " items in this category</a>.</p></section>"
      );
    }
    return (
      '<section class="card matches-card" id="matches">' + head +
      '<p class="muted small">Suggested from category, name, place, date and colour. These are suggestions only — an administrator verifies every return.</p>' +
      '<ul class="match-list">' + matches.map(matchRow).join("") + "</ul></section>"
    );
  }

  function render(user) {
    const params = new URLSearchParams(window.location.search);
    const item = CF.reports.find(params.get("id") || params.get("ref"));
    if (!item) return notFound();

    document.title = item.title + " — CampusFind";
    const isOwner = user.id === item.reporterId;
    const priv = CF.reports.canSeePrivate(item, user);
    const reporter = CF.reports.reporterOf(item);
    const isLost = item.type === "lost";

    // match suggestions are only shown to the person who filed the report
    let matches = [];
    if (isOwner && CF.match) {
      CF.match.sync(item);
      matches = CF.match.candidatesFor(item);
    }
    const matchNote = matches.length
      ? ' We found <a href="#matches"><strong>' + matches.length + " possible match" + (matches.length === 1 ? "" : "es") + "</strong></a> already."
      : "";

    const banner =
      params.get("created") && isOwner
        ? '<div class="alert alert-success created-banner" role="status"><strong>Report submitted.</strong> Your reference number is ' +
          '<span class="ref-pill">' + esc(item.ref) + "</span>. Keep it for follow-ups." + matchNote + "</div>"
        : "";

    const photo = CF.reports.isSafePhoto(item.photo)
      ? '<img class="detail-photo" src="' + item.photo + '" alt="Photo of ' + esc(item.title) + '">'
      : '<div class="detail-photo ph ' + item.type + '" aria-hidden="true"><span>' + (isLost ? "L" : "F") + "</span><small>No photo provided</small></div>";

    const marks =
      priv && item.identifyingMarks
        ? '<div class="private-box"><strong>Identifying marks</strong><p>' + esc(item.identifyingMarks) + '</p><small>Private — only you and administrators can see this.</small></div>'
        : "";

    let contact;
    if (priv && reporter) {
      contact = row("Contact", reporter.contact) + row("Email", reporter.email);
    } else {
      contact = '<div><dt>Contact</dt><dd class="muted">Private. Administrators will connect you once a claim is verified.</dd></div>';
    }

    // actions
    let actions = "";
    if (isOwner && item.status === "open") {
      actions += '<button class="btn btn-ghost btn-block" type="button" id="withdraw-btn">Withdraw this report</button>';
    } else if (!isOwner && item.type === "found") {
      const claimUrl = "claim-form.html?item=" + encodeURIComponent(item.id);
      if (!CF.claims) {
        if (item.status === "open") actions += '<a class="btn btn-primary btn-block" href="' + claimUrl + '">This is mine — start a claim</a>';
      } else {
        const el = CF.claims.eligibility(item, user);
        if (el.code === "active") {
          actions += '<a class="btn btn-primary btn-block" href="claim-details.html?id=' + encodeURIComponent(el.claim.id) + '">View my claim · ' + esc(CF.claims.STATUS_LABELS[el.claim.status]) + "</a>";
        } else if (el.ok) {
          actions += '<a class="btn btn-primary btn-block" href="' + claimUrl + '">This is mine — start a claim</a>';
        } else if (el.code === "limit") {
          actions += '<div class="alert alert-info">' + esc(el.message) + "</div>";
        }
      }
    } else if (!isOwner && item.status === "open") {
      actions += '<a class="btn btn-found btn-block" href="report-found.html">I found this item</a>';
    }
    // the finder is told (without names) when someone has claimed their item
    if (isOwner && item.type === "found" && CF.claims) {
      const live = CF.claims.forItem(item.id).filter((c) => c.status === "pending" || c.status === "needs_info" || c.status === "approved");
      if (live.length) {
        actions += '<div class="alert alert-info">' + (live.length === 1 ? "Someone has" : live.length + " people have") +
          " claimed this item. An administrator is checking, and will contact you if they need anything.</div>";
      }
    }
    if (item.status === "withdrawn") actions += '<div class="alert alert-info">This report was withdrawn' + (item.withdrawnAt ? " on " + esc(CF.util.formatDate(item.withdrawnAt)) : "") + ".</div>";

    const back = isOwner ? '<a class="back-link" href="my-reports.html">← My Reports</a>' : '<a class="back-link" href="index.html">← Home</a>';

    const matchesCard = isOwner ? renderMatches(item, matches) : "";

    rootEl.innerHTML =
      back + banner +
      '<div class="detail-layout">' +
      '<div><article class="card detail-main">' + photo +
      '<div class="detail-title"><div class="report-top"><span class="badge badge-' + item.type + '">' + (isLost ? "Lost" : "Found") + "</span>" +
      '<span class="badge badge-' + item.status + '">' + esc(CF.reports.STATUS_LABELS[item.status] || item.status) + "</span></div>" +
      "<h1>" + esc(item.title) + "</h1></div>" +
      '<p class="detail-desc">' + esc(item.description) + "</p>" +
      '<dl class="facts">' +
      row("Category", item.category) + row("Colour", item.color) + row("Brand", item.brand) +
      row(isLost ? "Last seen at" : "Found at", item.location) + row("Place details", item.locationDetail) +
      row(isLost ? "Date lost" : "Date found", CF.util.formatDate(item.dateOccurred)) +
      (item.type === "found" ? row("Item is now", item.storedAt) : "") +
      "</dl>" + marks + "</article>" + matchesCard + "</div>" +

      '<aside class="card detail-side"><h3>Report info</h3><dl class="facts">' +
      '<div><dt>Reference</dt><dd><span class="ref-pill">' + esc(item.ref) + "</span></dd></div>" +
      row("Reported", CF.util.formatDate(item.createdAt) + " (" + CF.util.timeAgo(item.createdAt) + ")") +
      row("Reported by", reporter ? reporter.name + " · " + (CF.ROLES[reporter.role] ? CF.ROLES[reporter.role].label : reporter.role) : "Unknown") +
      contact + "</dl>" +
      '<div class="side-actions">' + actions + "</div></aside>" +
      "</div>";

    if (params.get("created") && isOwner) CF.ui.toast("Report " + item.ref + " saved.", "success");

    const w = document.getElementById("withdraw-btn");
    if (w) {
      w.addEventListener("click", function () {
        if (!window.confirm("Withdraw this report? It will no longer be matched or claimed.")) return;
        const res = CF.reports.withdraw(item.id, user);
        if (res.ok) { CF.ui.toast("Report withdrawn.", "success"); render(user); }
        else CF.ui.toast(res.message, "error");
      });
    }
  }

  document.addEventListener("cf:ready", function (e) { render(e.detail.user); });
})();
