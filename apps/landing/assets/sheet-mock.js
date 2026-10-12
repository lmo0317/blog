// Spreadsheet look-alike of the activity report the app downloads. Every element with
// [data-sheet-mock] becomes one; clicking a sheet tab at the bottom switches the table.
// Sample rows are made up (no real bloggers).
(() => {
  const OK = (t) => `<span class="xl-tag ok">${t}</span>`;
  const NO = (t) => `<span class="xl-tag no">${t}</span>`;
  const WAIT = (t) => `<span class="xl-tag wait">${t}</span>`;
  const LINK = (t) => `<span class="xl-link">${t}</span>`;
  // [header, mobile-visible?] then rows.
  const SHEETS = [
    { name: '요약', cols: [['날짜', 1], ['공감', 1], ['댓글', 1], ['서이추 신청', 1], ['대댓글', 0], ['신청 수락', 0], ['보낸 신청 회수', 0]],
      rows: [['<b>합계</b>', '<b>761</b>', '<b>407</b>', '<b>291</b>', '<b>49</b>', '<b>38</b>', '<b>30</b>'],
        ['10-12', '124', '67', '42', '9', '6', '0'], ['10-11', '118', '61', '44', '8', '5', '30'], ['10-10', '109', '58', '40', '7', '7', '0']] },
    { name: '서이추 신청', cols: [['시간', 1], ['결과', 1], ['블로그 ID', 1], ['닉네임', 0], ['경로', 0]],
      rows: [['10-12 11:42', OK('신청 완료'), LINK('jeju_dayoff'), '제주한달살이', '키워드 · 제주 카페'],
        ['10-12 11:38', OK('신청 완료'), LINK('cook_mom22'), '요리하는엄마', '내 글에 댓글 단 이웃'],
        ['10-12 11:31', NO('신청 불가 블로그'), LINK('daily_ad99'), '오늘의특가', '키워드 · 제주 카페'],
        ['10-12 10:57', OK('신청 완료'), LINK('runner_kim'), '달리는김대리', '키워드 · 러닝화 추천']] },
    { name: '내가 단 댓글', cols: [['시간', 1], ['구분', 0], ['닉네임', 0], ['글 제목', 1], ['내 댓글', 1]],
      rows: [['10-12 12:57', '이웃 새글', '요리하는엄마', LINK('10분 완성 가지덮밥'), '가지를 먼저 구워 물기를 날리는 팁 덕분에 덮밥이 질척하지 않겠어요 😊'],
        ['10-12 12:41', '키워드 소통', '제주한달살이', LINK('애월 오션뷰 카페 3곳'), '창가 자리는 오전에 가야 한다는 팁이 유용하네요!'],
        ['10-12 12:20', '답방', '달리는김대리', LINK('첫 10km 완주 후기'), '7km 지점에서 페이스를 늦춘 판단이 완주 비결이었네요. 축하드려요!'],
        ['10-12 11:58', '이웃 새글', '책읽는밤', LINK('가을에 읽기 좋은 에세이'), '두 번째 책 문장이 오래 남네요. 장바구니에 담아 둘게요 📚']] },
    { name: '내 글 대댓글', cols: [['시간', 1], ['닉네임', 0], ['받은 댓글', 1], ['내 대댓글', 1], ['서이추', 0]],
      rows: [['10-12 12:06', '달리는김대리', '저도 성수동 자주 가는데 웨이팅 팁 좋네요', '평일 오후 3시쯤이 가장 한산했어요. 다음에 꼭 써 보세요!', OK('신청 완료')],
        ['10-12 11:12', '요리하는엄마', '사진이 너무 예뻐요~', '자연광 들어오는 창가에서 찍었어요. 칭찬 감사해요 😊', '이미 서로이웃'],
        ['10-11 21:40', '제주한달살이', '잘 보고 갑니다', WAIT('같은 댓글 반복 · 건너뜀'), '']] },
    { name: '이웃 관리', cols: [['시간', 1], ['작업', 1], ['닉네임', 1], ['사유', 0]],
      rows: [['10-12 12:05', OK('받은 신청 수락'), '책읽는밤', '최근 7일 새 글 5개 · 진성 블로거'],
        ['10-12 12:05', NO('받은 신청 거절'), '대출상담센터', '광고성 블로그'],
        ['10-11 09:10', WAIT('보낸 신청 회수'), '여행가는곰', '14일 동안 수락하지 않은 신청'],
        ['10-11 09:12', WAIT('비활성 이웃 정리'), '옛날블로그', '120일 동안 새 글 없음']] },
    { name: '방문 전체', cols: [['시간', 1], ['닉네임', 0], ['글 제목', 1], ['공감', 1], ['댓글', 1], ['처리 결과', 0]],
      rows: [['10-12 12:58', '재테크노트', LINK('예금 특판 금리 비교'), 'O', '', '공감 완료 · 글과 맞는 댓글을 못 써서 건너뜀'],
        ['10-12 12:57', '요리하는엄마', LINK('10분 완성 가지덮밥'), 'O', 'O', '공감 및 댓글 작성 완료'],
        ['10-12 12:49', '오늘의특가', LINK('최저가 모음전'), '', '', '광고 글이라 건너뜀']] },
    { name: '자율 주행 회차', cols: [['회차', 1], ['시작', 1], ['걸린 시간', 0], ['이웃 관리', 0], ['이웃 새글', 1]],
      rows: [['25', '10-12 12:05', '53분', '수락 3 · 거절 0', '공감 26 · 댓글 21'],
        ['24', '10-12 10:13', '49분', '새로 받은 신청 없음', '공감 24 · 댓글 19'],
        ['23', '10-12 08:30', '55분', '수락 2 · 회수 30', '공감 22 · 댓글 18']] }
  ];

  const render = (root) => {
    const start = Math.max(0, SHEETS.findIndex((s) => s.name === root.dataset.sheetMock));
    root.classList.add('xl');
    root.innerHTML = `
      <div class="frame-bar"><i></i><i></i><i></i><span>이웃메이트_활동기록_최근7일.xlsx</span></div>
      <div class="xl-body"><table class="xl-table"></table></div>
      <div class="xl-tabs" role="tablist" aria-label="시트">${SHEETS.map((s, i) => `<button type="button" role="tab" data-i="${i}">${s.name}</button>`).join('')}</div>`;
    const table = root.querySelector('table');
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const show = (index) => {
      const sheet = SHEETS[index];
      // Short values stay on one line like spreadsheet cells; long text (comments, titles) wraps.
      const cls = (col, value = '') => {
        const names = [col[1] ? '' : 'opt', String(value).replace(/<[^>]+>/g, '').length > 14 ? 'long' : ''].filter(Boolean);
        return names.length ? ` class="${names.join(' ')}"` : '';
      };
      table.innerHTML = `<thead><tr><th class="rn"></th>${sheet.cols.map((c) => `<th${cls(c)}>${c[0]}</th>`).join('')}</tr></thead>`
        + `<tbody>${sheet.rows.map((row, r) => `<tr><td class="rn">${r + 2}</td>${row.map((v, i) => `<td${cls(sheet.cols[i], v)}>${v}</td>`).join('')}</tr>`).join('')}</tbody>`;
      tabs.forEach((tab, i) => tab.setAttribute('aria-selected', String(i === index)));
    };
    tabs.forEach((tab) => tab.addEventListener('click', () => show(Number(tab.dataset.i))));
    show(start);
  };
  document.querySelectorAll('[data-sheet-mock]').forEach(render);
})();
