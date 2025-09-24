-- 000Y_add_link_to_files.sql
ALTER TABLE files ADD COLUMN link_id TEXT;
CREATE INDEX IF NOT EXISTS idx_files_link ON files(link_id);
