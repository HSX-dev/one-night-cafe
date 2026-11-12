import { h, formatTime } from './dom.js';
import { openModal, confirmDialog, toast } from './modal.js';
import { saves, settings as settingsStore, gallery as galleryStore, SLOT_COUNT } from '../services/storage.js';
import { api } from '../services/api.js';
import { formatPrice } from './Paywall.js';

/** 存档 / 读档 */
export function openSaveLoad({ mode, story, makeRecord, onLoad }) {
  const isSave = mode === 'save';
  const grid = h('div', { class: 'slots' });

  const render = () => {
    const { auto, slots } = saves.all();
    const cards = [];
    if (!isSave) cards.push(slotCard(auto, '自动存档', null));
    slots.forEach((rec, i) => cards.push(slotCard(rec, `存档 ${i + 1}`, i)));
    grid.replaceChildren(...cards);
  };

  const slotCard = (rec, label, index) => {
    const empty = !rec;
    const disabled = !isSave && empty;
    const bg = rec ? story.scenes[rec.meta.scene]?.bg : null;
    return h(
      'button',
      {
        class: `slot ${empty ? 'empty' : ''} ${index == null ? 'auto' : ''}`,
        disabled: disabled || (isSave && index == null),
        onclick: () => (isSave ? doSave(index, rec) : doLoad(rec)),
      },
      h('div', { class: 'slot-thumb', style: bg ? { backgroundImage: `url(${bg})` } : {} }, rec ? h('span', { class: 'slot-aff' }, `♥ ${rec.meta.affection}`) : null),
      h(
        'div',
        { class: 'slot-info' },
        h('div', { class: 'slot-head' }, h('b', {}, label), rec ? h('time', {}, formatTime(rec.meta.savedAt)) : null),
        h('div', { class: 'slot-title' }, rec ? rec.meta.nodeTitle : isSave ? '空 —— 点击保存' : '空'),
        rec ? h('div', { class: 'slot-text' }, rec.meta.text) : null,
      ),
      rec && index != null
        ? h('span', {
            class: 'slot-del',
            role: 'button',
            title: '删除',
            onclick: async (e) => {
              e.stopPropagation();
              if (await confirmDialog(`删除「存档 ${index + 1}」？`, { ok: '删除' })) {
                saves.deleteSlot(index);
                render();
              }
            },
          }, '删除')
        : null,
    );
  };

  const doSave = async (i, existing) => {
    if (existing && !(await confirmDialog(`覆盖「存档 ${i + 1}」？`, { ok: '覆盖' }))) return;
    if (saves.saveSlot(i, makeRecord())) toast(`已保存到 存档 ${i + 1}`, { type: 'success' });
    else toast('保存失败：浏览器存储不可用', { type: 'error' });
    render();
  };

  const doLoad = async (rec) => {
    if (!rec) return;
    if (makeRecord && !(await confirmDialog('读取这个存档？当前未保存的进度会丢失。', { ok: '读取' }))) return;
    modal.close();
    onLoad(rec);
  };

  render();
  const modal = openModal({ title: isSave ? '存档' : '读档', className: 'modal-wide', body: grid });
  return modal;
}

/** 对话历史回看 */
export function openBacklog(entries, speakerInfo) {
  const list = h(
    'ol',
    { class: 'backlog' },
    entries.map((e) => {
      const sp = speakerInfo(e.speaker);
      return h(
        'li',
        { class: `${e.choice ? 'is-choice' : ''} ${e.chat ? 'is-chat' : ''} ${sp ? '' : 'is-narration'}` },
        sp ? h('b', { style: { color: sp.color ?? 'inherit' } }, sp.name) : null,
        h('p', {}, e.choice ? `▸ ${e.text}` : e.text),
      );
    }),
  );
  const m = openModal({ title: '对话历史', className: 'modal-wide modal-backlog', body: entries.length ? list : h('p', { class: 'muted' }, '还没有对话') });
  requestAnimationFrame(() => (m.body.scrollTop = m.body.scrollHeight));
  return m;
}

