import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  bindPresence,
  captainDeal,
  claimCaptain,
  endTurnAction,
  fetchCaptainKey,
  giveClue,
  guessCard,
  hostRandomize,
  hostSetMember,
  joinRoom,
  leaveRoom,
  processPendingReveal,
  rematch,
  requestStart,
  resolveCode,
  setCaptainCardMark,
  transferHostIfStale,
  watchActions,
  watchCaptainNotes,
  watchDealRequest,
  watchRoom,
  watchSecret,
} from "../../adapters/roomApi";
import { toCaptainKeyView, type CaptainKeyView } from "../../domain/board";
import { canStart, mayOpenCards } from "../../domain/lobby";
import { CAPTAIN_MARK_KINDS, captainMarkRole, type CaptainMarkKind } from "../../domain/marks";
import type { CardRole, GameEvent, Member, PublicMatch, RoomMeta, SeatRole, SecretKey, Team } from "../../domain/types";
import { assetUrl, loadPack, roomInviteUrl, type PackManifest } from "../../lib/packs";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { GAME } from "../../config/brand";
import { CaptainKeyModal } from "../components/CaptainKeyModal";

export function RoomPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { user, ready, displayName, configured } = useAuth();
  const { t, err } = useI18n();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [match, setMatch] = useState<PublicMatch | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [presence, setPresence] = useState<Record<string, { online: boolean; at: number }>>({});
  const [secret, setSecret] = useState<SecretKey | null>(null);
  const [pack, setPack] = useState<PackManifest | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [clueWord, setClueWord] = useState("");
  const [clueCount, setClueCount] = useState(2);
  const [pendingDeal, setPendingDeal] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyView, setKeyView] = useState<CaptainKeyView | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState<unknown>(null);
  const [captainMarks, setCaptainMarks] = useState<Record<string, CaptainMarkKind>>({});

  const clearPrivateKey = useCallback(() => {
    setSecret(null);
    setKeyView(null);
    setKeyError(null);
    setKeyOpen(false);
    setCaptainMarks({});
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!configured) return;
    if (!user) {
      clearPrivateKey();
      navigate("/login", { replace: true, state: { next: `/room/${code}` } });
      return;
    }
    let cancel = false;
    void (async () => {
      try {
        const id = await resolveCode(code);
        if (cancel) return;
        await joinRoom(id, user.uid, displayName || user.displayName || "Player");
        if (cancel) return;
        setRoomId(id);
      } catch (caught) {
        if (!cancel) setError(caught);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [clearPrivateKey, code, configured, displayName, navigate, ready, user]);

  useEffect(() => {
    if (!roomId || !user) return;
    const unsub = watchRoom(roomId, {
      onMeta: setMeta,
      onMembers: setMembers,
      onPublic: setMatch,
      onEvents: setEvents,
      onPresence: setPresence,
    });
    let stopPresence: (() => void) | undefined;
    void bindPresence(roomId, user.uid).then((stop) => {
      stopPresence = stop;
    });
    const hostTimer = window.setInterval(() => {
      void transferHostIfStale(roomId, user.uid).catch(() => undefined);
    }, 30_000);
    return () => {
      unsub();
      stopPresence?.();
      window.clearInterval(hostTimer);
    };
  }, [roomId, user]);

  useEffect(() => {
    if (!meta?.packId) return;
    void loadPack(meta.packId).then(setPack).catch((caught) => setError(caught));
  }, [meta?.packId]);

  const me = members.find((m) => m.uid === user?.uid) ?? null;
  const isHost = meta?.hostId === user?.uid;
  const isCaptain = me?.role === "captain";
  const canViewKey = Boolean(match && (isCaptain || meta?.status === "finished"));

  useEffect(() => {
    if (!roomId || !match?.matchId) {
      clearPrivateKey();
      return;
    }
    if (!canViewKey) {
      clearPrivateKey();
      return;
    }
    const activeMatchId = match.matchId;
    let unsub: (() => void) | undefined;
    void watchSecret(roomId, activeMatchId, (next) => {
      // Drop stale rematch / room-switch responses.
      if (next && next.matchId !== activeMatchId) return;
      setSecret(next);
    }).then((u) => {
      unsub = u;
    });
    return () => {
      unsub?.();
    };
  }, [canViewKey, clearPrivateKey, match?.matchId, roomId]);

  useEffect(() => {
    if (!isCaptain && meta?.status !== "finished") {
      clearPrivateKey();
    }
  }, [clearPrivateKey, isCaptain, meta?.status]);

  useEffect(() => {
    if (!roomId || !user || !match?.matchId || !isCaptain) {
      setCaptainMarks({});
      return;
    }
    const activeMatchId = match.matchId;
    return watchCaptainNotes(roomId, user.uid, activeMatchId, setCaptainMarks);
  }, [isCaptain, match?.matchId, roomId, user]);

  useEffect(() => {
    if (!roomId || !user || !isCaptain) return;
    return watchActions(roomId, (ids) => {
      for (const id of ids) {
        void processPendingReveal(roomId, user.uid, id).catch(() => undefined);
      }
    });
  }, [isCaptain, roomId, user]);

  useEffect(() => {
    if (!roomId) return;
    return watchDealRequest(roomId, setPendingDeal);
  }, [roomId]);

  const imageById = useMemo(() => {
    const map = new Map<string, string>();
    pack?.cards.forEach((card) => map.set(card.id, card.image));
    return map;
  }, [pack]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function openCaptainKey() {
    if (!roomId || !match) return;
    // Viewing the key must not touch turn/clue/reveal/public state — local UI + private read only.
    const requestMatchId = match.matchId;
    const startingTeam = match.startingTeam;
    setKeyOpen(true);
    setKeyError(null);
    if (secret && secret.matchId === requestMatchId) {
      setKeyView(toCaptainKeyView(requestMatchId, startingTeam, secret.roles));
      setKeyLoading(false);
      return;
    }
    setKeyLoading(true);
    setKeyView(null);
    try {
      const key = await fetchCaptainKey(roomId, requestMatchId);
      // Discard stale rematch / room-switch responses.
      if (key.matchId !== requestMatchId) return;
      setSecret(key);
      setKeyView(toCaptainKeyView(key.matchId, startingTeam, key.roles));
    } catch (caught) {
      setKeyError(caught);
      setKeyView(null);
    } finally {
      setKeyLoading(false);
    }
  }

  function closeCaptainKey() {
    setKeyOpen(false);
    setKeyError(null);
  }

  if (!configured) return <p className="panel">{t("notConfigured")}</p>;
  if (!ready || (!meta && !error)) return <p className="muted">{t("loading")}</p>;
  if (error && !meta) {
    return (
      <section className="panel">
        <p className="error">{err(error)}</p>
        <button type="button" className="btn ghost" onClick={() => navigate("/")}>{t("home")}</button>
      </section>
    );
  }
  if (!meta || !me || !roomId || !user) return <p className="muted">{t("loading")}</p>;

  const startOk = canStart(members);

  return (
    <div className="stack">
      {error ? <p className="error" role="alert">{err(error)}</p> : null}

      {meta.status === "lobby" || pendingDeal ? (
        <section className="panel">
          <p className="muted">{t("roomCode")}</p>
          <h1 className="code">{meta.code}</h1>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                void navigator.clipboard.writeText(roomInviteUrl(meta.code)).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? t("copied") : t("copyInvite")}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => void run(async () => {
                clearPrivateKey();
                await leaveRoom(roomId, user.uid);
                navigate("/");
              })}
            >
              {t("leave")}
            </button>
          </div>
          {members.length < GAME.minPlayers ? <p className="muted">{t("minPlayers")}</p> : null}
          <p className={startOk ? "ok" : "muted"}>{startOk ? t("start") : t("needRoles")}</p>
          {isHost ? (
            <div className="row">
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void run(() => hostRandomize(roomId, user.uid, "teams"))}>{t("randomTeams")}</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void run(() => hostRandomize(roomId, user.uid, "captains"))}>{t("randomCaptains")}</button>
              <button type="button" className="btn primary" disabled={busy || !startOk} onClick={() => void run(() => requestStart(roomId, user.uid))}>{t("start")}</button>
            </div>
          ) : null}
          {pendingDeal ? (
            <div className="panel">
              <p>{t("waitingDeal")}</p>
              {isCaptain ? (
                <button type="button" className="btn primary" disabled={busy} onClick={() => void run(() => captainDeal(roomId, user.uid))}>{t("dealNow")}</button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <h2>{t("players")}</h2>
        <div className="teams">
          {(["red", "blue", "none"] as const).map((bucket) => {
            const list = members.filter((m) => (bucket === "none" ? m.team == null : m.team === bucket));
            return (
              <div key={bucket} className={`team-col ${bucket}`}>
                <h3>{bucket === "none" ? t("unassigned") : t(bucket)}</h3>
                <ul>
                  {list.map((member) => {
                    const online = presence[member.uid]?.online;
                    return (
                      <li key={member.uid}>
                        <strong>
                          {member.displayName}
                          {member.uid === user.uid ? ` (${t("you")})` : ""}
                          {member.uid === meta.hostId ? ` · ${t("host")}` : ""}
                          {member.role === "captain" ? ` · ${t("captain")}` : member.role === "guesser" ? ` · ${t("guesser")}` : ""}
                        </strong>
                        <div className="muted">{online ? t("online") : t("offline")}</div>
                        {meta.status === "lobby" && isHost ? (
                          <div className="row">
                            <select
                              value={member.team ?? ""}
                              onChange={(e) => {
                                const team = e.target.value === "red" || e.target.value === "blue" ? (e.target.value as Team) : null;
                                void run(() => hostSetMember(roomId, user.uid, member.uid, team, team ? (member.role ?? "guesser") : null));
                              }}
                            >
                              <option value="">{t("unassigned")}</option>
                              <option value="red">{t("red")}</option>
                              <option value="blue">{t("blue")}</option>
                            </select>
                            <select
                              value={member.role ?? "guesser"}
                              disabled={!member.team}
                              onChange={(e) => {
                                const role = e.target.value as SeatRole;
                                if (member.team) void run(() => hostSetMember(roomId, user.uid, member.uid, member.team, role));
                              }}
                            >
                              <option value="guesser">{t("guesser")}</option>
                              <option value="captain">{t("captain")}</option>
                            </select>
                          </div>
                        ) : null}
                        {meta.status === "lobby" && member.uid === user.uid && member.team && member.role !== "captain" ? (
                          <button type="button" className="btn ghost" onClick={() => void run(() => claimCaptain(roomId, user.uid, member.team as Team))}>{t("claimCaptain")}</button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {match && (meta.status === "playing" || meta.status === "finished") ? (
        <>
          {canViewKey ? (
            <div className="captain-toolbar">
              <button
                type="button"
                className="btn primary"
                aria-haspopup="dialog"
                aria-label={t("viewKey")}
                onClick={() => void openCaptainKey()}
              >
                {t("viewKey")}
              </button>
            </div>
          ) : null}
          <GameBoard
            match={match}
            me={me}
            members={members}
            secret={canViewKey ? secret : null}
            captainMarks={isCaptain ? captainMarks : {}}
            imageById={imageById}
            packId={meta.packId}
            selected={selected}
            setSelected={setSelected}
            setZoom={setZoom}
            clueWord={clueWord}
            setClueWord={setClueWord}
            clueCount={clueCount}
            setClueCount={setClueCount}
            busy={busy}
            isHost={isHost}
            onClue={() => void run(() => giveClue(roomId, user.uid, clueWord, clueCount))}
            onReveal={(position) => void run(async () => {
              await guessCard(roomId, user.uid, position, match.version);
              setSelected(null);
            })}
            onMark={(position, kind) => void run(async () => {
              await setCaptainCardMark(roomId, user.uid, match.matchId, position, kind);
            })}
            onEnd={() => void run(() => endTurnAction(roomId, user.uid))}
            onRematch={() => void run(() => rematch(roomId, user.uid))}
          />
        </>
      ) : null}

      <section className="panel">
        <h2>{t("events")}</h2>
        <ol className="log">
          {events.map((event) => (
            <li key={event.id}>
              <span className="muted">{new Date(event.at).toLocaleTimeString()}</span> {event.type}
            </li>
          ))}
        </ol>
      </section>

      {zoom != null && match ? (
        <div className="modal" role="dialog" onClick={() => setZoom(null)} onKeyDown={(e) => e.key === "Escape" && setZoom(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <img
              src={assetUrl(meta.packId, imageById.get(match.cardIds[zoom] ?? "") ?? "")}
              alt={t("zoom")}
            />
            <button type="button" className="btn ghost" onClick={() => setZoom(null)}>{t("close")}</button>
          </div>
        </div>
      ) : null}

      {keyOpen ? (
        <CaptainKeyModal
          view={keyView}
          loading={keyLoading}
          error={keyError}
          onClose={closeCaptainKey}
        />
      ) : null}
    </div>
  );
}

function GameBoard(props: {
  match: PublicMatch;
  me: Member;
  members: Member[];
  secret: SecretKey | null;
  captainMarks: Record<string, CaptainMarkKind>;
  imageById: Map<string, string>;
  packId: string;
  selected: number | null;
  setSelected: (n: number | null) => void;
  setZoom: (n: number | null) => void;
  clueWord: string;
  setClueWord: (v: string) => void;
  clueCount: number;
  setClueCount: (n: number) => void;
  busy: boolean;
  isHost: boolean;
  onClue: () => void;
  onReveal: (position: number) => void;
  onMark: (position: number, kind: CaptainMarkKind | null) => void;
  onEnd: () => void;
  onRematch: () => void;
}) {
  const { t } = useI18n();
  const { match, me, members } = props;
  const myTurn = me.team === match.currentTeam;
  const canClue = !match.winner && match.phase === "clue" && myTurn && me.role === "captain";
  const canGuess = !match.winner && match.phase === "guess" && mayOpenCards(members, me.uid, match.currentTeam);
  // Clue-giving captain (active team) may privately annotate cards during their turn.
  const canMark =
    !match.winner &&
    me.role === "captain" &&
    me.team != null &&
    myTurn;
  const canEnd =
    !match.winner &&
    match.phase === "guess" &&
    match.guessesMade >= 1 &&
    (canGuess || (myTurn && me.role === "captain"));
  const duoTraining =
    members.length === 2 &&
    members.every((m) => m.role === "captain") &&
    !match.winner;
  const markLabels: Record<CaptainMarkKind, "markOwn" | "markEnemy" | "markNeutral" | "markAssassin"> = {
    own: "markOwn",
    enemy: "markEnemy",
    neutral: "markNeutral",
    assassin: "markAssassin",
  };

  return (
    <div className="stack">
      <section className={`banner ${match.winner ?? match.currentTeam}`}>
        <h1>{match.winner ? t("winner", { team: t(match.winner) }) : t("turn", { team: t(match.currentTeam) })}</h1>
        <p>{t("remaining", { team: t("red"), n: match.remaining.red })} · {t("remaining", { team: t("blue"), n: match.remaining.blue })}</p>
        {duoTraining ? <p className="muted">{t("duoTraining")}</p> : null}
        {match.phase === "guess" && match.clueWord ? (
          <p className="clue-banner">
            <strong>{match.clueWord}</strong> <span>{match.clueCount}</span>
            <span>{t("guessesLeft", { n: match.guessesLeft ?? 0 })}</span>
          </p>
        ) : null}
      </section>

      <div className="board" role="list">
        {match.cardIds.map((cardId, position) => {
          const revealed = (match.revealed ?? {})[String(position)] as CardRole | undefined;
          const keyRole = props.secret?.roles[String(position)] ?? null;
          const markKind = props.captainMarks[String(position)] ?? null;
          const markRole = markKind && me.team ? captainMarkRole(me.team, markKind) : null;
          const role = revealed ?? null;
          const file = props.imageById.get(cardId);
          return (
            <button
              key={`${cardId}-${position}`}
              type="button"
              role="listitem"
              className={[
                "tile",
                props.selected === position ? "selected" : "",
                role ? `role-${role}` : "",
                !revealed && keyRole ? `key-${keyRole}` : "",
              ].join(" ")}
              aria-label={`Card ${position + 1}`}
              onClick={() => {
                if (revealed) {
                  props.setZoom(position);
                  return;
                }
                if (canGuess) {
                  if (props.selected === position) return;
                  props.setSelected(position);
                  return;
                }
                if (canMark) {
                  props.setSelected(position);
                  return;
                }
                props.setZoom(position);
              }}
            >
              {file ? <img src={assetUrl(props.packId, file)} alt={`Card ${position + 1}`} /> : null}
              {role ? <span className="veil">{t(role)}</span> : null}
              {!revealed && markRole ? (
                <span className={`mark-pip role-${markRole}`} title={t(markLabels[markKind!])} aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>

      {canGuess && props.selected != null ? (
        <div className="dock">
          <p>{t("selectCard")}</p>
          <div className="row">
            <button type="button" className="btn primary" disabled={props.busy} onClick={() => props.onReveal(props.selected!)}>{t("confirmReveal")}</button>
            <button type="button" className="btn ghost" onClick={() => props.setSelected(null)}>{t("cancel")}</button>
            <button type="button" className="btn ghost" onClick={() => props.setZoom(props.selected)}>{t("zoom")}</button>
          </div>
        </div>
      ) : null}

      {canMark && !canGuess && props.selected != null && !(match.revealed ?? {})[String(props.selected)] ? (
        <div className={`dock mark-dock team-${me.team ?? "red"}`}>
          <p>{t("markCard")}</p>
          <div className="mark-actions">
            {CAPTAIN_MARK_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`btn mark-${kind}`}
                disabled={props.busy}
                aria-pressed={props.captainMarks[String(props.selected)] === kind}
                onClick={() => {
                  const pos = props.selected!;
                  const next = props.captainMarks[String(pos)] === kind ? null : kind;
                  props.onMark(pos, next);
                }}
              >
                {t(markLabels[kind])}
              </button>
            ))}
            <button
              type="button"
              className="btn ghost"
              disabled={props.busy || !props.captainMarks[String(props.selected)]}
              onClick={() => props.onMark(props.selected!, null)}
            >
              {t("markClear")}
            </button>
            <button type="button" className="btn ghost" onClick={() => props.setZoom(props.selected)}>{t("zoom")}</button>
            <button type="button" className="btn ghost" onClick={() => props.setSelected(null)}>{t("cancel")}</button>
          </div>
        </div>
      ) : null}

      {canClue ? (
        <form
          className="dock"
          onSubmit={(e) => {
            e.preventDefault();
            props.onClue();
          }}
        >
          <label>
            {t("clueWord")}
            <input value={props.clueWord} onChange={(e) => props.setClueWord(e.target.value)} maxLength={32} required />
          </label>
          <label>
            {t("clueCount")}
            <select value={props.clueCount} onChange={(e) => props.setClueCount(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={props.busy}>{t("giveClue")}</button>
        </form>
      ) : null}

      {canEnd ? (
        <button type="button" className="btn ghost" disabled={props.busy} onClick={props.onEnd}>{t("endTurn")}</button>
      ) : null}

      {match.winner && props.isHost ? (
        <button type="button" className="btn primary" disabled={props.busy} onClick={props.onRematch}>{t("rematch")}</button>
      ) : null}
    </div>
  );
}
