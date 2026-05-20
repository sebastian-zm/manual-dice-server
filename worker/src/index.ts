import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DiceParser } from './parser';

const ElicitResultSchema = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const sharedParams = {
  expression: z.string().describe(
    'Dice expression, e.g. "2d6+3", "4d6k3" (keep highest 3), "3d6!" (exploding), "d%", "4dF"',
  ),
  description: z.string().optional().describe(
    'Optional label for this roll, e.g. "Attack roll" or "Saving throw"',
  ),
};

export class DiceRollerAgent extends McpAgent {
  server = new McpServer({ name: 'dice-roller', version: '1.0.0' });
  private parser = new DiceParser();

  async init() {
    this.server.tool(
      'roll_dice',
      'Roll dice and return just the total. Use for quick rolls where only the number matters.',
      sharedParams,
      ({ expression, description }) => {
        try {
          const result = this.parser.parse(expression);
          const label = description ? `${description}: ` : '';
          return { content: [{ type: 'text' as const, text: `${label}${result.total}` }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
        }
      },
    );

    this.server.tool(
      'roll_dice_transparent',
      'Roll dice with full breakdown showing all individual die results and calculation steps. Use when the user wants to see the math or verify a roll.',
      sharedParams,
      ({ expression, description }) => {
        try {
          const result = this.parser.parse(expression);
          const label = description ? `${description}\n` : '';
          return {
            content: [
              {
                type: 'text' as const,
                text: `${label}${result.expression}\n${result.breakdown}\nTotal: ${result.total}`,
              },
            ],
          };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
        }
      },
    );

    this.server.tool(
      'roll_dice_user',
      [
        'Prompt the user to enter their own physical dice results via MCP elicitation.',
        'Use when the user wants to roll real dice and supply the values manually.',
        'Requires a client that supports MCP elicitation; returns an error otherwise.',
        'Note: for exploding/reroll expressions only the initial dice are elicited;',
        'any triggered extra rolls (explosions) are resolved automatically.',
      ].join(' '),
      sharedParams,
      async ({ expression, description }) => {
        let diceNeeded: number[];
        try {
          diceNeeded = this.parser.listDice(expression);
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
        }

        if (diceNeeded.length === 0) {
          // Pure arithmetic — nothing to elicit, just evaluate.
          const result = this.parser.parse(expression);
          const label = description ? `${description}\n` : '';
          return {
            content: [
              {
                type: 'text' as const,
                text: `${label}${result.expression}\n${result.breakdown}\nTotal: ${result.total}`,
              },
            ],
          };
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
              params: {
                message,
                requestedSchema: { type: 'object', properties, required },
              },
            },
            ElicitResultSchema,
          );
        } catch {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: this client does not support MCP elicitation. Use roll_dice or roll_dice_transparent instead.',
              },
            ],
          };
        }

        if (elicitResult.action !== 'accept' || !elicitResult.content) {
          return { content: [{ type: 'text' as const, text: 'Roll cancelled.' }] };
        }

        const userValues = Object.values(elicitResult.content) as number[];
        let idx = 0;

        try {
          const result = this.parser.parse(expression, (sides) => {
            if (idx < userValues.length) return userValues[idx++];
            // Extra triggered rolls (explosions beyond the elicited set).
            return Math.floor(Math.random() * sides) + 1;
          });

          const label = description ? `${description}\n` : '';
          return {
            content: [
              {
                type: 'text' as const,
                text: `${label}${result.expression}\n${result.breakdown}\nTotal: ${result.total}`,
              },
            ],
          };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
        }
      },
    );
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
