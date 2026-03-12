/**
 * kasaPaymentEventService.ts
 *
 * Tüm ödeme hareketleri bu servis üzerinden Firestore'a yazılır.
 * Koleksiyon: kasaPaymentEvents
 */

import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  Timestamp,
  orderBy,
  writeBatch,
  doc,
} from "firebase/firestore";
import { db } from "../firebase/config"; // ✅ düzeltildi: '../firebase' → '../firebase/config'

// ─── Tipler ──────────────────────────────────────────────────────────────────

export type PaymentEventType =
  | "payment_created"
  | "payment_reversed"
  | "refund_created"
  | "refund_reversed";

export type OdemeTipi =
  | "nakit"
  | "kredi_karti"
  | "havale"
  | "diger"
  | "iade";

export interface KasaPaymentEvent {
  id?: string;
  saleId: string;
  saleCode: string;
  musteriAdi: string;
  sube: string;
  eventType: PaymentEventType;
  odemeTipi: OdemeTipi;
  tutar: number;
  aciklama?: string;
  originalEventId?: string;
  createdAt: Timestamp;
  eventDateTR: string; // "YYYY-MM-DD" — TR timezone
  createdBy?: string;
}

export interface PaymentItem {
  odemeTipi: OdemeTipi;
  tutar: number;
  aciklama?: string;
}

export interface KasaGunlukOzet {
  nakitTahsilat: number;
  krediKartiTahsilat: number;
  havaleTahsilat: number;
  digerTahsilat: number;
  toplamTahsilat: number;
  nakitIade: number;
  krediKartiIade: number;
  havaleIade: number;
  digerIade: number;
  toplamIade: number;
  netToplam: number;
  reversalToplam: number;
}

// ─── Yardımcı: TR timezone tarih string ──────────────────────────────────────

export function getTRDateString(date?: Date): string {
  const d = date ?? new Date();
  const parts = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const year  = parts.find((p) => p.type === "year")?.value  ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day   = parts.find((p) => p.type === "day")?.value   ?? "";

  return `${year}-${month}-${day}`; // "2025-07-14"
}

// ─── Event yazma ─────────────────────────────────────────────────────────────

export async function writePaymentEvent(
  event: Omit<KasaPaymentEvent, "id" | "createdAt" | "eventDateTR">,
  overrideDate?: Date
): Promise<string> {
  const now = overrideDate ?? new Date();
  const docData: Omit<KasaPaymentEvent, "id"> = {
    ...event,
    createdAt: Timestamp.fromDate(now),
    eventDateTR: getTRDateString(now),
  };
  const ref = await addDoc(collection(db, "kasaPaymentEvents"), docData);
  return ref.id;
}

export async function handlePaymentEdit(params: {
  saleId: string;
  saleCode: string;
  musteriAdi: string;
  sube: string;
  oldPayments: PaymentItem[];
  newPayments: PaymentItem[];
  originalEventDate: string;
  createdBy?: string;
}): Promise<void> {
  const {
    saleId, saleCode, musteriAdi, sube,
    oldPayments, newPayments, originalEventDate, createdBy,
  } = params;

  const todayTR   = getTRDateString();
  const isSameDay = todayTR === originalEventDate;

  if (isSameDay) {
    for (const p of newPayments) {
      if (p.tutar > 0) {
        await writePaymentEvent({
          saleId, saleCode, musteriAdi, sube,
          eventType: "payment_created",
          odemeTipi: p.odemeTipi,
          tutar: p.tutar,
          aciklama: p.aciklama ?? "Aynı gün düzenleme",
          createdBy,
        });
      }
    }
    return;
  }

  const batch       = writeBatch(db);
  const now         = new Date();
  const eventDateTR = getTRDateString(now);
  const createdAt   = Timestamp.fromDate(now);

  for (const old of oldPayments) {
    if (old.tutar > 0) {
      batch.set(doc(collection(db, "kasaPaymentEvents")), {
        saleId, saleCode, musteriAdi, sube,
        eventType: "payment_reversed",
        odemeTipi: old.odemeTipi,
        tutar: old.tutar,
        aciklama: "Düzenleme nedeniyle iptal",
        createdAt, eventDateTR, createdBy,
      } as Omit<KasaPaymentEvent, "id">);
    }
  }

  for (const np of newPayments) {
    if (np.tutar > 0) {
      batch.set(doc(collection(db, "kasaPaymentEvents")), {
        saleId, saleCode, musteriAdi, sube,
        eventType: "payment_created",
        odemeTipi: np.odemeTipi,
        tutar: np.tutar,
        aciklama: np.aciklama ?? "Ödeme düzenlendi",
        createdAt, eventDateTR, createdBy,
      } as Omit<KasaPaymentEvent, "id">);
    }
  }

  await batch.commit();
}

