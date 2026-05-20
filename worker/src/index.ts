import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DiceParser } from './parser';

const ElicitResultSchema = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const EXPRESSION_DESCRIPTION =
  'Dice expression, or comma-separated list for multiple rolls at once (e.g. "2d6, d8+2, 4d6k3").\n' +
  'Top-level commas separate expressions; commas inside min()/max() are part of those functions.\n' +
  'Supported notation:\n' +
  '• Basic: 2d6, d20, d% (percentile), 4dF (Fudge/FATE dice)\n' +
  '• Keep/Drop: 4d6k3 (keep highest 3), 5d8d2 (drop lowest 2)\n' +
  '• Exploding: 3d6! (explode on max), 2d10e8 (explode on 8+)\n' +
  '• Reroll: 4d6r1 (reroll 1s)\n' +
  '• Functions: min(2d6, 3d4), max(d20, d12+5)\n' +
  '• Math: d20+5, 2d6*3, (2d4+1)*2';

const DESCRIPTION_DESCRIPTION =
  'Optional label for this roll or group of rolls, e.g. "Attack roll" or "Saving throw"';

const sharedParams = {
  expression: z.string().describe(EXPRESSION_DESCRIPTION),
  description: z.string().optional().describe(DESCRIPTION_DESCRIPTION),
};

// Split on top-level commas only (not inside parentheses).
function splitExpressions(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === '(') depth++;
    else if (expression[i] === ')') depth--;
    else if (expression[i] === ',' && depth === 0) {
      const part = expression.slice(start, i).trim();
      if (part) parts.push(part);
      start = i + 1;
    }
  }
  const last = expression.slice(start).trim();
  if (last) parts.push(last);
  return parts.length ? parts : [expression.trim()];
}

export class DiceRollerAgent extends McpAgent {
  server = new McpServer({ name: 'dice-roller', version: '1.0.0' });
  private parser = new DiceParser();

  async init() {
    this.server.tool(
      'roll_dice',
      'Roll dice and return just the total for each expression. Use for quick rolls where only the number matters.',
      sharedParams,
      ({ expression, description }) => {
        const exprs = splitExpressions(expression);
        const multi = exprs.length > 1;
        const lines: string[] = [];

        for (const expr of exprs) {
          try {
            const result = this.parser.parse(expr);
            lines.push(multi ? `${result.expression}: ${result.total}` : `${result.total}`);
          } catch (err: any) {
            lines.push(`${expr}: Error: ${err.message}`);
          }
        }

        const header = description ? (multi ? `${description}\n` : `${description}: `) : '';
        const body = multi ? lines.join('\n') : lines[0];
        return { content: [{ type: 'text' as const, text: `${header}${body}` }] };
      },
    );

    this.server.tool(
      'roll_dice_transparent',
      'Roll dice with full per-die breakdown and calculation steps. Use when the user wants to see the math or verify a roll.',
      sharedParams,
      ({ expression, description }) => {
        const exprs = splitExpressions(expression);
        const multi = exprs.length > 1;
        const blocks: string[] = [];

        for (const expr of exprs) {
          try {
            const result = this.parser.parse(expr);
            blocks.push(`${result.expression}\n${result.breakdown}\nTotal: ${result.total}`);
          } catch (err: any) {
            blocks.push(`${expr}: Error: ${err.message}`);
          }
        }

        const header = description ? `${description}\n` : '';
        return { content: [{ type: 'text' as const, text: `${header}${blocks.join('\n\n')}` }] };
      },
    );

    this.server.tool(
      'roll_dice_user',
      [
        'Prompt the user to enter their own physical dice results via MCP elicitation.',
        'Use when the user wants to roll real dice and supply the values manually.',
        'Pass a comma-separated list to handle multiple expressions in one call; each gets its own prompt.',
        'Requires a client that supports MCP elicitation; returns an error otherwise.',
        'Note: for exploding/reroll expressions only the initial dice are elicited —',
        'any further triggered rolls (chain explosions) are resolved automatically.',
      ].join(' '),
      sharedParams,
      async ({ expression, description }) => {
        const exprs = splitExpressions(expression);
        const multi = exprs.length > 1;
        const blocks: string[] = [];

        for (const expr of exprs) {
          const block = await this.rollOneUser(expr, description, multi);
          if (block === null) {
            return { content: [{ type: 'text' as const, text: 'Roll cancelled.' }] };
          }
          blocks.push(block);
        }

        const header = description && multi ? `${description}\n` : '';
        return { content: [{ type: 'text' as const, text: `${header}${blocks.join('\n\n')}` }] };
      },
    );
  }

  // Returns the formatted result block for one expression, or null if the user cancelled.
  private async rollOneUser(
    expression: string,
    description: string | undefined,
    multi: boolean,
  ): Promise<string | null> {
    let diceNeeded: number[];
    try {
      diceNeeded = this.parser.listDice(expression);
    } catch (err: any) {
      return `Error: ${err.message}`;
    }

    if (diceNeeded.length === 0) {
      const result = this.parser.parse(expression);
      const prefix = !multi && description ? `${description}\n` : '';
      return `${prefix}${result.expression}\n${result.breakdown}\nTotal: ${result.total}`;
    }

    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    diceNeeded.forEach((sides, idx) => {
      const key = `roll_${idx + 1}`;
      properties[key] = {
        type: 'integer',
        minimum: 1,
        maximum: sides,
        title: `d${sides}`,
        description: `Enter your d${sides} result (1–${sides})`,
      };
      required.push(key);
    });

    const message = description
      ? `${description} — roll the dice for: ${expression}`
      : `Roll the dice for: ${expression}`;

    let elicitResult: z.infer<typeof ElicitResultSchema>;
    try {
      elicitResult = await (this.server as any).server.request(
        {
          method: 'elicitation/create',
          params: { message, requestedSchema: { type: 'object', properties, required } },
        },
        ElicitResultSchema,
      );
    } catch {
      return 'Error: this client does not support MCP elicitation. Use roll_dice or roll_dice_transparent instead.';
    }

    if (elicitResult.action !== 'accept' || !elicitResult.content) {
      return null;
    }

    const userValues = Object.values(elicitResult.content) as number[];
    let idx = 0;

    try {
      const result = this.parser.parse(expression, (sides) => {
        if (idx < userValues.length) return userValues[idx++];
        return Math.floor(Math.random() * sides) + 1;
      });
      const prefix = !multi && description ? `${description}\n` : '';
      return `${prefix}${result.expression}\n${result.breakdown}\nTotal: ${result.total}`;
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  }
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/mcp')) {
      return DiceRollerAgent.mount('/mcp').fetch(req, env, ctx);
    }
    return Promise.resolve(new Response('Not found', { status: 404 }));
  },
} satisfies ExportedHandler<Env>;

interface Env {
  MCP_AGENT: DurableObjectNamespace;
}
