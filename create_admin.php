<?php
/** Run once from a terminal: php scripts/create_admin.php */
declare(strict_types=1);
require_once __DIR__ . '/../config/database.php';

$name = 'CampusFind Administrator';
$email = 'admin@campusfind.local';
$id = 'u_admin_' . bin2hex(random_bytes(6));
$password = '';
echo "Create the first CampusFind administrator\n";
echo "Email [{$email}]: ";
$input = trim((string)fgets(STDIN));
if ($input !== '') $email = strtolower($input);
echo "Full name [{$name}]: ";
$input = trim((string)fgets(STDIN));
if ($input !== '') $name = $input;
echo "Choose administrator password (input will be visible): ";
$password = trim((string)fgets(STDIN));
if (strlen($password) < 8 || !preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password)) {
    fwrite(STDERR, "Password must be at least 8 characters and contain a letter and a number.\n");
    exit(1);
}
$check = $pdo->prepare('SELECT id FROM users WHERE email = ?');
$check->execute([$email]);
if ($check->fetch()) { fwrite(STDERR, "That email already exists.\n"); exit(1); }
$stmt = $pdo->prepare("INSERT INTO users (id, name, email, role, id_number, contact, password_hash, status) VALUES (?, ?, ?, 'admin', 'ADMIN-001', '09000000000', ?, 'active')");
$stmt->execute([$id, $name, $email, password_hash($password, PASSWORD_DEFAULT)]);
echo "Administrator created: {$email}\n";
