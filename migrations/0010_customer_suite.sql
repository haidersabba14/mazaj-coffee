ALTER TABLE loyalty_cards ADD COLUMN customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX loyalty_one_card_per_customer ON loyalty_cards(customer_id) WHERE customer_id IS NOT NULL;
CREATE TABLE customer_preferences(customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,favorites TEXT NOT NULL DEFAULT '[]',customization TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
ALTER TABLE customers ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN(0,1));
CREATE TRIGGER loyalty_cancel_refund AFTER UPDATE OF status ON orders WHEN NEW.status='cancelled' AND OLD.status!='cancelled' BEGIN UPDATE loyalty_cards SET reward_drinks=reward_drinks+2 WHERE id=(SELECT card_id FROM loyalty_redemptions WHERE order_id=NEW.id); END;
ALTER TABLE orders ADD COLUMN cancelled_by TEXT NOT NULL DEFAULT '';
