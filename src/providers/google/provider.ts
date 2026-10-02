import { ProviderError, type FlightOffer, type FlightProvider, type SearchQuery } from '../../types.js';
import { fetchWithRetry } from '../../utils/http.js';
import { extractPayload, parseOffers } from './parser.js';
import { googleFlightsUrl } from './tfs.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

const ACCEPT_LANGUAGES = ['pt-BR,pt;q=0.9,en;q=0.8', 'pt-BR,pt;q=0.8,en-US;q=0.6,en;q=0.4', 'en-US,en;q=0.9,pt;q=0.7'];

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;

/** Provedor padrão: busca direta no Google Flights (HTML + payload `ds:1`), sem API paga. */
export class GoogleFlightsProvider implements FlightProvider {
  readonly name = 'google-flights';

  async search(query: SearchQuery): Promise<FlightOffer[]> {
    const url = googleFlightsUrl(query);
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': pick(USER_AGENTS),
          'Accept-Language': pick(ACCEPT_LANGUAGES),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          // Aceita o aviso de consentimento (comum em IPs europeus) para receber a página de resultados.
          Cookie: 'SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiAo_CmBg; CONSENT=YES+',
        },
      },
      { retries: 2, backoffMs: 3_000 },
    ).catch((error: unknown) => {
      throw new ProviderError(this.name, 'falha de rede', { cause: error });
    });

    if (response.url.includes('/sorry/') || response.status === 429) {
      throw new ProviderError(this.name, 'bloqueado pelo Google (captcha/rate limit)');
    }
    if (!response.ok) throw new ProviderError(this.name, `HTTP ${response.status}`);

    const html = await response.text();
    try {
      return parseOffers(extractPayload(html), query, url);
    } catch (error) {
      throw new ProviderError(this.name, `resposta não reconhecida: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}
