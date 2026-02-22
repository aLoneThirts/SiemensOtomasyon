// ===================================================
//  KASA TİPLERİ - TAM VERSİYON
// ===================================================

export enum KasaHareketTipi {
  NAKIT_SATIS  = 'NAKİT SATIŞ',
  KART         = 'KART',
  HAVALE       = 'HAVALE',
  GIDER        = 'GİDER',
  CIKIS        = 'ÇIKIŞ',
  ADMIN_ALIM   = 'ADMİN ALIM',
  DIGER        = 'DİĞER',
}

// Kasaya fiziksel olarak yansıyor mu?
export const kasayaYansiyor = (tip: KasaHareketTipi): boolean => {
  return [
    KasaHareketTipi.NAKIT_SATIS,
    KasaHareketTipi.GIDER,
    KasaHareketTipi.CIKIS,
    KasaHareketTipi.ADMIN_ALIM,
    KasaHareketTipi.DIGER,
  ].includes(tip);
};

// Para girişi mi çıkışı mı?
export const kasaYonu = (tip: KasaHareketTipi): 'giris' | 'cikis' | 'yansimaz' => {
  if (tip === KasaHareketTipi.NAKIT_SATIS)  return 'giris';
  if (tip === KasaHareketTipi.KART)         return 'yansimaz';
  if (tip === KasaHareketTipi.HAVALE)       return 'yansimaz';
  if (tip === KasaHareketTipi.GIDER)        return 'cikis';
  if (tip === KasaHareketTipi.CIKIS)        return 'cikis';
  if (tip === KasaHareketTipi.ADMIN_ALIM)   return 'cikis';
  if (tip === KasaHareketTipi.DIGER)        return 'giris';
  return 'yansimaz';
};

// Admin listesi — isimlerini kendi admin isimlerinle değiştir
export const ADMIN_LISTESI = [
  { id: 'berat',  ad: 'Berat Bey'  },
  { id: 'hamza',  ad: 'Hamza Bey'  },
  { id: 'ender',  ad: 'Ender Bey'  },
] as const;

export type AdminId = typeof ADMIN_LISTESI[number]['id'];

export interface KasaHareket {
  id:           string;
  tip:          KasaHareketTipi;
  aciklama:     string;
  tutar:        number;
  tarih:        Date;
  saat:         string;
  kullanici:    string;
  kullaniciId:  string;
  subeKodu:     string;
  belgeNo?:     string;
  not?:         string;
  // Admin alım için ek alanlar
  adminId?:     string;
  adminAd?:     string;
}

export interface KasaGun {
  id:               string;
  gun:              string;       // "YYYY-MM-DD"
  subeKodu:         string;
  durum:            'ACIK' | 'KAPALI';

  acilisBakiyesi:   number;
  gunSonuBakiyesi:  number;

  // Kasaya yansıyanlar
  nakitSatis:       number;       // + giriş
  toplamGider:      number;       // - çıkış
  cikisYapilanPara: number;       // - çıkış
  adminAlimlar:     number;       // - çıkış (admin para aldı)

  // Kasaya yansımayanlar (kayıt amaçlı)
  kartSatis:        number;
  havaleSatis:      number;

  hareketler:       KasaHareket[];

  // Admin bazlı alım özeti { 'Berat Bey': 500, 'Admin 2': 200 }
  adminOzet:        Record<string, number>;

  acilisYapan:      string;
  olusturmaTarihi:  Date;
  guncellemeTarihi: Date;
}