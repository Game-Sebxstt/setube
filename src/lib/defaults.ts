import type { PublicConfig } from './contract';

export const COMPILED_CONFIG: PublicConfig = {
  maxItemsPerJob: 50,
  maxPlaylistItems: 50,
  maxDurationAudioSec: 3600,
  maxDurationVideoSec: 1200,
  formats: { mp3: [128, 192, 320], m4a: [], wav: [], mp4: [360, 480, 720, 1080, 'best'] },
  defaults: { mp3: 192, mp4: 720 },
  turnstile: false,
};
