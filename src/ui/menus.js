// DOM menus: title, character select, loadout (tools + binding vows), arena
// select, codex, pause, settings and the in-match impromptu vow picker.

import { CHARACTERS, ROSTER, GRADE_LABEL } from '../data/characters.js';
import { TECHNIQUES } from '../data/techniques.js';
import { TOOLS, TOOL_LIST } from '../data/tools.js';
import { VOWS, VOW_LIST, MAX_VOW_POINTS, IMPROMPTU_VOWS } from '../data/vows.js';
import { ARENAS, ARENA_LIST } from '../data/arenas.js';
import { CURSES } from '../data/curses.js';
import { FLASH } from '../sim/combat.js';

const MODES = [
  {
    id: 'gauntlet', name: 'Gauntlet',
    desc: 'Fourteen escalating waves of cursed spirits, ending with a special grade and the shikigami nobody has tamed.',
    arena: 'shibuya',
  },
  {
    id: 'duel', name: 'Duel',
    desc: 'One sorcerer, one arena, full kits on both sides. The purest test of parry timing and Black Flash.',
    arena: 'jujutsuHigh',
  },
  {
    id: 'culling', name: 'Culling Game',
    desc: 'Nine other players, a shrinking veil, cursed tools on the ground and points for every kill.',
    arena: 'cullingIsland',
  },
  {
    id: 'training', name: 'Training Void',
    desc: 'A dummy that does not fight back. Learn the Black Flash band, parry timing and domain counterplay.',
    arena: 'void',
  },
];

