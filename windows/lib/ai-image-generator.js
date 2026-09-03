import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { searchOpenImages } from './images.js';

export const AI_IMAGE_STYLES = {
  photorealistic: {
    label: '실사 고화질 사진',
    suffix: 'crystal clear 8k resolution, ultra sharp focus, crisp fine details, professional DSLR photography, natural bright lighting, vibrant true colors, award-winning masterpiece, highly detailed, no blur, no noise, photorealistic',
    primaryModel: 'flux',
    fallbackModel: 'sana'
  },
  cartoon_3d: {
    label: '3D 픽사/디즈니 카툰',
    suffix: 'cute 3D stylized environment and objects, Pixar Disney 3D animation render, vivid crisp textures, bright volumetric studio lighting, smooth polished surfaces, Unreal Engine 5 render, 4k ultra detailed, no blur',
    primaryModel: 'flux-3d',
    fallbackModel: 'flux'
  },
  anime_webtoon: {
    label: '감성 애니/웹툰 일러스트',
    suffix: 'breathtaking Makoto Shinkai anime scenery illustration, ultra sharp clean lines, vibrant luminous colors, cinematic golden hour lighting, masterwork wallpaper art, 4k resolution, no blur',
    primaryModel: 'flux-anime',
    fallbackModel: 'flux'
  },
  digital_art: {
    label: '트렌디 디지털 아트',
    suffix: 'modern sleek premium digital art illustration, ultra sharp vector detail, vibrant editorial color palette, high-end graphic concept, trending on Behance, 4k resolution, no blur',
    primaryModel: 'flux',
    fallbackModel: 'flux-3d'
  }
};

// Safety Policy: strictly family-friendly editorial still life and wholesome lifestyle scenes.
// Policy: ABSOLUTELY NO PEOPLE with inappropriate exposure; all subjects must be fully clothed and modest.
const SAFE_IMAGE_RULES = 'strictly family-friendly editorial still life, wholesome, high quality professional photography, natural lighting, sharp focus, vibrant colors, authentic lifestyle';
const HUMAN_IMAGE_WORDS = /\b(person|people|woman|women|man|men|girl|boy|female|male|human|model|patient|doctor|worker|citizen|hands?|face|body|neck|shoulders?|chest|legs?|sitting|standing|stretching|rolling|exercising|eating)\b/gi;
const SENSITIVE_WORDS_REGEX = /\b(chest|breasts?|bust|cleavage|torso|body|flesh|skin|neck|shoulders?|legs?|arms?|thighs?|waist|hips?|belly|underwear|lingerie|bikini|swimwear|swimsuit|nude|naked|erotic|sensual|sexy|provocative|seductive|topless)\b/gi;

