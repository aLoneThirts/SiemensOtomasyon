export enum KasaHareketTipi {
  NAKIT_SATIS = 'NAKİT SATIŞ',       // ✅ Kasaya GİRER (+)
  KART        = 'KART',               // ❌ Kasaya yansımaz
  HAVALE      = 'HAVALE',             // ❌ Kasaya yansımaz
  GIDER       = 'GİDER',             // ✅ Kasadan ÇIKAR (-)
  CIKIS       = 'ÇIKIŞ YAPILAN PARA',// ✅ Kasadan ÇIKAR (-)
  DIGER       = 'DİĞER',             // ✅ Kasadan ÇIKAR (-)
}

export function kasayaYansiyor(tip: KasaHareketTipi): boolean {
  return tip !== KasaHareketTipi.KART && tip !== KasaHareketTipi.HAVALE;
}

export function kasaYonu(tip: KasaHareketTipi): 'giris' | 'cikis' | 'yansimaz' {
  if (tip === KasaHareketTipi.NAKIT_SATIS) return 'giris';
  if (tip === KasaHareketTipi.KART || tip === KasaHareketTipi.HAVALE) return 'yansimaz';
  return 'cikis';
}

export interface KasaHareket {
  id?: string;
  aciklama: string;
  tutar: number;
  tip: KasaHareketTipi;
  belgeNo?: string;
  not?: string;
  tarih: Date;
  saat?: string;
  kullanici: string;
  kullaniciId: string;
  subeKodu: string;
}

export interface KasaGun {
  id?: string;
  gun: string;
  subeKodu: string;
  acilisTarihi?: Date;
  acilisBakiyesi: number;
  hareketler?: KasaHareket[];
  durum: 'ACIK' | 'KAPALI';
  kapanisTarihi?: Date;

  // Orijinal alanlar (korundu)
  toplamGelir: number;
  toplamGider: number;
  marketHarcamalari: number;
  digerGiderler: number;

  // Yeni alanlar
  nakitSatis: number;         // NAKİT SATIŞ toplamı → kasaya girer
  kartSatis: number;          // KART toplamı → kasaya yansımaz
  havaleSatis: number;        // HAVALE toplamı → kasaya yansımaz
  cikisYapilanPara: number;   // ÇIKIŞ YAPILAN PARA → kasadan çıkar

  // Gün sonu = Açılış + NakitSatış - Gider - Çıkış - Diğer
  gunSonuBakiyesi: number;
}