/** 设置 */
export function openSettings(onChange) {
  const s = settingsStore.get();
  const update = (patch) => onChange(settingsStore.set(patch));

  const toggle = (key, label) =>
    h('label', { class: 'setting-row' }, h('span', {}, label), h('input', { type: 'checkbox', class: 'switch', checked: s[key], onchange: (e) => update({ [key]: e.target.checked }) }));
  const slider = (key, label, min, max, step, fmt, invert = false) => {
    const out = h('output', {}, fmt(s[key]));
    return h(
      'label',
      { class: 'setting-row' },
      h('span', {}, label),
      h('input', {
        type: 'range',
        min,
        max,
        step,
        value: invert ? max - s[key] + min : s[key],
        oninput: (e) => {
          const v = Number(e.target.value);
          const real = invert ? max - v + min : v;
          out.textContent = fmt(real);
          update({ [key]: real });
        },
      }),
      out,
    );
  };

  return openModal({
    title: '设置',
    body: h(
      'div',
      { class: 'settings' },
      h('h4', {}, '声音'),
      toggle('bgmOn', '背景音乐'),
      slider('bgmVolume', 'BGM 音量', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      toggle('sfxOn', '音效'),
      slider('sfxVolume', '音效音量', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      h('h4', {}, '文字'),
      slider('textSpeed', '文字速度', 0, 80, 5, (v) => (v === 0 ? '瞬间' : v < 25 ? '快' : v < 50 ? '中' : '慢'), true),
      slider('autoDelay', '自动播放间隔', 0.4, 2.5, 0.1, (v) => `${v.toFixed(1)}x`),
      toggle('skipUnread', '快进时也跳过未读文本'),
      h('p', { class: 'muted small' }, '快捷键：空格/回车 推进 · 按住 Ctrl 快进 · A 自动 · 滚轮上 / H 历史 · Esc 关闭'),
    ),
  });
}

/** CG 鉴赏 + 结局收集 */
export function openGallery({ story, session, paywall, audio }) {
  const body = h('div', { class: 'gallery' });
  const render = () => {
    const g = galleryStore.get();
    const cgCards = Object.entries(story.cgs ?? {}).map(([id, cg]) => {
      const unlocked = cg.paid ? session.unlocks.has(id) : g.cgs.includes(id);
      const src = cg.paid ? (unlocked ? api.cgUrl(id) : cg.preview) : unlocked ? cg.image : null;
      return h(
        'button',
        {
          class: `gallery-item ${unlocked ? '' : 'locked'} ${cg.paid ? 'paid' : ''}`,
          onclick: async () => {
            if (unlocked) return viewCg(src, cg.title);
            if (!cg.paid) return toast('在剧情中遇到这张 CG 后解锁');
            const r = await paywall.request(id, { source: 'gallery' });
            if (r === 'unlocked') {
              render();
              viewCg(api.cgUrl(id), cg.title);
            }
          },
        },
        src ? h('img', { src, alt: cg.title, loading: 'lazy' }) : h('div', { class: 'gallery-unknown' }, '?'),
        h('span', { class: 'gallery-cap' }, unlocked ? cg.title : cg.paid ? `🔒 ${formatPrice(cg.price, cg.currency)} 解锁` : '未解锁'),
      );
    });
    const endings = Object.entries(story.endings ?? {}).map(([id, e]) =>
      h('li', { class: g.endings.includes(id) ? 'got' : '' }, h('b', {}, e.label ?? id), g.endings.includes(id) ? e.title : '？？？'),
    );
    body.replaceChildren(h('h4', {}, 'CG'), h('div', { class: 'gallery-grid' }, cgCards), h('h4', {}, `结局 ${g.endings.length}/${endings.length}`), h('ul', { class: 'ending-list' }, endings));
  };
  render();
  audio?.sfx('open');
  return openModal({ title: '回想', className: 'modal-wide', body });
}

export function viewCg(src, title) {
  const m = openModal({
    className: 'modal-cg',
    body: h('figure', { onclick: () => m.close() }, h('img', { src, alt: title }), h('figcaption', {}, title, h('small', {}, '点击关闭'))),
  });
  return m;
}

/** 结局卡片 */
export function showEnding({ ending, affection, onTitle, onRestart }) {
  return openModal({
    className: `modal-ending ending-${ending.id}`,
    dismissible: false,
    body: h(
      'div',
      { class: 'ending-card' },
      h('span', { class: 'ending-label' }, ending.label ?? 'END'),
      h('h2', {}, ending.title),
      h('p', {}, ending.description ?? ''),
      h('p', { class: 'ending-aff' }, `最终好感度 ♥ ${affection}`),
    ),
    actions: [
      { label: '回到标题', onClick: (m) => (m.close(), onTitle()) },
      { label: '再玩一次', primary: true, onClick: (m) => (m.close(), onRestart()) },
    ],
  });
}
