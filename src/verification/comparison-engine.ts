import { SupplementFactsData, NutrientData } from '../parser/json-validator.js';
import logger from '../utils/logger.js';

export interface ComparisonResult {
  hasDiscrepancies: boolean;
  discrepancies: Discrepancy[];
  similarityScore: number; // 0-100
  recommendsReview: boolean;
  fieldCounts: {
    total: number;
    matching: number;
    different: number;
    missing: number;
  };
}

export interface Discrepancy {
  fieldPath: string;
  claudeValue: any;
  grokValue: any;
  type: 'missing' | 'different' | 'extra';
  severity: 'low' | 'medium' | 'high';
  confidenceScore: number;
  description: string;
}

export class ComparisonEngine {
  /**
   * Main comparison function for supplement facts
   */
  compareSupplementFacts(
    claude: SupplementFactsData,
    grok: SupplementFactsData
  ): ComparisonResult {
    const discrepancies: Discrepancy[] = [];

    // Compare basic fields
    discrepancies.push(...this.compareTextField('supplementFacts.servings', claude.servings, grok.servings));
    discrepancies.push(...this.compareTextField('supplementFacts.servingsPerContainer', claude.servingsPerContainer, grok.servingsPerContainer));
    discrepancies.push(...this.compareTextField('supplementFacts.calories', claude.calories || null, grok.calories || null));
    discrepancies.push(...this.compareTextField('supplementFacts.protein', claude.protein || null, grok.protein || null));

    // Compare nutrients (most critical)
    discrepancies.push(...this.compareNutrients(claude.nutrients, grok.nutrients));

    // Calculate similarity score
    const similarityScore = this.calculateSimilarityScore(claude, grok, discrepancies);

    // Determine if review needed
    const highSeverityCount = discrepancies.filter(d => d.severity === 'high').length;
    const mediumSeverityCount = discrepancies.filter(d => d.severity === 'medium').length;
    const recommendsReview = highSeverityCount > 0 || mediumSeverityCount > 2 || similarityScore < 85;

    logger.debug(`Comparison completed: ${discrepancies.length} discrepancies, similarity ${similarityScore.toFixed(1)}%`);

    return {
      hasDiscrepancies: discrepancies.length > 0,
      discrepancies,
      similarityScore,
      recommendsReview,
      fieldCounts: {
        total: this.countTotalFields(claude),
        matching: this.countMatchingFields(claude, grok),
        different: discrepancies.filter(d => d.type === 'different').length,
        missing: discrepancies.filter(d => d.type === 'missing').length
      }
    };
  }

