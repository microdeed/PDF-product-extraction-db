import Database from 'better-sqlite3';

const db = new Database('products.db');

console.log('\n=== CHECKING WHICH PRODUCTS ARE ALIGNED ===\n');

// Get all products and their supplement_facts
const query = db.prepare(`
  SELECT
    p.id as product_id,
    p.product_code,
    p.product_name,
    p.extraction_status,
    p.created_at,
    sf.id as supplement_fact_id
  FROM products p
  LEFT JOIN supplement_facts sf ON p.id = sf.product_id
  ORDER BY p.id
`);

const results = query.all();

console.log('Products where product.id == supplement_facts.id:');
results.forEach(row => {
  if (row.product_id === row.supplement_fact_id) {
    console.log(`  ID ${row.product_id}: ${row.product_name} (${row.product_code}) - Created: ${row.created_at}`);
  }
});

console.log('\n\nFirst 10 products overall:');
results.slice(0, 10).forEach(row => {
  const aligned = row.product_id === row.supplement_fact_id ? 'ALIGNED' : 'MISALIGNED';
  console.log(`  Product ${row.product_id} -> SupplementFact ${row.supplement_fact_id || 'NULL'} - ${aligned}`);
});

console.log('\n\nChecking if aligned products have a pattern...');
const alignedIds = results.filter(r => r.product_id === r.supplement_fact_id).map(r => r.product_id);
console.log(`Aligned product IDs: ${alignedIds.join(', ')}`);

db.close();
