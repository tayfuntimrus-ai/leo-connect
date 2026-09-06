/*
  DASHBOARD YAPISI

  Sunucu baslatmaz; dashboard.html'in yapisini dogrular.
  Amac: menu, gorunum ve JS baglantilarinin birbirini tutmasi.
*/
const fs = require('fs');
const path = require('path');
const { makeChecker } = require('./helpers');

const PUB = path.join(__dirname, '..', 'public');
const dash = fs.readFileSync(path.join(PUB, 'dashboard.html'), 'utf8');
const { check, finish } = makeChecker();

/* Onaylanan menu duzeni */
const NAV = ['overview', 'orders', 'digital', 'stats', 'menu', 'connections', 'campaigns', 'profile'];

/* ---- 1. menu ogeleri ---- */
const missingNav = NAV.filter(k => !new RegExp(`data-bc="${k}"`).test(dash));
check('Tum menu ogeleri var', missingNav.length === 0,
  missingNav.length ? missingNav.join(', ') : NAV.length + ' oge');

check('Siparisler menude', /data-bc="orders"[^>]*>[\s\S]{0,120}Siparişler/.test(dash), '');
check('Menu menude', /data-bc="menu"[^>]*>[\s\S]{0,120}Menü/.test(dash), '');
check('QR ve NFC olarak adlandirilmis', /<span>QR ve NFC<\/span>/.test(dash), '');
check('Raporlar olarak adlandirilmis', /<span>Raporlar<\/span>/.test(dash), '');
check('Ayarlar olarak adlandirilmis', /<span>Ayarlar<\/span>/.test(dash), '');
check('Dijital Kanallar KENDI basligi olarak duruyor',
  /data-bc="connections"[^>]*>[\s\S]{0,140}Dijital Kanallar/.test(dash), '');

/* ---- 2. mobil menu de ayni ---- */
const mobile = (dash.match(/<div class="bc-mobile-nav">[\s\S]*?<\/div>/) || [''])[0];
const missingMobile = NAV.filter(k => k !== 'campaigns' && !mobile.includes(`data-bc="${k}"`));
check('Mobil menu masaustuyle uyumlu', missingMobile.length === 0,
  missingMobile.length ? 'eksik: ' + missingMobile.join(', ') : '');

/* ---- 3. gorunum konteynerleri ---- */
['orders', 'menu'].forEach(v => {
  check(`"${v}" gorunum konteyneri var`, new RegExp(`data-view="${v}"`).test(dash), '');
});

/* ---- 4. view map ---- */
const mapLine = (dash.match(/const map=\{[^;]*\};/) || [''])[0];
const missingMap = ['orders', 'menu'].filter(k => !mapLine.includes(k + ':{'));
check('Yeni gorunumler view map\'te', missingMap.length === 0,
  missingMap.length ? missingMap.join(', ') : '');
check('Basliklar guncellenmis',
  mapLine.includes("title:'Raporlar'") && mapLine.includes("title:'Ayarlar'") &&
  mapLine.includes("title:'QR ve NFC'"), '');

/* ---- 5. Genel Bakis icerigi ---- */
check('4 ozet kart var', (dash.match(/class="bc-sum-card/g) || []).length === 4,
  String((dash.match(/class="bc-sum-card/g) || []).length));
check('Hizli erisim basligi var', /Hızlı erişim/.test(dash), '');
check('4 hizli erisim karti var', (dash.match(/class="bc-quick"/g) || []).length === 4,
  String((dash.match(/class="bc-quick"/g) || []).length));
check('Son siparisler blogu var', /id="bcRecentOrders"/.test(dash) && /Son siparişler/.test(dash), '');

/* hizli erisim kartlari dogru gorunume gidiyor mu */
['orders', 'digital', 'stats', 'menu'].forEach(v => {
  check(`Hizli erisim "${v}" gorunumune gidiyor`,
    new RegExp(`class="bc-quick" onclick="showBusinessSection\\('${v}'\\)`).test(dash), '');
});

/* ---- 6. JS baglantilari ---- */
['loadOrders', 'loadMenu', 'initOrdersModule', 'updateOrderStatus', 'setOrderFilter'].forEach(fn => {
  check(`${fn}() tanimli`,
    new RegExp(`(window\\.)?${fn}\\s*=\\s*(async\\s*)?function|async function ${fn}\\(|function ${fn}\\(`).test(dash), '');
});
check('Gorunum degisiminde siparis yukleniyor',
  /if\(name==='orders'\)\{try\{loadOrders\(\)/.test(dash), '');
check('Gorunum degisiminde menu yukleniyor',
  /if\(name==='menu'\)\{try\{loadMenu\(\)/.test(dash), '');
check('Acilista modul izni kontrol ediliyor', /initOrdersModule\(\);/.test(dash), '');

/* ---- 7. izin kilidi ---- */
check('Siparis ekrani izne bagli', /id="ordersLocked"/.test(dash) && /setModuleLock/.test(dash), '');
check('Menu ekrani izne bagli', /id="menuLocked"/.test(dash), '');
check('Izin yoksa ozet kartlari gizleniyor',
  /\['bcOrderSummary','bcRecentOrders'\]\.forEach/.test(dash), '');

/* ---- 8. durum gecisleri sunucuyla ayni ---- */
const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const srvT = (srv.match(/const ORDER_TRANSITIONS = \{[\s\S]*?\};/) || [''])[0];
const uiT  = (dash.match(/const ORDER_NEXT=\{[\s\S]*?\};/) || [''])[0];
const pairsMatch = ['new', 'preparing', 'ready', 'delivered', 'cancelled'].every(s =>
  srvT.includes(s) && uiT.includes(s));
check('Durum listesi sunucu ve arayuzde ayni', pairsMatch, '');
check('delivered arayuzde de son durum', /delivered:\[\]/.test(uiT), '');

/* ---- 9. XSS ---- */
check('Siparis icerigi kacisla basiliyor',
  /const esc=v=>String\(v\?\?''\)\.replace/.test(dash) && /esc\(i\.name\)/.test(dash), '');

/* ---- 10. .hidden tanimli ---- */
check('.hidden sinifi tanimli', /\.hidden\{display:none!important\}/.test(dash), '');

process.exit(finish() ? 1 : 0);
