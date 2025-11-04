CREATE TABLE IF NOT EXISTS link_download_stats (
  link_id TEXT NOT NULL,
  date TEXT NOT NULL,
  apk_dl INTEGER NOT NULL DEFAULT 0,
  ipa_dl INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, date),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_link_download_stats_link_date
  ON link_download_stats (link_id, date);

CREATE TRIGGER IF NOT EXISTS trg_link_download_stats_after_insert
AFTER INSERT ON link_download_stats
BEGIN
  UPDATE links
  SET today_apk_dl = COALESCE((
        SELECT apk_dl
        FROM link_download_stats
        WHERE link_id = NEW.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      today_ipa_dl = COALESCE((
        SELECT ipa_dl
        FROM link_download_stats
        WHERE link_id = NEW.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      today_total_dl = COALESCE((
        SELECT apk_dl
        FROM link_download_stats
        WHERE link_id = NEW.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0) + COALESCE((
        SELECT ipa_dl
        FROM link_download_stats
        WHERE link_id = NEW.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      total_apk_dl = COALESCE((
        SELECT SUM(apk_dl)
        FROM link_download_stats
        WHERE link_id = NEW.link_id
      ), 0),
      total_ipa_dl = COALESCE((
        SELECT SUM(ipa_dl)
        FROM link_download_stats
        WHERE link_id = NEW.link_id
      ), 0),
      total_total_dl = COALESCE((
        SELECT SUM(apk_dl)
        FROM link_download_stats
        WHERE link_id = NEW.link_id
      ), 0) + COALESCE((
        SELECT SUM(ipa_dl)
        FROM link_download_stats
        WHERE link_id = NEW.link_id
      ), 0)
  WHERE id = NEW.link_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_link_download_stats_after_update
AFTER UPDATE ON link_download_stats
BEGIN
  UPDATE links
  SET today_apk_dl = COALESCE((
        SELECT apk_dl
        FROM link_download_stats
        WHERE link_id = NEW.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      today_ipa_dl = COALESCE((
        SELECT ipa_dl
        FROM link_download_stats
        WHERE link_id = NEW.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      today_total_dl = COALESCE((
        SELECT apk_dl
        FROM link_download_stats
        WHERE link_id = NEW.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0) + COALESCE((
        SELECT ipa_dl
        FROM link_download_stats
        WHERE link_id = NEW.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      total_apk_dl = COALESCE((
        SELECT SUM(apk_dl)
        FROM link_download_stats
        WHERE link_id = NEW.link_id
      ), 0),
      total_ipa_dl = COALESCE((
        SELECT SUM(ipa_dl)
        FROM link_download_stats
        WHERE link_id = NEW.link_id
      ), 0),
      total_total_dl = COALESCE((
        SELECT SUM(apk_dl)
        FROM link_download_stats
        WHERE link_id = NEW.link_id
      ), 0) + COALESCE((
        SELECT SUM(ipa_dl)
        FROM link_download_stats
        WHERE link_id = NEW.link_id
      ), 0)
  WHERE id = NEW.link_id;

  -- If link_id changes, recalculate the previous link as well.
  UPDATE links
  SET today_apk_dl = COALESCE((
        SELECT apk_dl
        FROM link_download_stats
        WHERE link_id = OLD.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      today_ipa_dl = COALESCE((
        SELECT ipa_dl
        FROM link_download_stats
        WHERE link_id = OLD.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      today_total_dl = COALESCE((
        SELECT apk_dl
        FROM link_download_stats
        WHERE link_id = OLD.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0) + COALESCE((
        SELECT ipa_dl
        FROM link_download_stats
        WHERE link_id = OLD.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      total_apk_dl = COALESCE((
        SELECT SUM(apk_dl)
        FROM link_download_stats
        WHERE link_id = OLD.link_id
      ), 0),
      total_ipa_dl = COALESCE((
        SELECT SUM(ipa_dl)
        FROM link_download_stats
        WHERE link_id = OLD.link_id
      ), 0),
      total_total_dl = COALESCE((
        SELECT SUM(apk_dl)
        FROM link_download_stats
        WHERE link_id = OLD.link_id
      ), 0) + COALESCE((
        SELECT SUM(ipa_dl)
        FROM link_download_stats
        WHERE link_id = OLD.link_id
      ), 0)
  WHERE id = OLD.link_id AND OLD.link_id <> NEW.link_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_link_download_stats_after_delete
AFTER DELETE ON link_download_stats
BEGIN
  UPDATE links
  SET today_apk_dl = COALESCE((
        SELECT apk_dl
        FROM link_download_stats
        WHERE link_id = OLD.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      today_ipa_dl = COALESCE((
        SELECT ipa_dl
        FROM link_download_stats
        WHERE link_id = OLD.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      today_total_dl = COALESCE((
        SELECT apk_dl
        FROM link_download_stats
        WHERE link_id = OLD.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0) + COALESCE((
        SELECT ipa_dl
        FROM link_download_stats
        WHERE link_id = OLD.link_id
          AND date = strftime('%Y-%m-%d', 'now', 'utc')
      ), 0),
      total_apk_dl = COALESCE((
        SELECT SUM(apk_dl)
        FROM link_download_stats
        WHERE link_id = OLD.link_id
      ), 0),
      total_ipa_dl = COALESCE((
        SELECT SUM(ipa_dl)
        FROM link_download_stats
        WHERE link_id = OLD.link_id
      ), 0),
      total_total_dl = COALESCE((
        SELECT SUM(apk_dl)
        FROM link_download_stats
        WHERE link_id = OLD.link_id
      ), 0) + COALESCE((
        SELECT SUM(ipa_dl)
        FROM link_download_stats
        WHERE link_id = OLD.link_id
      ), 0)
  WHERE id = OLD.link_id;
END;

UPDATE links
SET today_apk_dl = COALESCE((
      SELECT apk_dl
      FROM link_download_stats
      WHERE link_id = links.id
        AND date = strftime('%Y-%m-%d', 'now', 'utc')
    ), 0),
    today_ipa_dl = COALESCE((
      SELECT ipa_dl
      FROM link_download_stats
      WHERE link_id = links.id
        AND date = strftime('%Y-%m-%d', 'now', 'utc')
    ), 0),
    today_total_dl = COALESCE((
      SELECT apk_dl
      FROM link_download_stats
      WHERE link_id = links.id
        AND date = strftime('%Y-%m-%d', 'now', 'utc')
    ), 0) + COALESCE((
      SELECT ipa_dl
      FROM link_download_stats
      WHERE link_id = links.id
        AND date = strftime('%Y-%m-%d', 'now', 'utc')
    ), 0),
    total_apk_dl = COALESCE((
      SELECT SUM(apk_dl)
      FROM link_download_stats
      WHERE link_id = links.id
    ), 0),
    total_ipa_dl = COALESCE((
      SELECT SUM(ipa_dl)
      FROM link_download_stats
      WHERE link_id = links.id
    ), 0),
    total_total_dl = COALESCE((
      SELECT SUM(apk_dl)
      FROM link_download_stats
      WHERE link_id = links.id
    ), 0) + COALESCE((
      SELECT SUM(ipa_dl)
      FROM link_download_stats
      WHERE link_id = links.id
    ), 0);
