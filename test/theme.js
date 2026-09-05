/*
  MARKA TEMASI DOGRULAMA

  Tema guncellemesi 400'den fazla renk degeri degistirdi. Bu kosum
  degisimin dogru ve eksiksiz oldugunu, yanlislikla baska bir seyin
  bozulmadigini kontrol eder.
*/
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const PUB = path.join(REPO, 'public');

/* Marka temasinin uygulandigi SABIT arayuz */
const PANELS = ['admin.html','dashboard.html','qr-center.html','nfc-center.html',
                'card-login.html','card-dashboard.html','login.html','register.html'];

/* Musteriye acilan sayfalar — isletmelerin kendi temasi gecerli, DOKUNULMAZ */
const CUSTOMER = ['profile.html','business-card.html','index.html'];

const BRAND = { ground:'#0f1115', accent:'#ef9f27', accentDeep:'#854f0b' };

/* Ucuncu taraf marka renkleri — sosyal ikonlarda korunmali */
const PROTECTED = ['#feda75','#fa7e1e','#d62976','#4f5bd5','#1877f2','#0a66c2',
                   '#25d366','#ea4335','#34a853','#4285f4','#fbbc05','#229ed9','#003b95'];

/* Artik hicbir panelde bulunmamasi gereken eski marka renkleri */
const RETIRED = ['#d4af37','#c59a52','#d7a943','#d6aa55','#e7bb58','#d8ae5a','#e0bd7b',
                 '#f0d77b','#f2c968','#f1d77a','#f0c979','#9e7738','#c59a50',
                 'rgba(212,175,55','rgba(141,229,141'];

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'GECTI' : 'KALDI'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');

/* 1 — brand.css var mi ve marka degerlerini iceriyor mu */
const brand = fs.existsSync(path.join(PUB, 'brand.css')) ? read('brand.css') : '';
check('brand.css mevcut', !!brand, brand ? `${brand.length} bayt` : 'YOK');
check('brand.css marka zeminini tanimliyor', brand.includes(BRAND.ground), BRAND.ground);
check('brand.css imza vurgusunu tanimliyor', brand.includes(BRAND.accent), BRAND.accent);
check('brand.css koyu vurgu tonunu tanimliyor', brand.includes(BRAND.accentDeep), BRAND.accentDeep);

/* 2 — her panel brand.css'i baglamis mi */
const unlinked = PANELS.filter(f => !read(f).includes('href="/brand.css"'));
check('Tum paneller brand.css baglamis', unlinked.length === 0,
  unlinked.length ? unlinked.join(', ') : `${PANELS.length} sayfa`);

/* 3 — eski marka renkleri panellerden temizlenmis mi */
const leftovers = [];
for (const f of PANELS) {
  const src = read(f);
  for (const c of RETIRED) if (src.toLowerCase().includes(c)) leftovers.push(`${f}:${c}`);
}
check('Eski marka renkleri panellerde kalmamis', leftovers.length === 0,
  leftovers.length ? leftovers.slice(0, 4).join('  ') : '');

/* 4 — ucuncu taraf marka renkleri korunmus mu (sosyal ikonlar) */
/* Renkler dosyada buyuk harfle de yazilmis olabilir (#1877F2) */
const dash = read('dashboard.html');
const dashLower = dash.toLowerCase();
const lostBrands = PROTECTED.filter(c => !dashLower.includes(c));
check('Sosyal medya marka renkleri korunmus', lostBrands.length === 0,
  lostBrands.length ? 'KAYIP: ' + lostBrands.join(', ') : `${PROTECTED.length} renk yerinde`);

/* 5 — XSS kacis kodu bozulmamis mi (#039 -> &#039; entity'si) */
const escapers = PANELS.filter(f => read(f).includes('&amp;'));
const brokenEsc = escapers.filter(f => !read(f).includes('&#039;'));
check('XSS kacis entity\'leri bozulmamis', brokenEsc.length === 0,
  brokenEsc.length ? brokenEsc.join(', ') : `${escapers.length} dosyada &#039; yerinde`);

/* 6 — metin icindeki "#001" placeholder'i renk sanilip degistirilmemis mi */
check('NFC placeholder metni bozulmamis', read('nfc-center.html').includes('NFC #001'), '');

/* 7 — musteri sayfalarina DOKUNULMAMIS mi */
const touched = CUSTOMER.filter(f => read(f).includes('/brand.css'));
check('Musteri sayfalari kapsam disinda kalmis', touched.length === 0,
  touched.length ? 'DOKUNULMUS: ' + touched.join(', ') : CUSTOMER.join(', '));

/* 8 — isletmelerin secebildigi temalar hala yerinde mi */
const prof = read('profile.html');
check('Isletme temalari profile.html\'de duruyor',
  prof.includes('#d8ad61') || prof.includes('--gold'), '');

/* 9 — dashboard.html doctype ile basliyor mu (quirks mode hatasi) */
const dashStart = dash.trimStart().slice(0, 15).toLowerCase();
check('dashboard.html <!doctype ile basliyor', dashStart.startsWith('<!doctype'),
  dashStart.startsWith('<!doctype') ? '' : `bulunan: ${dashStart}`);

/* 10 — bosta kalan CSS metni yok mu */
check('doctype oncesi ciplak CSS kalmamis', !dash.trimStart().startsWith('.'), '');

/* 11 — panellerin :root'lari marka token'larini kullaniyor mu */
const tokenUsers = ['admin.html','dashboard.html','qr-center.html','card-login.html','card-dashboard.html'];
const noToken = tokenUsers.filter(f => !read(f).includes('var(--leo-'));
check('Panel :root\'lari marka token\'i kullaniyor', noToken.length === 0,
  noToken.length ? noToken.join(', ') : `${tokenUsers.length} sayfa`);

/* 12 — amber buton uzerinde beyaz metin kalmamis mi (2.17:1 okunmaz) */
const badBtn = [];
for (const f of PANELS) {
  const src = read(f);
  const re = /background:\s*(?:linear-gradient\([^)]*)?#ef9f27[^;}]*;[^}]*color:\s*#(fff|ffffff)\b/gi;
  if (re.test(src)) badBtn.push(f);
}
check('Amber zemin uzerinde beyaz metin yok', badBtn.length === 0,
  badBtn.length ? badBtn.join(', ') : '');

const failed = results.filter(r => !r.pass).length;
console.log(`\n  ${results.length - failed}/${results.length} kontrol gecti\n`);
process.exit(failed ? 1 : 0);
