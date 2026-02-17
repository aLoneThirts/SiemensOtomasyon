export interface KasaHareket {
  id?: string;
  tarih: Date;
  saat: string;
  aciklama: string;
  tutar: number; // Pozitif = gelir, negatif = gider
  tip: KasaHareketTipi;
  kullanici: string;
  kullaniciId: string;
  subeKodu: string;
  belgeNo?: string;
  not?: string;
}

export interface KasaGun {
  id?: string;
  gun: string; // YYYY-MM-DD
  subeKodu: string;
  acilisTarihi: Date;
  kapanisTarihi?: Date;
  acilisBakiyesi: number;
  gunSonuBakiyesi?: number;
  hareketler: KasaHareket[];
  durum: 'ACIK' | 'KAPALI';
  toplamGelir: number;
  toplamGider: number;
  marketHarcamalari: number;
  digerGiderler: number;
}

export enum KasaHareketTipi {
  GELIR = 'GELİR',
  GIDER = 'GİDER',
  MARKET = 'MARKET ALIŞVERİŞİ',
  DIGER = 'DİĞER GİDER'
}

export interface KasaOzet {
  gun: string;
  acilis: number;
  gelir: number;
  gider: number;
  market: number;
  gunSonu: number;
}