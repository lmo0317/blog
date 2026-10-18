---
name: operator
description: 이웃메이트 운영자. 고객의 버그 신고나 질문(블로그 댓글, 메일, Q&A)을 찾아서 원인을 고치고, 패치를 배포하고, 이용권을 연장해 주고, 블로그 답글과 메일로 답하는 일을 끝까지 처리한다. Use when a customer reports a bug or asks a question, when the user says '문의 왔어', '버그 신고', '손님 질문', '고객 대응', '이용권 연장/서비스로 며칠 넣어줘', '답글 달아줘', '메일 보내줘', or asks to check for unanswered customer questions.
---

# 🛠️ Operator — 이웃메이트 고객 대응

고객 한 명의 문제를 **찾기 → 재현 → 고치기 → 배포 → 보상 → 답장(블로그 + 메일) → 확인**까지 한 번에 끝낸다.
체험 중인 고객은 곧 구매자다. 답이 늦거나 틀리면 팔리지 않는다.

## 기본 정보

| 항목 | 값 |
|---|---|
| 운영 서버 | `lmo0317@192.168.219.112` (SSH 키 등록됨, `ssh -o StrictHostKeyChecking=no lmo0317@192.168.219.112 "<cmd>"`) |
| Node (112) | `~/.local/node-v22/bin/node` |
| 웹 앱 (112) | `~/apps/blog-engage`, 서비스 `blog-engage` (port 4310) |
| 라이선스 서버 (112) | `~/apps/license-server`, 서비스 `neighbor-license`, DB `data/license.db`, env `~/.config/neighbor-license/env` |
| 네이버 세션 (112) | `~/apps/blog-engage/.playwright/naver-session.json` (운영자 lmo0317 계정) |
| 업데이트 피드 | https://minohlee.mooo.com/updates/neighbormate/latest.yml |
| 운영 블로그 | https://blog.naver.com/lmo0317 , 소개 글 `224437725213` (고객 문의가 주로 여기 달림) |
| 이 스킬 스크립트 | `.agents/skills/operator/scripts/` → 112 의 `/tmp/nmr/op/` 에 복사해서 실행 |

스크립트를 112 로 올리는 법 (Git Bash, CRLF 제거 필수):
```bash
cd /d/work/dev/blog/.agents/skills/operator/scripts
ssh lmo0317@192.168.219.112 'mkdir -p /tmp/nmr/op'
for f in *.mjs license.sh; do tr -d '\r' < $f | ssh lmo0317@192.168.219.112 "cat > /tmp/nmr/op/$f"; done
ssh lmo0317@192.168.219.112 'chmod +x /tmp/nmr/op/license.sh'
```

## 규칙

- 사용자에게 하는 말은 전부 한국어. 결과만 보고하고 숙제(명령어, "직접 해 보세요")를 넘기지 않는다.
- 비밀값(`LICENSE_ADMIN_SECRET`, `APP_PASSWORD`, Typecast 키 등)은 절대 출력하지 않는다. `license.sh` 는 env 파일에서 읽기만 한다.
- 고객 이메일 주소는 그 고객에게 메일 보낼 때만 쓴다. 다른 서비스나 URL 파라미터에 넣지 않는다.
- 고객에게 나가는 답글과 메일은 사용자가 시켰을 때 보낸다. "답글 달고 메일도 보내"처럼 지시가 있으면 확인 없이 진행, 없으면 문안을 보여 주고 물어본다.
- 사실만 쓴다. 고치지 않은 걸 고쳤다고, 넣지 않은 이용권을 넣었다고 쓰지 않는다. 답장 전에 패치 배포와 이용권 반영을 먼저 끝내고 확인한다.
- 설치된 앱은 고객 설치본이다. 고객 PC 기준으로 고친다(개발용 모델·설정을 연결하지 않는다).

## 1단계: 문의 찾기

고객 문의는 대부분 **블로그 댓글의 답글**로 온다. 첫 댓글(인사) 아래 답글로 질문을 달아서 새 댓글 알림에 잘 안 뜬다. 꼭 답글까지 본다.

