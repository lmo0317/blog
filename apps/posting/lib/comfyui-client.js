import { spawn } from 'node:child_process';
import { writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const COMFYUI_DEFAULT_PORT = 8188;
const COMFYUI_BASE_URL = `http://127.0.0.1:${COMFYUI_DEFAULT_PORT}`;
const COMFYUI_DIR = 'D:\\work\\ai\\comfyui';
const COMFYUI_PYTHON = path.join(COMFYUI_DIR, '.venv', 'Scripts', 'python.exe');

let startingPromise = null;

export async function isComfyUiRunning(baseUrl = COMFYUI_BASE_URL) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${baseUrl}/system_stats`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureComfyUiRunning({ baseUrl = COMFYUI_BASE_URL, maxWaitMs = 35000 } = {}) {
  if (await isComfyUiRunning(baseUrl)) {
    return true;
  }

  if (startingPromise) {
    return startingPromise;
  }

  startingPromise = (async () => {
    try {
      console.log('[ComfyUI] ComfyUI 서버가 꺼져 있어 백그라운드로 자동 실행합니다...');

      try {
        await access(COMFYUI_PYTHON);
      } catch {
        throw new Error(`ComfyUI 파이썬 실행 파일을 찾을 수 없습니다: ${COMFYUI_PYTHON}`);
      }

      const child = spawn(COMFYUI_PYTHON, ['main.py', '--listen', '127.0.0.1', '--port', String(COMFYUI_DEFAULT_PORT)], {
        cwd: COMFYUI_DIR,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });

      child.unref();

      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await isComfyUiRunning(baseUrl)) {
          console.log('[ComfyUI] ComfyUI 서버가 성공적으로 준비되었습니다 (포트 8188).');
          return true;
        }
      }

      throw new Error(`ComfyUI 자동 실행 후 ${maxWaitMs / 1000}초 동안 응답이 없습니다.`);
    } finally {
      startingPromise = null;
    }
  })();

  return startingPromise;
}

export function buildZImageTurboPromptWorkflow({ prompt, width = 1024, height = 768, seed, steps = 8 }) {
  const actualSeed = Number.isInteger(seed) ? seed : Math.floor(Math.random() * 1000000000);
  return {
    "30": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen_3_4b.safetensors",
        type: "lumina2",
        device: "default"
      }
    },
    "29": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "ae.safetensors"
      }
    },
    "28": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "z_image_turbo_bf16.safetensors",
        weight_dtype: "default"
      }
    },
    "11": {
      class_type: "ModelSamplingAuraFlow",
      inputs: {
        model: ["28", 0],
        shift: 3.0
      }
    },
    "27": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: String(prompt || '').trim(),
        clip: ["30", 0]
      }
    },
    "33": {
      class_type: "ConditioningZeroOut",
      inputs: {
        conditioning: ["27", 0]
      }
    },
    "13": {
      class_type: "EmptySD3LatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1
      }
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: actualSeed,
        steps: steps,
        cfg: 1.0,
        sampler_name: "res_multistep",
        scheduler: "simple",
        denoise: 1.0,
        model: ["11", 0],
        positive: ["27", 0],
        negative: ["33", 0],
        latent_image: ["13", 0]
      }
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["29", 0]
      }
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "z-image-turbo",
        images: ["8", 0]
      }
    }
  };
}

export async function generateWithComfyUi({ prompt, width = 1024, height = 768, seed, outputPath, baseUrl = COMFYUI_BASE_URL, timeoutMs = 60000, autoLaunch = true }) {
  if (autoLaunch) {
    await ensureComfyUiRunning({ baseUrl });
  }

  const workflow = buildZImageTurboPromptWorkflow({ prompt, width, height, seed });

  const res = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ComfyUI 프롬프트 전송 실패 (${res.status}): ${errText}`);
  }

  const { prompt_id } = await res.json();
  if (!prompt_id) throw new Error('ComfyUI prompt_id를 받지 못했습니다.');

  const startTime = Date.now();
  let imageInfo = null;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 600));
    try {
      const histRes = await fetch(`${baseUrl}/history/${prompt_id}`);
      if (histRes.ok) {
        const histData = await histRes.json();
        const runData = histData[prompt_id];
        if (runData && runData.outputs && runData.outputs['9'] && runData.outputs['9'].images && runData.outputs['9'].images.length > 0) {
          imageInfo = runData.outputs['9'].images[0];
          break;
        }
      }
    } catch {}
  }

  if (!imageInfo) {
    throw new Error(`ComfyUI 이미지 생성 타임아웃 (${timeoutMs / 1000}초 초과)`);
  }

  const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder || '')}&type=${encodeURIComponent(imageInfo.type || 'output')}`;
  const imgRes = await fetch(viewUrl);
  if (!imgRes.ok) {
    throw new Error(`ComfyUI 이미지 다운로드 실패 (${imgRes.status})`);
  }

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  if (outputPath) {
    await writeFile(outputPath, buffer);
  }
  return { buffer, imageInfo, outputPath };
}
