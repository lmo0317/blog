import argparse
import hashlib
import json
import random
from collections import Counter
from pathlib import Path

import pyarrow.parquet as pq


def normalize(value):
    import unicodedata
    return " ".join(unicodedata.normalize("NFC", str(value or "")).split())


def valid_korean_response(text):
    return (
        15 <= len(text) <= 120
        and sum("가" <= char <= "힣" for char in text) >= 8
        and "http://" not in text.lower()
        and "https://" not in text.lower()
        and "인공지능 어시스턴트" not in text
    )


def main():
    parser = argparse.ArgumentParser(description="외부 공개 한국어 대화에서 문체 보조 샘플만 추출")
    parser.add_argument("--input", default="training/comment-model/data/raw/public/mkd-chanwoo__keural-conversation-ko/train-00000-of-00001.parquet")
    parser.add_argument("--output", default="training/comment-model/data/processed/external-style-auxiliary.jsonl")
    parser.add_argument("--report", default="training/comment-model/data/reports/external-style-auxiliary.json")
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=20260909)
    args = parser.parse_args()

    table = pq.read_table(args.input, columns=["id", "topic", "situation", "conversation"])
    candidates = []
    seen = set()
    rejected = Counter()

    for row in table.to_pylist():
        try:
            messages = json.loads(row["conversation"])
        except (TypeError, json.JSONDecodeError):
            rejected["invalid_json"] += 1
            continue
        for index in range(len(messages) - 1):
            user, assistant = messages[index:index + 2]
            if user.get("role") != "user" or assistant.get("role") != "assistant":
                continue
            prompt = normalize(user.get("content"))
            answer = normalize(assistant.get("content"))
            if not valid_korean_response(answer):
                rejected["response_filter"] += 1
                continue
            fingerprint = hashlib.sha256(f"{prompt}\0{answer}".encode("utf-8")).hexdigest()
            if fingerprint in seen:
                rejected["duplicate"] += 1
                continue
            seen.add(fingerprint)
            candidates.append({
                "task": "korean_natural_response_style_auxiliary",
                "input": prompt,
                "output": answer,
                "topic": normalize(row["topic"]),
                "situation": normalize(row["situation"]),
                "source": "mkd-chanwoo/keural-conversation-ko",
                "sourceRevision": "fcb975654651d55ff1a642455d620045b6d3f741",
                "license": "cc-by-4.0",
                "synthetic": True,
                "usableForBlogSft": False,
                "sourceFingerprint": fingerprint,
            })

    rng = random.Random(args.seed)
    rng.shuffle(candidates)
    selected = candidates[:args.limit]
    output = Path(args.output)
    report = Path(args.report)
    output.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in selected), encoding="utf-8")
    report.write_text(json.dumps({
        "sourceRows": table.num_rows,
        "qualifiedPairs": len(candidates),
        "selected": len(selected),
        "seed": args.seed,
        "byTopic": dict(Counter(row["topic"] for row in selected)),
        "rejected": dict(rejected),
        "usableForBlogSft": False,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(report.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
