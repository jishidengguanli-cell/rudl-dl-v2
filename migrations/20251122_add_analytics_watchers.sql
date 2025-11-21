CREATE TABLE IF NOT EXISTS analytics_watchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  settings TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS analytics_watchers_owner_idx ON analytics_watchers(owner_id);
CREATE INDEX IF NOT EXISTS analytics_watchers_link_idx ON analytics_watchers(link_id);
