// ===================================================
//  KASA.TSX — v3 (TÜM İSTEKLER)
//  0) Her şey şube bazlı
//  1) Gün içi hareketlerde Çıkış kaldırıldı
//  2) Kasa çıktısı → print preview (stok dahil)
//  3) Geçmiş kayıtlar: tarih aralığı + pagination
//  4) Font sadeleşti
//  5) Gelen/Çıkan Ürün + Mağaza Stoğu paneli (devir daim)
//  6) Tahsilatlar → created_at = today
//  7) Satış iptali → negatif tahsilat
//  8) Admin → tüm şubeleri görebilir (şube seçici)
// ===================================================

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  KasaGun, KasaHareketTipi,
  kasayaYansiyor, kasaYonu, ADMIN_LISTESI,
} from '../types/kasa';
import {
  getBugununKasaGunu, kasaHareketEkle, getKasaGecmisi,
  getSatislar, getTahsilatlar,
  KasaSatisOzet, KasaTahsilatOzet, KasaSatisDetay,
} from '../services/kasaService';
import { db } from '../firebase/config';
import {
  collection, addDoc, getDocs, query,
  where, doc, setDoc, getDoc, Timestamp, runTransaction,
} from 'firebase/firestore';
import { getSubeByKod, SUBELER } from '../types/sube';
import './Kasa.css';

// ─── Tipler ──────────────────────────────────────────────────────────────────

type AktifTab = 'hareketler' | 'satislar' | 'tahsilatlar' | 'cikis' | 'urun';

const MANUEL_TIPLER: KasaHareketTipi[] = [
  KasaHareketTipi.GIDER,
  KasaHareketTipi.DIGER,
];

type StokTip = 'GELEN' | 'CIKAN';

interface StokHareket {
  id?: string;
  tip: StokTip;
  urunKodu: string;
  urunAdi: string | null;
  adet: number;
  musteriVeyaSatisKodu: string | null;
  not: string | null;
  tarih: Date;
  gun: string;
  kullanici: string;
  subeKodu: string;
}

// Kalıcı stok kaydı (devir daim)
interface MagazaStokKaydi {
  urunKodu: string;
  urunAdi: string;
  adet: number;
  sonGuncelleme: Date;
  subeKodu: string;
}

interface GecmisTarihFiltre { baslangic: string; bitis: string; }

interface GecmisDetay {
  kasaGun: KasaGun;
  satisOzet: KasaSatisOzet | null;
  tahsilatOzet: KasaTahsilatOzet | null;
  aktifTab: 'satislar' | 'tahsilatlar' | 'hareketler';
}

