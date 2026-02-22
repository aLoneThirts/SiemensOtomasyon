// ===================================================
//  KASA SERVICE - DÜZELTİLMİŞ VERSİYON
//  Satışlar ve Tahsilatlar AYRI tablolar
// ===================================================

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, orderBy, limit, serverTimestamp, Timestamp,
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

// Her türlü tarih formatını Date'e çevirir
const toDate = (d: any): Date => {
  if (!d) return new Date();
  if (typeof d.toDate === 'function') return d.toDate();
  if (d instanceof Date) return d;
  if (typeof d === 'number') return new Date(d);
  if (d && typeof d === 'object' && d.seconds !== undefined)
    return new Date(d.seconds * 1000 + Math.floor((d.nanoseconds ?? 0) / 1e6));
  return new Date(d);
};

// Bir tarihin sadece gün kısmını normalize eder (saat=12 → DST sorununu önler)
const gunNormalize = (d: Date): Date => {
  const g = new Date(d);
  g.setHours(12, 0, 0, 0);
  return g;
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
  hareketler: (data.hareketler ?? []).map((h: any) => ({ ...h, tarih: toDate(h.tarih) })),
  acilisYapan: data.acilisYapan ?? '',
  olusturmaTarihi: toDate(data.olusturmaTarihi),
  guncellemeTarihi: toDate(data.guncellemeTarihi),
});

const hesaplaGunSonu = (g: Partial<KasaGun>): number =>
  (g.acilisBakiyesi ?? 0) +
  (g.nakitSatis ?? 0) -
  (g.toplamGider ?? 0) -
  (g.cikisYapilanPara ?? 0) -
  (g.adminAlimlar ?? 0);

// ─── Export Tipler ───────────────────────────────────────────────────────────

export interface KasaSatisDetay {
  id: string;
  satisKodu: string;
  musteriIsim: string;

  // Satışın toplam fatura tutarı
  tutar: number;

  // Bu filtre gününe ait tahsilat kırılımı
  nakitTutar: number;
  kartTutar: number;
  havaleTutar: number;

  // Satışın yapıldığı tarih (olusturmaTarihi)
  tarih: Date;

  odemeDurumu: string;
  onayDurumu: boolean;
  kullanici: string;

  // true → satış başka gün yapılmış, ödeme bu güne ait
  oncekiGunOdemesi: boolean;
  // oncekiGunOdemesi=true ise satışın orijinal tarihi "YYYY-MM-DD"
  satisTarihi?: string;
}

export interface KasaSatisOzet {
  // Ciro: sadece bu günün satışları (satış tarihi = filtre günü)
  toplamTutar: number;
  satisAdeti: number;

  // Kasa girişi: bu güne ait tüm tahsilatlar (hem o günün satışları hem önceki günden gelenler)
  toplamNakit: number;
  toplamKart: number;
  toplamHavale: number;
  tahsilatTutar: number; // toplamNakit + toplamKart + toplamHavale

  satislar: KasaSatisDetay[];
}

export interface KasaTahsilatOzet {
  // Sadece önceki günlerden gelen tahsilatlar
  toplamNakit: number;
  toplamKart: number;
  toplamHavale: number;
  tahsilatTutar: number;
  tahsilatAdeti: number;
  tahsilatlar: KasaSatisDetay[];
}

export type SatisFiltreTip = 'bugun' | 'haftabasindan' | 'buay' | '30gun' | 'tahsilatlar';

