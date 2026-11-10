/* Landing page controller: live stats, recent items, personalised hero */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;

  function render(user) {
    const items = CF.db.items();
    const openLost = items.filter(function (i) { return i.type === "lost" && i.status === "open"; }).length;
    const openFound = items.filter(function (i) { return i.type === "found" && i.status === "open"; }).length;
    const returned = items.filter(function (i) { return i.status === "returned"; }).length;

    document.getElementById("stat-lost").textContent = openLost;
    document.getElementById("stat-found").textContent = openFound;
    document.getElementById("stat-returned").textContent = returned;

    // hero call-to-action depends on sign-in state
    const cta = document.getElementById("hero-cta");
    if (user) {
      document.getElementById("hero-eyebrow").textContent = "Welcome back, " + user.name.split(" ")[0];
      cta.innerHTML =
        '<a class="btn btn-lost btn-lg" href="report-lost.html">I lost something</a>' +
        '<a class="btn btn-found btn-lg" href="report-found.html">I found something</a>' +
        '<a class="btn btn-ghost btn-lg" href="search.html">Search items</a>';
    } else {
      cta.innerHTML =
        '<a class="btn btn-primary btn-lg" href="register.html">Get started</a>' +
        '<a class="btn btn-ghost btn-lg" href="login.html">Log in</a>';
    }

    if (new URLSearchParams(window.location.search).get("welcome")) {
      CF.ui.toast("Welcome to CampusFind! Your account is ready.", "success");
    }

    // recent items
    const list = document.getElementById("recent-items");
    const recent = items
      .slice()
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })
      .slice(0, 5);
    if (!recent.length) {
      list.innerHTML = '<div class="empty">No items have been reported yet.</div>';
      return;
    }
    list.innerHTML = recent
      .map(function (i) {
        return (
          '<button type="button" class="item-row item-row-link" data-item-id="' + esc(i.id) + '" aria-haspopup="dialog" aria-label="View details for ' + esc(i.title) + '">' +
          '<div class="item-ico ' + i.type + '" aria-hidden="true">' + (i.type === "lost" ? "L" : "F") + "</div>" +
          "<div><h4>" + esc(i.title) + '</h4><div class="meta">' + esc(i.category) + " · " + esc(i.location) + " · " + esc(CF.util.timeAgo(i.createdAt)) + "</div></div>" +
          '<div class="badge-col"><span class="badge badge-' + i.type + '">' + (i.type === "lost" ? "Lost" : "Found") + "</span></div>" +
          "</button>"
        );
      })
      .join("");
    list.onclick = function (e) {
      const btn = e.target.closest("[data-item-id]");
      if (btn) openModal(btn.getAttribute("data-item-id"), user, btn);
    };
  }

  /* ---------- item details modal ---------- */
  let lastFocus = null;

  function fact(label, value) {
    return value ? "<div><dt>" + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>" : "";
  }

  function claimAction(item, user) {
    const claimUrl = "claim-form.html?item=" + encodeURIComponent(item.id);
    if (item.type !== "found") {
      return '<p class="muted small" style="margin:0">This item was reported <strong>lost</strong>. If you found it, tell us so the owner can be reunited with it.</p>' +
        '<a class="btn btn-found btn-block" href="' + (user ? "report-found.html" : "login.html?next=" + encodeURIComponent("report-found.html")) + '">I found this item</a>';
    }
    if (item.status !== "open") {
      return '<div class="alert alert-info">This item is no longer available to claim.</div>';
    }
    if (!user) {
      return '<p class="muted small" style="margin:0">Is this yours? Log in to submit a claim with proof of ownership.</p>' +
        '<a class="btn btn-primary btn-block" href="login.html?next=' + encodeURIComponent(claimUrl) + '">Log in to claim this item</a>' +
        '<a class="btn btn-ghost btn-block" href="register.html">Create an account</a>';
    }
    const el = CF.claims.eligibility(item, user);
    if (el.code === "active") return '<a class="btn btn-primary btn-block" href="claim-details.html?id=' + encodeURIComponent(el.claim.id) + '">View my claim</a>';
    if (el.ok) return '<p class="muted small" style="margin:0">Is this yours? You will be asked to answer a few questions only the owner could answer.</p><a class="btn btn-primary btn-block" href="' + claimUrl + '">This is mine — claim it</a>';
    return '<div class="alert alert-info">' + esc(el.message) + "</div>";
  }

  function closeModal() {
    const m = document.getElementById("item-modal");
    if (!m) return;
    m.remove();
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) {
    if (e.key === "Escape") return closeModal();
    if (e.key !== "Tab") return;
    const m = document.getElementById("item-modal");
    if (!m) return;
    const f = m.querySelectorAll('a[href],button:not([disabled])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openModal(id, user, trigger) {
    const item = CF.reports.find(id);
    if (!item) return;
    closeModal();
    lastFocus = trigger;
    const isLost = item.type === "lost";
    const photo = CF.reports.isSafePhoto(item.photo)
      ? '<img class="detail-photo" src="' + item.photo + '" alt="Photo of ' + esc(item.title) + '">'
      : '<div class="detail-photo ph ' + item.type + '" aria-hidden="true"><span>' + (isLost ? "L" : "F") + "</span><small>No photo provided</small></div>";
    const fullUrl = "item-details.html?id=" + encodeURIComponent(item.id);

    const m = document.createElement("div");
    m.id = "item-modal";
    m.className = "modal-backdrop";
    m.innerHTML =
      '<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
      '<button type="button" class="modal-close" aria-label="Close details">&times;</button>' +
      '<div class="modal-body">' + photo +
      '<div class="report-top"><span class="badge badge-' + item.type + '">' + (isLost ? "Lost" : "Found") + "</span>" +
      '<span class="badge badge-' + item.status + '">' + esc(CF.reports.STATUS_LABELS[item.status] || item.status) + "</span>" +
      '<span class="ref-pill">' + esc(item.ref) + "</span></div>" +
      '<h2 id="modal-title">' + esc(item.title) + "</h2>" +
      '<p class="detail-desc">' + esc(item.description) + "</p>" +
      '<dl class="facts">' +
      fact("Category", item.category) + fact("Colour", item.color) + fact("Brand", item.brand) +
      fact(isLost ? "Last seen at" : "Found at", item.location) + fact("Place details", item.locationDetail) +
      fact(isLost ? "Date lost" : "Date found", CF.util.formatDate(item.dateOccurred)) +
      (!isLost ? fact("Item is now", item.storedAt) : "") +
      fact("Reported", CF.util.timeAgo(item.createdAt)) +
      "</dl>" +
      '<div class="modal-actions">' + claimAction(item, user) +
      (user ? '<a class="modal-more" href="' + fullUrl + '">Open full details page</a>' : "") +
      "</div></div></div>";
    document.body.appendChild(m);
    document.body.classList.add("modal-open");
    m.addEventListener("click", function (e) { if (e.target === m) closeModal(); });
    m.querySelector(".modal-close").addEventListener("click", closeModal);
    document.addEventListener("keydown", onKey);
    m.querySelector(".modal-close").focus();
  }

  document.addEventListener("cf:ready", function (e) { render(e.detail.user); });
})();
