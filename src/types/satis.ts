import { SubeKodu } from './sube';

export interface MusteriBilgileri {
  isim: string;
  adres: string;
  faturaAdresi?: string;
  isAdresi?: string;
  vergiNumarasi?: string;
  vkNo?: string;
  vd?: string;
  cep?: string;
}

export interface Urun {
  id: string;
  kod: string;
  ad: string;
  adet: number;
  alisFiyati: number;
  bip?: number; // BİP tutarı
}

export interface KartOdeme {
  id: string;
  banka: string;
  taksitSayisi: number; // 1 = Tek, 2-9 = taksit
  tutar: number;
  pesinat?: number;
  kesintiOrani?: number; // % cinsinden kesinti oranı (örn: 1.5 → %1.5)
}

export interface Kampanya {
  id: string;
  ad: string;
  tutar: number;
}

export interface YesilEtiket {
  id: string;
  urunKodu: string;
  ad: string;
  alisFiyati: number;
  tutar: number;
}

export enum OdemeYontemi {
  PESINAT = 'PEŞİNAT',
  KREDI_KARTI = 'KREDİ KARTI',
  HAVALE = 'HAVALE',
  ACIK_HESAP = 'AÇIK HESAP',
  CEK_SENET = 'ÇEK/SENET'
}

export enum OdemeDurumu {
  ODENDI = 'ÖDENDİ',
  ACIK_HESAP = 'AÇIK HESAP'
}

// 📌 Ödeme Sistemi Özeti
// Kasaya Yansır → Sadece Peşin
// Hesaba Geçer → Peşin + Havale + Kart NET (kesinti sonrası)
// Açık Hesap   → Satış Tutarı - Hesaba Geçen
export interface OdemeOzeti {
  kasayaYansiran: number;       // Sadece peşin tutarı
  kartBrutToplam: number;       // Kart ödemelerinin brüt toplamı
  kartKesintiToplam: number;    // Toplam kart kesintisi
  kartNetToplam: number;        // Kart NET toplamı (kesinti sonrası)
  hesabaGecenToplam: number;    // Peşin + Havale + Kart NET
  acikHesap: number;            // Satış Tutarı - Hesaba Geçen
  odemeDurumuDetay: 'AÇIK_HESAP' | 'ÖDENDİ';
}

export interface SatisTeklifFormu {
  id?: string;
  satisKodu: string;
  subeKodu: SubeKodu;
  musteriBilgileri: MusteriBilgileri;
  musteriTemsilcisi: string;
  musteriTemsilcisiTel: string;
  urunler: Urun[];
  toplamTutar: number;
  tarih: Date;
  teslimatTarihi: Date;
  
  // Notlar
  marsNo?: string; // 2026 ile başlayan 10 haneli
  magaza?: string;
  faturaNo: string; // ZORUNLU!
  servisNotu?: string;
  teslimEdildiMi?: boolean;
  cevap?: string;
  
  // Kampanyalar ve İndirimler
  kampanyalar?: Kampanya[];
  yesilEtiketler?: YesilEtiket[];
  
  // Ödeme
  pesinatTutar?: number;
  havaleTutar?: number;
  kartOdemeler?: KartOdeme[];
  hesabaGecen?: string;
  odemeDurumu: OdemeDurumu; // ÖDENDİ veya AÇIK HESAP
  odemeOzeti?: OdemeOzeti;  // 📌 Yeni ödeme sistemi özeti
  
  fatura: boolean;
  ileriTeslim: boolean;
  servis: boolean;
  odemeYontemi: OdemeYontemi;
  onayDurumu: boolean;
  
  zarar?: number;
  
  olusturanKullanici: string;
  olusturmaTarihi: Date;
  guncellemeTarihi: Date;
}

export interface BekleyenUrun {
  id: string;
  satisKodu: string;
  subeKodu: SubeKodu;
  urunKodu: string;
  urunAdi: string;
  adet: number;
  musteriIsmi: string;
  siparisTarihi: Date;
  beklenenTeslimTarihi: Date;
  durum: 'BEKLEMEDE' | 'HAZIR' | 'TESLIM_EDILDI';
  notlar?: string;
  guncellemeTarihi: Date;
}

export interface SatisLog {
  id: string;
  satisKodu: string;
  subeKodu: SubeKodu;
  islem: string;
  kullanici: string;
  tarih: Date;
  detay: string;
}

export const BANKALAR = [
  'Garanti Bankası',
  'İş Bankası',
  'Yapı Kredi',
  'Akbank',
  'Ziraat Bankası',
  'Halkbank',
  'QNB Finansbank',
  'Denizbank',
  'TEB',
  'ING',
  'Vakıfbank',
  'Kuveyt Türk',
  'Türkiye Finans',
  'Albaraka Türk',
  'Şekerbank',
  'HSBC',
  'Citibank'
];

export const TAKSIT_SECENEKLERI = [
  { label: 'Tek', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
  { label: '5', value: 5 },
  { label: '6', value: 6 },
  { label: '7', value: 7 },
  { label: '8', value: 8 },
  { label: '9', value: 9 }
];

export interface SatisCounter {
  id: string;
  currentNumber: number;
  lastUpdated: Date;
}

export enum SatisStatusu {
  BEKLIYOR = 'BEKLIYOR',
  ONAYLANDI = 'ONAYLANDI',
  KILIT = 'KILIT'
}