// ─── getSatislar ─────────────────────────────────────────────────────────────
//
//  YENİ MANTIK:
//  - filtre = 'bugun' | 'haftabasindan' | 'buay' | '30gun' → SADECE o günlerin SATIŞLARI
//  - filtre = 'tahsilatlar' → SADECE önceki günlerden gelen TAHSİLATLAR (belirliGün parametresi ile)
//
//  TOPLAM KUTULARI:
//  - Satışlar sekmesinde: toplamTutar = sadece bu günün satışlarının toplamı
//  - Tahsilatlar sekmesinde: tahsilatTutar = sadece bugün yapılan tahsilatlar
//
// ─────────────────────────────────────────────────────────────────────────────
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

    // ── Filtre aralığı ──────────────────────────────────────────────────────
    let aralikBaslangic: Date;
    let aralikBitis: Date;

    // Eğer 'tahsilatlar' filtresiyse, belirliGun zorunlu
    if (filtre === 'tahsilatlar' && belirliGun) {
      const [y, m, d] = belirliGun.split('-').map(Number);
      aralikBaslangic = new Date(y, m - 1, d, 0, 0, 0, 0);
      aralikBitis = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else if (belirliGun) {
      // Belirli bir gün için satışlar
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
        aralikBaslangic.setHours(0, 0, 0, 0);
      } else if (filtre === '30gun') {
        aralikBaslangic.setDate(bugun.getDate() - 30);
        aralikBaslangic.setHours(0, 0, 0, 0);
      }
      // 'bugun' filtresi: aralikBaslangic zaten bugünün 00:00'ı

      aralikBitis = new Date(bugun);
      aralikBitis.setHours(23, 59, 59, 999);
    }

    // ── Yardımcı: tarih filtre aralığında mı? ──────────────────────────────
    const aralikta = (tarih: Date | null | undefined): boolean => {
      if (!tarih) return false;
      const t = gunNormalize(tarih);
      const b = gunNormalize(aralikBaslangic);
      const s = gunNormalize(aralikBitis);
      return t >= b && t <= s;
    };

    const ozet: KasaSatisOzet = {
      toplamTutar: 0,
      satisAdeti: 0,
      toplamNakit: 0,
      toplamKart: 0,
      toplamHavale: 0,
      tahsilatTutar: 0,
      satislar: [],
    };

    snap.docs.forEach((docSnap) => {
      const data = docSnap.data();

      // Satışın yapıldığı tarih
      const olusturmaTarih = toDate(data.olusturmaTarihi);
      const buGununSatisi = aralikta(olusturmaTarih);

      // ── A) Nakit (pesinat) ─────────────────────────────────────────────
      const nakitTutar = Number(data.pesinatTutar ?? data.odemeOzeti?.kasayaYansiran ?? 0);
      const nakitOdemeTarih: Date | null = nakitTutar > 0
        ? toDate(data.nakitOdemeTarihi ?? data.guncellemeTarihi ?? data.olusturmaTarihi)
        : null;
      const nakitBuGun = aralikta(nakitOdemeTarih);

      // ── B) Havale ──────────────────────────────────────────────────────
      const havaleTutar = Number(data.havaleTutar ?? 0);
      const havaleTarih: Date | null = havaleTutar > 0
        ? toDate(data.havaleTarihi ?? data.guncellemeTarihi ?? data.olusturmaTarihi)
        : null;
      const havaleBuGun = aralikta(havaleTarih);

      // ── C) Kart — her satır ayrı değerlendirilir ───────────────────────
      let kartBuGunToplam = 0;
      (data.kartOdemeler ?? []).forEach((k: any) => {
        const kTutar = Number(k.tutar ?? k.netTutar ?? 0);
        if (kTutar <= 0) return;
        const kTarih: Date = toDate(k.tarih ?? data.guncellemeTarihi ?? data.olusturmaTarihi);
        if (aralikta(kTarih)) kartBuGunToplam += kTutar;
      });

      const buGunOdemeVar = nakitBuGun || havaleBuGun || kartBuGunToplam > 0;

      // Filtreye göre işlem yap
      if (filtre === 'tahsilatlar') {
        // SADECE önceki günlerden gelen tahsilatlar
        if (!buGununSatisi && buGunOdemeVar) {
          const toplamTutar = Number(data.toplamTutar ?? data.satisToplami ?? 0);

          // Kasa girişleri: bugün kasaya giren tutarlar
          if (nakitBuGun) {
            ozet.toplamNakit += nakitTutar;
            ozet.tahsilatTutar += nakitTutar;
          }
          if (havaleBuGun) {
            ozet.toplamHavale += havaleTutar;
            ozet.tahsilatTutar += havaleTutar;
          }
          if (kartBuGunToplam > 0) {
            ozet.toplamKart += kartBuGunToplam;
            ozet.tahsilatTutar += kartBuGunToplam;
          }

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
            odemeDurumu: data.odemeDurumu ?? data.odemeOzeti?.odemeDurumuDetay ?? '—',
            onayDurumu: data.onayDurumu ?? false,
            kullanici: data.olusturanKullanici ?? data.kullanici ?? '—',
            oncekiGunOdemesi: true,
            satisTarihi: tarihStr(olusturmaTarih),
          });
        }
      } else {
        // Normal satışlar: bu günün satışları (ödeme olsun olmasın)
        if (buGununSatisi) {
          const toplamTutar = Number(data.toplamTutar ?? data.satisToplami ?? 0);

          // Ciro: sadece bu günün satışları
          ozet.toplamTutar += toplamTutar;

          // Kasa girişleri: bugün kasaya giren tutarlar
          if (nakitBuGun) {
            ozet.toplamNakit += nakitTutar;
            ozet.tahsilatTutar += nakitTutar;
          }
          if (havaleBuGun) {
            ozet.toplamHavale += havaleTutar;
            ozet.tahsilatTutar += havaleTutar;
          }
          if (kartBuGunToplam > 0) {
            ozet.toplamKart += kartBuGunToplam;
            ozet.tahsilatTutar += kartBuGunToplam;
          }

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
            odemeDurumu: data.odemeDurumu ?? data.odemeOzeti?.odemeDurumuDetay ?? '—',
            onayDurumu: data.onayDurumu ?? false,
            kullanici: data.olusturanKullanici ?? data.kullanici ?? '—',
            oncekiGunOdemesi: false,
          });
        }
      }
    });

    // Satış tarihine göre sırala (en yeni önce)
    ozet.satislar.sort((a, b) => b.tarih.getTime() - a.tarih.getTime());
    return ozet;
  } catch (err) {
    console.error('getSatislar hata:', err);
    return bos;
  }
};

