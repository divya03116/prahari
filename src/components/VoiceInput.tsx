import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { SPEECH_LANGUAGES, speechSupported, startDictation, type Dictation } from '@/ai/speech';

/**
 * "Report by voice": dictates into a text value the person can then review
 * and edit. Speech is appended to whatever was already typed. Where the
 * browser has no speech recognition, it says so and the text box still works.
 */
export function VoiceInput({
  value,
  onChange,
  onUsed,
  size = 'md',
  className,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Called once dictation has produced text, so the report can be marked as a voice report. */
  onUsed?: () => void;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const { t } = useI18n();
  const [supported] = useState(speechSupported);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<string>(() => {
    try {
      return localStorage.getItem('prahari.voiceLang') ?? 'en-IN';
    } catch {
      return 'en-IN';
    }
  });
  const dictation = useRef<Dictation | null>(null);
  const base = useRef('');

  useEffect(() => () => dictation.current?.stop(), []);

  if (!supported) {
    return (
      <p className={cn('rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted', className)}>
        {t('voice.unsupported')}
      </p>
    );
  }

  const start = () => {
    setError(null);
    base.current = value.trim();
    try {
      dictation.current = startDictation(
        lang,
        (text) => {
          onChange(base.current ? `${base.current} ${text}` : text);
          if (text) onUsed?.();
        },
        (message) => setError(message),
        () => {
          setListening(false);
          dictation.current = null;
        },
      );
      setListening(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const stop = () => dictation.current?.stop();

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={listening ? stop : start}
          aria-pressed={listening}
          className={cn(
            'inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-semibold transition-colors',
            size === 'lg' ? 'h-12 px-6 text-base' : 'h-9 px-4 text-sm',
            listening ? 'bg-critical text-white hover:bg-critical/90' : 'bg-signal text-fg-inverse hover:bg-signal-hover',
          )}
        >
          {listening ? <Square className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
          {listening ? t('voice.stop') : t('voice.start')}
        </button>
        <select
          aria-label={t('voice.language')}
          value={lang}
          disabled={listening}
          onChange={(e) => {
            setLang(e.target.value);
            try {
              localStorage.setItem('prahari.voiceLang', e.target.value);
            } catch {
              /* optional */
            }
          }}
          className="h-9 cursor-pointer rounded-full border border-border-strong bg-surface-2 px-3 text-xs text-fg-muted"
        >
          {SPEECH_LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        {listening && (
          <span role="status" className="inline-flex items-center gap-1.5 text-xs text-critical">
            <span className="size-2 animate-pulse rounded-full bg-critical" aria-hidden /> {t('voice.listening')}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
