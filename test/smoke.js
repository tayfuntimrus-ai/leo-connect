/*
  Masa/nokta QR gorselleri ve NFC sayaclari.

  Regresyon gecmisi: /qr/nfc/:code.png route'u silindiginde Express
  fallback'i index.html donduruyordu; dashboard <img src> ile PNG
  bekledigi icin gorseller kiriliyor, "QR Indir" ise 200 OK aldigi icin
  hata vermeden ici HTML olan bozuk bir .png indiriyordu.
*/
const { SERVER, stubPg, setEnv, get, makeChecker, token } = require('./helpers');

const PORT = 4571;
setEnv(PORT);

const TAG = {
  id: 7, business_id: 42, name: 'Masa 3', placement: 'Bahçe',
  code: 'abc123def456abc123def456', is_active: true,
  created_at: new Date(), updated_at: new Date(),
  tap_count: 11, qr_count: 5, nfc_count: 11, total_count: 16, last_tap: new Date()
};

stubPg(text => {
  const q = String(text).replace(/\s+/g, ' ').trim();
  if (/^(CREATE|ALTER|DELETE|DROP)/i.test(q)) return { rows: [] };
  if (/^SELECT 1$/i.test(q)) return { rows: [{}] };
  if (/FROM pg_constraint/i.test(q)) return { rows: [{}] };
  if (/FROM nfc_tags t INNER JOIN businesses b/i.test(q))
    return { rows: [{ code: TAG.code, slug: 'test-isletme' }] };
  if (/SELECT id,business_id,name,placement,code,is_active FROM nfc_tags/i.test(q))
    return { rows: [TAG] };
  if (/SELECT dashboard_profile/i.test(q))
    return { rows: [{ dashboard_profile: true, dashboard_qr: true, dashboard_nfc: true,
                      dashboard_analytics: true, dashboard_live: true, dashboard_ai: true,
                      dashboard_review: true, dashboard_campaign: true }] };
  if (/FROM nfc_tags t/i.test(q) && /tap_count/i.test(q)) return { rows: [TAG] };
  return { rows: [] };
});

require(SERVER);

const { check, finish } = makeChecker();
const biz = token('business', { id: 42, email: 'b@test.local' });

setTimeout(async () => {
  const png = await get(PORT, `/qr/nfc/${TAG.code}.png`);
  const isPng = png.body.length > 8 && png.body[0] === 0x89 &&
                png.body[1] === 0x50 && png.body[2] === 0x4e && png.body[3] === 0x47;
  const head = png.body.slice(0, 40).toString('utf8').toLowerCase();

  check('QR PNG ucu 200 donuyor', png.status === 200, `status ${png.status}`);
  check('Content-Type image/png', (png.headers['content-type'] || '').includes('image/png'),
    png.headers['content-type']);
  check('Govde gercek PNG', isPng, isPng ? `${png.body.length} bayt` : head);
  check('Fallback HTML donmuyor', !head.includes('<!doctype') && !head.includes('<html'), '');

  const tags = await get(PORT, '/api/nfc-tags', { Authorization: 'Bearer ' + biz });
  const row = Array.isArray(tags.json) ? tags.json[0] : null;
  check('/api/nfc-tags 200', tags.status === 200, `status ${tags.status}`);
  check('qr_count alani var', row && typeof row.qr_count === 'number', row ? `qr_count=${row.qr_count}` : 'satir yok');
  check('nfc_count alani var', row && typeof row.nfc_count === 'number', '');
  check('total_count alani var', row && typeof row.total_count === 'number', '');

  const qrJson = await get(PORT, `/api/nfc-tags/${TAG.id}/qr`, { Authorization: 'Bearer ' + biz });
  check('QR JSON ucu 200', qrJson.status === 200, `status ${qrJson.status}`);
  check('data URL donuyor',
    !!(qrJson.json && String(qrJson.json.qr || '').startsWith('data:image/png;base64,')), '');

  const noAuth = await get(PORT, '/api/nfc-tags');
  check('Yetkisiz erisim 401', noAuth.status === 401, `status ${noAuth.status}`);

  const health = await get(PORT, '/api/health');
  check('Saglik ucu 200', health.status === 200, `status ${health.status}`);

  process.exit(finish() ? 1 : 0);
}, 1200);
