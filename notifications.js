/* Notifications page controller (Day 4) */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;

  // notification links are same-site pages only (optionally with ?query and #anchor)
  const SAFE_LINK = /^[\w\-/]+\.html(\?[\w\-=&%.]*)?(#[\w\-]*)?$/;
  const ICON = { match: "◎", claim_submitted: "✉", claim_reply: "✉", claim_info_requested: "?", claim_approved: "✓", claim_rejected: "✕", claim_returned: "✓", info: "i" };
  const TONE = { match: "amber", claim_info_requested: "warn", claim_approved: "good", claim_returned: "good", claim_rejected: "bad" };

  document.addEventListener("cf:ready", function (e) {
    const user = e.detail.user;
    const list = document.getElementById("notif-list");
    const markAll = document.getElementById("mark-all");

    function render() {
      const items = CF.notify.forUser(user.id);
      const unread = items.filter((n) => !n.read).length;
      markAll.hidden = unread === 0;
      if (!items.length) {
        list.innerHTML = '<div class="empty"><h3>You\'re all caught up</h3><p>Match alerts and claim updates will appear here.</p></div>';
        return;
      }
      list.innerHTML = items
        .map(function (n) {
          const link = SAFE_LINK.test(n.link) ? n.link : "";
          const inner =
            '<span class="notif-ico tone-' + (TONE[n.type] || "info") + '" aria-hidden="true">' + (ICON[n.type] || "i") + "</span>" +
            '<span class="notif-body"><strong>' + esc(n.title) + (n.read ? "" : ' <span class="sr-only">(unread)</span>') + "</strong>" +
            "<span>" + esc(n.body) + '</span><small class="muted">' + esc(CF.util.timeAgo(n.createdAt)) + "</small></span>" +
            (n.read ? "" : '<span class="unread-dot" aria-hidden="true"></span>');
          return link
            ? '<a class="notif' + (n.read ? "" : " unread") + '" href="' + link + '" data-id="' + esc(n.id) + '">' + inner + "</a>"
            : '<div class="notif' + (n.read ? "" : " unread") + '" data-id="' + esc(n.id) + '">' + inner + "</div>";
        })
        .join("");
    }

    // opening a notification marks it read (before the browser follows the link)
    list.addEventListener("click", function (ev) {
      const el = ev.target.closest(".notif[data-id]");
      if (!el) return;
      if (CF.notify.markRead(el.dataset.id, user.id)) CF.layout.updateBell(user);
    });
    markAll.addEventListener("click", function () {
      const n = CF.notify.markAllRead(user.id);
      CF.layout.updateBell(user);
      if (n) CF.ui.toast(n + " notification" + (n === 1 ? "" : "s") + " marked as read.", "success");
      render();
    });

    render();
  });
})();
