/*
  JWT_SECRET korumasi.

  Onceden server.js su satiri iceriyordu:
    const SECRET = process.env.JWT_SECRET || 'leo-connect-change-this-secret'
  Ortam degiskeni yoksa tum token'lar depoda acikta duran sabit anahtarla
  imzalaniyor, o anahtari goren herkes admin token'i uretebiliyordu.
*/
const { spawn } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..');
const PRELOAD = path.join(__dirname, 'preload-pg.js');

function boot(envOverrides = {}) {
  return new Promise(resolve => {
    const env = {
      ...process.env,
      DATABASE_URL: 'postgres://t:t@localhost:5432/t',
      JWT_SECRET: 'j'.repeat(64),
      ADMIN_EMAIL: 'a@test.local',
      ADMIN_PASSWORD: 'p',
      PORT: String(4640 + Math.floor(Math.random() * 50)),
      NODE_ENV: 'development',
      TEST_SCENARIO: 'kisit-zaten-var',
      ...envOverrides
    };
    if (envOverrides.__unset) delete env.JWT_SECRET;

    const child = spawn(process.execPath, ['--require', PRELOAD, path.join(REPO, 'server.js')],
      { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });

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
  const ok = await boot();
  check('JWT_SECRET varken sunucu aciliyor', started(ok), `exit=${ok.code}`);

  const missing = await boot({ __unset: true });
  check('JWT_SECRET yokken sunucu ACILMIYOR', missing.code === 1, `exit=${missing.code}`);
  check('Eksik degisken icin acik hata mesaji',
    /JWT_SECRET tanımlı değil/.test(missing.out),
    missing.out.split('\n').find(l => l.includes('JWT_SECRET')) || '(mesaj yok)');

  const leaked = await boot({ JWT_SECRET: 'leo-connect-change-this-secret' });
  check('Sizmis varsayilan UYARIR ama durdurmaz',
    started(leaked) && /açıkta duran eski varsayılan/.test(leaked.out), `exit=${leaked.code}`);

  const short = await boot({ JWT_SECRET: 'kisa' });
  check('Kisa deger UYARIR ama durdurmaz',
    started(short) && /çok kısa/.test(short.out), `exit=${short.code}`);

  process.exit(finish() ? 1 : 0);
})();
