import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { searchOpenImages } from './images.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BESPOKE_BASE_DIR = existsSync(path.resolve(__dirname, '../../../output/gemini-images'))
  ? path.resolve(__dirname, '../../../output/gemini-images')
  : 'D:/work/dev/blog/output/gemini-images';

export const AI_IMAGE_STYLES = {
  photorealistic: {
    label: '실사 고화질 사진',
    suffix: 'crystal clear 8k resolution, ultra sharp focus, crisp fine details, professional commercial photography, natural bright lighting, vibrant true colors, award-winning masterpiece, highly detailed, no blur, no noise, photorealistic',
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
const SAFE_IMAGE_RULES = 'strictly family-friendly editorial still life, wholesome, high quality lifestyle photography, natural warm lighting, sharp focus, authentic cozy atmosphere';
const HUMAN_IMAGE_WORDS = /\b(person|people|woman|women|man|men|girl|boy|female|male|human|model|patient|doctor|worker|citizen|hands?|face|body|neck|shoulders?|chest|legs?|sitting|standing|stretching|rolling|exercising|eating)\b/gi;
const SENSITIVE_WORDS_REGEX = /\b(chest|breasts?|bust|cleavage|torso|body|flesh|skin|neck|shoulders?|legs?|arms?|thighs?|waist|hips?|belly|underwear|lingerie|bikini|swimwear|swimsuit|nude|naked|erotic|sensual|sexy|provocative|seductive|topless)\b/gi;

export const KOREAN_KEYWORDS_MAP = [
  // 1. Refrigerator, Pantry & Food Storage
  [/냉장고|냉동실|성에|식재료\s*보관|밀폐용기|선반\s*정리|음식\s*보관|탈취제|베이킹소다|식재료/gi, 'neatly organized clean modern refrigerator interior with fresh food produce and glass airtight containers'],

  // 2. Laundry, Towels & Odor Removal
  [/수건|타월|빨래|세탁기|세탁|쉰내|섬유유연제|빨래통|건조기|빨래\s*건조/gi, 'stack of fresh fluffy clean white cotton towels on wooden shelf in bright modern laundry room'],

  // 3. Bathroom, Shower & Mold Cleaning
  [/욕실|화장실|곰팡이|타일|샤워|스퀴지|환풍기|세면대|욕조|욕실\s*청소/gi, 'sparkling clean modern hotel style bathroom with glass shower stall, pristine white tiles and mirror'],

  // 4. Kitchen Sink, Dishwashing & Drainage
  [/싱크대|배수구|거름망|설거지|주방\s*세제|기름때|수전|식용유|폐식용유|배관/gi, 'sparkling spotless stainless steel kitchen sink with modern faucet, eco sponge and clean counter'],

  // 5. Kitchen Appliances
  [/전자레인지|에어프라이어|오븐|인덕션|가스레인지|조리대|주방\s*가전/gi, 'modern sleek stainless steel kitchen appliances on clean tidy countertop in bright kitchen'],

  // 6. Tumbler, Cutting Board & Hygiene
  [/텀블러|보온병|도마|주방칼|식기|수저|위생/gi, 'clean reusable stainless steel tumbler and natural wooden cutting board on bright kitchen island'],

  // 7. Packaging, Delivery Boxes & Recycling
  [/택배|택배\s*상자|박스|송장|운송장|분리수거|분리배출|재활용|종이류|박스테이프/gi, 'neat stack of clean kraft cardboard delivery boxes and recyclable paper packaging materials'],

  // 8. Electrical, Multi-tap & Cable Safety
  [/멀티탭|콘센트|전선|플러그|문어발|과부하|정격용량|전기\s*안전|코드/gi, 'clean organized modern desk cable management with multi-plug power extension strip and chargers'],

  // 9. Medicine, Pharmacy, Vitamins & First Aid
  [/약품|처방약|폐의약품|약\s*보관|약통|체온계|복용|알약|영양제|비타민|약국|medicine|supplement|pill/gi, 'organized amber glass medicine bottles and daily health vitamin supplements neatly arranged on clean table'],

  // 10. Dental, Toothbrush & Oral Care
  [/칫솔|치약|양치|양치질|구강|잇몸|치아|치실|가글/gi, 'eco-friendly bamboo toothbrushes in ceramic cup on sunny clean modern bathroom counter'],

  // 11. Hand Washing & Daily Hygiene
  [/손\s*씻기|손씻기|비누|손소독|손세정|흐르는\s*물|위생\s*수칙/gi, 'person washing hands with rich white soap lather bubbles under pure flowing clear tap water'],

  // 12. Walking, Jogging & Park Exercise
  [/걷기|산책|운동화|보행|조깅|러닝|식후\s*걷기|공원\s*산책/gi, 'comfortable walking sneakers on peaceful morning city park tree-lined pathway in golden sunlight'],

  // 13. Blood Pressure, Health Checks & Clinic
  [/혈압|혈압계|커프|건강검진|진료|병원|의사|청진기|측정\s*자세/gi, 'automatic digital blood pressure monitor with arm cuff and stethoscope on bright clinic desk'],

  // 14. Sleep, Bedding & Bedroom Wellness
  [/수면|숙면|잠|침실|베개|이불|취침|꿀잠|잠들기|수면\s*환경/gi, 'peaceful tidy modern bedroom with soft fluffy bedding, pillows and gentle warm bedside lamp light'],

  // 15. Foam Roller & Fascia Relaxation
  [/폼롤러|후두하근|근막|근막\s*이완|마사지볼|롤링|목\s*뒤/gi, 'high-density cylindrical foam roller on clean yoga mat in modern sunlit living room'],

  // 16. Neck, Shoulder & Upper Body Stretch
  [/목\s*늘리기|목\s*스트레칭|어깨\s*돌리기|승모근|거북목|라운드\s*숄더|목\s*통증|어깨\s*운동/gi, 'person in modest clothing gently stretching neck and shoulders with correct posture in bright pleasant room'],

  // 17. Back & Spine Posture Alignment
  [/가슴\s*열기|척추|바른\s*자세|허리|가슴\s*스트레칭|굽은\s*등|자세\s*교정/gi, 'person sitting upright opening chest with healthy straight spinal alignment in bright room'],

  // 18. Fitness, Yoga & Home Workout
  [/스트레칭|홈트|유연성|몸풀기|요가|필라테스|매트\s*운동/gi, 'person in modest sportswear doing mindful floor stretching exercise on fitness mat in bright home'],

  // 19. Water, Hydration & Healthy Drink
  [/수분|물\s*마시기|물\s*섭취|물한잔|미지근한\s*물|레몬수|수분\s*보충/gi, 'clear glass of pure refreshing water with fresh lemon slice on clean sunlit wooden table'],

  // 20. Coffee & Cafe Culture
  [/카페|커피|원두|라떼|디저트|베이커리|에스프레소|바리스타/gi, 'artisan latte art coffee in ceramic mug with freshly baked pastry on cozy cafe table'],

  // 21. Healthy Food, Salads & Diet Meals
  [/식이섬유|통곡물|영양|샐러드|채소|단백질|비타민|다이어트|식단|아보카도/gi, 'colorful fresh organic salad bowl with vibrant vegetables, avocado, nuts and healthy superfoods on dining table'],

  // 22. Korean Cooking & Recipes
  [/식사|식습관|밥|음식|맛집|식당|요리|레시피|한식|찌개|비빔밥|반찬|불고기|삼겹살/gi, 'appetizing gourmet Korean meal beautifully served in authentic ceramic bowls on warm wooden dining table'],

  // 23. Seafood, Crab & Gourmet Cooking
  [/꽃게|게찜|해산물|생선|수산물|스테이크|고기|바비큐|그릴/gi, 'fresh seasonal seafood and gourmet culinary dish beautifully prepared on rustic kitchen table'],

  // 24. Desk Ergonomics & Home Office
  [/재택|책상|의자|키보드|마우스|데스크|워크스페이스|노트북|모니터/gi, 'clean ergonomic modern desk setup with comfortable chair, laptop, green succulent plant and soft natural light'],

  // 25. Smartphone & Mobile Tech
  [/스마트폰|핸드폰|모바일|앱|어플|스크린|알림/gi, 'modern sleek smartphone on desk with colorful clean app screen in cozy lighting'],

  // 26. AI, Cloud & Cutting-edge Tech
  [/인공지능|인공 지능|\bAI\b|챗봇|머신러닝|데이터센터|서버|클라우드|컴퓨터/gi, 'futuristic holographic artificial intelligence digital concept with glowing clean geometric interface'],

  // 27. Finance, Economy & Investment
  [/주식|증시|투자|금융|경제|자산|재테크|부동산/gi, 'modern financial investment stock market graphs and data analytics on digital display in sunny office'],

  // 28. Living Room & Home Interior
  [/아파트|집|주택|인테리어|거실|소파|홈스타일링/gi, 'warm inviting modern apartment interior living room with comfortable sofa and morning sunlight'],

  // 29. Travel & Scenic Nature
  [/여행|관광|풍경|휴가|호텔|바다|산|자연|공원|날씨/gi, 'breathtaking scenic outdoor travel destination with clear blue ocean and sunny green mountains']
];

export const CURATED_EDITORIAL_COLLECTIONS = {
  // 1. Refrigerator & Kitchen Storage (냉장고, 식재료 보관, 밀폐용기, 선반 정리)
  refrigerator_kitchen: [
    { title: 'Modern double door refrigerator with open shelves, fresh food and clear bottles', url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/af/Samsung_French_Door_Refrigerator_with_Food_Showcase_Design_%2816676046120%29.jpg/1280px-Samsung_French_Door_Refrigerator_with_Food_Showcase_Design_%2816676046120%29.jpg', author: 'Wikimedia Pro' },
    { title: 'Fresh fruits and citrus neatly arranged in clean refrigerator crisper drawer', url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/78/Fruits_in_Refrigerator_Bin.jpg/1280px-Fruits_in_Refrigerator_Bin.jpg', author: 'Wikimedia Pro' },
    { title: 'Neat pantry and kitchen shelves with transparent airtight containers', url: 'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Organized glass jars with healthy grains and dry food ingredients', url: 'https://images.unsplash.com/photo-1506368249639-73a05d6f6488?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Sunlit modern minimalist kitchen with tidy counter and storage', url: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Fresh organic greens and produce ready for meal prep in kitchen', url: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 2. Laundry, Towels & Odor Removal (수건, 빨래, 세탁기, 섬유유연제, 쉰내)
  laundry_towels: [
    { title: 'Stack of fresh fluffy clean white towels on wooden shelf', url: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Modern bright laundry room with washing machine and neat baskets', url: 'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Natural woven laundry basket with soft clean linens in morning light', url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Neatly folded neutral cotton towels and soothing aroma in bathroom', url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Fresh clean laundry hanging in airy bright room with natural breeze', url: 'https://images.unsplash.com/photo-1521656693074-0ef32e80a5d5?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 3. Bathroom, Shower & Mold Cleaning (욕실 청소, 곰팡이, 타일, 샤워부스, 스퀴지)
  bathroom_shower_mold: [
    { title: 'Sparkling clean modern bathroom with glass shower and white tiles', url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Eco-friendly cleaning spray bottle and microfiber cloth on bathroom counter', url: 'https://images.unsplash.com/photo-1585421514738-01798e348b17?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Bright pristine hotel-style bathroom vanity with spotless mirror', url: 'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Natural cleaning brushes and soap dispensers arranged neatly', url: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Minimalist clean bathtub and ceramic tile wall with warm sunlight', url: 'https://images.unsplash.com/photo-1507652313519-d4e9174996dd?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 4. Kitchen Sink, Dishwashing & Drainage (싱크대, 배수구, 설거지, 주방 세정)
  kitchen_sink_cleaning: [
    { title: 'Sparkling stainless steel kitchen sink with modern faucet and natural sponge', url: 'https://images.unsplash.com/photo-1588854337236-6889d631faa8?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Spotless clean kitchen counter with dishwashing soap and wooden brush', url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Bright modern open kitchen with clean island and polished surfaces', url: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Clean ceramic plates and glasses drying on stylish wooden dish rack', url: 'https://images.unsplash.com/photo-1516455590571-18256e5bb9ff?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 5. Packaging, Delivery Boxes & Recycling (택배 상자, 박스, 분리배출, 송장 제거)
  packaging_delivery_boxes: [
    { title: 'Clean kraft cardboard delivery boxes stacked neatly in bright room', url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Eco-friendly paper packaging boxes and wrapping materials on table', url: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Person organizing cardboard parcels and delivery boxes carefully', url: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Recyclable clean paper packaging and shipping boxes ready for sorting', url: 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 6. Electrical, Multi-tap & Cable Safety (멀티탭, 콘센트, 전선, 전력 안전)
  electrical_multitap_safety: [
    { title: 'Organized modern desk cable setup and multi-plug power extension', url: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Clean tidy computer desk with safe power cable management', url: 'https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Modern workspace electronics with neat power strips and chargers', url: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Safe organized smart home charging station on wooden console', url: 'https://images.unsplash.com/photo-1555774698-0b77e0d5fac6?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 7. Medicine, Pharmacy, Vitamins & First Aid (약, 영양제, 비타민, 체온계, 보관법)
  medicine_vitamins_health: [
    { title: 'Organized amber glass medicine bottles and daily supplement capsules', url: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Assorted vitamins and healthy nutritional supplements on clean table', url: 'https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Modern home first aid kit and healthcare essentials neatly arranged', url: 'https://images.unsplash.com/photo-1603398938378-e54eab446dde?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Daily health supplements and prescription medicine neatly arranged', url: 'https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 8. Dental, Toothbrush & Oral Care (칫솔, 치약, 양치 습관, 구강 관리)
  dental_toothbrush_oral: [
    { title: 'Eco-friendly bamboo toothbrushes in ceramic cup on sunny bathroom counter', url: 'https://images.unsplash.com/photo-1507652313519-d4e9174996dd?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Natural oral hygiene essentials with clean toothbrushes and towel', url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Minimalist morning dental care station with natural bright sunlight', url: 'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 9. Hand Washing & Daily Hygiene (손씻기, 비누, 세정제, 손소독)
  handwashing_hygiene: [
    { title: 'Person washing hands with rich lather soap bubbles under clean water', url: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Natural artisan soap bar and foaming hand wash in bright bathroom', url: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Clean hands reaching for refreshing pure flowing tap water', url: 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 10. Walking, Jogging & Park Exercise (걷기, 산책, 운동화, 아침 운동)
  walking_park_exercise: [
    { title: 'Person in comfortable running shoes walking along peaceful park trail', url: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Morning sunlight filtering through green trees on quiet walking path', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Comfortable sneakers on outdoor pathway during refreshing stroll', url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Serene city park boardwalk surrounded by lush nature and fresh air', url: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 11. Blood Pressure, Health Checks & Clinic (혈압, 혈압계, 건강검진, 진료)
  medical_bloodpressure: [
    { title: 'Automatic blood pressure monitor with cuff and stethoscope on clinic desk', url: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Doctor consulting patient with health records and diagnostic tools', url: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Modern medical checkup instruments and health tracking equipment', url: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 12. Sleep, Bedding & Bedroom Wellness (수면, 숙면, 침실, 베개, 이불, 휴식)
  sleep_bedroom_wellness: [
    { title: 'Peaceful tidy modern bedroom with soft fluffy bedding and warm bedside lamp', url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Cozy serene bed with neat linen duvet and morning sun rays', url: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Comfortable supportive pillows arranged neatly on inviting bed', url: 'https://images.unsplash.com/photo-1584132967334-10e028bd69f7?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Calm evening bedroom reading atmosphere with soft warm illumination', url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Natural sleep sanctuary with soft curtains and relaxing ambiance', url: 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 13. Neck, Shoulder & Foam Roller (목 스트레칭, 어깨, 폼롤러, 근막 이완)
  neck_shoulder_foamroller: [
    { title: 'High-density cylindrical foam roller for spine and muscle mobility', url: 'https://upload.wikimedia.org/wikipedia/commons/4/41/Hartschaumrolle.jpg', author: 'Wikimedia Pro' },
    { title: 'Textured EVA foam roller for deep tissue fascia massage and back release', url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c6/%ED%8F%BC%EB%A1%A4%EB%9F%AC.jpg/1280px-%ED%8F%BC%EB%A1%A4%EB%9F%AC.jpg', author: 'Wikimedia Pro' },
    { title: 'Fitness mobility equipment and foam roller prepared on clean wooden floor', url: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Posture alignment exercise mat and wellness tools in sunlit room', url: 'https://images.unsplash.com/photo-1594737625785-a6cbdabd333c?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 14. Desk Ergonomics & Home Office (책상, 의자, 모니터, 워크스페이스, 재택근무)
  office_ergonomics: [
    { title: 'Modern ergonomic office workstation with monitor and natural lighting', url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Minimalist productive desk with laptop, plant and comfortable chair', url: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Cozy organized home office desk with warm wooden texture and sunlight', url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Clean dual monitor setup with mechanical keyboard and desk mat', url: 'https://images.unsplash.com/photo-1587614382346-4ec70e388b28?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Bright creative workspace with laptop and healthy green houseplant', url: 'https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 15. Coffee & Cafe Culture (커피, 카페, 라떼아트, 원두, 디저트)
  cafe_coffee: [
    { title: 'Artisan latte art in warm ceramic mug at cozy modern coffee shop', url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Freshly roasted specialty coffee beans and brewed cup on wooden table', url: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Pour-over drip coffee brewing with fragrant aroma in sunlit cafe', url: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Freshly baked buttery pastry and iced beverage on cafe patio', url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 16. Healthy Food, Salads & Dining (샐러드, 건강식, 식단, 다이어트, 영양)
  healthy_food_dining: [
    { title: 'Colorful fresh organic salad bowl with avocado, seeds and vegetables', url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Nutritious balanced wholesome home cooked dish on warm table', url: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Fresh vibrant meal bowl with healthy superfoods and greens', url: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Artisan culinary dish beautifully plated with fresh ingredients', url: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Gourmet dining meal on warm wooden table with side dishes', url: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 17. Seafood, Meat & Gourmet Cooking (꽃게, 해산물, 고기, 스테이크, 요리)
  seafood_meat_cooking: [
    { title: 'Fresh seasonal seafood and gourmet ingredients on rustic kitchen board', url: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Delicious freshly prepared seafood dish served with herbs and lemon', url: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Sizzling savory meat dish beautifully grilled on warm plate', url: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Gourmet cooking pan with steaming aromatic fresh ingredients', url: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 18. Smartphone, Mobile & Digital Life (스마트폰, 핸드폰, 앱, 모바일 라이프)
  smartphone_digital_life: [
    { title: 'Modern sleek smartphone on clean wooden desk with glowing screen', url: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Hand holding modern smartphone displaying colorful clean interface', url: 'https://images.unsplash.com/photo-1526406915894-7bcd65f60845?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Wireless devices and smart tech accessories on minimalist desk', url: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 19. AI, Cloud & Cutting-Edge Tech (인공지능, AI, 데이터, 클라우드, 인프라)
  ai_technology_cloud: [
    { title: 'Cutting-edge AI artificial intelligence digital glow concept interface', url: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'High-tech cloud data center server racks with illuminated LED lights', url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Modern software developer coding workstation with multiple displays', url: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Futuristic abstract global fiber optic network data flow', url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 20. Finance, Investment & Economy (주식, 증시, 재테크, 투자, 금융, 부동산)
  finance_economy_stocks: [
    { title: 'Financial stock market investment charts and analytics on digital screen', url: 'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Business growth data analytics dashboard on tablet in modern office', url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Financial planning calculator and investment growth notes on desk', url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Modern banking wealth growth and savings investment concept', url: 'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 21. Living Room & Home Interior (거실, 소파, 아파트, 인테리어, 아늑한 집)
  interior_living_room: [
    { title: 'Warm inviting modern apartment living room with comfortable sofa and sunlight', url: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Minimalist Scandinavian living room interior with cozy plants and cushions', url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Peaceful sunlit reading nook with armchair and warm wooden floor', url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 22. Water, Hydration & Healthy Drink (물, 수분 섭취, 레몬수, 미네랄 워터)
  water_hydration_drink: [
    { title: 'Pouring fresh mineral water into clear tumbler glass on wooden dining table', url: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Refreshing pure hydration water bottle beside healthy lifestyle notebook', url: 'https://images.unsplash.com/photo-1523362628745-0c100150b504?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Clear glass of refreshing water with lemon slice on wooden cafe table', url: 'https://images.unsplash.com/photo-1512069772995-ec65ed45afd6?w=1280&q=80', author: 'Unsplash Pro' }
  ],

  // 23. Scenic Nature & Outdoor Travel (여행, 명소, 바다, 산, 공원, 힐링 풍경)
  travel_nature_scenic: [
    { title: 'Breathtaking scenic coastal ocean travel destination under clear blue sky', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Lush green forest canopy with warm morning sunlight streaming through', url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Peaceful mountain ridge trail overlook with fresh crisp air', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1280&q=80', author: 'Unsplash Pro' },
    { title: 'Golden autumn leaves along tranquil park pathway in soft light', url: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=1280&q=80', author: 'Unsplash Pro' }
  ]
};

export function findCuratedEditorialPhoto(text, excludeUrls = new Set(), excludeTitles = new Set()) {
  const combined = String(text || '').toLowerCase();
  let categoryKey = 'travel_nature_scenic';

  // 1. Medicine & Pharmacy & Health Checks (Priority: check specific medicine words first)
  if (/약품|처방약|폐의약품|약\s*보관|약통|체온계|복용|알약|영양제|비타민|약국|medicine|supplement|pill|first\s*aid/i.test(combined)) {
    categoryKey = 'medicine_vitamins_health';
  } else if (/혈압|혈압계|커프|건강검진|진료|병원|의사|청진기|blood\s*pressure|clinic|stethoscope/i.test(combined)) {
    categoryKey = 'medical_bloodpressure';
  } else if (/칫솔|치약|양치|구강|잇몸|치아|치실|가글|toothbrush|dental|oral/i.test(combined)) {
    categoryKey = 'dental_toothbrush_oral';
  } else if (/손\s*씻기|손씻기|비누|손소독|손세정|hand\s*wash|soap/i.test(combined)) {
    categoryKey = 'handwashing_hygiene';
  }
  // 2. Refrigerator, Pantry & Food Storage
  else if (/냉장고|냉동실|성에|식재료\s*보관|밀폐용기|선반\s*정리|음식\s*보관|탈취제|베이킹소다|refrigerator|freezer|pantry/i.test(combined)) {
    categoryKey = 'refrigerator_kitchen';
  }
  // 3. Laundry, Towels & Linens
  else if (/수건|타월|빨래|세탁기|세탁|쉰내|섬유유연제|빨래통|건조기|laundry|towel/i.test(combined)) {
    categoryKey = 'laundry_towels';
  }
  // 4. Bathroom, Mold & Tiles
  else if (/욕실|화장실|곰팡이|타일|샤워|스퀴지|환풍기|세면대|욕조|bathroom|mold|shower/i.test(combined)) {
    categoryKey = 'bathroom_shower_mold';
  }
  // 5. Kitchen Sink & Dishwashing
  else if (/싱크대|배수구|거름망|설거지|주방\s*세제|기름때|수전|식용유|폐식용유|sink|drain/i.test(combined)) {
    categoryKey = 'kitchen_sink_cleaning';
  }
  // 6. Delivery Boxes & Packaging
  else if (/택배|상자|박스|송장|운송장|분리수거|분리배출|재활용|종이류|box|package|packaging|cardboard/i.test(combined)) {
    categoryKey = 'packaging_delivery_boxes';
  }
  // 7. Multi-tap & Cable Safety
  else if (/멀티탭|콘센트|전선|플러그|문어발|과부하|정격용량|전기\s*안전|power\s*strip|multitap|cord/i.test(combined)) {
    categoryKey = 'electrical_multitap_safety';
  }
  // 8. Foam Roller & Spine Posture & Stretching
  else if (/폼롤러|후두하근|근막|이완|마사지볼|롤링|foam\s*roller/i.test(combined)) {
    categoryKey = 'neck_shoulder_foamroller';
  } else if (/목\s*늘리기|목\s*스트레칭|어깨|승모근|거북목|라운드\s*숄더|척추|바른\s*자세|허리|가슴\s*열기|자세\s*교정|등|스트레칭|neck|shoulder|stretch|posture|spine/i.test(combined)) {
    categoryKey = 'neck_shoulder_foamroller';
  }
  // 9. Sleep & Bedroom
  else if (/수면|숙면|잠|침실|베개|이불|취침|sleep|bedroom|bedding/i.test(combined)) {
    categoryKey = 'sleep_bedroom_wellness';
  }
  // 10. Walking & Park
  else if (/걷기|산책|운동화|보행|조깅|러닝|walk|walking|park/i.test(combined)) {
    categoryKey = 'walking_park_exercise';
  }
  // 11. Seafood, Meat & Cooking
  else if (/꽃게|게찜|해산물|생선|스테이크|고기|삼겹살|seafood|crab|meat/i.test(combined)) {
    categoryKey = 'seafood_meat_cooking';
  }
  // 12. Healthy Dining & Salad
  else if (/샐러드|다이어트|채소|식이섬유|과일|식단|한식|요리|맛집|식사|찌개|비빔밥|반찬|레시피|salad|diet|food|cooking/i.test(combined)) {
    categoryKey = 'healthy_food_dining';
  }
  // 13. Cafe & Coffee
  else if (/카페|커피|라떼|원두|디저트|cafe|coffee|latte|dessert/i.test(combined)) {
    categoryKey = 'cafe_coffee';
  }
  // 14. Desk & Office Ergonomics
  else if (/책상|모니터|의자|데스크|워크스페이스|키보드|사무실|재택|노트북|desk|office|workstation|workspace/i.test(combined)) {
    categoryKey = 'office_ergonomics';
  }
  // 15. Smartphone & Mobile
  else if (/스마트폰|모바일|앱|핸드폰|smartphone|phone|digital/i.test(combined)) {
    categoryKey = 'smartphone_digital_life';
  }
  // 16. AI & Tech
  else if (/인공지능|AI|데이터|클라우드|서버|컴퓨터|tech|cloud/i.test(combined)) {
    categoryKey = 'ai_technology_cloud';
  }
  // 17. Finance & Stocks
  else if (/주식|증시|투자|금융|재테크|경제|부동산|자산|finance|market|investment|stock/i.test(combined)) {
    categoryKey = 'finance_economy_stocks';
  }
  // 18. Interior & Living Room
  else if (/아파트|집|주택|인테리어|거실|소파|living\s*room|interior/i.test(combined)) {
    categoryKey = 'interior_living_room';
  }
  // 19. Water & Hydration
  else if (/물\s*마시기|수분|미지근한\s*물|레몬수|water|hydration/i.test(combined)) {
    categoryKey = 'water_hydration_drink';
  }
  // 20. Travel & Nature
  else if (/여행|관광|풍경|자연|공원|날씨|바다|산|나무|travel|nature|scenic/i.test(combined)) {
    categoryKey = 'travel_nature_scenic';
  }

  const primary = CURATED_EDITORIAL_COLLECTIONS[categoryKey] || CURATED_EDITORIAL_COLLECTIONS.travel_nature_scenic;
  const match = primary.find((item) => !excludeUrls.has(item.url) && !excludeTitles.has(item.title));
  if (match) return match;

  // Search through all categories for any unused photo
  for (const cat of Object.values(CURATED_EDITORIAL_COLLECTIONS)) {
    const fallbackItem = cat.find((item) => !excludeUrls.has(item.url) && !excludeTitles.has(item.title));
    if (fallbackItem) return fallbackItem;
  }

  return primary[0] || null;
}

export function extractSearchKeywordCandidates(text, heading = '', topic = '') {
  const queryStr = String(text || '').trim();
  const headingStr = String(heading || '').trim();
  const topicStr = String(topic || '').trim();

  const candidates = [];
  const combined = `${headingStr} ${topicStr} ${queryStr}`;

  for (const [pattern, englishKeyword] of KOREAN_KEYWORDS_MAP) {
    if (pattern.test(combined)) {
      candidates.push(englishKeyword);
    }
  }

  if (!candidates.length) {
    candidates.push('healthy lifestyle and modern wellbeing concept');
  }

  return [...new Set(candidates)];
}

export function extractSearchKeywords(text, heading = '', topic = '') {
  const list = extractSearchKeywordCandidates(text, heading, topic);
  return list[0] || 'lifestyle';
}

export const BESPOKE_TOPICS = [
  {
    folder: '2026-09-15-refrigerator-cleaning',
    pattern: /냉장고|냉동실|성에|밀폐용기|선반\s*정리|음식\s*보관|탈취제|베이킹소다|식재료\s*정리|refrigerator|fridge/i
  },
  {
    folder: '2026-09-15-foam-roller-stretching',
    pattern: /폼롤러|후두하근|근막|이완|도리도리|foam\s*roller|마사지볼|목\s*스트레칭|승모근|거북목|라운드\s*숄더|스트레칭|자세\s*교정/i
  },
  {
    folder: '2026-09-15-laundry-towels',
    pattern: /수건|타월|빨래|세탁기|세탁|쉰내|섬유유연제|빨래통|건조기|laundry|towel/i
  },
  {
    folder: '2026-09-06-trend-crab',
    pattern: /꽃게|게찜|수꽃게|게\s*손질|해산물\s*찜|crab/i
  },
  {
    folder: '2026-09-08-jeyuk-recipe',
    pattern: /제육|제육볶음|돼지\s*불고기|고추장\s*불고기|기사식당|앞다리살/i
  },
  {
    folder: '2026-09-05-cooktop-cleaning',
    pattern: /인덕션|가스레인지|가스렌지|조리대|하이라이트|상판|탄\s*자국|cooktop|stove/i
  },
  {
    folder: '2026-09-06-shower-glass-cleaning',
    pattern: /샤워부스|유리\s*물때|스퀴지|욕실\s*유리|shower\s*glass/i
  },
  {
    folder: '2026-09-08-unclog-toilet',
    pattern: /변기|변기\s*막힘|막힌\s*변기|변기\s*뚫|toilet/i
  },
  {
    folder: '2026-09-05-washing-machine-cleaning',
    pattern: /통세척|세탁조|세탁기\s*곰팡이|washing\s*machine\s*clean/i
  },
  {
    folder: '2026-09-06-air-fryer-cleaning',
    pattern: /에어프라이어|에어\s*프라이어|air\s*fryer/i
  },
  {
    folder: '2026-09-05-tumbler-cleaning',
    pattern: /텀블러|보온병|tumbler/i
  },
  {
    folder: '2026-09-05-microwave-cleaning',
    pattern: /전자레인지|전자렌지|레인지\s*청소|microwave/i
  },
  {
    folder: '2026-09-06-window-track-cleaning',
    pattern: /창틀|방충망|창문\s*청소|window\s*track/i
  },
  {
    folder: '2026-09-05-cutting-board-hygiene',
    pattern: /도마|도마\s*살균|도마\s*세척|cutting\s*board/i
  },
  {
    folder: '2026-09-07-daiso-organizer',
    pattern: /다이소|수납함|서랍\s*정리|정리\s*바구니|organizer/i
  },
  {
    folder: '2026-09-07-sweet-potato-stem',
    pattern: /고구마줄기|고구마순/i
  },
  {
    folder: '2026-09-06-trend-fig',
    pattern: /무화과|무화과\s*보관|fig/i
  },
  {
    folder: '2026-09-06-trend-blanket',
    pattern: /이불|이불\s*세탁|극세사|가을\s*이불|침구|blanket/i
  },
  {
    folder: '2026-09-06-vitamin-timing',
    pattern: /비타민\s*시간|영양제\s*시간|식전\s*식후\s*영양제|vitamin\s*timing/i
  },
  {
    folder: '2026-09-06-vitamin-b-complex',
    pattern: /비타민\s*b|활성형\s*비타민|벤포티아민|vitamin\s*b/i
  },
  {
    folder: '2026-09-06-supplement-synergy',
    pattern: /영양제|비타민|밀크씨슬|오메가|supplement/i
  },
  {
    folder: '2026-09-08-diabetes-symptoms',
    pattern: /당뇨|혈당|공복혈당|거꾸로\s*식사|diabetes/i
  },
  {
    folder: '2026-09-08-influenza-a',
    pattern: /독감|a형\s*독감|타미플루|발열|flu|influenza/i
  },
  {
    folder: '2026-09-07-vagus-nerve',
    pattern: /미주신경|자율신경|부교감|호흡법|vagus/i
  },
  {
    folder: '2026-09-09-gpt-astra',
    pattern: /gpt-?5|gpt-?6|astra|ai\s*에이전트/i
  },
  {
    folder: '2026-09-09-local-ai-ollama',
    pattern: /로컬\s*ai|ollama|라마|오라마/i
  },
  {
    folder: '2026-09-09-prompt-engineering',
    pattern: /프롬프트|프롬프트\s*엔지니어링|prompt/i
  },
  {
    folder: '2026-09-09-vibe-coding',
    pattern: /바이브\s*코딩|ai\s*코딩|vibe\s*coding/i
  },
  {
    folder: '2026-09-10-ai-image-guide',
    pattern: /ai\s*이미지|미드저니|ai\s*그림|image\s*gen/i
  },
  {
    folder: '2026-09-10-ai-music-guide',
    pattern: /ai\s*음악|수노|suno|music\s*ai/i
  },
  {
    folder: '2026-09-10-ai-search-guide',
    pattern: /ai\s*검색|퍼플렉시티|perplexity/i
  },
  {
    folder: '2026-09-11-ai-pdf-tools',
    pattern: /pdf\s*요약|문서\s*분석|pdf\s*ai/i
  },
  {
    folder: '2026-09-11-ai-summary-tools',
    pattern: /회의록|음성\s*텍스트|클로바노트|ai\s*요약/i
  },
  {
    folder: '2026-09-11-ai-voice-english',
    pattern: /영어\s*회화|ai\s*튜터|스피킹|voice\s*english/i
  }
];

export async function findBespokeTopicImage({
  query,
  outputDir,
  afterHeading = '',
  postTitle = '',
  excludeUrls = new Set(),
  excludeTitles = new Set()
}) {
  try {
    const combinedContext = `${query} ${afterHeading} ${postTitle}`;
    const matchedTopic = BESPOKE_TOPICS.find((t) => t.pattern.test(combinedContext));
    if (!matchedTopic) return null;

    const topicDir = path.join(BESPOKE_BASE_DIR, matchedTopic.folder);
    if (!existsSync(topicDir)) return null;

    let candidates = [];
    const metaPath = path.join(topicDir, 'images.json');
    if (existsSync(metaPath)) {
      try {
        const metaList = JSON.parse(readFileSync(metaPath, 'utf8'));
        for (const m of metaList) {
          if (m.filePath && existsSync(m.filePath)) {
            candidates.push({
              filePath: m.filePath,
              title: m.title || path.basename(m.filePath, '.jpg'),
              afterHeading: m.afterHeading || ''
            });
          }
        }
      } catch {}
    }

    if (!candidates.length) {
      const rawFiles = readdirSync(topicDir).filter((f) => f.endsWith('.jpg') && !f.startsWith('ai-art-'));
      candidates = rawFiles.map((f) => ({
        filePath: path.join(topicDir, f),
        title: f.replace(/^[0-9]+[_-]/, '').replace(/\.jpg$/, '').replace(/[-_]/g, ' '),
        afterHeading: ''
      }));
    }

    if (!candidates.length) return null;

    const unused = candidates.filter((c) => !excludeUrls.has(c.filePath) && !excludeTitles.has(c.title));
    if (!unused.length) return null;

    let chosen = unused.find((c) => c.afterHeading && afterHeading && (
      c.afterHeading.includes(afterHeading) || afterHeading.includes(c.afterHeading)
    ));
    if (!chosen) {
      chosen = unused[0];
    }

    excludeUrls.add(chosen.filePath);
    excludeTitles.add(chosen.title);

    const filename = `bespoke-gemini-${randomUUID().slice(0, 8)}.jpg`;
    const targetPath = path.join(outputDir, filename);

    await mkdir(outputDir, { recursive: true });
    copyFileSync(chosen.filePath, targetPath);

    try {
      const thumbsDir = path.join(outputDir, '.thumbs');
      await mkdir(thumbsDir, { recursive: true });
      const thumbPath = path.join(thumbsDir, filename);
      await sharp(targetPath)
        .resize({ width: 360, withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(thumbPath);
    } catch {}

    return {
      id: `bespoke-gemini-${randomUUID().slice(0, 8)}`,
      title: chosen.title,
      filePath: targetPath,
      previewUrl: `generated-images/thumb/${filename}`,
      downloadUrl: `generated-images/${filename}`,
      thumbnailUrl: `generated-images/thumb/${filename}`,
      pageUrl: '',
      author: '💎 Google Imagen 3 (스튜디오 실사 에디토리얼)',
      license: '상업용 라이선스 완비',
      licenseUrl: '',
      afterHeading,
      caption: `📷 고화질 실사: ${chosen.title}`,
      isAiGenerated: true,
      style: 'photorealistic',
      autoSelected: true
    };
  } catch (err) {
    console.warn('[AiImageGen] Bespoke image search bypassed:', err.message);
    return null;
  }
}

export async function fetchRealEditorialPhoto({
  query,
  outputDir,
  afterHeading = '',
  postTitle = '',
  fetchImpl = fetch,
  excludeUrls = new Set(),
  excludeTitles = new Set()
}) {
  try {
    const combinedContext = `${query} ${afterHeading} ${postTitle}`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const curated = findCuratedEditorialPhoto(combinedContext, excludeUrls, excludeTitles);
      if (!curated || !curated.url) break;

      excludeUrls.add(curated.url);
      excludeTitles.add(curated.title);
      const filename = `editorial-photo-${randomUUID().slice(0, 8)}.jpg`;
      const filePath = path.join(outputDir, filename);

      try {
        const response = await fetchImpl(curated.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(7000)
        });
        if (response.ok) {
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 5000) {
            await mkdir(outputDir, { recursive: true });
            await writeFile(filePath, bytes, { mode: 0o600 });
            try {
              const thumbsDir = path.join(outputDir, '.thumbs');
              await mkdir(thumbsDir, { recursive: true });
              const thumbPath = path.join(thumbsDir, filename);
              await sharp(filePath)
                .resize({ width: 360, withoutEnlargement: true })
                .jpeg({ quality: 80, mozjpeg: true })
                .toFile(thumbPath);
            } catch {}

            return {
              id: `editorial-photo-${randomUUID().slice(0, 8)}`,
              title: curated.title,
              filePath,
              previewUrl: `generated-images/thumb/${filename}`,
              downloadUrl: `generated-images/${filename}`,
              thumbnailUrl: `generated-images/thumb/${filename}`,
              pageUrl: curated.url,
              author: `📷 고화질 에디토리얼 포토 (${curated.author || 'Unsplash Pro'})`,
              license: '자유 상업용 라이선스',
              licenseUrl: '',
              afterHeading,
              caption: `📷 고화질 실사: ${curated.title}`,
              isAiGenerated: false,
              style: 'photorealistic',
              autoSelected: true
            };
          }
        }
      } catch (curatedErr) {
        console.warn('[RealPhotoGen] Photo fetch failed, trying next candidate:', curatedErr.message);
      }
    }
  } catch (err) {
    console.warn('[RealPhotoGen] Real photo fetch error:', err.message);
  }
  return null;
}

export function buildEnhancedImagePrompt(basePrompt, style = 'photorealistic') {
  let text = String(basePrompt || '').trim();

  if (/[가-힣]/.test(text)) {
    let translated = text;
    for (const [pattern, replacement] of KOREAN_KEYWORDS_MAP) {
      translated = translated.replace(pattern, ` ${replacement} `);
    }
    const words = translated.replace(/[가-힣]/g, ' ').replace(/[^a-zA-Z0-9,\s]/g, ' ').split(/\s+/).filter(Boolean);
    const uniqueWords = [...new Set(words)];
    text = uniqueWords.join(' ');
  }

  text = text.replace(SENSITIVE_WORDS_REGEX, 'wholesome lifestyle');

  if (text.length < 5) {
    text = 'healthy lifestyle and modern wellbeing concept';
  }

  const hasHumanWord = /\b(person|people|woman|women|man|men|girl|boy|female|male|human|model|worker|adult|stretching)\b/i.test(text);
  const attireGuard = hasHumanWord ? 'fully clothed in modest comfortable casual attire, ' : '';

  const styleConfig = AI_IMAGE_STYLES[style] || AI_IMAGE_STYLES.photorealistic;
  return `${text}, ${attireGuard}${SAFE_IMAGE_RULES}, ${styleConfig.suffix}`.slice(0, 900);
}

// Prompt for Google Imagen. Unlike buildEnhancedImagePrompt (which strips Korean for engines that cannot
// read it), Gemini understands Korean, so the post title and section heading go in as written; dropping
// them made Imagen draw generic scenes unrelated to the post.
export function buildImagenPrompt(basePrompt, style = 'photorealistic', { postTitle = '', afterHeading = '' } = {}) {
  const subject = String(basePrompt || '').replace(SENSITIVE_WORDS_REGEX, 'wholesome lifestyle').trim();
  const styleConfig = AI_IMAGE_STYLES[style] || AI_IMAGE_STYLES.photorealistic;
  return [
    postTitle ? `Image for a Korean blog post titled "${postTitle}"` : 'Image for a Korean blog post',
    afterHeading ? `, for the section "${afterHeading}"` : '',
    `. Show exactly what this is about: ${subject || postTitle}.`,
    ` ${SAFE_IMAGE_RULES}. Any people are fully clothed in modest casual attire.`,
    ` Style: ${styleConfig.suffix}`
  ].join('').slice(0, 1200);
}

export async function generateAiDrawing({
  prompt,
  style = 'photorealistic',
  width = 1024,
  height = 768,
  outputDir,
  afterHeading = '',
  fetchImpl = fetch,
  imageModelManager = null,
  seed = null,
  postTitle = '',
  excludeUrls = new Set(),
  excludeTitles = new Set()
}) {
  await mkdir(outputDir, { recursive: true });
  // 1. Google Imagen (agy generate_image): the only image model.
  const agyClient = imageModelManager?.agyClient;
  if (agyClient && typeof agyClient.generateImageWithAgy === 'function') {
    try {
      const imagenImg = await agyClient.generateImageWithAgy({
        prompt: buildImagenPrompt(prompt, style, { postTitle, afterHeading }),
        outputDir,
        imageName: afterHeading || postTitle || 'blog',
        style,
        afterHeading,
        width,
        height
      });
      if (imagenImg) {
        const label = (afterHeading || postTitle || prompt).replace(/^[#\s0-9.]+/, '').slice(0, 60);
        return { ...imagenImg, title: label, caption: `💎 Google Imagen: ${label}` };
      }
    } catch (agyErr) {
      console.warn('[AiImageGen] Google Imagen failed:', agyErr.message);
    }
  }

  // 2. When Imagen is unavailable (quota, network), fall back to a photo matching the section so the
  //    post is never left without images.
  const bespokeFallback = await findBespokeTopicImage({
    query: prompt,
    outputDir,
    afterHeading,
    postTitle,
    excludeUrls,
    excludeTitles
  });
  if (bespokeFallback) return bespokeFallback;

  return fetchRealEditorialPhoto({
    query: prompt,
    outputDir,
    afterHeading,
    postTitle,
    fetchImpl,
    excludeUrls,
    excludeTitles
  });
}

export async function generateAiDrawingsForPost(
  post,
  outputDir,
  {
    style = 'photorealistic',
    fetchImpl = fetch,
    imageModelManager = null,
    imagePrompt = '',
    excludeUrls = new Set(),
    excludeTitles = new Set()
  } = {}
) {
  const plans = post.imagePlans || [];
  const headings = post.sectionHeadings || [];
  const postTitle = post.title || '블로그 주제';

  const targets = [];

  const visualPerspectives = [
    'introduction overview concept and preparation phase',
    'step by step practical action and core instructional method detail',
    'inspiring clean result tidy space and completed practical benefits'
  ];

  const customUserStyle = (imagePrompt && !imagePrompt.includes('[블로그 맞춤') && imagePrompt.length < 120)
    ? imagePrompt.trim()
    : '';

  if (plans.length > 0) {
    plans.slice(0, 3).forEach((plan, idx) => {
      const baseQuery = plan.query || `${postTitle} ${headings[idx] || ''}`;
      const decoratedPrompt = [
        customUserStyle,
        baseQuery,
        visualPerspectives[idx] || ''
      ].filter(Boolean).join(', ');

      targets.push({
        prompt: decoratedPrompt,
        afterHeading: plan.afterHeading || headings[idx] || '',
        seed: Math.floor(Math.random() * 800000) + 100000 + (idx * 37777)
      });
    });
  } else if (headings.length > 0) {
    headings.slice(0, 3).forEach((heading, idx) => {
      const cleanHeading = heading.replace(/^[#\s0-9.💪🎯🚀✨🔥💡]+/, '').trim();
      const decoratedPrompt = [
        customUserStyle,
        `${postTitle} - ${cleanHeading}`,
        visualPerspectives[idx] || ''
      ].filter(Boolean).join(', ');

      targets.push({
        prompt: decoratedPrompt,
        afterHeading: heading,
        seed: Math.floor(Math.random() * 800000) + 100000 + (idx * 37777)
      });
    });
  } else {
    for (let idx = 0; idx < 3; idx += 1) {
      targets.push({
        prompt: [customUserStyle, postTitle, visualPerspectives[idx]].filter(Boolean).join(', '),
        afterHeading: '',
        seed: Math.floor(Math.random() * 800000) + 100000 + (idx * 37777)
      });
    }
  }

  // Imagen takes about a minute per picture, so the three run at once.
  const results = await Promise.all(targets.slice(0, 3).map(async (target) => {
    try {
      const img = await generateAiDrawing({
        prompt: target.prompt,
        style,
        outputDir,
        afterHeading: target.afterHeading,
        fetchImpl,
        imageModelManager,
        seed: target.seed,
        postTitle,
        excludeUrls,
        excludeTitles
      });
      if (img) {
        if (img.downloadUrl) excludeUrls.add(img.downloadUrl);
        if (img.pageUrl) excludeUrls.add(img.pageUrl);
        if (img.title) excludeTitles.add(img.title);
      }
      return img;
    } catch (err) {
      console.error('[AiImageGen] Failed target rendering:', err);
      return null;
    }
  }));

  return results.filter(Boolean);
}
