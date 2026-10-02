import type { AppConfig } from './config/index.js';
import { loadConfig } from './config/index.js';
import { Monitor } from './core/monitor.js';
import { Repository } from './db/repository.js';
import { createLogger } from './logger.js';
import { LogNotifier, TelegramNotifier, type Notifier } from './notify/telegram.js';
import { createProvider } from './providers/index.js';
import { startScheduler } from './scheduler.js';

function createNotifier(config: AppConfig, log: ReturnType<typeof createLogger>): Notifier {
  if (config.dryRun || !config.telegram.botToken || !config.telegram.chatId) return new LogNotifier(log);
  return new TelegramNotifier(config.telegram.botToken, config.telegram.chatId);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const config = loadConfig();
  const log = createLogger(config.log.level, config.log.pretty);
  const repo = new Repository(config.dbPath);
  const monitor = new Monitor(config, createProvider(config, log), repo, createNotifier(config, log), log);

  log.info(
    {
      routes: config.routes.filter((r) => r.active).map((r) => r.id),
      providers: config.providers,
      dryRun: config.dryRun,
    },
    'flight-radar iniciado',
  );

  if (args.has('--once')) {
    const summary = await monitor.runCycle();
    repo.close();
    process.exitCode = summary.searches > 0 && summary.failures === summary.searches ? 1 : 0;
    return;
  }

  const task = startScheduler(config.schedule.cron, config.schedule.timezone, () => monitor.runCycle(), log);
  if (config.schedule.runOnStart) {
    monitor.runCycle().catch((error: unknown) => { log.error({ err: (error as Error).message }, 'ciclo inicial falhou'); });
  }

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'encerrando');
    void task.stop();
    repo.close();
    process.exit(0);
  };
  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
}

main().catch((error: unknown) => {
  // Logger pode não existir se a configuração falhou.
  console.error((error as Error).message);
  process.exit(1);
});
