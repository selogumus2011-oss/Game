# Nexus Island Royale: Cursed

A browser combat game built around cursed energy: reinforcement, reversal,
sure-hit barriers, and the one-in-a-thousand strike that distorts space.

It is a **combat game, not a shooter**. Everything is decided at melee range by
frame data, guard damage and timing windows. Techniques are tools that open or
close that range — they are never the whole fight.

It renders in 3D, cel-shaded with ink outlines, on a renderer written from
scratch for it.

No engine, no asset pipeline, no build step, and no third-party runtime code.
Pure ES modules, a canvas, and procedural WebAudio. Every character, curse,
prop, domain and sound is generated from code — including the 3D renderer,
which is a hand-written software rasteriser rather than a library.

```bash
npm start          # http://localhost:8080
npm test           # 29 headless simulation tests
node tools/browsertest.mjs   # scripted playthrough + screenshots (needs Playwright)
node tools/touchtest.mjs     # drives the game on an iPad viewport by touch alone
node tools/domainshots.mjs   # opens all 13 domains and screenshots each
node tools/charshots.mjs     # portrait of every sorcerer and curse model
node tools/techshots.mjs shrine   # every ability of a technique, three frames each
```

ES modules need a real HTTP origin, so open the served URL rather than the file.

---

## Controls

Keyboard and mouse, a gamepad, and touch all work at once — on an iPad with a
keyboard attached you can use either, in the same match, without a mode switch.

On a touch device the game draws its own controls: a movement stick that appears
wherever your left thumb lands, and a right half that aims where you touch and
attacks while you hold. Everything else is three arcs of buttons sweeping up
from the bottom-right corner, inside a thumb's reach of where a hand actually
holds a tablet — the four cursed techniques, then block / dash / jump / grab,
then Domain Expansion, Simple Domain, Amplification and Reverse Cursed
Technique. Buttons grey out when the action is not available. The page is pinned
against rubber-band scrolling and double-tap zoom, lays out inside the safe area,
and the renderer drops its backing-store resolution on large screens, because
every polygon here is filled on the CPU and an iPad's 2× store over a full-width
window is five and a half million pixels a frame.

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
| `G` | **First person** ↔ third person |
| `Tab` | Codex · `Esc` pause |

In first person the mouse looks rather than points: click once in the arena to
hand the cursor over, `Esc` to get it back. Your own body draws as arms, hands
and whatever you are holding, so the hand sign a technique raises is readable —
which is the point of it. Sensitivity is in Settings. It needs the 3D renderer.

On a tablet the right half of the screen aims and attacks, or looks around in
first person; the `VIEW` button switches between them.

Gamepads are supported (left stick move, right stick aim, face/shoulder buttons
mapped to the same actions).

---

## The mechanics

### Cursed energy

Everything costs it, and it is also your armour. **Reinforcement** passively
soaks up to 72% of incoming damage, scaling with how full your pool is and how
good your *cursed energy control* stat is. Running dry does not only lock your
techniques — it strips your defence. The live reinforcement percentage sits
under the energy bar, because it is the number that decides whether you survive
the next exchange.

Some damage ignores it entirely: soul strikes, the Split Soul Katana, Cleave,
and any domain sure-hit aimed at the soul. Against those, a full bar is worth
nothing.

### Black Flash

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

### Flow

Builds from perfect parries, Black Flashes, long combos and near-miss dodges;
decays if you disengage. At 22% you can expand a domain. It also widens the
Black Flash band, so playing well makes playing well easier.

### Domain Expansion

A barrier built from your innate technique. Inside it the technique becomes a
**sure hit**: it does not travel, is not aimed, cannot be dodged. It simply
happens, continuously, to everyone you designate.

