-- Short links. The slug is permanent once created (it may be printed on a sign).
CREATE TABLE links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  destination  TEXT    NOT NULL,
  note         TEXT    NOT NULL DEFAULT '',
  scan_count   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL, -- unix epoch milliseconds
  updated_at   INTEGER NOT NULL
);

-- One row per redirect. No IP addresses are stored.
CREATE TABLE scans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id     INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  scanned_at  INTEGER NOT NULL,
  country     TEXT,
  device      TEXT    NOT NULL
);
CREATE INDEX idx_scans_link_time ON scans(link_id, scanned_at);

-- Every destination change, newest last.
CREATE TABLE link_history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id          INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  old_destination  TEXT,
  new_destination  TEXT    NOT NULL,
  changed_at       INTEGER NOT NULL
);
CREATE INDEX idx_history_link_time ON link_history(link_id, changed_at);
