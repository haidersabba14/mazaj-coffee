ALTER TABLE settings ADD COLUMN promotion_weekday INTEGER NOT NULL DEFAULT 5 CHECK (promotion_weekday BETWEEN 0 AND 6);
ALTER TABLE orders ADD COLUMN fulfillment TEXT NOT NULL DEFAULT 'pickup';
ALTER TABLE orders ADD COLUMN location_lat REAL;
ALTER TABLE orders ADD COLUMN location_lng REAL;
ALTER TABLE orders ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN estimated_ready_at INTEGER;
ALTER TABLE orders ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT '';
INSERT INTO products(id,name,description,category,image,available,sort) VALUES
('iced-latte','لاتيه مثلج','إسبريسو وحليب ناعم فوق مكعبات الثلج.','cold','/images/iced-latte.webp',1,8),
('cold-water','ماء بارد','ماء نقي وبارد، لانتعاش على مزاجك.','cold','/images/cold-water.webp',1,9),
('hot-water','ماء حار','كوب ماء نقي ساخن، يُحضّر عند الطلب.','hot','/images/hot-water.webp',1,10);
