# LEO CONNECT V2

İşletmelere özel QR + NFC destekli dijital profil platformu. Müşteri raf standındaki
QR kodu okuttuğunda veya NFC etiketine dokunduğunda işletmenin profil sayfası açılır:
logo, isim, özel tema, Google yorum butonu ve sosyal medya bağlantıları.

Node.js + Express 5 + PostgreSQL. Frontend framework kullanılmıyor; sayfalar
`public/` altında statik HTML.

Ayrıntılı teknik dökümantasyon: [`DOKUMANTASYON.md`](DOKUMANTASYON.md)

## Kurulum

```bash
npm install
cp .env.example .env    # değerleri doldurun
npm start
```

Sunucu varsayılan olarak `http://localhost:10000` adresinde çalışır.

## Ortam Değişkenleri

`.env.example` dosyasını `.env` olarak kopyalayıp doldurun. `.env` commit edilmez.

| Değişken | Zorunlu | Açıklama |
|---|:--:|---|
| `DATABASE_URL` | **Evet** | PostgreSQL bağlantı dizesi. Yoksa sunucu başlamaz. |
| `JWT_SECRET` | **Evet** | Token imzalama anahtarı. Yoksa sunucu başlamaz. |
| `ADMIN_EMAIL` | Admin için | Boşsa `/api/admin/login` `503` döner. |
| `ADMIN_PASSWORD` | Admin için | Boşsa `/api/admin/login` `503` döner. |
| `PUBLIC_URL` | Önerilir | QR/NFC bağlantılarının mutlak adresi. |
| `RENDER_EXTERNAL_URL` | Otomatik | Render sağlar; `PUBLIC_URL` yoksa kullanılır. |
| `PORT` | Hayır | Varsayılan `10000`. Render kendi değerini enjekte eder. |
| `NODE_ENV` | Hayır | `production` ise PostgreSQL SSL açılır. |

`JWT_SECRET` üretmek için:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> `JWT_SECRET` değiştirildiğinde mevcut tüm oturumlar geçersiz olur;
> işletmeler ve admin yeniden giriş yapar.

## Deploy — Render

| Ayar | Değer |
|---|---|
| Build komutu | `npm install` |
| Start komutu | `npm start` |
| Deploy edilen dal | `v2-development` |

Dal her push'ta otomatik deploy edilir. Veritabanı şeması `initDatabase()`
içinde `CREATE TABLE IF NOT EXISTS` ile her açılışta uygulanır; ayrı bir
migration adımı yoktur.

## Dallar

| Dal | Rol |
|---|---|
| `v2-development` | **Aktif geliştirme ve yayın dalı** |
| `main` | İlk sürüm. Geride kalmıştır, deploy edilmez. |
| `backup-final-v1` | Eski yedek |

## Sayfalar

| Yol | Kim için |
|---|---|
| `/p/:slug` · `/p/nfc/:code` | Müşteri — profil sayfası |
| `/login` · `/dashboard` | İşletme paneli |
| `/admin` | Platform yönetimi |
| `/card/:slug` · `/card-login` | Kişisel dijital kartvizit |
| `/qr-center` · `/nfc-center` | QR ve NFC yönetim merkezleri |
