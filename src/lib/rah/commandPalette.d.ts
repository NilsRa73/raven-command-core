export interface PaletteCommand {
  id: string;
  title: string;
  hint?: string;
  section: string;
  keywords?: string[];
  to?: string;
  action?: string;
  shortcut?: string;
}
export const PALETTE_COMMANDS: PaletteCommand[];
export function filterPaletteCommands(query: string, list?: PaletteCommand[]): PaletteCommand[];
export function groupBySection(commands: PaletteCommand[]): { section: string; items: PaletteCommand[] }[];
export function isFreeformPrompt(query: string): boolean;
