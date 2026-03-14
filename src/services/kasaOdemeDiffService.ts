// ===================================================
//  kasaOdemeDiffService.ts — v2
//
//  v1'den fark:
//  - Yeni eklenen ödeme (eskide yok, yenide var) → TAHSILAT (yeşil)
//  - Mevcut ödeme değişti / silindi → DUZELTME (turuncu)
//  - 2 kere yazma yok — her kalem tek seferde işlenir
// ===================================================

import {
  collection, addDoc, getDoc, updateDoc, doc,
  serverTimestamp, Timestamp, increment,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { getSubeByKod, SubeKodu } from '../types/sube';
import { bugunStrTR } from './kasaService';

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface OdemeKalemi {
  tutar: number;
  banka?: string;
}

export interface OdemeSnapshot {
  nakitTutar:    number;
  kartTutar:     number;
  havaleTutar:   number;
  kartOdemeler?: OdemeKalemi[];
  havaleler?:    OdemeKalemi[];
}

// ─── Kasa gün dokümanını güncelle ────────────────────────────────────────────

const kasaGunGuncelle = async (
  subeKodu: string,
  bugun: string,
  diffNakit: number,
  diffKart: number,
  diffHavale: number,
) => {
  if (diffNakit === 0 && diffKart === 0 && diffHavale === 0) return;

  const gunRef = doc(db, 'kasalar', subeKodu, 'gunler', bugun);
  const gunSnap = await getDoc(gunRef);
  if (!gunSnap.exists()) return;

  await updateDoc(gunRef, {
    nakitSatis:  increment(diffNakit),
    kartSatis:   increment(diffKart),
    havaleSatis: increment(diffHavale),
    guncellemeTarihi: serverTimestamp(),
  });

  const freshSnap = await getDoc(gunRef);
  if (freshSnap.exists()) {
    const fresh = freshSnap.data();
    const gunSonuBakiyesi =
      (fresh.acilisBakiyesi   ?? 0) +
      (fresh.nakitSatis       ?? 0) -
      (fresh.toplamGider      ?? 0) -
      (fresh.cikisYapilanPara ?? 0) -
      (fresh.adminAlimlar     ?? 0);
    await updateDoc(gunRef, { gunSonuBakiyesi });
  }
};

// ─── Hareket yaz ─────────────────────────────────────────────────────────────

const hareketYaz = async (params: {
  subeKodu: string;
  dbPath: string;
  tip: 'TAHSILAT' | 'DUZELTME';
  satisId: string;
  satisKodu: string;
  musteriIsim: string;
  satisTarihi: string;
  bugun: string;
  nakitTutar: number;
  kartTutar: number;
  havaleTutar: number;
  aciklama: string;
  yapan: string;
  yapanId: string;
}) => {
  const {
    subeKodu, dbPath, tip, satisId, satisKodu, musteriIsim,
    satisTarihi, bugun, nakitTutar, kartTutar, havaleTutar,
    aciklama, yapan, yapanId,
  } = params;

  await addDoc(
    collection(db, `subeler/${dbPath}/kasaTahsilatHareketleri`),
    {
      tip,
      satisId, satisKodu, musteriIsim,
      nakitTutar, kartTutar, havaleTutar,
      toplamTutar: nakitTutar + kartTutar + havaleTutar,
      gun: satisTarihi,
      subeKodu, yapan, yapanId,
      aciklama,
      satisTarihi,
      tahsilatGun: bugun,
      created_at: Timestamp.fromDate(new Date()),
      ...(tip === 'DUZELTME' ? { isDuzeltme: true } : {}),
    }
  );
};

// ─── Ana fonksiyon ────────────────────────────────────────────────────────────

export const kasaOdemeDiffYaz = async (params: {
  subeKodu:    string;
  satisId:     string;
  satisKodu:   string;
  musteriIsim: string;
  satisTarihi: string;
  eskiOdeme:   OdemeSnapshot;
  yeniOdeme:   OdemeSnapshot;
  yapan:       string;
  yapanId:     string;
}): Promise<boolean> => {
  const {
    subeKodu, satisId, satisKodu, musteriIsim,
    satisTarihi, eskiOdeme, yeniOdeme, yapan, yapanId,
  } = params;

  const bugun = bugunStrTR();

  // KURAL: Aynı gün düzenleme → hiçbir şey yazma
  if (satisTarihi === bugun) {
    console.log(`kasaOdemeDiffYaz: aynı gün (${bugun}), atlanıyor.`);
    return true;
  }

  const sube = getSubeByKod(subeKodu as SubeKodu);
  if (!sube) return false;

  const base = {
    subeKodu, dbPath: sube.dbPath,
    satisId, satisKodu, musteriIsim,
    satisTarihi, bugun, yapan, yapanId,
  };

  let toplamDiffNakit  = 0;
  let toplamDiffKart   = 0;
  let toplamDiffHavale = 0;

  try {
    // ── 1. NAKİT (peşinat) ───────────────────────────────────────────────
    const diffNakit = yeniOdeme.nakitTutar - eskiOdeme.nakitTutar;
    if (diffNakit !== 0) {
      if (eskiOdeme.nakitTutar === 0 && yeniOdeme.nakitTutar > 0) {
        // Yeni peşinat eklendi → TAHSILAT
        await hareketYaz({
          ...base, tip: 'TAHSILAT',
          nakitTutar: yeniOdeme.nakitTutar, kartTutar: 0, havaleTutar: 0,
          aciklama: `Yeni peşinat eklendi (satış: ${satisTarihi} / düzenleme: ${bugun})`,
        });
        toplamDiffNakit += yeniOdeme.nakitTutar;
      } else {
        // Mevcut peşinat değişti → DUZELTME
        await hareketYaz({
          ...base, tip: 'DUZELTME',
          nakitTutar: diffNakit, kartTutar: 0, havaleTutar: 0,
          aciklama: `Peşinat güncellendi ${diffNakit > 0 ? '+' : ''}${diffNakit.toLocaleString('tr-TR')} ₺ (satış: ${satisTarihi} / düzenleme: ${bugun})`,
        });
        toplamDiffNakit += diffNakit;
      }
    }

    // ── 2. HAVALE ────────────────────────────────────────────────────────
    const eskiHavaleler = eskiOdeme.havaleler ?? [];
    const yeniHavaleler = yeniOdeme.havaleler ?? [];

    // Yeni eklenen havaleler (eskide yoktu)
    for (const yeni of yeniHavaleler) {
      const eskiToplamBanka = eskiHavaleler
        .filter(h => (h.banka ?? '—') === (yeni.banka ?? '—'))
        .reduce((t, h) => t + h.tutar, 0);

      if (eskiToplamBanka === 0 && yeni.tutar > 0) {
        // Tamamen yeni havale → TAHSILAT
        await hareketYaz({
          ...base, tip: 'TAHSILAT',
          nakitTutar: 0, kartTutar: 0, havaleTutar: yeni.tutar,
          aciklama: `Yeni havale eklendi — ${yeni.banka ?? '—'} (satış: ${satisTarihi} / düzenleme: ${bugun})`,
        });
        toplamDiffHavale += yeni.tutar;
      } else if (eskiToplamBanka !== yeni.tutar) {
        // Mevcut havale değişti → DUZELTME
        const fark = yeni.tutar - eskiToplamBanka;
        if (fark !== 0) {
          await hareketYaz({
            ...base, tip: 'DUZELTME',
            nakitTutar: 0, kartTutar: 0, havaleTutar: fark,
            aciklama: `${yeni.banka ?? 'Havale'} güncellendi ${fark > 0 ? '+' : ''}${fark.toLocaleString('tr-TR')} ₺ (satış: ${satisTarihi} / düzenleme: ${bugun})`,
          });
          toplamDiffHavale += fark;
        }
      }
    }

    // Silinen havaleler (yenide yok)
    for (const eski of eskiHavaleler) {
      const yeniToplamBanka = yeniHavaleler
        .filter(h => (h.banka ?? '—') === (eski.banka ?? '—'))
        .reduce((t, h) => t + h.tutar, 0);

      if (yeniToplamBanka === 0 && eski.tutar > 0) {
        await hareketYaz({
          ...base, tip: 'DUZELTME',
          nakitTutar: 0, kartTutar: 0, havaleTutar: -eski.tutar,
          aciklama: `${eski.banka ?? 'Havale'} silindi −${eski.tutar.toLocaleString('tr-TR')} ₺ (satış: ${satisTarihi} / düzenleme: ${bugun})`,
        });
        toplamDiffHavale -= eski.tutar;
      }
    }

    // Fallback: havale listesi yoksa toplam fark yaz
    if (eskiHavaleler.length === 0 && yeniHavaleler.length === 0) {
      const diffHavale = yeniOdeme.havaleTutar - eskiOdeme.havaleTutar;
      if (diffHavale !== 0) {
        const tip = eskiOdeme.havaleTutar === 0 ? 'TAHSILAT' : 'DUZELTME';
        await hareketYaz({
          ...base, tip,
          nakitTutar: 0, kartTutar: 0, havaleTutar: diffHavale,
          aciklama: tip === 'TAHSILAT'
            ? `Yeni havale eklendi (satış: ${satisTarihi} / düzenleme: ${bugun})`
            : `Havale güncellendi ${diffHavale > 0 ? '+' : ''}${diffHavale.toLocaleString('tr-TR')} ₺ (satış: ${satisTarihi} / düzenleme: ${bugun})`,
        });
        toplamDiffHavale += diffHavale;
      }
    }

    // ── 3. KART ──────────────────────────────────────────────────────────
    const eskiKartlar = eskiOdeme.kartOdemeler ?? [];
    const yeniKartlar = yeniOdeme.kartOdemeler ?? [];

    for (const yeni of yeniKartlar) {
      const eskiToplamBanka = eskiKartlar
        .filter(k => (k.banka ?? '—') === (yeni.banka ?? '—'))
        .reduce((t, k) => t + k.tutar, 0);

      if (eskiToplamBanka === 0 && yeni.tutar > 0) {
        // Tamamen yeni kart → TAHSILAT
        await hareketYaz({
          ...base, tip: 'TAHSILAT',
          nakitTutar: 0, kartTutar: yeni.tutar, havaleTutar: 0,
          aciklama: `Yeni kart ödemesi — ${yeni.banka ?? '—'} (satış: ${satisTarihi} / düzenleme: ${bugun})`,
        });
        toplamDiffKart += yeni.tutar;
      } else if (eskiToplamBanka !== yeni.tutar) {
        const fark = yeni.tutar - eskiToplamBanka;
        if (fark !== 0) {
          await hareketYaz({
            ...base, tip: 'DUZELTME',
            nakitTutar: 0, kartTutar: fark, havaleTutar: 0,
            aciklama: `${yeni.banka ?? 'Kart'} güncellendi ${fark > 0 ? '+' : ''}${fark.toLocaleString('tr-TR')} ₺ (satış: ${satisTarihi} / düzenleme: ${bugun})`,
          });
          toplamDiffKart += fark;
        }
      }
    }

    // Silinen kartlar
    for (const eski of eskiKartlar) {
      const yeniToplamBanka = yeniKartlar
        .filter(k => (k.banka ?? '—') === (eski.banka ?? '—'))
        .reduce((t, k) => t + k.tutar, 0);

      if (yeniToplamBanka === 0 && eski.tutar > 0) {
        await hareketYaz({
          ...base, tip: 'DUZELTME',
          nakitTutar: 0, kartTutar: -eski.tutar, havaleTutar: 0,
          aciklama: `${eski.banka ?? 'Kart'} silindi −${eski.tutar.toLocaleString('tr-TR')} ₺ (satış: ${satisTarihi} / düzenleme: ${bugun})`,
        });
        toplamDiffKart -= eski.tutar;
      }
    }

    // Fallback: kart listesi yoksa toplam fark yaz
    if (eskiKartlar.length === 0 && yeniKartlar.length === 0) {
      const diffKart = yeniOdeme.kartTutar - eskiOdeme.kartTutar;
      if (diffKart !== 0) {
        const tip = eskiOdeme.kartTutar === 0 ? 'TAHSILAT' : 'DUZELTME';
        await hareketYaz({
          ...base, tip,
          nakitTutar: 0, kartTutar: diffKart, havaleTutar: 0,
          aciklama: tip === 'TAHSILAT'
            ? `Yeni kart ödemesi (satış: ${satisTarihi} / düzenleme: ${bugun})`
            : `Kart güncellendi ${diffKart > 0 ? '+' : ''}${diffKart.toLocaleString('tr-TR')} ₺ (satış: ${satisTarihi} / düzenleme: ${bugun})`,
        });
        toplamDiffKart += diffKart;
      }
    }

    // ── 4. Kasa gün dokümanını güncelle ──────────────────────────────────
    await kasaGunGuncelle(subeKodu, bugun, toplamDiffNakit, toplamDiffKart, toplamDiffHavale);

    console.log(`✅ kasaOdemeDiffYaz v2: ${satisKodu} için yazıldı`, {
      toplamDiffNakit, toplamDiffKart, toplamDiffHavale,
    });

    return true;
  } catch (err) {
    console.error('kasaOdemeDiffYaz hata:', err);
    return false;
  }
};

// ─── Satış dokümanından OdemeSnapshot çıkar ───────────────────────────────────

export const satistenOdemeSnapshot = (data: any): OdemeSnapshot => {
  const kartOdemeler: OdemeKalemi[] = (data.kartOdemeler ?? []).map((k: any) => ({
    tutar: Number(k.tutar ?? k.netTutar ?? 0),
    banka: k.banka ?? undefined,
  }));

  const havaleler: OdemeKalemi[] = (data.havaleler ?? []).map((h: any) => ({
    tutar: Number(h.tutar ?? 0),
    banka: h.banka ?? undefined,
  }));

  const kartTutar = kartOdemeler.reduce((t, k) => t + k.tutar, 0)
    || Number(data.kartTutar ?? 0);

  const havaleTutar = havaleler.reduce((t, h) => t + h.tutar, 0)
    || Number(data.havaleTutar ?? 0);

  return {
    nakitTutar:  Number(data.pesinatTutar ?? data.nakitTutar ?? 0),
    kartTutar,
    havaleTutar,
    kartOdemeler,
    havaleler,
  };
};