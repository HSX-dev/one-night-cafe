import { $ } from './dom.js';
import { StoryEngine } from '../engine/StoryEngine.js';
import { Stage } from './Stage.js';
import { Dialogue } from './Dialogue.js';
import { Hud } from './Hud.js';
import { ChatPanel } from './Chat.js';
import { renderChoices } from './choices.js';
import { openSaveLoad, openBacklog, openSettings, showEnding } from './menus.js';
import { hasOpenModal, closeTopModal, confirmDialog, toast } from './modal.js';
import { analytics, newPlayId } from '../services/analytics.js';
import { saves, settings as settingsStore, readLog, gallery } from '../services/storage.js';
import { api } from '../services/api.js';

/**
 * 游戏控制器：把 StoryEngine 的 step 渲染到画面上，处理输入、自动/快进、存读档、付费墙、AI 聊天。
 */
export class Game {
  constructor({ root, story, session, audio, paywall, onExit }) {
    this.root = root;
    this.story = story;
    this.session = session;
    this.audio = audio;
    this.paywall = paywall;
    this.onExit = onExit;
    this.settings = settingsStore.get();

    this.stage = new Stage(root, story, audio);
    this.dialogue = new Dialogue($('.dialogue', root));
    this.hud = new Hud($('.hud', root), story);
    this.chat = new ChatPanel($('.chat', root), { audio });
    this.choicesEl = $('.choices', root);

    this.mode = 'normal'; // normal | auto | skip
    this.ctrlSkip = false;
    this.renderToken = 0;
    this.shownCg = null;
    this.chatProgress = null;
    this.debug = new URLSearchParams(location.search).has('debug');

    this._bindInput();
  }

  // ───────────────────────── 生命周期 ─────────────────────────

  start(record = null) {
    this.step = null;
    this.chat.abort();
    this.root.classList.remove('chatting');
    this.engine = new StoryEngine(this.story, { onEvent: (n, p) => this._onEngineEvent(n, p) });
    this.shownCg = null;
    this.stage.setCg(null);
    this.setMode('normal');
    this.root.classList.add('in-game');

    let step;
    if (record) {
      try {
        this.playId = record.meta.playId ?? newPlayId();
        analytics.setPlay(this.playId);
        step = this.engine.load(record.state);
        this.chatProgress = record.meta.chat?.node === step.node ? record.meta.chat : null;
        analytics.track('game_load', { node: step.node });
        if (record.meta.storyVersion !== this.story.meta.version) toast('剧情已更新，存档可能与新版本有出入');
      } catch (e) {
        toast(`读档失败：${e.message}`, { type: 'error' });
        return this.start(null);
      }
    } else {
      this.playId = newPlayId();
      this.chatProgress = null;
      analytics.setPlay(this.playId);
      analytics.track('game_start', {});
      step = this.engine.newGame();
    }
    this.hud.set(this.engine.state.affection, { animate: false });
    this.render(step, { restoring: Boolean(record) });
  }

  exit() {
    this.setMode('normal');
    this.renderToken++;
    clearTimeout(this.autoTimer);
    this.step = null;
    this.chat.abort();
    this.choicesEl.classList.add('hidden');
    this.root.classList.remove('in-game', 'chatting');
    analytics.flush();
    this.onExit();
  }

  // ───────────────────────── 渲染 ─────────────────────────

  async render(step, { restoring = false } = {}) {
    this.step = step;
    const token = ++this.renderToken;
    clearTimeout(this.autoTimer);
    this.choicesEl.classList.add('hidden');
    this.stage.apply(this.engine.state.stage, { instant: restoring || this.mode === 'skip' });
    this._debugInfo();

    await this._syncCg(this.engine.state.stage.cg);
    if (token !== this.renderToken) return;

    switch (step.type) {
      case 'line':
        return this._renderLine(step, { restoring, token });
      case 'choices':
        return this._renderChoices(step);
      case 'chat':
        return this._renderChat(step);
      case 'ending':
        return this._renderEnding(step);
    }
  }

  async _renderLine(step, { restoring, token }) {
    const { line } = step;
    if (!restoring && line.sfx) this.audio.sfx(line.sfx);
    if (!restoring && line.fx && this.mode !== 'skip') this.stage.fx(line.fx);

    const wasRead = readLog.has(step.key);
    const skipping = this.mode === 'skip' || this.ctrlSkip;
    this.autosave();
    await this.dialogue.show(step.speaker, step.text, {
      speed: this.settings.textSpeed,
      instant: skipping,
      variant: step.speaker?.id === 'player' ? 'player' : '',
    });
    readLog.add(step.key);
    if (token !== this.renderToken) return;

    if (skipping) {
      if (wasRead || this.settings.skipUnread) {
        this.autoTimer = setTimeout(() => this.next(), 60);
      } else {
        this.setMode('normal');
        this.ctrlSkip = false;
        toast('已停在未读文本');
      }
    } else if (this.mode === 'auto') {
      const delay = (900 + Array.from(step.text).length * 70) * this.settings.autoDelay;
      this.autoTimer = setTimeout(() => this.next(), delay);
    }
  }

