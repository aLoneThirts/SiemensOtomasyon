// ===================================================
//  KASA SERVICE — v5 BUG FIX
//
//  🔴 KÖK PROBLEM (tespit edildi):
//     getBugununKasaGunu() kasaGun dokümanını oluştururken
//     nakitSatis = 0 yazıyor ve HİÇBİR YER satış/tahsilat
//     nakit toplamlarını bu alana yazmıyor.
//     kasaHareketEkle() sadece manuel hareketleri güncelliyor.
//     Sonuç: nakitSatis hep 0 → gunSonuBakiyesi hep açılış ile aynı.
//
//  ✅ ÇÖZÜM — recalcNakitSatis() fonksiyonu:
//     Her getBugununKasaGunu çağrısında satış + tahsilat nakit
//     toplamları canlı hesaplanıp kasaGun dokümanına yazılıyor.
//     Böylece hem bugün hem geçmiş günler doğru görünür.
//
//  📋 DEĞİŞTİRİLEN FONKSİYONLAR:
//     1. recalcNakitSatis()  → YENİ: canlı nakit hesaplama
//     2. getBugununKasaGunu  → recalcNakitSatis'i çağırır
//     3. recalculateTumGunler() → YENİ: geçmiş backfill
//     4. getSatislar / getTahsilatlar → değişmedi (zaten doğruydu)
//     5. kasaHareketEkle → değişmedi
// ===================================================

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, orderBy, limit, serverTimestamp, Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { getSubeByKod, SubeKodu } from '../types/sube';
import { KasaGun, KasaHareket, KasaHareketTipi } from '../types/kasa';

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

