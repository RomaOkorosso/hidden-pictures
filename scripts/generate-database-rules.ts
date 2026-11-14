import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function countRole(role: string): string {
  const parts = Array.from(
    { length: 20 },
    (_, i) => `(newData.child('roles/${i}').val() === '${role}' ? 1 : 0)`,
  );
  return `(${parts.join(" + ")})`;
}

function allRolesPresent(): string {
  return Array.from({ length: 20 }, (_, i) => `newData.child('roles/${i}').exists()`).join(" && ");
}

const member = (room = "$roomId") =>
  `root.child('rooms').child(${room === "$roomId" ? "$roomId" : room}).child('members').child(auth.uid).exists()`;

const captainRoom = "root.child('rooms').child($roomId)";
const activeKey = `${captainRoom}.child('secret').child(${captainRoom}.child('meta/matchId').val())`;
// A roster role alone must never authorize a third captain to read or probe the key.
const isCaptain = `(${captainRoom}.child('members').child(auth.uid).child('role').val() === 'captain' && (${captainRoom}.child('meta/status').val() === 'lobby' || ${activeKey}.child('captainRed').val() === auth.uid || ${activeKey}.child('captainBlue').val() === auth.uid))`;
const isHost = `root.child('rooms').child($roomId).child('meta').child('hostId').val() === auth.uid`;
const lobbyOpen = `root.child('rooms').child($roomId).child('meta').child('status').val() === 'lobby'`;
// newData path sees sibling meta from the same multi-path create (root is still pre-write).
const lobbyOpenAfterWrite = `newData.parent().parent().child('meta').child('status').val() === 'lobby'`;
const auth = "auth != null";

const room = "root.child('rooms').child($roomId)";
const meta = `${room}.child('meta')`;
const pub = `${room}.child('public')`;
const mine = `${room}.child('members').child(auth.uid)`;
const playing = `${meta}.child('status').val() === 'playing'`;
const dealer = `${lobbyOpen} && ${room}.child('dealRequests/pending/initializer').val() === auth.uid && ${isCaptain}`;
const same = (fields: string[]) => fields.flatMap(f => f === 'remaining' ? ['remaining/red', 'remaining/blue'] : f === 'revealed' ? Array.from({ length: 20 }, (_, i) => `revealed/${i}`) : f === 'cardIds' ? Array.from({ length: 20 }, (_, i) => `cardIds/${i}`) : [f]).map(f => `newData.child('${f}').val() === data.child('${f}').val()`).join(' && ');
const sameSeat = same(['uid', 'team', 'role', 'joinedAt']);
const sameMeta = same(['code', 'createdAt', 'packId']);
const active = `${mine}.child('team').val() === data.child('currentTeam').val()`;
const captainTurn = `${isCaptain} && ${active}`;
const endAction = `data.child('phase').val() === 'guess' && data.child('guessesMade').val() >= 1 && newData.child('phase').val() === 'clue' && newData.child('currentTeam').val() === (data.child('currentTeam').val() === 'red' ? 'blue' : 'red') && ${same(['revealed', 'remaining', 'winner', 'winReason'])} && !newData.child('clueWord').exists() && !newData.child('clueCount').exists() && !newData.child('guessesLeft').exists() && newData.child('guessesMade').val() === 0 && (${active} || (${isCaptain} && data.child('duoTraining').val() === true))`;
const clueAction = `${captainTurn} && data.child('phase').val() === 'clue' && newData.child('phase').val() === 'guess' && ${same(['revealed', 'remaining', 'currentTeam', 'turnId', 'winner', 'winReason'])} && newData.child('clueWord').isString() && newData.child('clueWord').val().length > 0 && newData.child('clueWord').val().length <= 32 && newData.child('clueCount').isNumber() && newData.child('clueCount').val() >= 1 && newData.child('clueCount').val() <= 8 && newData.child('clueCount').val() % 1 === 0 && newData.child('guessesLeft').val() === newData.child('clueCount').val() + 1 && newData.child('guessesMade').val() === 0`;
const revealCount = (snapshot: string) => '(' + Array.from({ length: 20 }, (_, i) => `(${snapshot}.child('revealed/${i}').exists() ? 1 : 0)`).join(' + ') + ')';
const revealAction = `${isCaptain} && data.child('phase').val() === 'guess' && data.child('guessesLeft').val() > 0 && ${revealCount('newData')} === ${revealCount('data')} + 1 && newData.child('guessesMade').val() === data.child('guessesMade').val() + 1`;
const preserveRevealed = Array.from({ length: 20 }, (_, i) => `(!data.child('revealed/${i}').exists() || newData.child('revealed/${i}').val() === data.child('revealed/${i}').val())`).join(' && ');

