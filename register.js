/* Registration page controller */
(function () {
  "use strict";
  const CF = window.CF;
  const form = document.getElementById("register-form");
  const alertBox = document.getElementById("form-alert");

  const existing = CF.auth.currentUser();
  if (existing) { window.location.replace(CF.auth.homeFor(existing, "")); return; }

  // Build the role picker from the single source of truth in app.js
  const picker = document.getElementById("role-picker");
  picker.innerHTML = Object.keys(CF.ROLES)
    .filter(function (k) { return CF.ROLES[k].registrable; })
    .map(function (k) {
      const r = CF.ROLES[k];
      return (
        '<label class="role-option"><input type="radio" name="role" value="' + k + '">' +
        "<span>" + CF.util.escapeHtml(r.label) + "<small>" + CF.util.escapeHtml(r.hint) + "</small></span></label>"
      );
    })
    .join("");

  const FIELDS = ["name", "email", "role", "idNumber", "contact", "password", "confirm"];

  function setFieldError(name, message) {
    let field;
    if (name === "role") field = document.getElementById("role-field");
    else field = form.elements[name].closest(".field");
    field.classList.toggle("has-error", !!message);
    field.querySelector(".field-error").textContent = message || "";
    if (name !== "role") form.elements[name].setAttribute("aria-invalid", message ? "true" : "false");
  }

  function collect() {
    const checked = form.querySelector('input[name="role"]:checked');
    return {
      name: form.elements.name.value,
      email: form.elements.email.value,
      role: checked ? checked.value : "",
      idNumber: form.elements.idNumber.value,
      contact: form.elements.contact.value,
      password: form.elements.password.value,
      confirm: form.elements.confirm.value,
    };
  }

  // ID label adapts to the chosen role
  picker.addEventListener("change", function () {
    const role = form.querySelector('input[name="role"]:checked').value;
    const label = document.getElementById("id-label");
    label.textContent = role === "student" ? "Student number" : "Employee ID number";
    setFieldError("role", "");
  });

  // validate a single field on blur for quick feedback
  FIELDS.forEach(function (name) {
    if (name === "role") return;
    form.elements[name].addEventListener("blur", function () {
      const probe = CF.auth.validateRegistration(collect()).errors;
      // don't nag about untouched later fields
      if (form.elements[name].value || probe[name] === undefined) setFieldError(name, probe[name]);
    });
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    alertBox.hidden = true;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const result = await CF.auth.register(collect());
    submitButton.disabled = false;
    FIELDS.forEach(function (name) { setFieldError(name, result.errors && result.errors[name]); });

    if (!result.ok) {
      alertBox.className = "alert alert-error";
      alertBox.textContent = result.message || "Please fix the highlighted fields and try again.";
      alertBox.hidden = false;
      const firstBad = form.querySelector(".has-error input, .has-error select");
      if (firstBad) firstBad.focus();
      return;
    }
    window.location.href = CF.auth.homeFor(result.user, "") + "?welcome=1";
  });

  document.querySelectorAll(".pw-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const input = btn.parentElement.querySelector("input");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
      btn.setAttribute("aria-pressed", String(show));
    });
  });
})();
