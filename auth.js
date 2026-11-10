/* ==========================================================================
   CampusFind — authentication & role guards (Day 1)
   Requires app.js. Exposes CF.auth.
   ========================================================================== */
(function (global) {
  "use strict";
  const CF = global.CF;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^(\+?63|0)9\d{9}$/;

  function passwordError(pw) {
    if (pw.length < 8) return "Use at least 8 characters.";
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Include at least one letter and one number.";
    return "";
  }

  const auth = {
    /** The signed-in user, or null. Disabled accounts are treated as signed out. */
    currentUser() {
      const session = CF.storage.get(CF.KEYS.session, null);
      if (!session || !session.userId) return null;
      const user = CF.db.userById(session.userId);
      return user && user.status === "active" ? user : null;
    },

    isAdmin(user) {
      return !!user && user.role === "admin";
    },

    // Keep a non-sensitive user profile in localStorage for the existing UI.
    // Password hashes are never sent by the PHP authentication endpoints.
    cacheServerUser(user) {
      const users = CF.db.users().filter((u) => u.id !== user.id);
      users.push(user);
      CF.db.saveUsers(users);
      CF.storage.set(CF.KEYS.session, { userId: user.id, at: new Date().toISOString() });
    },

    /** Where a user lands after signing in. `root` is the relative path back to site root. */
    homeFor(user, root) {
      return (root || "") + (auth.isAdmin(user) ? "admin/dashboard.html" : "index.html");
    },

    login(email, password) {
      const errors = {};
      const cleanEmail = String(email || "").trim().toLowerCase();
      if (!cleanEmail) errors.email = "Enter your email address.";
      else if (!EMAIL_RE.test(cleanEmail)) errors.email = "That doesn't look like a valid email.";
      if (!password) errors.password = "Enter your password.";
      if (Object.keys(errors).length) return { ok: false, errors };

      return fetch((document.body.dataset.root || "") + "api/auth/login.php", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, password })
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.ok) return { ok: false, errors: {}, message: result.message || "Unable to log in." };
        auth.cacheServerUser(result.user);
        return { ok: true, user: result.user };
      }).catch(() => ({ ok: false, errors: {}, message: "Cannot reach the server. Check that Apache and MySQL are running." }));
    },

    logout() {
      fetch((document.body.dataset.root || "") + "api/auth/logout.php", {
        method: "POST", credentials: "same-origin", keepalive: true
      }).catch(() => {});
      CF.storage.remove(CF.KEYS.session);
    },

    validateRegistration(data) {
      const errors = {};
      const name = String(data.name || "").trim();
      const email = String(data.email || "").trim().toLowerCase();
      const contact = String(data.contact || "").replace(/[\s-]/g, "");
      const role = data.role;

      if (name.length < 3) errors.name = "Enter your full name (at least 3 characters).";
      if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";

      if (!role || !CF.ROLES[role] || !CF.ROLES[role].registrable) errors.role = "Choose how you are part of the campus.";
      if (!String(data.idNumber || "").trim()) errors.idNumber = "Enter your school or employee ID number.";
      if (!PHONE_RE.test(contact)) errors.contact = "Enter a valid PH mobile number (e.g. 09171234567).";

      const pw = String(data.password || "");
      const pwError = passwordError(pw);
      if (pwError) errors.password = pwError;
      if (data.confirm !== pw) errors.confirm = "Passwords do not match.";

      return { errors, clean: { name, email, contact, role, idNumber: String(data.idNumber || "").trim(), password: pw, confirm: String(data.confirm || "") } };
    },

    /** Creates the account and signs the user in. */
    register(data) {
      const { errors, clean } = auth.validateRegistration(data);
      if (Object.keys(errors).length) return { ok: false, errors };

      return fetch((document.body.dataset.root || "") + "api/auth/register.php", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean)
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.ok) return { ok: false, errors: result.errors || {}, message: result.message || "Unable to create your account." };
        auth.cacheServerUser(result.user);
        return { ok: true, user: result.user };
      }).catch(() => ({ ok: false, errors: {}, message: "Cannot reach the server. Check that Apache and MySQL are running." }));
    },

    /** Edits the signed-in person's own name, ID number and mobile number. Email and role stay fixed. */
    updateProfile(userId, data) {
      const name = String(data.name || "").trim();
      const contact = String(data.contact || "").replace(/[\s-]/g, "");
      const idNumber = String(data.idNumber || "").trim();
      const errors = {};
      if (name.length < 3) errors.name = "Enter your full name (at least 3 characters).";
      if (!idNumber) errors.idNumber = "Enter your school or employee ID number.";
      if (!PHONE_RE.test(contact)) errors.contact = "Enter a valid PH mobile number (e.g. 09171234567).";
      if (Object.keys(errors).length) return { ok: false, errors };
      const users = CF.db.users();
      const u = users.find((x) => x.id === userId);
      if (!u) return { ok: false, errors: {}, message: "Account not found." };
      const before = JSON.stringify(users);
      u.name = name.slice(0, 80); u.contact = contact; u.idNumber = idNumber.slice(0, 30);
      if (!CF.db.saveUsers(users)) { CF.db.saveUsers(JSON.parse(before)); return { ok: false, errors: {}, message: "Your browser's storage is full, so this change wasn't saved." }; }
      return { ok: true, user: u };
    },

    changePassword(userId, current, next, confirm) {
      const users = CF.db.users();
      const u = users.find((x) => x.id === userId);
      if (!u) return { ok: false, errors: {}, message: "Account not found." };
      const errors = {};
      if (u.passwordHash !== CF.util.hash(String(current || ""))) errors.current = "That isn't your current password.";
      const pw = String(next || "");
      const pwError = passwordError(pw);
      if (pwError) errors.next = pwError;
      else if (pw === String(current || "")) errors.next = "Choose a password different from the current one.";
      if (confirm !== pw) errors.confirm = "Passwords do not match.";
      if (Object.keys(errors).length) return { ok: false, errors };
      const before = JSON.stringify(users);
      u.passwordHash = CF.util.hash(pw);
      if (!CF.db.saveUsers(users)) { CF.db.saveUsers(JSON.parse(before)); return { ok: false, errors: {}, message: "Your browser's storage is full, so this change wasn't saved." }; }
      return { ok: true };
    },

    /** Login URL that returns the visitor to the current page (including its query string) afterwards. */
    loginUrl(root) {
      const here = global.location.pathname.split("/").pop() || "index.html";
      const next = (root ? "admin/" : "") + here + (global.location.search || "");
      return (root || "") + "login.html?next=" + encodeURIComponent(next);
    },

    /** Only follow ?next= to a same-site .html page, optionally with a plain query string (no schemes, no protocol-relative URLs). */
    safeNext(raw) {
      if (!raw) return null;
      if (/^[a-z]+:|^\/\/|\.\./i.test(raw)) return null;
      return /^[\w\-/]+\.html(\?[\w\-=&%.]*)?$/.test(raw) ? raw : null;
    },

    /**
     * Page guard. `allowed` is "any" (signed-in) or an array of roles.
     * Redirects to login (with ?next=) or to the user's own home. Returns the user, or null if redirecting.
     */
    requireRole(allowed, root) {
      const user = auth.currentUser();
      if (!user) {
        global.location.replace(auth.loginUrl(root));
        return null;
      }
      if (allowed !== "any" && allowed.indexOf(user.role) === -1) {
        global.location.replace(auth.homeFor(user, root));
        return null;
      }
      return user;
    },
  };

  CF.auth = auth;
})(typeof window !== "undefined" ? window : globalThis);