```bash
# 특정 글의 모든 댓글과 답글 (답글은 └ 와 parent 번호로 표시)
ssh lmo0317@192.168.219.112 'cd /tmp/nmr/op && LOGNO=224437725213 ~/.local/node-v22/bin/node comments.mjs'
# 최근 글 30개 전체에서 질문처럼 보이는 것만
ssh lmo0317@192.168.219.112 'cd /tmp/nmr/op && ALL=1 FIND="안 ?되|안 ?나|오류|에러|조회|왜|어떻게|문의|체험|구독|결제|환불|\\?" ~/.local/node-v22/bin/node comments.mjs'
```

그 밖의 창구:
- 관리자 페이지 **🏠 홈 → ✅ 지금 챙길 일**: 답변 안 한 질문, 오류 난 고객, 가입하고 안 켠 고객, 네이버 미연결, AI 모델 안 받음, 구버전, 체험 끝나감, 체험·이용권 끝나고 결제 안 함, 3일 넘게 안 씀, 사용 급감, 카톡 구매 버튼 누른 방문자, 설치 파일 받고 가입 안 한 방문자. 문의가 오기 전에 먼저 연락할 대상이다. (API `GET /api/admin/home?latest=<최신버전>`) 
- 👥 고객 목록의 **⚠️ 챙길 고객** 필터도 같은 기준이다.
- 사이트 Q&A: 관리자 페이지 **💬 문의** (같은 IP로 가입한 고객이 있으면 질문 옆에 이메일이 붙는다). API `GET /api/admin/qna`, 답변 `POST /api/admin/qna/:id/answer`.
- 메일: 운영자 네이버 메일 / Gmail 받은편지함.

문의마다 기록할 것: 닉네임, 블로그 아이디(프로필 링크), 글 번호, **스레드 맨 위 댓글 번호(PARENT)**, 질문 원문, 작성 시각.

## 2단계: 고객 계정 찾기

가입 이메일은 대개 `<블로그아이디>@naver.com` 이다.
```bash
ssh lmo0317@192.168.219.112 '/tmp/nmr/op/license.sh find <블로그아이디 또는 이메일 일부>'
ssh lmo0317@192.168.219.112 '/tmp/nmr/op/license.sh audit <userId>'
```
`planType`(free_trial / monthly_paid), `expiresAt`, `daysLeft`, `lastSeenAt`(마지막 실행)을 본다.

## 3단계: 재현하고 원인 찾기

- **먼저 관리자 페이지에서 그 고객을 연다** (https://minohlee.mooo.com/license/admin#customers → 고객 줄 클릭, 주소는 `#customer/<userId>`). 탭: 개요 / 활동 기록 / 응대·메모 / 유입 경로 / 계정·이용권.
  앱 1.0.22부터 2분마다 사용 기록을 보내므로 재현 전에 대부분 보인다:
  - 프로그램 환경: 버전(구버전이면 업데이트 안내부터), 네이버 연결·블로그 아이디, AI 엔진·모델·GPU/CPU, PC 사양.
  - 오늘 사용량, 자동 작업 상태, 최근 14일 활동, 많이 쓴 기능, **자주 난 오류·경고**.
  - 활동 기록(🚨 오류 필터): 고객이 누른 기능, 결과 숫자(예: `내 글 댓글 조회 · posts 0`), 실패 메시지, 자동 작업 로그와 AI가 단 댓글.
  - API로도 볼 수 있다: `GET /api/admin/users/<id>?type=error&limit=300` (헤더 `x-admin-secret`).
  - "⚪ 사용 기록 없음"이면 1.0.22 이전 버전이거나 앱을 안 켰거나 이용권 로그인을 안 한 것이다.
- **응대·메모 탭에 남긴다**: 문의 내용, 고친 버전, 지급한 기간, 보낸 메일을 적어 둔다 (API `POST /api/admin/users/<id>/notes` body `{kind: note|mail|reply|call, body}`). 메일은 고객 화면의 [✉️ 메일 쓰기]에 상황별 문안(사용 시작·네이버 연결·오류·체험 종료·서비스 지급·다시 돌아오기)이 있다.
- **고객 환경으로 재현한다.** 내 블로그에서 된다고 끝내지 않는다. 고객 블로그 아이디로 같은 함수를 112 에서 직접 돌린다.
  예) `scanMyBlogComments` 를 고객 blogId 로 호출해서 글 수/댓글 수를 본다.
