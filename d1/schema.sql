-- 依你現況整理，型別以 SQLite 常見型別為主，NULL/非 NULL 與預設值可再微調
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  pw_hash TEXT,
  role TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS files(
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  platform TEXT,         -- 'apk' | 'ipa'
  package_name TEXT,
  channel TEXT,
  version TEXT,
  size INTEGER,
  sha256 TEXT,
  r2_key TEXT,
  created_at INTEGER,
  link_id TEXT
);

CREATE TABLE IF NOT EXISTS links(
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  file_id TEXT,
  title TEXT,
  is_active INTEGER,
  created_at INTEGER,
  cn_direct INTEGER,
  owner_id TEXT,
  platform TEXT
);

CREATE TABLE IF NOT EXISTS point_accounts(
  id TEXT PRIMARY KEY,
  user_id TEXT,
  balance INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS point_dedupe(
  account_id TEXT,
  link_id TEXT,
  bucket_minute INTEGER,
  platform TEXT,
  PRIMARY KEY (account_id, link_id, bucket_minute, platform)
);

CREATE TABLE IF NOT EXISTS point_ledger(
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
