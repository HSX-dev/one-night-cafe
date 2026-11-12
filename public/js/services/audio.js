/**
 * 音频：BGM / 音效 / 雨声环境音。
 *
 * 剧情 JSON 的 audio.bgm / audio.sfx 里每一项可以是：
 *   { "src": "assets/audio/xxx.mp3" }  —— 真实音频文件（HTMLAudio 播放，自动循环 BGM）
 *   { "synth": "cafe" }                —— 内置 WebAudio 程序化合成（Demo 无版权音频，全部用合成）
 *
 * 浏览器要求用户手势后才能出声，所以 unlock() 在"点击进入"时调用。
 */

const NOTE = (name) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + base + acc;
};
const FREQ = (midi) => 440 * 2 ** ((midi - 69) / 12);
const chord = (s) => s.split(' ').map(NOTE);

/** BGM 预设：和弦进行 + 速度 + 乐器组合 */
const BGM_PRESETS = {
  title: { bpm: 68, beatsPerChord: 8, chords: ['F3 A3 C4 E4', 'E3 G3 B3 D4', 'D3 F3 A3 C4', 'C3 E3 G3 B3'], pad: 0.05, arp: { type: 'triangle', gain: 0.05, pattern: [0, 2, 1, 3, 2, 1], every: 1, octave: 12 } },
  cafe: { bpm: 78, beatsPerChord: 4, chords: ['D3 F3 A3 C4 E4', 'G2 F3 B3 E4', 'C3 E3 G3 B3 D4', 'A2 G3 C4 E4'], pad: 0.025, keys: { gain: 0.07, rhythm: [0, 1.5, 2.5] }, bass: 0.09, arp: { type: 'sine', gain: 0.03, pattern: [4, 3, 2, 3], every: 0.5, octave: 12, swing: 0.12 } },
  candle: { bpm: 56, beatsPerChord: 8, chords: ['A2 E3 B3 C4', 'F2 C3 E3 A3', 'D3 F3 A3 E4', 'E2 B2 E3 G#3'], pad: 0.06, bell: { gain: 0.035, every: 3 } },
  stars: { bpm: 64, beatsPerChord: 8, chords: ['C3 G3 B3 E4', 'B2 G3 A3 D4', 'A2 E3 G3 C4', 'F2 C3 E3 A3'], pad: 0.045, arp: { type: 'sine', gain: 0.035, pattern: [0, 1, 2, 3, 2, 1, 3, 2], every: 0.5, octave: 24 } },
  tender: { bpm: 56, beatsPerChord: 8, chords: ['F2 C3 E3 A3', 'G2 D3 E3 B3', 'E2 B2 D3 G3', 'A2 E3 G3 B3 C4'], pad: 0.05, keys: { gain: 0.06, rhythm: [0, 3, 4.5] }, bass: 0.06 },
  dawn: { bpm: 80, beatsPerChord: 4, chords: ['C3 E3 G3 B3 D4', 'F3 A3 C4 E4', 'A2 E3 G3 C4', 'G2 D3 G3 B3'], pad: 0.03, keys: { gain: 0.06, rhythm: [0, 1, 2.5, 3] }, bass: 0.07, arp: { type: 'triangle', gain: 0.03, pattern: [0, 2, 4, 2], every: 0.5, octave: 12 } },
};

export class AudioManager {
  constructor(story, settings) {
    this.story = story;
    this.settings = settings;
    this.ctx = null;
    this.currentBgm = undefined;
    this.bgmVoice = null;
    this.rain = null;
    this.weather = null;
  }

