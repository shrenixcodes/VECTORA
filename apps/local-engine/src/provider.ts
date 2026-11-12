/**
 * Optional narrative provider.
 *
 * Disabled by default. When the user enables it and supplies an endpoint that
 * speaks the widely used "chat completions" HTTP format, the statements that
 * were already retrieved from the graph are sent to it to be rewritten as
 * prose. Only those statements (file paths, symbol names, short evidence
 * lines) are sent — never whole files — and the provider cannot add facts:
 * the evidence list shown to the user always comes from the graph.
 */
import type { ExplorationAnswer } from '@vectora/shared';

export interface ProviderConfig {
  endpoint: string;
  model: string;
  apiKey: string | null;
  fetch?: typeof fetch;
}

export interface NarrativeProvider {
  summarize(answer: ExplorationAnswer): Promise<string>;
}

export function createChatCompletionsProvider(cfg: ProviderConfig): NarrativeProvider {
  return {
    async summarize(answer) {
      const url = new URL(cfg.endpoint);
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('The provider endpoint must use HTTPS');
      const facts = answer.statements
        .slice(0, 60)
        .map((s, i) => `${i + 1}. ${s.verified ? '[verified]' : '[derived]'} ${s.text}${s.evidence[0] ? ` (${s.evidence[0].path}:${s.evidence[0].startLine})` : ''}`)
        .join('\n');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await (cfg.fetch ?? fetch)(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
          body: JSON.stringify({
            model: cfg.model,
            temperature: 0,
            messages: [
              {
                role: 'system',
                content:
                  'Rewrite the numbered findings about a software repository as a short, plain explanation. Use only the findings. Keep file references. Say clearly which points are derived rather than verified. Do not add anything that is not in the findings.',
              },
              { role: 'user', content: `Question: ${answer.question}\n\nFindings:\n${facts}\n\nKnown limits:\n${answer.caveats.join('\n') || 'none'}` },
            ],
          }),
        });
        if (!res.ok) throw new Error(`provider returned ${res.status}`);
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error('provider returned no text');
        return text.slice(0, 6000);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const summarizeWithProvider = (cfg: ProviderConfig, answer: ExplorationAnswer): Promise<string> => createChatCompletionsProvider(cfg).summarize(answer);
