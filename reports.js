/* ==========================================================================
   CampusFind — reports module (Day 2)
   Create / validate / query lost & found reports. Requires app.js + auth.js.
   Exposes CF.reports.
   ========================================================================== */
(function (global) {
  "use strict";
  const CF = global.CF;

  const STATUS_LABELS = {
    open: "Open",
    matched: "Matched",
    claimed: "Claimed",
    returned: "Returned",
    withdrawn: "Withdrawn",
  };

  /** Where a finder is keeping a found item (shown to claimants so they know where to go). */
  const HOLDING_PLACES = [
    "I have it with me",
    "Guard house / Main Gate",
    "Administration office",
    "Library counter",
    "Department office",
    "Other",
  ];

  const LIMITS = {
    title: [3, 80],
    description: [10, 500],
    color: 30,
    brand: 40,
    marks: 200,
    locationDetail: 120,
    maxPastDays: 365,
  };
  const MAX_PHOTO_INPUT_BYTES = 8 * 1024 * 1024; // what we accept from the file picker
  const MAX_PHOTO_CHARS = 350000; // ~260 KB of data-URL after compression (localStorage is ~5 MB total)
  const MAX_PHOTO_DIM = 900;
  const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

  const reports = {
    STATUS_LABELS, HOLDING_PLACES, LIMITS, MAX_PHOTO_CHARS,

    isSafePhoto(src) {
      return typeof src === "string" && src.length <= MAX_PHOTO_CHARS + 64 && PHOTO_RE.test(src);
    },

    /**
     * Validates a report. `type` is "lost" | "found".
     * Returns { errors, clean } — clean holds trimmed values.
     */
    validate(type, data) {
      const errors = {};
      const t = (v) => String(v == null ? "" : v).trim();
      const clean = {
        title: t(data.title),
        category: t(data.category),
        color: t(data.color),
        brand: t(data.brand),
        location: t(data.location),
        locationDetail: t(data.locationDetail),
        dateOccurred: t(data.dateOccurred),
        description: t(data.description),
        identifyingMarks: t(data.identifyingMarks),
        storedAt: t(data.storedAt),
      };

      if (type !== "lost" && type !== "found") errors._type = "Unknown report type.";

      if (clean.title.length < LIMITS.title[0]) errors.title = "Give the item a short name (at least 3 characters).";
      else if (clean.title.length > LIMITS.title[1]) errors.title = "Keep the name under " + LIMITS.title[1] + " characters.";

      if (!CF.db.categories().includes(clean.category)) errors.category = "Choose a category.";
      if (!CF.db.locations().includes(clean.location)) errors.location = type === "lost" ? "Choose where you think you lost it." : "Choose where you found it.";

      if (clean.locationDetail.length > LIMITS.locationDetail) errors.locationDetail = "Keep this under " + LIMITS.locationDetail + " characters.";
      if (clean.color.length > LIMITS.color) errors.color = "Keep the colour under " + LIMITS.color + " characters.";
      if (clean.brand.length > LIMITS.brand) errors.brand = "Keep the brand under " + LIMITS.brand + " characters.";
      if (clean.identifyingMarks.length > LIMITS.marks) errors.identifyingMarks = "Keep this under " + LIMITS.marks + " characters.";

      // date: valid, not in the future, not older than a year
      const d = CF.util.parseDate(clean.dateOccurred);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.dateOccurred) || isNaN(d)) {
        errors.dateOccurred = "Pick the date it happened.";
      } else {
        const today = CF.util.parseDate(CF.util.todayStr());
        const oldest = new Date(today);
        oldest.setDate(oldest.getDate() - LIMITS.maxPastDays);
        if (d > today) errors.dateOccurred = "The date can't be in the future.";
        else if (d < oldest) errors.dateOccurred = "That's more than a year ago. Please contact the administrator instead.";
      }

      if (clean.description.length < LIMITS.description[0]) errors.description = "Add a short description (at least 10 characters).";
      else if (clean.description.length > LIMITS.description[1]) errors.description = "Keep the description under " + LIMITS.description[1] + " characters.";

      if (type === "found" && !HOLDING_PLACES.includes(clean.storedAt)) errors.storedAt = "Tell us where the item is now.";

      if (data.photo != null && data.photo !== "" && !reports.isSafePhoto(data.photo)) {
        errors.photo = "That photo can't be used. Try another image.";
      }
      return { errors, clean };
    },

    /** Creates a report for `user`. Returns { ok, item } or { ok:false, errors|message }. */
    create(type, data, user) {
      if (!user) return { ok: false, message: "Please log in first." };
      const { errors, clean } = reports.validate(type, data);
      if (Object.keys(errors).length) return { ok: false, errors };

      const prevCounters = CF.storage.get(CF.KEYS.counters, {});
      const item = {
        id: CF.util.uid("item"),
        ref: CF.util.nextRef(type === "lost" ? "LST" : "FND"),
        type,
        title: clean.title,
        category: clean.category,
        color: clean.color,
        brand: clean.brand,
        location: clean.location,
        locationDetail: clean.locationDetail,
        dateOccurred: clean.dateOccurred,
        description: clean.description,
        identifyingMarks: clean.identifyingMarks,
        storedAt: type === "found" ? clean.storedAt : "",
        photo: data.photo || null,
        status: "open",
        reporterId: user.id,
        createdAt: new Date().toISOString(),
      };

      const before = CF.db.items();
      if (!CF.db.saveItems(before.concat(item))) {
        // roll back so nothing half-saved lingers in memory-only storage
        CF.db.saveItems(before);
        CF.storage.set(CF.KEYS.counters, prevCounters);
        return {
          ok: false,
          message: "Your browser's storage is full, so this report couldn't be saved. Remove the photo or withdraw old reports and try again.",
        };
      }
      return { ok: true, item };
    },

    /** Finds a report by internal id or by reference number (e.g. LST-0004). */
    find(key) {
      if (!key) return null;
      const k = String(key).toLowerCase();
      return CF.db.items().find((i) => i.id.toLowerCase() === k || i.ref.toLowerCase() === k) || null;
    },

    /** Thumbnail markup: the photo if it is a safe data-URL, otherwise a coloured L/F placeholder. */
    thumbHtml(item) {
      if (reports.isSafePhoto(item.photo)) {
        return '<img src="' + item.photo + '" alt="Photo of ' + CF.util.escapeHtml(item.title) + '" loading="lazy">';
      }
      return '<span class="thumb-ph ' + item.type + '" aria-hidden="true">' + (item.type === "lost" ? "L" : "F") + "</span>";
    },

    forUser(userId) {
      return CF.db
        .items()
        .filter((i) => i.reporterId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    reporterOf(item) {
      return CF.db.userById(item.reporterId);
    },

    /** Contact details and identifying marks are only for the reporter and administrators. */
    canSeePrivate(item, user) {
      return !!user && (user.id === item.reporterId || user.role === "admin");
    },

    /** Reporter withdraws their own open report. */
    withdraw(id, user) {
      const items = CF.db.items();
      const item = items.find((i) => i.id === id);
      if (!item) return { ok: false, message: "Report not found." };
      if (!user || user.id !== item.reporterId) return { ok: false, message: "Only the person who filed this report can withdraw it." };
      if (item.status !== "open") return { ok: false, message: "Only open reports can be withdrawn." };
      // a found item someone is claiming can't just disappear mid-review
      if (item.type === "found" && CF.db.claims().some((c) => c.itemId === item.id && (c.status === "pending" || c.status === "needs_info"))) {
        return { ok: false, message: "Someone has a claim under review on this item, so it can't be withdrawn. Please contact an administrator." };
      }
      item.status = "withdrawn";
      item.withdrawnAt = new Date().toISOString();
      CF.db.saveItems(items);
      return { ok: true, item };
    },

    /**
     * Shrinks a chosen image file to a JPEG data-URL small enough for localStorage.
     * Rejects with an Error whose message is safe to show the user.
     */
    compressImage(file, opts) {
      const maxDim = (opts && opts.maxDim) || MAX_PHOTO_DIM;
      const maxChars = (opts && opts.maxChars) || MAX_PHOTO_CHARS;
      return new Promise(function (resolve, reject) {
        if (!file) return resolve(null);
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error("Use a JPG, PNG or WebP image."));
        if (file.size > MAX_PHOTO_INPUT_BYTES) return reject(new Error("That image is over 8 MB. Choose a smaller one."));

        const reader = new FileReader();
        reader.onerror = function () { reject(new Error("Couldn't read that file.")); };
        reader.onload = function () {
          const img = new Image();
          img.onerror = function () { reject(new Error("That file isn't a valid image.")); };
          img.onload = function () {
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff"; // flatten transparency before JPEG encoding
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            let q = 0.78;
            let out = canvas.toDataURL("image/jpeg", q);
            while (out.length > maxChars && q > 0.35) {
              q -= 0.1;
              out = canvas.toDataURL("image/jpeg", q);
            }
            if (out.length > maxChars) return reject(new Error("Couldn't shrink that image enough. Try another photo."));
            resolve(out);
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    },
  };

  CF.reports = reports;
})(typeof window !== "undefined" ? window : globalThis);
