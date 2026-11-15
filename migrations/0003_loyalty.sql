ALTER TABLE settings ADD COLUMN all_free INTEGER NOT NULL DEFAULT 1;
CREATE TABLE loyalty_cards(id TEXT PRIMARY KEY,card_number TEXT NOT NULL UNIQUE,token_hash TEXT NOT NULL,name TEXT NOT NULL,contact_hash TEXT NOT NULL,stamps INTEGER NOT NULL DEFAULT 0 CHECK(stamps BETWEEN 0 AND 4),reward_drinks INTEGER NOT NULL DEFAULT 0 CHECK(reward_drinks>=0),total_stamps INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,blocked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE loyalty_events(id TEXT PRIMARY KEY,card_id TEXT NOT NULL REFERENCES loyalty_cards(id),kind TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE loyalty_redemptions(order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,card_id TEXT NOT NULL REFERENCES loyalty_cards(id),drinks INTEGER NOT NULL CHECK(drinks=2));
CREATE TRIGGER loyalty_check_balance BEFORE INSERT ON loyalty_redemptions BEGIN SELECT CASE WHEN (SELECT reward_drinks FROM loyalty_cards WHERE id=NEW.card_id AND blocked=0)<NEW.drinks THEN RAISE(ABORT,'loyalty_balance') END; END;
CREATE TRIGGER loyalty_redeem AFTER INSERT ON loyalty_redemptions BEGIN UPDATE loyalty_cards SET reward_drinks=reward_drinks-NEW.drinks WHERE id=NEW.card_id; END;
ALTER TABLE orders ADD COLUMN customization TEXT NOT NULL DEFAULT '{}';
