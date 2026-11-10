/* My Reports page controller (Day 2) */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;

  document.addEventListener("cf:ready", function (e) {
    const user = e.detail.user;
    const grid = document.getElementById("reports-grid");
    const search = document.getElementById("q");
    const statusSel = document.getElementById("status-filter");
    const tabs = Array.prototype.slice.call(document.querySelectorAll(".tab[data-filter]"));
    let typeFilter = "all";

    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    function thumb(item) {
      if (CF.reports.isSafePhoto(item.photo)) {
        return '<img src="' + item.photo + '" alt="Photo of ' + esc(item.title) + '" loading="lazy">';
      }
      return '<span class="thumb-ph ' + item.type + '" aria-hidden="true">' + (item.type === "lost" ? "L" : "F") + "</span>";
    }

    function card(item) {
      const url = "item-details.html?id=" + encodeURIComponent(item.id);
      const mc = item.status === "open" && CF.match ? CF.match.candidatesFor(item).length : 0;
      const matchPill = mc
        ? '<a class="match-pill" href="' + url + '#matches">' + mc + " possible match" + (mc === 1 ? "" : "es") + "</a>"
        : "";
      const withdraw =
        item.status === "open"
          ? '<button class="btn btn-ghost btn-sm" type="button" data-withdraw="' + esc(item.id) + '">Withdraw</button>'
          : "";
      return (
        '<article class="report-card">' +
        '<a class="report-thumb" href="' + url + '" tabindex="-1" aria-hidden="true">' + thumb(item) + "</a>" +
        '<div class="report-body">' +
        '<div class="report-top"><span class="badge badge-' + item.type + '">' + (item.type === "lost" ? "Lost" : "Found") + "</span>" +
        '<span class="badge badge-' + item.status + '">' + esc(CF.reports.STATUS_LABELS[item.status] || cap(item.status)) + "</span></div>" +
        '<h3><a href="' + url + '">' + esc(item.title) + "</a></h3>" +
        '<p class="meta">' + esc(item.ref) + " · " + esc(item.category) + "</p>" +
        '<p class="meta">' + esc(item.location) + " · " + esc(CF.util.formatDate(item.dateOccurred)) + "</p>" +
        matchPill +
        "</div>" +
        '<div class="report-actions"><a class="btn btn-primary btn-sm" href="' + url + '">View</a>' + withdraw + "</div>" +
        "</article>"
      );
    }

    function emptyState(all) {
      if (all.length === 0) {
        return (
          '<div class="empty" style="grid-column:1/-1"><h3>No reports yet</h3>' +
          '<p>When you report something lost or found, it will show up here.</p>' +
          '<div class="hero-cta" style="justify-content:center;margin-top:12px">' +
          '<a class="btn btn-lost" href="report-lost.html">Report a lost item</a>' +
          '<a class="btn btn-found" href="report-found.html">Report a found item</a></div></div>'
        );
      }
      return '<div class="empty" style="grid-column:1/-1"><h3>Nothing matches those filters</h3><p>Try a different search or status.</p></div>';
    }

    function render() {
      const all = CF.reports.forUser(user.id);

      // tab counts
      const counts = { all: all.length, lost: 0, found: 0 };
      all.forEach(function (i) { counts[i.type]++; });
      tabs.forEach(function (t) {
        t.querySelector(".count").textContent = counts[t.dataset.filter];
        t.setAttribute("aria-pressed", String(t.dataset.filter === typeFilter));
      });

      const q = search.value.trim().toLowerCase();
      const status = statusSel.value;
      const rows = all.filter(function (i) {
        if (typeFilter !== "all" && i.type !== typeFilter) return false;
        if (status && i.status !== status) return false;
        if (q) {
          const hay = [i.title, i.ref, i.category, i.location, i.description, i.color, i.brand].join(" ").toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
      grid.innerHTML = rows.length ? rows.map(card).join("") : emptyState(all);
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () { typeFilter = t.dataset.filter; render(); });
    });
    search.addEventListener("input", render);
    statusSel.addEventListener("change", render);

    grid.addEventListener("click", function (ev) {
      const btn = ev.target.closest("[data-withdraw]");
      if (!btn) return;
      if (!window.confirm("Withdraw this report? It will no longer be matched or claimed.")) return;
      const res = CF.reports.withdraw(btn.dataset.withdraw, user);
      CF.ui.toast(res.ok ? "Report withdrawn." : res.message, res.ok ? "success" : "error");
      render();
    });

    render();
  });
})();
