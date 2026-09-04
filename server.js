require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 10000;
const SECRET = process.env.JWT_SECRET || 'leo-connect-change-this-secret';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));


/* =========================================================
   DATABASE
========================================================= */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL bulunamadı.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false
});


/* =========================================================
   HELPERS
========================================================= */

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}


function createNfcCode() {
  return crypto.randomBytes(12).toString('hex');
}


function publicBusiness(row) {
  if (!row) return null;
  const allowed = normalizeAllowedPlatforms(row.social_platform_permissions);
  const legacyAllowed = {
    instagram: allowed.instagram !== false,
    tiktok: allowed.tiktok !== false,
    whatsapp: allowed.whatsapp !== false,
    google_review: allowed.google !== false,
    website: allowed.website !== false,
    menu: allowed.menu !== false,
    address: allowed.location !== false
  };
  const social = normalizeSocialLinks(row.social_links);
  const filteredSocial = Object.fromEntries(
    Object.entries(social).filter(([key,item]) => allowed[key] !== false && item && item.url)
  );
  return {
    id: row.id, name: row.name, slug: row.slug, email: row.email,
    category: row.category || '', description: row.description || '', phone: row.phone || '',
    whatsapp: legacyAllowed.whatsapp ? (row.whatsapp || '') : '',
    address: legacyAllowed.address ? (row.address || '') : '',
    instagram: legacyAllowed.instagram ? (row.instagram || '') : '',
    tiktok: legacyAllowed.tiktok ? (row.tiktok || '') : '',
    google_review: legacyAllowed.google_review ? (row.google_review || '') : '',
    website: legacyAllowed.website ? (row.website || '') : '',
    menu: legacyAllowed.menu ? (row.menu || '') : '',
    iban: row.iban || '', iban_holder: row.iban_holder || '', hours: row.hours || '', logo_url: row.logo_url || '',
    social_links: filteredSocial, custom_links: normalizeCustomLinks(row.custom_links),
    social_platform_permissions: allowed, created_at: row.created_at
  };
}



const LEO_V2_THEMES = {
  'midnight-gold': { name:'Midnight Gold', description:'Siyah + altın, ana premium tema' },
  'obsidian': { name:'Obsidian', description:'Ultra koyu, modern ve teknolojik tema' },
  'champagne': { name:'Champagne', description:'Sıcak, zarif ve lüks tema' },
  'pure-light': { name:'Pure Light', description:'Aydınlık, temiz ve premium tema' }
};

const LEO_V2_SOCIAL_PLATFORMS = ['instagram','facebook','tiktok','youtube','linkedin','x','whatsapp','google','website','yemeksepeti','getir','trendyol-yemek','migros-yemek','rezervasyon','bilet','menu','location','tripadvisor','booking','telegram','email'];
const LEO_V2_DEFAULT_ALLOWED_PLATFORMS = Object.fromEntries(LEO_V2_SOCIAL_PLATFORMS.map(k=>[k,true]));
function normalizeAllowedPlatforms(value){
  let raw=value;
  if(typeof raw==='string'){ try{raw=JSON.parse(raw)}catch(_){raw={};} }
  raw=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  return Object.fromEntries(LEO_V2_SOCIAL_PLATFORMS.map(k=>[k,raw[k]!==false]));
}

function normalizeSocialLinks(value){
  let raw=value;
  if(typeof raw==='string'){ try{ raw=JSON.parse(raw); }catch(_){ raw={}; } }
  raw=raw && typeof raw==='object' && !Array.isArray(raw) ? raw : {};
  const out={};
  for(const key of LEO_V2_SOCIAL_PLATFORMS){
    const item=raw[key];
    if(typeof item==='string') out[key]={url:item.trim().slice(0,2000),enabled:true,icon_url:''};
    else if(item && typeof item==='object') out[key]={url:String(item.url||'').trim().slice(0,2000),enabled:item.enabled!==false,label:String(item.label||'').trim().slice(0,80),icon_url:String(item.icon_url||'').trim().slice(0,2000)};
  }
  return out;
}

function normalizeCustomLinks(value){
  let raw=value;
  if(typeof raw==='string'){ try{ raw=JSON.parse(raw); }catch(_){ raw=[]; } }
  if(!Array.isArray(raw)) return [];
  return raw.slice(0,20).map((item,i)=>({
    id:String(item?.id || `custom-${i+1}`),
    title:String(item?.title || '').trim().slice(0,80),
    url:String(item?.url || '').trim().slice(0,2000),
    icon:String(item?.icon || '🔗').trim().slice(0,8),
    icon_url:String(item?.icon_url || '').trim().slice(0,2000),
    enabled:item?.enabled!==false,
    sort_order:Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : i
  })).filter(x=>x.title && x.url);
}

const DYNAMIC_PROFILE_DEFAULTS = {
  theme: 'midnight-gold',
  accent_color: '#D4AF37',
  cover_url: '',
  cover_position: 'center',
  announcement_text: '',
  announcement_enabled: false,
  campaign_title: '',
  campaign_text: '',
  campaign_image_url: '',
  campaign_button_text: '',
  campaign_button_url: '',
  campaign_enabled: false,
  featured_title: '',
  featured_text: '',
  featured_image_url: '',
  featured_button_text: '',
  featured_button_url: '',
  featured_enabled: false,
  gallery: [],
  video_url: '',
  video_enabled: false
};

function normalizeProfileDesign(row) {
  if (!row) return { ...DYNAMIC_PROFILE_DEFAULTS };
  return {
    ...DYNAMIC_PROFILE_DEFAULTS,
    ...row,
    gallery: Array.isArray(row.gallery) ? row.gallery : []
  };
}

async function getPublicProfileDesign(businessId) {
  const result = await pool.query(
    `SELECT theme,accent_color,cover_url,cover_position,
            announcement_text,announcement_enabled,
            campaign_title,campaign_text,campaign_image_url,campaign_button_text,campaign_button_url,campaign_enabled,
            featured_title,featured_text,featured_image_url,featured_button_text,featured_button_url,featured_enabled,
            gallery,video_url,video_enabled
     FROM profile_designs
     WHERE business_id=$1
     LIMIT 1`,
    [businessId]
  );
  return normalizeProfileDesign(result.rows[0]);
}


const REVIEW_BOOSTER_DEFAULTS = {
  enabled: false,
  title: 'Deneyimini bizimle paylaş',
  text: 'Memnun kaldıysan Google’da bizi değerlendir. Bir sorun yaşadıysan doğrudan bize ulaş.',
  threshold: 4,
  low_title: 'Bunu duymak isteriz',
  low_text: 'Yaşadığın sorunu bize ilet, seninle ilgilenelim.',
  success_title: 'Teşekkürler!',
  success_text: 'Değerlendirmen bizim için çok değerli.'
};

function normalizeReviewBooster(row) {
  if (!row) return { ...REVIEW_BOOSTER_DEFAULTS };
  return {
    ...REVIEW_BOOSTER_DEFAULTS,
    ...row,
    enabled: row.enabled === true,
    threshold: Math.min(5, Math.max(1, Number(row.threshold) || 4))
  };
}

async function getReviewBooster(businessId) {
  const result = await pool.query(
    `SELECT enabled,title,text,threshold,low_title,low_text,success_title,success_text
     FROM review_boosters WHERE business_id=$1 LIMIT 1`,
    [businessId]
  );
  return normalizeReviewBooster(result.rows[0]);
}


/* =========================================================
   V2 — INDEPENDENT PERSONAL BUSINESS CARD
========================================================= */
const CARD_PERSON_FIELDS = [
  'display_name','person_name','job_title','company','phone','whatsapp','email','website','address',
  'instagram','facebook','tiktok','linkedin','youtube','x','photo_url','cover_url','bio','note'
];
const CARD_PERSON_LABELS = {
  display_name:'Kart Başlığı', person_name:'Ad Soyad', job_title:'Unvan', company:'Şirket / Kurum',
  phone:'Telefon', whatsapp:'WhatsApp', email:'E-posta', website:'Web Sitesi', address:'Adres',
  instagram:'Instagram', facebook:'Facebook', tiktok:'TikTok', linkedin:'LinkedIn', youtube:'YouTube', x:'X / Twitter',
  photo_url:'Profil Fotoğrafı', cover_url:'Kapak Görseli', bio:'Hakkımda', note:'Not / Kısa Açıklama'
};
const CARD_PERSON_DEFAULT_DATA = Object.fromEntries(CARD_PERSON_FIELDS.map(k=>[k,'']));
const CARD_PERSON_DEFAULT_PERMISSIONS = Object.fromEntries(CARD_PERSON_FIELDS.map(k=>[k,false]));
function normalizeCardPerson(row){
  const data={...CARD_PERSON_DEFAULT_DATA,...(row?.data||{})};
  const permissions={...CARD_PERSON_DEFAULT_PERMISSIONS,...(row?.permissions||{})};
  for(const key of CARD_PERSON_FIELDS){ data[key]=String(data[key]??''); permissions[key]=permissions[key]===true; }
  return {id:row?.id||null,slug:row?.slug||'',enabled:row?.enabled===true,email:row?.email||'',data,permissions,field_labels:CARD_PERSON_LABELS};
}
async function getCardPerson(id){
  const r=await pool.query(`SELECT id,slug,email,enabled,data,permissions FROM card_people WHERE id=$1 LIMIT 1`,[id]);
  return normalizeCardPerson(r.rows[0]);
}
function cardPersonAuth(req,res,next){
  try{
    const header=req.headers.authorization||'';
    if(!header.startsWith('Bearer ')) return res.status(401).json({error:'Kart sahibi oturumu gerekli'});
    const decoded=jwt.verify(header.substring(7),SECRET);
    if(!decoded?.id || decoded.role!=='card_person') return res.status(403).json({error:'Kart sahibi yetkisi gerekli'});
    req.cardPerson=decoded; next();
  }catch(e){ return res.status(401).json({error:'Kart sahibi oturumu geçersiz veya süresi dolmuş'}); }
}

const BUSINESS_PROFILE_FIELDS = [
  'name','category','description','phone','whatsapp','address',
  'instagram','tiktok','google_review','website','menu',
  'hours','iban','iban_holder','logo_url'
];

const BUSINESS_PROFILE_FIELD_LABELS = {
  name:'İşletme Adı',
  category:'Kategori',
  description:'İşletme Açıklaması',
  phone:'Telefon',
  whatsapp:'WhatsApp',
  address:'Konum / Google Maps',
  instagram:'Instagram',
  tiktok:'TikTok',
  google_review:'Google Yorum',
  website:'Web Sitesi',
  menu:'Menü',
  hours:'Çalışma Saatleri',
  iban:'IBAN',
  iban_holder:'IBAN Sahibi',
  logo_url:'Logo Görseli'
};

function businessProfileFieldPermissions(row) {
  let raw = row?.profile_field_permissions;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = {}; }
  }
  raw = raw && typeof raw === 'object' ? raw : {};
  const result = {};
  for (const key of BUSINESS_PROFILE_FIELDS) result[key] = raw[key] === false ? false : true;
  return result;
}

function publicBusinessWithFieldPermissions(row) {
  const profile = publicBusiness(row);
  const permissions = businessProfileFieldPermissions(row);

  for (const key of BUSINESS_PROFILE_FIELDS) {
    if (!permissions[key]) profile[key] = '';
  }

  return profile;
}

function businessPermissions(row) {
  return {
    profile: row?.dashboard_profile !== false,
    qr: row?.dashboard_qr === true,
    nfc: row?.dashboard_nfc === true,
    analytics: row?.dashboard_analytics === true,
    live: row?.dashboard_live === true,
    ai: row?.dashboard_ai === true,
    review: row?.dashboard_review === true,
    campaign: row?.dashboard_campaign === true,
    profile_theme: row?.profile_theme_permission !== false,
    profile_fields: businessProfileFieldPermissions(row)
  };
}

function requireBusinessPermission(permission) {
  return async (req, res, next) => {
    try {
      if (req.user?.role === 'admin') return next();
      const result = await pool.query(
        `SELECT dashboard_profile, dashboard_qr, dashboard_nfc, dashboard_analytics, dashboard_live, dashboard_ai, dashboard_review, dashboard_campaign
         FROM businesses WHERE id=$1 LIMIT 1`,
        [req.user.id]
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: 'İşletme bulunamadı' });
      }
      const permissions = businessPermissions(result.rows[0]);
      if (!permissions[permission]) {
        return res.status(403).json({
          error: 'Bu alan için admin izni gerekli',
          permission,
          permissions
        });
      }
      next();
    } catch (error) {
      console.error('BUSINESS PERMISSION ERROR:', error);
      res.status(500).json({ error: 'Erişim kontrolü yapılamadı' });
    }
  };
}


