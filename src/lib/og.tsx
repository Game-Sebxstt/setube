import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };

export async function renderOg(): Promise<ImageResponse> {
  const logo = await readFile(path.join(process.cwd(), 'public', 'logo.png'));
  const logoSrc = `data:image/png;base64,${logo.toString('base64')}`;
  const segments = Array.from({ length: 24 }, (_, i) => i);
  const lit = 15;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: '#16181B',
          color: '#E9E7E2',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} width={130} height={118} alt="" />
          <div style={{ fontSize: 112, fontWeight: 800, letterSpacing: '-2px' }}>Setube</div>
        </div>
        <div style={{ marginTop: 28, fontSize: 40, color: '#9BA1A9' }}>Convierte links de YouTube a MP3, M4A, WAV y MP4</div>
        <div style={{ marginTop: 64, display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {segments.map((i) => (
              <div
                key={i}
                style={{ width: 34, height: 30, borderRadius: 3, background: i < lit ? '#D7262C' : '#2A2E33' }}
              />
            ))}
          </div>
          <div style={{ fontSize: 40, color: '#E9E7E2' }}>62,5 %</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
