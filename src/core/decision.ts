export interface PriceStats {
  average: number | null;
  samples: number;
}

export interface LastAlert {
  price: number;
  sentAt: number;
}

export interface DecisionInput {
  price: number;
  maxPrice: number;
  stats: PriceStats;
  lastAlert: LastAlert | null;
  now: number;
  rules: { cooldownHours: number; dropPercent: number; dropMinSamples: number };
}

export type AlertReason = 'below-max-price' | 'price-drop';

export interface Decision {
  notify: boolean;
  reasons: AlertReason[];
  /** Queda percentual vs. média (positivo = mais barato), quando há média. */
  dropPercent: number | null;
  suppressedBy?: 'cooldown';
}

/**
 * Notifica se preço < maxPrice OU queda >= X% vs. média dos últimos N dias,
 * respeitando o cooldown (só reenvia dentro da janela se o preço caiu ainda mais).
 */
export function decide(input: DecisionInput): Decision {
  const { price, maxPrice, stats, lastAlert, now, rules } = input;

  const dropPercent =
    stats.average !== null && stats.average > 0 ? ((stats.average - price) / stats.average) * 100 : null;

  const reasons: AlertReason[] = [];
  if (price < maxPrice) reasons.push('below-max-price');
  if (dropPercent !== null && stats.samples >= rules.dropMinSamples && dropPercent >= rules.dropPercent) {
    reasons.push('price-drop');
  }

  if (reasons.length === 0) return { notify: false, reasons, dropPercent };

  if (lastAlert) {
    const withinCooldown = now - lastAlert.sentAt < rules.cooldownHours * 3_600_000;
    if (withinCooldown && price >= lastAlert.price) {
      return { notify: false, reasons, dropPercent, suppressedBy: 'cooldown' };
    }
  }
  return { notify: true, reasons, dropPercent };
}
