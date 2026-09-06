/*
  MENU VE SIPARIS ALTYAPISI

  Kritik noktalar:
   - Fiyat SUNUCUDAN okunmali; musteri fiyati belirleyememeli
   - Konum dogrulamasi sunucuda; tarayici verisi sahtelenebilir
   - Isletme koordinat girmediyse siparis yine de calismali
   - Siparis modulu izne bagli (dashboard_orders)
   - Durum gecisleri kurallara uymali
*/
const { SERVER, stubPg, setEnv, request, makeChecker, token } = require('./helpers');

const PORT = 4666;
setEnv(PORT);

const MENU = [
  { id: 11, name: 'Türk Kahvesi', price: '35.00' },
  { id: 12, name: 'Cheesecake',   price: '120.50' }
];

/* Isletme ayarlari testler arasinda degistirilir */
let BIZ = { id: 42, slug: 'test-cafe', name: 'Test Cafe', dashboard_orders: true,
            lat: null, lng: null, order_radius_meters: 150, currency: 'TRY' };
let ORDER_ROWS = [];
let ORDER_ITEM_ROWS = [];
let orderSeq = 500;
let lastOrderTotal = null;
let currentStatus = 'new';

stubPg((text, params) => {
  const q = String(text).replace(/\s+/g, ' ').trim();

  if (/^(CREATE|ALTER|DROP)/i.test(q)) return { rows: [] };
  if (/^UPDATE profile_designs/i.test(q)) return { rows: [], rowCount: 0 };
  if (/^SELECT 1$/i.test(q)) return { rows: [{}] };
  if (/FROM pg_constraint/i.test(q)) return { rows: [{}] };
  if (/^DELETE FROM events/i.test(q)) return { rows: [] };

  if (/SELECT dashboard_profile/i.test(q))
    return { rows: [{ dashboard_profile: true, dashboard_qr: true, dashboard_nfc: true,
                      dashboard_analytics: true, dashboard_live: true, dashboard_ai: true,
                      dashboard_review: true, dashboard_campaign: true,
                      dashboard_orders: BIZ.dashboard_orders }] };

  if (/FROM businesses WHERE slug/i.test(q)) return { rows: [BIZ] };

  if (/FROM menu_items WHERE business_id=\$1 AND is_available=TRUE AND id = ANY/i.test(q)) {
    const ids = params[1] || [];
    return { rows: MENU.filter(m => ids.includes(m.id)) };
  }
  if (/FROM menu_categories/i.test(q)) return { rows: [] };
  if (/FROM menu_items/i.test(q)) return { rows: MENU.map(m => ({ ...m, business_id: 42, is_available: true })) };

  if (/FROM nfc_tags WHERE code/i.test(q)) return { rows: [{ id: 7 }] };

  if (/INSERT INTO orders/i.test(q)) {
    lastOrderTotal = Number(params[4]);
    const row = { id: ++orderSeq, business_id: 42, nfc_tag_id: params[1], status: 'new',
                  table_label: params[2], customer_note: params[3], total: params[4],
                  customer_lat: params[5], customer_lng: params[6], distance_meters: params[7],
                  created_at: new Date(), updated_at: new Date() };
    ORDER_ROWS.unshift(row);
    return { rows: [row] };
  }
  if (/INSERT INTO order_items/i.test(q)) {
    ORDER_ITEM_ROWS.push({ id: ORDER_ITEM_ROWS.length + 1, order_id: params[0],
      menu_item_id: params[1], name_snapshot: params[2], unit_price: params[3],
      quantity: params[4], note: params[5] });
    return { rows: [] };
  }
  if (/INSERT INTO events/i.test(q)) return { rows: [] };

  if (/SELECT status FROM orders/i.test(q)) return { rows: [{ status: currentStatus }] };
  if (/^UPDATE orders SET status/i.test(q)) {
    currentStatus = params[0];
    return { rows: [{ id: params[1], status: params[0], total: 0, created_at: new Date(), updated_at: new Date() }] };
  }
  if (/FROM orders o/i.test(q)) return { rows: ORDER_ROWS };
  if (/FROM order_items WHERE order_id/i.test(q)) return { rows: ORDER_ITEM_ROWS };
  if (/COUNT\(\*\) FILTER \(WHERE created_at >= CURRENT_DATE\)/i.test(q))
    return { rows: [{ today_count: 3, today_revenue: 410.5, open_count: 2 }] };
  if (/active_tags/i.test(q)) return { rows: [{ active_tags: 4 }] };

  return { rows: [] };
});

require(SERVER);

const { check, finish } = makeChecker();
const biz = token('business', { id: 42, email: 'b@test.local' });
const authH = { Authorization: 'Bearer ' + biz };
const post = (p, body, h) => request(PORT, 'POST', p, { body, headers: h || {} });
const get  = (p, h) => request(PORT, 'GET', p, { headers: h || {} });
const put  = (p, body, h) => request(PORT, 'PUT', p, { body, headers: h || {} });

