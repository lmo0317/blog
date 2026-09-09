# Comment model data workspace

이 폴더의 실제 데이터 파일은 개인정보와 대용량 원천 파일을 포함할 수 있어 Git에서 제외한다.

- `raw/public/`: 라이선스가 확인된 공개 원천 데이터
- `private/`: 이전 실험 파일 보관 영역. 현재 외부 데이터 학습에는 사용하지 않음
- `processed/`: 사람이 승인한 SFT/DPO 데이터
- `reports/`: 수집 수량, 중복, 품질 플래그 보고서

`sources.json`은 출처와 라이선스 메타데이터만 추적한다. 공개 데이터라고 해도 바로 학습하지 말고 데이터셋별 원저작물 조건과 상업 이용 가능 여부를 최종 검토한다.

## 수집 명령

```powershell
node training/comment-model/scripts/collect-local-history.mjs
& training/comment-model/scripts/download-public-data.ps1
node training/comment-model/scripts/prepare-public-auxiliary.mjs
```

현재 학습 정책은 `external_public_sources_only`다. `collect-local-history.mjs`는 과거 재현용이며 새 학습 실행에 포함하지 않는다.

## 2026-09-08 수집 스냅샷

- 공개 원천: 6개 파일, 1,046,214,750 bytes
- 공개 원천 레코드: 528,655건
- 짧은 한국어 보조 후보: 245,578건, JSONL 오류 0건
- 익명화된 기존 맞춤 댓글 후보: 1,386건 (`weak_unverified`)
- 익명화된 기존 답글 후보: 66건 (`review_required`)
- 현재 사람 검수까지 끝난 최종 SFT 데이터: 0건

공개 보조 후보는 `usableForBlogSft: false`로 저장된다. 블로그 본문 근거와 사람 승인이 없는 상태에서 이 표시를 바꾸지 않는다.
