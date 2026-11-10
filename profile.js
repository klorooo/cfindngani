/* My Profile: edit your own details, change your password, see your activity. */
(function () {
  "use strict";
  const CF = window.CF;
  const esc = CF.util.escapeHtml;

  document.addEventListener("cf:ready", function (e) {
    let user = e.detail.user;
    const role = CF.ROLES[user.role];
    const pf = document.getElementById("profile-form"), pw = document.getElementById("password-form");

    function setError(form, name, message) {
      const field = form.elements[name].closest(".field");
      field.classList.toggle("has-error", !!message);
      field.querySelector(".field-error").textContent = message || "";
      form.elements[name].setAttribute("aria-invalid", message ? "true" : "false");
    }
    function clear(form, alertEl) { Array.prototype.forEach.call(form.elements, function (el) { if (el.name) setError(form, el.name, ""); }); alertEl.hidden = true; }
    function showErrors(form, alertEl, res) {
      Object.keys(res.errors || {}).forEach(function (k) { setError(form, k, res.errors[k]); });
      alertEl.textContent = res.message || "Please fix the highlighted fields.";
      alertEl.className = "alert alert-error"; alertEl.hidden = false;
      const first = form.querySelector(".has-error input");
      if (first) first.focus();
    }

    function fill() {
      document.getElementById("profile-sub").textContent = "Signed in as " + user.name + " · " + (role ? role.label : user.role);
      document.getElementById("p-email").value = user.email;
      document.getElementById("p-role").value = role ? role.label : user.role;
      document.getElementById("p-name").value = user.name;
      document.getElementById("p-id").value = user.idNumber || "";
      document.getElementById("p-contact").value = user.contact || "";
      document.getElementById("p-id-label").textContent = user.role === "student" ? "Student ID number" : "Employee ID number";
      const mine = CF.db.items().filter((i) => i.reporterId === user.id);
      const claims = CF.db.claims().filter((c) => c.claimantId === user.id);
      const tile = (n, label, href) => '<a class="stat" href="' + href + '"><div class="stat-num">' + n + '</div><div class="stat-label">' + esc(label) + "</div></a>";
      document.getElementById("profile-stats").innerHTML =
        tile(mine.filter((i) => i.type === "lost").length, "Lost reports", "my-reports.html") +
        tile(mine.filter((i) => i.type === "found").length, "Found reports", "my-reports.html") +
        tile(claims.length, "Claims", "my-claims.html") +
        tile(CF.notify.unreadCount(user.id), "Unread notifications", "notifications.html");
    }

    pf.addEventListener("submit", function (ev) {
      ev.preventDefault();
      const alertEl = document.getElementById("profile-alert");
      clear(pf, alertEl);
      const res = CF.auth.updateProfile(user.id, { name: pf.elements.name.value, idNumber: pf.elements.idNumber.value, contact: pf.elements.contact.value });
      if (!res.ok) { showErrors(pf, alertEl, res); return; }
      user = res.user; fill();
      CF.ui.toast("Profile saved.", "success");
      const hdr = document.querySelector(".avatar"); if (hdr) hdr.textContent = CF.util.initials(user.name);
    });

    pw.addEventListener("submit", function (ev) {
      ev.preventDefault();
      const alertEl = document.getElementById("password-alert");
      clear(pw, alertEl);
      const res = CF.auth.changePassword(user.id, pw.elements.current.value, pw.elements.next.value, pw.elements.confirm.value);
      if (!res.ok) { showErrors(pw, alertEl, res); return; }
      pw.reset();
      CF.ui.toast("Password updated.", "success");
    });

    fill();
  });
})();
