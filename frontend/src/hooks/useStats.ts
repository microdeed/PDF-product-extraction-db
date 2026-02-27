import { useQuery } from '@tanstack/react-query';
import {
  fetchOverviewStats,
  fetchIngredientFrequencies,
  fetchIngredientDistribution,
  fetchComparison,
  fetchIngredientProducts,
} from '../services/api';

export function useOverviewStats() {
  return useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: fetchOverviewStats,
  });
}

export function useIngredientFrequencies(limit: number = 50) {
  return useQuery({
    queryKey: ['stats', 'ingredients', limit],
    queryFn: () => fetchIngredientFrequencies(limit),
  });
}

export function useIngredientDistribution() {
  return useQuery({
    queryKey: ['stats', 'distribution'],
    queryFn: fetchIngredientDistribution,
  });
}

export function useIngredientProducts(normalizedName: string | null) {
  return useQuery({
    queryKey: ['stats', 'ingredient-products', normalizedName],
    queryFn: () => fetchIngredientProducts(normalizedName!),
    enabled: normalizedName !== null,
  });
}

export function useComparison(codes: string[]) {
  return useQuery({
    queryKey: ['compare', codes],
    queryFn: () => fetchComparison(codes),
    enabled: codes.length >= 2,
  });
}