function nfcTagPublic(row) {
  if (!row) return null;

  const baseUrl =
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    '';

  const url = baseUrl
    ? `${baseUrl}/p/nfc/${row.code}`
    : `/p/nfc/${row.code}`;

  return {
    id: row.id,
    business_id: row.business_id,
    name: row.name,
    placement: row.placement || '',
    code: row.code,
    url,
    is_active: row.is_active,
    tap_count: Number(row.tap_count || row.nfc_count || 0),
    qr_count: Number(row.qr_count || 0),
    nfc_count: Number(row.nfc_count || row.tap_count || 0),
    total_count: Number(row.total_count || ((Number(row.qr_count || 0)) + (Number(row.nfc_count || row.tap_count || 0)))),
    last_tap: row.last_tap || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}


/* =========================================================
   DATABASE INIT
========================================================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      category TEXT DEFAULT '',
      description TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      whatsapp TEXT DEFAULT '',
      address TEXT DEFAULT '',
      instagram TEXT DEFAULT '',
      tiktok TEXT DEFAULT '',
      google_review TEXT DEFAULT '',
      website TEXT DEFAULT '',
      menu TEXT DEFAULT '',
      iban TEXT DEFAULT '',
      iban_holder TEXT DEFAULT '',
      hours TEXT DEFAULT '',
      logo_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);


  await pool.query(`
    ALTER TABLE businesses
      ADD COLUMN IF NOT EXISTS dashboard_profile BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS dashboard_qr BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS dashboard_nfc BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS dashboard_analytics BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS dashboard_live BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS dashboard_ai BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS profile_field_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS profile_theme_permission BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS custom_links JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS social_platform_permissions JSONB NOT NULL DEFAULT '{}'::jsonb
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);


  /*
    NFC TAGS
  */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nfc_tags (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL
        REFERENCES businesses(id)
        ON DELETE CASCADE,

      name TEXT NOT NULL,
      placement TEXT DEFAULT '',
      code TEXT UNIQUE NOT NULL,

      is_active BOOLEAN NOT NULL DEFAULT TRUE,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);


  /*
    Eski events tablosuna NFC tag bağlantısı ekle.
  */

  await pool.query(`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS nfc_tag_id INTEGER
    REFERENCES nfc_tags(id)
    ON DELETE SET NULL
  `);


  await pool.query(`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT ''
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_events_source
    ON events(source)
  `);


  /*
    Performans için indexler.
  */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_events_business_id
    ON events(business_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_events_type
    ON events(type)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_events_nfc_tag_id
    ON events(nfc_tag_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_nfc_tags_business_id
    ON nfc_tags(business_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_nfc_tags_code
    ON nfc_tags(code)
  `);



  /* V2 — INDEPENDENT PERSONAL BUSINESS CARDS */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS card_people (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_card_people_slug ON card_people(slug)`);

  /* V2 — DYNAMIC PROFILE DESIGN */

  /* V2 — REVIEW BOOSTER */
  await pool.query(`
    ALTER TABLE businesses
      ADD COLUMN IF NOT EXISTS dashboard_review BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS dashboard_campaign BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_boosters (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      title TEXT NOT NULL DEFAULT 'Deneyimini bizimle paylaş',
      text TEXT NOT NULL DEFAULT 'Memnun kaldıysan Google’da bizi değerlendir. Bir sorun yaşadıysan doğrudan bize ulaş.',
      threshold INTEGER NOT NULL DEFAULT 4,
      low_title TEXT NOT NULL DEFAULT 'Bunu duymak isteriz',
      low_text TEXT NOT NULL DEFAULT 'Yaşadığın sorunu bize ilet, seninle ilgilenelim.',
      success_title TEXT NOT NULL DEFAULT 'Teşekkürler!',
      success_text TEXT NOT NULL DEFAULT 'Değerlendirmen bizim için çok değerli.',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_review_boosters_business_id
    ON review_boosters(business_id)
  `);

  /* V2 — SMART CAMPAIGNS */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      text TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      button_text TEXT DEFAULT '',
      button_url TEXT DEFAULT '',
      starts_at TIMESTAMP NULL,
      ends_at TIMESTAMP NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_business_id ON campaigns(business_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_active_window ON campaigns(enabled,starts_at,ends_at)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profile_designs (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
      theme TEXT NOT NULL DEFAULT 'midnight-gold',
      accent_color TEXT NOT NULL DEFAULT '#D4AF37',
      cover_url TEXT DEFAULT '',
      cover_position TEXT DEFAULT 'center',
      announcement_text TEXT DEFAULT '',
      announcement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      campaign_title TEXT DEFAULT '',
      campaign_text TEXT DEFAULT '',
      campaign_image_url TEXT DEFAULT '',
      campaign_button_text TEXT DEFAULT '',
      campaign_button_url TEXT DEFAULT '',
      campaign_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      featured_title TEXT DEFAULT '',
      featured_text TEXT DEFAULT '',
      featured_image_url TEXT DEFAULT '',
      featured_button_text TEXT DEFAULT '',
      featured_button_url TEXT DEFAULT '',
      featured_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
      video_url TEXT DEFAULT '',
      video_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_profile_designs_business_id
    ON profile_designs(business_id)
  `);

  console.log('PostgreSQL + NFC Tag Management hazır.');
}


/* =========================================================
   AUTH
========================================================= */

function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';

    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Yetkilendirme gerekli'
      });
    }

    const token = header.substring(7);

    const decoded = jwt.verify(token, SECRET);

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        error: 'Geçersiz token'
      });
    }

    req.user = decoded;

    next();

  } catch (error) {
    return res.status(401).json({
      error: 'Oturum geçersiz veya süresi dolmuş'
    });
  }
}


function adminAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';

    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Admin yetkisi gerekli'
      });
    }

    const token = header.substring(7);

    const decoded = jwt.verify(token, SECRET);

    if (
      !decoded ||
      decoded.role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Admin yetkisi gerekli'
      });
    }

    req.admin = decoded;

    next();

  } catch (error) {
    return res.status(401).json({
      error: 'Admin oturumu geçersiz'
    });
  }
}


/* =========================================================
   HEALTH
========================================================= */

app.get('/api/health', async (req, res) => {
  try {

    await pool.query('SELECT 1');

    res.json({
      ok: true,
      version: '3.9-access-control',
      database: 'postgresql',
      nfc_tags: true
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      ok: false,
      error: 'Veritabanı bağlantı hatası'
    });
  }
});


/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post('/api/admin/login', async (req, res) => {

  try {

    const {
      email,
      password
    } = req.body;

    const adminEmail =
      process.env.ADMIN_EMAIL || '';

    const adminPassword =
      process.env.ADMIN_PASSWORD || '';

    if (!adminEmail || !adminPassword) {

      return res.status(503).json({
        error: 'Admin hesabı henüz yapılandırılmadı'
      });

    }

    if (
      String(email || '').trim().toLowerCase() !==
      String(adminEmail).trim().toLowerCase() ||
      String(password || '') !==
      String(adminPassword)
    ) {

      return res.status(401).json({
        error: 'Admin e-posta veya şifre hatalı'
      });

    }

    const token = jwt.sign(
      {
        role: 'admin',
        email: adminEmail
      },
      SECRET,
      {
        expiresIn: '7d'
      }
    );

    res.json({
      token,
      admin: {
        email: adminEmail
      }
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Admin girişi sırasında hata oluştu'
    });

  }

});



/* =========================================================
   ADMIN LIVE ACTIVITY
========================================================= */
app.get('/api/admin/live-activity', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.id,
        e.type,
        e.source,
        e.nfc_tag_id,
        e.created_at,
        b.id AS business_id,
        b.name AS business_name,
        b.slug AS business_slug,
        t.name AS nfc_name,
        t.placement AS nfc_placement
      FROM events e
      LEFT JOIN businesses b ON b.id = e.business_id
      LEFT JOIN nfc_tags t ON t.id = e.nfc_tag_id
      ORDER BY e.created_at DESC
      LIMIT 30
    `);
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '15 minutes')::int AS last_15m,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '60 minutes')::int AS last_60m
      FROM events
    `);
    res.json({activities: result.rows, stats: stats.rows[0] || {last_24h:0,last_15m:0,last_60m:0}});
  } catch (error) {
    console.error('LIVE ACTIVITY ERROR:', error);
    res.status(500).json({error:'Canlı aktiviteler alınamadı'});
  }
});

/* =========================================================
   ADMIN OVERVIEW
========================================================= */

app.get('/api/admin/overview', adminAuth, async (req, res) => {

  try {

    const businesses = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM businesses
    `);

    const events = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM events
    `);

    const profiles = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM events
      WHERE type='profile_view'
    `);

    const qr = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM events
      WHERE type IN ('qr_scan','qr')
    `);

    const nfc = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM events
      WHERE type='nfc'
    `);

    const whatsapp = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM events
      WHERE type='whatsapp'
    `);

    const phone = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM events
      WHERE type='phone'
    `);

    const nfcTags = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM nfc_tags
    `);

    res.json({

      businesses:
        businesses.rows[0].count,

      events:
        events.rows[0].count,

      profile_views:
        profiles.rows[0].count,

      qr_scans:
        qr.rows[0].count,

      nfc_scans:
        nfc.rows[0].count,

      whatsapp_clicks:
        whatsapp.rows[0].count,

      phone_clicks:
        phone.rows[0].count,

      nfc_tags:
        nfcTags.rows[0].count

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Genel istatistikler alınamadı'
    });

  }

});


/* =========================================================
   ADMIN BUSINESSES
========================================================= */

app.get('/api/admin/businesses', adminAuth, async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT

        b.id,
        b.name,
        b.slug,
        b.email,
        b.category,
        b.phone,
        b.dashboard_profile,
        b.dashboard_qr,
        b.dashboard_nfc,
        b.dashboard_analytics,
        b.created_at,

        COALESCE((
          SELECT COUNT(*)
          FROM events e
          WHERE e.business_id = b.id
          AND e.type = 'profile_view'
        ),0)::int AS profile_views,

        COALESCE((
          SELECT COUNT(*)
          FROM events e
          WHERE e.business_id = b.id
          AND e.type IN ('qr_scan','qr')
        ),0)::int AS qr_scans,

        COALESCE((
          SELECT COUNT(*)
          FROM events e
          WHERE e.business_id = b.id
          AND e.type = 'nfc'
        ),0)::int AS nfc_scans,

        COALESCE((
          SELECT COUNT(*)
          FROM events e
          WHERE e.business_id = b.id
          AND e.type = 'whatsapp'
        ),0)::int AS whatsapp_clicks,

        COALESCE((
          SELECT COUNT(*)
          FROM events e
          WHERE e.business_id = b.id
          AND e.type = 'phone'
        ),0)::int AS phone_clicks,

        COALESCE((
          SELECT COUNT(*)
          FROM nfc_tags t
          WHERE t.business_id = b.id
        ),0)::int AS nfc_tags

      FROM businesses b

      ORDER BY b.id DESC
    `);

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'İşletmeler alınamadı'
    });

  }

});


/* =========================================================
   ADMIN BUSINESS CREATE
========================================================= */

