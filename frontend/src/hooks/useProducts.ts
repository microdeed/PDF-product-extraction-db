import { useQuery } from '@tanstack/react-query';
import { fetchProducts, fetchProduct, fetchSubbrands } from '../services/api';

export function useProducts(
  page: number = 1,
  pageSize: number = 20,
  subbrand?: string,
  search?: string
) {
  return useQuery({
    queryKey: ['products', page, pageSize, subbrand, search],
    queryFn: () => fetchProducts(page, pageSize, subbrand, search)
  });
}

export function useProduct(code: string) {
  return useQuery({
    queryKey: ['product', code],
    queryFn: () => fetchProduct(code),
    enabled: !!code
  });
}

export function useSubbrands() {
  return useQuery({
    queryKey: ['subbrands'],
    queryFn: fetchSubbrands
  });
}