Requires 22% Flow and near-full energy. The bar is deliberately low: the
interesting decision is *when* you open a domain and what the other player does
about it, not whether you ever get to. The chant is short enough to actually
land in a fight, and heavy guard damage during it still **interrupts** the
expansion — costing energy and locking domains for 10 seconds.

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
for 14 s; having one shattered costs 22 s plus a chunk of health.

### Reverse Cursed Technique

Hold `R` to multiply two cursed energies into positive energy and heal. It
drains fast, halves your movement, and below 0.45 control it can reverse the
wrong way and hurt you. It is also the only thing that closes wounds, clears
throat strain, cures soul wounds and burns off cursed energy burnout.

### Binding Vows

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

**23 cursed techniques**, each with a passive that changes a rule, four
abilities and (mostly) a domain:

| Technique | Passive | Domain |
| --- | --- | --- |
| Limitless | Infinity — attacks decelerate forever while you can pay | Unlimited Void |
| Ten Shadows | Shadow reservoir, persistent shikigami | Chimera Shadow Garden (incomplete) |
| Shrine | Malevolent presence — enemies lose poise near you | Malevolent Shrine (open barrier) |
| Idle Transfiguration | Soul perception — bypasses reinforcement | Self-Embodiment of Perfection |
| Disaster Flames | Volcanic body — fire immune, burns melee range | Coffin of the Iron Mountain |
| Blood Manipulation | Costs health; output rises as health falls | Flowing Red Sea |
| Heavenly Restriction | Zero cursed energy, inhuman body, invisible to sense | — |
| Cursed Speech | Throat strain; at maximum you are silenced | Cradle of Quiet Words |
| Ratio Technique | Cheapest costs in the game; Overtime at 90 s | — |
| Boogie Woogie | Rhythm stacks from swapping | — |
| Straw Doll | Every hit plants a Resonance fragment | — |
| Projection Sorcery | 24 frames — mistimed targets freeze for a second | — |
| Cursed Spirit Manipulation | Absorbs every curse you kill | Chamber of Unknown Depths |
| Deadly Sentencing | Evidence — stronger every time you are hit | Deadly Sentencing (confiscates techniques) |
| Divergent Fist | Every hit lands a second, delayed impact | — |
| Copy | Learns any technique that hits you | Authentic Mutual Love |
| Ice Formation | Frost aura slows and softens everything nearby | Frozen Sanctuary |
| Idle Death Gamble | Damage fills the reels; jackpot = unlimited reversal | Idle Death Gamble |
| Star Rage | Virtual mass stacks through a combo | — |
| Electric Discharge | Every hit arcs to a second target | — |
| Disaster Tides | A water wall halves incoming projectiles | Horizon of the Captivating Skandha |
| Construction | Self-rebuilding steel plating | — |
| Puppet Manipulation | Inverted Heavenly Restriction: huge reserve, fragile body | — |

**23 playable sorcerers**, each a different body around those techniques, with
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

## Presentation

### Looking like the show

The target is the later seasons rather than the early ones: crushed blacks, a
nearly colourless world, and the cursed energy as the only saturated thing in
frame. Three passes get there without a shader — the frame multiplied by itself
at partial strength (squaring is a real tone curve, and darks fall away while
brights barely move), a grey wash in `saturation` mode that additive energy is
bright enough to survive, and a cool multiply with a warm screen that puts the
two-tone back. Inside a domain both shift to that domain's key colour, so
standing in one looks like standing in one.

The shading under that is two-tone with a hard terminator, not a ramp: four flat bands with
the break between them placed where a painter would put it, and the shadow band
cooled and desaturated rather than simply dimmed — painted shadow reads as
shadow, dimness reads as a mistake. On top of that the ink line is measured in
*pixels*, not in model scale. A scaled inverted hull draws a line that thins out
with distance, so a fighter across the arena loses their outline while one in
your face wears a thick black border; each back-face triangle is offset outward
in screen space instead, edge by edge, so the line holds its weight at every
depth the way a drawn line does.

