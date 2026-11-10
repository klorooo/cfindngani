/* ==========================================================================
   CampusFind — admin logic (Day 5)
   Everything the admin screens do lives here so it can be tested without a page:
   statistics, removing/restoring reports, confirming/dismissing matches, linking a
   match by hand, claim verification hints, user accounts and CSV export.
   Needs: app.js, reports.js, claims.js, search-match.js (loaded before this file).
   ========================================================================== */
(function (global) {
  "use strict";
  const CF = global.CF;
  const text = (v) => String(v == null ? "" : v).trim();
  const isAdmin = (u) => !!u && u.role === "admin";
  const NOT_ADMIN = { ok: false, message: "Only administrators can do that." };
  const STORAGE_FULL = { ok: false, message: "Your browser's storage is full, so this change wasn't saved." };

  const LIVE = ["open", "matched"];
  const ACTIVE_CLAIM = ["pending", "needs_info", "approved"];
  const find = (id) => CF.db.items().find((i) => i.id === id) || null;

  const admin = {};

  /* ---------- statistics (dashboard) ---------- */
  admin.stats = function (days) {
    days = days || 14;
    const items = CF.db.items(), claims = CF.db.claims(), matches = CF.db.matches();
    const real = items.filter((i) => i.status !== "withdrawn");

    const cats = {};
    real.forEach((i) => {
      const c = cats[i.category] || (cats[i.category] = { category: i.category, lost: 0, found: 0 });
      c[i.type]++;
    });
    const byCategory = Object.values(cats).sort((a, b) => b.lost + b.found - (a.lost + a.found) || a.category.localeCompare(b.category));

    const labels = [], keys = [], lost = [], found = [];
    for (let n = days - 1; n >= 0; n--) {
      const iso = CF.util.daysAgoISO(n);
      keys.push(CF.util.toDayStr(iso));
      labels.push(CF.util.formatDate(iso).replace(/,\s*\d{4}$/, ""));
      lost.push(0); found.push(0);
    }
    real.forEach((i) => {
      const k = keys.indexOf(CF.util.toDayStr(i.createdAt));
      if (k >= 0) (i.type === "lost" ? lost : found)[k]++;
    });

    const order = ["pending", "needs_info", "approved", "returned", "rejected", "cancelled"];
    const claimsByStatus = order.map((s) => ({ status: s, label: CF.claims.STATUS_LABELS[s], count: claims.filter((c) => c.status === s).length }));

    const foundTotal = real.filter((i) => i.type === "found").length;
    const returned = real.filter((i) => i.type === "found" && i.status === "returned").length;
    const liveSuggestions = admin.matchRows().filter((r) => r.state === "suggested").length;

    return {
      totals: {
        openLost: items.filter((i) => i.type === "lost" && i.status === "open").length,
        openFound: items.filter((i) => i.type === "found" && i.status === "open").length,
        pendingClaims: claims.filter((c) => c.status === "pending").length,
        needsInfo: claims.filter((c) => c.status === "needs_info").length,
        awaitingReturn: claims.filter((c) => c.status === "approved").length,
        returned: items.filter((i) => i.type === "found" && i.status === "returned").length, // one hand-over = one item, even when a lost report is linked
        users: CF.db.users().filter((u) => u.role !== "admin").length,
        suggestedMatches: liveSuggestions,
        confirmedMatches: matches.filter((m) => m.status === "confirmed").length,
      },
      byCategory,
      perDay: { labels, lost, found },
      claimsByStatus,
      returnRate: { returned, foundTotal, pct: foundTotal ? Math.round((returned / foundTotal) * 100) : 0 },
    };
  };

  /* ---------- helpers for match bookkeeping ---------- */
  /** After a match is undone or an item removed, items that are no longer part of any live confirmed match go back to "open". */
  function settleStatuses(ids) {
    const items = CF.db.items(), matches = CF.db.matches();
    let changed = false;
    ids.forEach((id) => {
      const it = items.find((i) => i.id === id);
      if (!it || it.status !== "matched") return;
      const stillMatched = matches.some((m) => m.status === "confirmed" && (m.lostId === id || m.foundId === id) &&
        [m.lostId, m.foundId].every((x) => { const o = items.find((i) => i.id === x); return o && (o.status === "matched" || o.status === "open"); }));
      if (!stillMatched) { it.status = "open"; changed = true; }
    });
    return changed ? CF.db.saveItems(items) : true;
  }

  /* ---------- reports ---------- */
  admin.removeReport = function (itemId, adminUser, reason) {
    if (!isAdmin(adminUser)) return NOT_ADMIN;
    const items = CF.db.items();
    const it = items.find((i) => i.id === itemId);
    if (!it) return { ok: false, message: "Report not found." };
    if (it.status === "withdrawn") return { ok: false, message: "This report is already removed." };
    if (it.status === "claimed" || it.status === "returned") return { ok: false, message: "This item has already been claimed, so its report can't be removed." };
    const why = text(reason);
    if (why.length < 5) return { ok: false, message: "Give a short reason (at least 5 characters). The reporter will see it." };
    if (it.type === "found" && CF.db.claims().some((c) => c.itemId === it.id && ACTIVE_CLAIM.indexOf(c.status) >= 0)) {
      return { ok: false, message: "This item has a claim in progress. Resolve the claim first." };
    }
    const before = JSON.stringify(items);
    it.status = "withdrawn"; it.removedByAdmin = true; it.removedReason = why.slice(0, 200); it.removedAt = new Date().toISOString();
    if (!CF.db.saveItems(items)) { CF.db.saveItems(JSON.parse(before)); return STORAGE_FULL; }
    settleStatuses(CF.db.matches().filter((m) => m.lostId === it.id || m.foundId === it.id).flatMap((m) => [m.lostId, m.foundId]).filter((x) => x !== it.id));
    CF.notify.add(it.reporterId, { type: "report_removed", title: "Report " + it.ref + " was removed", body: 'An administrator removed your report "' + it.title + '". Reason: ' + why.slice(0, 150), link: "my-reports.html" });
    return { ok: true, item: it };
  };

  admin.restoreReport = function (itemId, adminUser) {
    if (!isAdmin(adminUser)) return NOT_ADMIN;
    const items = CF.db.items();
    const it = items.find((i) => i.id === itemId);
    if (!it) return { ok: false, message: "Report not found." };
    if (it.status !== "withdrawn" || !it.removedByAdmin) return { ok: false, message: "Only reports removed by an administrator can be restored." };
    const before = JSON.stringify(items);
    it.status = "open"; delete it.removedByAdmin; delete it.removedReason; delete it.removedAt;
    if (!CF.db.saveItems(items)) { CF.db.saveItems(JSON.parse(before)); return STORAGE_FULL; }
    CF.notify.add(it.reporterId, { type: "report_restored", title: "Report " + it.ref + " is back", body: 'An administrator restored your report "' + it.title + '".', link: "item-details.html?id=" + it.id });
    return { ok: true, item: it };
  };

  /* ---------- matches ---------- */
  /** One row per stored match record, with both reports, a fresh score and a display state. */
  admin.matchRows = function () {
    return CF.db.matches().map(function (rec) {
      const lost = find(rec.lostId), found = find(rec.foundId);
      if (!lost || !found) return null;
      const s = CF.match.score(lost, found);
      let state = rec.status;
      if (rec.status === "suggested" && !(lost.status === "open" && found.status === "open")) state = "closed";
      if (rec.status === "confirmed" && [lost, found].some((i) => i.status === "withdrawn")) state = "closed";
      return { rec, lost, found, state, score: rec.status === "confirmed" ? Math.max(rec.score || 0, s.score) : s.score, reasons: s.reasons, tier: CF.match.tierOf(s.score) };
    }).filter(Boolean).sort((a, b) => b.score - a.score || new Date(b.rec.createdAt) - new Date(a.rec.createdAt));
  };

  function persistMatch(records, items) {
    const prevM = CF.db.matches(), prevI = CF.db.items();
    if (!CF.db.saveMatches(records) || (items && !CF.db.saveItems(items))) {
      CF.db.saveMatches(prevM); CF.db.saveItems(prevI);
      return false;
    }
    return true;
  }

  function doConfirm(records, rec, items, adminUser) {
    const lost = items.find((i) => i.id === rec.lostId), found = items.find((i) => i.id === rec.foundId);
    if (!lost || !found) return { ok: false, message: "One of the reports no longer exists." };
    if (lost.status !== "open" || found.status !== "open") return { ok: false, message: "One of these reports is no longer open, so the match can't be confirmed." };
    rec.status = "confirmed"; rec.confirmedAt = new Date().toISOString(); rec.confirmedBy = adminUser.id;
    lost.status = "matched"; found.status = "matched";
    if (!persistMatch(records, items)) return STORAGE_FULL;
    CF.notify.add(lost.reporterId, { type: "match_confirmed", title: "Match confirmed for " + lost.ref, body: 'An administrator thinks "' + found.title + '" (' + found.ref + ") is your item. Open it and start a claim to prove it's yours.", link: "item-details.html?id=" + found.id });
    CF.notify.add(found.reporterId, { type: "match_confirmed", title: "Owner found for " + found.ref, body: 'An administrator linked your found item "' + found.title + '" to a lost report. The owner may submit a claim soon.', link: "item-details.html?id=" + found.id });
    return { ok: true, lost, found };
  }

  admin.confirmMatch = function (matchId, adminUser) {
    if (!isAdmin(adminUser)) return NOT_ADMIN;
    const records = CF.db.matches(), items = CF.db.items();
    const rec = records.find((m) => m.id === matchId);
    if (!rec) return { ok: false, message: "Match not found." };
    if (rec.status === "confirmed") return { ok: false, message: "This match is already confirmed." };
    return doConfirm(records, rec, items, adminUser);
  };

  admin.dismissMatch = function (matchId, adminUser) {
    if (!isAdmin(adminUser)) return NOT_ADMIN;
    const records = CF.db.matches();
    const rec = records.find((m) => m.id === matchId);
    if (!rec) return { ok: false, message: "Match not found." };
    if (rec.status !== "suggested") return { ok: false, message: "Only suggestions can be dismissed. Undo a confirmed match first." };
    rec.status = "dismissed"; rec.dismissedAt = new Date().toISOString();
    return persistMatch(records) ? { ok: true } : STORAGE_FULL;
  };

  /** Confirmed -> suggested (items return to open) or dismissed -> suggested. */
  admin.reopenMatch = function (matchId, adminUser) {
    if (!isAdmin(adminUser)) return NOT_ADMIN;
    const records = CF.db.matches();
    const rec = records.find((m) => m.id === matchId);
    if (!rec) return { ok: false, message: "Match not found." };
    if (rec.status === "suggested") return { ok: false, message: "This match is already a suggestion." };
    const wasConfirmed = rec.status === "confirmed";
    const items = CF.db.items();
    if (wasConfirmed) {
      const l = items.find((i) => i.id === rec.lostId), f = items.find((i) => i.id === rec.foundId);
      if ((l && (l.status === "claimed" || l.status === "returned")) || (f && (f.status === "claimed" || f.status === "returned"))) {
        return { ok: false, message: "This item has already been claimed, so the match can't be undone." };
      }
    }
    rec.status = "suggested"; delete rec.confirmedAt; delete rec.confirmedBy; delete rec.dismissedAt;
    if (!persistMatch(records)) return STORAGE_FULL;
    if (wasConfirmed) settleStatuses([rec.lostId, rec.foundId]);
    return { ok: true };
  };

  /** Admin pairs a lost and a found report that the scorer didn't suggest. */
  admin.linkMatch = function (lostRef, foundRef, adminUser) {
    if (!isAdmin(adminUser)) return NOT_ADMIN;
    const lost = CF.reports.find(lostRef), found = CF.reports.find(foundRef);
    if (!lost || lost.type !== "lost") return { ok: false, message: "Choose a lost report." };
    if (!found || found.type !== "found") return { ok: false, message: "Choose a found report." };
    if (lost.reporterId === found.reporterId) return { ok: false, message: "Both reports were filed by the same person." };
    const records = CF.db.matches(), items = CF.db.items();
    let rec = records.find((m) => m.lostId === lost.id && m.foundId === found.id);
    if (rec && rec.status === "confirmed") return { ok: false, message: "These two reports are already matched." };
    if (!rec) {
      rec = { id: CF.util.uid("m"), lostId: lost.id, foundId: found.id, score: CF.match.score(lost, found).score, status: "suggested", createdAt: new Date().toISOString(), manual: true };
      records.push(rec);
    }
    return doConfirm(records, rec, items, adminUser);
  };

  /* ---------- claim verification ---------- */
  admin.claimRows = function () {
    // newest activity first; same-millisecond ties fall back to storage order (later = newer)
    return CF.db.claims().map((c, i) => {
      const item = CF.reports.find(c.itemId);
      return { claim: c, item, claimant: CF.db.userById(c.claimantId), finder: item ? CF.db.userById(item.reporterId) : null, i };
    }).sort((a, b) => new Date(b.claim.updatedAt || b.claim.createdAt) - new Date(a.claim.updatedAt || a.claim.createdAt) || b.i - a.i);
  };

  /**
   * Plain-language comparisons between what the claimant said and what the finder recorded.
   * They are hints for the administrator, not a verdict. Each is { label, level: good|warn|info, text }.
   */
  admin.verifyHints = function (claim) {
    const item = CF.reports.find(claim.itemId);
    const hints = [];
    if (!item) return hints;
    const day = (v) => CF.util.toDayStr(v);

    if (claim.lostLocation) {
      hints.push(claim.lostLocation === item.location
        ? { label: "Place", level: "good", text: "Same place: " + item.location }
        : { label: "Place", level: "warn", text: "Claimant says " + claim.lostLocation + "; it was found at " + item.location });
    }
    const a = day(claim.lostDate), b = day(item.dateOccurred);
    if (a && b) {
      const diff = Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
      hints.push(diff < 0
        ? { label: "Date", level: "warn", text: "Claimant says it was lost " + Math.abs(diff) + " day(s) after it was found" }
        : diff <= 3
          ? { label: "Date", level: "good", text: diff === 0 ? "Lost and found on the same day" : "Found " + diff + " day(s) after it was lost" }
          : { label: "Date", level: diff > 14 ? "warn" : "info", text: "Found " + diff + " days after the claimant says it was lost" });
    }

    const mine = CF.match.tokens([claim.description, claim.proofDetails].join(" "));
    const marks = CF.match.tokens(item.identifyingMarks || "");
    const pub = CF.match.tokens([item.title, item.description, item.color, item.brand].join(" "));
    const sharedMarks = mine.filter((t, i) => marks.indexOf(t) >= 0 && mine.indexOf(t) === i);
    if (!marks.length) {
      hints.push({ label: "Private marks", level: "info", text: "The finder didn't record any private marks. Ask a question only the owner could answer." });
    } else if (sharedMarks.length >= 2) {
      hints.push({ label: "Private marks", level: "good", text: "Claimant's answers share words with the finder's private marks: " + sharedMarks.join(", ") });
    } else if (sharedMarks.length === 1) {
      hints.push({ label: "Private marks", level: "info", text: "One word in common with the private marks: " + sharedMarks[0] });
    } else {
      hints.push({ label: "Private marks", level: "warn", text: "Nothing in the claimant's answers matches the finder's private marks" });
    }
    const sharedPub = mine.filter((t, i) => pub.indexOf(t) >= 0 && mine.indexOf(t) === i);
    hints.push(sharedPub.length
      ? { label: "Description", level: sharedPub.length >= 2 ? "good" : "info", text: "Shares words with the public listing: " + sharedPub.slice(0, 6).join(", ") }
      : { label: "Description", level: "warn", text: "Nothing in common with the public listing" });

    if (claim.lostReportId) {
      const lost = find(claim.lostReportId);
      if (lost) {
        const s = CF.match.score(lost, item).score;
        hints.push({ label: "Lost report", level: s >= 55 ? "good" : s >= CF.match.THRESHOLD ? "info" : "warn", text: "Linked report " + lost.ref + " scores " + s + "% against this item" });
      }
    } else {
      hints.push({ label: "Lost report", level: "info", text: "The claimant didn't link a lost report" });
    }

    const rivals = CF.db.claims().filter((c) => c.itemId === claim.itemId && c.id !== claim.id && ACTIVE_CLAIM.indexOf(c.status) >= 0).length;
    if (rivals) hints.push({ label: "Competing claims", level: "warn", text: rivals + " other active claim(s) on this item. Approving this one will close them." });
    const past = CF.db.claims().filter((c) => c.claimantId === claim.claimantId && c.id !== claim.id && c.status === "rejected").length;
    if (past) hints.push({ label: "History", level: "warn", text: "This person has " + past + " earlier rejected claim(s)" });
    return hints;
  };

  /* ---------- users ---------- */
  admin.userSummary = function (user) {
    const items = CF.db.items().filter((i) => i.reporterId === user.id);
    return {
      reports: items.length,
      openReports: items.filter((i) => LIVE.indexOf(i.status) >= 0).length,
      claims: CF.db.claims().filter((c) => c.claimantId === user.id).length,
    };
  };

  admin.setUserStatus = function (userId, status, adminUser) {
    if (!isAdmin(adminUser)) return NOT_ADMIN;
    if (status !== "active" && status !== "disabled") return { ok: false, message: "Unknown status." };
    const users = CF.db.users();
    const u = users.find((x) => x.id === userId);
    if (!u) return { ok: false, message: "User not found." };
    if (u.role === "admin") return { ok: false, message: "Administrator accounts can't be changed here." };
    if (u.status === status) return { ok: false, message: "This account is already " + status + "." };
    const before = JSON.stringify(users);
    u.status = status;
    if (!CF.db.saveUsers(users)) { CF.db.saveUsers(JSON.parse(before)); return STORAGE_FULL; }
    return { ok: true, user: u };
  };

  /* ---------- CSV (opens in Excel / Google Sheets) ---------- */
  admin.csv = function (rows) {
    const cell = (v) => {
      let s = String(v == null ? "" : v).replace(/\r?\n/g, " ");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
      return '"' + s.replace(/"/g, '""') + '"';
    };
    return rows.map((r) => r.map(cell).join(",")).join("\r\n");
  };

  /** Triggers a download in the browser. */
  admin.download = function (filename, content) {
    const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };

  /** Days between two ISO dates, rounded down, never negative. */
  admin.daysBetween = function (fromIso, toIso) {
    const d = Math.floor((new Date(toIso) - new Date(fromIso)) / 86400000);
    return isFinite(d) && d > 0 ? d : 0;
  };

  /* ---------- small UI helpers shared by the admin pages ---------- */
  const esc = CF.util.escapeHtml;
  admin.ui = {
    /** Current query string as an object. */
    query() {
      const o = {};
      try { new URLSearchParams(global.location.search).forEach((v, k) => { o[k] = v; }); } catch (e) { /* ignore */ }
      return o;
    },
    /** Keeps filters in the address bar so a view can be bookmarked. */
    setQuery(obj) {
      const p = new URLSearchParams();
      Object.keys(obj).forEach((k) => { if (obj[k]) p.set(k, obj[k]); });
      const qs = p.toString();
      try { global.history.replaceState(null, "", global.location.pathname + (qs ? "?" + qs : "")); } catch (e) { /* ignore */ }
    },
    /** defs: [{ key, label, count }] */
    tabs(el, defs, active) {
      el.innerHTML = defs.map((d) =>
        '<button class="tab" type="button" data-tab="' + esc(d.key) + '" aria-pressed="' + (d.key === active ? "true" : "false") + '">' +
        esc(d.label) + (d.count == null ? "" : ' <span class="count">' + d.count + "</span>") + "</button>").join("");
    },
    badge(kind, value, label) {
      return '<span class="badge badge-' + esc(kind) + '">' + esc(label) + "</span>";
    },
    person(u) {
      if (!u) return "<span class=\"muted\">Unknown</span>";
      const role = CF.ROLES[u.role] ? CF.ROLES[u.role].label : u.role;
      return esc(u.name) + '<div class="meta">' + esc(role) + "</div>";
    },
    day(v) { return CF.util.formatDate(v); },
  };

  /* ---------- presentation data ---------- */
  /** Adds a realistic set of backdated reports, claims and one confirmed match. Safe to press twice: it does nothing if already loaded. */
  admin.loadSampleData = function (adminUser) {
    if (!adminUser || adminUser.role !== "admin") return { ok: false, message: "Only administrators can do this." };
    if (CF.db.items().some((i) => i.sample)) return { ok: false, message: "Sample data is already loaded." };
    const U = (id) => CF.db.userById(id);
    if (!U("u_student") || !U("u_faculty") || !U("u_guard") || !U("u_maint")) return { ok: false, message: "The demo accounts are missing. Use \"Reset demo data\" first." };
    const spec = [
      ["lost", "Samsung phone, black case", "Phones & Gadgets", "Library", 9, "u_student"],
      ["found", "Black phone with cracked corner", "Phones & Gadgets", "Library", 8, "u_guard"],
      ["lost", "Brown leather backpack", "Bags", "Classrooms", 7, "u_faculty"],
      ["found", "Brown backpack with notebooks", "Bags", "Classrooms", 6, "u_maint"],
      ["lost", "Prescription eyeglasses", "Eyewear", "Computer Laboratory", 6, "u_student"],
      ["found", "Eyeglasses in a blue case", "Eyewear", "Computer Laboratory", 5, "u_guard"],
      ["lost", "Student ID card", "IDs & Documents", "Administration Building", 5, "u_student"],
      ["found", "Water tumbler, green", "Bottles & Umbrellas", "Canteen", 4, "u_maint"],
      ["lost", "Silver bracelet", "Jewelry & Accessories", "Quadrangle / Covered Court", 4, "u_faculty"],
      ["found", "ATM card holder", "Wallets & Cards", "Parking Area", 3, "u_guard"],
      ["lost", "Engineering drawing set", "Books & School Supplies", "Classrooms", 3, "u_student"],
      ["found", "Drawing tube and pencils", "Books & School Supplies", "Classrooms", 2, "u_maint"],
      ["lost", "Car key with black fob", "Keys", "Parking Area", 2, "u_faculty"],
      ["found", "Gray jacket", "Clothing", "Gymnasium", 1, "u_guard"],
    ];
    const prevItems = CF.db.items(), made = [];
    for (const [type, title, category, location, ago, uid] of spec) {
      const res = CF.reports.create(type, {
        title, category, location, color: "", brand: "", locationDetail: "", description: title + ". Sample record for the presentation.",
        identifyingMarks: type === "found" ? "Sample private mark" : "", storedAt: type === "found" ? "Guard house / Main Gate" : "",
        dateOccurred: CF.util.toDayStr(CF.util.daysAgoISO(ago)),
      }, U(uid));
      if (!res.ok) { CF.db.saveItems(prevItems); return { ok: false, message: "Could not create sample reports." + (res.errors ? " " + Object.values(res.errors).join(" ") : "") }; }
      made.push(res.item.id);
    }
    const items = CF.db.items();
    made.forEach(function (id, n) {
      const it = items.find((x) => x.id === id);
      if (!it) return;
      it.sample = true; it.createdAt = CF.util.daysAgoISO(spec[n][4]); it.dateOccurred = CF.util.daysAgoISO(spec[n][4]);
    });
    if (!CF.db.saveItems(items)) { CF.db.saveItems(prevItems); return { ok: false, message: "Your browser's storage is full." }; }

    // claims in different states
    const claimFor = (foundIdx, uid, lostLoc, daysAgoLost, action) => {
      const fi = CF.db.items().find((x) => x.id === made[foundIdx]);
      const res = CF.claims.submit(fi.id, { description: fi.title + " that I lost.", proofDetails: "I can describe what is inside and any marks on it.", lostDate: CF.util.toDayStr(CF.util.daysAgoISO(daysAgoLost)), lostLocation: lostLoc, lostReportId: "", evidence: [], declaration: true }, U(uid));
      if (res.ok && action) CF.claims.review(res.claim.id, action, adminUser, action === "approve" ? "Please collect it at the guard house." : "Please tell us what the case looks like.");
      return res;
    };
    claimFor(1, "u_student", "Library", 9, null);
    const ret = claimFor(3, "u_faculty", "Classrooms", 7, "approve");
    if (ret.ok) CF.claims.markReturned(ret.claim.id, adminUser);
    claimFor(5, "u_student", "Computer Laboratory", 6, "approve");
    claimFor(7, "u_faculty", "Canteen", 4, "request_info");
    return { ok: true, added: made.length };
  };

  CF.admin = admin;
})(typeof window !== "undefined" ? window : globalThis);
