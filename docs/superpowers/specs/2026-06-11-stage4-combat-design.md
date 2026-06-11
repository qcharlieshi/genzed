# Stage 4 — Combat: Design

Date: 2026-06-11
Status: approved (brainstorm complete)
Parent: `docs/superpowers/specs/2026-05-25-genzed-modernization-design.md`
Recon: 7-agent extraction over `legacy/` with file:line citations, adversarially spot-checked. Citations below are to legacy source unless marked otherwise.

## Goal

Port the 2017 game's combat onto the server-authoritative Colyseus sim: the GunGame PvP loop that actually shipped (mouse-aimed guns, kill-to-upgrade ladder, level 6 wins), plus the zombie layer the capstone *intended* but never finished, plus the supporting systems (pickups, kill feed, active reload, vision cone, chat, HUD, sounds).

Two deployable slices:

- **4A — PvP gun-game**: aim, bullets, damage, gun ladder, roll, respawn, win FSM, kill feed, HUD, sounds. Playable and deployable on its own.
- **4B — world layer**: zombies, pickups, chat, vision cone.

One spec (this document), two plans, two branches, two merges.

## Decisions made during brainstorming

| Question | Decision |
| --- | --- |
| Zombie scope | **Simple zombies** — server-spawned, chase nearest player with greedy steering (no A*), legacy-derived stats, one-hit-killed. Spawner invented (legacy has none). |
| Win/score model | **Faithful GunGame** — +1 gun level per player kill, level 6 (5 kills) wins. Zombie kills award nothing. No points system (legacy's was dead code). |
| Extras | **All in**: kill feed, active-reload minigame, vision cone (client-only), in-game chat. |
| Netcode | **Schema entities + dead reckoning** — bullets/zombies are server-stepped schema state; clients dead-reckon bullets for smooth rendering; transient FX via `room.broadcast()` events. |
| Delivery | **Two slices 4A/4B**, each spec→plan→build→merge→deployable. |

## Key recon findings (what we're actually porting)

- Legacy was fully client-authoritative: the shooter's client detected hits and broadcast damage events; the victim's client applied damage and rolled its own respawn (`zombieGameState.js:556-595`, `player.js:333-373`). None of that machinery ports — this stage re-architects combat onto our tick.
- **Zombies never worked in legacy.** Spawners have zero call sites, the A* worldGrid bug made pathfinding return null always, shipped zombie motion was literally `x += 1; y -= 1` (`enemyGenerator.js`, `tiledState.js:108-125`, `manageZombies.js:88-89`). The only legacy-derived zombie numbers: 5 dmg per attack, 1/s cadence, ~91 px/s (350ms/32px tile), one-hit-kill, 4s corpse.
- **There is no score.** Gun level is the score; the leaderboard's `.score` sort is a no-op on an undefined field (`Leaderboard.js:8-17`).
- Collision geometry differs by purpose: players block on wall+water+litWall; **bullets block on wallCollision only** (fly over water); legacy zombie pathing intended wall+water (`zombieGameState.js:345-358`).
- Vision cone (Lighting plugin) is a combat mechanic, not atmosphere: 90°/~270px mouse-directed cone; off-cone enemies genuinely hidden via render parenting (`Lighting.js:12-14`, `zombieGameState.js:150-168`).

## Tuning (`shared/src/tuning.ts` additions — single source for server + client)

### Gun ladder

Cumulative values resolved from `player.js:198-254` upgrade deltas + `GunPrefab.js:7` + `gameConstants.js:8` + `gun.js:85-103`:

| Lvl | Identity | Damage | Fire interval ms | Clip | Bullet speed px/s | Gun frame | Bullet frame | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Pistol | 10 | 350 | 10 | 500 | 6 | 7 | starting weapon |
| 2 | SMG | 5 | 150 | 30 | 500 | 5 | 0 | |
| 3 | Sniper | 70 | 1050 | 5 | 1000 | 1 | 2 | |
| 4 | Heavy | 90 | 1550 | 2 | 200 | 3 | 3 | |
| 5 | Melee-ish | 70 | 350 | ∞ (`-1`) | 200 | 4 | 4 | bullet lifetime 50ms (~10px); +36 px/s move speed |
| 6 | — | | | | | | | `hasWon` — win state, not a weapon |

All weapons fire full-auto while the button is held, gated by the fire interval (`handlePlayerInput.js:71-74`, `gun.js:53-62`).

### Player / movement / roll

- `PLAYER_HEALTH = 100` (`gameConstants.js:6`)
- Base speed stays `PLAYER_SPEED = 100`; **speed becomes per-player state**: `effective = base + gunL5Bonus(36) + speedPickupBonus(100)` — see Architecture.
- Roll: `ROLL_SPEED_BONUS = 100` px/s on top of effective speed in the roll direction (diagonal normalized ×0.7071), `ROLL_DURATION_MS = 600` (12 ticks), `ROLL_COOLDOWN_MS = 1000` (`gameConstants.js:9`). During a roll: movement/fire/reload input ignored, aim still updates, **no i-frames** (`handlePlayerInput.js:64-69,252-280`).
- Respawn: instant teleport to a random Stage 3 `SPAWN_POINTS` entry (the nudged 8-point list — do **not** re-port legacy's `(896,704)`, it sits in a wall under centered-AABB), HP 100, `RESPAWN_IMMUNITY_MS = 1000` (`player.js:352-364`). Server rolls the location.
- Self-damage: blocked. FFA otherwise; no teams (`zombieGameState.js:558-560`).

### Reload / active reload

- `RELOAD_MS = 2000` — legacy's `reloadSpeed` field was dead code; real duration was the 30-frame/15fps bar animation (`gun.js:143-176`, `player.js:147`).
- Active-reload attempt (R during reload), judged server-side against server reload-start: success window `[1350, 1650]` ms (legacy frames 21–23 ≈ 1400–1600ms + 50ms latency slack each side; `handlePlayerInput.js:80-113`). Success: instant full clip + `ACTIVE_RELOAD_DAMAGE_BONUS = 10` for `2500` ms. Miss: jam — reload completes at `attempt + 3500` ms.

### Zombies (stats legacy-derived; spawner INVENTED — flagged for playtest)

- `ZOMBIE_SPEED = 91` px/s (350ms per 32px tile, `enemy.js:72`)
- `ZOMBIE_ATTACK_DAMAGE = 5`, `ZOMBIE_ATTACK_COOLDOWN_MS = 1000` (`enemy.js:12-22,30-40`)
- `ZOMBIE_ATTACK_RANGE_PX = 28` (legacy "same 32px tile", canonicalized to a center distance)
- One-hit-kill by any bullet (legacy never decremented zombie HP; `zombieGameState.js:511-525`). No HP field.
- Corpse: client-side death anim at last position, despawned after 4s (`zombieGameState.js:527-554`)
- **Invented:** `ZOMBIE_SPAWN_INTERVAL_MS = 4000`, `ZOMBIE_MAX_ALIVE = 8`, spawn points = legacy's `enemyGenerator.js:7-18` list deduplicated (8 unique points), each validated against the solidity grid at boot (nudge or reject, Stage 3 spawn-in-wall lesson). These numbers are starting guesses — tune in playtest.

### Pickups

- Health: `+30` HP; if HP ≥ 70 → set to 100 (cap; `managePickups.js:84-87`)
- Speed: `+100` px/s for `5000` ms; **re-pickup refreshes the timer instead of stacking** (deviation — legacy stacked via untracked setTimeouts, a bug)
- `PICKUP_RESPAWN_MS = 8000` after consumption, at a random unoccupied slot of the legacy 11-point list (`managePickups.js:26-36,93-96`); initial: 2 health at slots 4 and 1, 2 speed at slots 6 and 8 (`managePickups.js:65-73`). Coordinates validated against the grid at boot.

### Deliberate deviations from legacy (bugs not ported)

1. Zombies target the **nearest** player — legacy's `distance <= playerDistance` comparison selected the farthest (`enemy.js:81-97`).
2. **Per-bullet speed** — legacy mutated the shared bullet group's speed at L3/L4 and never reset it (`gun.js:86-93`).
3. One bullet spawn point: player center (legacy mixed gun position and player center, `gun.js:70-83`).
4. Speed boost refreshes, doesn't stack.
5. One canonical roll: 600ms all directions, speed bonus applied before diagonal normalization (legacy had a precedence quirk yielding `movement + 70.71` diagonally and 700ms up-rolls).
6. Single death path: server-side `hp <= 0` check only (legacy had a racing client-side safety net, `zombieGameState.js:212-214`).
7. Server rolls respawn location (legacy: every client rolled independently, victim's self-report won).
8. Rank-change feed line announces the player whose rank actually changed (legacy double-bug: announced on rank *drop*, always named yourself; `player.js:309,328`).
9. `gun.spread` dropped — assigned in legacy, never read.

## Architecture

### Prerequisite: Colyseus version alignment

First task of 4A: align `colyseus.js` client to the server's `0.15.57` line (both already resolve `@colyseus/schema@2.0.37`). CLAUDE.md mandates this before wire-protocol work, and this stage adds schema collections.

### Schema (`server/src/schema/ArenaState.ts` + client mirror `client/src/lobby/arenaState.ts`)

```
Player +=
  hp: uint8            // 0..100
  gunLevel: uint8      // 1..6 (6 = won)
  ammo: int16          // -1 encodes Infinity (L5)
  reloadStartedAt: number  // server-clock ms; 0 = not reloading. Jam pushes completion out.
  aimAngle: float32    // radians; remote gun rendering
  rollTicksLeft: uint8
  rollDir: uint8       // DIR_* of the roll
  rollCooldownTicks: uint8
  speedBonus: uint8    // 0 | 36 | 100 | 136 — server-computed, read by prediction
  immuneUntil: number  // server-clock ms; respawn immunity + client tint

Bullet (new MapSchema, key = id):
  x, y, vx, vy: number
  level: uint8         // sprite frame selection
  spawnTick: uint32    // L5 lifetime; client TTL fallback
  // shooter sessionId stays in room memory (kill credit is server business)

Zombie (new MapSchema, key = id):
  x, y: number
  vx: number           // sign drives flipX; walk anim is direction-less
  // AABB reuses the player's 16×20 (frame sourceSize is 25×24; close enough, shares move())

Pickup (new MapSchema, key = id):
  x, y: number
  kind: uint8          // 0 = health, 1 = speed

ArenaState +=
  bullets: MapSchema<Bullet>
  zombies: MapSchema<Zombie>
  pickups: MapSchema<Pickup>
  winnerName: string
  phase: "lobby" | "starting" | "playing" | "ended"
```

`useArenaRoom`'s React `sync()` must ignore bullet/zombie churn (players-only mirror) — otherwise React re-renders every tick (recon flag, `useArenaRoom.ts:73-84`).

### Messages (`shared/src/messages.ts`)

- `MSG_INPUT` extended: `{ seq, up, down, left, right, roll: boolean, aimAngle: number }` — `isInputMessage` validation extended to match. Roll and aim ride the seq'd, replay-guarded, prediction-replayed channel.
- New commands (server-gated, bypass the 2-per-tick input cap):
  - `MSG_FIRE { tx, ty }` — target world point; bullets converge on the point, legacy-faithful (`gun.js:95`). Server computes velocity from its authoritative player position; gates: `nextFire`, ammo, not reloading, not rolling, playing-phase, alive.
  - `MSG_RELOAD {}` — gate: ammo < clip, not already reloading.
  - `MSG_ACTIVE_RELOAD {}` — judged against server reload-start (window above).
  - `MSG_CHAT { text }` — relay broadcast `{ name, text }`; gates: 200 chars, 1/s per player.
- New broadcasts:
  - `EVT_SHOT { shooterId, level, x, y }` — muzzle sound (distance-attenuated client-side) + flash.
  - `EVT_LOG { kind, text }` — kill feed: slain / pickup / level-up / rank-change / win lines, 3s TTL client-side.

### Server tick (extends `ArenaRoom.tick()`, 20 Hz, order matters)

1. **Players**: drain input queues (existing path) through the extended sim — roll FSM, per-player speed. Tick down roll/cooldown/immunity/reload/buff timers.
2. **Bullets**: integrate with substepping (≤16px per substep; sniper moves 50px/tick — `move()`'s <32px precondition rules it out for bullets). Collide against the **bullet grid** (built from `wallCollision` layer only — bullets fly over water, players don't; `buildSolidityGrid` gains a layer-name filter) and against player/zombie AABBs (skip shooter; skip immune players). Apply damage; on player kill: credit shooter `gunLevel+1`, reset their clip to the new gun, victim respawns (teleport + immunity), `EVT_LOG` slain line; on zombie hit: remove zombie.
3. **Zombies**: retarget nearest alive player each tick (cheap at ≤4 players × ≤8 zombies), steer greedily via shared `move()` (axis-separated sweep gives wall-sliding for free; zombies use the player-collision grid), attack if within range and off cooldown.
4. **Spawners**: zombie cadence + max-alive; pickup respawn timers. Pickups are server state (small fixed set — plain schema array or map) with collection detected by player-AABB overlap in this step.
5. **Win check**: any `gunLevel >= 6` → `phase = "ended"`, `winnerName`, `EVT_LOG` win line, server timer 10s → reset to lobby (reuses the existing `handleEndGame` reset logic; the dev `end_game` message stays for tests).

### The hard part (called out): speed and roll thread through prediction

`stepPlayer(grid, x, y, input)` becomes `stepPlayer(grid, sim, input) → sim` where `sim = { x, y, rollTicksLeft, rollDir, rollCooldownTicks, speedBonus }`. Server tick and client prediction/replay share it (the Stage 3 invariant: ONE simulation). Reconciliation rebases the full sim from schema, then replays pending inputs. A vitest parity test drives identical input sequences through server-side and prediction-side stepping and asserts identical trajectories — this is the regression net for the whole stage.

Aim is *not* predicted — it's render-immediate locally and schema-synced for remotes.

### Client (`ArenaScene` + HUD)

- Per-player gun sprite rotated by `aimAngle`, y-flipped when aiming left; crosshair sprite replaces the cursor in-arena (`crosshair.json` atlas).
- Bullets: sprite per schema entity, dead-reckoned at 60fps from `x/y/vx/vy` (linear motion — extrapolation is exact), corrected on patch, removed on schema remove (wall/hit/lifetime).
- Zombies: `RemoteInterpolation` reuse (per-zombie buffer), `flipX = vx > 0`, walk anim loop; on remove → client-local corpse playing the death anim, destroyed after 4s.
- HUD ports (legacy layouts): 10 hearts top-left (3 frames: empty/half/full, clean `hp/10` mapping — not legacy's quirky modulo), ammo box top-right with 3× gun sprite + `ammo/clip` text (∞ for -1), medal rank top-center (frame = rank by gun level), 30-frame reload bar center (drives the active-reload UI), kill-feed text block right side (EVT_LOG, 3s TTL), win banner on `phase="ended"`.
- Sounds (assets list below): own shot `heavyPistol` + camera shake (0.005, 40); remote shots from `EVT_SHOT` linearly attenuated 30→600px (`gun.js:131-139`); `pistolReload` / `reloadSuccess` / `reloadFail`; `playerHurt` on own hp drop; `levelUp`; `gameWin`; zombie groan client-side proximity (30→150px falloff −0.2, 5s throttle) + `zombieHit.wav` on zombie attack (legacy loaded it never / played it broken — wire it properly).
- Chat (4B): TAB toggles a React overlay; while open, game input is suppressed **and velocity zeroes** (legacy slid at pre-chat velocity — bug, not ported); send via `MSG_CHAT`.
- Vision cone (4B, last, cuttable): client-only port of the Lighting cone — 90° toward pointer, ~270px, raycast against the wall grid, remote players/zombies (and labels) in a masked container under a 0.7-alpha darkness overlay. Phaser 3 implementation: geometry mask from a per-frame cone polygon (raycast the solidity grid, ~60 rays). Purely cosmetic: a modified client could see everything — accepted at prototype tier.

### Asset copies (verbatim, `legacy/client/assets/` → `client/public/assets/`)

From the recon's verified load-list (dead atlases excluded): `zombieSprite.png + zombieSheet.json` (note: its `meta.image` says `zombie.png` — harmless with explicit URLs), `finalGunSheet.png/.json`, `crosshair.png/.json`, `medals.png/.json`, `reloadBar.png/.json`, `heart.png`, `speed.png`, `ui/hearts.png`, `ui/gunContainer.png`; sounds: `heavyPistol.wav`, `pistolReload.mp3`, `reloadSuccess.wav`, `reloadFail.wav`, `zombie.wav`, `zombieHit.wav`, `playerHurt.wav`, `levelUp.wav`, `gameWin.wav`, `themeLoop.wav`. Do **not** copy: `updatedGunSheet`, `finalSheet`, `gunAndBulletTest` (dead experiments), `shoot.ogg` (never played), `lightPistolShot.wav` (file doesn't exist). Legacy anims use numeric frame indices = JSON hash order; port to named frames using the recon's documented orderings.

## Slice contents

**4A — PvP gun-game (deployable: a complete playable PvP arena)**
1. Colyseus client/server version alignment
2. Tuning tables + deviations into `shared/src/tuning.ts`
3. Schema: Player combat fields + Bullet map + `"ended"` phase; client mirror; React sync filter
4. `stepPlayer` sim-state refactor + roll FSM + prediction/reconciliation threading + parity test
5. `MSG_INPUT` extension (roll, aimAngle) + validation
6. Fire/reload/active-reload commands + server gates
7. Bullet stepping, bullet grid, hit resolution, damage/death/respawn/immunity
8. Gun ladder + kill credit + win FSM + 10s banner→lobby reset
9. `EVT_SHOT`/`EVT_LOG` broadcasts + kill feed UI
10. Client: gun sprites, crosshair, bullets (dead reckoning), HUD (hearts/ammo/medal/reload bar), win banner, sounds
11. Assets for the above; E2E: shot lands → HP drops → kill feed line

**4B — world layer (deployable: the full game)**
1. Zombie schema + spawner + AI (nearest-target steering, attacks) + death/corpse + sounds
2. Pickups (server state, collection, effects, respawn) + feed lines
3. Chat (TAB overlay, relay, input gating)
4. Vision cone (client-only; cuttable if the Phaser 3 mask fights back)

## Testing

- **Vitest (server)**: gun table resolution (cumulative deltas → table above); bullet substep sweep vs bullet-grid + AABB hits (incl. sniper tunneling guard); roll FSM determinism — server step vs prediction step parity over scripted input sequences; fire gates (rate/ammo/reload/roll); active-reload window judgments; kill→upgrade→win FSM→lobby reset; zombie target selection + attack cadence; pickup effects + respawn slots.
- **E2E (Playwright, `workers: 1`)**: two clients join, A fires at stationary B → B's HP drops, feed shows the hit/slain line; zombie spawns and closes distance (4B). Keep specs few and fat — the lobby room is shared.
- **Evidence**: screenshots to `docs/stage4-evidence/` (dev + prod build + Docker, per Stage 3 convention).

## Done criteria

- 4A: two browsers on the deployed app can fight — aim, shoot, kill, upgrade through the ladder, win at 5 kills, see the banner, return to lobby. All gates green (typecheck, lint, vitest, E2E); dev + prod + Docker verified.
- 4B: zombies pressure players and die to bullets; pickups work; chat works; vision cone renders (or is consciously cut with a note here).

## Out of scope (explicit)

- Lag compensation / favor-the-shooter rewind (Stage 5 if playtest demands; at 4 players on one VM, lead-your-target is acceptable)
- Spectator mode (legacy camera-followed a remote player; our `onAuth` rejects mid-game joins)
- Player-player solidity (ghost-through — matches what legacy actually did; its collide call was broken)
- Server-enforced vision (cone is cosmetic; interest management is a redesign)
- Persistence, multi-room, teams

## Risks

1. **Roll/speed prediction threading** is the stage's hard kernel — mitigated by the parity unit test and by landing it as its own plan step before any combat consumes it.
2. **Bullet patch churn**: worst realistic case ~30 live bullets × 20 Hz is fine on a single VM, but the React sync filter must land with the schema (step 3) or the lobby UI re-renders 20×/s.
3. **Vision cone in Phaser 3** is the most uncertain port (mask perf, ray count) — scheduled last, explicitly cuttable.
4. **Active-reload timing over the wire**: the 300ms server-judged window can feel unfair at high RTT — accepted at prototype tier; revisit slack in Stage 5.
5. **Invented zombie/spawner numbers** may need live tuning — they're isolated in `tuning.ts` by design.
