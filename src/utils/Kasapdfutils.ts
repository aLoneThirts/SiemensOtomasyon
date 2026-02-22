// ===================================================
//  KASA PDF UTILS — TEK SAYFA, KOMPAKT, TEMİZ
// ===================================================

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { KasaGun, KasaHareketTipi } from '../types/kasa';
import { KasaSatisDetay } from '../services/kasaService';

export interface KasaPdfInput {
  kasaGun:     KasaGun;
  satislar:    KasaSatisDetay[];
  tahsilatlar: KasaSatisDetay[];
  magazaAdi?:  string;
}

// ─── Türkçe karakter dönüşümü ────────────────────
// jsPDF Helvetica Türkçe desteklemez, latin'e çevir
const tr = (s: string): string =>
  (s || '')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C');

const para = (n: number): string =>
  new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n ?? 0) + ' TL';

const gunFmt = (s: string): string => {
  if (!s) return '--';
  const [yy, mm, dd] = s.split('-');
  return `${dd}.${mm}.${yy}`;
};

const saatFmt = (d: any): string => {
  try {
    const dt = d instanceof Date ? d : new Date(d);
    return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  } catch { return '--'; }
};

// ─── Renkler ─────────────────────────────────────
type RGB = [number, number, number];

const C: Record<string, RGB> = {
  teal:        [0,   153, 153],
  tealDark:    [0,   117, 117],
  tealLight:   [220, 245, 245],
  tealXlight:  [240, 252, 252],
  green:       [22,  163,  74],
  greenLight:  [220, 252, 231],
  greenAccent: [134, 239, 172],
  red:         [185,  28,  28],
  redLight:    [254, 226, 226],
  redAccent:   [252, 165, 165],
  amber:       [180,  83,   9],
  amberLight:  [254, 243, 199],
  amberAccent: [253, 211, 102],
  purple:      [109,  40, 217],
  purpleLight: [245, 243, 255],
  g50:         [249, 250, 251],
  g100:        [243, 244, 246],
  g200:        [229, 231, 235],
  g300:        [209, 213, 219],
  g400:        [156, 163, 175],
  g500:        [107, 114, 128],
  g600:        [ 75,  85,  99],
  g700:        [ 55,  65,  81],
  g800:        [ 31,  41,  55],
  tealAccent:  [ 94, 210, 210],
  white:       [255, 255, 255],
};

const fc = (pdf: jsPDF, k: string) => pdf.setFillColor(C[k][0], C[k][1], C[k][2]);
const tc = (pdf: jsPDF, k: string) => pdf.setTextColor(C[k][0], C[k][1], C[k][2]);
const dc = (pdf: jsPDF, k: string) => pdf.setDrawColor(C[k][0], C[k][1], C[k][2]);

// ─── Bölüm başlığı ───────────────────────────────
function baslik(
  pdf: jsPDF, text: string, y: number,
  M: number, CW: number,
  bg: string, accent: string,
): number {
  fc(pdf, bg);
  pdf.rect(M, y, CW, 7, 'F');
  fc(pdf, accent);
  pdf.rect(M, y, 3, 7, 'F');
  tc(pdf, accent);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.text(tr(text), M + 6, y + 5);
  return y + 9;
}

