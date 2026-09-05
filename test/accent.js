/*
  ISLETMEYE OZEL VURGU RENGI

  Musteri profil sayfasindaki vurgu rengi isletme basina secilebilir.
  Varsayilan Leo Connect marka amberi (#EF9F27).

  Kritik noktalar:
   - Deger CSS'e yaziliyor; sunucuda dogrulanmali (enjeksiyon)
   - Isletme ACIK bir renk secerse uzerindeki yazi koyu olmali
   - "Leo Connect ile calisiyor" imzasi isletme rengine BAGLI OLMAMALI
*/
const fs = require('fs');
const path = require('path');
const { SERVER, stubPg, setEnv, request, makeChecker, token } = require('./helpers');

const PORT = 4655;
setEnv(PORT);

const PUB = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');

const BRAND = '#EF9F27';
let lastWrite = null;

stubPg((text, params) => {
  const q = String(text).replace(/\s+/g, ' ').trim();
  if (/^(CREATE|ALTER|DROP)/i.test(q)) return { rows: [] };
  if (/^UPDATE profile_designs/i.test(q)) return { rows: [], rowCount: 0 };
  if (/^SELECT 1$/i.test(q)) return { rows: [{}] };
  if (/FROM pg_constraint/i.test(q)) return { rows: [{}] };
  if (/^DELETE/i.test(q)) return { rows: [] };
  if (/SELECT dashboard_profile/i.test(q))
    return { rows: [{ dashboard_profile: true, dashboard_qr: true, dashboard_nfc: true,
                      dashboard_analytics: true, dashboard_live: true, dashboard_ai: true,
                      dashboard_review: true, dashboard_campaign: true }] };
  if (/INSERT INTO profile_designs/i.test(q)) {
    lastWrite = params;
    const accent = (params || []).find(p => typeof p === 'string' && /^#[0-9A-F]{6}$/i.test(p));
    return { rows: [{ theme: 'midnight-gold', accent_color: accent || BRAND }] };
  }
  return { rows: [{ id: 42, theme: 'midnight-gold', accent_color: BRAND,
                    profile_theme_permission: true, social_links: {}, custom_links: [],
                    social_platform_permissions: {} }] };
});

require(SERVER);

const { check, finish } = makeChecker();
const biz = token('business', { id: 42, email: 'b@test.local' });
const put = (p, body) => request(PORT, 'PUT', p, {
  headers: { Authorization: 'Bearer ' + biz }, body
});

setTimeout(async () => {
  /* ---- 1. sunucu dogrulamasi ---- */
  const valid = await put('/api/business-theme',
    { theme: 'midnight-gold', accent_color: '#3366FF' });
  check('Gecerli hex kabul ediliyor',
    valid.status === 200 && /#3366FF/i.test(JSON.stringify(valid.json || {})),
    valid.json ? valid.json.accent_color : `status ${valid.status}`);

  const injection = await put('/api/business-theme',
    { theme: 'midnight-gold', accent_color: 'red;} body{display:none' });
  check('CSS enjeksiyonu reddediliyor, markaya dusuyor',
    injection.status === 200 && injection.json?.accent_color === BRAND,
    injection.json ? injection.json.accent_color : '');

  const empty = await put('/api/business-theme', { theme: 'midnight-gold', accent_color: '' });
  check('Bos deger markaya dusuyor', empty.json?.accent_color === BRAND, empty.json?.accent_color);

  const short = await put('/api/business-theme', { theme: 'midnight-gold', accent_color: '#f0a' });
  check('3 haneli hex 6 haneye genisletiliyor', short.json?.accent_color === '#FF00AA',
    short.json?.accent_color);

  /* ---- 2. varsayilan marka amberi ---- */
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('Kolon varsayilani marka amberi',
    /accent_color TEXT NOT NULL DEFAULT '#EF9F27'/.test(srv), '');
  check('Eski varsayilan icin tasima kodu var',
    /LEGACY_DEFAULT_ACCENT/.test(srv) && /UPDATE profile_designs/.test(srv), '');

  /* ---- 3. panelde renk secici ---- */
  const dash = read('dashboard.html');
  check('Panelde renk secici var',
    /id="design_accent_color"[^>]*type="color"/.test(dash), '');
  check('Secici kaydetme payload\'ina bagli',
    /accent_color:\s*normalizeAccent\(document\.getElementById\('design_accent_color'\)/.test(dash), '');
  check('Secici yukleme sirasinda dolduruluyor',
    /setAccentField\(profileContentState\.accent_color\)/.test(dash), '');
  check('Markaya don butonu var', /id="design_accent_reset"/.test(dash), '');

  /* ---- 4. musteri sayfasi ---- */
  const prof = read('profile.html');
  check('Siparis Ver butonu vurgu rengini kullaniyor',
    /#utilityOrder\{[^}]*var\(--lc-gold\)/.test(prof), '');
  check('One cikan blok vurgu rengini kullaniyor',
    /#dynamicFeatured\{[^}]*var\(--lc-gold\)/.test(prof), '');
  check('Eksik one-cikan butonu markup\'a eklendi',
    /id="dynamicFeaturedButton"/.test(prof), '');
  check('Vurgu uzerindeki metin rengi hesaplaniyor',
    /--lc-on-accent/.test(prof) && /relLuminance/.test(prof), '');
  /* "color-mix(in srgb,...)" gercek kullanimdir; yorum icinde gecen
     "color-mix()" ifadesi degil. Desen ona gore daraltildi. */
  check('color-mix kullanilmiyor (eski mobil destegi)',
    !/color-mix\(\s*in\s/i.test(prof), '');

  /* ---- 5. sabit imza ---- */
  check('Leo Connect imzasi var', /Leo Connect ile çalışıyor/.test(prof), '');
  const sigBlock = (prof.match(/\.leo-signature[^{]*\{[^}]*\}/g) || []).join(' ')
                 + (prof.match(/\.leo-signature::[a-z]+\{[^}]*\}/g) || []).join(' ');
  check('Imza SABIT marka rengini kullaniyor',
    sigBlock.includes('var(--leo-brand)'), '');
  check('Imza isletme rengine BAGLI DEGIL',
    !sigBlock.includes('--lc-gold'), '');
  check('Sabit marka degiskeni tanimli',
    /--leo-brand:\s*#EF9F27/i.test(prof), '');

  process.exit(finish() ? 1 : 0);
}, 1200);
