import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";

export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut, configured } = useAuth();
  const { t, lang, setLang } = useI18n();
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">{t("appName")}</NavLink>
        <nav className="nav">
          <div className="lang" role="group" aria-label={t("language")}>
            <button type="button" className={lang === "ru" ? "on" : ""} onClick={() => setLang("ru")}>RU</button>
            <button type="button" className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          </div>
          {user ? (
            <>
              <NavLink to="/profile">{t("profile")}</NavLink>
              <button type="button" className="btn ghost" onClick={() => void signOut()}>{t("logout")}</button>
            </>
          ) : configured ? (
            <NavLink to="/login">{t("login")}</NavLink>
          ) : null}
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