Then a bloom pass and a grade. There is no shader to threshold with, so the
frame is downsampled and squared twice — which crushes the darks to nothing and
leaves cursed energy almost intact — blurred, and added back. The grade cools
the whole picture and lifts the warm end, and inside a domain it shifts to that
domain's key colour, so standing in one *looks* like standing in one.

### The Domain Expansion cutscene

A domain expansion is the largest thing a sorcerer can do, and the show never
treats it as another move coming out. It stops, cuts to the caster, lets them
say the words, stamps the name, and only then closes the barrier. That sequence
plays here, over the live simulation:

1. **Seal** — black bars slam in, the shot *cuts* to a low tight angle on the
   caster from a side the camera was not already on, and the colour drains out
   of the world.
2. **Chant** — a slow creep around and up while the incantation types itself in
   under the caster's name.
3. **Call** — DOMAIN EXPANSION rides in from the left, the domain's own name stamps in
   from the right a beat later, the camera punches, everything whites out.
4. **Close** — the camera rockets back and up over the barrier as it unfolds,
   the bars slide out, and the rig gets the camera back over the last third
   rather than snapping.

The world runs at 42% speed for the duration, so it is cinematic in real time
and nearly free in game time — and the opponent cannot simply walk through your
chant. It aborts on the spot if the chant is interrupted, because a domain that
got punched out of someone is not a cinematic. Switchable under Settings.

### Cuts

Cleave, Dismantle and the World-Cutting Slash are not beams. A slash in this
show is a line that was already there, and the drawing gives you three stages:

1. **Flash** — a hairline the full length of the cut, white-hot, two frames.
2. **Hold** — nothing moves. This beat is what makes the cut land.
3. **Open** — the gap spreads, its edges light up, and darkness shows between
   them: the space the cut took out of the world.

Dismantle arrives as a lattice — strokes across the strike, stepped along it,
leaning alternately, crossed by a second set leaning the other way. Cleave is
one heavy measured stroke. They land on whatever the line actually connected
with rather than at the midpoint of its reach, and a Domain Expansion opens the
same way: a ring of cuts around the caster, the space opened before the barrier
appears inside it.

### Every technique lands differently

Every technique earns an impact frame when it connects, scaled by how much the
hit actually mattered — chip damage gets nothing, a finisher gets everything.
But an impact frame in a different colour is still the same impact frame, so
each technique also names an **archetype** that decides what the hit looks like
apart from the frame. Ten of them cover the roster:

| Archetype | Reads as | Used by |
| --- | --- | --- |
| `cut` | Strokes across the target; the air opens | Shrine, Heavenly Restriction, Projection |
| `collapse` | Rings closing inward, dust pulled in | Limitless, Blue, Maximum: Uzumaki |
| `burst` | A ring out, sparks, light | Red, Divergent Fist, Boogie Woogie |
| `crush` | Two ground rings, a dust plume, debris, almost no light | Ratio, Star Rage, Deadly Sentencing |
| `pierce` | One stroke through, spray out the far side | Blood Manipulation, Straw Doll, Construction |
| `scorch` | Embers rising, ground blackened | Disaster Flames |
| `frost` | Shards growing out of the hit, a slow ring | Ice Formation |
| `arc` | Short bright forks | Electric Discharge |
| `soul` | Rings inside the target, no debris at all | Idle Transfiguration, Copy |
| `surge` | Weight rather than shape | Disaster Tides |
| `beast` | Fanned claw strokes | Ten Shadows, Spirit Manipulation |

A handful of abilities differ from the rest of their technique — Blue and Red
are the same technique and opposite events, and Purple is neither — so they get
their own entries. Anything unmapped falls back to an archetype implied by its
shape, so a technique nobody wrote an entry for still lands as *something*.

`src/render/signatures.js` holds the table; `tools/sigshots.mjs` shoots every
archetype in a single colour, so two that differ only by hue are obvious.

### Hand signs

