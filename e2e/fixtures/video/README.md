# Fixtures del e2e del video

Las usa `e2e/video-player.spec.ts`. Imitan los formatos adaptativos de YouTube que la API sirve por HLS: video H.264 sin audio y audio AAC aparte, cada uno en un MP4 fragmentado con un `sidx` global al principio.

| Archivo | Qué es |
| --- | --- |
| `134.mp4` | Video 640×360, avc1 Main, 30 fps, keyframe cada 2 s, ~160 kbit/s, 10 s |
| `136.mp4` | Video 1280×720, avc1 Main, 30 fps, keyframe cada 2 s, ~300 kbit/s, 10 s |
| `140.m4a` | Audio AAC-LC estéreo 44,1 kHz, 64 kbit/s, fragmentos de 5 s, 10 s |
| `master.m3u8` | Master playlist: las dos variantes y el grupo de audio |
| `134.m3u8`, `136.m3u8`, `140.m3u8` | Media playlists con `EXT-X-MAP` y `EXT-X-BYTERANGE` hacia `../media/<formatId>` |

Los nombres son los itag de YouTube (134 = 360p, 136 = 720p, 140 = m4a), como los `formatId` de la API. En los playlists el `sid` queda como `SID` y el spec lo cambia por el que pide el navegador.

## Regenerarlas

Con un ffmpeg que incluya libx264 y AAC (por ejemplo el estático de johnvansickle.com), desde esta carpeta:

```bash
video() {
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=$2:rate=30:duration=10" \
    -c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p \
    -b:v "$3" -maxrate "$3" -bufsize "$3" \
    -g 60 -keyint_min 60 -sc_threshold 0 \
    -movflags +frag_keyframe+empty_moov+default_base_moof+global_sidx \
    -f mp4 "$1"
}
video 134.mp4 640x360 160k
video 136.mp4 1280x720 300k

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=10" \
  -c:a aac -b:a 64k -ac 2 \
  -frag_duration 5000000 \
  -movflags +empty_moov+default_base_moof+global_sidx \
  -f mp4 140.m4a
```

Los playlists salen del mismo código que la API (`api-setube`): `parseMp4Index` de `src/lib/preview/mp4-index.ts` sobre cada archivo y `mediaPlaylist` y `masterPlaylist` de `src/lib/preview/hls.ts` con `sid = 'SID'`, `BANDWIDTH` calculado con el tamaño y la duración de cada archivo, `RESOLUTION` 640x360 y 1280x720, `FRAME-RATE` 30 y los códecs `avc1.4d401e`, `avc1.4d401f` y `mp4a.40.2`. Si cambian los archivos, hay que regenerar los playlists: los `BYTERANGE` dependen de los bytes exactos. Si cambia el formato de los playlists en la API, conviene regenerarlos también.

El spec lee los rangos del init y de los segmentos de los propios playlists, y necesita que cada variante de video tenga al menos dos segmentos.
