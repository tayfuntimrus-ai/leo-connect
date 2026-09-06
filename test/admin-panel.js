/*
  ADMIN PANELİ ÇALIŞMA-ANI TESTİ

  Bu koşum diğerlerinden farklı: sayfayı jsdom içinde GERÇEKTEN
  çalıştırır ve butonlara basar. Kaynak taraması bu hataları
  yakalayamıyordu, çünkü fonksiyonlar tanımlıydı — sorun çalışırken
  fırlayan TypeError'lardı.

  Yakaladığı gerçek hatalar:
    - switchBizTab id'yi charAt(0).toUpperCase() ile üretiyordu:
      "nfc" -> bizNfc, ama markup'ta bizNFC. NFC ve QR sekmeleri
      hiç açılmıyordu; üstelik hata, tüm panellerin "active" sınıfı
      kaldırıldıktan SONRA fırladığı için ekran tamamen boşalıyordu.
    - openBusiness içinde tanımsız "b" değişkeni kullanılıyordu.
    - Kanal izinleri yüklenmeden gösteriliyor, kaydedince 21 kanalın
      hepsi açılıyordu.
*/
const fs = require('fs');
const path = require('path');
const { makeChecker } = require('./helpers');

const REPO = path.join(__dirname, '..');
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.log('  ATLANDI  jsdom kurulu değil (npm i -D jsdom)\n');
  process.exit(0);
}

const html = fs.readFileSync(path.join(REPO, 'public', 'admin.html'), 'utf8');
const { check, finish } = makeChecker();

const PANELS = { overview:'bizOverview', profile:'bizProfile', nfc:'bizNFC',
                 analytics:'bizAnalytics', permissions:'bizPermissions', qr:'bizQR' };

const BIZ = { id:42, name:'Test Cafe', slug:'test-cafe', email:'a@b.c', category:'Kafe',
  phone:'0555', whatsapp:'', address:'', instagram:'', tiktok:'', google_review:'',
  website:'', menu:'', hours:'', iban:'', iban_holder:'', logo_url:'',
  social_links:{}, custom_links:[], social_platform_permissions:{},
  profile_views:10, qr_scans:3, nfc_scans:7, phone_clicks:1, whatsapp_clicks:2,
  created_at:new Date() };
const PERMS = { profile:true, qr:true, nfc:true, analytics:true, live:true, ai:true,
  review:false, campaign:false, orders:false, profile_theme:true, profile_fields:{} };
/* v2-settings gercekte bazi kanallari KAPALI dondurebilir */
const CHANNELS = { instagram:true, facebook:false, tiktok:true, getir:false };

const dom = new JSDOM(html, {
  runScripts:'dangerously', url:'https://leo-connect.onrender.com/admin',
  virtualConsole:new VirtualConsole(),
  beforeParse(win){
    win.localStorage.setItem('admin_token','t'); win.localStorage.setItem('token','t');
    win.scrollTo=()=>{}; win.confirm=()=>false; win.prompt=()=>null; win.alert=()=>{};
    win.__saved=null;
    win.fetch=async(url,opts)=>{
      const u=String(url); let body={};
      if(/social-platform-permissions/.test(u)){ win.__saved=JSON.parse(opts?.body||'{}'); body={allowed_platforms:CHANNELS}; }
      else if(/\/v2-settings/.test(u)) body={theme:'midnight-gold',themes:{},accent_color:'#EF9F27',
        social_links:{},custom_links:[],allowed_platforms:CHANNELS,theme_permission:true};
      else if(/\/permissions/.test(u)) body={permissions:PERMS};
      else if(/\/analytics/.test(u)) body={totals:{},daily:[],hourly:[]};
      else if(/\/qr/.test(u)) body={qr:'data:image/png;base64,AA',url:'x'};
      else if(/\/api\/admin\/business\/\d+/.test(u)) body={business:BIZ,permissions:PERMS,nfc_tags:[]};
      else if(/\/api\/admin\/businesses/.test(u)) body={businesses:[BIZ]};
      else if(/\/api\/admin\/overview/.test(u)) body={total_businesses:1};
      else if(/live-activity/.test(u)) body={activities:[],stats:{}};
      else body={};
      /* gercek fetch gibi: headers.get() ve JSON content-type */
      return {ok:true,status:200,
              headers:{get:h=>String(h).toLowerCase()==='content-type'?'application/json; charset=utf-8':null},
              json:async()=>body,text:async()=>JSON.stringify(body)};
    };
  }
});

