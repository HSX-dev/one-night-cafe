import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { StoryEngine } from '../public/js/engine/StoryEngine.js';
import { validateStory } from '../public/js/engine/validate.js';
import { evalCondition } from '../public/js/engine/conditions.js';

const story = JSON.parse(fs.readFileSync(new URL('../story/story.json', import.meta.url), 'utf8'));

/**
 * 自动游玩：plan[nodeId] = 选项 index；chatDelta = 聊天环节带来的好感度变化
 * 返回 { ending, engine, events }
 */
function play(plan, { chatDelta = 0, stopAt } = {}) {
  const events = [];
  const engine = new StoryEngine(story, { onEvent: (name, p) => events.push({ name, ...p }) });
  let step = engine.newGame();
  for (let guard = 0; guard < 500; guard++) {
    if (stopAt && step.node === stopAt) return { step, engine, events };
    if (step.type === 'line') step = engine.advance();
    else if (step.type === 'choices') step = engine.choose(plan[step.node] ?? step.options[0].index);
    else if (step.type === 'chat') {
      if (chatDelta) engine.adjustAffection(chatDelta);
      step = engine.endChat();
    } else if (step.type === 'ending') return { ending: step.ending.id, engine, events, step };
  }
  throw new Error('没有走到结局');
}

const BEST = { meet: 0, counter: 2, blackout: 0, rain_stops: 0, rooftop: 0 };
const MEH = { meet: 1, counter: 1, blackout: 1, rain_stops: 0, rooftop: 1 };

test('剧情 JSON 校验通过，且至少 10 个节点、2 个结局', () => {
  const { errors, stats } = validateStory(story);
  assert.deepEqual(errors, []);
  assert.ok(stats.nodes >= 10);
  assert.ok(stats.endings.length >= 2);
});

test('全选最优 → 好结局，并经过付费 CG 节点', () => {
  const { ending, engine } = play(BEST);
  assert.equal(ending, 'good');
  assert.ok(engine.state.visited.includes('night'));
  assert.ok(engine.state.affection >= 75);
});

test('中庸选择 → 普通结局', () => {
  const { ending, engine } = play(MEH);
  assert.equal(ending, 'normal');
  assert.ok(engine.state.affection < 75);
});

test('雨停后提前离开 → 坏结局（且台词按 flag 分支）', () => {
  const { ending, engine } = play({ ...BEST, rain_stops: 1 });
  assert.equal(ending, 'bad');
  assert.equal(engine.state.flags.left_early, true);
  assert.ok(engine.state.backlog.some((b) => b.text.includes('我拿起外套')));
  assert.ok(!engine.state.backlog.some((b) => b.text.includes('祝你以后')));
});

test('聊天中惹她生气 → 好感度过低走坏结局', () => {
  const { ending } = play({ meet: 2, counter: 1, blackout: 1, rain_stops: 0, rooftop: 1 }, { chatDelta: -15 });
  assert.equal(ending, 'bad');
});

test('AI 聊天加分可以把中庸路线救到好结局', () => {
  const plan = { meet: 0, counter: 0, blackout: 2, rain_stops: 0, rooftop: 1 };
  assert.equal(play(plan).ending, 'normal');
  assert.equal(play(plan, { chatDelta: 15 }).ending, 'good');
});

test('选项后的反应台词按好感度条件分支', () => {
  const high = play(BEST, { stopAt: 'candle_chat' }).engine.state.backlog.map((b) => b.text);
  assert.ok(high.some((t) => t.includes('你的手好暖')));
  const low = play({ meet: 2, counter: 1, blackout: 0 }, { stopAt: 'candle_chat' }).engine.state.backlog.map((b) => b.text);
  assert.ok(low.some((t) => t.includes('像被烫到一样')));
  assert.ok(!low.some((t) => t.includes('你的手好暖')));
});

test('好感度事件和节点事件', () => {
  const { events } = play(BEST);
  const aff = events.filter((e) => e.name === 'affection');
  assert.equal(aff[0].delta, 10);
  assert.equal(events.filter((e) => e.name === 'ending').length, 1);
  const nodes = events.filter((e) => e.name === 'node').map((e) => e.node);
  assert.deepEqual(nodes.slice(0, 3), ['prologue', 'meet', 'counter']);
  assert.ok(nodes.includes('route_check'));
});

