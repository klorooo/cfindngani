/* ==========================================================================
   CampusFind — shared layout (Day 1)
   Renders the navbar / admin sidebar / footer so every page stays in sync.

   Page contract — set these on <body>:
     data-root="../"      relative path to the site root ("" for root pages)
     data-page="home"     key used to highlight the active menu item
     data-area="public"   "public" | "user" | "admin"  (admin pages are guarded)
   ========================================================================== */
(function (global) {
  "use strict";
  const CF = global.CF;
  const esc = CF.util.escapeHtml;

  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    lost: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
    found: '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>',
    matches: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    claims: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    returned: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>',
  };
  const icon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + "</svg>";

  const BRAND_MARK =
    '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.9-4.9M8 10.5l1.8 1.8L13 9"/></svg></span>';

  /* ---------- menus (single source of truth) ---------- */
  const PUBLIC_MENU = [
    { key: "home", label: "Home", href: "index.html" },
    { key: "search", label: "Search Items", href: "search.html" },
  ];
  const USER_MENU = [
    { key: "home", label: "Home", href: "index.html" },
    { key: "report-lost", label: "Report Lost", href: "report-lost.html" },
    { key: "report-found", label: "Report Found", href: "report-found.html" },
    { key: "search", label: "Search Items", href: "search.html" },
    { key: "my-reports", label: "My Reports", href: "my-reports.html" },
    { key: "my-claims", label: "My Claims", href: "my-claims.html" },
  ];
  const ADMIN_MENU = [
    { key: "dashboard", label: "Dashboard", href: "admin/dashboard.html", icon: "dashboard" },
    { key: "lost-reports", label: "Lost Reports", href: "admin/lost-reports.html", icon: "lost" },
    { key: "found-reports", label: "Found Reports", href: "admin/found-reports.html", icon: "found" },
    { key: "matches", label: "Matches", href: "admin/matches.html", icon: "matches" },
    { key: "claims", label: "Claims & Verification", href: "admin/claims.html", icon: "claims" },
    { key: "returned-items", label: "Returned Items", href: "admin/returned-items.html", icon: "returned" },
    { key: "users", label: "Users", href: "admin/users.html", icon: "users" },
  ];

  /* ---------- builders ---------- */
  function navLinks(menu, root, active) {
    return menu
      .map((m) => {
        const cls = "nav-link" + (m.key === active ? " is-active" : "");
        const cur = m.key === active ? ' aria-current="page"' : "";
        return '<a class="' + cls + '" href="' + root + m.href + '"' + cur + ">" + esc(m.label) + "</a>";
      })
      .join("");
  }

  function userMenu(user, root) {
    const role = CF.ROLES[user.role] ? CF.ROLES[user.role].label : user.role;
    return (
      '<details class="user-menu"><summary aria-label="Account menu">' +
      '<span class="avatar" aria-hidden="true">' + esc(CF.util.initials(user.name)) + "</span>" +
      '<span class="u-name">' + esc(user.name.split(" ")[0]) + "</span></summary>" +
      '<div class="menu-panel">' +
      '<div class="who"><strong>' + esc(user.name) + "</strong><span>" + esc(role) + " · " + esc(user.email) + "</span></div>" +
      '<a href="' + root + 'profile.html">Profile</a>' +
      '<button type="button" data-action="logout">Log out</button>' +
      "</div></details>"
    );
  }

  function bellLabel(n) { return "Notifications" + (n ? ", " + n + " unread" : ""); }

  function bellLink(user, root, page) {
    const n = CF.notify.unreadCount(user.id);
    const active = page === "notifications";
    return (
      '<a class="bell-link' + (active ? " is-active" : "") + '" href="' + root + 'notifications.html" aria-label="' + bellLabel(n) + '"' + (active ? ' aria-current="page"' : "") + ">" +
      icon("bell") + '<span class="bell-text">Notifications</span>' +
      '<span class="bell-count"' + (n ? "" : " hidden") + ">" + (n > 99 ? "99+" : n) + "</span></a>"
    );
  }

  /** Refreshes the unread badge in the header (call after reading notifications). */
  function updateBell(user) {
    const link = document.querySelector(".bell-link");
    if (!link || !user) return;
    const n = CF.notify.unreadCount(user.id);
    const badge = link.querySelector(".bell-count");
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = n === 0;
    link.setAttribute("aria-label", bellLabel(n));
    // phones: the bell lives inside the collapsed menu, so flag unread on the menu button too
    const toggle = document.querySelector(".nav-toggle");
    if (toggle) toggle.classList.toggle("has-unread", n > 0);
  }

  function renderHeader(ctx) {
    const { root, page, user } = ctx;
    const menu = user ? USER_MENU : PUBLIC_MENU;
    let right = "";
    if (user) {
      right = '<span class="nav-sep" aria-hidden="true"></span>' + (user.role === "admin" ? "" : bellLink(user, root, page)) + userMenu(user, root);
    } else {
      right =
        '<span class="nav-sep" aria-hidden="true"></span>' +
        navLinks([{ key: "login", label: "Log in", href: "login.html" }], root, page) +
        '<a class="btn btn-primary" href="' + root + 'register.html" style="margin-left:6px">Create account</a>';
    }
    return (
      '<header class="site-header"><div class="container header-inner">' +
      '<a class="brand" href="' + root + 'index.html" aria-label="CampusFind home">' + BRAND_MARK +
      '<span class="brand-name">Campus<em>Find</em></span></a>' +
      '<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-nav" aria-label="Toggle menu">' + icon("menu") + "</button>" +
      '<nav id="primary-nav" class="primary-nav" aria-label="Main">' + navLinks(menu, root, page) + right + "</nav>" +
      "</div></header>"
    );
  }

  function renderSidebar(ctx) {
    const { root, page, user } = ctx;
    const links = ADMIN_MENU.map((m) => {
      const active = m.key === page;
      return (
        '<a class="side-link' + (active ? " is-active" : "") + '" href="' + root + m.href + '"' +
        (active ? ' aria-current="page"' : "") + ">" + icon(m.icon) + "<span>" + esc(m.label) + "</span></a>"
      );
    }).join("");
    return (
      '<a class="brand" href="' + root + 'admin/dashboard.html">' + BRAND_MARK + '<span class="brand-name">Campus<em>Find</em></span></a>' +
      '<div class="side-label">Administration</div>' + links +
      '<div class="side-foot"><strong>' + esc(user.name) + "</strong>" + esc(user.email) +
      '<button class="btn btn-ghost btn-block" type="button" data-action="logout" style="color:#fff;border-color:rgba(255,255,255,.35)">' +
      icon("logout").replace("<svg", '<svg style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2"') + " Log out</button></div>"
    );
  }

  function renderFooter(root) {
    return (
      '<footer class="site-footer"><div class="container footer-inner">' +
      "<div><strong>CampusFind</strong><br>Lost &amp; Found for the University of Rizal System Binangonan community.</div>" +
      '<div>Prototype build · <a href="' + root + 'index.html">Home</a></div>' +
      "</div></footer>"
    );
  }

  /* ---------- mount ---------- */
  function mount() {
    const body = document.body;
    const root = body.dataset.root || "";
    const page = body.dataset.page || "";
    const area = body.dataset.area || "public";

    let user = CF.auth.currentUser();

    // guards
    if (area === "admin") {
      user = CF.auth.requireRole(["admin"], root);
      if (!user) return;
    } else if (area === "user") {
      user = CF.auth.requireRole("any", root);
      if (!user) return;
      if (CF.auth.isAdmin(user)) { global.location.replace(CF.auth.homeFor(user, root)); return; }
    }

    const ctx = { root, page, user };

    if (area === "admin") {
      const side = document.getElementById("cf-sidebar");
      if (side) side.innerHTML = renderSidebar(ctx);
    } else {
      const head = document.getElementById("cf-header");
      if (head) head.outerHTML = renderHeader(ctx);
      const foot = document.getElementById("cf-footer");
      if (foot) foot.outerHTML = renderFooter(root);
    }

    // events
    document.addEventListener("click", function (e) {
      const t = e.target.closest("[data-action], .nav-toggle, .side-toggle");
      if (t && t.dataset.action === "logout") {
        CF.auth.logout();
        global.location.href = root + "login.html?loggedout=1";
        return;
      }
      if (t && t.classList.contains("nav-toggle")) {
        const nav = document.getElementById("primary-nav");
        const open = nav.classList.toggle("is-open");
        t.setAttribute("aria-expanded", String(open));
        return;
      }
      if (t && t.classList.contains("side-toggle")) {
        const sb = document.getElementById("cf-sidebar");
        sb.classList.toggle("is-open");
        return;
      }
      // close dropdown / mobile sidebar when clicking elsewhere
      const menu = document.querySelector(".user-menu[open]");
      if (menu && !e.target.closest(".user-menu")) menu.removeAttribute("open");
      const sb = document.getElementById("cf-sidebar");
      if (sb && sb.classList.contains("is-open") && !e.target.closest("#cf-sidebar")) sb.classList.remove("is-open");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const menu = document.querySelector(".user-menu[open]");
      if (menu) menu.removeAttribute("open");
      const nav = document.getElementById("primary-nav");
      if (nav) nav.classList.remove("is-open");
    });

    /* Accessibility: skip link, main landmark id, keyboard-focusable scrolling tables */
    const mainEl = document.querySelector("main");
    if (mainEl) {
      if (!mainEl.id) mainEl.id = "main";
      mainEl.setAttribute("tabindex", "-1");
      if (!document.querySelector(".skip-link")) {
        const a = document.createElement("a");
        a.className = "skip-link"; a.href = "#" + mainEl.id; a.textContent = "Skip to main content";
        a.addEventListener("click", function () { mainEl.focus(); });
        document.body.insertBefore(a, document.body.firstChild);
      }
    }
    const markScrollers = function () {
      document.querySelectorAll(".table-wrap:not([tabindex])").forEach(function (w) {
        w.setAttribute("tabindex", "0"); w.setAttribute("role", "region");
        if (!w.getAttribute("aria-label")) w.setAttribute("aria-label", "Table, scrolls sideways");
      });
    };
    markScrollers();
    if (window.MutationObserver) new MutationObserver(markScrollers).observe(document.body, { childList: true, subtree: true });

    if (user && user.role !== "admin") updateBell(user);
    document.dispatchEvent(new CustomEvent("cf:ready", { detail: { user } }));
  }

  CF.layout = { mount, updateBell, ADMIN_MENU, USER_MENU, PUBLIC_MENU };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})(window);
