/* ==========================================================================
   CampusFind — search & match engine (Day 3)
   Requires app.js + reports.js. Exposes CF.match.

   Matching scores a LOST report against a FOUND report from 0–100 using only
   public fields (never the private identifying marks, so the score can't be
   used to "probe" for them):

     category   35   same = 35, related = 15, either is "Others" = 12
     name       18   overlap of meaningful words in the titles
     details    12   extra shared words in the descriptions
     place      15   same = 15, nearby = 7
     date       10   found on/after the loss date, closer = better
     colour      5   shared = +5, both given but different = -8
     brand       5   shared = +5, both given but different = -6

   Suggestions start at THRESHOLD (40). An administrator still verifies every return.
   ========================================================================== */
(function (global) {
  "use strict";
  const CF = global.CF;

  const THRESHOLD = 40;

  /* ---------- text normalisation ---------- */
  const STOPWORDS = new Set(
    ("the and with without near for from this that these those has have had was were its it is are " +
      "item items thing things found lost left small big new old one some very color colour " +
      "inside outside around beside also been being than then them they you your our his her their " +
      "turned guard house table").split(" ")
  );

  // Common variants -> one canonical word (includes a few everyday Filipino terms).
  const SYNONYMS = {
    cellphone: "phone", celphone: "phone", cell: "phone", mobile: "phone", smartphone: "phone", iphone: "phone", android: "phone",
    backpack: "bag", knapsack: "bag", handbag: "bag", sling: "bag", tote: "bag",
    glass: "eyeglass", eyeglass: "eyeglass", spectacle: "eyeglass", eyewear: "eyeglass", salamin: "eyeglass",
    pitaka: "wallet", purse: "wallet",
    susi: "key", keychain: "key",
    payong: "umbrella",
    relo: "watch", wristwatch: "watch",
    tumbler: "bottle", flask: "bottle", aquaflask: "bottle", hydroflask: "bottle",
    earbud: "earphone", headphone: "earphone", airpod: "earphone", earpod: "earphone",
    hoodie: "jacket", sweater: "jacket", cardigan: "jacket",
    usb: "flashdrive", flash: "flashdrive", thumbdrive: "flashdrive",
    ballpen: "pen",
    calc: "calculator",
    identification: "id",
    grey: "gray",
  };

  function stem(w) {
    if (w.length > 4 && w.endsWith("sses")) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
    return w;
  }

  /** Lower-cased, accent-free, de-duplicated list of meaningful canonical words. */
  function tokens(text) {
    const raw = String(text == null ? "" : text)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().split(/[^a-z0-9]+/);
    const out = [];
    raw.forEach(function (w) {
      if (!w || (w.length < 3 && w !== "id")) return;
      if (STOPWORDS.has(w)) return;
      let t = stem(w);
      if (SYNONYMS[t]) t = SYNONYMS[t];
      if (out.indexOf(t) === -1) out.push(t);
    });
    return out;
  }

  const intersect = (a, b) => a.filter((x) => b.indexOf(x) !== -1);

  /* ---------- scoring helpers ---------- */
  const RELATED_CATEGORIES = [
    ["Wallets & Cards", "IDs & Documents"],
    ["Bags", "Books & School Supplies"],
  ];
  // Placeholder groupings — adjust to the real URS Binangonan campus layout.
  const NEARBY_LOCATIONS = [
    ["Main Gate", "Parking Area"],
    ["Library", "Classrooms", "Computer Laboratory", "Administration Building"],
    ["Canteen", "Quadrangle / Covered Court", "Gymnasium"],
  ];

  const areRelatedCategories = (a, b) => RELATED_CATEGORIES.some((p) => p.indexOf(a) !== -1 && p.indexOf(b) !== -1);
  const areNearby = (a, b) => NEARBY_LOCATIONS.some((g) => g.indexOf(a) !== -1 && g.indexOf(b) !== -1);
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

  function dayDiff(fromDay, toDay) {
    return Math.round((CF.util.parseDate(toDay) - CF.util.parseDate(fromDay)) / 86400000);
  }

  function tierOf(score) {
    if (score >= 75) return { tier: "strong", label: "Strong match" };
    if (score >= 55) return { tier: "good", label: "Good match" };
    return { tier: "possible", label: "Possible match" };
  }

  /** Scores one lost report against one found report. Returns { score, tier, label, reasons, parts }. */
  function score(lost, found) {
    const parts = {};
    const reasons = [];

    // category
    if (lost.category === found.category) { parts.category = 35; reasons.push("Same category"); }
    else if (areRelatedCategories(lost.category, found.category)) { parts.category = 15; reasons.push("Related category"); }
    else if (lost.category === "Others" || found.category === "Others") parts.category = 12;
    else parts.category = 0;

    // name
    const tl = tokens(lost.title), tf = tokens(found.title);
    const sharedTitle = intersect(tl, tf);
    parts.title = tl.length && tf.length ? (sharedTitle.length / Math.min(tl.length, tf.length)) * 18 : 0;
    if (sharedTitle.length) reasons.push("Similar name: " + sharedTitle.slice(0, 3).join(", "));

    // details (shared words beyond the ones already counted in the name)
    const al = tokens(lost.title + " " + lost.description);
    const af = tokens(found.title + " " + found.description);
    const extraUnique = intersect(al, af).filter((w) => sharedTitle.indexOf(w) === -1);
    parts.text = Math.min(1, extraUnique.length / 3) * 12;
    if (extraUnique.length) reasons.push("Matching details: " + extraUnique.slice(0, 3).join(", "));

    // place
    if (lost.location === found.location) { parts.location = 15; reasons.push("Same place (" + found.location + ")"); }
    else if (areNearby(lost.location, found.location)) { parts.location = 7; reasons.push("Nearby places"); }
    else parts.location = 0;

    // date (the found date should be on/after the lost date)
    const ld = CF.util.toDayStr(lost.dateOccurred), fd = CF.util.toDayStr(found.dateOccurred);
    parts.date = 0;
    if (ld && fd) {
      const diff = dayDiff(ld, fd);
      if (diff === 0) { parts.date = 10; reasons.push("Same day"); }
      else if (diff === -1) { parts.date = 6; reasons.push("Dates are a day apart"); }
      else if (diff > 0) {
        parts.date = diff <= 3 ? 10 : diff <= 7 ? 7 : diff <= 14 ? 4 : diff <= 30 ? 2 : 0;
        if (parts.date) reasons.push("Found " + plural(diff, "day") + " after it was lost");
      }
    }

    // colour
    parts.color = 0;
    const cl = tokens(lost.color), cf = tokens(found.color);
    if (cl.length && cf.length) {
      if (intersect(cl, cf).length) { parts.color = 5; reasons.push("Same colour"); }
      else parts.color = -8;
    }

    // brand
    parts.brand = 0;
    const bl = tokens(lost.brand), bf = tokens(found.brand);
    if (bl.length && bf.length) {
      if (intersect(bl, bf).length) { parts.brand = 5; reasons.push("Same brand"); }
      else parts.brand = -6;
    }

    const total = Object.keys(parts).reduce((sum, k) => sum + parts[k], 0);
    const final = Math.max(0, Math.min(100, Math.round(total)));
    const t = tierOf(final);
    return { score: final, tier: t.tier, label: t.label, reasons, parts };
  }

  /* ---------- candidates & persistence ---------- */
  function pairKey(lostId, foundId) { return lostId + "|" + foundId; }

  /**
   * Likely counterparts for a report: open items of the opposite type filed by someone else,
   * scoring at least THRESHOLD, best first. Pairs an admin dismissed are left out.
   */
  function candidatesFor(item) {
    if (!item || (item.status !== "open" && item.status !== "matched")) return [];
    const dismissed = new Set(
      CF.db.matches().filter((m) => m.status === "dismissed").map((m) => pairKey(m.lostId, m.foundId))
    );
    // a pair an administrator confirmed stays visible even though both reports are now "matched"
    const confirmed = new Set(
      CF.db.matches().filter((m) => m.status === "confirmed").map((m) => pairKey(m.lostId, m.foundId))
    );
    const isLost = item.type === "lost";
    const keyOf = (o) => (isLost ? pairKey(item.id, o.id) : pairKey(o.id, item.id));
    return CF.db
      .items()
      .filter((o) => o.type !== item.type && o.reporterId !== item.reporterId &&
        (o.status === "open" || (o.status === "matched" && confirmed.has(keyOf(o)))))
      .map(function (o) {
        const s = isLost ? score(item, o) : score(o, item);
        const key = keyOf(o);
        return Object.assign({ item: o, key, confirmed: confirmed.has(key) }, s);
      })
      .filter((r) => (r.confirmed || r.score >= THRESHOLD) && !dismissed.has(r.key))
      .sort((a, b) => (b.confirmed - a.confirmed) || b.score - a.score || new Date(b.item.createdAt) - new Date(a.item.createdAt));
  }

  /**
   * Stores/refreshes suggestion records (used later by the admin Matches page). Returns how many are new.
   * With { notify: true } (used when a brand-new report is filed) the owner of each counterpart report
   * gets an in-app notification for every NEW suggestion.
   */
  function sync(item, opts) {
    const found = candidatesFor(item);
    if (!found.length) return 0;
    const records = CF.db.matches();
    let added = 0, changed = false;
    const now = new Date().toISOString();
    found.forEach(function (r) {
      const lostId = item.type === "lost" ? item.id : r.item.id;
      const foundId = item.type === "lost" ? r.item.id : item.id;
      const rec = records.find((m) => m.lostId === lostId && m.foundId === foundId);
      if (!rec) {
        records.push({ id: CF.util.uid("m"), lostId, foundId, score: r.score, status: "suggested", createdAt: now });
        added++; changed = true;
        if (opts && opts.notify && CF.notify) {
          CF.notify.add(r.item.reporterId, {
            type: "match",
            title: "New possible match for " + r.item.ref,
            body: (item.type === "found"
              ? 'A found item "' + item.title + '" may match your lost report'
              : 'A lost report "' + item.title + '" may match the item you found') + " (" + r.score + "% match).",
            link: "item-details.html?id=" + r.item.id + "#matches",
          });
        }
      } else if (rec.score !== r.score) {
        rec.score = r.score; changed = true;
      }
    });
    if (changed) CF.db.saveMatches(records);
    return added;
  }

  function syncAll() {
    let added = 0;
    CF.db.items().filter((i) => i.type === "lost" && i.status === "open").forEach((i) => { added += sync(i); });
    return added;
  }

  /* ---------- search ---------- */
  const tokenMatches = (itemTok, q) => itemTok === q || (q.length >= 3 && itemTok.indexOf(q) === 0);

  /** 0 when any query word is missing (all words must match); otherwise a weighted relevance score. */
  function relevanceOf(item, qTokens) {
    const fields = [
      { toks: tokens(item.title), w: 3 },
      { toks: tokens([item.category, item.location, item.color, item.brand, item.ref].join(" ")), w: 2 },
      { toks: tokens(item.description), w: 1 },
    ];
    let total = 0;
    for (let i = 0; i < qTokens.length; i++) {
      let best = 0;
      fields.forEach(function (f) {
        if (f.w > best && f.toks.some((t) => tokenMatches(t, qTokens[i]))) best = f.w;
      });
      if (!best) return 0;
      total += best;
    }
    return total;
  }

  /**
   * Public search over reports. Filters: q, type ("lost"|"found"), category, location,
   * from/to ("YYYY-MM-DD", on the date the item was lost/found), includeClosed, sort
   * ("newest"|"oldest"|"relevance"). Withdrawn reports are never returned.
   */
  function search(f) {
    f = f || {};
    const qTokens = tokens(f.q || "");
    const visible = new Set(["open", "matched"]);
    if (f.includeClosed) { visible.add("claimed"); visible.add("returned"); }

    const rows = [];
    CF.db.items().forEach(function (item) {
      if (!visible.has(item.status)) return;
      if ((f.type === "lost" || f.type === "found") && item.type !== f.type) return;
      if (f.category && item.category !== f.category) return;
      if (f.location && item.location !== f.location) return;
      const day = CF.util.toDayStr(item.dateOccurred);
      if (f.from && (!day || day < f.from)) return;
      if (f.to && (!day || day > f.to)) return;
      let relevance = 0;
      if (qTokens.length) {
        relevance = relevanceOf(item, qTokens);
        if (!relevance) return;
      }
      rows.push({ item, relevance });
    });

    const newer = (a, b) => new Date(b.item.createdAt) - new Date(a.item.createdAt);
    const sort = f.sort === "relevance" && !qTokens.length ? "newest" : f.sort || (qTokens.length ? "relevance" : "newest");
    if (sort === "oldest") rows.sort((a, b) => -newer(a, b));
    else if (sort === "relevance") rows.sort((a, b) => b.relevance - a.relevance || newer(a, b));
    else rows.sort(newer);

    return { results: rows, tokens: qTokens, sort };
  }

  CF.match = { THRESHOLD, tokens, score, tierOf, candidatesFor, sync, syncAll, search };
})(typeof window !== "undefined" ? window : globalThis);
