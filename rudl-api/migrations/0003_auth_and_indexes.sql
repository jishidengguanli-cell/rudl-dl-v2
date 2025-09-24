-- 讓 email 不重複（登入/註冊要用）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 常用查詢的輔助索引
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_links_file ON links(file_id);

-- 點數異動查詢：依帳號與時間（新版用 account_id, delta）
CREATE INDEX IF NOT EXISTS idx_point_ledger_account_time
  ON point_ledger(account_id, created_at DESC);

-- 下載紀錄：依連結與時間
CREATE INDEX IF NOT EXISTS idx_downloads_link_time
  ON downloads(link_id, created_at DESC);
