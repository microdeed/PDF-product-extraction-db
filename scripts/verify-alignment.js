/**
 * Database Alignment Verification Script
 *
 * Verifies that supplement_facts.id matches products.id for all products.
 * Also checks foreign key integrity and record counts.
 *
 * Usage: node verify-alignment.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'products.db');

function verifyAlignment() {
  console.log('🔍 Verifying Database Alignment\n');
  console.log('=' .repeat(60));

  const db = new Database(DB_PATH, { readonly: true });

  try {
    // 1. Check total record counts
    console.log('\n📊 Record Counts:');
    const counts = {
      products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
      supplementFacts: db.prepare('SELECT COUNT(*) as count FROM supplement_facts').get().count,
      nutritionalValues: db.prepare('SELECT COUNT(*) as count FROM nutritional_values').get().count,
      ingredients: db.prepare('SELECT COUNT(*) as count FROM ingredients').get().count,
      dietaryAttributes: db.prepare('SELECT COUNT(*) as count FROM dietary_attributes').get().count,
    };

    console.log(`   Products:            ${counts.products}`);
    console.log(`   Supplement Facts:    ${counts.supplementFacts}`);
    console.log(`   Nutritional Values:  ${counts.nutritionalValues}`);
    console.log(`   Ingredients:         ${counts.ingredients}`);
    console.log(`   Dietary Attributes:  ${counts.dietaryAttributes}`);

    // 2. Check alignment between products and supplement_facts
    console.log('\n🎯 ID Alignment Check:');

    const alignedCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM products p
      JOIN supplement_facts sf ON p.id = sf.product_id
      WHERE p.id = sf.id
    `).get().count;

    const misalignedCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM products p
      JOIN supplement_facts sf ON p.id = sf.product_id
      WHERE p.id != sf.id
    `).get().count;

    const totalProducts = counts.supplementFacts; // Products with supplement facts

    console.log(`   Aligned:     ${alignedCount}/${totalProducts} products`);
    console.log(`   Misaligned:  ${misalignedCount}/${totalProducts} products`);

    if (misalignedCount === 0) {
      console.log('   ✅ All products are correctly aligned!');
    } else {
      console.log(`   ⚠️  ${misalignedCount} products need alignment`);
    }

    // 3. Show sample of misaligned products (if any)
    if (misalignedCount > 0) {
      console.log('\n📋 Sample Misaligned Products (first 10):');
      const misaligned = db.prepare(`
        SELECT p.id as product_id, sf.id as supplement_fact_id, p.product_name
        FROM products p
        JOIN supplement_facts sf ON p.id = sf.product_id
        WHERE p.id != sf.id
        ORDER BY p.id
        LIMIT 10
      `).all();

      misaligned.forEach((row) => {
        console.log(`   Product ${row.product_id} → supplement_facts.id = ${row.supplement_fact_id}`);
        console.log(`      ${row.product_name.substring(0, 60)}...`);
      });

      if (misalignedCount > 10) {
        console.log(`   ... and ${misalignedCount - 10} more`);
      }
    }

    // 4. Show sample of aligned products
    if (alignedCount > 0) {
      console.log('\n✅ Sample Aligned Products (first 5):');
      const aligned = db.prepare(`
        SELECT p.id, p.product_name
        FROM products p
        JOIN supplement_facts sf ON p.id = sf.product_id
        WHERE p.id = sf.id
        ORDER BY p.id
        LIMIT 5
      `).all();

      aligned.forEach((row) => {
        console.log(`   Product ${row.id}: ${row.product_name.substring(0, 60)}...`);
      });
    }

    // 5. Check for orphaned nutritional values
    console.log('\n🔗 Foreign Key Integrity:');

    const orphanedNutritionalValues = db.prepare(`
      SELECT COUNT(*) as count
      FROM nutritional_values nv
      LEFT JOIN supplement_facts sf ON nv.supplement_fact_id = sf.id
      WHERE sf.id IS NULL
    `).get().count;

    if (orphanedNutritionalValues === 0) {
      console.log('   ✅ All nutritional_values have valid supplement_fact_id');
    } else {
      console.log(`   ⚠️  ${orphanedNutritionalValues} orphaned nutritional_values found!`);
    }

    // 6. Check for orphaned supplement facts
    const orphanedSupplementFacts = db.prepare(`
      SELECT COUNT(*) as count
      FROM supplement_facts sf
      LEFT JOIN products p ON sf.product_id = p.id
      WHERE p.id IS NULL
    `).get().count;

    if (orphanedSupplementFacts === 0) {
      console.log('   ✅ All supplement_facts have valid product_id');
    } else {
      console.log(`   ⚠️  ${orphanedSupplementFacts} orphaned supplement_facts found!`);
    }

    // 7. Check ingredients and dietary attributes (should not be affected by migration)
    const orphanedIngredients = db.prepare(`
      SELECT COUNT(*) as count
      FROM ingredients i
      LEFT JOIN products p ON i.product_id = p.id
      WHERE p.id IS NULL
    `).get().count;

    if (orphanedIngredients === 0) {
      console.log('   ✅ All ingredients have valid product_id');
    } else {
      console.log(`   ⚠️  ${orphanedIngredients} orphaned ingredients found!`);
    }

    const orphanedDietaryAttributes = db.prepare(`
      SELECT COUNT(*) as count
      FROM dietary_attributes da
      LEFT JOIN products p ON da.product_id = p.id
      WHERE p.id IS NULL
    `).get().count;

    if (orphanedDietaryAttributes === 0) {
      console.log('   ✅ All dietary_attributes have valid product_id');
    } else {
      console.log(`   ⚠️  ${orphanedDietaryAttributes} orphaned dietary_attributes found!`);
    }

    // 8. Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📈 Summary:');

    const alignmentPercentage = totalProducts > 0
      ? ((alignedCount / totalProducts) * 100).toFixed(1)
      : 0;

    console.log(`   Alignment Rate: ${alignmentPercentage}% (${alignedCount}/${totalProducts})`);

    if (misalignedCount === 0 && orphanedNutritionalValues === 0 && orphanedSupplementFacts === 0) {
      console.log('\n   ✅ DATABASE IS FULLY ALIGNED AND HEALTHY!\n');
      return true;
    } else {
      console.log('\n   ⚠️  DATABASE NEEDS ALIGNMENT\n');
      return false;
    }
  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    return false;
  } finally {
    db.close();
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isAligned = verifyAlignment();
  process.exit(isAligned ? 0 : 1);
}

export { verifyAlignment };
