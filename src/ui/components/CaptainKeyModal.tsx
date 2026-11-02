import { useEffect, useId, useRef } from "react";
import { GAME } from "../../config/brand";
import type { CaptainKeyView } from "../../domain/board";
import type { CardRole } from "../../domain/types";
import { useI18n } from "../../i18n/I18nProvider";

type Props = {
  view: CaptainKeyView | null;
  loading: boolean;
  error: unknown;
  onClose: () => void;
};

export function CaptainKeyModal({ view, loading, error, onClose }: Props) {
  const { t, err } = useI18n();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal key-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="sheet key-sheet"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="row key-sheet-head">
          <h2 id={titleId}>{t("keyTitle")}</h2>
          <button ref={closeRef} type="button" className="btn ghost" aria-label={t("close")} onClick={onClose}>
            {t("close")}
          </button>
        </div>

        {loading ? <p className="muted">{t("keyLoading")}</p> : null}
        {error ? <p className="error" role="alert">{err(error)}</p> : null}

        {view ? (
          <>
            <p className="key-start">
              {t("startingTeamLabel")}: <strong className={`swatch-label ${view.startingTeam}`}>{t(view.startingTeam)}</strong>
            </p>
            <div
              className="key-grid"
              role="grid"
              aria-label={t("keyTitle")}
              style={{ gridTemplateColumns: `repeat(${GAME.cols}, minmax(0, 1fr))` }}
            >
              {view.cells.map((role, index) => (
                <div
                  key={index}
                  role="gridcell"
                  className={`key-cell role-${role}`}
                  aria-label={`${t("keyCell")} ${index + 1}: ${t(role)}`}
                >
                  <span>{labelFor(role, t)}</span>
                </div>
              ))}
            </div>
            <ul className="key-legend">
              {(["red", "blue", "neutral", "assassin"] as const).map((role) => (
                <li key={role}>
                  <span className={`legend-swatch role-${role}`} aria-hidden />
                  {t(role)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

function labelFor(role: CardRole, t: (key: "red" | "blue" | "neutral" | "assassin") => string): string {
  return t(role);
}
