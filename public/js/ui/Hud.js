import { $, h } from './dom.js';

/** 顶部好感度条 + 变化飘字 */
export class Hud {
  constructor(root, story) {
    this.root = root;
    this.cfg = { min: 0, max: 100, name: '好感度', ...(story.settings?.affection ?? {}) };
    this.fill = $('.aff-fill', root);
    this.valueEl = $('.aff-value', root);
    this.heart = $('.aff-heart', root);
    this.toasts = $('.aff-toasts', root);
    $('.aff-label', root).textContent = this.cfg.name;

    const bar = $('.aff-bar', root);
    for (const m of this.cfg.markers ?? []) {
      bar.append(h('span', { class: 'aff-marker', style: { left: `${this.pct(m.value)}%` }, title: m.label }));
    }
    this.value = null;
  }

  pct(v) {
    return ((v - this.cfg.min) / (this.cfg.max - this.cfg.min)) * 100;
  }

  set(value, { animate = true } = {}) {
    this.fill.classList.toggle('instant', !animate);
    this.fill.style.width = `${this.pct(value)}%`;
    const reached = (this.cfg.markers ?? []).some((m) => value >= m.value);
    this.root.classList.toggle('reached', reached);
    this.animateNumber(this.value ?? value, value, animate);
    this.value = value;
  }

  animateNumber(from, to, animate) {
    cancelAnimationFrame(this.raf);
    if (!animate || from === to) {
      this.valueEl.textContent = to;
      return;
    }
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / 600);
      this.valueEl.textContent = Math.round(from + (to - from) * k);
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** 好感度变化提示：+10 ♥ 飘字 + 心跳动画 */
  pop(delta, reason = '') {
    const el = h('div', { class: `aff-toast ${delta > 0 ? 'up' : 'down'}` }, `${delta > 0 ? '+' : ''}${delta}`, h('small', {}, reason || this.cfg.name));
    this.toasts.append(el);
    setTimeout(() => el.remove(), 1800);
    this.heart.classList.remove('beat', 'break');
    void this.heart.offsetWidth;
    this.heart.classList.add(delta > 0 ? 'beat' : 'break');
  }
}
