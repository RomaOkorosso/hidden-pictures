import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { dictionaries, t, type Lang, type MessageKey } from "./messages";
import { matchError } from "../lib/errors";

type Ctx = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  err: (error: unknown) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem("hp-lang") === "en" ? "en" : "ru"));
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = dictionaries[lang].appName;
    localStorage.setItem("hp-lang", lang);
  }, [lang]);
  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang: setLangState,
      t: (key, vars) => t(lang, key, vars),
      err: (error) => {
        const code = matchError(error);
        const key = `err_${code}` as MessageKey;
        return key in dictionaries[lang] ? t(lang, key) : t(lang, "err_UNKNOWN");
      },
    }),
    [lang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("i18n");
  return ctx;
}