  /** 必须在用户手势里调用 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const comp = this.ctx.createDynamicsCompressor();
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.connect(comp);
    this.bgmBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.bgmBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.noise = this._makeNoise();
    this.applySettings(this.settings);
    // 解锁前就请求过的 BGM / 天气，现在补上
    const pending = this.currentBgm;
    this.currentBgm = undefined;
    if (pending) this.playBgm(pending);
    if (this.weather) this.setWeather(this.weather, true);
  }

  applySettings(s) {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bgmBus.gain.setTargetAtTime(s.bgmOn ? s.bgmVolume : 0, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(s.sfxOn ? s.sfxVolume : 0, t, 0.05);
    if (this.fileBgm) this.fileBgm.volume = s.bgmOn ? s.bgmVolume : 0;
  }

  // ───────────── BGM ─────────────

  playBgm(key) {
    if (key === this.currentBgm) return;
    this.currentBgm = key;
    if (!this.ctx) return; // 等 unlock 后再播
    this._stopBgm();
    if (!key) return;
    const def = this.story.audio?.bgm?.[key];
    if (!def) return;
    if (def.src) return this._playFileBgm(def.src);
    const preset = BGM_PRESETS[def.synth];
    if (preset) this.bgmVoice = this._startSequencer(preset);
  }

  _stopBgm() {
    if (this.bgmVoice) {
      this.bgmVoice.stop();
      this.bgmVoice = null;
    }
    if (this.fileBgm) {
      const a = this.fileBgm;
      this.fileBgm = null;
      const fade = setInterval(() => {
        a.volume = Math.max(0, a.volume - 0.05);
        if (a.volume <= 0) {
          clearInterval(fade);
          a.pause();
        }
      }, 50);
    }
  }

  _playFileBgm(src) {
    const a = new Audio(src);
    a.loop = true;
    a.volume = this.settings.bgmOn ? this.settings.bgmVolume : 0;
    a.play().catch(() => {});
    this.fileBgm = a;
  }

  /** 简单的前瞻调度音序器：和弦 pad + 电钢琴和弦 + 琶音 + 贝斯 + 铃声 */
  _startSequencer(p) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    out.connect(filter).connect(this.bgmBus);

    const beat = 60 / p.bpm;
    const chords = p.chords.map(chord);
    let step = 0; // 以 0.5 拍为单位
    let next = ctx.currentTime + 0.1;
    let stopped = false;