test('存档 → JSON 序列化 → 读档后继续，结果与不中断一致', () => {
  const { engine } = play(BEST, { stopAt: 'rooftop' });
  const saved = JSON.parse(JSON.stringify(engine.snapshot()));
  const engine2 = new StoryEngine(story);
  let step = engine2.load(saved);
  assert.equal(step.node, 'rooftop');
  assert.equal(engine2.state.stage.scene, 'rooftop');
  while (step.type !== 'ending') {
    if (step.type === 'line') step = engine2.advance();
    else if (step.type === 'choices') step = engine2.choose(BEST[step.node]);
    else step = engine2.endChat();
  }
  assert.equal(step.ending.id, 'good');
});

test('舞台状态：换场景带出 BGM / 天气，表情随台词切换，CG 显示与关闭', () => {
  const { engine } = play(BEST, { stopAt: 'blackout' });
  assert.equal(engine.state.stage.scene, 'cafe');
  assert.equal(engine.state.stage.bgm, 'cafe');
  assert.equal(engine.state.stage.weather, 'rain');
  engine.advance(); // 停电那句：切到 cafe_dark
  assert.equal(engine.state.stage.scene, 'cafe_dark');
  assert.equal(engine.state.stage.bgm, 'candle');
  const s = engine.advance();
  assert.equal(s.stage.expression, 'surprised');

  const r = play(BEST, { stopAt: 'route_check' });
  assert.equal(r.engine.state.stage.cg, null, '天台 CG 在对话结束前关闭');
});

test('好感度有上下限', () => {
  const e = new StoryEngine(story);
  e.newGame();
  e.adjustAffection(999);
  assert.equal(e.state.affection, 100);
  e.adjustAffection(-999);
  assert.equal(e.state.affection, 0);
});

test('条件表达式', () => {
  const s = { affection: 50, flags: { a: true, n: 3 }, visited: ['x'] };
  assert.ok(evalCondition({ affection: { gte: 50, lt: 60 } }, s));
  assert.ok(!evalCondition({ affection: { gt: 50 } }, s));
  assert.ok(evalCondition({ flag: 'a', notFlag: 'b' }, s));
  assert.ok(evalCondition({ flags: { n: { gte: 2 } } }, s));
  assert.ok(evalCondition({ any: [{ flag: 'zzz' }, { visited: 'x' }] }, s));
  assert.ok(evalCondition({ not: { flag: 'b' } }, s));
  assert.throws(() => evalCondition({ typo: 1 }, s));
});

test('带条件的选项：有 lockedHint 显示为锁定，没有则隐藏', () => {
  const mini = {
    meta: { start: 'a', version: 't' },
    settings: { affection: { initial: 10 } },
    nodes: {
      a: {
        choices: [
          { text: '普通', next: 'end' },
          { text: '需要好感', if: { affection: { gte: 50 } }, lockedHint: '好感度 ≥ 50', next: 'end' },
          { text: '隐藏', if: { flag: 'nope' }, next: 'end' },
        ],
      },
      end: { ending: 'e' },
    },
    endings: { e: { title: 'E' } },
  };
  const e = new StoryEngine(mini);
  const step = e.newGame();
  assert.equal(step.options.length, 2);
  assert.equal(step.options[1].locked, true);
  assert.throws(() => e.choose(1));
  assert.equal(e.choose(0).type, 'ending');
});

test('校验器能发现常见配置错误', () => {
  const broken = {
    meta: { start: 'a' },
    characters: { wan: { name: '晚', sprites: { normal: 'x.svg' } } },
    endings: {},
    nodes: {
      a: { lines: [{ speaker: 'wan', expression: 'angry', text: 'hi' }], next: 'missing' },
      b: { branch: [{ if: { affection: { gte: 1 } }, next: 'a' }] },
      c: { lines: [{ text: 'x', if: { afection: 1 } }], ending: 'nope' },
      d: { next: 'a', ending: 'nope' },
    },
  };
  const { errors, warnings } = validateStory(broken);
  const all = errors.join('\n');
  assert.match(all, /没有表情 "angry"/);
  assert.match(all, /"missing" 不存在/);
  assert.match(all, /无条件兜底/);
  assert.match(all, /未知条件字段 "afection"/);
  assert.match(all, /结局 "nope" 未在 endings 中定义/);
  assert.match(all, /只能有一个出口/);
  assert.ok(warnings.some((w) => w.includes('无法到达')));
});