// ─── Ana fonksiyon ────────────────────────────────
export const kasaPdfIndir = async (input: KasaPdfInput): Promise<void> => {
  const { kasaGun, satislar, tahsilatlar, magazaAdi = 'Tufekci Home' } = input;

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W  = 210;
  const M  = 10;
  const CW = W - M * 2; // 190mm
  let   y  = 0;

  // ════════════════════════════════════════
  // 1. BAŞLIK
  // ════════════════════════════════════════
  fc(pdf, 'teal');
  pdf.rect(0, 0, W, 22, 'F');

  fc(pdf, 'tealDark');
  pdf.rect(M, 3, 28, 16, 'F');
  tc(pdf, 'white');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text('KASA', M + 14, 9.5, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(5);
  pdf.text('YONETIM SISTEMI', M + 14, 13.5, { align: 'center' });
  pdf.text('GUNLUK RAPOR',    M + 14, 17,   { align: 'center' });

  tc(pdf, 'white');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text(tr(magazaAdi).toUpperCase(), M + 32, 10);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text(`Kasa Gunluk Raporu  -  ${gunFmt(kasaGun.gun)}`, M + 32, 17);

  pdf.setFontSize(6.5);
  pdf.text(`Tarih: ${gunFmt(kasaGun.gun)}`,            W - M, 8,  { align: 'right' });
  pdf.text(`Acilis: ${tr(kasaGun.acilisYapan || '--')}`, W - M, 13, { align: 'right' });
  pdf.text(`Olusturuldu: ${tr(new Date().toLocaleString('tr-TR'))}`, W - M, 18, { align: 'right' });

  y = 26;

  // ════════════════════════════════════════
  // 2. ÖZET KASA — 5 KUTU
  // ════════════════════════════════════════
  y = baslik(pdf, 'OZET KASA TABLOSU', y, M, CW, 'g100', 'tealDark');

  const bW = (CW - 4) / 5;
  const bH = 18;

  const kutular = [
    { label: 'ACILIS BAKIYESI', value: kasaGun.acilisBakiyesi ?? 0,
      bg: 'g100',      txt: 'g700',     acc: 'g300' },
    { label: 'NAKIT SATIS',     value: kasaGun.nakitSatis ?? 0,
      bg: 'greenLight', txt: 'green',   acc: 'greenAccent' },
    { label: 'GIDER',           value: kasaGun.toplamGider ?? 0,
      bg: 'redLight',   txt: 'red',     acc: 'redAccent' },
    { label: 'CIKIS',           value: (kasaGun.cikisYapilanPara ?? 0) + (kasaGun.adminAlimlar ?? 0),
      bg: 'amberLight', txt: 'amber',   acc: 'amberAccent' },
    { label: 'GUN SONU',        value: kasaGun.gunSonuBakiyesi ?? 0,
      bg: 'tealXlight', txt: 'tealDark', acc: 'tealAccent' },
  ];

  kutular.forEach((k, i) => {
    const bx = M + i * (bW + 1);
    fc(pdf, k.bg);
    pdf.rect(bx, y, bW, bH, 'F');
    fc(pdf, k.acc);
    pdf.rect(bx, y, bW, 2, 'F');
    tc(pdf, k.txt);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6);
    pdf.text(k.label, bx + bW / 2, y + 8, { align: 'center' });
    const tutStr = para(k.value);
    pdf.setFontSize(tutStr.length > 12 ? 6.5 : 8);
    pdf.text(tutStr, bx + bW / 2, y + 15, { align: 'center' });
  });

  y += bH + 2;

  fc(pdf, 'tealXlight');
  pdf.rect(M, y, CW, 6, 'F');
  tc(pdf, 'tealDark');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6);
  const formul = `Acilis ${para(kasaGun.acilisBakiyesi ?? 0)}  +  Nakit ${para(kasaGun.nakitSatis ?? 0)}  -  Gider ${para(kasaGun.toplamGider ?? 0)}  -  Cikis ${para((kasaGun.cikisYapilanPara ?? 0) + (kasaGun.adminAlimlar ?? 0))}  =  Gun Sonu ${para(kasaGun.gunSonuBakiyesi ?? 0)}`;
  pdf.text(formul, W / 2, y + 4, { align: 'center' });
  y += 8;

  // ════════════════════════════════════════
  // 3. SATIŞ LİSTESİ
  // ════════════════════════════════════════
  if (satislar.length > 0) {
    y = baslik(pdf, `SATIS LISTESI  (${satislar.length} kayit - ${gunFmt(kasaGun.gun)})`, y, M, CW, 'g100', 'tealDark');

    // Sütun genişlikleri toplamı = 190mm
    // 10+22+36+22+20+20+22+16+22 = 190
    autoTable(pdf, {
      startY: y,
      margin: { left: M, right: M },
      tableWidth: CW,
      head: [['Saat', 'Satis Kodu', 'Musteri', 'Nakit', 'Kart', 'Havale', 'Toplam', 'Durum', 'Satici']],
      body: satislar.map(s => [
        saatFmt(s.tarih),
        tr(s.satisKodu   || '--'),
        tr(s.musteriIsim || '--'),
        s.nakitTutar  > 0 ? para(s.nakitTutar)  : '-',
        s.kartTutar   > 0 ? para(s.kartTutar)   : '-',
        s.havaleTutar > 0 ? para(s.havaleTutar) : '-',
        para(s.tutar),
        s.onayDurumu ? 'Onayli' : 'Bekliyor',
        tr(s.kullanici || '--'),
      ]),
      styles: {
        font: 'helvetica',
        fontSize: 6.5,
        cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
        overflow: 'ellipsize',
        lineColor: C.g200,
        lineWidth: 0.15,
        textColor: C.g800,
        valign: 'middle',
        minCellHeight: 0,
      },
      headStyles: {
        fillColor: C.teal,
        textColor: C.white,
        fontStyle: 'bold',
        fontSize: 6.5,
        halign: 'center',
        cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
      },
      alternateRowStyles: { fillColor: C.g50 },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 22, halign: 'center' },
        2: { cellWidth: 36 },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 20, halign: 'right' },
        5: { cellWidth: 20, halign: 'right' },
        6: { cellWidth: 22, halign: 'right' },
        7: { cellWidth: 16, halign: 'center' },
        8: { cellWidth: 22 },
      },
      didParseCell(data) {
        if (data.section !== 'body') return;
        if (data.column.index === 3 && data.cell.raw !== '-') {
          data.cell.styles.textColor = C.green;
          data.cell.styles.fontStyle = 'bold';
        }
        if (data.column.index === 6) {
          data.cell.styles.textColor = C.tealDark;
          data.cell.styles.fontStyle = 'bold';
        }
        if (data.column.index === 7) {
          data.cell.styles.textColor = data.cell.raw === 'Onayli' ? C.green : C.amber;
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    y = (pdf as any).lastAutoTable.finalY + 4;
  }

  // ════════════════════════════════════════
  // 4. TAHSİLATLAR
  // ════════════════════════════════════════
  if (tahsilatlar.length > 0) {
    y = baslik(pdf, `TAHSILATLAR - Onceki Gunlerden  (${tahsilatlar.length})`, y, M, CW, 'greenLight', 'green');

    // 18+22+40+22+20+20+26+22 = 190
    autoTable(pdf, {
      startY: y,
      margin: { left: M, right: M },
      tableWidth: CW,
      head: [['Satis Tar.', 'Satis Kodu', 'Musteri', 'Nakit', 'Kart', 'Havale', 'Tahsil', 'Satici']],
      body: tahsilatlar.map(s => [
        s.satisTarihi ? gunFmt(s.satisTarihi) : '--',
        tr(s.satisKodu   || '--'),
        tr(s.musteriIsim || '--'),
        s.nakitTutar  > 0 ? para(s.nakitTutar)  : '-',
        s.kartTutar   > 0 ? para(s.kartTutar)   : '-',
        s.havaleTutar > 0 ? para(s.havaleTutar) : '-',
        para(s.nakitTutar + s.kartTutar + s.havaleTutar),
        tr(s.kullanici || '--'),
      ]),
      styles: {
        font: 'helvetica',
        fontSize: 6.5,
        cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
        overflow: 'ellipsize',
        lineColor: C.g200,
        lineWidth: 0.15,
        textColor: C.g800,
        valign: 'middle',
        minCellHeight: 0,
      },
      headStyles: {
        fillColor: C.green,
        textColor: C.white,
        fontStyle: 'bold',
        fontSize: 6.5,
        halign: 'center',
        cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
      },
      alternateRowStyles: { fillColor: [240, 253, 244] as RGB },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center' },
        1: { cellWidth: 22, halign: 'center' },
        2: { cellWidth: 40 },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 20, halign: 'right' },
        5: { cellWidth: 20, halign: 'right' },
        6: { cellWidth: 26, halign: 'right' },
        7: { cellWidth: 22 },
      },
      didParseCell(data) {
        if (data.section !== 'body') return;
        if (data.column.index === 6) {
          data.cell.styles.textColor = C.tealDark;
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    y = (pdf as any).lastAutoTable.finalY + 4;
  }

  // ════════════════════════════════════════
  // 5. GİDER & ÇIKIŞ
  // ════════════════════════════════════════
  const giderler = (kasaGun.hareketler ?? []).filter(h =>
    [KasaHareketTipi.GIDER, KasaHareketTipi.CIKIS,
     KasaHareketTipi.ADMIN_ALIM, KasaHareketTipi.DIGER].includes(h.tip)
  );

  if (giderler.length > 0) {
    y = baslik(pdf, `GIDER & CIKIS HAREKETLERI  (${giderler.length})`, y, M, CW, 'redLight', 'red');

    // 10+24+24+52+26+20+34 = 190
    autoTable(pdf, {
      startY: y,
      margin: { left: M, right: M },
      tableWidth: CW,
      head: [['Saat', 'Tip', 'Tutar', 'Aciklama', 'Kime Verildi', 'Belge No', 'Kaydeden']],
      body: giderler.map(h => [
        tr(h.saat      || '--'),
        tr(h.tip       || '--'),
        para(h.tutar),
        tr(h.aciklama  || '--'),
        h.tip === KasaHareketTipi.ADMIN_ALIM ? tr(h.adminAd || '--') : '--',
        tr(h.belgeNo   || '--'),
        tr(h.kullanici || '--'),
      ]),
      styles: {
        font: 'helvetica',
        fontSize: 6.5,
        cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
        overflow: 'ellipsize',
        lineColor: C.g200,
        lineWidth: 0.15,
        textColor: C.g800,
        valign: 'middle',
        minCellHeight: 0,
      },
      headStyles: {
        fillColor: C.red,
        textColor: C.white,
        fontStyle: 'bold',
        fontSize: 6.5,
        halign: 'center',
        cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
      },
      alternateRowStyles: { fillColor: [255, 245, 245] as RGB },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 24 },
        2: { cellWidth: 24, halign: 'right' },
        3: { cellWidth: 52 },
        4: { cellWidth: 26 },
        5: { cellWidth: 20, halign: 'center' },
        6: { cellWidth: 34 },
      },
      didParseCell(data) {
        if (data.section !== 'body') return;
        if (data.column.index === 2) {
          data.cell.styles.textColor = C.red;
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    y = (pdf as any).lastAutoTable.finalY + 4;
  }

  // ════════════════════════════════════════
  // 6. ADMİN ÖZET
  // ════════════════════════════════════════
  const adminEntries = Object.entries(kasaGun.adminOzet || {}).filter(([, v]) => Number(v) > 0);
  if (adminEntries.length > 0) {
    y = baslik(pdf, 'ADMIN PARA ALIM OZETI', y, M, CW, 'purpleLight', 'purple');

    const aW = Math.min(50, (CW - (adminEntries.length - 1) * 3) / adminEntries.length);
    adminEntries.forEach(([ad, tutar], i) => {
      const bx = M + i * (aW + 3);
      fc(pdf, 'purpleLight');
      pdf.rect(bx, y, aW, 14, 'F');
      fc(pdf, 'purple');
      pdf.rect(bx, y, aW, 2, 'F');
      tc(pdf, 'purple');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.5);
      pdf.text(tr(ad), bx + aW / 2, y + 7.5, { align: 'center' });
      tc(pdf, 'red');
      pdf.setFontSize(8);
      pdf.text(para(Number(tutar)), bx + aW / 2, y + 12.5, { align: 'center' });
    });

    y += 17;
  }

  // ════════════════════════════════════════
  // 7. GÜN SONU + İMZA (yan yana)
  // ════════════════════════════════════════
  y += 2;

  const gunSonuW = CW * 0.45;
  const sigW     = (CW - gunSonuW - 4) / 2;
  const boxH     = 20;

  // Gün sonu kutusu
  fc(pdf, 'teal');
  pdf.rect(M, y, gunSonuW, boxH, 'F');
  fc(pdf, 'tealDark');
  pdf.rect(M, y + boxH - 4, gunSonuW, 4, 'F');
  tc(pdf, 'white');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.text('GUN SONU BAKIYESI', M + gunSonuW / 2, y + 7, { align: 'center' });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text(para(kasaGun.gunSonuBakiyesi ?? 0), M + gunSonuW / 2, y + 16, { align: 'center' });

  // Hazırlayan
  const h1x = M + gunSonuW + 4;
  fc(pdf, 'g50');
  pdf.rect(h1x, y, sigW, boxH, 'F');
  dc(pdf, 'g200');
  pdf.rect(h1x, y, sigW, boxH);
  fc(pdf, 'teal');
  pdf.rect(h1x, y, sigW, 2, 'F');
  tc(pdf, 'g500');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6);
  pdf.text('HAZIRLAYAN', h1x + sigW / 2, y + 6, { align: 'center' });
  tc(pdf, 'g800');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text(tr(kasaGun.acilisYapan || '--'), h1x + sigW / 2, y + 12, { align: 'center' });
  dc(pdf, 'g300');
  pdf.line(h1x + 6, y + 17, h1x + sigW - 6, y + 17);
  tc(pdf, 'g400');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6);
  pdf.text('imza', h1x + sigW / 2, y + 19.5, { align: 'center' });

  // Onaylayan
  const h2x = h1x + sigW + 2;
  fc(pdf, 'g50');
  pdf.rect(h2x, y, sigW, boxH, 'F');
  dc(pdf, 'g200');
  pdf.rect(h2x, y, sigW, boxH);
  fc(pdf, 'teal');
  pdf.rect(h2x, y, sigW, 2, 'F');
  tc(pdf, 'g500');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6);
  pdf.text('ONAYLAYAN', h2x + sigW / 2, y + 6, { align: 'center' });
  tc(pdf, 'g400');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.text('- - - - - - -', h2x + sigW / 2, y + 12, { align: 'center' });
  dc(pdf, 'g300');
  pdf.line(h2x + 6, y + 17, h2x + sigW - 6, y + 17);
  tc(pdf, 'g400');
  pdf.setFontSize(6);
  pdf.text('imza', h2x + sigW / 2, y + 19.5, { align: 'center' });

  // ════════════════════════════════════════
  // 8. FOOTER
  // ════════════════════════════════════════
  const totalPages = pdf.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    const PH = pdf.internal.pageSize.getHeight();
    fc(pdf, 'g100');
    pdf.rect(0, PH - 7, W, 7, 'F');
    dc(pdf, 'g200');
    pdf.line(0, PH - 7, W, PH - 7);
    tc(pdf, 'g500');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.text(`${tr(magazaAdi)}  -  Kasa Raporu  -  ${gunFmt(kasaGun.gun)}`, M, PH - 2.5);
    pdf.text(`Sayfa ${p} / ${totalPages}`, W - M, PH - 2.5, { align: 'right' });
  }

  pdf.save(`Kasa_Raporu_${kasaGun.gun}.pdf`);
};