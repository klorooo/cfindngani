/* Admin dashboard: key figures, things that need attention, charts (Chart.js, bundled locally) and latest reports. */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Colour-blind-safe pair (validated): lost = coral, found = blue. Single-series charts use the brand teal.
  const C = { lost: "#c8553d", found: "#2f6fa3", brand: "#0f4c5c", grid: "#e2dccb", tick: "#6b7c8c" };

  document.addEventListener("cf:ready", function (e) {
    const admin = e.detail.user;
    document.getElementById("admin-greeting").textContent = "Hello, " + admin.name.split(" ")[0] + ".";
    const charts = [];

    /* ---------- figures ---------- */
    function renderFigures(st) {
      const t = st.totals;
      const set = (id, v) => { document.getElementById(id).textContent = v; };
      set("kpi-lost", t.openLost); set("kpi-found", t.openFound); set("kpi-claims", t.pendingClaims);
      set("kpi-returned", t.returned); set("kpi-users", t.users);
    }

    function renderLatest() {
      const recent = CF.db.items().slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
      document.getElementById("recent-body").innerHTML = recent.map(function (i) {
        const reporter = CF.db.userById(i.reporterId);
        return "<tr><td>" + esc(i.ref) + '</td><td><span class="badge badge-' + i.type + '">' + (i.type === "lost" ? "Lost" : "Found") + "</span></td>" +
          "<td>" + esc(i.title) + "</td><td>" + esc(i.location) + "</td><td>" + esc(reporter ? reporter.name : "—") + "</td>" +
          '<td><span class="badge badge-' + esc(i.status) + '">' + esc(cap(i.status)) + "</span></td>" +
          "<td>" + esc(CF.util.formatDate(i.createdAt)) + "</td></tr>";
      }).join("");
    }

    /* ---------- attention list ---------- */
    function renderAttention(st) {
      const t = st.totals;
      const rows = [
        [t.pendingClaims, "claim(s) waiting for your review", "claims.html?status=pending", "Review"],
        [t.awaitingReturn, "approved claim(s) waiting to be handed over", "claims.html?status=approved", "Open"],
        [t.needsInfo, "claim(s) waiting for the claimant's reply", "claims.html?status=needs_info", "View"],
        [t.suggestedMatches, "possible match(es) to confirm or dismiss", "matches.html", "Review"],
      ].filter((r) => r[0] > 0);
      const el = document.getElementById("attention");
      el.innerHTML = rows.length
        ? rows.map((r) => '<a class="attn-row" href="' + r[2] + '"><strong>' + r[0] + "</strong><span>" + esc(r[1]) + '</span><span class="attn-go">' + r[3] + " →</span></a>").join("")
        : '<div class="empty">All caught up. Nothing is waiting for you.</div>';
    }

    /* ---------- charts ---------- */
    const table = (head, rows) =>
      '<div class="table-wrap"><table class="table compact"><thead><tr>' + head.map((h, i) => "<th" + (i ? ' class="num"' : "") + ">" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" +
      rows.map((r) => "<tr>" + r.map((c, i) => "<td" + (i ? ' class="num"' : "") + ">" + esc(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";

    function draw(id, config, hasData) {
      const canvas = document.getElementById(id);
      const box = canvas.parentElement;
      box.querySelectorAll(".chart-empty").forEach((n) => n.remove());
      if (!hasData) {
        canvas.hidden = true;
        box.insertAdjacentHTML("beforeend", '<div class="chart-empty">No data yet.</div>');
        return;
      }
      canvas.hidden = false;
      if (typeof window.Chart !== "function") { canvas.hidden = true; box.insertAdjacentHTML("beforeend", '<div class="chart-empty">The chart library didn\'t load. Use "View as table".</div>'); return; }
      try { charts.push(new window.Chart(canvas, config)); }
      catch (err) { canvas.hidden = true; box.insertAdjacentHTML("beforeend", '<div class="chart-empty">This chart couldn\'t be drawn. Use "View as table".</div>'); }
    }

    function baseOptions(extra) {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      return Object.assign({
        responsive: true, maintainAspectRatio: false,
        animation: reduce ? false : { duration: 400 },
        plugins: { legend: { position: "top", align: "start", labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, color: "#3d5266", font: { family: "DM Sans", size: 12 } } }, tooltip: { padding: 10 } },
        scales: {
          x: { grid: { display: false }, ticks: { color: C.tick, font: { family: "DM Sans", size: 11 }, maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.tick, precision: 0, font: { family: "DM Sans", size: 11 } } },
        },
      }, extra || {});
    }

    function renderCharts(st) {
      charts.splice(0).forEach((c) => c.destroy());
      chartDefaults();

      const cats = st.byCategory;
      document.getElementById("chart-category").parentElement.style.height = Math.max(280, cats.length * 46 + 70) + "px";
      draw("chart-category", {
        type: "bar",
        data: { labels: cats.map((c) => c.category), datasets: [
          { label: "Lost", data: cats.map((c) => c.lost), backgroundColor: C.lost, borderRadius: 4, maxBarThickness: 16 },
          { label: "Found", data: cats.map((c) => c.found), backgroundColor: C.found, borderRadius: 4, maxBarThickness: 16 },
        ] },
        options: baseOptions({
          indexAxis: "y",
          scales: {
            x: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.tick, precision: 0, font: { family: "DM Sans", size: 11 } } },
            y: { grid: { display: false }, ticks: { color: "#3d5266", autoSkip: false, font: { family: "DM Sans", size: 12 } } },
          },
        }),
      }, cats.length > 0);
      document.getElementById("table-category").innerHTML = table(["Category", "Lost", "Found"], cats.map((c) => [c.category, c.lost, c.found]));

      const d = st.perDay;
      draw("chart-days", {
        type: "line",
        data: { labels: d.labels, datasets: [
          { label: "Lost", data: d.lost, borderColor: C.lost, backgroundColor: C.lost, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0 },
          { label: "Found", data: d.found, borderColor: C.found, backgroundColor: C.found, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0 },
        ] },
        options: baseOptions({ interaction: { mode: "index", intersect: false } }),
      }, d.lost.concat(d.found).some((n) => n > 0));
      document.getElementById("table-days").innerHTML = table(["Day", "Lost", "Found"], d.labels.map((l, i) => [l, d.lost[i], d.found[i]]));

      const cl = st.claimsByStatus;
      draw("chart-claims", {
        type: "bar",
        data: { labels: cl.map((c) => c.label), datasets: [{ label: "Claims", data: cl.map((c) => c.count), backgroundColor: C.brand, borderRadius: 4, maxBarThickness: 22 }] },
        options: baseOptions({
          indexAxis: "y",
          plugins: { legend: { display: false }, tooltip: { padding: 10 } },
          scales: {
            x: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.tick, precision: 0, font: { family: "DM Sans", size: 11 } } },
            y: { grid: { display: false }, ticks: { color: "#3d5266", font: { family: "DM Sans", size: 12 } } },
          },
        }),
      }, cl.some((c) => c.count > 0));
      document.getElementById("table-claims").innerHTML = table(["Status", "Claims"], cl.map((c) => [c.label, c.count]));

      const r = st.returnRate;
      document.getElementById("rate-num").textContent = r.pct + "%";
      document.getElementById("rate-fill").style.width = r.pct + "%";
      document.getElementById("rate-bar").setAttribute("aria-label", "Return rate " + r.pct + " percent");
      document.getElementById("rate-text").textContent = r.foundTotal
        ? r.returned + " of " + r.foundTotal + " found item" + (r.foundTotal === 1 ? "" : "s") + " returned to their owners."
        : "No found items have been reported yet.";
    }

    function chartDefaults() {
      try { if (typeof window.Chart === "function") { window.Chart.defaults.font.family = "DM Sans"; window.Chart.defaults.color = C.tick; } }
      catch (err) { /* defaults are cosmetic; the charts still draw */ }
    }

    function renderAll() {
      const st = CF.admin.stats(14);
      renderFigures(st); renderAttention(st); renderCharts(st); renderLatest();
    }

    document.getElementById("reset-demo").addEventListener("click", function () {
      if (window.confirm("Reset all demo data? Reports, claims and any accounts you registered will be erased.")) {
        CF.resetDemoData();
        CF.auth.logout();
        window.location.href = "../login.html";
      }
    });

    const sampleBtn = document.getElementById("load-sample");
    if (sampleBtn) sampleBtn.addEventListener("click", function () {
      const res = CF.admin.loadSampleData(admin);
      if (!res.ok) { CF.ui.toast(res.message, "error"); return; }
      CF.ui.toast("Added " + res.added + " sample reports and some claims.", "success");
      renderAll();
    });

    renderAll();
  });
})();
