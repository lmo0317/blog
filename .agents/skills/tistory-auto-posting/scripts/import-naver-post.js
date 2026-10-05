#!/usr/bin/env node
// Convert a published Naver Blog post into Tistory publish inputs:
// <out>/content.html (with <!-- image:N --> markers), <out>/images.json,
// <out>/images/*, and <out>/meta.json ({ title, tags, source }).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function readNaverPost(blogId, logNo) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    await page.goto(`https://m.blog.naver.com/${blogId}/${logNo}`, { waitUntil: 'networkidle' });
    return await page.evaluate(() => {
      const clean = (t) => t.replace(/\u200b/g, '').trim();
      const comps = [...document.querySelectorAll('.se-main-container > .se-component')].map((c) => {
        const cls = c.className;
        if (cls.includes('se-image')) {
          const img = c.querySelector('img');
          return { type: 'image', src: img?.getAttribute('data-lazy-src') || img?.src, caption: clean(c.querySelector('.se-caption')?.innerText || '') };
        }
        if (cls.includes('se-text')) return { type: 'text', paras: [...c.querySelectorAll('.se-text-paragraph')].map((p) => clean(p.innerText)) };
        if (cls.includes('se-sectionTitle')) return { type: 'heading', text: clean(c.innerText) };
        if (cls.includes('se-quotation')) return { type: 'quote', text: clean(c.innerText) };
        if (cls.includes('se-horizontalLine')) return { type: 'hr' };
        if (cls.includes('se-oglink')) return { type: 'link', href: c.querySelector('a')?.href, text: clean(c.querySelector('.se-oglink-title')?.innerText || c.innerText) };
        return { type: 'other', text: clean(c.innerText) };
      });
      return { title: clean(document.querySelector('.se-title-text')?.innerText || ''), comps };
    });
  } finally {
    await browser.close();
  }
}

export async function importNaverPost(url, outArg = '') {
  const match = String(url || '').match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/);
  if (!match) throw new Error(`네이버 글 주소 형식이 아닙니다: ${url}`);
  const [, blogId, logNo] = match;
  const outDir = path.resolve(outArg || `D:/work/dev/blog/output/tistory-import/${logNo}`).replace(/\\/g, '/');
  fs.mkdirSync(`${outDir}/images`, { recursive: true });

  const post = await readNaverPost(blogId, logNo);
  if (!post.title || !post.comps.length) throw new Error('네이버 글 본문을 읽지 못했습니다.');

  const out = [];
  const images = [];
  let tags = [];

  for (const [index, comp] of post.comps.entries()) {
    if (comp.type === 'image') {
      const src = comp.src.replace(/\?type=\w+$/, '') + '?type=w966';
      const res = await fetch(src, { headers: { Referer: 'https://m.blog.naver.com/', 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`이미지 다운로드 실패 (${res.status}): ${src}`);
      const name = `${String(images.length + 1).padStart(2, '0')}_${decodeURIComponent(src.split('/').pop().split('?')[0])}`;
      const filePath = `${outDir}/images/${name}`;
      fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
      images.push({ filePath, title: comp.caption });
      out.push(`<!-- image:${images.length} -->`);
      if (comp.caption) out.push(`<p style="text-align: center;">${esc(comp.caption)}</p>`);
      continue;
    }
    if (comp.type === 'heading') { out.push(`<h2>${esc(comp.text)}</h2>`); continue; }
    if (comp.type === 'quote') { out.push(`<blockquote><p>${esc(comp.text).replace(/\n/g, '<br>')}</p></blockquote>`); continue; }
    if (comp.type === 'hr') { out.push('<hr>'); continue; }
    if (comp.type === 'link') { out.push(`<p><a href="${esc(comp.href)}" target="_blank" rel="noopener">${esc(comp.text || comp.href)}</a></p>`); continue; }
    if (comp.type === 'other') { if (comp.text) out.push(`<p>${esc(comp.text)}</p>`); continue; }

    const paras = comp.paras.filter(Boolean);
    const nextIsImage = post.comps[index + 1]?.type === 'image';
    let list = [];
    const flush = () => {
      if (list.length) out.push(`<ul>${list.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`);
      list = [];
    };
    paras.forEach((text, i) => {
      const words = text.split(/\s+/);
      if (words.every((w) => /^#\S/.test(w))) { tags = words.map((w) => w.slice(1)); return; }
      if (/^[-•·]\s+/.test(text)) { list.push(text.replace(/^[-•·]\s+/, '')); return; }
      flush();
      // Naver posts in this blog mark sections as "N. 소제목" right before the section image.
      const isHeading = /^\d{1,2}\.\s/.test(text) && text.length <= 80 && i === paras.length - 1 && nextIsImage;
      out.push(isHeading ? `<h2>${esc(text)}</h2>` : `<p>${esc(text).replace(/\n/g, '<br>')}</p>`);
    });
    flush();
  }

  fs.writeFileSync(`${outDir}/content.html`, out.join('\n'));
  fs.writeFileSync(`${outDir}/images.json`, JSON.stringify(images, null, 2));
  fs.writeFileSync(`${outDir}/meta.json`, JSON.stringify({ title: post.title, tags, source: url }, null, 2));
  return {
    outDir,
    contentFile: `${outDir}/content.html`,
    imagesFile: `${outDir}/images.json`,
    title: post.title,
    tags,
    images: images.length,
    headings: out.filter((line) => line.startsWith('<h2')).length
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [url, outArg] = process.argv.slice(2);
  if (!url) {
    console.error('Usage: node import-naver-post.js https://blog.naver.com/<blogId>/<logNo> [outDir]');
    process.exit(1);
  }
  console.log(JSON.stringify(await importNaverPost(url, outArg), null, 2));
}
