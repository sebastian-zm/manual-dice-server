import { DiceModifiers, DiceResult } from './types';

type RollFn = (sides: number) => number;

const defaultRollFn: RollFn = (sides) => Math.floor(Math.random() * sides) + 1;

export class DiceParser {
  private position = 0;
  private input = '';
  private rollFn: RollFn = defaultRollFn;
  private readonly MAX_NUMBER = 1000000;
  private readonly MAX_DICE_COUNT = 1000;
  private readonly MAX_DICE_SIDES = 10000;

  parse(expression: string, rollFn?: RollFn): DiceResult {
    this.input = expression.toLowerCase().replace(/\s+/g, '');
    this.position = 0;
    this.rollFn = rollFn ?? defaultRollFn;

    try {
      const result = this.parseExpression();
      if (this.position < this.input.length) {
        throw new Error(`Unexpected character at position ${this.position}: '${this.input[this.position]}'`);
      }
      return result;
    } catch (error: any) {
      throw new Error(`Parse error: ${error.message}`);
    }
  }

  // Returns the ordered list of die sizes the expression would roll.
  // Uses mid-range placeholder values so exploding dice don't add extra rolls.
  listDice(expression: string): number[] {
    const dice: number[] = [];
    try {
      this.parse(expression, (sides) => {
        dice.push(sides);
        return Math.ceil(sides / 2);
      });
    } catch { /* ignore */ }
    return dice;
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
    if (this.peek() === '(') {
      this.position++;
      const result = this.parseExpression();
      if (this.peek() !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      this.position++;
      return result;
    }

    return this.parseDiceOrNumber();
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

    return {
      total: negative ? -count : count,
      rolls: [],
      expression: negative ? `-${count}` : count.toString(),
      breakdown: negative ? `-${count}` : count.toString(),
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

    const dieTotals: number[] = [];
    const dieDisplays: string[] = [];
    const allRolls: number[] = [];

    for (let i = 0; i < count; i++) {
      let roll = this.rollFn(sides);
      allRolls.push(roll);
      let display = `${roll}`;

      // Reroll first so explosion sees the final face value.
      if (options.reroll && roll <= options.reroll) {
        const newRoll = this.rollFn(sides);
        allRolls.push(newRoll);
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
          allRolls.push(roll);
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
    const total = sum * (options.negative ? -1 : 1);

    let expr = `${count}d${sides}`;
    if (options.keep) expr += `k${options.keep}`;
    if (options.drop) expr += `d${options.drop}`;
    if (options.explode) expr += options.explodeOn ? `e${options.explodeOn}` : '!';
    if (options.reroll) expr += `r${options.reroll}`;
    if (options.negative) expr = `-${expr}`;

    return {
      total,
      rolls: allRolls,
      expression: expr,
      breakdown: this.buildBreakdown(dieDisplays, finalDisplays, sum, options),
    };
  }

  private rollFudgeDice(count: number, options: { negative?: boolean } = {}): DiceResult {
    if (count <= 0 || count > this.MAX_DICE_COUNT) {
      throw new Error(`Dice count must be between 1 and ${this.MAX_DICE_COUNT}`);
    }

    const rolls: number[] = [];
    for (let i = 0; i < count; i++) {
      // rollFn(3) → 1/2/3; subtract 2 to get -1/0/+1
      rolls.push(this.rollFn(3) - 2);
    }

    const total = rolls.reduce((sum, roll) => sum + roll, 0) * (options.negative ? -1 : 1);
    const symbols = rolls.map(r => (r === -1 ? '[-]' : r === 0 ? '[ ]' : '[+]'));

    return {
      total,
      rolls,
      expression: `${options.negative ? '-' : ''}${count}dF`,
      breakdown: `${symbols.join(' ')} = ${total}`,
    };
  }

  private buildBreakdown(
    originalDisplays: string[],
    finalDisplays: string[],
    sum: number,
    options: DiceModifiers,
  ): string {
    let breakdown = `[${originalDisplays.join(', ')}]`;
    if (options.keep || options.drop) {
      breakdown += ` → [${finalDisplays.join(', ')}]`;
    }
    breakdown += ` = ${sum}`;
    return breakdown;
  }

  private combineResults(left: DiceResult, right: DiceResult, operator: string): DiceResult {
    const total = operator === '+' ? left.total + right.total : left.total - right.total;
    return {
      total,
      rolls: [...left.rolls, ...right.rolls],
      expression: `${left.expression} ${operator} ${right.expression}`,
      breakdown: `${left.breakdown} ${operator} ${right.breakdown} = ${total}`,
    };
  }

  private multiplyResults(left: DiceResult, right: DiceResult): DiceResult {
    return {
      total: left.total * right.total,
      rolls: [...left.rolls, ...right.rolls],
      expression: `${left.expression} × ${right.expression}`,
      breakdown: `(${left.breakdown}) × (${right.breakdown}) = ${left.total * right.total}`,
    };
  }
}
