import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";

export function ProfilePage() {
  const { user, ready, displayName, setDisplayName } = useAuth();
  const { t, err } = useI18n();
  const [name, setName] = useState(displayName);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!ready) return <p>{t("loading")}</p>;
  if (!user) return <Navigate to="/login" replace state={{ next: "/profile" }} />;

  return (
    <section className="panel" style={{ maxWidth: 480 }}>
      <h1>{t("profile")}</h1>
      <p className="muted">{t("nameHint")}</p>
      <form
        className="stack"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setError(null);
          setSaved(false);
          void setDisplayName(name || displayName)
            .then(() => setSaved(true))
            .catch((caught) => setError(caught));
        }}
      >
        <label>
          {t("displayName")}
          <input value={name || displayName} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={24} required />
        </label>
        {saved ? <p className="ok">{t("saved")}</p> : null}
        {error ? <p className="error">{err(error)}</p> : null}
        <button className="btn primary" type="submit">{t("save")}</button>
      </form>
    </section>
  );
}
