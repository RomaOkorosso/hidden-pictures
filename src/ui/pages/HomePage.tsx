import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createRoom } from "../../adapters/roomApi";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";

export function HomePage() {
  const { user, ready, displayName, configured } = useAuth();
  const { t, err } = useI18n();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom(user.uid, displayName || user.displayName || "Player");
      navigate(`/room/${room.code}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p className="muted">{t("loading")}</p>;

  return (
    <div className="stack">
      <section className="hero panel">
        <h1>{t("appName")}</h1>
        <p className="lede">{t("tagline")}</p>
      </section>
      {!configured ? (
        <section className="panel">
          <p>{t("notConfigured")}</p>
          <p className="muted">{t("demoNote")}</p>
        </section>
      ) : !user ? (
        <section className="panel">
          <div className="row">
            <Link className="btn primary" to="/login">{t("login")}</Link>
            <Link className="btn ghost" to="/register">{t("register")}</Link>
          </div>
        </section>
      ) : (
        <>
          <form className="panel" onSubmit={(e) => void onCreate(e)}>
            <h2>{t("createRoom")}</h2>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? t("loading") : t("createRoom")}</button>
          </form>
          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) navigate(`/room/${code.trim().toUpperCase()}`);
            }}
          >
            <h2>{t("joinRoom")}</h2>
            <label>
              {t("roomCode")}
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} autoComplete="off" />
            </label>
            <button className="btn ghost" type="submit">{t("joinRoom")}</button>
          </form>
        </>
      )}
      {error ? <p className="error" role="alert">{err(error)}</p> : null}
      <details className="panel">
        <summary>{t("rules")}</summary>
        <p>{t("ruleBody")}</p>
      </details>
    </div>
  );
}
