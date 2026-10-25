import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, ready, configured, signIn, signUp, resetPassword } = useAuth();
  const { t, err } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const next = (location.state as { next?: string } | null)?.next || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (ready && user) return <Navigate to={next} replace />;
  if (!configured) return <p className="panel">{t("notConfigured")}</p>;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "login") {
        await signIn(email, password);
        navigate(next);
      } else {
        await signUp(email, password, name);
        navigate(next);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 440 }}>
      <h1>{mode === "login" ? t("login") : t("register")}</h1>
      <form className="stack" onSubmit={(e) => void onSubmit(e)}>
        {mode === "register" ? (
          <label>
            {t("displayName")}
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={24} />
            <small>{t("nameHint")}</small>
          </label>
        ) : null}
        <label>
          {t("email")}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          {t("password")}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          <small>{t("passwordHint")}</small>
        </label>
        {notice ? <p className="ok">{notice}</p> : null}
        {error ? <p className="error" role="alert">{err(error)}</p> : null}
        <button className="btn primary" type="submit" disabled={busy}>{t("continue")}</button>
      </form>
      {mode === "login" ? (
        <>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void resetPassword(email).then(() => setNotice(t("resetSent"))).catch((caught) => setError(caught));
            }}
          >
            {t("forgot")}
          </button>
          <Link to="/register" state={{ next }}>{t("register")}</Link>
        </>
      ) : (
        <Link to="/login" state={{ next }}>{t("login")}</Link>
      )}
    </section>
  );
}
