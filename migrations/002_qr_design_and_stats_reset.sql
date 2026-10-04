-- QR code design per link (JSON, see src/qrDesign.ts). Empty object = default black & white.
ALTER TABLE links ADD COLUMN qr_design TEXT NOT NULL DEFAULT '{}';

-- When the scan statistics were last reset (unix epoch ms), or NULL if never.
ALTER TABLE links ADD COLUMN stats_reset_at INTEGER;

-- Uploaded logo per link, already re-encoded as a 512 x 512 PNG.
CREATE TABLE link_logos (
  link_id     INTEGER PRIMARY KEY REFERENCES links(id) ON DELETE CASCADE,
  png         BLOB    NOT NULL,
  updated_at  INTEGER NOT NULL
);