const SAYFA_BOYUTU = 15;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const bugunStrLocal = (): string => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const formatPrice = (p: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(p);

const formatGun = (gun: string) => {
  const [y, m, d] = gun.split('-');
  return `${d}.${m}.${y}`;
};

const formatSaat = (tarih: Date) =>
  `${String(tarih.getHours()).padStart(2, '0')}:${String(tarih.getMinutes()).padStart(2, '0')}`;

const getTipIcon = (tip: KasaHareketTipi): string =>
  ({
    [KasaHareketTipi.NAKIT_SATIS]: '💵',
    [KasaHareketTipi.KART]:        '💳',
    [KasaHareketTipi.HAVALE]:      '🏦',
    [KasaHareketTipi.GIDER]:       '💸',
    [KasaHareketTipi.CIKIS]:       '📤',
    [KasaHareketTipi.ADMIN_ALIM]:  '👤',
    [KasaHareketTipi.DIGER]:       '📝',
  }[tip] ?? '•');

const getTipClass = (tip: KasaHareketTipi): string =>
  ({
    [KasaHareketTipi.NAKIT_SATIS]: 'nakit',
    [KasaHareketTipi.KART]:        'kart',
    [KasaHareketTipi.HAVALE]:      'havale',
    [KasaHareketTipi.GIDER]:       'gider',
    [KasaHareketTipi.CIKIS]:       'cikis',
    [KasaHareketTipi.ADMIN_ALIM]:  'admin',
    [KasaHareketTipi.DIGER]:       'diger',
  }[tip] ?? '');

// ─── Print Preview ────────────────────────────────────────────────────────────

const kasaPrintPreviewYap = (params: {
  kasaGun: KasaGun;
  satislar: KasaSatisDetay[];
  tahsilatlar: KasaSatisDetay[];
  magazaStok: MagazaStokKaydi[];
  magazaAdi: string;
  subeAdi: string;
}) => {
  const { kasaGun, satislar, tahsilatlar, magazaStok, magazaAdi, subeAdi } = params;
  const tarih = formatGun(kasaGun.gun);

  const fTL = (n: number) =>
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(n);

  const toplamNakit = satislar.reduce((t, s) => t + (s.nakitTutar || 0), 0)
    + tahsilatlar.reduce((t, s) => t + (s.nakitTutar || 0), 0);
  const toplamKart = satislar.reduce((t, s) => t + (s.kartTutar || 0), 0)
    + tahsilatlar.reduce((t, s) => t + (s.kartTutar || 0), 0);
  const toplamHavale = satislar.reduce((t, s) => t + (s.havaleTutar || 0), 0)
    + tahsilatlar.reduce((t, s) => t + (s.havaleTutar || 0), 0);

  const satisRows = satislar.map(s => `
    <tr>
      <td>${formatSaat(s.tarih)}</td><td>${s.satisKodu}</td><td>${s.musteriIsim}</td>
      <td>${s.nakitTutar > 0 ? fTL(s.nakitTutar) : '—'}</td>
      <td>${s.kartTutar > 0 ? fTL(s.kartTutar) : '—'}</td>
      <td>${s.havaleTutar > 0 ? fTL(s.havaleTutar) : '—'}</td>
      <td><strong>${fTL(s.tutar)}</strong></td>
    </tr>`).join('');

  const tahsilatRows = tahsilatlar.map(s => `
    <tr>
      <td>${s.satisTarihi ? formatGun(s.satisTarihi) : '—'}</td><td>${s.satisKodu}</td><td>${s.musteriIsim}</td>
      <td>${s.nakitTutar !== 0 ? fTL(s.nakitTutar) : '—'}</td>
      <td>${s.kartTutar !== 0 ? fTL(s.kartTutar) : '—'}</td>
      <td>${s.havaleTutar !== 0 ? fTL(s.havaleTutar) : '—'}</td>
      <td><strong>${fTL(s.nakitTutar + s.kartTutar + s.havaleTutar)}</strong></td>
    </tr>`).join('');

  const stokRows = magazaStok.map(s => `
    <tr>
      <td><strong>${s.urunKodu}</strong></td>
      <td>${s.urunAdi || '—'}</td>
      <td style="font-weight:700; color: ${s.adet > 0 ? '#16a34a' : '#dc2626'}">${s.adet} adet</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8"/>
  <title>Kasa Çıktısı — ${subeAdi} — ${tarih}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'IBM Plex Sans',sans-serif;font-size:12px;color:#202124;padding:16mm;background:white}
    h1{font-size:17px;font-weight:700;margin-bottom:2px}
    .meta{color:#5f6368;font-size:11px;margin-bottom:14px}
    .ozet{display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap}
    .ozet-kart{border:1.5px solid #e0e0e0;border-radius:6px;padding:9px 13px;min-width:110px}
    .ozet-kart label{display:block;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.8px;margin-bottom:3px}
    .ozet-kart strong{font-family:'IBM Plex Mono',monospace;font-size:13px;color:#202124}
    .ozet-kart.toplam{border-color:#009999}
    .ozet-kart.toplam strong{color:#009999}
    h2{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#5f6368;margin:14px 0 6px;border-bottom:1px solid #e0e0e0;padding-bottom:5px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th{background:#f5f5f5;padding:5px 7px;text-align:left;font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid #e0e0e0}
    td{padding:5px 7px;border-bottom:1px solid #f0f0f0;vertical-align:middle}
    td strong{font-family:'IBM Plex Mono',monospace}
    .footer{margin-top:16px;padding-top:10px;border-top:1px solid #e0e0e0;font-size:10px;color:#aaa;text-align:right}
    @media print{body{padding:8mm 10mm}}
  </style>
</head>
<body>
  <h1>🏪 ${magazaAdi} — Kasa Raporu</h1>
  <div class="meta">📍 Şube: ${subeAdi} &nbsp;|&nbsp; 📅 Tarih: ${tarih}</div>

  <div class="ozet">
    <div class="ozet-kart"><label>Açılış Bakiyesi</label><strong>${fTL(kasaGun.acilisBakiyesi)}</strong></div>
    <div class="ozet-kart"><label>💵 Nakit Tahsilat</label><strong style="color:#16a34a">${fTL(toplamNakit)}</strong></div>
    <div class="ozet-kart"><label>💳 Kart Tahsilat</label><strong style="color:#0066cc">${fTL(toplamKart)}</strong></div>
    <div class="ozet-kart"><label>🏦 Havale Tahsilat</label><strong style="color:#5f6368">${fTL(toplamHavale)}</strong></div>
    <div class="ozet-kart"><label>💸 Giderler</label><strong style="color:#dc2626">${fTL(kasaGun.toplamGider || 0)}</strong></div>
    <div class="ozet-kart"><label>📤 Çıkış</label><strong style="color:#d97706">${fTL((kasaGun.cikisYapilanPara || 0) + (kasaGun.adminAlimlar || 0))}</strong></div>
    <div class="ozet-kart toplam"><label>Toplam Tahsilat</label><strong>${fTL(toplamNakit + toplamKart + toplamHavale)}</strong></div>
  </div>

  <h2>🛒 Satışlar</h2>
  ${satislar.length > 0 ? `<table><thead><tr><th>Saat</th><th>Satış Kodu</th><th>Müşteri</th><th>Nakit</th><th>Kart</th><th>Havale</th><th>Toplam</th></tr></thead><tbody>${satisRows}</tbody></table>` : '<p style="color:#aaa;padding:8px 0">Bu gün satış bulunamadı.</p>'}

  <h2>💰 Tahsilatlar</h2>
  ${tahsilatlar.length > 0 ? `<table><thead><tr><th>Satış Tarihi</th><th>Satış Kodu</th><th>Müşteri</th><th>Nakit</th><th>Kart</th><th>Havale</th><th>Toplam</th></tr></thead><tbody>${tahsilatRows}</tbody></table>` : '<p style="color:#aaa;padding:8px 0">Bu gün tahsilat bulunamadı.</p>'}

  <h2>📦 Mağaza Stoğu</h2>
  ${magazaStok.length > 0 ? `<table><thead><tr><th>Ürün Kodu</th><th>Ürün Adı</th><th>Stok</th></tr></thead><tbody>${stokRows}</tbody></table>` : '<p style="color:#aaa;padding:8px 0">Stok kaydı bulunamadı.</p>'}

  <div class="footer">Rapor: ${new Date().toLocaleString('tr-TR')}</div>
  <script>window.onload=()=>{window.print()}</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=940,height=720');
  if (win) { win.document.write(html); win.document.close(); }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const Kasa: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

  // 8️⃣ Admin şube seçici — admin ise istediği şubeyi görebilir
  const [seciliSubeKodu, setSeciliSubeKodu] = useState<string>(currentUser?.subeKodu || '');

  // Aktif şube (admin seçtiyse o, yoksa kendi şubesi)
  const aktifSubeKodu = isAdmin ? seciliSubeKodu : (currentUser?.subeKodu || '');
  const aktifSube = getSubeByKod(aktifSubeKodu as any);

  // ── Ana kasa ──────────────────────────────────────────────────
  const [kasaGun, setKasaGun] = useState<KasaGun | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Geçmiş ───────────────────────────────────────────────────
  const [gecmis, setGecmis]                   = useState<KasaGun[]>([]);
  const [gecmisGorunuyor, setGecmisGorunuyor] = useState(false);
  const [gecmisDetay, setGecmisDetay]         = useState<GecmisDetay | null>(null);
  const [detayYukleniyor, setDetayYukleniyor] = useState(false);
  const [printYukleniyor, setPrintYukleniyor] = useState<string | null>(null);

  const [tarihFiltre, setTarihFiltre] = useState<GecmisTarihFiltre>({
    baslangic: (() => {
      const d = new Date(); d.setDate(d.getDate() - 30);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })(),
    bitis: bugunStrLocal(),
  });
  const [tarihFiltreHata, setTarihFiltreHata] = useState('');
  const [gecmisSayfa, setGecmisSayfa]         = useState(1);

  // ── Bugünkü tablar ────────────────────────────────────────────
  const [aktifTab, setAktifTab] = useState<AktifTab>('hareketler');

  // ── Satışlar & Tahsilatlar ────────────────────────────────────
  const [satisOzet, setSatisOzet]               = useState<KasaSatisOzet | null>(null);
  const [satisYukleniyor, setSatisYukleniyor]   = useState(false);
  const [tahsilatOzet, setTahsilatOzet]             = useState<KasaTahsilatOzet | null>(null);
  const [tahsilatYukleniyor, setTahsilatYukleniyor] = useState(false);

  // ── Hareket ekleme formu ──────────────────────────────────────
  const [eklemeModu, setEklemeModu] = useState(false);
  const [hTip, setHTip]             = useState<KasaHareketTipi>(KasaHareketTipi.GIDER);
  const [hAciklama, setHAciklama]   = useState('');
  const [hTutar, setHTutar]         = useState<number>(0);
  const [hBelgeNo, setHBelgeNo]     = useState('');
  const [hNot, setHNot]             = useState('');
  const [formHata, setFormHata]     = useState('');

  // ── Admin çıkış formu ─────────────────────────────────────────
  const [adminModu, setAdminModu]   = useState(false);
  const [adminId, setAdminId]       = useState(ADMIN_LISTESI[0]?.id || '');
  const [adminTutar, setAdminTutar] = useState<number>(0);
  const [adminNot, setAdminNot]     = useState('');
  const [adminHata, setAdminHata]   = useState('');

  // 5️⃣ Stok Hareketleri (günlük log)
  const [stokHareketler, setStokHareketler] = useState<StokHareket[]>([]);
  const [stokYukleniyor, setStokYukleniyor] = useState(false);
  const [stokEklemeModu, setStokEklemeModu] = useState(false);
  const [stokTip, setStokTip]               = useState<StokTip>('GELEN');
  const [stokKod, setStokKod]               = useState('');
  const [stokAd, setStokAd]                 = useState('');
  const [stokAdet, setStokAdet]             = useState<number>(1);
  const [stokMustaeri, setStokMustieri]     = useState('');
  const [stokNot, setStokNot]               = useState('');
  const [stokHata, setStokHata]             = useState('');

  // 5️⃣ Mağaza Stoğu (kalıcı, devir daim)
  const [magazaStok, setMagazaStok]           = useState<MagazaStokKaydi[]>([]);
  const [magazaStokYukleniyor, setMagazaStokYukleniyor] = useState(false);

  // ─────────────────────────────────────────────────────────────
  //  DATA LOAD — tümü aktifSubeKodu'na bağlı
  // ─────────────────────────────────────────────────────────────

  const loadKasa = useCallback(async () => {
    if (!currentUser || !aktifSubeKodu) return;
    setLoading(true);
    try {
      const gun = await getBugununKasaGunu(
        aktifSubeKodu,
        `${currentUser.ad} ${currentUser.soyad}`,
      );
      setKasaGun(gun);
      const gecmisData = await getKasaGecmisi(aktifSubeKodu, 365);
      setGecmis(gecmisData.filter(g => g.gun !== gun?.gun));
    } catch (err) {
      console.error('Kasa yüklenemedi:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser, aktifSubeKodu]);

  const loadSatislar = useCallback(async () => {
    if (!currentUser || !kasaGun || !aktifSubeKodu) return;
    setSatisYukleniyor(true);
    try {
      const ozet = await getSatislar(aktifSubeKodu, 'bugun', kasaGun.gun);
      setSatisOzet(ozet);
    } catch (err) { console.error('Satışlar yüklenemedi:', err); }
    finally { setSatisYukleniyor(false); }
  }, [currentUser, kasaGun, aktifSubeKodu]);

  const loadTahsilatlar = useCallback(async () => {
    if (!currentUser || !kasaGun || !aktifSubeKodu) return;
    setTahsilatYukleniyor(true);
    try {
      const ozet = await getTahsilatlar(aktifSubeKodu, kasaGun.gun);
      setTahsilatOzet(ozet);
    } catch (err) { console.error('Tahsilatlar yüklenemedi:', err); }
    finally { setTahsilatYukleniyor(false); }
  }, [currentUser, kasaGun, aktifSubeKodu]);

  // Günlük stok log (stokHareketler koleksiyonu)
  const loadStokHareketler = useCallback(async () => {
    if (!aktifSubeKodu) return;
    setStokYukleniyor(true);
    try {
      const sube = getSubeByKod(aktifSubeKodu as any);
      if (!sube) return;
      const snap = await getDocs(
        query(
          collection(db, `subeler/${sube.dbPath}/stokHareketler`),
          where('gun', '==', bugunStrLocal()),
        )
      );
      const liste: StokHareket[] = snap.docs.map(d => ({
        id: d.id, ...d.data(),
        tarih: d.data().tarih?.toDate?.() ?? new Date(),
      } as StokHareket));
      liste.sort((a, b) => b.tarih.getTime() - a.tarih.getTime());
      setStokHareketler(liste);
    } catch (err) { console.error('Stok hareketler yüklenemedi:', err); }
    finally { setStokYukleniyor(false); }
  }, [aktifSubeKodu]);

  // 5️⃣ Kalıcı mağaza stoğu (devir daim)
  const loadMagazaStok = useCallback(async () => {
    if (!aktifSubeKodu) return;
    setMagazaStokYukleniyor(true);
    try {
      const sube = getSubeByKod(aktifSubeKodu as any);
      if (!sube) return;
      const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/magazaStok`));
      const liste: MagazaStokKaydi[] = snap.docs.map(d => ({
        urunKodu: d.id,
        ...d.data(),
        sonGuncelleme: d.data().sonGuncelleme?.toDate?.() ?? new Date(),
      } as MagazaStokKaydi));
      liste.sort((a, b) => a.urunKodu.localeCompare(b.urunKodu));
      setMagazaStok(liste);
    } catch (err) { console.error('Mağaza stoğu yüklenemedi:', err); }
    finally { setMagazaStokYukleniyor(false); }
  }, [aktifSubeKodu]);

  // Şube değişince tüm verileri sıfırla ve yeniden yükle
  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    setSatisOzet(null);
    setTahsilatOzet(null);
    setStokHareketler([]);
    setMagazaStok([]);
    setKasaGun(null);
    setGecmis([]);
    loadKasa();
  }, [aktifSubeKodu, currentUser]);

  useEffect(() => {
    if (aktifTab === 'satislar' && !satisOzet)       loadSatislar();
    if (aktifTab === 'tahsilatlar' && !tahsilatOzet) loadTahsilatlar();
    if (aktifTab === 'urun') {
      loadStokHareketler();
      loadMagazaStok();
    }
  }, [aktifTab, kasaGun]);

  // ─────────────────────────────────────────────────────────────
  //  GEÇMİŞ DETAY MODAL
  // ─────────────────────────────────────────────────────────────

  const acGecmisDetay = async (gun: KasaGun) => {
    if (!currentUser) return;
    setDetayYukleniyor(true);
    setGecmisDetay({ kasaGun: gun, satisOzet: null, tahsilatOzet: null, aktifTab: 'satislar' });
    try {
      const [sat, tah] = await Promise.all([
        getSatislar(aktifSubeKodu, 'bugun', gun.gun),
        getTahsilatlar(aktifSubeKodu, gun.gun),
      ]);
      setGecmisDetay(prev => prev ? { ...prev, satisOzet: sat, tahsilatOzet: tah } : null);
    } catch (err) { console.error('Detay yüklenemedi:', err); }
    finally { setDetayYukleniyor(false); }
  };

  // ─────────────────────────────────────────────────────────────
  //  PRINT PREVIEW
  // ─────────────────────────────────────────────────────────────

  const handlePrintPreview = async (gun: KasaGun) => {
    if (!currentUser) return;
    setPrintYukleniyor(gun.gun);
    try {
      const sube = getSubeByKod(aktifSubeKodu as any);
      const stokSnap = await getDocs(collection(db, `subeler/${sube?.dbPath}/magazaStok`));
      const stokListe: MagazaStokKaydi[] = stokSnap.docs.map(d => ({ urunKodu: d.id, ...d.data() } as MagazaStokKaydi));
      const [sat, tah] = await Promise.all([
        getSatislar(aktifSubeKodu, 'bugun', gun.gun),
        getTahsilatlar(aktifSubeKodu, gun.gun),
      ]);
      kasaPrintPreviewYap({
        kasaGun: gun, satislar: sat.satislar, tahsilatlar: tah.tahsilatlar,
        magazaStok: stokListe, magazaAdi: 'Tüfekçi Home', subeAdi: sube?.ad || aktifSubeKodu,
      });
    } catch (err) {
      alert('❌ Çıktı hazırlanamadı: ' + (err as Error).message);
    } finally { setPrintYukleniyor(null); }
  };

  const handleBugunkuPrint = async () => {
    if (!kasaGun || !currentUser) return;
    setPrintYukleniyor(kasaGun.gun);
    try {
      const sube = getSubeByKod(aktifSubeKodu as any);
      const stokSnap = await getDocs(collection(db, `subeler/${sube?.dbPath}/magazaStok`));
      const stokListe: MagazaStokKaydi[] = stokSnap.docs.map(d => ({ urunKodu: d.id, ...d.data() } as MagazaStokKaydi));
      const sat = satisOzet ?? await getSatislar(aktifSubeKodu, 'bugun', kasaGun.gun);
      const tah = tahsilatOzet ?? await getTahsilatlar(aktifSubeKodu, kasaGun.gun);
      kasaPrintPreviewYap({
        kasaGun, satislar: sat.satislar, tahsilatlar: tah.tahsilatlar,
        magazaStok: stokListe, magazaAdi: 'Tüfekçi Home', subeAdi: sube?.ad || aktifSubeKodu,
      });
    } catch (err) { alert('❌ Hata: ' + (err as Error).message); }
    finally { setPrintYukleniyor(null); }
  };

  // ─────────────────────────────────────────────────────────────
  //  HAREKET EKLE
  // ─────────────────────────────────────────────────────────────

  const handleHareketEkle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !kasaGun?.id) { setFormHata('Kasa günü bulunamadı!'); return; }
    if (!hAciklama.trim())             { setFormHata('Açıklama giriniz!'); return; }
    if (hTutar <= 0)                   { setFormHata("Tutar 0'dan büyük olmalı!"); return; }
    if (!MANUEL_TIPLER.includes(hTip)) { setFormHata('Bu tip manuel eklenemez!'); return; }
    setFormHata('');
    try {
      const ok = await kasaHareketEkle(
        aktifSubeKodu, kasaGun.id,
        {
          aciklama: hAciklama, tutar: hTutar, tip: hTip,
          belgeNo: hBelgeNo || undefined, not: hNot || undefined,
          tarih: new Date(),
          kullanici: `${currentUser.ad} ${currentUser.soyad}`,
          kullaniciId: currentUser.uid || '',
          subeKodu: aktifSubeKodu,
        },
        `${currentUser.ad} ${currentUser.soyad}`,
        currentUser.uid || '',
      );
      if (ok) {
        setHAciklama(''); setHTutar(0); setHBelgeNo(''); setHNot('');
        setHTip(KasaHareketTipi.GIDER); setEklemeModu(false);
        await loadKasa();
      } else { setFormHata('İşlem başarısız!'); }
    } catch (err) { setFormHata('Hata: ' + (err as Error).message); }
  };

  // ─────────────────────────────────────────────────────────────
  //  ADMİN ALIM
  // ─────────────────────────────────────────────────────────────

  const handleAdminAlim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !kasaGun?.id) { setAdminHata('Kasa günü bulunamadı!'); return; }
    if (adminTutar <= 0)               { setAdminHata("Tutar 0'dan büyük olmalı!"); return; }
    if (adminTutar > (kasaGun.gunSonuBakiyesi ?? 0)) {
      setAdminHata(`⚠️ Bakiye yetersiz! Mevcut: ${formatPrice(kasaGun.gunSonuBakiyesi ?? 0)}`); return;
    }
    setAdminHata('');
    const admin = ADMIN_LISTESI.find(a => a.id === adminId);
    if (!admin) return;
    try {
      const ok = await kasaHareketEkle(
        aktifSubeKodu, kasaGun.id,
        {
          aciklama: `${admin.ad} kasadan para aldı`, tutar: adminTutar,
          tip: KasaHareketTipi.ADMIN_ALIM, not: adminNot || undefined,
          tarih: new Date(),
          kullanici: `${currentUser.ad} ${currentUser.soyad}`,
          kullaniciId: currentUser.uid || '',
          subeKodu: aktifSubeKodu,
          adminId: admin.id, adminAd: admin.ad,
        },
        `${currentUser.ad} ${currentUser.soyad}`,
        currentUser.uid || '',
      );
      if (ok) {
        setAdminTutar(0); setAdminNot(''); setAdminModu(false);
        await loadKasa();
        alert(`✅ ${admin.ad} ${formatPrice(adminTutar)} aldı.`);
      } else { setAdminHata('İşlem başarısız!'); }
    } catch (err) { setAdminHata('Hata: ' + (err as Error).message); }
  };

  // ─────────────────────────────────────────────────────────────
  //  5️⃣ STOK HAREKETİ EKLE + MAĞAZA STOĞU GÜNCELLE
  // ─────────────────────────────────────────────────────────────

  const handleStokEkle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !aktifSubeKodu) return;
    if (!stokKod.trim())  { setStokHata('Ürün kodu gereklidir!'); return; }
    if (stokAdet <= 0)    { setStokHata("Adet 0'dan büyük olmalı!"); return; }
    if (stokTip === 'CIKAN' && !stokMustaeri.trim()) { setStokHata('Çıkan ürün için müşteri/satış kodu giriniz!'); return; }
    setStokHata('');

    const subeKoduAnlik = aktifSubeKodu; // closure'dan kopyala
    const sube = getSubeByKod(subeKoduAnlik as any);
    if (!sube) { setStokHata('Şube bulunamadı!'); return; }

    const kod = stokKod.trim().toUpperCase();
    const adAnlik = stokAd.trim();
    const adetAnlik = stokAdet;
    const tipAnlik = stokTip;
    const musteriAnlik = stokMustaeri.trim();
    const notAnlik = stokNot.trim();
    const kullaniciAnlik = `${currentUser.ad} ${currentUser.soyad}`;

    try {
      const stokRef = doc(db, `subeler/${sube.dbPath}/magazaStok`, kod);

      // 1. Günlük stok hareketi log
      await addDoc(collection(db, `subeler/${sube.dbPath}/stokHareketler`), {
        tip: tipAnlik,
        urunKodu: kod,
        urunAdi: adAnlik || null,
        adet: adetAnlik,
        musteriVeyaSatisKodu: musteriAnlik || null,
        not: notAnlik || null,
        tarih: Timestamp.fromDate(new Date()),
        gun: bugunStrLocal(),
        kullanici: kullaniciAnlik,
        subeKodu: subeKoduAnlik,
      });

      // 2. Kalıcı stok — runTransaction ile atomic güncelleme
      await runTransaction(db, async (transaction) => {
        const mevcut = await transaction.get(stokRef);
        const mevcutAdet = mevcut.exists() ? (mevcut.data().adet ?? 0) : 0;
        const mevcutAd   = mevcut.exists() ? (mevcut.data().urunAdi ?? '') : '';
        const yeniAdet = tipAnlik === 'GELEN' ? mevcutAdet + adetAnlik : mevcutAdet - adetAnlik;
        transaction.set(stokRef, {
          urunKodu: kod,
          urunAdi: adAnlik || mevcutAd,
          adet: yeniAdet,
          sonGuncelleme: Timestamp.fromDate(new Date()),
          subeKodu: subeKoduAnlik,
        });
      });

      // 3. State sıfırla
      setStokKod(''); setStokAd(''); setStokAdet(1); setStokMustieri(''); setStokNot('');
      setStokEklemeModu(false);

      // 4. Firestore'dan taze veri çek (sırayla, race condition yok)
      await loadStokHareketler();
      await loadMagazaStok();

      alert(`✅ ${tipAnlik === 'GELEN' ? 'Gelen' : 'Çıkan'} ürün kaydedildi. Mağaza stoğu güncellendi.`);
    } catch (err) {
      console.error('Stok ekle hatası:', err);
      setStokHata('Hata: ' + (err as Error).message);
    }
  };

  // ─────────────────────────────────────────────────────────────
  //  GEÇMİŞ FİLTRE
  // ─────────────────────────────────────────────────────────────

  const handleTarihFiltre = (field: 'baslangic' | 'bitis', val: string) => {
    const yeni = { ...tarihFiltre, [field]: val };
    const fark = Math.round((new Date(yeni.bitis).getTime() - new Date(yeni.baslangic).getTime()) / 86400000);
    if (fark > 31)   setTarihFiltreHata('⚠️ Maksimum 31 günlük aralık seçilebilir.');
    else if (fark < 0) setTarihFiltreHata('⚠️ Başlangıç tarihi bitiş tarihinden büyük olamaz.');
    else setTarihFiltreHata('');
    setTarihFiltre(yeni);
    setGecmisSayfa(1);
  };

  const filtreliGecmis = () =>
    tarihFiltreHata ? [] :
    gecmis.filter(g => g.gun >= tarihFiltre.baslangic && g.gun <= tarihFiltre.bitis)
          .sort((a, b) => b.gun.localeCompare(a.gun));

  const toplamSayfa = () => Math.ceil(filtreliGecmis().length / SAYFA_BOYUTU);
  const sayfaGecmis = () => {
    const liste = filtreliGecmis();
    return liste.slice((gecmisSayfa - 1) * SAYFA_BOYUTU, gecmisSayfa * SAYFA_BOYUTU);
  };

  // ─────────────────────────────────────────────────────────────
  //  LOADING
  // ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="kasa-container">
        <div className="loading">Kasa yükleniyor...</div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════════════

  return (
    <div className="kasa-container">

      {/* ─────────────────────── HEADER ─────────────────────── */}
      <div className="kasa-header">
        <div className="kasa-header-left">
          <button onClick={() => navigate('/dashboard')} className="btn-back">← Geri</button>
          <h1>Kasa Yönetimi</h1>
          {/* 8️⃣ Admin şube seçici */}
          {isAdmin && (
            <select
              value={seciliSubeKodu}
              onChange={e => {
                setSeciliSubeKodu(e.target.value);
                setAktifTab('hareketler');
                setGecmisGorunuyor(false);
              }}
              className="form-select"
              style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, minWidth: 160, borderRadius: 8 }}
            >
              {SUBELER.map((s: any) => (
                <option key={s.kod} value={s.kod}>🏪 {s.ad}</option>
              ))}
            </select>
          )}
          {isAdmin && aktifSube && (
            <span style={{
              fontSize: 12, color: 'var(--teal)', fontWeight: 700,
              background: 'var(--teal-light)', padding: '4px 12px', borderRadius: 999,
            }}>
              📍 {aktifSube.ad}
            </span>
          )}
        </div>
        <div className="kasa-header-right">
          <button onClick={() => setGecmisGorunuyor(!gecmisGorunuyor)} className="btn-gecmis">
            {gecmisGorunuyor ? '📋 Günlük Kasa' : '📅 Geçmiş Kayıtlar'}
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {!gecmisGorunuyor ? (

        /* ─────────── GÜNLÜK KASA ─────────── */
        <div className="kasa-gunluk">
          {!kasaGun ? (
            <div className="empty-hareket">
              <p>⚠️ Kasa yüklenemedi.</p>
              <button onClick={loadKasa} className="btn-ekle" style={{ marginTop: 16 }}>🔄 Tekrar Dene</button>
            </div>
          ) : (
            <>
              {/* ── ÖZET KART ── */}
              <div className="kasa-bilgi-karti">
                <div className="kasa-tarih">
                  <span className="tarih-label">Tarih:</span>
                  <span className="tarih-value">{formatGun(kasaGun.gun)}</span>
                  <span className="tarih-label" style={{ marginLeft: 20 }}>Açılış Yapan:</span>
                  <span className="tarih-value" style={{ fontSize: 13, color: 'var(--gray-600)' }}>
                    {kasaGun.acilisYapan}
                  </span>
                  <button
                    className="btn-pdf"
                    onClick={handleBugunkuPrint}
                    disabled={printYukleniyor === kasaGun.gun}
                    style={{ marginLeft: 'auto' }}
                  >
                    {printYukleniyor === kasaGun.gun ? '⏳ Hazırlanıyor...' : '🖨️ Kasa Çıktısı Al'}
                  </button>
                </div>

                <div className="kasa-akis">
                  <div className="akis-kart acilis">
                    <span className="akis-kart-label">Açılış Bakiyesi</span>
                    <span className="akis-kart-tutar">{formatPrice(kasaGun.acilisBakiyesi)}</span>
                  </div>
                  <div className="akis-kart nakit">
                    <span className="akis-kart-label">💵 Nakit Satış</span>
                    <span className="akis-kart-tutar">{formatPrice(kasaGun.nakitSatis || 0)}</span>
                    <span className="akis-kart-alt">kasaya girer</span>
                  </div>
                  <div className="akis-kart gider">
                    <span className="akis-kart-label">💸 Giderler</span>
                    <span className="akis-kart-tutar">{formatPrice(kasaGun.toplamGider || 0)}</span>
                    <span className="akis-kart-alt">kasadan çıkar</span>
                  </div>
                  <div className="akis-kart cikis">
                    <span className="akis-kart-label">📤 Çıkış</span>
                    <span className="akis-kart-tutar">
                      {formatPrice((kasaGun.cikisYapilanPara || 0) + (kasaGun.adminAlimlar || 0))}
                    </span>
                    <span className="akis-kart-alt">kasadan çıkar</span>
                  </div>
                  <div className="akis-kart gunsonu">
                    <span className="akis-kart-label">Gün Sonu Bakiyesi</span>
                    <span className="akis-kart-tutar">{formatPrice(kasaGun.gunSonuBakiyesi || 0)}</span>
                    <span className="akis-kart-alt">ertesi gün açılış</span>
                  </div>
                </div>
              </div>

              {/* ── TAB BAR ── */}
              <div className="kasa-tab-bar">
                {([
                  { key: 'hareketler',  label: '📋 Gün İçi Hareketler', badge: kasaGun.hareketler?.filter(h => h.tip !== KasaHareketTipi.ADMIN_ALIM).length || 0 },
                  { key: 'satislar',    label: '🛒 Satışlar',            badge: satisOzet?.satisAdeti || 0 },
                  { key: 'tahsilatlar', label: '💰 Tahsilatlar',         badge: tahsilatOzet?.tahsilatAdeti || 0 },
                  { key: 'cikis',       label: '📤 Çıkış',              badge: kasaGun.hareketler?.filter(h => h.tip === KasaHareketTipi.ADMIN_ALIM).length || 0, adminBadge: true },
                  { key: 'urun',        label: '📦 Gelen / Çıkan Ürün', badge: stokHareketler.length },
                ] as any[]).map(t => (
                  <button
                    key={t.key}
                    className={`tab-btn ${aktifTab === t.key ? 'aktif' : ''}`}
                    onClick={() => setAktifTab(t.key)}
                  >
                    {t.label}
                    <span className={`tab-badge ${t.adminBadge ? 'admin' : ''}`}>{t.badge}</span>
                  </button>
                ))}
              </div>

              {/* ══ TAB: HAREKETLER ══ */}
              {aktifTab === 'hareketler' && (
                <div className="kasa-hareketler">
                  <div className="hareketler-header">
                    <h2>Gün İçi Hareketler</h2>
                    <button onClick={() => { setEklemeModu(!eklemeModu); setFormHata(''); }} className="btn-ekle">
                      {eklemeModu ? '✕ İptal' : '+ Yeni Hareket'}
                    </button>
                  </div>
                  <div className="kasa-bilgi-notu">
                    ℹ️ <strong>Nakit Satış, Kart ve Havale</strong> otomatik oluşur.
                    Buraya yalnızca <strong>Gider</strong> ve <strong>Diğer</strong> eklenebilir.
                    Admin çıkışı için <strong>Çıkış</strong> sekmesini kullanın.
                  </div>
                  {eklemeModu && (
                    <div className="hareket-ekle-form">
                      <h3>Yeni Hareket Ekle</h3>
                      <form onSubmit={handleHareketEkle}>
                        <div className="form-row">
                          <div className="form-group">
                            <label>İşlem Tipi *</label>
                            <select value={hTip} onChange={e => setHTip(e.target.value as KasaHareketTipi)} className="form-select">
                              <option value={KasaHareketTipi.GIDER}>💸 Gider</option>
                              <option value={KasaHareketTipi.DIGER}>📝 Diğer</option>
                            </select>
                          </div>
                          <div className="form-group">
                            <label>Tutar (TL) *</label>
                            <input type="number" min="0.01" step="0.01" value={hTutar || ''}
                              onChange={e => setHTutar(parseFloat(e.target.value) || 0)} placeholder="0.00" required />
                          </div>
                        </div>
                        <div className="form-group">
                          <label>Açıklama *</label>
                          <input type="text" value={hAciklama} onChange={e => setHAciklama(e.target.value)} placeholder="Ne için?" required />
                        </div>
                        <div className="form-row">
                          <div className="form-group">
                            <label>Belge No</label>
                            <input type="text" value={hBelgeNo} onChange={e => setHBelgeNo(e.target.value)} placeholder="Opsiyonel" />
                          </div>
                          <div className="form-group">
                            <label>Not</label>
                            <input type="text" value={hNot} onChange={e => setHNot(e.target.value)} placeholder="Ek not" />
                          </div>
                        </div>
                        {formHata && <div className="form-hata">{formHata}</div>}
                        <div className="form-actions">
                          <button type="button" onClick={() => setEklemeModu(false)} className="btn-iptal">İptal</button>
                          <button type="submit" className="btn-kaydet">Kaydet</button>
                        </div>
                      </form>
                    </div>
                  )}
                  {(kasaGun.hareketler?.filter(h => h.tip !== KasaHareketTipi.ADMIN_ALIM).length ?? 0) > 0 ? (
                    <div className="hareket-listesi">
                      <table className="hareket-tablosu">
                        <thead><tr><th>Saat</th><th>Tip</th><th>Açıklama</th><th>Belge No</th><th>Tutar</th><th>Kasaya Yansır</th><th>Kullanıcı</th></tr></thead>
                        <tbody>
                          {kasaGun.hareketler.filter(h => h.tip !== KasaHareketTipi.ADMIN_ALIM).map(h => {
                            const yon = kasaYonu(h.tip);
                            return (
                              <tr key={h.id} className={`hareket-satir ${getTipClass(h.tip)}`}>
                                <td>{h.saat}</td>
                                <td><span className={`tip-badge ${getTipClass(h.tip)}`}>{getTipIcon(h.tip)} {h.tip}</span></td>
                                <td>{h.aciklama}</td>
                                <td>{h.belgeNo || '—'}</td>
                                <td className={`tutar ${yon}`}>
                                  {yon === 'giris' ? '+' : yon === 'cikis' ? '−' : ''}{formatPrice(Math.abs(h.tutar))}
                                </td>
                                <td>{kasayaYansiyor(h.tip) ? <span className="badge-evet">✅ Evet</span> : <span className="badge-hayir">❌ Hayır</span>}</td>
                                <td>{h.kullanici}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty-hareket">
                      <p>Bugün henüz hareket yok.</p>
                      <small>Gider veya Diğer eklemek için butona tıklayın.</small>
                    </div>
                  )}
                </div>
              )}

              {/* ══ TAB: SATIŞLAR ══ */}
              {aktifTab === 'satislar' && (
                <div className="kasa-hareketler">
                  <div className="hareketler-header">
                    <h2>🛒 Satışlar — {formatGun(kasaGun.gun)}</h2>
                    <button onClick={loadSatislar} className="btn-filtre aktif">🔄 Yenile</button>
                  </div>
                  <div className="kasa-bilgi-notu">
                    📦 Bugün kesilmiş satışlar. Önceki günlerden gelen ödemeler → <strong>Tahsilatlar</strong> sekmesi.
                  </div>
                  {satisYukleniyor ? (
                    <div className="loading" style={{ padding: '40px 0' }}>Satışlar yükleniyor...</div>
                  ) : satisOzet ? (
                    <>
                      <div className="satis-ozet-grid">
                        <div className="satis-ozet-kart toplam"><span className="satis-ozet-label">📦 Toplam Ciro</span><span className="satis-ozet-tutar">{formatPrice(satisOzet.toplamTutar)}</span><span className="satis-ozet-alt">{satisOzet.satisAdeti} satış</span></div>
                        <div className="satis-ozet-kart nakit"><span className="satis-ozet-label">💵 Nakit</span><span className="satis-ozet-tutar">{formatPrice(satisOzet.toplamNakit)}</span></div>
                        <div className="satis-ozet-kart kart"><span className="satis-ozet-label">💳 Kart</span><span className="satis-ozet-tutar">{formatPrice(satisOzet.toplamKart)}</span></div>
                        <div className="satis-ozet-kart havale"><span className="satis-ozet-label">🏦 Havale</span><span className="satis-ozet-tutar">{formatPrice(satisOzet.toplamHavale)}</span></div>
                      </div>
                      {satisOzet.satislar.length > 0 ? (
                        <div className="hareket-listesi" style={{ marginTop: 16 }}>
                          <table className="hareket-tablosu">
                            <thead><tr><th>Saat</th><th>Satış Kodu</th><th>Müşteri</th><th>Nakit</th><th>Kart</th><th>Havale</th><th>Satış Tutarı</th><th>Durum</th><th>Satıcı</th></tr></thead>
                            <tbody>
                              {satisOzet.satislar.map(s => (
                                <tr key={s.id} className="hareket-satir">
                                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{formatSaat(s.tarih)}</td>
                                  <td><span className="tip-badge nakit">{s.satisKodu}</span></td>
                                  <td>{s.musteriIsim}</td>
                                  <td className="tutar giris">{s.nakitTutar > 0 ? formatPrice(s.nakitTutar) : '—'}</td>
                                  <td style={{ color: '#0066cc', fontFamily: 'var(--font-mono)' }}>{s.kartTutar > 0 ? formatPrice(s.kartTutar) : '—'}</td>
                                  <td style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>{s.havaleTutar > 0 ? formatPrice(s.havaleTutar) : '—'}</td>
                                  <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{formatPrice(s.tutar)}</td>
                                  <td><span className={`tip-badge ${s.onayDurumu ? 'nakit' : 'gider'}`}>{s.onayDurumu ? '✅ Onaylı' : '⏳ Bekliyor'}</span></td>
                                  <td>{s.kullanici}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <div className="empty-hareket"><p>Bugün satış bulunamadı.</p></div>}
                    </>
                  ) : (
                    <div className="empty-hareket">
                      <button onClick={loadSatislar} className="btn-ekle">Satışları Yükle</button>
                    </div>
                  )}
                </div>
              )}

              {/* ══ TAB: TAHSİLATLAR ══ */}
              {aktifTab === 'tahsilatlar' && (
                <div className="kasa-hareketler">
                  <div className="hareketler-header">
                    <h2>💰 Tahsilatlar — {formatGun(kasaGun.gun)}</h2>
                    <span className="tarih-badge">{formatGun(kasaGun.gun)}</span>
                  </div>
                  <div className="kasa-bilgi-notu">
                    📅 <strong>Bugün</strong> alınan ödemeler (ödeme kayıt tarihi = bugün).
                    <br />🔴 Kırmızı satırlar iptal iadelerini gösterir.
                  </div>
                  {tahsilatYukleniyor ? (
                    <div className="loading" style={{ padding: '40px 0' }}>Tahsilatlar yükleniyor...</div>
                  ) : tahsilatOzet && tahsilatOzet.tahsilatlar.length > 0 ? (
                    <>
                      <div className="satis-ozet-grid">
                        <div className="satis-ozet-kart toplam"><span className="satis-ozet-label">💰 Bugün Tahsil</span><span className="satis-ozet-tutar">{formatPrice(tahsilatOzet.tahsilatTutar)}</span><span className="satis-ozet-alt">{tahsilatOzet.tahsilatAdeti} kayıt</span></div>
                        <div className="satis-ozet-kart nakit"><span className="satis-ozet-label">💵 Nakit</span><span className="satis-ozet-tutar">{formatPrice(tahsilatOzet.toplamNakit)}</span></div>
                        <div className="satis-ozet-kart kart"><span className="satis-ozet-label">💳 Kart</span><span className="satis-ozet-tutar">{formatPrice(tahsilatOzet.toplamKart)}</span></div>
                        <div className="satis-ozet-kart havale"><span className="satis-ozet-label">🏦 Havale</span><span className="satis-ozet-tutar">{formatPrice(tahsilatOzet.toplamHavale)}</span></div>
                      </div>
                      <div className="hareket-listesi" style={{ marginTop: 16 }}>
                        <table className="hareket-tablosu">
                          <thead><tr><th>Satış Tarihi</th><th>Satış Kodu</th><th>Müşteri</th><th>Nakit</th><th>Kart</th><th>Havale</th><th>Tutar</th><th>Açıklama</th></tr></thead>
                          <tbody>
                            {tahsilatOzet.tahsilatlar.map(s => {
                              const isIptal = (s as any).iptalIadesi === true;
                              return (
                                <tr key={s.id} className={`hareket-satir ${isIptal ? '' : 'onceki-gun-odeme'}`}
                                  style={isIptal ? { background: '#fef2f2', borderLeft: '3px solid #dc2626' } : {}}>
                                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                                    <span style={{ fontWeight: 600, color: isIptal ? 'var(--red)' : 'var(--teal)' }}>{s.satisTarihi ? formatGun(s.satisTarihi) : '—'}</span>
                                    <br /><span style={{ fontSize: 10, background: isIptal ? 'rgba(220,38,38,.1)' : 'rgba(0,153,153,.1)', color: isIptal ? 'var(--red)' : 'var(--teal)', padding: '2px 6px', borderRadius: 4, display: 'inline-block', marginTop: 2 }}>
                                      {isIptal ? '🔴 iptal iadesi' : 'önceki günden'}
                                    </span>
                                  </td>
                                  <td><span className={`tip-badge ${isIptal ? 'gider' : 'nakit'}`}>{s.satisKodu}</span></td>
                                  <td>{s.musteriIsim}</td>
                                  <td className={`tutar ${s.nakitTutar < 0 ? 'cikis' : s.nakitTutar > 0 ? 'giris' : ''}`}>{s.nakitTutar !== 0 ? formatPrice(s.nakitTutar) : '—'}</td>
                                  <td style={{ color: s.kartTutar < 0 ? 'var(--red)' : '#0066cc', fontFamily: 'var(--font-mono)' }}>{s.kartTutar !== 0 ? formatPrice(s.kartTutar) : '—'}</td>
                                  <td style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>{s.havaleTutar !== 0 ? formatPrice(s.havaleTutar) : '—'}</td>
                                  <td className={`tutar ${(s.nakitTutar + s.kartTutar + s.havaleTutar) < 0 ? 'cikis' : 'giris'}`} style={{ fontWeight: 700 }}>{formatPrice(s.nakitTutar + s.kartTutar + s.havaleTutar)}</td>
                                  <td style={{ fontSize: 11, color: isIptal ? 'var(--red)' : 'var(--gray-500)' }}>{(s as any).aciklama || (isIptal ? 'Satış iptali iadesi' : '—')}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="empty-hareket">
                      <p>Bugün tahsilat veya iade yok.</p>
                      <small>Tüm ödemeler satış gününde yapılmış ya da henüz kayıt yok.</small>
                    </div>
                  )}
                </div>
              )}

              {/* ══ TAB: ÇIKIŞ ══ */}
              {aktifTab === 'cikis' && (
                <div className="kasa-hareketler">
                  <div className="hareketler-header">
                    <h2>📤 Çıkış — Admin Para Alımları</h2>
                    <button onClick={() => { setAdminModu(!adminModu); setAdminHata(''); }} className="btn-ekle btn-admin">
                      {adminModu ? '✕ İptal' : '📤 Yeni Çıkış'}
                    </button>
                  </div>
                  {adminModu && (
                    <div className="hareket-ekle-form admin-form">
                      <h3>Admin Para Alım Kaydı</h3>
                      <form onSubmit={handleAdminAlim}>
                        <div className="form-row">
                          <div className="form-group">
                            <label>Admin *</label>
                            <select value={adminId} onChange={e => setAdminId(e.target.value as any)} className="form-select">
                              {ADMIN_LISTESI.map(a => <option key={a.id} value={a.id}>👤 {a.ad}</option>)}
                            </select>
                          </div>
                          <div className="form-group">
                            <label>Tutar (TL) *</label>
                            <input type="number" min="0.01" step="0.01" value={adminTutar || ''}
                              onChange={e => setAdminTutar(parseFloat(e.target.value) || 0)} placeholder="0.00" required />
                          </div>
                        </div>
                        <div className="form-group">
                          <label>Not</label>
                          <input type="text" value={adminNot} onChange={e => setAdminNot(e.target.value)} placeholder="Açıklama (opsiyonel)" />
                        </div>
                        <div className="admin-bakiye-info">
                          <span>Mevcut Kasa Bakiyesi:</span>
                          <strong>{formatPrice(kasaGun.gunSonuBakiyesi ?? 0)}</strong>
                        </div>
                        {adminHata && <div className="form-hata">{adminHata}</div>}
                        <div className="form-actions">
                          <button type="button" onClick={() => setAdminModu(false)} className="btn-iptal">İptal</button>
                          <button type="submit" className="btn-admin-kaydet">👤 Kaydet</button>
                        </div>
                      </form>
                    </div>
                  )}
                  {Object.keys(kasaGun.adminOzet || {}).length > 0 && (
                    <div className="admin-ozet-grid">
                      {ADMIN_LISTESI.map(admin => {
                        const toplam = kasaGun.adminOzet?.[admin.ad] ?? 0;
                        return (
                          <div key={admin.id} className={`admin-ozet-kart ${toplam > 0 ? 'aktif' : ''}`}>
                            <span className="admin-isim">{admin.ad}</span>
                            <span className="admin-toplam">{formatPrice(toplam)}</span>
                            <span className="admin-label">{toplam > 0 ? 'kasadan aldı' : 'henüz almadı'}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {(kasaGun.hareketler?.filter(h => h.tip === KasaHareketTipi.ADMIN_ALIM).length ?? 0) > 0 ? (
                    <div className="hareket-listesi" style={{ marginTop: 16 }}>
                      <table className="hareket-tablosu">
                        <thead><tr><th>Saat</th><th>Admin</th><th>Tutar</th><th>Not</th><th>Kaydeden</th></tr></thead>
                        <tbody>
                          {kasaGun.hareketler.filter(h => h.tip === KasaHareketTipi.ADMIN_ALIM).map(h => (
                            <tr key={h.id} className="hareket-satir admin">
                              <td>{h.saat}</td>
                              <td><span className="tip-badge admin">👤 {h.adminAd || h.aciklama}</span></td>
                              <td className="tutar cikis">−{formatPrice(h.tutar)}</td>
                              <td>{h.not || '—'}</td>
                              <td>{h.kullanici}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : !adminModu && (
                    <div className="empty-hareket">
                      <p>Bugün çıkış yok.</p>
                      <small>Yeni Çıkış butonuyla kayıt ekleyebilirsiniz.</small>
                    </div>
                  )}
                </div>
              )}

              {/* ══ TAB: 5️⃣ GELEN / ÇIKAN ÜRÜN + MAĞAZA STOĞU ══ */}
              {aktifTab === 'urun' && (
                <div className="urun-tab-grid">

                  {/* Sol: Gelen/Çıkan Ürün */}
                  <div className="kasa-hareketler">
                    <div className="hareketler-header">
                      <h2>📦 Gelen / Çıkan Ürün — Bugünkü Hareketler</h2>
                      <button onClick={() => { setStokEklemeModu(!stokEklemeModu); setStokHata(''); }} className="btn-ekle">
                        {stokEklemeModu ? '✕ İptal' : '+ Yeni Kayıt'}
                      </button>
                    </div>
                    <div className="kasa-bilgi-notu">
                      📦 Stok hareketleri kasayı etkilemez. Kayıt girince <strong>Mağaza Stoğu</strong> otomatik güncellenir.
                    </div>

                    {stokEklemeModu && (
                      <div className="hareket-ekle-form">
                        <h3>Yeni Stok Hareketi</h3>
                        <form onSubmit={handleStokEkle}>
                          <div className="form-row">
                            <div className="form-group">
                              <label>Hareket Tipi *</label>
                              <select value={stokTip} onChange={e => setStokTip(e.target.value as StokTip)} className="form-select">
                                <option value="GELEN">📥 Gelen Ürün (Stok Artışı)</option>
                                <option value="CIKAN">📤 Çıkan Ürün (Stok Azalışı)</option>
                              </select>
                            </div>
                            <div className="form-group">
                              <label>Ürün Kodu *</label>
                              <input type="text" value={stokKod} onChange={e => setStokKod(e.target.value)} placeholder="Ürün kodu" required />
                            </div>
                          </div>
                          <div className="form-row">
                            {stokTip === 'GELEN' && (
                              <div className="form-group">
                                <label>Ürün Adı</label>
                                <input type="text" value={stokAd} onChange={e => setStokAd(e.target.value)} placeholder="Ürün adı (opsiyonel)" />
                              </div>
                            )}
                            <div className="form-group">
                              <label>Adet *</label>
                              <input type="number" min="1" value={stokAdet || ''}
                                onChange={e => setStokAdet(parseInt(e.target.value) || 1)} placeholder="1" required />
                            </div>
                          </div>
                          {stokTip === 'CIKAN' && (
                            <div className="form-group">
                              <label>Müşteri veya Satış Kodu *</label>
                              <input type="text" value={stokMustaeri} onChange={e => setStokMustieri(e.target.value)} placeholder="Müşteri adı veya satış kodu" required />
                            </div>
                          )}
                          <div className="form-group">
                            <label>Not</label>
                            <input type="text" value={stokNot} onChange={e => setStokNot(e.target.value)} placeholder="Açıklama (opsiyonel)" />
                          </div>
                          {stokHata && <div className="form-hata">{stokHata}</div>}
                          <div className="form-actions">
                            <button type="button" onClick={() => setStokEklemeModu(false)} className="btn-iptal">İptal</button>
                            <button type="submit" className="btn-kaydet">Kaydet</button>
                          </div>
                        </form>
                      </div>
                    )}

                    {stokYukleniyor ? (
                      <div className="loading" style={{ padding: '40px 0' }}>Yükleniyor...</div>
                    ) : stokHareketler.length > 0 ? (
                      <div className="hareket-listesi" style={{ marginTop: 16 }}>
                        <table className="hareket-tablosu">
                          <thead><tr><th>Saat</th><th>Tip</th><th>Ürün Kodu</th><th>Ürün Adı</th><th>Adet</th><th>Müşteri/Satış</th><th>Not</th><th>Kaydeden</th></tr></thead>
                          <tbody>
                            {stokHareketler.map(h => (
                              <tr key={h.id} className="hareket-satir">
                                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{formatSaat(h.tarih)}</td>
                                <td><span className={`tip-badge ${h.tip === 'GELEN' ? 'nakit' : 'gider'}`}>{h.tip === 'GELEN' ? '📥 Gelen' : '📤 Çıkan'}</span></td>
                                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{h.urunKodu}</td>
                                <td>{h.urunAdi || '—'}</td>
                                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: h.tip === 'GELEN' ? 'var(--green)' : 'var(--red)' }}>
                                  {h.tip === 'GELEN' ? '+' : '−'}{h.adet}
                                </td>
                                <td>{h.musteriVeyaSatisKodu || '—'}</td>
                                <td>{h.not || '—'}</td>
                                <td>{h.kullanici}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty-hareket">
                        <p>Bugün stok hareketi yok.</p>
                        <small>Gelen veya çıkan ürün eklemek için butona tıklayın.</small>
                      </div>
                    )}
                  </div>

                  {/* Sağ: 5️⃣ Mağaza Stoğu Paneli (devir daim) */}
                  <div className="magaza-stok-panel">
                    <div className="magaza-stok-header">
                      <h3>🏪 Mağaza Stoğu</h3>
                      <button onClick={loadMagazaStok} className="btn-pdf-mini" title="Yenile">🔄</button>
                    </div>
                    <p className="magaza-stok-aciklama">
                      Kalıcı stok — günler arası devir eder.
                    </p>
                    {magazaStokYukleniyor ? (
                      <div style={{ textAlign: 'center', padding: 24, fontSize: 12, color: 'var(--gray-400)' }}>Yükleniyor...</div>
                    ) : magazaStok.length > 0 ? (
                      <div className="magaza-stok-liste">
                        {magazaStok.map(s => (
                          <div key={s.urunKodu} className={`magaza-stok-satir ${s.adet <= 0 ? 'sifir' : s.adet <= 2 ? 'az' : ''}`}>
                            <div className="magaza-stok-kod">{s.urunKodu}</div>
                            <div className="magaza-stok-ad">{s.urunAdi || '—'}</div>
                            <div className={`magaza-stok-adet ${s.adet <= 0 ? 'sifir' : s.adet <= 2 ? 'az' : 'normal'}`}>
                              {s.adet} <span>adet</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--gray-400)', fontSize: 13 }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
                        Henüz stok kaydı yok.<br />
                        <small>Ürün girişi yapınca burası dolar.</small>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

      ) : (

        /* ═══════════════ GEÇMİŞ KAYITLAR ═══════════════ */
        <div className="kasa-gecmis">
          <div className="gecmis-header-row">
            <h2>Geçmiş Kasa Kayıtları {aktifSube ? `— ${aktifSube.ad}` : ''}</h2>
          </div>

          {/* Tarih Filtresi */}
          <div style={{
            display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap',
            padding: '16px 20px', background: 'var(--gray-50)',
            border: '1.5px solid var(--gray-200)', borderRadius: 'var(--r-sm)', marginBottom: 16
          }}>
            {[
              { label: 'Başlangıç Tarihi', field: 'baslangic' as const, max: tarihFiltre.bitis },
              { label: 'Bitiş Tarihi',     field: 'bitis'     as const, min: tarihFiltre.baslangic, max: bugunStrLocal() },
            ].map(({ label, field, max, min }) => (
              <div key={field} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</label>
                <input type="date" value={tarihFiltre[field]} max={max} min={min as any}
                  onChange={e => handleTarihFiltre(field, e.target.value)}
                  style={{ padding: '8px 12px', border: '1.5px solid var(--gray-300)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 13 }} />
              </div>
            ))}
            {!tarihFiltreHata && (
              <div style={{ fontSize: 12, color: 'var(--gray-500)', paddingBottom: 8 }}>{filtreliGecmis().length} kayıt bulundu</div>
            )}
            {tarihFiltreHata && (
              <div style={{ background: 'var(--red-light)', color: 'var(--red)', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid var(--red-border)', width: '100%' }}>
                {tarihFiltreHata}
              </div>
            )}
          </div>

          {!tarihFiltreHata && filtreliGecmis().length > 0 ? (
            <>
              <div className="gecmis-listesi">
                {sayfaGecmis().map(gun => (
                  <div key={gun.id} className="gecmis-kart">
                    <div className="gecmis-kart-header">
                      <h3>{formatGun(gun.gun)}</h3>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button className="btn-pdf-mini" onClick={() => handlePrintPreview(gun)}
                          disabled={printYukleniyor === gun.gun}>
                          {printYukleniyor === gun.gun ? '⏳' : '🖨️ Çıktı Al'}
                        </button>
                        <button className="btn-gecmis-satis" onClick={() => acGecmisDetay(gun)}>🔍 Detay</button>
                        <span className={`gecmis-durum ${gun.durum === 'ACIK' ? 'acik' : 'kapali'}`}>{gun.durum}</span>
                      </div>
                    </div>
                    <div className="gecmis-akis">
                      <div className="gakis-satir"><span>Açılış</span><strong>{formatPrice(gun.acilisBakiyesi)}</strong></div>
                      <div className="gakis-satir giris"><span>+ Nakit Satış</span><strong>{formatPrice(gun.nakitSatis || 0)}</strong></div>
                      <div className="gakis-satir cikis"><span>− Gider</span><strong>{formatPrice(gun.toplamGider || 0)}</strong></div>
                      <div className="gakis-satir cikis"><span>− Çıkış</span><strong>{formatPrice((gun.cikisYapilanPara || 0) + (gun.adminAlimlar || 0))}</strong></div>
                      <div className="gakis-ayirici" />
                      <div className="gakis-satir gunsonu"><span>= Gün Sonu</span><strong>{formatPrice(gun.gunSonuBakiyesi || gun.acilisBakiyesi)}</strong></div>
                    </div>
                    {Object.keys(gun.adminOzet || {}).length > 0 && (
                      <div className="gecmis-admin-ozet">
                        {Object.entries(gun.adminOzet).map(([ad, tutar]) => (
                          <span key={ad}>👤 {ad}: <strong>{formatPrice(tutar as number)}</strong></span>
                        ))}
                      </div>
                    )}
                    <div className="gecmis-kart-footer">
                      <span>Hareketler: {gun.hareketler?.length || 0}</span>
                      <span>Açan: {gun.acilisYapan || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>

              {toplamSayfa() > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 24, flexWrap: 'wrap' }}>
                  <button className="btn-filtre" onClick={() => setGecmisSayfa(p => Math.max(1, p - 1))} disabled={gecmisSayfa === 1} style={{ opacity: gecmisSayfa === 1 ? 0.4 : 1 }}>← Önceki</button>
                  {Array.from({ length: toplamSayfa() }, (_, i) => i + 1).map(p => (
                    <button key={p} className={`btn-filtre ${gecmisSayfa === p ? 'aktif' : ''}`} onClick={() => setGecmisSayfa(p)} style={{ minWidth: 36 }}>{p}</button>
                  ))}
                  <button className="btn-filtre" onClick={() => setGecmisSayfa(p => Math.min(toplamSayfa(), p + 1))} disabled={gecmisSayfa === toplamSayfa()} style={{ opacity: gecmisSayfa === toplamSayfa() ? 0.4 : 1 }}>Sonraki →</button>
                  <span style={{ fontSize: 12, color: 'var(--gray-500)', fontFamily: 'var(--font-mono)' }}>
                    {gecmisSayfa} / {toplamSayfa()} · {filtreliGecmis().length} kayıt
                  </span>
                </div>
              )}
            </>
          ) : !tarihFiltreHata ? (
            <div className="empty-gecmis"><p>Bu tarih aralığında kayıt bulunamadı.</p></div>
          ) : null}
        </div>
      )}

      {/* ══════════════ GEÇMİŞ DETAY MODALİ ══════════════ */}
      {gecmisDetay && (
        <div className="modal-overlay" onClick={() => setGecmisDetay(null)}>
          <div className="modal-kart gecmis-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>📋 {formatGun(gecmisDetay.kasaGun.gun)} — Detaylar</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-pdf-mini" onClick={() => handlePrintPreview(gecmisDetay.kasaGun)} disabled={printYukleniyor === gecmisDetay.kasaGun.gun}>
                  {printYukleniyor === gecmisDetay.kasaGun.gun ? '⏳' : '🖨️ Çıktı Al'}
                </button>
                <button onClick={() => setGecmisDetay(null)} className="modal-kapat">✕</button>
              </div>
            </div>
            <div className="modal-ozet-bant">
              <span>Açılış: <strong>{formatPrice(gecmisDetay.kasaGun.acilisBakiyesi)}</strong></span>
              <span>Nakit: <strong style={{ color: 'var(--green)' }}>{formatPrice(gecmisDetay.kasaGun.nakitSatis || 0)}</strong></span>
              <span>Gider: <strong style={{ color: 'var(--red)' }}>{formatPrice(gecmisDetay.kasaGun.toplamGider || 0)}</strong></span>
              <span>Çıkış: <strong style={{ color: 'var(--amber)' }}>{formatPrice((gecmisDetay.kasaGun.cikisYapilanPara || 0) + (gecmisDetay.kasaGun.adminAlimlar || 0))}</strong></span>
              <span className="gunsonu-badge">Gün Sonu: <strong>{formatPrice(gecmisDetay.kasaGun.gunSonuBakiyesi || 0)}</strong></span>
            </div>
            <div className="modal-tab-bar">
              {(['satislar', 'tahsilatlar', 'hareketler'] as const).map(t => (
                <button key={t} className={`tab-btn ${gecmisDetay.aktifTab === t ? 'aktif' : ''}`}
                  onClick={() => setGecmisDetay(prev => prev ? { ...prev, aktifTab: t } : null)}>
                  {t === 'satislar' ? '🛒 Satışlar' : t === 'tahsilatlar' ? '💰 Tahsilatlar' : '📋 Hareketler'}
                  <span className="tab-badge">
                    {t === 'satislar' ? (gecmisDetay.satisOzet?.satisAdeti ?? '—') :
                     t === 'tahsilatlar' ? (gecmisDetay.tahsilatOzet?.tahsilatAdeti ?? '—') :
                     gecmisDetay.kasaGun.hareketler?.length ?? 0}
                  </span>
                </button>
              ))}
            </div>
            {detayYukleniyor && <div className="loading" style={{ padding: '32px 0' }}>Yükleniyor...</div>}

            {!detayYukleniyor && gecmisDetay.aktifTab === 'satislar' && (
              gecmisDetay.satisOzet?.satislar.length ? (
                <div className="hareket-listesi" style={{ marginTop: 12 }}>
                  <table className="hareket-tablosu">
                    <thead><tr><th>Saat</th><th>Satış Kodu</th><th>Müşteri</th><th>Nakit</th><th>Kart</th><th>Havale</th><th>Toplam</th><th>Durum</th><th>Satıcı</th></tr></thead>
                    <tbody>
                      {gecmisDetay.satisOzet.satislar.map(s => (
                        <tr key={s.id} className="hareket-satir">
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{formatSaat(s.tarih)}</td>
                          <td><span className="tip-badge nakit">{s.satisKodu}</span></td>
                          <td>{s.musteriIsim}</td>
                          <td className="tutar giris">{s.nakitTutar > 0 ? formatPrice(s.nakitTutar) : '—'}</td>
                          <td style={{ color: '#0066cc', fontFamily: 'var(--font-mono)' }}>{s.kartTutar > 0 ? formatPrice(s.kartTutar) : '—'}</td>
                          <td style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>{s.havaleTutar > 0 ? formatPrice(s.havaleTutar) : '—'}</td>
                          <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{formatPrice(s.tutar)}</td>
                          <td><span className={`tip-badge ${s.onayDurumu ? 'nakit' : 'gider'}`}>{s.onayDurumu ? '✅ Onaylı' : '⏳ Bekliyor'}</span></td>
                          <td>{s.kullanici}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="empty-hareket"><p>Bu gün için satış bulunamadı.</p></div>
            )}
            {!detayYukleniyor && gecmisDetay.aktifTab === 'tahsilatlar' && (
              gecmisDetay.tahsilatOzet?.tahsilatlar.length ? (
                <div className="hareket-listesi" style={{ marginTop: 12 }}>
                  <table className="hareket-tablosu">
                    <thead><tr><th>Satış Tarihi</th><th>Satış Kodu</th><th>Müşteri</th><th>Nakit</th><th>Kart</th><th>Havale</th><th>Toplam</th><th>Satıcı</th></tr></thead>
                    <tbody>
                      {gecmisDetay.tahsilatOzet.tahsilatlar.map(s => (
                        <tr key={s.id} className="hareket-satir onceki-gun-odeme">
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--teal)' }}>{s.satisTarihi ? formatGun(s.satisTarihi) : '—'}</td>
                          <td><span className="tip-badge nakit">{s.satisKodu}</span></td>
                          <td>{s.musteriIsim}</td>
                          <td className="tutar giris">{s.nakitTutar > 0 ? formatPrice(s.nakitTutar) : '—'}</td>
                          <td style={{ color: '#0066cc', fontFamily: 'var(--font-mono)' }}>{s.kartTutar > 0 ? formatPrice(s.kartTutar) : '—'}</td>
                          <td style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>{s.havaleTutar > 0 ? formatPrice(s.havaleTutar) : '—'}</td>
                          <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{formatPrice(s.nakitTutar + s.kartTutar + s.havaleTutar)}</td>
                          <td>{s.kullanici}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="empty-hareket"><p>Bu gün için tahsilat bulunamadı.</p></div>
            )}
            {!detayYukleniyor && gecmisDetay.aktifTab === 'hareketler' && (
              gecmisDetay.kasaGun.hareketler?.length ? (
                <div className="hareket-listesi" style={{ marginTop: 12 }}>
                  <table className="hareket-tablosu">
                    <thead><tr><th>Saat</th><th>Tip</th><th>Açıklama</th><th>Tutar</th><th>Kasaya Yansır</th><th>Kullanıcı</th></tr></thead>
                    <tbody>
                      {gecmisDetay.kasaGun.hareketler.map(h => {
                        const yon = kasaYonu(h.tip);
                        return (
                          <tr key={h.id} className={`hareket-satir ${getTipClass(h.tip)}`}>
                            <td>{h.saat}</td>
                            <td><span className={`tip-badge ${getTipClass(h.tip)}`}>{getTipIcon(h.tip)} {h.tip}</span></td>
                            <td>{h.aciklama}</td>
                            <td className={`tutar ${yon}`}>{yon === 'giris' ? '+' : yon === 'cikis' ? '−' : ''}{formatPrice(Math.abs(h.tutar))}</td>
                            <td>{kasayaYansiyor(h.tip) ? <span className="badge-evet">✅ Evet</span> : <span className="badge-hayir">❌ Hayır</span>}</td>
                            <td>{h.kullanici}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <div className="empty-hareket"><p>Bu gün için hareket bulunamadı.</p></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Kasa;