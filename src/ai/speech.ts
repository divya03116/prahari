/**
 * Speech-to-text using the browser's Web Speech API (Chrome, Edge, Safari).
 * Where it is missing (e.g. Firefox), `speechSupported()` is false and the UI
 * falls back to typing. Note: Chrome and Edge send the audio to their speech
 * service to transcribe it; the transcript comes back to the page only.
 */

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [i: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = (): boolean => ctor() !== null;

export const SPEECH_LANGUAGES = [
  { value: 'en-IN', label: 'English' },
  { value: 'hi-IN', label: 'हिन्दी' },
  { value: 'bn-IN', label: 'বাংলা' },
  { value: 'as-IN', label: 'অসমীয়া' },
] as const;

export function describeSpeechError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was blocked. Allow the microphone for this site, or type the report instead.';
    case 'no-speech':
      return 'No speech was heard. Tap the microphone and speak again.';
    case 'audio-capture':
      return 'No microphone was found. Connect one, or type the report instead.';
    case 'network':
      return 'Speech recognition needs an internet connection. Type the report instead.';
    case 'language-not-supported':
      return 'This language is not supported for speech here. Choose another, or type.';
    default:
      return 'Voice input stopped. You can type the report instead.';
  }
}

export interface Dictation {
  stop(): void;
}

/**
 * Starts listening. `onText` receives the text heard so far in this session
 * (final + interim); `onEnd` fires when listening stops for any reason.
 */
export function startDictation(
  lang: string,
  onText: (text: string, final: boolean) => void,
  onError: (message: string) => void,
  onEnd: () => void,
): Dictation {
  const Ctor = ctor();
  if (!Ctor) throw new Error('Speech recognition is not available in this browser.');
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += `${r[0].transcript.trim()} `;
      else interim += r[0].transcript;
    }
    onText(`${finalText}${interim}`.trim(), interim === '');
  };
  rec.onerror = (e) => {
    if (e.error !== 'aborted') onError(describeSpeechError(e.error));
  };
  rec.onend = onEnd;
  rec.start();
  return { stop: () => rec.stop() };
}
