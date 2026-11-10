/* My Claims page controller (Day 4) */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;

  document.addEventListener("cf:ready", function (e) {
    const user = e.detail.user;
    const list = document.getElementById("claims-list");
    const tabs = Array.prototype.slice.call(document.querySelectorAll(".tab[data-filter]"));
    let filter = "all";

    const isActive = (c) => c.status === "pending" || c.status === "needs_info" || c.status === "approved";

    function note(claim) {
      if (claim.status === "needs_info") {
        const t = claim.timeline.slice().reverse().find((x) => x.kind === "info_requested");
        return t ? '<p class="claim-note warn"><strong>Action needed:</strong> ' + esc(t.text) + "</p>" : "";
      }
      const t = claim.timeline.slice().reverse().find((x) => ["approved", "rejected", "auto_rejected"].indexOf(x.kind) !== -1);
      if (t && (claim.status === "approved" || claim.status === "rejected")) {
        return '<p class="claim-note ' + (claim.status === "approved" ? "good" : "bad") + '">' + esc(t.text) + "</p>";
      }
      return "";
    }

    function card(claim) {
      const item = CF.reports.find(claim.itemId);
      const url = "claim-details.html?id=" + encodeURIComponent(claim.id);
      return (
        '<article class="card claim-card' + (claim.status === "needs_info" ? " needs-action" : "") + '">' +
        '<div class="claim-top"><div class="claim-item">' +
        '<a class="claim-thumb" href="' + url + '" tabindex="-1" aria-hidden="true">' + (item ? CF.reports.thumbHtml(item) : "") + "</a>" +
        "<div><h3><a href=\"" + url + '">' + esc(item ? item.title : "Item no longer listed") + "</a></h3>" +
        '<p class="meta">' + esc(claim.ref) + (item ? " · " + esc(item.ref) : "") + " · submitted " + esc(CF.util.timeAgo(claim.createdAt)) + "</p></div></div>" +
        '<span class="badge badge-' + esc(claim.status) + '">' + esc(CF.claims.STATUS_LABELS[claim.status]) + "</span></div>" +
        CF.claims.trackerHtml(claim, true) + note(claim) +
        '<div class="claim-actions"><a class="btn btn-primary btn-sm" href="' + url + '">' + (claim.status === "needs_info" ? "Reply now" : "View claim") + "</a></div></article>"
      );
    }

    function render() {
      const all = CF.claims.forUser(user.id);
      const counts = { all: all.length, active: all.filter(isActive).length, closed: all.filter((c) => !isActive(c)).length };
      tabs.forEach(function (t) {
        t.querySelector(".count").textContent = counts[t.dataset.filter];
        t.setAttribute("aria-pressed", String(t.dataset.filter === filter));
      });
      const rows = all
        .filter((c) => filter === "all" || (filter === "active" ? isActive(c) : !isActive(c)))
        // claims that need the user's reply come first
        .sort((a, b) => (b.status === "needs_info") - (a.status === "needs_info") || new Date(b.createdAt) - new Date(a.createdAt));

      if (!rows.length) {
        list.innerHTML = all.length
          ? '<div class="empty"><h3>Nothing here</h3><p>No ' + filter + " claims.</p></div>"
          : '<div class="empty"><h3>No claims yet</h3><p>Found something that looks like yours? Open the item and choose “This is mine — start a claim”.</p>' +
            '<a class="btn btn-primary" href="search.html?type=found">Browse found items</a></div>';
        return;
      }
      list.innerHTML = rows.map(card).join("");
    }

    tabs.forEach((t) => t.addEventListener("click", function () { filter = t.dataset.filter; render(); }));
    render();
  });
})();
