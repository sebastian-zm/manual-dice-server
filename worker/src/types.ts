export interface DiceModifiers {
  keep?: number;
  drop?: number;
  explode?: boolean;
  explodeOn?: number;
  compound?: boolean;
  reroll?: number;
  negative?: boolean;
}

export interface DiceGroup {
  expression: string;  // e.g. "2d6k1" (no leading minus)
  display: string;     // e.g. "[4, 2] → [4] = 5" or "5" for user-entered
  total: number;       // always positive; sign lives in DiceResult
}

export interface DiceResult {
  total: number;
  groups: DiceGroup[];  // populated by root parse() call only
  expression: string;   // e.g. "2d6k1+min(2d6, 5d3!)"
  simplified: string;   // group totals substituted in, e.g. "5 + min(8, 39)"
}