  _renderChoices(step) {
    if (this.mode === 'skip') this.setMode('normal');
    this.ctrlSkip = false;
    if (step.prompt) this.dialogue.show(null, step.prompt, { instant: true });
    this.autosave();
    renderChoices(this.choicesEl, step.options, (index) => {
      this.audio.sfx('select');
      this.choicesEl.classList.add('hidden');
      this.render(this.engine.choose(index));
    });
  }

  async _renderChat(step) {
    this.setMode('normal');
    this.dialogue.setVisible(false);
    this.root.classList.add('chatting');
    this.autosave();
    const charId = step.chat.character;
    const character = this.engine.speakerInfo(charId);
    const resume = this.chatProgress?.node === step.node ? this.chatProgress : null;
    if (!resume) this.chatProgress = { node: step.node, used: 0, totalDelta: 0, log: [] };

    const result = await this.chat.run({
      node: step.node,
      chat: step.chat,
      character,
      affection: this.engine.state.affection,
      resume,
      onReply: (r) => {
        this.engine.logExternal({ speaker: 'player', text: r.text, chat: true });
        this.engine.logExternal({ speaker: charId, text: r.reply, chat: true });
        this.engine.state.stage.char = charId;
        this.engine.state.stage.expression = r.expression;
        this.stage.setExpression(charId, r.expression);
        if (r.delta) this.engine.adjustAffection(r.delta, 'chat');
      },
      onProgress: (p) => {
        this.chatProgress = { node: step.node, ...p };
        this.autosave();
      },
    });
    if (this.step !== step) return; // 聊天中途读档/退出：后续交给新的流程，这里什么都不动
    this.root.classList.remove('chatting');
    this.chatProgress = null;
    this.render(this.engine.endChat(result));
  }

  _renderEnding(step) {
    this.setMode('normal');
    this.dialogue.setVisible(false);
    saves.clearAuto();
    analytics.flush();
    setTimeout(() => {
      showEnding({
        ending: step.ending,
        affection: this.engine.state.affection,
        onTitle: () => this.exit(),
        onRestart: () => this.start(null),
      });
    }, 600);
  }

  /** CG 同步：付费 CG 未解锁时弹付费墙；跳过则显示模糊预览 + 解锁按钮 */
  async _syncCg(cgId) {
    if (cgId === this.shownCg) return;
    this.shownCg = cgId;
    if (!cgId) return this.stage.setCg(null);
    const cg = this.story.cgs[cgId];

    if (!cg.paid) {
      this.stage.setCg(cg.image);
      gallery.addCg(cgId);
      analytics.track('cg_view', { cgId });
      return;
    }
    if (this.session.unlocks.has(cgId)) {
      this.stage.setCg(api.cgUrl(cgId));
      analytics.track('cg_view', { cgId, paid: true });
      return;
    }

    this.setMode('normal');
    this.ctrlSkip = false;
    const unlockLater = async () => {
      if ((await this.paywall.request(cgId, { source: 'stage' })) === 'unlocked' && this.shownCg === cgId) {
        this.stage.setCg(api.cgUrl(cgId));
        analytics.track('cg_view', { cgId, paid: true });
      }
    };
    this.stage.setCg(cg.preview, { locked: true, onUnlock: unlockLater });
    const r = await this.paywall.request(cgId, { source: 'story' });
    if (r === 'unlocked' && this.shownCg === cgId) {
      this.stage.setCg(api.cgUrl(cgId));
      analytics.track('cg_view', { cgId, paid: true });
    }
  }

  // ───────────────────────── 推进 / 模式 ─────────────────────────

  next() {
    clearTimeout(this.autoTimer);
    if (this.step?.type !== 'line') return;
    this.render(this.engine.advance());
  }

  /** 点击屏幕 */
  advanceInput() {
    if (!this.root.classList.contains('in-game') || hasOpenModal()) return;
    if (this.step?.type !== 'line') return;
    if (this.mode === 'skip') return this.setMode('normal');
    if (this.dialogue.typing) return this.dialogue.complete();
    this.next();
  }

