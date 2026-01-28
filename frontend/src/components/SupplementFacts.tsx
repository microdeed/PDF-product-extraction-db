import type { SupplementFact, NutritionalValue } from '../services/api';

interface SupplementFactsProps {
  supplementFacts: SupplementFact;
  nutritionalValues: NutritionalValue[];
}

function SupplementFacts({ supplementFacts, nutritionalValues }: SupplementFactsProps) {
  const hasChildrenDV = nutritionalValues.some(nv => nv.daily_value_percent_children);

  return (
    <div className="supplement-facts">
      <div className="supplement-facts-header">
        <h2>Supplement Facts</h2>
      </div>

      <div className="serving-info">
        <div className="serving-row">
          <span className="serving-label">Serving Size</span>
          <span className="serving-value">{supplementFacts.servings}</span>
        </div>
        <div className="serving-row">
          <span className="serving-label">Servings Per Container</span>
          <span className="serving-value">{supplementFacts.servings_per_container}</span>
        </div>
      </div>

      <table className="nutrients-table">
        <thead>
          <tr>
            <th className="nutrient-name-col">Nutrient</th>
            <th className="amount-col">Amount</th>
            <th className="dv-col">% DV{hasChildrenDV ? ' (Adult)' : ''}</th>
            {hasChildrenDV && <th className="dv-col">% DV (Children)</th>}
          </tr>
        </thead>
        <tbody>
          {supplementFacts.calories && (
            <tr className="calories-row">
              <td className="nutrient-name">Calories</td>
              <td className="amount">{supplementFacts.calories}</td>
              <td className="dv"></td>
              {hasChildrenDV && <td className="dv"></td>}
            </tr>
          )}
          {supplementFacts.protein && (
            <tr>
              <td className="nutrient-name">Protein</td>
              <td className="amount">{supplementFacts.protein}</td>
              <td className="dv"></td>
              {hasChildrenDV && <td className="dv"></td>}
            </tr>
          )}
          {nutritionalValues.map((nv, index) => (
            <tr key={nv.id} className={index % 2 === 0 ? 'even-row' : 'odd-row'}>
              <td className="nutrient-name">{nv.nutrient_name}</td>
              <td className="amount">
                {nv.amount && nv.unit ? `${nv.amount} ${nv.unit}` : nv.amount || nv.unit || '-'}
              </td>
              <td className="dv">{nv.daily_value_percent_adult || '-'}</td>
              {hasChildrenDV && (
                <td className="dv">{nv.daily_value_percent_children || '-'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dv-footnote">
        * Percent Daily Values are based on a 2,000 calorie diet.
      </div>
    </div>
  );
}

export default SupplementFacts;
