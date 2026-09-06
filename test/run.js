/*
  Tum kosumlari sirayla calistirir.  Kullanim:  npm test

  Her kosum ayri bir surecte calisir; biri patlarsa digerleri etkilenmez.
  Gercek veritabani GEREKMEZ.
*/
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['contract',  'frontend <-> backend sozlesmesi'],
  ['theme',     'marka temasi butunlugu'],
  ['accent',    'isletmeye ozel vurgu rengi'],
  ['orders',    'menu ve siparis altyapisi'],
  ['dashboard', 'isletme paneli yapisi'],
  ['customer-order', 'musteri siparis ekrani'],
  ['smoke',     'QR gorselleri ve NFC sayaclari'],
  ['jwtguard',  'JWT_SECRET korumasi'],
  ['ratelimit', 'rate limit ve IP ayrimi'],
  ['metrics',   'analitik sorgulari'],
  ['fkguard',   'events foreign key akisi']
];

console.log('\nLEO CONNECT — test kosumlari\n' + '='.repeat(46) + '\n');

const failed = [];
for (const [name, desc] of SUITES) {
  console.log(`> ${name}  (${desc})`);
  const r = spawnSync(process.execPath, [path.join(__dirname, name + '.js')], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  if (r.status !== 0) failed.push(name);
}

console.log('='.repeat(46));
if (failed.length) {
  console.log(`BASARISIZ: ${failed.join(', ')}\n`);
  process.exit(1);
}
console.log(`Tum kosumlar gecti (${SUITES.length}/${SUITES.length})\n`);
