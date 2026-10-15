import { describe, expect, it } from 'vitest';
import type { CreatedJobItem } from '../src/lib/contract';
import { downloadTarget } from '../src/lib/download';

const API = 'https://api.example.com/';
const JOB = '3f1c2a9e-6b1d-4d55-9a3c-2b7e0c9d1e4f';
const item = (itemId: string, status: 'pending' | 'error'): CreatedJobItem => ({
  itemId,
  videoId: `vid${itemId.padStart(8, '0')}`.slice(0, 11),
  title: null,
  duration: null,
  status,
  ...(status === 'error' ? { error: { code: 'LIMIT_DURATION', message: 'x' }, errorKind: 'validation' as const } : {}),
});

describe('downloadTarget', () => {
  it('1 item válido que no es i0 → /items/i1/file', () => {
    const t = downloadTarget({ jobId: JOB, items: [item('i0', 'error'), item('i1', 'pending')] }, API);
    expect(t).toEqual({ url: `https://api.example.com/api/jobs/${JOB}/items/i1/file`, mode: 'file', itemId: 'i1' });
  });

  it('un solo item válido i0 → /items/i0/file', () => {
    expect(downloadTarget({ jobId: JOB, items: [item('i0', 'pending')] }, API)?.url).toBe(
      `https://api.example.com/api/jobs/${JOB}/items/i0/file`,
    );
  });

  it('2 válidos → /archive', () => {
    const t = downloadTarget({ jobId: JOB, items: [item('i0', 'pending'), item('i1', 'error'), item('i2', 'pending')] }, API);
    expect(t).toEqual({ url: `https://api.example.com/api/jobs/${JOB}/archive`, mode: 'archive', itemId: null });
  });

  it('ningún válido → null', () => {
    expect(downloadTarget({ jobId: JOB, items: [item('i0', 'error')] }, API)).toBeNull();
  });
});
