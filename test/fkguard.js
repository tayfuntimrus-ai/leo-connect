/*
  events.business_id foreign key akisi.

  EN KRITIK KONTROL: kisit eklenemese BILE sunucu acilmali.
  initDatabase() hata firlatirsa surec kapanir ve site tamamen duser;
  oksuz kayit temizligi bunu goze alacak kadar kritik degil.
*/
const { spawn } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..');
const PRELOAD = path.join(__dirname, 'preload-pg.js');

function boot(scenario) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--require', PRELOAD, path.join(REPO, 'server.js')], {
      cwd: REPO,
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://t:t@localhost:5432/t',
        JWT_SECRET: 'f'.repeat(64),
        ADMIN_EMAIL: 'a@test.local',
        ADMIN_PASSWORD: 'p',
        PORT: String(4700 + Math.floor(Math.random() * 60)),
        NODE_ENV: 'development',
        TEST_SCENARIO: scenario
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { child.kill(); resolve({ code: 'CALISIYOR', out }); }, 2500);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, out }); });
  });
}

const { makeChecker } = require('./helpers');
const { check, finish } = makeChecker();
const started = r => r.code === 'CALISIYOR' && /çalışıyor/i.test(r.out);

(async () => {
  const clean = await boot('temiz');
  check('Temiz tabloda kisit ekleniyor',
    started(clean) && /foreign key eklendi/.test(clean.out), `exit=${clean.code}`);

  const orphan = await boot('oksuz-var');
  check('Oksuz kayit once temizleniyor',
    started(orphan) && /137 öksüz kayıt bulundu/.test(orphan.out) &&
    /137 öksüz kayıt silindi/.test(orphan.out), '');
  check('Temizlik sonrasi kisit ekleniyor',
    started(orphan) && /foreign key eklendi/.test(orphan.out), '');

  const exists = await boot('kisit-zaten-var');
  check('Kisit zaten varsa tekrar eklenmiyor',
    started(exists) && !/foreign key eklendi/.test(exists.out), '');

  const alterFail = await boot('alter-patlar');
  check('ALTER PATLASA BILE sunucu aciliyor', started(alterFail), `exit=${alterFail.code}`);
  check('ALTER hatasi loglaniyor',
    /foreign key eklenemedi/.test(alterFail.out) && /permission denied/.test(alterFail.out), '');

  const deleteFail = await boot('delete-patlar');
  check('DELETE patlasa bile sunucu aciliyor', started(deleteFail), `exit=${deleteFail.code}`);

  process.exit(finish() ? 1 : 0);
})();
