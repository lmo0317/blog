import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const IMAGE_MODEL_CATALOG = {
  'gemini-imagen': {
    id: 'gemini-imagen',
    name: '💎 Google Imagen (Gemini 연동 · 스마트 고화질)',
    type: 'remote',
    sizeFormatted: '구독 연동',
    description: '구독 중인 Google Gemini(agy) 연동 스마트 고화질 엔진으로 1280px 고화질 실사 포토와 초고속 클라우드 신경망을 자동 매칭합니다.',
    isDefault: true
  },
  'real-photo': {
    id: 'real-photo',
    name: '📸 고화질 실사 라이프스타일 포토 (추천 · 100% 무결점)',
    type: 'remote',
    sizeFormatted: '실사 라이브러리',
    description: 'AI 왜곡이나 뭉개짐 없는 1280px 초고해상도 실제 촬영 라이프스타일 포토를 본문 섹션별로 1:1 자동 매칭합니다. (워터마크 0%, 실패율 0%, 초고속)'
  },
  pollinations: {
    id: 'pollinations',
    name: '⚡ 온라인 FLUX (초고속 AI 일러스트/사진)',
    type: 'remote',
    sizeFormatted: '클라우드',
    description: '온라인 클라우드 AI 엔진을 사용하여 2초 만에 감성적인 고화질 이미지를 생성합니다.'
  }
};

export class ImageModelManager extends EventEmitter {
  constructor({ engineDir, configPath }) {
    super();
    this.engineDir = engineDir;
    this.configPath = configPath;
    this.activeModelId = 'gemini-imagen';
    this.agyClient = null;
  }

  async init() {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    try {
      const c = JSON.parse(await readFile(this.configPath, 'utf8'));
      if (IMAGE_MODEL_CATALOG[c.activeModelId]) {
        this.activeModelId = c.activeModelId;
      } else {
        this.activeModelId = 'gemini-imagen';
      }
    } catch {
      this.activeModelId = 'gemini-imagen';
    }
  }

  async installed(id) {
    return id in IMAGE_MODEL_CATALOG;
  }

  async list() {
    return Object.values(IMAGE_MODEL_CATALOG).map((m) => ({
      ...m,
      isInstalled: true,
      isActive: m.id === this.activeModelId,
      isDownloading: false,
      downloadedBytes: 0,
      downloadedFormatted: '클라우드 연동',
      percent: 100
    }));
  }

  async select(id) {
    const m = IMAGE_MODEL_CATALOG[id];
    if (!m) throw new Error('존재하지 않는 이미지 모델입니다.');
    this.activeModelId = id;
    await writeFile(this.configPath, JSON.stringify({ activeModelId: id }, null, 2));
    return m;
  }

  async download(id) {
    return { ok: true, message: '클라우드 모델은 별도 다운로드가 필요 없습니다.', id };
  }
}
