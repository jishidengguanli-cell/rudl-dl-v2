-- 使用者
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  pw_hash TEXT,
  role TEXT DEFAULT 'user',
  created_at INTEGER
);

-- 點數帳戶
CREATE TABLE IF NOT EXISTS point_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE,
  balance INTEGER DEFAULT 0,
  updated_at INTEGER
);

-- 扣點流水
CREATE TABLE IF NOT EXISTS point_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  delta INTEGER,
  reason TEXT,
  link_id TEXT,
  download_id TEXT,
  bucket_minute INTEGER,
  platform TEXT,
  created_at INTEGER
);

-- 冪等去重（同一分鐘只扣一次）
CREATE TABLE IF NOT EXISTS point_dedupe (
  account_id TEXT,
  link_id TEXT,
  bucket_minute INTEGER,
  platform TEXT,
  PRIMARY KEY (account_id, link_id, bucket_minute, platform)
);

-- 檔案
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  platform TEXT CHECK(platform IN ('apk','ipa')),
  package_name TEXT,
  channel TEXT,
  version TEXT,
  size INTEGER,
  sha256 TEXT,
  r2_key TEXT,
  created_at INTEGER
);

-- 分發連結
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  file_id TEXT,
  title TEXT,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER
);

-- 下載紀錄
CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  link_id TEXT,
  user_id TEXT,
  ip TEXT,
  country TEXT,
  ua TEXT,
  platform TEXT,
  billed INTEGER DEFAULT 0,
  billed_at INTEGER,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_links_code ON links(code);
