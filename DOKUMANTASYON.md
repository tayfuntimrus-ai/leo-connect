# LEO CONNECT — Teknik Dökümantasyon

> Kaynak: `v2-development` dalı — **aktif geliştirme ve yayın dalı**.
> Son güncelleme: 6 Eylül 2026.
> Kod okunarak çıkarılmıştır; belirtilen doğrulamalar otomatik koşumlarla yapılmıştır.

---

## 1. Genel Bakış

### 1.1 Ürün

LeoConnect, işletmelere özel **QR + NFC destekli raf standı** çözümüdür. Her işletmeye özel QR kodu ve NFC etiketi üretilir. Müşteri okuttuğunda işletmenin dijital profil sayfası açılır: logo, isim, özel tema, Google yorum butonu ve sosyal medya bağlantıları.

Her fiziksel etiket ayrı ölçülür, böylece hangi standın ne kadar okutulduğu görülebilir.

### 1.2 Kullanıcı Rolleri

| Rol | Giriş | Panel | Ne yapar |
|---|---|---|---|
| **Admin** | `/admin` | `admin.html` | İşletme açar, modül izinlerini dağıtır, NFC etiketi üretir, tüm analitiği görür |
| **İşletme** | `/login` | `dashboard.html` | Profilini düzenler, QR/NFC yönetir, analitiğini izler |
| **Kartvizit sahibi** | `/card-login` | `card-dashboard.html` | Kişisel dijital kartvizitini düzenler |

Dördüncü kullanıcı **müşteri**: giriş yapmaz, QR/NFC okutup profil sayfasını görür.

### 1.3 Teknoloji

| Katman | Teknoloji |
|---|---|
| Çalışma ortamı | Node.js |
| Web sunucusu | Express 5.2 |
| Veritabanı | PostgreSQL — `pg` 8.23 |
| Kimlik doğrulama | `jsonwebtoken` 9 + `bcryptjs` 3 |
| Rate limit | `express-rate-limit` 8.7 |
| QR üretimi | `qrcode` 1.5 |
| Frontend | **Framework yok** — statik HTML + gömülü CSS/JS |
| Hosting | Render — `v2-development` dalından otomatik deploy |

> Frontend'de React, Vue, Tailwind veya build adımı **yoktur**.

### 1.4 Kod Büyüklüğü

| Dosya | Satır | Boyut | Rolü |
|---|---:|---:|---|
| `public/dashboard.html` | 4.333 | 202 KB | İşletme paneli |
| `server.js` | 4.031 | 137 KB | **Tüm backend** — tek dosya |
| `public/nfc-center.html` | 2.042 | 48 KB | NFC yönetim merkezi |
| `public/profile.html` | 1.018 | 44 KB | Müşteriye açılan profil |
| `public/qr-center.html` | 963 | 26 KB | QR yönetim merkezi |
| `public/admin.html` | 899 | 76 KB | Admin paneli |
| `public/index.html` | 242 | 153 KB | Tanıtım sayfası |
| `public/business-card.html` · `card-dashboard.html` · `card-login.html` | 1-2 | 16 KB | Kartvizit (tek satıra sıkıştırılmış) |

---

## 2. Mimari

```
   Müşteri ──QR/NFC──┐
   İşletme ──────────┼──► Express (server.js) ──► PostgreSQL
   Admin   ──────────┘      tek süreç, tek dosya
```

Router ayrımı, servis katmanı, ORM veya migration aracı yok. Şema `initDatabase()` içinde `CREATE TABLE IF NOT EXISTS` ve `ALTER TABLE … IF NOT EXISTS` ile her açılışta uygulanır.

**Müşteri akışı:**

1. NFC okutulur → `GET /p/nfc/:code`
2. Sunucu etiketi doğrular, **tek event kaydeder** (`nfc` veya `?source=qr` ise `qr_scan`), `profile.html` gönderir
3. Sayfa `GET /api/profile-by-nfc/:code` ile veriyi çeker
4. Butona tıklanır → `POST /api/event/:slug`

---

## 3. Kurulum

```bash
npm install
cp .env.example .env    # değerleri doldurun
npm start
```

