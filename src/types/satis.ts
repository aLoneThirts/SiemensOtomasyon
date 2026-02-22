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
  bip?: number;
}

export interface KartOdeme {
  id: string;
  banka: string;
  taksitSayisi: number;
  tutar: number;
  pesinat?: number;
  kesintiOrani?: number;
  tarih?: Date;
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
  PESINAT     = 'PEŞİNAT',
  KREDI_KARTI = 'KREDİ KARTI',
  HAVALE      = 'HAVALE',
  ACIK_HESAP  = 'AÇIK HESAP',
  CEK_SENET   = 'ÇEK/SENET',
}

export enum OdemeDurumu {
  ODENDI     = 'ÖDENDİ',
  ACIK_HESAP = 'AÇIK HESAP',
}

export interface OdemeOzeti {
  kasayaYansiran:    number;
  kartBrutToplam:    number;
  kartKesintiToplam: number;
  kartNetToplam:     number;
  hesabaGecenToplam: number;
  acikHesap:         number;
  odemeDurumuDetay:  'AÇIK_HESAP' | 'ÖDENDİ';
}

// =============================================
// İLERİ TESLİM STATÜ ENUMu
// =============================================
export enum IleriTeslimStatusu {
  BEKLEMEDE        = 'BEKLEMEDE',
  TESLIM_EDILDI    = 'TESLIM_EDILDI',
  ILERI_TESLIM_IPTAL = 'ILERI_TESLIM_IPTAL',
}

export enum SatisStatusu {
  BEKLIYOR  = 'BEKLIYOR',
  ONAYLANDI = 'ONAYLANDI',
  KILIT     = 'KILIT',
}

export interface SatisTeklifFormu {
  id?: string;
  satisKodu:            string;
  subeKodu:             SubeKodu;
  musteriBilgileri:     MusteriBilgileri;
  musteriTemsilcisi:    string;
  musteriTemsilcisiTel: string;
  urunler:              Urun[];
  toplamTutar:          number;
  tarih:                Date;
  teslimatTarihi:       Date;

  yeniMarsNo?:          string;
  yeniTeslimatTarihi?:  any;
  marsNo?:              string;
  magaza?:              string;
  faturaNo:             string;
  servisNotu?:          string;
  teslimEdildiMi?:      boolean;
  cevap?:               string;

  kampanyalar?:         Kampanya[];
  yesilEtiketler?:      YesilEtiket[];

  // Ödeme tutarları
  pesinatTutar?:        number;
  havaleTutar?:         number;
  kartOdemeler?:        KartOdeme[];
  hesabaGecen?:         string;
  odemeDurumu:          OdemeDurumu;
  odemeOzeti?:          OdemeOzeti;

  // Ödeme tarihleri
  nakitOdemeTarihi?:    Date;
  havaleTarihi?:        Date;

  fatura:               boolean;
  ileriTeslim:          boolean;
  servis:               boolean;
  odemeYontemi:         OdemeYontemi;
  onayDurumu:           boolean;
  zarar?:               number;

  olusturanKullanici:   string;
  olusturmaTarihi:      Date;
  guncellemeTarihi:     Date;

  marsGirisleri?:       MarsGirisi[];     // eski alan (geriye uyumluluk)
  musteriTemsilcisiId?: string;    // yeni - Firestore uid
  musteriTemsilcisiAd?: string;   

  // =============================================
  // İLERİ TESLİM YÖNETİMİ — YENİ ALANLAR
  // =============================================

  // M.A. (Müşteriyle Anlaşılan) teslim tarihi
  // Dolu ise → otomatik olarak ileri teslim kabul edilir
  ileriTeslimTarihi?:   any; // Firestore Timestamp veya Date

  // Hesaplanmış ileri teslim flag'i
  // true: teslimTarihi >= satisTarihi + 1 ay VEYA ileriTeslimTarihi dolu
  isIleriTeslim?:       boolean;

  // İleri teslim statüsü
  // BEKLEMEDE (default), TESLIM_EDILDI, ILERI_TESLIM_IPTAL
  ileriTeslimStatusu?:  IleriTeslimStatusu;

  // İleri teslim iptal/tamamlama notu (opsiyonel)
  ileriTeslimNotu?:     string;

  // Genel satış statüsü (onay yönetimi için)
  satisStatusu?:        'BEKLIYOR' | 'ONAYLANDI' | 'TESLIM_EDILDI' | 'ILERI_TESLIM_IPTAL';
}

export interface BekleyenUrun {
  id:                   string;
  satisKodu:            string;
  subeKodu:             SubeKodu;
  urunKodu:             string;
  urunAdi:              string;
  adet:                 number;
  musteriIsmi:          string;
  siparisTarihi:        Date;
  beklenenTeslimTarihi: Date;
  durum:                'BEKLEMEDE' | 'HAZIR' | 'TESLIM_EDILDI';
  notlar?:              string;
  guncellemeTarihi:     Date;
}

export interface SatisLog {
  id:        string;
  satisKodu: string;
  subeKodu:  SubeKodu;
  islem:     string;
  kullanici: string;
  tarih:     Date;
  detay:     string;
}

export interface MarsGirisi {
  marsNo:         string;
  teslimatTarihi: string;
  etiket:         string;
}

export const BANKALAR = [
  'Garanti Bankası', 'İş Bankası', 'Yapı Kredi', 'Akbank',
  'Ziraat Bankası', 'Halkbank', 'QNB Finansbank', 'Denizbank',
  'TEB', 'ING', 'Vakıfbank', 'Kuveyt Türk', 'Türkiye Finans',
  'Albaraka Türk', 'Şekerbank', 'HSBC', 'Citibank',
];

export const TAKSIT_SECENEKLERI = [
  { label: 'Tek', value: 1 }, { label: '2', value: 2 },
  { label: '3',   value: 3 }, { label: '4', value: 4 },
  { label: '5',   value: 5 }, { label: '6', value: 6 },
  { label: '7',   value: 7 }, { label: '8', value: 8 },
  { label: '9',   value: 9 },
];

export interface SatisCounter {
  id:            string;
  currentNumber: number;
  lastUpdated:   Date;
}