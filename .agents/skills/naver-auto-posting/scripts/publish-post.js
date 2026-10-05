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
    imagesFile: '',
    update: false,
    logNo: '',
    blogId: 'lmo0317'
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
    } else if (arg === '--update') {
      options.update = true;
    } else if (arg === '--log-no' && i + 1 < args.length) {
      options.logNo = args[++i];
      options.update = true;
    } else if (arg === '--blog-id' && i + 1 < args.length) {
      options.blogId = args[++i];
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  if (!options.title || !options.contentFile) {
    console.error('Usage: node publish-post.js --title <title> --content-file <path> [--category <cat>] [--tags tag1,tag2] [--images-file <images.json>] [--update --log-no <logNo>]');
    process.exit(1);
  }

  const content = fs.readFileSync(path.resolve(options.contentFile), 'utf8');
  let images = [];
  if (options.imagesFile && fs.existsSync(options.imagesFile)) {
    images = JSON.parse(fs.readFileSync(path.resolve(options.imagesFile), 'utf8')).map((img) => ({
      ...img,
      filePath: img.filePath || img.path
    }));
  }

  const sessionPaths = [
    'D:/work/dev/blog/apps/engagement/.playwright/naver-session.json',
    'D:/work/dev/blog/apps/posting/.playwright/naver-session.json',
    'D:/work/dev/blog/windows/.playwright/naver-session.json'
  ];
  const existingSession = sessionPaths.find((p) => fs.existsSync(p));
  const activeSessionPath = existingSession || sessionPaths[0];

  const browserSession = new NaverBrowserSession({
    headless: false,
    profileDir: 'D:/work/dev/blog/apps/engagement/.playwright/naver-profile',
    sessionStatePath: activeSessionPath
  });

  const restored = await browserSession.restoreSession();
  if (!browserSession.connected) {
    console.log('[publish-post] 저장된 세션이 없거나 만료되었습니다. 네이버 로그인 창을 엽니다...');
    const loginResult = await browserSession.openLoginWindow();
    if (!loginResult?.success) {
      throw new Error(loginResult?.message || '네이버 로그인에 실패했거나 대기 시간이 초과되었습니다.');
    }
    console.log(`[publish-post] ${loginResult.message}`);

    // Sync saved session state to both session paths
    for (const sp of sessionPaths) {
      try {
        if (fs.existsSync(browserSession.sessionStatePath) && sp !== browserSession.sessionStatePath) {
          fs.mkdirSync(path.dirname(sp), { recursive: true });
          fs.copyFileSync(browserSession.sessionStatePath, sp);
        }
      } catch {}
    }
  }

  if (options.update && options.logNo) {
    console.log(`[publish-post] Updating post ${options.logNo}: "${options.title}" to category: "${options.category || '기본'}"`);
    const prepResult = await browserSession.prepareBlogPostUpdate({
      blogId: options.blogId,
      logNo: options.logNo,
      title: options.title,
      content,
      tags: options.tags,
      images,
      links: []
    });
    console.log(`[publish-post] Prepared update:`, prepResult);
    const result = await browserSession.confirmPreparedBlogPostUpdate(options.category);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[publish-post] Publishing: "${options.title}" to category: "${options.category || '기본'}"`);
    const result = await browserSession.publishBlogPost({
      title: options.title,
      content,
      tags: options.tags,
      images,
      categoryName: options.category
    });
    console.log(JSON.stringify(result, null, 2));

    if (result?.status === 'published' && result?.url) {
      console.log(`\n🎉 성공적으로 발행되었습니다: ${result.url}`);

      // Record to INDEX.md
      const indexPath = 'D:/work/dev/blog/.agents/skills/naver-auto-posting/references/published-posts/INDEX.md';
      try {
        if (fs.existsSync(indexPath)) {
          const now = new Date();
          const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
          const logNoMatch = result.url.match(/logNo=(\d+)|\/(\d{10,})/);
          const logNo = logNoMatch ? (logNoMatch[1] || logNoMatch[2]) : 'link';
          const indexEntry = `| ${dateStr} | ${options.title} | ${options.tags.join(', ') || '-'} | ${options.category || '-'} | [${logNo}](${result.url}) |\n`;
          fs.appendFileSync(indexPath, indexEntry, 'utf8');
          console.log('📝 INDEX.md에 발행 이력이 기록되었습니다.');
        }
      } catch (err) {
        console.warn('INDEX.md 기록 중 경미한 오류:', err.message);
      }
    }
  }
  await browserSession.close().catch(() => {});
}

main().catch((err) => {
  console.error('[publish-post] Failed:', err);
  process.exit(1);
});
