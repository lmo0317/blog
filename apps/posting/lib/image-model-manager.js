import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access, readdir, stat, rename, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { isComfyUiRunning, generateWithComfyUi } from './comfyui-client.js';

export const IMAGE_MODEL_CATALOG = {
  'comfyui-z-image-turbo': { id: 'comfyui-z-image-turbo', name: 'Z-Image-Turbo (로컬 ComfyUI · RTX 5080 초고속)', type: 'comfyui', repo: 'Comfy-Org/z_image_turbo', expectedSizeBytes: 12.31 * 1024 ** 3, sizeFormatted: '11.5 GB', description: '로컬 ComfyUI의 Z-Image-Turbo로 1~2초 만에 초고화질 이미지를 생성합니다. (원클릭 설치 & 자동 실행)' },
  pollinations: { id: 'pollinations', name: '온라인 FLUX 우선 이미지 (빠름)', type: 'remote', sizeFormatted: '설치 없음', description: '온라인 FLUX를 우선 사용하며 실패할 때만 호환 모델로 전환합니다.' },
  // Deprecated heavy models (hidden from UI menu)
  'z-image-turbo': { id: 'z-image-turbo', name: 'Z-Image-Turbo (Diffusers)', type: 'local', repo: 'Tongyi-MAI/Z-Image-Turbo', expectedSizeBytes: 31 * 1024 ** 3, sizeFormatted: '약 31 GB', description: '실사와 인물 표현에 강한 8스텝 로컬 이미지 모델입니다.', hidden: true },
  'flux-2-klein-4b': { id: 'flux-2-klein-4b', name: 'FLUX.2 Klein 4B', type: 'local', repo: 'black-forest-labs/FLUX.2-klein-4B', expectedSizeBytes: 13 * 1024 ** 3, sizeFormatted: '약 13 GB', description: '가볍고 빠른 4B 로컬 생성·편집 모델입니다.', hidden: true }
};

