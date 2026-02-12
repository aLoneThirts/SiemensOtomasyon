import { SubeKodu } from './sube';

export interface MusteriBilgileri {
  isim: string;
  adres: string;
  faturaAdresi: string;
  isAdresi: string;
  vergiNumarasi: string;
}

export interface Urun {
  id: string;
  kod: string;
  ad: string;
  adet: number;
  alisFiyati: number;
}

export enum OdemeYontemi {
  PESINAT = 'PESINAT',
  KREDI_KARTI = 'KREDI_KARTI',
  HAVALE = 'HAVALE',
  ACIK_HESAP = 'ACIK_HESAP',
  CEK_SENET = 'CEK_SENET'
}

export interface SatisTeklifFormu {
  id: string;
  satisKodu: string; // Örn: 1010-0001, 2030-0001
  subeKodu: SubeKodu;
  
  // Müşteri Bilgileri
  musteriBilgileri: MusteriBilgileri;
  
  // Ürünler
  urunler: Urun[];
  toplamTutar: number;
  
  // Tarihler
  tarih: Date;
  teslimatTarihi: Date;
  
  // Diğer Bilgiler
  musteriTemsilcisi: string;
  cevap: string;
  magaza: string;
  
  // Seçenekler
  fatura: boolean;
  ileriTeslim: boolean;
  servis: boolean;
  
  // Ödeme Bilgileri
  odemeYontemi: OdemeYontemi;
  hesabaGecen: string;
  
  // Onay
  onayDurumu: boolean;
  
  // Meta
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
  notlar: string;
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