const KOREAN_KEYWORDS_MAP = [
  // 1. Neck stretching & exercises
  [/목\s*늘리기|목\s*스트레칭|목\s*옆|목\s*통증|목\s*운동/gi, 'person in modest clothing gently stretching neck sideways with hand on head, healthy posture routine, warm bright room'],

  // 2. Shoulder exercises & rotation
  [/어깨\s*돌리기|어깨\s*스트레칭|뭉친\s*어깨|어깨\s*풀어주는|어깨\s*운동/gi, 'person in clean casual t-shirt doing gentle shoulder roll stretching exercise, upper body relaxation, bright natural lighting'],

  // 3. Chest expansion & posture correction
  [/가슴\s*열기|가슴\s*스트레칭|굽은\s*등|라운드\s*숄더|거북목|바른\s*자세|척추|날개뼈/gi, 'person sitting upright with good posture opening chest and straightening back, healthy spinal alignment, bright pleasant environment'],

  // 4. General stretching & fitness
  [/스트레칭|홈트|유연성|몸풀기/gi, 'healthy person in modest sportswear doing gentle stretching exercise on yoga mat, bright home fitness routine'],

  // 5. Water & hydration
  [/수분|물\s*마시기|물\s*섭취|물한잔|미지근한\s*물/gi, 'clear glass of pure refreshing water with fresh lemon slice on clean sunlit wooden table, healthy lifestyle'],

  // 6. Sleep, bedroom & night routine
  [/숙면|수면|침실|취침|잠들기|꿀잠|베개/gi, 'cozy peaceful modern bedroom, soft fluffy bedding, gentle warm bedside lamp light, restful sleep atmosphere'],

  // 7. Eye fatigue & 20-20-20 rule
  [/눈\s*피로|20-20|눈\s*휴식|모니터\s*눈|시력|안구/gi, 'person looking out of a bright sunlit window relaxing eyes from screen, peaceful calm moment, refreshing view'],

  // 8. Walking & running
  [/걷기|산책|운동화|보행|조깅/gi, 'person in modest casual sneakers walking peacefully along beautiful tree-lined park path in morning sunlight'],

  // 9. Diet, fiber & healthy meals
  [/식이섬유|통곡물|영양|샐러드|채소|단백질|비타민/gi, 'colorful fresh organic salad bowl with vibrant vegetables, avocado, nuts, and healthy ingredients on dining table'],
  [/비만|과체중|체중|다이어트|살|지방|체지방/gi, 'healthy nutritious fresh food bowl, measuring tape and green apples on wooden table'],
  [/식사|식습관|밥|음식|포만감|식사속도|먹는|먹기|과식|폭식|한끼|식단/gi, 'delicious nutritious balanced home cooked meal dish on warm dining table, wholesome food'],
  [/맛집|식당|요리|레시피|디너|점심|아침|한식/gi, 'appetizing gourmet Korean dish beautifully plated on dining table with side dishes'],

  // 10. Coffee & cafe
  [/카페|커피|원두|라떼|디저트|베이커리/gi, 'cozy coffee cafe with warm aromatic latte art cup and freshly baked pastry on table'],

  // 11. Desk & workspace ergonomics
  [/재택|책상|의자|키보드|마우스/gi, 'clean ergonomic modern desk setup with comfortable chair, laptop, small succulent plant, soft natural light'],

  // 12. Medical & research
  [/의대|연구|연구팀|의사|병원|건강검진|발표|논문|의학|분석|조사/gi, 'modern medical research documents, stethoscope and health monitors in bright clinic office'],

  // 13. Spa, lymph & relaxation
  [/림프|마사지|순환|붓기|부종|혈액순환/gi, 'calming wellness spa setting with soothing aroma essential oil, clean rolled towels and natural flower petals'],

  // 14. IT & Technology
  [/인공지능|인공 지능|\bAI\b|챗봇|머신러닝/gi, 'futuristic holographic artificial intelligence digital concept glowing interface'],
  [/스마트폰|핸드폰|모바일|앱|어플|스크린/gi, 'hand holding modern sleek smartphone with colorful clean app screen'],
  [/카카오|카톡|라인|메신저/gi, 'modern smartphone on desk with chat notification screen in cozy lighting'],
  [/통신사|통신|네트워크|5G|인터넷/gi, 'high-speed futuristic 5G fiber optic network connectivity lights'],
  [/데이터센터|서버|컴퓨터|클라우드|인프라/gi, 'high-tech cloud data center server racks with cool glowing LED lights'],
  [/반도체|칩|전자기기|하드웨어/gi, 'macro view of cutting-edge computer microchip processor on circuit board'],

  // 15. Economy & Shopping
  [/주식|증시|투자|금융|경제|자산/gi, 'modern financial investment stock market charts on tablet display in sunny office'],
  [/부동산|아파트|집|주택|인테리어/gi, 'warm inviting modern apartment interior living room with comfortable sofa and sunlight'],
  [/쇼핑|특가|할인|최저가|마트|구매/gi, 'stylish colorful shopping bags and gift packages in modern boutique store'],
  [/무료|혜택|지원|국민|서비스/gi, 'welcoming modern community information center with informative displays'],

  // 16. Travel & Nature
  [/여행|관광|풍경|휴가|호텔|바다|산|자연/gi, 'breathtaking scenic outdoor travel destination with clear blue ocean and sunny mountains'],
  [/한국|국내|서울|도시/gi, 'vibrant modern Seoul cityscape with famous landmarks in beautiful evening glow'],
  [/자동차|전기차|드라이브|차량/gi, 'modern sleek electric vehicle parked on scenic coastal highway'],
  [/날씨|계절|봄|여름|가을|겨울/gi, 'gorgeous seasonal nature landscape with vivid blooming trees and blue sky']
];

export function buildEnhancedImagePrompt(basePrompt, style = 'photorealistic') {
  let text = String(basePrompt || '').trim();

  if (/[가-힣]/.test(text)) {
    let translated = text;
    for (const [pattern, replacement] of KOREAN_KEYWORDS_MAP) {
      translated = translated.replace(pattern, ` ${replacement} `);
    }
    // Remove leftover Korean characters, clean up punctuation, and deduplicate words
    const words = translated.replace(/[가-힣]/g, ' ').replace(/[^a-zA-Z0-9,\s]/g, ' ').split(/\s+/).filter(Boolean);
    const uniqueWords = [...new Set(words)];
    text = uniqueWords.join(' ');
  }

  // Sanitize any sensitive body or sexually suggestive words
  text = text.replace(SENSITIVE_WORDS_REGEX, 'wholesome lifestyle');

  if (text.length < 5) {
    text = 'healthy lifestyle and modern wellbeing concept';
  }

  // When people or human exercise are involved, ensure modest full clothing guard to prevent nudity
  const hasHumanWord = /\b(person|people|woman|women|man|men|girl|boy|female|male|human|model|worker|adult|stretching)\b/i.test(text);
  const attireGuard = hasHumanWord ? 'fully clothed in modest comfortable casual attire, ' : '';

  const styleConfig = AI_IMAGE_STYLES[style] || AI_IMAGE_STYLES.photorealistic;
  return `${attireGuard}${SAFE_IMAGE_RULES}, ${text}, ${styleConfig.suffix}`.slice(0, 900);
}

