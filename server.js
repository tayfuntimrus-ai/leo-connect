require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QR = require('qrcode');
const { Pool } = require('pg');
const path = require('path');

const app = express();

const PORT =
  process.env.PORT || 3000;

const SECRET =
  process.env.JWT_SECRET || 'change-me';


/* =========================
   DATABASE CHECK
========================= */

if (!process.env.DATABASE_URL) {

  console.error(
    'DATABASE_URL bulunamadı!'
  );

  process.exit(1);

}


/* =========================
   DATABASE
========================= */

const pool =
  new Pool({

    connectionString:
      process.env.DATABASE_URL,

    ssl:
      process.env.NODE_ENV === 'production'
        ? {
            rejectUnauthorized: false
          }
        : false

  });


/* =========================
   APP
========================= */

app.use(cors());

app.use(
  express.json({
    limit: '2mb'
  })
);

app.use(
  express.static(
    path.join(
      __dirname,
      'public'
    )
  )
);


/* =========================
   DATABASE INITIALIZATION
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

      created_at
        TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP

    );


    CREATE TABLE IF NOT EXISTS events(

      id SERIAL PRIMARY KEY,

      business_id
        INTEGER
        REFERENCES businesses(id)
        ON DELETE CASCADE,

      type TEXT,

      created_at
        TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP

    );

  `);

}


/* =========================
   HELPERS
========================= */

function slug(value) {

  return String(value || '')

    .toLowerCase()

    .normalize('NFD')

    .replace(
      /[\u0300-\u036f]/g,
      ''
    )

    .replace(
      /[^a-z0-9]+/g,
      '-'
    )

    .replace(
      /^-|-$/g,
      ''
    )

    .slice(
      0,
      50
    )

    || 'isletme';

}


/* =========================
   PUBLIC BUSINESS DATA
========================= */

async function pub(id) {

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
        logo_url

      FROM businesses

      WHERE id=$1

      `,
      [id]
    );


  return (
    result.rows[0]
    || null
  );

}


/* =========================
   BUSINESS AUTH
========================= */

function auth(
  req,
  res,
  next
) {

  try {

    const token =
      (
        req.headers.authorization
        || ''
      )
        .replace(
          /^Bearer\s+/,
          ''
        );


    const user =
      jwt.verify(
        token,
        SECRET
      );


    if (
      !user.id ||
      (
        user.role &&
        user.role !== 'business'
      )
    ) {

      return res
        .status(403)
        .json({

          error:
            'İşletme yetkisi gerekli'

        });

    }


    req.user =
      user;


    next();


  } catch (error) {

    res
      .status(401)
      .json({

        error:
          'Oturum gerekli'

      });

  }

}


/* =========================
   ADMIN AUTH
========================= */

function adminAuth(
  req,
  res,
  next
) {

  try {

    const token =
      (
        req.headers.authorization
        || ''
      )
        .replace(
          /^Bearer\s+/,
          ''
        );


    const user =
      jwt.verify(
        token,
        SECRET
      );


    if (
      user.role !== 'admin'
    ) {

      return res
        .status(403)
        .json({

          error:
            'Admin yetkisi gerekli'

        });

    }


    req.admin =
      user;


    next();


  } catch (error) {

    res
      .status(401)
      .json({

        error:
          'Admin oturumu gerekli'

      });

  }

}


/* =========================
   HEALTH
========================= */

app.get(
  '/api/health',
  async (
    req,
    res
  ) => {

    try {

      await pool.query(
        'SELECT 1'
      );


      res.json({

        ok: true,

        version:
          '3.5-qr-center'

      });


    } catch (error) {

      console.error(
        error
      );


      res
        .status(500)
        .json({

          ok: false,

          error:
            'Veritabanı bağlantı hatası'

        });

    }

  }
);


/* =========================
   ADMIN LOGIN
========================= */

app.post(
  '/api/admin/login',
  async (
    req,
    res
  ) => {

    try {

      const {
        email,
        password
      } = req.body;


      const adminEmail =
        process.env.ADMIN_EMAIL
        || '';


      const adminPassword =
        process.env.ADMIN_PASSWORD
        || '';


      if (
        !adminEmail ||
        !adminPassword
      ) {

        return res
          .status(503)
          .json({

            error:
              'Admin hesabı henüz yapılandırılmadı'

          });

      }


      const emailMatch =
        String(
          email || ''
        )
          .trim()
          .toLowerCase()
        ===
        String(
          adminEmail
        )
          .trim()
          .toLowerCase();


      const passwordMatch =
        String(
          password || ''
        )
        ===
        String(
          adminPassword
        );


      if (
        !emailMatch ||
        !passwordMatch
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
            role:
              'admin',

            email:
              adminEmail
          },

          SECRET,

          {
            expiresIn:
              '7d'
          }

        );


      res.json({

        token,

        admin: {

          email:
            adminEmail

        }

      });


    } catch (error) {

      console.error(
        error
      );


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
  async (
    req,
    res
  ) => {

    try {

      const businesses =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS count
          FROM businesses
          `
        );


      const events =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS count
          FROM events
          `
        );


      const profiles =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS count
          FROM events
          WHERE type='profile_view'
          `
        );


      const qr =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS count
          FROM events
          WHERE type IN(
            'qr_scan',
            'qr'
          )
          `
        );


      const nfc =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS count
          FROM events
          WHERE type='nfc'
          `
        );


      const whatsapp =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS count
          FROM events
          WHERE type='whatsapp'
          `
        );


      const phone =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS count
          FROM events
          WHERE type='phone'
          `
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

      console.error(
        error
      );


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
   ADMIN BUSINESS LIST