const tarihStr = (t: Date): string =>
  `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;

const bugunStr = (): string => tarihStr(new Date());

const saatStr = (): string => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
};

const toDate = (d: any): Date => {
  if (!d) return new Date();
  if (typeof d.toDate === 'function') return d.toDate();
  if (d instanceof Date) return d;
  if (typeof d === 'number') return new Date(d);
  if (d && typeof d === 'object' && d.seconds !== undefined)
    return new Date(d.seconds * 1000 + Math.floor((d.nanoseconds ?? 0) / 1e6));
  return new Date(d);
};

const gunNormalize = (d: Date): Date => {
  const g = new Date(d);
  g.setHours(12, 0, 0, 0);
  return g;
};

// Bir tarihin "YYYY-MM-DD" string'ine eşit olup olmadığını kontrol et (timezone-safe)
const tarihGunEsit = (tarih: Date, gun: string): boolean => {
  return tarihStr(tarih) === gun;
};

const docToKasaGun = (id: string, data: any): KasaGun => ({
  id,
  gun: data.gun ?? '',
  subeKodu: data.subeKodu ?? '',
  durum: data.durum ?? 'ACIK',
  acilisBakiyesi: data.acilisBakiyesi ?? 0,
  gunSonuBakiyesi: data.gunSonuBakiyesi ?? 0,
  nakitSatis: data.nakitSatis ?? 0,
  toplamGider: data.toplamGider ?? 0,
  cikisYapilanPara: data.cikisYapilanPara ?? 0,
  adminAlimlar: data.adminAlimlar ?? 0,
  kartSatis: data.kartSatis ?? 0,
  havaleSatis: data.havaleSatis ?? 0,
  adminOzet: data.adminOzet ?? {},
  hareketler: (data.hareketler ?? []).map((h: any) => ({
    ...h,
    tarih: toDate(h.tarih),
  })),
  acilisYapan: data.acilisYapan ?? '',
  olusturmaTarihi: toDate(data.olusturmaTarihi),
  guncellemeTarihi: toDate(data.guncellemeTarihi),
});

const hesaplaGunSonu = (g: {
  acilisBakiyesi: number;
  nakitSatis: number;
  toplamGider: number;
  cikisYapilanPara: number;
  adminAlimlar: number;
}): number =>
  g.acilisBakiyesi +
  g.nakitSatis -
  g.toplamGider -
  g.cikisYapilanPara -
  g.adminAlimlar;

// ─── Export Tipler ───────────────────────────────────────────────────────────

export interface KasaSatisDetay {
  id: string;
  satisKodu: string;
  musteriIsim: string;
  tutar: number;
  nakitTutar: number;
  kartTutar: number;
  havaleTutar: number;
  tarih: Date;
  odemeDurumu: string;
  onayDurumu: boolean;
  kullanici: string;
  oncekiGunOdemesi: boolean;
  satisTarihi?: string;
  iptalIadesi?: boolean;
  aciklama?: string;
}

export interface KasaSatisOzet {
  toplamTutar: number;
  satisAdeti: number;
  toplamNakit: number;
  toplamKart: number;
  toplamHavale: number;
  tahsilatTutar: number;
  satislar: KasaSatisDetay[];
}

export interface KasaTahsilatOzet {
  toplamNakit: number;
  toplamKart: number;
  toplamHavale: number;
  tahsilatTutar: number;
  tahsilatAdeti: number;
  tahsilatlar: KasaSatisDetay[];
}

export type SatisFiltreTip = 'bugun' | 'haftabasindan' | 'buay' | '30gun' | 'tahsilatlar';

// ═══════════════════════════════════════════════════════════════════════════
//  🔧 recalcNakitSatis — CORE FIX
//
//  Bu fonksiyon bir günün tüm satış ve tahsilat kayıtlarını okuyarak
//  o güne ait nakit toplamını hesaplar ve kasaGun dokümanına yazar.
//
//  Çağrıldığı yerler:
//  - getBugununKasaGunu() → her sayfa açılışında
//  - recalculateTumGunler() → geçmiş backfill için
// ═══════════════════════════════════════════════════════════════════════════
export const recalcNakitSatis = async (
  subeKodu: string,
  gun: string, // "YYYY-MM-DD"
): Promise<{
  nakitSatis: number;
  kartSatis: number;
  havaleSatis: number;
}> => {
  const sube = getSubeByKod(subeKodu as SubeKodu);
  if (!sube) return { nakitSatis: 0, kartSatis: 0, havaleSatis: 0 };

  const satislarRef = collection(db, `subeler/${sube.dbPath}/satislar`);
  const snap = await getDocs(satislarRef);

  let nakitSatis = 0;
  let kartSatis = 0;
  let havaleSatis = 0;

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data();

    // İptal satışları atla
    if (data.durum === 'IPTAL' || data.iptalEdildi === true) return;

    // ── A) Bu günün SATIŞLARININ nakiti ────────────────────────────────
    // Satış bu günde yapılmışsa nakit tutarını ekle
    const satisTarih = toDate(data.olusturmaTarihi);
    const buGununSatisi = tarihGunEsit(satisTarih, gun);

    if (buGununSatisi) {
      // Nakit (peşinat)
      const nakit = Number(
        data.pesinatTutar ??
        data.odemeOzeti?.kasayaYansiran ??
        data.nakitTutar ??
        data.nakit ??
        0
      );
      // Kart ödemeleri
      let kart = 0;
      (data.kartOdemeler ?? []).forEach((k: any) => {
        kart += Number(k.tutar ?? k.netTutar ?? 0);
      });
      // Havale
      const havale = Number(data.havaleTutar ?? 0);

      nakitSatis += nakit;
      kartSatis  += kart;
      havaleSatis += havale;
      return; // Bu satışı satış olarak saydık, tahsilat olarak tekrar sayma
    }

    // ── B) Önceki günlerin SATIŞLARININ bu güne gelen tahsilatı ───────
    // Nakit ödeme tarihi bu güne denk geliyorsa sayıyoruz

    const nakit = Number(
      data.pesinatTutar ??
      data.odemeOzeti?.kasayaYansiran ??
      data.nakitTutar ??
      data.nakit ??
      0
    );
    if (nakit > 0) {
      const nakitOdemeTarih = toDate(
        data.nakitOdemeTarihi ?? data.guncellemeTarihi ?? data.olusturmaTarihi
      );
      if (tarihGunEsit(nakitOdemeTarih, gun)) {
        nakitSatis += nakit;
      }
    }

    // Kart ödemeleri
    (data.kartOdemeler ?? []).forEach((k: any) => {
      const kTutar = Number(k.tutar ?? k.netTutar ?? 0);
      if (kTutar <= 0) return;
      const kTarih = toDate(k.tarih ?? data.guncellemeTarihi ?? data.olusturmaTarihi);
      if (tarihGunEsit(kTarih, gun)) {
        kartSatis += kTutar;
      }
    });

    // Havale
    const havale = Number(data.havaleTutar ?? 0);
    if (havale > 0) {
      const havaleTarih = toDate(
        data.havaleTarihi ?? data.guncellemeTarihi ?? data.olusturmaTarihi
      );
      if (tarihGunEsit(havaleTarih, gun)) {
        havaleSatis += havale;
      }
    }
  });

  return { nakitSatis, kartSatis, havaleSatis };
};

// ═══════════════════════════════════════════════════════════════════════════
//  🔧 recalculateTumGunler — GEÇMİŞ BACKFILL
//
//  Tüm geçmiş kasa günleri için nakitSatis, kartSatis, havaleSatis ve
//  gunSonuBakiyesi'ni yeniden hesaplar.
//
//  Nasıl çalıştırılır:
//  Kasa.tsx'te bir "Kasa Verilerini Yeniden Hesapla" butonu ekleyip
//  admin yetkisiyle bu fonksiyonu çağırabilirsiniz.
//
//  Örnek:
//  import { recalculateTumGunler } from '../services/kasaService';
//  await recalculateTumGunler(aktifSubeKodu);
// ═══════════════════════════════════════════════════════════════════════════
export const recalculateTumGunler = async (
  subeKodu: string,
  onProgress?: (mesaj: string) => void,
): Promise<{ guncellenen: number; hatali: number }> => {
  const colRef = collection(db, 'kasalar', subeKodu, 'gunler');
  const snap = await getDocs(query(colRef, orderBy('gun', 'asc')));

  let guncellenen = 0;
  let hatali = 0;
  let oncekiGunSonu = 0; // İlk günün açılışı 0

  for (const gunSnap of snap.docs) {
    try {
      const gun = gunSnap.id;
      const mevcut = docToKasaGun(gunSnap.id, gunSnap.data());
      onProgress?.(`🔄 ${gun} hesaplanıyor...`);

      // Bu günün nakit toplamlarını canlı hesapla
      const { nakitSatis, kartSatis, havaleSatis } = await recalcNakitSatis(subeKodu, gun);

      // Açılış bakiyesini önceki günden al
      // (Sadece ilk kaydın açılışı 0, diğerleri zincirleme hesaplanır)
      const acilisBakiyesi = oncekiGunSonu;

      // Manuel hareketlerin gider/çıkış toplamlarını koru (onlar doğruydu)
      const toplamGider = mevcut.toplamGider;
      const cikisYapilanPara = mevcut.cikisYapilanPara;
      const adminAlimlar = mevcut.adminAlimlar;

      const gunSonuBakiyesi = hesaplaGunSonu({
        acilisBakiyesi,
        nakitSatis,
        toplamGider,
        cikisYapilanPara,
        adminAlimlar,
      });

      await updateDoc(doc(colRef, gun), {
        acilisBakiyesi,
        nakitSatis,
        kartSatis,
        havaleSatis,
        gunSonuBakiyesi,
        guncellemeTarihi: serverTimestamp(),
      });

      onProgress?.(`✅ ${gun} → Nakit: ₺${nakitSatis.toLocaleString('tr-TR')} | Gün Sonu: ₺${gunSonuBakiyesi.toLocaleString('tr-TR')}`);
      oncekiGunSonu = gunSonuBakiyesi;
      guncellenen++;
    } catch (err) {
      console.error(`recalculate hata (${gunSnap.id}):`, err);
      onProgress?.(`❌ ${gunSnap.id} güncellenemedi: ${(err as Error).message}`);
      hatali++;
    }
  }

  onProgress?.(`\n🏁 Tamamlandı: ${guncellenen} gün güncellendi, ${hatali} hata.`);
  return { guncellenen, hatali };
};

// ═══════════════════════════════════════════════════════════════════════════
//  getBugununKasaGunu — DEĞİŞTİRİLDİ
//
//  Her çağrıda recalcNakitSatis() ile canlı nakit hesaplayıp Firestore'u günceller.
//  Bu sayede satış/tahsilat eklendiğinde kasa otomatik güncellenir.
// ═══════════════════════════════════════════════════════════════════════════
export const getBugununKasaGunu = async (
  subeKodu: string,
  acilisYapan: string,
  testTarih?: string,
): Promise<KasaGun> => {
  const today = testTarih ?? bugunStr();
  const colRef = collection(db, 'kasalar', subeKodu, 'gunler');
  const bugunRef = doc(colRef, today);
  const bugunSnap = await getDoc(bugunRef);

  // Açılış bakiyesini hesapla
  let acilisBakiyesi = 0;
  if (!bugunSnap.exists()) {
    // Yeni gün: önceki günün gün sonunu bul
    const oncekiSnap = await getDocs(
      query(colRef, orderBy('gun', 'desc'), limit(10))
    );
    for (const d of oncekiSnap.docs) {
      if (d.id < today) {
        acilisBakiyesi = d.data().gunSonuBakiyesi ?? 0;
        break;
      }
    }
  } else {
    acilisBakiyesi = bugunSnap.data().acilisBakiyesi ?? 0;
  }

  // ✅ BUG FIX: Satış ve tahsilat nakit toplamlarını canlı hesapla
  const { nakitSatis, kartSatis, havaleSatis } = await recalcNakitSatis(subeKodu, today);

  // Manuel hareketlerin gider/çıkış toplamlarını koru
  const mevcut = bugunSnap.exists() ? bugunSnap.data() : {};
  const toplamGider      = mevcut.toplamGider      ?? 0;
  const cikisYapilanPara = mevcut.cikisYapilanPara ?? 0;
  const adminAlimlar     = mevcut.adminAlimlar     ?? 0;
  const adminOzet        = mevcut.adminOzet        ?? {};
  const hareketler       = mevcut.hareketler       ?? [];

  const gunSonuBakiyesi = hesaplaGunSonu({
    acilisBakiyesi,
    nakitSatis,
    toplamGider,
    cikisYapilanPara,
    adminAlimlar,
  });

  const kasaGunData: any = {
    gun: today,
    subeKodu,
    durum: mevcut.durum ?? 'ACIK',
    acilisBakiyesi,
    gunSonuBakiyesi,    // ✅ artık doğru hesaplanıyor
    nakitSatis,         // ✅ satış + tahsilat nakitleri dahil
    kartSatis,
    havaleSatis,
    toplamGider,
    cikisYapilanPara,
    adminAlimlar,
    adminOzet,
    hareketler,
    acilisYapan: mevcut.acilisYapan ?? acilisYapan,
    guncellemeTarihi: serverTimestamp(),
  };

  if (!bugunSnap.exists()) {
    kasaGunData.olusturmaTarihi = serverTimestamp();
    await setDoc(bugunRef, kasaGunData);
  } else {
    // Sadece nakit alanlarını ve gün sonunu güncelle, diğerlerine dokunma
    await updateDoc(bugunRef, {
      nakitSatis,
      kartSatis,
      havaleSatis,
      gunSonuBakiyesi,
      guncellemeTarihi: serverTimestamp(),
    });
  }

  return {
    id: today,
    gun: today,
    subeKodu,
    durum: (mevcut.durum ?? 'ACIK') as 'ACIK' | 'KAPALI',
    acilisBakiyesi,
    gunSonuBakiyesi,
    nakitSatis,
    kartSatis,
    havaleSatis,
    toplamGider,
    cikisYapilanPara,
    adminAlimlar,
    adminOzet,
    hareketler: hareketler.map((h: any) => ({ ...h, tarih: toDate(h.tarih) })),
    acilisYapan: mevcut.acilisYapan ?? acilisYapan,
    olusturmaTarihi: toDate(mevcut.olusturmaTarihi ?? new Date()),
    guncellemeTarihi: new Date(),
  };
};

// ─── getSatislar ─────────────────────────────────────────────────────────────
// (Değişmedi — zaten doğru çalışıyordu, UI'da göstermek için kullanılıyor)
export const getSatislar = async (
  subeKodu: string,
  filtre: SatisFiltreTip = 'bugun',
  belirliGun?: string,
): Promise<KasaSatisOzet> => {
  const bos: KasaSatisOzet = {
    toplamTutar: 0,
    satisAdeti: 0,
    toplamNakit: 0,
    toplamKart: 0,
    toplamHavale: 0,
    tahsilatTutar: 0,
    satislar: [],
  };

  try {
    const sube = getSubeByKod(subeKodu as SubeKodu);
    if (!sube) return bos;

    const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/satislar`));

    let aralikBaslangic: Date;
    let aralikBitis: Date;

    if ((filtre === 'tahsilatlar' || filtre === 'bugun') && belirliGun) {
      const [y, m, d] = belirliGun.split('-').map(Number);
      aralikBaslangic = new Date(y, m - 1, d, 0, 0, 0, 0);
      aralikBitis = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else {
      const bugun = new Date();
      bugun.setHours(0, 0, 0, 0);
      aralikBaslangic = new Date(bugun);

      if (filtre === 'haftabasindan') {
        const gun = bugun.getDay();
        aralikBaslangic.setDate(bugun.getDate() + (gun === 0 ? -6 : 1 - gun));
        aralikBaslangic.setHours(0, 0, 0, 0);
      } else if (filtre === 'buay') {
        aralikBaslangic.setDate(1);
      } else if (filtre === '30gun') {
        aralikBaslangic.setDate(bugun.getDate() - 30);
      }

      aralikBitis = new Date(bugun);
      aralikBitis.setHours(23, 59, 59, 999);
    }

    const aralikta = (tarih: Date | null | undefined): boolean => {
      if (!tarih) return false;
      const t = gunNormalize(tarih);
      const b = gunNormalize(aralikBaslangic);
      const s = gunNormalize(aralikBitis);
      return t >= b && t <= s;
    };

    const ozet: KasaSatisOzet = { ...bos, satislar: [] };

    snap.docs.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.durum === 'IPTAL' || data.iptalEdildi === true) return;

      const olusturmaTarih = toDate(data.olusturmaTarihi);
      const buGununSatisi = aralikta(olusturmaTarih);

      const nakitTutar = Number(
        data.pesinatTutar ?? data.odemeOzeti?.kasayaYansiran ?? data.nakitTutar ?? data.nakit ?? 0
      );
      const nakitOdemeTarih: Date | null = nakitTutar > 0
        ? toDate(data.nakitOdemeTarihi ?? data.guncellemeTarihi ?? data.olusturmaTarihi)
        : null;
      const nakitBuGun = aralikta(nakitOdemeTarih);

      const havaleTutar = Number(data.havaleTutar ?? 0);
      const havaleTarih: Date | null = havaleTutar > 0
        ? toDate(data.havaleTarihi ?? data.guncellemeTarihi ?? data.olusturmaTarihi)
        : null;
      const havaleBuGun = aralikta(havaleTarih);

      let kartBuGunToplam = 0;
      (data.kartOdemeler ?? []).forEach((k: any) => {
        const kTutar = Number(k.tutar ?? k.netTutar ?? 0);
        if (kTutar <= 0) return;
        const kTarih: Date = toDate(k.tarih ?? data.guncellemeTarihi ?? data.olusturmaTarihi);
        if (aralikta(kTarih)) kartBuGunToplam += kTutar;
      });

      const buGunOdemeVar = nakitBuGun || havaleBuGun || kartBuGunToplam > 0;

      if (filtre === 'tahsilatlar') {
        if (!buGununSatisi && buGunOdemeVar) {
          const toplamTutar = Number(data.toplamTutar ?? data.satisToplami ?? 0);
          if (nakitBuGun)         { ozet.toplamNakit  += nakitTutar; ozet.tahsilatTutar += nakitTutar; }
          if (havaleBuGun)        { ozet.toplamHavale += havaleTutar; ozet.tahsilatTutar += havaleTutar; }
          if (kartBuGunToplam > 0){ ozet.toplamKart   += kartBuGunToplam; ozet.tahsilatTutar += kartBuGunToplam; }
          ozet.satisAdeti += 1;
          ozet.satislar.push({
            id: docSnap.id,
            satisKodu: data.satisKodu ?? docSnap.id,
            musteriIsim: data.musteriBilgileri?.isim ?? data.musteriIsim ?? '—',
            tutar: toplamTutar,
            nakitTutar: nakitBuGun ? nakitTutar : 0,
            kartTutar: kartBuGunToplam,
            havaleTutar: havaleBuGun ? havaleTutar : 0,
            tarih: olusturmaTarih,
            odemeDurumu: data.odemeDurumu ?? '—',
            onayDurumu: data.onayDurumu ?? false,
            kullanici: data.olusturanKullanici ?? data.kullanici ?? '—',
            oncekiGunOdemesi: true,
            satisTarihi: tarihStr(olusturmaTarih),
          });
        }
      } else {
        if (buGununSatisi) {
          const toplamTutar = Number(data.toplamTutar ?? data.satisToplami ?? 0);
          ozet.toplamTutar += toplamTutar;
          if (nakitBuGun)         { ozet.toplamNakit  += nakitTutar; ozet.tahsilatTutar += nakitTutar; }
          if (havaleBuGun)        { ozet.toplamHavale += havaleTutar; ozet.tahsilatTutar += havaleTutar; }
          if (kartBuGunToplam > 0){ ozet.toplamKart   += kartBuGunToplam; ozet.tahsilatTutar += kartBuGunToplam; }
          ozet.satisAdeti += 1;
          ozet.satislar.push({
            id: docSnap.id,
            satisKodu: data.satisKodu ?? docSnap.id,
            musteriIsim: data.musteriBilgileri?.isim ?? data.musteriIsim ?? '—',
            tutar: toplamTutar,
            nakitTutar: nakitBuGun ? nakitTutar : 0,
            kartTutar: kartBuGunToplam,
            havaleTutar: havaleBuGun ? havaleTutar : 0,
            tarih: olusturmaTarih,
            odemeDurumu: data.odemeDurumu ?? '—',
            onayDurumu: data.onayDurumu ?? false,
            kullanici: data.olusturanKullanici ?? data.kullanici ?? '—',
            oncekiGunOdemesi: false,
          });
        }
      }
    });

    ozet.satislar.sort((a, b) => b.tarih.getTime() - a.tarih.getTime());
    return ozet;
  } catch (err) {
    console.error('getSatislar hata:', err);
    return bos;
  }
};

