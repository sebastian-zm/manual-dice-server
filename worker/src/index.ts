import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DiceParser } from './parser';
import { DiceResult } from './types';

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

const MODE_DESCRIPTION =
  '"system" returns just the total; ' +
  '"transparent" shows per-group breakdown and the full evaluation chain; ' +
  '"user" prompts via MCP elicitation for each dice group so the user can roll physical dice';

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

// Formats a parsed result with per-group breakdown + evaluation chain.
function formatTransparent(result: DiceResult): string {
  const lines: string[] = result.groups.map(g => `${g.expression}: ${g.display}`);
  const isSimple = result.simplified === String(result.total);
  lines.push(
    isSimple
      ? `${result.expression} = ${result.total}`
      : `${result.expression} = ${result.simplified} = ${result.total}`,
  );
  return lines.join('\n');
}

export class DiceRollerAgent extends McpAgent {
  server = new McpServer({ name: 'dice-roller', version: '1.0.0' });
  private parser = new DiceParser();

  async init() {
    this.server.tool(
      'roll_dice',
      'Roll dice. Use mode "system" for a quick total, "transparent" for the full breakdown, ' +
        'or "user" to let the user enter results from physical dice via MCP elicitation. ' +
        'Pass a comma-separated list to roll multiple expressions at once.',
      {
        expression: z.string().describe(EXPRESSION_DESCRIPTION),
        mode: z.enum(['system', 'transparent', 'user']).default('system').describe(MODE_DESCRIPTION),
        description: z
          .string()
          .optional()
          .describe('Optional label for this roll or group of rolls, e.g. "Attack roll"'),
      },
      async ({ expression, mode, description }) => {
        const exprs = splitExpressions(expression);
        const multi = exprs.length > 1;

        if (mode === 'system') {
          return this.rollSystem(exprs, description, multi);
        }
        if (mode === 'transparent') {
          return this.rollTransparent(exprs, description, multi);
        }
        return this.rollUser(exprs, description, multi);
      },
    );
  }

  private rollSystem(exprs: string[], description: string | undefined, multi: boolean) {
    const lines: string[] = [];
    for (const expr of exprs) {
      try {
        const result = this.parser.parse(expr);
        lines.push(multi ? `${result.expression}: ${result.total}` : String(result.total));
      } catch (err: any) {
        lines.push(`${expr}: Error: ${err.message}`);
      }
    }
    const header = description ? (multi ? `${description}\n` : `${description}: `) : '';
    return { content: [{ type: 'text' as const, text: `${header}${lines.join('\n')}` }] };
  }

  private rollTransparent(exprs: string[], description: string | undefined, multi: boolean) {
    const blocks: string[] = [];
    for (const expr of exprs) {
      try {
        blocks.push(formatTransparent(this.parser.parse(expr)));
      } catch (err: any) {
        blocks.push(`${expr}: Error: ${err.message}`);
      }
    }
    const header = description ? `${description}\n` : '';
    return { content: [{ type: 'text' as const, text: `${header}${blocks.join('\n\n')}` }] };
  }

  private async rollUser(exprs: string[], description: string | undefined, multi: boolean) {
    type ExprInfo = { expr: string; groups: string[]; error?: string };
    const exprInfos: ExprInfo[] = exprs.map(expr => {
      try {
        return { expr, groups: this.parser.listGroups(expr) };
      } catch (err: any) {
        return { expr, groups: [], error: err.message };
      }
    });

    // Flatten all dice groups from all expressions into one elicitation form.
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    let keyIdx = 0;
    for (const { groups } of exprInfos) {
      for (const groupExpr of groups) {
        const key = `roll_${++keyIdx}`;
        properties[key] = {
          type: 'integer',
          title: groupExpr,
          description: `Enter your total for ${groupExpr}`,
        };
        required.push(key);
      }
    }

    let allValues: number[] = [];
    if (keyIdx > 0) {
      const message = description
        ? `${description} — roll the dice for: ${exprs.join(', ')}`
        : `Roll the dice for: ${exprs.join(', ')}`;

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
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: this client does not support MCP elicitation. Use mode "system" or "transparent" instead.',
          }],
        };
      }

      if (elicitResult.action !== 'accept' || !elicitResult.content) {
        return { content: [{ type: 'text' as const, text: 'Roll cancelled.' }] };
      }

      allValues = Object.values(elicitResult.content) as number[];
    }

    // Distribute values back to each expression by slice.
    const blocks: string[] = [];
    let valueOffset = 0;
    for (const { expr, groups, error } of exprInfos) {
      if (error) {
        blocks.push(`Error: ${error}`);
        continue;
      }
      const exprValues = allValues.slice(valueOffset, valueOffset + groups.length);
      valueOffset += groups.length;
      let idx = 0;
      try {
        const result = this.parser.parse(expr, undefined, (_e) => {
          if (idx < exprValues.length) return exprValues[idx++];
          return 1;
        });
        const prefix = !multi && description ? `${description}\n` : '';
        blocks.push(`${prefix}${formatTransparent(result)}`);
      } catch (err: any) {
        blocks.push(`Error: ${err.message}`);
      }
    }

    const header = description && multi ? `${description}\n` : '';
    return { content: [{ type: 'text' as const, text: `${header}${blocks.join('\n\n')}` }] };
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