setTimeout(async () => {
  process.on('uncaughtException',()=>{});
  const win=dom.window, doc=win.document;
  const toasts=[];
  win.showToast=m=>toasts.push(String(m));

  /* ---- 0. GERCEK ACILIS AKISI ----
     Onceki surumde bu test openBusiness()'i DOGRUDAN cagiriyordu ve
     gercek acilis yolunu (loadAll) hic gecmiyordu. Bu yuzden
     renderOverview'in patlayip renderBusinesses'i engellemesini
     kaciriyordu: isletme listesi hic dolmuyordu. */
  toasts.length=0;
  await win.loadAll();
  const rows=doc.getElementById('businessRows');
  check('loadAll() hatasız tamamlanıyor',
    !toasts.some(t=>/Cannot set|Cannot read|not defined/i.test(t)),
    toasts.length ? toasts.join(' | ') : 'toast yok');
  check('İşletme listesi DOLDU',
    !!rows && /Test Cafe/.test(rows.innerHTML),
    rows ? `${rows.innerHTML.length} karakter` : 'businessRows yok');
  check('Genel bakış sayaçları yazıldı',
    doc.getElementById('sBusinesses')?.textContent !== '',
    doc.getElementById('sBusinesses')?.textContent);
  check('Admin e-postası yazıldı',
    !!doc.getElementById('adminMail')?.textContent, '');

  /* ---- 0b. TANILAMA ----
     Kullanici Console'a bakamiyor. Bir sey ters giderse ekranda
     Turkce aciklama gorunmeli. */
  check('Açılış adımları kaydediliyor',
    Array.isArray(win.bootLog) && win.bootLog.length >= 4,
    win.bootLog ? win.bootLog.map(s=>s.ad+':'+s.durum).join(', ') : 'bootLog yok');
  check('Her şey yolundayken uyarı kutusu GİZLİ',
    doc.getElementById('bootBanner')?.style.display === 'none', '');

  /* isletme yokken uyari cikmali */
  const okFetch = win.fetch;
  win.fetch = async (url) => {
    const u = String(url);
    const body = /businesses/.test(u) ? [] : {total_businesses:0};
    return {ok:true,status:200,
            headers:{get:()=>'application/json'},
            json:async()=>body,text:async()=>JSON.stringify(body)};
  };
  await win.loadAll();
  const emptyBanner = doc.getElementById('bootBanner');
  check('İşletme yokken uyarı GÖRÜNÜYOR',
    emptyBanner?.style.display === 'block' && /Henüz işletme yok/.test(emptyBanner.innerHTML),
    emptyBanner?.style.display);
  check('Uyarı ne yapılacağını söylüyor',
    /işletme oluşturman gerekiyor/.test(emptyBanner?.innerHTML || ''), '');

  /* API patlarsa sebebi yazilmali */
  win.fetch = async () => ({
    ok:false,status:500,
    headers:{get:()=>'application/json'},
    json:async()=>({error:'Veritabanına ulaşılamadı'}),
    text:async()=>JSON.stringify({error:'Veritabanına ulaşılamadı'})
  });
  await win.loadAll();
  const errBanner = doc.getElementById('bootBanner');
  check('API hatası ekranda SEBEBİYLE görünüyor',
    errBanner?.style.display === 'block' && /Veritabanına ulaşılamadı/.test(errBanner.innerHTML),
    errBanner?.innerHTML?.slice(0,60));
  check('Tanılama raporu açılabiliyor', typeof win.showDiagnostics === 'function', '');
  win.fetch = okFetch;
  await win.loadAll();

  /* ---- 1. isletme acilisi hatasiz mi ---- */
  toasts.length=0;
  await win.openBusiness(42);
  check('İşletme açılışı hatasız',
    !toasts.some(t=>/not defined|Cannot read/i.test(t)),
    toasts.length ? toasts.join(' | ') : 'toast yok');
  check('İşletme sayfası açıldı',
    doc.getElementById('businessPage').classList.contains('show'), '');
  check('Başlık işletme adını gösteriyor',
    doc.getElementById('topContextTitle').textContent === BIZ.name,
    doc.getElementById('topContextTitle').textContent);

  /* ---- 2. TUM sekmeler aciliyor mu ---- */
  for(const [tab,id] of Object.entries(PANELS)){
    await win.openBusiness(42);
    const btn=doc.querySelector(`[data-tab="${tab}"]`);
    let ok=false, len=0;
    try{
      win.switchBizTab(tab, btn);
      await new Promise(r=>setTimeout(r,25));
      const panel=doc.getElementById(id);
      ok = !!panel && panel.classList.contains('active') && panel.innerHTML.length > 50;
      len = panel ? panel.innerHTML.length : 0;
    }catch(e){ len = -1; }
    check(`"${tab}" sekmesi açılıyor`, ok, len < 0 ? 'HATA fırlattı' : `içerik ${len}`);
  }

  /* ---- 3. TUM onclick isleyicileri ---- */
  const seen=new Set(); const calls=[];
  for(const el of doc.querySelectorAll('[onclick]')){
    const code=el.getAttribute('onclick');
    if(code && !seen.has(code)){ seen.add(code); calls.push({code,el}); }
  }
  const broken=[];
  for(const {code,el} of calls){
    toasts.length=0;
    try{ await win.openBusiness(42); }catch(_){}
    try{
      new win.Function('event',code).call(el,{preventDefault(){},stopPropagation(){},target:el,currentTarget:el});
      await new Promise(r=>setTimeout(r,6));
      if(toasts.some(t=>/not defined|Cannot read|undefined is not/i.test(t))) broken.push(code);
    }catch(e){ broken.push(code + '  -> ' + e.message); }
  }
  check(`Tüm onclick işleyicileri çalışıyor (${calls.length} adet)`,
    broken.length === 0, broken.length ? broken[0].slice(0,90) : '');

  /* ---- 4. izin anahtarlari ---- */
  await win.openBusiness(42);
  win.switchBizTab('permissions', doc.querySelector('[data-tab="permissions"]'));
  await new Promise(r=>setTimeout(r,40));
  for(const k of ['profile','qr','nfc','analytics','live','ai','review','campaign','orders']){
    check(`perm_${k} anahtarı var`, !!doc.getElementById('perm_'+k), '');
  }

  /* ---- 5. kanal izinleri GERCEK durumu gosteriyor mu ---- */
  await new Promise(r=>setTimeout(r,60));
  const fb=doc.getElementById('channel_facebook');
  const ig=doc.getElementById('channel_instagram');
  check('Kanal izinleri sunucudan yüklendi',
    !!fb && !fb.disabled, fb ? (fb.disabled?'hâlâ kilitli':'yüklendi') : 'yok');
  check('KAPALI kanal kapalı görünüyor', !!fb && fb.checked === false,
    fb ? `facebook checked=${fb.checked} (false olmalı)` : '');
  check('AÇIK kanal açık görünüyor', !!ig && ig.checked === true,
    ig ? `instagram checked=${ig.checked}` : '');

  /* ---- 6. sessiz hata tuzagi ---- */
  /* Express fallback bilinmeyen yola index.html + 200 OK donuyor.
     api() bunu SESSIZCE bos {} olarak dondurmemeli. */
  const realFetch = win.fetch;
  win.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => '<!doctype html><html><body>index</body></html>',
    json: async () => { throw new SyntaxError('Unexpected token <'); }
  });
  let htmlErr = null;
  try { await win.api('/api/admin/olmayan-uc'); }
  catch (e) { htmlErr = e.message; }
  check('HTML yanıtı sessizce yutulmuyor', !!htmlErr,
    htmlErr ? htmlErr.slice(0, 70) : 'hata fırlatılmadı — SESSİZ');
  check('Hata mesajı hangi uç olduğunu söylüyor',
    !!htmlErr && htmlErr.includes('/api/admin/olmayan-uc'), '');
  win.fetch = realFetch;

  /* ---- 7. businesses dizi seklini de kabul ediyor ---- */
  const src = fs.readFileSync(path.join(REPO, 'public', 'admin.html'), 'utf8');
  check('businesses yanıtı dizi olarak da okunuyor',
    /Array\.isArray\(fresh\)\?fresh:\(fresh\?\.businesses\|\|\[\]\)/.test(src), '');

  /* ---- 8. yakalanmamis hatalar gorunur ---- */
  check('unhandledrejection yakalanıyor',
    /addEventListener\('unhandledrejection'/.test(src), '');
  check('sayfa hataları yakalanıyor',
    /addEventListener\('error'/.test(src), '');

  process.exit(finish() ? 1 : 0);
}, 1600);