  /**
   * Compare nutrients arrays between Claude and Grok
   */
  private compareNutrients(
    claudeNutrients: NutrientData[],
    grokNutrients: NutrientData[]
  ): Discrepancy[] {
    const discrepancies: Discrepancy[] = [];

    // Build maps for fuzzy matching
    const claudeMap = new Map(claudeNutrients.map(n => [this.normalizeNutrientName(n.name), n]));
    const grokMap = new Map(grokNutrients.map(n => [this.normalizeNutrientName(n.name), n]));

    // Check Claude nutrients against Grok
    claudeNutrients.forEach((claudeNutrient, index) => {
      const normalizedName = this.normalizeNutrientName(claudeNutrient.name);
      const grokNutrient = grokMap.get(normalizedName);

      if (!grokNutrient) {
        // Missing in Grok
        discrepancies.push({
          fieldPath: `supplementFacts.nutrients[${index}]`,
          claudeValue: claudeNutrient,
          grokValue: null,
          type: 'missing',
          severity: 'high',
          confidenceScore: 50,
          description: `Nutrient "${claudeNutrient.name}" found by Claude but not Grok`
        });
        return;
      }

      // Compare amount
      if (!this.amountsMatch(claudeNutrient.amount || null, grokNutrient.amount || null)) {
        discrepancies.push({
          fieldPath: `supplementFacts.nutrients[${index}].amount`,
          claudeValue: claudeNutrient.amount,
          grokValue: grokNutrient.amount,
          type: 'different',
          severity: 'high', // Amount differences are critical
          confidenceScore: 60,
          description: `Amount mismatch for ${claudeNutrient.name}: "${claudeNutrient.amount}" vs "${grokNutrient.amount}"`
        });
      }

      // Compare daily value percentages (adult)
      if (!this.percentagesMatch(
        claudeNutrient.dailyValuePercentAdult || null,
        grokNutrient.dailyValuePercentAdult || null
      )) {
        discrepancies.push({
          fieldPath: `supplementFacts.nutrients[${index}].dailyValuePercentAdult`,
          claudeValue: claudeNutrient.dailyValuePercentAdult,
          grokValue: grokNutrient.dailyValuePercentAdult,
          type: 'different',
          severity: 'medium',
          confidenceScore: 70,
          description: `Daily value % (adult) mismatch for ${claudeNutrient.name}`
        });
      }

      // Compare daily value percentages (children)
      if (!this.percentagesMatch(
        claudeNutrient.dailyValuePercentChildren || null,
        grokNutrient.dailyValuePercentChildren || null
      )) {
        discrepancies.push({
          fieldPath: `supplementFacts.nutrients[${index}].dailyValuePercentChildren`,
          claudeValue: claudeNutrient.dailyValuePercentChildren,
          grokValue: grokNutrient.dailyValuePercentChildren,
          type: 'different',
          severity: 'medium',
          confidenceScore: 70,
          description: `Daily value % (children) mismatch for ${claudeNutrient.name}`
        });
      }
    });

    // Check for extra nutrients in Grok (not in Claude)
    grokNutrients.forEach((grokNutrient, index) => {
      const normalizedName = this.normalizeNutrientName(grokNutrient.name);
      if (!claudeMap.has(normalizedName)) {
        discrepancies.push({
          fieldPath: `supplementFacts.nutrients[grok-${index}]`,
          claudeValue: null,
          grokValue: grokNutrient,
          type: 'extra',
          severity: 'high',
          confidenceScore: 50,
          description: `Nutrient "${grokNutrient.name}" found by Grok but not Claude`
        });
      }
    });

    return discrepancies;
  }

