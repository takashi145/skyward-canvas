(() => {
  'use strict';

  const DEFAULT_MODE = 'rain';
  const TAU = Math.PI * 2;
  const MAX_FRAME_TIME = 0.05;
  const TRANSITION = Object.freeze({ out: 1.4, pause: 0.35, in: 1.6, sky: 3.2 });
  const DAY_NIGHT_DURATION = 2.8;
  const STAR_ROTATION_SPEED = TAU / (12 * 60);
  const SETTINGS_KEY = 'skyward.weather-adjustments';
  const STORM_KEY = 'skyward.rain-storm';
  const NIGHT_KEY = 'skyward.clear-night';
  const VOLUME_KEY = 'skyward.ambient-volume';
  const IMPACT_KEY = 'skyward.screen-impacts';
  const STORM = Object.freeze({ boltAmplitude: 0.78, boltGap: [5, 14], windMultiplier: 1.45 });
  const AMOUNT_CONTROL = Object.freeze({ base: 2.5, min: 100, max: 300 });
  const DEFAULT_ADJUSTMENTS = Object.freeze({
    rain: Object.freeze({ amount: AMOUNT_CONTROL.base }),
    snow: Object.freeze({ amount: AMOUNT_CONTROL.base }),
  });
  const NO_ADJUSTMENT = Object.freeze({ amount: 1 });
  const BASE = Object.freeze({
    FOV: 0.92,
    MAX_DROPS: 320,
    GRAIN: 0.5,
    Z_HIT: 0.09,
  });
  const MODES = Object.freeze({
    clear: Object.freeze({
      Z0: 3.0,
      VZ: [1, 1],
      R_DROP: [0, 0],
      HIT_RATE: [0, 0],
      PASS_RATE: [0, 0],
      FAR_COUNT: 0,
      FAR_VZ: [1, 1],
      WIND: 0,
      WANDER: 0,
      STREAK: 0,
      EXPOSURE: 0.04,
      GAIN: 0,
      GRAIN: 0.22,
      SOFT: 0,
      A_BASE: 0,
      A_CAP: 0,
      A_FAR: 0,
      SPLASH: false,
      BOLT_AMP: 0,
      BOLT_GAP: [9999, 9999],
      SKY: { c0: [45, 93, 139], c1: [139, 177, 204], f0: [45, 93, 139], f1: [139, 177, 204] },
      COOL: [255, 255, 255],
      CYCLE: 0.4,
    }),
    rain: Object.freeze({
      Z0: 3.0,
      VZ: [2.07, 4.14],
      R_DROP: [0.0035, 0.0125],
      HIT_RATE: [0.6, 4.0],
      PASS_RATE: [14, 85],
      FAR_COUNT: 120,
      FAR_VZ: [2.88, 6.12],
      WIND: 0.95,
      WANDER: 0,
      STREAK: 1.0,
      EXPOSURE: 0.42,
      GAIN: 0.80,
      SOFT: 0.40,
      A_BASE: 0.07,
      A_CAP: 0.52,
      A_FAR: 1.00,
      SPLASH: true,
      BOLT_AMP: 0,
      BOLT_GAP: [70, 180],
      SKY: { c0: [16, 21, 30], c1: [31, 41, 55], f0: [44, 55, 72], f1: [66, 80, 99] },
      COOL: [188, 212, 238],
      CYCLE: 1.0,
    }),
    snow: Object.freeze({
      Z0: 2.2,
      VZ: [0.22, 0.60],
      R_DROP: [0.0035, 0.0115],
      HIT_RATE: [0.12, 0.75],
      PASS_RATE: [12, 46],
      FAR_COUNT: 170,
      FAR_VZ: [0.35, 0.95],
      WIND: 0.18,
      WANDER: 1.0,
      STREAK: 0.10,
      EXPOSURE: 0.12,
      GAIN: 1.00,
      SOFT: 0.32,
      A_BASE: 0.20,
      A_CAP: 0.80,
      A_FAR: 1.70,
      SPLASH: false,
      BOLT_AMP: 0,
      BOLT_GAP: [9999, 9999],
      SKY: { c0: [29, 30, 41], c1: [51, 49, 61], f0: [52, 52, 68], f1: [80, 76, 92] },
      COOL: [234, 240, 250],
      CYCLE: 0.55,
    }),
  });
  const STARS = Array.from({ length: 180 }, () => ({
    angle: Math.random() * TAU,
    distance: Math.sqrt(Math.random()),
    radius: randomBetween(0.35, 1.25),
    phase: Math.random() * TAU,
    speed: randomBetween(0.35, 0.85),
  }));
  const SHOOTING_STARS = Object.freeze([
    { period: 19, offset: 0, x: 0.12, y: 0.14, dx: 0.16, dy: 0.10, duration: 0.9 },
    { period: 31, offset: 11, x: 0.58, y: 0.09, dx: 0.13, dy: 0.08, duration: 0.75 },
  ]);

  const canvas = document.getElementById('c');
  const context = canvas.getContext('2d');
  const buttons = {
    clear: document.getElementById('b-clear'),
    rain: document.getElementById('b-rain'),
    snow: document.getElementById('b-snow'),
  };
  const stormButton = document.getElementById('b-storm');
  const impactButton = document.getElementById('b-impact');
  const nightButton = document.getElementById('b-night');
  const soundButton = document.getElementById('b-sound');
  const settingsButton = document.getElementById('b-settings');
  const settingsPanel = document.getElementById('settings-panel');
  const amountSetting = document.getElementById('amount-setting');
  const controls = { amount: document.getElementById('amount') };
  const controlValues = { amount: document.getElementById('amount-value') };
  const volumeControl = document.getElementById('volume');
  const volumeValue = document.getElementById('volume-value');
  const layers = createLayers();
  const particles = { drops: [], far: [], splashes: [], bolts: [] };
  const viewport = { width: 0, height: 0, cx: 0, cy: 0, focal: 0, dpr: 1 };
  const startsStormy = loadStormPreference();
  const startsAtNight = loadNightPreference();
  let ambientAudio = null;
  const state = {
    mode: modeFromLocation(),
    config: null,
    time: 0,
    lastFrame: performance.now(),
    windX: 0,
    windY: 0,
    hitAccumulator: 0,
    passAccumulator: 0,
    dropBudget: BASE.MAX_DROPS,
    weatherLevel: 1,
    nextBolt: 0,
    transition: null,
    skyBlend: 1,
    previousSky: null,
    idleTimer: null,
    adjustments: loadAdjustments(),
    storm: startsStormy,
    nightLevel: startsAtNight ? 1 : 0,
    nightTarget: startsAtNight ? 1 : 0,
    soundEnabled: false,
    volume: loadVolumePreference(),
    impactsEnabled: loadImpactPreference(),
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function modeFromLocation() {
    const source = `${location.hash}${location.search}`.toLowerCase();
    if (source.includes('clear')) return 'clear';
    if (source.includes('snow')) return 'snow';
    if (source.includes('rain')) return 'rain';
    return DEFAULT_MODE;
  }

  function loadAdjustments() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      return Object.fromEntries(Object.keys(DEFAULT_ADJUSTMENTS).map(mode => [mode, {
        amount: clamp(
          Number(saved?.[mode]?.amount) || DEFAULT_ADJUSTMENTS[mode].amount,
          AMOUNT_CONTROL.base * AMOUNT_CONTROL.min / 100,
          AMOUNT_CONTROL.base * AMOUNT_CONTROL.max / 100,
        ),
      }]));
    } catch {
      return Object.fromEntries(Object.entries(DEFAULT_ADJUSTMENTS).map(([mode, values]) => [
        mode,
        { ...values },
      ]));
    }
  }

  function saveAdjustments() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.adjustments));
    } catch {
      // 保存できない環境でも、そのセッション中の調整は維持する。
    }
  }

  function loadVolumePreference() {
    try {
      const saved = Number(localStorage.getItem(VOLUME_KEY));
      return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.35;
    } catch {
      return 0.35;
    }
  }

  function saveVolumePreference() {
    try {
      localStorage.setItem(VOLUME_KEY, String(state.volume));
    } catch {
      // 保存できない環境でも再生は継続する。
    }
  }

  function loadImpactPreference() {
    try {
      return localStorage.getItem(IMPACT_KEY) !== 'off';
    } catch {
      return true;
    }
  }

  function saveImpactPreference() {
    try {
      localStorage.setItem(IMPACT_KEY, state.impactsEnabled ? 'on' : 'off');
    } catch {
      // 保存できない環境でも、そのセッション中の設定は維持する。
    }
  }

  function createAmbientAudio() {
    return window.SkywardAudio?.create() ?? null;
  }

  function updateAmbientAudio(force = false) {
    ambientAudio?.update({
      enabled: state.soundEnabled,
      volume: state.volume,
      mode: state.mode,
      weatherLevel: state.weatherLevel,
      nightLevel: state.nightLevel,
      nightTarget: state.nightTarget,
      time: state.time,
    }, force);
  }

  function disableAmbientAudio(error) {
    console.warn('環境音を停止しました。', error);
    state.soundEnabled = false;
    const failedAudio = ambientAudio;
    ambientAudio = null;
    try {
      const closing = failedAudio?.close?.();
      if (closing && typeof closing.catch === 'function') closing.catch(() => {});
    } catch {
      // 音声エンジンの破棄に失敗しても描画は継続する。
    }
    updateSoundButton();
  }

  function safelyUpdateAmbientAudio(force = false) {
    try {
      updateAmbientAudio(force);
    } catch (error) {
      disableAmbientAudio(error);
    }
  }

  function stopDaySounds() {
    ambientAudio?.stopDaySounds();
  }

  function loadStormPreference() {
    try {
      return localStorage.getItem(STORM_KEY) === 'on';
    } catch {
      return false;
    }
  }

  function saveStormPreference() {
    try {
      localStorage.setItem(STORM_KEY, state.storm ? 'on' : 'off');
    } catch {
      // 保存できない環境でも切替自体は継続する。
    }
  }

  function loadNightPreference() {
    try {
      return localStorage.getItem(NIGHT_KEY) === 'on';
    } catch {
      return false;
    }
  }

  function saveNightPreference() {
    try {
      localStorage.setItem(NIGHT_KEY, state.nightTarget ? 'on' : 'off');
    } catch {
      // 保存できない環境でも切替自体は継続する。
    }
  }

  function currentAdjustment() {
    return state.adjustments[state.mode] ?? NO_ADJUSTMENT;
  }

  function createLayers() {
    return Object.fromEntries(['sky', 'flash', 'previousSky', 'mixedSky'].map(name => {
      const element = document.createElement('canvas');
      return [name, { element, context: element.getContext('2d') }];
    }));
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function interpolate(start, end, amount) {
    return start + (end - start) * amount;
  }

  function smoothstep(value) {
    const normalized = clamp(value, 0, 1);
    return normalized * normalized * (3 - 2 * normalized);
  }

  function smootherstep(value) {
    const normalized = clamp(value, 0, 1);
    return normalized ** 3 * (normalized * (normalized * 6 - 15) + 10);
  }

  function rgbToHex(rgb) {
    const channels = rgb.map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0'));
    return `#${channels.join('')}`;
  }

  function mixRgb(start, end, amount) {
    return start.map((value, index) => interpolate(value, end[index], amount));
  }

  function createNoiseTexture() {
    const texture = document.createElement('canvas');
    texture.width = texture.height = 128;
    const noiseContext = texture.getContext('2d');
    const image = noiseContext.createImageData(texture.width, texture.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const value = 116 + Math.random() * 24;
      image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
    noiseContext.putImageData(image, 0, 0);
    return texture;
  }

  const noiseTexture = createNoiseTexture();

  function paintSky(target, lift, config = state.config) {
    const { context: layerContext } = target;
    const gradient = layerContext.createLinearGradient(0, 0, 0, viewport.height);
    gradient.addColorStop(0, rgbToHex(mixRgb(config.SKY.c0, config.SKY.f0, lift)));
    gradient.addColorStop(1, rgbToHex(mixRgb(config.SKY.c1, config.SKY.f1, lift)));
    layerContext.fillStyle = gradient;
    layerContext.fillRect(0, 0, viewport.width, viewport.height);

    if (config.GRAIN <= 0) return;
    layerContext.save();
    layerContext.globalCompositeOperation = 'overlay';
    layerContext.globalAlpha = 0.05 * config.GRAIN;
    layerContext.fillStyle = layerContext.createPattern(noiseTexture, 'repeat');
    layerContext.fillRect(0, 0, viewport.width, viewport.height);
    layerContext.restore();
  }

  function repaintSkies() {
    paintSky(layers.sky, 0);
    paintSky(layers.flash, 1);
    if (state.previousSky) paintSky(layers.previousSky, 0, state.previousSky);
  }

  function resize() {
    viewport.dpr = Math.min(2, window.devicePixelRatio || 1);
    viewport.width = innerWidth;
    viewport.height = innerHeight;
    viewport.cx = viewport.width / 2;
    viewport.cy = viewport.height / 2;
    viewport.focal = viewport.cx * state.config.FOV;

    for (const target of [{ element: canvas, context }, ...Object.values(layers)]) {
      target.element.width = Math.round(viewport.width * viewport.dpr);
      target.element.height = Math.round(viewport.height * viewport.dpr);
      target.context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    }
    repaintSkies();
    seedFarParticles();
    updateDropBudget();
  }

  function updateDropBudget() {
    const baseBudget = viewport.width * viewport.height > 900000 ? state.config.MAX_DROPS : 220;
    state.dropBudget = Math.max(1, Math.round(baseBudget * currentAdjustment().amount));
  }

  function createWander() {
    if (!state.config.WANDER) return { wanderAmplitude: 0, wanderFrequency: 0, wanderPhase: 0 };
    return {
      wanderAmplitude: randomBetween(7, 26) * state.config.WANDER / viewport.focal,
      wanderFrequency: randomBetween(0.35, 0.95),
      wanderPhase: randomBetween(0, TAU),
    };
  }

  function spawnDrop(willHit) {
    if (particles.drops.length >= state.dropBudget) return;
    const velocityZ = randomBetween(...state.config.VZ);
    const flightTime = (state.config.Z0 - state.config.Z_HIT) / velocityZ;
    const turbulence = randomBetween(0.82, 1.18);
    let screenX;
    let screenY;
    let targetDepth;

    if (willHit) {
      screenX = randomBetween(-0.05, 1.05) * viewport.width;
      screenY = randomBetween(-0.05, 1.05) * viewport.height;
      targetDepth = state.config.Z_HIT;
    } else {
      screenX = randomBetween(-0.1, 1.1) * viewport.width;
      screenY = randomBetween(-0.1, 1.1) * viewport.height;
      targetDepth = state.config.Z0;
    }

    const windOffsetX = willHit ? state.windX * turbulence * flightTime : 0;
    const windOffsetY = willHit ? state.windY * turbulence * flightTime : 0;
    particles.drops.push({
      x: (screenX - viewport.cx) * targetDepth / viewport.focal - windOffsetX,
      y: (screenY - viewport.cy) * targetDepth / viewport.focal - windOffsetY,
      z: state.config.Z0,
      startZ: state.config.Z0,
      velocityZ,
      turbulence,
      radius: randomBetween(...state.config.R_DROP),
      age: 0,
      previousX: null,
      previousY: null,
      ...createWander(),
    });
  }

  function createFarParticle(z) {
    const screenX = randomBetween(-0.1, 1.1) * viewport.width;
    const screenY = randomBetween(-0.1, 1.1) * viewport.height;
    return {
      x: (screenX - viewport.cx) * z / viewport.focal,
      y: (screenY - viewport.cy) * z / viewport.focal,
      z,
      velocityZ: randomBetween(...state.config.FAR_VZ),
      radius: randomBetween(0.006, 0.016),
      turbulence: randomBetween(0.8, 1.2),
      ...createWander(),
    };
  }

  function seedFarParticles() {
    particles.far.length = 0;
    syncFarParticleCount();
  }

  function syncFarParticleCount() {
    const targetCount = Math.round(state.config.FAR_COUNT * currentAdjustment().amount);
    if (particles.far.length > targetCount) particles.far.length = targetCount;
    for (let index = particles.far.length; index < targetCount; index += 1) {
      particles.far.push(createFarParticle(randomBetween(5, 26)));
    }
  }

  function particlePosition(particle) {
    const scale = viewport.focal / Math.max(particle.z, state.config.Z_HIT);
    const wanderX = particle.wanderAmplitude
      ? particle.wanderAmplitude * particle.z * Math.sin(state.time * particle.wanderFrequency + particle.wanderPhase)
      : 0;
    const wanderY = particle.wanderAmplitude
      ? particle.wanderAmplitude * particle.z * Math.cos(state.time * particle.wanderFrequency * 0.83 + particle.wanderPhase * 1.7)
      : 0;
    return {
      x: viewport.cx + (particle.x + wanderX) * scale,
      y: viewport.cy + (particle.y + wanderY) * scale,
      scale,
    };
  }

  function moveParticle(particle, deltaTime) {
    particle.z -= particle.velocityZ * deltaTime;
    particle.x += state.windX * particle.turbulence * deltaTime;
    particle.y += state.windY * particle.turbulence * deltaTime;
  }

  function particleColor(alpha) {
    const [red, green, blue] = state.config.COOL.map(Math.trunc);
    return `rgba(${red},${green},${blue},${alpha * state.weatherLevel})`;
  }

  function addImpact(x, y, radius) {
    if (!state.config.SPLASH) {
      particles.splashes.push({ settles: true, x, y, radius, progress: 0, life: randomBetween(2.2, 3.8) });
      return;
    }
    const crown = Array.from({ length: 5 + Math.floor(Math.random() * 7) }, () => ({
      angle: Math.random() * TAU,
      velocity: randomBetween(0.6, 1.5),
      scale: randomBetween(0.15, 0.4),
    }));
    particles.splashes.push({
      settles: false,
      x,
      y,
      radius,
      progress: 0,
      life: randomBetween(1.4, 2.1),
      crown,
    });
  }

  function weatherIntensity() {
    const speed = state.config.CYCLE;
    const longWave = 0.5 + 0.5 * Math.sin(state.time * speed / 47);
    const slowWave = 0.5 + 0.5 * Math.sin(state.time * speed / 113 + 1.7);
    const shortWave = 0.5 + 0.5 * Math.sin(state.time * speed / 19 + 0.4);
    const combined = 0.45 * longWave + 0.40 * slowWave + 0.15 * shortWave;
    return clamp(0.10 + 0.90 * combined ** 1.55, 0, 1) * (reducedMotion ? 0.35 : 1);
  }

  function updateTransition(deltaTime) {
    const active = state.transition;
    if (!active) return;
    active.elapsed += deltaTime;

    if (active.phase === 'out') {
      state.weatherLevel = active.from * (1 - smoothstep(active.elapsed / TRANSITION.out));
      if (active.elapsed >= TRANSITION.out) beginTransitionPhase('pause');
      return;
    }
    if (active.phase === 'pause') {
      state.weatherLevel = 0;
      if (active.elapsed >= TRANSITION.pause) {
        applyMode(active.target, true);
        beginTransitionPhase('in');
      }
      return;
    }

    state.weatherLevel = smoothstep(active.elapsed / TRANSITION.in);
    state.skyBlend = smootherstep(active.elapsed / TRANSITION.sky);
    if (active.elapsed >= TRANSITION.sky) {
      state.weatherLevel = 1;
      state.skyBlend = 1;
      state.previousSky = null;
      state.transition = null;
    }
  }

  function beginTransitionPhase(phase) {
    state.transition.phase = phase;
    state.transition.elapsed = 0;
  }

  function isStormActive() {
    return state.mode === 'rain' && state.storm;
  }

  function boltSettings() {
    return isStormActive()
      ? { amplitude: STORM.boltAmplitude, gap: STORM.boltGap }
      : { amplitude: state.config.BOLT_AMP, gap: state.config.BOLT_GAP };
  }

  function updateWind(intensity) {
    const stormMultiplier = isStormActive() ? STORM.windMultiplier : 1;
    const strength = (0.35 + 0.65 * intensity) * stormMultiplier;
    state.windX = state.config.WIND * strength
      * (Math.sin(state.time / 61) * 0.75 + Math.sin(state.time / 23 + 1.1) * 0.35);
    state.windY = state.config.WIND * strength
      * (Math.sin(state.time / 79 + 2.2) * 0.45 + Math.sin(state.time / 31) * 0.20);
  }

  function updateBolts(deltaTime) {
    const { amplitude, gap } = boltSettings();
    if (state.weatherLevel > 0.95 && amplitude > 0 && state.time > state.nextBolt) {
      state.nextBolt = state.time + randomBetween(...gap);
      particles.bolts.push({
        time: 0,
        sequence: [[0, 0.45 * amplitude, 0.30], [0.22, amplitude, 0.70]],
      });
    }
    for (let index = particles.bolts.length - 1; index >= 0; index -= 1) {
      particles.bolts[index].time += deltaTime;
      if (particles.bolts[index].time > 2.2) particles.bolts.splice(index, 1);
    }
  }

  function flashLevel() {
    let level = 0;
    for (const bolt of particles.bolts) {
      for (const [offset, amplitude, decay] of bolt.sequence) {
        const elapsed = bolt.time - offset;
        if (elapsed > 0) level += amplitude * Math.exp(-elapsed / decay);
      }
    }
    return clamp(level, 0, 1) * state.weatherLevel;
  }

  function emitParticles(deltaTime, intensity) {
    const motionFactor = reducedMotion ? 0.4 : 1;
    const amount = currentAdjustment().amount;
    const rateAt = ([minimum, maximum]) => interpolate(minimum, maximum, intensity);
    state.hitAccumulator += deltaTime * state.weatherLevel * rateAt(state.config.HIT_RATE) * motionFactor * amount;
    state.passAccumulator += deltaTime * state.weatherLevel * rateAt(state.config.PASS_RATE) * motionFactor * amount;
    while (state.hitAccumulator >= 1) {
      state.hitAccumulator -= 1;
      spawnDrop(true);
    }
    while (state.passAccumulator >= 1) {
      state.passAccumulator -= 1;
      spawnDrop(false);
    }
  }

  function update(deltaTime) {
    state.time += deltaTime;
    updateTransition(deltaTime);
    updateNight(deltaTime);
    const intensity = weatherIntensity();
    updateWind(intensity);
    updateBolts(deltaTime);
    emitParticles(deltaTime, intensity);
    safelyUpdateAmbientAudio();
  }

  function updateNight(deltaTime) {
    const difference = state.nightTarget - state.nightLevel;
    if (difference === 0) return;
    const step = Math.min(Math.abs(difference), deltaTime / DAY_NIGHT_DURATION);
    state.nightLevel += Math.sign(difference) * step;
  }

  function currentSky() {
    if (!state.previousSky || state.skyBlend >= 1) return layers.sky.element;
    const mixed = layers.mixedSky.context;
    mixed.clearRect(0, 0, viewport.width, viewport.height);
    mixed.globalAlpha = 1;
    mixed.drawImage(layers.previousSky.element, 0, 0, viewport.width, viewport.height);
    mixed.globalAlpha = state.skyBlend;
    mixed.drawImage(layers.sky.element, 0, 0, viewport.width, viewport.height);
    mixed.globalAlpha = 1;
    return layers.mixedSky.element;
  }

  function drawBackground() {
    context.globalCompositeOperation = 'source-over';
    const exposure = state.previousSky
      ? interpolate(state.previousSky.EXPOSURE, state.config.EXPOSURE, state.skyBlend)
      : state.config.EXPOSURE;
    context.globalAlpha = 1 - exposure;
    context.drawImage(currentSky(), 0, 0, viewport.width, viewport.height);
    context.globalAlpha = 1;
    drawNightAtmosphere();
    drawClearAtmosphere();

    const flash = flashLevel();
    if (flash <= 0.003) return;
    context.globalAlpha = flash;
    context.drawImage(layers.flash.element, 0, 0, viewport.width, viewport.height);
    context.globalAlpha = 1;
  }

  function drawClearAtmosphere() {
    if (state.mode !== 'clear' || state.weatherLevel <= 0) return;

    const visibility = state.weatherLevel * (1 - state.nightLevel);
    if (visibility <= 0.001) return;
    const shortSide = Math.min(viewport.width, viewport.height);
    const sunX = viewport.width * 0.76 + Math.sin(state.time / 80) * shortSide * 0.01;
    const sunY = viewport.height * 0.18 + Math.cos(state.time / 95) * shortSide * 0.007;
    const pulse = 0.95 + Math.sin(state.time / 7) * 0.05;
    const haloRadius = shortSide * 0.50 * pulse;

    context.save();
    context.globalCompositeOperation = 'screen';

    const atmosphere = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, haloRadius);
    atmosphere.addColorStop(0, `rgb(255 242 200 / ${22 * visibility}%)`);
    atmosphere.addColorStop(0.20, `rgb(255 224 175 / ${10 * visibility}%)`);
    atmosphere.addColorStop(1, 'rgb(255 220 170 / 0%)');
    context.fillStyle = atmosphere;
    context.fillRect(0, 0, viewport.width, viewport.height);

    const bloomRadius = Math.max(44, shortSide * 0.095) * pulse;
    const bloom = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, bloomRadius);
    bloom.addColorStop(0, `rgb(255 253 234 / ${96 * visibility}%)`);
    bloom.addColorStop(0.11, `rgb(255 247 215 / ${78 * visibility}%)`);
    bloom.addColorStop(0.40, `rgb(255 230 180 / ${22 * visibility}%)`);
    bloom.addColorStop(1, 'rgb(255 220 170 / 0%)');
    context.fillStyle = bloom;
    context.beginPath();
    context.arc(sunX, sunY, bloomRadius, 0, TAU);
    context.fill();

    const flareVectorX = viewport.cx - sunX;
    const flareVectorY = viewport.cy - sunY;
    const flares = [
      { position: 0.44, radius: shortSide * 0.024, alpha: 0.055 },
      { position: 0.75, radius: shortSide * 0.045, alpha: 0.032 },
      { position: 1.11, radius: shortSide * 0.016, alpha: 0.065 },
    ];
    for (const flare of flares) {
      const x = sunX + flareVectorX * flare.position;
      const y = sunY + flareVectorY * flare.position;
      const gradient = context.createRadialGradient(x, y, 0, x, y, flare.radius);
      gradient.addColorStop(0, `rgb(220 245 255 / ${flare.alpha * 100 * visibility}%)`);
      gradient.addColorStop(0.55, `rgb(190 225 255 / ${flare.alpha * 35 * visibility}%)`);
      gradient.addColorStop(1, 'rgb(180 220 255 / 0%)');
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, flare.radius, 0, TAU);
      context.fill();
    }

    context.restore();
  }

  function drawNightAtmosphere() {
    if (state.mode !== 'clear' || state.nightLevel <= 0.001 || state.weatherLevel <= 0) return;

    const visibility = state.weatherLevel * state.nightLevel;
    const shortSide = Math.min(viewport.width, viewport.height);
    context.save();
    context.globalCompositeOperation = 'source-over';

    const nightSky = context.createLinearGradient(0, 0, 0, viewport.height);
    nightSky.addColorStop(0, `rgb(5 10 24 / ${98 * visibility}%)`);
    nightSky.addColorStop(0.55, `rgb(9 16 32 / ${97 * visibility}%)`);
    nightSky.addColorStop(1, `rgb(7 13 28 / ${98 * visibility}%)`);
    context.fillStyle = nightSky;
    context.fillRect(0, 0, viewport.width, viewport.height);

    context.globalCompositeOperation = 'screen';
    const skyRadius = Math.hypot(viewport.width, viewport.height) / 2;
    const rotation = state.time * STAR_ROTATION_SPEED;
    for (const star of STARS) {
      const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(state.time * star.speed + star.phase));
      const angle = star.angle + rotation;
      const distance = star.distance * skyRadius;
      const x = viewport.cx + Math.cos(angle) * distance;
      const y = viewport.cy + Math.sin(angle) * distance;
      if (x < -2 || x > viewport.width + 2 || y < -2 || y > viewport.height + 2) continue;
      context.fillStyle = `rgb(224 236 255 / ${twinkle * 72 * visibility}%)`;
      context.beginPath();
      context.arc(x, y, star.radius, 0, TAU);
      context.fill();
    }

    drawShootingStars(visibility, shortSide);
    context.restore();
  }

  function drawShootingStars(visibility, shortSide) {
    for (const meteor of SHOOTING_STARS) {
      const age = (state.time + meteor.offset) % meteor.period;
      if (age > meteor.duration) continue;
      const progress = age / meteor.duration;
      const alpha = Math.sin(progress * Math.PI) * visibility;
      const headX = (meteor.x + meteor.dx * progress) * viewport.width;
      const headY = (meteor.y + meteor.dy * progress) * viewport.height;
      const length = shortSide * 0.085;
      const angle = Math.atan2(meteor.dy * viewport.height, meteor.dx * viewport.width);
      const tailX = headX - Math.cos(angle) * length;
      const tailY = headY - Math.sin(angle) * length;
      const trail = context.createLinearGradient(tailX, tailY, headX, headY);
      trail.addColorStop(0, 'rgb(210 230 255 / 0%)');
      trail.addColorStop(1, `rgb(235 245 255 / ${68 * alpha}%)`);
      context.strokeStyle = trail;
      context.lineWidth = 1.1;
      context.beginPath();
      context.moveTo(tailX, tailY);
      context.lineTo(headX, headY);
      context.stroke();
    }
  }

  function drawFarParticles(deltaTime) {
    context.lineCap = 'round';
    for (const particle of particles.far) {
      moveParticle(particle, deltaTime);
      if (particle.z < 5) {
        Object.assign(particle, createFarParticle(26 + Math.random() * 4));
        continue;
      }
      const position = particlePosition(particle);
      if (position.x < -40 || position.x > viewport.width + 40
          || position.y < -40 || position.y > viewport.height + 40) {
        Object.assign(particle, createFarParticle(randomBetween(18, 30)));
        continue;
      }

      const radius = Math.max(0.9, particle.radius * position.scale);
      const alpha = 0.035 * state.config.GAIN * state.config.A_FAR
        * clamp((26 - particle.z) / 10, 0, 1) * clamp((particle.z - 5) / 3.5, 0, 1);
      context.strokeStyle = particleColor(alpha);
      context.lineWidth = radius * 1.6;
      context.beginPath();
      context.moveTo(position.x, position.y);
      context.lineTo(
        position.x - ((position.x - viewport.cx) * 0.02 + state.windX * 3) * state.config.STREAK,
        position.y - ((position.y - viewport.cy) * 0.02 + state.windY * 3) * state.config.STREAK,
      );
      context.stroke();
    }
  }

  function drawLargeDrop(drop, position, radius, velocityX, velocityY, length, alpha) {
    const softness = clamp(
      state.config.SOFT + (1 - state.config.SOFT) * clamp((0.35 - drop.z) / 0.30, 0, 1),
      0,
      1,
    );
    const outerRadius = radius * (1 + 0.75 * softness);
    const innerRadius = radius * (1 - softness) * 0.75;
    const gradient = context.createRadialGradient(
      position.x, position.y, innerRadius, position.x, position.y, outerRadius,
    );
    gradient.addColorStop(0, particleColor(alpha * 0.90));
    gradient.addColorStop(0.55, particleColor(alpha * (0.30 + 0.42 * (1 - softness))));
    gradient.addColorStop(1, particleColor(0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(position.x, position.y, outerRadius, 0, TAU);
    context.fill();

    if (length <= 1.5) return;
    context.strokeStyle = particleColor(alpha * 0.35);
    context.lineWidth = radius * 0.9;
    strokeTrail(position, velocityX, velocityY);
  }

  function strokeTrail(position, velocityX, velocityY) {
    context.beginPath();
    context.moveTo(position.x, position.y);
    context.lineTo(position.x - velocityX, position.y - velocityY);
    context.stroke();
  }

  function drawDropShape(drop, position, radius, alpha) {
    if (drop.previousX === null) return;
    let velocityX = (position.x - drop.previousX) * state.config.STREAK;
    let velocityY = (position.y - drop.previousY) * state.config.STREAK;
    const length = Math.hypot(velocityX, velocityY);
    const maximumLength = radius * 5.5 + 6;
    if (length > maximumLength) {
      velocityX *= maximumLength / length;
      velocityY *= maximumLength / length;
    }

    if (radius > 4) {
      drawLargeDrop(drop, position, radius, velocityX, velocityY, length, alpha);
    } else if (length > 1.2) {
      context.strokeStyle = particleColor(alpha);
      context.lineWidth = Math.max(1, radius * 1.9);
      strokeTrail(position, velocityX, velocityY);
    } else {
      context.fillStyle = particleColor(alpha);
      context.beginPath();
      context.arc(position.x, position.y, Math.max(0.7, radius), 0, TAU);
      context.fill();
    }
  }

  function isOutsideViewport(position, radius, margin) {
    return position.x < -radius - margin || position.x > viewport.width + radius + margin
      || position.y < -radius - margin || position.y > viewport.height + radius + margin;
  }

  function drawDrops(deltaTime) {
    for (let index = particles.drops.length - 1; index >= 0; index -= 1) {
      const drop = particles.drops[index];
      drop.age += deltaTime;
      moveParticle(drop, deltaTime);
      const position = particlePosition(drop);
      const radius = drop.radius * position.scale;

      if (drop.z <= state.config.Z_HIT) {
        if (state.impactsEnabled && !isOutsideViewport(position, 0, 60)) {
          addImpact(position.x, position.y, radius);
        }
        particles.drops.splice(index, 1);
        continue;
      }
      if (isOutsideViewport(position, radius, 80)) {
        if (drop.z < state.config.Z0 * 0.75) {
          particles.drops.splice(index, 1);
        } else {
          drop.previousX = position.x;
          drop.previousY = position.y;
        }
        continue;
      }

      const fade = clamp(drop.age / 0.60, 0, 1) * clamp((drop.startZ - drop.z) / 0.35, 0, 1);
      const alpha = clamp(state.config.A_BASE, 0, state.config.A_CAP) * state.config.GAIN * fade;
      drawDropShape(drop, position, radius, alpha);
      drop.previousX = position.x;
      drop.previousY = position.y;
    }
  }

  function drawSettlingSplash(splash, remaining, easedProgress) {
    const radius = splash.radius * (1 + 0.30 * easedProgress);
    const gradient = context.createRadialGradient(
      splash.x, splash.y, radius * 0.35, splash.x, splash.y, radius * 1.3,
    );
    gradient.addColorStop(0, particleColor(remaining * 0.34 * state.config.GAIN));
    gradient.addColorStop(0.6, particleColor(remaining * 0.14 * state.config.GAIN));
    gradient.addColorStop(1, particleColor(0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(splash.x, splash.y, radius * 1.3, 0, TAU);
    context.fill();
  }

  function drawSplashCrown(splash, remaining, easedProgress) {
    for (const bead of splash.crown) {
      const distance = (splash.radius + 70 * bead.velocity) * easedProgress;
      context.fillStyle = particleColor(remaining * 0.26 * state.config.GAIN);
      context.beginPath();
      context.arc(
        splash.x + Math.cos(bead.angle) * distance,
        splash.y + Math.sin(bead.angle) * distance,
        Math.max(1, splash.radius * bead.scale * remaining),
        0,
        TAU,
      );
      context.fill();
    }
  }

  function drawSplashes(deltaTime) {
    context.globalCompositeOperation = 'lighter';
    for (let index = particles.splashes.length - 1; index >= 0; index -= 1) {
      const splash = particles.splashes[index];
      splash.progress += deltaTime / splash.life;
      if (splash.progress >= 1) {
        particles.splashes.splice(index, 1);
        continue;
      }
      const remaining = 1 - splash.progress;
      const easedProgress = 1 - remaining ** 2.4;
      if (splash.settles) drawSettlingSplash(splash, remaining, easedProgress);
      else drawSplashCrown(splash, remaining, easedProgress);
    }
    context.globalCompositeOperation = 'source-over';
  }

  function render(deltaTime) {
    drawBackground();
    drawFarParticles(deltaTime);
    drawDrops(deltaTime);
    drawSplashes(deltaTime);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const deltaTime = Math.min((now - state.lastFrame) / 1000, MAX_FRAME_TIME);
    state.lastFrame = now;
    update(deltaTime);
    render(deltaTime);
  }

  function clearWeatherParticles() {
    for (const group of [particles.drops, particles.splashes, particles.bolts]) group.length = 0;
    state.hitAccumulator = 0;
    state.passAccumulator = 0;
  }

  function applyMode(name, blendSky = false) {
    if (blendSky) {
      state.previousSky = {
        SKY: state.config.SKY,
        GRAIN: state.config.GRAIN,
        EXPOSURE: state.config.EXPOSURE,
      };
      state.skyBlend = 0;
    }
    state.mode = name;
    state.config = { ...BASE, ...MODES[name] };
    repaintSkies();
    clearWeatherParticles();
    updateDropBudget();
    seedFarParticles();
    state.nextBolt = state.time + randomBetween(...boltSettings().gap) * 0.5;
  }

  function updateButtons(selectedMode) {
    for (const [name, button] of Object.entries(buttons)) {
      const isSelected = name === selectedMode;
      button.classList.toggle('on', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    }
    const isAdjustable = Boolean(state.adjustments[selectedMode]);
    const hasSettings = isAdjustable || selectedMode === 'clear';
    settingsButton.hidden = !hasSettings;
    if (!hasSettings) setSettingsOpen(false);
    amountSetting.hidden = !isAdjustable;
    impactButton.hidden = !isAdjustable;
    stormButton.hidden = selectedMode !== 'rain';
    nightButton.hidden = selectedMode !== 'clear';
    updateStormButton();
    updateImpactButton();
    updateNightButton();
    updateSoundButton();
  }

  function updateStormButton() {
    stormButton.classList.toggle('on', state.storm);
    stormButton.setAttribute('aria-checked', String(state.storm));
    stormButton.setAttribute('aria-label', state.storm ? '雷雨を解除' : '雷雨に切り替え');
  }

  function toggleStorm() {
    state.storm = !state.storm;
    particles.bolts.length = 0;
    state.nextBolt = state.storm
      ? state.time + randomBetween(1, 3)
      : state.time + randomBetween(...state.config.BOLT_GAP);
    updateStormButton();
    saveStormPreference();
    showControls();
  }

  function updateImpactButton() {
    impactButton.classList.toggle('on', state.impactsEnabled);
    impactButton.setAttribute('aria-checked', String(state.impactsEnabled));
    impactButton.setAttribute(
      'aria-label',
      state.impactsEnabled ? '画面への付着を無効にする' : '画面への付着を有効にする',
    );
  }

  function toggleImpacts() {
    state.impactsEnabled = !state.impactsEnabled;
    if (!state.impactsEnabled) particles.splashes.length = 0;
    updateImpactButton();
    saveImpactPreference();
    showControls();
  }

  function updateNightButton() {
    const isNight = state.nightTarget === 1;
    nightButton.classList.toggle('on', isNight);
    nightButton.setAttribute('aria-checked', String(isNight));
    nightButton.setAttribute('aria-label', isNight ? '昼に切り替え' : '夜に切り替え');
  }

  function toggleNight() {
    state.nightTarget = state.nightTarget ? 0 : 1;
    if (state.nightTarget === 1) stopDaySounds();
    updateNightButton();
    saveNightPreference();
    showControls();
  }

  function updateSoundButton() {
    soundButton.classList.toggle('on', state.soundEnabled);
    soundButton.setAttribute('aria-checked', String(state.soundEnabled));
    soundButton.setAttribute('aria-label', state.soundEnabled ? '環境音を停止' : '環境音を再生');
    volumeControl.disabled = !state.soundEnabled;
    const percentage = Math.round(state.volume * 100);
    volumeControl.value = String(percentage);
    volumeValue.value = `${percentage}%`;
  }

  function toggleSound() {
    const shouldEnable = !state.soundEnabled;
    state.soundEnabled = shouldEnable;
    updateSoundButton();
    showControls();

    if (!shouldEnable) {
      stopDaySounds();
      safelyUpdateAmbientAudio(true);
      return;
    }

    try {
      if (!ambientAudio) ambientAudio = createAmbientAudio();
      if (!ambientAudio) {
        state.soundEnabled = false;
        updateSoundButton();
        soundButton.setAttribute('aria-label', 'このブラウザでは環境音を再生できません');
        return;
      }
      ambientAudio.resetSchedule();
      safelyUpdateAmbientAudio(true);
      if (!ambientAudio) return;
      if (ambientAudio.state === 'suspended') {
        ambientAudio.resume()
          .then(() => safelyUpdateAmbientAudio(true))
          .catch(disableAmbientAudio);
      }
    } catch (error) {
      disableAmbientAudio(error);
    }
  }

  function setVolume(percentage) {
    state.volume = clamp(percentage / 100, 0, 1);
    volumeValue.value = `${Math.round(state.volume * 100)}%`;
    saveVolumePreference();
    safelyUpdateAmbientAudio(true);
    showControls();
  }

  function selectedMode() {
    return state.transition ? state.transition.target : state.mode;
  }

  function updateAdjustmentControls(mode = selectedMode()) {
    const values = state.adjustments[mode];
    if (!values) return;
    controls.amount.min = String(AMOUNT_CONTROL.min);
    controls.amount.max = String(AMOUNT_CONTROL.max);
    for (const name of Object.keys(controls)) {
      const percentage = Math.round(values[name] / AMOUNT_CONTROL.base * 100);
      controls[name].value = String(percentage);
      controlValues[name].value = `${percentage}%`;
    }
  }

  function setAdjustment(name, percentage) {
    const mode = selectedMode();
    state.adjustments[mode][name] = AMOUNT_CONTROL.base * percentage / 100;
    controlValues[name].value = `${percentage}%`;
    saveAdjustments();

    if (mode === state.mode && name === 'amount') {
      updateDropBudget();
      syncFarParticleCount();
    }
  }

  function setSettingsOpen(isOpen) {
    settingsPanel.classList.toggle('open', isOpen);
    settingsPanel.setAttribute('aria-hidden', String(!isOpen));
    settingsButton.setAttribute('aria-expanded', String(isOpen));
  }

  function toggleSettings() {
    const isOpen = settingsButton.getAttribute('aria-expanded') !== 'true';
    setSettingsOpen(isOpen);
    if (isOpen) updateAdjustmentControls();
    showControls();
  }

  function setMode(name) {
    if (!MODES[name]) return;
    if (name === selectedMode()) return;
    state.transition = { target: name, phase: 'out', elapsed: 0, from: state.weatherLevel };
    updateButtons(name);
    if (state.adjustments[name]) updateAdjustmentControls(name);
    try {
      history.replaceState(null, '', `#${name}`);
    } catch {
      // file:// など History API が利用できない環境でも描画は継続する。
    }
  }

  function showControls() {
    document.body.classList.remove('idle');
    clearTimeout(state.idleTimer);
    const delay = settingsButton.getAttribute('aria-expanded') === 'true' ? 6000 : 2600;
    state.idleTimer = setTimeout(() => {
      document.body.classList.add('idle');
      setSettingsOpen(false);
    }, delay);
  }

  function bindEvents() {
    const labels = { clear: '晴', rain: '雨', snow: '雪' };
    for (const [name, button] of Object.entries(buttons)) {
      button.textContent = labels[name];
      button.addEventListener('click', () => {
        setMode(name);
        showControls();
      });
    }
    settingsButton.addEventListener('click', toggleSettings);
    stormButton.addEventListener('click', toggleStorm);
    impactButton.addEventListener('click', toggleImpacts);
    nightButton.addEventListener('click', toggleNight);
    soundButton.addEventListener('click', toggleSound);
    volumeControl.addEventListener('input', () => setVolume(Number(volumeControl.value)));
    for (const [name, control] of Object.entries(controls)) {
      control.addEventListener('input', () => {
        setAdjustment(name, Number(control.value));
        showControls();
      });
    }
    addEventListener('pointermove', showControls, { passive: true });
    addEventListener('pointerdown', event => {
      showControls();
      if (settingsButton.getAttribute('aria-expanded') === 'true'
          && !settingsPanel.contains(event.target)
          && !settingsButton.contains(event.target)) {
        setSettingsOpen(false);
      }
    }, { passive: true });
    addEventListener('resize', resize);
  }

  function initialize() {
    state.config = { ...BASE, ...MODES[state.mode] };
    resize();
    applyMode(state.mode);
    updateButtons(state.mode);
    if (state.adjustments[state.mode]) updateAdjustmentControls(state.mode);
    bindEvents();
    showControls();
    requestAnimationFrame(frame);
  }

  initialize();
})();
