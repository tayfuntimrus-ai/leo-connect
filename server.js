require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QR = require('qrcode');
const { Pool } = require('pg');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'change-me';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL bulunamadı!');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


/* =========================
   DATABASE
========================= */

async function initDatabase() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses(
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      category TEXT,
      description TEXT,
      phone TEXT,
      whatsapp TEXT,
      address TEXT,
      instagram TEXT,
      tiktok TEXT,
      google_review TEXT,
      website TEXT,
      menu TEXT,
      iban TEXT,
      iban_holder TEXT,
      hours TEXT,
      logo_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events(
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      type TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

}


/* =========================
   HELPERS
========================= */

function slug(s) {

  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'isletme';

}


async function pub(id) {

  const result = await pool.query(
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
      logo_url
    FROM businesses
    WHERE id=$1
    `,
    [id]
  );

  return result.rows[0] || null;

}


/* =========================
   BUSINESS AUTH
========================= */

function auth(req, res, next) {

  try {

    const token =
      (req.headers.authorization || '')
        .replace(/^Bearer\s+/, '');

    const user =
      jwt.verify(token, SECRET);

    if (!user.id) {

      return res
        .status(403)
        .json({
          error: 'İşletme yetkisi gerekli'
        });

    }

    req.user = user;

    next();

  } catch (error) {

    res
      .status(401)
      .json({
        error: 'Oturum gerekli'
      });

  }

}


/* =========================
   ADMIN AUTH
========================= */

function adminAuth(req, res, next) {

  try {

    const token =
      (req.headers.authorization || '')
        .replace(/^Bearer\s+/, '');

    const user =
      jwt.verify(token, SECRET);

    if (user.role !== 'admin') {

      return res
        .status(403)
        .json({
          error: 'Admin yetkisi gerekli'
        });

    }

    req.admin = user;

    next();

  } catch (error) {

    res
      .status(401)
      .json({
        error: 'Admin oturumu gerekli'
      });

  }

}


/* =========================
   HEALTH
========================= */

app.get(
  '/api/health',
  async (req, res) => {

    try {

      await pool.query('SELECT 1');

      res.json({
        ok: true,
        version: '3.1-admin-postgres'
      });

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          ok: false,
          error: 'Veritabanı bağlantı hatası'
        });

    }

  }
);


/* =========================
   ADMIN LOGIN
========================= */

app.post(
  '/api/admin/login',
  (req, res) => {

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

        return res
          .status(503)
          .json({
            error:
              'Admin hesabı henüz yapılandırılmadı'
          });

      }


      if (
        String(email || '').trim().toLowerCase() !==
        String(adminEmail).trim().toLowerCase() ||
        String(password || '') !==
        String(adminPassword)
      ) {

        return res
          .status(401)
          .json({
            error:
              'Admin e-posta veya şifre hatalı'
          });

      }


      const token =
        jwt.sign(
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

      res
        .status(500)
        .json({
          error:
            'Admin girişi sırasında hata oluştu'
        });

    }

  }
);


/* =========================
   ADMIN OVERVIEW
========================= */

app.get(
  '/api/admin/overview',
  adminAuth,
  async (req, res) => {

    try {

      const businesses =
        await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM businesses`
        );


      const events =
        await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM events`
        );


      const profiles =
        await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM events
           WHERE type='profile_view'`
        );


      const qr =
        await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM events
           WHERE type IN ('qr_scan','qr')`
        );


      const nfc =
        await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM events
           WHERE type='nfc'`
        );


      const whatsapp =
        await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM events
           WHERE type='whatsapp'`
        );


      const phone =
        await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM events
           WHERE type='phone'`
        );


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
          phone.rows[0].count

      });

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          error:
            'Genel istatistikler alınamadı'
        });

    }

  }
);


/* =========================
   ADMIN BUSINESSES
========================= */

