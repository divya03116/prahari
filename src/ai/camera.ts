/**
 * Camera access through the browser (WebRTC MediaDevices): a laptop webcam, a
 * USB camera, or a phone's front/back camera. Network (IP) cameras are read
 * from an HTTP(S) stream URL — browsers cannot open RTSP directly, so an RTSP
 * camera needs a gateway (e.g. MediaMTX or go2rtc) that serves MJPEG/MP4/HLS.
 */

export type CameraChoice =
  | { kind: 'device'; deviceId: string }
  | { kind: 'facing'; facingMode: 'environment' | 'user' }
  | { kind: 'stream'; url: string; format: 'video' | 'mjpeg' };

export interface CameraSupport {
  secure: boolean;
  mediaDevices: boolean;
}

export function cameraSupport(): CameraSupport {
  return {
    secure: window.isSecureContext,
    mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
  };
}

/** Video inputs. Labels are empty until the user has granted camera permission once. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput');
}

export async function openCamera(choice: Extract<CameraChoice, { kind: 'device' | 'facing' }>): Promise<MediaStream> {
  const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (choice.kind === 'device') video.deviceId = { exact: choice.deviceId };
  else video.facingMode = { ideal: choice.facingMode };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** A sentence a person can act on, for every way opening a camera can fail. */
export function describeCameraError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was blocked. Allow the camera for this site in the browser’s address-bar settings, then press Start again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Connect a camera, or choose another source.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is busy — another application may be using it. Close it and try again.';
    case 'OverconstrainedError':
      return 'This camera cannot provide the requested video. Choose another camera.';
    case 'SecurityError':
      return 'The browser blocked camera access. Open the site over HTTPS (or on localhost).';
    case 'AbortError':
      return 'The camera stopped unexpectedly. Try again.';
    default:
      return 'The camera could not be started.';
  }
}
