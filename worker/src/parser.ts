import { DiceModifiers, DiceGroup, DiceResult } from './types';

type RollFn = (sides: number) => number;
type GroupRollFn = (expression: string) => number;

const defaultRollFn: RollFn = (sides) => Math.floor(Math.random() * sides) + 1;

export class DiceParser {
  private position = 0;
  private input = '';
  private rollFn: RollFn = defaultRollFn;
  private groupRollFn?: GroupRollFn;
  private groups_: DiceGroup[] = [];
  private readonly MAX_NUMBER = 1000000;
  private readonly MAX_DICE_COUNT = 1000;
  private readonly MAX_DICE_SIDES = 10000;

  parse(expression: string, rollFn?: RollFn, groupRollFn?: GroupRollFn): DiceResult {
    this.input = expression.toLowerCase().replace(/\s+/g, '');
    this.position = 0;
    this.rollFn = rollFn ?? defaultRollFn;
    this.groupRollFn = groupRollFn;
    this.groups_ = [];

    try {
      const result = this.parseExpression();
      if (this.position < this.input.length) {
        throw new Error(`Unexpected character at position ${this.position}: '${this.input[this.position]}'`);
      }
      return { ...result, groups: [...this.groups_] };
    } catch (error: any) {
      throw new Error(`Parse error: ${error.message}`);
    }
  }

  // Returns the dice group expressions in parse order, for user-mode elicitation.
  listGroups(expression: string): string[] {
    const groups: string[] = [];
    try {
      this.parse(expression, undefined, (expr) => {
        groups.push(expr);
        return 1;
      });
    } catch { /* ignore parse errors — caller validates separately */ }
    return groups;
  }

  private parseExpression(): DiceResult {
    let left = this.parseTerm();

    while (this.position < this.input.length) {
      const operator = this.input[this.position];
      if (operator === '+' || operator === '-') {
        this.position++;
        const right = this.parseTerm();
        left = this.combineResults(left, right, operator);
      } else {
        break;
      }
    }

    return left;
  }

  private parseTerm(): DiceResult {
    let left = this.parseFactor();

    while (this.position < this.input.length) {
      const char = this.input[this.position];
      if (char === '*' || char === '×' || char === '·') {
        this.position++;
        const right = this.parseFactor();
        left = this.multiplyResults(left, right);
      } else {
        break;
      }
    }

    return left;
  }

