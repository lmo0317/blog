import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Model specifications based on available VRAM
 */
export const MODEL_CATALOG = {
  'gemma-4-e2b': {
    id: 'gemma-4-e2b',
    name: 'Gemma 4 E2B (2.3B Effective)',
    category: 'lightweight',
    minVramMb: 0, // Works on CPU or any low-end GPU
    recommendedVramMb: 3000,
    sizeBytes: 1400000000, // ~1.4GB
    sizeFormatted: '1.4 GB',
    description: '초경량·초고속 멀티모달. 저사양 노트북이나 CPU 환경에서도 1초 내 빠른 댓글 생성.',
    filename: 'gemma-4-e2b-it-q4_k_m.gguf',
    downloadUrl: 'https://huggingface.co/google/gemma-4-e2b-it-GGUF/resolve/main/gemma-4-e2b-it-q4_k_m.gguf'
  },
  'gemma-4-e4b': {
    id: 'gemma-4-e4b',
    name: 'Gemma 4 E4B (4.5B Effective)',
    category: 'balanced',
    minVramMb: 4000,
    recommendedVramMb: 6000,
    sizeBytes: 2800000000, // ~2.8GB
    sizeFormatted: '2.8 GB',
    description: '고품질 비전 & 자연스러운 문맥 이해. 이미지 속 디테일을 정밀하게 파악하여 풍부한 감상평 작성.',
    filename: 'gemma-4-e4b-it-q4_k_m.gguf',
    downloadUrl: 'https://huggingface.co/google/gemma-4-e4b-it-GGUF/resolve/main/gemma-4-e4b-it-q4_k_m.gguf'
  },
  'gemma-4-12b': {
    id: 'gemma-4-12b',
    name: 'Gemma 4 12B Unified',
    category: 'performance',
    minVramMb: 8000,
    recommendedVramMb: 12000,
    sizeBytes: 7800000000, // ~7.8GB
    sizeFormatted: '7.8 GB',
    description: '전문가급 최고 지능 모델. 복합적인 이미지 분석과 장문 블로그 포스팅까지 완벽 처리.',
    filename: 'gemma-4-12b-it-q4_k_m.gguf',
    downloadUrl: 'https://huggingface.co/google/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-q4_k_m.gguf'
  }
};

/**
 * Detects GPUs and dedicated VRAM on Windows systems.
 */
export async function detectGpuSpecs() {
  const result = {
    hasDedicatedGpu: false,
    gpus: [],
    primaryGpu: null,
    totalVramMb: 0,
    vramFormatted: '0 MB'
  };

  // 1. Try nvidia-smi first (Most accurate for NVIDIA GPUs)
  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits', { timeout: 3000 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length >= 2) {
        const name = parts[0];
        const vramMb = parseInt(parts[1], 10) || 0;
        const driver = parts[2] || '';
        result.gpus.push({ name, vramMb, driver, vendor: 'NVIDIA' });
      }
    }
  } catch {
    // nvidia-smi not available or not NVIDIA
  }

  // 2. Fallback to PowerShell / WMI if nvidia-smi failed or no GPUs found
  if (result.gpus.length === 0 && process.platform === 'win32') {
    try {
      const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion | ConvertTo-Json -Compress"`;
      const { stdout } = await execAsync(cmd, { timeout: 4000 });
      if (stdout.trim()) {
        const parsed = JSON.parse(stdout);
        const controllers = Array.isArray(parsed) ? parsed : [parsed];
        for (const ctrl of controllers) {
          if (!ctrl || !ctrl.Name) continue;
          // AdapterRAM is in bytes, convert to MB
          const rawBytes = Number(ctrl.AdapterRAM) || 0;
          let vramMb = Math.round(rawBytes / (1024 * 1024));
          // WMI often caps AdapterRAM at 4GB (UINT32), but provides name
          result.gpus.push({
            name: ctrl.Name,
            vramMb: vramMb > 0 ? vramMb : 0,
            driver: ctrl.DriverVersion || '',
            vendor: detectVendor(ctrl.Name)
          });
        }
      }
    } catch {
      // WMI fallback failed
    }
  }

  if (result.gpus.length > 0) {
    // Pick the GPU with highest VRAM as primary
    result.gpus.sort((a, b) => b.vramMb - a.vramMb);
    result.primaryGpu = result.gpus[0];
    result.totalVramMb = result.primaryGpu.vramMb;
    result.hasDedicatedGpu = result.totalVramMb >= 1024 || /GeForce|Radeon RX|RTX|GTX|Arc/i.test(result.primaryGpu.name);
    result.vramFormatted = result.totalVramMb >= 1024 
      ? `${(result.totalVramMb / 1024).toFixed(1)} GB` 
      : `${result.totalVramMb} MB`;
  }

  return result;
}

