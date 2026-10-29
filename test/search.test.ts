import { describe, expect, it } from 'vitest';
import { formatViews } from '../src/lib/format';
import { searchQuery } from '../src/lib/search';

describe('searchQuery', () => {
  it('una línea de texto es una búsqueda, con los espacios normalizados', () => {
    expect(searchQuery('bad bunny monaco')).toBe('bad bunny monaco');
    expect(searchQuery('  karol   g  \n')).toBe('karol g');
    expect(searchQuery('ñandú 2024 (en vivo)')).toBe('ñandú 2024 (en vivo)');
  });

  it('los links, lo que parece una URL y varias líneas no se buscan', () => {
    expect(searchQuery('https://www.youtube.com/watch?v=jNQXAC9IVRw')).toBeNull();
    expect(searchQuery('youtu.be/jNQXAC9IVRw')).toBeNull();
    expect(searchQuery('https://vimeo.com/123')).toBeNull();
    expect(searchQuery('www.example.com')).toBeNull();
    expect(searchQuery('example.com/video')).toBeNull();
    expect(searchQuery('uno\ndos')).toBeNull();
    expect(searchQuery('   ')).toBeNull();
  });
});

describe('formatViews', () => {
  it('abrevia como YouTube en español', () => {
    expect(formatViews(950)).toBe('950');
    expect(formatViews(12_345)).toBe('12 mil');
    expect(formatViews(1_500)).toBe('1,5 mil');
    expect(formatViews(6_562_112)).toBe('6,5 M');
    expect(formatViews(249_332_660)).toBe('249 M');
    expect(formatViews(1_531_204_677)).toBe('1,5 mil M');
    expect(formatViews(null)).toBe('');
    expect(formatViews(-1)).toBe('');
  });
});
