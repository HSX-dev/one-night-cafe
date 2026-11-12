/**
 * 条件表达式 & 效果 —— 剧情 JSON 里所有"判断"和"数值变化"都走这里。
 * 纯函数、无 DOM 依赖，浏览器和 Node（服务端校验 / 单元测试）共用。
 *
 * 条件语法（一个对象里的多个 key 是 AND 关系）：
 *   { "affection": { "gte": 70 } }          好感度比较：gte / gt / lte / lt / eq / ne，或直接写数字表示 eq
 *   { "flag": "held_hand" }                  flag 为真
 *   { "notFlag": "left_early" }              flag 为假 / 不存在
 *   { "flags": { "route": "a", "n": { "gte": 2 } } }  flag 等值或比较
 *   { "visited": "rooftop" }                 到达过某节点
 *   { "all": [cond, ...] } / { "any": [...] } / { "not": cond }
 */

const COMPARATORS = {
  gte: (a, b) => a >= b,
  gt: (a, b) => a > b,
  lte: (a, b) => a <= b,
  lt: (a, b) => a < b,
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
};

export const CONDITION_KEYS = ['affection', 'flag', 'notFlag', 'flags', 'visited', 'all', 'any', 'not'];
export const EFFECT_KEYS = ['affection', 'flags'];

function compare(value, spec) {
  if (typeof spec !== 'object' || spec === null) return value === spec;
  for (const [op, target] of Object.entries(spec)) {
    const fn = COMPARATORS[op];
    if (!fn) throw new Error(`未知比较运算符: ${op}`);
    if (!fn(value, target)) return false;
  }
  return true;
}

/** @returns {boolean} */
export function evalCondition(cond, state) {
  if (cond == null) return true;
  if (Array.isArray(cond)) return cond.every((c) => evalCondition(c, state));
  for (const [key, val] of Object.entries(cond)) {
    switch (key) {
      case 'affection':
        if (!compare(state.affection, val)) return false;
        break;
      case 'flag':
        if (!state.flags[val]) return false;
        break;
      case 'notFlag':
        if (state.flags[val]) return false;
        break;
      case 'flags':
        for (const [name, expected] of Object.entries(val)) {
          if (!compare(state.flags[name] ?? null, expected)) return false;
        }
        break;
      case 'visited':
        if (!state.visited.includes(val)) return false;
        break;
      case 'all':
        if (!val.every((c) => evalCondition(c, state))) return false;
        break;
      case 'any':
        if (!val.some((c) => evalCondition(c, state))) return false;
        break;
      case 'not':
        if (evalCondition(val, state)) return false;
        break;
      default:
        throw new Error(`未知条件字段: ${key}`);
    }
  }
  return true;
}

/** 校验条件结构，返回错误信息数组（供 validate.js 使用） */
export function checkCondition(cond, where) {
  const errors = [];
  if (cond == null) return errors;
  if (Array.isArray(cond)) {
    cond.forEach((c, i) => errors.push(...checkCondition(c, `${where}[${i}]`)));
    return errors;
  }
  if (typeof cond !== 'object') return [`${where}: 条件必须是对象`];
  for (const [key, val] of Object.entries(cond)) {
    if (!CONDITION_KEYS.includes(key)) {
      errors.push(`${where}: 未知条件字段 "${key}"（可用：${CONDITION_KEYS.join(', ')}）`);
      continue;
    }
    if (key === 'affection' && typeof val === 'object') {
      for (const op of Object.keys(val)) {
        if (!COMPARATORS[op]) errors.push(`${where}.affection: 未知比较运算符 "${op}"`);
      }
    }
    if ((key === 'all' || key === 'any') && !Array.isArray(val)) errors.push(`${where}.${key}: 必须是数组`);
    if (key === 'all' || key === 'any') (val || []).forEach((c, i) => errors.push(...checkCondition(c, `${where}.${key}[${i}]`)));
    if (key === 'not') errors.push(...checkCondition(val, `${where}.not`));
  }
  return errors;
}

export function clampAffection(value, settings) {
  const min = settings?.min ?? 0;
  const max = settings?.max ?? 100;
  return Math.max(min, Math.min(max, value));
}

/**
 * 应用效果，直接修改 state。
 * @returns {{ affectionDelta: number }} 实际生效的好感度变化（已经过上下限裁剪）
 */
export function applyEffects(effects, state, affectionSettings) {
  if (!effects) return { affectionDelta: 0 };
  let affectionDelta = 0;
  if (typeof effects.affection === 'number' && effects.affection !== 0) {
    const before = state.affection;
    state.affection = clampAffection(before + effects.affection, affectionSettings);
    affectionDelta = state.affection - before;
  }
  if (effects.flags) Object.assign(state.flags, effects.flags);
  return { affectionDelta };
}
