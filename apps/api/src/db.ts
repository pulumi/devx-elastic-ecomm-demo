import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dbPath = process.env.DATABASE_PATH ?? "shopfront.sqlite";
export const db = new Database(dbPath);
// WAL by default; on ECS the file lives on EFS (NFS), where WAL's shared-
// memory index is unreliable, so the task sets SQLITE_JOURNAL_MODE=DELETE.
db.pragma(`journal_mode = ${process.env.SQLITE_JOURNAL_MODE ?? "WAL"}`);

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    priceCents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    inventoryCount INTEGER NOT NULL,
    imageUrl TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS carts (
    id TEXT PRIMARY KEY,
    sessionId TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id TEXT PRIMARY KEY,
    cartId TEXT NOT NULL,
    productId TEXT NOT NULL,
    qty INTEGER NOT NULL,
    FOREIGN KEY (cartId) REFERENCES carts(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    totalCents INTEGER NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    orderId TEXT NOT NULL,
    productId TEXT NOT NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unitPriceCents INTEGER NOT NULL,
    FOREIGN KEY (orderId) REFERENCES orders(id)
  );
`);

function seedProducts() {
  const count = db.prepare("SELECT COUNT(*) as c FROM products").get() as { c: number };
  if (count.c > 0) return;

  const seedPath = fileURLToPath(new URL("../../../packages/contracts/seed-data/products.json", import.meta.url));
  const products = JSON.parse(readFileSync(seedPath, "utf-8"));

  const insert = db.prepare(`
    INSERT INTO products (id, sku, name, description, priceCents, currency, inventoryCount, imageUrl)
    VALUES (@id, @sku, @name, @description, @priceCents, @currency, @inventoryCount, @imageUrl)
  `);
  const insertMany = db.transaction((rows: any[]) => {
    for (const row of rows) insert.run(row);
  });
  insertMany(products);
}

seedProducts();

export function newId(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
