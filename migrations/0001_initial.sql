PRAGMA foreign_keys=ON;
CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,image TEXT NOT NULL,available INTEGER NOT NULL DEFAULT 1,sort INTEGER NOT NULL DEFAULT 0);
INSERT INTO products VALUES
('cappuccino','كابتشينو حار','إسبريسو غني، حليب مخملي ولمسة من الحب.','hot','/images/cappuccino.webp',1,1),
('black','بلاك كوفي','قهوة سوداء نقية، لعشّاق المذاق الأصيل.','hot','/images/black.webp',1,2),
('secret','كوفي سري','وصفتنا الخاصة… سرّ يستحق التجربة.','signature','/images/secret.webp',1,3),
('iced-americano','أمريكانو بارد','إسبريسو متوازن فوق مكعبات الثلج.','cold','/images/iced-americano.webp',1,4),
('americano','أمريكانو حار','بساطة القهوة، وعمق النكهة.','hot','/images/americano.webp',1,5),
('cold-milk','حليب بارد','حليب طازج، بارد ومنعش.','cold','/images/cold-milk.webp',1,6),
('hot-milk','حليب ساخن','دفء لطيف في كل رشفة.','hot','/images/hot-milk.webp',1,7);
CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),accepting INTEGER NOT NULL DEFAULT 1,opening_hour INTEGER NOT NULL DEFAULT 15);
INSERT INTO settings VALUES(1,1,15);
CREATE TABLE orders(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,request_hash TEXT NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,notes TEXT NOT NULL,items TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',created_at INTEGER NOT NULL,email_status TEXT NOT NULL DEFAULT 'pending',email_attempts INTEGER NOT NULL DEFAULT 0,email_updated INTEGER NOT NULL DEFAULT 0);
CREATE INDEX orders_date ON orders(created_at);
CREATE INDEX orders_status ON orders(status,created_at);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
CREATE TABLE limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);

ALTER TABLE settings ADD COLUMN promotion_date TEXT NOT NULL DEFAULT '2026-11-13';
ALTER TABLE orders ADD COLUMN subtotal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN total INTEGER NOT NULL DEFAULT 0;
