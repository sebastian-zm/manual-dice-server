export interface DiceModifiers {
  keep?: number;
  drop?: number;
  explode?: boolean;
  explodeOn?: number;
  reroll?: number;
  negative?: boolean;
}

export interface DiceResult {
  total: number;
  rolls: number[];
  expression: string;
  breakdown: string;
}