app.post('/api/admin/businesses', adminAuth, async (req, res) => {

  try {

    const {
      name,
      email,
      password,
      category
    } = req.body || {};

    const businessName = String(name || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const businessPassword = String(password || '');

    if (!businessName || !normalizedEmail || businessPassword.length < 8) {
      return res.status(400).json({
        error: 'İşletme adı, e-posta ve en az 8 karakter şifre gerekli'
      });
    }

    const existing = await pool.query(
      `SELECT id FROM businesses WHERE email=$1 LIMIT 1`,
      [normalizedEmail]
    );

    if (existing.rows.length) {
      return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı' });
    }

    const base = slugify(businessName) || 'business';
    let slug = base;
    let n = 1;

    while (true) {
      const check = await pool.query(
        `SELECT id FROM businesses WHERE slug=$1 LIMIT 1`,
        [slug]
      );
      if (!check.rows.length) break;
      n++;
      slug = `${base}-${n}`;
    }

    const passwordHash = await bcrypt.hash(businessPassword, 12);

    const result = await pool.query(`
      INSERT INTO businesses(
        name,
        slug,
        email,
        password_hash,
        category,
        dashboard_profile,
        dashboard_qr,
        dashboard_nfc,
        dashboard_analytics,
        dashboard_live,
        dashboard_ai
      )
      VALUES($1,$2,$3,$4,$5,TRUE,FALSE,FALSE,FALSE,FALSE,FALSE)
      RETURNING *
    `, [
      businessName,
      slug,
      normalizedEmail,
      passwordHash,
      String(category || '').trim()
    ]);

    res.status(201).json({
      success: true,
      business: publicBusiness(result.rows[0]),
      permissions: businessPermissions(result.rows[0])
    });

  } catch (error) {

    console.error('ADMIN BUSINESS CREATE ERROR:', error);

    res.status(500).json({
      error: 'İşletme oluşturulamadı'
    });

  }

});


/* =========================================================
   ADMIN BUSINESS DETAIL
========================================================= */

app.get(
  '/api/admin/business/:id',
  adminAuth,
  async (req, res) => {

    try {

      const id = Number(req.params.id);

      const result = await pool.query(
        `
        SELECT *
        FROM businesses
        WHERE id=$1
        `,
        [id]
      );

      if (!result.rows.length) {

        return res.status(404).json({
          error: 'İşletme bulunamadı'
        });

      }

      const business = result.rows[0];

      const tags = await pool.query(`
        SELECT
          t.id,
          t.name,
          t.placement,
          t.code,
          t.is_active,
          t.created_at,
          t.updated_at,

          COALESCE((
            SELECT COUNT(*)
            FROM events e
            WHERE e.nfc_tag_id = t.id
            AND e.type='nfc'
          ),0)::int AS tap_count,

          (
            SELECT MAX(e.created_at)
            FROM events e
            WHERE e.nfc_tag_id = t.id
            AND e.type='nfc'
          ) AS last_tap

        FROM nfc_tags t

        WHERE t.business_id=$1

        ORDER BY t.id DESC
      `, [id]);

      res.json({
        business: publicBusiness(business),
        permissions: businessPermissions(business),
        nfc_tags: tags.rows.map(nfcTagPublic)
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: 'İşletme bilgileri alınamadı'
      });

    }

  }
);


/* =========================================================
   ADMIN BUSINESS PERMISSIONS
========================================================= */

app.get('/api/admin/business/:id/permissions', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, dashboard_profile, dashboard_qr, dashboard_nfc, dashboard_analytics, dashboard_live, dashboard_ai, dashboard_review, dashboard_campaign, profile_theme_permission, profile_field_permissions
      FROM businesses WHERE id=$1 LIMIT 1
    `, [Number(req.params.id)]);
    if (!result.rows.length) return res.status(404).json({ error: 'İşletme bulunamadı' });
    res.json({ permissions: businessPermissions(result.rows[0]) });
  } catch (error) {
    console.error('ADMIN PERMISSIONS GET ERROR:', error);
    res.status(500).json({ error: 'İzinler alınamadı' });
  }
});

app.put('/api/admin/business/:id/permissions', adminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const profile = body.profile !== false;
    const qr = body.qr === true;
    const nfc = body.nfc === true;
    const analytics = body.analytics === true;
    const live = body.live === true;
    const ai = body.ai === true;
    const review = body.review === true;
    const campaign = body.campaign === true;

    const current = await pool.query(
      `SELECT profile_field_permissions FROM businesses WHERE id=$1 LIMIT 1`,
      [id]
    );
    if (!current.rows.length) return res.status(404).json({ error: 'İşletme bulunamadı' });

    const incomingFields = body.profile_fields && typeof body.profile_fields === 'object'
      ? body.profile_fields
      : {};
    const profile_fields = businessProfileFieldPermissions(current.rows[0]);
    const profile_theme = body.profile_theme !== undefined
      ? body.profile_theme === true
      : current.rows[0].profile_theme_permission !== false;
    for (const key of BUSINESS_PROFILE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(incomingFields, key)) {
        profile_fields[key] = incomingFields[key] === true;
      }
    }

    const result = await pool.query(`
      UPDATE businesses
      SET dashboard_profile=$1, dashboard_qr=$2, dashboard_nfc=$3, dashboard_analytics=$4, dashboard_live=$5, dashboard_ai=$6, dashboard_review=$7, dashboard_campaign=$8, profile_theme_permission=$9, profile_field_permissions=$10::jsonb
      WHERE id=$11
      RETURNING id, name, dashboard_profile, dashboard_qr, dashboard_nfc, dashboard_analytics, dashboard_live, dashboard_ai, dashboard_review, dashboard_campaign, profile_theme_permission, profile_field_permissions
    `, [profile, qr, nfc, analytics, live, ai, review, campaign, profile_theme, JSON.stringify(profile_fields), id]);

    if (!result.rows.length) return res.status(404).json({ error: 'İşletme bulunamadı' });
    res.json({ success: true, permissions: businessPermissions(result.rows[0]) });
  } catch (error) {
    console.error('ADMIN PERMISSIONS UPDATE ERROR:', error);
    res.status(500).json({ error: 'İzinler güncellenemedi' });
  }
});



/* =========================================================
   INDEPENDENT PERSONAL BUSINESS CARD API
========================================================= */
app.get('/api/admin/card-people', adminAuth, async (req,res)=>{
  try{
    const r=await pool.query(`SELECT id,slug,email,enabled,data,permissions,created_at,updated_at FROM card_people ORDER BY created_at DESC`);
    res.json({people:r.rows.map(x=>normalizeCardPerson(x))});
  }catch(e){console.error('ADMIN CARD PEOPLE LIST ERROR:',e);res.status(500).json({error:'Business Card kişileri alınamadı'});}
});
app.post('/api/admin/card-people', adminAuth, async (req,res)=>{
  try{
    const body=req.body||{}, name=String(body.person_name||body.display_name||'').trim();
    if(!name) return res.status(400).json({error:'Ad Soyad gerekli'});
    const base=slugify(name)||'kart';
    let slug=base, i=2;
    while((await pool.query(`SELECT 1 FROM card_people WHERE slug=$1 LIMIT 1`,[slug])).rows.length) slug=`${base}-${i++}`;
    const data={...CARD_PERSON_DEFAULT_DATA};
    for(const k of CARD_PERSON_FIELDS) if(Object.prototype.hasOwnProperty.call(body.data||{},k)) data[k]=String(body.data[k]??'').trim();
    data.person_name=data.person_name||name;
    const permissions={...CARD_PERSON_DEFAULT_PERMISSIONS};
    for(const k of CARD_PERSON_FIELDS) if(body.permissions&&Object.prototype.hasOwnProperty.call(body.permissions,k)) permissions[k]=body.permissions[k]===true;
    const email=String(body.email||'').trim().toLowerCase()||null;
    let passwordHash=null;
    if(body.password) passwordHash=await bcrypt.hash(String(body.password),10);
    const r=await pool.query(`INSERT INTO card_people(slug,email,password_hash,enabled,data,permissions) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING id,slug,email,enabled,data,permissions,created_at,updated_at`,[slug,email,passwordHash,body.enabled!==false,JSON.stringify(data),JSON.stringify(permissions)]);
    res.status(201).json({person:normalizeCardPerson(r.rows[0])});
  }catch(e){console.error('ADMIN CARD PERSON CREATE ERROR:',e);res.status(500).json({error:e.code==='23505'?'E-posta veya slug zaten kullanılıyor':'Business Card kişisi oluşturulamadı'});}
});
app.get('/api/admin/card-people/:id', adminAuth, async (req,res)=>{
  try{const p=await getCardPerson(Number(req.params.id));if(!p.id)return res.status(404).json({error:'Kişi bulunamadı'});res.json({person:p});}
  catch(e){res.status(500).json({error:'Business Card kişisi alınamadı'});}
});
app.put('/api/admin/card-people/:id', adminAuth, async (req,res)=>{
  try{
    const id=Number(req.params.id), current=await getCardPerson(id); if(!current.id)return res.status(404).json({error:'Kişi bulunamadı'});
    const body=req.body||{}, data={...current.data}, permissions={...current.permissions};
    if(body.data&&typeof body.data==='object') for(const k of CARD_PERSON_FIELDS) if(Object.prototype.hasOwnProperty.call(body.data,k)) data[k]=String(body.data[k]??'').trim();
    if(body.permissions&&typeof body.permissions==='object') for(const k of CARD_PERSON_FIELDS) if(Object.prototype.hasOwnProperty.call(body.permissions,k)) permissions[k]=body.permissions[k]===true;
    const enabled=body.enabled===true;
    let passwordHash=null;
    if(body.password) passwordHash=await bcrypt.hash(String(body.password),10);
    const r=await pool.query(`UPDATE card_people SET email=$1,enabled=$2,data=$3::jsonb,permissions=$4::jsonb,password_hash=COALESCE($5,password_hash),updated_at=CURRENT_TIMESTAMP WHERE id=$6 RETURNING id,slug,email,enabled,data,permissions,created_at,updated_at`,[String(body.email??current.email).trim().toLowerCase()||null,enabled,JSON.stringify(data),JSON.stringify(permissions),passwordHash,id]);
    res.json({person:normalizeCardPerson(r.rows[0])});
  }catch(e){console.error('ADMIN CARD PERSON UPDATE ERROR:',e);res.status(500).json({error:'Business Card kişisi güncellenemedi'});}
});
app.delete('/api/admin/card-people/:id', adminAuth, async (req,res)=>{
  try{const r=await pool.query(`DELETE FROM card_people WHERE id=$1 RETURNING id`,[Number(req.params.id)]);if(!r.rows.length)return res.status(404).json({error:'Kişi bulunamadı'});res.json({success:true});}
  catch(e){res.status(500).json({error:'Business Card kişisi silinemedi'});}
});

app.post('/api/card-login', async (req,res)=>{
  try{
    const email=String(req.body?.email||'').trim().toLowerCase(), password=String(req.body?.password||'');
    const r=await pool.query(`SELECT * FROM card_people WHERE email=$1 AND enabled=TRUE LIMIT 1`,[email]);
    if(!r.rows.length || !r.rows[0].password_hash) return res.status(401).json({error:'E-posta veya şifre hatalı'});
    if(!await bcrypt.compare(password,r.rows[0].password_hash)) return res.status(401).json({error:'E-posta veya şifre hatalı'});
    const p=r.rows[0], token=jwt.sign({id:p.id,email:p.email,role:'card_person'},SECRET,{expiresIn:'30d'});
    res.json({token,person:normalizeCardPerson(p)});
  }catch(e){res.status(500).json({error:'Kart girişi yapılamadı'});}
});
app.get('/api/card/me', cardPersonAuth, async (req,res)=>{try{const p=await getCardPerson(req.cardPerson.id);if(!p.id)return res.status(404).json({error:'Kart bulunamadı'});res.json({person:p});}catch(e){res.status(500).json({error:'Kart bilgileri alınamadı'});}});
app.put('/api/card/me', cardPersonAuth, async (req,res)=>{
  try{
    const current=await getCardPerson(req.cardPerson.id); if(!current.id)return res.status(404).json({error:'Kart bulunamadı'});
    const data={...current.data};
    for(const k of CARD_PERSON_FIELDS){if(Object.prototype.hasOwnProperty.call(req.body||{},k)){if(current.permissions[k]!==true)return res.status(403).json({error:`${CARD_PERSON_LABELS[k]} alanı için admin izni gerekli`,permission:`card_${k}`});data[k]=String(req.body[k]??'').trim();}}
    const r=await pool.query(`UPDATE card_people SET data=$1::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id,slug,email,enabled,data,permissions`,[JSON.stringify(data),current.id]);
    res.json({person:normalizeCardPerson(r.rows[0])});
  }catch(e){res.status(500).json({error:'Kart bilgileri kaydedilemedi'});}
});

app.get('/card/:slug', async (req,res)=>{
  try{
    const r=await pool.query(`SELECT id,slug,enabled,data,permissions FROM card_people WHERE slug=$1 LIMIT 1`,[String(req.params.slug||'')]);
    if(!r.rows.length || r.rows[0].enabled!==true)return res.status(404).send('Business Card bulunamadı');
    return res.sendFile(path.join(__dirname,'public','business-card.html'));
  }catch(e){console.error('PUBLIC CARD ERROR:',e);res.status(500).send('Business Card açılamadı');}
});
app.get('/api/public-card/:slug', async (req,res)=>{
  try{
    const r=await pool.query(`SELECT id,slug,enabled,data,permissions FROM card_people WHERE slug=$1 LIMIT 1`,[String(req.params.slug||'')]);
    if(!r.rows.length || r.rows[0].enabled!==true)return res.status(404).json({error:'Business Card bulunamadı'});
    const p=normalizeCardPerson(r.rows[0]), filtered={};
    for(const k of CARD_PERSON_FIELDS) if(p.permissions[k]===true) filtered[k]=p.data[k];
    res.json({card:{slug:p.slug,enabled:true,data:filtered,permissions:p.permissions,field_labels:CARD_PERSON_LABELS}});
  }catch(e){res.status(500).json({error:'Business Card alınamadı'});}
});

app.get('/card-login',(req,res)=>res.sendFile(path.join(__dirname,'public','card-login.html')));
app.get('/card-dashboard',(req,res)=>res.sendFile(path.join(__dirname,'public','card-dashboard.html')));

/* =========================================================
   ADMIN BUSINESS ANALYTICS
========================================================= */

app.get(
  '/api/admin/business/:id/analytics',
  adminAuth,
  async (req, res) => {

    try {

      const businessId = Number(req.params.id);
      if (!Number.isInteger(businessId) || businessId <= 0) {
        return res.status(400).json({ error: 'Geçersiz işletme ID' });
      }

      const period = ['today','7d','30d','all'].includes(req.query.period)
        ? req.query.period
        : 'all';

      let periodWhere = 'business_id=$1';
      const params = [businessId];

      if (period === 'today') {
        periodWhere += ` AND created_at >= CURRENT_DATE`;
      } else if (period === '7d') {
        periodWhere += ` AND created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`;
      } else if (period === '30d') {
        periodWhere += ` AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`;
      }

      const totals = await pool.query(`
        SELECT
          COUNT(*)::int AS total_events,
          COUNT(*) FILTER (WHERE type='profile_view')::int AS profile_views,
          COUNT(*) FILTER (WHERE type='qr_scan')::int AS qr_scans,
          COUNT(*) FILTER (WHERE type='nfc')::int AS nfc_taps,
          COUNT(*) FILTER (WHERE type='phone')::int AS phone_clicks,
          COUNT(*) FILTER (WHERE type='whatsapp')::int AS whatsapp_clicks,
          COUNT(*) FILTER (WHERE type='instagram')::int AS instagram_clicks,
          COUNT(*) FILTER (WHERE type='tiktok')::int AS tiktok_clicks,
          COUNT(*) FILTER (WHERE type='google_review')::int AS google_review_clicks,
          COUNT(*) FILTER (WHERE type='website')::int AS website_clicks,
          COUNT(*) FILTER (WHERE type='menu')::int AS menu_clicks
        FROM events
        WHERE ${periodWhere}
      `, params);

      const daily = await pool.query(`
        SELECT
          DATE(created_at) AS date,
          COUNT(*) FILTER (WHERE type='profile_view')::int AS profile_views,
          COUNT(*) FILTER (WHERE type='qr_scan')::int AS qr_scans,
          COUNT(*) FILTER (WHERE type='nfc')::int AS nfc_taps,
          COUNT(*)::int AS total_events
        FROM events
        WHERE ${periodWhere}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
        LIMIT 366
      `, params);

      const hourly = await pool.query(`
        SELECT
          EXTRACT(HOUR FROM created_at)::int AS hour,
          COUNT(*)::int AS events,
          COUNT(*) FILTER (WHERE type='qr_scan')::int AS qr_scans,
          COUNT(*) FILTER (WHERE type='nfc')::int AS nfc_taps,
          COUNT(*) FILTER (WHERE type='profile_view')::int AS profile_views
        FROM events
        WHERE ${periodWhere}
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY hour ASC
      `, params);

      const eventTypes = await pool.query(`
        SELECT type, COUNT(*)::int AS count
        FROM events
        WHERE ${periodWhere}
        GROUP BY type
        ORDER BY count DESC, type ASC
      `, params);

      const topNfc = await pool.query(`
        SELECT
          t.id,
          t.name,
          t.placement,
          t.code,
          t.is_active,
          COUNT(e.id)::int AS taps,
          MAX(e.created_at) AS last_tap
        FROM nfc_tags t
        LEFT JOIN events e
          ON e.nfc_tag_id=t.id
          AND e.type='nfc'
          AND ${periodWhere.replace('business_id=$1', 'e.business_id=$1').replace('created_at', 'e.created_at')}
        WHERE t.business_id=$1
        GROUP BY t.id, t.name, t.placement, t.code, t.is_active
        ORDER BY taps DESC, t.id ASC
        LIMIT 10
      `, params);

      res.json({
        success: true,
        period,
        totals: totals.rows[0] || {},
        daily: daily.rows,
        hourly: hourly.rows,
        event_types: eventTypes.rows,
        top_nfc: topNfc.rows
      });

    } catch (error) {

      console.error('ADMIN ANALYTICS ERROR:', error);

      res.status(500).json({
        error: 'Analitik verileri alınamadı'
      });

    }

  }
);

/* ==================================================
   ADMIN NFC MANAGEMENT
================================================== */

/* =========================
   ADMIN NFC LIST
========================= */

app.get(
  '/api/admin/nfc-tags',
  adminAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(`
          SELECT

            n.id,
            n.business_id,
            n.name,
            n.placement,
            n.code,
            n.is_active,
            n.created_at,
            n.updated_at,

            b.name AS business_name,
            b.slug AS business_slug,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE
                e.nfc_tag_id = n.id
                AND e.type = 'nfc'
            ), 0)::int AS tap_count,

            (
              SELECT MAX(e.created_at)
              FROM events e
              WHERE
                e.nfc_tag_id = n.id
                AND e.type = 'nfc'
            ) AS last_tap

          FROM nfc_tags n

          INNER JOIN businesses b
            ON b.id = n.business_id

          ORDER BY
            n.id DESC
        `);

      const tags =
        result.rows.map(
          tag => ({

            ...tag,

            url:
              `${req.protocol}://${req.get('host')}/p/nfc/${tag.code}`

          })
        );

      res.json(tags);

    } catch (error) {

      console.error(
        'ADMIN NFC LIST ERROR:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'NFC etiketleri alınamadı'
        });

    }

  }
);


/* =========================
   ADMIN NFC CREATE
========================= */

