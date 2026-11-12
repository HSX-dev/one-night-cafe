/**
 * StoryEngine —— 剧情状态机（纯逻辑，无 DOM）。
 *
 * 剧情由 JSON 描述：节点(nodes) → 台词(lines) → 出口(next / branch / choices / chat / ending)。
 * 引擎只负责"现在该显示什么"和"状态怎么变"，渲染、音频、网络全部交给 UI 层通过 step + 事件处理。
 *
 * 状态(state)是一个可 JSON 序列化的普通对象 —— 存档 / 读档就是 snapshot() / load()。
 *
 * step 类型：
 *   { type: 'line',    key, speaker, text, line, stage }
 *   { type: 'choices', node, prompt, options: [{ index, text, locked, hint }] }
 *   { type: 'chat',    node, chat }
 *   { type: 'ending',  node, ending }
 *
 * 事件 onEvent(name, payload)：node / affection / choice / ending / chat_end
 */
import { evalCondition, applyEffects, clampAffection } from './conditions.js';

export const SAVE_FORMAT_VERSION = 1;
const BACKLOG_LIMIT = 300;
const MAX_AUTO_HOPS = 1000; // 防止 next/branch 配成死循环

export function createInitialState(story) {
  const aff = story.settings?.affection ?? {};
  return {
    v: SAVE_FORMAT_VERSION,
    storyVersion: story.meta?.version ?? '0',
    affection: clampAffection(aff.initial ?? 0, aff),
    flags: {},
    cursor: null, // { node, phase: 'lines' | 'reaction' | 'exit', i, choice }
    stage: { scene: null, bgm: null, weather: null, char: null, expression: null, cg: null },
    visited: [],
    choices: [],
    backlog: [],
    ended: null,
  };
}

export class StoryEngine {
  /**
   * @param {object} story 剧情 JSON
   * @param {{ onEvent?: (name: string, payload: object) => void }} [opts]
   */
  constructor(story, opts = {}) {
    this.story = story;
    this.onEvent = opts.onEvent || (() => {});
    this.state = null;
  }

  // ───────────────────────── 公共 API ─────────────────────────

  newGame() {
    this.state = createInitialState(this.story);
    this._enter(this.story.meta.start);
    return this._settle();
  }

