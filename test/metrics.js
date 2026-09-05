/*
  Analitik sorgulari.

  1) Calisan HICBIR SQL'de yorumlanmamis ${...} kalmamali. Bir sorgu
     template literal degilse sabit metin olarak gecer ve Postgres'te
     sozdizimi hatasi verir; sahte pg bunu yakalayamaz.
  2) "Profil Goruntuleme" metrigi yalnizca profile_view degil, bir profil
     acilisinin uretebilecegi TUM tipleri saymali.
*/
const { SERVER, stubPg, setEnv, get, makeChecker, token } = require('./helpers');

const PORT = 4612;
setEnv(PORT);

const seen = [];
stubPg(text => {
  seen.push(String(text));
  const q = String(text).replace(/\s+/g, ' ').trim();
  if (/^(CREATE|ALTER|DELETE|DROP)/i.test(q)) return { rows: [] };
  if (/^SELECT 1$/i.test(q)) return { rows: [{}] };
  if (/FROM pg_constraint/i.test(q)) return { rows: [{}] };
  if (/SELECT dashboard_profile/i.test(q))
    return { rows: [{ dashboard_profile: true, dashboard_qr: true, dashboard_nfc: true,
                      dashboard_analytics: true, dashboard_live: true, dashboard_ai: true,
                      dashboard_review: true, dashboard_campaign: true }] };
  return { rows: [{ count: 0, total_events: 0, profile_views: 0, qr_scans: 0, nfc_taps: 0,
                    qr: 0, nfc: 0, whatsapp: 0, phone: 0, id: 1, slug: 'x', name: 'x' }] };
});

require(SERVER);

const { check, finish } = makeChecker();
const biz = token('business', { id: 42, email: 'b@test.local' });
const adm = token('admin', { email: 'admin@test.local' });

setTimeout(async () => {
  const endpoints = [
    ['/api/stats', biz],
    ['/api/business-analytics?period=7d', biz],
    ['/api/business-live-activity', biz],
    ['/api/business-ai-insights?period=7d', biz],
    ['/api/admin/overview', adm],
    ['/api/admin/businesses', adm],
    ['/api/admin/business/1/analytics', adm]
  ];

  for (const [p, t] of endpoints) {
    const r = await get(PORT, p, { Authorization: 'Bearer ' + t });
    check(`${p.split('?')[0]} hata vermiyor`, r.status !== 500, `status ${r.status}`);
  }

  const unresolved = seen.filter(q => q.includes('${'));
  check('Hicbir SQL yorumlanmamis sablon icermiyor', unresolved.length === 0,
    unresolved.length
      ? unresolved[0].split('\n').find(l => l.includes('${'))
      : `${seen.length} sorgu tarandi`);

  const narrow = seen.filter(q => /type\s*=\s*'profile_view'/.test(q));
  check('Eski dar filtre (type=profile_view) kalmadi', narrow.length === 0,
    narrow.length ? narrow[0].split('\n').find(l => /profile_view/.test(l)) : '');

  const pv = seen.filter(q => /profile_views/.test(q));
  const widened = pv.every(q => /'profile_view','qr_scan','qr','nfc'/.test(q));
  check('profile_views filtreleri qr_scan + nfc iceriyor', widened,
    `${pv.length} sorgu kontrol edildi`);

  process.exit(finish() ? 1 : 0);
}, 1200);
