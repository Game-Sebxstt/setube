import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, CLIENT_ERROR_CODES } from '../src/lib/contract';
import { MESSAGES, messageFor } from '../src/lib/messages';

describe('messages', () => {
  it('el catálogo tiene 36 códigos', () => {
    expect(API_ERROR_CODES).toHaveLength(36);
    expect(new Set(API_ERROR_CODES).size).toBe(36);
  });

  it.each([...API_ERROR_CODES, ...CLIENT_ERROR_CODES])('%s tiene copy propio no vacío', (code) => {
    expect(MESSAGES[code]).toBeDefined();
    const text = messageFor(code, { maxItemsPerJob: 50, maxDurationAudioSec: 3600, maxDurationVideoSec: 1200 });
    expect(typeof text).toBe('string');
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/undefined|\{|\}/);
  });

  it('incluye NETWORK_ERROR, DOWNLOAD_BLOCKED y UNKNOWN', () => {
    expect(messageFor('NETWORK_ERROR')).toBe('No se pudo conectar con el servidor.');
    expect(messageFor('DOWNLOAD_BLOCKED')).toBe(
      'Tu navegador pudo bloquear la descarga. Permite las descargas múltiples para este sitio.',
    );
    expect(messageFor('UNKNOWN')).toBe('Ocurrió un error inesperado. Intenta de nuevo.');
  });

  it('RATE_LIMITED usa retryAfterSec y tiene copy de respaldo sin details', () => {
    expect(messageFor('RATE_LIMITED', { details: { retryAfterSec: 42 } })).toBe('Demasiadas solicitudes. Espera 42 s.');
    expect(messageFor('RATE_LIMITED')).toBe('Demasiadas solicitudes. Espera un momento.');
    expect(messageFor('RATE_LIMITED', { details: {} })).toBe('Demasiadas solicitudes. Espera un momento.');
  });

  it('interpola límites de /api/config', () => {
    expect(messageFor('LIMIT_ITEMS', { maxItemsPerJob: 20 })).toBe('Puedes convertir hasta 20 videos a la vez.');
    expect(messageFor('LIMIT_DURATION', { maxDurationAudioSec: 3600, maxDurationVideoSec: 1200 })).toBe(
      'Supera la duración máxima: 60 min en audio, 20 min en video.',
    );
  });
});
