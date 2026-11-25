import { describe, expect, it } from 'vitest';
import { clock, dateProblem, dayLabel, fromLocalInput, isLive, isOver, toLocalInput, whenText } from './events';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const now = at(2026, 11, 25, 10);

describe('dates', () => {
  it('says Today and Tomorrow, then the weekday and date', () => {
    expect(dayLabel(at(2026, 11, 25, 18), now)).toBe('Today');
    expect(dayLabel(at(2026, 11, 26, 9), now)).toBe('Tomorrow');
    expect(dayLabel(at(2026, 11, 29, 9), now)).toBe('Sun 29 Nov');
    expect(dayLabel(at(2027, 1, 4, 9), now)).toBe('Mon 4 Jan 2027');
  });
  it('writes times as "2:30 pm"', () => {
    expect(clock(at(2026, 11, 25, 14, 30))).toBe('2:30 pm');
    expect(clock(at(2026, 11, 25, 9, 5))).toBe('9:05 am');
  });
  it('gives one day once, and both days when the event runs past midnight', () => {
    const s = at(2026, 11, 25, 14).toISOString();
    expect(whenText(s, null, now)).toBe('Today · 2:00 pm');
    expect(whenText(s, at(2026, 11, 25, 16).toISOString(), now)).toBe('Today · 2:00 pm – 4:00 pm');
    expect(whenText(s, at(2026, 11, 26, 2).toISOString(), now)).toBe('Today · 2:00 pm – Tomorrow · 2:00 am');
  });
  it('round-trips datetime-local values in local time', () => {
    const iso = fromLocalInput('2026-11-29T14:00')!;
    expect(new Date(iso).getHours()).toBe(14);
    expect(toLocalInput(iso)).toBe('2026-11-29T14:00');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
  });
});

describe('live and over', () => {
  const t = now.getTime();
  it('is live between start and end, never when cancelled', () => {
    const e = { startsAt: at(2026, 11, 25, 9).toISOString(), endsAt: at(2026, 11, 25, 11).toISOString(), cancelled: false };
    expect(isLive(e, t)).toBe(true);
    expect(isLive({ ...e, cancelled: true }, t)).toBe(false);
    expect(isOver(e, t)).toBe(false);
  });
  it('treats an event without an end as two hours long for "now", and over after its start', () => {
    const e = { startsAt: at(2026, 11, 25, 9).toISOString(), endsAt: null, cancelled: false };
    expect(isLive(e, t)).toBe(true);
    expect(isOver(e, t)).toBe(true);
  });
});

describe('dateProblem', () => {
  const t = now.getTime();
  const iso = (d: Date) => d.toISOString();
  it('needs a start, not in the past for a new event, at most a year ahead', () => {
    expect(dateProblem(null, null, true, t)).toBe('Choose when it starts.');
    expect(dateProblem(iso(at(2026, 11, 25, 8)), null, true, t)).toBe('The start time is in the past.');
    expect(dateProblem(iso(at(2026, 11, 25, 8)), null, false, t)).toBeNull();
    expect(dateProblem(iso(at(2028, 1, 1, 8)), null, true, t)).toBe('Events can be at most a year ahead.');
    expect(dateProblem(iso(at(2026, 11, 29, 14)), null, true, t)).toBeNull();
  });
  it('wants the end after the start', () => {
    const s = iso(at(2026, 11, 29, 14));
    expect(dateProblem(s, s, true, t)).toBe('The end must be after the start.');
    expect(dateProblem(s, iso(at(2026, 11, 29, 16)), true, t)).toBeNull();
  });
});
