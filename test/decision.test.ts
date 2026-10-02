import { describe, expect, it } from 'vitest';
import { decide, type DecisionInput } from '../src/core/decision.js';

const HOUR = 3_600_000;
const base: DecisionInput = {
  price: 4000,
  maxPrice: 3500,
  stats: { average: null, samples: 0 },
  lastAlert: null,
  now: 1_000_000_000_000,
  rules: { cooldownHours: 12, dropPercent: 15, dropMinSamples: 3 },
};

describe('decide', () => {
  it('não notifica acima do teto e sem queda', () => {
    expect(decide(base).notify).toBe(false);
  });

  it('notifica abaixo do teto', () => {
    const d = decide({ ...base, price: 3400 });
    expect(d).toMatchObject({ notify: true, reasons: ['below-max-price'] });
  });

  it('notifica queda >= 15% vs média mesmo acima do teto', () => {
    const d = decide({ ...base, price: 4250, stats: { average: 5000, samples: 5 } });
    expect(d.notify).toBe(true);
    expect(d.reasons).toEqual(['price-drop']);
    expect(d.dropPercent).toBeCloseTo(15);
  });

  it('ignora a regra de queda com poucas amostras', () => {
    expect(decide({ ...base, price: 3600, stats: { average: 5000, samples: 2 } }).notify).toBe(false);
  });

  it('não notifica com queda de 14%', () => {
    expect(decide({ ...base, price: 4300, stats: { average: 5000, samples: 5 } }).notify).toBe(false);
  });

  it('aplica cooldown para o mesmo preço ou maior', () => {
    const lastAlert = { price: 3400, sentAt: base.now - 2 * HOUR };
    const d = decide({ ...base, price: 3400, lastAlert });
    expect(d).toMatchObject({ notify: false, suppressedBy: 'cooldown' });
    expect(decide({ ...base, price: 3450, lastAlert }).notify).toBe(false);
  });

  it('reenvia dentro do cooldown se o preço caiu ainda mais', () => {
    const lastAlert = { price: 3400, sentAt: base.now - 2 * HOUR };
    expect(decide({ ...base, price: 3300, lastAlert }).notify).toBe(true);
  });

  it('reenvia após o cooldown', () => {
    const lastAlert = { price: 3400, sentAt: base.now - 13 * HOUR };
    expect(decide({ ...base, price: 3400, lastAlert }).notify).toBe(true);
  });
});