A sorcerer does not simply press a button: the hands go up first, and the shape
they make is the tell. A cast raises a sign during the windup, holds it, and
throws it away as the technique comes out. **A Domain Expansion always signs**,
whatever its data says — the sure-hit is the one thing here that is never
casual.

A hand is a palm and five fingers, each three phalanges that curl cumulatively
so a closed hand rolls into the palm rather than folding flat at one hinge. Six
shapes — open, fist, point, two, claw, pinch — and six signs pairing them with a
hold position and a finger direction. That direction matters: without it a hand
just follows the forearm, which for anything held in front of the chest aims it
straight at the viewer and hides the shape that is the whole reason the hand is
up.

They read best in first person, which is what they were built for.

### Air

Distance blends toward the arena's haze colour rather than darkening toward
black — darkening reads as the lights going out, blending reads as air. The sky
brightens all the way down to that same haze so the ground meets it rather than
stopping dead against it, with a wide low glow behind so silhouettes have
something to stand against. And there are cursed-energy motes drifting through
it, in world space so they sort and parallax properly; a domain tints the air it
encloses.

### The 3D renderer

The game renders in real 3D: a perspective camera, low-poly models posed from an
actual skeleton, hemispherical domain barriers you stand inside, and ink
outlines over hard cel bands.

It is all hand-written, in `src/r3d/`:

- **`core3.js`** — vectors, 4×4 matrices, the orbit-follow camera, quantised
  three-band cel shading with a colour cache, and a draw list that collects
  every polygon, sprite, line and label in the frame and sorts it once by view
  depth.
- **`geom3.js`** — the primitive builders (tapered boxes, cylinders, cones,
  spheres, prisms, rings, domes) and the rasteriser. Faces are culled by screen
  winding, then the view-space normal is recovered from the projected triangle
  so the lighting is real rather than faked per object. `drawOutline` re-draws a
  mesh scaled out with the front faces culled — the inverted-hull trick, which
  is what gives everything its ink line.
- **`pose3.js`** — the 3D skeleton: hips, chest, neck, head, shoulders, elbows,
  hands, knees and feet, driven by the same frame data the simulation uses, with
  spring chains for hair and coat tails.
- **`models3.js` / `actors3.js`** — procedural bodies. Heads are built per
  palette (skull, jaw, ears, eye plates, brows, nine hair styles, blindfold,
  markings, stitches); limbs are unit bones stretched onto the skeleton; every
  cursed tool has its own mesh. The curse roster has a builder per silhouette —
  blob, mouth, mantis, wraith, hulk, serpent, finger bearer, hanged, special
  grade, dog, toad, nue, Mahoraga, Rika, isomer, fish, puppet.
- **`arena3.js`** — floors baked as chunked tile blocks with the grout part of
  the geometry, so nothing is ever coplanar and a painter's sort can never
  flicker; props modelled per type; the veil as a real curtain of falling
  panels.
- **`fx3.js` / `props3.js`** — every effect as geometry: slash crescents that
  taper to points, beams as cylinders with muzzle flares, shockwaves as rings,
  cursed-energy orbs as cored spheres, lightning as projected polylines.
- **`domains3.js`** — the barriers and their interiors (see below).

Why write a renderer instead of using one: the whole project ships with no build
step and no dependencies, and flat-shaded polygons with inverted-hull outlines
are exactly the look this game wants. There is nothing a general-purpose engine
would add here except a bundler.

Performance is adaptive. Fighters and props drop through levels of detail with
distance — a curse forty metres out loses its outline, its hands, its staring
eyes and its detailed head — and the quality tier steps the whole scene down if
the frame rate falls. The classic 2.5D renderer is still there and selectable
under Settings → 3D renderer; it runs the same simulation, the same frame data
and the same HUD.

### Direction

The look leans on the source material's own grammar rather than generic game
feedback:

