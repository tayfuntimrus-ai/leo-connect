/*
  MÜŞTERİ SİPARİŞ EKRANI

  profile.html'deki sipariş akışını doğrular. Tarayıcı çalıştırmadan,
  kaynak yapısı ve sunucu sözleşmesiyle uyum üzerinden.
*/
const fs = require('fs');
const path = require('path');
const { makeChecker } = require('./helpers');

const PUB = path.join(__dirname, '..', 'public');
const prof = fs.readFileSync(path.join(PUB, 'profile.html'), 'utf8');
const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const { check, finish } = makeChecker();

/* ---- 1. ekran iskeleti ---- */
check('Sipariş ekranı markup\'ta var', /id="orderSheet"/.test(prof), '');
check('Varsayılan olarak gizli', /id="orderSheet"[^>]*\shidden/.test(prof), '');
check('Menü gövdesi var', /id="osheetBody"/.test(prof), '');
check('Toplam ve gönder butonu var',
  /id="orderTotal"/.test(prof) && /id="orderSubmit"/.test(prof), '');
check('Not alanı var', /id="orderNote"/.test(prof), '');
check('Kapatma erişilebilir', /aria-label="Kapat"/.test(prof) && /aria-modal="true"/.test(prof), '');

/* ---- 2. sunucu sözleşmesi ---- */
check('public-menu ucu çağrılıyor', /\/api\/public-menu\//.test(prof), '');
check('sipariş ucu çağrılıyor', /\/api\/orders\/"\s*\+\s*encodeURIComponent\(slug\)/.test(prof), '');
check('Gönderilen alanlar sunucunun beklediğiyle uyumlu',
  /items:\s*\[\.\.\.orderCart\]/.test(prof) && /customer_note:/.test(prof) && /nfc_code:/.test(prof), '');

const srvHasMenu = /app\.get\('\/api\/public-menu\/:slug'/.test(srv);
const srvHasOrder = /app\.post\('\/api\/orders\/:slug'/.test(srv);
check('Sunucuda public-menu ucu kayıtlı', srvHasMenu, '');
check('Sunucuda sipariş ucu kayıtlı', srvHasOrder, '');

/* ---- 3. fiyat güvenliği ---- */
check('İstemci fiyat GÖNDERMİYOR (sadece id ve adet)',
  /map\(\(\[menu_item_id, quantity\]\) => \(\{ menu_item_id, quantity \}\)\)/.test(prof),
  'payload yalnızca menu_item_id + quantity');
check('Sunucu fiyatı menüden okuyor',
  /Istemciden gelen fiyat ve toplam BILEREK yok sayilir/.test(srv), '');

/* ---- 4. konum akışı ---- */
check('Konum yalnızca gerekiyorsa isteniyor',
  /if\(orderMenu\?\.location_required\)\{/.test(prof), '');
check('Konum reddedilirse net mesaj veriliyor',
  /konum izni gerekiyor/i.test(prof), '');
check('Uzaklık mesajı kullanıcıya gösteriliyor',
  /distance_meters != null/.test(prof) && /uzaktasın/.test(prof), '');
check('Geolocation zaman aşımı var', /timeout: 10000/.test(prof), '');

/* ---- 5. modül kapalıyken ---- */
check('403 sessizce ele alınıyor (modül kapalı hata değil)',
  /r\.status === 403/.test(prof), '');
check('Modül kapalıysa harici link davranışı korunuyor',
  /if\(!orderMenu\)\{ return; \}/.test(prof), '');

/* ---- 6. sepet mantığı ---- */
check('Adet 99 ile sınırlı', /if\(next > 99\) next = 99/.test(prof), '');
check('Sıfırlanan ürün sepetten çıkıyor', /orderCart\.delete\(id\)/.test(prof), '');
check('Sepet boşken gönderim kapalı', /btn\.disabled = orderCart\.size === 0/.test(prof), '');

/* ---- 7. XSS ---- */
check('Menü içeriği kaçışla basılıyor',
  /const oEsc = v =>/.test(prof) && /oEsc\(i\.name\)/.test(prof), '');
check('Açıklama da kaçışlı', /oEsc\(i\.description\)/.test(prof), '');

/* ---- 8. event ---- */
check('order_start olayı gönderiliyor', /track\('order_start'\)/.test(prof), '');
const types = (srv.match(/const EVENT_TYPES = \[([\s\S]*?)\n\];/) || ['',''])[1];
check('order_start sunucuda geçerli tip', /'order_start'/.test(types), '');
check('order_submit sunucuda geçerli tip', /'order_submit'/.test(types), '');

/* ---- 9. işletme rengi ---- */
check('Sipariş ekranı işletme vurgu rengini kullanıyor',
  /\.osheet-submit\{[^}]*var\(--lc-gold\)/.test(prof), '');
check('Buton yazısı hesaplanan renkte',
  /\.osheet-submit\{[^}]*var\(--lc-on-accent\)/.test(prof), '');

/* ---- 10. imza etkilenmiyor ---- */
const sig = (prof.match(/\.leo-signature::after\{[^}]*\}/) || [''])[0];
check('Leo Connect imzası hâlâ sabit marka renginde',
  sig.includes('var(--leo-brand)'), '');

process.exit(finish() ? 1 : 0);
