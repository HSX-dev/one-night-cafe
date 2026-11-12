import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 本地开发读取 .env（Node ≥ 20.12 内置，无需 dotenv）
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;

function hasAnthropicCredentials() {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE);
}

/** Cookie 签名密钥：优先用环境变量，否则在数据目录生成一个并持久化（重启后旧 Cookie 仍有效） */
function resolveCookieSecret(dataDir) {
  if (env.COOKIE_SECRET) return env.COOKIE_SECRET;
  const file = path.join(dataDir, '.cookie-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, secret);
    return secret;
  }
}

export function loadConfig(overrides = {}) {
  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? path.join(ROOT, 'data'));
  fs.mkdirSync(dataDir, { recursive: true });
  const provider = overrides.llmProvider ?? env.LLM_PROVIDER ?? (hasAnthropicCredentials() ? 'anthropic' : 'mock');
  return {
    port: Number(env.PORT) || 3000,
    dataDir,
    storyFile: path.resolve(overrides.storyFile ?? env.STORY_FILE ?? path.join(ROOT, 'story', 'story.json')),
    publicDir: path.join(ROOT, 'public'),
    protectedDir: path.join(ROOT, 'server', 'protected'),
    cookieSecret: overrides.cookieSecret ?? resolveCookieSecret(dataDir),
    statsToken: overrides.statsToken ?? env.STATS_TOKEN ?? '',
    secureCookies: env.NODE_ENV === 'production' && env.INSECURE_COOKIES !== '1',
    llm: {
      provider,
      model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
      effort: env.ANTHROPIC_EFFORT || 'low',
    },
    chat: {
      maxMessageLength: 200,
      perReplyMaxDelta: 5,
      ratePerMinute: Number(env.CHAT_RATE_PER_MINUTE) || 12,
      sessionTtlMs: 30 * 60 * 1000,
    },
  };
}
