import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatPct, formatSpeed } from '../src/lib/format';

describe('format (es-ES)', () => {
  it('velocidad con coma decimal', () => {
    expect(formatSpeed(2_400_000)).toBe('2,4 MB/s');
    expect(formatSpeed(null)).toBe('');
    expect(formatSpeed(0)).toBe('');
  });

  it('duración h:mm:ss y m:ss', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(222)).toBe('3:42');
    expect(formatDuration(19)).toBe('0:19');
    expect(formatDuration(null)).toBe('');
  });

  it('bytes', () => {
    expect(formatBytes(5_200_000)).toBe('5,2 MB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1_500_000_000)).toBe('1,5 GB');
  });

  it('porcentaje: un decimal mientras avanza, entero al terminar', () => {
    expect(formatPct(38.14)).toBe('38,1 %');
    expect(formatPct(99.99)).toBe('99,9 %');
    expect(formatPct(100)).toBe('100 %');
    expect(formatPct(57.3, true)).toBe('57 %');
  });
});
