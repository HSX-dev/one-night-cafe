import { $ } from './dom.js';

const LONG_PAUSE = new Set(['。', '！', '？', '…', '!', '?']);
const SHORT_PAUSE = new Set(['，', '、', '；', ',', '—']);

/** 对话框 + 打字机效果 */
export class Dialogue {
  constructor(root) {
    this.root = root;
    this.nameEl = $('.nameplate', root);
    this.textEl = $('.dialogue-text', root);
    this.typing = false;
    this._finish = null;
  }

  setVisible(v) {
    this.root.classList.toggle('hidden', !v);
  }

  /**
   * @returns {Promise<void>} 文字全部显示完成时 resolve
   */
  show(speaker, text, { speed = 35, instant = false, variant = '' } = {}) {
    this._cancel();
    this.setVisible(true);
    this.root.classList.toggle('narration', !speaker);
    this.root.dataset.variant = variant;
    this.nameEl.textContent = speaker?.name ?? '';
    this.nameEl.style.setProperty('--speaker-color', speaker?.color ?? '#ffffff');
    this.root.classList.remove('done');

    const chars = Array.from(text);
    if (instant || speed <= 0) {
      this.textEl.textContent = text;
      this.root.classList.add('done');
      return Promise.resolve();
    }

    this.typing = true;
    this.textEl.textContent = '';
    return new Promise((resolve) => {
      let i = 0;
      let timer = 0;
      const finish = () => {
        clearTimeout(timer);
        this.textEl.textContent = text;
        this.typing = false;
        this._finish = null;
        this.root.classList.add('done');
        resolve();
      };
      this._finish = finish;
      const tick = () => {
        i++;
        this.textEl.textContent = chars.slice(0, i).join('');
        if (i >= chars.length) return finish();
        const c = chars[i - 1];
        const delay = LONG_PAUSE.has(c) ? speed * 5 : SHORT_PAUSE.has(c) ? speed * 2.5 : speed;
        timer = setTimeout(tick, delay);
      };
      timer = setTimeout(tick, speed);
    });
  }

  /** 正在打字时点击 → 立即显示全文 */
  complete() {
    this._finish?.();
  }

  _cancel() {
    this._finish?.();
  }
}
