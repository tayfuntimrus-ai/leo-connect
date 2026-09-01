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
      version: '3.8-stable-public-profile',
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
   ADMIN BUSINESS ANALYTICS
========================================================= */

app.get(
  '/api/admin/business/:id/analytics',
  adminAuth,
  async (req, res) => {

    try {

      const businessId = Number(req.params.id);

      const period =
        req.query.period || 'all';

      let where = `
        business_id=$1
      `;

      let params = [businessId];

      if (period === 'today') {

        where += `
          AND created_at >= CURRENT_DATE
        `;

      } else if (period === '7d') {

        where += `
          AND created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
        `;

      } else if (period === '30d') {

        where += `
          AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        `;

      }

      const result = await pool.query(`
        SELECT
          type,
          COUNT(*)::int AS count
        FROM events
        WHERE ${where}
        GROUP BY type
        ORDER BY count DESC
      `, params);

      res.json({
        period,
        events: result.rows
      });

    } catch (error) {

      console.error(error);

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

      const result =
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
            req.params.id
          ]
        );

      if (!result.rows.length) {

        return res
          .status(404)
          .json({
            error:
              'İşletme bulunamadı'
          });

      }

      const business =
        result.rows[0];

      const url =
        `${req.protocol}://${req.get('host')}/p/${business.slug}?source=qr`;

      const dataUrl =
        await QRCode.toDataURL(url, {
          width: 1200,
          margin: 2,
          errorCorrectionLevel: 'H'
        });

      res.json({

        business_id:
          business.id,

        business_name:
          business.name,

        slug:
          business.slug,

        url,

        dataUrl

      });

    } catch (error) {

      console.error(
        'ADMIN QR ERROR:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'QR oluşturulamadı'
        });

    }

  }
);


/* =========================================================
   BUSINESS AUTH
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
      !password
    ) {

      return res
        .status(400)
        .json({
          error:
            'İşletme adı, e-posta ve şifre zorunludur'
        });

    }

    const normalizedEmail =
      String(email)
        .trim()
        .toLowerCase();

    const existing =
      await pool.query(
        `
        SELECT id
        FROM businesses
        WHERE email=$1
        `,
        [
          normalizedEmail
        ]
      );

    if (existing.rows.length) {

      return res
        .status(409)
        .json({
          error:
            'Bu e-posta zaten kayıtlı'
        });

    }

    const passwordHash =
      await bcrypt.hash(
        String(password),
        10
      );

    let slug =
      slugify(name);

    if (!slug) {
      slug = 'isletme';
    }

    let slugExists =
      await pool.query(
        `
        SELECT id
        FROM businesses
        WHERE slug=$1
        `,
        [
          slug
        ]
      );

    let suffix = 2;

    while (slugExists.rows.length) {

      slug =
        `${slugify(name)}-${suffix}`;

      slugExists =
        await pool.query(
          `
          SELECT id
          FROM businesses
          WHERE slug=$1
          `,
          [
            slug
          ]
        );

      suffix++;
    }

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

        RETURNING
          id,
          name,
          slug,
          email,
          category,
          created_at
        `,
        [
          String(name).trim(),
          slug,
          normalizedEmail,
          passwordHash,
          String(category || '').trim()
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
          expiresIn: '7d'
        }
      );

    res.status(201).json({
      token,
      business
    });

  } catch (error) {

    console.error(
      'REGISTER ERROR:',
      error
    );

    res
      .status(500)
      .json({
        error:
          'Kayıt sırasında hata oluştu'
      });

  }

});


/* =========================================================
   BUSINESS LOGIN
========================================================= */