========================= */

app.get(
  '/api/admin/businesses',
  adminAuth,
  async (
    req,
    res
  ) => {

    try {

      const result =
        await pool.query(
          `
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
              WHERE
                e.business_id=b.id
              AND
                e.type='profile_view'
            ),0)::int
            AS profile_views,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE
                e.business_id=b.id
              AND
                e.type IN(
                  'qr_scan',
                  'qr'
                )
            ),0)::int
            AS qr_scans,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE
                e.business_id=b.id
              AND
                e.type='nfc'
            ),0)::int
            AS nfc_scans,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE
                e.business_id=b.id
              AND
                e.type='whatsapp'
            ),0)::int
            AS whatsapp_clicks,

            COALESCE((
              SELECT COUNT(*)
              FROM events e
              WHERE
                e.business_id=b.id
              AND
                e.type='phone'
            ),0)::int
            AS phone_clicks

          FROM businesses b

          ORDER BY
            b.id DESC

          `
        );


      res.json(
        result.rows
      );


    } catch (error) {

      console.error(
        error
      );


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
   ADMIN CREATE BUSINESS
========================= */

app.post(
  '/api/admin/business',
  adminAuth,
  async (
    req,
    res
  ) => {

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
              'İşletme adı, e-posta ve şifre gerekli'

          });

      }


      if (
        String(password).length < 8
      ) {

        return res
          .status(400)
          .json({

            error:
              'Şifre en az 8 karakter olmalı'

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


      if (
        existing.rows.length
      ) {

        return res
          .status(409)
          .json({

            error:
              'Bu e-posta adresi zaten kayıtlı'

          });

      }


      const base =
        slug(
          name
        );


      let businessSlug =
        base;


      let number =
        1;


      while (true) {

        const check =
          await pool.query(
            `
            SELECT id
            FROM businesses
            WHERE slug=$1
            `,
            [
              businessSlug
            ]
          );


        if (
          !check.rows.length
        ) {

          break;

        }


        number++;

        businessSlug =
          base +
          '-' +
          number;

      }


      const passwordHash =
        await bcrypt.hash(
          String(password),
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

          RETURNING id

          `,
          [

            String(name)
              .trim(),

            businessSlug,

            normalizedEmail,

            passwordHash,

            String(
              category || ''
            ).trim()

          ]
        );


      const business =
        await pub(
          result.rows[0].id
        );


      res
        .status(201)
        .json({

          ok:
            true,

          business

        });


    } catch (error) {

      console.error(
        error
      );


      res
        .status(500)
        .json({

          error:
            'Yeni işletme oluşturulamadı'

        });

    }

  }
);


/* =========================
   ADMIN BUSINESS DETAIL
========================= */

app.get(
  '/api/admin/business/:id',
  adminAuth,
  async (
    req,
    res
  ) => {

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

          `,
          [
            req.params.id
          ]
        );


      const business =
        result.rows[0];


      if (!business) {

        return res
          .status(404)
          .json({

            error:
              'İşletme bulunamadı'

          });

      }


      const statsResult =
        await pool.query(
          `
          SELECT

            type,

            COUNT(*)::int
            AS count

          FROM events

          WHERE
            business_id=$1

          GROUP BY
            type

          ORDER BY
            type

          `,
          [
            business.id
          ]
        );


      const stats = {};


      statsResult.rows.forEach(
        item => {

          stats[item.type] =
            item.count;

        }
      );


      const totalEvents =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS count
          FROM events
          WHERE business_id=$1
          `,
          [
            business.id
          ]
        );


      res.json({

        business,

        stats,

        total_events:
          totalEvents.rows[0].count

      });


    } catch (error) {

      console.error(
        error
      );


      res
        .status(500)
        .json({

          error:
            'İşletme detayları alınamadı'

        });

    }

  }
);


/* =========================
   ADVANCED BUSINESS ANALYTICS
========================= */

app.get(
  '/api/admin/business/:id/analytics',
  adminAuth,
  async (
    req,
    res
  ) => {

    try {

      const businessId =
        req.params.id;


      const allowedPeriods = [
        'today',
        '7d',
        '30d',
        'all'
      ];


      const period =
        allowedPeriods.includes(
          String(
            req.query.period || '30d'
          )
        )
          ? String(
              req.query.period || '30d'
            )
          : '30d';


      /* BUSINESS */

      const businessResult =
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
            businessId
          ]
        );


      const business =
        businessResult.rows[0];


      if (!business) {

        return res
          .status(404)
          .json({

            error:
              'İşletme bulunamadı'

          });

      }


      /* DATE CONDITION */

      let dateCondition =
        '';

      if (
        period === 'today'
      ) {

        dateCondition =
          `
          AND created_at >=
            CURRENT_DATE
          `;

      }

      if (
        period === '7d'
      ) {

        dateCondition =
          `
          AND created_at >=
            CURRENT_DATE - INTERVAL '6 days'
          `;

      }

      if (
        period === '30d'
      ) {

        dateCondition =
          `
          AND created_at >=
            CURRENT_DATE - INTERVAL '29 days'
          `;

      }


      /* TOTALS */

      const totalResult =
        await pool.query(
          `
          SELECT

            type,

            COUNT(*)::int
            AS count

          FROM events

          WHERE
            business_id=$1

          ${dateCondition}

          GROUP BY
            type

          ORDER BY
            count DESC

          `,
          [
            businessId
          ]
        );


      const totals = {};


      totalResult.rows.forEach(
        item => {

          totals[item.type] =
            Number(
              item.count
            );

        }
      );


      /* DAILY */

      const dailyResult =
        await pool.query(
          `
          SELECT

            date_trunc(
              'day',
              created_at
            ) AS day,

            COUNT(*)::int
              AS total,

            COUNT(*) FILTER(
              WHERE type='profile_view'
            )::int
              AS profile_views,

            COUNT(*) FILTER(
              WHERE type IN(
                'qr_scan',
                'qr'
              )
            )::int
              AS qr_scans,

            COUNT(*) FILTER(
              WHERE type='nfc'
            )::int
              AS nfc_scans,

            COUNT(*) FILTER(
              WHERE type='whatsapp'
            )::int
              AS whatsapp,

            COUNT(*) FILTER(
              WHERE type='phone'
            )::int
              AS phone,

            COUNT(*) FILTER(
              WHERE type='location'
            )::int
              AS location,

            COUNT(*) FILTER(
              WHERE type='instagram'
            )::int
              AS instagram,

            COUNT(*) FILTER(
              WHERE type='tiktok'
            )::int
              AS tiktok,

            COUNT(*) FILTER(
              WHERE type='google_review'
            )::int
              AS google_review,

            COUNT(*) FILTER(
              WHERE type='website'
            )::int
              AS website,

            COUNT(*) FILTER(
              WHERE type='menu'
            )::int
              AS menu,

            COUNT(*) FILTER(
              WHERE type='iban'
            )::int
              AS iban

          FROM events

          WHERE
            business_id=$1

          ${dateCondition}

          GROUP BY
            date_trunc(
              'day',
              created_at
            )

          ORDER BY
            day ASC

          `,
          [
            businessId
          ]
        );


      const daily =
        dailyResult.rows.map(
          item => ({

            day:
              item.day,

            total:
              Number(
                item.total
              ),

            profile_views:
              Number(
                item.profile_views
              ),

            qr_scans:
              Number(
                item.qr_scans
              ),

            nfc_scans:
              Number(
                item.nfc_scans
              ),

            whatsapp:
              Number(
                item.whatsapp
              ),

            phone:
              Number(
                item.phone
              ),

            location:
              Number(
                item.location
              ),

            instagram:
              Number(
                item.instagram
              ),

            tiktok:
              Number(
                item.tiktok
              ),

            google_review:
              Number(
                item.google_review
              ),

            website:
              Number(
                item.website
              ),

            menu:
              Number(
                item.menu
              ),

            iban:
              Number(
                item.iban
              )

          })
        );


      /* CHANNELS */

      const channels = [

        {
          key:
            'profile_view',

          label:
            'Profil Görüntüleme',

          value:
            totals.profile_view || 0
        },

        {
          key:
            'whatsapp',

          label:
            'WhatsApp',

          value:
            totals.whatsapp || 0
        },

        {
          key:
            'phone',

          label:
            'Telefon',

          value:
            totals.phone || 0
        },

        {
          key:
            'location',

          label:
            'Konum',

          value:
            totals.location || 0
        },

        {
          key:
            'instagram',

          label:
            'Instagram',

          value:
            totals.instagram || 0
        },

        {
          key:
            'tiktok',

          label:
            'TikTok',

          value:
            totals.tiktok || 0
        },

        {
          key:
            'google_review',

          label:
            'Google Yorum',

          value:
            totals.google_review || 0
        },

        {
          key:
            'website',

          label:
            'Web Sitesi',

          value:
            totals.website || 0
        },

        {
          key:
            'menu',

          label:
            'Menü',

          value:
            totals.menu || 0
        },

        {
          key:
            'iban',

          label:
            'IBAN',

          value:
            totals.iban || 0
        }

      ];


      /* QR / NFC */

      const sources = {

        qr:
          (
            totals.qr_scan || 0
          )
          +
          (
            totals.qr || 0
          ),

        nfc:
          totals.nfc || 0

      };


      /* TOTAL */

      const totalEvents =
        Object.values(
          totals
        )
          .reduce(
            (
              total,
              value
            ) =>
              total +
              Number(value || 0),
            0
          );


      res.json({

        ok:
          true,

        business,

        period,

        total_events:
          totalEvents,

        totals,

        sources,

        channels,

        daily

      });


    } catch (error) {

      console.error(
        'ANALYTICS ERROR:',
        error
      );


      res
        .status(500)
        .json({

          error:
            'Detaylı analitik verileri alınamadı'

        });

    }

  }
);


/* =========================
   ADMIN BUSINESS QR
========================= */

app.get(
  '/api/admin/business/:id/qr',
  adminAuth,
  async (
    req,
    res
  ) => {

    try {

      const business =
        await pub(
          req.params.id
        );


      if (!business) {

        return res
          .status(404)
          .json({

            error:
              'İşletme bulunamadı'

          });

      }


      const protocol =
        req.get(
          'x-forwarded-proto'
        )
        ||
        req.protocol;


      const host =
        req.get(
          'host'
        );


      const url =
        `${protocol}://${host}/p/${business.slug}?source=qr`;


      const dataUrl =
        await QR.toDataURL(
          url,
          {

            width:
              900,

            margin:
              2,

            errorCorrectionLevel:
              'H'

          }
        );


      res.json({

        url,

        dataUrl

      });


    } catch (error) {

      console.error(
        error
      );


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
   ADMIN UPDATE BUSINESS
========================= */

app.put(
  '/api/admin/business/:id',
  adminAuth,
  async (
    req,
    res
  ) => {

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
          key =>
            req.body[key]
            ?? ''
        );


      const setClause =
        keys
          .map(
            (
              key,
              index
            ) =>
              `${key}=$${index + 1}`
          )
          .join(',');


      const result =
        await pool.query(

          `
          UPDATE businesses

          SET
            ${setClause}

          WHERE
            id=$${keys.length + 1}

          RETURNING id

          `,

          [

            ...values,

            req.params.id

          ]

        );


      if (
        !result.rows.length
      ) {

        return res
          .status(404)
          .json({

            error:
              'İşletme bulunamadı'

          });

      }


      const business =
        await pub(
          req.params.id
        );


      res.json({

        ok:
          true,

        business

      });


    } catch (error) {

      console.error(
        error
      );


      res
        .status(500)
        .json({

          error:
            'İşletme güncellenemedi'

        });

    }

  }
);


/* =========================
   ADMIN DELETE BUSINESS
========================= */

app.delete(
  '/api/admin/business/:id',
  adminAuth,
  async (
    req,
    res
  ) => {

    try {

      const result =
        await pool.query(
          `
          DELETE FROM businesses

          WHERE id=$1

          RETURNING id

          `,
          [
            req.params.id
          ]
        );


      if (
        !result.rows.length
      ) {

        return res
          .status(404)
          .json({

            error:
              'İşletme bulunamadı'

          });

      }


      res.json({

        ok:
          true

      });


    } catch (error) {

      console.error(
        error
      );


      res
        .status(500)
        .json({

          error:
            'İşletme silinemedi'

        });

    }

  }
);


/* =========================
   REGISTER
========================= */

app.post(
  '/api/register',
  async (
    req,
    res
  ) => {

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


      if (
        existing.rows.length
      ) {

        return res
          .status(409)
          .json({

            error:
              'E-posta zaten kayıtlı'

          });

      }


      const base =
        slug(
          name
        );


      let sl =
        base;


      let n =
        1;


      while (true) {

        const check =
          await pool.query(
            `
            SELECT id
            FROM businesses
            WHERE slug=$1
            `,
            [
              sl
            ]
          );


        if (
          !check.rows.length
        ) {

          break;

        }


        n++;


        sl =
          base +
          '-' +
          n;

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

          RETURNING id

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
        await pub(
          result.rows[0].id
        );


      const token =
        jwt.sign(

          {

            id:
              business.id,

            role:
              'business'

          },

          SECRET,

          {

            expiresIn:
              '7d'

          }

        );


      res.json({

        token,

        business

      });


    } catch (error) {

      console.error(
        error
      );


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
   BUSINESS LOGIN
========================= */

app.post(
  '/api/login',
  async (
    req,
    res
  ) => {

    try {

      const normalizedEmail =
        String(
          req.body.email
          || ''
        )
          .trim()
          .toLowerCase();


      const result =
        await pool.query(
          `
          SELECT *

          FROM businesses

          WHERE
            email=$1

          `,
          [
            normalizedEmail
          ]
        );


      const business =
        result.rows[0];


      if (
        !business ||
        !business.password_hash
      ) {

        return res
          .status(401)
          .json({

            error:
              'E-posta veya şifre hatalı'

          });

      }


      const validPassword =
        await bcrypt.compare(

          req.body.password
          || '',

          business.password_hash

        );


      if (
        !validPassword
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

            id:
              business.id,

            role:
              'business'

          },

          SECRET,

          {

            expiresIn:
              '7d'

          }

        );


      res.json({

        token,

        business:
          await pub(
            business.id
          )

      });


    } catch (error) {

      console.error(
        error
      );


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
  async (
    req,
    res
  ) => {

    try {

      const business =
        await pub(
          req.user.id
        );


      if (!business) {

        return res
          .status(404)
          .json({

            error:
              'İşletme bulunamadı'

          });

      }


      res.json(
        business
      );


    } catch (error) {

      console.error(
        error
      );


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
   UPDATE CURRENT BUSINESS
========================= */

app.put(
  '/api/me',
  auth,
  async (
    req,
    res
  ) => {

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
          key =>
            req.body[key]
            ?? ''
        );


      const setClause =
        keys
          .map(
            (
              key,
              index
            ) =>
              `${key}=$${index + 1}`
          )
          .join(',');


      await pool.query(

        `
        UPDATE businesses

        SET
          ${setClause}

        WHERE
          id=$${keys.length + 1}

        `,

        [

          ...values,

          req.user.id

        ]

      );


      res.json(

        await pub(
          req.user.id
        )

      );


    } catch (error) {

      console.error(
        error
      );


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
  async (
    req,
    res
  ) => {

    try {

      const business =
        await pub(
          req.user.id
        );


      if (!business) {

        return res
          .status(404)
          .json({

            error:
              'İşletme bulunamadı'

          });

      }


      const protocol =
        req.get(
          'x-forwarded-proto'
        )
        ||
        req.protocol;


      const host =
        req.get(
          'host'
        );


      const base =
        `${protocol}://${host}`;


      const url =
        `${base}/p/${business.slug}?source=qr`;


      const dataUrl =
        await QR.toDataURL(

          url,

          {

            width:
              900,

            margin:
              2,

            errorCorrectionLevel:
              'H'

          }

        );


      res.json({

        url,

        dataUrl

      });


    } catch (error) {

      console.error(
        error
      );


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
   BUSINESS STATISTICS
========================= */

app.get(
  '/api/stats',
  auth,
  async (
    req,
    res
  ) => {

    try {

      const result =
        await pool.query(
          `
          SELECT

            type,

            COUNT(*)::int
            AS count

          FROM events

          WHERE
            business_id=$1

          GROUP BY
            type

          ORDER BY
            type

          `,
          [
            req.user.id
          ]
        );


      const rows =
        result.rows;


      const stats = {

        total_events:
          rows.reduce(
            (
              total,
              item
            ) =>
              total +
              Number(
                item.count || 0
              ),
            0
          ),

        profile_views:
          0,

        qr_scans:
          0,

        nfc_scans:
          0,

        whatsapp_clicks:
          0,

        phone_clicks:
          0

      };


      rows.forEach(
        item => {

          const count =
            Number(
              item.count || 0
            );


          if (
            item.type ===
            'profile_view'
          ) {

            stats.profile_views =
              count;

          }


          if (
            item.type ===
            'qr_scan'
          ) {

            stats.qr_scans +=
              count;

          }


          if (
            item.type ===
            'qr'
          ) {

            stats.qr_scans +=
              count;

          }


          if (
            item.type ===
            'nfc'
          ) {

            stats.nfc_scans =
              count;

          }


          if (
            item.type ===
            'whatsapp'
          ) {

            stats.whatsapp_clicks =
              count;

          }


          if (
            item.type ===
            'phone'
          ) {

            stats.phone_clicks =
              count;

          }

        }
      );


      /* Keep individual event data available too */

      rows.forEach(
        item => {

          stats[item.type] =
            Number(
              item.count || 0
            );

        }
      );


      res.json(
        stats
      );


    } catch (error) {

      console.error(
        error
      );


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
  async (
    req,
    res
  ) => {

    try {

      const result =
        await pool.query(
          `
          SELECT id

          FROM businesses

          WHERE
            slug=$1

          `,
          [
            req.params.slug
          ]
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

        VALUES(

          $1,
          $2

        )

        `,

        [

          business.id,
          req.body.type

        ]

      );


      res.json({

        ok:
          true

      });


    } catch (error) {

      console.error(
        error
      );


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
  async (
    req,
    res
  ) => {

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

          WHERE
            slug=$1

          `,
          [
            req.params.slug
          ]
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

      console.error(
        error
      );


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
  async (
    req,
    res
  ) => {

    try {

      const result =
        await pool.query(
          `
          SELECT id

          FROM businesses

          WHERE
            slug=$1

          `,
          [
            req.params.slug
          ]
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


      /* PROFILE VIEW */

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

          business.id,
          'profile_view'

        ]

      );


      /* QR */

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
            $2

          )

          `,

          [

            business.id,
            'qr_scan'

          ]

        );

      }


      /* NFC */

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
            $2

          )

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

      console.error(
        error
      );


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
  (
    req,
    res
  ) => {

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
   QR CENTER
========================= */

app.get(
  '/qr-center',
  (
    req,
    res
  ) => {

    res.sendFile(

      path.join(

        __dirname,
        'public',
        'qr-center.html'

      )

    );

  }
);


/* =========================
   ADMIN PAGE
========================= */

app.get(
  '/admin',
  (
    req,
    res
  ) => {

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
  (
    req,
    res
  ) => {

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
  (
    req,
    res
  ) => {

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
  (
    req,
    res
  ) => {

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

  .then(
    () => {

      app.listen(

        PORT,

        '0.0.0.0',

        () => {

          console.log(

            `LEO CONNECT 3.5 çalışıyor: ${PORT}`

          );

        }

      );

    }

  )

  .catch(
    error => {

      console.error(

        'DATABASE BAŞLATMA HATASI:',

        error

      );


      process.exit(1);

    }
  );