- 네이버는 화면 구조를 자주 바꾼다. 의심 1순위는 셀렉터/레이아웃 변경이다. 예전 구조(mainFrame iframe)와 새 구조가 블로그마다 다를 수 있다.
- 화면을 긁는 것보다 네이버 모바일 API가 튼튼하다:
  - 글 목록 `https://m.blog.naver.com/api/blogs/{blogId}/post-list?categoryNo=0&itemCount=30&page=1` (→ `result.items[].logNo`)
  - 카테고리 `https://m.blog.naver.com/api/blogs/{blogId}/category-list`
  - `m.blog.naver.com` 페이지 안에서 `fetch(..., { credentials: 'include' })` 로 호출.
- 원인을 한 문장으로 쓸 수 있을 때까지 판다. "앱이 내 글 목록을 0개 찾아서 댓글도 0개였다"처럼.

## 4단계: 고치고 패치하기

1. `apps/engagement` 에서 수정하고 회귀 테스트를 추가한다. `npm test` 전부 통과.
2. 커밋 (프로젝트 규칙의 커밋 트레일러 포함).
3. 배포 = **웹 → 웹 확인 → 릴리스** 순서:
   ```bash
   cd apps/engagement
   npm run deploy:web     # 112 blog-engage 반영 (백업 자동 생성)
   # 112 에서 고객 blogId 로 고친 기능을 다시 돌려 결과 확인
   npm run release        # 버전 올리고 고객용 앱 배포 → latest.yml 갱신
   curl -s https://minohlee.mooo.com/updates/neighbormate/latest.yml | head -2   # version 확인
   ```
   고객 앱은 다시 켜면 자동 업데이트된다.
4. 라이선스 서버를 고쳤을 때(배포 스크립트 없음):
   ```bash
   cd apps/license-server && npm test
   ssh lmo0317@192.168.219.112 'mkdir -p ~/backups && cp ~/apps/license-server/lib/<file> ~/backups/<file>.$(date +%Y%m%d)'
   tr -d '\r' < lib/<file> | ssh lmo0317@192.168.219.112 'cat > ~/apps/license-server/lib/<file> && cd ~/apps/license-server && ~/.local/node-v22/bin/node --check lib/<file> && systemctl --user restart neighbor-license && systemctl --user is-active neighbor-license'
   ```
   올리기 전에 서버 파일이 repo HEAD 와 같은지 diff 로 확인한다(서버에서 따로 고친 게 있으면 덮어쓰지 않는다).

## 5단계: 서비스 이용권 넣기

불편을 겪은 체험 고객에게는 사과로 며칠을 넣어 준다(오늘 기준 3일).
```bash
ssh lmo0317@192.168.219.112 '/tmp/nmr/op/license.sh extend <userId> 3'
ssh lmo0317@192.168.219.112 '/tmp/nmr/op/license.sh find <이메일>'   # expiresAt, planType 확인
```
- 관리자 연장은 요금제를 그대로 둔다. 체험판은 체험판으로 남는다. (2026-10-18 이전에는 연장하면 `monthly_paid` 로 바뀌는 버그가 있었다 → 86e0227 에서 수정.) 연장 후 `planType` 이 바뀌었으면 바로 되돌리고 원인을 고친다.
- 답장에 쓸 만료일은 `expiresAt`(UTC)를 한국 시간으로 바꿔서 "10월 23일까지"처럼 날짜로 쓴다.
- 고객 앱은 다음 실행/하트비트 때 늘어난 기간을 받는다. 고객이 할 일은 없다.

