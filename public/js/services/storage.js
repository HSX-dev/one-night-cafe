/**
 * 本地持久化：存档槽、设置、已读文本、收集要素（CG/结局）。
 * localStorage 在隐私模式等情况下可能不可用，所有读写都 try/catch，失败时退化为内存。
 */
const PREFIX = 'onc:v1:';
const memory = new Map();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const SLOT_COUNT = 6;

// ── 存档 ──
export const saves = {
  all() {
    const data = read('saves', null) ?? {};
    const slots = Array.from({ length: SLOT_COUNT }, (_, i) => data.slots?.[i] ?? null);
    return { auto: data.auto ?? null, slots };
  },
  _put(mutator) {
    const data = this.all();
    mutator(data);
    return write('saves', data);
  },
  saveAuto(record) {
    return this._put((d) => (d.auto = record));
  },
  saveSlot(i, record) {
    return this._put((d) => (d.slots[i] = record));
  },
  deleteSlot(i) {
    return this._put((d) => (d.slots[i] = null));
  },
  clearAuto() {
    return this._put((d) => (d.auto = null));
  },
};

// ── 设置 ──
export const DEFAULT_SETTINGS = {
  bgmOn: true,
  bgmVolume: 0.5,
  sfxOn: true,
  sfxVolume: 0.7,
  textSpeed: 35, // 每个字的毫秒数
  autoDelay: 1, // 自动播放等待倍率
  skipUnread: false,
};

export const settings = {
  get() {
    return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    write('settings', next);
    return next;
  },
};

// ── 已读文本（快进默认只跳过读过的句子） ──
let readCache = null;
let readDirty = false;
export const readLog = {
  has(key) {
    readCache ??= new Set(read('read', []));
    return readCache.has(key);
  },
  add(key) {
    readCache ??= new Set(read('read', []));
    if (readCache.has(key)) return;
    readCache.add(key);
    if (!readDirty) {
      readDirty = true;
      setTimeout(() => {
        readDirty = false;
        write('read', [...readCache]);
      }, 1000);
    }
  },
};

// ── 收集要素 ──
export const gallery = {
  get() {
    return { cgs: [], endings: [], ...read('gallery', {}) };
  },
  addCg(id) {
    const g = this.get();
    if (!g.cgs.includes(id)) write('gallery', { ...g, cgs: [...g.cgs, id] });
  },
  addEnding(id) {
    const g = this.get();
    if (!g.endings.includes(id)) write('gallery', { ...g, endings: [...g.endings, id] });
  },
};
