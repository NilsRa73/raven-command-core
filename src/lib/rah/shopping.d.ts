export interface Product {
  id: string; name: string; category: string;
  priceUsd: number; shippingUsd: number;
  supplier: string; origin: string;
  quality: number; reviewSummary: string;
  compatibility: string[]; risks: string[]; accent: string;
}
export const SHORTLIST_KEY: string;
export const CATALOG: Product[];
export function landedCost(p: Product): number;
export function adjustedQuality(p: Product): number;
export function filterCatalog(list: Product[], query?: string, category?: string): Product[];
export interface ComparisonRow {
  id: string; name: string;
  priceUsd: number; shippingUsd: number; landed: number;
  quality: number; adjusted: number;
  origin: string; supplier: string;
  risks: string[]; compatibility: string[];
}
export interface Comparison { fields: string[]; rows: ComparisonRow[] }
export function buildComparison(products: Product[]): Comparison;
export function loadShortlist(): string[];
export function saveShortlist(ids: string[]): void;
export function toggleShortlist(id: string): string[];