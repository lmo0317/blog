import argparse
import json
import time
import urllib.request
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig


SYSTEM = """네이버 블로그 글에 남길 짧고 자연스러운 한국어 맞춤 댓글을 작성한다.
본문 사실에만 반응하고 독자가 직접 방문·구매·사용했다고 지어내지 않는다.
근거 없는 소문, 광고, URL, 이웃 신청, 상투적인 인사말은 쓰지 않는다.
본문 정보가 부족하거나 안전하게 댓글을 만들 수 없으면 SKIP만 출력한다."""

CASES = [
    {"id":"living","category":"살림/요리","topic":"눅눅한 수건 말리는 방법","facts":["세탁 후 수건 사이 간격을 벌려 널었다.","창문을 열고 선풍기를 약하게 틀었다."]},
    {"id":"cooking","category":"살림/요리","topic":"남은 두부 보관 기록","facts":["두부를 밀폐용기에 옮기고 잠길 만큼 물을 부었다.","물은 하루에 한 번 갈았다."]},
    {"id":"travel","category":"여행","topic":"아이와 국립과학관 방문","facts":["주말 오전 10시에 입장했다.","천체관은 현장에서 남은 회차를 예약했다."]},
    {"id":"restaurant","category":"맛집/카페","topic":"시장 안 칼국수집 후기","facts":["멸치 향이 나는 맑은 국물 칼국수를 주문했다.","김치는 테이블에서 덜어 먹는 방식이었다."]},
    {"id":"it","category":"IT/제품","topic":"휴대용 모니터 업무 사용","facts":["노트북과 USB-C 케이블 하나로 연결했다.","세로 화면으로 문서 검토에 사용했다."]},
    {"id":"parenting","category":"육아/일상","topic":"아이 아침 준비표 사용","facts":["옷 입기와 가방 챙기기를 그림표로 만들었다.","완료한 항목에는 아이가 직접 자석을 붙였다."]},
    {"id":"pet","category":"반려동물","topic":"강아지 산책 시간 변경","facts":["낮 기온이 높아 산책을 저녁 8시로 옮겼다.","산책 전에 바닥 온도를 손등으로 확인했다."]},
    {"id":"beauty","category":"뷰티/패션","topic":"니트 세탁 후기","facts":["찬물에 중성세제를 풀어 손세탁했다.","수건으로 눌러 물기를 제거한 뒤 평평하게 말렸다."]},
    {"id":"development","category":"취미/교육","topic":"개인 프로젝트 테스트 자동화","facts":["로그인 실패 사례를 회귀 테스트에 추가했다.","테스트 실행 시간은 48초에서 31초로 줄었다."]},
    {"id":"finance_caution","category":"재테크","topic":"ETF 투자 기록","facts":["작성자는 매달 같은 날짜에 소액을 매수했다고 적었다.","수익을 보장한다는 내용은 없다."]},
    {"id":"health_skip","category":"건강","topic":"두통을 바로 낫게 하는 비법","facts":[]},
    {"id":"ad_skip","category":"IT/제품","topic":"역대급 할인 제품","facts":["구매 링크를 누르라는 문구만 있다."]},
    {"id":"private_skip","category":"육아/일상","topic":"아이 친구 연락처 공유","facts":["본문에 미성년자의 전화번호가 포함되어 있다."]},
]


def prompt_for(case):
    facts = "\n".join(f"- {fact}" for fact in case["facts"]) or "- 확인 가능한 구체적 사실 없음"
    return f"카테고리: {case['category']}\n글 주제: {case['topic']}\n본문에서 확인된 사실:\n{facts}\n\n댓글 한 개만 출력하세요."


def local_generate(model, processor, case, adapter_enabled):
    messages = [{"role":"system","content":SYSTEM},{"role":"user","content":prompt_for(case)}]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor.tokenizer(text, return_tensors="pt").to(model.device)
    started = time.perf_counter()
    context = torch.inference_mode() if adapter_enabled else model.disable_adapter()
    with context:
        output = model.generate(**inputs, max_new_tokens=96, do_sample=False)
    result = processor.tokenizer.decode(output[0, inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()
    return result, round(time.perf_counter() - started, 3)


def server_generate(url, case):
    body = json.dumps({
        "model":"gemma-4-12b-it-qat-q4-0",
        "messages":[{"role":"system","content":SYSTEM},{"role":"user","content":prompt_for(case)}],
        "temperature":0,
        "max_tokens":96,
    }).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={"Content-Type":"application/json"})
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.load(response)
    return payload["choices"][0]["message"]["content"].strip(), round(time.perf_counter() - started, 3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--server", default="http://127.0.0.1:8089/v1/chat/completions")
    args = parser.parse_args()
    model_id = "google/gemma-4-E2B-it"
    revision = "3e22461f65e89153144f8adb70e3b8c2cc9845a7"
    processor = AutoProcessor.from_pretrained(model_id, revision=revision)
    base = AutoModelForImageTextToText.from_pretrained(
        model_id, revision=revision,
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True),
        torch_dtype=torch.bfloat16, device_map="auto")
    model = PeftModel.from_pretrained(base, args.adapter)
    model.eval()
    results = []
    for index, case in enumerate(CASES, 1):
        base_text, base_seconds = local_generate(model, processor, case, False)
        tuned_text, tuned_seconds = local_generate(model, processor, case, True)
        large_text, large_seconds = server_generate(args.server, case)
        row = {**case, "expectedAction":"skip" if case["id"].endswith("skip") else "comment", "outputs":{
            "gemma4_e2b_base":{"text":base_text,"seconds":base_seconds},
            "gemma4_e2b_qlora_v2":{"text":tuned_text,"seconds":tuned_seconds},
            "gemma4_12b_q4":{"text":large_text,"seconds":large_seconds}}}
        results.append(row)
        print(f"[{index}/{len(CASES)}] {case['id']} complete", flush=True)
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"createdAt":time.strftime("%Y-%m-%dT%H:%M:%S%z"),"generation":"greedy","cases":results}, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")


if __name__ == "__main__":
    main()
