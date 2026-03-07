import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs, doc, updateDoc, Timestamp, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, OdemeDurumu } from '../types/satis';
import { getSubeByKod, SUBELER, SubeKodu } from '../types/sube';
import Layout from '../components/Layout';
import * as XLSX from 'xlsx';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [satislar, setSatislar] = useState<SatisTeklifFormu[]>([]);
  const [filtreliSatislar, setFiltreliSatislar] = useState<SatisTeklifFormu[]>([]);
  const [loading, setLoading] = useState(true);
  const [guncellemeyorum, setGuncellemeyorum] = useState<string | null>(null);
  const [iptalOnayBekleyen, setIptalOnayBekleyen] = useState<string | null>(null);
  const [secilenSube, setSecilenSube] = useState<string>('');
  const [zararOlanlar, setZararOlanlar] = useState<string>('all');
  const [durum, setDurum] = useState<string>('all');
  const [teslimTarihi, setTeslimTarihi] = useState<string>('');
  const [acikHesap, setAcikHesap] = useState<string>('all');
  const [satisTarihiBaslangic, setSatisTarihiBaslangic] = useState<string>('');
  const [satisTarihiBitis, setSatisTarihiBitis] = useState<string>('');
  const [tarihAralikHatasi, setTarihAralikHatasi] = useState<string>('');
  const [aramaMetni, setAramaMetni] = useState<string>('');
  const [mevcutSubeler, setMevcutSubeler] = useState<string[]>([]);
  const [bugunAcik, setBugunAcik] = useState(true);
  const [yarinAcik, setYarinAcik] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [siralamaAlani, setSiralamaAlani] = useState<string | null>(null);
  const [siralamaYonu, setSiralamaYonu] = useState<'asc' | 'desc'>('asc');
  const itemsPerPage = 30;
  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

  useEffect(() => { if (!currentUser) { navigate('/login'); return; } fetchSatislar(); }, [currentUser]);
  useEffect(() => { filtreyiUygula(); }, [satislar, secilenSube, zararOlanlar, durum, teslimTarihi, acikHesap, satisTarihiBaslangic, satisTarihiBitis, aramaMetni]);
  useEffect(() => { setCurrentPage(1); }, [secilenSube, zararOlanlar, durum, teslimTarihi, acikHesap, satisTarihiBaslangic, satisTarihiBitis, aramaMetni]);
  useEffect(() => {
    if (satisTarihiBaslangic && satisTarihiBitis) {
      const b = new Date(satisTarihiBaslangic), bi = new Date(satisTarihiBitis);
      const fark = Math.ceil((bi.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
      if (bi < b) setTarihAralikHatasi('Bitiş tarihi başlangıçtan önce olamaz');
      else if (fark > 31) setTarihAralikHatasi(`Maksimum 31 gün seçilebilir (${fark} gün seçildi)`);
      else { setTarihAralikHatasi(''); fetchSatislar(satisTarihiBaslangic, satisTarihiBitis); }
    } else setTarihAralikHatasi('');
  }, [satisTarihiBaslangic, satisTarihiBitis]);

  const fetchSatislar = async (baslangic?: string, bitis?: string) => {
    try {
      setLoading(true);
      const satisListesi: SatisTeklifFormu[] = [];
      const subeSet = new Set<string>();

      let startDate: Date;
      let endDate: Date | null = null;

      if (baslangic && bitis) {
        startDate = new Date(baslangic);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(bitis);
        endDate.setHours(23, 59, 59, 999);
      } else {
        startDate = new Date();
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
      }

      const startTimestamp = Timestamp.fromDate(startDate);
      const endTimestamp = endDate ? Timestamp.fromDate(endDate) : null;

      const fetchSube = async (sube: typeof SUBELER[0]) => {
        try {
          let q;
          if (endTimestamp) {
            q = query(
              collection(db, `subeler/${sube.dbPath}/satislar`),
              where('olusturmaTarihi', '>=', startTimestamp),
              where('olusturmaTarihi', '<=', endTimestamp),
              orderBy('olusturmaTarihi', 'desc')
            );
          } else {
            q = query(
              collection(db, `subeler/${sube.dbPath}/satislar`),
              where('olusturmaTarihi', '>=', startTimestamp),
              orderBy('olusturmaTarihi', 'desc')
            );
          }
          const snap = await getDocs(q);
          snap.forEach(d => {
            satisListesi.push({ id: d.id, ...d.data(), subeKodu: sube.kod } as SatisTeklifFormu);
            subeSet.add(sube.kod);
          });
        } catch (err) {
          console.error(`${sube.ad} yüklenemedi:`, err);
        }
      };

      if (isAdmin) {
        await Promise.all(SUBELER.map(fetchSube));
      } else {
        const sube = getSubeByKod(currentUser!.subeKodu as SubeKodu);
        if (sube) await fetchSube(sube);
      }

      satisListesi.sort((a: any, b: any) => {
        const tA = a.olusturmaTarihi?.toDate ? a.olusturmaTarihi.toDate() : new Date(a.olusturmaTarihi || 0);
        const tB = b.olusturmaTarihi?.toDate ? b.olusturmaTarihi.toDate() : new Date(b.olusturmaTarihi || 0);
        return tB.getTime() - tA.getTime();
      });
      setMevcutSubeler(Array.from(subeSet));
      setSatislar(satisListesi);
    } catch (error) {
      console.error('Satışlar yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const dateToString = (date: any): string => { if (!date) return ''; if (date instanceof Timestamp) return date.toDate().toISOString().split('T')[0]; if (date instanceof Date) return date.toISOString().split('T')[0]; return ''; };
  const getAyBasiSonu = (): { ayBasi: Date; aySonu: Date } => { const n = new Date(); const ayBasi = new Date(n.getFullYear(), n.getMonth(), 1); ayBasi.setHours(0, 0, 0, 0); const aySonu = new Date(n.getFullYear(), n.getMonth() + 1, 0); aySonu.setHours(23, 59, 59, 999); return { ayBasi, aySonu }; };
  const toDateSafe = (d: any): Date => { if (!d) return new Date(0); if (d instanceof Timestamp) return d.toDate(); if (d instanceof Date) return d; return new Date(d); };

  const filtreyiUygula = () => {
    let sonuc = [...satislar];
    if (secilenSube) sonuc = sonuc.filter(s => s.subeKodu === secilenSube);
    if (zararOlanlar === 'zarar') sonuc = sonuc.filter(s => (s.zarar ?? 0) < 0);
    else if (zararOlanlar === 'kar') sonuc = sonuc.filter(s => (s.zarar ?? 0) >= 0);
    if (durum === 'approved') sonuc = sonuc.filter(s => s.onayDurumu === true && (s as any).satisDurumu !== 'IPTAL');
    else if (durum === 'pending') sonuc = sonuc.filter(s => s.onayDurumu === false && (s as any).satisDurumu !== 'IPTAL');
    else if (durum === 'iptal') { const { ayBasi, aySonu } = getAyBasiSonu(); sonuc = sonuc.filter(s => { if ((s as any).satisDurumu !== 'IPTAL') return false; const ip = (s as any).iptalTarihi || (s as any).guncellemeTarihi || s.tarih; const t = toDateSafe(ip); return t >= ayBasi && t <= aySonu; }); }
    if (teslimTarihi) sonuc = sonuc.filter(s => dateToString(s.teslimatTarihi) === teslimTarihi);
    if (acikHesap === 'acik') sonuc = sonuc.filter(s => s.odemeDurumu === OdemeDurumu.ACIK_HESAP);
    else if (acikHesap === 'kapali') sonuc = sonuc.filter(s => s.odemeDurumu === OdemeDurumu.ODENDI);
    if (satisTarihiBaslangic && satisTarihiBitis && !tarihAralikHatasi) { const b = new Date(satisTarihiBaslangic); b.setHours(0, 0, 0, 0); const bi = new Date(satisTarihiBitis); bi.setHours(23, 59, 59, 999); sonuc = sonuc.filter(s => { const t = toDateSafe(s.tarih); return t >= b && t <= bi; }); }
    else if (satisTarihiBaslangic && !satisTarihiBitis) { const b = new Date(satisTarihiBaslangic); b.setHours(0, 0, 0, 0); sonuc = sonuc.filter(s => { const t = toDateSafe(s.tarih); return t >= b; }); }
    if (aramaMetni) { const a = aramaMetni.toLowerCase(); sonuc = sonuc.filter(s => s.satisKodu?.toLowerCase().includes(a) || s.musteriBilgileri?.isim?.toLowerCase().includes(a)); }
    setFiltreliSatislar(sonuc);
  };

  const filtreleriSifirla = () => { setSecilenSube(''); setZararOlanlar('all'); setDurum('all'); setTeslimTarihi(''); setAcikHesap('all'); setSatisTarihiBaslangic(''); setSatisTarihiBitis(''); setTarihAralikHatasi(''); setAramaMetni(''); setSiralamaAlani(null); setSiralamaYonu('asc'); fetchSatislar(); };

  const iptalTalebiGonder = async (satis: SatisTeklifFormu) => {
    if (!satis.id) return; const sube = getSubeByKod(satis.subeKodu as SubeKodu); if (!sube) return;
    setGuncellemeyorum(satis.id);
    try { await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), { iptalTalebi: true, iptalTalepTarihi: new Date(), guncellemeTarihi: new Date() }); setSatislar(prev => prev.map(s => s.id === satis.id ? { ...s, iptalTalebi: true } as any : s)); }
    catch { alert('❌ İptal talebi gönderilemedi!'); }
    finally { setGuncellemeyorum(null); setIptalOnayBekleyen(null); }
  };

  const ozetVeriler = React.useMemo(() => {
    const aktif = satislar.filter(s => (s as any).satisDurumu !== 'IPTAL');
    const toplamCiro = aktif.reduce((a, s) => a + (s.toplamTutar || 0), 0);
    const acikHesaplar = aktif.filter(s => s.odemeDurumu === OdemeDurumu.ACIK_HESAP).length;
    const bekleyenOnaylar = aktif.filter(s => s.onayDurumu === false).length;
    const zararEdenler = aktif.filter(s => (s.zarar ?? 0) < 0).length;
    const toplamKar = aktif.reduce((a, s) => a + (s.zarar ?? 0), 0);
    const { ayBasi, aySonu } = getAyBasiSonu();
    const iptalSayisi = satislar.filter(s => { if ((s as any).satisDurumu !== 'IPTAL') return false; const ip = (s as any).iptalTarihi || (s as any).guncellemeTarihi || s.tarih; const t = toDateSafe(ip); return t >= ayBasi && t <= aySonu; }).length;
    return { toplamCiro, acikHesaplar, bekleyenOnaylar, zararEdenler, toplamKar, iptalSayisi };
  }, [satislar]);

  const alarmVeriler = React.useMemo(() => {
    const bugun = new Date(); bugun.setHours(0, 0, 0, 0); const yarin = new Date(bugun); yarin.setDate(yarin.getDate() + 1);
    const bugunSatislar = satislar.filter(s => { if ((s as any).satisDurumu === 'IPTAL') return false; const tarih = s.yeniTeslimatTarihi || s.teslimatTarihi; const t = toDateSafe(tarih); t.setHours(0, 0, 0, 0); return t.getTime() === bugun.getTime() && s.teslimEdildiMi !== true; });
    const yarinSatislar = satislar.filter(s => { if ((s as any).satisDurumu === 'IPTAL') return false; const tarih = s.yeniTeslimatTarihi || s.teslimatTarihi; const t = toDateSafe(tarih); t.setHours(0, 0, 0, 0); return t.getTime() === yarin.getTime() && s.teslimEdildiMi !== true; });
    return { bugunSatislar, yarinSatislar };
  }, [satislar]);

  // =============================================
  // YENİ EXCEL EXPORT
  // =============================================
  const excelExport = () => {
    const wb = XLSX.utils.book_new();
    const ws: any = {};

    // ── Maliyet hesaplama (SatisDetay ile aynı mantık) ──────────
    const maliyetHesapla = (s: SatisTeklifFormu): number => {
      const kampanyaToplami = (s as any).kampanyaToplami || 0;
      const yesilEtiketler: any[] = s.yesilEtiketler || [];

      if (yesilEtiketler.length === 0) {
        const alis = (s.urunler || []).reduce((t, u) => t + ((u as any).alisFiyatSnapshot ?? u.alisFiyati ?? 0) * u.adet, 0);
        const bip  = (s.urunler || []).reduce((t, u) => t + ((u as any).bipSnapshot ?? u.bip ?? 0) * u.adet, 0);
        return Math.max(0, alis - bip - kampanyaToplami);
      }

      const yesilKodlar = new Set(yesilEtiketler.map((e: any) => (e.urunKodu || '').trim().toLowerCase()));
      const normalAlis  = (s.urunler || []).filter(u => !yesilKodlar.has((u.kod || '').trim().toLowerCase())).reduce((t, u) => t + ((u as any).alisFiyatSnapshot ?? u.alisFiyati ?? 0) * u.adet, 0);
      const normalBip   = (s.urunler || []).filter(u => !yesilKodlar.has((u.kod || '').trim().toLowerCase())).reduce((t, u) => t + ((u as any).bipSnapshot ?? u.bip ?? 0) * u.adet, 0);
      const yesilOzel   = yesilEtiketler.reduce((t: number, e: any) => t + (e.tutar || 0), 0);
      return Math.max(0, (normalAlis - normalBip) + yesilOzel - kampanyaToplami);
    };

    // ── Ödeme tutarları ──────────────────────────────────────────
    const nakitHesapla = (s: SatisTeklifFormu): number => {
      const pesinatlar: any[] = (s as any).pesinatlar || [];
      if (pesinatlar.length > 0) return pesinatlar.reduce((t: number, p: any) => t + (p.tutar || 0), 0);
      return (s as any).pesinatToplam || s.pesinatTutar || 0;
    };

    const havaleHesapla = (s: SatisTeklifFormu): number => {
      const havaleler: any[] = (s as any).havaleler || [];
      if (havaleler.length > 0) return havaleler.reduce((t: number, h: any) => t + (h.tutar || 0), 0);
      return (s as any).havaleToplam || s.havaleTutar || 0;
    };

    const kartBrutHesapla = (s: SatisTeklifFormu): number => {
      if ((s as any).kartBrutToplam !== undefined) return (s as any).kartBrutToplam;
      return (s.kartOdemeler || []).reduce((t, k) => t + (k.tutar || 0), 0);
    };

    const kartKesintiHesapla = (s: SatisTeklifFormu): number => {
      if ((s as any).kartKesintiToplam !== undefined) return (s as any).kartKesintiToplam;
      return (s.kartOdemeler || []).reduce((t, k) => t + (k.tutar * (k.kesintiOrani || 0)) / 100, 0);
    };

    const hesabaGecenHesapla = (s: SatisTeklifFormu): number => {
      if ((s as any).hesabaGecenToplam !== undefined) return (s as any).hesabaGecenToplam;
      return nakitHesapla(s) + havaleHesapla(s) + kartBrutHesapla(s) - kartKesintiHesapla(s);
    };

    // ── Maksimum ürün sayısı (dinamik kolon) ────────────────────
    const maxUrun = Math.max(10, ...filtreliSatislar.map(s => (s.urunler || []).length));

    // ── Kolon indeksleri ─────────────────────────────────────────
    const C_TARIH    = 0;
    const C_KOD      = 1;
    const C_TEMSILCI = 2;
    const C_MUSTERI  = 3;
    const C_URUN0    = 4;
    const C_PRIM     = C_URUN0 + maxUrun;
    const C_KVKK     = C_PRIM + 1;
    const C_PRIM2    = C_PRIM + 2;
    const C_MALIYET  = C_PRIM + 3;
    const C_NAKIT    = C_PRIM + 4;
    const C_KREDI    = C_PRIM + 5;
    const C_ACIK     = C_PRIM + 6;
    const C_HAVALE   = C_PRIM + 7;
    const C_TOPLAM   = C_PRIM + 8;
    const C_HESABA   = C_PRIM + 9;
    const C_KAZANC   = C_PRIM + 10;
    const C_YUZDE    = C_PRIM + 11;
    const TOTAL_COLS = C_YUZDE + 1;

    // ── Hücre yazma yardımcısı ───────────────────────────────────
    const setCell = (r: number, c: number, v: any, style?: any) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      ws[addr] = { v, t: typeof v === 'number' ? 'n' : 's', ...(style ? { s: style } : {}) };
    };

    // TL formatı: 14.999 ₺ veya -7.500 ₺
    const TL_FMT = '#,##0 [$₺-41F];[RED]-#,##0 [$₺-41F]';
    const PCT_FMT = '0"%"';

    // ── Stil tanımları ───────────────────────────────────────────
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
      fill: { fgColor: { rgb: '1E7A6D' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    };
    const manuelHeaderStyle = {
      ...headerStyle,
      fill: { fgColor: { rgb: '4A90D9' }, patternType: 'solid' },
    };
    const numStyle = (fmt: string) => ({ numFmt: fmt, alignment: { horizontal: 'right' } });

    // Genel Toplam satırı: SARI arka plan, kalın yazı
    const gtBase = {
      font: { bold: true, sz: 11 },
      fill: { fgColor: { rgb: 'FFD700' }, patternType: 'solid' },
      alignment: { horizontal: 'right', vertical: 'center' },
    };
    const gtTL = { ...gtBase, numFmt: TL_FMT };
    const gtPct = { ...gtBase, numFmt: PCT_FMT, alignment: { horizontal: 'center', vertical: 'center' } };
    const gtText = { ...gtBase, alignment: { horizontal: 'left', vertical: 'center' } };
    const gtKazanc = (v: number) => ({
      ...gtTL,
      font: { bold: true, sz: 11, color: { rgb: v >= 0 ? '15803D' : 'DC2626' } },
    });

    // ── BAŞLIK SATIRI (satır 0) ──────────────────────────────────
    const basliklar: [number, string, boolean][] = [
      [C_TARIH,    'Tarih',              false],
      [C_KOD,      'Satış Kodu',         false],
      [C_TEMSILCI, 'Müşteri Temsilcisi', false],
      [C_MUSTERI,  'Müşteri Adı',        false],
      ...Array.from({ length: maxUrun }, (_, i) => [C_URUN0 + i, `Ürün ${i + 1}`, false] as [number, string, boolean]),
      [C_PRIM,    'Prim',       true],
      [C_KVKK,    'KVKK',      true],
      [C_PRIM2,   'Prim 2',    true],
      [C_MALIYET, 'Maliyet',   false],
      [C_NAKIT,   'Nakit',     false],
      [C_KREDI,   'Kredi Kartı', false],
      [C_ACIK,    'Açık Hesap', false],
      [C_HAVALE,  'Havale',    false],
      [C_TOPLAM,  'Toplam',    false],
      [C_HESABA,  'Hesaba Geçen', false],
      [C_KAZANC,  'Kazanç',    false],
      [C_YUZDE,   'Yüzde %',   false],
    ];

    basliklar.forEach(([col, label, isManuel]) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: col });
      ws[addr] = { v: label, t: 's', s: isManuel ? manuelHeaderStyle : headerStyle };
    });

    // ── VERİ SATIRLARI ───────────────────────────────────────────
    let topMaliyet = 0, topNakit = 0, topKredi = 0, topAcik = 0, topHavale = 0;
    let topToplam  = 0, topHesaba = 0, topKazanc = 0;

    filtreliSatislar.forEach((s, idx) => {
      const row = idx + 1;

      setCell(row, C_TARIH,    formatDate(s.tarih));
      setCell(row, C_KOD,      s.satisKodu || '');
      setCell(row, C_TEMSILCI, (s as any).musteriTemsilcisi || '');
      setCell(row, C_MUSTERI,  s.musteriBilgileri?.isim || '');

      // Ürünler — her ürün ayrı kolona
      (s.urunler || []).forEach((u, ui) => {
        if (ui >= maxUrun) return;
        const kod  = u.kod || '';
        const adet = u.adet || 1;
        setCell(row, C_URUN0 + ui, adet > 1 ? `${kod} x${adet}` : kod);
      });

      // Prim / KVKK / Prim2 → BOŞ (manuel doldurulacak)

      // Maliyet
      const maliyet = maliyetHesapla(s);
      if (maliyet) setCell(row, C_MALIYET, maliyet, numStyle(TL_FMT));
      topMaliyet += maliyet;

      // Nakit
      const nakit = nakitHesapla(s);
      if (nakit) setCell(row, C_NAKIT, nakit, numStyle(TL_FMT));
      topNakit += nakit;

      // Kredi Kartı (brüt)
      const kredi = kartBrutHesapla(s);
      if (kredi) setCell(row, C_KREDI, kredi, numStyle(TL_FMT));
      topKredi += kredi;

      // Açık Hesap
      const toplamOdenen = nakit + havaleHesapla(s) + kredi;
      const acik = Math.max(0, (s.toplamTutar || 0) - toplamOdenen);
      if (acik > 0) setCell(row, C_ACIK, acik, numStyle(TL_FMT));
      topAcik += acik;

      // Havale (sadece tutar)
      const havale = havaleHesapla(s);
      if (havale) setCell(row, C_HAVALE, havale, numStyle(TL_FMT));
      topHavale += havale;

      // Toplam
      const toplam = s.toplamTutar || 0;
      if (toplam) setCell(row, C_TOPLAM, toplam, numStyle(TL_FMT));
      topToplam += toplam;

      // Hesaba Geçen
      const hesaba = hesabaGecenHesapla(s);
      if (hesaba) setCell(row, C_HESABA, hesaba, numStyle(TL_FMT));
      topHesaba += hesaba;

      // Kazanç (sayısal, TL formatında, + yeşil - kırmızı)
      const kazanc = s.zarar ?? 0;
      setCell(row, C_KAZANC, kazanc, {
        numFmt: TL_FMT,
        alignment: { horizontal: 'right' },
        font: { color: { rgb: kazanc >= 0 ? '15803D' : 'DC2626' } },
      });
      topKazanc += kazanc;

      // Yüzde (sayı olarak, PCT_FMT ile gösterilir)
      const yuzde = maliyet > 0 ? Math.round((kazanc / maliyet) * 100) : 0;
      setCell(row, C_YUZDE, yuzde, numStyle(PCT_FMT));
    });

    // ── GENEL TOPLAM SATIRI (SARI, KALIN) ───────────────────────
    const gRow = filtreliSatislar.length + 1;

    setCell(gRow, C_TARIH,   'GENEL TOPLAM', gtText);
    setCell(gRow, C_MALIYET, topMaliyet, gtTL);
    setCell(gRow, C_NAKIT,   topNakit,   gtTL);
    setCell(gRow, C_KREDI,   topKredi,   gtTL);
    setCell(gRow, C_ACIK,    topAcik,    gtTL);
    setCell(gRow, C_HAVALE,  topHavale,  gtTL);
    setCell(gRow, C_TOPLAM,  topToplam,  gtTL);
    setCell(gRow, C_HESABA,  topHesaba,  gtTL);
    setCell(gRow, C_KAZANC,  topKazanc,  gtKazanc(topKazanc));

    // Genel karlılık: toplam kazanç / toplam ciro * 100
    const genelYuzde = topToplam > 0 ? Math.round((topKazanc / topToplam) * 100) : 0;
    setCell(gRow, C_YUZDE, genelYuzde, gtPct);

    // ── Çalışma alanı tanımı ─────────────────────────────────────
    ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: gRow, c: TOTAL_COLS - 1 });

    // ── Kolon genişlikleri ───────────────────────────────────────
    ws['!cols'] = [
      { wch: 12 }, // Tarih
      { wch: 14 }, // Satış Kodu
      { wch: 22 }, // Müşteri Temsilcisi
      { wch: 22 }, // Müşteri Adı
      ...Array.from({ length: maxUrun }, () => ({ wch: 16 })),
      { wch: 8  }, // Prim
      { wch: 8  }, // KVKK
      { wch: 8  }, // Prim 2
      { wch: 14 }, // Maliyet
      { wch: 14 }, // Nakit
      { wch: 14 }, // Kredi Kartı
      { wch: 14 }, // Açık Hesap
      { wch: 14 }, // Havale
      { wch: 14 }, // Toplam
      { wch: 14 }, // Hesaba Geçen
      { wch: 13 }, // Kazanç
      { wch: 10 }, // Yüzde
    ];

    ws['!rows'] = [{ hpt: 28 }];

    XLSX.utils.book_append_sheet(wb, ws, 'Satışlar');
    XLSX.writeFile(wb, `Satislar_${new Date().toLocaleDateString('tr-TR').replace(/\./g, '-')}.xlsx`);
  };

  // =============================================
  // SIRALAMA
  // =============================================
  const siralamaToggle = (alan: string) => {
    if (siralamaAlani === alan) {
      setSiralamaYonu(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSiralamaAlani(alan);
      setSiralamaYonu('asc');
    }
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(filtreliSatislar.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentSatislar = filtreliSatislar.slice(startIndex, startIndex + itemsPerPage);

  const siralanmisSatislar = React.useMemo(() => {
    if (!siralamaAlani) return currentSatislar;
    return [...currentSatislar].sort((a: any, b: any) => {
      let valA: any, valB: any;
      switch (siralamaAlani) {
        case 'kar':
          valA = a.zarar ?? 0; valB = b.zarar ?? 0; break;
        case 'sube':
          valA = getSubeByKod(a.subeKodu as SubeKodu)?.ad || '';
          valB = getSubeByKod(b.subeKodu as SubeKodu)?.ad || ''; break;
        case 'tarih':
          valA = toDateSafe(a.tarih).getTime();
          valB = toDateSafe(b.tarih).getTime(); break;
        case 'tutar':
          valA = a.toplamTutar || 0; valB = b.toplamTutar || 0; break;
        case 'teslimat':
          valA = toDateSafe(a.yeniTeslimatTarihi || a.teslimatTarihi).getTime();
          valB = toDateSafe(b.yeniTeslimatTarihi || b.teslimatTarihi).getTime(); break;
        default: return 0;
      }
      if (typeof valA === 'string') {
        return siralamaYonu === 'asc' ? valA.localeCompare(valB, 'tr') : valB.localeCompare(valA, 'tr');
      }
      if (valA < valB) return siralamaYonu === 'asc' ? -1 : 1;
      if (valA > valB) return siralamaYonu === 'asc' ? 1 : -1;
      return 0;
    });
  }, [currentSatislar, siralamaAlani, siralamaYonu]);

  // =============================================
  // SIRALAMA BAŞLIK COMPONENT
  // =============================================
  const SiralamaBaslik = ({ alan, label }: { alan: string; label: string }) => {
    const aktif = siralamaAlani === alan;
    return (
      <th
        onClick={() => siralamaToggle(alan)}
        className={`sortable-th ${aktif ? 'sortable-th--aktif' : ''}`}
      >
        <span className="sortable-th-icerik">
          {label}
          <span className={`sort-icon ${aktif ? 'sort-icon--aktif' : ''}`}>
            {aktif
              ? (siralamaYonu === 'asc' ? '▲' : '▼')
              : '⬍'}
          </span>
        </span>
      </th>
    );
  };

  const goToPage = (page: number) => { setCurrentPage(page); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const renderPagination = () => {
    if (totalPages <= 1) return null;
    const pages: React.ReactNode[] = [];
    const maxV = 5;
    let sP = Math.max(1, currentPage - Math.floor(maxV / 2));
    let eP = Math.min(totalPages, sP + maxV - 1);
    if (eP - sP + 1 < maxV) sP = Math.max(1, eP - maxV + 1);
    pages.push(<button key="prev" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="pagination-btn pagination-arrow">← Önceki</button>);
    if (sP > 1) { pages.push(<button key={1} onClick={() => goToPage(1)} className="pagination-btn">1</button>); if (sP > 2) pages.push(<span key="d1" className="pagination-dots">...</span>); }
    for (let i = sP; i <= eP; i++) pages.push(<button key={i} onClick={() => goToPage(i)} className={`pagination-btn ${currentPage === i ? 'active' : ''}`}>{i}</button>);
    if (eP < totalPages) { if (eP < totalPages - 1) pages.push(<span key="d2" className="pagination-dots">...</span>); pages.push(<button key={totalPages} onClick={() => goToPage(totalPages)} className="pagination-btn">{totalPages}</button>); }
    pages.push(<button key="next" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="pagination-btn pagination-arrow">Sonraki →</button>);
    return <div className="pagination-container">{pages}</div>;
  };

  const onayDurumuToggle = async (satis: SatisTeklifFormu) => {
    if (!isAdmin || !satis.id) return; const sube = getSubeByKod(satis.subeKodu as SubeKodu); if (!sube) return;
    setGuncellemeyorum(satis.id);
    try { const y = !satis.onayDurumu; await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), { onayDurumu: y, satisDurumu: y ? 'ONAYLI' : 'BEKLEMEDE', guncellemeTarihi: new Date() }); setSatislar(prev => prev.map(s => s.id === satis.id ? { ...s, onayDurumu: y } : s)); }
    catch { alert('❌ Güncelleme başarısız!'); } finally { setGuncellemeyorum(null); }
  };

  const odemeDurumunuHesapla = (satis: SatisTeklifFormu): boolean => { const tt = (satis as any).toplamTutar || 0; if (tt <= 0) return false; const to = (satis as any).toplamOdenen || ((satis as any).pesinatTutar || 0) + ((satis as any).havaleTutar || 0) + ((satis.kartOdemeler || []).reduce((s: number, k: any) => s + (k.tutar || 0), 0)); return to >= tt; };
  const formatPrice = (price: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);
  const formatDate = (date: any) => { if (!date) return ''; try { if (date instanceof Timestamp) return date.toDate().toLocaleDateString('tr-TR'); if (date instanceof Date) return date.toLocaleDateString('tr-TR'); return new Date(date).toLocaleDateString('tr-TR'); } catch { return ''; } };
  const mevcutAyAdi = new Date().toLocaleString('tr-TR', { month: 'long', year: 'numeric' });
  const excelBtn = (<button onClick={excelExport} className="dash-btn-excel"><i className="fas fa-file-excel"></i> Excel</button>);

  return (
    <Layout pageTitle="Satış Listesi" headerExtra={excelBtn}>
      {!loading && (<>
        {alarmVeriler.bugunSatislar.length > 0 && (<div className="alarm-banner bugun"><div className="alarm-baslik" onClick={() => setBugunAcik(p => !p)}><div className="alarm-baslik-sol"><i className="fas fa-exclamation-circle"></i><strong>Bugün Teslim Edilmesi Gerekenler</strong><span className="alarm-badge">{alarmVeriler.bugunSatislar.length} satış</span></div><i className={`fas fa-chevron-down alarm-toggle-icon ${bugunAcik ? 'acik' : ''}`}></i></div>
          {bugunAcik && (<div className="alarm-liste">{alarmVeriler.bugunSatislar.map(s => (<div key={s.id} className="alarm-satir"><div className="alarm-satir-sol"><span className="alarm-satis-kodu">{s.satisKodu}</span><span className="alarm-musteri">{s.musteriBilgileri?.isim || '-'}</span><span className="alarm-sube">{getSubeByKod(s.subeKodu as SubeKodu)?.ad}</span></div><div className="alarm-satir-sag"><span className="alarm-tutar">{formatPrice(s.toplamTutar)}</span><button className="alarm-detay-btn" onClick={() => navigate(`/satis-detay/${s.subeKodu}/${s.id}`)}>Görüntüle</button></div></div>))}</div>)}</div>)}
        {alarmVeriler.yarinSatislar.length > 0 && (<div className="alarm-banner yarin"><div className="alarm-baslik" onClick={() => setYarinAcik(p => !p)}><div className="alarm-baslik-sol"><i className="fas fa-clock"></i><strong>Yarın Teslim Edilmesi Gerekenler</strong><span className="alarm-badge">{alarmVeriler.yarinSatislar.length} satış</span></div><i className={`fas fa-chevron-down alarm-toggle-icon ${yarinAcik ? 'acik' : ''}`}></i></div>
          {yarinAcik && (<div className="alarm-liste">{alarmVeriler.yarinSatislar.map(s => (<div key={s.id} className="alarm-satir"><div className="alarm-satir-sol"><span className="alarm-satis-kodu">{s.satisKodu}</span><span className="alarm-musteri">{s.musteriBilgileri?.isim || '-'}</span><span className="alarm-sube">{getSubeByKod(s.subeKodu as SubeKodu)?.ad}</span></div><div className="alarm-satir-sag"><span className="alarm-tutar">{formatPrice(s.toplamTutar)}</span><button className="alarm-detay-btn" onClick={() => navigate(`/satis-detay/${s.subeKodu}/${s.id}`)}>Görüntüle</button></div></div>))}</div>)}</div>)}
      </>)}

      {!loading && (
        <div className="ozet-kartlar">
          <div className="ozet-kart ozet-ciro"><div className="ozet-kart-ikon"><i className="fas fa-lira-sign"></i></div><div className="ozet-kart-bilgi"><span className="ozet-kart-baslik">TOPLAM CİRO</span><span className="ozet-kart-deger">{formatPrice(ozetVeriler.toplamCiro)}</span></div></div>
          <div className="ozet-kart ozet-kar"><div className="ozet-kart-ikon"><i className="fas fa-chart-line"></i></div><div className="ozet-kart-bilgi"><span className="ozet-kart-baslik">NET KAR</span><span className={`ozet-kart-deger ${ozetVeriler.toplamKar < 0 ? 'negatif' : ''}`}>{ozetVeriler.toplamKar >= 0 ? '+' : ''}{formatPrice(ozetVeriler.toplamKar)}</span></div></div>
          <div className="ozet-kart ozet-acik"><div className="ozet-kart-ikon"><i className="fas fa-file-invoice-dollar"></i></div><div className="ozet-kart-bilgi"><span className="ozet-kart-baslik">AÇIK HESAP</span><span className="ozet-kart-deger">{ozetVeriler.acikHesaplar} satış</span></div></div>
          <div className="ozet-kart ozet-bekleyen"><div className="ozet-kart-ikon"><i className="fas fa-hourglass-half"></i></div><div className="ozet-kart-bilgi"><span className="ozet-kart-baslik">BEKLEYEN ONAY</span><span className="ozet-kart-deger">{ozetVeriler.bekleyenOnaylar} satış</span></div></div>
          <div className="ozet-kart ozet-zarar"><div className="ozet-kart-ikon"><i className="fas fa-exclamation-triangle"></i></div><div className="ozet-kart-bilgi"><span className="ozet-kart-baslik">ZARAR EDEN</span><span className="ozet-kart-deger">{ozetVeriler.zararEdenler} satış</span></div></div>
          {ozetVeriler.iptalSayisi > 0 && (<div className="ozet-kart ozet-iptal" onClick={() => setDurum('iptal')} style={{ cursor: 'pointer' }}><div className="ozet-kart-ikon"><i className="fas fa-ban"></i></div><div className="ozet-kart-bilgi"><span className="ozet-kart-baslik">İPTAL ({mevcutAyAdi})</span><span className="ozet-kart-deger">{ozetVeriler.iptalSayisi} satış</span></div></div>)}
        </div>
      )}

      <div className="filtre-container">
        <div className="filtre-item"><label>ŞUBE</label><select value={secilenSube} onChange={e => setSecilenSube(e.target.value)} className="filtre-select"><option value="">Tüm Şubeler ({mevcutSubeler.length})</option>{mevcutSubeler.map(kod => { const sube = getSubeByKod(kod as SubeKodu); return sube ? <option key={kod} value={kod}>{sube.ad}</option> : null; })}</select></div>
        <div className="filtre-item"><label>KAR/ZARAR</label><select value={zararOlanlar} onChange={e => setZararOlanlar(e.target.value)} className="filtre-select"><option value="all">Tümü</option><option value="zarar">Sadece Zararlı</option><option value="kar">Sadece Karlı</option></select></div>
        <div className="filtre-item"><label>DURUM</label><select value={durum} onChange={e => setDurum(e.target.value)} className="filtre-select"><option value="all">Tümü</option><option value="approved">Onaylı</option><option value="pending">Beklemede</option><option value="iptal">🚫 İptal (Bu Ay)</option></select></div>
        <div className="filtre-item"><label>TESLİM TARİHİ</label><input type="date" value={teslimTarihi} onChange={e => setTeslimTarihi(e.target.value)} className="filtre-input" /></div>
        <div className="filtre-item"><label>AÇIK HESAP</label><select value={acikHesap} onChange={e => setAcikHesap(e.target.value)} className="filtre-select"><option value="all">Tümü</option><option value="acik">Açık Hesaplar</option><option value="kapali">Kapalı Hesaplar</option></select></div>
        <div className="filtre-item"><label>SATIŞ TARİHİ (BAŞLANGIÇ)</label><input type="date" value={satisTarihiBaslangic} onChange={e => setSatisTarihiBaslangic(e.target.value)} className="filtre-input" /></div>
        <div className="filtre-item"><label>SATIŞ TARİHİ (BİTİŞ)</label><input type="date" value={satisTarihiBitis} onChange={e => setSatisTarihiBitis(e.target.value)} className={`filtre-input ${tarihAralikHatasi ? 'filtre-input--hata' : ''}`} min={satisTarihiBaslangic || undefined} />{tarihAralikHatasi && <span className="filtre-hata-mesaji">⚠️ {tarihAralikHatasi}</span>}</div>
        <div className="filtre-item filtre-item--wide"><label>SATIŞ KODU / MÜŞTERİ</label><div className="search-container"><input type="text" placeholder="Satış kodu veya müşteri adı..." value={aramaMetni} onChange={e => setAramaMetni(e.target.value)} className="search-input" /><button className="search-btn" onClick={filtreyiUygula}><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></button></div></div>
        <div className="filtre-item filtre-item--actions"><label>&nbsp;</label><button onClick={filtreleriSifirla} className="btn-sifirla"><i className="fas fa-undo"></i> Sıfırla</button></div>
      </div>

      <div className="sonuc-bilgi">
        <p>
          Toplam <strong>{filtreliSatislar.length}</strong> satış
          {durum === 'iptal' && <span> · Sadece {mevcutAyAdi} iptalleri</span>}
          {satisTarihiBaslangic && satisTarihiBitis && !tarihAralikHatasi && (<span> · {new Date(satisTarihiBaslangic).toLocaleDateString('tr-TR')} — {new Date(satisTarihiBitis).toLocaleDateString('tr-TR')}</span>)}
          {totalPages > 1 && <span> · Sayfa {currentPage}/{totalPages}</span>}
          {siralamaAlani && (
            <span className="siralama-bilgi">
              · Sıralama: <strong>{
                siralamaAlani === 'kar' ? 'Kar/Zarar' :
                siralamaAlani === 'sube' ? 'Şube' :
                siralamaAlani === 'tarih' ? 'Tarih' :
                siralamaAlani === 'tutar' ? 'Tutar' :
                siralamaAlani === 'teslimat' ? 'Teslimat' : siralamaAlani
              }</strong> {siralamaYonu === 'asc' ? '▲' : '▼'}
              <button className="siralama-temizle-btn" onClick={() => { setSiralamaAlani(null); setSiralamaYonu('asc'); }}>✕</button>
            </span>
          )}
        </p>
      </div>

      {loading ? (<div className="loading">Yükleniyor...</div>) : filtreliSatislar.length === 0 ? (
        <div className="empty-state"><p>Filtreye uygun satış kaydı bulunmuyor.</p><button onClick={() => navigate('/satis-teklif')} className="btn-primary">YENİ SATIŞ TEKLİFİ OLUŞTUR</button></div>
      ) : (<>
        <div className="sales-table-container">
          <table className="sales-table">
            <thead>
              <tr>
                <th>SATIŞ KODU</th>
                <SiralamaBaslik alan="sube"     label="ŞUBE" />
                <th>MÜŞTERİ</th>
                <SiralamaBaslik alan="tutar"    label="TUTAR" />
                <SiralamaBaslik alan="kar"      label="KAR/ZARAR" />
                <SiralamaBaslik alan="tarih"    label="TARİH" />
                <SiralamaBaslik alan="teslimat" label="TESLİMAT" />
                <th>DURUM</th>
                <th>ÖDEME</th>
                <th>İŞLEMLER</th>
              </tr>
            </thead>
            <tbody>
              {siralanmisSatislar.map(satis => {
                const kar = satis.zarar ?? 0;
                const isOnaylandi = satis.onayDurumu === true;
                const isOdendi = odemeDurumunuHesapla(satis);
                const onayYukleniyor = guncellemeyorum === satis.id;
                const isIptal = (satis as any).satisDurumu === 'IPTAL';
                const iptalTalebiVar = (satis as any).iptalTalebi === true;

                const onayliVeNormalUser = !isAdmin && isOnaylandi && !isIptal;
                const duzenleGorunur = isAdmin || (!isIptal && !onayliVeNormalUser);

                return (
                  <tr key={satis.id} className={isIptal ? 'satir-iptal' : ''}>
                    <td>
                      <strong>{satis.satisKodu}</strong>
                      {isIptal && <span className="iptal-etiket">İPTAL</span>}
                      {iptalTalebiVar && !isIptal && <span className="iptal-talep-etiket">İPTAL TALEBİ</span>}
                    </td>
                    <td>{getSubeByKod(satis.subeKodu as SubeKodu)?.ad}</td>
                    <td>{satis.musteriBilgileri?.isim || '-'}</td>
                    <td><strong>{formatPrice(satis.toplamTutar)}</strong></td>
                    <td><span className={`kar-zarar-badge ${kar >= 0 ? 'kar' : 'zarar'}`}>{kar >= 0 ? '+' : ''}{formatPrice(kar)}</span></td>
                    <td>{formatDate(satis.tarih)}</td>
                    <td>{satis.yeniTeslimatTarihi ? formatDate(satis.yeniTeslimatTarihi) : formatDate(satis.teslimatTarihi)}</td>
                    <td>
                      {isIptal ? (<span className="status-badge iptal">🚫 İPTAL</span>)
                        : isAdmin ? (<button className={`status-badge clickable ${isOnaylandi ? 'approved' : 'pending'}`} onClick={() => onayDurumuToggle(satis)} disabled={onayYukleniyor}>{onayYukleniyor ? '...' : isOnaylandi ? 'ONAYLI' : 'BEKLEMEDE'}</button>)
                        : (<span className={`status-badge ${isOnaylandi ? 'approved' : 'pending'}`}>{isOnaylandi ? 'ONAYLI' : 'BEKLEMEDE'}</span>)}
                    </td>
                    <td><span className={`status-badge ${isOdendi ? 'odendi' : 'acik-hesap'}`}>{isOdendi ? 'ÖDENDİ' : 'AÇIK HESAP'}</span></td>
                    <td>
                      <div className="action-buttons">
                        <button onClick={() => navigate(`/satis-detay/${satis.subeKodu}/${satis.id}`)} className="btn-view" title="Detay Görüntüle">👁️</button>
                        {duzenleGorunur && (
                          <button onClick={() => navigate(`/satis-duzenle/${satis.subeKodu}/${satis.id}`)} className="btn-edit" title="Düzenle">✏️</button>
                        )}
                        {onayliVeNormalUser && (
                          <span title="Onaylı satışlar düzenlenemez" style={{ width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', color: '#9ca3af', fontSize: 15, cursor: 'not-allowed', border: '1px solid #e5e7eb' }}>🔒</span>
                        )}
                        {!isAdmin && !isIptal && !iptalTalebiVar && (
                          iptalOnayBekleyen === satis.id ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                              <span style={{ color: '#6b7280' }}>İptal?</span>
                              <button style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }} onClick={() => iptalTalebiGonder(satis)} disabled={onayYukleniyor}>{onayYukleniyor ? '...' : 'Evet'}</button>
                              <button style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }} onClick={() => setIptalOnayBekleyen(null)}>Hayır</button>
                            </span>
                          ) : (
                            <button className="btn-iptal-talep" title="İptal Talebi Gönder" onClick={() => setIptalOnayBekleyen(satis.id!)}>🚫</button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      </>)}
    </Layout>
  );
};

export default Dashboard;