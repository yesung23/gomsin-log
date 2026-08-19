import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fertilityOccursOnDate,
  ovulationOccursOnDate,
  predictionOccursOnDate,
  type CyclePrediction,
} from '@/lib/cyclePrediction';
import { cycleDayMarkLabels } from '@/components/cycle/cycleFormatting';
import { CycleDayMarker, CycleLegend } from '@/components/cycle/CycleDayMarker';

/**
 * Fertility and ovulation display.
 *
 * These two states were computed by the engine and drawn nowhere. The tests below
 * cover the reading of them and the drawing of them, and -- most importantly --
 * that reading them changed no arithmetic.
 */

const prediction: CyclePrediction = {
  status: 'predicted',
  expectedStartDate: '2026-09-01',
  windowStart: '2026-08-30',
  windowEnd: '2026-09-03',
  confidence: 'medium',
  periodsUsed: 4,
  intervalsUsed: 3,
  estimatedOvulationDate: '2026-08-18',
  fertilityWindowStart: '2026-08-13',
  fertilityWindowEnd: '2026-08-19',
};

describe('reading the estimate, without recomputing it', () => {
  it('reports the fertile window inclusively at both ends', () => {
    expect(fertilityOccursOnDate(prediction, '2026-08-13')).toBe(true);
    expect(fertilityOccursOnDate(prediction, '2026-08-16')).toBe(true);
    expect(fertilityOccursOnDate(prediction, '2026-08-19')).toBe(true);
    expect(fertilityOccursOnDate(prediction, '2026-08-12')).toBe(false);
    expect(fertilityOccursOnDate(prediction, '2026-08-20')).toBe(false);
  });

  it('reports ovulation on exactly one day', () => {
    expect(ovulationOccursOnDate(prediction, '2026-08-18')).toBe(true);
    expect(ovulationOccursOnDate(prediction, '2026-08-17')).toBe(false);
    expect(ovulationOccursOnDate(prediction, '2026-08-19')).toBe(false);
  });

  it('says no rather than guessing when the engine produced no window', () => {
    // `status: 'insufficient_data'` is a real state -- a first-time user has it.
    const bare: CyclePrediction = {
      status: 'insufficient_data',
      confidence: 'low',
      periodsUsed: 0,
      intervalsUsed: 0,
    };
    expect(fertilityOccursOnDate(bare, '2026-08-18')).toBe(false);
    expect(ovulationOccursOnDate(bare, '2026-08-18')).toBe(false);
    expect(predictionOccursOnDate(bare, '2026-08-18')).toBe(false);
  });

  it('the ovulation day sits inside the fertile window the engine derived', () => {
    // Not a new rule -- a check that reading did not invert the engine's own
    // relationship between the two, which is ovulation-5 .. ovulation+1.
    expect(fertilityOccursOnDate(prediction, prediction.estimatedOvulationDate!)).toBe(true);
  });

  it('adds no arithmetic: the readers only compare against stored fields', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/cyclePrediction.ts'), 'utf8');
    const readers = source.slice(source.indexOf('export function fertilityOccursOnDate'));
    // `addDays` is how the engine DERIVES a window. A reader that called it would
    // be a second, silently divergent estimate.
    expect(readers).not.toContain('addDays');
  });
});

describe('a record and a guess never look the same', () => {
  function markup(node: ReturnType<typeof render>): string {
    return node.container.innerHTML;
  }

  it('draws a recorded period solid', () => {
    const html = markup(render(<CycleDayMarker mark="period" />));
    expect(html).toContain('fill="var(--coral-strong)"');
    expect(html).toContain('stroke-width="0"');
  });

  it('draws every estimate outlined, never filled', () => {
    for (const mark of ['period_predicted', 'fertile', 'ovulation'] as const) {
      const html = markup(render(<CycleDayMarker mark={mark} />));
      expect(html, mark).toContain('fill="none"');
      expect(html, mark).not.toContain('stroke-width="0"');
    }
  });

  it('gives the four states four different shapes, not four tints of one', () => {
    const shapes = (['period', 'period_predicted', 'fertile', 'ovulation'] as const).map(
      (mark) => markup(render(<CycleDayMarker mark={mark} />)),
    );
    // The seed is the only ellipse; the heart is its own path; period and its
    // prediction share the droplet and differ by fill.
    expect(shapes[2]).toContain('<ellipse');
    expect(shapes[0]).not.toContain('<ellipse');
    expect(shapes[3]).not.toContain('<ellipse');
    expect(shapes[0]).not.toBe(shapes[1]);
  });
});

describe('the legend explains the symbols, and does not overclaim', () => {
  it('names all four marks plus the condition dot', () => {
    render(<CycleLegend />);
    for (const label of Object.values(cycleDayMarkLabels)) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('컨디션 기록')).toBeTruthy();
  });

  it('says the estimate is an estimate, next to the estimate', () => {
    render(<CycleLegend />);
    expect(screen.getByText(/지난 기록으로 계산한 추정/)).toBeTruthy();
    expect(screen.getByText(/피임 여부를 알려주지는 않아요/)).toBeTruthy();
  });

  it('never uses safe-day language anywhere in the cycle surface', () => {
    /*
     * The one that would matter most if it were ever wrong. `안전한 날` and its
     * cousins imply contraceptive reliability that arithmetic over past start
     * dates cannot support, and someone could act on it.
     */
    const files = [
      'src/components/cycle/CycleDayMarker.tsx',
      'src/components/cycle/cycleFormatting.ts',
      'src/components/cycle/CycleCalendar.tsx',
      'src/lib/cyclePrediction.ts',
      'src/lib/cyclePartnerMessage.ts',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      // Allowed inside a comment that forbids it; not allowed as rendered copy.
      const rendered = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const banned of ['안전한 날', '안전기', '임신이 안 되는', '피임이 됩니다']) {
        expect(rendered, `${file} :: ${banned}`).not.toContain(banned);
      }
    }
  });
});
