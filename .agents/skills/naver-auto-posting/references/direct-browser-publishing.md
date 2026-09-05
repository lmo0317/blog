# Direct Naver Browser Publishing

Use this reference for live posting to Naver Blog. The primary route is Playwright authenticated session (`windows/lib/naver.js` / `scripts/publish-post.js`) or browser automation → Naver SmartEditor ONE → public Naver post.

## Browser and login

1. Run the publication helper script (`scripts/publish-post.js`) or connect via `NaverBrowserSession`.
2. Determine login state using the existing authenticated session (`.data/auth/naver_user_data` or `.playwright/naver-session.json`).
3. If login or an account challenge appears, make the browser visible (`headless: false`) and allow the user to complete credentials, CAPTCHA, two-step verification, or new-device approval directly on Naver.
4. After verification, confirm the signed-in blog owner matches the target blog.

## SmartEditor composition

1. Navigate to the writing URL (`https://blog.naver.com/<blogId>/postwrite` or `GoBlogWrite.naver`).
2. Replace title in the title placeholder element (`.se-documentTitle`).
3. Compose the body in article order: intro and section text, followed immediately by its matching section image, repeated for each section.
4. Upload images using standard file input handlers and verify each image component is inserted before moving to the next section.
5. Dismiss any draft recovery or help overlays without merging unexpected content.

## Category and final publish

1. Open the publish panel via `[data-click-area="tpb.publish"]`.
2. Select the exact category (`건강`, `생활`, `자동화`) using the category dropdown trigger and verify selection.
3. Apply up to 10 relevant tags.
4. Click the final publish confirmation button and wait for Naver's redirection to the published post page.

## Public proof and cleanup

1. Require a numeric URL in the form `blog.naver.com/<blogId>/<logNo>` or a `PostView.naver` equivalent.
2. Verify the public or mobile page responds with HTTP 200, matching title, representative body text, and expected image count.
3. Update `published-posts/INDEX.md` and create the post's full Markdown archive file under `references/published-posts/`.
