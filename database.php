<?php
/** CampusFind PDO database connection. Update credentials for your hosting provider. */
declare(strict_types=1);

$host = '127.0.0.1';
$dbname = 'campusfind';
$username = 'root';
$password = ''; // Default XAMPP root password is usually blank.

$dsn = "mysql:host={$host};dbname={$dbname};charset=utf8mb4";
$options = [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
];

try {
    $pdo = new PDO($dsn, $username, $password, $options);
} catch (PDOException $e) {
    error_log('CampusFind database connection failed: ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => 'Unable to connect to the database. Check config/database.php.']);
    exit;
}