app.post(
  '/api/admin/nfc-tags',
  adminAuth,
  async (req, res) => {

    try {

      const {
        business_id,
        name,
        placement
      } = req.body;

      if (!business_id) {

        return res
          .status(400)
          .json({
            error:
              'İşletme seçilmesi gerekli'
          });

      }

      const business =
        await pool.query(
          `
          SELECT
            id,
            name,
            slug
          FROM businesses
          WHERE id=$1
          `,
          [
            business_id
          ]
        );

      if (!business.rows.length) {

        return res
          .status(404)
          .json({
            error:
              'İşletme bulunamadı'
          });

      }

      const code =
        crypto
          .randomBytes(12)
          .toString('hex');

      const result =
        await pool.query(
          `
          INSERT INTO nfc_tags(
            business_id,
            name,
            placement,
            code,
            is_active
          )

          VALUES(
            $1,
            $2,
            $3,
            $4,
            true
          )

          RETURNING
            id,
            business_id,
            name,
            placement,
            code,
            is_active,
            created_at,
            updated_at
          `,
          [
            business_id,
            String(name || 'NFC Etiketi')
              .trim(),

            String(
              placement || 'Diğer'
            ).trim(),

            code
          ]
        );

      const tag =
        result.rows[0];

      res.status(201).json({

        ...tag,

        business_name:
          business.rows[0].name,

        business_slug:
          business.rows[0].slug,

        url:
          `${req.protocol}://${req.get('host')}/p/nfc/${tag.code}`

      });

    } catch (error) {

      console.error(
        'ADMIN NFC CREATE ERROR:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'NFC etiketi oluşturulamadı'
        });

    }

  }
);


/* =========================
   ADMIN NFC DETAIL
========================= */

app.get(
  '/api/admin/nfc-tags/:id',
  adminAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT

            n.id,
            n.business_id,
            n.name,
            n.placement,
            n.code,
            n.is_active,
            n.created_at,
            n.updated_at,

            b.name AS business_name,
            b.slug AS business_slug,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE
                e.nfc_tag_id = n.id
                AND e.type='nfc'
            ),0)::int AS tap_count,

            (
              SELECT MAX(e.created_at)
              FROM events e
              WHERE
                e.nfc_tag_id=n.id
                AND e.type='nfc'
            ) AS last_tap

          FROM nfc_tags n

          INNER JOIN businesses b
            ON b.id=n.business_id

          WHERE n.id=$1
          `,
          [
            req.params.id
          ]
        );

      if (!result.rows.length) {

        return res
          .status(404)
          .json({
            error:
              'NFC etiketi bulunamadı'
          });

      }

      const tag =
        result.rows[0];

      res.json({

        ...tag,

        url:
          `${req.protocol}://${req.get('host')}/p/nfc/${tag.code}`

      });

    } catch (error) {

      console.error(
        'ADMIN NFC DETAIL ERROR:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'NFC etiketi alınamadı'
        });

    }

  }
);


/* =========================
   ADMIN NFC UPDATE
========================= */

app.put(
  '/api/admin/nfc-tags/:id',
  adminAuth,
  async (req, res) => {

    try {

      const {
        name,
        placement,
        is_active
      } = req.body;

      const result =
        await pool.query(
          `
          UPDATE nfc_tags

          SET

            name =
              COALESCE($1, name),

            placement =
              COALESCE($2, placement),

            is_active =
              COALESCE($3, is_active),

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id=$4

          RETURNING
            id,
            business_id,
            name,
            placement,
            code,
            is_active,
            created_at,
            updated_at
          `,
          [
            name,
            placement,
            typeof is_active === 'boolean'
              ? is_active
              : null,
            req.params.id
          ]
        );

      if (!result.rows.length) {

        return res
          .status(404)
          .json({
            error:
              'NFC etiketi bulunamadı'
          });

      }

      const tag =
        result.rows[0];

      res.json({

        ...tag,

        url:
          `${req.protocol}://${req.get('host')}/p/nfc/${tag.code}`

      });

    } catch (error) {

      console.error(
        'ADMIN NFC UPDATE ERROR:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'NFC etiketi güncellenemedi'
        });

    }

  }
);


/* =========================
   ADMIN NFC DELETE
========================= */

app.delete(
  '/api/admin/nfc-tags/:id',
  adminAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          DELETE FROM nfc_tags

          WHERE id=$1

          RETURNING id
          `,
          [
            req.params.id
          ]
        );

      if (!result.rows.length) {

        return res
          .status(404)
          .json({
            error:
              'NFC etiketi bulunamadı'
          });

      }

      res.json({
        ok: true
      });

    } catch (error) {

      console.error(
        'ADMIN NFC DELETE ERROR:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'NFC etiketi silinemedi'
        });

    }

  }
);


/* =========================
   ADMIN NFC ANALYTICS
========================= */

app.get(
  '/api/admin/nfc-tags/:id/analytics',
  adminAuth,
  async (req, res) => {

    try {

      const tag =
        await pool.query(
          `
          SELECT
            n.id,
            n.name,
            n.placement,
            n.code,
            n.is_active,
            b.name AS business_name

          FROM nfc_tags n

          INNER JOIN businesses b
            ON b.id=n.business_id

          WHERE n.id=$1
          `,
          [
            req.params.id
          ]
        );

      if (!tag.rows.length) {

        return res
          .status(404)
          .json({
            error:
              'NFC etiketi bulunamadı'
          });

      }

      const totals =
        await pool.query(
          `
          SELECT

            COUNT(*)::int
              AS total_taps,

            COUNT(
              DISTINCT DATE(created_at)
            )::int
              AS active_days,

            MAX(created_at)
              AS last_tap

          FROM events

          WHERE
            nfc_tag_id=$1
            AND type='nfc'
          `,
          [
            req.params.id
          ]
        );

      const daily =
        await pool.query(
          `
          SELECT

            DATE(created_at)
              AS day,

            COUNT(*)::int
              AS taps

          FROM events

          WHERE
            nfc_tag_id=$1
            AND type='nfc'

          GROUP BY
            DATE(created_at)

          ORDER BY
            day DESC

          LIMIT 30
          `,
          [
            req.params.id
          ]
        );

      res.json({

        tag:
          tag.rows[0],

        totals:
          totals.rows[0],

        daily:
          daily.rows

      });

    } catch (error) {

      console.error(
        'ADMIN NFC ANALYTICS ERROR:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'NFC analizleri alınamadı'
        });

    }

  }
);

/* =========================================================
   ADMIN BUSINESS QR
========================================================= */

app.get(
  '/api/admin/business/:id/qr',
  adminAuth,
  async (req, res) => {

    try {

      const id = Number(req.params.id);

      const result = await pool.query(
        `
        SELECT slug
        FROM businesses
        WHERE id=$1
        `,
        [id]
      );

      if (!result.rows.length) {

        return res.status(404).json({
          error: 'İşletme bulunamadı'
        });

      }

      const baseUrl =
        process.env.PUBLIC_URL ||
        process.env.RENDER_EXTERNAL_URL ||
        `${req.protocol}://${req.get('host')}`;

      const url =
        `${baseUrl}/p/${result.rows[0].slug}?source=qr`;

      const qr =
        await QRCode.toDataURL(url, {
          width: 900,
          margin: 2,
          errorCorrectionLevel: 'H'
        });

      res.json({
        url,
        qr
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: 'QR oluşturulamadı'
      });

    }

  }
);


/* =========================================================
   ADMIN BUSINESS UPDATE
========================================================= */

app.put(
  '/api/admin/business/:id',
  adminAuth,
  async (req, res) => {

    try {

      const id = Number(req.params.id);

      const {
        name,
        category,
        description,
        phone,
        whatsapp,
        address,
        instagram,
        tiktok,
        google_review,
        website,
        menu,
        iban,
        iban_holder,
        hours,
        logo_url
      } = req.body;

      if (!name) {

        return res.status(400).json({
          error: 'İşletme adı gerekli'
        });

      }

      const current =
        await pool.query(
          `
          SELECT slug
          FROM businesses
          WHERE id=$1
          `,
          [id]
        );

      if (!current.rows.length) {

        return res.status(404).json({
          error: 'İşletme bulunamadı'
        });

      }

      await pool.query(
        `
        UPDATE businesses

        SET
          name=$1,
          category=$2,
          description=$3,
          phone=$4,
          whatsapp=$5,
          address=$6,
          instagram=$7,
          tiktok=$8,
          google_review=$9,
          website=$10,
          menu=$11,
          iban=$12,
          iban_holder=$13,
          hours=$14,
          logo_url=$15

        WHERE id=$16
        `,
        [
          name,
          category || '',
          description || '',
          phone || '',
          whatsapp || '',
          address || '',
          instagram || '',
          tiktok || '',
          google_review || '',
          website || '',
          menu || '',
          iban || '',
          iban_holder || '',
          hours || '',
          logo_url || '',
          id
        ]
      );

      const updated =
        await pool.query(
          `
          SELECT *
          FROM businesses
          WHERE id=$1
          `,
          [id]
        );

      res.json({
        business: publicBusiness(updated.rows[0])
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: 'İşletme güncellenemedi'
      });

    }

  }
);


/* =========================================================
   ADMIN BUSINESS DELETE
========================================================= */

app.delete(
  '/api/admin/business/:id',
  adminAuth,
  async (req, res) => {

    try {

      const id = Number(req.params.id);

      const result =
        await pool.query(
          `
          DELETE FROM businesses
          WHERE id=$1
          RETURNING id
          `,
          [id]
        );

      if (!result.rows.length) {

        return res.status(404).json({
          error: 'İşletme bulunamadı'
        });

      }

      res.json({
        success: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: 'İşletme silinemedi'
      });

    }

  }
);


/* =========================================================
   REGISTER
========================================================= */

app.post('/api/register', async (req, res) => {

  try {

    const {
      name,
      email,
      password,
      category
    } = req.body;

    if (
      !name ||
      !email ||
      !password ||
      password.length < 8
    ) {

      return res.status(400).json({
        error:
          'İşletme adı, e-posta ve 8+ karakter şifre gerekli'
      });

    }

    const normalizedEmail =
      String(email).trim().toLowerCase();

    const existing =
      await pool.query(
        `
        SELECT id
        FROM businesses
        WHERE email=$1
        `,
        [normalizedEmail]
      );

    if (existing.rows.length) {

      return res.status(409).json({
        error: 'E-posta zaten kayıtlı'
      });

    }

    const base =
      slugify(name) || 'business';

    let sl = base;
    let n = 1;

    while (true) {

      const check =
        await pool.query(
          `
          SELECT id
          FROM businesses
          WHERE slug=$1
          `,
          [sl]
        );

      if (!check.rows.length) {
        break;
      }

      n++;

      sl =
        `${base}-${n}`;
    }

    const passwordHash =
      await bcrypt.hash(
        password,
        12
      );

    const result =
      await pool.query(
        `
        INSERT INTO businesses(
          name,
          slug,
          email,
          password_hash,
          category
        )

        VALUES(
          $1,
          $2,
          $3,
          $4,
          $5
        )

        RETURNING *
        `,
        [
          name,
          sl,
          normalizedEmail,
          passwordHash,
          category || ''
        ]
      );

    const business =
      result.rows[0];

    const token =
      jwt.sign(
        {
          id: business.id,
          email: business.email,
          role: 'business'
        },
        SECRET,
        {
          expiresIn: '30d'
        }
      );

    res.status(201).json({
      token,
      business: publicBusiness(business)
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Kayıt sırasında hata oluştu'
    });

  }

});


/* =========================================================
   LOGIN
========================================================= */

app.post('/api/login', async (req, res) => {

  try {

    const {
      email,
      password
    } = req.body;

    if (!email || !password) {

      return res.status(400).json({
        error: 'E-posta ve şifre gerekli'
      });

    }

    const normalizedEmail =
      String(email).trim().toLowerCase();

    const result =
      await pool.query(
        `
        SELECT *
        FROM businesses
        WHERE email=$1
        `,
        [normalizedEmail]
      );

    if (!result.rows.length) {

      return res.status(401).json({
        error: 'E-posta veya şifre hatalı'
      });

    }

    const business =
      result.rows[0];

    const valid =
      await bcrypt.compare(
        password,
        business.password_hash
      );

    if (!valid) {

      return res.status(401).json({
        error: 'E-posta veya şifre hatalı'
      });

    }

    const token =
      jwt.sign(
        {
          id: business.id,
          email: business.email,
          role: 'business'
        },
        SECRET,
        {
          expiresIn: '30d'
        }
      );

    res.json({
      token,
      business: {
        ...publicBusiness(business),
        permissions: businessPermissions(business)
      }
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Giriş sırasında hata oluştu'
    });

  }

});


/* =========================================================
   ME
========================================================= */

app.get('/api/me', auth, async (req, res) => {

  try {

    let result =
      await pool.query(
        `
        SELECT *
        FROM businesses
        WHERE id=$1
        `,
        [req.user.id]
      );

    /* Eski oturumlarda ID değişmiş olabileceği için e-posta ile güvenli geri dönüş. */
    if (!result.rows.length && req.user.email) {
      result = await pool.query(
        `
        SELECT *
        FROM businesses
        WHERE email=$1
        LIMIT 1
        `,
        [String(req.user.email).trim().toLowerCase()]
      );
    }

    if (!result.rows.length) {
      return res.status(404).json({
        error: 'İşletme bulunamadı'
      });
    }

    const business = result.rows[0];

    res.json({
      ...publicBusiness(business),
      permissions: businessPermissions(business)
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Profil alınamadı'
    });

  }

});


/* =========================================================
   UPDATE ME
========================================================= */

app.put('/api/me', auth, requireBusinessPermission('profile'), async (req, res) => {
  try {
    let currentResult = await pool.query(
      `SELECT * FROM businesses WHERE id=$1 LIMIT 1`,
      [req.user.id]
    );

    if (!currentResult.rows.length && req.user.email) {
      currentResult = await pool.query(
        `SELECT * FROM businesses WHERE email=$1 LIMIT 1`,
        [String(req.user.email).trim().toLowerCase()]
      );
    }

    if (!currentResult.rows.length) {
      return res.status(404).json({ error: 'İşletme bulunamadı' });
    }

    const current = currentResult.rows[0];
    const permissions = businessProfileFieldPermissions(current);
    const body = req.body || {};

    const valueFor = (key) => {
      if (permissions[key] && Object.prototype.hasOwnProperty.call(body, key)) {
        return String(body[key] ?? '').trim();
      }
      return String(current[key] ?? '');
    };

    const values = {};
    for (const key of BUSINESS_PROFILE_FIELDS) values[key] = valueFor(key);

    if (!values.name) {
      return res.status(400).json({ error: 'İşletme adı gerekli' });
    }

    await pool.query(
      `UPDATE businesses SET
        name=$1, category=$2, description=$3, phone=$4, whatsapp=$5,
        address=$6, instagram=$7, tiktok=$8, google_review=$9,
        website=$10, menu=$11, iban=$12, iban_holder=$13,
        hours=$14, logo_url=$15
       WHERE id=$16`,
      [
        values.name, values.category, values.description, values.phone,
        values.whatsapp, values.address, values.instagram, values.tiktok,
        values.google_review, values.website, values.menu, values.iban,
        values.iban_holder, values.hours, values.logo_url, current.id
      ]
    );

    const result = await pool.query(
      `SELECT * FROM businesses WHERE id=$1`,
      [current.id]
    );

    res.json({
      ...publicBusiness(result.rows[0]),
      permissions: businessPermissions(result.rows[0])
    });
  } catch (error) {
    console.error('BUSINESS PROFILE UPDATE ERROR:', error);
    res.status(500).json({ error: 'Profil güncellenemedi' });
  }
});


