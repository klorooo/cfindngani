<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';
require_once __DIR__ . '/../../config/database.php';
if (empty($_SESSION['user_id'])) json_response(['ok' => false, 'user' => null], 401);
$stmt = $pdo->prepare('SELECT id, name, email, role, id_number, contact, status, created_at FROM users WHERE id = :id LIMIT 1');
$stmt->execute(['id' => $_SESSION['user_id']]);
$user = $stmt->fetch();
if (!$user || $user['status'] !== 'active') {
    $_SESSION = [];
    session_destroy();
    json_response(['ok' => false, 'user' => null], 401);
}
json_response(['ok' => true, 'user' => public_user($user)]);
