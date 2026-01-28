import Database from 'better-sqlite3';

const db = new Database('products.db');

console.log('\n=== CHECKING FOR GAPS IN PRODUCT IDs ===\n');

// Get all product IDs
const productIds = db.prepare('SELECT id FROM products ORDER BY id').all().map(p => p.id);
const suppFactIds = db.prepare('SELECT id FROM supplement_facts ORDER BY id').all().map(sf => sf.id);

console.log(`Product IDs: ${productIds.slice(0, 20).join(', ')}...`);
console.log(`Total products: ${productIds.length}`);
console.log(`Min product ID: ${Math.min(...productIds)}`);
console.log(`Max product ID: ${Math.max(...productIds)}`);

console.log(`\nSupplement Fact IDs: ${suppFactIds.slice(0, 20).join(', ')}...`);
console.log(`Total supplement facts: ${suppFactIds.length}`);
console.log(`Min supplement fact ID: ${Math.min(...suppFactIds)}`);
console.log(`Max supplement fact ID: ${Math.max(...suppFactIds)}`);

// Check for gaps in product IDs
console.log('\n=== GAPS IN PRODUCT IDs ===');
let gapsFound = false;
for (let i = 0; i < productIds.length - 1; i++) {
  const gap = productIds[i + 1] - productIds[i];
  if (gap > 1) {
    console.log(`Gap between product ${productIds[i]} and ${productIds[i + 1]}`);
    gapsFound = true;
  }
}
if (!gapsFound) {
  console.log('No gaps found in product IDs');
}

// Check the timing of creation
console.log('\n=== PRODUCT CREATION TIMELINE ===');
const timeline = db.prepare(`
  SELECT id, product_code, product_name, created_at, extraction_status
  FROM products
  ORDER BY created_at
  LIMIT 15
`).all();

timeline.forEach(p => {
  console.log(`${p.created_at} - ID ${p.id}: ${p.product_code} (${p.extraction_status})`);
});

// Check for products created on different dates
console.log('\n=== PRODUCTS BY DATE ===');
const byDate = db.prepare(`
  SELECT DATE(created_at) as date, COUNT(*) as count
  FROM products
  GROUP BY DATE(created_at)
  ORDER BY date
`).all();

byDate.forEach(d => {
  console.log(`${d.date}: ${d.count} products`);
});

db.close();