/* =========================================================
   V2 FINAL — THEME + SOCIAL/DIGITAL LINKS
========================================================= */

app.get('/api/business-v2-settings', auth, requireBusinessPermission('profile'), async (req,res)=>{
  try{
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma','no-cache');
    res.set('Expires','0');
    const r=await pool.query(`SELECT id,profile_theme_permission,social_links,custom_links,social_platform_permissions FROM businesses WHERE id=$1 LIMIT 1`,[req.user.id]);
    if(!r.rows.length) return res.status(404).json({error:'İşletme bulunamadı'});
    const d=await pool.query(`SELECT theme,accent_color FROM profile_designs WHERE business_id=$1 LIMIT 1`,[req.user.id]);
    const design=d.rows[0]||{};
    const theme=LEO_V2_THEMES[design.theme] ? design.theme : 'midnight-gold';
    res.json({theme,themes:LEO_V2_THEMES,theme_permission:r.rows[0].profile_theme_permission!==false,accent_color:design.accent_color||'#D4AF37',social_links:normalizeSocialLinks(r.rows[0].social_links),custom_links:normalizeCustomLinks(r.rows[0].custom_links),allowed_platforms:normalizeAllowedPlatforms(r.rows[0].social_platform_permissions)});
  }catch(e){console.error('V2 SETTINGS GET ERROR:',e);res.status(500).json({error:'Profil ayarları alınamadı'});}
});

app.put('/api/business-theme', auth, requireBusinessPermission('profile'), async (req,res)=>{
  try{
    const b=await pool.query(`SELECT profile_theme_permission FROM businesses WHERE id=$1 LIMIT 1`,[req.user.id]);
    if(!b.rows.length) return res.status(404).json({error:'İşletme bulunamadı'});
    if(b.rows[0].profile_theme_permission===false) return res.status(403).json({error:'Tema değiştirme yetkisi admin tarafından kapatıldı'});
    const theme=String(req.body?.theme||'').trim();
    if(!LEO_V2_THEMES[theme]) return res.status(400).json({error:'Geçersiz tema'});
    const accent=String(req.body?.accent_color||'').trim().slice(0,30)||'#D4AF37';
    const r=await pool.query(`INSERT INTO profile_designs(business_id,theme,accent_color,updated_at) VALUES($1,$2,$3,CURRENT_TIMESTAMP) ON CONFLICT(business_id) DO UPDATE SET theme=EXCLUDED.theme,accent_color=EXCLUDED.accent_color,updated_at=CURRENT_TIMESTAMP RETURNING theme,accent_color`,[req.user.id,theme,accent]);
    res.json({theme:r.rows[0].theme,accent_color:r.rows[0].accent_color,theme_name:LEO_V2_THEMES[r.rows[0].theme].name});
  }catch(e){console.error('BUSINESS THEME UPDATE ERROR:',e);res.status(500).json({error:'Tema kaydedilemedi'});}
});

app.put('/api/business-social-links', auth, requireBusinessPermission('profile'), async (req,res)=>{
  try{
    const b=await pool.query(`SELECT social_platform_permissions FROM businesses WHERE id=$1 LIMIT 1`,[req.user.id]);
    if(!b.rows.length) return res.status(404).json({error:'İşletme bulunamadı'});
    const allowed=normalizeAllowedPlatforms(b.rows[0].social_platform_permissions);
    const incoming=normalizeSocialLinks(req.body?.social_links||req.body);
    const existing=normalizeSocialLinks(b.rows[0].social_links);
    const links={...existing};
    for(const key of Object.keys(incoming)){
      if(allowed[key]!==false) links[key]=incoming[key];
    }
    const r=await pool.query(`UPDATE businesses SET social_links=$1::jsonb WHERE id=$2 RETURNING social_links`,[JSON.stringify(links),req.user.id]);
    if(!r.rows.length) return res.status(404).json({error:'İşletme bulunamadı'});
    res.json({social_links:normalizeSocialLinks(r.rows[0].social_links)});
  }catch(e){console.error('SOCIAL LINKS UPDATE ERROR:',e);res.status(500).json({error:'Bağlantılar kaydedilemedi'});}
});

app.put('/api/business-custom-links', auth, requireBusinessPermission('profile'), async (req,res)=>{
  try{
    const links=normalizeCustomLinks(req.body?.custom_links);
    const r=await pool.query(`UPDATE businesses SET custom_links=$1::jsonb WHERE id=$2 RETURNING custom_links`,[JSON.stringify(links),req.user.id]);
    if(!r.rows.length) return res.status(404).json({error:'İşletme bulunamadı'});
    res.json({custom_links:normalizeCustomLinks(r.rows[0].custom_links)});
  }catch(e){console.error('CUSTOM LINKS UPDATE ERROR:',e);res.status(500).json({error:'Özel bağlantılar kaydedilemedi'});}
});

app.get('/api/admin/business/:id/v2-settings', adminAuth, async (req,res)=>{
  try{
    const id=Number(req.params.id);
    const r=await pool.query(`SELECT b.id,b.name,b.profile_theme_permission,b.social_links,b.custom_links,b.social_platform_permissions,COALESCE(pd.theme,'midnight-gold') theme,COALESCE(pd.accent_color,'#D4AF37') accent_color FROM businesses b LEFT JOIN profile_designs pd ON pd.business_id=b.id WHERE b.id=$1 LIMIT 1`,[id]);
    if(!r.rows.length) return res.status(404).json({error:'İşletme bulunamadı'});
    const row=r.rows[0];
    res.json({id:row.id,name:row.name,theme:LEO_V2_THEMES[row.theme]?row.theme:'midnight-gold',themes:LEO_V2_THEMES,theme_permission:row.profile_theme_permission!==false,accent_color:row.accent_color,social_links:normalizeSocialLinks(row.social_links),custom_links:normalizeCustomLinks(row.custom_links),allowed_platforms:normalizeAllowedPlatforms(row.social_platform_permissions)});
  }catch(e){console.error('ADMIN V2 SETTINGS GET ERROR:',e);res.status(500).json({error:'V2 ayarları alınamadı'});}
});

app.put('/api/admin/business/:id/theme', adminAuth, async (req,res)=>{
  try{
    const id=Number(req.params.id), theme=String(req.body?.theme||'').trim();
    if(!LEO_V2_THEMES[theme]) return res.status(400).json({error:'Geçersiz tema'});
    const accent=String(req.body?.accent_color||'').trim().slice(0,30)||'#D4AF37';
    const r=await pool.query(`INSERT INTO profile_designs(business_id,theme,accent_color,updated_at) VALUES($1,$2,$3,CURRENT_TIMESTAMP) ON CONFLICT(business_id) DO UPDATE SET theme=EXCLUDED.theme,accent_color=EXCLUDED.accent_color,updated_at=CURRENT_TIMESTAMP RETURNING theme,accent_color`,[id,theme,accent]);
    res.json({theme:r.rows[0].theme,accent_color:r.rows[0].accent_color,theme_name:LEO_V2_THEMES[r.rows[0].theme].name});
  }catch(e){console.error('ADMIN THEME UPDATE ERROR:',e);res.status(500).json({error:'Tema kaydedilemedi'});}
});

app.put('/api/admin/business/:id/theme-permission', adminAuth, async (req,res)=>{
  try{
    const id=Number(req.params.id), allowed=req.body?.allowed!==false;
    const r=await pool.query(`UPDATE businesses SET profile_theme_permission=$1 WHERE id=$2 RETURNING id,name,profile_theme_permission`,[allowed,id]);
    if(!r.rows.length) return res.status(404).json({error:'İşletme bulunamadı'});
    res.json({id:r.rows[0].id,name:r.rows[0].name,theme_permission:r.rows[0].profile_theme_permission!==false});
  }catch(e){console.error('ADMIN THEME PERMISSION ERROR:',e);res.status(500).json({error:'Tema yetkisi kaydedilemedi'});}
});

app.put('/api/admin/business/:id/social-platform-permissions', adminAuth, async (req,res)=>{
  try{
    const id=Number(req.params.id);
    const allowed=normalizeAllowedPlatforms(req.body?.allowed_platforms||req.body);
    const r=await pool.query(`UPDATE businesses SET social_platform_permissions=$1::jsonb WHERE id=$2 RETURNING id,name,social_platform_permissions`,[JSON.stringify(allowed),id]);
    if(!r.rows.length) return res.status(404).json({error:'İşletme bulunamadı'});
    res.json({id:r.rows[0].id,name:r.rows[0].name,allowed_platforms:normalizeAllowedPlatforms(r.rows[0].social_platform_permissions)});
  }catch(e){console.error('ADMIN SOCIAL PLATFORM PERMISSION ERROR:',e);res.status(500).json({error:'Bağlantı yetkileri kaydedilemedi'});}
});


/* =========================================================
   QR
========================================================= */

app.get('/api/qr', auth, requireBusinessPermission('qr'), async (req, res) => {

  try {

    const result =
      await pool.query(
        `
        SELECT slug
        FROM businesses
        WHERE id=$1
        `,
        [req.user.id]
      );

    if (!result.rows.length) {

      return res.status(404).json({
        error: 'İşletme bulunamadı'
      });

    }

    const baseUrl =
      process.env.PUBLIC_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      `${req.protocol}://${req.get('host')}`;

    const url =
      `${baseUrl}/p/${result.rows[0].slug}?source=qr`;

    const qr =
      await QRCode.toDataURL(
        url,
        {
          width: 900,
          margin: 2,
          errorCorrectionLevel: 'H'
        }
      );

    res.json({
      url,
      qr
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'QR oluşturulamadı'
    });

  }

});


/* =========================================================
   BUSINESS CENTER ANALYTICS V3
========================================================= */

app.get('/api/business-analytics', auth, requireBusinessPermission('analytics'), async (req, res) => {
  try {
    const period = ['today','7d','30d','all'].includes(req.query.period) ? req.query.period : '7d';
    let where = "business_id=$1 AND type <> 'campaign_view'";
    if (period === 'today') where += " AND created_at >= CURRENT_DATE";
    if (period === '7d') where += " AND created_at >= NOW() - INTERVAL '7 days'";
    if (period === '30d') where += " AND created_at >= NOW() - INTERVAL '30 days'";

    const totals = await pool.query(`
      SELECT
        COUNT(*)::int AS total_events,
        COUNT(*) FILTER (WHERE type='profile_view')::int AS profile_views,
        COUNT(*) FILTER (WHERE type IN ('qr_scan','qr'))::int AS qr_scans,
        COUNT(*) FILTER (WHERE type='nfc')::int AS nfc_taps,
        COUNT(*) FILTER (WHERE type='phone')::int AS phone_clicks,
        COUNT(*) FILTER (WHERE type='whatsapp')::int AS whatsapp_clicks,
        COUNT(*) FILTER (WHERE type='instagram')::int AS instagram_clicks,
        COUNT(*) FILTER (WHERE type='tiktok')::int AS tiktok_clicks,
        COUNT(*) FILTER (WHERE type='google_review')::int AS google_review_clicks,
        COUNT(*) FILTER (WHERE type='website')::int AS website_clicks,
        COUNT(*) FILTER (WHERE type='menu')::int AS menu_clicks
      FROM events WHERE ${where}`,[req.user.id]);

    const daily = await pool.query(`
      SELECT TO_CHAR(created_at::date,'YYYY-MM-DD') AS day,
        COUNT(*)::int AS events,
        COUNT(*) FILTER (WHERE type='profile_view')::int AS profile_views,
        COUNT(*) FILTER (WHERE type IN ('qr_scan','qr'))::int AS qr_scans,
        COUNT(*) FILTER (WHERE type='nfc')::int AS nfc_taps
      FROM events WHERE ${where}
      GROUP BY created_at::date ORDER BY created_at::date ASC`,[req.user.id]);

    const hourly = await pool.query(`
      SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS events
      FROM events WHERE ${where}
      GROUP BY EXTRACT(HOUR FROM created_at) ORDER BY hour ASC`,[req.user.id]);

    const actions = await pool.query(`
      SELECT type, COUNT(*)::int AS count FROM events
      WHERE ${where} GROUP BY type ORDER BY count DESC`,[req.user.id]);

    const tags = await pool.query(`
      SELECT
        n.id,
        n.name,
        n.code,
        n.placement,
        COALESCE(SUM(CASE WHEN e.type='qr_scan' THEN 1 ELSE 0 END),0)::int AS qr_count,
        COALESCE(SUM(CASE WHEN e.type='nfc' THEN 1 ELSE 0 END),0)::int AS nfc_count,
        COUNT(e.id)::int AS total_count,
        MAX(e.created_at) AS last_tap
      FROM nfc_tags n
      LEFT JOIN events e
        ON e.nfc_tag_id = n.id
       AND e.type <> 'campaign_view'
      WHERE n.business_id=$1
      GROUP BY n.id,n.name,n.code,n.placement,n.created_at
      ORDER BY total_count DESC, n.created_at DESC
      LIMIT 50`,[req.user.id]);

    res.json({period, totals: totals.rows[0], daily: daily.rows, hourly: hourly.rows, actions: actions.rows, top_nfc: tags.rows, table_reports: tags.rows});
  } catch(error) {
    console.error('BUSINESS ANALYTICS V3 ERROR:', error);
    res.status(500).json({error:'Analiz verileri alınamadı'});
  }
});


