# İş Takip Uygulaması

Modern bir iş takip ve satış teklif yönetim sistemi. React + TypeScript + Firebase ile geliştirilmiştir.

## 🚀 Özellikler

### Kullanıcı Yönetimi
- ✅ Login / Register sistemi
- ✅ Şube bazlı kullanıcı yetkilendirmesi
- ✅ Admin ve Çalışan rolleri
- ✅ Her çalışan sadece kendi şubesinin verilerine erişebilir
- ✅ Admin tüm şubelere erişebilir

### Şube Yönetimi
5 farklı şube:
1. Kartal Şubesi (Kod: 1010)
2. Pendik Şubesi (Kod: 2030)
3. Sancaktepe Şubesi (Kod: 3040)
4. Büyaka AVM Şubesi (Kod: 4050)
5. Maltepe Şubesi (Kod: 5060)

### Satış Teklif Formu
- ✅ Müşteri Bilgileri (İsim, Adres, Fatura Bilgileri, İş Adresi, Vergi No)
- ✅ Ürün Ekleme/Çıkarma
- ✅ Otomatik toplam hesaplama
- ✅ Tarih seçimi (Sipariş ve Teslimat)
- ✅ Müşteri Temsilcisi, Cevap, Mağaza bilgileri
- ✅ Fatura, İleri Teslim, Servis seçenekleri
- ✅ Ödeme Yöntemleri (Peşinat, Kredi Kartı, Havale, Açık Hesap, Çek/Senet)
- ✅ Onay sistemi

### Bekleyen Ürünler Takip
- ✅ Bekleyen ürünleri görüntüleme
- ✅ Durum takibi (Beklemede, Hazır, Teslim Edildi)
- ✅ Filtreleme özellikleri

### Admin Panel
- ✅ Tüm şubelerin genel istatistikleri
- ✅ Şube bazlı detaylı raporlar
- ✅ Sistem logları

## 📦 Kurulum

```bash
cd siemensotomasyon
npm install
npm start
```

## ⚙️ Firebase Konfigürasyonu

`src/firebase/config.ts` dosyasını düzenleyin ve Firebase bilgilerinizi girin.

## 🚀 Çalıştırma

```bash
npm start
```

## 🔧 Teknolojiler

- React 18 + TypeScript
- Firebase (Firestore + Authentication)
- React Router v6
- Custom CSS (Responsive)

---

**Geliştirici:** Göktuğ Fuat
