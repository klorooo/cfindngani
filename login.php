<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';
require_once __DIR__ . '/../../config/database.php';
require_post();
$data = request_data();
$email = strtolower(trim((string)($data['email'] ?? '')));
$password = (string)($data['password'] ?? '');

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $password === '') {
    json_response(['ok' => false, 'message' => 'Enter a valid email address and password.'], 422);
}

$stmt = $pdo->prepare('SELECT id, name, email, role, id_number, contact, password_hash, status, created_at FROM users WHERE email = :email LIMIT 1');
$stmt->execute(['email' => $email]);
$user = $stmt->fetch();

if (!$user || !password_verify($password, $user['password_hash'])) {
    json_response(['ok' => false, 'message' => 'Incorrect email or password.'], 401);
}
if ($user['status'] !== 'active') {
    json_response(['ok' => false, 'message' => 'This account is disabled. Please contact the administrator.'], 403);
}

session_regenerate_id(true);
$_SESSION['user_id'] = $user['id'];
$_SESSION['user_role'] = $user['role'];
json_response(['ok' => true, 'user' => public_user($user)]);