## 6단계: 블로그 답글

질문이 달린 **스레드의 맨 위 댓글 번호(PARENT)** 에 답글을 단다(네이버는 답글의 답글이 없다).
```bash
# 먼저 DRY 로 입력창이 열리는지 확인
ssh lmo0317@192.168.219.112 'cd /tmp/nmr/op && DRY=1 LOGNO=<글번호> PARENT=<맨위댓글번호> TEXT="..." ~/.local/node-v22/bin/node reply.mjs'
# 실제 게시 → POSTED 가 찍혀야 성공
ssh lmo0317@192.168.219.112 'cd /tmp/nmr/op && LOGNO=<글번호> PARENT=<맨위댓글번호> TEXT="..." ~/.local/node-v22/bin/node reply.mjs'
```
답글 문안 원칙:
- 닉네임 + 사과 한 마디 → 원인 한 줄(쉬운 말) → 해결과 고객이 할 일("앱을 껐다가 다시 켜시면 자동 적용") → 보상(며칠, 언제까지) → "또 막히면 편하게 말씀해 주세요".
- 4~5문장. 기술 용어(API, 셀렉터, iframe)는 쓰지 않는다. 버전 번호 정도는 괜찮다.
- 예시 (2026-10-18 실제 게시):
  > 민달팽솔님, 불편 드려 죄송해요! 확인해 보니 네이버 새 블로그 화면에서 앱이 내 글 목록을 못 찾던 문제였어요. 1.0.21 업데이트로 고쳤으니 앱을 껐다가 다시 켜시면 자동으로 적용됩니다. 사과의 의미로 무료 이용권 3일을 더 넣어 드렸어요(10월 23일까지). 써 보시다 또 막히는 게 있으면 편하게 말씀해 주세요!

## 7단계: 메일 (댓글 알림을 놓칠 수 있으니 같이 보낸다)

**네이버 메일은 112 세션으로 보낸다.** Claude in Chrome 은 naver.com 전체를 막고("This site is not allowed due to safety restrictions"), Gmail 에 수신자를 입력하는 것도 권한 검사에서 거부됐다.
```bash
# 본문 파일 작성 (UTF-8, 줄바꿈 그대로 들어감)
ssh lmo0317@192.168.219.112 'cat > /tmp/nmr/op/body.txt' < body.txt
# SEND 없이 채우기만 → /tmp/nmr/mail-draft.png 를 받아서 눈으로 확인 (수신자 1명, 제목, 본문)
ssh lmo0317@192.168.219.112 'cd /tmp/nmr/op && TO=<이메일> SUBJECT="..." BODY_FILE=/tmp/nmr/op/body.txt ~/.local/node-v22/bin/node send-mail.mjs'
scp lmo0317@192.168.219.112:/tmp/nmr/mail-draft.png <scratchpad>/
# 발송 → SENT 가 찍혀야 성공
ssh lmo0317@192.168.219.112 'cd /tmp/nmr/op && SEND=1 TO=<이메일> SUBJECT="..." BODY_FILE=/tmp/nmr/op/body.txt ~/.local/node-v22/bin/node send-mail.mjs'
```
메일 형식:
```
제목: [이웃메이트] <문제 한 줄> 수정 및 무료 이용권 N일 추가 안내

안녕하세요, <닉네임>님. 이웃메이트 개발자입니다.

블로그에 남겨 주신 문의(<질문 요약>) 확인했습니다. 혹시 댓글 알림을 놓치실까 봐 메일로도 안내드립니다.

[원인]
<쉬운 말 1~2문장>

[해결]
<버전> 업데이트로 고쳤습니다. 이웃메이트를 껐다가 다시 켜시면 자동으로 업데이트되어 바로 적용됩니다.

[무료 이용권 N일 추가]
불편을 드린 사과의 의미로 무료 이용권을 N일 더 넣어 드렸습니다. 이용 기간은 <날짜>까지이며, 따로 하실 일 없이 앱을 다시 켜시면 반영됩니다.

써 보시다가 또 막히는 부분이 있으면 이 메일로 회신 주시거나 블로그에 편하게 남겨 주세요. 빠르게 확인하겠습니다.

감사합니다.
이웃메이트 개발자 드림
```

