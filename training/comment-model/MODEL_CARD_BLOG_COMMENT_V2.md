---
language:
- ko
license: gemma
base_model: google/gemma-4-E2B-it
library_name: gguf
tags:
- gemma-4
- lora
- gguf
- korean
- blog-comment
---

# Gemma 4 E2B Korean Blog Comment LoRA v2

Gemma 4 E2B를 한국어 블로그 맞춤 댓글 형식으로 연구용 QLoRA 학습한 llama.cpp용 F16 LoRA GGUF입니다.

## 사용 방법

기본 모델 `google/gemma-4-E2B-it-qat-q4_0-gguf`의 `gemma-4-E2B_q4_0-it.gguf`와 함께 사용합니다.

```powershell
llama-server.exe -m gemma-4-E2B_q4_0-it.gguf --lora gemma-4-e2b-blog-comment-v2-lora-f16.gguf
```

## 학습 정보

- 외부 공개 검색 문맥 기반 연구 데이터 250건
- 맞춤 댓글 198건, 사실 부족·민감 문맥 `SKIP` 52건
- 1 epoch, LoRA rank 16
- 기본 모델 revision: `3e22461f65e89153144f8adb70e3b8c2cc9845a7`
- 변환 llama.cpp revision: `22397c31a00e78f55ae556c41fc78b717c5911bd`

## 제한 사항

연구용 v2이며 `productionReady: false`입니다. 13개 고정 평가에서 원본 E2B보다 거절 판단과 구체성이 개선됐지만, 시간·방향·예약 방식 같은 의미를 반대로 해석한 사례가 있어 자동 게시 전 검증기가 필요합니다.

기본 Gemma 모델의 이용 조건도 함께 준수해야 합니다.
