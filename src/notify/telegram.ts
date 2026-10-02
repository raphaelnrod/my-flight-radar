import type { Logger } from 'pino';
import { fetchWithRetry } from '../utils/http.js';
import { sleep } from '../utils/time.js';
import { formatAlert, type AlertMessage } from './format.js';

export interface Notifier {
  send(alert: AlertMessage): Promise<void>;
}

interface TelegramResponse {
  ok: boolean;
  description?: string;
  parameters?: { retry_after?: number };
}

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async send(alert: AlertMessage): Promise<void> {
    await this.sendText(formatAlert(alert));
  }

  async sendText(html: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: html,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        }),
      });
      const body = (await response.json().catch(() => ({ ok: false }))) as TelegramResponse;
      if (body.ok) return;
      if (response.status === 429 && body.parameters?.retry_after) {
        await sleep(body.parameters.retry_after * 1000);
        continue;
      }
      // Nunca incluir a URL (contém o token) na mensagem de erro.
      throw new Error(`Telegram recusou a mensagem (HTTP ${response.status}): ${body.description ?? 'sem detalhes'}`);
    }
    throw new Error('Telegram: limite de requisições excedido após várias tentativas');
  }
}

/** Usado com DRY_RUN=true: apenas registra o alerta no log. */
export class LogNotifier implements Notifier {
  constructor(private readonly log: Logger) {}

  send(alert: AlertMessage): Promise<void> {
    this.log.info({ message: formatAlert(alert) }, 'DRY_RUN: alerta que seria enviado');
    return Promise.resolve();
  }
}
