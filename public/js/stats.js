/** 统计看板：读 /api/stats 渲染指标卡 + 行内条形表格，悬停显示明细 */
const token = new URLSearchParams(location.search).get('token') ?? '';
const $ = (id) => document.getElementById(id);
const pct = (r) => `${(r * 100).toFixed(1)}%`;
const TYPE_LABEL = { story: '剧情', choice: '选项', chat: 'AI 聊天', branch: '分支', ending: '结局' };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') Object.assign(e.style, v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

/** 条形本身 14px，外面包一层带上下留白的命中区，悬停更容易触发 */
function bar(ratio, tip, variant = '') {
  return el(
    'div',
    { class: 'bar-hit', 'data-tip': tip, role: 'img', 'aria-label': tip },
    el('div', { class: `bar ${variant}` }, el('i', { style: { width: `${Math.min(100, ratio * 100)}%` } })),
  );
}

function tile(label, value, note) {
  return el('div', { class: 'tile' }, el('div', { class: 'tile-label' }, label), el('div', { class: 'tile-value' }, value), note ? el('div', { class: 'tile-note' }, note) : null);
}

function render(s) {
  const o = s.overview;
  $('tiles').replaceChildren(
    tile('玩家', o.users),
    tile('游戏局数', o.plays),
    tile('通关局数', o.completed, `通关率 ${pct(o.completionRate)}`),
    tile('付费按钮点击', s.pay.clicks, `${s.pay.uniqueClickers} 人点击`),
    tile('支付成功', s.pay.success, `点击→付费 ${pct(s.pay.clickToPayRate)}`),
    tile('收入（模拟）', `¥${s.pay.revenue.toFixed(2)}`),
    tile('AI 聊天消息', s.chat.messages),
  );

  // ── 漏斗 ──
  const head = el('tr', {}, el('th', {}, '节点'), el('th', {}, '类型'), el('th', {}, '到达率'), el('th', { class: 'num' }, '到达'), el('th', {}, '流失率'), el('th', { class: 'num' }, '流失'));
  const rows = s.funnel.map((f) =>
    el(
      'tr',
      {},
      el('td', { class: 'node-title' }, f.title, el('span', { class: 'node-id' }, f.node)),
      el('td', {}, el('span', { class: 'badge' }, TYPE_LABEL[f.type] ?? f.type)),
      el('td', { class: 'bar-cell' }, bar(f.reachRate, `${f.title}\n到达 ${f.arrivals} 局 / 共 ${o.plays} 局（${pct(f.reachRate)}）`)),
      el('td', { class: 'num' }, f.arrivals),
      el(
        'td',
        { class: 'bar-cell' },
        f.type === 'ending' ? el('span', { class: 'empty' }, '—') : bar(f.dropRate, `${f.title}\n流失 ${f.dropped} 局 / 到达 ${f.arrivals} 局（${pct(f.dropRate)}）${f.active ? `\n另有 ${f.active} 局正在进行` : ''}`, 'drop'),
      ),
      el('td', { class: 'num' }, f.type === 'ending' ? '—' : `${f.dropped}（${pct(f.dropRate)}）`),
    ),
  );
  $('funnel').replaceChildren(el('thead', {}, head), el('tbody', {}, rows));

  // ── 选项 ──
  $('choices').replaceChildren(
    ...s.choices.map((c) =>
      el(
        'div',
        { class: 'choice-group' },
        el('h3', {}, c.title, el('small', {}, `  共 ${c.total} 次选择`)),
        c.options.map((opt) =>
          el(
            'div',
            { class: 'opt' },
            el('div', { class: 'opt-text', title: opt.text }, opt.text, el('span', { class: 'opt-delta' }, `(${opt.affection > 0 ? '+' : ''}${opt.affection})`)),
            bar(opt.rate, `${opt.text}\n${opt.count} 次 · ${pct(opt.rate)}\n好感度 ${opt.affection > 0 ? '+' : ''}${opt.affection}`),
            el('div', { class: 'opt-val' }, `${pct(opt.rate)} · ${opt.count}`),
          ),
        ),
      ),
    ),
  );

  // ── 付费 ──
  const p = s.pay;
  $('pay').replaceChildren(
    el(
      'div',
      { class: 'mini-tiles' },
      tile('点击解锁', p.clicks),
      tile('支付成功', p.success),
      tile('支付失败', p.fail),
      tile('取消', p.cancel),
      tile('点击人数', p.uniqueClickers),
      tile('付费人数', p.uniquePayers, `转化 ${pct(p.clickToPayRate)}`),
    ),
  );

  // ── 结局 ──
  $('endings').replaceChildren(
    ...s.endings.map((e) =>
      el(
        'div',
        { class: 'opt' },
        el('div', { class: 'opt-text' }, `${e.title}`, el('span', { class: 'opt-delta' }, e.label ?? '')),
        bar(e.rate, `${e.label ?? ''} ${e.title}\n${e.count} 局 · ${pct(e.rate)}`),
        el('div', { class: 'opt-val' }, `${pct(e.rate)} · ${e.count}`),
      ),
    ),
  );

  // ── 聊天 ──
  const providers = Object.entries(s.chat.providers).map(([k, v]) => `${k === 'anthropic' ? 'Claude' : k === 'mock' ? '离线规则' : k} ${v}`).join(' / ') || '—';
  $('chat').replaceChildren(
    el('div', { class: 'mini-tiles' }, tile('聊天段数', s.chat.sessions), tile('消息数', s.chat.messages), tile('平均好感变化', `${s.chat.avgDelta > 0 ? '+' : ''}${s.chat.avgDelta}`, '每条消息'), tile('回复来源', providers)),
  );

  $('updated').textContent = `更新于 ${new Date(s.generatedAt).toLocaleTimeString()} · ${o.events} 条事件`;
}

async function load() {
  try {
    const res = await fetch(`/api/stats${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    if (res.status === 401) throw new Error('需要访问令牌：在地址后加上 ?token=你的 STATS_TOKEN');
    if (!res.ok) throw new Error(`加载失败 HTTP ${res.status}`);
    render(await res.json());
    $('error').hidden = true;
  } catch (e) {
    $('error').textContent = e.message;
    $('error').hidden = false;
  }
}

// 悬停提示：命中区域是整行条形（比细条本身大）
const tip = $('tooltip');
document.addEventListener('pointermove', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) return (tip.hidden = true);
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
});

$('refresh').addEventListener('click', load);
let timer = setInterval(load, 10000);
$('auto').addEventListener('change', (e) => {
  clearInterval(timer);
  if (e.target.checked) timer = setInterval(load, 10000);
});
load();
