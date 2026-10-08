/**
 * Interface language: English, Hindi, Assamese and Bengali.
 *
 * Only the interface is translated — menus, labels, buttons, messages. What
 * people write (report narratives, statements, notes) is always shown exactly
 * as written, in whatever language they wrote it.
 *
 * English is the source of truth and the fallback: a key missing from another
 * language shows in English rather than as a blank. The other dictionaries are
 * loaded only when chosen, so English users never download them. The choice is
 * remembered on the device.
 */

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { en, type MessageKey } from './en';

export type { MessageKey } from './en';
export type Lang = 'en' | 'hi' | 'as' | 'bn';
export type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;
type Dictionary = Partial<Record<MessageKey, string>>;

/** Each language under its own name, as its speakers write it. */
export const LANGUAGES: { code: Lang; name: string; english: string }[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
  { code: 'as', name: 'অসমীয়া', english: 'Assamese' },
  { code: 'bn', name: 'বাংলা', english: 'Bengali' },
];

const STORAGE_KEY = 'prahari.lang';
const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<Dictionary>> = {
  hi: () => import('./hi').then((m) => m.hi),
  as: () => import('./as').then((m) => m.as),
  bn: () => import('./bn').then((m) => m.bn),
};

const isLang = (v: unknown): v is Lang => LANGUAGES.some((l) => l.code === v);

function storedLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isLang(saved) ? saved : 'en';
  } catch {
    return 'en';
  }
}

// The active dictionary also lives outside React, so plain modules (error
// messages, services) can translate without a hook.
let active: Dictionary = en;
let activeLang: Lang = storedLang();

/** The interface language right now, for code outside React (date and number formats). */
export const currentLang = (): Lang => activeLang;

function format(template: string, vars?: Vars): string {
  return vars ? template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : template;
}

/** Translate outside a component. Inside one, use `useI18n().t` so it re-renders on a language change. */
export const translate: Translate = (key, vars) => format(active[key] ?? en[key], vars);

/**
 * A translated sentence with elements inside it: `rich(t('auth.resetSent'), { email: <b>{address}</b> })`.
 * Each language places `{email}` where its grammar needs it.
 */
export function rich(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in nodes ? <Fragment key={i}>{nodes[name]}</Fragment> : part;
  });
}

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const Ctx = createContext<I18nState>({ lang: 'en', setLang: () => undefined, t: (key, vars) => format(en[key], vars) });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(storedLang);
  const [dict, setDict] = useState<Dictionary>(en);

  useEffect(() => {
    let cancelled = false;
    activeLang = lang;
    document.documentElement.lang = lang;
    if (lang === 'en') {
      active = en;
      setDict(en);
      return;
    }
    LOADERS[lang]()
      .then((loaded) => {
        if (cancelled) return;
        active = loaded;
        setDict(loaded);
      })
      .catch(() => undefined); // offline before the first load: stay in English
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  }, []);

  const value = useMemo<I18nState>(
    () => ({ lang, setLang, t: (key, vars) => format(dict[key] ?? en[key], vars) }),
    [lang, setLang, dict],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nState {
  return useContext(Ctx);
}
