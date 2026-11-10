/* ==========================================================================
   CampusFind — claims module (Day 4)
   Requires app.js + auth.js + reports.js. Exposes CF.claims.

   Claim lifecycle
     pending ──(admin asks)──> needs_info ──(claimant replies)──> pending
     pending / needs_info ──> approved ──> returned
     pending / needs_info ──> rejected
     pending / needs_info ──> cancelled   (claimant withdraws)

   Every change is recorded in claim.timeline and the claimant gets an in-app notification.
   The proof a claimant supplies (description, marks, evidence photos) is private: only the
   claimant and administrators ever see it.
   ========================================================================== */
(function (global) {
  "use strict";
  const CF = global.CF;

  const STATUS_LABELS = {
    pending: "Pending review",
    needs_info: "More info needed",
    approved: "Approved",
    rejected: "Rejected",
    returned: "Returned",
    cancelled: "Cancelled",
  };
  const ACTIVE = ["pending", "needs_info"];
  const MAX_ATTEMPTS = 3; // claims one person may file for the same item
  const LIMITS = {
    description: [15, 500],
    proof: [5, 300],
    note: [5, 500],
    reply: [5, 500],
    maxEvidence: 2,
    maxPastDays: 365,
  };
  /** Evidence photos are kept smaller than report photos so claims don't fill the browser's storage. */
  const EVIDENCE_OPTS = { maxDim: 800, maxChars: 250000 };

  const claims = { STATUS_LABELS, ACTIVE, MAX_ATTEMPTS, LIMITS, EVIDENCE_OPTS };

  /* ---------- helpers ---------- */
  const text = (v) => String(v == null ? "" : v).trim();
  const isOpenItem = (item) => !!item && (item.status === "open" || item.status === "matched");
  const entry = (kind, by, text_, photos) => ({
    id: CF.util.uid("t"),
    kind,
    at: new Date().toISOString(),
    byId: by ? by.id : null,
    byRole: by ? (by.role === "admin" ? "admin" : "claimant") : "system",
    text: text_ || "",
    photos: photos || [],
  });
  const safePhotos = (list) => (Array.isArray(list) ? list : []).filter((p) => CF.reports.isSafePhoto(p));

  function notifyClaimant(claim, type, title, body) {
    CF.notify.add(claim.claimantId, { type, title, body, link: "claim-details.html?id=" + claim.id });
  }

  /** Saves claims (+ optionally items). On failure restores what was there and returns false. */
  function persist(nextClaims, backupClaims, nextItems, backupItems) {
    if (!CF.db.saveClaims(nextClaims)) { CF.db.saveClaims(backupClaims); return false; }
    if (nextItems && !CF.db.saveItems(nextItems)) {
      CF.db.saveItems(backupItems);
      CF.db.saveClaims(backupClaims);
      return false;
    }
    return true;
  }
  const STORAGE_FULL = "Your browser's storage is full, so this couldn't be saved. Remove an evidence photo or withdraw old reports and try again.";

  /* ---------- queries ---------- */
  claims.find = function (key) {
    if (!key) return null;
    const k = String(key).toLowerCase();
    return CF.db.claims().find((c) => c.id.toLowerCase() === k || c.ref.toLowerCase() === k) || null;
  };
  claims.forUser = function (userId) {
    return CF.db.claims().filter((c) => c.claimantId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  };
  claims.forUserItem = function (userId, itemId) {
    return CF.db.claims().filter((c) => c.claimantId === userId && c.itemId === itemId);
  };
  claims.forItem = function (itemId) {
    return CF.db.claims().filter((c) => c.itemId === itemId);
  };
  /** Claims an administrator still has something to do with, oldest first. */
  claims.reviewQueue = function () {
    return CF.db.claims()
      .filter((c) => c.status === "pending" || c.status === "needs_info" || c.status === "approved")
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  };

  /* ---------- who may claim what ---------- */
  /** Returns { ok:true } or { ok:false, code, message, claim? }. */
  claims.eligibility = function (item, user) {
    if (!item) return { ok: false, code: "notfound", message: "We couldn't find that item." };
    if (item.type !== "found") return { ok: false, code: "type", message: "Only found items can be claimed. If you found this item, file a found report instead." };
    if (!user) return { ok: false, code: "login", message: "Please log in to submit a claim." };
    if (user.role === "admin") return { ok: false, code: "admin", message: "Administrators review claims; they can't submit them." };
    if (item.reporterId === user.id) return { ok: false, code: "own", message: "You reported this item as found, so you can't claim it." };

    const mine = claims.forUserItem(user.id, item.id);
    const live = mine.find((c) => ACTIVE.indexOf(c.status) !== -1 || c.status === "approved" || c.status === "returned");
    if (live) return { ok: false, code: "active", message: "You already have a claim on this item (" + live.ref + ").", claim: live };
    if (!isOpenItem(item)) return { ok: false, code: "closed", message: "This item is no longer available to claim." };
    if (mine.length >= MAX_ATTEMPTS) return { ok: false, code: "limit", message: "You've reached the limit of " + MAX_ATTEMPTS + " claims for this item. Please visit the administration office." };
    return { ok: true };
  };

  /* ---------- validation ---------- */
  /** Validates the ownership-proof answers. Returns { errors, clean }. */
  claims.validate = function (item, data, user) {
    const errors = {};
    const clean = {
      description: text(data.description),
      proofDetails: text(data.proofDetails),
      lostDate: text(data.lostDate),
      lostLocation: text(data.lostLocation),
      lostReportId: text(data.lostReportId),
    };

    if (clean.description.length < LIMITS.description[0]) errors.description = "Describe the item in at least " + LIMITS.description[0] + " characters.";
    else if (clean.description.length > LIMITS.description[1]) errors.description = "Keep this under " + LIMITS.description[1] + " characters.";

    if (clean.proofDetails.length < LIMITS.proof[0]) errors.proofDetails = "Tell us something only the owner would know (at least " + LIMITS.proof[0] + " characters).";
    else if (clean.proofDetails.length > LIMITS.proof[1]) errors.proofDetails = "Keep this under " + LIMITS.proof[1] + " characters.";

    const d = CF.util.parseDate(clean.lostDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.lostDate) || isNaN(d)) {
      errors.lostDate = "Pick the date you lost it.";
    } else {
      const today = CF.util.parseDate(CF.util.todayStr());
      const oldest = new Date(today);
      oldest.setDate(oldest.getDate() - LIMITS.maxPastDays);
      const foundDay = item ? CF.util.toDayStr(item.dateOccurred) : "";
      if (d > today) errors.lostDate = "The date can't be in the future.";
      else if (d < oldest) errors.lostDate = "That's more than a year ago. Please visit the administration office.";
      else if (foundDay && clean.lostDate > foundDay) errors.lostDate = "It can't have been lost after it was found (found on " + CF.util.formatDate(foundDay) + ").";
    }

    if (CF.db.locations().indexOf(clean.lostLocation) === -1) errors.lostLocation = "Choose where you think you lost it.";

    if (clean.lostReportId) {
      const r = CF.reports.find(clean.lostReportId);
      if (!r || r.type !== "lost" || !user || r.reporterId !== user.id || !isOpenItem(r)) {
        errors.lostReportId = "Choose one of your own open lost reports, or none.";
      } else {
        clean.lostReportId = r.id;
      }
    }

    const evidence = Array.isArray(data.evidence) ? data.evidence : [];
    if (evidence.length > LIMITS.maxEvidence) errors.evidence = "Attach at most " + LIMITS.maxEvidence + " photos.";
    else if (!evidence.every((p) => CF.reports.isSafePhoto(p))) errors.evidence = "One of the photos can't be used. Remove it and try another.";

    if (data.declaration !== true) errors.declaration = "Please confirm the declaration to continue.";

    return { errors, clean };
  };

  /* ---------- claimant actions ---------- */
  /** Files a claim on a found item. Returns { ok, claim } or { ok:false, errors|message, code? }. */
  claims.submit = function (itemId, data, user) {
    const item = CF.reports.find(itemId);
    const el = claims.eligibility(item, user);
    if (!el.ok) return { ok: false, code: el.code, message: el.message, claim: el.claim };

    const { errors, clean } = claims.validate(item, data, user);
    if (Object.keys(errors).length) return { ok: false, errors };

    const prevCounters = CF.storage.get(CF.KEYS.counters, {});
    const now = new Date().toISOString();
    const claim = {
      id: CF.util.uid("clm"),
      ref: CF.util.nextRef("CLM"),
      itemId: item.id,
      claimantId: user.id,
      status: "pending",
      description: clean.description,
      proofDetails: clean.proofDetails,
      lostDate: clean.lostDate,
      lostLocation: clean.lostLocation,
      lostReportId: clean.lostReportId,
      evidence: safePhotos(data.evidence),
      declaration: true,
      timeline: [entry("submitted", user, "Claim submitted.")],
      createdAt: now,
      updatedAt: now,
    };
    const backup = CF.db.claims();
    if (!CF.db.saveClaims(backup.concat(claim))) {
      CF.db.saveClaims(backup);
      CF.storage.set(CF.KEYS.counters, prevCounters);
      return { ok: false, message: STORAGE_FULL };
    }
    notifyClaimant(claim, "claim_submitted", "Claim " + claim.ref + " submitted",
      'We\'ll review your claim on "' + item.title + '". You\'ll be notified when something changes.');
    return { ok: true, claim };
  };

  /** Claimant answers an administrator's request for more information. */
  claims.reply = function (claimId, data, user) {
    const backup = CF.db.claims();
    const list = CF.db.claims();
    const claim = list.find((c) => c.id === claimId);
    if (!claim || !user || claim.claimantId !== user.id) return { ok: false, message: "Claim not found." };
    if (claim.status !== "needs_info") return { ok: false, message: "This claim isn't waiting for more information." };

    const msg = text(data && data.text);
    const photos = data && data.photos ? data.photos : [];
    if (msg.length < LIMITS.reply[0]) return { ok: false, errors: { text: "Write at least " + LIMITS.reply[0] + " characters." } };
    if (msg.length > LIMITS.reply[1]) return { ok: false, errors: { text: "Keep your reply under " + LIMITS.reply[1] + " characters." } };
    if (photos.length > 1 || !photos.every((p) => CF.reports.isSafePhoto(p))) return { ok: false, errors: { photo: "That photo can't be used." } };

    claim.status = "pending";
    claim.updatedAt = new Date().toISOString();
    claim.timeline.push(entry("reply", user, msg, photos));
    if (!persist(list, backup)) return { ok: false, message: STORAGE_FULL };
    notifyClaimant(claim, "claim_reply", "Reply sent on " + claim.ref, "Thanks. An administrator will review your reply.");
    return { ok: true, claim };
  };

  /** Claimant withdraws their own claim while it is still under review. */
  claims.cancel = function (claimId, user) {
    const backup = CF.db.claims();
    const list = CF.db.claims();
    const claim = list.find((c) => c.id === claimId);
    if (!claim || !user || claim.claimantId !== user.id) return { ok: false, message: "Claim not found." };
    if (ACTIVE.indexOf(claim.status) === -1) return { ok: false, message: "Only claims under review can be cancelled." };
    claim.status = "cancelled";
    claim.updatedAt = new Date().toISOString();
    claim.timeline.push(entry("cancelled", user, "You cancelled this claim."));
    if (!persist(list, backup)) return { ok: false, message: STORAGE_FULL };
    return { ok: true, claim };
  };

  /* ---------- administrator actions ---------- */
  /**
   * action: "approve" | "reject" | "request_info". `note` is required for reject / request_info;
   * for approve it carries optional pickup instructions.
   */
  claims.review = function (claimId, action, admin, note) {
    if (!admin || admin.role !== "admin") return { ok: false, message: "Only administrators can review claims." };
    if (["approve", "reject", "request_info"].indexOf(action) === -1) return { ok: false, message: "Unknown action." };

    const backupClaims = CF.db.claims(), backupItems = CF.db.items();
    const list = CF.db.claims(), items = CF.db.items();
    const claim = list.find((c) => c.id === claimId);
    if (!claim) return { ok: false, message: "Claim not found." };
    const item = items.find((i) => i.id === claim.itemId);
    if (!item) return { ok: false, message: "The item for this claim no longer exists." };

    const msg = text(note);
    const now = new Date().toISOString();
    const label = 'on "' + item.title + '"';

    if (action === "request_info") {
      if (claim.status !== "pending") return { ok: false, message: claim.status === "needs_info" ? "Already waiting for the claimant's reply." : "This claim is already " + STATUS_LABELS[claim.status].toLowerCase() + "." };
      if (msg.length < LIMITS.note[0]) return { ok: false, message: "Tell the claimant what you need (at least " + LIMITS.note[0] + " characters)." };
      claim.status = "needs_info";
      claim.updatedAt = now;
      claim.timeline.push(entry("info_requested", admin, msg));
      if (!persist(list, backupClaims)) return { ok: false, message: STORAGE_FULL };
      notifyClaimant(claim, "claim_info_requested", "More information needed on " + claim.ref, msg);
      return { ok: true, claim };
    }

    if (ACTIVE.indexOf(claim.status) === -1) return { ok: false, message: "This claim is already " + STATUS_LABELS[claim.status].toLowerCase() + "." };

    if (action === "reject") {
      if (msg.length < LIMITS.note[0]) return { ok: false, message: "Give the claimant a reason (at least " + LIMITS.note[0] + " characters)." };
      claim.status = "rejected";
      claim.updatedAt = now;
      claim.timeline.push(entry("rejected", admin, msg));
      if (!persist(list, backupClaims)) return { ok: false, message: STORAGE_FULL };
      notifyClaimant(claim, "claim_rejected", "Claim " + claim.ref + " was not approved", msg);
      return { ok: true, claim };
    }

    // approve
    if (!isOpenItem(item)) return { ok: false, message: "This item is no longer available (it is " + item.status + ")." };
    const others = list.filter((c) => c.itemId === claim.itemId && c.id !== claim.id && ACTIVE.indexOf(c.status) !== -1);
    claim.status = "approved";
    claim.updatedAt = now;
    claim.timeline.push(entry("approved", admin, msg || "Your claim was approved."));
    item.status = "claimed";
    const lost = claim.lostReportId ? items.find((i) => i.id === claim.lostReportId) : null;
    if (lost && lost.reporterId === claim.claimantId && isOpenItem(lost)) lost.status = "claimed";
    others.forEach(function (o) {
      o.status = "rejected";
      o.updatedAt = now;
      o.timeline.push(entry("auto_rejected", null, "Another claim for this item was approved."));
    });
    if (!persist(list, backupClaims, items, backupItems)) return { ok: false, message: STORAGE_FULL };

    // keep the stored match suggestion in step
    if (lost) {
      const recs = CF.db.matches();
      const rec = recs.find((m) => m.lostId === lost.id && m.foundId === item.id);
      if (rec) { rec.status = "confirmed"; CF.db.saveMatches(recs); }
    }
    notifyClaimant(claim, "claim_approved", "Claim " + claim.ref + " approved", msg || "Your claim " + label + " was approved. Please follow the pickup instructions.");
    others.forEach((o) => notifyClaimant(o, "claim_rejected", "Claim " + o.ref + " closed", "Another claim " + label + " was approved."));
    return { ok: true, claim };
  };

  /** Admin records that the owner collected the item. */
  claims.markReturned = function (claimId, admin) {
    if (!admin || admin.role !== "admin") return { ok: false, message: "Only administrators can do this." };
    const backupClaims = CF.db.claims(), backupItems = CF.db.items();
    const list = CF.db.claims(), items = CF.db.items();
    const claim = list.find((c) => c.id === claimId);
    if (!claim) return { ok: false, message: "Claim not found." };
    if (claim.status !== "approved") return { ok: false, message: "Only approved claims can be marked as returned." };
    const item = items.find((i) => i.id === claim.itemId);
    if (item) item.status = "returned";
    const lost = claim.lostReportId ? items.find((i) => i.id === claim.lostReportId) : null;
    if (lost && lost.status === "claimed") lost.status = "returned";
    claim.status = "returned";
    claim.updatedAt = new Date().toISOString();
    claim.timeline.push(entry("returned", admin, "Item handed back to its owner."));
    if (!persist(list, backupClaims, items, backupItems)) return { ok: false, message: STORAGE_FULL };
    notifyClaimant(claim, "claim_returned", "Item returned (" + claim.ref + ")",
      'Your item "' + (item ? item.title : "") + '" was marked as returned to you. Thank you for using CampusFind!');
    return { ok: true, claim };
  };

  /* ---------- progress tracker ---------- */
  /**
   * Four-step tracker for a claim. state: done | current | warn | bad | todo | skipped.
   */
  claims.tracker = function (claim) {
    const s = claim.status;
    const step = (key, label, state, hint) => ({ key, label, state, hint: hint || "" });
    const submitted = step("submitted", "Submitted", "done", CF.util.formatDate(claim.createdAt));
    if (s === "pending") return [submitted, step("review", "Under review", "current", "An administrator is checking your proof"), step("decision", "Decision", "todo"), step("returned", "Returned", "todo")];
    if (s === "needs_info") return [submitted, step("review", "More info needed", "warn", "Reply to the administrator's question"), step("decision", "Decision", "todo"), step("returned", "Returned", "todo")];
    if (s === "approved") return [submitted, step("review", "Reviewed", "done"), step("decision", "Approved", "done"), step("returned", "Ready for pickup", "current", "Collect it as instructed")];
    if (s === "returned") return [submitted, step("review", "Reviewed", "done"), step("decision", "Approved", "done"), step("returned", "Returned", "done", CF.util.formatDate(claim.updatedAt))];
    if (s === "rejected") return [submitted, step("review", "Reviewed", "done"), step("decision", "Rejected", "bad"), step("returned", "Returned", "skipped")];
    return [submitted, step("review", "Under review", "skipped"), step("decision", "Cancelled", "skipped"), step("returned", "Returned", "skipped")];
  };

  /** Tracker markup; `compact` hides the per-step hints (used on list cards). */
  claims.trackerHtml = function (claim, compact) {
    const esc = CF.util.escapeHtml;
    const symbol = { done: "✓", bad: "✕", warn: "!" };
    return (
      '<ol class="tracker' + (compact ? " compact" : "") + '" aria-label="Claim progress">' +
      claims.tracker(claim).map(function (s, i) {
        const cur = s.state === "current" || s.state === "warn" ? ' aria-current="step"' : "";
        return (
          '<li class="step step-' + s.state + '"' + cur + '><span class="dot" aria-hidden="true">' + (symbol[s.state] || i + 1) + "</span>" +
          '<span class="step-text"><strong>' + esc(s.label) + "</strong>" + (!compact && s.hint ? "<small>" + esc(s.hint) + "</small>" : "") + "</span></li>"
        );
      }).join("") + "</ol>"
    );
  };

  CF.claims = claims;
})(typeof window !== "undefined" ? window : globalThis);