### Ortam Değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|:--:|---|
| `DATABASE_URL` | **Evet** | Yoksa süreç `exit(1)` |
| `JWT_SECRET` | **Evet** | Yoksa süreç `exit(1)`. Zayıfsa uyarır ama durdurmaz |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` | Admin için | Boşsa admin girişi `503` |
| `PUBLIC_URL` | Önerilir | QR/NFC bağlantılarının mutlak adresi |
| `RENDER_EXTERNAL_URL` | Otomatik | Render sağlar |
| `PORT` | Hayır | Varsayılan `10000` |
| `NODE_ENV` | Hayır | `production` ise PostgreSQL SSL |

```bash
# JWT_SECRET üretmek için
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> `JWT_SECRET` değiştirilirse mevcut tüm oturumlar geçersiz olur.

---

## 4. Deploy — Render

| Ayar | Değer |
|---|---|
| Build | `npm install` |
| Start | `npm start` |
| Dal | `v2-development` (her push'ta otomatik) |

`render.yaml` yok; yapılandırma Render arayüzünden elle yapılmış.

`app.set('trust proxy', 1)` ayarlıdır — Render ters proxy arkasında çalıştığı için rate limit'in doğru IP görmesi buna bağlıdır.

---

## 5. Veri Modeli

7 tablo, tümü `initDatabase()` içinde.

### 5.1 `businesses`

**Kimlik:** `id` · `slug` (UNIQUE, public URL) · `email` (UNIQUE) · `password_hash` (bcrypt) · `created_at`

**Profil alanları (15):** `name`, `category`, `description`, `phone`, `whatsapp`, `address`, `instagram`, `tiktok`, `google_review`, `website`, `menu`, `hours`, `iban`, `iban_holder`, `logo_url`

**Modül izinleri** — admin dağıtır:

| Kolon | Varsayılan | Modül |
|---|:--:|---|
| `dashboard_profile` | `TRUE` | Profil düzenleme |
| `dashboard_qr` | `FALSE` | QR merkezi |
| `dashboard_nfc` | `FALSE` | NFC merkezi |
| `dashboard_analytics` | `FALSE` | Analitik |
| `dashboard_live` | `FALSE` | Canlı aktivite |
| `dashboard_ai` | `FALSE` | AI Insights |
| `dashboard_review` | `FALSE` | Yorum yönlendirme |
| `dashboard_campaign` | `FALSE` | Kampanyalar |

> Yeni işletme varsayılan olarak **sadece profilini düzenleyebilir**.

**JSONB:** `profile_field_permissions` · `social_links` · `custom_links` (maks. 20) · `social_platform_permissions` · ayrıca `profile_theme_permission` (boolean)

### 5.2 `events`

| Kolon | Tip | Not |
|---|---|---|
| `id` | SERIAL | PK |
| `business_id` | INTEGER | **FK → `businesses(id)` `ON DELETE CASCADE`** |
| `type` | TEXT | 35 geçerli değer |
| `source` | TEXT | `''` · `direct` · `qr` · `nfc` |
| `nfc_tag_id` | INTEGER | FK → `nfc_tags(id)` `ON DELETE SET NULL` |
| `created_at` | TIMESTAMP | |

**İndeksler:** `business_id`, `type`, `source`, `nfc_tag_id`

### 5.3 `nfc_tags`

`id` · `business_id` (FK CASCADE) · `name` · `placement` (fiziksel konum, ör. "3 numaralı masa") · `code` (UNIQUE, 24 karakter hex) · `is_active` · `created_at` · `updated_at`

Pasif etiket okutulduğunda `410` + "NFC etiketi pasif" sayfası döner.

### 5.4 `card_people`

`id` · `slug` (UNIQUE) · `email` (UNIQUE) · `password_hash` · `enabled` · `data` (JSONB, 19 alan) · `permissions` (JSONB)

**19 alan:** `display_name`, `person_name`, `job_title`, `company`, `phone`, `whatsapp`, `email`, `website`, `address`, `instagram`, `facebook`, `tiktok`, `linkedin`, `youtube`, `x`, `photo_url`, `cover_url`, `bio`, `note`

> İzinler burada varsayılan **`false`** — admin açmadıkça hiçbir alan public görünmez. (`businesses` tablosunun tersi.)

### 5.5 `profile_designs`

`business_id` UNIQUE. Tema (`midnight-gold` · `obsidian` · `champagne` · `pure-light`), vurgu rengi (`#D4AF37`), kapak, duyuru, kampanya bloğu, öne çıkan blok, galeri, video.

### 5.6 `campaigns`

Çoklu ve tarih aralıklı kampanyalar: `title` · `text` · `image_url` · `button_text` · `button_url` · `starts_at` · `ends_at` · `enabled` · `priority`

İndeks: `business_id` ve `(enabled, starts_at, ends_at)`

### 5.7 `review_boosters`

`business_id` UNIQUE. Müşteriye önce puan sorulur; puan `threshold`'un (varsayılan `4`) altındaysa Google yerine işletmeye özel geri bildirim ekranına yönlendirilir.

---

## 6. Kimlik Doğrulama

| Rol | Middleware | Ömür |
|---|---|:--:|
| `admin` | `adminAuth` | 7 gün |
| `business` | `auth` | 30 gün |
| `card_person` | `cardPersonAuth` | 30 gün |

Taşıma: `Authorization: Bearer <token>`. Hepsi aynı `JWT_SECRET` ile imzalanır, `role` ile ayrışır.

**Admin veritabanında tutulmaz** — `ADMIN_EMAIL` / `ADMIN_PASSWORD` ile karşılaştırılır.

**Modül izinleri** her istekte veritabanından yeniden okunur (`requireBusinessPermission`), token'a güvenilmez. İzin yoksa `403` ve cevapta tüm `permissions` nesnesi döner.

**İki katmanlı görünürlük:** admin bir işletmenin hangi alanları *düzenleyebileceğini* değil, hangilerinin *yayınlanacağını* da kontrol eder.

---

## 7. API Referansı

58 kayıtlı route. 🔓 açık · 🔑 işletme · 👑 admin · 🪪 kartvizit

### Kimlik

| Metot | Yol | Erişim | Not |
|---|---|:--:|---|
| POST | `/api/register` | 🔓 | **Rate limit** |
| POST | `/api/login` | 🔓 | **Rate limit** |
| POST | `/api/admin/login` | 🔓 | **Rate limit** |
| POST | `/api/card-login` | 🔓 | **Rate limit** |
| GET · PUT | `/api/me` | 🔑 | Profil |

### Public

| Metot | Yol | Not |
|---|---|---|
| GET | `/api/profile/:slug` | Profil + tasarım + review booster + kampanyalar |
| GET | `/api/profile-by-nfc/:code` | Aynısı, NFC koduyla |
| GET | `/api/public-card/:slug` | Kartvizit — sadece izinli alanlar |
| POST | `/api/event/:slug` | Etkileşim kaydı — **rate limit 300/dk** |
| GET | `/api/health` | DB sağlık kontrolü |

### İşletme Paneli

| Yol | İzin |
|---|:--:|
| `/api/qr` | `qr` |
| `/api/stats` | — |
| `/api/business-analytics` | `analytics` |
| `/api/business-live-activity` | `live` |
| `/api/business-ai-insights` | `ai` |
| `/api/business-profile-design` | `profile` |
| `/api/business-v2-settings` · `/api/business-theme` · `/api/business-social-links` · `/api/business-custom-links` | `profile` |
| `/api/business-campaigns` (+`/:id`) | `campaign` |
| `/api/business-review-booster` | `review` |
| `/api/nfc-tags` (+`/:id`, `/:id/qr`) | `nfc` |

### Admin

`/api/admin/overview` · `/api/admin/live-activity` · `/api/admin/businesses` · `/api/admin/business/:id` (+`/permissions`, `/v2-settings`, `/theme`, `/theme-permission`, `/social-platform-permissions`, `/analytics`) · `/api/admin/card-people` (+`/:id`) · NFC yönetim route'ları

### Sayfa ve Görseller

| Yol | Döndürdüğü |
|---|---|
| `/` · `/login` · `/register` | `index.html` · `login.html` · `register.html` |
| `/dashboard` · `/admin` | Paneller |
| `/qr-center` · `/nfc-center` | Yönetim merkezleri |
| `/p/:slug` | `profile.html` |
| `/p/nfc/:code` | `profile.html` + **event kaydeder** |
| `/card/:slug` · `/card-login` · `/card-dashboard` | Kartvizit |
| `/qr/nfc/:code.png` | Masa/nokta QR **PNG görseli** |
| *(diğer)* | `index.html` fallback |

> ⚠️ Fallback bilinmeyen her yola `index.html` döndürür — **200 OK** ile. Silinen bir route'a frontend'den istek atılırsa hata değil, HTML döner. Geçmişte tam olarak bu sessiz kırılma yaşandı ([Bölüm 9.1](#91-masanokta-qr-görselleri-bozuktu)).

---

## 8. Event Sistemi

### 8.1 Tek Kaynak

Geçerli event tipleri `server.js` içinde **`EVENT_TYPES`** sabitinde tanımlıdır (35 tip). Şu üç yer ondan beslenir:

1. `/api/event/:slug` doğrulaması
2. Canlı akış sorgusu
3. Canlı akış istatistik sorgusu

> Bu liste eskiden üç ayrı yerde tekrarlanıyor ve ayrışıyordu. Sonucu: `whatsapp` canlı akışta görünürken `phone` görünmüyordu.

**35 tip:**

| Grup | Tipler |
|---|---|
| Profil açılışı | `profile_view` `qr_scan` `qr` `nfc` |
| İletişim | `whatsapp` `phone` `email` `telegram` |
| Sosyal | `instagram` `facebook` `tiktok` `youtube` `linkedin` `x` |
| İşletme bağlantıları | `google_review` `website` `menu` `location` `iban` `share` `tripadvisor` `booking` `bilet` `rezervasyon` |
| Sipariş platformları | `yemeksepeti` `getir` `trendyol-yemek` `migros-yemek` `order` |
| Yorum yönlendirme | `review_open` `review_positive` `review_feedback` |
| İçerik blokları | `campaign_view` `campaign_click` `featured_click` |

### 8.2 Profil Açılışı

Bir profil açılışı **tam olarak bir** event üretir:

| Yol | Üretilen tip |
|---|---|
| `/p/:slug` | `profile_view` (source `direct`) |
| `/p/:slug?source=qr` | `qr_scan` |
| `/p/:slug?source=nfc` | `nfc` |
| `/p/nfc/:code` | `nfc` |
| `/p/nfc/:code?source=qr` | `qr_scan` |

Aynı fiziksel etiketin QR ile mi NFC ile mi okutulduğu `?source=qr` ile ayrılır — raf standı ürünü için doğrudan işe yarayan ölçüm.

### 8.3 "Profil Görüntüleme" Metriği

Panellerdeki bu metrik yukarıdaki **dört tipin toplamını** sayar (`PROFILE_OPEN_TYPES` sabiti). Sadece `profile_view` sayılsaydı QR ve NFC okutmaları — yani ürünün asıl kullanım biçimi — metriğe hiç girmezdi.

---

## 9. Düzeltilen Sorunlar

Aşağıdakiler 6 Eylül 2026'da tespit edilip düzeltildi ve canlıya alındı.

### 9.1 Masa/nokta QR görselleri bozuktu

`/qr/nfc/:code.png` ve `/api/nfc-tags/:id/qr` route'ları `v2-development`'ta silinmiş, ancak `dashboard.html` hâlâ bu adresleri kullanıyordu. Fallback `index.html` döndürdüğü için:

- QR görselleri kırıktı (`image/png` yerine `text/html`)
- "QR İndir" **200 OK** aldığı için hata vermeden, içi HTML olan bozuk bir `.png` indiriyordu

**Doğrulama:** düzeltme öncesi `200 text/html`, gövde `<!doctype html>`. Sonrası `200 image/png`, 6112 bayt gerçek PNG.

### 9.2 Dashboard'da QR sayacı hep sıfırdı

`/api/nfc-tags` artık `qr_count` / `nfc_count` / `total_count` döndürmüyordu; `dashboard.html` bu alanları okuduğu için masa QR okutmaları panelde hiç görünmüyordu. Kalan `tap_count` yalnızca `type='nfc'` saydığından QR taramaları toplamdan da düşüyordu.

### 9.3 `JWT_SECRET` sessizce sızmış anahtara düşebiliyordu

```js
const SECRET = process.env.JWT_SECRET || 'leo-connect-change-this-secret';
```

Ortam değişkeni yoksa tüm token'lar depoda açıkta duran sabit anahtarla imzalanıyordu; o anahtarı gören herkes admin token'ı üretebilirdi. Artık `DATABASE_URL` ile aynı davranış: yoksa süreç açılmaz. Zayıf değer **uyarır ama durdurmaz** (beklenmedik kesinti oluşmasın diye).

### 9.4 Giriş uçları kaba kuvvete açıktı

Rate limit eklendi: 15 dakikada 15 **başarısız** deneme (`skipSuccessfulRequests`), event ucu 300/dk. `app.set('trust proxy', 1)` olmadan limitleyici tüm ziyaretçileri tek istemci sayıp herkesi kilitlerdi.

### 9.5 `events` öksüz kayıt biriktiriyordu

`business_id` için foreign key yoktu; işletme silindiğinde event kayıtları kalıyordu. Kısıt `ON DELETE CASCADE` ile eklendi. Blok `try/catch` içinde — kısıt eklenemezse bile **sunucu açılmaya devam eder**.

### 9.6 Tıklamalar sessizce kayboluyordu

`profile.html` dört etkileşimde geçersiz tip gönderiyordu; `/api/event/:slug` `400` dönüyor, kullanıcıya hata gösterilmiyor ve tıklama hiç kaydedilmiyordu:

| Gönderilen | Düzeltme |
|---|---|
| `campaign` | → `campaign_click` |
| `featured` | → `featured_click` (yeni tip) |
| `reservation` | → `rezervasyon` (zaten vardı) |
| `order` | → `order` (yeni tip) |

### 9.7 Canlı akıştan düşen tipler

Filtre `phone`, `iban`, `share`, `review_*`, `campaign_*` ve `profile_view` tiplerini dışarıda bırakıyordu; `whatsapp` görünürken `phone` görünmüyordu. `dashboard.html` bu tiplerin hepsi için hazır etiket tuttuğu hâlde sorgu hiç getirmiyordu.

### 9.8 Depo hijyeni

`.gitignore` yoktu (`.env` kazara commit edilebilirdi) — eklendi, `.env.example` ile birlikte. README kodda kullanılmayan `BASE_URL` / `DB_FILE` değişkenlerinden bahsediyor, gerçekten zorunlu olanları anmıyordu — yeniden yazıldı.

---

## 10. Kalan İşler

| # | Konu | Önem |
|---|---|:--:|
| 10.1 | **CORS tamamen açık** — `app.use(cors())`, origin kısıtı yok. Pratikte API'yi sadece kendi frontend'i kullanıyor. | Orta |
| 10.2 | **Admin şifresi düz metin** ortam değişkeninde, karşılaştırma sabit-zamanlı değil (`!==`). Tek hesap olduğu için risk sınırlı. | Orta |
| 10.3 | **`server.js` 4.031 satır** tek dosya — router/servis ayrımı yok | Düşük |
| 10.4 | **`dashboard.html` 202 KB** tek dosya, CSS+JS gömülü | Düşük |
| 10.5 | **Migration aracı yok** — `IF NOT EXISTS` deseniyle idare ediliyor | Düşük |
| 10.6 | **`initDatabase()` her açılışta ~22 DDL** çalıştırıyor, soğuk başlatmayı yavaşlatır | Düşük |
| 10.7 | **Dosya yükleme yok** — görseller URL veya JSONB içinde | Düşük |
| 10.8 | **`main` dalı 210 commit geride** — deploy edilmiyor, kafa karıştırıcı olabilir | Düşük |

---

## 11. Testler

Depoda `test/` altında altı koşum var. Hiçbiri gerçek veritabanı gerektirmez — `pg` modülü sahtelenip `server.js` gerçek Express uygulaması olarak ayağa kaldırılır ve gerçek HTTP istekleri atılır.

```bash
npm test
```

| Koşum | Ne doğrular |
|---|---|
| `smoke` | QR PNG üretimi, sayaç alanları, yetkisiz erişim, sağlık ucu |
| `jwtguard` | `JWT_SECRET` yoksa açılmama, zayıf değerde uyarma |
| `ratelimit` | Limitler, **farklı IP'lerin ayrı kovalara düşmesi**, başarılı girişin sayılmaması |
| `metrics` | Tüm SQL'lerde yorumlanmamış şablon kalmaması, metrik filtrelerinin genişliği |
| `fkguard` | Foreign key akışı ve **hata durumunda sunucunun yine de açılması** |
| `contract` | Frontend↔backend sözleşmesi: eksik route, geçersiz event tipi, eksik etiket |

`contract` koşumu özellikle önemli: [9.1](#91-masanokta-qr-görselleri-bozuktu) ve [9.6](#96-tıklamalar-sessizce-kayboluyordu) hatalarının ikisi de bu sınıftandı. Koşum eski commit üzerinde çalıştırıldığında o beş hatayı yanlış pozitif üretmeden buluyor.

---

## 12. Hedef Ürün ile Fark

### Yapılmış

QR ve NFC üretimi · profil sayfası · logo/isim/tema · Google yorum butonu · 21 platformluk sosyal medya alanı · işletme paneli · raf standı başına ayrı ölçüm.

**Vizyonda yoktu ama var:** akıllı yorum yönlendirme, zamanlı kampanyalar, AI Insights, kişisel dijital kartvizit, canlı aktivite akışı.

### Sipariş Sistemi — Henüz Yok

Sipariş sisteminin hiçbir parçası kodda yok:

| İhtiyaç | Durum |
|---|---|
| Sipariş tablosu | Yok |
| Ürün / menü kataloğu | Yok — `businesses.menu` sadece harici bir **link** |
| Ürün kategorileri | Yok — `businesses.category` işletmenin *kendi* kategorisi ("Restoran") |
| Konum doğrulama | Yok — kodda `geolocation` hiç geçmiyor |
| İşletme paneline bildirim | Yok — gerçek zamanlı altyapı yok |
| Sipariş durumu takibi | Yok |

> `profile.html`'deki mevcut "Sipariş Ver" bağlantısı bir sipariş sistemi değil; işletmenin tanımladığı harici bir linki (Yemeksepeti, Getir vb.) açar. Tıklaması artık `order` tipiyle kaydediliyor.

**Not:** Sipariş modülü tüm işletmelere değil, **isteyen işletmelere** açılacak. Mevcut izin desenine uyarak `businesses` tablosuna `dashboard_orders BOOLEAN DEFAULT FALSE` eklenmesi yeterli olur.

### Gereken İş

**Veritabanı — 4 yeni tablo**

```sql
menu_categories (id, business_id FK, name, sort_order, enabled)

menu_items (id, business_id FK, category_id FK, name, description,
            price NUMERIC, image_url, is_available, sort_order)

orders (id, business_id FK, nfc_tag_id FK, status, table_label,
        customer_note, total NUMERIC, customer_lat, customer_lng,
        created_at, updated_at)

order_items (id, order_id FK, menu_item_id FK, name_snapshot,
             unit_price NUMERIC, quantity, note)
```

`order_items.name_snapshot` ve `unit_price` bilerek kopyalanır — sonradan yapılan zam geçmiş siparişi değiştirmesin.

**Konum doğrulama.** `businesses` tablosuna `lat`, `lng`, `radius_meters`. Müşterinin konumu `navigator.geolocation` ile alınır, mesafe **sunucuda** haversine ile hesaplanır.

> Tarayıcıdan gelen konum kolayca sahtelenebilir; istemci tarafı kontrol tek başına yeterli değildir. `navigator.geolocation` HTTPS zorunludur (Render'da var) ve kullanıcı izni reddedebilir — yedek akış gerekir, örneğin masadaki NFC etiketini okutmuş olmayı yeterli saymak.

**Yeni uçlar**

| Yol | Erişim |
|---|---|
| `GET /api/public-menu/:slug` | 🔓 Kategorili menü |
| `POST /api/orders/:slug` | 🔓 Sipariş oluştur (konum doğrulamalı) |
| `GET /api/orders` · `PUT /api/orders/:id/status` | 🔑 |
| `GET /api/orders/stream` | 🔑 **SSE** — canlı bildirim |
| `/api/menu-categories` · `/api/menu-items` | 🔑 CRUD |

**Bildirim.** En pratik yol **SSE**: tek yönlü, WebSocket'ten basit, Express ile kolay. Sekme kapalıyken de bildirim isteniyorsa Web Push gerekir.

**Event tipleri.** `EVENT_TYPES` listesine `order_start`, `order_submit`, `order_complete` eklenmeli.

---

## 13. React ve shadcn/ui

Proje düz HTML; shadcn/ui React + Tailwind üzerine kurulu. Yani React'e geçmek mevcut frontend'i yeniden yazmak demek.

| Seçenek | Değerlendirme |
|---|---|
| **A — Sadece sipariş ekranlarını React ile yaz** | **Önerilen.** Mevcut sayfalar korunur, sipariş akışı ayrı React uygulaması olarak sunulur. Risk düşük. |
| **B — İşletme panelini taşı** | `dashboard.html` (4.333 satır) ve `admin.html` en çok bakım isteyen kısım; uzun vadede en çok kazandıran ama zaman isteyen seçenek. |
| **C — Her şeyi taşı** | `profile.html` dahil — **önerilmez.** O sayfanın en hızlı açılması gerekir; düz HTML hâli bu iş için ideal. |

---

*Hazırlayan: Claude Opus 5 · `v2-development` · 6 Eylül 2026*
