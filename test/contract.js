/*
  FRONTEND <-> BACKEND SOZLESME TARAYICISI

  Bu kosum en cok is goreni: iki gercek uretim hatasi tam olarak bu
  siniftandi. Sunucu baslatmaz, yalnizca kaynak dosyalari karsilastirir.

    A) Frontend'in cagirdigi ama server.js'de kayitli OLMAYAN yollar
       (masa QR gorselleri boyle kirilmisti)
    B) Frontend'in gonderdigi ama EVENT_TYPES'ta olmayan event tipleri
       (dort tiklama boyle sessizce kayboluyordu)
    C) Gecerli tip ama dashboard'da etiketi yok  -> ham tip adi gorunur
    D) Etiketi var ama gecerli tip degil          -> olu etiket
*/
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
const pubDir = path.join(REPO, 'public');
const pages = fs.readdirSync(pubDir).filter(f => f.endsWith('.html'));

/* --- kayitli route'lar --- */
const routes = new Set();
const routeRe = /app\.(get|post|put|patch|delete|use)\s*\(\s*(?:\r?\n\s*)?['"`]([^'"`]+)['"`]/g;
let m;
while ((m = routeRe.exec(server))) routes.add(m[2]);

const routePatterns = [...routes].map(r => ({
  route: r,
  re: new RegExp('^' + r.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+/g, '[^/]+') + '$')
}));

function isServed(rawUrl) {
  const url = rawUrl.split('?')[0];
  /* sondaki egik cizgi = JS string birlestirme oneki ('/api/x/' + id) */
  if (rawUrl.endsWith('/')) {
    return routePatterns.some(p => (p.route + '/').startsWith(url) || p.route.startsWith(url));
  }
  const clean = url.replace(/\/+$/, '') || '/';
  return routePatterns.some(p => p.re.test(clean) || clean.startsWith(p.route + '/'));
}

/* --- gecerli event tipleri --- */
const atMatch = server.match(/const EVENT_TYPES\s*=\s*\[([\s\S]*?)\n\];/);
const allowedTypes = new Set(
  (atMatch ? atMatch[1] : '').match(/'([^']+)'/g)?.map(s => s.slice(1, -1)) || []
);

/* --- dashboard etiket haritasi --- */
const dash = fs.readFileSync(path.join(pubDir, 'dashboard.html'), 'utf8');
const fmt = dash.match(/function formatEventType\(type\)\{\s*const events=\{([\s\S]*?)\n\s*\};/);
const labelled = new Set(
  [...(fmt ? fmt[1] : '').matchAll(/["']?([a-z_0-9-]+)["']?\s*:\s*\{\s*icon/g)].map(x => x[1])
);

/* --- tara --- */
const missingRoutes = [];
const missingTypes = [];

for (const page of pages) {
  const src = fs.readFileSync(path.join(pubDir, page), 'utf8');

  const urlRe = /['"`](\/(?:api|qr|p)\/[A-Za-z0-9_\-./:{}$+]*)['"`]/g;
  const seen = new Set();
  let u;
  while ((u = urlRe.exec(src))) {
    if (seen.has(u[1])) continue;
    seen.add(u[1]);
    const normalized = u[1].replace(/\$\{[^}]*\}/g, 'X');
    if (normalized.includes('${')) continue;
    if (!isServed(normalized)) {
      missingRoutes.push({ page, url: u[1], line: src.slice(0, u.index).split('\n').length });
    }
  }

  const trackRe = /track\(\s*['"]([a-z_0-9-]+)['"]\s*\)/g;
  const seenT = new Set();
  let t;
  while ((t = trackRe.exec(src))) {
    if (seenT.has(t[1])) continue;
    seenT.add(t[1]);
    if (!allowedTypes.has(t[1])) {
      missingTypes.push({ page, type: t[1], line: src.slice(0, t.index).split('\n').length });
    }
  }
}

const unlabelled = [...allowedTypes].filter(t => !labelled.has(t));
const deadLabels = [...labelled].filter(t => !allowedTypes.has(t));

function report(title, rows, fmtRow) {
  console.log(`  ${title}`);
  if (!rows.length) console.log('    (temiz)');
  for (const r of rows) console.log('    ' + fmtRow(r));
}

if (!allowedTypes.size) {
  console.log('  KALDI  EVENT_TYPES bulunamadi — tarama anlamsiz');
  process.exit(1);
}

report('A) Frontend cagiriyor ama server.js\'de yok:', missingRoutes,
  r => `${r.page}:${r.line}  ${r.url}`);
report('B) Frontend gonderiyor ama gecerli tip degil:', missingTypes,
  r => `${r.page}:${r.line}  track("${r.type}") -> 400, kaydedilmez`);
report('C) Gecerli tip ama dashboard etiketi yok:', unlabelled, t => t);
report('D) Etiketi var ama gecerli tip degil:', deadLabels, t => t);

const problems = missingRoutes.length + missingTypes.length + unlabelled.length + deadLabels.length;
console.log(`  ${routes.size} route · ${allowedTypes.size} event tipi · ${pages.length} sayfa`);
console.log(problems === 0
  ? '  GECTI  sozlesme tutarli\n'
  : `  KALDI  ${problems} sorun\n`);

process.exit(problems ? 1 : 0);