export async function writeRefundEvent(params: {
  saleId: string;
  saleCode: string;
  musteriAdi: string;
  sube: string;
  tutar: number;
  odemeTipi: OdemeTipi;
  aciklama?: string;
  createdBy?: string;
}): Promise<string> {
  return writePaymentEvent({ ...params, eventType: "refund_created" });
}

// ─── Event okuma ─────────────────────────────────────────────────────────────

export async function getPaymentEventsByDate(
  sube: string,
  dateTR: string
): Promise<KasaPaymentEvent[]> {
  const q = query(
    collection(db, "kasaPaymentEvents"),
    where("sube", "==", sube),
    where("eventDateTR", "==", dateTR),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as KasaPaymentEvent));
}

export async function getPaymentEventsByDateRange(
  sube: string,
  startDate: string,
  endDate: string
): Promise<KasaPaymentEvent[]> {
  const q = query(
    collection(db, "kasaPaymentEvents"),
    where("sube", "==", sube),
    where("eventDateTR", ">=", startDate),
    where("eventDateTR", "<=", endDate),
    orderBy("eventDateTR", "asc"),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as KasaPaymentEvent));
}

export async function getPaymentEventsBySaleId(
  saleId: string
): Promise<KasaPaymentEvent[]> {
  const q = query(
    collection(db, "kasaPaymentEvents"),
    where("saleId", "==", saleId),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as KasaPaymentEvent));
}

// ─── Özet hesaplama ──────────────────────────────────────────────────────────

export function calculateDailyKasaOzet(events: KasaPaymentEvent[]): KasaGunlukOzet {
  const ozet: KasaGunlukOzet = {
    nakitTahsilat: 0, krediKartiTahsilat: 0, havaleTahsilat: 0, digerTahsilat: 0,
    toplamTahsilat: 0,
    nakitIade: 0, krediKartiIade: 0, havaleIade: 0, digerIade: 0,
    toplamIade: 0, netToplam: 0, reversalToplam: 0,
  };

  for (const ev of events) {
    if (ev.eventType === "payment_created") {
      switch (ev.odemeTipi) {
        case "nakit":       ozet.nakitTahsilat      += ev.tutar; break;
        case "kredi_karti": ozet.krediKartiTahsilat += ev.tutar; break;
        case "havale":      ozet.havaleTahsilat      += ev.tutar; break;
        default:            ozet.digerTahsilat       += ev.tutar;
      }
      ozet.toplamTahsilat += ev.tutar;
    } else if (ev.eventType === "refund_created") {
      switch (ev.odemeTipi) {
        case "nakit":       ozet.nakitIade      += ev.tutar; break;
        case "kredi_karti": ozet.krediKartiIade += ev.tutar; break;
        case "havale":      ozet.havaleIade      += ev.tutar; break;
        default:            ozet.digerIade       += ev.tutar;
      }
      ozet.toplamIade += ev.tutar;
    } else if (ev.eventType === "payment_reversed" || ev.eventType === "refund_reversed") {
      ozet.reversalToplam += ev.tutar;
    }
  }

  ozet.netToplam = ozet.toplamTahsilat - ozet.toplamIade;
  return ozet;
}