// ===================================================
//  kasaOdemeDiffService.ts — v1
//
//  AMAÇ:
//  Geçmiş tarihli bir satış düzenlendiğinde (farklı gün),
//  eski ödeme state'i ile yeni ödeme state'i arasındaki
//  FARKI bugünün kasasına DUZELTME tipi olarak yazar.
//
//  KURALLAR:
//  1. Satış günü === işlem günü → HİÇBİR ŞEY YAZMA
//     (aynı gün düzenlemeler kasayı etkilemez)
//  2. Satış günü !== işlem günü → sadece FARK yaz
//     - Peşinat 5k→10k: kasaya +5k (fark)
//     - Peşinat 10k→5k: kasaya -5k (fark)
//     - Banka değişimi, toplam aynı: DUZELTME kaydı açıklamayla var, tutar=0
//  3. Eski günün kasasına ASLA dokunma
//  4. Bugünün kasa gün dokümanı yoksa güncelleme yapma (sadece hareket yaz)
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
  banka?: string;  // havale/kart için banka adı
}

export interface OdemeSnapshot {
  nakitTutar:    number;
  kartTutar:     number;
  havaleTutar:   number;
  // Banka bazlı detay (opsiyonel — varsa daha zengin açıklama üretilir)
  kartOdemeler?: OdemeKalemi[];
  havaleler?:    OdemeKalemi[];
}

export interface DiffSonuc {
  diffNakit:  number;
  diffKart:   number;
  diffHavale: number;
  aciklama:   string;
  herhangiDegisiklikVar: boolean; // tutar aynı olsa bile banka değiştiyse true
}

// ─── Diff hesapla ─────────────────────────────────────────────────────────────

export const odemeDiffHesapla = (
  eskiOdeme: OdemeSnapshot,
  yeniOdeme: OdemeSnapshot,
  satisTarihi: string,
  bugun: string,
): DiffSonuc => {
  const diffNakit  = yeniOdeme.nakitTutar  - eskiOdeme.nakitTutar;
  const diffKart   = yeniOdeme.kartTutar   - eskiOdeme.kartTutar;
  const diffHavale = yeniOdeme.havaleTutar - eskiOdeme.havaleTutar;

  const aciklamaParcalari: string[] = [
    `Geçmiş satış düzenlemesi (satış: ${satisTarihi} / düzenleme: ${bugun})`,
  ];

  // Havale banka bazlı diff açıklaması
  const eskiHavaleler = eskiOdeme.havaleler ?? [];
  const yeniHavaleler = yeniOdeme.havaleler ?? [];
  const tumHavaleBankalar = new Set([
    ...eskiHavaleler.map(h => h.banka ?? '—'),
    ...yeniHavaleler.map(h => h.banka ?? '—'),
  ]);
  let havaleBankaDegisti = false;
  tumHavaleBankalar.forEach(banka => {
    const eski = eskiHavaleler.filter(h => (h.banka ?? '—') === banka).reduce((t, h) => t + h.tutar, 0);
    const yeni = yeniHavaleler.filter(h => (h.banka ?? '—') === banka).reduce((t, h) => t + h.tutar, 0);
    const fark = yeni - eski;
    if (fark > 0)  aciklamaParcalari.push(`${banka} havale +${fark.toLocaleString('tr-TR')} ₺`);
    if (fark < 0)  aciklamaParcalari.push(`${banka} havale ${fark.toLocaleString('tr-TR')} ₺`);
    if (fark !== 0) havaleBankaDegisti = true;
  });

  // Kart banka bazlı diff açıklaması
  const eskiKartlar = eskiOdeme.kartOdemeler ?? [];
  const yeniKartlar = yeniOdeme.kartOdemeler ?? [];
  const tumKartBankalar = new Set([
    ...eskiKartlar.map(k => k.banka ?? '—'),
    ...yeniKartlar.map(k => k.banka ?? '—'),
  ]);
  let kartBankaDegisti = false;
  tumKartBankalar.forEach(banka => {
    const eski = eskiKartlar.filter(k => (k.banka ?? '—') === banka).reduce((t, k) => t + k.tutar, 0);
    const yeni = yeniKartlar.filter(k => (k.banka ?? '—') === banka).reduce((t, k) => t + k.tutar, 0);
    const fark = yeni - eski;
    if (fark > 0)  aciklamaParcalari.push(`${banka} kart +${fark.toLocaleString('tr-TR')} ₺`);
    if (fark < 0)  aciklamaParcalari.push(`${banka} kart ${fark.toLocaleString('tr-TR')} ₺`);
    if (fark !== 0) kartBankaDegisti = true;
  });

  // Nakit diff açıklaması
  if (diffNakit !== 0) {
    aciklamaParcalari.push(
      diffNakit > 0
        ? `Nakit +${diffNakit.toLocaleString('tr-TR')} ₺`
        : `Nakit ${diffNakit.toLocaleString('tr-TR')} ₺`
    );
  }

  const herhangiDegisiklikVar =
    diffNakit !== 0 ||
    diffKart !== 0 ||
    diffHavale !== 0 ||
    havaleBankaDegisti ||
    kartBankaDegisti;

  return {
    diffNakit,
    diffKart,
    diffHavale,
    aciklama: aciklamaParcalari.join(' | '),
    herhangiDegisiklikVar,
  };
};