app.post('/api/login', async (req, res) => {

  try {

    const {
      email,
      password
    } = req.body;

    if (!email || !password) {

      return res
        .status(400)
        .json({
          error:
            'E-posta ve şifre gerekli'
        });

    }

    const normalizedEmail =
      String(email)
        .trim()
        .toLowerCase();

    const result =
      await pool.query(
        `
        SELECT *
        FROM businesses
        WHERE email=$1
        LIMIT 1
        `,
        [
          normalizedEmail
        ]
      );

    if (!result.rows.length) {

      return res
        .status(401)
        .json({
          error:
            'E-posta veya şifre hatalı'
        });

    }

    const business =
      result.rows[0];

    const valid =
      await bcrypt.compare(
        String(password),
        business.password_hash
      );

    if (!valid) {

      return res
        .status(401)
        .json({
          error:
            'E-posta veya şifre hatalı'
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
          expiresIn: '7d'
        }
      );

    res.json({

      token,

      business:
        publicBusiness(business)

    });

  } catch (error) {

    console.error(
      'LOGIN ERROR:',
      error
    );

    res
      .status(500)
      .json({
        error:
          'Giriş sırasında hata oluştu'
      });

  }

});


/* =========================================================
   CURRENT BUSINESS
========================================================= */

app.get('/api/me', auth, async (req, res) => {

  try {

    const result =
      await pool.query(
        `
        SELECT
          id,
          name,
          slug,
          email,
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
        WHERE id=$1
        LIMIT 1
        `,
        [
          req.user.id
        ]
      );

    if (!result.rows.length) {

      return res
        .status(404)
        .json({
          error:
            'İşletme bulunamadı'
        });

    }

    res.json(
      publicBusiness(
        result.rows[0]
      )
    );

  } catch (error) {

    console.error(
      'ME ERROR:',
      error
    );

    res
      .status(500)
      .json({
        error:
          'Profil bilgileri alınamadı'
      });

  }

});


/* =========================================================
   UPDATE BUSINESS PROFILE
========================================================= */

app.put('/api/me', auth, async (req, res) => {

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

    const current =
      await pool.query(
        `
        SELECT
          id,
          name,
          slug
        FROM businesses
        WHERE id=$1
        LIMIT 1
        `,
        [
          req.user.id
        ]
      );

    if (!current.rows.length) {

      return res
        .status(404)
        .json({
          error:
            'İşletme bulunamadı'
        });

    }

    /*
      ÖNEMLİ:
      Mevcut slug kesinlikle değiştirilmez.

      Böylece daha önce oluşturulmuş QR kodların
      adresi bozulmaz.
    */

    const result =
      await pool.query(
        `
        UPDATE businesses

        SET

          name =
            COALESCE($1, name),

          category =
            COALESCE($2, category),

          description =
            COALESCE($3, description),

          phone =
            COALESCE($4, phone),

          whatsapp =
            COALESCE($5, whatsapp),

          address =
            COALESCE($6, address),

          instagram =
            COALESCE($7, instagram),

          tiktok =
            COALESCE($8, tiktok),

          google_review =
            COALESCE($9, google_review),

          website =
            COALESCE($10, website),

          menu =
            COALESCE($11, menu),

          iban =
            COALESCE($12, iban),

          iban_holder =
            COALESCE($13, iban_holder),

          hours =
            COALESCE($14, hours),

          logo_url =
            COALESCE($15, logo_url)

        WHERE id=$16

        RETURNING
          id,
          name,
          slug,
          email,
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
        `,
        [
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
          logo_url,
          req.user.id
        ]
      );

    res.json(
      publicBusiness(
        result.rows[0]
      )
    );

  } catch (error) {

    console.error(
      'UPDATE PROFILE ERROR:',
      error
    );

    res
      .status(500)
      .json({
        error:
          'Profil güncellenemedi'
      });

  }

});


/* =========================================================
   PUBLIC PROFILE API
========================================================= */

