import { $, h } from './dom.js';
import { toast } from './modal.js';
import { api, ApiError } from '../services/api.js';

/**
 * AI 自由聊天面板。对话历史和好感度裁剪都在服务端，这里只负责展示和把结果回传给引擎。
 */
export class ChatPanel {
  constructor(root, { audio }) {
    this.root = root;
    this.audio = audio;
    this.list = $('.chat-list', root);
    this.form = $('.chat-form', root);
    this.input = $('.chat-input', root);
    this.sendBtn = $('.chat-send', root);
    this.endBtn = $('.chat-end', root);
    this.roundsEl = $('.chat-rounds', root);
    this.providerEl = $('.chat-provider', root);
    this.suggestEl = $('.chat-suggestions', root);
    this.titleEl = $('.chat-title', root);
    // 面板内交互不推进剧情
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /**
   * @param {object} o
   * @param {string} o.node
   * @param {object} o.chat           节点上的 chat 配置
   * @param {{id,name,color}} o.character
   * @param {number} o.affection      当前好感度
   * @param {object} [o.resume]       { used, totalDelta, log } 刷新页面后继续
   * @param {(r: {expression, delta, reply, text}) => void} o.onReply
   * @param {(p: object) => void} o.onProgress
   * @returns {Promise<{ used: number, totalDelta: number }>}
   */
  async run({ node, chat, character, affection, resume, onReply, onProgress }) {
    this.list.replaceChildren();
    this.input.value = '';
    this.titleEl.textContent = `和${character.name}聊天`;
    this.root.classList.remove('hidden', 'finished');
    this.root.style.setProperty('--her-color', character.color ?? '#ffa3bd');

    let session;
    try {
      session = await api.chatStart({ node, affection, resume: resume ? { used: resume.used, totalDelta: resume.totalDelta } : undefined });
    } catch (e) {
      toast(`聊天服务不可用：${e.message}`, { type: 'error' });
      this.root.classList.add('hidden');
      return { used: 0, totalDelta: 0 };
    }

    const state = { used: resume?.used ?? 0, totalDelta: resume?.totalDelta ?? 0, log: [...(resume?.log ?? [])], rounds: session.rounds };
    this.providerEl.textContent = session.provider === 'anthropic' ? `Claude · ${session.model}` : '离线模式';
    this.providerEl.title = session.provider === 'anthropic' ? '由大模型实时生成' : '未配置 API Key，使用规则回复';

    for (const m of state.log) this.bubble(m.who, m.text, character);
    if (!state.log.length && session.opening) {
      this.bubble('her', session.opening, character);
      state.log.push({ who: 'her', text: session.opening });
    }
    this.renderSuggestions(session.suggestions);
    this.updateRounds(state);

    return new Promise((resolve) => {
      const finish = async () => {
        this.form.onsubmit = null;
        this.endBtn.onclick = null;
        this._abort = null;
        api.chatEnd(session.chatId).catch(() => {});
        this.root.classList.add('hidden');
        resolve({ used: state.used, totalDelta: state.totalDelta });
      };
      this._abort = finish;

      const send = async (text) => {
        text = text.trim();
        if (!text || this.busy || state.used >= state.rounds) return;
        this.busy = true;
        this.input.value = '';
        this.suggestEl.replaceChildren();
        this.bubble('me', text, character);
        state.log.push({ who: 'me', text });
        const typing = this.bubble('her', '', character, true);
        this.setEnabled(false);
        try {
          const r = await api.chatMessage({ chatId: session.chatId, text });
          typing.remove();
          this.bubble('her', r.reply, character, false, r.delta);
          this.audio.sfx('message');
          state.log.push({ who: 'her', text: r.reply });
          state.used = state.rounds - r.roundsLeft;
          state.totalDelta = r.totalDelta;
          onReply({ ...r, text });
          if (r.degraded) this.providerEl.textContent = '离线模式（接口异常已降级）';
        } catch (e) {
          typing.remove();
          if (e instanceof ApiError && e.status === 410) {
            toast('聊天已过期，继续剧情吧', { type: 'error' });
            state.used = state.rounds;
          } else {
            toast(e.message, { type: 'error' });
          }
        } finally {
          this.busy = false;
          this.updateRounds(state);
          onProgress({ used: state.used, totalDelta: state.totalDelta, log: state.log.slice(-20) });
          if (state.used < state.rounds) this.setEnabled(true);
        }
      };

      this.form.onsubmit = (e) => {
        e.preventDefault();
        send(this.input.value);
      };
      this.suggestEl.onclick = (e) => {
        const b = e.target.closest('button');
        if (b) send(b.textContent);
      };
      this.endBtn.onclick = finish;
      this.setEnabled(state.used < state.rounds);
      if (matchMedia('(pointer: fine)').matches) this.input.focus();
    });
  }

  /** 读档 / 回标题时中止正在进行的聊天 */
  abort() {
    this._abort?.();
  }

  updateRounds(state) {
    const left = Math.max(0, state.rounds - state.used);
    this.roundsEl.textContent = left ? `还能聊 ${left} 句` : '蜡烛快燃尽了';
    const done = left === 0;
    this.root.classList.toggle('finished', done);
    this.endBtn.textContent = done ? '继续剧情 ▶' : '结束聊天';
  }

  setEnabled(on) {
    this.input.disabled = !on;
    this.sendBtn.disabled = !on;
  }

  renderSuggestions(list = []) {
    this.suggestEl.replaceChildren(...list.map((s) => h('button', { type: 'button', class: 'chip' }, s)));
  }

  bubble(who, text, character, typing = false, delta = 0) {
    const el = h(
      'div',
      { class: `bubble bubble-${who} ${typing ? 'typing' : ''}` },
      who === 'her' ? h('span', { class: 'bubble-name' }, character.name) : null,
      h('p', {}, typing ? h('span', { class: 'dots' }, h('i'), h('i'), h('i')) : text),
      delta ? h('span', { class: `bubble-delta ${delta > 0 ? 'up' : 'down'}` }, `${delta > 0 ? '+' : ''}${delta} ♥`) : null,
    );
    this.list.append(el);
    this.list.scrollTop = this.list.scrollHeight;
    return el;
  }
}
