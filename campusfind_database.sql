-- CampusFind database schema
-- Compatible with XAMPP MySQL / MariaDB
-- Import this file using phpMyAdmin > Import.

CREATE DATABASE IF NOT EXISTS campusfind
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE campusfind;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(60) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  role ENUM('student','faculty','guard','maintenance','admin') NOT NULL DEFAULT 'student',
  id_number VARCHAR(40) NOT NULL,
  contact VARCHAR(20) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS locations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS items (
  id VARCHAR(60) PRIMARY KEY,
  reference_no VARCHAR(20) NOT NULL UNIQUE,
  type ENUM('lost','found') NOT NULL,
  title VARCHAR(150) NOT NULL,
  category_id INT UNSIGNED NULL,
  location_id INT UNSIGNED NULL,
  location_detail VARCHAR(255) NULL,
  color VARCHAR(60) NULL,
  brand VARCHAR(100) NULL,
  description TEXT NOT NULL,
  identifying_marks TEXT NULL,
  stored_at VARCHAR(255) NULL,
  photo_path VARCHAR(500) NULL,
  date_occurred DATE NOT NULL,
  status ENUM('open','matched','claimed','returned','withdrawn') NOT NULL DEFAULT 'open',
  reporter_id VARCHAR(60) NOT NULL,
  removed_by_admin TINYINT(1) NOT NULL DEFAULT 0,
  removed_reason VARCHAR(200) NULL,
  removed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_items_reporter FOREIGN KEY (reporter_id) REFERENCES users(id),
  CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_items_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  INDEX idx_items_type_status (type, status),
  INDEX idx_items_reporter (reporter_id),
  INDEX idx_items_date (date_occurred)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS matches (
  id VARCHAR(60) PRIMARY KEY,
  lost_item_id VARCHAR(60) NOT NULL,
  found_item_id VARCHAR(60) NOT NULL,
  score DECIMAL(5,2) NOT NULL DEFAULT 0,
  status ENUM('suggested','confirmed','dismissed') NOT NULL DEFAULT 'suggested',
  confirmed_by VARCHAR(60) NULL,
  confirmed_at DATETIME NULL,
  dismissed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_match_pair (lost_item_id, found_item_id),
  CONSTRAINT fk_matches_lost FOREIGN KEY (lost_item_id) REFERENCES items(id),
  CONSTRAINT fk_matches_found FOREIGN KEY (found_item_id) REFERENCES items(id),
  CONSTRAINT fk_matches_admin FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_matches_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS claims (
  id VARCHAR(60) PRIMARY KEY,
  reference_no VARCHAR(20) NOT NULL UNIQUE,
  item_id VARCHAR(60) NOT NULL,
  claimant_id VARCHAR(60) NOT NULL,
  linked_lost_item_id VARCHAR(60) NULL,
  status ENUM('pending','needs_info','approved','rejected','returned','cancelled') NOT NULL DEFAULT 'pending',
  description TEXT NOT NULL,
  proof_details TEXT NOT NULL,
  lost_date DATE NULL,
  lost_location VARCHAR(150) NULL,
  evidence_paths TEXT NULL COMMENT 'JSON array of uploaded evidence file paths',
  declaration TINYINT(1) NOT NULL DEFAULT 0,
  admin_note TEXT NULL,
  reviewed_by VARCHAR(60) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_claims_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_claims_claimant FOREIGN KEY (claimant_id) REFERENCES users(id),
  CONSTRAINT fk_claims_lost_item FOREIGN KEY (linked_lost_item_id) REFERENCES items(id) ON DELETE SET NULL,
  CONSTRAINT fk_claims_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_claims_item_status (item_id, status),
  INDEX idx_claims_claimant (claimant_id),
  INDEX idx_claims_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS claim_timeline (
  id VARCHAR(60) PRIMARY KEY,
  claim_id VARCHAR(60) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  actor_id VARCHAR(60) NULL,
  actor_role ENUM('admin','claimant','system') NOT NULL DEFAULT 'system',
  message TEXT NULL,
  photo_paths TEXT NULL COMMENT 'JSON array of uploaded photo paths',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_timeline_claim FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
  CONSTRAINT fk_timeline_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_timeline_claim_date (claim_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(60) PRIMARY KEY,
  user_id VARCHAR(60) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'info',
  title VARCHAR(120) NOT NULL,
  body VARCHAR(300) NOT NULL,
  link VARCHAR(500) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user_read_date (user_id, is_read, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reference_counters (
  prefix VARCHAR(10) PRIMARY KEY,
  current_value INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

INSERT IGNORE INTO categories (name) VALUES
('Phones & Gadgets'), ('Wallets & Cards'), ('IDs & Documents'), ('Bags'),
('Keys'), ('Clothing'), ('Books & School Supplies'), ('Eyewear'),
('Bottles & Umbrellas'), ('Jewelry & Accessories'), ('Others');

INSERT IGNORE INTO locations (name) VALUES
('Main Gate'), ('Library'), ('Canteen'), ('Gymnasium'),
('Administration Building'), ('Classrooms'), ('Computer Laboratory'),
('Restrooms'), ('Parking Area'), ('Quadrangle / Covered Court'), ('Others');

INSERT IGNORE INTO reference_counters (prefix, current_value) VALUES
('LST', 0), ('FND', 0), ('CLM', 0);
