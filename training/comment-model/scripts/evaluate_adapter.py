import argparse
import json
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig


SYSTEM = """네이버 블로그 글에 남길 짧고 자연스러운 한국어 맞춤 댓글을 작성한다.
본문 사실에만 반응하고 독자가 직접 방문·구매·사용했다고 지어내지 않는다.
근거 없는 소문, 광고, URL, 이웃 신청, 상투적인 인사말은 쓰지 않는다.
본문 정보가 부족하거나 안전하게 댓글을 만들 수 없으면 SKIP만 출력한다."""

CASES = [
    {"id": "living", "category": "살림/요리", "topic": "냉장고 냄새 줄이는 관리법", "facts": ["선반을 분리해 중성세제로 닦았다.", "물기를 완전히 말린 뒤 다시 조립했다."]},
    {"id": "travel", "category": "여행", "topic": "비 오는 날 경주 박물관 관람", "facts": ["오전에는 비가 내려 실내 전시를 먼저 관람했다.", "어린이 체험 공간은 사전 예약 후 이용했다."]},
    {"id": "it", "category": "IT/제품", "topic": "무선 키보드 일주일 사용 기록", "facts": ["노트북과 태블릿 전환 기능을 사용했다.", "충전은 일주일 동안 한 번 진행했다."]},
    {"id": "pet", "category": "반려동물", "topic": "고양이 급수기 청소", "facts": ["필터를 새것으로 교체했다.", "물통과 펌프를 분리해 세척했다."]},
    {"id": "skip", "category": "건강", "topic": "건강 비법", "facts": []},
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    model_id = "google/gemma-4-E2B-it"
    revision = "3e22461f65e89153144f8adb70e3b8c2cc9845a7"
    processor = AutoProcessor.from_pretrained(model_id, revision=revision)
    base = AutoModelForImageTextToText.from_pretrained(
        model_id,
        revision=revision,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        ),
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )
    model = PeftModel.from_pretrained(base, args.adapter)
    model.eval()
    results = []
    for case in CASES:
        facts = "\n".join(f"- {fact}" for fact in case["facts"]) or "- 확인 가능한 구체적 사실 없음"
        prompt = f"카테고리: {case['category']}\n글 주제: {case['topic']}\n본문에서 확인된 사실:\n{facts}\n\n댓글 한 개만 출력하세요."
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = processor.tokenizer(text, return_tensors="pt").to(model.device)
        with torch.inference_mode():
            output = model.generate(**inputs, max_new_tokens=80, do_sample=False)
        generated = processor.tokenizer.decode(output[0, inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()
        results.append({**case, "output": generated})
        print(f"[{case['id']}] {generated}")
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"adapter": args.adapter, "cases": results}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