/* =========================================================
   BUSINESS LIVE ACTIVITY — PERMISSION CONTROLLED
========================================================= */
app.get('/api/business-live-activity', auth, requireBusinessPermission('live'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 5), 50);
    const result = await pool.query(`
      SELECT e.id, e.type, e.source, e.nfc_tag_id, e.created_at,
             t.name AS nfc_name, t.placement AS nfc_placement
      FROM events e
      LEFT JOIN nfc_tags t ON t.id=e.nfc_tag_id
      WHERE e.business_id=$1
        AND e.type <> 'campaign_view'
      ORDER BY e.created_at DESC
      LIMIT $2
    `, [req.user.id, limit]);
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '15 minutes')::int AS last_15m,
        COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '60 minutes')::int AS last_60m,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today
      FROM events WHERE business_id=$1 AND type <> 'campaign_view'
    `, [req.user.id]);
    res.json({activities: result.rows, stats: stats.rows[0] || {last_15m:0,last_60m:0,today:0}});
  } catch(error) {
    console.error('BUSINESS LIVE ERROR:', error);
    res.status(500).json({error:'Canlı aktivite alınamadı'});
  }
});

/* =========================================================
   LEO AI INSIGHTS V1 — DATA-DRIVEN BUSINESS REPORTING
   Rule-based insight engine; no external AI API required.
========================================================= */
app.get('/api/business-ai-insights', auth, requireBusinessPermission('ai'), async (req, res) => {
  try {
    const period = ['today','7d','30d','all'].includes(req.query.period) ? req.query.period : '7d';
    let where = "business_id=$1 AND type <> 'campaign_view'";
    if (period === 'today') where += " AND created_at >= CURRENT_DATE";
    if (period === '7d') where += " AND created_at >= NOW() - INTERVAL '7 days'";
    if (period === '30d') where += " AND created_at >= NOW() - INTERVAL '30 days'";
    const params=[req.user.id];
    const totalsQ=await pool.query(`SELECT
      COUNT(*)::int total_events,
      COUNT(*) FILTER(WHERE type='profile_view')::int profile_views,
      COUNT(*) FILTER(WHERE type IN ('qr_scan','qr'))::int qr,
      COUNT(*) FILTER(WHERE type='nfc')::int nfc,
      COUNT(*) FILTER(WHERE type='whatsapp')::int whatsapp,
      COUNT(*) FILTER(WHERE type='phone')::int phone,
      COUNT(*) FILTER(WHERE type='instagram')::int instagram,
      COUNT(*) FILTER(WHERE type='tiktok')::int tiktok,
      COUNT(*) FILTER(WHERE type='google_review')::int google_review,
      COUNT(*) FILTER(WHERE type='website')::int website,
      COUNT(*) FILTER(WHERE type='menu')::int menu,
      COUNT(*) FILTER(WHERE type='location')::int location,
      COUNT(*) FILTER(WHERE type='share')::int share
      FROM events WHERE ${where}`,params);
    const hourlyQ=await pool.query(`SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS events FROM events WHERE ${where} GROUP BY 1 ORDER BY events DESC LIMIT 1`,params);
    const actionsQ=await pool.query(`SELECT type, COUNT(*)::int count FROM events WHERE ${where} GROUP BY type ORDER BY count DESC LIMIT 5`,params);
    const sourceQ=await pool.query(`SELECT COALESCE(NULLIF(source,''),'direct') source, COUNT(*)::int count FROM events WHERE ${where} GROUP BY 1 ORDER BY count DESC`,params);
    const t=totalsQ.rows[0]||{};
    const n=k=>Number(t[k]||0);
    const profile=n('profile_views'), total=n('total_events'), digital=n('qr')+n('nfc'), contact=n('whatsapp')+n('phone');
    const actionTotal=Math.max(0,total-profile);
    const conversion=profile?Math.min(100,actionTotal/profile*100):0;
    let score=0;
    if(profile>=20) score+=20; else if(profile>0) score+=10;
    if(digital>=10) score+=20; else if(digital>0) score+=10;
    if(contact>=5) score+=20; else if(contact>0) score+=10;
    if(actionTotal>=20) score+=20; else if(actionTotal>0) score+=10;
    if((n('whatsapp')+n('phone')+n('instagram')+n('google_review'))>0) score+=20;
    const peak=hourlyQ.rows[0]||null;
    const top=actionsQ.rows[0]||null;
    const strongestSource=sourceQ.rows[0]||null;
    const insights=[]; const recommendations=[];
    if(!total){ insights.push('Henüz yeterli etkileşim verisi oluşmadı.'); recommendations.push('Profil bağlantısını QR ve NFC noktalarında daha görünür hale getir.'); }
    else {
      if(n('nfc')>n('qr') && digital>0) insights.push(`NFC, QR'a göre daha güçlü dijital temas kanalı olmuş (${n('nfc')} vs ${n('qr')}).`);
      else if(n('qr')>n('nfc') && digital>0) insights.push(`QR, NFC'ye göre daha fazla dijital temas üretmiş (${n('qr')} vs ${n('nfc')}).`);
      if(contact>0) insights.push(`Müşteriler ${contact} kez doğrudan iletişim aksiyonu gerçekleştirmiş.`);
      if(peak) insights.push(`En yoğun saat ${String(Number(peak.hour)).padStart(2,'0')}:00 civarı; ${peak.events} etkileşim kaydedilmiş.`);
      if(top) insights.push(`En sık kullanılan aksiyon: ${top.type} (${top.count}).`);
      if(conversion<10 && profile>=10) recommendations.push('Profil ziyaretinden iletişime geçişi artırmak için WhatsApp ve telefon CTA\'larını daha görünür konumlandır.');
      if(n('nfc')===0 && n('qr')>0) recommendations.push('NFC noktaları eklemek, QR dışında fiziksel temas kanalı oluşturabilir.');
      if(n('qr')===0 && n('nfc')>0) recommendations.push('QR kodu menü, masa, vitrin veya kartvizitte görünür hale getir.');
      if(n('google_review')===0 && profile>=20) recommendations.push('Google yorum bağlantısını görünür bir aksiyon olarak öne çıkar.');
      if(!recommendations.length) recommendations.push('Mevcut en güçlü kanalı koru ve yoğun saatlerde görünürlüğü artır.');
    }
    const title=score>=80?'Mükemmel performans':score>=60?'Güçlü performans':score>=40?'Gelişen performans':score>=20?'Veri oluşuyor':'Başlangıç aşaması';
    res.json({period, generated_at:new Date().toISOString(), score, title, totals:t, conversion:Math.round(conversion*10)/10, peak_hour:peak, strongest_action:top, strongest_source:strongestSource, insights, recommendations});
  } catch(error) {
    console.error('BUSINESS AI INSIGHTS ERROR:', error);
    res.status(500).json({error:'AI içgörü raporu oluşturulamadı'});
  }
});

/* =========================================================
   STATS
========================================================= */