export class UI {
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;   // { onStart, onResume, onQuit, onSettings }
    this.screen = null;
    this.selection = {
      mode: 'gauntlet',
      character: 'kingOfCurses',
      tool: null,
      vows: [],
      arena: 'shibuya',
      difficulty: 1,
    };
    this.settings = {
      masterVolume: 0.7, sfxVolume: 0.9, musicVolume: 0.3,
      particles: 1, grain: true, shake: 1, assist: 0, aimAssist: 0.7, showNames: true,
      firstPerson: false, lookSensitivity: 1,
      render3d: true, cutscenes: true,
    };
  }

  // -------------------------------------------------------------------------

  show(html, cls = '') {
    this.root.innerHTML = `<div class="screen ${cls}">${html}</div>`;
    this.root.classList.remove('hidden');
    this.root.querySelectorAll('[data-sound]').forEach((el) => {
      el.addEventListener('mouseenter', () => this.hooks.onHover && this.hooks.onHover());
    });
  }

  hide() {
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
    this.screen = null;
  }

  $(sel) { return this.root.querySelector(sel); }
  $$(sel) { return Array.from(this.root.querySelectorAll(sel)); }

  // -------------------------------------------------------------------------
  // Title
  // -------------------------------------------------------------------------

  showTitle() {
    this.screen = 'title';
    this.show(`
      <div class="title-wrap">
        <div class="title-mark">JJ</div>
        <h1 class="title">NEXUS ISLAND ROYALE</h1>
        <h2 class="subtitle">CURSED</h2>
        <p class="tagline">A cursed energy combat game. Reinforcement, reversal, sure-hit barriers,
        and the one-in-a-thousand strike that distorts space.</p>
        <div class="menu-list">
          <button class="menu-btn primary" data-act="play" data-sound>
            <span class="en">Start a Fight</span>
          </button>
          <button class="menu-btn" data-act="codex" data-sound>
            <span class="en">Codex — techniques &amp; mechanics</span>
          </button>
          <button class="menu-btn" data-act="settings" data-sound>
            <span class="en">Settings</span>
          </button>
        </div>
        <div class="hint">Best with sound on. Mouse + keyboard or a gamepad.</div>
      </div>
    `, 'title-screen');

    this.$('[data-act="play"]').onclick = () => this.showModeSelect();
    this.$('[data-act="codex"]').onclick = () => this.showCodex();
    this.$('[data-act="settings"]').onclick = () => this.showSettings(() => this.showTitle());
  }

  // -------------------------------------------------------------------------
  // Mode
  // -------------------------------------------------------------------------

  showModeSelect() {
    this.screen = 'mode';
    const cards = MODES.map((m) => `
      <button class="card mode-card ${this.selection.mode === m.id ? 'sel' : ''}" data-mode="${m.id}" data-sound>
        <div class="card-name">${m.name}</div>
        <div class="card-desc">${m.desc}</div>
      </button>`).join('');
    this.show(`
      <div class="panel">
        <div class="panel-head">
          <button class="back" data-act="back">&lsaquo; Back</button>
          <h2>Choose a mission</h2>
        </div>
        <div class="card-grid modes">${cards}</div>
        <div class="row difficulty-row">
          <label>Difficulty</label>
          <div class="seg" data-group="difficulty">
            ${[['0.8', 'Grade 3'], ['1', 'Grade 1'], ['1.35', 'Special Grade'], ['1.8', 'Hollow']]
              .map(([v, n]) => `<button data-val="${v}" class="${Number(v) === this.selection.difficulty ? 'sel' : ''}">${n}</button>`).join('')}
          </div>
        </div>
        <button class="menu-btn primary wide" data-act="next">Choose your sorcerer &rsaquo;</button>
      </div>
    `);
    this.$$('[data-mode]').forEach((b) => {
      b.onclick = () => {
        this.selection.mode = b.dataset.mode;
        this.selection.arena = MODES.find((m) => m.id === b.dataset.mode).arena;
        this.$$('[data-mode]').forEach((x) => x.classList.toggle('sel', x === b));
      };
    });
    this.$$('[data-group="difficulty"] button').forEach((b) => {
      b.onclick = () => {
        this.selection.difficulty = Number(b.dataset.val);
        this.$$('[data-group="difficulty"] button').forEach((x) => x.classList.toggle('sel', x === b));
      };
    });
    this.$('[data-act="back"]').onclick = () => this.showTitle();
    this.$('[data-act="next"]').onclick = () => this.showCharacterSelect();
  }

  // -------------------------------------------------------------------------
  // Character
  // -------------------------------------------------------------------------

  showCharacterSelect() {
    this.screen = 'character';
    const list = ROSTER.map((id) => {
      const c = CHARACTERS[id];
      const t = TECHNIQUES[c.technique];
      return `<button class="roster-item ${this.selection.character === id ? 'sel' : ''}" data-char="${id}" data-sound>
        <span class="dot" style="background:${t.color}"></span>
        <span class="rbody">
          <span class="rtop"><span class="rn">${c.name}</span><span class="rg">${GRADE_LABEL[c.grade] || c.grade}</span></span>
          <span class="rt">${t.name}</span>
        </span>
      </button>`;
    }).join('');

    this.show(`
      <div class="panel wide-panel">
        <div class="panel-head">
          <button class="back" data-act="back">&lsaquo; Back</button>
          <h2>Choose your sorcerer</h2>
        </div>
        <div class="char-layout">
          <div class="roster">${list}</div>
          <div class="char-detail" id="charDetail"></div>
        </div>
        <button class="menu-btn primary wide" data-act="next">Binding vows &amp; cursed tool &rsaquo;</button>
      </div>
    `);

    const render = () => {
      const id = this.selection.character;
      const c = CHARACTERS[id];
      const t = TECHNIQUES[c.technique];
      const abilities = t.abilities.map((a, i) => `
        <div class="ab">
          <div class="ab-key">${i + 1}</div>
          <div class="ab-body">
            <div class="ab-name">${a.name}
              ${a.ultimate ? '<span class="tag max">MAX</span>' : ''}</div>
            <div class="ab-desc">${a.desc}</div>
            <div class="ab-meta">${a.cost} CE${a.hpCost ? ` · ${a.hpCost} HP` : ''}${a.throat ? ` · ${a.throat} throat` : ''} · ${a.cooldown}s cooldown</div>
          </div>
        </div>`).join('');

      const domain = t.domain ? `
        <div class="domain-block" style="border-color:${t.domain.color}55">
          <div class="dom-name">${t.domain.name}</div>
          <div class="dom-desc">${t.domain.desc}</div>
          <div class="dom-meta">${t.domain.blurb}</div>
          <div class="dom-meta dim">Radius ${t.domain.radius}m · ${t.domain.duration}s · ${t.domain.cost} CE · barrier ${t.domain.integrity}</div>
        </div>` : `
        <div class="domain-block none">
          <div class="dom-name">No Domain Expansion</div>
          <div class="dom-desc">${t.blurbNoDomain || ''}</div>
        </div>`;

      this.$('#charDetail').innerHTML = `
        <div class="cd-head">
          <div>
            <div class="cd-name">${c.name}</div>
            <div class="cd-title">${c.title} · ${GRADE_LABEL[c.grade] || c.grade}</div>
          </div>
          <div class="cd-tech" style="color:${t.color}">${t.name}</div>
        </div>
        <div class="cd-quote">${c.quote}</div>
        <div class="cd-desc">${c.desc}</div>
        <div class="stat-grid">
          ${statBar('Health', c.maxHp / 350)}
          ${statBar('Cursed Energy', c.maxCe / 160)}
          ${statBar('CE Control', c.ceControl)}
          ${statBar('Speed', (c.speed - 0.8) / 0.6)}
          ${statBar('Power', (c.power - 0.8) / 0.8)}
          ${statBar('Poise', c.poise / 170)}
          ${statBar('Reverse CT', c.rct)}
          ${statBar('Domain', c.domainSkill / 1.3)}
        </div>
        <div class="passive">
          <div class="p-title">Passive — ${t.passive.name}</div>
          <div class="p-desc">${t.passive.desc}</div>
        </div>
        <div class="traits">${c.traits.map((x) => `<span class="trait">${x}</span>`).join('')}</div>
        <div class="ab-list">${abilities}</div>
        ${domain}
      `;
    };

    this.$$('[data-char]').forEach((b) => {
      b.onclick = () => {
        this.selection.character = b.dataset.char;
        this.selection.tool = null;
        this.$$('[data-char]').forEach((x) => x.classList.toggle('sel', x === b));
        render();
      };
    });
    render();
    this.$('[data-act="back"]').onclick = () => this.showModeSelect();
    this.$('[data-act="next"]').onclick = () => this.showLoadout();
  }

  // -------------------------------------------------------------------------
  // Loadout: tools + binding vows
  // -------------------------------------------------------------------------

  showLoadout() {
    this.screen = 'loadout';
    const c = CHARACTERS[this.selection.character];
    const t = TECHNIQUES[c.technique];
    if (!this.selection.tool) this.selection.tool = c.tool;

    const tools = TOOL_LIST.map((id) => {
      const tool = TOOLS[id];
      return `<button class="card tool-card ${this.selection.tool === id ? 'sel' : ''}" data-tool="${id}" data-sound>
        <div class="card-name">${tool.name}</div>
        <div class="card-desc">${tool.desc}</div>
        <div class="tool-stats">
          <span>WEIGHT ${tool.weight.toFixed(2)}</span>
          <span>POWER ${tool.power.toFixed(2)}</span>
          <span>REACH ${tool.reach.toFixed(2)}</span>
        </div>
        ${tool.special ? `<div class="tool-special">${tool.special}</div>` : ''}
      </button>`;
    }).join('');

    const vows = VOW_LIST.map((v) => `
      <button class="card vow-card ${this.selection.vows.includes(v.id) ? 'sel' : ''}" data-vow="${v.id}" data-sound>
        <div class="vow-head"><span class="vow-cost">${v.cost}</span></div>
        <div class="card-name">${v.name}</div>
        <div class="vow-terms"><b>You give up:</b> ${v.terms}</div>
        <div class="vow-gain"><b>You gain:</b> ${v.gain}</div>
        ${v.penalty ? `<div class="vow-pen"><b>If broken:</b> ${v.penalty}</div>` : ''}
      </button>`).join('');

    this.show(`
      <div class="panel wide-panel">
        <div class="panel-head">
          <button class="back" data-act="back">&lsaquo; Back</button>
          <h2>Binding vows &amp; cursed tool</h2>
          <div class="points">Vow points <b id="vowPoints">0</b> / ${MAX_VOW_POINTS}</div>
        </div>
        <p class="section-note">A binding vow is a contract with yourself: give up something real and
        cursed energy pays you back. Break the terms mid-fight and the backlash is worse than anything
        the enemy can do to you.</p>
        <div class="card-grid vows">${vows}</div>
        <h3 class="sec">Cursed tool</h3>
        <p class="section-note">The tool rewrites your physical moveset — swing weight, reach, guard damage,
        and in a few cases a rule of the game. ${t.id === 'heavenlyRestriction' ? 'Heavenly Restriction carries an entire belt and swaps with C.' : 'Swap in-match with C.'}</p>
        <div class="card-grid tools">${tools}</div>
        <div class="arena-row">
          <h3 class="sec">Arena</h3>
          <div class="seg arenas">
            ${ARENA_LIST.map((a) => `<button data-arena="${a}" class="${this.selection.arena === a ? 'sel' : ''}">${ARENAS[a].name}</button>`).join('')}
          </div>
        </div>
        <button class="menu-btn primary wide" data-act="fight"><span class="en">Begin</span></button>
      </div>
    `);

    const updatePoints = () => {
      const used = this.selection.vows.reduce((n, id) => n + VOWS[id].cost, 0);
      this.$('#vowPoints').textContent = String(used);
      this.$('#vowPoints').style.color = used > MAX_VOW_POINTS ? '#ff4d4d' : '#ffd166';
    };

    this.$$('[data-vow]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.vow;
        const i = this.selection.vows.indexOf(id);
        if (i >= 0) this.selection.vows.splice(i, 1);
        else {
          const used = this.selection.vows.reduce((n, v) => n + VOWS[v].cost, 0);
          if (used + VOWS[id].cost > MAX_VOW_POINTS) return;
          this.selection.vows.push(id);
        }
        b.classList.toggle('sel', this.selection.vows.includes(id));
        updatePoints();
      };
    });
    updatePoints();

    this.$$('[data-tool]').forEach((b) => {
      b.onclick = () => {
        this.selection.tool = b.dataset.tool;
        this.$$('[data-tool]').forEach((x) => x.classList.toggle('sel', x === b));
      };
    });
    this.$$('[data-arena]').forEach((b) => {
      b.onclick = () => {
        this.selection.arena = b.dataset.arena;
        this.$$('[data-arena]').forEach((x) => x.classList.toggle('sel', x === b));
      };
    });

    this.$('[data-act="back"]').onclick = () => this.showCharacterSelect();
    this.$('[data-act="fight"]').onclick = () => {
      this.hide();
      this.hooks.onStart(Object.assign({}, this.selection));
    };
  }

  // -------------------------------------------------------------------------
  // Codex
  // -------------------------------------------------------------------------

  showCodex(back) {
    this.screen = 'codex';
    const sections = {
      mechanics: 'Mechanics',
      techniques: 'Cursed Techniques',
      domains: 'Domains',
      vows: 'Binding Vows',
      tools: 'Cursed Tools',
      bestiary: 'Bestiary',
    };
    this.show(`
      <div class="panel wide-panel">
        <div class="panel-head">
          <button class="back" data-act="back">&lsaquo; Back</button>
          <h2>Codex</h2>
        </div>
        <div class="tabs">${Object.entries(sections).map(([k, v], i) =>
          `<button data-tab="${k}" class="${i === 0 ? 'sel' : ''}">${v}</button>`).join('')}</div>
        <div class="codex-body" id="codexBody"></div>
      </div>
    `);
    const body = this.$('#codexBody');
    const render = (tab) => { body.innerHTML = CODEX_RENDER[tab](); body.scrollTop = 0; };
    this.$$('[data-tab]').forEach((b) => {
      b.onclick = () => {
        this.$$('[data-tab]').forEach((x) => x.classList.toggle('sel', x === b));
        render(b.dataset.tab);
      };
    });
    render('mechanics');
    this.$('[data-act="back"]').onclick = () => (back ? back() : this.showTitle());
  }

  // -------------------------------------------------------------------------
  // Pause / settings / impromptu vows
  // -------------------------------------------------------------------------

  showPause() {
    this.screen = 'pause';
    this.show(`
      <div class="panel narrow">
        <h2 class="pause-title">Paused</h2>
        <div class="menu-list">
          <button class="menu-btn primary" data-act="resume"><span class="en">Resume</span></button>
          <button class="menu-btn" data-act="codex"><span class="en">Codex</span></button>
          <button class="menu-btn" data-act="settings"><span class="en">Settings</span></button>
          <button class="menu-btn danger" data-act="quit"><span class="en">Abandon mission</span></button>
        </div>
      </div>
    `, 'overlay');
    this.$('[data-act="resume"]').onclick = () => this.hooks.onResume();
    this.$('[data-act="codex"]').onclick = () => this.showCodex(() => this.showPause());
    this.$('[data-act="settings"]').onclick = () => this.showSettings(() => this.showPause());
    this.$('[data-act="quit"]').onclick = () => this.hooks.onQuit();
  }

  showSettings(back) {
    this.screen = 'settings';
    const s = this.settings;
    const slider = (key, label, min, max, step) => `
      <div class="setting">
        <label>${label}</label>
        <input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}">
        <span class="val" id="v_${key}">${s[key]}</span>
      </div>`;
    const toggle = (key, label) => `
      <div class="setting">
        <label>${label}</label>
        <button class="toggle ${s[key] ? 'on' : ''}" data-toggle="${key}">${s[key] ? 'ON' : 'OFF'}</button>
      </div>`;
    this.show(`
      <div class="panel narrow">
        <div class="panel-head"><button class="back" data-act="back">&lsaquo; Back</button><h2>Settings</h2></div>
        ${slider('masterVolume', 'Master volume', 0, 1, 0.05)}
        ${slider('sfxVolume', 'Effects volume', 0, 1, 0.05)}
        ${slider('particles', 'Particle density', 0.3, 1.4, 0.1)}
        ${slider('shake', 'Screen shake', 0, 1.5, 0.1)}
        ${slider('aimAssist', 'Aim assist', 0, 1, 0.1)}
        ${slider('assist', 'Black Flash window assist', 0, 1, 0.1)}
        ${slider('lookSensitivity', 'Look sensitivity (first person)', 0.3, 2.5, 0.1)}
        ${toggle('firstPerson', 'First person view')}
        ${toggle('render3d', '3D renderer')}
        ${toggle('cutscenes', 'Domain expansion cutscenes')}
        ${toggle('grain', 'Film grain')}
        ${toggle('showNames', 'Enemy name plates')}
        <p class="section-note">First person puts the camera behind your eyes and takes the
        mouse for looking — click once in the arena to hand the cursor over, Escape to get it
        back. G switches view mid-fight. It needs the 3D renderer.</p>
        <p class="section-note">Turning the 3D renderer off falls back to the classic 2.5D
        presentation. Same simulation, same frame data — only the drawing changes.</p>
        <p class="section-note">Aim assist nudges a swing or a cast the last few degrees
        onto a target you were already pointing at, and widens your reach a little. It will
        never pick a target you were not aiming near.</p>
        <p class="section-note">Black Flash assist widens the timing band. At 0 the band is
        ${Math.round(FLASH.bandBase * 1000)}ms wide before your cursed energy control and Flow are applied.</p>
      </div>
    `, 'overlay');
    this.$$('[data-set]').forEach((el) => {
      el.oninput = () => {
        const k = el.dataset.set;
        this.settings[k] = Number(el.value);
        this.$('#v_' + k).textContent = Number(el.value).toFixed(2);
        this.hooks.onSettings && this.hooks.onSettings(this.settings);
      };
    });
    this.$$('[data-toggle]').forEach((el) => {
      el.onclick = () => {
        const k = el.dataset.toggle;
        this.settings[k] = !this.settings[k];
        el.classList.toggle('on', this.settings[k]);
        el.textContent = this.settings[k] ? 'ON' : 'OFF';
        this.hooks.onSettings && this.hooks.onSettings(this.settings);
      };
    });
    this.$('[data-act="back"]').onclick = () => back();
  }

  /** Mid-fight vow picker. `onPick(vow)` or null to cancel. */
  showImpromptuVows(fighter, onPick) {
    this.screen = 'vowPicker';
    const cards = IMPROMPTU_VOWS.map((v) => {
      const ok = v.available(fighter);
      return `<button class="card vow-card ${ok ? '' : 'disabled'}" data-iv="${v.id}" ${ok ? '' : 'disabled'}>
        <div class="card-name">${v.name}</div>
        <div class="vow-terms"><b>Cost:</b> ${v.terms}</div>
        <div class="vow-gain"><b>Gain:</b> ${v.gain}</div>
      </button>`;
    }).join('');
    this.show(`
      <div class="panel">
        <h2 class="vow-title">Declare a Binding Vow</h2>
        <p class="section-note">Time is stopped. Whatever you swear here binds immediately and cannot be undone.</p>
        <div class="card-grid vows">${cards}</div>
        <button class="menu-btn wide" data-act="cancel">Swear nothing</button>
      </div>
    `, 'overlay vow-overlay');
    this.$$('[data-iv]').forEach((b) => {
      b.onclick = () => {
        const v = IMPROMPTU_VOWS.find((x) => x.id === b.dataset.iv);
        this.hide();
        onPick(v);
      };
    });
    this.$('[data-act="cancel"]').onclick = () => { this.hide(); onPick(null); };
  }
}

