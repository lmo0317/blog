// Claude and Gemini on the user's own subscriptions, used when the local model is not an option.
// Each call runs the vendor CLI once, non-interactively, the same way edumaster does:
//  - Claude: Claude Code CLI (`claude -p`), signed in with `claude auth login`.
//  - Gemini: Antigravity CLI (`agy -p`), signed in on its first interactive run.
// Nothing is billed per call; each subscription's own usage limits apply.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CLOUD_PROVIDERS = ['claude', 'gemini'];

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
];
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash-medium';
const STATUS_TTL_MS = { claude: 60000, gemini: 600000 };

function findBin(provider) {
  const home = os.homedir();
  const candidates = provider === 'claude'
    ? [process.env.NEIGHBORMATE_CLAUDE_CLI, path.join(home, '.local', 'bin', 'claude.exe'), path.join(home, '.local', 'bin', 'claude')]
    : [process.env.NEIGHBORMATE_AGY_CLI, path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'agy', 'bin', 'agy.exe'), path.join(home, '.local', 'bin', 'agy')];
  return candidates.find((candidate) => candidate && existsSync(candidate)) || '';
}

// A CLI started from inside another Claude Code session would pick up that session's credentials and proxy.
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(CLAUDE|ANTHROPIC)/i.test(key)) delete env[key];
  }
  return env;
}

function run(bin, args, { cwd, input = '', timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: cwd || os.tmpdir(), env: cleanEnv(), windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`응답 시간이 초과되었습니다 (${Math.round(timeoutMs / 1000)}초).`));
    }, timeoutMs);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`실행하지 못했습니다: ${error.message}`)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

// CLI output is one JSON object, either pretty-printed over many lines (newer `claude auth status --json`)
// or on its own line after log lines; try the whole output first, then the last single-line object.
export function lastJsonLine(text) {
  const trimmed = String(text || '').trim();
  const start = trimmed.indexOf('{');
  if (start >= 0) {
    try { return JSON.parse(trimmed.slice(start)); } catch {}
  }
  const line = trimmed.split('\n').filter((l) => l.trim().startsWith('{')).pop();
  try { return line ? JSON.parse(line) : null; } catch { return null; }
}

