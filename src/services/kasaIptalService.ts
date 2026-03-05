// ===================================================
//  kasaIptalService.ts — v2 FIX
//
//  v1 PROBLEMLER:
//  1. Müşteri adı "Bilinmiyor" — musteriAdi/musteriIsim yerine
//     musteriBilgileri.isim'den alınmalı
//  2. İdempotency yok — aynı satış için birden fazla iptal kaydı
//     oluşturulabiliyordu
//
//  v2 ÇÖZÜMLER:
//  1. Müşteri adı fallback zinciri düzeltildi
//  2. Aynı satisId için zaten kayıt varsa tekrar oluşturmaz
// ===================================================

import { db } from '../firebase/config';
import {
  collection, addDoc, getDocs, query,
  where, Timestamp,
} from 'firebase/firestore';
import { getSubeByKod } from '../types/sube';
import { SatisTeklifFormu } from '../types/satis';

// ─── Tipler ──────────────────────────────────────────────────────────────────

interface KasaIptalParams {
  satis: SatisTeklifFormu & { id: string };
  subeKodu: string;
  iptalYapan: string;
  iptalYapanId: string;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

const bugunStr = (): string => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const tarihStr = (tarih: any): string => {
  if (!tarih) return '';
  try {
    const d = typeof tarih === 'object' && 'toDate' in tarih ? tarih.toDate() : new Date(tarih);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return '';
  }
};

// ─── Ana Fonksiyon ───────────────────────────────────────────────────────────

export const kasaIptalKaydiOlustur = async (params: KasaIptalParams): Promise<boolean> => {
  const { satis, subeKodu, iptalYapan, iptalYapanId } = params;

  const sube = getSubeByKod(subeKodu as any);
  if (!sube) {
    console.error('kasaIptalKaydiOlustur: Şube bulunamadı:', subeKodu);
    return false;
  }

  // ═══ v2 FIX: İdempotency guard ═══
  // Aynı satisId için zaten iptal kaydı varsa tekrar oluşturma
  try {
    const mevcutSnap = await getDocs(
      query(
        collection(db, `subeler/${sube.dbPath}/kasaIptalKayitlari`),
        where('satisId', '==', satis.id),
      )
    );
    if (!mevcutSnap.empty) {
      console.log(`⚠️ kasaIptalKaydiOlustur: ${satis.satisKodu} için zaten iptal kaydı var, atlanıyor.`);
      return true;
    }
  } catch (err) {
    console.error('İdempotency kontrol hatası:', err);
  }

  // ── 1. Satışın ödeme tutarlarını bul ─────────────────────────────────────
  const pesinatlar: any[] = (satis as any).pesinatlar || [];
  const havaleler: any[]  = (satis as any).havaleler  || [];
  const kartOdemeler: any[] = satis.kartOdemeler || [];

  const nakit = pesinatlar.reduce((t: number, p: any) => t + (parseFloat(p.tutar) || 0), 0)
               || (satis.pesinatTutar || 0);

  const havale = havaleler.reduce((t: number, h: any) => t + (parseFloat(h.tutar) || 0), 0)
                || (satis.havaleTutar || 0);

  const kart = kartOdemeler.reduce((t: number, k: any) => t + (parseFloat(k.tutar) || 0), 0)
              || ((satis as any).kartBrutToplam || 0);

  const toplamOdendi = nakit + havale + kart;

  if (toplamOdendi <= 0) {
    console.log('kasaIptalKaydiOlustur: Ödemesiz satış, negatif kayıt gerekmez.');
    return true;
  }

  // ── 2. Negatif kayıt oluştur ─────────────────────────────────────────────
  const bugün = bugunStr();
  const satisTarihStr = tarihStr((satis as any).olusturmaTarihi || (satis as any).tarih);

  // ═══ v2 FIX: Müşteri adı fallback zinciri düzeltildi ═══
  // Eski: satis.musteriAdi || satis.musteriIsim → "Bilinmiyor"
  // Yeni: musteriBilgileri.isim → musteriIsim → musteriAdi → fallback
  const musteriIsim =
    (satis as any).musteriBilgileri?.isim ||
    (satis as any).musteriIsim ||
    (satis as any).musteriAdi ||
    (satis as any).musteriBilgileri?.adSoyad ||
    'Bilinmiyor';

  const kayit = {
    tip: 'IPTAL_IADESI' as const,
    satisId: satis.id,
    satisKodu: satis.satisKodu || '',
    musteriIsim,
    // Negatif tutarlar
    nakitTutar:  nakit  > 0 ? -nakit  : 0,
    kartTutar:   kart   > 0 ? -kart   : 0,
    havaleTutar: havale > 0 ? -havale : 0,
    // Meta
    iptalTarihi: bugün,
    satisTarihi: satisTarihStr,
    iptalYapan,
    iptalYapanId,
    subeKodu,
    created_at: Timestamp.fromDate(new Date()),
    aciklama: `Satış iptali iadesi — ${satis.satisKodu}`,
    iptalIadesi: true as const,
    // Audit trail
    orijinalOdemeDetay: { nakit, kart, havale, toplamOdendi },
  };

  try {
    await addDoc(
      collection(db, `subeler/${sube.dbPath}/kasaIptalKayitlari`),
      kayit,
    );

    console.log(`✅ Kasa iptal kaydı oluşturuldu: ${satis.satisKodu} — Müşteri: ${musteriIsim}`, {
      nakit: -nakit, kart: -kart, havale: -havale,
    });
    return true;
  } catch (err) {
    console.error('kasaIptalKaydiOlustur: Firestore hatası:', err);
    return false;
  }
};

// ─── İptal kayıtlarını getir ─────────────────────────────────────────────────

export const bugunIptalKayitlariniGetir = async (subeKodu: string, gun: string) => {
  const sube = getSubeByKod(subeKodu as any);
  if (!sube) return [];

  try {
    const [y, m, d] = gun.split('-').map(Number);
    const gunBaslangic = new Date(y, m - 1, d, 0, 0, 0, 0);
    const gunBitis     = new Date(y, m - 1, d, 23, 59, 59, 999);

    const snap = await getDocs(
      query(
        collection(db, `subeler/${sube.dbPath}/kasaIptalKayitlari`),
        where('created_at', '>=', Timestamp.fromDate(gunBaslangic)),
        where('created_at', '<=', Timestamp.fromDate(gunBitis)),
      )
    );

    return snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      created_at: doc.data().created_at?.toDate?.() ?? new Date(),
    }));
  } catch (err) {
    console.error('bugunIptalKayitlariniGetir hatası:', err);
    return [];
  }
};