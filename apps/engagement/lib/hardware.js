import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Model specifications based on available VRAM
 */
export const MODEL_CATALOG = {
  'gemma-4-e2b-it-qat-q4-0': {
    id: 'gemma-4-e2b-it-qat-q4-0',
    name: 'Gemma 4 E2B',
    category: 'fast',
    minVramMb: 4096,
    recommendedVramMb: 6144,
    sizeBytes: 3349516256,
    sizeFormatted: '3.12 GB',
    description: '가볍고 빠른 Google Gemma 4 E2B instruction-tuned QAT Q4_0 GGUF입니다.',
    filename: 'gemma-4-E2B_q4_0-it.gguf',
    downloadUrl: 'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/main/gemma-4-E2B_q4_0-it.gguf',
    sourceUrl: 'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf'
  },
  'gemma-4-e4b-it-qat-q4-0': {
    id: 'gemma-4-e4b-it-qat-q4-0',
    name: 'Gemma 4 E4B',
    category: 'balanced',
    minVramMb: 6144,
    recommendedVramMb: 8192,
    sizeBytes: 5154941280,
    sizeFormatted: '4.80 GB',
    description: '속도와 품질의 균형을 맞춘 Google Gemma 4 E4B instruction-tuned QAT Q4_0 GGUF입니다.',
    filename: 'gemma-4-E4B_q4_0-it.gguf',
    downloadUrl: 'https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/main/gemma-4-E4B_q4_0-it.gguf',
    sourceUrl: 'https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf'
  },
  'gemma-4-12b-it-qat-q4-0': {
    id: 'gemma-4-12b-it-qat-q4-0',
    name: 'Gemma 4 12B',
    category: 'performance',
    minVramMb: 8192,
    recommendedVramMb: 12288,
    sizeBytes: 6975879296,
    sizeFormatted: '6.50 GB',
    description: '공식 Google Gemma 4 12B instruction-tuned QAT GGUF. 설치 전용량을 내려받아야 하며, 텍스트 생성용 로컬 모델입니다.',
    filename: 'gemma-4-12b-it-qat-q4_0.gguf',
    downloadUrl: 'https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/resolve/main/gemma-4-12b-it-qat-q4_0.gguf',
    sourceUrl: 'https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf'
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
  let recommendedModelId = 'gemma-4-e2b-it-qat-q4-0';
  let tierLabel = 'Gemma 4 E2B 경량 모드';
  let recommendationReason = '낮은 VRAM에서도 사용할 수 있는 Gemma 4 E2B를 추천합니다.';

  if (gpuInfo.totalVramMb >= 12288) {
    recommendedModelId = 'gemma-4-12b-it-qat-q4-0';
    tierLabel = 'Gemma 4 12B 권장 모드';
    recommendationReason = `감지된 VRAM(${gpuInfo.vramFormatted})에서 공식 Gemma 4 12B Q4_0을 사용할 수 있습니다. 모델을 실제로 설치한 뒤 선택하세요.`;
  } else if (gpuInfo.totalVramMb >= 6144) {
    recommendedModelId = 'gemma-4-e4b-it-qat-q4-0';
    tierLabel = 'Gemma 4 E4B 균형 모드';
    recommendationReason = `감지된 VRAM(${gpuInfo.vramFormatted})에 맞춰 Gemma 4 E4B를 추천합니다.`;
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
