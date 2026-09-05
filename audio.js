(() => {
  'use strict';

  const randomBetween = (min, max) => min + Math.random() * (max - min);

  function createNoiseBuffer(audioContext, duration, colored = false) {
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.84 + white * 0.16;
      data[index] = colored ? previous * 0.78 + white * 0.22 : white;
    }
    return buffer;
  }

  function create() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    const context = new AudioContextClass();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    const buffers = {
      white: createNoiseBuffer(context, 4),
      colored: createNoiseBuffer(context, 5, true),
    };

    const createNoiseLayer = (buffer, type, frequency, q = 0.5) => {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start();
      return { filter, gain: gain.gain };
    };

    const layers = {
      rainBody: createNoiseLayer(buffers.colored, 'bandpass', 760, 0.38),
      rainDetail: createNoiseLayer(buffers.white, 'highpass', 3400, 0.28),
      snowBody: createNoiseLayer(buffers.colored, 'lowpass', 360, 0.65),
      snowHowl: createNoiseLayer(buffers.colored, 'bandpass', 780, 5.5),
    };
    const schedule = { rainDrop: 0, bird: 0, insect: 0 };
    const activeBirds = new Set();
    let lastUpdate = -Infinity;

    function setTarget(audioParam, value, timeConstant = 0.7) {
      const now = context.currentTime;
      if (typeof audioParam.cancelScheduledValues === 'function') {
        audioParam.cancelScheduledValues(now);
      }
      if (typeof audioParam.setTargetAtTime === 'function') {
        audioParam.setTargetAtTime(value, now, timeConstant);
      } else {
        audioParam.value = value;
      }
    }

    function playRainDrop(delay = 0) {
      const now = context.currentTime + delay;
      const duration = randomBetween(0.035, 0.09);
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const panner = typeof context.createStereoPanner === 'function'
        ? context.createStereoPanner()
        : null;
      source.buffer = buffers.white;
      source.playbackRate.value = randomBetween(0.8, 1.3);
      filter.type = 'bandpass';
      filter.frequency.value = randomBetween(1100, 4800);
      filter.Q.value = randomBetween(0.7, 1.8);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(randomBetween(0.012, 0.032), now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter);
      filter.connect(gain);
      if (panner) {
        panner.pan.value = randomBetween(-0.9, 0.9);
        gain.connect(panner);
        panner.connect(master);
      } else {
        gain.connect(master);
      }
      source.start(now);
      source.stop(now + duration + 0.01);
    }

    function playDayBird() {
      const now = context.currentTime;
      const base = randomBetween(3000, 3800);
      const pan = randomBetween(-0.75, 0.75);
      const phrase = Array.from({ length: 2 + Math.floor(Math.random() * 4) }, (_, index) => [
        index * randomBetween(0.13, 0.21),
        randomBetween(0.07, 0.12),
        randomBetween(1.05, 1.2),
        randomBetween(0.82, 0.98),
      ]);
      for (const [offset, duration, startScale, endScale] of phrase) {
        const start = now + offset;
        const oscillator = context.createOscillator();
        const vibrato = context.createOscillator();
        const vibratoDepth = context.createGain();
        const gain = context.createGain();
        const panner = typeof context.createStereoPanner === 'function'
          ? context.createStereoPanner()
          : null;
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(base * startScale, start);
        oscillator.frequency.exponentialRampToValueAtTime(base * endScale, start + duration);
        vibrato.type = 'sine';
        vibrato.frequency.value = randomBetween(12, 18);
        vibratoDepth.gain.value = randomBetween(24, 42);
        vibrato.connect(vibratoDepth);
        vibratoDepth.connect(oscillator.frequency);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(randomBetween(0.012, 0.018), start + duration * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        if (panner) {
          panner.pan.value = pan;
          gain.connect(panner);
          panner.connect(master);
        } else {
          gain.connect(master);
        }
        activeBirds.add(oscillator);
        oscillator.onended = () => activeBirds.delete(oscillator);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.02);
        vibrato.start(start);
        vibrato.stop(start + duration + 0.02);
      }
    }

    function playNightInsect() {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = randomBetween(4050, 4550);
      gain.gain.setValueAtTime(0.0001, now);
      for (let pulse = 0; pulse < 5; pulse += 1) {
        const start = now + pulse * 0.07;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.038, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.037);
      }
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now);
      oscillator.stop(now + 0.38);
    }

    function update(scene, force = false) {
      const now = context.currentTime;
      if (!force && now - lastUpdate < 0.1) return;
      lastUpdate = now;

      const isClear = scene.mode === 'clear';
      const isRain = scene.mode === 'rain';
      const isSnow = scene.mode === 'snow';
      const rainMotion = 0.97 + 0.03 * Math.sin(scene.time / 3.7);
      const snowGust = 0.62
        + 0.25 * (0.5 + 0.5 * Math.sin(scene.time / 8.5))
        + 0.13 * (0.5 + 0.5 * Math.sin(scene.time / 3.1 + 1.4));
      const howlCycle = 0.5 + 0.5 * Math.sin(scene.time / 7.2 + 2);
      setTarget(master.gain, scene.enabled ? scene.volume * 0.9 : 0, 0.22);
      setTarget(layers.rainBody.gain, isRain ? 0.055 * rainMotion * scene.weatherLevel : 0);
      setTarget(layers.rainDetail.gain, isRain ? 0.006 * scene.weatherLevel : 0);
      setTarget(layers.snowBody.gain, isSnow ? 0.09 * snowGust * scene.weatherLevel : 0);
      setTarget(
        layers.snowBody.filter.frequency,
        330 + 70 * (0.5 + 0.5 * Math.sin(scene.time / 10.5 + 0.8)),
        1.1,
      );
      setTarget(
        layers.snowHowl.gain,
        isSnow ? 0.15 * (0.5 + 0.5 * howlCycle) * scene.weatherLevel : 0,
      );
      setTarget(layers.snowHowl.filter.frequency, 560 + 520 * howlCycle ** 2, 0.9);

      if (scene.enabled && isRain && scene.weatherLevel > 0.2 && now >= schedule.rainDrop) {
        const count = 1 + Math.floor(Math.random() * 3);
        for (let drop = 0; drop < count; drop += 1) {
          playRainDrop(drop * randomBetween(0.015, 0.04));
        }
        schedule.rainDrop = now + randomBetween(0.07, 0.14);
      }
      if (scene.enabled && isClear && scene.nightTarget === 0 && scene.nightLevel < 0.05
          && now >= schedule.bird) {
        playDayBird();
        schedule.bird = now + randomBetween(5, 11);
      }
      if (scene.enabled && isClear && scene.nightTarget === 1 && scene.nightLevel > 0.8
          && now >= schedule.insect) {
        playNightInsect();
        schedule.insect = now + randomBetween(5, 10);
      }
    }

    function stopDaySounds() {
      for (const oscillator of activeBirds) {
        try {
          oscillator.stop();
        } catch {
          // すでに停止済みの場合は何もしない。
        }
      }
      activeBirds.clear();
    }

    function resetSchedule() {
      const now = context.currentTime;
      schedule.rainDrop = now;
      schedule.bird = now + randomBetween(2, 6);
      schedule.insect = now + randomBetween(1, 3);
    }

    return {
      get state() {
        return context.state;
      },
      update,
      resetSchedule,
      stopDaySounds,
      resume: () => context.resume(),
      close: () => context.close(),
    };
  }

  window.SkywardAudio = Object.freeze({ create });
})();
