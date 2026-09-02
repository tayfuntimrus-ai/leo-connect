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

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    email: row.email,
    category: row.category || '',
    description: row.description || '',
    phone: row.phone || '',
    whatsapp: row.whatsapp || '',
    address: row.address || '',
    instagram: row.instagram || '',
    tiktok: row.tiktok || '',
    google_review: row.google_review || '',
    website: row.website || '',
    menu: row.menu || '',
    iban: row.iban || '',
    iban_holder: row.iban_holder || '',
    hours: row.hours || '',
    logo_url: row.logo_url || '',
    created_at: row.created_at
  };
}


function businessPermissions(row) {
  return {
    profile: row?.dashboard_profile !== false,
    qr: row?.dashboard_qr === true,
    nfc: row?.dashboard_nfc === true,
    analytics: row?.dashboard_analytics === true
  };
}

function requireBusinessPermission(permission) {
  return async (req, res, next) => {
    try {
      if (req.user?.role === 'admin') return next();
      const result = await pool.query(
        `SELECT dashboard_profile, dashboard_qr, dashboard_nfc, dashboard_analytics
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
    tap_count: Number(row.tap_count || 0),
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
      ADD COLUMN IF NOT EXISTS dashboard_analytics BOOLEAN NOT NULL DEFAULT FALSE
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
        dashboard_analytics
      )
      VALUES($1,$2,$3,$4,$5,TRUE,FALSE,FALSE,FALSE)
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
      SELECT id, name, dashboard_profile, dashboard_qr, dashboard_nfc, dashboard_analytics
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

    const result = await pool.query(`
      UPDATE businesses
      SET dashboard_profile=$1, dashboard_qr=$2, dashboard_nfc=$3, dashboard_analytics=$4
      WHERE id=$5
      RETURNING id, name, dashboard_profile, dashboard_qr, dashboard_nfc, dashboard_analytics
    `, [profile, qr, nfc, analytics, id]);

    if (!result.rows.length) return res.status(404).json({ error: 'İşletme bulunamadı' });
    res.json({ success: true, permissions: businessPermissions(result.rows[0]) });
  } catch (error) {
    console.error('ADMIN PERMISSIONS UPDATE ERROR:', error);
    res.status(500).json({ error: 'İzinler güncellenemedi' });
  }
});


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

    const result =
      await pool.query(
        `
        SELECT *
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

    res.json({
      ...publicBusiness(result.rows[0]),
      permissions: businessPermissions(result.rows[0])
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
        req.user.id
      ]
    );

    const result =
      await pool.query(
        `
        SELECT *
        FROM businesses
        WHERE id=$1
        `,
        [req.user.id]
      );

    res.json({
      business:
        publicBusiness(result.rows[0])
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Profil güncellenemedi'
    });

  }

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
    let where = 'business_id=$1';
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
      SELECT id,name,code,placement,tap_count,last_tap FROM nfc_tags
      WHERE business_id=$1 ORDER BY tap_count DESC NULLS LAST, created_at DESC LIMIT 10`,[req.user.id]);

    res.json({period, totals: totals.rows[0], daily: daily.rows, hourly: hourly.rows, actions: actions.rows, top_nfc: tags.rows});
  } catch(error) {
    console.error('BUSINESS ANALYTICS V3 ERROR:', error);
    res.status(500).json({error:'Analiz verileri alınamadı'});
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
          COUNT(*)::int AS total_events,

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
      'google_review'
    ];

    if (!allowedTypes.includes(type)) {

      return res.status(400).json({
        error: 'Geçersiz event tipi'
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

    await pool.query(
      `
      INSERT INTO events(
        business_id,
        type
      )

      VALUES(
        $1,
        $2
      )
      `,
      [
        business.rows[0].id,
        type
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

      return res.json(
        publicBusiness(result.rows[0])
      );

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

      return res.json(
        publicBusiness(result.rows[0])
      );

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

          (
            SELECT MAX(e.created_at)
            FROM events e
            WHERE e.nfc_tag_id=t.id
            AND e.type='nfc'
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
   CREATE TAG
*/

app.post('/api/nfc-tags', auth, requireBusinessPermission('nfc'), async (req, res) => {

  try {

    const {
      name,
      placement
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
          TRUE
        )

        RETURNING *
        `,
        [
          req.user.id,
          tagName,
          tagPlacement,
          code
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

      /*
        Önce profil görüntüleme.
      */

      await pool.query(
        `
        INSERT INTO events(
          business_id,
          type,
          nfc_tag_id
        )

        VALUES(
          $1,
          'profile_view',
          $2
        )
        `,
        [
          tag.business_id,
          tag.tag_id
        ]
      );


      /*
        Sonra gerçek NFC tap.
      */

      await pool.query(
        `
        INSERT INTO events(
          business_id,
          type,
          nfc_tag_id
        )

        VALUES(
          $1,
          'nfc',
          $2
        )
        `,
        [
          tag.business_id,
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
          type
        )

        VALUES(
          $1,
          'profile_view'
        )
        `,
        [business.id]
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
            type
          )

          VALUES(
            $1,
            'qr_scan'
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
            type
          )

          VALUES(
            $1,
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
          `LEO CONNECT 3.8 STABLE PUBLIC PROFILE çalışıyor: ${PORT}`
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
