import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DiceParser } from './parser';

const ElicitResultSchema = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export class DiceRollerAgent extends McpAgent {
  server = new McpServer({ name: 'dice-roller', version: '1.0.0' });
  private parser = new DiceParser();

  async init() {
    this.server.tool(
      'roll',
      [
        'Roll dice using standard notation.',
        'Examples: "d20", "3d6+2", "4d6k3" (keep highest 3), "2d6!" (exploding), "d%", "4dF".',
        'mode "user" opens an elicitation dialog for manual input; "system" auto-rolls.',
        'Note: exploding/reroll modifiers show a fixed number of input fields in user mode',
        '(extra explosion rolls fall back to system).',
      ].join(' '),
      {
        expression: z.string().describe('Dice expression, e.g. "2d6+3" or "4d6k3"'),
        mode: z
          .enum(['system', 'user'])
          .default('system')
          .describe('"system" generates rolls automatically; "user" prompts via MCP elicitation'),
      },
      async ({ expression, mode }) => {
        if (mode === 'user') {
          return this.rollUser(expression);
        }
        return this.rollSystem(expression);
      },
    );
  }

  private rollSystem(expression: string) {
    try {
      const result = this.parser.parse(expression);
      return {
        content: [
          {
            type: 'text' as const,
            text: `(system) ${result.expression}\n${result.breakdown}\nTotal: ${result.total}`,
          },
        ],
      };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
    }
  }

  private async rollUser(expression: string) {
    let diceNeeded: number[];
    try {
      diceNeeded = this.parser.listDice(expression);
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
    }

    if (diceNeeded.length === 0) {
      // Pure arithmetic — no dice to elicit.
      return this.rollSystem(expression);
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

    let elicitResult: z.infer<typeof ElicitResultSchema>;
    try {
      // server.server is the underlying low-level Server instance.
      elicitResult = await (this.server as any).server.request(
        {
          method: 'elicitation/create',
          params: {
            message: `Roll the dice for: ${expression}`,
            requestedSchema: { type: 'object', properties, required },
          },
        },
        ElicitResultSchema,
      );
    } catch {
      // Client doesn't support elicitation — fall back silently.
      return this.rollSystem(expression);
    }

    if (elicitResult.action !== 'accept' || !elicitResult.content) {
      return { content: [{ type: 'text' as const, text: 'Roll cancelled.' }] };
    }

    const userValues = Object.values(elicitResult.content) as number[];
    let idx = 0;

    try {
      // Re-parse with user-supplied values; any extra rolls (explosions) fall back to Math.random.
      const result = this.parser.parse(expression, (sides) => {
        if (idx < userValues.length) return userValues[idx++];
        return Math.floor(Math.random() * sides) + 1;
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `(user) ${result.expression}\n${result.breakdown}\nTotal: ${result.total}`,
          },
        ],
      };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
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
