/**
 * 启动流程：连接服务器 → 拉取剧情 → 预加载素材（进度条）→ 点击进入（解锁音频）→ 标题画面
 */
import { $, h } from './ui/dom.js';
import { api, ApiError } from './services/api.js';
import { AudioManager } from './services/audio.js';
import { preloadImages } from './services/preload.js';
import { analytics } from './services/analytics.js';
import { saves, settings, gallery } from './services/storage.js';
import { collectAssets } from './engine/validate.js';
import { Game } from './ui/Game.js';
import { Paywall } from './ui/Paywall.js';
import { openSaveLoad, openSettings, openGallery } from './ui/menus.js';
import { confirmDialog } from './ui/modal.js';

const root = $('#stage');
const loadingEl = $('.screen-loading');
const titleEl = $('.screen-title');

function setProgress(ratio, label) {
  $('.loading-bar i').style.width = `${Math.round(ratio * 100)}%`;
  $('.loading-pct').textContent = `${Math.round(ratio * 100)}%`;
  if (label) $('.loading-label').textContent = label;
}

function showError(error) {
  const el = $('.screen-error');
  const details = error instanceof ApiError ? error.body?.details ?? [] : [];
  $('.error-message', el).textContent =
    error instanceof ApiError && error.body?.error === 'story_invalid' ? '剧情配置（story.json）有错误，修正后刷新页面：' : `加载失败：${error.message}`;
  $('.error-details', el).replaceChildren(...details.map((d) => h('li', {}, d)));
  loadingEl.classList.add('hidden');
  el.classList.remove('hidden');
}

async function boot() {
  setProgress(0.03, '连接服务器…');
  let session;
  let story;
  try {
    [session, story] = await Promise.all([api.session(), api.story()]);
  } catch (e) {
    return showError(e);
  }
  session.unlocks = new Set(session.unlocks);
  document.title = story.meta.title;

  const assets = collectAssets(story);
  setProgress(0.1, `加载素材 0/${assets.length}`);
  const { failed } = await preloadImages(assets, (done, total) => setProgress(0.1 + 0.9 * (done / total), `加载素材 ${done}/${total}`));
  if (failed.length) console.warn('以下素材加载失败：', failed);

  const audio = new AudioManager(story, settings.get());
  const paywall = new Paywall({ story, session, audio });
  const game = new Game({ root, story, session, audio, paywall, onExit: () => showTitle() });
  analytics.track('session_start', { w: innerWidth, h: innerHeight, touch: matchMedia('(pointer: coarse)').matches });

  // 浏览器要求用户手势后才能播放声音，所以加载完先"点击进入"
  setProgress(1, '');
  loadingEl.classList.add('ready');
  await new Promise((r) => loadingEl.addEventListener('click', r, { once: true }));
  audio.unlock();
  loadingEl.classList.add('hidden');
  showTitle();

  function showTitle() {
    $('.title-name', titleEl).textContent = story.meta.title;
    $('.title-sub', titleEl).textContent = story.meta.subtitle ?? '';
    game.stage.apply({ scene: null, bgm: story.meta.titleBgm ?? null, weather: 'rain', char: null, expression: null });
    game.stage.bg.set(story.meta.titleBg);
    game.stage.setCg(null);
    game.stage.tint.dataset.tint = '';
    game.dialogue.setVisible(false);

    const hasAuto = Boolean(saves.all().auto);
    $('[data-title="continue"]', titleEl).disabled = !hasAuto;
    const g = gallery.get();
    const total = Object.keys(story.endings ?? {}).length;
    $('.title-progress', titleEl).textContent = `结局 ${g.endings.length}/${total} · CG ${g.cgs.length + session.unlocks.size}/${Object.keys(story.cgs ?? {}).length}`;
    titleEl.classList.remove('hidden');
  }

  function enterGame(record) {
    titleEl.classList.add('hidden');
    game.start(record);
  }

  titleEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-title]');
    if (!btn) return;
    audio.sfx('click');
    switch (btn.dataset.title) {
      case 'new':
        if (saves.all().auto && !(await confirmDialog('开始新游戏？「继续游戏」的自动存档会被覆盖（手动存档不受影响）。', { ok: '开始' }))) return;
        return enterGame(null);
      case 'continue':
        return enterGame(saves.all().auto);
      case 'load':
        return openSaveLoad({ mode: 'load', story, onLoad: (rec) => enterGame(rec) });
      case 'gallery':
        return openGallery({ story, session, paywall, audio });
      case 'settings':
        return openSettings((s) => game.applySettings(s));
    }
  });
}

boot();
