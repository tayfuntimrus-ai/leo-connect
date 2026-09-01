LEO CONNECT — FULL MVP / V4

Bu paket; pazarlanabilir bir MVP'nin yerel çalışan temelini içerir:
- işletme kayıt/giriş
- SQLite kalıcı veritabanı
- işletme profili ve slug URL
- bağlantı yönetimi için API
- otomatik QR üretimi
- profil görüntüleme ve etkileşim eventleri
- temel istatistik API
- NFC için kullanılabilecek kalıcı profil URL'si
- responsive tanıtım, kayıt ve dashboard ekranları

KURULUM
1) Node.js 20+ kur.
2) Bu klasörde: npm install
3) .env.example dosyasını .env olarak kopyala ve JWT_SECRET'i değiştir.
4) npm start
5) http://localhost:3000/register.html

NFC
Bir NFC etiketini işletmenin /p/slug adresine yönlendirebilirsin. Fiziksel NFC yazma işlemi ayrıca NFC Writer uygulaması/cihazı ile yapılır.

QR
Dashboard QR üretir. Gerçek sunucuda BASE_URL alanını https://leoconnect.com.tr yap.

ÖDEME / ABONELİK
Bu pakette gerçek kart çekimi yapılmaz. subscriptions tablosu ve plan alanı hazırdır. Canlı ödeme için seçilecek sağlayıcının sunucu tarafı checkout/webhook entegrasyonu ve şirket hesabı anahtarları gerekir.

CANLIYA ALMADAN ÖNCE
HTTPS, güçlü JWT_SECRET, rate limiting, CSRF/authorization kontrolleri, e-posta doğrulama, şifre sıfırlama, yedekleme, KVKK/Gizlilik metni, açık rıza/çerez yönetimi, ödeme sağlayıcısı webhook doğrulaması ve PostgreSQL/Supabase gibi üretim veritabanı eklenmelidir.