app.get('/api/stats', auth, async (req, res) => {

  try {

    const result =
      await pool.query(
        `
        SELECT
          COUNT(*) FILTER(WHERE type <> 'campaign_view')::int AS total_events,

          COUNT(*) FILTER(
            WHERE type='profile_view'
          )::int AS profile_views,

          COUNT(*) FILTER(
            WHERE type IN ('qr_scan','qr')
          )::int AS qr_scans,

          COUNT(*) FILTER(
            WHERE type='nfc'
          )::int AS nfc_scans,

          COUNT(*) FILTER(
            WHERE type='whatsapp'
          )::int AS whatsapp_clicks,

          COUNT(*) FILTER(
            WHERE type='phone'
          )::int AS phone_clicks,

          COUNT(*) FILTER(
            WHERE type='instagram'
          )::int AS instagram_clicks,

          COUNT(*) FILTER(
            WHERE type='tiktok'
          )::int AS tiktok_clicks,

          COUNT(*) FILTER(
            WHERE type='website'
          )::int AS website_clicks,

          COUNT(*) FILTER(
            WHERE type='menu'
          )::int AS menu_clicks,

          COUNT(*) FILTER(
            WHERE type='google_review'
          )::int AS google_review_clicks

        FROM events

        WHERE business_id=$1
        `,
        [req.user.id]
      );

    const tags =
      await pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM nfc_tags
        WHERE business_id=$1
        `,
        [req.user.id]
      );

    res.json({
      ...result.rows[0],
      nfc_tags: tags.rows[0].count
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'İstatistikler alınamadı'
    });

  }

});


/* =========================================================
   EVENT
========================================================= */

app.post('/api/event/:slug', async (req, res) => {

  try {

    const slug =
      String(req.params.slug || '');

    const type =
      String(req.body.type || '');

    const source =
      String(req.body.source || '').toLowerCase();

    const nfcCode =
      String(req.body.nfc_code || '').trim();

    const allowedTypes = [
      'profile_view',
      'qr_scan',
      'qr',
      'nfc',
      'whatsapp',
      'phone',
      'instagram',
      'tiktok',
      'website',
      'menu',
      'google_review',
      'review_open',
      'review_positive',
      'review_feedback',
      'campaign_view',
      'campaign_click',
      'location',
      'iban',
      'share'
    ];

    const allowedSources = ['', 'direct', 'qr', 'nfc'];

    if (!allowedTypes.includes(type)) {

      return res.status(400).json({
        error: 'Geçersiz event tipi'
      });

    }

    if (!allowedSources.includes(source)) {
      return res.status(400).json({
        error: 'Geçersiz kaynak'
      });
    }

    const business =
      await pool.query(
        `
        SELECT id
        FROM businesses
        WHERE slug=$1
        `,
        [slug]
      );

    if (!business.rows.length) {

      return res.status(404).json({
        error: 'İşletme bulunamadı'
      });

    }

    let nfcTagId = null;

    if (source === 'nfc') {
      if (!nfcCode) {
        return res.status(400).json({
          error: 'NFC kodu gerekli'
        });
      }

      const tag = await pool.query(
        `
        SELECT id
        FROM nfc_tags
        WHERE code=$1
          AND business_id=$2
          AND is_active=TRUE
        LIMIT 1
        `,
        [nfcCode, business.rows[0].id]
      );

      if (!tag.rows.length) {
        return res.status(400).json({
          error: 'NFC etiketi doğrulanamadı'
        });
      }

      nfcTagId = tag.rows[0].id;
    }

    await pool.query(
      `
      INSERT INTO events(
        business_id,
        type,
        source,
        nfc_tag_id
      )

      VALUES(
        $1,
        $2,
        $3,
        $4
      )
      `,
      [
        business.rows[0].id,
        type,
        source,
        nfcTagId
      ]
    );

    res.json({
      success: true
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Event kaydedilemedi'
    });

  }

});



/* =========================================================
   V2 — DYNAMIC PROFILE DESIGN API
========================================================= */

app.get('/api/business-profile-design', auth, requireBusinessPermission('profile'), async (req, res) => {
  try {
    let result = await pool.query(
      `SELECT * FROM profile_designs WHERE business_id=$1 LIMIT 1`,
      [req.user.id]
    );

    if (!result.rows.length) {
      result = await pool.query(
        `INSERT INTO profile_designs(business_id) VALUES($1) RETURNING *`,
        [req.user.id]
      );
    }

    res.json(normalizeProfileDesign(result.rows[0]));
  } catch (error) {
    console.error('BUSINESS PROFILE DESIGN GET ERROR:', error);
    res.status(500).json({ error: 'Profil tasarım ayarları alınamadı' });
  }
});

app.put('/api/business-profile-design', auth, requireBusinessPermission('profile'), async (req, res) => {
  try {
    const body = req.body || {};
    const str = (value, max) => String(value ?? '').trim().slice(0, max);
    const gallery = Array.isArray(body.gallery)
      ? body.gallery.slice(0, 30).map(item => {
          if (typeof item === 'string') return str(item, 2000);
          if (item && typeof item === 'object') {
            return { url: str(item.url, 2000), title: str(item.title, 200) };
          }
          return '';
        }).filter(Boolean)
      : [];

    const values = [
      req.user.id,
      str(body.theme, 80) || DYNAMIC_PROFILE_DEFAULTS.theme,
      str(body.accent_color, 30) || DYNAMIC_PROFILE_DEFAULTS.accent_color,
      str(body.cover_url, 2000),
      str(body.cover_position, 50) || 'center',
      str(body.announcement_text, 1000),
      body.announcement_enabled === true,
      str(body.campaign_title, 200),
      str(body.campaign_text, 2000),
      str(body.campaign_image_url, 2000),
      str(body.campaign_button_text, 100),
      str(body.campaign_button_url, 2000),
      body.campaign_enabled === true,
      str(body.featured_title, 200),
      str(body.featured_text, 2000),
      str(body.featured_image_url, 2000),
      str(body.featured_button_text, 100),
      str(body.featured_button_url, 2000),
      body.featured_enabled === true,
      JSON.stringify(gallery),
      str(body.video_url, 2000),
      body.video_enabled === true
    ];

    const result = await pool.query(`
      INSERT INTO profile_designs(
        business_id,theme,accent_color,cover_url,cover_position,
        announcement_text,announcement_enabled,
        campaign_title,campaign_text,campaign_image_url,campaign_button_text,campaign_button_url,campaign_enabled,
        featured_title,featured_text,featured_image_url,featured_button_text,featured_button_url,featured_enabled,
        gallery,video_url,video_enabled,updated_at
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,CURRENT_TIMESTAMP)
      ON CONFLICT(business_id) DO UPDATE SET
        theme=EXCLUDED.theme,
        accent_color=EXCLUDED.accent_color,
        cover_url=EXCLUDED.cover_url,
        cover_position=EXCLUDED.cover_position,
        announcement_text=EXCLUDED.announcement_text,
        announcement_enabled=EXCLUDED.announcement_enabled,
        campaign_title=EXCLUDED.campaign_title,
        campaign_text=EXCLUDED.campaign_text,
        campaign_image_url=EXCLUDED.campaign_image_url,
        campaign_button_text=EXCLUDED.campaign_button_text,
        campaign_button_url=EXCLUDED.campaign_button_url,
        campaign_enabled=EXCLUDED.campaign_enabled,
        featured_title=EXCLUDED.featured_title,
        featured_text=EXCLUDED.featured_text,
        featured_image_url=EXCLUDED.featured_image_url,
        featured_button_text=EXCLUDED.featured_button_text,
        featured_button_url=EXCLUDED.featured_button_url,
        featured_enabled=EXCLUDED.featured_enabled,
        gallery=EXCLUDED.gallery,
        video_url=EXCLUDED.video_url,
        video_enabled=EXCLUDED.video_enabled,
        updated_at=CURRENT_TIMESTAMP
      RETURNING *
    `, values);

    res.json(normalizeProfileDesign(result.rows[0]));
  } catch (error) {
    console.error('BUSINESS PROFILE DESIGN UPDATE ERROR:', error);
    res.status(500).json({ error: 'Profil tasarım ayarları kaydedilemedi' });
  }
});


/* =========================================================
   V2 — SMART CAMPAIGNS API
========================================================= */
function normalizeCampaign(row){
  if(!row) return null;
  return {
    id:row.id,
    business_id:row.business_id,
    title:String(row.title||''),
    text:String(row.text||''),
    image_url:String(row.image_url||''),
    button_text:String(row.button_text||''),
    button_url:String(row.button_url||''),
    starts_at:row.starts_at||null,
    ends_at:row.ends_at||null,
    enabled:row.enabled===true,
    priority:Number(row.priority||0),
    created_at:row.created_at||null,
    updated_at:row.updated_at||null
  };
}

async function getActiveCampaigns(businessId){
  const r=await pool.query(`
    SELECT * FROM campaigns
    WHERE business_id=$1
      AND enabled=TRUE
      AND (starts_at IS NULL OR starts_at<=CURRENT_TIMESTAMP)
      AND (ends_at IS NULL OR ends_at>=CURRENT_TIMESTAMP)
    ORDER BY priority DESC, created_at DESC
    LIMIT 5
  `,[businessId]);
  return r.rows.map(normalizeCampaign);
}

app.get('/api/business-campaigns', auth, requireBusinessPermission('campaign'), async (req,res)=>{
  try{
    const r=await pool.query(`SELECT * FROM campaigns WHERE business_id=$1 ORDER BY enabled DESC, priority DESC, created_at DESC`,[req.user.id]);
    res.json({campaigns:r.rows.map(normalizeCampaign)});
  }catch(e){console.error('CAMPAIGNS LIST ERROR:',e);res.status(500).json({error:'Kampanyalar alınamadı'});}
});

app.post('/api/business-campaigns', auth, requireBusinessPermission('campaign'), async (req,res)=>{
  try{
    const b=req.body||{};
    const title=String(b.title||'').trim().slice(0,120);
    if(!title)return res.status(400).json({error:'Kampanya başlığı gerekli'});
    const text=String(b.text||'').trim().slice(0,500);
    const image_url=String(b.image_url||'').trim().slice(0,1000);
    const button_text=String(b.button_text||'').trim().slice(0,60);
    const button_url=String(b.button_url||'').trim().slice(0,1000);
    const starts_at=b.starts_at?new Date(b.starts_at):null;
    const ends_at=b.ends_at?new Date(b.ends_at):null;
    if(starts_at && Number.isNaN(starts_at.getTime()))return res.status(400).json({error:'Başlangıç tarihi geçersiz'});
    if(ends_at && Number.isNaN(ends_at.getTime()))return res.status(400).json({error:'Bitiş tarihi geçersiz'});
    if(starts_at && ends_at && starts_at>ends_at)return res.status(400).json({error:'Bitiş tarihi başlangıçtan önce olamaz'});
    const priority=Math.max(-100,Math.min(100,Number(b.priority)||0));
    const r=await pool.query(`INSERT INTO campaigns(business_id,title,text,image_url,button_text,button_url,starts_at,ends_at,enabled,priority,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP) RETURNING *`,[req.user.id,title,text,image_url,button_text,button_url,starts_at,ends_at,b.enabled!==false,priority]);
    res.status(201).json({campaign:normalizeCampaign(r.rows[0])});
  }catch(e){console.error('CAMPAIGN CREATE ERROR:',e);res.status(500).json({error:'Kampanya oluşturulamadı'});}
});

app.put('/api/business-campaigns/:id', auth, requireBusinessPermission('campaign'), async (req,res)=>{
  try{
    const id=Number(req.params.id), b=req.body||{};
    const existing=await pool.query(`SELECT * FROM campaigns WHERE id=$1 AND business_id=$2 LIMIT 1`,[id,req.user.id]);
    if(!existing.rows.length)return res.status(404).json({error:'Kampanya bulunamadı'});
    const current=existing.rows[0];
    const title=String(b.title??current.title).trim().slice(0,120);
    if(!title)return res.status(400).json({error:'Kampanya başlığı gerekli'});
    const text=String(b.text??current.text).trim().slice(0,500);
    const image_url=String(b.image_url??current.image_url).trim().slice(0,1000);
    const button_text=String(b.button_text??current.button_text).trim().slice(0,60);
    const button_url=String(b.button_url??current.button_url).trim().slice(0,1000);
    const starts_at=b.starts_at===null||b.starts_at===''?null:(b.starts_at!==undefined?new Date(b.starts_at):current.starts_at);
    const ends_at=b.ends_at===null||b.ends_at===''?null:(b.ends_at!==undefined?new Date(b.ends_at):current.ends_at);
    if(starts_at && Number.isNaN(new Date(starts_at).getTime()))return res.status(400).json({error:'Başlangıç tarihi geçersiz'});
    if(ends_at && Number.isNaN(new Date(ends_at).getTime()))return res.status(400).json({error:'Bitiş tarihi geçersiz'});
    if(starts_at && ends_at && new Date(starts_at)>new Date(ends_at))return res.status(400).json({error:'Bitiş tarihi başlangıçtan önce olamaz'});
    const priority=b.priority!==undefined?Math.max(-100,Math.min(100,Number(b.priority)||0)):Number(current.priority||0);
    const enabled=b.enabled!==undefined?b.enabled===true:current.enabled===true;
    const r=await pool.query(`UPDATE campaigns SET title=$1,text=$2,image_url=$3,button_text=$4,button_url=$5,starts_at=$6,ends_at=$7,enabled=$8,priority=$9,updated_at=CURRENT_TIMESTAMP WHERE id=$10 AND business_id=$11 RETURNING *`,[title,text,image_url,button_text,button_url,starts_at?new Date(starts_at):null,ends_at?new Date(ends_at):null,enabled,priority,id,req.user.id]);
    res.json({campaign:normalizeCampaign(r.rows[0])});
  }catch(e){console.error('CAMPAIGN UPDATE ERROR:',e);res.status(500).json({error:'Kampanya güncellenemedi'});}
});

app.delete('/api/business-campaigns/:id', auth, requireBusinessPermission('campaign'), async (req,res)=>{
  try{
    const r=await pool.query(`DELETE FROM campaigns WHERE id=$1 AND business_id=$2 RETURNING id`,[Number(req.params.id),req.user.id]);
    if(!r.rows.length)return res.status(404).json({error:'Kampanya bulunamadı'});
    res.json({success:true});
  }catch(e){console.error('CAMPAIGN DELETE ERROR:',e);res.status(500).json({error:'Kampanya silinemedi'});}
});

/* =========================================================
   V2 — REVIEW BOOSTER API
========================================================= */

app.get('/api/business-review-booster', auth, requireBusinessPermission('review'), async (req, res) => {
  try {
    let result = await pool.query(
      `SELECT * FROM review_boosters WHERE business_id=$1 LIMIT 1`,
      [req.user.id]
    );
    if (!result.rows.length) {
      result = await pool.query(
        `INSERT INTO review_boosters(business_id) VALUES($1) RETURNING *`,
        [req.user.id]
      );
    }
    res.json(normalizeReviewBooster(result.rows[0]));
  } catch (error) {
    console.error('REVIEW BOOSTER GET ERROR:', error);
    res.status(500).json({ error: 'Review Booster ayarları alınamadı' });
  }
});

app.put('/api/business-review-booster', auth, requireBusinessPermission('review'), async (req, res) => {
  try {
    const body = req.body || {};
    const str = (v, max) => String(v ?? '').trim().slice(0, max);
    const threshold = Math.min(5, Math.max(1, Number(body.threshold) || 4));

    const result = await pool.query(`
      INSERT INTO review_boosters(
        business_id,enabled,title,text,threshold,
        low_title,low_text,success_title,success_text,updated_at
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
      ON CONFLICT(business_id) DO UPDATE SET
        enabled=EXCLUDED.enabled,
        title=EXCLUDED.title,
        text=EXCLUDED.text,
        threshold=EXCLUDED.threshold,
        low_title=EXCLUDED.low_title,
        low_text=EXCLUDED.low_text,
        success_title=EXCLUDED.success_title,
        success_text=EXCLUDED.success_text,
        updated_at=CURRENT_TIMESTAMP
      RETURNING *
    `, [
      req.user.id,
      body.enabled === true,
      str(body.title, 160) || REVIEW_BOOSTER_DEFAULTS.title,
      str(body.text, 500) || REVIEW_BOOSTER_DEFAULTS.text,
      threshold,
      str(body.low_title, 160) || REVIEW_BOOSTER_DEFAULTS.low_title,
      str(body.low_text, 500) || REVIEW_BOOSTER_DEFAULTS.low_text,
      str(body.success_title, 160) || REVIEW_BOOSTER_DEFAULTS.success_title,
      str(body.success_text, 500) || REVIEW_BOOSTER_DEFAULTS.success_text
    ]);

    res.json(normalizeReviewBooster(result.rows[0]));
  } catch (error) {
    console.error('REVIEW BOOSTER UPDATE ERROR:', error);
    res.status(500).json({ error: 'Review Booster ayarları kaydedilemedi' });
  }
});

/* =========================================================
   PUBLIC PROFILE API
========================================================= */

/*
   Public profile data endpoint.
   QR:  /api/profile/:slug
   NFC: /api/profile-by-nfc/:code

   IMPORTANT:
   Business slug is never regenerated here.
   Existing QR URLs therefore remain stable.
*/

app.get(
  '/api/profile/:slug',
  async (req, res) => {

    try {

      const slug =
        String(req.params.slug || '').trim();

      if (!slug) {
        return res.status(404).json({
          error: 'Profil bulunamadı'
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            name,
            slug,
            category,
            description,
            phone,
            whatsapp,
            address,
            instagram,
            tiktok,
            google_review,
            website,
            menu,
            iban,
            iban_holder,
            hours,
            logo_url,
            profile_field_permissions,
            social_links,
            custom_links,
            social_platform_permissions,
            created_at
          FROM businesses
          WHERE slug=$1
          LIMIT 1
          `,
          [slug]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error: 'Profil bulunamadı'
        });
      }

      const profile = publicBusinessWithFieldPermissions(result.rows[0]);
      const profile_design = await getPublicProfileDesign(result.rows[0].id);
      const review_booster = await getReviewBooster(result.rows[0].id);
      const campaigns = await getActiveCampaigns(result.rows[0].id);

      return res.json({
        ...profile,
        profile_design,
        review_booster,
        campaigns
      });

    } catch (error) {

      console.error(
        'PUBLIC PROFILE API ERROR:',
        error
      );

      return res.status(500).json({
        error: 'Profil alınamadı'
      });

    }
  }
);


/* =========================================================
   PUBLIC NFC PROFILE API
========================================================= */