/**
 * Get comprehensive hardware summary and recommended AI model.
 */
export async function getSystemHardwareSummary() {
  const gpuInfo = await detectGpuSpecs();
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0]?.model || 'Unknown CPU';
  const cpuCores = cpus.length;
  const totalRamBytes = os.totalmem();
  const freeRamBytes = os.freemem();
  const totalRamGb = Number((totalRamBytes / (1024 ** 3)).toFixed(1));
  const freeRamGb = Number((freeRamBytes / (1024 ** 3)).toFixed(1));

  // Determine optimal model recommendation based on VRAM
  let recommendedModelId = 'gemma-4-e2b';
  let tierLabel = '엔트리 / CPU 모드';
  let recommendationReason = 'VRAM 4GB 미만 또는 내장 그래픽 환경에 맞춰 가장 빠르고 가벼운 Gemma 4 E2B 모델을 추천합니다.';

  if (gpuInfo.totalVramMb >= 10000) {
    recommendedModelId = 'gemma-4-12b';
    tierLabel = '최고급 고성능 모드';
    recommendationReason = `감지된 VRAM(${gpuInfo.vramFormatted})이 넉넉하여 최고 수준의 비전 분석과 자연스러운 글 작성이 가능한 Gemma 4 12B 모델을 100% GPU 가속으로 구동할 수 있습니다.`;
  } else if (gpuInfo.totalVramMb >= 5000) {
    recommendedModelId = 'gemma-4-e4b';
    tierLabel = '밸런스 고품질 모드';
    recommendationReason = `감지된 VRAM(${gpuInfo.vramFormatted})에 최적화된 Gemma 4 E4B 모델로 이미지 세부 분석과 인간적인 댓글을 0.5초 내에 초고속 생성할 수 있습니다.`;
  } else if (gpuInfo.totalVramMb >= 3000) {
    recommendedModelId = 'gemma-4-e2b';
    tierLabel = '초고속 경량 모드';
    recommendationReason = `감지된 VRAM(${gpuInfo.vramFormatted})에 딱 맞아 100% GPU 가속으로 초고속 응답을 제공하는 Gemma 4 E2B 모델을 추천합니다.`;
  }

  return {
    os: {
      platform: process.platform,
      arch: process.arch,
      release: os.release()
    },
    cpu: {
      model: cpuModel,
      cores: cpuCores
    },
    ram: {
      totalGb: totalRamGb,
      freeGb: freeRamGb,
      totalFormatted: `${totalRamGb} GB`
    },
    gpu: gpuInfo,
    recommendedModel: {
      id: recommendedModelId,
      tier: tierLabel,
      reason: recommendationReason,
      modelInfo: MODEL_CATALOG[recommendedModelId]
    },
    catalog: Object.values(MODEL_CATALOG).map((model) => ({
      ...model,
      isRecommended: model.id === recommendedModelId,
      canFullOffload: gpuInfo.totalVramMb >= model.minVramMb
    }))
  };
}

function detectVendor(name) {
  if (/NVIDIA/i.test(name)) return 'NVIDIA';
  if (/AMD|Radeon/i.test(name)) return 'AMD';
  if (/Intel/i.test(name)) return 'Intel';
  return 'Unknown';
}