<?php
declare(strict_types=1);
require_once __DIR__ . '/common.php';
require_once __DIR__ . '/../../config/database.php';
require_post();
$data = request_data();

$name = trim((string)($data['name'] ?? ''));
$email = strtolower(trim((string)($data['email'] ?? '')));
$role = (string)($data['role'] ?? '');
$idNumber = trim((string)($data['idNumber'] ?? ''));
$contact = preg_replace('/[\s-]/', '', (string)($data['contact'] ?? ''));
$password = (string)($data['password'] ?? '');
$confirm = (string)($data['confirm'] ?? '');
$allowedRoles = ['student', 'faculty', 'guard', 'maintenance'];
$errors = [];

if (mb_strlen($name) < 3 || mb_strlen($name) > 100) $errors['name'] = 'Enter your full name (3 to 100 characters).';
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) $errors['email'] = 'Enter a valid email address.';
if (!in_array($role, $allowedRoles, true)) $errors['role'] = 'Choose a valid campus role.';
if ($idNumber === '' || mb_strlen($idNumber) > 40) $errors['idNumber'] = 'Enter your school or employee ID number.';
if (!preg_match('/^(\+?63|0)9\d{9}$/', $contact)) $errors['contact'] = 'Enter a valid PH mobile number (e.g. 09171234567).';
if (strlen($password) < 8 || !preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password)) $errors['password'] = 'Use at least 8 characters, including a letter and a number.';
if ($password !== $confirm) $errors['confirm'] = 'Passwords do not match.';
if ($errors) json_response(['ok' => false, 'errors' => $errors], 422);

$check = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
$check->execute(['email' => $email]);
if ($check->fetch()) json_response(['ok' => false, 'errors' => ['email' => 'That email is already registered.']], 409);

$id = 'u_' . bin2hex(random_bytes(16));
$hash = password_hash($password, PASSWORD_DEFAULT);
try {
    $insert = $pdo->prepare("INSERT INTO users (id, name, email, role, id_number, contact, password_hash, status) VALUES (:id, :name, :email, :role, :id_number, :contact, :password_hash, 'active')");
    $insert->execute([
        'id' => $id, 'name' => $name, 'email' => $email, 'role' => $role,
        'id_number' => $idNumber, 'contact' => $contact, 'password_hash' => $hash,
    ]);
} catch (PDOException $e) {
    if ($e->getCode() === '23000') json_response(['ok' => false, 'errors' => ['email' => 'That email is already registered.']], 409);
    error_log('CampusFind registration failed: ' . $e->getMessage());
    json_response(['ok' => false, 'message' => 'Unable to create your account right now.'], 500);
}

$stmt = $pdo->prepare('SELECT id, name, email, role, id_number, contact, status, created_at FROM users WHERE id = :id');
$stmt->execute(['id' => $id]);
$user = $stmt->fetch();
session_regenerate_id(true);
$_SESSION['user_id'] = $id;
$_SESSION['user_role'] = $role;
json_response(['ok' => true, 'user' => public_user($user)], 201);