// ─── Ana fonksiyon ────────────────────────────────────────────────────────────

export const kasaOdemeDiffYaz = async (params: {
  subeKodu:    string;
  satisId:     string;
  satisKodu:   string;
  musteriIsim: string;
  satisTarihi: string;  // orijinal satış günü "YYYY-MM-DD"
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

  // KURAL 1: Aynı gün düzenleme → hiçbir şey yazma
  if (satisTarihi === bugun) {
    console.log(`kasaOdemeDiffYaz: aynı gün düzenleme (${bugun}), kasa kaydı atlanıyor.`);
    return true;
  }

  const sube = getSubeByKod(subeKodu as SubeKodu);
  if (!sube) return false;

  // Diff hesapla
  const diff = odemeDiffHesapla(eskiOdeme, yeniOdeme, satisTarihi, bugun);

  // Hiçbir değişiklik yoksa yazma
  if (!diff.herhangiDegisiklikVar) {
    console.log(`kasaOdemeDiffYaz: değişiklik tespit edilmedi, atlanıyor.`);
    return true;
  }

  try {
    // 1. kasaTahsilatHareketleri'ne DUZELTME kaydı yaz
    await addDoc(
      collection(db, `subeler/${sube.dbPath}/kasaTahsilatHareketleri`),
      {
        tip:           'DUZELTME',
        satisId,
        satisKodu,
        musteriIsim,
        nakitTutar:    diff.diffNakit,
        kartTutar:     diff.diffKart,
        havaleTutar:   diff.diffHavale,
        toplamTutar:   diff.diffNakit + diff.diffKart + diff.diffHavale,
        gun:           satisTarihi,       // orijinal satış günü (referans)
        subeKodu,
        yapan,
        yapanId,
        aciklama:      diff.aciklama,
        satisTarihi,
        tahsilatGun:   bugun,             // bugünün kasasına ait
        created_at:    Timestamp.fromDate(new Date()),
        // Debug için snapshot
        _eskiOdeme:    eskiOdeme,
        _yeniOdeme:    yeniOdeme,
      }
    );

    // 2. Bugünün kasa gün dokümanını güncelle (varsa)
    const gunRef = doc(db, 'kasalar', subeKodu, 'gunler', bugun);
    const gunSnap = await getDoc(gunRef);

    if (gunSnap.exists() && (diff.diffNakit !== 0 || diff.diffKart !== 0 || diff.diffHavale !== 0)) {
      await updateDoc(gunRef, {
        nakitSatis:  increment(diff.diffNakit),
        kartSatis:   increment(diff.diffKart),
        havaleSatis: increment(diff.diffHavale),
        guncellemeTarihi: serverTimestamp(),
      });

      // Gün sonu yeniden hesapla
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
    }
    // Kasa günü henüz açılmamışsa sadece hareket kaydı yeterli.
    // getBugununKasaGunu çağrıldığında recalcNakitSatis zaten DUZELTME'yi toplayacak.

    console.log(`✅ kasaOdemeDiffYaz: ${satisKodu} için diff yazıldı:`, {
      diffNakit: diff.diffNakit,
      diffKart:  diff.diffKart,
      diffHavale: diff.diffHavale,
      aciklama:  diff.aciklama,
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
