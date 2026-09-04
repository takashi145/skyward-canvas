(() => {
  'use strict';

  const DEFAULT_MODE = 'rain';
  const TAU = Math.PI * 2;
  const MAX_FRAME_TIME = 0.05;
  const TRANSITION = Object.freeze({ out: 1.4, pause: 0.35, in: 1.6, sky: 3.2 });
  const BASE = Object.freeze({
    FOV: 0.92,
    MAX_DROPS: 320,
    GRAIN: 0.5,
    Z_HIT: 0.09,
  });
  const MODES = Object.freeze({
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
      SOFT: 1.00,
      A_BASE: 0.07,
      A_CAP: 0.52,
      A_FAR: 1.00,
      SPLASH: true,
      BOLT_AMP: 0.35,
      BOLT_GAP: [70, 180],
      SKY: { c0: [16, 21, 30], c1: [31, 41, 55], f0: [44, 55, 72], f1: [66, 80, 99] },
      COOL: [188, 212, 238],
      CYCLE: 1.0,
    }),
    snow: Object.freeze({
      Z0: 2.2,
      VZ: [0.22, 0.60],
      R_DROP: [0.0035, 0.0115],
      HIT_RATE: [0.4, 2.2],
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

  const canvas = document.getElementById('c');
  const context = canvas.getContext('2d');
  const buttons = {
    rain: document.getElementById('b-rain'),
    snow: document.getElementById('b-snow'),
  };
  const layers = createLayers();
  const particles = { drops: [], far: [], splashes: [], bolts: [] };
  const viewport = { width: 0, height: 0, cx: 0, cy: 0, focal: 0, halfDiagonal: 1, dpr: 1 };
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
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function modeFromLocation() {
    const source = `${location.hash}${location.search}`.toLowerCase();
    if (source.includes('snow')) return 'snow';
    if (source.includes('rain')) return 'rain';
    return DEFAULT_MODE;
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
    viewport.halfDiagonal = Math.hypot(viewport.width, viewport.height) / 2;
    viewport.focal = viewport.cx * state.config.FOV;

    for (const target of [{ element: canvas, context }, ...Object.values(layers)]) {
      target.element.width = Math.round(viewport.width * viewport.dpr);
      target.element.height = Math.round(viewport.height * viewport.dpr);
      target.context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    }
    repaintSkies();
    seedFarParticles();
    state.dropBudget = viewport.width * viewport.height > 900000 ? state.config.MAX_DROPS : 220;
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

    if (willHit) {
      screenX = randomBetween(-0.05, 1.05) * viewport.width;
      screenY = randomBetween(-0.05, 1.05) * viewport.height;
    } else {
      const angle = Math.random() * TAU;
      const radius = viewport.halfDiagonal * randomBetween(1.12, 3.4);
      screenX = viewport.cx + Math.cos(angle) * radius;
      screenY = viewport.cy + Math.sin(angle) * radius;
    }

    particles.drops.push({
      x: (screenX - viewport.cx) * state.config.Z_HIT / viewport.focal - state.windX * turbulence * flightTime,
      y: (screenY - viewport.cy) * state.config.Z_HIT / viewport.focal - state.windY * turbulence * flightTime,
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
    const angle = Math.random() * TAU;
    const radius = viewport.halfDiagonal * randomBetween(0.05, 1.5);
    return {
      x: Math.cos(angle) * radius * 5 / viewport.focal,
      y: Math.sin(angle) * radius * 5 / viewport.focal,
      z,
      velocityZ: randomBetween(...state.config.FAR_VZ),
      radius: randomBetween(0.006, 0.016),
      turbulence: randomBetween(0.8, 1.2),
      ...createWander(),
    };
  }

  function seedFarParticles() {
    particles.far.length = 0;
    for (let index = 0; index < state.config.FAR_COUNT; index += 1) {
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

  function updateWind(intensity) {
    const strength = 0.35 + 0.65 * intensity;
    state.windX = state.config.WIND * strength
      * (Math.sin(state.time / 61) * 0.75 + Math.sin(state.time / 23 + 1.1) * 0.35);
    state.windY = state.config.WIND * strength
      * (Math.sin(state.time / 79 + 2.2) * 0.45 + Math.sin(state.time / 31) * 0.20);
  }

  function updateBolts(deltaTime) {
    if (state.weatherLevel > 0.95 && state.config.BOLT_AMP > 0 && state.time > state.nextBolt) {
      state.nextBolt = state.time + randomBetween(...state.config.BOLT_GAP);
      particles.bolts.push({
        time: 0,
        sequence: [[0, 0.45 * state.config.BOLT_AMP, 0.30], [0.22, state.config.BOLT_AMP, 0.70]],
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
    const rateAt = ([minimum, maximum]) => interpolate(minimum, maximum, intensity);
    state.hitAccumulator += deltaTime * state.weatherLevel * rateAt(state.config.HIT_RATE) * motionFactor;
    state.passAccumulator += deltaTime * state.weatherLevel * rateAt(state.config.PASS_RATE) * motionFactor;
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
    const intensity = weatherIntensity();
    updateWind(intensity);
    updateBolts(deltaTime);
    emitParticles(deltaTime, intensity);
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

    const flash = flashLevel();
    if (flash <= 0.003) return;
    context.globalAlpha = flash;
    context.drawImage(layers.flash.element, 0, 0, viewport.width, viewport.height);
    context.globalAlpha = 1;
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
          || position.y < -40 || position.y > viewport.height + 40) continue;

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
        if (!isOutsideViewport(position, 0, 60)) addImpact(position.x, position.y, radius);
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
    const deltaTime = Math.min((now - state.lastFrame) / 1000, MAX_FRAME_TIME);
    state.lastFrame = now;
    update(deltaTime);
    render(deltaTime);
    requestAnimationFrame(frame);
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
    seedFarParticles();
    state.nextBolt = state.time + randomBetween(...state.config.BOLT_GAP) * 0.5;
  }

  function updateButtons(selectedMode) {
    for (const [name, button] of Object.entries(buttons)) {
      const isSelected = name === selectedMode;
      button.classList.toggle('on', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    }
  }

  function setMode(name) {
    if (!MODES[name]) return;
    const selectedMode = state.transition ? state.transition.target : state.mode;
    if (name === selectedMode) return;
    state.transition = { target: name, phase: 'out', elapsed: 0, from: state.weatherLevel };
    updateButtons(name);
    try {
      history.replaceState(null, '', `#${name}`);
    } catch {
      // file:// など History API が利用できない環境でも描画は継続する。
    }
  }

  function showControls() {
    document.body.classList.remove('idle');
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => document.body.classList.add('idle'), 2600);
  }

  function bindEvents() {
    for (const [name, button] of Object.entries(buttons)) {
      button.textContent = name === 'rain' ? '雨' : '雪';
      button.addEventListener('click', () => {
        setMode(name);
        showControls();
      });
    }
    addEventListener('keydown', event => {
      const modeByKey = { r: 'rain', s: 'snow' };
      const mode = modeByKey[event.key.toLowerCase()];
      if (mode) setMode(mode);
    });
    addEventListener('pointermove', showControls, { passive: true });
    addEventListener('pointerdown', showControls, { passive: true });
    addEventListener('resize', resize);
  }

  function initialize() {
    state.config = { ...BASE, ...MODES[state.mode] };
    resize();
    applyMode(state.mode);
    updateButtons(state.mode);
    bindEvents();
    showControls();
    requestAnimationFrame(frame);
  }

  initialize();
})();
