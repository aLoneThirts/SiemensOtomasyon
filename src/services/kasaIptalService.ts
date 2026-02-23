// ===================================================
//  kasaIptalService.ts
//  7️⃣ Satış iptali → iptal tarihinde negatif tahsilat
//
//  KULLANIM:
//  SatisDuzenlePage'de satisiIptalEt() içinde çağrılır:
//
//  import { kasaIptalKaydiOlustur } from '../services/kasaIptalService';
//
//  await kasaIptalKaydiOlustur({
//    satis,
//    subeKodu: currentUser.subeKodu,
//    iptalYapan: `${currentUser.ad} ${currentUser.soyad}`,
//    iptalYapanId: currentUser.uid,
//  });
// ===================================================

import { db } from '../firebase/config';
import {
  collection, addDoc, getDocs, query,
  where, Timestamp, doc, getDoc,
} from 'firebase/firestore';
import { getSubeByKod } from '../types/sube';
import { SatisTeklifFormu } from '../types/satis';

// ─── Tipler ──────────────────────────────────────────────────────────────────

interface KasaIptalKayit {
  // Tahsilat sekmesine düşen negatif kayıt
  tip: 'IPTAL_IADESI';
  satisId: string;
  satisKodu: string;
  musteriIsim: string;
  // Negatif tutarlar (ödeme tipine göre)
  nakitTutar: number;  // <= 0
  kartTutar: number;   // <= 0
  havaleTutar: number; // <= 0
  // İptal meta
  iptalTarihi: string;           // YYYY-MM-DD (bugün)
  satisTarihi: string;           // orijinal satış günü
  iptalYapan: string;
  iptalYapanId: string;
  subeKodu: string;
  created_at: Timestamp;         // 6️⃣ tahsilatlar bu alana göre filtreler
  aciklama: string;
  iptalIadesi: true;             // tahsilatlar sekmesinde kırmızı satır için
  // Audit trail
  orijinalOdemeDetay: {
    nakit: number;
    kart: number;
    havale: number;
    toplamOdendi: number;
  };
}

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

/**
 * Satış iptal edildiğinde çağrılır.
 * İptal tarihinin (bugün) kasa tahsilatlarına negatif kayıt ekler.
 *
 * ✅ Doğru mantık:
 * - Geçmiş günler DEĞİŞMEZ
 * - Açılış bakiyeleri DEĞİŞMEZ
 * - Sadece bugüne negatif tahsilat eklenir
 * - Tahsilatlar sekmesi created_at = today filtresiyle bunu yakalar
 */
export const kasaIptalKaydiOlustur = async (params: KasaIptalParams): Promise<boolean> => {
  const { satis, subeKodu, iptalYapan, iptalYapanId } = params;

  const sube = getSubeByKod(subeKodu as any);
  if (!sube) {
    console.error('kasaIptalKaydiOlustur: Şube bulunamadı:', subeKodu);
    return false;
  }

  // ── 1. Satışın ödeme tutarlarını bul ─────────────────────────────────────
  const pesinatlar: any[] = (satis as any).pesinatlar || [];
  const havaleler: any[]  = (satis as any).havaleler  || [];
  const kartOdemeler: any[] = satis.kartOdemeler || [];

  // Nakit = peşinatlar toplamı
  const nakit = pesinatlar.reduce((t: number, p: any) => t + (parseFloat(p.tutar) || 0), 0)
               || (satis.pesinatTutar || 0);

  // Havale toplamı
  const havale = havaleler.reduce((t: number, h: any) => t + (parseFloat(h.tutar) || 0), 0)
                || (satis.havaleTutar || 0);

  // Kart toplamı (brüt)
  const kart = kartOdemeler.reduce((t: number, k: any) => t + (parseFloat(k.tutar) || 0), 0)
              || ((satis as any).kartBrutToplam || 0);

  const toplamOdendi = nakit + havale + kart;

  // Eğer hiç ödeme yoksa negatif kayıt gerekmez
  if (toplamOdendi <= 0) {
    console.log('kasaIptalKaydiOlustur: Ödemesiz satış, negatif kayıt gerekmez.');
    return true;
  }

  // ── 2. Negatif kayıt oluştur ─────────────────────────────────────────────
  const bugün = bugunStr();
  const satisTarihStr = tarihStr((satis as any).olusturmaTarihi || (satis as any).tarih);
  const musteriIsim = (satis as any).musteriAdi || (satis as any).musteriIsim || 'Bilinmiyor';

  const kayit: Omit<KasaIptalKayit, never> = {
    tip: 'IPTAL_IADESI',
    satisId: satis.id,
    satisKodu: satis.satisKodu || '',
    musteriIsim,
    // 🔴 Negatif tutarlar
    nakitTutar:  nakit  > 0 ? -nakit  : 0,
    kartTutar:   kart   > 0 ? -kart   : 0,
    havaleTutar: havale > 0 ? -havale : 0,
    // Meta
    iptalTarihi: bugün,
    satisTarihi: satisTarihStr,
    iptalYapan,
    iptalYapanId,
    subeKodu,
    // 6️⃣ created_at = today → tahsilatlar sekmesi bu günü yakalar
    created_at: Timestamp.fromDate(new Date()),
    aciklama: `Satış iptali iadesi — ${satis.satisKodu}`,
    iptalIadesi: true,
    // Audit trail
    orijinalOdemeDetay: { nakit, kart, havale, toplamOdendi },
  };

  try {
    // Firestore: subeler/{sube.dbPath}/kasaIptalKayitlari
    await addDoc(
      collection(db, `subeler/${sube.dbPath}/kasaIptalKayitlari`),
      kayit,
    );

    console.log(`✅ Kasa iptal kaydı oluşturuldu: ${satis.satisKodu}`, {
      nakit: -nakit, kart: -kart, havale: -havale,
    });
    return true;
  } catch (err) {
    console.error('kasaIptalKaydiOlustur: Firestore hatası:', err);
    return false;
  }
};

// ─── kasaService'e ek: iptal kayıtlarını getir (getTahsilatlar içinde kullan) ─

/**
 * Bugün oluşturulmuş iptal kayıtlarını getirir.
 * kasaService.ts'deki getTahsilatlar() fonksiyonu bunu çağırıp
 * normal tahsilatlarla birleştirmeli.
 */
export const bugunIptalKayitlariniGetir = async (subeKodu: string, gun: string) => {
  const sube = getSubeByKod(subeKodu as any);
  if (!sube) return [];

  try {
    // Bugünün başı / sonu
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