// ─── getTahsilatlar ───────────────────────────────────────────────────────────
// SADECE önceki günlerden gelen tahsilatları getir
export const getTahsilatlar = async (
  subeKodu: string,
  gun: string, // "YYYY-MM-DD"
): Promise<KasaTahsilatOzet> => {
  const bos: KasaTahsilatOzet = {
    toplamNakit: 0,
    toplamKart: 0,
    toplamHavale: 0,
    tahsilatTutar: 0,
    tahsilatAdeti: 0,
    tahsilatlar: [],
  };

  try {
    // getSatislar'ı 'tahsilatlar' filtresiyle çağır
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

// ─── getBugununKasaGunu ───────────────────────────────────────────────────────
export const getBugununKasaGunu = async (
  subeKodu: string,
  acilisYapan: string,
  testTarih?: string,
): Promise<KasaGun> => {
  const today = testTarih ?? bugunStr();
  const colRef = collection(db, 'kasalar', subeKodu, 'gunler');
  const bugunRef = doc(colRef, today);
  const bugunSnap = await getDoc(bugunRef);

  if (bugunSnap.exists()) return docToKasaGun(bugunSnap.id, bugunSnap.data());

  let acilisBakiyesi = 0;
  const q = query(colRef, orderBy('gun', 'desc'), limit(10));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    if (d.id < today) {
      acilisBakiyesi = d.data().gunSonuBakiyesi ?? 0;
      break;
    }
  }

  const yeniGun: any = {
    gun: today,
    subeKodu,
    durum: 'ACIK',
    acilisBakiyesi,
    gunSonuBakiyesi: acilisBakiyesi,
    nakitSatis: 0,
    toplamGider: 0,
    cikisYapilanPara: 0,
    adminAlimlar: 0,
    kartSatis: 0,
    havaleSatis: 0,
    adminOzet: {},
    hareketler: [],
    acilisYapan,
    olusturmaTarihi: serverTimestamp(),
    guncellemeTarihi: serverTimestamp(),
  };

  await setDoc(bugunRef, yeniGun);
  return { ...yeniGun, id: today, olusturmaTarihi: new Date(), guncellemeTarihi: new Date() };
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

    let nakitSatis = mevcut.nakitSatis;
    let toplamGider = mevcut.toplamGider;
    let cikisYapilanPara = mevcut.cikisYapilanPara;
    let adminAlimlar = mevcut.adminAlimlar;
    let kartSatis = mevcut.kartSatis;
    let havaleSatis = mevcut.havaleSatis;
    const adminOzet = { ...mevcut.adminOzet };

    switch (yeniH.tip) {
      case KasaHareketTipi.NAKIT_SATIS:
        nakitSatis += yeniH.tutar;
        break;
      case KasaHareketTipi.KART:
        kartSatis += yeniH.tutar;
        break;
      case KasaHareketTipi.HAVALE:
        havaleSatis += yeniH.tutar;
        break;
      case KasaHareketTipi.GIDER:
        toplamGider += yeniH.tutar;
        break;
      case KasaHareketTipi.CIKIS:
        cikisYapilanPara += yeniH.tutar;
        break;
      case KasaHareketTipi.DIGER:
        nakitSatis += yeniH.tutar;
        break;
      case KasaHareketTipi.ADMIN_ALIM:
        adminAlimlar += yeniH.tutar;
        if (yeniH.adminAd) adminOzet[yeniH.adminAd] = (adminOzet[yeniH.adminAd] ?? 0) + yeniH.tutar;
        break;
    }

    await updateDoc(gunRef, {
      nakitSatis,
      toplamGider,
      cikisYapilanPara,
      adminAlimlar,
      kartSatis,
      havaleSatis,
      adminOzet,
      gunSonuBakiyesi: hesaplaGunSonu({
        acilisBakiyesi: mevcut.acilisBakiyesi,
        nakitSatis,
        toplamGider,
        cikisYapilanPara,
        adminAlimlar,
      }),
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