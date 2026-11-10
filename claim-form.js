/* ==========================================================================
   CampusFind — claim form controller (Day 4)
   claim-form.html?item=<id or reference of a found item>
   ========================================================================== */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const rootEl = document.getElementById("claim-root");

  function blocked(pill, title, message, href, label) {
    rootEl.innerHTML =
      '<div class="coming"><span class="pill">' + esc(pill) + '</span><h1 style="font-size:2rem">' + esc(title) + "</h1>" +
      '<p class="muted">' + esc(message) + '</p><a class="btn btn-primary" href="' + href + '">' + esc(label) + "</a></div>";
  }

  const options = (list, placeholder) =>
    '<option value="">' + esc(placeholder) + "</option>" + list.map((v) => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");

  function init(user) {
    const params = new URLSearchParams(window.location.search);
    const item = CF.reports.find(params.get("item"));
    const el = CF.claims.eligibility(item, user);

    if (!el.ok) {
      if (el.code === "active") return blocked("Already claimed", "You already have a claim on this item", el.message, "claim-details.html?id=" + encodeURIComponent(el.claim.id), "View claim " + el.claim.ref);
      if (el.code === "own") return blocked("Your report", "This is your own report", el.message, "item-details.html?id=" + encodeURIComponent(item.id), "View my report");
      if (el.code === "notfound") return blocked("Not found", "We couldn't find that item", "The link may be wrong, or the report was removed.", "search.html?type=found", "Search found items");
      return blocked("Unavailable", "This item can't be claimed", el.message, "search.html?type=found", "Search found items");
    }

    document.title = "Claim: " + item.title + " — CampusFind";
    const today = CF.util.todayStr();
    const foundDay = CF.util.toDayStr(item.dateOccurred);
    const maxLost = foundDay && foundDay < today ? foundDay : today; // it can't have been lost after it was found
    const oldest = (function () {
      const d = CF.util.parseDate(today);
      d.setDate(d.getDate() - CF.claims.LIMITS.maxPastDays);
      return CF.util.toDayStr(d);
    })();

    // the user's own open lost reports; pre-select the one that best matches this found item
    const myLost = CF.reports.forUser(user.id).filter((i) => i.type === "lost" && (i.status === "open" || i.status === "matched"));
    const best = myLost
      .map((l) => ({ l, hit: CF.match.candidatesFor(l).find((c) => c.item.id === item.id) }))
      .filter((x) => x.hit)
      .sort((a, b) => b.hit.score - a.hit.score)[0];
    const suggested = best ? best.l : null;

    const lostOptions =
      '<option value="">None — I haven\'t filed a lost report</option>' +
      myLost.map((l) => '<option value="' + esc(l.id) + '">' + esc(l.ref + " · " + l.title) + "</option>").join("");

    rootEl.innerHTML =
      '<div class="report-head"><p class="eyebrow">Claim an item</p><h1>Prove it\'s yours</h1>' +
      '<p class="lede muted">Answer a few questions only the real owner could answer. An administrator checks your answers against the finder\'s private notes before anything is handed over.</p></div>' +
      '<div class="report-layout">' +
      '<form id="claim-form" class="card form" novalidate>' +
      '<div id="form-alert" class="alert" role="alert" hidden></div>' +

      '<fieldset class="fieldset"><legend>About your item</legend>' +
      '<div class="field"><label for="description">Describe it in your own words</label>' +
      '<textarea class="textarea" id="description" name="description" rows="4" maxlength="500" placeholder="Brand, size, colour, condition, what it looks like — details that aren\'t in the public listing." required></textarea>' +
      '<div class="counter"><span class="field-error" aria-live="polite"></span><span id="desc-count" class="muted">0 / 500</span></div></div>' +
      '<div class="field"><label for="proofDetails">What\'s inside, or what marks it as yours?</label>' +
      '<textarea class="textarea" id="proofDetails" name="proofDetails" rows="3" maxlength="300" placeholder="e.g. A sticker on the back, a name written inside, what is in the pockets, a scratch or dent." required></textarea>' +
      '<div class="hint">Only something the owner would know. This stays private.</div><div class="field-error" aria-live="polite"></div></div>' +
      "</fieldset>" +

      '<fieldset class="fieldset"><legend>When &amp; where you lost it</legend>' +
      '<div class="field"><label for="lostReportId">Link your lost report <span class="muted">(optional)</span></label>' +
      '<select class="select" id="lostReportId" name="lostReportId">' + lostOptions + "</select>" +
      '<div class="hint" id="link-hint">' + (suggested ? "We picked the report that best matches this item and filled in the date and place. Change anything that's wrong." : "Linking a report helps the administrator verify your claim faster.") + "</div>" +
      '<div class="field-error" aria-live="polite"></div></div>' +
      '<div class="form-row">' +
      '<div class="field"><label for="lostDate">Date you lost it</label><input class="input" type="date" id="lostDate" name="lostDate" min="' + oldest + '" max="' + maxLost + '" required>' +
      '<div class="field-error" aria-live="polite"></div></div>' +
      '<div class="field"><label for="lostLocation">Where you lost it</label><select class="select" id="lostLocation" name="lostLocation" required>' + options(CF.db.locations(), "Select…") + "</select>" +
      '<div class="field-error" aria-live="polite"></div></div></div>' +
      "</fieldset>" +

      '<fieldset class="fieldset"><legend>Evidence <span class="muted" style="font-weight:400">(optional, up to 2 photos)</span></legend>' +
      '<div class="field"><div class="photo-drop">' +
      '<input type="file" id="evidence" accept="image/jpeg,image/png,image/webp" multiple class="sr-only">' +
      '<label for="evidence" class="photo-label" id="evidence-label"><strong>Add photos</strong><span class="muted">An older photo of you with it, a receipt or the box · resized automatically</span></label></div>' +
      '<ul class="evidence-list" id="evidence-list"></ul>' +
      '<div class="field-error" id="evidence-error" aria-live="polite"></div></div>' +
      "</fieldset>" +

      '<fieldset class="fieldset"><legend>Declaration</legend>' +
      '<div class="field"><label class="check"><input type="checkbox" id="declaration" name="declaration"> ' +
      "I confirm this item is mine and the information above is true. I understand that a false claim may be reported to the school.</label>" +
      '<div class="field-error" aria-live="polite"></div></div>' +
      "</fieldset>" +

      '<div class="form-actions"><button class="btn btn-primary btn-lg" type="submit" id="submit-btn">Submit claim</button>' +
      '<a class="btn btn-ghost btn-lg" href="item-details.html?id=' + encodeURIComponent(item.id) + '">Cancel</a></div>' +
      "</form>" +

      '<aside class="side-stack">' +
      '<div class="card claim-item-card"><div class="claim-item-thumb">' + CF.reports.thumbHtml(item) + "</div>" +
      '<div class="report-top"><span class="badge badge-found">Found</span></div>' +
      "<h3>" + esc(item.title) + "</h3>" +
      '<p class="meta">' + esc(item.ref) + " · " + esc(item.category) + "</p>" +
      '<p class="meta">Found at ' + esc(item.location) + " on " + esc(CF.util.formatDate(item.dateOccurred)) + "</p>" +
      (item.storedAt ? '<p class="meta">Currently: ' + esc(item.storedAt) + "</p>" : "") +
      '<a class="back-link" href="item-details.html?id=' + encodeURIComponent(item.id) + '" style="margin:10px 0 0">View full listing</a></div>' +
      '<div class="card tips"><h3>What happens next</h3><ul>' +
      "<li>An administrator reviews your answers.</li>" +
      "<li>They may ask you for more details — you'll get a notification.</li>" +
      "<li>If approved, you'll be told where and how to collect your item.</li>" +
      "<li>Other people may have claimed this item too; only one claim is approved.</li></ul></div>" +
      "</aside></div>";

    const form = document.getElementById("claim-form");
    const alertBox = document.getElementById("form-alert");
    const submitBtn = document.getElementById("submit-btn");
    const evInput = document.getElementById("evidence");
    const evLabel = document.getElementById("evidence-label");
    const evList = document.getElementById("evidence-list");
    const evError = document.getElementById("evidence-error");
    const FIELDS = ["description", "proofDetails", "lostReportId", "lostDate", "lostLocation", "declaration"];
    let evidence = [];
    let busy = false;

    function setError(name, message) {
      const input = form.elements[name];
      if (!input) return;
      const field = input.closest(".field");
      field.classList.toggle("has-error", !!message);
      input.setAttribute("aria-invalid", message ? "true" : "false");
      const slot = field.querySelector(".field-error");
      if (slot) slot.textContent = message || "";
    }

    function collect() {
      return {
        description: form.elements.description.value,
        proofDetails: form.elements.proofDetails.value,
        lostReportId: form.elements.lostReportId.value,
        lostDate: form.elements.lostDate.value,
        lostLocation: form.elements.lostLocation.value,
        evidence: evidence,
        declaration: form.elements.declaration.checked,
      };
    }

    // character counter
    const desc = form.elements.description;
    desc.addEventListener("input", function () { document.getElementById("desc-count").textContent = desc.value.length + " / 500"; });

    // fill the date and place from a linked lost report
    function applyLostReport(id) {
      const r = id ? CF.reports.find(id) : null;
      if (!r) return;
      const day = CF.util.toDayStr(r.dateOccurred);
      form.elements.lostDate.value = day && day > maxLost ? maxLost : day;
      form.elements.lostLocation.value = r.location;
      setError("lostDate", ""); setError("lostLocation", "");
    }
    form.elements.lostReportId.addEventListener("change", function () { applyLostReport(form.elements.lostReportId.value); });
    if (suggested) { form.elements.lostReportId.value = suggested.id; applyLostReport(suggested.id); }

    // validate on blur
    ["description", "proofDetails", "lostDate", "lostLocation"].forEach(function (n) {
      form.elements[n].addEventListener("blur", function () { setError(n, CF.claims.validate(item, collect(), user).errors[n]); });
    });

    /* ---------- evidence photos ---------- */
    function renderEvidence() {
      evList.innerHTML = evidence
        .map(function (src, i) {
          return '<li><img src="' + src + '" alt="Evidence photo ' + (i + 1) + '"><button type="button" class="btn btn-ghost btn-sm" data-remove="' + i + '">Remove</button></li>';
        })
        .join("");
      evLabel.hidden = evidence.length >= CF.claims.LIMITS.maxEvidence;
    }
    evList.addEventListener("click", function (e) {
      const b = e.target.closest("[data-remove]");
      if (!b) return;
      evidence.splice(Number(b.dataset.remove), 1);
      evError.textContent = "";
      renderEvidence();
    });
    evInput.addEventListener("change", async function () {
      evError.textContent = "";
      const files = Array.prototype.slice.call(evInput.files || []);
      evInput.value = "";
      if (!files.length) return;
      const room = CF.claims.LIMITS.maxEvidence - evidence.length;
      busy = true; submitBtn.disabled = true;
      evLabel.querySelector("strong").textContent = "Processing…";
      let problem = files.length > room ? "Only " + CF.claims.LIMITS.maxEvidence + " photos can be attached." : "";
      for (const f of files.slice(0, room)) {
        try { evidence.push(await CF.reports.compressImage(f, CF.claims.EVIDENCE_OPTS)); }
        catch (err) { problem = err.message; }
      }
      busy = false; submitBtn.disabled = false;
      evLabel.querySelector("strong").textContent = "Add photos";
      evError.textContent = problem;
      renderEvidence();
    });

    /* ---------- submit ---------- */
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      alertBox.hidden = true;
      const result = CF.claims.submit(item.id, collect(), user);
      FIELDS.forEach(function (n) { setError(n, result.errors && result.errors[n]); });
      evError.textContent = (result.errors && result.errors.evidence) || "";

      if (!result.ok) {
        alertBox.className = "alert alert-error";
        alertBox.textContent = result.message || "Please fix the highlighted fields and try again.";
        alertBox.hidden = false;
        const firstBad = form.querySelector(".has-error input, .has-error select, .has-error textarea");
        if (firstBad) firstBad.focus(); else alertBox.scrollIntoView({ block: "center" });
        return;
      }
      submitBtn.disabled = true;
      window.location.href = "claim-details.html?id=" + encodeURIComponent(result.claim.id) + "&created=1";
    });
  }

  document.addEventListener("cf:ready", function (e) { init(e.detail.user); });
})();