app.get(
  '/api/profile-by-nfc/:code',
  async (req, res) => {

    try {

      const code =
        String(req.params.code || '').trim();

      if (!code) {
        return res.status(404).json({
          error: 'NFC profili bulunamadı'
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            b.id,
            b.name,
            b.slug,
            b.category,
            b.description,
            b.phone,
            b.whatsapp,
            b.address,
            b.instagram,
            b.tiktok,
            b.google_review,
            b.website,
            b.menu,
            b.iban,
            b.iban_holder,
            b.hours,
            b.logo_url,
            b.profile_field_permissions,
            b.social_links,
            b.custom_links,
            b.social_platform_permissions,
            b.created_at
          FROM nfc_tags t
          INNER JOIN businesses b
            ON b.id=t.business_id
          WHERE t.code=$1
            AND t.is_active=TRUE
          LIMIT 1
          `,
          [code]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error: 'NFC profili bulunamadı'
        });
      }

      const profile = publicBusinessWithFieldPermissions(result.rows[0]);
      const profile_design = await getPublicProfileDesign(result.rows[0].id);
      const review_booster = await getReviewBooster(result.rows[0].id);
      const campaigns = await getActiveCampaigns(result.rows[0].id);

      return res.json({
        ...profile,
        profile_design,
        review_booster,
        campaigns
      });

    } catch (error) {

      console.error(
        'PUBLIC NFC PROFILE API ERROR:',
        error
      );

      return res.status(500).json({
        error: 'NFC profili alınamadı'
      });

    }
  }
);


/* =========================================================
   NFC TAG MANAGEMENT 2.0
========================================================= */


/*
   GET ALL TAGS
*/

app.get('/api/nfc-tags', auth, requireBusinessPermission('nfc'), async (req, res) => {

  try {

    const result =
      await pool.query(
        `
        SELECT

          t.id,
          t.business_id,
          t.name,
          t.placement,
          t.code,
          t.is_active,
          t.created_at,
          t.updated_at,

          COALESCE((
            SELECT COUNT(*)
            FROM events e
            WHERE e.nfc_tag_id=t.id
            AND e.type='nfc'
          ),0)::int AS tap_count,

          COALESCE((
            SELECT COUNT(*)
            FROM events e
            WHERE e.nfc_tag_id=t.id
            AND e.type='qr_scan'
          ),0)::int AS qr_count,

          COALESCE((
            SELECT COUNT(*)
            FROM events e
            WHERE e.nfc_tag_id=t.id
            AND e.type='nfc'
          ),0)::int AS nfc_count,

          COALESCE((
            SELECT COUNT(*)
            FROM events e
            WHERE e.nfc_tag_id=t.id
            AND e.type IN ('nfc','qr_scan')
          ),0)::int AS total_count,

          (
            SELECT MAX(e.created_at)
            FROM events e
            WHERE e.nfc_tag_id=t.id
            AND e.type IN ('nfc','qr_scan')
          ) AS last_tap

        FROM nfc_tags t

        WHERE t.business_id=$1

        ORDER BY t.id DESC
        `,
        [req.user.id]
      );

    res.json(
      result.rows.map(nfcTagPublic)
    );

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'NFC etiketleri alınamadı'
    });

  }

});


/*
   GET SINGLE TAG
*/

app.get(
  '/api/nfc-tags/:id',
  auth,
  requireBusinessPermission('nfc'),
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      const result =
        await pool.query(
          `
          SELECT

            t.id,
            t.business_id,
            t.name,
            t.placement,
            t.code,
            t.is_active,
            t.created_at,
            t.updated_at,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE e.nfc_tag_id=t.id
              AND e.type='nfc'
            ),0)::int AS tap_count,

            (
              SELECT MAX(e.created_at)
              FROM events e
              WHERE e.nfc_tag_id=t.id
              AND e.type='nfc'
            ) AS last_tap

          FROM nfc_tags t

          WHERE t.id=$1
          AND t.business_id=$2
          `,
          [
            id,
            req.user.id
          ]
        );

      if (!result.rows.length) {

        return res.status(404).json({
          error: 'NFC etiketi bulunamadı'
        });

      }

      res.json(
        nfcTagPublic(result.rows[0])
      );

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: 'NFC etiketi alınamadı'
      });

    }

  }
);


/*
   STABLE PUBLIC TABLE QR IMAGE
   Uses the existing NFC tag code as the single source of truth.
   The image URL is deterministic, public, and cacheable so the Business
   Dashboard never depends on several authenticated JSON requests.
*/
app.get('/qr/nfc/:code.png', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.status(404).send('QR bulunamadı');

    const result = await pool.query(
      `SELECT t.code,b.slug FROM nfc_tags t INNER JOIN businesses b ON b.id=t.business_id WHERE t.code=$1 LIMIT 1`,
      [code]
    );
    if (!result.rows.length) return res.status(404).send('QR bulunamadı');

    const baseUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
    const publicUrl = `${baseUrl}/p/nfc/${encodeURIComponent(result.rows[0].code)}?source=qr`;
    const png = await QRCode.toBuffer(publicUrl, { type:'png', width:700, margin:2, errorCorrectionLevel:'H' });

    res.set('Content-Type','image/png');
    res.set('Cache-Control','public, max-age=31536000, immutable');
    res.set('ETag', `"nfc-qr-${result.rows[0].code}"`);
    return res.end(png);
  } catch (error) {
    console.error('PUBLIC TABLE QR ERROR:', error);
    return res.status(500).send('QR oluşturulamadı');
  }
});

/*
   TABLE / POINT QR JSON (legacy-compatible)
   Uses the existing NFC tag URL; no second QR database is created.
*/
app.get('/api/nfc-tags/:id/qr', auth, requireBusinessPermission('nfc'), async (req, res) => {
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:'Geçersiz NFC etiketi'});
    const result=await pool.query(`SELECT id,business_id,name,placement,code,is_active FROM nfc_tags WHERE id=$1 AND business_id=$2 LIMIT 1`,[id,req.user.id]);
    if(!result.rows.length) return res.status(404).json({error:'NFC etiketi bulunamadı'});
    const baseUrl=process.env.PUBLIC_URL||process.env.RENDER_EXTERNAL_URL||`${req.protocol}://${req.get('host')}`;
    const url=`${baseUrl}/p/nfc/${result.rows[0].code}?source=qr`;
    const qr=await QRCode.toDataURL(url,{width:900,margin:2,errorCorrectionLevel:'H'});
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');res.set('Pragma','no-cache');res.set('Expires','0');
    res.json({...result.rows[0],url,qr});
  } catch(error) {console.error('BUSINESS NFC QR ERROR:',error);res.status(500).json({error:'Masa / nokta QR kodu oluşturulamadı'});}
});


/*
   CREATE TAG
*/

app.post('/api/nfc-tags', auth, requireBusinessPermission('nfc'), async (req, res) => {

  try {

    const {
      name,
      placement,
      is_active
    } = req.body;

    const tagName =
      String(name || '').trim();

    const tagPlacement =
      String(placement || '').trim();

    const active =
      typeof is_active === 'boolean'
        ? is_active
        : true;

    if (!tagName) {

      return res.status(400).json({
        error: 'NFC etiket adı gerekli'
      });

    }

    let code = '';

    /*
      Benzersiz code üret.
    */

    for (let i = 0; i < 10; i++) {

      const candidate =
        createNfcCode();

      const exists =
        await pool.query(
          `
          SELECT id
          FROM nfc_tags
          WHERE code=$1
          `,
          [candidate]
        );

      if (!exists.rows.length) {

        code = candidate;

        break;
      }

    }

    if (!code) {

      return res.status(500).json({
        error: 'NFC kodu oluşturulamadı'
      });

    }

    const result =
      await pool.query(
        `
        INSERT INTO nfc_tags(
          business_id,
          name,
          placement,
          code,
          is_active
        )

        VALUES(
          $1,
          $2,
          $3,
          $4,
          $5
        )

        RETURNING *
        `,
        [
          req.user.id,
          tagName,
          tagPlacement,
          code,
          active
        ]
      );

    res.status(201).json({
      tag:
        nfcTagPublic(result.rows[0])
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'NFC etiketi oluşturulamadı'
    });

  }

});


/*
   UPDATE TAG
*/

app.put(
  '/api/nfc-tags/:id',
  auth,
  requireBusinessPermission('nfc'),
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      const {
        name,
        placement,
        is_active
      } = req.body;

      const tagName =
        String(name || '').trim();

      const tagPlacement =
        String(placement || '').trim();

      if (!tagName) {

        return res.status(400).json({
          error: 'NFC etiket adı gerekli'
        });

      }

      const active =
        typeof is_active === 'boolean'
          ? is_active
          : true;

      const result =
        await pool.query(
          `
          UPDATE nfc_tags

          SET
            name=$1,
            placement=$2,
            is_active=$3,
            updated_at=CURRENT_TIMESTAMP

          WHERE id=$4
          AND business_id=$5

          RETURNING *
          `,
          [
            tagName,
            tagPlacement,
            active,
            id,
            req.user.id
          ]
        );

      if (!result.rows.length) {

        return res.status(404).json({
          error: 'NFC etiketi bulunamadı'
        });

      }

      /*
        İstatistikleri tekrar hesaplayarak döndür.
      */

      const stats =
        await pool.query(
          `
          SELECT

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE e.nfc_tag_id=t.id
              AND e.type='nfc'
            ),0)::int AS tap_count,

            (
              SELECT MAX(e.created_at)
              FROM events e
              WHERE e.nfc_tag_id=t.id
              AND e.type='nfc'
            ) AS last_tap

          FROM nfc_tags t

          WHERE t.id=$1
          `,
          [id]
        );

      const tag = {
        ...result.rows[0],
        tap_count:
          stats.rows[0]?.tap_count || 0,
        last_tap:
          stats.rows[0]?.last_tap || null
      };

      res.json({
        tag:
          nfcTagPublic(tag)
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: 'NFC etiketi güncellenemedi'
      });

    }

  }
);


/*
   DELETE TAG
*/

app.delete(
  '/api/nfc-tags/:id',
  auth,
  requireBusinessPermission('nfc'),
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      const result =
        await pool.query(
          `
          DELETE FROM nfc_tags

          WHERE id=$1
          AND business_id=$2

          RETURNING id
          `,
          [
            id,
            req.user.id
          ]
        );

      if (!result.rows.length) {

        return res.status(404).json({
          error: 'NFC etiketi bulunamadı'
        });

      }

      res.json({
        success: true,
        id
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: 'NFC etiketi silinemedi'
      });

    }

  }
);


/* =========================================================
   NFC TAG ANALYTICS
========================================================= */

app.get(
  '/api/nfc-tags/:id/analytics',
  auth,
  requireBusinessPermission('analytics'),
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      const tag =
        await pool.query(
          `
          SELECT id
          FROM nfc_tags
          WHERE id=$1
          AND business_id=$2
          `,
          [
            id,
            req.user.id
          ]
        );

      if (!tag.rows.length) {

        return res.status(404).json({
          error: 'NFC etiketi bulunamadı'
        });

      }

      const total =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS total_taps,
            MAX(created_at) AS last_tap
          FROM events

          WHERE nfc_tag_id=$1
          AND type='nfc'
          `,
          [id]
        );

      const daily =
        await pool.query(
          `
          SELECT

            DATE(created_at) AS date,
            COUNT(*)::int AS taps

          FROM events

          WHERE nfc_tag_id=$1
          AND type='nfc'

          GROUP BY DATE(created_at)

          ORDER BY date DESC

          LIMIT 90
          `,
          [id]
        );

      res.json({
        total_taps:
          total.rows[0].total_taps,

        last_tap:
          total.rows[0].last_tap,

        daily:
          daily.rows
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: 'NFC analizleri alınamadı'
      });

    }

  }
);


/* =========================================================
   PUBLIC NFC TAG ROUTE
========================================================= */

/*
   DİKKAT:

   Bu route /p/:slug route'undan ÖNCE bulunuyor.

   NFC TAG:
   /p/nfc/CODE

   -> tag bulunur
   -> işletme bulunur
   -> NFC event'i tag ID ile kaydedilir
   -> profile.html açılır
*/

app.get(
  '/p/nfc/:code',
  async (req, res) => {

    try {

      const code =
        String(req.params.code || '').trim();

      if (!code) {

        return res.status(404).send(
          'NFC etiketi bulunamadı'
        );

      }

      const result =
        await pool.query(
          `
          SELECT

            t.id AS tag_id,
            t.business_id,
            t.is_active,

            b.slug

          FROM nfc_tags t

          INNER JOIN businesses b
            ON b.id=t.business_id

          WHERE t.code=$1

          LIMIT 1
          `,
          [code]
        );

      if (!result.rows.length) {

        return res.status(404).send(
          'NFC etiketi bulunamadı'
        );

      }

      const tag =
        result.rows[0];

      /*
        Pasif tag çalışmaz.
      */

      if (!tag.is_active) {

        return res.status(410).send(`
          <!DOCTYPE html>
          <html lang="tr">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport"
              content="width=device-width,initial-scale=1">
            <title>NFC Pasif</title>

            <style>
              body{
                margin:0;
                min-height:100vh;
                display:flex;
                align-items:center;
                justify-content:center;
                background:#050505;
                color:#fff;
                font-family:Arial,sans-serif;
                text-align:center;
                padding:30px;
                box-sizing:border-box;
              }

              .box{
                max-width:420px;
                padding:35px;
                border:1px solid rgba(212,175,55,.3);
                border-radius:24px;
                background:#0c0c0c;
              }

              .icon{
                font-size:54px;
                margin-bottom:20px;
              }

              h1{
                margin:0 0 12px;
                font-size:26px;
              }

              p{
                color:#aaa;
                line-height:1.6;
                margin:0;
              }
            </style>
          </head>

          <body>

            <div class="box">

              <div class="icon">
                📡
              </div>

              <h1>
                NFC etiketi pasif
              </h1>

              <p>
                Bu NFC bağlantısı şu anda aktif değil.
              </p>

            </div>

          </body>
          </html>
        `);

      }

      const isQr = String(req.query.source || '').toLowerCase() === 'qr';

      await pool.query(
        `
        INSERT INTO events(
          business_id,
          type,
          source,
          nfc_tag_id
        )

        VALUES(
          $1,
          'profile_view',
          $2,
          $3
        )
        `,
        [
          tag.business_id,
          isQr ? 'qr' : 'nfc',
          tag.tag_id
        ]
      );

      await pool.query(
        `
        INSERT INTO events(
          business_id,
          type,
          source,
          nfc_tag_id
        )

        VALUES(
          $1,
          $2,
          $3,
          $4
        )
        `,
        [
          tag.business_id,
          isQr ? 'qr_scan' : 'nfc',
          isQr ? 'qr' : 'nfc',
          tag.tag_id
        ]
      );


      /*
        Profile aç.
      */

      return res.sendFile(
        path.join(
          __dirname,
          'public',
          'profile.html'
        )
      );

    } catch (error) {

      console.error(error);

      res.status(500).send(
        'NFC bağlantısı açılırken hata oluştu'
      );

    }

  }
);


/* =========================================================
   PUBLIC PROFILE
========================================================= */

app.get(
  '/p/:slug',
  async (req, res) => {

    try {

      const slug =
        String(req.params.slug || '');

      const result =
        await pool.query(
          `
          SELECT *
          FROM businesses
          WHERE slug=$1
          `,
          [slug]
        );

      if (!result.rows.length) {

        return res.status(404).send(
          'İşletme bulunamadı'
        );

      }

      const business =
        result.rows[0];

      /*
        Profile view
      */

      await pool.query(
        `
        INSERT INTO events(
          business_id,
          type,
          source
        )

        VALUES(
          $1,
          'profile_view',
          $2
        )
        `,
        [
          business.id,
          req.query.source === 'qr'
            ? 'qr'
            : req.query.source === 'nfc'
              ? 'nfc'
              : 'direct'
        ]
      );


      /*
        QR
      */

      if (
        req.query.source === 'qr'
      ) {

        await pool.query(
          `
          INSERT INTO events(
            business_id,
            type,
            source
          )

          VALUES(
            $1,
            'qr_scan',
            'qr'
          )
          `,
          [business.id]
        );

      }


      /*
        Eski NFC bağlantıları:

        /p/slug?source=nfc

        Bunlar yeni tag sistemi kullanılmadan
        oluşturulmuş NFC bağlantıları olabilir.

        Backward compatibility korunuyor.
      */

      if (
        req.query.source === 'nfc'
      ) {

        await pool.query(
          `
          INSERT INTO events(
            business_id,
            type,
            source
          )

          VALUES(
            $1,
            'nfc',
            'nfc'
          )
          `,
          [business.id]
        );

      }


      res.sendFile(
        path.join(
          __dirname,
          'public',
          'profile.html'
        )
      );

    } catch (error) {

      console.error(error);

      res.status(500).send(
        'Profil açılırken hata oluştu'
      );

    }

  }
);


/* =========================================================
   DASHBOARD PAGE
========================================================= */

app.get(
  '/dashboard',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'dashboard.html'
      )
    );

  }
);


/* =========================================================
   QR CENTER
========================================================= */

app.get(
  '/qr-center',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'qr-center.html'
      )
    );

  }
);


/* =========================================================
   NFC CENTER
========================================================= */

app.get(
  '/nfc-center',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'nfc-center.html'
      )
    );

  }
);


/* =========================================================
   ADMIN PAGE
========================================================= */

app.get(
  '/admin',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'admin.html'
      )
    );

  }
);


/* =========================================================
   REGISTER PAGE
========================================================= */

app.get(
  '/register',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'register.html'
      )
    );

  }
);


/* =========================================================
   LOGIN PAGE
========================================================= */

app.get(
  '/login',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'login.html'
      )
    );

  }
);


/* =========================================================
   MAIN PAGE
========================================================= */

app.get(
  '/',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );

  }
);


/* =========================================================
   FALLBACK
========================================================= */

app.use(
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );

  }
);


/* =========================================================
   START
========================================================= */

initDatabase()
  .then(() => {

    app.listen(
      PORT,
      '0.0.0.0',
      () => {

        console.log(
          `LEO CONNECT V2 FINAL CORE + V1 COMPATIBILITY çalışıyor: ${PORT}`
        );

      }
    );

  })
  .catch(error => {

    console.error(
      'DATABASE BAŞLATMA HATASI:',
      error
    );

    process.exit(1);

  });
