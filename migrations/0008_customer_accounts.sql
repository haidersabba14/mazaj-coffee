CREATE TABLE customers(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',password_hash TEXT NOT NULL,recovery_hash TEXT NOT NULL,auth_version INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE customer_sessions(token_hash TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,auth_version INTEGER NOT NULL,created_at INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE INDEX customer_sessions_user ON customer_sessions(customer_id,expires);
ALTER TABLE orders ADD COLUMN customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX orders_customer ON orders(customer_id,created_at DESC);
