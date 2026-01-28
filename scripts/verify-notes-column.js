import Database from 'better-sqlite3';

const db = new Database('products.db', { readonly: true });
const tables = ['products', 'supplement_facts', 'nutritional_values', 'ingredients', 'dietary_attributes', 'processing_log'];

console.log('📋 Verifying notes column in all tables:\n');

tables.forEach(table => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const notesCol = cols.find(c => c.name === 'notes');
  if (notesCol) {
    console.log(`✅ ${table}: notes column exists (type: ${notesCol.type}, nullable: ${notesCol.notnull === 0 ? 'yes' : 'no'})`);
  } else {
    console.log(`❌ ${table}: notes column NOT found`);
  }
});

db.close();
