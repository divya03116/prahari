/**
 * Camera access through the browser (WebRTC MediaDevices): a laptop webcam, a
 * USB camera, or a phone's front/back camera. Network (IP) cameras are read
 * from an HTTP(S) stream URL — browsers cannot open RTSP directly, so an RTSP
 * camera needs a gateway (e.g. MediaMTX or go2rtc) that serves MJPEG/MP4/HLS.
 */

import { translate } from '@/i18n';

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
/** In the interface language (src/i18n). */
export function describeCameraError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return translate('cam.blocked');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return translate('cam.notFound');
    case 'NotReadableError':
    case 'TrackStartError':
      return translate('cam.busy');
    case 'OverconstrainedError':
      return translate('cam.overconstrained');
    case 'SecurityError':
      return translate('cam.security');
    case 'AbortError':
      return translate('cam.aborted');
    default:
      return translate('cam.failed');
  }
}
