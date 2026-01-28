const Database = require('better-sqlite3');
const db = new Database('products.db');

console.log('=== Schema Version ===');
const version = db.prepare('SELECT * FROM schema_version').get();
console.log('Current version:', version.version, 'Applied at:', version.applied_at);

console.log('\n=== Database Schema for nutritional_values ===');
const schema = db.prepare("PRAGMA table_info(nutritional_values)").all();
console.log(JSON.stringify(schema.map(col => ({name: col.name, type: col.type})), null, 2));

console.log('\n=== Product 0358 Nutritional Values ===');
const nutrients = db.prepare(`
  SELECT
    nv.nutrient_name,
    nv.amount,
    nv.daily_value_percent_adult AS adult_dv,
    nv.daily_value_percent_children AS child_dv
  FROM products p
  JOIN supplement_facts sf ON p.id = sf.product_id
  JOIN nutritional_values nv ON sf.id = nv.supplement_fact_id
  WHERE p.product_code = '0358'
  ORDER BY nv.display_order
`).all();

console.log('Total nutrients:', nutrients.length);
console.log('\nFirst 10 nutrients:');
nutrients.slice(0, 10).forEach((n, i) => {
  console.log(`${i+1}. ${n.nutrient_name}`);
  console.log(`   Amount: ${n.amount}`);
  console.log(`   Adult DV%: ${n.adult_dv || 'null'}, Children DV%: ${n.child_dv || 'null'}`);
});

console.log('\n=== Dual Daily Value Percentage Check ===');
const dualDV = db.prepare(`
  SELECT
    nv.nutrient_name,
    nv.amount,
    nv.daily_value_percent_adult AS adult_dv,
    nv.daily_value_percent_children AS child_dv
  FROM products p
  JOIN supplement_facts sf ON p.id = sf.product_id
  JOIN nutritional_values nv ON sf.id = nv.supplement_fact_id
  WHERE p.product_code = '0358'
    AND nv.daily_value_percent_children IS NOT NULL
  ORDER BY nv.display_order
`).all();
console.log('Nutrients with BOTH adult and children DV%:', dualDV.count || dualDV.length);
if (dualDV.length > 0) {
  console.log('Examples:');
  dualDV.slice(0, 5).forEach(n => {
    console.log(`  - ${n.nutrient_name}: ${n.amount} (${n.adult_dv}% adult, ${n.child_dv}% children)`);
  });
}

console.log('\n=== Data Quality Checks ===');
const invalidAmounts = db.prepare(`
  SELECT COUNT(*) as count
  FROM nutritional_values
  WHERE amount IN ('0', '0 mg', '0 g', '0 mcg', 'unknown', 'N/A', '-')
`).get();
console.log('Invalid amounts (should be 0):', invalidAmounts.count);

const nullAmounts = db.prepare(`
  SELECT COUNT(*) as count
  FROM nutritional_values
  WHERE amount IS NULL
`).get();
console.log('Null amounts:', nullAmounts.count);

const validAmounts = db.prepare(`
  SELECT COUNT(*) as count
  FROM nutritional_values
  WHERE amount IS NOT NULL AND amount NOT IN ('0', 'unknown', 'N/A', '-')
`).get();
console.log('Valid amounts with number and unit:', validAmounts.count);

console.log('\n=== Amount Format Validation ===');
const amountFormats = db.prepare(`
  SELECT DISTINCT amount
  FROM nutritional_values
  WHERE amount IS NOT NULL
  LIMIT 10
`).all();
console.log('Sample amount formats:');
amountFormats.forEach(a => console.log(`  - "${a.amount}"`));

db.close();
console.log('\n✓ Verification complete!');
