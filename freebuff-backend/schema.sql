-- Freebuff client backend — D1 schema (idempotent, also created lazily by the worker)
CREATE TABLE IF NOT EXISTS link_codes (
	code TEXT PRIMARY KEY,
	created_at INTEGER,
	expires_at INTEGER,
	used INTEGER DEFAULT 0,
	device_name TEXT,
	device_id TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	device_id TEXT,
	device_name TEXT,
	created_at INTEGER,
	expires_at INTEGER,
	revoked INTEGER DEFAULT 0,
	last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id);