function formatBytes(bytes) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`; }

async function directorySize(dir) {
  let total = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await directorySize(target);
      else if (entry.isFile()) total += (await stat(target)).size;
    }
  } catch {}
  return total;
}

export class ImageModelManager extends EventEmitter {
  constructor({ engineDir, configPath }) {
    super(); this.engineDir = engineDir; this.modelsDir = path.join(engineDir, 'models'); this.cacheDir = path.join(engineDir, 'cache'); this.configPath = configPath; this.activeModelId = 'comfyui-z-image-turbo'; this.downloads = new Map();
  }
  async init() { await Promise.all([mkdir(this.modelsDir,{recursive:true}),mkdir(this.cacheDir,{recursive:true}),mkdir(path.dirname(this.configPath),{recursive:true})]); try { const c=JSON.parse(await readFile(this.configPath,'utf8')); if(IMAGE_MODEL_CATALOG[c.activeModelId] && !IMAGE_MODEL_CATALOG[c.activeModelId].hidden) this.activeModelId=c.activeModelId; else this.activeModelId='comfyui-z-image-turbo'; } catch {} }
  modelDir(id) { return path.join(this.modelsDir, id); }
  async installed(id) {
    if(id==='pollinations') return true;
    if(id==='comfyui-z-image-turbo') {
      try { await access('D:\\work\\ai\\comfyui\\models\\unet\\z_image_turbo_bf16.safetensors'); return true; } catch {}
      try { await access('D:\\work\\ai\\comfyui\\models\\diffusion_models\\z_image_turbo_bf16.safetensors'); return true; } catch {}
      return false;
    }
    try { await access(path.join(this.modelDir(id), '.installed')); return true; } catch { return false; }
  }
  async list() {
    const visibleModels = Object.values(IMAGE_MODEL_CATALOG).filter((m) => !m.hidden);
    return Promise.all(visibleModels.map(async m=>{
      const isInstalled=await this.installed(m.id);
      let downloadedBytes = 0;
      if (m.id === 'comfyui-z-image-turbo') downloadedBytes = isInstalled ? 11.46 * 1024 ** 3 : 0;
      else if (m.type==='local') downloadedBytes = await directorySize(this.modelDir(m.id));
      const percent=m.expectedSizeBytes ? Math.min(99,Math.floor(downloadedBytes/m.expectedSizeBytes*100)) : (isInstalled ? 100 : 0);
      return {...m,isInstalled,isActive:m.id===this.activeModelId,isDownloading:this.downloads.has(m.id)||(m.type==='local'&&!isInstalled&&downloadedBytes>0),downloadedBytes,downloadedFormatted:formatBytes(downloadedBytes),percent};
    }));
  }
  async select(id) { const m=IMAGE_MODEL_CATALOG[id]; if(!m) throw new Error('존재하지 않는 이미지 모델입니다.'); if(!(await this.installed(id))) throw new Error('이미지 모델을 먼저 다운로드해주세요.'); this.activeModelId=id; await writeFile(this.configPath,JSON.stringify({activeModelId:id},null,2)); return m; }
  async download(id) {
    const m = IMAGE_MODEL_CATALOG[id];
    if (!m || (m.type !== 'local' && m.type !== 'comfyui')) throw new Error('다운로드할 로컬 이미지 모델이 아닙니다.');
    if (this.downloads.has(id)) return;

    if (id === 'comfyui-z-image-turbo' || m.type === 'comfyui') {
      const comfyBase = 'D:\\work\\ai\\comfyui';
      const unetTarget = path.join(comfyBase, 'models', 'unet');
      const textEncTarget = path.join(comfyBase, 'models', 'text_encoders');
      const vaeTarget = path.join(comfyBase, 'models', 'vae');
      await Promise.all([
        mkdir(unetTarget, { recursive: true }),
        mkdir(textEncTarget, { recursive: true }),
        mkdir(vaeTarget, { recursive: true })
      ]);

      const tempTarget = path.join(this.engineDir, 'temp-comfy-download');
      await mkdir(tempTarget, { recursive: true });

      const env = { ...process.env, UV_CACHE_DIR: this.cacheDir, HF_HOME: path.join(this.engineDir, 'huggingface') };
      const filesToDownload = [
        'split_files/diffusion_models/z_image_turbo_bf16.safetensors',
        'split_files/text_encoders/qwen_3_4b.safetensors',
        'split_files/vae/ae.safetensors'
      ];
      const child = spawn('uvx', [
        '--from', 'huggingface_hub', 'hf', 'download',
        m.repo || 'Comfy-Org/z_image_turbo',
        ...filesToDownload,
        '--local-dir', tempTarget
      ], { env, windowsHide: true });

      this.downloads.set(id, child);
      const startedAt = Date.now();
      let lastBytes = await directorySize(tempTarget);
      let lastAt = startedAt;

      const timer = setInterval(async () => {
        const downloadedBytes = await directorySize(tempTarget);
        const now = Date.now();
        const speedBps = Math.max(0, (downloadedBytes - lastBytes) / Math.max(1, (now - lastAt) / 1000));
        lastBytes = downloadedBytes;
        lastAt = now;
        const totalSize = m.expectedSizeBytes || (12.31 * 1024 ** 3);
        const percent = Math.min(99, Math.floor((downloadedBytes / totalSize) * 100));

        this.emit('progress', {
          modelId: id,
          phase: 'downloading',
          message: `${m.name} 다운로드 중`,
          percent,
          downloadedBytes,
          downloadedFormatted: formatBytes(downloadedBytes),
          totalFormatted: m.sizeFormatted,
          speedMbps: `${(speedBps / 1024 / 1024).toFixed(1)} MB/s`
        });
      }, 1500);

      let error = '';
      child.stderr.on('data', (d) => { error += d; });
      child.on('exit', async (code) => {
        clearInterval(timer);
        this.downloads.delete(id);

        if (code === 0) {
          try {
            const downloadedUnet = path.join(tempTarget, 'split_files', 'diffusion_models', 'z_image_turbo_bf16.safetensors');
            const downloadedTextEnc = path.join(tempTarget, 'split_files', 'text_encoders', 'qwen_3_4b.safetensors');
            const downloadedVae = path.join(tempTarget, 'split_files', 'vae', 'ae.safetensors');

            const moveOrCopy = async (src, dst) => {
              try {
                await rename(src, dst);
              } catch {
                await copyFile(src, dst);
                await rm(src, { force: true }).catch(() => {});
              }
            };

            await Promise.all([
              moveOrCopy(downloadedUnet, path.join(unetTarget, 'z_image_turbo_bf16.safetensors')),
              moveOrCopy(downloadedTextEnc, path.join(textEncTarget, 'qwen_3_4b.safetensors')),
              moveOrCopy(downloadedVae, path.join(vaeTarget, 'ae.safetensors'))
            ]);

            await rm(tempTarget, { recursive: true, force: true }).catch(() => {});
            await this.select(id);
            this.emit('complete', { modelId: id, activeModelId: id });
          } catch (moveErr) {
            this.emit('error', { modelId: id, message: `파일 저장 실패: ${moveErr.message}` });
          }
        } else {
          this.emit('error', { modelId: id, message: error.slice(-500) || `다운로드 종료 코드 ${code}` });
        }
      });
      return;
    }

    const target = this.modelDir(id);
    await mkdir(target, { recursive: true });
    const env = { ...process.env, UV_CACHE_DIR: this.cacheDir, HF_HOME: path.join(this.engineDir, 'huggingface') };
    const child = spawn('uvx', ['--from', 'huggingface_hub', 'hf', 'download', m.repo, '--local-dir', target], { env, windowsHide: true });
    this.downloads.set(id, child);
    const startedAt = Date.now();
    let lastBytes = await directorySize(target);
    let lastAt = startedAt;
    const timer = setInterval(async () => {
      const downloadedBytes = await directorySize(target);
      const now = Date.now();
      const speedBps = Math.max(0, (downloadedBytes - lastBytes) / Math.max(1, (now - lastAt) / 1000));
      lastBytes = downloadedBytes;
      lastAt = now;
      this.emit('progress', { modelId: id, phase: 'downloading', message: `${m.name} 다운로드 중`, percent: Math.min(99, Math.floor(downloadedBytes / m.expectedSizeBytes * 100)), downloadedBytes, downloadedFormatted: formatBytes(downloadedBytes), totalFormatted: m.sizeFormatted, speedMbps: `${(speedBps / 1024 / 1024).toFixed(1)} MB/s` });
    }, 1500);
    let error = '';
    child.stderr.on('data', d => { error += d; });
    child.on('exit', async code => {
      clearInterval(timer);
      this.downloads.delete(id);
      if (code === 0) {
        await writeFile(path.join(target, '.installed'), new Date().toISOString());
        await this.select(id);
        this.emit('complete', { modelId: id, activeModelId: id });
      } else {
        this.emit('error', { modelId: id, message: error.slice(-500) || `다운로드 종료 코드 ${code}` });
      }
    });
  }
  async generate({prompt,style,outputPath}) {
    const m=IMAGE_MODEL_CATALOG[this.activeModelId];
    if(!m) return null;
    if(this.activeModelId==='comfyui-z-image-turbo' || m.type==='comfyui') {
      await generateWithComfyUi({ prompt, outputPath, autoLaunch: true });
      return { ...m, outputPath };
    }
    if(m.type!=='local') return null;
    if(!(await this.installed(m.id))) throw new Error(`${m.name} 모델이 설치되어 있지 않습니다.`);
    const worker=path.join(this.engineDir,'worker.py');
    const env={...process.env,UV_CACHE_DIR:this.cacheDir,HF_HOME:path.join(this.engineDir,'huggingface'),PYTHONUTF8:'1',UV_DEFAULT_INDEX:'https://download.pytorch.org/whl/cu128',UV_EXTRA_INDEX_URL:'https://pypi.org/simple',UV_INDEX_STRATEGY:'unsafe-best-match'};
    const args=['run','--python','3.12','--with','torch==2.10.0+cu128','--with','diffusers','--with','transformers','--with','accelerate','--with','safetensors',worker,'--model',m.id,'--model-dir',this.modelDir(m.id),'--prompt',prompt,'--style',style,'--output',outputPath];
    await new Promise((resolve,reject)=>{
      const p=spawn('uv',args,{env,windowsHide:true});
      let err=''; let settled=false;
      const killTree = () => {
        if (p.pid && process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']);
        } else {
          try { p.kill('SIGKILL'); } catch {}
        }
      };
      const finish=(error)=>{if(settled)return; settled=true; clearTimeout(timer); if(error) killTree(); error?reject(error):resolve();};
      const timer=setTimeout(()=>{killTree(); finish(new Error(`${m.name} 이미지 생성이 5분을 초과해 자동 중단되었습니다.`));},300000);
      p.stderr.on('data',d=>{err+=d});
      p.on('error',error=>finish(error));
      p.on('exit',code=>code===0?finish():finish(new Error(err.slice(-1600)||`이미지 엔진 종료 코드 ${code}`)));
    });
    return {...m,outputPath};
  }
}