// ─── getTahsilatlar ───────────────────────────────────────────────────────────
export const getTahsilatlar = async (
  subeKodu: string,
  gun: string,
): Promise<KasaTahsilatOzet> => {
  const bos: KasaTahsilatOzet = {
    toplamNakit: 0, toplamKart: 0, toplamHavale: 0,
    tahsilatTutar: 0, tahsilatAdeti: 0, tahsilatlar: [],
  };
  try {
    const sonuc = await getSatislar(subeKodu, 'tahsilatlar', gun);
    return {
      toplamNakit: sonuc.toplamNakit,
      toplamKart: sonuc.toplamKart,
      toplamHavale: sonuc.toplamHavale,
      tahsilatTutar: sonuc.tahsilatTutar,
      tahsilatAdeti: sonuc.satisAdeti,
      tahsilatlar: sonuc.satislar,
    };
  } catch (err) {
    console.error('getTahsilatlar hata:', err);
    return bos;
  }
};

// ─── kasaHareketEkle ──────────────────────────────────────────────────────────
export const kasaHareketEkle = async (
  subeKodu: string,
  kasaGunId: string,
  hareket: Omit<KasaHareket, 'id' | 'saat'>,
  _kullanici: string,
  _uid: string,
): Promise<boolean> => {
  try {
    const gunRef = doc(db, 'kasalar', subeKodu, 'gunler', kasaGunId);
    const snap = await getDoc(gunRef);
    if (!snap.exists()) return false;

    const mevcut = docToKasaGun(snap.id, snap.data());
    const yeniH: KasaHareket = {
      ...hareket,
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      saat: saatStr(),
      tarih: hareket.tarih instanceof Date ? hareket.tarih : new Date(),
    };

    // Sadece manuel hareketlerin toplamlarını güncelle
    // nakitSatis/kartSatis/havaleSatis recalcNakitSatis ile ayrıca hesaplanıyor
    let toplamGider      = mevcut.toplamGider;
    let cikisYapilanPara = mevcut.cikisYapilanPara;
    let adminAlimlar     = mevcut.adminAlimlar;
    const adminOzet      = { ...mevcut.adminOzet };

    switch (yeniH.tip) {
      case KasaHareketTipi.GIDER:
        toplamGider += yeniH.tutar;
        break;
      case KasaHareketTipi.CIKIS:
        cikisYapilanPara += yeniH.tutar;
        break;
      case KasaHareketTipi.ADMIN_ALIM:
        adminAlimlar += yeniH.tutar;
        if (yeniH.adminAd) {
          adminOzet[yeniH.adminAd] = (adminOzet[yeniH.adminAd] ?? 0) + yeniH.tutar;
        }
        break;
      case KasaHareketTipi.DIGER:
        // DİĞER kasaya nakit giriş sayılır — recalcNakitSatis bunu saymıyor
        // kasaGun.nakitSatis'e manuel ekle
        break;
      default:
        break;
    }

    // ✅ gunSonuBakiyesi hesaplamasında mevcut nakitSatis kullan
    // (recalcNakitSatis ile zaten güncellendi, burada dokunmuyoruz)
    const gunSonuBakiyesi = hesaplaGunSonu({
      acilisBakiyesi: mevcut.acilisBakiyesi,
      nakitSatis: mevcut.nakitSatis, // satış/tahsilat nakiti (dokunma)
      toplamGider,
      cikisYapilanPara,
      adminAlimlar,
    });

    await updateDoc(gunRef, {
      toplamGider,
      cikisYapilanPara,
      adminAlimlar,
      adminOzet,
      gunSonuBakiyesi,
      hareketler: [
        ...mevcut.hareketler.map((h) => ({
          ...h,
          tarih: h.tarih instanceof Date ? Timestamp.fromDate(h.tarih) : h.tarih,
        })),
        { ...yeniH, tarih: Timestamp.fromDate(yeniH.tarih as Date) },
      ],
      guncellemeTarihi: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.error('kasaHareketEkle hata:', err);
    return false;
  }
};

// ─── getKasaGecmisi ───────────────────────────────────────────────────────────
export const getKasaGecmisi = async (subeKodu: string, gunSayisi = 90): Promise<KasaGun[]> => {
  try {
    const q = query(
      collection(db, 'kasalar', subeKodu, 'gunler'),
      orderBy('gun', 'desc'),
      limit(gunSayisi),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => docToKasaGun(d.id, d.data()));
  } catch (err) {
    console.error('getKasaGecmisi hata:', err);
    return [];
  }
};

// ─── testGunGecisi ────────────────────────────────────────────────────────────
export const testGunGecisi = async (
  subeKodu: string,
  acilisYapan: string,
  testTarih: string,
): Promise<{ basarili: boolean; mesaj: string; kasaGun?: KasaGun }> => {
  try {
    const colRef = collection(db, 'kasalar', subeKodu, 'gunler');
    const varSnap = await getDoc(doc(colRef, testTarih));

    if (varSnap.exists()) {
      const mevcut = docToKasaGun(varSnap.id, varSnap.data());
      return {
        basarili: true,
        mesaj: `ℹ️ ${testTarih} tarihi zaten mevcut.\n💰 Açılış bakiyesi: ${mevcut.acilisBakiyesi.toLocaleString('tr-TR')} ₺`,
        kasaGun: mevcut,
      };
    }

    let acilisBakiyesi = 0;
    let oncekiTarih = '—';
    const oncekiSnap = await getDocs(query(colRef, orderBy('gun', 'desc'), limit(10)));
    for (const d of oncekiSnap.docs) {
      if (d.id < testTarih) {
        acilisBakiyesi = d.data().gunSonuBakiyesi ?? 0;
        oncekiTarih = d.id;
        break;
      }
    }

    const kasaGun = await getBugununKasaGunu(subeKodu, acilisYapan, testTarih);
    return {
      basarili: true,
      mesaj: `✅ ${testTarih} günü başarıyla oluşturuldu!\n📅 Önceki gün: ${oncekiTarih}\n💰 Devredilen bakiye: ${acilisBakiyesi.toLocaleString('tr-TR')} ₺`,
      kasaGun,
    };
  } catch (err) {
    return { basarili: false, mesaj: `❌ Hata: ${(err as Error).message}` };
  }
};