  setMode(mode) {
    this.mode = this.mode === mode ? 'normal' : mode;
    if (mode === 'normal') this.mode = 'normal';
    this.root.dataset.mode = this.mode;
    clearTimeout(this.autoTimer);
    // 切到自动/快进时，如果当前句已经显示完，立刻开始推进
    if (this.mode !== 'normal' && this.step?.type === 'line' && !this.dialogue.typing && !hasOpenModal()) {
      this.autoTimer = setTimeout(() => this.next(), this.mode === 'skip' ? 60 : 600);
    }
  }

  // ───────────────────────── 存档 ─────────────────────────

  makeRecord() {
    const state = this.engine.snapshot();
    const last = [...state.backlog].reverse().find((b) => b.text);
    return {
      state,
      meta: {
        playId: this.playId,
        savedAt: Date.now(),
        storyVersion: this.story.meta.version,
        node: state.cursor.node,
        nodeTitle: this.story.nodes[state.cursor.node]?.title ?? state.cursor.node,
        scene: state.stage.scene,
        affection: state.affection,
        text: last ? last.text.slice(0, 40) : '',
        chat: this.chatProgress,
      },
    };
  }

  autosave() {
    if (this.engine?.state) saves.saveAuto(this.makeRecord());
  }

  // ───────────────────────── 事件 & 输入 ─────────────────────────

  _onEngineEvent(name, p) {
    switch (name) {
      case 'node':
        analytics.track('node_enter', { node: p.node });
        break;
      case 'affection':
        this.hud.set(p.value);
        this.hud.pop(p.delta, p.source === 'chat' ? '聊天' : '');
        this.audio.sfx(p.delta > 0 ? 'heart_up' : 'heart_down');
        break;
      case 'choice':
        analytics.track('choice', { node: p.node, index: p.index });
        break;
      case 'ending':
        gallery.addEnding(p.ending);
        analytics.track('ending', { ending: p.ending, affection: this.engine.state.affection });
        break;
      case 'chat_end':
        analytics.track('chat_end', { node: p.node, used: p.used, totalDelta: p.totalDelta });
        break;
    }
  }

  async handleAction(action) {
    this.audio.sfx('click');
    switch (action) {
      case 'auto':
        return this.setMode('auto');
      case 'skip':
        return this.setMode('skip');
      case 'log':
        return openBacklog(this.engine.state.backlog, (id) => this.engine.speakerInfo(id));
      case 'save':
        return openSaveLoad({ mode: 'save', story: this.story, makeRecord: () => this.makeRecord() });
      case 'load':
        return openSaveLoad({ mode: 'load', story: this.story, makeRecord: () => this.makeRecord(), onLoad: (rec) => this.start(rec) });
      case 'settings':
        return openSettings((s) => this.applySettings(s));
      case 'title':
        if (await confirmDialog('回到标题画面？进度已自动保存，可以从「继续游戏」回来。', { ok: '回到标题' })) this.exit();
        return;
    }
  }

  applySettings(s) {
    this.settings = s;
    this.audio.applySettings(s);
  }

  _bindInput() {
    const stageInner = $('.stage-inner', this.root);
    stageInner.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, .chat, .choices, .hud, .quickmenu')) return;
      this.advanceInput();
    });
    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn && this.root.classList.contains('in-game')) {
        e.stopPropagation();
        this.handleAction(btn.dataset.action);
      }
    });
    stageInner.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY < 0 && this.root.classList.contains('in-game') && !hasOpenModal() && this.step?.type === 'line') this.handleAction('log');
      },
      { passive: true },
    );
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return closeTopModal();
      if (!this.root.classList.contains('in-game') || hasOpenModal()) return;
      if (e.target.closest?.('input, textarea')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.advanceInput();
      } else if (e.key === 'Control' && !this.ctrlSkip && this.step?.type === 'line') {
        this.ctrlSkip = true;
        this.next();
      } else if (e.key.toLowerCase() === 'a') this.setMode('auto');
      else if (e.key.toLowerCase() === 'h' || e.key === 'ArrowUp') this.handleAction('log');
    });
    addEventListener('keyup', (e) => {
      if (e.key === 'Control') this.ctrlSkip = false;
    });
  }

  _debugInfo() {
    if (!this.debug) return;
    const s = this.engine.state;
    let el = $('.debug', this.root);
    if (!el) {
      el = document.createElement('pre');
      el.className = 'debug';
      $('.stage-inner', this.root).append(el);
    }
    el.textContent = `node: ${s.cursor.node} (${s.cursor.phase} ${s.cursor.i})\naffection: ${s.affection}\nflags: ${JSON.stringify(s.flags)}`;
  }
}
