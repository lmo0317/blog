#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use the NaverBrowserSession from the blog project
const naverLibPath = 'D:/work/dev/blog/windows/lib/naver.js';
const { NaverBrowserSession } = await import(`file:///${naverLibPath}`);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    title: '',
    contentFile: '',
    category: '',
    tags: [],
    imagesFile: ''
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--title' && i + 1 < args.length) {
      options.title = args[++i];
    } else if (arg === '--content-file' && i + 1 < args.length) {
      options.contentFile = args[++i];
    } else if (arg === '--category' && i + 1 < args.length) {
      options.category = args[++i];
    } else if (arg === '--tags' && i + 1 < args.length) {
      options.tags = args[++i].split(',').map((t) => t.trim()).filter(Boolean);
    } else if (arg === '--images-file' && i + 1 < args.length) {
      options.imagesFile = args[++i];
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  if (!options.title || !options.contentFile) {
    console.error('Usage: node publish-post.js --title <title> --content-file <path> [--category <cat>] [--tags tag1,tag2] [--images-file <images.json>]');
    process.exit(1);
  }

  const content = fs.readFileSync(path.resolve(options.contentFile), 'utf8');
  let images = [];
  if (options.imagesFile && fs.existsSync(options.imagesFile)) {
    images = JSON.parse(fs.readFileSync(path.resolve(options.imagesFile), 'utf8'));
  }

  console.log(`[publish-post] Publishing: "${options.title}" to category: "${options.category || '기본'}"`);

  const browserSession = new NaverBrowserSession({
    headless: false,
    profileDir: 'D:/work/dev/blog/apps/engagement/.playwright/naver-profile',
    sessionStatePath: 'D:/work/dev/blog/apps/engagement/.playwright/naver-session.json'
  });

  const restored = await browserSession.restoreSession();
  if (!browserSession.connected) {
    throw new Error('네이버 로그인 세션이 만료되었거나 연결되지 않았습니다.');
  }

  const result = await browserSession.publishBlogPost({
    title: options.title,
    content,
    tags: options.tags,
    images,
    categoryName: options.category
  });

  console.log(JSON.stringify(result, null, 2));
  await browserSession.close().catch(() => {});
}

main().catch((err) => {
  console.error('[publish-post] Failed:', err);
  process.exit(1);
});
