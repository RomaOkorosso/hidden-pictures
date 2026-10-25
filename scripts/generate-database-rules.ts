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

const isCaptain = `root.child('rooms').child($roomId).child('members').child(auth.uid).child('role').val() === 'captain'`;
const isHost = `root.child('rooms').child($roomId).child('meta').child('hostId').val() === auth.uid`;
const auth = "auth != null";

const rules = {
  rules: {
    ".read": false,
    ".write": false,
    profiles: {
      $uid: {
        ".read": `${auth} && (auth.uid === $uid || root.child('rooms').child($roomId).exists() === false)`,
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
        meta: {
          ".read": `${auth} && ${member()}`,
          ".write": `${auth}`,
          ".validate":
            "newData.hasChildren(['code','hostId','status','createdAt','updatedAt','packId']) && (newData.child('status').val() === 'lobby' || newData.child('status').val() === 'playing' || newData.child('status').val() === 'finished') && (!data.exists() ? newData.child('hostId').val() === auth.uid : (newData.child('hostId').val() === data.child('hostId').val() || newData.child('hostId').val() === auth.uid))",
        },
        members: {
          ".read": `${auth} && ${member()}`,
          $uid: {
            ".write": `${auth}`,
            ".validate":
              "!newData.exists() || (newData.hasChildren(['displayName','joinedAt','lastSeenAt']) && newData.child('uid').val() === $uid && newData.child('displayName').isString() && newData.child('displayName').val().length >= 2)",
          },
        },
        presence: {
          ".read": `${auth} && ${member()}`,
          $uid: {
            ".write": `${auth} && auth.uid === $uid`,
          },
        },
        public: {
          ".read": `${auth} && ${member()}`,
          ".write": `${auth} && ${member()}`,
          revealed: {
            $pos: {
              ".validate":
                `!newData.exists() || (` +
                `newData.isString() &&` +
                `(newData.val() === 'red' || newData.val() === 'blue' || newData.val() === 'neutral' || newData.val() === 'assassin') &&` +
                `(!data.exists()) &&` +
                `newData.val() === root.child('rooms').child($roomId).child('secret').child(newData.parent().parent().child('matchId').val()).child('roles').child($pos).val()` +
                `)`,
            },
          },
        },
        secret: {
          $matchId: {
            ".read":
              `${auth} && (${isCaptain} || (root.child('rooms').child($roomId).child('meta').child('status').val() === 'finished' && ${member()}))`,
            ".write": `${auth} && ${isCaptain} && !data.exists()`,
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
            ".validate": "newData.hasChildren(['id','at','type','actorUid','payload'])",
          },
        },
        dealRequests: {
          ".read": `${auth} && ${member()}`,
          ".write": `${auth} && (${isHost} || ${isCaptain})`,
        },
      },
    },
  },
};

// Fix broken profiles.read referencing $roomId — profiles only self-read
(rules.rules.profiles as { $uid: { ".read": string } }).$uid[".read"] = `${auth} && auth.uid === $uid`;

writeFileSync(join(root, "database.rules.json"), `${JSON.stringify(rules, null, 2)}\n`);
console.log("generated database.rules.json");
