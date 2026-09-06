/*
  EKSİK ELEMAN TARAYICISI

  getElementById("X") ile aranan her id sayfada gerçekten var mı?
  Yoksa null döner ve .textContent / .innerHTML ataması
  "Cannot set properties of null" ile patlar.

  Bu koşum gerçek bir üretim hatasını yakalamak için yazıldı:
  renderOverview() markup'ta hiç olmayan 5 elemana yazıyordu
  (sumViews, sumQR, sumNFC, sumPhone, sumWA). İlk atamada patlıyor,
  arkasından çağrılan renderBusinesses() hiç çalışmıyordu — yani
  admin panelinde İŞLETME LİSTESİ HİÇ DOLMUYORDU.

  Salt okuma amaçlı ve korumalı (if(el)) kullanımlar sorun değil;
  bu koşum yalnızca YAZMA işlemlerini hata sayar.
*/
const fs = require('fs');
const path = require('path');
const { makeChecker } = require('./helpers');

const PUB = path.join(__dirname, '..', 'public');
const files = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));
const { check, finish } = makeChecker();

let totalWrites = 0;

for (const f of files) {
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');

  const defined = new Set();
  for (const m of src.matchAll(/\bid\s*=\s*["']([^"'${}]+)["']/g)) defined.add(m[1]);

  /* şablonla üretilen id önekleri: id="q_${x}" -> "q_" */
  const dynamicPrefixes = [];
  for (const m of src.matchAll(/\bid\s*=\s*["']([^"']*)\$\{[^}]*\}[^"']*["']/g)) {
    if (m[1]) dynamicPrefixes.push(m[1]);
  }

  const badWrites = [];
  for (const m of src.matchAll(/getElementById\(\s*["']([^"'${}]+)["']\s*\)/g)) {
    const id = m[1];
    if (defined.has(id)) continue;
    if (dynamicPrefixes.some(p => id.startsWith(p))) continue;

    /* yalnızca doğrudan YAZMA hata sayılır */
    const after = src.slice(m.index, m.index + 120).replace(/\s+/g, ' ');
    if (/\)\s*\.(textContent|innerHTML|value|src|href|className)\s*=/.test(after)) {
      badWrites.push(`${id} (satır ${src.slice(0, m.index).split('\n').length})`);
    }
  }

  totalWrites += badWrites.length;
  check(`${f} — olmayan elemana yazma yok`,
    badWrites.length === 0,
    badWrites.length ? badWrites.slice(0, 3).join(', ') : `${defined.size} id tanımlı`);
}

/* Bu beş id bir daha geri gelmemeli */
const admin = fs.readFileSync(path.join(PUB, 'admin.html'), 'utf8');
for (const dead of ['sumViews', 'sumQR', 'sumNFC', 'sumPhone', 'sumWA']) {
  check(`admin.html artık #${dead} kullanmıyor`,
    !new RegExp(`getElementById\\(["']${dead}["']\\)`).test(admin), '');
}

/* loadAll adımları ayrı ayrı korunuyor mu */
/* Her ikisi de KENDI try blogunda olmali; ortak try'da biri
   patlayinca digeri hic calismiyordu. Metnin birebir esitligine
   degil, ayri sarmalanmis olmalarina bakiliyor. */
check('loadAll adımları birbirini engellemiyor',
  /try\s*\{\s*renderOverview\(\)[\s\S]{0,80}?\}\s*catch/.test(admin) &&
  /try\s*\{\s*renderBusinesses\(\)[\s\S]{0,80}?\}\s*catch/.test(admin), '');
check('Güvenli setText yardımcısı var',
  /function setText\(id,value\)/.test(admin), '');

process.exit(finish() ? 1 : 0);
