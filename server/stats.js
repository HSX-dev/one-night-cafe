/**
 * 埋点聚合：节点到达/流失漏斗、选项选择比例、付费转化、结局分布、AI 聊天概况。
 *
 * 口径说明：
 *  - "一局" = 一个 playId（点"开始游戏"生成，存档里带着它，所以读档继续还算同一局）
 *  - 到达：该局进入过此节点（去重）
 *  - 流失：该局最后停在此节点、没打出结局，并且超过 activeWindowMs 没有任何事件（还在玩的不算流失）
 *  - 选项比例：同一局在同一节点重复选择（读档重选）只计最后一次
 */
import { nextTargets } from '../public/js/engine/validate.js';

export const TRACKED_EVENTS = [
  'session_start',
  'game_start',
  'game_load',
  'node_enter',
  'choice',
  'ending',
  'pay_click',
  'pay_success',
  'pay_fail',
  'pay_cancel',
  'cg_view',
  'chat_message',
  'chat_end',
];

export function computeStats(events, story, { now = Date.now(), activeWindowMs = 5 * 60 * 1000 } = {}) {
  const plays = new Map();
  const getPlay = (e) => {
    if (!e.playId) return null;
    if (!plays.has(e.playId)) {
      plays.set(e.playId, { uid: e.uid, nodes: new Set(), lastNode: null, ending: null, lastTs: 0, choices: new Map() });
    }
    return plays.get(e.playId);
  };

  const users = new Set();
  const pay = { clicks: 0, clickUsers: new Set(), success: 0, payUsers: new Set(), fail: 0, cancel: 0, revenue: 0, byCg: {} };
  const chat = { messages: 0, sessions: 0, deltaSum: 0, providers: {} };
  const cgViews = {};

  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (e.uid) users.add(e.uid);
    const play = getPlay(e);
    if (play) play.lastTs = Math.max(play.lastTs, e.ts);
    const p = e.props ?? {};
    switch (e.event) {
      case 'node_enter':
        if (play && p.node) {
          play.nodes.add(p.node);
          play.lastNode = p.node;
        }
        break;
      case 'choice':
        if (play && p.node != null) play.choices.set(p.node, p.index);
        break;
      case 'ending':
        if (play) play.ending = p.ending;
        break;
      case 'pay_click':
        pay.clicks++;
        pay.clickUsers.add(e.uid);
        (pay.byCg[p.cgId] ??= { clicks: 0, success: 0 }).clicks++;
        break;
      case 'pay_success':
        pay.success++;
        pay.payUsers.add(e.uid);
        pay.revenue += Number(p.amount) || 0;
        (pay.byCg[p.cgId] ??= { clicks: 0, success: 0 }).success++;
        break;
      case 'pay_fail':
        pay.fail++;
        break;
      case 'pay_cancel':
        pay.cancel++;
        break;
      case 'cg_view':
        cgViews[p.cgId] = (cgViews[p.cgId] ?? 0) + 1;
        break;
      case 'chat_message':
        chat.messages++;
        chat.deltaSum += Number(p.delta) || 0;
        if (p.provider) chat.providers[p.provider] = (chat.providers[p.provider] ?? 0) + 1;
        break;
      case 'chat_end':
        chat.sessions++;
        break;
    }
  }

  // ── 节点漏斗（按剧情 BFS 顺序） ──
  const order = bfsOrder(story);
  const totalPlays = plays.size;
  const funnel = order.map((nodeId) => {
    let arrivals = 0;
    let dropped = 0;
    let active = 0;
    for (const play of plays.values()) {
      if (!play.nodes.has(nodeId)) continue;
      arrivals++;
      if (play.lastNode === nodeId && !play.ending) {
        if (now - play.lastTs < activeWindowMs) active++;
        else dropped++;
      }
    }
    const node = story.nodes[nodeId];
    return {
      node: nodeId,
      title: node.title ?? nodeId,
      type: node.ending ? 'ending' : node.choices ? 'choice' : node.chat ? 'chat' : node.branch ? 'branch' : 'story',
      arrivals,
      reachRate: ratio(arrivals, totalPlays),
      dropped,
      active,
      dropRate: ratio(dropped, arrivals),
    };
  });

  // ── 选项比例 ──
  const choices = order
    .filter((id) => story.nodes[id].choices)
    .map((nodeId) => {
      const counts = story.nodes[nodeId].choices.map(() => 0);
      for (const play of plays.values()) {
        const idx = play.choices.get(nodeId);
        if (idx != null && counts[idx] != null) counts[idx]++;
      }
      const total = counts.reduce((a, b) => a + b, 0);
      return {
        node: nodeId,
        title: story.nodes[nodeId].title ?? nodeId,
        total,
        options: story.nodes[nodeId].choices.map((c, i) => ({
          text: c.text,
          affection: c.effects?.affection ?? 0,
          count: counts[i],
          rate: ratio(counts[i], total),
        })),
      };
    });

  // ── 结局 ──
  const endingCounts = {};
  for (const play of plays.values()) if (play.ending) endingCounts[play.ending] = (endingCounts[play.ending] ?? 0) + 1;
  const completed = Object.values(endingCounts).reduce((a, b) => a + b, 0);
  const endings = Object.entries(story.endings ?? {}).map(([id, e]) => ({
    id,
    title: e.title,
    label: e.label,
    count: endingCounts[id] ?? 0,
    rate: ratio(endingCounts[id] ?? 0, completed),
  }));

  return {
    generatedAt: now,
    overview: {
      users: users.size,
      plays: totalPlays,
      completed,
      completionRate: ratio(completed, totalPlays),
      events: events.length,
    },
    funnel,
    choices,
    endings,
    pay: {
      clicks: pay.clicks,
      uniqueClickers: pay.clickUsers.size,
      success: pay.success,
      uniquePayers: pay.payUsers.size,
      fail: pay.fail,
      cancel: pay.cancel,
      revenue: Math.round(pay.revenue * 100) / 100,
      clickToPayRate: ratio(pay.payUsers.size, pay.clickUsers.size),
      byCg: pay.byCg,
    },
    chat: {
      sessions: chat.sessions,
      messages: chat.messages,
      avgDelta: chat.messages ? Math.round((chat.deltaSum / chat.messages) * 100) / 100 : 0,
      providers: chat.providers,
    },
    cgViews,
  };
}

function ratio(a, b) {
  return b ? Math.round((a / b) * 1000) / 1000 : 0;
}

function bfsOrder(story) {
  const seen = new Set();
  const order = [];
  const queue = [story.meta.start];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !story.nodes[id]) continue;
    seen.add(id);
    order.push(id);
    queue.push(...nextTargets(story.nodes[id]));
  }
  for (const id of Object.keys(story.nodes)) if (!seen.has(id)) order.push(id);
  // 结局节点统一排在最后，漏斗从上到下读起来更顺
  return [...order.filter((id) => !story.nodes[id].ending), ...order.filter((id) => story.nodes[id].ending)];
}
