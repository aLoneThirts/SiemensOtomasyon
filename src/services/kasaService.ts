// ===================================================
//  KASA SERVICE — v8
//
//  v7'den v8'e değişiklikler:
//  🔴 v7'deki PROBLEM:
//     kasaIadeEkle → created_at her zaman "şu an" yazıyordu
//     → Eski bir peşinat düzenlendiğinde ters kayıt bugünün
//       kasasına düşüyordu, oysa eski günün kasasına düşmeli
//
//  ✅ v8 ÇÖZÜM:
//     kasaIadeEkle → artık "gun" parametresine göre created_at yazar
//     → Eski peşinat 09.03'te girilmişse, ters kayıt da 09.03'e düşer
//     → Geçmiş kasalar asla yanlış etkilenmez
// ===================================================

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc,
  query, orderBy, limit, serverTimestamp, Timestamp,
  where, runTransaction, increment,
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
//  🔧 recalcNakitSatis — v7: kasaTahsilatHareketleri'nden okur
// ═══════════════════════════════════════════════════════════════════════════
export const recalcNakitSatis = async (
  subeKodu: string,
  gun: string,
): Promise<{
  nakitSatis: number;
  kartSatis: number;
  havaleSatis: number;
}> => {
  const sube = getSubeByKod(subeKodu as SubeKodu);
  if (!sube) return { nakitSatis: 0, kartSatis: 0, havaleSatis: 0 };

  const [y, m, d] = gun.split('-').map(Number);
  const gunBaslangic = new Date(y, m - 1, d, 0, 0, 0, 0);
  const gunBitis     = new Date(y, m - 1, d, 23, 59, 59, 999);

  let nakitSatis  = 0;
  let kartSatis   = 0;
  let havaleSatis = 0;

  // ── 1. Bugünkü satışlar (olusturmaTarihi = bugün) ────────────────────────
  try {
    const satisSnap = await getDocs(
      query(
        collection(db, `subeler/${sube.dbPath}/satislar`),
        where('olusturmaTarihi', '>=', Timestamp.fromDate(gunBaslangic)),
        where('olusturmaTarihi', '<=', Timestamp.fromDate(gunBitis)),
      )
    );

    satisSnap.docs.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.durum === 'IPTAL' || data.iptalEdildi === true) return;

      const nakit = Number(
        data.pesinatTutar ??
        data.odemeOzeti?.kasayaYansiran ??
        data.nakitTutar ??
        0
      );
      let kart = 0;
      (data.kartOdemeler ?? []).forEach((k: any) => { kart += Number(k.tutar ?? 0); });
      const havale = Number(data.havaleTutar ?? 0);

      nakitSatis  += nakit;
      kartSatis   += kart;
      havaleSatis += havale;
    });
  } catch (err) {
    console.error('recalcNakitSatis satislar hatası:', err);
  }

  // ── 2. kasaTahsilatHareketleri — created_at bu güne ait olanlar ──────────
  // ✅ v8: kasaIadeEkle artık gun'e göre created_at yazdığından,
  // eski peşinat ters kayıtları doğru güne düşer.
  try {
    const tahsilatSnap = await getDocs(
      query(
        collection(db, `subeler/${sube.dbPath}/kasaTahsilatHareketleri`),
        where('created_at', '>=', Timestamp.fromDate(gunBaslangic)),
        where('created_at', '<=', Timestamp.fromDate(gunBitis)),
        where('tip', '==', 'TAHSILAT'),
      )
    );

    tahsilatSnap.docs.forEach((tahDoc) => {
      const data = tahDoc.data();
      if (data.satisTarihi && data.satisTarihi === gun) return;
      nakitSatis  += Number(data.nakitTutar  ?? 0);
      kartSatis   += Number(data.kartTutar   ?? 0);
      havaleSatis += Number(data.havaleTutar ?? 0);
    });
  } catch (err) {
    console.error('recalcNakitSatis tahsilatlar hatası:', err);
  }

  // ── 3. İptal iadeleri — negatif ─────────────────────────────────────────
  try {
    const iptalSnap = await getDocs(
      query(
        collection(db, `subeler/${sube.dbPath}/kasaIptalKayitlari`),
        where('created_at', '>=', Timestamp.fromDate(gunBaslangic)),
        where('created_at', '<=', Timestamp.fromDate(gunBitis)),
      )
    );

    iptalSnap.docs.forEach((iptalDoc) => {
      const data = iptalDoc.data();
      if (data.iptalGeriAlindi === true) return;
      nakitSatis  += Number(data.nakitTutar  ?? 0);
      kartSatis   += Number(data.kartTutar   ?? 0);
      havaleSatis += Number(data.havaleTutar ?? 0);
    });
  } catch (err) {
    console.error('recalcNakitSatis iptal kayıtları hatası:', err);
  }

  // ── 4. kasaTahsilatHareketleri — IADE tipindekiler (peşinat ters kayıtları)
  // ✅ v8: kasaIadeEkle artık gun'e göre created_at yazdığından
  // bu sorguda doğru günün ters kayıtları gelir.
  try {
    const iadeSnap = await getDocs(
      query(
        collection(db, `subeler/${sube.dbPath}/kasaTahsilatHareketleri`),
        where('created_at', '>=', Timestamp.fromDate(gunBaslangic)),
        where('created_at', '<=', Timestamp.fromDate(gunBitis)),
        where('tip', '==', 'IADE'),
      )
    );

    iadeSnap.docs.forEach((iadeDoc) => {
      const data = iadeDoc.data();
      // Tutarlar zaten negatif
      nakitSatis  += Number(data.nakitTutar  ?? 0);
      kartSatis   += Number(data.kartTutar   ?? 0);
      havaleSatis += Number(data.havaleTutar ?? 0);
    });
  } catch (err) {
    console.error('recalcNakitSatis iade hareketleri hatası:', err);
  }

  return { nakitSatis, kartSatis, havaleSatis };
};

