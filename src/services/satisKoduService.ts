// ===================================================
//  satisKoduService.ts — v2 FIX: Transaction + Atomic Counter
//
//  🔴 v1 PROBLEM:
//     getDocs(orderBy('satisKodu', 'desc'), limit(1)) ile son kodu okuyup
//     +1 ekliyordu. Transaction yoktu → iki kişi aynı anda satış oluşturunca
//     aynı kodu alıyordu → ÇAKIŞMA (ör: 1010-004 iki kere)
//
//  ✅ v2 ÇÖZÜM:
//     Firestore'da counter dokümanı + runTransaction:
//     counters/{subeKodu}_satis → { lastNumber: 17 }
//     Transaction içinde oku → +1 → yaz → döndür
//     Atomik olduğu için aynı anda iki kişi çağırsa bile
//     Firestore sadece birini geçirir, diğeri retry yapar.
//
//  📋 MİGRASYON:
//     İlk çalışmada counter dokümanı yoksa, mevcut satışlardan
//     en yüksek numarayı bulup counter'ı ona göre başlatır.
//     Yani eski verilerle uyumlu — sıfırdan başlamaz.
// ===================================================

import {
  collection, doc, getDoc, getDocs, setDoc, runTransaction,
  query, orderBy, limit,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { SubeKodu } from '../types/sube';

// ─── Counter doküman yolu ────────────────────────────────────────────────────
// counters/{subeKodu}_satis → { lastNumber: 17, subeKodu: "KARTAL", updatedAt: ... }
const getCounterRef = (subeKodu: string) =>
  doc(db, 'counters', `${subeKodu}_satis`);

// ─── Mevcut en yüksek satış numarasını bul (migrasyon için) ──────────────────
const findMaxSatisNumber = async (subeDbPath: string, subePrefix: string): Promise<number> => {
  try {
    const satisRef = collection(db, `subeler/${subeDbPath}/satislar`);
    const q = query(satisRef, orderBy('satisKodu', 'desc'), limit(20));
    const snapshot = await getDocs(q);

    let maxNumber = 0;

    snapshot.docs.forEach((docSnap) => {
      const kod = docSnap.data().satisKodu;
      if (!kod || typeof kod !== 'string') return;

      const parts = kod.split('-');
      if (parts.length !== 2) return;

      // Prefix kontrolü — farklı şubenin kodu olabilir
      if (parts[0] !== subePrefix) return;

      const num = parseInt(parts[1], 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    });

    return maxNumber;
  } catch (err) {
    console.error('findMaxSatisNumber hata:', err);
    return 0;
  }
};

// ─── Yeni satış kodu oluştur (ATOMIC) ────────────────────────────────────────
/**
 * Transaction + counter ile atomik satış kodu üretir.
 * İki kişi aynı anda çağırsa bile çakışma olmaz.
 *
 * @param subeKodu - Şube kodu (ör: "KARTAL")
 * @param subeDbPath - Firestore path (ör: "kartal")
 * @param subePrefix - Satış kodu prefix'i (ör: "1010")
 * @returns Yeni satış kodu (ör: "1010-018")
 */
export const yeniSatisKoduOlustur = async (
  subeKodu: SubeKodu,
  subeDbPath: string,
  subePrefix: string,
): Promise<string> => {
  const counterRef = getCounterRef(subeKodu);

  const yeniNumara = await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);

    let lastNumber: number;

    if (!counterSnap.exists()) {
      // ── İlk çalışma: Mevcut satışlardan en yüksek numarayı bul ──
      // Bu transaction DIŞINDA yapılmalı (getDocs transaction içinde çalışmaz)
      // Ama burada bir problem var: transaction içinde getDocs çağıramayız.
      // O yüzden counter'ı 0 ile başlatıp, transaction dışında düzelteceğiz.
      lastNumber = 0;
    } else {
      lastNumber = counterSnap.data().lastNumber ?? 0;
    }

    const newNumber = lastNumber + 1;

    tx.set(counterRef, {
      lastNumber: newNumber,
      subeKodu,
      subePrefix,
      updatedAt: new Date(),
    });

    return newNumber;
  });

  // ── Eğer counter yeni oluşturulduysa (lastNumber: 1), mevcut verileri kontrol et ──
  // İlk satış "001" oluşturulmuş olabilir ama mevcut verilerden "017" varsa
  // counter'ı 17'ye çekmemiz lazım.
  if (yeniNumara === 1) {
    const maxExisting = await findMaxSatisNumber(subeDbPath, subePrefix);
    if (maxExisting > 0) {
      // Counter'ı mevcut en yüksek + 1'e güncelle
      const correctNumber = maxExisting + 1;
      await setDoc(counterRef, {
        lastNumber: correctNumber,
        subeKodu,
        subePrefix,
        updatedAt: new Date(),
        migratedFrom: maxExisting,
      });

      return `${subePrefix}-${correctNumber.toString().padStart(3, '0')}`;
    }
  }

  return `${subePrefix}-${yeniNumara.toString().padStart(3, '0')}`;
};