export class CloudLlmManager {
  constructor({ settingsPath }) {
    this.settingsPath = settingsPath;
    this.settings = { engine: 'local', claudeModel: 'claude-opus-5-5', geminiModel: DEFAULT_GEMINI_MODEL };
    this.status = {
      claude: { installed: false, connected: false, checkedAt: 0, account: '', plan: '', error: '' },
      gemini: { installed: false, connected: false, checkedAt: 0, account: '', plan: '', error: '', models: [] }
    };
    this.checking = {};
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.settingsPath, 'utf8'));
      this.settings = { ...this.settings, ...saved };
    } catch {}
    if (!['local', ...CLOUD_PROVIDERS].includes(this.settings.engine)) this.settings.engine = 'local';
    return this.settings;
  }

  async saveSettings(patch = {}) {
    if (patch.engine && !['local', ...CLOUD_PROVIDERS].includes(patch.engine)) throw new Error('알 수 없는 AI 엔진입니다.');
    if (patch.claudeModel && !CLAUDE_MODELS.some((m) => m.id === patch.claudeModel)) throw new Error('알 수 없는 Claude 모델입니다.');
    this.settings = { ...this.settings, ...patch };
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
    return this.settings;
  }

  isConnected(provider) {
    return Boolean(this.status[provider]?.connected);
  }

  /** The first connected subscription, preferring the one the user picked. */
  fallbackProvider() {
    const order = [this.settings.engine, ...CLOUD_PROVIDERS].filter((p) => CLOUD_PROVIDERS.includes(p));
    return order.find((p) => this.isConnected(p)) || '';
  }

  modelFor(provider) {
    return provider === 'claude' ? this.settings.claudeModel : this.settings.geminiModel;
  }

  labelFor(provider) {
    if (provider === 'claude') return `${CLAUDE_MODELS.find((m) => m.id === this.settings.claudeModel)?.label || this.settings.claudeModel} · 구독`;
    const model = this.status.gemini.models.find((m) => m.id === this.settings.geminiModel);
    return `${model?.label || this.settings.geminiModel} · 구독`;
  }

  async refreshStatus(provider, { force = false } = {}) {
    const entry = this.status[provider];
    if (!force && Date.now() - entry.checkedAt < STATUS_TTL_MS[provider]) return entry;
    if (this.checking[provider]) return this.checking[provider];
    this.checking[provider] = this.#check(provider).finally(() => { this.checking[provider] = null; });
    return this.checking[provider];
  }

  async #check(provider) {
    const entry = this.status[provider];
    const bin = findBin(provider);
    entry.installed = Boolean(bin);
    entry.checkedAt = Date.now();
    if (!bin) {
      entry.connected = false;
      entry.error = provider === 'claude' ? 'Claude Code가 설치되어 있지 않습니다.' : 'Antigravity(agy)가 설치되어 있지 않습니다.';
      return entry;
    }
    try {
      if (provider === 'claude') {
        const { stdout } = await run(bin, ['auth', 'status', '--json'], { timeoutMs: 20000 });
        const info = lastJsonLine(stdout) || {};
        // A saved login can be expired; the last call's 401 keeps it marked until the user signs in again.
        entry.connected = Boolean(info.loggedIn) && !entry.expired;
        entry.account = info.email || '';
        entry.plan = info.subscriptionType || '';
        entry.error = info.loggedIn ? (entry.expired ? '로그인이 만료되었습니다. 다시 연결해 주세요.' : '') : '계정 연결이 필요합니다.';
      } else {
        const { code, stdout } = await run(bin, ['models'], { timeoutMs: 30000 });
        const models = stdout.split('\n').map((line) => line.split('\t')).filter(([id, label]) => /^gemini-/.test(String(id || '').trim()) && label)
          .map(([id, label]) => ({ id: id.trim(), label: label.trim() }));
        entry.connected = code === 0 && models.length > 0;
        entry.models = models;
        entry.error = entry.connected ? '' : '계정 연결이 필요합니다.';
        if (entry.connected && !models.some((m) => m.id === this.settings.geminiModel)) {
          this.settings.geminiModel = (models.find((m) => m.id === DEFAULT_GEMINI_MODEL) || models[0]).id;
        }
      }
    } catch (error) {
      entry.connected = false;
      entry.error = error.message;
    }
    return entry;
  }

  /** Opens a console window where the user signs in; the settings screen polls the status afterwards. */
  openLogin(provider) {
    const bin = findBin(provider);
    if (!bin) throw new Error(this.status[provider]?.error || '프로그램이 설치되어 있지 않습니다.');
    if (process.platform !== 'win32') {
      throw new Error(`이 서버에서는 터미널에서 ${provider === 'claude' ? 'claude auth login' : 'agy'}을 실행해 로그인해 주세요.`);
    }
    const title = provider === 'claude' ? 'Claude 계정 연결' : 'Gemini 계정 연결';
    const command = provider === 'claude' ? [bin, 'auth', 'login'] : [bin];
    this.status[provider].expired = false;
    this.status[provider].checkedAt = 0;
    const child = spawn('cmd.exe', ['/c', 'start', title, 'cmd.exe', '/k', ...command], { env: cleanEnv(), detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  }

  /**
   * One chat turn on a subscription. messages are OpenAI-style ({ role, content } with a system message first).
   * Returns the answer text.
   */
  async complete(provider, { messages, timeoutMs = 120000 }) {
    const bin = findBin(provider);
    if (!bin) throw new Error(this.status[provider]?.error || '프로그램이 설치되어 있지 않습니다.');
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const user = messages.filter((m) => m.role !== 'system').map((m) => (m.role === 'assistant' ? `[이전 답변]\n${m.content}` : m.content)).join('\n\n');
    const dir = mkdtempSync(path.join(os.tmpdir(), `neighbormate-${provider}-`));
    try {
      if (provider === 'claude') {
        const args = ['-p', '--output-format', 'json', '--model', this.settings.claudeModel, '--system-prompt', system,
          '--no-session-persistence', '--tools', '', '--effort', 'low'];
        const { code, stdout, stderr } = await run(bin, args, { cwd: dir, input: user, timeoutMs });
        const result = lastJsonLine(stdout);
        if (!result) throw new Error(`Claude 실행 오류 (종료 코드 ${code}): ${(stderr || stdout).trim().slice(0, 200)}`);
        if (result.is_error || result.subtype !== 'success') {
          if (result.api_error_status === 401) {
            this.status.claude.expired = true;
            this.status.claude.connected = false;
            this.status.claude.error = '로그인이 만료되었습니다. 다시 연결해 주세요.';
          }
          throw new Error(`Claude 오류: ${String(result.result || result.subtype).slice(0, 200)}`);
        }
        return String(result.result || '').trim();
      }
      const prompt = `[시스템 지시]\n${system}\n\n[요청]\n${user}\n\n파일을 읽거나 쓰거나 명령을 실행하지 말고, 요청한 답만 출력한다.`;
      const { code, stdout, stderr } = await run(bin, ['-p', prompt, '--output-format', 'json', '--model', this.settings.geminiModel, '--sandbox'], { cwd: dir, timeoutMs });
      const result = lastJsonLine(stdout);
      if (!result) throw new Error(`Gemini 실행 오류 (종료 코드 ${code}): ${(stderr || stdout).trim().slice(0, 200)}`);
      if (result.status !== 'SUCCESS') throw new Error(`Gemini 오류: ${String(result.error || result.response || result.status).slice(0, 200)}`);
      return String(result.response || '').trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async describe() {
    await Promise.all(CLOUD_PROVIDERS.map((p) => this.refreshStatus(p)));
    return {
      settings: this.settings,
      claude: { ...this.status.claude, models: CLAUDE_MODELS },
      gemini: { ...this.status.gemini }
    };
  }
}