app.get(
  '/api/profile/:slug',
  async (req, res) => {

    try {

      const slug =
        String(
          req.params.slug || ''
        )
        .trim()
        .toLowerCase();

      if (!slug) {

        return res
          .status(400)
          .json({
            error:
              'Profil adresi gerekli'
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
          [
            slug
          ]
        );

      if (!result.rows.length) {

        return res
          .status(404)
          .json({
            error:
              'Profil bulunamadı'
          });

      }

      res.json(
        publicBusiness(
          result.rows[0]
        )
      );

    } catch (error) {

      console.error(
        'PUBLIC PROFILE API ERROR:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'Profil yüklenemedi'
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
        String(
          req.params.code || ''
        )
        .trim();

      if (!code) {

        return res
          .status(400)
          .json({
            error:
              'NFC kodu gerekli'
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

          WHERE
            t.code=$1
            AND t.is_active=TRUE

          LIMIT 1
          `,
          [
            code
          ]
        );

      if (!result.rows.length) {

        return res
          .status(404)
          .json({
            error:
              'NFC profili bulunamadı'
          });

      }

      res.json(
        publicBusiness(
          result.rows[0]
        )
      );

    } catch (error) {

      console.error(
        'PUBLIC NFC PROFILE API ERROR:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'NFC profili yüklenemedi'
        });

    }

  }
);


/* =========================================================
   BUSINESS QR
========================================================= */

app.get('/api/qr', auth, async (req, res) => {

  try {

    const result =
      await pool.query(
        `
        SELECT slug
        FROM businesses
        WHERE id=$1
        `,
        [
          req.user.id
        ]
      );

    if (!result.rows.length) {

      return res
        .status(404)
        .json({
          error:
            'İşletme bulunamadı'
        });

    }

    const slug =
      result.rows[0].slug;

    /*
      Mevcut QR adres yapısı korunuyor.
    */

    const url =
      `${req.protocol}://${req.get('host')}/p/${slug}?source=qr`;

    const dataUrl =
      await QRCode.toDataURL(
        url,
        {
          width: 1200,
          margin: 2,
          errorCorrectionLevel: 'H'
        }
      );

    res.json({
      url,
      dataUrl
    });

  } catch (error) {

    console.error(
      'QR ERROR:',
      error
    );

    res
      .status(500)
      .json({
        error:
          'QR oluşturulamadı'
      });

  }

});

/* =========================================================
   NFC TAG MANAGEMENT
========================================================= */


/* =========================================================
   LIST NFC TAGS
========================================================= */

app.get(
  '/api/nfc-tags',
  auth,
  async (req, res) => {

    try {

      const result = await pool.query(`
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
      `, [
        req.user.id
      ]);

      res.json(
        result.rows.map(nfcTagPublic)
      );

    } catch (error) {

      console.error(
        'NFC LIST ERROR:',
        error
      );

      res.status(500).json({
        error:
          'NFC etiketleri alınamadı'
      });

    }

  }
);


/* =========================================================
   GET SINGLE NFC TAG
========================================================= */

app.get(
  '/api/nfc-tags/:id',
  auth,
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

          WHERE
            t.id=$1
            AND t.business_id=$2

          LIMIT 1
          `,
          [
            id,
            req.user.id
          ]
        );

      if (!result.rows.length) {

        return res.status(404).json({
          error:
            'NFC etiketi bulunamadı'
        });

      }

      res.json(
        nfcTagPublic(
          result.rows[0]
        )
      );

    } catch (error) {

      console.error(
        'NFC DETAIL ERROR:',
        error
      );

      res.status(500).json({
        error:
          'NFC etiketi alınamadı'
      });

    }

  }
);


/* =========================================================
   CREATE NFC TAG
========================================================= */

app.post(
  '/api/nfc-tags',
  auth,
  async (req, res) => {

    try {

      const {
        name,
        placement
      } = req.body;

      const tagName =
        String(
          name || ''
        ).trim();

      const tagPlacement =
        String(
          placement || 'Diğer'
        ).trim();

      if (!tagName) {

        return res.status(400).json({
          error:
            'NFC etiketi adı gerekli'
        });

      }

      let code = null;

      /*
        Benzersiz NFC kodu üret.
      */

      for (
        let attempt = 0;
        attempt < 10;
        attempt++
      ) {

        const candidate =
          createNfcCode();

        const exists =
          await pool.query(
            `
            SELECT id
            FROM nfc_tags
            WHERE code=$1
            LIMIT 1
            `,
            [
              candidate
            ]
          );

        if (!exists.rows.length) {

          code = candidate;

          break;

        }

      }

      if (!code) {

        return res.status(500).json({
          error:
            'Benzersiz NFC kodu oluşturulamadı'
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
            req.user.id,
            tagName,
            tagPlacement,
            code
          ]
        );

      res.status(201).json({
        tag:
          nfcTagPublic(
            result.rows[0]
          )
      });

    } catch (error) {

      console.error(
        'NFC CREATE ERROR:',
        error
      );

      res.status(500).json({
        error:
          'NFC etiketi oluşturulamadı'
      });

    }

  }
);


/* =========================================================
   UPDATE NFC TAG
========================================================= */

app.put(
  '/api/nfc-tags/:id',
  auth,
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
        String(
          name || ''
        ).trim();

      const tagPlacement =
        String(
          placement || 'Diğer'
        ).trim();

      if (!tagName) {

        return res.status(400).json({
          error:
            'NFC etiketi adı gerekli'
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

          WHERE
            id=$4
            AND business_id=$5

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
            tagName,
            tagPlacement,
            active,
            id,
            req.user.id
          ]
        );

      if (!result.rows.length) {

        return res.status(404).json({
          error:
            'NFC etiketi bulunamadı'
        });

      }

      const stats =
        await pool.query(
          `
          SELECT

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE e.nfc_tag_id=$1
              AND e.type='nfc'
            ),0)::int AS tap_count,

            (
              SELECT MAX(e.created_at)
              FROM events e
              WHERE e.nfc_tag_id=$1
              AND e.type='nfc'
            ) AS last_tap
          `,
          [
            id
          ]
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

      console.error(
        'NFC UPDATE ERROR:',
        error
      );

      res.status(500).json({
        error:
          'NFC etiketi güncellenemedi'
      });

    }

  }
);


/* =========================================================
   DELETE NFC TAG
========================================================= */

app.delete(
  '/api/nfc-tags/:id',
  auth,
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      const result =
        await pool.query(
          `
          DELETE FROM nfc_tags

          WHERE
            id=$1
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
          error:
            'NFC etiketi bulunamadı'
        });

      }

      res.json({
        success: true,
        id
      });

    } catch (error) {

      console.error(
        'NFC DELETE ERROR:',
        error
      );

      res.status(500).json({
        error:
          'NFC etiketi silinemedi'
      });

    }

  }
);


