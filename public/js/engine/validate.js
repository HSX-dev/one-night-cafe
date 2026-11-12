/**
 * 剧情 JSON 校验器 —— 服务端加载剧情、`npm run validate`、单元测试共用。
 * 目标：策划改 JSON 时，所有"引用不存在 / 跳转断链 / 死路"问题在启动时就暴露，而不是玩到一半白屏。
 *
 * @returns {{ errors: string[], warnings: string[], stats: object }}
 */
import { checkCondition, EFFECT_KEYS } from './conditions.js';

const EXIT_KEYS = ['next', 'branch', 'choices', 'chat', 'ending'];

export function validateStory(story) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!story || typeof story !== 'object') return { errors: ['剧情文件不是合法对象'], warnings, stats: {} };
  const { meta, characters = {}, scenes = {}, cgs = {}, endings = {}, nodes, audio = {} } = story;
  const bgm = audio.bgm ?? {};
  const sfx = audio.sfx ?? {};

  if (!meta?.start) err('meta.start 未设置');
  if (!nodes || typeof nodes !== 'object') {
    err('缺少 nodes');
    return { errors, warnings, stats: {} };
  }
  if (meta?.start && !nodes[meta.start]) err(`meta.start 指向不存在的节点 "${meta.start}"`);

  const aff = story.settings?.affection;
  if (aff && aff.min != null && aff.max != null && aff.min >= aff.max) err('settings.affection.min 必须小于 max');

  // ── 资源表 ──
  for (const [id, c] of Object.entries(characters)) {
    if (!c.name) err(`characters.${id}: 缺少 name`);
    if (c.sprites && typeof c.sprites !== 'object') err(`characters.${id}.sprites 必须是对象`);
  }
  for (const [id, s] of Object.entries(scenes)) {
    if (!s.bg) err(`scenes.${id}: 缺少 bg`);
    if (s.bgm && !bgm[s.bgm]) err(`scenes.${id}.bgm 引用了不存在的 BGM "${s.bgm}"`);
  }
  for (const [id, cg] of Object.entries(cgs)) {
    if (cg.paid) {
      if (!(cg.price > 0)) err(`cgs.${id}: 付费 CG 必须设置 price > 0`);
      if (!cg.preview) warn(`cgs.${id}: 付费 CG 建议设置 preview（未解锁时的模糊预览图）`);
    } else if (!cg.image) {
      err(`cgs.${id}: 免费 CG 必须设置 image`);
    }
  }

  const nodeRef = (target, where) => {
    if (typeof target !== 'string' || !nodes[target]) err(`${where}: 跳转目标 "${target}" 不存在`);
  };
  const checkEffects = (effects, where) => {
    if (!effects) return;
    for (const k of Object.keys(effects)) {
      if (!EFFECT_KEYS.includes(k)) err(`${where}.effects: 未知效果字段 "${k}"（可用：${EFFECT_KEYS.join(', ')}）`);
    }
    if (effects.affection != null && typeof effects.affection !== 'number') err(`${where}.effects.affection 必须是数字`);
  };
  const checkLines = (lines, where) => {
    if (lines == null) return;
    if (!Array.isArray(lines)) return err(`${where}: lines 必须是数组`);
    lines.forEach((line, i) => {
      const w = `${where}[${i}]`;
      if (line.speaker && line.speaker !== 'player' && !characters[line.speaker]) {
        err(`${w}: speaker "${line.speaker}" 未在 characters 中定义`);
      }
      const charId = line.char ?? (line.expression ? line.speaker : null);
      if (line.expression) {
        const sprites = characters[charId]?.sprites;
        if (!sprites) err(`${w}: 角色 "${charId}" 没有立绘，不能设置 expression`);
        else if (!sprites[line.expression]) err(`${w}: 角色 "${charId}" 没有表情 "${line.expression}"`);
      }
      if (line.scene != null && !scenes[line.scene]) err(`${w}: 场景 "${line.scene}" 不存在`);
      if (line.cg != null && !cgs[line.cg]) err(`${w}: CG "${line.cg}" 不存在`);
      if (line.bgm != null && !bgm[line.bgm]) err(`${w}: BGM "${line.bgm}" 不存在`);
      if (line.sfx != null && !sfx[line.sfx]) err(`${w}: 音效 "${line.sfx}" 不存在`);
      if (line.text != null && typeof line.text !== 'string') err(`${w}: text 必须是字符串`);
      errors.push(...checkCondition(line.if, `${w}.if`));
      checkEffects(line.effects, w);
    });
  };

  // ── 节点 ──
  for (const [id, node] of Object.entries(nodes)) {
    const where = `nodes.${id}`;
    const exits = EXIT_KEYS.filter((k) => node[k] != null);
    if (exits.length === 0) err(`${where}: 没有出口（需要 next / branch / choices / chat / ending 之一）`);
    if (exits.length > 1) err(`${where}: 只能有一个出口，当前有 ${exits.join(' + ')}`);
    if (node.scene && !scenes[node.scene]) err(`${where}.scene: 场景 "${node.scene}" 不存在`);
    if (node.bgm != null && !bgm[node.bgm]) err(`${where}.bgm: BGM "${node.bgm}" 不存在`);
    checkLines(node.lines, `${where}.lines`);
    checkEffects(node.effects, where);

    if (node.next != null) nodeRef(node.next, `${where}.next`);
    if (node.branch != null) {
      if (!Array.isArray(node.branch) || node.branch.length === 0) err(`${where}.branch 必须是非空数组`);
      else {
        node.branch.forEach((b, i) => {
          nodeRef(b.next, `${where}.branch[${i}].next`);
          errors.push(...checkCondition(b.if, `${where}.branch[${i}].if`));
        });
        if (node.branch[node.branch.length - 1].if) {
          err(`${where}.branch: 最后一项必须是无条件兜底（不写 if），否则可能走进死路`);
        }
      }
    }
    if (node.choices != null) {
      if (!Array.isArray(node.choices) || node.choices.length === 0) err(`${where}.choices 必须是非空数组`);
      else {
        node.choices.forEach((c, i) => {
          const w = `${where}.choices[${i}]`;
          if (!c.text) err(`${w}: 缺少 text`);
          nodeRef(c.next, `${w}.next`);
          checkEffects(c.effects, w);
          checkLines(c.lines, `${w}.lines`);
          errors.push(...checkCondition(c.if, `${w}.if`));
        });
        if (node.choices.every((c) => c.if)) warn(`${where}.choices: 所有选项都有条件，可能出现无选项可选的情况`);
      }
    }
    if (node.chat != null) {
      nodeRef(node.chat.next, `${where}.chat.next`);
      if (!(node.chat.rounds > 0)) err(`${where}.chat.rounds 必须 > 0`);
      if (node.chat.character && !characters[node.chat.character]?.persona) {
        err(`${where}.chat.character: 角色 "${node.chat.character}" 没有 persona，无法 AI 聊天`);
      }
    }
    if (node.ending != null && !endings[node.ending]) err(`${where}.ending: 结局 "${node.ending}" 未在 endings 中定义`);
  }

  // ── 可达性 ──
  const reachable = new Set();
  const order = [];
  if (meta?.start && nodes[meta.start]) {
    const queue = [meta.start];
    while (queue.length) {
      const id = queue.shift();
      if (reachable.has(id) || !nodes[id]) continue;
      reachable.add(id);
      order.push(id);
      queue.push(...nextTargets(nodes[id]));
    }
  }
  for (const id of Object.keys(nodes)) if (!reachable.has(id)) warn(`节点 "${id}" 从开头无法到达`);
  const reachableEndings = new Set(order.filter((id) => nodes[id].ending).map((id) => nodes[id].ending));
  if (reachableEndings.size < 2) warn(`可到达的结局只有 ${reachableEndings.size} 个`);

  return {
    errors,
    warnings,
    stats: {
      nodes: Object.keys(nodes).length,
      choiceNodes: Object.values(nodes).filter((n) => n.choices).length,
      endings: [...reachableEndings],
      lines: Object.values(nodes).reduce(
        (sum, n) => sum + (n.lines?.length ?? 0) + (n.choices ?? []).reduce((s, c) => s + (c.lines?.length ?? 0), 0),
        0,
      ),
      order,
    },
  };
}

/** 一个节点所有可能的下一跳（用于可达性分析、统计页漏斗排序、剧情图生成） */
export function nextTargets(node) {
  const out = [];
  if (node.next) out.push(node.next);
  if (node.branch) out.push(...node.branch.map((b) => b.next));
  if (node.choices) out.push(...node.choices.map((c) => c.next));
  if (node.chat) out.push(node.chat.next);
  return out.filter(Boolean);
}

/** 剧情中引用的所有公开图片资源（加载页预加载用；付费 CG 原图不在其中） */
export function collectAssets(story) {
  const urls = new Set();
  for (const c of Object.values(story.characters ?? {})) for (const u of Object.values(c.sprites ?? {})) urls.add(u);
  for (const s of Object.values(story.scenes ?? {})) if (s.bg) urls.add(s.bg);
  for (const cg of Object.values(story.cgs ?? {})) {
    if (!cg.paid && cg.image) urls.add(cg.image);
    if (cg.preview) urls.add(cg.preview);
  }
  for (const u of story.meta?.preload ?? []) urls.add(u);
  return [...urls];
}
