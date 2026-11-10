/* Login page controller */
(function () {
  "use strict";
  const CF = window.CF;
  const form = document.getElementById("login-form");
  const alertBox = document.getElementById("form-alert");
  const params = new URLSearchParams(window.location.search);

  // Already signed in? Skip the form.
  const existing = CF.auth.currentUser();
  if (existing) { window.location.replace(CF.auth.homeFor(existing, "")); return; }

  if (params.get("loggedout")) showAlert("info", "You have been logged out.");
  if (params.get("registered")) showAlert("success", "Account created. You can log in now.");

  function showAlert(kind, text) {
    alertBox.className = "alert alert-" + kind;
    alertBox.textContent = text;
    alertBox.hidden = false;
  }

  function setFieldError(name, message) {
    const input = form.elements[name];
    const field = input.closest(".field");
    const slot = field.querySelector(".field-error");
    field.classList.toggle("has-error", !!message);
    input.setAttribute("aria-invalid", message ? "true" : "false");
    slot.textContent = message || "";
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    alertBox.hidden = true;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const result = await CF.auth.login(form.elements.email.value, form.elements.password.value);
    submitButton.disabled = false;
    setFieldError("email", result.errors && result.errors.email);
    setFieldError("password", result.errors && result.errors.password);

    if (!result.ok) {
      if (result.message) showAlert("error", result.message);
      return;
    }
    const next = CF.auth.safeNext(params.get("next"));
    const isAdmin = CF.auth.isAdmin(result.user);
    // keep admins in admin pages and users out of them
    const allowedNext = next && (isAdmin ? next.indexOf("admin/") === 0 : next.indexOf("admin/") !== 0) ? next : null;
    window.location.href = allowedNext || CF.auth.homeFor(result.user, "");
  });

  // password visibility toggle
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
