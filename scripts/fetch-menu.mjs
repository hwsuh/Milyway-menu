// MILYWAY 점심 메뉴 수집기 — GitHub Actions에서 실행 (Node 20+, 외부 패키지 없음)
// Eurest 서버에서 한식/Global PDF를 받아 menu-data.json(PDF를 base64로 포함)으로 저장합니다.
// 서버에서 받으므로 브라우저 CORS 제한이 없습니다. 메뉴가 바뀌지 않았으면 파일을 다시 쓰지 않습니다.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const BASE = process.env.MENU_BASE_URL || 'https://eurestcafes.compass-usa.com/Samsung/DiningMenus/';
const MENUS = {
  korean: BASE + 'Milky%20Way%20Korean%20Menu.pdf',
  global: BASE + 'Milky%20Way%20Cafe%20Menu.pdf',
};
const OUT = process.env.MENU_OUT || 'menu-data.json';

const isPdf = b => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
const sha = b => createHash('sha256').update(b).digest('hex');

async function get(url, tries = 3) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (milyway-menu-collector)' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const bytes = Buffer.from(await r.arrayBuffer());
      if (!isPdf(bytes)) throw new Error('응답이 PDF가 아닙니다');
      return { bytes, lastModified: r.headers.get('last-modified') };
    } catch (e) {
      last = e;
      console.warn(`  시도 ${i}/${tries} 실패: ${e.message}`);
      if (i < tries) await new Promise(res => setTimeout(res, 5000 * i));
    }
  }
  throw last;
}

let prev = {};
try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 첫 실행 */ }

const next = { fetchedAt: new Date().toISOString() };
let changed = false, failed = 0;
for (const [kind, url] of Object.entries(MENUS)) {
  console.log(`${kind}: ${url}`);
  try {
    const { bytes, lastModified } = await get(url);
    const hash = sha(bytes);
    const same = prev[kind]?.sha256 === hash;
    next[kind] = same
      ? { ...prev[kind], checkedAt: next.fetchedAt }
      : { pdfBase64: bytes.toString('base64'), sha256: hash, bytes: bytes.length, lastModified, checkedAt: next.fetchedAt };
    if (!same) changed = true;
    console.log(`  OK ${bytes.length} bytes, Last-Modified: ${lastModified || '-'}${same ? ' (변경 없음)' : ' (새 메뉴)'}`);
  } catch (e) {
    failed++;
    console.error(`  실패: ${e.message}`);
    if (prev[kind]) next[kind] = prev[kind]; // 이전 메뉴 유지
  }
}

if (failed === Object.keys(MENUS).length) {
  console.error('두 메뉴 모두 받지 못했습니다 — 기존 파일을 그대로 둡니다.');
  process.exit(1);
}
if (changed) {
  await writeFile(OUT, JSON.stringify(next, null, 1) + '\n');
  console.log(`${OUT} 갱신됨`);
} else {
  console.log('메뉴 변경 없음 — 파일을 다시 쓰지 않습니다.');
}