const rules = {
  rules: {
    ".read": false,
    ".write": false,
    profiles: {
      $uid: {
        ".read": `${auth} && auth.uid === $uid`,
        // profiles readable by self; room peers read via members.displayName copy
        ".write": `${auth} && auth.uid === $uid`,
        ".validate":
          "newData.hasChildren(['displayName','updatedAt']) && newData.child('displayName').isString() && newData.child('displayName').val().length >= 2 && newData.child('displayName').val().length <= 24 && newData.child('updatedAt').isNumber()",
      },
    },
    roomCodes: {
      ".read": false,
      $code: {
        ".read": auth,
        ".write":
          `${auth} && ((!data.exists() && newData.hasChildren(['roomId']) && newData.child('roomId').isString()) || (data.exists() && !newData.exists() && root.child('rooms').child(data.child('roomId').val()).child('meta').child('hostId').val() === auth.uid))`,
      },
    },
    rooms: {
      $roomId: {
        ".write": `${auth} && ${isHost} && ${lobbyOpen} && !data.child('members').exists() && !newData.exists()`,
        meta: {
          // Lobby meta is readable so joiners can resolve status before becoming members.
          ".read": `${auth} && (${member()} || data.child('status').val() === 'lobby')`,
          ".write": `${auth} && ((!data.exists() && newData.child('hostId').val() === auth.uid && newData.child('status').val() === 'lobby') || (data.exists() && (${sameMeta}) && ((${isHost} && ${same(['status', 'matchId'])} && (newData.child('hostId').val() === auth.uid || ${room}.child('members').child(newData.child('hostId').val()).exists())) || (${dealer} && data.child('status').val() === 'lobby' && newData.child('status').val() === 'playing' && newData.child('matchId').val() === newData.parent().child('public/matchId').val() && newData.parent().child('secret').child(newData.child('matchId').val()).exists() && newData.child('hostId').val() === data.child('hostId').val()) || (${isCaptain} && ${playing} && newData.child('status').val() === 'finished' && newData.parent().child('public/winner').exists() && ${same(['hostId', 'matchId'])}) || (${isHost} && data.child('status').val() === 'finished' && newData.child('status').val() === 'lobby' && !newData.child('matchId').exists() && !newData.parent().child('public').exists() && ${same(['hostId'])}) || (${member()} && newData.child('hostId').val() === auth.uid && ${same(['status','matchId'])} && ${room}.child('presence').child(data.child('hostId').val()).child('online').val() === false && ${room}.child('presence').child(data.child('hostId').val()).child('at').val() < now - 90000))))`,
          ".validate":
            "newData.hasChildren(['code','hostId','status','createdAt','updatedAt','packId']) && (newData.child('status').val() === 'lobby' || newData.child('status').val() === 'playing' || newData.child('status').val() === 'finished') && newData.child('hostId').isString() && newData.child('code').isString() && newData.child('createdAt').isNumber() && newData.child('updatedAt').isNumber() && newData.child('packId').isString()",
        },
        members: {
          // Lobby roster readable for capacity checks during join.
          ".read": `${auth} && (${member()} || ${lobbyOpen})`,
          $uid: {
            ".write": `${auth} && ((!data.exists() && auth.uid === $uid && ${lobbyOpen} && (${room}.child('joinLock/uid').val() === auth.uid || (${isHost} && !${room}.child('members').exists())) && !newData.child('team').exists() && !newData.child('role').exists()) || (data.exists() && ((auth.uid === $uid && newData.exists() && ${sameSeat}) || (${lobbyOpen} && (${isHost} || (auth.uid === $uid && !newData.exists()) || (${member()} && newData.exists() && ${same(['uid','team','displayName','joinedAt','lastSeenAt'])} && newData.child('team').val() === ${mine}.child('team').val() && ((auth.uid === $uid && newData.child('role').val() === 'captain') || (newData.child('role').val() === 'guesser' && newData.parent().child(auth.uid).child('role').val() === 'captain'))))))))`,
            // New seats only while lobby is open; updates/deletes keep existing host/claim flows.
            // Allow create-room multipath (meta+member) via newData sibling meta, and join via root lobby.
            ".validate":
              `!newData.exists() || (newData.hasChildren(['displayName','joinedAt','lastSeenAt']) && newData.child('uid').val() === $uid && newData.child('displayName').isString() && newData.child('displayName').val().length >= 2 && newData.child('displayName').val().length <= 24 && (data.exists() || (auth.uid === $uid && (${lobbyOpen} || ${lobbyOpenAfterWrite}))))`,
            // Explicit schema: no extra role/profile fields in the public roster.
            uid: { ".validate": "newData.isString() && newData.val() === $uid" },
            displayName: { ".validate": "newData.isString() && newData.val().length >= 2 && newData.val().length <= 24" },
            team: { ".validate": "newData.val() === 'red' || newData.val() === 'blue'" },
            role: { ".validate": "newData.val() === 'captain' || newData.val() === 'guesser'" },
            joinedAt: { ".validate": "newData.isNumber()" },
            lastSeenAt: { ".validate": "newData.isNumber()" },
            $other: { ".validate": false },
          },
        },
        joinLock: {
          ".read": `${auth} && (${lobbyOpen} || ${member()})`,
          ".write": `${auth} && ${lobbyOpen} && ((!newData.exists() && data.child('uid').val() === auth.uid) || (newData.exists() && newData.child('uid').val() === auth.uid && (!data.exists() || data.child('uid').val() === auth.uid || data.child('at').val() <= now - 10000)))`,
          ".validate": "newData.hasChildren(['uid','at']) && newData.child('at').isNumber() && newData.child('at').val() === now",
        },
        presence: {
          ".read": `${auth} && ${member()}`,
          $uid: {
            ".write": `${auth} && auth.uid === $uid`,
          },
        },
        public: {
          ".read": `${auth} && ${member()}`,
          ".write": `${auth} && ${member()} && ((!newData.exists() && ${isHost} && ${meta}.child('status').val() === 'finished') || (!data.exists() && ${dealer}) || (data.exists() && newData.exists() && ${playing} && !data.child('winner').exists() && newData.child('version').val() === data.child('version').val() + 1 && ${same(['matchId','cardIds','startingTeam','createdAt','duoTraining'])} && (${preserveRevealed}) && ((${clueAction}) || (${endAction}) || (${revealAction}))))`,
          revealed: {
            // First write must match secret. Rewriting the same value is allowed so full
            // `public` replacements (2nd+ reveal, clue, end turn) are not rejected.
            $pos: {
              ".validate":
                `!newData.exists() || (` +
                `newData.isString() &&` +
                `(newData.val() === 'red' || newData.val() === 'blue' || newData.val() === 'neutral' || newData.val() === 'assassin') &&` +
                `((data.exists() && data.val() === newData.val()) || (` +
                `!data.exists() &&` +
                `newData.val() === root.child('rooms').child($roomId).child('secret').child(newData.parent().parent().child('matchId').val()).child('roles').child($pos).val()` +
                `))` +
                `)`,
            },
          },
        },
        secret: {
          // Only the active matchId may be read. Captains during play; any room member after finish.
          // Auth identity comes from Firebase Auth token — never from client-supplied role fields.
          $matchId: {
            ".read":
              `${auth} && $matchId === root.child('rooms').child($roomId).child('meta').child('matchId').val() && (${isCaptain} || (root.child('rooms').child($roomId).child('meta').child('status').val() === 'finished' && ${member()}))`,
            ".write": `${auth} && ${dealer} && !data.exists()`,
            ".validate":
              `newData.child('matchId').val() === $matchId && newData.hasChildren(['matchId','roles','captainRed','captainBlue']) && ${allRolesPresent()} && ${countRole(
                "assassin",
              )} === 1 && ${countRole("neutral")} === 4 && ((${countRole("red")} === 8 && ${countRole("blue")} === 7) || (${countRole(
                "red",
              )} === 7 && ${countRole("blue")} === 8))`,
          },
        },
        events: {
          ".read": `${auth} && ${member()}`,
          $eventId: {
            ".write": `${auth} && ${member()} && !data.exists()`,
            ".validate": "newData.hasChildren(['id','at','type','actorUid'])",
          },
        },
        dealRequests: {
          ".read": `${auth} && ${member()}`,
          ".write": `${auth} && ((${isHost} && ${lobbyOpen}) || (${dealer} && !newData.exists()) || (${isHost} && ${meta}.child('status').val() === 'finished' && !newData.exists()))`,
        },
        // Guesser reveal queue: field players enqueue position only (never roles).
        // Only captains may read the queue / clear items after applying via secret.
        actions: {
          ".read": `${auth} && ${isCaptain}`,
          $actionId: {
            ".write":
              `${auth} && ${member()} && (` +
              `(!data.exists() && newData.hasChildren(['uid','position','turnId','matchId','version','at']) && newData.child('uid').val() === auth.uid && ${mine}.child('role').val() === 'guesser' && ${mine}.child('team').val() === ${pub}.child('currentTeam').val() && ${playing} && ${pub}.child('phase').val() === 'guess' && !${pub}.child('winner').exists() && newData.child('version').val() === ${pub}.child('version').val() && newData.child('turnId').val() === ${pub}.child('turnId').val() && newData.child('matchId').val() === ${pub}.child('matchId').val()) ||` +
              `(data.exists() && !newData.exists() && ${isCaptain})` +
              `)`,
            ".validate":
              `!newData.exists() || (` +
              `newData.child('uid').val() === auth.uid &&` +
              `newData.child('position').isNumber() && newData.child('position').val() >= 0 && newData.child('position').val() <= 19 && newData.child('position').val() % 1 === 0 &&` +
              `newData.child('turnId').isString() && newData.child('matchId').isString() &&` +
              `newData.child('version').isNumber() && newData.child('at').isNumber()` +
              `)`,
          },
        },
        // Private per-captain card marks. Never readable by other players.
        captainNotes: {
          $uid: {
            ".read": `${auth} && auth.uid === $uid`,
            ".write":
              `${auth} && auth.uid === $uid && ${isCaptain} && root.child('rooms').child($roomId).child('meta').child('status').val() === 'playing'`,
            ".validate":
              `!newData.exists() || (` +
              `newData.hasChildren(['matchId','marks']) &&` +
              `newData.child('matchId').isString() &&` +
              `newData.child('matchId').val() === root.child('rooms').child($roomId).child('meta').child('matchId').val()` +
              `)`,
            marks: {
              $pos: {
                ".validate":
                  `!newData.exists() || (` +
                  `newData.isString() &&` +
                  `(newData.val() === 'own' || newData.val() === 'enemy' || newData.val() === 'neutral' || newData.val() === 'assassin')` +
                  `)`,
              },
            },
          },
        },
      },
    },
  },
};

writeFileSync(join(root, "database.rules.json"), `${JSON.stringify(rules, null, 2)}\n`);
console.log("generated database.rules.json");