// ---------------------------------------------------------------------------

function statBar(label, frac) {
  const f = Math.max(0.02, Math.min(1, frac));
  return `<div class="stat"><span class="sl">${label}</span>
    <span class="sb"><i style="width:${(f * 100).toFixed(0)}%"></i></span></div>`;
}

const CODEX_RENDER = {
  mechanics: () => `
    <article>
      <h3>Cursed Energy</h3>
      <p>Everything costs cursed energy. It also passively <b>reinforces</b> your body: up to 72% damage
      reduction, scaling with how full your pool is and how good your control stat is. Running dry does not
      just lock your techniques — it removes your armour. The reinforcement read-out sits under your energy bar.</p>

      <h3>Reinforcement vs. the soul</h3>
      <p>Some damage ignores reinforcement entirely: Idle Transfiguration's soul touch, the Split Soul Katana,
      Cleave, and any domain sure-hit that targets the soul. Against those, a full energy bar saves you nothing.</p>

      <h3>Black Flash</h3>
      <p>When cursed energy lands within a hair's breadth of the physical impact, space distorts and the hit
      does <b>${FLASH.baseMultiplier}×</b> damage. In the game this is a timing band on the ring above your head:</p>
      <ul>
        <li>Landing any physical hit opens a window and starts the ring.</li>
        <li>A red band lights up partway through. Land your <b>next</b> hit inside it.</li>
        <li>Success: 2.5× damage, +${FLASH.ceReward} cursed energy, Flow surges, and the chain counter climbs —
        each link adds ${Math.round(FLASH.chainBonus * 100)}% more damage.</li>
        <li>Failure narrows the band until you land one. Missing is never free.</li>
        <li>A <b>perfect parry</b> opens the window far wider. Parry, then strike — that is the intended route.</li>
      </ul>
      <p>Width scales with your cursed energy control, your Flow, bare hands, and the Empty Hands vow.</p>

      <h3>Parry, block and guard break</h3>
      <p>Tap block within 190ms of an incoming hit for a perfect parry: no damage, the attacker staggers,
      you gain energy and Flow, and the Black Flash window opens wide. Holding block instead trades chip damage
      for guard damage — run your poise out and you are guard broken and open to everything.</p>

      <h3>Poise and stagger</h3>
      <p>Every hit does guard damage. At zero poise you stagger for nearly a second and take 30% extra damage.
      This is how heavy tools like Playful Cloud and Dragon-Bone win fights they should lose on paper.</p>

      <h3>Flow</h3>
      <p>Flow builds from perfect parries, Black Flashes, long combos and near-miss dodges; it decays if you
      disengage. At 50% you may expand a domain. It also widens the Black Flash band, so playing well makes
      playing well easier.</p>

      <h3>Reverse Cursed Technique</h3>
      <p>Hold R to multiply two cursed energies into positive energy and heal. It drains fast, halves your
      movement, and below 0.45 control it can reverse the wrong way and damage you. It also closes wounds,
      clears throat strain, cures soul wounds and burns off cursed energy burnout.</p>

      <h3>Wounds</h3>
      <p>Heavy damage injures arms (less output) or legs (less speed). Only RCT closes them.</p>

      <h3>Wall slams and destruction</h3>
      <p>Knock someone into a pillar at speed and both take damage. Dragon-Bone doubles it. Most cover
      breaks permanently — the arena you finish a fight in never looks like the one you started in.</p>
    </article>`,

  techniques: () => Object.values(TECHNIQUES).map((t) => `
    <article class="codex-tech">
      <h3 style="color:${t.color}">${t.name}</h3>
      <div class="fam">${t.family}</div>
      <p>${t.blurb}</p>
      <div class="passive"><b>${t.passive.name}</b> — ${t.passive.desc}</div>
      <ul class="abl">
        ${t.abilities.map((a) => `<li><b>${a.name}</b> — ${a.desc}
          <span class="dim">(${a.cost} CE, ${a.cooldown}s)</span></li>`).join('')}
      </ul>
      ${t.domain
        ? `<div class="dom"><b>Domain: ${t.domain.name}</b> — ${t.domain.desc}<br><i>${t.domain.blurb}</i></div>`
        : `<div class="dom none"><b>No domain</b> — ${t.blurbNoDomain}</div>`}
    </article>`).join(''),

  domains: () => `
    <article>
      <h3>Domain Expansion</h3>
      <p>A barrier built from your innate technique. Inside it, the technique becomes a <b>sure hit</b>: it does
      not travel, is not aimed, and cannot be dodged. It simply happens, continuously, to everyone you designate.</p>
      <p>Requirements: 50% Flow and near-full cursed energy. The chant takes over a second and heavy guard
      damage during it <b>interrupts</b> the expansion — costing you energy and locking domains for 20 seconds.</p>
      <h3>The counterplay ladder</h3>
      <ol>
        <li><b>Simple Domain (E)</b> — a 2.21m circle. Neutralises the sure-hit while you stand in it and
        auto-counters anything crossing the line. Drains energy fast and slows you to a walk.</li>
        <li><b>Domain Amplification (Z)</b> — barrier wrapped over your body. Technique effects fizzle on
        contact for 2.8s, and your own attacks pierce Infinity.</li>
        <li><b>Falling Blossom Emotion</b> — mastered Simple Domain users repel the enemy barrier on
        contact, shredding its integrity. Heavenly Restriction has this by default.</li>
        <li><b>Your own domain</b> — a clash. Refinement, output, Flow and cursed energy decide it; the loser's
        barrier shatters and backfires on them.</li>
        <li><b>Break the barrier</b> — everything you land inside it costs the domain integrity.</li>
        <li><b>Kill the caster</b> — they are draining energy and cannot regenerate the whole time.</li>
      </ol>
      <h3>Open barriers</h3>
      <p>Malevolent Shrine trades the barrier away by binding vow: no walls, a 17m radius, and the slash storm
      hits allies — and the caster — too.</p>
      <h3>Burnout</h3>
      <p>Holding a domain drains you continuously and stops your regeneration. When it closes you cannot expand
      another for 30 seconds; if it is shattered, 45 seconds plus a chunk of your health.</p>
    </article>`,

  vows: () => `
    <article>
      <h3>Binding Vows</h3>
      <p>Give up something certain, receive power. Chosen before the fight for vow points, or declared
      mid-fight with V for an immediate price.</p>
      ${VOW_LIST.map((v) => `<div class="vow-row">
        <b>${v.name}</b> <span class="dim">(${v.cost} pts)</span>
        <div>Give up: ${v.terms}</div>
        <div>Gain: ${v.gain}</div>
        ${v.penalty ? `<div class="pen">Broken: ${v.penalty}</div>` : ''}
      </div>`).join('')}
      <h3>Impromptu vows</h3>
      ${IMPROMPTU_VOWS.map((v) => `<div class="vow-row">
        <b>${v.name}</b>
        <div>Cost: ${v.terms}</div><div>Gain: ${v.gain}</div>
      </div>`).join('')}
    </article>`,

  tools: () => `<article>${TOOL_LIST.map((id) => {
    const t = TOOLS[id];
    return `<div class="tool-row">
      <b style="color:${t.color}">${t.name}</b>
      <div>${t.desc}</div>
      <div class="dim">Weight ${t.weight} · Power ${t.power} · Reach ${t.reach} · Guard damage ×${t.poiseMul}</div>
      ${t.special ? `<div class="spec">${t.special}</div>` : ''}
    </div>`;
  }).join('')}</article>`,

  bestiary: () => `<article>${Object.values(CURSES).map((c) => `
    <div class="curse-row">
      <b style="color:${c.color}">${c.name}</b>
      <span class="dim"> — ${GRADE_LABEL[c.grade] || c.grade}</span>
      <div>${c.desc || ''}</div>
      <div class="dim">HP ${c.maxHp} · Poise ${c.poise} · Speed ${c.speed}${c.canDomain ? ' · can expand a domain' : ''}${c.adapts ? ' · adapts' : ''}</div>
    </div>`).join('')}</article>`,
};
