import type { Logger } from 'pino';
import type { AppConfig, ProviderName } from '../config/index.js';
import type { FlightProvider } from '../types.js';
import { AmadeusProvider } from './amadeus.js';
import { FallbackProvider } from './chain.js';
import { GoogleFlightsProvider } from './google/provider.js';
import { SerpApiProvider } from './serpapi.js';

function create(name: ProviderName, config: AppConfig): FlightProvider {
  switch (name) {
    case 'google-flights':
      return new GoogleFlightsProvider();
    case 'serpapi':
      return new SerpApiProvider(config.serpApi.apiKey ?? '');
    case 'amadeus':
      return new AmadeusProvider(
        config.amadeus.clientId ?? '',
        config.amadeus.clientSecret ?? '',
        config.amadeus.environment,
      );
  }
}

export function createProvider(config: AppConfig, log: Logger): FlightProvider {
  return new FallbackProvider(
    config.providers.map((name) => create(name, config)),
    log,
  );
}
