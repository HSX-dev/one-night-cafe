/**
 * 剧情加载：按文件 mtime 缓存，改了 story.json 刷新页面即生效（无需重启服务）。
 * 加载时跑一遍校验，有错误就拒绝下发并把错误列表返回给前端展示。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateStory } from '../public/js/engine/validate.js';

export class StoryError extends Error {
  constructor(errors) {
    super(`剧情配置有 ${errors.length} 处错误`);
    this.errors = errors;
  }
}

export function createStoryLoader(file) {
  let cache = null;

  function load() {
    const { mtimeMs } = fs.statSync(file);
    if (cache && cache.mtimeMs === mtimeMs) return cache;

    const raw = fs.readFileSync(file, 'utf8');
    let story;
    try {
      story = JSON.parse(raw);
    } catch (e) {
      throw new StoryError([`JSON 语法错误：${e.message}`]);
    }
    const report = validateStory(story);
    if (report.errors.length) throw new StoryError(report.errors);
    for (const w of report.warnings) console.warn(`[story] ! ${w}`);

    cache = {
      mtimeMs,
      story,
      report,
      publicJson: JSON.stringify(toPublic(story)),
      etag: `"${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}"`,
    };
    console.log(`[story] 已加载 ${file}（${report.stats.nodes} 个节点）`);
    return cache;
  }

  return { load, get: () => load().story };
}

/** 下发给前端的版本：去掉 AI 人设（服务端专用）和付费 CG 的原图路径 */
function toPublic(story) {
  const copy = structuredClone(story);
  for (const c of Object.values(copy.characters ?? {})) delete c.persona;
  for (const cg of Object.values(copy.cgs ?? {})) if (cg.paid) delete cg.file;
  return copy;
}