  /**
   * Normalize nutrient name for fuzzy matching
   */
  private normalizeNutrientName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\(.*?\)/g, '') // Remove parentheses content
      .replace(/[^a-z0-9]/g, '') // Remove special chars
      .replace(/vitamin/g, 'vit')
      .trim();
  }

  /**
   * Check if two amount values match (with tolerance for units and rounding)
   */
  private amountsMatch(amount1: string | null, amount2: string | null): boolean {
    if (amount1 === null && amount2 === null) return true;
    if (amount1 === null || amount2 === null) return false;

    // Parse numeric value and unit
    const parsed1 = this.parseAmount(amount1);
    const parsed2 = this.parseAmount(amount2);

    if (!parsed1 || !parsed2) return false;

    // Check if units are equivalent
    if (!this.unitsEquivalent(parsed1.unit, parsed2.unit)) return false;

    // Check if values are close (within 1% tolerance for rounding)
    const tolerance = parsed1.value * 0.01;
    return Math.abs(parsed1.value - parsed2.value) <= tolerance;
  }

  /**
   * Parse amount string into numeric value and unit
   */
  private parseAmount(amount: string): { value: number; unit: string } | null {
    const match = amount.match(/^<?(\d+(?:\.\d+)?)\s*([a-zA-Zα-ωµμ]+)/);
    if (!match) return null;
    return {
      value: parseFloat(match[1]),
      unit: match[2].toLowerCase()
    };
  }

  /**
   * Check if two units are equivalent
   */
  private unitsEquivalent(unit1: string, unit2: string): boolean {
    const normalized1 = unit1.toLowerCase().replace(/[^a-zα-ωµμ]/g, '');
    const normalized2 = unit2.toLowerCase().replace(/[^a-zα-ωµμ]/g, '');

    // Handle common equivalents
    const equivalents: { [key: string]: string } = {
      'mcg': 'ug',
      'μg': 'ug',
      'µg': 'ug',
      'iu': 'iu',
      'mg': 'mg',
      'g': 'g',
      'l': 'l',
      'ml': 'ml'
    };

    const norm1 = equivalents[normalized1] || normalized1;
    const norm2 = equivalents[normalized2] || normalized2;

    return norm1 === norm2;
  }

  /**
   * Check if two percentage values match (with tolerance)
   */
  private percentagesMatch(percent1: string | null, percent2: string | null): boolean {
    if (percent1 === null && percent2 === null) return true;
    if (percent1 === null || percent2 === null) return false;

    const num1 = parseFloat(percent1.replace(/[^0-9.]/g, ''));
    const num2 = parseFloat(percent2.replace(/[^0-9.]/g, ''));

    if (isNaN(num1) || isNaN(num2)) return false;

    // Allow 1% tolerance for rounding
    return Math.abs(num1 - num2) <= 1;
  }

  /**
   * Compare text field values
   */
  private compareTextField(
    fieldPath: string,
    value1: string | null,
    value2: string | null
  ): Discrepancy[] {
    if (value1 === value2) return [];

    // Normalize and compare
    const normalized1 = value1?.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalized2 = value2?.toLowerCase().replace(/\s+/g, ' ').trim();

    if (normalized1 === normalized2) return []; // Same after normalization

    return [{
      fieldPath,
      claudeValue: value1,
      grokValue: value2,
      type: 'different',
      severity: 'low', // Text field differences are less critical than nutrient amounts
      confidenceScore: 75,
      description: `Text field mismatch: "${value1}" vs "${value2}"`
    }];
  }

  /**
   * Calculate overall similarity score
   */
  private calculateSimilarityScore(
    claude: SupplementFactsData,
    _grok: SupplementFactsData,
    discrepancies: Discrepancy[]
  ): number {
    const totalFields = this.countTotalFields(claude);

    if (totalFields === 0) return 100;

    // Weight by severity
    const weightedDifferences = discrepancies.reduce((sum, d) => {
      const weight = d.severity === 'high' ? 1 : d.severity === 'medium' ? 0.5 : 0.25;
      return sum + weight;
    }, 0);

    const score = Math.max(0, Math.min(100, 100 - (weightedDifferences / totalFields * 100)));

    return Math.round(score * 10) / 10; // Round to 1 decimal place
  }

  /**
   * Count total fields in supplement facts
   */
  private countTotalFields(data: SupplementFactsData): number {
    let count = 4; // servings, servingsPerContainer, calories, protein
    count += data.nutrients.length * 3; // name, amount, dailyValuePercent for each
    return count;
  }

  /**
   * Count matching fields between Claude and Grok
   */
  private countMatchingFields(claude: SupplementFactsData, grok: SupplementFactsData): number {
    let matching = 0;

    // Basic fields
    if (this.compareTextField('', claude.servings, grok.servings).length === 0) matching++;
    if (this.compareTextField('', claude.servingsPerContainer, grok.servingsPerContainer).length === 0) matching++;
    if (this.compareTextField('', claude.calories || null, grok.calories || null).length === 0) matching++;
    if (this.compareTextField('', claude.protein || null, grok.protein || null).length === 0) matching++;

    // Nutrients - match by normalized name
    const claudeMap = new Map(claude.nutrients.map(n => [this.normalizeNutrientName(n.name), n]));
    const grokMap = new Map(grok.nutrients.map(n => [this.normalizeNutrientName(n.name), n]));

    claudeMap.forEach((claudeNutrient, normalizedName) => {
      const grokNutrient = grokMap.get(normalizedName);
      if (grokNutrient) {
        // Name matches
        matching++;

        // Amount matches
        if (this.amountsMatch(claudeNutrient.amount || null, grokNutrient.amount || null)) {
          matching++;
        }

        // Daily value matches
        if (this.percentagesMatch(
          claudeNutrient.dailyValuePercentAdult || null,
          grokNutrient.dailyValuePercentAdult || null
        )) {
          matching++;
        }
      }
    });

    return matching;
  }
}
