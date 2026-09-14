# Nexus Island Royale: Cursed — 呪術戦

A browser combat game built around cursed energy: reinforcement, reversal,
sure-hit barriers, and the one-in-a-thousand strike that distorts space.

It is a **combat game, not a shooter**. Everything is decided at melee range by
frame data, guard damage and timing windows. Techniques are tools that open or
close that range — they are never the whole fight.

No engine, no asset pipeline, no build step. Pure ES modules, a 2D canvas, and
procedural WebAudio. Every character, curse, prop and sound is generated from
code.

```bash
npm start          # http://localhost:8080
npm test           # 29 headless simulation tests
node tools/browsertest.mjs   # scripted playthrough + screenshots (needs Playwright)
```

ES modules need a real HTTP origin, so open the served URL rather than the file.

---

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| Mouse | Aim |
| `LMB` | Light attack — a 4-hit chain. **Hold** for a charged heavy that breaks guard |
| `RMB` | Hold to block · **tap to parry** (190 ms window) |
| `Shift` | Dash — i-frames, cancels attack recovery, costs cursed energy |
| `Space` | Jump — unlocks the air chain and the spike finisher |
| `F` | Grab — unblockable, beats block, loses to attacks |
| `1` – `4` | Cursed technique I–IV |
| `E` | **Simple Domain** (hold) |
| `Z` | **Domain Amplification** |
| `R` | **Reverse Cursed Technique** (hold) |
| `X` | **Domain Expansion** (hold during a clash to push) |
| `V` | Declare an impromptu **binding vow** |
| `C` | Swap cursed tool |
| `T` | Lock-on |
| `Tab` | Codex · `Esc` pause |

Gamepads are supported (left stick move, right stick aim, face/shoulder buttons
mapped to the same actions).

---

## The mechanics

### Cursed energy — 呪力

Everything costs it, and it is also your armour. **Reinforcement** passively
soaks up to 72% of incoming damage, scaling with how full your pool is and how
good your *cursed energy control* stat is. Running dry does not only lock your
techniques — it strips your defence. The live reinforcement percentage sits
under the energy bar, because it is the number that decides whether you survive
the next exchange.

Some damage ignores it entirely: soul strikes, the Split Soul Katana, Cleave,
and any domain sure-hit aimed at the soul. Against those, a full bar is worth
nothing.

### Black Flash — 黒閃

Cursed energy landing within a hair's breadth of the physical impact distorts
space and multiplies the hit by **2.5×**. Here it is a timing band on the ring
above your head:

1. Landing any physical hit opens the window and starts the ring.
2. A red band lights up partway through the sweep.
3. Land your **next** hit inside that band.

Success gives 2.5× damage, +30 cursed energy, a Flow surge, a 12-second Flow
State, and increments the chain counter — each link adds 16% more damage on top.
A miss narrows the band until you land one, so fishing is never free.

A **perfect parry** opens the window much wider. Parry → strike is the intended
route into a flash, and into a chain.

Band width scales with cursed energy control, Flow, bare hands, and the Empty
Hands binding vow. There is an accessibility slider that widens it further.

### Parry, block, poise

A perfect parry takes zero damage, staggers the attacker, refunds energy and
Flow, and opens the flash window. Holding block trades chip damage for guard
damage instead. Every hit does poise damage; at zero poise you stagger for
almost a second and take 30% extra — which is how heavy tools like Playful Cloud
and Dragon-Bone win fights they lose on paper.

### Flow — 領域感覚

Builds from perfect parries, Black Flashes, long combos and near-miss dodges;
decays if you disengage. At 50% you can expand a domain. It also widens the
Black Flash band, so playing well makes playing well easier.

### Domain Expansion — 領域展開

A barrier built from your innate technique. Inside it the technique becomes a
**sure hit**: it does not travel, is not aimed, cannot be dodged. It simply
happens, continuously, to everyone you designate.

Requires 50% Flow and near-full energy. The chant takes over a second, and heavy
guard damage during it **interrupts** the expansion — costing energy and locking
domains for 20 seconds.

The counterplay ladder, cheapest first:

1. **Simple Domain** — a 2.21 m circle that neutralises the sure-hit while you
   stand in it and auto-counters anything crossing the line. Drains energy fast
   and slows you to a walk.
2. **Domain Amplification** — barrier wrapped over your body. Technique effects
   fizzle on contact for 2.8 s, and your attacks pierce Infinity.
3. **Falling Blossom Emotion** — a mastered Simple Domain repels the enemy
   barrier on contact, shredding its integrity. Heavenly Restriction has it by
   default.
4. **Your own domain** — a clash. Refinement, output, Flow and energy decide it;
   the loser's barrier shatters and backfires on them.
5. **Break the barrier** — everything you land inside costs the domain integrity.
6. **Kill the caster** — they are draining and cannot regenerate the whole time.

Malevolent Shrine trades the barrier away by binding vow: no walls, a 17 m
radius, and the slash storm cuts allies — and the caster — too.