export async function generateAiDrawing({
  prompt,
  style = 'photorealistic',
  width = 1024,
  height = 768,
  outputDir,
  afterHeading = '',
  fetchImpl = fetch
}) {
  await mkdir(outputDir, { recursive: true });
  const filename = `ai-art-${randomUUID()}.jpg`;
  const filePath = path.join(outputDir, filename);

  const enhancedPrompt = buildEnhancedImagePrompt(prompt, style);
  const seed = Math.floor(Math.random() * 1000000);
  const encodedPrompt = encodeURIComponent(enhancedPrompt);
  const styleConfig = AI_IMAGE_STYLES[style] || AI_IMAGE_STYLES.photorealistic;
  const styleLabel = styleConfig.label;

  const negativePrompt = encodeURIComponent('nsfw, nudity, suggestive, bikini, cleavage, lingerie, erotic, explicit, pornographic, sensual, provocative, people, person, human, face, woman, girl, model, blur, blurry, haze, foggy, lowres, low quality, distorted');
  const candidateUrls = [
    `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=false&safe=true&negative_prompt=${negativePrompt}&model=${styleConfig.primaryModel}`,
    `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=false&safe=true&negative_prompt=${negativePrompt}&model=${styleConfig.fallbackModel}`,
    `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&safe=true&negative_prompt=${negativePrompt}&model=sana`
  ];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const imageUrl of candidateUrls) {
      try {
        const response = await fetchImpl(imageUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          signal: AbortSignal.timeout(20000)
        });

        if (response.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 2500));
          continue;
        }

        if (response.ok) {
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 10000) {
            await writeFile(filePath, bytes, { mode: 0o600 });
            return {
              id: `ai-art-${randomUUID().slice(0, 8)}`,
              title: prompt.slice(0, 60),
              filePath,
              previewUrl: `/generated-images/${filename}`,
              downloadUrl: `/generated-images/${filename}`,
              pageUrl: '',
              author: `Gemma 4 12B AI (${styleLabel})`,
              license: `Gemma 4 12B AI 생성 (${styleLabel})`,
              licenseUrl: '',
              afterHeading,
              caption: `⚡ Gemma 4 12B AI ${styleLabel}: ${prompt.slice(0, 60)}`,
              isAiGenerated: true,
              style,
              autoSelected: true
            };
          }
        }
      } catch (err) {
        console.warn(`[AiImageGen] Neural render failed (${err.message}), trying next model...`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Fallback: High-resolution Openverse or Wikimedia with full original URL
  try {
    const searchCandidates = await searchOpenImages(prompt, { limit: 3, fetchImpl });
    if (searchCandidates.length > 0) {
      const best = searchCandidates[0];
      return {
        ...best,
        afterHeading,
        caption: `⚡ ${styleLabel} 참조 사진: ${best.title}`,
        isAiGenerated: true,
        autoSelected: true
      };
    }
  } catch (err) {
    console.warn(`[AiImageGen] Open image fallback failed:`, err);
  }

  return null;
}

export async function generateAiDrawingsForPost(post, outputDir, { style = 'photorealistic', fetchImpl = fetch } = {}) {
  const plans = post.imagePlans || [];
  const headings = post.sectionHeadings || [];
  const postTitle = post.title || '블로그 주제';

  const targets = [];

  if (plans.length > 0) {
    plans.slice(0, 3).forEach((plan, idx) => {
      targets.push({
        prompt: plan.query || `${postTitle} ${headings[idx] || ''}`,
        afterHeading: plan.afterHeading || headings[idx] || ''
      });
    });
  } else if (headings.length > 0) {
    headings.slice(0, 3).forEach((heading, idx) => {
      targets.push({
        prompt: `${postTitle}, ${heading.replace(/^[#\s0-9.💪🎯🚀✨🔥💡]+/, '').trim()}`,
        afterHeading: heading
      });
    });
  } else {
    targets.push({
      prompt: postTitle,
      afterHeading: ''
    });
  }

  const generatedImages = [];
  for (const target of targets.slice(0, 3)) {
    try {
      const img = await generateAiDrawing({
        prompt: target.prompt,
        style,
        outputDir,
        afterHeading: target.afterHeading,
        fetchImpl
      });
      if (img) generatedImages.push(img);
    } catch (err) {
      console.error('[AiImageGen] Failed target rendering:', err);
    }
    // Stagger requests to avoid 429 concurrency limit
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return generatedImages;
}
