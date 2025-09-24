-- 000X_add_owner_to_links.sql
ALTER TABLE links ADD COLUMN owner_id TEXT;
CREATE INDEX IF NOT EXISTS idx_links_owner ON links(owner_id);