app.get(
  '/api/admin/businesses',
  adminAuth,
  async (req, res) => {

    try {

      const result =
        await pool.query(`
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
            ), 0)::int AS profile_views,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE e.business_id = b.id
              AND e.type IN ('qr_scan','qr')
            ), 0)::int AS qr_scans,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE e.business_id = b.id
              AND e.type = 'nfc'
            ), 0)::int AS nfc_scans,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE e.business_id = b.id
              AND e.type = 'whatsapp'
            ), 0)::int AS whatsapp_clicks,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE e.business_id = b.id
              AND e.type = 'phone'
            ), 0)::int AS phone_clicks

          FROM businesses b

          ORDER BY b.id DESC
        `);


      res.json(
        result.rows
      );

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          error:
            'İşletmeler alınamadı'
        });

    }

  }
);


/* =========================
   REGISTER
========================= */

app.post(
  '/api/register',
  async (req, res) => {

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

        return res
          .status(400)
          .json({
            error:
              'İşletme adı, e-posta ve 8+ karakter şifre gerekli'
          });

      }


      const existing =
        await pool.query(
          'SELECT id FROM businesses WHERE email=$1',
          [email]
        );


      if (existing.rows.length) {

        return res
          .status(409)
          .json({
            error:
              'E-posta zaten kayıtlı'
          });

      }


      const base =
        slug(name);

      let sl = base;
      let n = 1;


      while (true) {

        const check =
          await pool.query(
            'SELECT id FROM businesses WHERE slug=$1',
            [sl]
          );

        if (!check.rows.length) {
          break;
        }

        n++;
        sl = base + '-' + n;

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
          VALUES($1,$2,$3,$4,$5)
          RETURNING id
          `,
          [
            name,
            sl,
            email,
            passwordHash,
            category || ''
          ]
        );


      const business =
        await pub(
          result.rows[0].id
        );


      const token =
        jwt.sign(
          {
            id: business.id,
            role: 'business'
          },
          SECRET,
          {
            expiresIn: '7d'
          }
        );


      res.json({
        token,
        business
      });

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          error:
            'Kayıt sırasında hata oluştu'
        });

    }

  }
);


/* =========================
   LOGIN
========================= */

app.post(
  '/api/login',
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT *
          FROM businesses
          WHERE email=$1
          `,
          [req.body.email || '']
        );


      const business =
        result.rows[0];


      if (
        !business ||
        !(await bcrypt.compare(
          req.body.password || '',
          business.password_hash
        ))
      ) {

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
          await pub(business.id)
      });

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          error:
            'Giriş sırasında hata oluştu'
        });

    }

  }
);


/* =========================
   CURRENT BUSINESS
========================= */

app.get(
  '/api/me',
  auth,
  async (req, res) => {

    try {

      const business =
        await pub(req.user.id);

      if (!business) {

        return res
          .status(404)
          .json({
            error:
              'İşletme bulunamadı'
          });

      }

      res.json(business);

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          error:
            'İşletme bilgileri alınamadı'
        });

    }

  }
);


/* =========================
   UPDATE BUSINESS
========================= */

app.put(
  '/api/me',
  auth,
  async (req, res) => {

    try {

      const keys = [

        'name',
        'category',
        'description',

        'phone',
        'whatsapp',

        'address',

        'instagram',
        'tiktok',

        'google_review',
        'website',
        'menu',

        'iban',
        'iban_holder',

        'hours',

        'logo_url'

      ];


      const values =
        keys.map(
          k => req.body[k] ?? ''
        );


      const setClause =
        keys
          .map(
            (k, i) => `${k}=$${i + 1}`
          )
          .join(',');


      await pool.query(
        `
        UPDATE businesses
        SET ${setClause}
        WHERE id=$${keys.length + 1}
        `,
        [
          ...values,
          req.user.id
        ]
      );


      res.json(
        await pub(req.user.id)
      );

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          error:
            'Bilgiler güncellenemedi'
        });

    }

  }
);


/* =========================
   QR CODE
========================= */