setTimeout(async () => {
  /* ---- 1. FIYAT MANIPULASYONU ---- */
  const cheat = await post('/api/orders/test-cafe', {
    items: [{ menu_item_id: 11, quantity: 2, price: 0.01, unit_price: 0.01 }],
    total: 0.02
  });
  check('Siparis olusturuluyor', cheat.status === 200, `status ${cheat.status}`);
  check('Musterinin gonderdigi FIYAT yok sayiliyor',
    lastOrderTotal === 70, `sunucu toplami: ${lastOrderTotal} (2 x 35 = 70 beklenir)`);
  check('Musterinin gonderdigi TOPLAM yok sayiliyor',
    cheat.json?.order?.total === 70, `donen toplam: ${cheat.json?.order?.total}`);

  /* ---- 2. urun adi ve fiyati kopyalaniyor ---- */
  const line = cheat.json?.order?.items?.[0];
  check('Urun adi siparise kopyalaniyor', line?.name === 'Türk Kahvesi', line?.name);
  check('Birim fiyat siparise kopyalaniyor', line?.unit_price === 35, String(line?.unit_price));

  /* ---- 3. miktar sinirlari ---- */
  const qty = await post('/api/orders/test-cafe', {
    items: [{ menu_item_id: 12, quantity: 5000 }]
  });
  check('Asiri miktar 99 ile sinirlaniyor',
    qty.json?.order?.items?.[0]?.quantity === 99, String(qty.json?.order?.items?.[0]?.quantity));

  /* ---- 4. gecersiz urun ---- */
  const bogus = await post('/api/orders/test-cafe', { items: [{ menu_item_id: 9999, quantity: 1 }] });
  check('Var olmayan urun reddediliyor', bogus.status === 400, `status ${bogus.status}`);

  const emptyOrder = await post('/api/orders/test-cafe', { items: [] });
  check('Bos siparis reddediliyor', emptyOrder.status === 400, `status ${emptyOrder.status}`);

  /* ---- 5. KONUM DOGRULAMASI ---- */
  BIZ.lat = 41.0082; BIZ.lng = 28.9784; BIZ.order_radius_meters = 150;

  const noLoc = await post('/api/orders/test-cafe', { items: [{ menu_item_id: 11, quantity: 1 }] });
  check('Konum zorunluyken konumsuz siparis reddediliyor',
    noLoc.status === 400 && noLoc.json?.location_required === true, `status ${noLoc.status}`);

  const farAway = await post('/api/orders/test-cafe', {
    items: [{ menu_item_id: 11, quantity: 1 }], lat: 39.9334, lng: 32.8597   // Ankara
  });
  check('Uzaktaki musteri reddediliyor',
    farAway.status === 403 && farAway.json?.distance_meters > 150,
    `${farAway.json?.distance_meters} m`);

  const nearby = await post('/api/orders/test-cafe', {
    items: [{ menu_item_id: 11, quantity: 1 }], lat: 41.0083, lng: 28.9785
  });
  check('Yakindaki musteri kabul ediliyor',
    nearby.status === 200, `status ${nearby.status}, mesafe ${nearby.json?.order?.distance_meters} m`);

  /* isletme koordinat girmediyse kontrol devre disi kalmali */
  BIZ.lat = null; BIZ.lng = null;
  const noGeo = await post('/api/orders/test-cafe', { items: [{ menu_item_id: 11, quantity: 1 }] });
  check('Koordinat girilmemisse siparis yine calisiyor',
    noGeo.status === 200, `status ${noGeo.status}`);

  /* ---- 6. IZIN KONTROLU ---- */
  BIZ.dashboard_orders = false;
  const closed = await post('/api/orders/test-cafe', { items: [{ menu_item_id: 11, quantity: 1 }] });
  check('Siparis kapaliyken musteri siparis veremiyor', closed.status === 403, `status ${closed.status}`);

  const closedMenu = await get('/api/public-menu/test-cafe');
  check('Siparis kapaliyken public menu 403',
    closedMenu.status === 403 && closedMenu.json?.orders_enabled === false, `status ${closedMenu.status}`);

  const closedPanel = await get('/api/orders', authH);
  check('Izin yokken isletme paneli 403', closedPanel.status === 403, `status ${closedPanel.status}`);

  BIZ.dashboard_orders = true;
  const openMenu = await get('/api/public-menu/test-cafe');
  check('Izin acikken public menu 200',
    openMenu.status === 200 && openMenu.json?.orders_enabled === true, `status ${openMenu.status}`);

  /* ---- 7. DURUM GECISLERI ---- */
  currentStatus = 'new';
  const ok1 = await put('/api/orders/500/status', { status: 'preparing' }, authH);
  check('new -> preparing gecerli', ok1.status === 200, `status ${ok1.status}`);

  currentStatus = 'delivered';
  const bad = await put('/api/orders/500/status', { status: 'preparing' }, authH);
  check('delivered -> preparing engelleniyor', bad.status === 409, `status ${bad.status}`);

  currentStatus = 'new';
  const badName = await put('/api/orders/500/status', { status: 'hazir_mi_acaba' }, authH);
  check('Gecersiz durum adi reddediliyor', badName.status === 400, `status ${badName.status}`);

  /* ---- 8. yetkisiz erisim ---- */
  const noAuth = await get('/api/orders');
  check('Yetkisiz siparis listesi 401', noAuth.status === 401, `status ${noAuth.status}`);

  const noAuthMenu = await get('/api/menu-items');
  check('Yetkisiz menu yonetimi 401', noAuthMenu.status === 401, `status ${noAuthMenu.status}`);

  /* ---- 9. ozet ---- */
  const sum = await get('/api/orders-summary', authH);
  check('Ozet bugunku sayi ve ciroyu donuyor',
    sum.status === 200 && sum.json?.today_count === 3 && sum.json?.today_revenue === 410.5,
    `${sum.json?.today_count} siparis / ${sum.json?.today_revenue} TL`);
  check('Ozet aktif etiket sayisini donuyor', sum.json?.active_tags === 4, String(sum.json?.active_tags));

  process.exit(finish() ? 1 : 0);
}, 1200);
