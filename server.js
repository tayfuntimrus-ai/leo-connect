require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QR = require('qrcode');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'change-me';

const db = new Database(
  process.env.DB_FILE || 'leo.db'
);

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

db.exec(`
CREATE TABLE IF NOT EXISTS businesses(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER,
  type TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);


/* =========================
   ESKİ VERİTABANINI KORU
========================= */

function addColumn(columnName) {

  try {

    db.exec(
      `ALTER TABLE businesses ADD COLUMN ${columnName} TEXT`
    );

  } catch (error) {

    // Kolon zaten varsa hata verme.
  }

}


[
  'whatsapp',
  'google_review',
  'website',
  'iban_holder',
  'logo_url'
].forEach(addColumn);


/* =========================
   HELPERS
========================= */

const slug = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'isletme';


const pub = (id) => {

  return db
    .prepare(`
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
      WHERE id=?
    `)
    .get(id);

};


/* =========================
   AUTH
========================= */

function auth(req, res, next) {

  try {

    const token =
      (req.headers.authorization || '')
        .replace(/^Bearer\s+/, '');

    req.user =
      jwt.verify(token, SECRET);

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
   HEALTH
========================= */

app.get(
  '/api/health',
  (req, res) => {

    res.json({
      ok: true,
      version: '2.2'
    });

  }
);


/* =========================
   REGISTER
========================= */

app.post(
  '/api/register',
  async (req, res) => {

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
      db
        .prepare(
          'SELECT id FROM businesses WHERE email=?'
        )
        .get(email);


    if (existing) {

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


    while (
      db
        .prepare(
          'SELECT id FROM businesses WHERE slug=?'
        )
        .get(sl)
    ) {

      n++;

      sl =
        base + '-' + n;

    }


    const passwordHash =
      await bcrypt.hash(
        password,
        12
      );


    const result =
      db
        .prepare(`
          INSERT INTO businesses(
            name,
            slug,
            email,
            password_hash,
            category
          )
          VALUES(?,?,?,?,?)
        `)
        .run(
          name,
          sl,
          email,
          passwordHash,
          category || ''
        );


    const business =
      pub(result.lastInsertRowid);


    const token =
      jwt.sign(
        {
          id: business.id
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

  }
);


/* =========================
   LOGIN
========================= */

app.post(
  '/api/login',
  async (req, res) => {

    const business =
      db
        .prepare(
          'SELECT * FROM businesses WHERE email=?'
        )
        .get(
          req.body.email || ''
        );


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
          id: business.id
        },
        SECRET,
        {
          expiresIn: '7d'
        }
      );


    res.json({
      token,
      business:
        pub(business.id)
    });

  }
);


/* =========================
   CURRENT BUSINESS
========================= */

app.get(
  '/api/me',
  auth,
  (req, res) => {

    res.json(
      pub(req.user.id)
    );

  }
);


/* =========================
   UPDATE BUSINESS
========================= */

app.put(
  '/api/me',
  auth,
  (req, res) => {

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


    db
      .prepare(`
        UPDATE businesses
        SET
          ${keys.map(
            k => k + '=?'
          ).join(',')}
        WHERE id=?
      `)
      .run(

        ...keys.map(
          k => req.body[k] ?? ''
        ),

        req.user.id

      );


    res.json(
      pub(req.user.id)
    );

  }
);


/* =========================
   QR CODE
========================= */

app.get(
  '/api/qr',
  auth,
  async (req, res) => {

    const business =
      pub(req.user.id);


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

  }
);


/* =========================
   STATISTICS
========================= */

app.get(
  '/api/stats',
  auth,
  (req, res) => {

    const stats =
      db
        .prepare(`
          SELECT
            type,
            COUNT(*) AS count
          FROM events
          WHERE business_id=?
          GROUP BY type
        `)
        .all(
          req.user.id
        );


    res.json(stats);

  }
);


/* =========================
   EVENT TRACKING
========================= */

app.post(
  '/api/event/:slug',
  (req, res) => {

    const business =
      db
        .prepare(
          'SELECT id FROM businesses WHERE slug=?'
        )
        .get(
          req.params.slug
        );


    const allowed = [

      'profile_view',

      'qr_scan',
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


    db
      .prepare(`
        INSERT INTO events(
          business_id,
          type
        )
        VALUES(?,?)
      `)
      .run(
        business.id,
        req.body.type
      );


    res.json({
      ok: true
    });

  }
);


/* =========================
   PUBLIC PROFILE API
========================= */

app.get(
  '/api/profile/:slug',
  (req, res) => {

    const business =
      db
        .prepare(
          'SELECT * FROM businesses WHERE slug=?'
        )
        .get(
          req.params.slug
        );


    if (!business) {

      return res
        .status(404)
        .json({
          error:
            'Profil bulunamadı'
        });

    }


    delete business.password_hash;


    res.json(
      business
    );

  }
);


/* =========================
   PUBLIC PROFILE
========================= */

app.get(
  '/p/:slug',
  (req, res) => {

    const business =
      db
        .prepare(
          'SELECT id FROM businesses WHERE slug=?'
        )
        .get(
          req.params.slug
        );


    if (!business) {

      return res
        .status(404)
        .send(
          'Profil bulunamadı'
        );

    }


    /*
      Her profil açılışını kaydet.
    */

    db
      .prepare(`
        INSERT INTO events(
          business_id,
          type
        )
        VALUES(?,?)
      `)
      .run(
        business.id,
        'profile_view'
      );


    /*
      QR üzerinden geldiyse
      ayrıca QR taramasını kaydet.
    */

    if (
      req.query.source === 'qr'
    ) {

      db
        .prepare(`
          INSERT INTO events(
            business_id,
            type
          )
          VALUES(?,?)
        `)
        .run(
          business.id,
          'qr_scan'
        );

    }


    /*
      NFC üzerinden geldiyse
      NFC etkileşimini kaydet.
    */

    if (
      req.query.source === 'nfc'
    ) {

      db
        .prepare(`
          INSERT INTO events(
            business_id,
            type
          )
          VALUES(?,?)
        `)
        .run(
          business.id,
          'nfc'
        );

    }


    res.sendFile(
      path.join(
        __dirname,
        'public',
        'profile.html'
      )
    );

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

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `LEO CONNECT V2.2 çalışıyor: ${PORT}`
    );

  }
);
