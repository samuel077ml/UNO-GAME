/* =========================================================================
   UNO — Game logic
   ========================================================================= */

(function uno() {
  'use strict';

  /* ---------- Constantes ---------- */

  const COLORS = ['red', 'yellow', 'green', 'blue'];

  const COLOR_NAMES = {
    red: 'Rojo',
    yellow: 'Amarillo',
    green: 'Verde',
    blue: 'Azul',
  };

  const SYMBOL_GLYPH = {
    skip: '\u00D8', // slashed O (looks like no-entry)
    reverse: '\u21BA', // anticlockwise arrow
    draw2: '+2',
    wild: 'W',
  };

  const SYMBOL_NAME = {
    skip: 'Salto',
    reverse: 'Reversa',
    draw2: '+2',
    wild: 'Comodín',
  };

  const PLAYERS = [
    { id: 'player', name: 'Vos', isAI: false, position: 'bottom' },
    { id: 'opp-left', name: 'IA Verde', isAI: true, position: 'left' },
    { id: 'opp-top', name: 'IA Azul', isAI: true, position: 'top' },
    { id: 'opp-right', name: 'IA Rojo', isAI: true, position: 'right' },
  ];

  const STORAGE_KEY = 'uno:game:v1';
  const AI_DELAY_MS = 700;
  const HAND_SIZE = 7;

  /* ---------- Mazo ---------- */

  function buildDeck() {
    const deck = [];
    let id = 0;
    const makeCard = (color, type, value = null) => ({
      id: `c${id++}`,
      color,
      type,
      value,
    });

    for (const color of COLORS) {
      // Un solo 0 y dos de cada 1-9
      deck.push(makeCard(color, 'number', 0));
      for (let n = 1; n <= 9; n++) {
        deck.push(makeCard(color, 'number', n));
        deck.push(makeCard(color, 'number', n));
      }

      // Especiales: 2 de cada uno por color
      deck.push(makeCard(color, 'skip'));
      deck.push(makeCard(color, 'skip'));
      deck.push(makeCard(color, 'reverse'));
      deck.push(makeCard(color, 'reverse'));
      deck.push(makeCard(color, 'draw2'));
      deck.push(makeCard(color, 'draw2'));
    }

    // 4 Comodines (sin color fijo)
    for (let i = 0; i < 4; i++) deck.push(makeCard(null, 'wild'));

    return deck;
  }

  // Fisher-Yates
  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /* ---------- Utilidades ---------- */

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  let state = null;

  function createInitialState() {
    return {
      deck: [], // draw pile (top = last index)
      discard: [], // discard pile (top = last index)
      hands: {
        // per-player card arrays
        player: [],
        'opp-left': [],
        'opp-top': [],
        'opp-right': [],
      },
      currentIndex: 0, // 0 = player, then rotates
      direction: 1, // +1 clockwise, -1 counter-clockwise
      activeColor: null, // top card color (wild may override)
      pendingDraw: 0, // pending draws from +2
      pendingSkip: false, // next player loses turn
      winner: null,
      phase: 'intro',
      stats: {
        turns: 0,
        played: 0,
        specials: 0,
        drawn: 0,
      },
      selected: 0,
    };
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    body: document.body,
    intro: $('#intro'),
    startBtn: $('#start-button'),
    helpBtnIntro: $('#help-button-intro'),
    helpBtn: $('#help-button'),
    themeBtn: $('#theme-button'),
    newGameBtn: $('#new-game-button'),
    sayUnoBtn: $('#say-uno-button'),
    passBtn: $('#pass-button'),
    playAgainBtn: $('#play-again-button'),

    drawPile: $('#draw-pile'),
    drawCount: $('[data-draw-count]'),
    discardPile: $('#discard-pile'),

    turnLabel: $('#turn-label'),
    directionIndicator: $('#direction-indicator'),
    eventLog: $('#event-log'),
    srLive: $('#sr-live'),

    playerHand: $('#player-hand'),
    playerRoot: $('#player'),
    playerCount: $('#player .player__count'),
    opponents: {
      'opp-left': $('#opponent-left'),
      'opp-top': $('#opponent-top'),
      'opp-right': $('#opponent-right'),
    },

    toastStack: $('#toast-stack'),

    wildFlash: $('#wild-flash'),
    wildSwatch: $('[data-wild-swatch]'),
    wildName: $('[data-wild-name]'),

    resultModal: $('#result-modal'),
    resultTitle: $('#result-title'),
    resultSubtitle: $('#result-subtitle'),
    confettiCanvas: $('#confetti-canvas'),

    helpModal: $('#help-modal'),
  };
  function getPlayer(idx) {
    return PLAYERS[((idx % PLAYERS.length) + PLAYERS.length) % PLAYERS.length];
  }

  function nextIndex(from, direction = state.direction, steps = 1) {
    const n = PLAYERS.length;
    return (((from + direction * steps) % n) + n) % n;
  }

  function topCard() {
    return state.discard[state.discard.length - 1] ?? null;
  }

  function playerByIndex() {
    return PLAYERS[state.currentIndex].id;
  }

  function playerName(id) {
    return PLAYERS.find((p) => p.id === id)?.name ?? id;
  }
  function isPlayable(card) {
    const top = topCard();
    if (!top) return true;
    if (card.type === 'wild') return true;
    if (card.color === state.activeColor) return true;
    if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
    if (card.type !== 'number' && card.type === top.type) return true;
    return false;
  }
  function startNewGame() {
    state = createInitialState();
    state.deck = shuffle(buildDeck());

    for (let i = 0; i < HAND_SIZE; i++) {
      for (const p of PLAYERS) {
        state.hands[p.id].push(state.deck.pop());
      }
    }

    let first = state.deck.pop();
    state.discard.push(first);

    if (first.type === 'wild') {
      const color = pickRandom(COLORS);
      state.activeColor = color;
      first.wildColor = color;
    } else {
      state.activeColor = first.color;
    }

    state.currentIndex = 0;
    state.direction = 1;
    state.phase = 'playing';

    applyStartingCardEffect(first);

    saveState();
    render();
  }
  function applyStartingCardEffect(first) {
    if (first.type === 'skip') {
      state.currentIndex = nextIndex(state.currentIndex);
    } else if (first.type === 'reverse') {
      state.direction *= -1;
    } else if (first.type === 'draw2') {
      drawCards('player', 2);
      state.currentIndex = nextIndex(state.currentIndex);
    }
  }
  function drawCards(playerId, count) {
    let drawn = [];
    for (let i = 0; i < count; i++) {
      if (state.deck.length === 0) reshuffleFromDiscard();
      if (state.deck.length === 0) break;
      const card = state.deck.pop();
      state.hands[playerId].push(card);
      drawn.push(card);
    }
    if (playerId === 'player') state.stats.drawn += drawn.length;
    return drawn;
  }

  function reshuffleFromDiscard() {
    if (state.discard.length <= 1) return;
    const top = state.discard.pop();
    const toShuffle = state.discard;
    for (const c of toShuffle) if (c.type === 'wild') delete c.wildColor;
    state.deck = shuffle(toShuffle);
    state.discard = [top];
  }
  function render() {
    if (!state) return;

    renderPlayerHand();
    renderOpponents();
    renderDiscard();
    renderDrawPile();
    renderTurn();
    renderDirection();
    renderUnoBadges();
    updateButtons();
  }
  function renderPlayerHand() {
    const hand = state.hands['player'] ?? [];
    els.playerHand.innerHTML = '';
    if (state.selected >= hand.length) state.selected = Math.max(0, hand.length - 1);

    hand.forEach((card, idx) => {
      const li = document.createElement('li');
      li.appendChild(
        buildCardEl(card, {
          isPlayer: true,
          isPlayable: isPlayable(card) && playerByIndex() === 'player',
          isFocused: idx === state.selected && playerByIndex() === 'player',
          onClick: () => humanPlay(card.id),
        }),
      );
      els.playerHand.appendChild(li);
    });

    els.playerCount.textContent = `${hand.length} carta${hand.length === 1 ? '' : 's'}`;
  }
  function buildCardEl(card, options = {}) {
    const {
      isPlayer = false,
      isPlayable: playable = false,
      isFocused = false,
      onClick = null,
      faceUp = true,
    } = options;

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'card';

    const effectiveColor = card.type === 'wild' ? 'wild' : card.color;
    el.classList.add(`card--${effectiveColor}`);

    const glyphVal = card.type === 'number' ? String(card.value) : SYMBOL_GLYPH[card.type];

    const tl = document.createElement('span');
    tl.className = 'card__corner card__corner--tl';
    tl.textContent = glyphVal;
    const br = document.createElement('span');
    br.className = 'card__corner card__corner--br';
    br.textContent = glyphVal;

    const oval = document.createElement('span');
    oval.className = 'card__oval';
    const glyph = document.createElement('span');
    glyph.className = 'card__glyph';
    glyph.textContent = glyphVal;
    oval.appendChild(glyph);

    el.appendChild(tl);
    el.appendChild(oval);
    el.appendChild(br);

    el.setAttribute('aria-label', describeCard(card));

    if (isPlayer) {
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', isFocused ? 'true' : 'false');
      if (playable) el.classList.add('card--playable');
      else if (playerByIndex() === 'player') el.classList.add('card--unplayable');
      if (isFocused) el.classList.add('card--focus');
      if (onClick) el.addEventListener('click', () => onClick());
    } else {
      el.setAttribute('tabindex', '-1');
    }

    if (!faceUp) el.classList.add('card--back');

    return el;
  }

  function describeCard(card) {
    if (card.type === 'wild') {
      const c = card.wildColor ? ` (color ${COLOR_NAMES[card.wildColor]})` : '';
      return `Carta comodín${c}`;
    }
    const colorName = COLOR_NAMES[card.color] ?? '';
    if (card.type === 'number') return `Carta ${colorName} ${card.value}`;
    return `Carta ${colorName} ${SYMBOL_NAME[card.type]}`;
  }
  function renderOpponents() {
    for (const [pid, rootEl] of Object.entries(els.opponents)) {
      const hand = state.hands[pid] ?? [];
      const handEl = rootEl.querySelector('[data-hand]');
      const countEl = rootEl.querySelector('[data-count]');

      handEl.innerHTML = '';
      const visible = Math.min(hand.length, 7);
      for (let i = 0; i < visible; i++) {
        const li = document.createElement('li');
        const back = document.createElement('span');
        back.className = 'card card--back card--mini';
        back.setAttribute('aria-hidden', 'true');
        const logo = document.createElement('span');
        logo.className = 'card__back-logo';
        logo.textContent = 'UNO';
        back.appendChild(logo);
        li.appendChild(back);
        handEl.appendChild(li);
      }

      countEl.textContent = `${hand.length} carta${hand.length === 1 ? '' : 's'}`;
      rootEl.classList.toggle('opponent--active', playerByIndex() === pid);
    }

    els.playerRoot.classList.toggle('player--active', playerByIndex() === 'player');
  }
  function renderDiscard() {
    const top = topCard();
    if (!top) return;

    const existing = els.discardPile.querySelector('.card:not(.pile__color-ring)');
    if (existing && !existing.classList.contains('pile__color-ring')) existing.remove();

    const color = top.type === 'wild' ? (top.wildColor ?? state.activeColor) : top.color;
    els.discardPile.dataset.color = color ?? 'red';

    const card = buildCardEl(top, { faceUp: true });
    card.classList.add('card--landing');
    els.discardPile.insertBefore(card, els.discardPile.querySelector('.pile__label'));
  }

  function renderDrawPile() {
    els.drawCount.textContent = String(state.deck.length);
  }

  function renderTurn() {
    const id = playerByIndex();
    els.turnLabel.textContent = id === 'player' ? 'Tu turno' : `Turno de ${playerName(id)}`;
  }

  function renderDirection() {
    els.directionIndicator.textContent = state.direction === 1 ? '\u21BB' : '\u21BA';
    els.directionIndicator.setAttribute('aria-label', state.direction === 1 ? 'Horario' : 'Antihorario');
  }

  function renderUnoBadges() {
    for (const p of PLAYERS) {
      const isUno = state.hands[p.id].length === 1;
      const root = p.id === 'player' ? els.playerRoot : els.opponents[p.id];
      if (p.id === 'player') root.classList.toggle('player--uno', isUno);
      else root.classList.toggle('opponent--uno', isUno);
    }
  }

  function updateButtons() {
    const myTurn = playerByIndex() === 'player' && state.phase === 'playing';
    els.passBtn.disabled = !myTurn;
    els.drawPile.disabled = !myTurn;
    els.sayUnoBtn.disabled = !(state.hands['player'].length === 1);
  }

  function playCard(playerId, cardId, opts = {}) {
    const hand = state.hands[playerId];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return false;
    const card = hand[idx];
    if (!isPlayable(card)) return false;

    // For wild, pick random color
    if (card.type === 'wild') {
      const color = pickRandom(COLORS);
      card.wildColor = color;
      state.activeColor = color;
      showWildFlash(color);
    } else {
      state.activeColor = card.color;
    }

    hand.splice(idx, 1);
    state.discard.push(card);
    state.stats.played += 1;
    if (card.type !== 'number') state.stats.specials += 1;

    // Win check
    if (hand.length === 0) {
      state.winner = playerId;
      state.phase = 'finished';
      const who = playerId === 'player' ? '¡Ganaste!' : `Perdiste — ${playerName(playerId)} se quedó sin cartas`;
      logEvent(who);
      render();
      showResult(playerId === 'player');
      return true;
    }

    // UNO detection (exactly 1 card remaining)
    if (hand.length === 1) {
      toastUno(playerName(playerId));
    }

    applyEffect(card);
    advanceTurn();

    render();

    saveState();
    if (!opts.suppressAI) maybeRunAI();
    return true;
  }
  function applyEffect(card) {
    const nextIdx = nextIndex(state.currentIndex);
    const nextId = PLAYERS[nextIdx].id;
    const nextName = PLAYERS[nextIdx].name;

    switch (card.type) {
      case 'skip':
        logEvent(`${playerName(playerByIndex())} jugó Salto — ${nextName} pierde el turno.`);
        state.pendingSkip = true;
        break;
      case 'reverse': {
        state.direction *= -1;
        flashDirection();
        logEvent(`${playerName(playerByIndex())} jugó Reversa — dirección invertida.`);
        break;
      }
      case 'draw2':
        logEvent(`${playerName(playerByIndex())} jugó +2 — ${nextName} roba 2 y pierde el turno.`);
        drawCards(nextId, 2);
        state.pendingSkip = true;
        break;
      case 'wild':
        logEvent(`${playerName(playerByIndex())} jugó Comodín — color nuevo: ${COLOR_NAMES[state.activeColor]}.`);
        break;
      default:
        break;
    }
  }
  function advanceTurn() {
    if (state.pendingSkip) {
      state.currentIndex = nextIndex(state.currentIndex, state.direction, 2);
      state.pendingSkip = false;
    } else {
      state.currentIndex = nextIndex(state.currentIndex);
    }
    state.stats.turns += 1;
  }
  function humanPlay(cardId) {
    if (state.phase !== 'playing') return;
    if (playerByIndex() !== 'player') return;
    const hand = state.hands['player'];
    const card = hand.find((c) => c.id === cardId);
    if (!card || !isPlayable(card)) {
      announce('Esa carta no se puede jugar ahora');
      return;
    }
    playCard('player', cardId);
  }

  function humanDraw() {
    if (state.phase !== 'playing') return;
    if (playerByIndex() !== 'player') return;

    els.drawPile?.classList.add('is-pressed');
    setTimeout(() => els.drawPile?.classList.remove('is-pressed'), 260);

    const [drawn] = drawCards('player', 1);
    saveState();
    if (!drawn) return;

    logEvent('Robaste una carta.');
    render();

    if (isPlayable(drawn)) {
      announce(`Robaste ${describeCard(drawn)}. Tiralo!`);
      const idx = state.hands['player'].findIndex((c) => c.id === drawn.id);
      if (idx !== -1) {
        state.selected = idx;
        render();
      }
      return;
    }

    announce('Robaste y no se puede tirar. Pasá el turno.');
    state.currentIndex = nextIndex(state.currentIndex);
    state.stats.turns += 1;
    render();
    maybeRunAI();
  }
  async function maybeRunAI() {
    while (state.phase === 'playing' && playerByIndex() !== 'player') {
      await wait(AI_DELAY_MS);
      if (state.phase !== 'playing') return;
      aiTakeTurn();
    }
  }
  function pickAICard(hand) {
    const playable = hand.filter(isPlayable);
    if (playable.length === 0) return null;

    const priority = (c) => {
      if (c.type === 'draw2') return 40;
      if (c.type === 'skip') return 30;
      if (c.type === 'reverse') return 20;
      if (c.type === 'number') return 10 + (c.value ?? 0);
      if (c.type === 'wild') return 0;
      return 0;
    };

    const nonWild = playable.filter((c) => c.type !== 'wild');
    const pool = nonWild.length > 0 ? nonWild : playable;

    pool.sort((a, b) => priority(b) - priority(a));
    return pool[0];
  }
  function aiTakeTurn() {
    const id = playerByIndex();
    const hand = state.hands[id];
    const pick = pickAICard(hand);
    if (pick) {
      playCard(id, pick.id, { suppressAI: true });
      return;
    }
    const [drawn] = drawCards(id, 1);
    logEvent(`${playerName(id)} roba una carta.`);
    if (drawn && isPlayable(drawn)) {
      playCard(id, drawn.id, { suppressAI: true });
      return;
    }
    state.currentIndex = nextIndex(state.currentIndex);
    state.stats.turns += 1;
    saveState();
    render();
  }

  function showResult(won) {
    els.resultTitle.textContent = won ? '¡Ganaste!' : '¡Perdiste!';
    els.resultSubtitle.textContent = won
      ? 'Dejaste sin cartas a toda la mesa.'
      : `${playerName(state.winner)} se quedó sin cartas primero.`;

    for (const [key, value] of Object.entries(state.stats)) {
      const node = els.resultModal.querySelector(`[data-stat="${key}"]`);
      if (node) node.textContent = String(value);
    }

    openModal(els.resultModal);

    if (won && !prefersReducedMotion()) {
      startConfetti();
    }
  }
  function openModal(modalEl) {
    modalEl.hidden = false;
    const focusable = modalEl.querySelector('.btn');
    focusable?.focus();
    document.addEventListener('keydown', trapEscape);
  }

  function closeModal(modalEl) {
    modalEl.hidden = true;
    document.removeEventListener('keydown', trapEscape);
    stopConfetti();
  }

  function trapEscape(e) {
    if (e.key === 'Escape') {
      [els.resultModal, els.helpModal].forEach((m) => {
        if (!m.hidden) closeModal(m);
      });
    }
  }
  let confettiRAF = null;
  function startConfetti() {
    const canvas = els.confettiCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize, { once: true });

    const particles = [];
    const colors = ['#ef4444', '#eab308', '#10b981', '#3b82f6', '#ffffff', '#f59e0b'];
    for (let i = 0; i < 140; i++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 10,
        vy: Math.random() * -10 - 2,
        g: 0.2 + Math.random() * 0.18,
        size: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.2,
        life: 0,
      });
    }

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particles) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        p.life += 1;
        if (p.y < canvas.height + 20 && p.life < 240) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (alive) {
        confettiRAF = requestAnimationFrame(tick);
      } else {
        stopConfetti();
      }
    };
    cancelAnimationFrame(confettiRAF);
    confettiRAF = requestAnimationFrame(tick);
  }

  function stopConfetti() {
    if (confettiRAF) cancelAnimationFrame(confettiRAF);
    confettiRAF = null;
    const canvas = els.confettiCanvas;
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }
  function toast(msg, variant = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast--${variant}`;
    el.textContent = msg;
    els.toastStack.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function toastUno(who) {
    const el = document.createElement('div');
    el.className = 'toast toast--uno';
    el.textContent = `¡UNO! ${who === 'Vos' ? 'Te queda una sola.' : `${who} canta UNO.`}`;
    els.toastStack.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function logEvent(msg) {
    const p = document.createElement('p');
    p.className = 'center__log-item';
    p.textContent = msg;
    els.eventLog.appendChild(p);
    while (els.eventLog.children.length > 4) {
      els.eventLog.firstChild?.remove();
    }
    announce(msg);
  }

  function announce(msg) {
    els.srLive.textContent = msg;
  }
  function showWildFlash(color) {
    const colorMap = {
      red: 'var(--uno-red)',
      yellow: 'var(--uno-yellow)',
      green: 'var(--uno-green)',
      blue: 'var(--uno-blue)',
    };
    els.wildSwatch.style.background = colorMap[color];
    els.wildName.textContent = COLOR_NAMES[color];
    els.wildFlash.dataset.active = 'true';
    setTimeout(() => {
      els.wildFlash.dataset.active = 'false';
    }, 1100);
  }

  function flashDirection() {
    els.directionIndicator.classList.add('flipping');
    setTimeout(() => els.directionIndicator.classList.remove('flipping'), 500);
  }
  /* ---------- Persistencia (localStorage) ---------- */

  function saveState() {
    try {
      const snapshot = clone(state);
      snapshot.selected = 0;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) {
      /* storage disabled / full */
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.deck || !parsed.hands) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearState() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function tryRestore() {
    const saved = loadState();
    if (!saved) return false;
    if (saved.phase !== 'playing') return false;

    state = saved;
    if (playerByIndex() !== 'player') {
      state.currentIndex = 0;
    }
    state.pendingSkip = false;
    els.body.dataset.phase = 'playing';
    render();
    return true;
  }

  /* ---------- Teclado ---------- */

  function onKey(e) {
    if (state?.phase !== 'playing') {
      if (e.key.toLowerCase() === 'n') els.newGameBtn.click();
      return;
    }

    const hand = state.hands['player'];
    const myTurn = playerByIndex() === 'player';

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!myTurn || hand.length === 0) return;
        e.preventDefault();
        const step = e.key === 'ArrowRight' ? 1 : -1;
        state.selected = (state.selected + step + hand.length) % hand.length;
        render();
        break;
      }
      case 'Enter':
      case ' ': {
        if (!myTurn || hand.length === 0) return;
        e.preventDefault();
        const card = hand[state.selected];
        if (card && isPlayable(card)) humanPlay(card.id);
        else announce('Esa carta no se puede jugar');
        break;
      }
      case 'd':
      case 'D':
        if (myTurn) humanDraw();
        break;
      case 'n':
      case 'N':
        els.newGameBtn.click();
        break;
      default:
        break;
    }
  }

  /* ---------- Eventos ---------- */

  function bindEvents() {
    els.startBtn?.addEventListener('click', () => {
      els.body.dataset.phase = 'playing';
      startNewGame();
    });
    els.helpBtnIntro?.addEventListener('click', () => openModal(els.helpModal));
    els.helpBtn?.addEventListener('click', () => openModal(els.helpModal));

    els.themeBtn?.addEventListener('click', () => {
      const current = els.body.classList.contains('theme-dark') ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      els.body.classList.remove('theme-dark', 'theme-light');
      els.body.classList.add(`theme-${next}`);
      try {
        localStorage.setItem('uno:theme', next);
      } catch (e) {}
    });

    els.newGameBtn?.addEventListener('click', () => {
      clearState();
      els.body.dataset.phase = 'playing';
      closeModal(els.resultModal);
      startNewGame();
    });

    els.playAgainBtn?.addEventListener('click', () => {
      clearState();
      closeModal(els.resultModal);
      startNewGame();
    });

    $$('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const modal = el.closest('.modal');
        if (modal) closeModal(modal);
      });
    });

    els.drawPile?.addEventListener('click', humanDraw);
    els.passBtn?.addEventListener('click', humanDraw);
    els.sayUnoBtn?.addEventListener('click', () => {
      if (state.hands['player'].length === 1) {
        toastUno('Vos');
      }
    });

    document.addEventListener('keydown', onKey);
  }

  function restoreTheme() {
    try {
      const t = localStorage.getItem('uno:theme');
      if (t === 'light') {
        els.body.classList.remove('theme-dark');
        els.body.classList.add('theme-light');
      }
    } catch (e) {}
  }

  /* ---------- Arranque ---------- */

  function boot() {
    restoreTheme();
    bindEvents();

    if (tryRestore()) {
      return;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