/* =========================================================
   NFC ANALYTICS
========================================================= */

app.get(
  '/api/nfc-tags/:id/analytics',
  auth,
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      const tag =
        await pool.query(
          `
          SELECT
            id,
            name,
            placement,
            code,
            is_active
          FROM nfc_tags
          WHERE
            id=$1
            AND business_id=$2
          LIMIT 1
          `,
          [
            id,
            req.user.id
          ]
        );

      if (!tag.rows.length) {

        return res.status(404).json({
          error:
            'NFC etiketi bulunamadı'
        });

      }

      const total =
        await pool.query(
          `
          SELECT

            COUNT(*)::int
              AS total_taps,

            MAX(created_at)
              AS last_tap

          FROM events

          WHERE
            nfc_tag_id=$1
            AND type='nfc'
          `,
          [
            id
          ]
        );

      const daily =
        await pool.query(
          `
          SELECT

            DATE(created_at)
              AS date,

            COUNT(*)::int
              AS taps

          FROM events

          WHERE
            nfc_tag_id=$1
            AND type='nfc'

          GROUP BY
            DATE(created_at)

          ORDER BY
            date DESC

          LIMIT 90
          `,
          [
            id
          ]
        );

      res.json({

        tag:
          tag.rows[0],

        total_taps:
          total.rows[0]?.total_taps || 0,

        last_tap:
          total.rows[0]?.last_tap || null,

        daily:
          daily.rows

      });

    } catch (error) {

      console.error(
        'NFC ANALYTICS ERROR:',
        error
      );

      res.status(500).json({
        error:
          'NFC analizleri alınamadı'
      });

    }

  }
);


