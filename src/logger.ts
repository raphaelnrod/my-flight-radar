import { pino, type Logger } from 'pino';

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    base: { app: 'flight-radar' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}

export type { Logger };