app.get(
  '/api/qr',
  auth,
  async (req, res) => {

    try {

      const business =
        await pub(req.user.id);


      if (!business) {

        return res
          .status(404)
          .json({
            error:
              'İşletme bulunamadı'
          });

      }


      const protocol =
        req.get('x-forwarded-proto') ||
        req.protocol;


      const host =
        req.get('host');


      const base =
        `${protocol}://${host}`;


      const url =
        `${base}/p/${business.slug}?source=qr`;


      const dataUrl =
        await QR.toDataURL(
          url,
          {
            width: 900,
            margin: 2,
            errorCorrectionLevel: 'H'
          }
        );


      res.json({
        url,
        dataUrl
      });

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          error:
            'QR kod oluşturulamadı'
        });

    }

  }
);


/* =========================
   STATISTICS
========================= */

app.get(
  '/api/stats',
  auth,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            type,
            COUNT(*)::int AS count
          FROM events
          WHERE business_id=$1
          GROUP BY type
          ORDER BY type
          `,
          [req.user.id]
        );


      res.json(
        result.rows
      );

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          error:
            'İstatistikler alınamadı'
        });

    }

  }
);


/* =========================
   EVENT TRACKING
========================= */

app.post(
  '/api/event/:slug',
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT id
          FROM businesses
          WHERE slug=$1
          `,
          [req.params.slug]
        );


      const business =
        result.rows[0];


      const allowed = [

        'profile_view',

        'qr_scan',
        'qr',
        'nfc',

        'phone',
        'whatsapp',
        'location',

        'instagram',
        'tiktok',

        'google_review',

        'website',
        'menu',

        'iban'

      ];


      if (
        !business ||
        !allowed.includes(
          req.body.type
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              'Geçersiz etkinlik'
          });

      }


      await pool.query(
        `
        INSERT INTO events(
          business_id,
          type
        )
        VALUES($1,$2)
        `,
        [
          business.id,
          req.body.type
        ]
      );


      res.json({
        ok: true
      });

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          error:
            'Etkinlik kaydedilemedi'
        });

    }

  }
);


/* =========================
   PUBLIC PROFILE API
========================= */

app.get(
  '/api/profile/:slug',
  async (req, res) => {

    try {

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
          `,
          [req.params.slug]
        );


      const business =
        result.rows[0];


      if (!business) {

        return res
          .status(404)
          .json({
            error:
              'Profil bulunamadı'
          });

      }


      res.json(
        business
      );

    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          error:
            'Profil alınamadı'
        });

    }

  }
);


/* =========================
   PUBLIC PROFILE
========================= */

app.get(
  '/p/:slug',
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT id
          FROM businesses
          WHERE slug=$1
          `,
          [req.params.slug]
        );


      const business =
        result.rows[0];


      if (!business) {

        return res
          .status(404)
          .send(
            'Profil bulunamadı'
          );

      }


      await pool.query(
        `
        INSERT INTO events(
          business_id,
          type
        )
        VALUES($1,$2)
        `,
        [
          business.id,
          'profile_view'
        ]
      );


      if (
        req.query.source === 'qr'
      ) {

        await pool.query(
          `
          INSERT INTO events(
            business_id,
            type
          )
          VALUES($1,$2)
          `,
          [
            business.id,
            'qr_scan'
          ]
        );

      }


      if (
        req.query.source === 'nfc'
      ) {

        await pool.query(
          `
          INSERT INTO events(
            business_id,
            type
          )
          VALUES($1,$2)
          `,
          [
            business.id,
            'nfc'
          ]
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

      res
        .status(500)
        .send(
          'Profil açılırken hata oluştu'
        );

    }

  }
);


/* =========================
   DASHBOARD
========================= */

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


/* =========================
   ADMIN PAGE
========================= */

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


/* =========================
   REGISTER PAGE
========================= */

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


/* =========================
   LOGIN PAGE
========================= */

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


/* =========================
   MAIN PAGE
========================= */

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


/* =========================
   START
========================= */

initDatabase()
  .then(() => {

    app.listen(
      PORT,
      '0.0.0.0',
      () => {

        console.log(
          `LEO CONNECT 3.1 PostgreSQL çalışıyor: ${PORT}`
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