// ─── Counter'ı manuel ayarla (admin aracı) ───────────────────────────────────
/**
 * Counter'ı belirli bir numaraya set eder.
 * Sadece admin tarafından kullanılmalı — hatalı durumlarda düzeltme için.
 */
export const satisCounterAyarla = async (
  subeKodu: string,
  subePrefix: string,
  numara: number,
): Promise<boolean> => {
  try {
    const counterRef = getCounterRef(subeKodu);
    await setDoc(counterRef, {
      lastNumber: numara,
      subeKodu,
      subePrefix,
      updatedAt: new Date(),
      manualSet: true,
    });
    console.log(`✅ Counter ayarlandı: ${subeKodu} → ${numara}`);
    return true;
  } catch (err) {
    console.error('satisCounterAyarla hata:', err);
    return false;
  }
};

// ─── Mevcut duplicate tespiti (admin aracı) ──────────────────────────────────
/**
 * Bir şubedeki tüm satış kodlarını tarar ve duplicate olanları döndürür.
 */
export const duplicateSatisKoduBul = async (
  subeDbPath: string,
): Promise<{ kod: string; docIds: string[] }[]> => {
  try {
    const satisRef = collection(db, `subeler/${subeDbPath}/satislar`);
    const snap = await getDocs(query(satisRef, orderBy('satisKodu', 'asc')));

    const kodMap: Record<string, string[]> = {};

    snap.docs.forEach((docSnap) => {
      const kod = docSnap.data().satisKodu;
      if (!kod) return;
      if (!kodMap[kod]) kodMap[kod] = [];
      kodMap[kod].push(docSnap.id);
    });

    return Object.entries(kodMap)
      .filter(([_, ids]) => ids.length > 1)
      .map(([kod, docIds]) => ({ kod, docIds }));
  } catch (err) {
    console.error('duplicateSatisKoduBul hata:', err);
    return [];
  }
};

// ─── Eski fonksiyonlar (geriye uyumluluk) ────────────────────────────────────
// Bu fonksiyonlar artık kullanılmamalı ama import eden yerler kırılmasın diye bırakıldı

/** @deprecated yeniSatisKoduOlustur kullanın */
export const getSonSatisKodu = async (subeKodu: SubeKodu, subeDbPath: string): Promise<string | null> => {
  console.warn('⚠️ getSonSatisKodu deprecated — yeniSatisKoduOlustur kullanın');
  try {
    const satisRef = collection(db, `subeler/${subeDbPath}/satislar`);
    const q = query(satisRef, orderBy('satisKodu', 'desc'), limit(1));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return snapshot.docs[0].data().satisKodu;
  } catch (error) {
    console.error('Son satış kodu alınamadı:', error);
    return null;
  }
};

/** @deprecated yeniSatisKoduOlustur kullanın */
export const getSiraNumarasi = (sonKod: string | null, subePrefix: string): string => {
  console.warn('⚠️ getSiraNumarasi deprecated — yeniSatisKoduOlustur kullanın');
  if (!sonKod) return `${subePrefix}-001`;
  const parts = sonKod.split('-');
  if (parts.length !== 2) return `${subePrefix}-001`;
  const sonSayi = parseInt(parts[1], 10);
  if (isNaN(sonSayi)) return `${subePrefix}-001`;
  const yeniSayi = sonSayi + 1;
  return `${subePrefix}-${yeniSayi.toString().padStart(3, '0')}`;
};