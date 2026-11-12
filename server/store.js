/**
 * 极简持久化：
 *  - JsonStore：业务数据（用户、订单、解锁记录）整份 JSON，写入用 tmp + rename 保证原子性
 *  - EventLog：埋点事件 append-only 的 JSONL
 * Demo 规模足够；生产环境换成 MySQL/Redis + ClickHouse 之类即可，路由层不用改。
 */
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(file, initial) {
    this.file = file;
    this.data = structuredClone(initial);
    if (fs.existsSync(file)) {
      try {
        Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch (e) {
        // 文件损坏时保留现场，避免覆盖掉可恢复的数据
        const backup = `${file}.corrupt-${Date.now()}`;
        fs.copyFileSync(file, backup);
        console.error(`[store] ${file} 解析失败，已备份到 ${backup}：${e.message}`);
      }
    }
  }

  /** 修改数据并立即落盘（付费解锁这类数据不能丢，所以同步写） */
  mutate(fn) {
    const result = fn(this.data);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
    return result;
  }
}

export class EventLog {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  append(events) {
    if (!events.length) return;
    fs.appendFileSync(this.file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }

  readAll() {
    if (!fs.existsSync(this.file)) return [];
    const out = [];
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* 跳过写了一半的行 */
      }
    }
    return out;
  }
}
