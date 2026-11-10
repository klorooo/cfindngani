# CampusFind PHP + MySQL authentication setup

This is the first gradual-conversion stage. The existing HTML/CSS interface and current localStorage-based modules are retained. Login and registration now use PHP endpoints and the MySQL `users` table. The PHP session is the server-side login session; a minimal profile cache in localStorage keeps the existing frontend navigation working while the remaining modules are converted.

## 1. Install the project in XAMPP

1. Extract the complete CampusFind project folder into `C:\xampp\htdocs\campusfind`.
2. Start **Apache** and **MySQL** in XAMPP Control Panel.
3. Open `http://localhost/phpmyadmin`.
4. Import the supplied `campusfind_database.sql` file using the **Import** tab.
5. Confirm that the database named `campusfind` appears and contains the `users` table.

## 2. Check the database connection

Open `config/database.php`. The default XAMPP settings are:

- Host: `127.0.0.1`
- Database: `campusfind`
- Username: `root`
- Password: blank

If you configured a MySQL root password, enter it in `$password`.

## 3. Create the first administrator

Do not register an administrator from the public registration form. Admin is deliberately excluded from the allowed registration roles.

Open Command Prompt and run:

```bat
cd C:\xampp\htdocs\campusfind
C:\xampp\php\php.exe scripts\create_admin.php
```

Enter an email, name, and a strong password when prompted. The password is stored using PHP `password_hash()`.

## 4. Open CampusFind

Use `http://localhost/campusfind/` rather than opening the HTML files by double-clicking them. PHP endpoints only work through Apache.

Try creating a regular Student, Faculty, Guard, or Maintenance account. Then log out and log back in. Verify the account in phpMyAdmin under `campusfind` > `users`.

## 5. Authentication files added

- `config/database.php` - PDO connection to MySQL.
- `api/auth/register.php` - validates and creates a user account.
- `api/auth/login.php` - verifies the password and starts a PHP session.
- `api/auth/me.php` - returns the signed-in user's safe profile.
- `api/auth/logout.php` - destroys the PHP session.
- `api/auth/common.php` - shared JSON and session helpers.
- `scripts/create_admin.php` - creates the first administrator from the command line.

## Important current-stage limitation

The existing report, claim, match, notification, and profile modules still use localStorage. This stage does not yet make those records shared across devices. Also, static HTML pages are not yet protected by server-side page guards. In the next stages, each data API must check the PHP session and role before reading or changing records, and the remaining modules will be migrated to MySQL. Do not treat the prototype as production-ready or publish it with real personal data until those protections and the remaining modules are completed.

For deployment, replace the local database credentials with hosting credentials, enable HTTPS, use a non-root database user, and keep error details out of public responses.
