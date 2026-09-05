import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { DEFAULT_PROMPT_CONFIG, normalizeGeneratedPost, parseLlmJson } from './llm.js';

const POST_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    lead: { type: 'string' },
    summaryPoints: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
    sections: {
      type: 'array', minItems: 4, maxItems: 6,
      items: {
        type: 'object',
        properties: { heading: { type: 'string' }, body: { type: 'string' }, imageQuery: { type: 'string' } },
        required: ['heading', 'body', 'imageQuery'], additionalProperties: false
      }
    },
    closing: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 8, maxItems: 10 },
    imageQueries: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 }
  },
  required: ['title', 'lead', 'summaryPoints', 'sections', 'closing', 'tags', 'imageQueries'],
  additionalProperties: false
};

function run(command, args, { cwd, input = '', timeoutMs = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('GPT 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Codex CLI를 실행할 수 없습니다: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`GPT 계정 호출에 실패했습니다 (${code}): ${(stderr || stdout).trim().slice(-800)}`));
    });
    child.stdin.end(input);
  });
}

function resolveCodexCommand() {
  if (process.env.POSTING_CODEX_COMMAND) return process.env.POSTING_CODEX_COMMAND;
  if (process.platform !== 'win32') return 'codex';
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const packageNames = ['codex-win32-x64', 'codex-win32-arm64'];
  const architectures = ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'];
  for (const dir of pathDirs) {
    for (const packageName of packageNames) {
      for (const architecture of architectures) {
        const candidate = path.join(dir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', packageName, 'vendor', architecture, 'bin', 'codex.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return 'codex.exe';
}

function articlePrompt(context, promptConfig) {
  const config = promptConfig || DEFAULT_PROMPT_CONFIG;
  return [
    config.systemPrompt,
    config.imagePromptInstructions,
    '',
    '[이번 작업의 필수 품질 기준]',
    '- 한국어 본문은 공백 제외 최소 1,500자, 권장 1,800~2,500자로 충분히 깊게 쓴다.',
    '- 서로 내용이 겹치지 않는 소제목 4~6개를 만든다. 각 절에는 원리, 구체적 실행법, 주의점이나 실전 팁을 담는다.',
    '- 확인하지 않은 개인 체험을 실제 경험처럼 꾸미지 않는다.',
    '- imageQueries는 정확히 3개이며 서로 다른 세 절을 대표하는 구체적인 실사 장면이어야 한다.',
    '- 글 안에 이미지 프롬프트, imageQuery, 출처가 없는 수치나 사실을 노출하지 않는다.',
    '- 결과는 지정된 JSON 스키마에 맞는 JSON 객체 하나만 출력한다.',
    '',
    '[입력]',
    JSON.stringify(context)
  ].filter(Boolean).join('\n');
}

export class CodexAccountClient {
  constructor({ appDir, imagesDir, command = resolveCodexCommand(), model = process.env.POSTING_CODEX_MODEL || 'gpt-5.6-sol', runner = run } = {}) {
    this.appDir = appDir;
    this.imagesDir = imagesDir;
    this.jobsDir = path.join(appDir, '.codex-jobs');
    this.command = command;
    this.model = model;
    this.runner = runner;
  }

  async status() {
    const codexHome = process.env.CODEX_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex');
    const connected = Boolean(codexHome) && existsSync(path.join(codexHome, 'auth.json'));
    return {
      connected,
      provider: 'ChatGPT',
      detail: connected ? '기존 Codex GPT 로그인 사용 가능' : 'Codex GPT 로그인 필요'
    };
  }

  async #job() {
    const jobDir = path.join(this.jobsDir, crypto.randomUUID());
    await mkdir(jobDir, { recursive: true });
    return jobDir;
  }

  async #generatePost(context, promptConfig = null, deals = []) {
    const auth = await this.status();
    if (!auth.connected) throw new Error('GPT 계정 로그인이 필요합니다. 터미널에서 codex login을 한 번 실행해주세요.');
    const jobDir = await this.#job();
    const schemaPath = path.join(jobDir, 'post-schema.json');
    const outputPath = path.join(jobDir, 'post.json');
    try {
      await writeFile(schemaPath, JSON.stringify(POST_SCHEMA), 'utf8');
      await this.runner(this.command, [
        'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
        '--sandbox', 'read-only', '--model', this.model,
        '--output-schema', schemaPath, '--output-last-message', outputPath, '-'
      ], { cwd: jobDir, input: articlePrompt(context, promptConfig) });
      const parsed = parseLlmJson(await readFile(outputPath, 'utf8'));
      const post = normalizeGeneratedPost(parsed, deals);
      if (post.content.replace(/\s/g, '').length < 1500 && !deals.length) {
        throw new Error('GPT가 작성한 글이 품질 기준(공백 제외 1,500자)에 미달했습니다. 다시 생성해주세요.');
      }
      if (!deals.length && post.imagePlans.length < 3) throw new Error('글에 맞는 이미지 계획 3개가 완성되지 않았습니다.');
      return post;
    } finally {
      await rm(jobDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  generateBlogPost(input) {
    return this.#generatePost({ mode: 'topic', ...input }, input.promptConfig);
  }

  generateArticleRewriteBlogPost(input) {
    return this.#generatePost({ mode: 'source_reinterpretation', ...input, sourceContent: String(input.sourceContent || '').slice(0, 12000) }, input.promptConfig);
  }

  generateDealsBlogPost(input) {
    return this.#generatePost({ mode: 'verified_deals', ...input }, null, input.deals || []);
  }

  async generateImagesForPost(post, { style = 'photorealistic', onProgress = null } = {}) {
    const auth = await this.status();
    if (!auth.connected) throw new Error('GPT 계정 로그인이 필요합니다.');
    const plans = (post.imagePlans || []).slice(0, 3);
    if (plans.length !== 3) throw new Error('이미지 생성 계획은 정확히 3개여야 합니다.');
    const images = [];
    for (let index = 0; index < plans.length; index += 1) {
      const jobDir = await this.#job();
      onProgress?.({ phase: 'image', current: index + 1, total: 3, message: `GPT 이미지 ${index + 1}/3 생성 중` });
      try {
        const plan = plans[index];
      const prompt = [
        '반드시 imagegen 스킬을 사용해 네이버 블로그용 이미지를 정확히 1장 생성하세요.',
        `전체 화풍: ${style}. 한국의 실제 생활 공간과 물건 규격을 반영한 자연스러운 고품질 에디토리얼 이미지.`,
        '이미지에는 글자, 로고, 워터마크, 콜라주, 분할 화면을 넣지 마세요.',
        '현재 작업 폴더에 image.png로 저장하세요.',
        '다른 파일은 만들지 말고, 생성이 끝나면 짧게 완료라고만 답하세요.',
        `삽입 소제목: ${plan.afterHeading}\n장면: ${plan.query}`
      ].join('\n\n');
      await this.runner(this.command, [
        'exec', '--ephemeral', '--skip-git-repo-check',
        '--sandbox', 'workspace-write', '--model', this.model, '-'
      ], { cwd: jobDir, input: prompt });

      const files = (await readdir(jobDir)).filter((name) => /\.png$/i.test(name)).sort();
      if (files.length !== 1) throw new Error(`GPT 이미지 ${index + 1}/3 파일을 확인하지 못했습니다.`);
      await mkdir(this.imagesDir, { recursive: true });
        const sourcePath = path.join(jobDir, files[0]);
        const metadata = await sharp(sourcePath).metadata();
        if (!metadata.width || !metadata.height || metadata.format !== 'png') throw new Error(`GPT 이미지 ${index + 1}/3 파일이 올바르지 않습니다.`);
        const filename = `gpt-${Date.now()}-${index + 1}.png`;
        const destination = path.join(this.imagesDir, filename);
        await copyFile(sourcePath, destination);
        images.push({
          id: `gpt-${crypto.randomUUID()}`,
          title: plans[index].afterHeading || `본문 이미지 ${index + 1}`,
          filePath: destination,
          previewUrl: `/generated-images/thumb/${filename}`,
          thumbnailUrl: `/generated-images/thumb/${filename}`,
          downloadUrl: `/generated-images/${filename}`,
          afterHeading: plans[index].afterHeading || '',
          caption: '',
          license: 'GPT 계정 생성 이미지',
          isAiGenerated: true,
          autoSelected: true,
          imageModelId: 'codex-chatgpt'
        });
        onProgress?.({ phase: 'image', current: index + 1, total: 3, message: `GPT 이미지 ${index + 1}/3 완료` });
      } finally {
        await rm(jobDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    return images;
  }
}
