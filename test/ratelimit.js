/*
  Rate limit.

  EN KRITIK KONTROL: farkli IP'ler ayri kovalara dusmeli.
  app.set('trust proxy', 1) olmadan req.ip her istekte Render proxy'sinin
  adresini dondurur; limitleyici tum ziyaretcileri tek istemci sayar ve
  ilk limiti dolduran kisi butun musterileri disari kilitler.
*/
const { SERVER, stubPg, setEnv, post, makeChecker } = require('./helpers');

const PORT = 4602;
setEnv(PORT);

stubPg(text => {
  const q = String(text).replace(/\s+/g, ' ').trim();
  if (/^(CREATE|ALTER|DELETE|DROP)/i.test(q)) return { rows: [] };
  if (/^SELECT 1$/i.test(q)) return { rows: [{}] };
  if (/FROM pg_constraint/i.test(q)) return { rows: [{}] };
  if (/FROM businesses WHERE email/i.test(q)) return { rows: [] };   // hep basarisiz giris
  if (/FROM businesses WHERE slug/i.test(q)) return { rows: [{ id: 42 }] };
  return { rows: [] };
});

require(SERVER);

const { check, finish } = makeChecker();
const login = (ip, body) => post(PORT, '/api/login', body, { 'X-Forwarded-For': ip });
const adminLogin = (ip, body) => post(PORT, '/api/admin/login', body, { 'X-Forwarded-For': ip });

setTimeout(async () => {
  const WRONG = { email: 'yok@ornek.com', password: 'yanlis' };

  // 1 — ayni IP'den 20 basarisiz deneme
  let firstBlock = null;
  for (let i = 1; i <= 20; i++) {
    const r = await login('203.0.113.10', WRONG);
    if (r.status === 429 && firstBlock === null) firstBlock = i;
  }
  check('Basarisiz girisler 15 denemeden sonra engelleniyor',
    firstBlock === 16, `ilk 429: ${firstBlock}. denemede`);

  // 2 — farkli IP etkilenmemeli
  const other = await login('198.51.100.77', WRONG);
  check('FARKLI IP etkilenmiyor (trust proxy dogru)',
    other.status === 401, `status ${other.status} (401 beklenir)`);

  // 3 — anlasilir hata mesaji
  const blocked = await login('203.0.113.10', WRONG);
  check('429 anlasilir JSON hata donuyor',
    blocked.status === 429 && /15 dakika/.test(blocked.json?.error || ''),
    blocked.json?.error || '');

  // 4 — admin girisi de korunuyor
  let adminBlocked = false;
  for (let i = 1; i <= 17; i++) {
    const r = await adminLogin('203.0.113.99', { email: 'admin@test.local', password: 'yanlis' });
    if (r.status === 429) { adminBlocked = true; break; }
  }
  check('Admin girisi kaba kuvvete karsi korunuyor', adminBlocked, '');

  // 5 — basarili girisler limite sayilmamali
  let ok = 0;
  for (let i = 1; i <= 25; i++) {
    const r = await adminLogin('198.51.100.200',
      { email: 'admin@test.local', password: process.env.ADMIN_PASSWORD });
    if (r.status === 200) ok++;
  }
  check('Basarili girisler limite SAYILMIYOR', ok === 25, `${ok}/25 basarili`);

  // 6 — event ucu normal trafigi engellememeli
  let evOk = 0;
  for (let i = 1; i <= 60; i++) {
    const r = await post(PORT, '/api/event/test-isletme',
      { type: 'google_review', source: 'direct' }, { 'X-Forwarded-For': '203.0.113.55' });
    if (r.status === 200) evOk++;
  }
  check('Event ucu normal trafigi engellemiyor', evOk === 60, `${evOk}/60`);

  process.exit(finish() ? 1 : 0);
}, 1200);
