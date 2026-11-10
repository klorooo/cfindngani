/* ==========================================================================
   CampusFind — lost / found report form controller (Day 2)
   Used by report-lost.html and report-found.html:
     <div id="report-root" data-type="lost|found"></div>
   ========================================================================== */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;
  const root = document.getElementById("report-root");
  const type = root.dataset.type === "found" ? "found" : "lost";

  const COPY = {
    lost: {
      eyebrow: "Lost something?",
      title: "Report a lost item",
      lede: "The more detail you give, the easier it is to match your item with something that has been found.",
      locationLabel: "Where do you think you lost it?",
      dateLabel: "When did you lose it?",
      descPlaceholder: "e.g. Black bi-fold leather wallet, slightly worn at the corners. Contains my student ID.",
      marksHint: "Scratches, stickers, engraved initials, serial or IMEI numbers. Only you and administrators can see this.",
      marksPlaceholder: "e.g. Sticker of a cat on the back, crack on the lower-left corner",
      submit: "Submit lost report",
      btn: "btn-lost",
      tips: [
        "Add a photo if you have one — even an older picture of the same item helps.",
        "Mention marks, stickers or serial numbers that prove it's yours.",
        "Check <strong>My Reports</strong> later: possible matches will show up there.",
      ],
    },
    found: {
      eyebrow: "Found something?",
      title: "Report a found item",
      lede: "Thank you for helping a classmate or colleague. Describe what you found and where it is now.",
      locationLabel: "Where did you find it?",
      dateLabel: "When did you find it?",
      descPlaceholder: "e.g. Black bi-fold wallet found on a table near the canteen counter.",
      marksHint: "Something only the real owner would know (a sticker, what's inside, a scratch). Kept private — administrators use it to verify claims. Don't repeat it in the description.",
      marksPlaceholder: "e.g. Photo of a dog inside the card slot",
      submit: "Submit found report",
      btn: "btn-found",
      tips: [
        "Hand the item in to the guard house or administration office when you can.",
        "Photograph it on a plain background, but leave out private details like ID numbers.",
        "Keep one identifying detail out of the public description so the owner can prove it's theirs.",
      ],
    },
  }[type];

  const today = CF.util.todayStr();
  const oldest = (function () {
    const d = CF.util.parseDate(today);
    d.setDate(d.getDate() - CF.reports.LIMITS.maxPastDays);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  })();

  const options = (list, placeholder) =>
    '<option value="">' + esc(placeholder) + "</option>" + list.map((v) => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");

  function render() {
    const foundOnly =
      type === "found"
        ? '<div class="field"><label for="storedAt">Where is the item now?</label>' +
          '<select class="select" id="storedAt" name="storedAt" required>' + options(CF.reports.HOLDING_PLACES, "Select…") + "</select>" +
          '<div class="hint">Owners will be told where to go to claim it.</div><div class="field-error" aria-live="polite"></div></div>'
        : "";

    root.innerHTML =
      '<div class="report-head"><p class="eyebrow">' + esc(COPY.eyebrow) + "</p><h1>" + esc(COPY.title) + '</h1><p class="lede muted">' + esc(COPY.lede) + "</p></div>" +
      '<div class="report-layout">' +
      '<form id="report-form" class="card form" novalidate>' +
      '<div id="form-alert" class="alert" role="alert" hidden></div>' +

      '<fieldset class="fieldset"><legend>The item</legend>' +
      '<div class="field"><label for="title">Item name</label>' +
      '<input class="input" id="title" name="title" maxlength="80" placeholder="e.g. Black wallet" required>' +
      '<div class="field-error" aria-live="polite"></div></div>' +
      '<div class="form-row">' +
      '<div class="field"><label for="category">Category</label><select class="select" id="category" name="category" required>' + options(CF.db.categories(), "Select…") + "</select>" +
      '<div class="field-error" aria-live="polite"></div></div>' +
      '<div class="field"><label for="color">Colour <span class="muted">(optional)</span></label><input class="input" id="color" name="color" maxlength="30" placeholder="e.g. Black">' +
      '<div class="field-error" aria-live="polite"></div></div></div>' +
      '<div class="field"><label for="brand">Brand <span class="muted">(optional)</span></label><input class="input" id="brand" name="brand" maxlength="40" placeholder="e.g. Casio">' +
      '<div class="field-error" aria-live="polite"></div></div>' +
      "</fieldset>" +

      '<fieldset class="fieldset"><legend>Where &amp; when</legend>' +
      '<div class="form-row">' +
      '<div class="field"><label for="location">' + esc(COPY.locationLabel) + '</label><select class="select" id="location" name="location" required>' + options(CF.db.locations(), "Select…") + "</select>" +
      '<div class="field-error" aria-live="polite"></div></div>' +
      '<div class="field"><label for="dateOccurred">' + esc(COPY.dateLabel) + '</label><input class="input" type="date" id="dateOccurred" name="dateOccurred" min="' + oldest + '" max="' + today + '" value="' + today + '" required>' +
      '<div class="field-error" aria-live="polite"></div></div></div>' +
      '<div class="field"><label for="locationDetail">More about the place <span class="muted">(optional)</span></label><input class="input" id="locationDetail" name="locationDetail" maxlength="120" placeholder="e.g. Room 204, second row near the window">' +
      '<div class="field-error" aria-live="polite"></div></div>' +
      foundOnly +
      "</fieldset>" +

      '<fieldset class="fieldset"><legend>Details</legend>' +
      '<div class="field"><label for="description">Description</label>' +
      '<textarea class="textarea" id="description" name="description" rows="4" maxlength="500" placeholder="' + esc(COPY.descPlaceholder) + '" required></textarea>' +
      '<div class="counter"><span class="field-error" aria-live="polite"></span><span id="desc-count" class="muted">0 / 500</span></div></div>' +
      '<div class="field"><label for="identifyingMarks">Identifying marks <span class="muted">(optional, private)</span></label>' +
      '<input class="input" id="identifyingMarks" name="identifyingMarks" maxlength="200" placeholder="' + esc(COPY.marksPlaceholder) + '">' +
      '<div class="hint">' + esc(COPY.marksHint) + '</div><div class="field-error" aria-live="polite"></div></div>' +
      "</fieldset>" +

      '<fieldset class="fieldset"><legend>Photo <span class="muted" style="font-weight:400">(optional)</span></legend>' +
      '<div class="field"><div class="photo-drop" id="photo-drop">' +
      '<input type="file" id="photo" name="photo" accept="image/jpeg,image/png,image/webp" class="sr-only">' +
      '<label for="photo" class="photo-label" id="photo-label"><strong>Choose a photo</strong><span class="muted">JPG, PNG or WebP · resized automatically</span></label>' +
      '<div class="photo-preview" id="photo-preview" hidden><img alt="Preview of the chosen photo"><button class="btn btn-ghost" type="button" id="photo-remove">Remove photo</button></div>' +
      "</div>" +
      '<div class="field-error" id="photo-error" aria-live="polite"></div></div>' +
      "</fieldset>" +

      '<div class="form-actions"><button class="btn ' + COPY.btn + ' btn-lg" type="submit" id="submit-btn">' + esc(COPY.submit) + "</button>" +
      '<a class="btn btn-ghost btn-lg" href="index.html">Cancel</a></div>' +
      "</form>" +

      '<aside class="card tips" aria-label="Tips"><h3>Quick tips</h3><ul>' + COPY.tips.map((t) => "<li>" + t + "</li>").join("") + "</ul></aside>" +
      "</div>";
  }

  function init() {
    render();
    const form = document.getElementById("report-form");
    const alertBox = document.getElementById("form-alert");
    const submitBtn = document.getElementById("submit-btn");
    const photoInput = document.getElementById("photo");
    const preview = document.getElementById("photo-preview");
    const photoLabel = document.getElementById("photo-label");
    const photoError = document.getElementById("photo-error");
    let photoData = null;
    let busy = false;

    const FIELDS = ["title", "category", "color", "brand", "location", "locationDetail", "dateOccurred", "storedAt", "description", "identifyingMarks"];

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
      const data = { photo: photoData };
      FIELDS.forEach(function (n) { if (form.elements[n]) data[n] = form.elements[n].value; });
      return data;
    }

    // live character counter
    const desc = form.elements.description;
    const count = document.getElementById("desc-count");
    desc.addEventListener("input", function () { count.textContent = desc.value.length + " / 500"; });

    // validate on blur for quick feedback (only fields the user has touched)
    FIELDS.forEach(function (n) {
      const el = form.elements[n];
      if (!el) return;
      el.addEventListener("blur", function () {
        const errors = CF.reports.validate(type, collect()).errors;
        setError(n, errors[n]);
      });
    });

    function setPhoto(dataUrl) {
      photoData = dataUrl;
      const has = !!dataUrl;
      preview.hidden = !has;
      photoLabel.hidden = has;
      if (has) preview.querySelector("img").src = dataUrl;
      else photoInput.value = "";
    }

    photoInput.addEventListener("change", function () {
      photoError.textContent = "";
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      busy = true;
      submitBtn.disabled = true;
      photoLabel.querySelector("strong").textContent = "Processing photo…";
      CF.reports.compressImage(file).then(
        function (dataUrl) {
          busy = false; submitBtn.disabled = false;
          photoLabel.querySelector("strong").textContent = "Choose a photo";
          setPhoto(dataUrl);
        },
        function (err) {
          busy = false; submitBtn.disabled = false;
          photoLabel.querySelector("strong").textContent = "Choose a photo";
          photoInput.value = "";
          photoError.textContent = err.message;
        }
      );
    });
    document.getElementById("photo-remove").addEventListener("click", function () { setPhoto(null); photoError.textContent = ""; });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      alertBox.hidden = true;
      const user = CF.auth.currentUser();
      const result = CF.reports.create(type, collect(), user);

      FIELDS.forEach(function (n) { setError(n, result.errors && result.errors[n]); });
      photoError.textContent = (result.errors && result.errors.photo) || "";

      if (!result.ok) {
        alertBox.className = "alert alert-error";
        alertBox.textContent = result.message || "Please fix the highlighted fields and try again.";
        alertBox.hidden = false;
        const firstBad = form.querySelector(".has-error input, .has-error select, .has-error textarea");
        if (firstBad) firstBad.focus(); else alertBox.scrollIntoView({ block: "center" });
        return;
      }
      submitBtn.disabled = true;
      if (CF.match) CF.match.sync(result.item, { notify: true }); // store suggestions now and alert the owners of matching reports
      window.location.href = "item-details.html?id=" + encodeURIComponent(result.item.id) + "&created=1";
    });
  }

  document.addEventListener("cf:ready", init);
})();