/* =========================================================
   PUBLIC NFC ROUTE
========================================================= */

app.get(
  '/p/nfc/:code',
  async (req, res) => {

    try {

      const code =
        String(
          req.params.code || ''
        ).trim();

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

          WHERE
            t.code=$1

          LIMIT 1
          `,
          [
            code
          ]
        );

      if (!result.rows.length) {

        return res.status(404).send(
          'NFC etiketi bulunamadı'
        );

      }

      const tag =
        result.rows[0];

      /*
        Pasif NFC etiketi çalışmaz.
      */

      if (!tag.is_active) {

        return res.status(410).send(`
          <!DOCTYPE html>

          <html lang="tr">

          <head>

            <meta charset="UTF-8">

            <meta
              name="viewport"
              content="width=device-width,initial-scale=1"
            >

            <title>NFC Pasif</title>

            <style>

              *{
                box-sizing:border-box;
              }

              body{
                margin:0;
                min-height:100vh;

                display:flex;
                align-items:center;
                justify-content:center;

                padding:30px;

                background:#050505;
                color:#fff;

                font-family:
                  Arial,
                  sans-serif;

                text-align:center;
              }

              .box{
                width:100%;
                max-width:430px;

                padding:40px 30px;

                border:
                  1px solid
                  rgba(212,175,55,.35);

                border-radius:26px;

                background:#0c0c0c;

                box-shadow:
                  0 25px 80px
                  rgba(0,0,0,.5);
              }

              .icon{
                font-size:58px;
                margin-bottom:20px;
              }

              h1{
                margin:0 0 12px;
                font-size:27px;
              }

              p{
                margin:0;
                color:#aaa;
                line-height:1.7;
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
                Bu NFC bağlantısı
                şu anda aktif değil.
              </p>

            </div>

          </body>

          </html>
        `);

      }


      /*
        Profil görüntüleme eventi.
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
        NFC dokunuş eventi.
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
        Profil sayfasını aç.
      */

      return res.sendFile(
        path.join(
          __dirname,
          'public',
          'profile.html'
        )
      );

    } catch (error) {

      console.error(
        'PUBLIC NFC ROUTE ERROR:',
        error
      );

      res.status(500).send(
        'NFC bağlantısı açılırken hata oluştu'
      );

    }

  }
);


/* =========================================================
   PUBLIC PROFILE PAGE
========================================================= */

app.get(
  '/p/:slug',
  async (req, res) => {

    try {

      const slug =
        String(
          req.params.slug || ''
        ).trim();

      if (!slug) {

        return res.status(404).send(
          'İşletme bulunamadı'
        );

      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM businesses
          WHERE slug=$1
          LIMIT 1
          `,
          [
            slug
          ]
        );

      if (!result.rows.length) {

        return res.status(404).send(
          'İşletme bulunamadı'
        );

      }

      const business =
        result.rows[0];


      /*
        Genel profil görüntüleme.
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
        [
          business.id
        ]
      );


      /*
        QR üzerinden geldiyse
        QR taraması olarak kaydet.
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
          [
            business.id
          ]
        );

      }


      /*
        Eski NFC URL'leri için
        geriye dönük uyumluluk.
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
          [
            business.id
          ]
        );

      }


      return res.sendFile(
        path.join(
          __dirname,
          'public',
          'profile.html'
        )
      );

    } catch (error) {

      console.error(
        'PUBLIC PROFILE ROUTE ERROR:',
        error
      );

      res.status(500).send(
        'Profil açılırken hata oluştu'
      );

    }

  }
);


/* =========================================================
   DASHBOARD
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
   ADMIN
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
   REGISTER
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
   LOGIN
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
   START SERVER
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
