ALTER TABLE links ADD COLUMN lang TEXT DEFAULT 'en';
UPDATE links SET lang = 'en' WHERE lang IS NULL;
