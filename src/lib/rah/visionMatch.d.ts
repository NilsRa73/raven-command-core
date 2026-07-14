export type MatchStrength = "hash" | "metadata" | "none";
export interface MatchResult { strength: MatchStrength; reason: string; }
export interface FindMatchResult extends MatchResult { targetId: string | null; }
export function classifyMatchStrength(a: unknown, b: unknown): MatchResult;
export function matchStrengthLabel(s: MatchStrength | string): string;
export function findStrongestMatch(candidate: unknown, existingList?: unknown[]): FindMatchResult;