## 8단계: 확인하고 보고

- `comments.mjs` 로 내 답글이 실제로 달렸는지, 고객이 새로 답했는지 본다.
- `license.sh find` 로 만료일·요금제가 맞는지 본다.
- 사용자에게 한국어로 짧게 보고: 원인 → 고친 것(버전) → 이용권(언제까지) → 답글·메일 발송 여부 → 그 과정에서 찾은 다른 버그. 실패한 단계가 있으면 그대로 적는다.
- 같은 원인으로 다른 고객도 막혔을 가능성을 한 줄로 적는다(예: 새 블로그는 대부분 새 화면 구조).

## 네이버 화면 메모 (2026-10 기준)

- `m.blog.naver.com/CommentList.naver?blogId=..&logNo=..` 는 PostView + 댓글 패널로 열린다.
- 댓글 `li.u_cbox_comment` 의 `data-info`: `commentNo:'..'`, `parentCommentNo:'..'`, `replyLevel:2`(답글), `mine:true`, `deleted:true`.
- 더 보기: `.u_cbox_btn_more, .u_cbox_paginate a`.
- 답글 입력창: 부모 li 안 `.u_cbox_reply_area [contenteditable=true]` (div, textarea 아님). 부모 li 의 `.u_cbox_btn_reply` 를 한 번 눌러야 나타난다. 두 번 누르면 닫힌다. 등록 버튼 `.u_cbox_reply_area .u_cbox_btn_upload`.
- 내 답글 삭제: 해당 li 의 `.u_cbox_btn_open`(force 클릭) → `.u_cbox_btn_delete`, confirm 은 `page.on('dialog')` 로 수락.
- 네이버 메일 쓰기 `https://mail.naver.com/v2/new`: 수신자 `#recipient_input_element`(입력 후 Enter), 제목 `#subject_title`, 본문은 iframe 안 contenteditable, 보내기 `button.button_write_task`, 성공 시 URL `/v2/new/done` + "메일을 성공적으로 보냈습니다".

## 사례: 2026-10-18 민달팽솔 (rlaalsthf006)

- **문의**: 소개 글(224437725213) 첫 댓글 아래 답글로 "답방 기능에서 내 글 댓글목록 조회 시 아무것도 안 나온다. 괜찮으면 유료구독 생각 중". 하루 가까이 아무도 못 봤다.
- **원인**: 그분 블로그는 네이버 새 화면 구조라 `PostList.naver` 안에 mainFrame 이 없음 → 앱이 글 링크 0개 → 댓글 0개. 운영자 블로그는 예전 구조라 테스트에서 안 드러났다.
- **수정**: `scanMyBlogComments` 가 모바일 post-list API로 글 목록을 먼저 가져오고, 실패할 때만 예전 방식. 그분 블로그 0개 → 30개. d2bd052, 릴리스 1.0.21.
- **보상**: `license.sh extend 4 3` → 10/20 → 10/23. 이때 관리자 연장이 체험판을 `monthly_paid` 로 바꾸는 버그 발견 → `grantDays(..., { keepPlan: true })` 로 수정(86e0227), 서버 반영, 그분 요금제 되돌림.
- **답장**: 블로그 답글(PARENT 907863464096039054) + 네이버 메일 발송.
- **결과**: 고객이 "감사합니다!!! 다시한번 이용해보겠습니다!!" 라고 답함.
- **교훈**: 질문은 답글 속에 숨어 있다 → 정기적으로 `ALL=1 FIND=...` 로 훑는다. 고객 블로그로 재현한다. 보상 도구도 결과(요금제)를 확인한다.
