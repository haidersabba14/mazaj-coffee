CREATE TABLE drink_ratings(order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(order_id,product_id));
CREATE INDEX drink_ratings_product ON drink_ratings(product_id,stars);