Holding a domain drains you and stops regeneration. Closing one locks the next
for 30 s; having one shattered costs 45 s plus a chunk of health.

### Reverse Cursed Technique — 反転術式

Hold `R` to multiply two cursed energies into positive energy and heal. It
drains fast, halves your movement, and below 0.45 control it can reverse the
wrong way and hurt you. It is also the only thing that closes wounds, clears
throat strain, cures soul wounds and burns off cursed energy burnout.

### Binding Vows — 束縛

Give up something certain, get power back. Ten pre-match vows costing vow
points, and five impromptu vows you can swear mid-fight with `V` at an immediate
price. Break the terms and the backlash is worse than anything the opponent can
do: 30% of your maximum health, energy zeroed, technique sealed — and the
deadline vow simply kills you when the clock runs out.

### Wounds, wall slams, destruction

Heavy damage injures arms (less output) or legs (less speed); only RCT closes
them. Knock someone into a pillar at speed and both take damage — Dragon-Bone
doubles it. Most cover breaks permanently, so the arena you finish in never
looks like the one you started in.

---

## Content

**14 cursed techniques**, each with a passive that changes a rule, four
abilities and (mostly) a domain:

| Technique | Passive | Domain |
| --- | --- | --- |
| Limitless 無下限呪術 | Infinity — attacks decelerate forever while you can pay | Unlimited Void |
| Ten Shadows 十種影法術 | Shadow reservoir, persistent shikigami | Chimera Shadow Garden (incomplete) |
| Shrine 御廚子 | Malevolent presence — enemies lose poise near you | Malevolent Shrine (open barrier) |
| Idle Transfiguration 無為転変 | Soul perception — bypasses reinforcement | Self-Embodiment of Perfection |
| Disaster Flames 灰燼爆 | Volcanic body — fire immune, burns melee range | Coffin of the Iron Mountain |
| Blood Manipulation 赤血操術 | Costs health; output rises as health falls | Flowing Red Sea |
| Heavenly Restriction 天与呪縛 | Zero cursed energy, inhuman body, invisible to sense | — |
| Cursed Speech 呪言 | Throat strain; at maximum you are silenced | Cradle of Quiet Words |
| Ratio Technique 十劃呪法 | Cheapest costs in the game; Overtime at 90 s | — |
| Boogie Woogie ブギウギ | Rhythm stacks from swapping | — |
| Straw Doll 芻霊呪法 | Every hit plants a Resonance fragment | — |
| Projection Sorcery 投射呪法 | 24 frames — mistimed targets freeze for a second | — |
| Cursed Spirit Manipulation 呪霊操術 | Absorbs every curse you kill | Chamber of Unknown Depths |
| Deadly Sentencing 誅伏賜死 | Evidence — stronger every time you are hit | Deadly Sentencing (confiscates techniques) |

**14 playable sorcerers**, each a different body around those techniques, with
their own stat spread, silhouette and starting tool.

**10 cursed tools** that rewrite your physical layer — Playful Cloud's guard
damage, the Inverted Spear of Heaven's technique nullification, the Split Soul
Katana ignoring reinforcement, the Chain of a Thousand Miles rooting and
dragging.

**Cursed spirits** from Grade 4 fodder to special grades that expand their own
domains, plus shikigami, transfigured humans and Mahoraga — which adapts to
every phenomenon that touches it, including yours.

**Four modes**

- **Gauntlet** — 14 escalating waves ending with a special grade and Mahoraga.
- **Duel** — one sorcerer, full kits on both sides.
- **Culling Game** — seven rival sorcerers, a shrinking veil, cursed tools on
  the ground, points for kills.
- **Training Void** — a dummy and a sparring partner, to learn the band.

**Five arenas** with their own palettes, floor treatments, weather, props and
lighting.

---

## Architecture

```
src/
  core/     math, seeded RNG, input (buffered, gamepad), fixed-step loop,
            procedural WebAudio
  data/     techniques, characters, curses, cursed tools, binding vows,
            arenas, melee frame data
  sim/      fighter state machine, damage pipeline, Black Flash, domains,
            projectiles, hazard zones, statuses, utility AI, world
  render/   camera, procedural characters, effects, domain visuals, HUD,
            cached glow sprites
  ui/       DOM menus and the codex
tools/      static server, headless test suite, browser playthrough
```

The simulation is **DOM-free and deterministic**. It never touches the canvas;
it emits queues of events that the presentation layer drains. That is what makes
`npm test` possible: 29 tests run thousands of frames of real fights in node and
assert that Infinity negates hits and drains energy, that the Black Flash band
behaves, that Simple Domain cuts sure-hit damage, that a shattered domain
backfires, that the Abstinence vow really does forbid healing, and that the same
seed replays the same fight exactly.

Rendering steps itself down automatically on slow hardware: glow sprites are
baked per colour, the vignette and grain are cached, and particle density plus
weather drop out below 46 fps.

---

## Notes

Fan work, made for the love of the source material's mechanics. All technique
names and terminology belong to their creator; the code, art and balance here
are original.