- **The veil** falls over the arena before every fight.
- **Opening name cards** introduce a duel, with both techniques named in kana.
- **Domain Expansion cut-ins** — diagonal panels wipe in, the technique lands in
  calligraphy, and the caster's chant sits underneath it. Every domain has one.
- **Technique call-outs**: every ability names itself in kana as it comes out,
  and ultimates get a bigger stamp and a camera punch.
- **Cast telegraphs**: a shrinking ring and a progress arc over any fighter
  charging a technique, so there is a readable window to interrupt them.
- **The gather**: a technique being cast forms a visible orb in the working
  hand, loose and wide at first and compressing to a dense point as the cast
  finishes, with energy falling into it from every side and rings closing on it.
  It takes the colour of the specific ability rather than the technique — Blue,
  Red and Purple are one technique and three colours.
- **Impact frames**: radial manga speed lines and a colour wash. They converge
  on the actual point of impact in the world rather than the middle of the
  screen, and they fire for cursed techniques too — scaled by how much of the
  target's health the hit really took, so chip damage gets nothing and a clean
  technique landing gets the full panel. Past a threshold the frame adds ragged
  white gashes across the whole view. Black Flash, guard breaks, perfect
  parries, ultimates coming out and domain openings all have their own.
- **Black Flash** gets a cut-in of its own, built on the opposite principles to
  the domain cutscene: no letterbox creeping in, no chant, no orbit. The frame
  stops dead on contact, space cracks black and red out of the point of impact,
  BLACK FLASH slams in slightly oversized and settles, and half a second later
  the camera eases back to the follow rig. It only takes the shot for your own
  flash — one landing on you gets the frames and the shake, not the camera — and
  a domain expansion always outranks it. Underneath: two stacked impact frames,
  red then black, and four strokes crossing the punch.

Animation is a pose system rather than a single swing value. Each attack is
driven by the body mechanic it actually uses — jab, cross, spin, rising kick,
overhead, slam, palm, grab, claw — with anticipation, follow-through and a
counter-balancing back arm. On top of that:

- Hair, scarves and coat tails run on spring chains that lag behind the body.
- Squash and stretch on takeoff and landing, with dust on the contact frames.
- Hit recoil shoves and tilts the body away from whatever just landed.
- Weapon trails sample the blade tip and draw a tapered ribbon along the arc.
- Casting and reverse cursed technique have their own poses, with cursed energy
  gathering visibly in the working palm.

### Domains, in detail

A domain is the biggest thing that happens in a fight, so it is staged rather
than faded in:

1. **Chant** — cursed energy spirals inward, a seal draws itself on the ground.
2. **Slam** — a blinding core, then a ground ring racing outward ahead of the
   barrier, tearing debris up as it goes.
3. **Unfold** — the walls rise as ribs that knit into a surface, with latitude
   rings closing over the top.
4. **Reveal** — the interior treatment wipes outward from the caster behind a
   glowing edge.
5. **Held** — the per-domain interior, plus live state: the barrier brightens on
   every sure-hit tick, **cracks appear exactly where it was struck** and heal
   shut slowly, and a **clash seam** bows toward whoever is losing a contest
   between two barriers.
6. **Collapse** — a shatter throws panels off the whole hemisphere and then
   implodes; a clean expiry drains the interior back into the caster.

In 3D the barrier is real geometry you are standing inside, not a shape drawn
over the arena. The floor replaces the arena's — tiles, scuffs and blood scars
inside the radius are skipped rather than layered under it — and the shell's
brightness ramps out toward the ground so its rim never cuts a hard line across
the frame. Anything the domain builds as a landmark is set back from the middle,
because the caster spawns at the centre of their own domain and a structure that
size would otherwise swallow them.

Each of the thirteen gets its own floor, interior and shell treatment:

- **Unlimited Void** — a lattice of light columns rising out of the floor on a
  golden-angle spiral, information rings rushing inward, and a pale orb overhead
  ringed by three orbiting bands.
