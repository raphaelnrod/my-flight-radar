import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from 'pino';

export function startScheduler(
  expression: string,
  timezone: string,
  job: () => Promise<unknown>,
  log: Logger,
): ScheduledTask {
  if (!cron.validate(expression)) throw new Error(`CRON_SCHEDULE inválido: "${expression}"`);
  log.info({ expression, timezone }, 'agendamento iniciado');
  return cron.schedule(
    expression,
    () => {
      job().catch((error: unknown) => { log.error({ err: (error as Error).message }, 'ciclo falhou'); });
    },
    { timezone },
  );
}
