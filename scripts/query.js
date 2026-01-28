import Database from 'better-sqlite3';

const db = new Database('products.db');

console.log('\n=== PRODUCT INFORMATION ===\n');
const product = db.prepare('SELECT * FROM products WHERE product_code = ?').get('0358');
console.log('Product Code:', product.product_code);
console.log('Product Name:', product.product_name);
console.log('Product Slogan:', product.product_slogan);
console.log('Description:', product.product_description);
console.log('Subbrand:', product.subbrand);
console.log('Directions:', product.directions.substring(0, 100) + '...');

console.log('\n=== SUPPLEMENT FACTS ===\n');
const suppFacts = db.prepare('SELECT * FROM supplement_facts WHERE product_id = ?').get(product.id);
if (suppFacts) {
  console.log('Servings:', suppFacts.servings);
  console.log('Servings per Container:', suppFacts.servings_per_container);
  console.log('Calories:', suppFacts.calories);
  console.log('Protein:', suppFacts.protein);

  const nutrients = db.prepare('SELECT * FROM nutritional_values WHERE supplement_fact_id = ? ORDER BY display_order').all(suppFacts.id);
  console.log('\nNutrients:');
  nutrients.forEach((n, i) => {
    console.log(`  ${i + 1}. ${n.nutrient_name}: ${n.amount}${n.daily_value_percent ? ' (' + n.daily_value_percent + ' DV)' : ''}`);
  });
}

console.log('\n=== INGREDIENTS ===\n');
const ingredients = db.prepare('SELECT * FROM ingredients WHERE product_id = ? ORDER BY display_order LIMIT 10').all(product.id);
console.log(`Total Ingredients: ${db.prepare('SELECT COUNT(*) as count FROM ingredients WHERE product_id = ?').get(product.id).count}`);
console.log('First 10 ingredients:');
ingredients.forEach((ing, i) => {
  console.log(`  ${i + 1}. ${ing.ingredient_name}${ing.is_organic ? ' (Organic)' : ''}`);
});

console.log('\n=== DIETARY ATTRIBUTES ===\n');
const dietaryAttrs = db.prepare('SELECT * FROM dietary_attributes WHERE product_id = ?').all(product.id);
console.log(dietaryAttrs.map(d => d.attribute_name).join(', '));

db.close();