    const schedule = () => {
      while (!stopped && next < ctx.currentTime + 0.4) {
        const beatPos = step / 2;
        const chordIdx = Math.floor(beatPos / p.beatsPerChord) % chords.length;
        const inChord = beatPos % p.beatsPerChord;
        const notes = chords[chordIdx];
        const t = next;

        if (inChord === 0 && p.pad) for (const n of notes) this._pad(out, FREQ(n), t, beat * p.beatsPerChord, p.pad / notes.length);
        if (inChord === 0 && p.bass) this._pluck(out, FREQ(notes[0] - 12), t, 'sine', p.bass, beat * 2);
        if (p.keys && p.keys.rhythm.includes(inChord)) {
          for (const n of notes.slice(1)) this._pluck(out, FREQ(n + 12), t, 'sine', p.keys.gain / notes.length, beat * 1.6, true);
        }
        if (p.arp && (beatPos / p.arp.every) % 1 === 0) {
          const i = Math.round(beatPos / p.arp.every) % p.arp.pattern.length;
          const n = notes[p.arp.pattern[i] % notes.length] + p.arp.octave;
          const swing = p.arp.swing && i % 2 ? p.arp.swing * beat : 0;
          this._pluck(out, FREQ(n), t + swing, p.arp.type, p.arp.gain, beat * 1.2);
        }
        if (p.bell && inChord % p.bell.every === 0 && Math.random() < 0.6) {
          const n = notes[Math.floor(Math.random() * notes.length)] + 24;
          this._bell(out, FREQ(n), t, p.bell.gain);
        }
        step++;
        next += beat / 2;
      }
    };
    schedule();
    const timer = setInterval(schedule, 100);
    return {
      stop: () => {
        stopped = true;
        clearInterval(timer);
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        setTimeout(() => out.disconnect(), 2500);
      },
    };
  }

  _pad(out, freq, t, dur, gain) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(1.2, dur * 0.3));
    g.gain.setTargetAtTime(0, t + dur * 0.85, 0.5);
    g.connect(out);
    f.connect(g);
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 2);
    }
  }

  _pluck(out, freq, t, type, gain, dur, tremolo = false) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    if (tremolo) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5;
      lg.gain.value = gain * 0.3;
      lfo.connect(lg).connect(g.gain);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _bell(out, freq, t, gain, dur = 2.5) {
    for (const [ratio, g] of [[1, 1], [2.76, 0.35], [5.4, 0.12]]) this._pluck(out, freq * ratio, t, 'sine', gain * g, dur / ratio ** 0.3);
  }

  // ───────────── 环境音：雨 ─────────────

  setWeather(weather, force = false) {
    if (weather === this.weather && !force) return;
    this.weather = weather;
    if (!this.ctx) return;
    if (this.rain) {
      const r = this.rain;
      r.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
      setTimeout(() => r.src.stop(), 3000);
      this.rain = null;
    }
    if (weather === 'rain') {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.12, this.ctx.currentTime, 1);
      src.connect(hp).connect(lp).connect(gain).connect(this.bgmBus);
      src.start();
      this.rain = { src, gain };
    }
  }

  // ───────────── 音效 ─────────────

  /** 剧情音效（JSON 里配置的 key）或内置 UI 音效名 */
  sfx(key) {
    if (!this.ctx || !this.settings.sfxOn) return;
    const def = this.story.audio?.sfx?.[key];
    if (def?.src) {
      const a = new Audio(def.src);
      a.volume = this.settings.sfxVolume;
      a.play().catch(() => {});
      return;
    }
    const name = def?.synth ?? key;
    const t = this.ctx.currentTime + 0.01;
    const out = this.sfxBus;
    switch (name) {
      case 'click':
        this._pluck(out, 1400, t, 'sine', 0.08, 0.05);
        break;
      case 'select':
        this._pluck(out, FREQ(NOTE('E5')), t, 'triangle', 0.12, 0.15);
        this._pluck(out, FREQ(NOTE('B5')), t + 0.07, 'triangle', 0.12, 0.25);
        break;
      case 'open':
        this._noiseBurst(out, t, 0.18, 2500, 0.15, 'bandpass');
        break;
      case 'bell':
        this._bell(out, FREQ(NOTE('E6')), t, 0.18, 2);
        this._bell(out, FREQ(NOTE('C6')), t + 0.18, 0.16, 2.5);
        break;
      case 'thunder':
        this._noiseBurst(out, t, 0.25, 3000, 0.6, 'highpass');
        this._noiseBurst(out, t + 0.05, 3.5, 300, 1.2, 'lowpass', 80);
        break;
      case 'heart_up':
        ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => this._pluck(out, FREQ(NOTE(n)), t + i * 0.06, 'sine', 0.1, 0.4));
        break;
      case 'heart_down':
        ['G5', 'Eb5', 'C5'].forEach((n, i) => this._pluck(out, FREQ(NOTE(n)), t + i * 0.09, 'triangle', 0.08, 0.4));
        break;
      case 'coin':
        this._pluck(out, FREQ(NOTE('B5')), t, 'square', 0.05, 0.12);
        this._pluck(out, FREQ(NOTE('E6')), t + 0.09, 'square', 0.05, 0.5);
        this._bell(out, FREQ(NOTE('E7')), t + 0.1, 0.05, 1.2);
        break;
      case 'message':
        this._pluck(out, FREQ(NOTE('A5')), t, 'sine', 0.07, 0.2);
        this._pluck(out, FREQ(NOTE('E6')), t + 0.05, 'sine', 0.05, 0.3);
        break;
    }
  }

  _noiseBurst(out, t, dur, freq, gain, type, sweepTo) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.1);
  }

  _makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
