import type { Logger } from 'pino';
import type { FlightOffer, FlightProvider, SearchQuery } from '../types.js';
import { ProviderError } from '../types.js';

/** Tenta cada provedor na ordem; passa ao próximo apenas quando o atual falha (erro, não resultado vazio). */
export class FallbackProvider implements FlightProvider {
  readonly name: string;

  constructor(
    private readonly providers: FlightProvider[],
    private readonly log: Logger,
  ) {
    if (providers.length === 0) throw new Error('Nenhum provedor configurado');
    this.name = providers.map((p) => p.name).join('>');
  }

  async search(query: SearchQuery): Promise<FlightOffer[]> {
    const failures: string[] = [];
    for (const provider of this.providers) {
      try {
        return await provider.search(query);
      } catch (error) {
        const message = (error as Error).message;
        failures.push(message);
        this.log.warn({ provider: provider.name, err: message }, 'provedor falhou');
      }
    }
    throw new ProviderError(this.name, `todos os provedores falharam: ${failures.join(' | ')}`);
  }
}