  /** 从存档恢复。存档里的节点在新版剧情中被删掉时，回退到开头而不是崩溃。 */
  load(saved) {
    if (!saved || saved.v !== SAVE_FORMAT_VERSION) throw new Error('存档格式不兼容');
    const state = structuredClone(saved);
    if (!state.cursor || !this.story.nodes[state.cursor.node]) {
      throw new Error(`存档中的节点 "${state.cursor?.node}" 在当前剧情中不存在`);
    }
    this.state = state;
    return this.current();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  get affectionSettings() {
    return this.story.settings?.affection ?? { min: 0, max: 100 };
  }

  /** 当前应显示的内容（只读，不改变状态） */
  current() {
    const { cursor } = this.state;
    const node = this.story.nodes[cursor.node];

    if (cursor.phase === 'lines' || cursor.phase === 'reaction') {
      const line = this._lines(node, cursor)[cursor.i];
      return this._lineStep(line, cursor);
    }

    // phase === 'exit'
    if (node.choices) {
      return {
        type: 'choices',
        node: cursor.node,
        prompt: node.prompt ?? null,
        options: node.choices
          .map((c, index) => {
            const ok = evalCondition(c.if, this.state);
            if (!ok && !c.lockedHint) return null; // 不满足且没写提示 → 直接隐藏
            return { index, text: c.text, locked: !ok, hint: ok ? null : c.lockedHint };
          })
          .filter(Boolean),
      };
    }
    if (node.chat) return { type: 'chat', node: cursor.node, chat: node.chat };
    if (node.ending) {
      return { type: 'ending', node: cursor.node, ending: { id: node.ending, ...this.story.endings[node.ending] } };
    }
    throw new Error(`节点 ${cursor.node} 停在了无效出口`);
  }

  /** 推进一句台词 */
  advance() {
    const step = this.current();
    if (step.type !== 'line') return step; // 选项 / 聊天 / 结局 需要专门的操作
    return this._settle();
  }

  /** 选择选项 */
  choose(index) {
    const step = this.current();
    if (step.type !== 'choices') throw new Error('当前不在选项界面');
    const option = step.options.find((o) => o.index === index);
    if (!option || option.locked) throw new Error(`选项 ${index} 不可用`);

    const nodeId = this.state.cursor.node;
    const choice = this.story.nodes[nodeId].choices[index];
    this._pushBacklog({ speaker: 'player', text: choice.text, choice: true });
    this.state.choices.push({ node: nodeId, index, text: choice.text });
    this.onEvent('choice', { node: nodeId, index, text: choice.text });
    this._applyEffects(choice.effects, 'choice');

    this.state.cursor = { node: nodeId, phase: 'reaction', i: -1, choice: index };
    return this._settle();
  }

  /** AI 自由聊天结束 → 走 chat.next */
  endChat(summary = {}) {
    const step = this.current();
    if (step.type !== 'chat') throw new Error('当前不在聊天环节');
    this.onEvent('chat_end', { node: step.node, ...summary });
    this._enter(step.chat.next);
    return this._settle();
  }

  /** 外部（AI 聊天）调整好感度 */
  adjustAffection(delta, source = 'chat') {
    return this._applyEffects({ affection: delta }, source);
  }

  /** 记录一条外部对话到历史（AI 聊天内容也进回看） */
  logExternal(entry) {
    this._pushBacklog(entry);
  }

  /** 剧情里所有角色的显示名 */
  speakerInfo(id) {
    if (!id) return null;
    const c = this.story.characters?.[id];
    if (c) return { id, name: c.name, color: c.color };
    return { id, name: id === 'player' ? '我' : id };
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  _lines(node, cursor) {
    if (cursor.phase === 'reaction') return node.choices[cursor.choice].lines ?? [];
    return node.lines ?? [];
  }

  _lineStep(line, cursor) {
    const reactionPart = cursor.phase === 'reaction' ? `c${cursor.choice}.` : '';
    return {
      type: 'line',
      key: `${cursor.node}#${reactionPart}${cursor.i}`,
      node: cursor.node,
      speaker: this.speakerInfo(line.speaker),
      text: line.text,
      line,
      stage: this.state.stage,
    };
  }

  _enter(nodeId) {
    const node = this.story.nodes[nodeId];
    if (!node) throw new Error(`跳转目标节点不存在: ${nodeId}`);
    this.state.cursor = { node: nodeId, phase: 'lines', i: -1, choice: null };
    this.state.visited.push(nodeId);

    const { stage } = this.state;
    if (node.scene && node.scene !== stage.scene) {
      const scene = this.story.scenes[node.scene];
      stage.scene = node.scene;
      stage.weather = scene.weather ?? null;
      if (scene.bgm !== undefined) stage.bgm = scene.bgm;
    }
    if (node.bgm !== undefined) stage.bgm = node.bgm;
    if (node.weather !== undefined) stage.weather = node.weather;

    this.onEvent('node', { node: nodeId, title: node.title ?? nodeId });
    this._applyEffects(node.effects, 'node');
  }

  /**
   * 把游标推进到下一个"需要玩家看的东西"：
   * 一句有 text 的台词 / 选项 / 聊天 / 结局。纯舞台指令（只换背景、表情、CG 的行）即时生效并跳过。
   */
  _settle() {
    for (let hops = 0; hops < MAX_AUTO_HOPS; hops++) {
      const { cursor } = this.state;
      const node = this.story.nodes[cursor.node];

      if (cursor.phase === 'lines' || cursor.phase === 'reaction') {
        const lines = this._lines(node, cursor);
        let i = cursor.i + 1;
        while (i < lines.length) {
          const line = lines[i];
          if (evalCondition(line.if, this.state)) {
            cursor.i = i;
            this._land(line);
            if (line.text != null) return this.current();
          }
          i++;
        }
        // 本段台词播完
        if (cursor.phase === 'reaction') {
          this._enter(node.choices[cursor.choice].next);
          continue;
        }
        cursor.phase = 'exit';
        cursor.i = -1;
      }

      // phase === 'exit'：自动出口直接跳转，交互出口停下
      if (node.next) {
        this._enter(node.next);
        continue;
      }
      if (node.branch) {
        const hit = node.branch.find((b) => evalCondition(b.if, this.state));
        if (!hit) throw new Error(`节点 ${cursor.node} 的 branch 没有命中任何分支（缺少无条件兜底）`);
        this._enter(hit.next);
        continue;
      }
      if (node.ending && this.state.ended !== node.ending) {
        this.state.ended = node.ending;
        this.onEvent('ending', { node: cursor.node, ending: node.ending });
      }
      return this.current();
    }
    throw new Error('剧情跳转次数过多，可能存在 next/branch 死循环');
  }

  /** 台词"落地"：舞台变化 + 效果 + 进历史。每句只执行一次（存档里记录的是落地后的状态）。 */
  _land(line) {
    const { stage } = this.state;
    if (line.scene !== undefined && line.scene !== stage.scene) {
      stage.scene = line.scene;
      const scene = this.story.scenes[line.scene];
      if (scene) {
        stage.weather = scene.weather ?? null;
        if (scene.bgm !== undefined) stage.bgm = scene.bgm;
      }
    }
    if (line.bgm !== undefined) stage.bgm = line.bgm;
    if (line.weather !== undefined) stage.weather = line.weather;
    if (line.cg !== undefined) stage.cg = line.cg;
    if (line.hide) {
      stage.char = null;
      stage.expression = null;
    }
    // 显式指定立绘：{ char, expression }；或者说话人自带表情
    const charId = line.char ?? (line.expression ? line.speaker : null);
    if (charId && this.story.characters?.[charId]?.sprites) {
      stage.char = charId;
      if (line.expression) stage.expression = line.expression;
      else if (!stage.expression) stage.expression = 'normal';
    }
    this._applyEffects(line.effects, 'line');
    if (line.text != null) this._pushBacklog({ speaker: line.speaker ?? null, text: line.text });
  }

  _applyEffects(effects, source) {
    if (!effects) return 0;
    const { affectionDelta } = applyEffects(effects, this.state, this.affectionSettings);
    if (affectionDelta !== 0) {
      this.onEvent('affection', { delta: affectionDelta, value: this.state.affection, source });
    }
    return affectionDelta;
  }

  _pushBacklog(entry) {
    const b = this.state.backlog;
    b.push(entry);
    if (b.length > BACKLOG_LIMIT) b.splice(0, b.length - BACKLOG_LIMIT);
  }
}
