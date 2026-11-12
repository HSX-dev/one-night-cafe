import { $ } from './dom.js';

/**
 * 舞台渲染：背景 / 立绘 / CG 三层都用"双缓冲 img + opacity 过渡"实现淡入淡出，
 * 新图 decode 完成后才开始切换，避免闪白。
 */
class Crossfader {
  constructor(a, b) {
    this.front = a;
    this.back = b;
    this.src = null;
    this.token = 0;
  }

  async set(src, { instant = false } = {}) {
    if (src === this.src) return;
    this.src = src;
    const token = ++this.token;
    if (!src) {
      this.front.classList.remove('visible');
      return;
    }
    const next = this.back;
    next.classList.toggle('instant', instant);
    this.front.classList.toggle('instant', instant);
    next.src = src;
    let broken = false;
    try {
      await next.decode();
    } catch {
      broken = true; // 图片加载失败：照常推进流程，但不显示破图图标
    }
    next.classList.toggle('broken', broken);
    if (token !== this.token) return; // 期间又切了别的图
    next.classList.add('visible');
    this.front.classList.remove('visible');
    [this.front, this.back] = [next, this.front];
  }
}

class Rain {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.on = false;
    this.drops = [];
    this.raf = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.scale = dpr;
  }

  set(on) {
    if (on === this.on) return;
    this.on = on;
    this.canvas.classList.toggle('visible', on);
    if (on && !this.raf) {
      this.drops = Array.from({ length: 140 }, () => this.spawn(true));
      const tick = () => {
        this.draw();
        this.raf = this.on || this.canvas.classList.contains('visible') ? requestAnimationFrame(tick) : 0;
      };
      this.raf = requestAnimationFrame(tick);
    }
    if (!on) setTimeout(() => cancelAnimationFrame(this.raf) || (this.raf = 0), 800);
  }

  spawn(anywhere = false) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const z = Math.random();
    return { x: Math.random() * w * 1.2, y: anywhere ? Math.random() * h : -20, len: (10 + z * 22) * this.scale, speed: (8 + z * 14) * this.scale, alpha: 0.12 + z * 0.3 };
  }

  draw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1.2 * this.scale;
    ctx.lineCap = 'round';
    for (const d of this.drops) {
      ctx.strokeStyle = `rgba(200,215,255,${d.alpha})`;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.18, d.y + d.len);
      ctx.stroke();
      d.y += d.speed;
      d.x -= d.speed * 0.18;
      if (d.y > canvas.height) Object.assign(d, this.spawn());
    }
  }
}

export class Stage {
  constructor(root, story, audio) {
    this.root = root;
    this.story = story;
    this.audio = audio;
    this.bg = new Crossfader($('.bg-a', root), $('.bg-b', root));
    this.char = new Crossfader($('.char-a', root), $('.char-b', root));
    this.cg = new Crossfader($('.cg-a', root), $('.cg-b', root));
    this.cgLayer = $('.layer-cg', root);
    this.cgUnlockBtn = $('.cg-unlock', root);
    this.tint = $('.layer-tint', root);
    this.rain = new Rain($('.layer-weather', root));
    this.scene = null;
  }

  /** 按引擎的 stage 状态同步画面（幂等，重复调用没有副作用） */
  apply(stage, { instant = false } = {}) {
    const scene = this.story.scenes[stage.scene];
    if (scene) {
      this.bg.set(scene.bg, { instant });
      this.tint.dataset.tint = scene.tint ?? '';
    }
    const sprites = this.story.characters[stage.char]?.sprites;
    this.char.set(sprites && stage.expression ? sprites[stage.expression] : null, { instant });
    this.rain.set(stage.weather === 'rain');
    this.audio.setWeather(stage.weather);
    this.audio.playBgm(stage.bgm);
  }

  setExpression(charId, expression) {
    const src = this.story.characters[charId]?.sprites?.[expression];
    if (src) this.char.set(src);
  }

  /** CG：locked 时显示模糊预览 + 解锁按钮 */
  setCg(src, { locked = false, onUnlock = null } = {}) {
    this.cg.set(src);
    this.cgLayer.classList.toggle('active', Boolean(src));
    this.cgLayer.classList.toggle('locked', locked);
    this.cgUnlockBtn.hidden = !locked;
    this.cgUnlockBtn.onclick = locked
      ? (e) => {
          e.stopPropagation();
          onUnlock?.();
        }
      : null;
  }

  fx(name) {
    const el = name === 'flash' ? $('.layer-flash', this.root) : $('.stage-inner', this.root);
    const cls = `fx-${name}`;
    el.classList.remove(cls);
    void el.offsetWidth; // 重新触发动画
    el.classList.add(cls);
  }
}
