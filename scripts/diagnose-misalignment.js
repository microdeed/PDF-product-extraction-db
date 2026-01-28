import Database from 'better-sqlite3';

const db = new Database('products.db');

console.log('\n=== DIAGNOSING ID MISALIGNMENT ===\n');

// 1. Check product with ID 94
console.log('1. Product with ID = 94:');
const product94 = db.prepare('SELECT id, product_code, product_name, extraction_status FROM products WHERE id = ?').get(94);
if (product94) {
  console.log(`   ID: ${product94.id}`);
  console.log(`   Code: ${product94.product_code}`);
  console.log(`   Name: ${product94.product_name}`);
  console.log(`   Status: ${product94.extraction_status}`);
} else {
  console.log('   No product found with ID 94');
}

// 2. Check supplement_facts for product 94
console.log('\n2. Supplement Facts for product_id = 94:');
const suppFacts94 = db.prepare('SELECT id, product_id FROM supplement_facts WHERE product_id = ?').get(94);
if (suppFacts94) {
  console.log(`   supplement_facts.id: ${suppFacts94.id}`);
  console.log(`   supplement_facts.product_id: ${suppFacts94.product_id}`);
} else {
  console.log('   No supplement_facts found for product_id 94');
}

// 3. Check nutritional_values with supplement_fact_id = 94
console.log('\n3. Nutritional Values with supplement_fact_id = 94:');
const nutrients94 = db.prepare('SELECT id, supplement_fact_id, nutrient_name FROM nutritional_values WHERE supplement_fact_id = ?').all(94);
if (nutrients94.length > 0) {
  console.log(`   Found ${nutrients94.length} nutritional values`);
  console.log(`   First few: ${nutrients94.slice(0, 3).map(n => n.nutrient_name).join(', ')}`);
} else {
  console.log('   No nutritional_values found with supplement_fact_id 94');
}

// 4. Check if there's a supplement_facts record with ID 94
console.log('\n4. Supplement Facts with id = 94:');
const suppFactsById94 = db.prepare('SELECT id, product_id FROM supplement_facts WHERE id = ?').get(94);
if (suppFactsById94) {
  console.log(`   supplement_facts.id: ${suppFactsById94.id}`);
  console.log(`   Points to product_id: ${suppFactsById94.product_id}`);

  // Get the product this points to
  const linkedProduct = db.prepare('SELECT id, product_code, product_name FROM products WHERE id = ?').get(suppFactsById94.product_id);
  if (linkedProduct) {
    console.log(`   Product: ${linkedProduct.product_name} (code: ${linkedProduct.product_code})`);
  }
} else {
  console.log('   No supplement_facts found with id 94');
}

// 5. Summary of the mismatch
console.log('\n=== MISMATCH ANALYSIS ===\n');
if (product94 && suppFacts94 && suppFacts94.id !== 94) {
  console.log(`ISSUE: Product ID ${product94.id} has supplement_facts.id ${suppFacts94.id}, NOT 94`);
  console.log(`This means nutritional_values should have supplement_fact_id = ${suppFacts94.id}`);
  console.log(`But you're seeing supplement_fact_id = 94, which points to a different product!`);
}

// 6. Find all misalignments
console.log('\n=== CHECKING ALL RECORDS FOR MISALIGNMENTS ===\n');
const allProducts = db.prepare('SELECT id, product_code, product_name FROM products').all();
const allSuppFacts = db.prepare('SELECT id, product_id FROM supplement_facts').all();

console.log(`Total products: ${allProducts.length}`);
console.log(`Total supplement_facts: ${allSuppFacts.length}`);

// Build a map of product_id -> supplement_fact_id
const productToSuppFactId = new Map();
allSuppFacts.forEach(sf => {
  productToSuppFactId.set(sf.product_id, sf.id);
});

// Check if product IDs match supplement_fact IDs
let alignedCount = 0;
let misalignedCount = 0;
const misalignments = [];

allProducts.forEach(product => {
  const suppFactId = productToSuppFactId.get(product.id);
  if (suppFactId) {
    if (product.id === suppFactId) {
      alignedCount++;
    } else {
      misalignedCount++;
      misalignments.push({
        productId: product.id,
        productCode: product.product_code,
        productName: product.product_name,
        suppFactId: suppFactId
      });
    }
  }
});

console.log(`\nAligned (product.id == supplement_facts.id): ${alignedCount}`);
console.log(`Misaligned (product.id != supplement_facts.id): ${misalignedCount}`);

if (misalignedCount > 0) {
  console.log('\nFirst 10 misalignments:');
  misalignments.slice(0, 10).forEach(m => {
    console.log(`  Product ID ${m.productId} (${m.productCode}) -> supplement_facts.id ${m.suppFactId}`);
  });
}

// 7. Check if there are orphaned nutritional_values
console.log('\n=== CHECKING FOR ORPHANED DATA ===\n');
const orphanedNutrients = db.prepare(`
  SELECT nv.id, nv.supplement_fact_id, nv.nutrient_name
  FROM nutritional_values nv
  LEFT JOIN supplement_facts sf ON nv.supplement_fact_id = sf.id
  WHERE sf.id IS NULL
`).all();

if (orphanedNutrients.length > 0) {
  console.log(`WARNING: Found ${orphanedNutrients.length} orphaned nutritional values!`);
  console.log('These point to non-existent supplement_facts:');
  orphanedNutrients.slice(0, 5).forEach(n => {
    console.log(`  supplement_fact_id ${n.supplement_fact_id}: ${n.nutrient_name}`);
  });
} else {
  console.log('Good news: No orphaned nutritional values found');
}

db.close();
