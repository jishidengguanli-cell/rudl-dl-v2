-- 0003_rename_ledger_cols.sql
CREATE TABLE IF NOT EXISTS point_ledger_bak AS SELECT * FROM point_ledger;

ALTER TABLE point_ledger RENAME COLUMN account_id TO user_id;
ALTER TABLE point_ledger RENAME COLUMN delta TO "change";

CREATE INDEX IF NOT EXISTS idx_point_ledger_user ON point_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_point_ledger_created ON point_ledger(created_at);