// ═══════════════════════════════════════════════════════════════════════════
//  recalculateTumGunler — Geçmiş backfill (değişmedi)
// ═══════════════════════════════════════════════════════════════════════════
export const recalculateTumGunler = async (
  subeKodu: string,
  onProgress?: (mesaj: string) => void,
): Promise<{ guncellenen: number; hatali: number }> => {
  const colRef = collection(db, 'kasalar', subeKodu, 'gunler');
  const snap = await getDocs(query(colRef, orderBy('gun', 'asc')));

  let guncellenen = 0;
  let hatali = 0;
  let oncekiGunSonu = 0;

  for (const gunSnap of snap.docs) {
    try {
      const gun = gunSnap.id;
      const mevcut = docToKasaGun(gunSnap.id, gunSnap.data());
      onProgress?.(`🔄 ${gun} hesaplanıyor...`);

      const { nakitSatis, kartSatis, havaleSatis } = await recalcNakitSatis(subeKodu, gun);

      const acilisBakiyesi = oncekiGunSonu;
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
//  getBugununKasaGunu (değişmedi)
// ═══════════════════════════════════════════════════════════════════════════
export const getBugununKasaGunu = async (
  subeKodu: string,
  acilisYapan: string,
  testTarih?: string,
): Promise<KasaGun> => {
  const today = testTarih ?? bugunStr();
  const colRef = collection(db, 'kasalar', subeKodu, 'gunler');
  const bugunRef = doc(colRef, today);

  let oncekiGunSonuBakiyesi = 0;
  const oncekiSnap = await getDocs(
    query(colRef, orderBy('gun', 'desc'), limit(10))
  );
  for (const d of oncekiSnap.docs) {
    if (d.id < today) {
      oncekiGunSonuBakiyesi = d.data().gunSonuBakiyesi ?? 0;
      break;
    }
  }

  const result = await runTransaction(db, async (tx) => {
    const bugunSnap = await tx.get(bugunRef);

    if (!bugunSnap.exists()) {
      const acilisBakiyesi = oncekiGunSonuBakiyesi;

      tx.set(bugunRef, {
        gun: today,
        subeKodu,
        durum: 'ACIK',
        acilisBakiyesi,
        gunSonuBakiyesi: acilisBakiyesi,
        nakitSatis: 0,
        kartSatis: 0,
        havaleSatis: 0,
        toplamGider: 0,
        cikisYapilanPara: 0,
        adminAlimlar: 0,
        adminOzet: {},
        hareketler: [],
        acilisYapan: acilisYapan,
        olusturmaTarihi: serverTimestamp(),
        guncellemeTarihi: serverTimestamp(),
      });

      return {
        acilisBakiyesi,
        nakitSatis: 0, kartSatis: 0, havaleSatis: 0,
        toplamGider: 0, cikisYapilanPara: 0, adminAlimlar: 0,
        adminOzet: {}, hareketler: [] as any[],
        durum: 'ACIK' as const,
        acilisYapan,
        olusturmaTarihi: new Date(),
      };
    } else {
      const data = bugunSnap.data();
      return {
        acilisBakiyesi:   data.acilisBakiyesi   ?? 0,
        nakitSatis:       data.nakitSatis       ?? 0,
        kartSatis:        data.kartSatis        ?? 0,
        havaleSatis:      data.havaleSatis       ?? 0,
        toplamGider:      data.toplamGider      ?? 0,
        cikisYapilanPara: data.cikisYapilanPara ?? 0,
        adminAlimlar:     data.adminAlimlar     ?? 0,
        adminOzet:        data.adminOzet        ?? {},
        hareketler:       data.hareketler       ?? [],
        durum:            (data.durum ?? 'ACIK') as 'ACIK' | 'KAPALI',
        acilisYapan:      data.acilisYapan      ?? acilisYapan,
        olusturmaTarihi:  data.olusturmaTarihi  ?? new Date(),
      };
    }
  });

  const { nakitSatis, kartSatis, havaleSatis } = await recalcNakitSatis(subeKodu, today);

  const gunSonuBakiyesi = hesaplaGunSonu({
    acilisBakiyesi: result.acilisBakiyesi,
    nakitSatis,
    toplamGider: result.toplamGider,
    cikisYapilanPara: result.cikisYapilanPara,
    adminAlimlar: result.adminAlimlar,
  });

  await updateDoc(bugunRef, {
    nakitSatis,
    kartSatis,
    havaleSatis,
    gunSonuBakiyesi,
    guncellemeTarihi: serverTimestamp(),
  });

  return {
    id: today,
    gun: today,
    subeKodu,
    durum: result.durum as 'ACIK' | 'KAPALI',
    acilisBakiyesi: result.acilisBakiyesi,
    gunSonuBakiyesi,
    nakitSatis,
    kartSatis,
    havaleSatis,
    toplamGider: result.toplamGider,
    cikisYapilanPara: result.cikisYapilanPara,
    adminAlimlar: result.adminAlimlar,
    adminOzet: result.adminOzet,
    hareketler: (result.hareketler as any[]).map((h: any) => ({ ...h, tarih: toDate(h.tarih) })),
    acilisYapan: result.acilisYapan,
    olusturmaTarihi: toDate(result.olusturmaTarihi),
    guncellemeTarihi: new Date(),
  };
};

// ─── getSatislar (değişmedi) ──────────────────────────────────────────────
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

    const ikiAyOnce = new Date();
    ikiAyOnce.setMonth(ikiAyOnce.getMonth() - 2);
    ikiAyOnce.setDate(1);
    ikiAyOnce.setHours(0, 0, 0, 0);
    const satisQuery = query(
      collection(db, `subeler/${sube.dbPath}/satislar`),
      where('olusturmaTarihi', '>=', Timestamp.fromDate(ikiAyOnce)),
      orderBy('olusturmaTarihi', 'desc')
    );
    const snap = await getDocs(satisQuery);

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

// ═══════════════════════════════════════════════════════════════════════════
//  getTahsilatlar — v7: kasaTahsilatHareketleri'nden okur (değişmedi)
// ═══════════════════════════════════════════════════════════════════════════
export const getTahsilatlar = async (
  subeKodu: string,
  gun: string,
): Promise<KasaTahsilatOzet> => {
  const bos: KasaTahsilatOzet = {
    toplamNakit: 0, toplamKart: 0, toplamHavale: 0,
    tahsilatTutar: 0, tahsilatAdeti: 0, tahsilatlar: [],
  };

  try {
    const sube = getSubeByKod(subeKodu as SubeKodu);
    if (!sube) return bos;

    const [y, m, d] = gun.split('-').map(Number);
    const gunBaslangic = new Date(y, m - 1, d, 0, 0, 0, 0);
    const gunBitis     = new Date(y, m - 1, d, 23, 59, 59, 999);

    const ozet: KasaTahsilatOzet = { ...bos, tahsilatlar: [] };

    // ── 1. kasaTahsilatHareketleri — TAHSILAT tipindekiler ────────────────
    try {
      const tahsilatSnap = await getDocs(
        query(
          collection(db, `subeler/${sube.dbPath}/kasaTahsilatHareketleri`),
          where('created_at', '>=', Timestamp.fromDate(gunBaslangic)),
          where('created_at', '<=', Timestamp.fromDate(gunBitis)),
          where('tip', '==', 'TAHSILAT'),
        )
      );

      tahsilatSnap.docs.forEach((tahDoc) => {
        const data = tahDoc.data();
        const nakit  = Number(data.nakitTutar  ?? 0);
        const kart   = Number(data.kartTutar   ?? 0);
        const havale = Number(data.havaleTutar ?? 0);

        ozet.toplamNakit   += nakit;
        ozet.toplamKart    += kart;
        ozet.toplamHavale  += havale;
        ozet.tahsilatTutar += nakit + kart + havale;
        ozet.tahsilatAdeti += 1;

        ozet.tahsilatlar.push({
          id:              tahDoc.id,
          satisKodu:       data.satisKodu   ?? '',
          musteriIsim:     data.musteriIsim ?? '—',
          tutar:           nakit + kart + havale,
          nakitTutar:      nakit,
          kartTutar:       kart,
          havaleTutar:     havale,
          tarih:           toDate(data.created_at),
          odemeDurumu:     'ODENDI',
          onayDurumu:      true,
          kullanici:       data.yapan ?? '—',
          oncekiGunOdemesi: true,
          satisTarihi:     data.satisTarihi ?? '',
          aciklama:        data.aciklama ?? '',
        });
      });
    } catch (err) {
      console.error('getTahsilatlar kasaTahsilatHareketleri hatası:', err);
    }

    // ── 2. kasaTahsilatHareketleri — IADE tipindekiler (peşinat ters kayıtları)
    // ✅ v8: kasaIadeEkle gun'e göre created_at yazdığından,
    // bu sorguda o günün ters kayıtları gelir — negatif olarak gösterilir.
    try {
      const iadeSnap = await getDocs(
        query(
          collection(db, `subeler/${sube.dbPath}/kasaTahsilatHareketleri`),
          where('created_at', '>=', Timestamp.fromDate(gunBaslangic)),
          where('created_at', '<=', Timestamp.fromDate(gunBitis)),
          where('tip', '==', 'IADE'),
        )
      );

      iadeSnap.docs.forEach((iadeDoc) => {
        const data = iadeDoc.data();
        const nakit  = Number(data.nakitTutar  ?? 0); // zaten negatif
        const kart   = Number(data.kartTutar   ?? 0); // zaten negatif
        const havale = Number(data.havaleTutar ?? 0); // zaten negatif

        ozet.toplamNakit   += nakit;
        ozet.toplamKart    += kart;
        ozet.toplamHavale  += havale;
        ozet.tahsilatTutar += nakit + kart + havale;
        ozet.tahsilatAdeti += 1;

        ozet.tahsilatlar.push({
          id:              iadeDoc.id,
          satisKodu:       data.satisKodu   ?? '',
          musteriIsim:     data.musteriIsim ?? '—',
          tutar:           nakit + kart + havale,
          nakitTutar:      nakit,
          kartTutar:       kart,
          havaleTutar:     havale,
          tarih:           toDate(data.created_at),
          odemeDurumu:     'IADE',
          onayDurumu:      false,
          kullanici:       data.yapan ?? '—',
          oncekiGunOdemesi: true,
          satisTarihi:     data.satisTarihi ?? '',
          iptalIadesi:     true,
          aciklama:        data.aciklama ?? 'Peşinat ters kaydı',
        });
      });
    } catch (err) {
      console.error('getTahsilatlar iade hareketleri hatası:', err);
    }

    // ── 3. kasaIptalKayitlari — satış iptali iadeleri ────────────────────
    try {
      const iptalSnap = await getDocs(
        query(
          collection(db, `subeler/${sube.dbPath}/kasaIptalKayitlari`),
          where('created_at', '>=', Timestamp.fromDate(gunBaslangic)),
          where('created_at', '<=', Timestamp.fromDate(gunBitis)),
        )
      );

      iptalSnap.docs.forEach((iptalDoc) => {
        const data = iptalDoc.data();
        if (data.iptalGeriAlindi === true) return;

        const nakit  = Number(data.nakitTutar  ?? 0);
        const kart   = Number(data.kartTutar   ?? 0);
        const havale = Number(data.havaleTutar ?? 0);

        ozet.toplamNakit   += nakit;
        ozet.toplamKart    += kart;
        ozet.toplamHavale  += havale;
        ozet.tahsilatTutar += nakit + kart + havale;
        ozet.tahsilatAdeti += 1;

        ozet.tahsilatlar.push({
          id:              iptalDoc.id,
          satisKodu:       data.satisKodu   ?? '',
          musteriIsim:     data.musteriIsim ?? '—',
          tutar:           nakit + kart + havale,
          nakitTutar:      nakit,
          kartTutar:       kart,
          havaleTutar:     havale,
          tarih:           toDate(data.created_at),
          odemeDurumu:     'IADE',
          onayDurumu:      false,
          kullanici:       data.iptalYapan ?? '—',
          oncekiGunOdemesi: true,
          satisTarihi:     data.satisTarihi ?? '',
          iptalIadesi:     true,
          aciklama:        data.aciklama ?? 'Satış iptali iadesi',
        });
      });
    } catch (err) {
      console.error('getTahsilatlar iptal kayıtları hatası:', err);
    }

    ozet.tahsilatlar.sort((a, b) => b.tarih.getTime() - a.tarih.getTime());
    return ozet;

  } catch (err) {
    console.error('getTahsilatlar hata:', err);
    return bos;
  }
};

// ─── kasaHareketEkle (değişmedi) ──────────────────────────────────────────
export const kasaHareketEkle = async (
  subeKodu: string,
  kasaGunId: string,
  hareket: Omit<KasaHareket, 'id' | 'saat'>,
  _kullanici: string,
  _uid: string,
): Promise<boolean> => {
  try {
    const gunRef = doc(db, 'kasalar', subeKodu, 'gunler', kasaGunId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(gunRef);
      if (!snap.exists()) throw new Error('Kasa günü bulunamadı');

      const mevcut = docToKasaGun(snap.id, snap.data());
      const yeniH: KasaHareket = {
        ...hareket,
        id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        saat: saatStr(),
        tarih: hareket.tarih instanceof Date ? hareket.tarih : new Date(),
      };

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
          break;
        default:
          break;
      }

      tx.update(gunRef, {
        toplamGider,
        cikisYapilanPara,
        adminAlimlar,
        adminOzet,
        hareketler: [
          ...mevcut.hareketler.map((h) => ({
            ...h,
            tarih: h.tarih instanceof Date ? Timestamp.fromDate(h.tarih) : h.tarih,
          })),
          { ...yeniH, tarih: Timestamp.fromDate(yeniH.tarih as Date) },
        ],
        guncellemeTarihi: serverTimestamp(),
      });
    });

    const freshSnap = await getDoc(gunRef);
    if (freshSnap.exists()) {
      const fresh = freshSnap.data()!;
      const gunSonuBakiyesi = hesaplaGunSonu({
        acilisBakiyesi:   fresh.acilisBakiyesi   ?? 0,
        nakitSatis:       fresh.nakitSatis       ?? 0,
        toplamGider:      fresh.toplamGider      ?? 0,
        cikisYapilanPara: fresh.cikisYapilanPara ?? 0,
        adminAlimlar:     fresh.adminAlimlar     ?? 0,
      });
      await updateDoc(gunRef, { gunSonuBakiyesi });
    }

    return true;
  } catch (err) {
    console.error('kasaHareketEkle hata:', err);
    return false;
  }
};

// ─── getKasaGecmisi (değişmedi) ───────────────────────────────────────────
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

// ─── testGunGecisi (değişmedi) ────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════════
//  KasaTahsilatHareket — audit trail için tip
// ═══════════════════════════════════════════════════════════════════════════
export interface KasaTahsilatHareket {
  tip: 'TAHSILAT' | 'IADE';
  satisId: string;
  satisKodu: string;
  musteriIsim: string;
  nakitTutar: number;
  kartTutar: number;
  havaleTutar: number;
  toplamTutar: number;
  gun: string;
  subeKodu: string;
  yapan: string;
  yapanId: string;
  aciklama: string;
  satisTarihi?: string | null;
  kartBanka?: string | null;
  havaleBanka?: string | null;
  iadeSebebi?: string;
  iadeTarih?: string;
  created_at: any;
}

// ═══════════════════════════════════════════════════════════════════════════
//  kasaTahsilatEkle (değişmedi)
// ═══════════════════════════════════════════════════════════════════════════
export const kasaTahsilatEkle = async (params: {
  subeKodu: string;
  gun: string;
  satisId: string;
  satisKodu: string;
  musteriIsim: string;
  nakitTutar: number;
  kartTutar: number;
  havaleTutar: number;
  yapan: string;
  yapanId: string;
  aciklama?: string;
  satisTarihi?: string;
  kartBanka?: string;
  havaleBanka?: string;
}): Promise<boolean> => {
  const {
    subeKodu, gun, satisId, satisKodu, musteriIsim,
    nakitTutar, kartTutar, havaleTutar, yapan, yapanId, aciklama,
    satisTarihi, kartBanka, havaleBanka,
  } = params;

  const sube = getSubeByKod(subeKodu as SubeKodu);
  if (!sube) return false;

  try {
    await addDoc(
      collection(db, `subeler/${sube.dbPath}/kasaTahsilatHareketleri`),
      {
        tip: 'TAHSILAT',
        satisId, satisKodu, musteriIsim,
        nakitTutar, kartTutar, havaleTutar,
        toplamTutar: nakitTutar + kartTutar + havaleTutar,
        gun, subeKodu, yapan, yapanId,
        aciklama: aciklama ?? '',
        satisTarihi: satisTarihi ?? null,
        kartBanka: kartBanka ?? null,
        havaleBanka: havaleBanka ?? null,
        created_at: Timestamp.fromDate(new Date()),
      }
    );

    const gunRef = doc(db, 'kasalar', subeKodu, 'gunler', gun);
    const gunSnap = await getDoc(gunRef);

    if (gunSnap.exists()) {
      await updateDoc(gunRef, {
        nakitSatis:  increment(nakitTutar),
        kartSatis:   increment(kartTutar),
        havaleSatis: increment(havaleTutar),
        guncellemeTarihi: serverTimestamp(),
      });

      const freshSnap = await getDoc(gunRef);
      const fresh = freshSnap.data()!;
      const gunSonuBakiyesi = hesaplaGunSonu({
        acilisBakiyesi:   fresh.acilisBakiyesi   ?? 0,
        nakitSatis:       fresh.nakitSatis       ?? 0,
        toplamGider:      fresh.toplamGider      ?? 0,
        cikisYapilanPara: fresh.cikisYapilanPara ?? 0,
        adminAlimlar:     fresh.adminAlimlar     ?? 0,
      });
      await updateDoc(gunRef, { gunSonuBakiyesi });
    } else {
      await setDoc(gunRef, {
        gun, subeKodu, durum: 'ACIK',
        acilisBakiyesi: 0,
        nakitSatis: nakitTutar, kartSatis: kartTutar, havaleSatis: havaleTutar,
        toplamGider: 0, cikisYapilanPara: 0, adminAlimlar: 0,
        adminOzet: {}, hareketler: [],
        gunSonuBakiyesi: nakitTutar,
        acilisYapan: yapan,
        olusturmaTarihi: serverTimestamp(), guncellemeTarihi: serverTimestamp(),
      });
    }

    return true;
  } catch (err) {
    console.error('kasaTahsilatEkle hata:', err);
    return false;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  kasaIadeEkle — v8 FIX
//
//  ✅ Artık "gun" parametresine göre created_at yazar.
//  → Eski peşinat 09.03'te girilmişse, ters kayıt da 09.03 kasasına düşer.
//  → Geçmiş kasalar asla yanlış etkilenmez.
// ═══════════════════════════════════════════════════════════════════════════
export const kasaIadeEkle = async (params: {
  subeKodu: string;
  gun: string;
  satisId: string;
  satisKodu: string;
  musteriIsim: string;
  nakitTutar: number;
  kartTutar: number;
  havaleTutar: number;
  yapan: string;
  yapanId: string;
  iadeSebebi?: string;
}): Promise<boolean> => {
  const {
    subeKodu, gun, satisId, satisKodu, musteriIsim,
    nakitTutar, kartTutar, havaleTutar, yapan, yapanId, iadeSebebi,
  } = params;

  const sube = getSubeByKod(subeKodu as SubeKodu);
  if (!sube) return false;

  try {
    // ✅ v8: created_at = gun'ün öğlen 12:00'si
    // Böylece kasaTahsilatHareketleri sorgusu (created_at filtreli)
    // bu kaydı doğru günde bulur.
    const [y, m, d] = gun.split('-').map(Number);
    const createdAt = Timestamp.fromDate(new Date(y, m - 1, d, 12, 0, 0, 0));

    await addDoc(
      collection(db, `subeler/${sube.dbPath}/kasaTahsilatHareketleri`),
      {
        tip: 'IADE',
        satisId, satisKodu, musteriIsim,
        nakitTutar:  -Math.abs(nakitTutar),
        kartTutar:   -Math.abs(kartTutar),
        havaleTutar: -Math.abs(havaleTutar),
        toplamTutar: -(Math.abs(nakitTutar) + Math.abs(kartTutar) + Math.abs(havaleTutar)),
        gun, subeKodu, yapan, yapanId,
        aciklama: iadeSebebi ?? 'İade',
        iadeSebebi: iadeSebebi ?? '',
        iadeTarih: gun,
        created_at: createdAt,
      }
    );

    console.log(`✅ kasaIadeEkle: ${satisKodu} — gun: ${gun}`);
    return true;
  } catch (err) {
    console.error('kasaIadeEkle hata:', err);
    return false;
  }
};