/** Pantalla completa y Picture-in-Picture del panel de video, con los prefijos de Safari. */

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };
/** iPhone: solo el <video> puede ir a pantalla completa, con el reproductor del sistema. */
type IosVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
};

export function fullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

function elementFullscreenEnabled(): boolean {
  const d = document as FsDocument;
  return d.fullscreenEnabled === true || d.webkitFullscreenEnabled === true;
}

export function canFullscreen(video: HTMLVideoElement | null): boolean {
  if (typeof document === 'undefined') return false;
  if (elementFullscreenEnabled()) return true;
  return typeof (video as IosVideo | null)?.webkitEnterFullscreen === 'function';
}

/**
 * Alterna la pantalla completa del contenedor (con los controles propios encima). Si el navegador solo deja
 * poner el <video> (iPhone), usa el reproductor del sistema.
 */
export function toggleFullscreen(container: HTMLElement | null, video: HTMLVideoElement | null): void {
  if (typeof document === 'undefined') return;
  const d = document as FsDocument;
  if (fullscreenElement()) {
    const exit = d.exitFullscreen?.bind(d) ?? d.webkitExitFullscreen?.bind(d);
    void Promise.resolve(exit?.()).catch(() => undefined);
    return;
  }
  const el = container as FsElement | null;
  if (el && elementFullscreenEnabled()) {
    const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
    void Promise.resolve(req?.()).catch(() => undefined);
    return;
  }
  const v = video as IosVideo | null;
  if (v && typeof v.webkitEnterFullscreen === 'function') {
    try {
      v.webkitEnterFullscreen();
    } catch {
      // el video aún no tiene datos
    }
  }
}

export function exitFullscreenIfInside(container: HTMLElement | null): void {
  const fs = fullscreenElement();
  if (!fs || !container || !container.contains(fs)) return;
  const d = document as FsDocument;
  const exit = d.exitFullscreen?.bind(d) ?? d.webkitExitFullscreen?.bind(d);
  void Promise.resolve(exit?.()).catch(() => undefined);
}

export function canPictureInPicture(video: HTMLVideoElement | null): boolean {
  if (typeof document === 'undefined' || !video) return false;
  return document.pictureInPictureEnabled === true && typeof video.requestPictureInPicture === 'function' && !video.disablePictureInPicture;
}

export function togglePictureInPicture(video: HTMLVideoElement | null): void {
  if (!video || typeof document === 'undefined') return;
  if (document.pictureInPictureElement === video) {
    void document.exitPictureInPicture().catch(() => undefined);
    return;
  }
  if (!canPictureInPicture(video)) return;
  void video.requestPictureInPicture().catch(() => undefined);
}

export function exitPictureInPicture(video: HTMLVideoElement | null): void {
  if (typeof document === 'undefined' || !video || document.pictureInPictureElement !== video) return;
  void document.exitPictureInPicture().catch(() => undefined);
}