- **Malevolent Shrine** — an open barrier: no walls at all. A bone shrine with a
  toothed maw and curving rib arches stands under its own torii, furnace light
  in its mouth, bone piles scattered around, and the dismantle storm raking the
  floor in slashes.
- **Chimera Shadow Garden** — oily swells across the surface, shikigami
  silhouettes surfacing and sinking with lit eyes, and hands reaching up out of
  the shadow.
- **Self-Embodiment of Perfection** — half-finished idols standing in a ring,
  bobbing gently, with loose souls drifting through the volume above them.
- **Coffin of the Iron Mountain** — you are inside the volcano, not looking at
  one: a caldera wall of leaning rock slabs around the rim, lava fountains
  climbing out of the floor, a heat column over the centre, ash coming down.
- **Frozen Sanctuary** — ice shards growing out of the ground as the domain
  settles, fangs dropping from the barrier, a cold haze over the whole floor.
- **Idle Death Gamble** — a pachinko parlour. Cabinets in a ring with neon
  banding, three drums on a shared axle in the middle, and on a pay-out the
  reels lock to 7-7-7 and the whole space fills with steel balls.
- **Authentic Mutual Love** — ribbons of hair sweeping through the volume, her
  eyes set into the shell watching you, and the maw overhead biting on every
  sure-hit tick.
- **Horizon of the Captivating Skandha** — a whirlpool of counter-rotating
  rings, standing water columns sweeping the floor, spray where the water meets
  the barrier.
- **Deadly Sentencing** — an actual courtroom: the judge's bench with its seal
  on the far side, gallery pews facing it, the verdict light falling from
  overhead, and a gavel that drops on every tick of the sentence.
- **Flowing Red Sea** — swell rings on the surface and blood columns rising and
  falling like a fountain that never lands.
- **Cradle of Quiet Words** — stone tablets hanging in the air, each carrying a
  command in kanji, turning slowly.
- **Chamber of Unknown Depths** — a hive column and five orbiting bands of
  insects filling the air.

Sure-hit is drawn explicitly — a tether runs from the dome to everyone the
domain has designated, and turns into a dashed line with a guard ring when
Simple Domain neutralises it. The HUD shows the barrier's integrity (your way
out), time remaining, and a centre-out tug-of-war bar during a clash.

## Architecture

```
src/
  core/     math, seeded RNG, input (buffered, gamepad), fixed-step loop,
            procedural WebAudio
  data/     techniques, characters, curses, cursed tools, binding vows,
            arenas, melee frame data
  sim/      fighter state machine, damage pipeline, Black Flash, domains,
            projectiles, hazard zones, statuses, utility AI, world
  r3d/      the 3D renderer: math and camera, mesh primitives and rasteriser,
            3D skeleton, procedural models, arena, effects, domains, scene
  render/   2.5D renderer, effects pool, HUD, cached glow sprites
  ui/       DOM menus and the codex
tools/      static server, headless test suite, browser playthrough,
            domain gallery, cast gallery
```

The simulation is **DOM-free and deterministic**. It never touches the canvas;
it emits queues of events that the presentation layer drains. That is what makes
`npm test` possible: 29 tests run thousands of frames of real fights in node and
assert that Infinity negates hits and drains energy, that the Black Flash band
behaves, that Simple Domain cuts sure-hit damage, that a shattered domain
backfires, that the Abstinence vow really does forbid healing, and that the same
seed replays the same fight exactly.

Rendering steps itself down automatically on slow hardware. Glow sprites are
baked per colour, the vignette and grain are cached, particle density and
weather drop out below 46 fps, and in 3D the outlines, the floor resolution, the
barrier's second skin and every model's level of detail all come off with it.

---

## Notes

Fan work, made for the love of the source material's mechanics. All technique
names and terminology belong to their creator; the code, art and balance here
are original.
