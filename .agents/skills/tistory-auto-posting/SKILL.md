---
name: tistory-auto-posting
description: Write a source-grounded Korean article with section-matched images and publish it to a Tistory blog by driving the real Tistory editor (the Tistory Open API was shut down in Feb 2024). Use when the user asks to post, publish, or upload a blog post to Tistory ('티스토리에 포스팅해줘', '티스토리 발행'). Do not use for Naver Blog (use naver-auto-posting) or when the user wants only a draft.
---

# Tistory Auto Posting

Create and publish one complete Tistory post through `scripts/publish-post.js`, which opens the Tistory editor (`https://<blog>.tistory.com/manage/newpost`) in a dedicated Chrome profile and fills it in.

## Scope and authorization

- A request to post with this skill authorizes one new Tistory post. Draft-only requests do not authorize publication; use `--dry-run` or `--visibility private` for those.
- Never overwrite or delete existing posts, and never perform engagement actions (likes, comments, subscriptions).
- Login uses a persistent profile at `.playwright/tistory-profile`, plus a cookie backup at `.data/tistory-session.json` because Tistory's `TSSESSION` can be a browser-session cookie (both gitignored). Never ask the user for, store, or log a Kakao/Tistory password, cookie, or token. If login, CAPTCHA, or Kakao 2-step verification is needed, run `--login` and let the user complete it in the opened Chrome window.
- If a publish attempt fails, check the blog's manage list for a post that was created anyway before retrying once. Never create duplicates.

## Topic and article

1. Read [references/published-posts/INDEX.md](references/published-posts/INDEX.md) and reject topics that repeat an existing post's reader problem or action list.
2. Do not copy a Naver post verbatim to Tistory. Identical text on two blogs is treated as duplicate content by search engines. Rewrite with a different angle, structure, and examples.
3. Follow the article quality rules in the naver-auto-posting skill (`../naver-auto-posting/SKILL.md`, "Article quality" section): research authoritative sources, write in depth with hands-on detail, and avoid template phrases and emoji spam.
4. Unlike Naver, Tistory renders real HTML headings, which helps search visibility. Write the content file with light markdown:
   - `## 소제목` → `<h2>`, `### 소제목` → `<h3>`; a standalone `1. 소제목` line after a blank line or a `[소제목]` line → `<h3>`
   - `- 항목` / `• 항목` → bullet list, `> 문장` → quote, `**굵게**` → bold, `---` → divider, bare URLs → links
   - A content file that already starts with HTML is used as-is.
5. Images: generate three images matched to specific sections (use the `gemini-image` skill or Gemini's image tool), saved under `output/tistory-images/<date>-<topic>/`. Write `images.json` in the same format as Naver:
   ```json
   [{ "filePath": "D:/work/dev/blog/output/tistory-images/.../01.jpg", "afterHeading": "1. 소제목 그대로", "title": "설명" }]
   ```
   Each image is inserted right after the heading whose text matches `afterHeading`. Unmatched images go to the end of the post, and the script prints a warning. For exact placement, put `<!-- image:N -->` in the content (N = 1-based index in `images.json`); markers override `afterHeading`.

## Publishing

First run, or when the session expires:

```powershell
node .agents/skills/tistory-auto-posting/scripts/publish-post.js --login
```

This opens Chrome for a Kakao login, then detects the blog name and saves it to `.data/tistory.json`. Pass `--blog <name>` if detection fails.

Publish:

```powershell
node .agents/skills/tistory-auto-posting/scripts/publish-post.js --title "<title>" --content-file "<content.md>" --images-file "<images.json>" --category "<category>" --tags "tag1,tag2"
```

To bring over an existing Naver post (only when the user asks for that specific post), use `--from-naver`. It converts the post (body, images, tags into `output/tistory-import/<logNo>/`) and publishes it in one run. The title and tags come from the Naver post unless `--title` or `--tags` is given. It can be combined with `--post-id` to overwrite an existing Tistory post instead:

```powershell
node .agents/skills/tistory-auto-posting/scripts/publish-post.js --from-naver https://blog.naver.com/<blogId>/<logNo> --category "<category>"
```

`scripts/import-naver-post.js <url>` does only the conversion step.

Options:
- `--visibility public|protected|private` (default `public`)
- `--dry-run`: fills everything and stops at the publish panel; closing the browser ends the run
- `--blog <name>`: overrides the saved blog name
- `--post-id <id>`: edits an existing post (`https://<blog>.tistory.com/<id>`) instead of creating one. Only edit posts the user named. Before changing anything, the script backs up the old title, tags, and HTML to `output/tistory-backup/<id>-<time>.json`. It replaces the title, body, and tags (only when `--tags` is given) and swaps the thumbnail for the first new image. It keeps the post's visibility unless `--visibility` is given, and keeps its URL and publish date. Updates are not added to INDEX.md.

The category must match a category that already exists on the blog exactly. On a mismatch, the script lists the available categories.

## Proof of completion

The script prints JSON. Treat a post as published only when `status` is `published` (or `updated` for `--post-id`), `url` is set, and for public posts `verify.status` is 200 with `titleOk` and `imagesOk` true. If `status` is `login_required` or `manual_required`, report it to the user instead of retrying blindly.

On selector failures the script saves a screenshot and a list of visible controls to `output/tistory-debug/`. Use them to update the selectors in `publish-post.js`, because the Tistory editor markup can change.

After a verified publish, the script appends a row to `references/published-posts/INDEX.md`. Also save the full published text as `references/published-posts/<postId>-<slug>.md` with the URL, category, sources, and body.