  private parseFactor(): DiceResult {
    // Unary minus before ( or min/max — not handled by parseDiceOrNumber.
    if (this.peek() === '-') {
      const after = this.input.slice(this.position + 1);
      if (after.startsWith('(') || after.startsWith('min(') || after.startsWith('max(')) {
        this.position++;
        const inner = this.parseFactor();
        return {
          ...inner,
          total: -inner.total,
          simplified: `-${inner.simplified}`,
          expression: `-${inner.expression}`,
        };
      }
    }

    const remaining = this.input.slice(this.position);

    if (remaining.startsWith('min(') || remaining.startsWith('max(')) {
      const fn = remaining.startsWith('min(') ? 'min' : 'max';
      this.position += fn.length + 1;
      const args = this.parseFunctionArgs(fn);
      if (this.peek() !== ')') {
        throw new Error(`Missing closing parenthesis after ${fn}()`);
      }
      this.position++;
      const totals = args.map(a => a.total);
      const total = fn === 'min' ? Math.min(...totals) : Math.max(...totals);
      return {
        total,
        groups: [],
        expression: `${fn}(${args.map(a => a.expression).join(', ')})`,
        simplified: `${fn}(${args.map(a => a.simplified).join(', ')})`,
      };
    }

    if (this.peek() === '(') {
      this.position++;
      const result = this.parseExpression();
      if (this.peek() !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      this.position++;
      return {
        ...result,
        simplified: `(${result.simplified})`,
        expression: `(${result.expression})`,
      };
    }

    return this.parseDiceOrNumber();
  }

  private parseFunctionArgs(fn: string): DiceResult[] {
    const args: DiceResult[] = [this.parseExpression()];
    while (this.peek() === ',') {
      this.position++;
      args.push(this.parseExpression());
    }
    if (args.length < 2) {
      throw new Error(`${fn}() requires at least 2 arguments`);
    }
    return args;
  }

  private parseDiceOrNumber(): DiceResult {
    const start = this.position;

    let negative = false;
    if (this.peek() === '-') {
      negative = true;
      this.position++;
    }

    const count = this.parseNumber();

    if (this.peek() === 'd') {
      this.position++;

      if (this.peek() === '%') {
        this.position++;
        return this.rollDice(count || 1, 100, { negative });
      }

      if (this.peek() === 'f') {
        this.position++;
        return this.rollFudgeDice(count || 1, { negative });
      }

      const sides = this.parseNumber();
      if (!sides) {
        throw new Error("Missing number of sides after 'd'");
      }

      const modifiers = this.parseModifiers();
      return this.rollDice(count || 1, sides, { ...modifiers, negative });
    }

    if (count === null) {
      throw new Error(`Expected number or dice notation at position ${start}`);
    }

    const value = negative ? -count : count;
    return {
      total: value,
      groups: [],
      expression: String(value),
      simplified: String(value),
    };
  }

  private parseModifiers(): DiceModifiers {
    const modifiers: DiceModifiers = {};

    while (this.position < this.input.length) {
      const char = this.peek();

      if (char === 'k') {
        this.position++;
        modifiers.keep = this.parseNumber() ?? undefined;
        if (!modifiers.keep) throw new Error("Missing number after 'k'");
      } else if (char === 'd' && /\d/.test(this.peek(1))) {
        this.position++;
        modifiers.drop = this.parseNumber() ?? undefined;
        if (!modifiers.drop) throw new Error("Missing number after 'd'");
      } else if (char === '!' || char === 'e') {
        this.position++;
        modifiers.explode = true;
        if (/\d/.test(this.peek())) {
          modifiers.explodeOn = this.parseNumber() ?? undefined;
        }
      } else if (char === 'r') {
        this.position++;
        modifiers.reroll = this.parseNumber() ?? undefined;
        if (!modifiers.reroll) throw new Error("Missing number after 'r'");
      } else {
        break;
      }
    }

    return modifiers;
  }

  private parseNumber(): number | null {
    const start = this.position;
    while (this.position < this.input.length && /\d/.test(this.input[this.position])) {
      this.position++;
    }

    if (start === this.position) return null;
    const num = parseInt(this.input.slice(start, this.position));

    if (num > this.MAX_NUMBER) {
      throw new Error(`Number too large (max ${this.MAX_NUMBER.toLocaleString()})`);
    }

    return num;
  }

  private peek(offset = 0): string {
    return this.input[this.position + offset] || '';
  }

  private rollDice(count: number, sides: number, options: DiceModifiers & { negative?: boolean } = {}): DiceResult {
    if (count <= 0 || count > this.MAX_DICE_COUNT) {
      throw new Error(`Dice count must be between 1 and ${this.MAX_DICE_COUNT}`);
    }
    if (sides <= 0 || sides > this.MAX_DICE_SIDES) {
      throw new Error(`Dice sides must be between 1 and ${this.MAX_DICE_SIDES}`);
    }
    if (count * sides > this.MAX_NUMBER) {
      throw new Error('Total possible outcomes too large');
    }

    // Build the canonical group expression (without leading minus).
    let absExpr = `${count}d${sides}`;
    if (options.keep) absExpr += `k${options.keep}`;
    if (options.drop) absExpr += `d${options.drop}`;
    if (options.explode) absExpr += options.explodeOn ? `e${options.explodeOn}` : '!';
    if (options.reroll) absExpr += `r${options.reroll}`;

    const expr = options.negative ? `-${absExpr}` : absExpr;

    // Group-level substitution: user supplied the group total directly.
    if (this.groupRollFn) {
      const userTotal = this.groupRollFn(absExpr);
      const total = options.negative ? -userTotal : userTotal;
      this.groups_.push({ expression: absExpr, display: String(userTotal), total: userTotal });
      return { total, groups: [], expression: expr, simplified: String(total) };
    }

    // Normal per-die rolling.
    const dieTotals: number[] = [];
    const dieDisplays: string[] = [];

    for (let i = 0; i < count; i++) {
      let roll = this.rollFn(sides);
      let display = String(roll);

      // Reroll first so explosion sees the final face value.
      if (options.reroll && roll <= options.reroll) {
        const newRoll = this.rollFn(sides);
        display = `${roll}→${newRoll}`;
        roll = newRoll;
      }

      let dieTotal = roll;

      if (options.explode) {
        const explodeThreshold = options.explodeOn || sides;
        const explosions: number[] = [];
        let explodeCount = 0;
        while (roll >= explodeThreshold && explodeCount < 100) {
          roll = this.rollFn(sides);
          dieTotal += roll;
          explosions.push(roll);
          explodeCount++;
        }
        if (explosions.length > 0) {
          display += `!${explosions.join('!')}`;
        }
      }

      dieTotals.push(dieTotal);
      dieDisplays.push(display);
    }

    let finalTotals = [...dieTotals];
    let finalDisplays = [...dieDisplays];
    if (options.keep) {
      const indexed = dieTotals.map((v, i) => ({ v, display: dieDisplays[i] }));
      indexed.sort((a, b) => b.v - a.v);
      const kept = indexed.slice(0, options.keep);
      finalTotals = kept.map(x => x.v);
      finalDisplays = kept.map(x => x.display);
    } else if (options.drop) {
      const indexed = dieTotals.map((v, i) => ({ v, display: dieDisplays[i] }));
      indexed.sort((a, b) => a.v - b.v);
      const remaining = indexed.slice(options.drop);
      finalTotals = remaining.map(x => x.v);
      finalDisplays = remaining.map(x => x.display);
    }

    const sum = finalTotals.reduce((s, r) => s + r, 0);
    const total = options.negative ? -sum : sum;

    let groupDisplay = `[${dieDisplays.join(', ')}]`;
    if (options.keep || options.drop) {
      groupDisplay += ` → [${finalDisplays.join(', ')}]`;
    }
    groupDisplay += ` = ${sum}`;

    this.groups_.push({ expression: absExpr, display: groupDisplay, total: sum });
    return { total, groups: [], expression: expr, simplified: String(total) };
  }

  private rollFudgeDice(count: number, options: { negative?: boolean } = {}): DiceResult {
    if (count <= 0 || count > this.MAX_DICE_COUNT) {
      throw new Error(`Dice count must be between 1 and ${this.MAX_DICE_COUNT}`);
    }

    const absExpr = `${count}dF`;
    const expr = options.negative ? `-${absExpr}` : absExpr;

    if (this.groupRollFn) {
      const userTotal = this.groupRollFn(absExpr);
      const total = options.negative ? -userTotal : userTotal;
      this.groups_.push({ expression: absExpr, display: String(userTotal), total: userTotal });
      return { total, groups: [], expression: expr, simplified: String(total) };
    }

    const rolls: number[] = [];
    for (let i = 0; i < count; i++) {
      rolls.push(this.rollFn(3) - 2);
    }

    const sum = rolls.reduce((s, r) => s + r, 0);
    const total = options.negative ? -sum : sum;
    const symbols = rolls.map(r => (r === -1 ? '[-]' : r === 0 ? '[ ]' : '[+]'));
    const groupDisplay = `${symbols.join(' ')} = ${sum}`;

    this.groups_.push({ expression: absExpr, display: groupDisplay, total: sum });
    return { total, groups: [], expression: expr, simplified: String(total) };
  }

  private combineResults(left: DiceResult, right: DiceResult, operator: string): DiceResult {
    const total = operator === '+' ? left.total + right.total : left.total - right.total;
    return {
      total,
      groups: [],
      expression: `${left.expression}${operator}${right.expression}`,
      simplified: `${left.simplified} ${operator} ${right.simplified}`,
    };
  }

  private multiplyResults(left: DiceResult, right: DiceResult): DiceResult {
    return {
      total: left.total * right.total,
      groups: [],
      expression: `${left.expression}×${right.expression}`,
      simplified: `${left.simplified} × ${right.simplified}`,
    };
  }
}
