// ===================================================
//  KASA.TSX — SIFIRDAN TAM KASA YONETiM SiSTEMi
//  PDF butonu + tam mantik
// ===================================================

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  KasaGun, KasaHareket, KasaHareketTipi,
  kasayaYansiyor, kasaYonu, ADMIN_LISTESI,
} from '../types/kasa';
import {
  getBugununKasaGunu, kasaHareketEkle, getKasaGecmisi,
  getSatislar, getTahsilatlar, testGunGecisi,
  KasaSatisOzet, KasaTahsilatOzet, KasaSatisDetay,
} from '../services/kasaService';
import { kasaPdfIndir } from '../utils/Kasapdfutils';
import './Kasa.css';

// ─── Tipler ──────────────────────────────────────────────────────────────────

type GecmisFiltre = 'tumzamanlar' | '7gun' | '30gun' | 'buay';
type AktifTab     = 'hareketler'  | 'satislar' | 'tahsilatlar' | 'cikis';

// Sadece manuel eklenebilir tipler
const MANUEL_TIPLER: KasaHareketTipi[] = [
  KasaHareketTipi.GIDER,
  KasaHareketTipi.CIKIS,
  KasaHareketTipi.DIGER,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const bugunStrLocal = (): string => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const formatPrice = (p: number) =>
  new Intl.NumberFormat('tr-TR', {
    style: 'currency', currency: 'TRY', minimumFractionDigits: 2,
  }).format(p);

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

// ─── Detay Modal verisi ───────────────────────────────────────────────────────

interface GecmisDetay {
  kasaGun: KasaGun;
  satisOzet: KasaSatisOzet | null;
  tahsilatOzet: KasaTahsilatOzet | null;
  aktifTab: 'satislar' | 'tahsilatlar' | 'hareketler';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const Kasa: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // ── Ana kasa ──────────────────────────────────────────────────
  const [kasaGun, setKasaGun]   = useState<KasaGun | null>(null);
  const [loading, setLoading]   = useState(true);

  // ── Geçmiş ───────────────────────────────────────────────────
  const [gecmis, setGecmis]               = useState<KasaGun[]>([]);
  const [gecmisGorunuyor, setGecmisGorunuyor] = useState(false);
  const [gecmisFiltre, setGecmisFiltre]   = useState<GecmisFiltre>('tumzamanlar');
  const [gecmisDetay, setGecmisDetay]     = useState<GecmisDetay | null>(null);
  const [detayYukleniyor, setDetayYukleniyor] = useState(false);
  const [pdfYukleniyor, setPdfYukleniyor] = useState<string | null>(null); // gun str

  // ── Bugünkü tablar ────────────────────────────────────────────
  const [aktifTab, setAktifTab] = useState<AktifTab>('hareketler');

  // ── Satışlar ──────────────────────────────────────────────────
  const [satisOzet, setSatisOzet]               = useState<KasaSatisOzet | null>(null);
  const [satisYukleniyor, setSatisYukleniyor]   = useState(false);

  // ── Tahsilatlar ───────────────────────────────────────────────
  const [tahsilatOzet, setTahsilatOzet]               = useState<KasaTahsilatOzet | null>(null);
  const [tahsilatYukleniyor, setTahsilatYukleniyor]   = useState(false);

  // ── Hareket ekleme formu ──────────────────────────────────────
  const [eklemeModu, setEklemeModu]             = useState(false);
  const [hTip, setHTip]                         = useState<KasaHareketTipi>(KasaHareketTipi.GIDER);
  const [hAciklama, setHAciklama]               = useState('');
  const [hTutar, setHTutar]                     = useState<number>(0);
  const [hBelgeNo, setHBelgeNo]                 = useState('');
  const [hNot, setHNot]                         = useState('');
  const [formHata, setFormHata]                 = useState('');

  // ── Admin çıkış formu ─────────────────────────────────────────
  const [adminModu, setAdminModu]               = useState(false);
  const [adminId, setAdminId]                   = useState(ADMIN_LISTESI[0].id);
  const [adminTutar, setAdminTutar]             = useState<number>(0);
  const [adminNot, setAdminNot]                 = useState('');
  const [adminHata, setAdminHata]               = useState('');

  // ── Test paneli ───────────────────────────────────────────────
  const [testAcik, setTestAcik]                 = useState(false);
  const [testTarih, setTestTarih]               = useState('');
  const [testSonuc, setTestSonuc]               = useState('');
  const [testYukleniyor, setTestYukleniyor]     = useState(false);

  // ─────────────────────────────────────────────────────────────
  //  DATA LOAD
  // ─────────────────────────────────────────────────────────────

  const loadKasa = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const gun = await getBugununKasaGunu(
        currentUser.subeKodu,
        `${currentUser.ad} ${currentUser.soyad}`,
      );
      setKasaGun(gun);
      const gecmisData = await getKasaGecmisi(currentUser.subeKodu, 365);
      setGecmis(gecmisData.filter(g => g.gun !== gun?.gun));
    } catch (err) {
      console.error('Kasa yüklenemedi:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  const loadSatislar = useCallback(async () => {
    if (!currentUser || !kasaGun) return;
    setSatisYukleniyor(true);
    try {
      const ozet = await getSatislar(currentUser.subeKodu, 'bugun', kasaGun.gun);
      setSatisOzet(ozet);
    } catch (err) {
      console.error('Satışlar yüklenemedi:', err);
    } finally {
      setSatisYukleniyor(false);
    }
  }, [currentUser, kasaGun]);

  const loadTahsilatlar = useCallback(async () => {
    if (!currentUser || !kasaGun) return;
    setTahsilatYukleniyor(true);
    try {
      const ozet = await getTahsilatlar(currentUser.subeKodu, kasaGun.gun);
      setTahsilatOzet(ozet);
    } catch (err) {
      console.error('Tahsilatlar yüklenemedi:', err);
    } finally {
      setTahsilatYukleniyor(false);
    }
  }, [currentUser, kasaGun]);

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    loadKasa();
  }, [currentUser]);

  useEffect(() => {
    if (aktifTab === 'satislar' && !satisOzet)     loadSatislar();
    if (aktifTab === 'tahsilatlar' && !tahsilatOzet) loadTahsilatlar();
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
        getSatislar(currentUser.subeKodu, 'bugun', gun.gun),
        getTahsilatlar(currentUser.subeKodu, gun.gun),
      ]);
      setGecmisDetay(prev => prev ? { ...prev, satisOzet: sat, tahsilatOzet: tah } : null);
    } catch (err) {
      console.error('Detay yüklenemedi:', err);
    } finally {
      setDetayYukleniyor(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  //  PDF İNDİR
  // ─────────────────────────────────────────────────────────────

  const handlePdfIndir = async (gun: KasaGun) => {
    if (!currentUser) return;
    setPdfYukleniyor(gun.gun);
    try {
      // O günün satış ve tahsilatlarını çek
      const [sat, tah] = await Promise.all([
        getSatislar(currentUser.subeKodu, 'bugun', gun.gun),
        getTahsilatlar(currentUser.subeKodu, gun.gun),
      ]);
      await kasaPdfIndir({
        kasaGun: gun,
        satislar: sat.satislar,
        tahsilatlar: tah.tahsilatlar,
        magazaAdi: 'Tüfekçi Home',
      });
    } catch (err) {
      console.error('PDF oluşturulamadı:', err);
      alert('❌ PDF oluşturulamadı: ' + (err as Error).message);
    } finally {
      setPdfYukleniyor(null);
    }
  };

  // Bugün için PDF
  const handleBugunkuPdf = async () => {
    if (!kasaGun || !currentUser) return;
    setPdfYukleniyor(kasaGun.gun);
    try {
      const sat = satisOzet ?? await getSatislar(currentUser.subeKodu, 'bugun', kasaGun.gun);
      const tah = tahsilatOzet ?? await getTahsilatlar(currentUser.subeKodu, kasaGun.gun);
      await kasaPdfIndir({
        kasaGun,
        satislar: sat.satislar,
        tahsilatlar: tah.tahsilatlar,
        magazaAdi: 'Tüfekçi Home',
      });
    } catch (err) {
      alert('❌ PDF hatası: ' + (err as Error).message);
    } finally {
      setPdfYukleniyor(null);
    }
  };

  // ─────────────────────────────────────────────────────────────
  //  HAREKET EKLE
  // ─────────────────────────────────────────────────────────────

  const handleHareketEkle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !kasaGun?.id) { setFormHata('Kasa günü bulunamadı!'); return; }
    if (!hAciklama.trim())            { setFormHata('Açıklama giriniz!'); return; }
    if (hTutar <= 0)                  { setFormHata("Tutar 0'dan büyük olmalı!"); return; }
    if (!MANUEL_TIPLER.includes(hTip)) { setFormHata('Bu tip manuel eklenemez!'); return; }
    setFormHata('');
    try {
      const ok = await kasaHareketEkle(
        currentUser.subeKodu, kasaGun.id,
        {
          aciklama: hAciklama, tutar: hTutar, tip: hTip,
          belgeNo: hBelgeNo || undefined, not: hNot || undefined,
          tarih: new Date(),
          kullanici: `${currentUser.ad} ${currentUser.soyad}`,
          kullaniciId: currentUser.uid || '',
          subeKodu: currentUser.subeKodu,
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
        currentUser.subeKodu, kasaGun.id,
        {
          aciklama: `${admin.ad} kasadan para aldı`, tutar: adminTutar,
          tip: KasaHareketTipi.ADMIN_ALIM,
          not: adminNot || undefined,
          tarih: new Date(),
          kullanici: `${currentUser.ad} ${currentUser.soyad}`,
          kullaniciId: currentUser.uid || '',
          subeKodu: currentUser.subeKodu,
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
  //  TEST GEÇİŞ
  // ─────────────────────────────────────────────────────────────

  const handleTestGecis = async () => {
    if (!testTarih || !currentUser) return;
    setTestYukleniyor(true); setTestSonuc('');
    try {
      const sonuc = await testGunGecisi(
        currentUser.subeKodu,
        `${currentUser.ad} ${currentUser.soyad}`,
        testTarih,
      );
      setTestSonuc(sonuc.mesaj);
      if (sonuc.basarili && sonuc.kasaGun?.gun === bugunStrLocal()) await loadKasa();
    } catch (err) {
      setTestSonuc('❌ Hata: ' + (err as Error).message);
    } finally {
      setTestYukleniyor(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  //  GEÇMİŞ FİLTRE
  // ─────────────────────────────────────────────────────────────

  const filtreliGecmis = (): KasaGun[] => {
    if (gecmisFiltre === 'tumzamanlar') return gecmis;
    const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
    return gecmis.filter(g => {
      const [y, m, d] = g.gun.split('-').map(Number);
      const t = new Date(y, m - 1, d);
      if (gecmisFiltre === '7gun')  { const s = new Date(bugun); s.setDate(s.getDate() - 7);  return t >= s; }
      if (gecmisFiltre === '30gun') { const s = new Date(bugun); s.setDate(s.getDate() - 30); return t >= s; }
      if (gecmisFiltre === 'buay')  return t.getMonth() === bugun.getMonth() && t.getFullYear() === bugun.getFullYear();
      return true;
    });
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
        </div>
        <div className="kasa-header-right">
          <button onClick={() => setTestAcik(!testAcik)} className="btn-test">🧪 Gece Testi</button>
          <button onClick={() => setGecmisGorunuyor(!gecmisGorunuyor)} className="btn-gecmis">
            {gecmisGorunuyor ? '📋 Günlük Kasa' : '📅 Geçmiş Kayıtlar'}
          </button>
        </div>
      </div>

      {/* ─────────────────────── TEST PANELİ ─────────────────── */}
      {testAcik && (
        <div className="test-panel">
          <div className="test-panel-header">
            <span>🧪 Gece Geçiş Testi</span>
            <small>Seçilen tarihe kasa günü oluşturur, önceki günden bakiye devreder.</small>
          </div>
          <div className="test-panel-body">
            <input type="date" value={testTarih} onChange={e => setTestTarih(e.target.value)} className="test-input" />
            <button onClick={handleTestGecis} disabled={!testTarih || testYukleniyor} className="btn-test-calistir">
              {testYukleniyor ? '⏳ Çalışıyor...' : '▶ Günü Oluştur'}
            </button>
          </div>
          {testSonuc && (
            <div className={`test-sonuc ${testSonuc.startsWith('❌') ? 'hata' : 'basarili'}`}>
              {testSonuc.split('\n').map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </div>
      )}

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
                  {/* Bugün için PDF butonu */}
                  <button
                    className="btn-pdf"
                    onClick={handleBugunkuPdf}
                    disabled={pdfYukleniyor === kasaGun.gun}
                    style={{ marginLeft: 'auto' }}
                  >
                    {pdfYukleniyor === kasaGun.gun ? '⏳ Hazırlanıyor...' : '🖨️ Kasa Çıktısı Al'}
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
                <button
                  className={`tab-btn ${aktifTab === 'hareketler' ? 'aktif' : ''}`}
                  onClick={() => setAktifTab('hareketler')}
                >
                  📋 Gün İçi Hareketler
                  <span className="tab-badge">
                    {kasaGun.hareketler?.filter(h => h.tip !== KasaHareketTipi.ADMIN_ALIM).length || 0}
                  </span>
                </button>
                <button
                  className={`tab-btn ${aktifTab === 'satislar' ? 'aktif' : ''}`}
                  onClick={() => setAktifTab('satislar')}
                >
                  🛒 Satışlar
                  <span className="tab-badge">{satisOzet?.satisAdeti || 0}</span>
                </button>
                <button
                  className={`tab-btn ${aktifTab === 'tahsilatlar' ? 'aktif' : ''}`}
                  onClick={() => setAktifTab('tahsilatlar')}
                >
                  💰 Tahsilatlar
                  <span className="tab-badge">{tahsilatOzet?.tahsilatAdeti || 0}</span>
                </button>
                <button
                  className={`tab-btn ${aktifTab === 'cikis' ? 'aktif' : ''}`}
                  onClick={() => setAktifTab('cikis')}
                >
                  📤 Çıkış
                  <span className="tab-badge admin">
                    {kasaGun.hareketler?.filter(h => h.tip === KasaHareketTipi.ADMIN_ALIM).length || 0}
                  </span>
                </button>
              </div>

              {/* ══════════════════════════════════════════════
                  TAB: HAREKETLER — Gider / Çıkış / Diğer
              ══════════════════════════════════════════════ */}
              {aktifTab === 'hareketler' && (
                <div className="kasa-hareketler">
                  <div className="hareketler-header">
                    <h2>Gün İçi Hareketler</h2>
                    <button onClick={() => { setEklemeModu(!eklemeModu); setFormHata(''); }} className="btn-ekle">
                      {eklemeModu ? '✕ İptal' : '+ Yeni Hareket'}
                    </button>
                  </div>

                  <div className="kasa-bilgi-notu">
                    ℹ️ <strong>Nakit Satış, Kart ve Havale</strong> satışlardan otomatik oluşur.
                    Buraya yalnızca <strong>Gider, Çıkış ve Diğer</strong> eklenebilir.
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
                              <option value={KasaHareketTipi.CIKIS}>📤 Çıkış</option>
                              <option value={KasaHareketTipi.DIGER}>📝 Diğer</option>
                            </select>
                          </div>
                          <div className="form-group">
                            <label>Tutar (TL) *</label>
                            <input
                              type="number" min="0.01" step="0.01"
                              value={hTutar || ''}
                              onChange={e => setHTutar(parseFloat(e.target.value) || 0)}
                              placeholder="0.00" required
                            />
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
                        <thead>
                          <tr>
                            <th>Saat</th><th>Tip</th><th>Açıklama</th>
                            <th>Belge No</th><th>Tutar</th><th>Kasaya Yansır</th><th>Kullanıcı</th>
                          </tr>
                        </thead>
                        <tbody>
                          {kasaGun.hareketler.filter(h => h.tip !== KasaHareketTipi.ADMIN_ALIM).map(h => {
                            const yon = kasaYonu(h.tip);
                            return (
                              <tr key={h.id} className={`hareket-satir ${getTipClass(h.tip)}`}>
                                <td>{h.saat}</td>
                                <td>
                                  <span className={`tip-badge ${getTipClass(h.tip)}`}>
                                    {getTipIcon(h.tip)} {h.tip}
                                  </span>
                                </td>
                                <td>{h.aciklama}</td>
                                <td>{h.belgeNo || '—'}</td>
                                <td className={`tutar ${yon}`}>
                                  {yon === 'giris' ? '+' : yon === 'cikis' ? '−' : ''}
                                  {formatPrice(Math.abs(h.tutar))}
                                </td>
                                <td>
                                  {kasayaYansiyor(h.tip)
                                    ? <span className="badge-evet">✅ Evet</span>
                                    : <span className="badge-hayir">❌ Hayır</span>}
                                </td>
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
                      <small>Gider, Çıkış veya Diğer eklemek için butona tıklayın.</small>
                    </div>
                  )}
                </div>
              )}

              {/* ══════════════════════════════════════════════
                  TAB: SATIŞLAR — sale_date = bugün
              ══════════════════════════════════════════════ */}
              {aktifTab === 'satislar' && (
                <div className="kasa-hareketler">
                  <div className="hareketler-header">
                    <h2>🛒 Satışlar — {formatGun(kasaGun.gun)}</h2>
                    <button onClick={loadSatislar} className="btn-filtre aktif">🔄 Yenile</button>
                  </div>

                  <div className="kasa-bilgi-notu">
                    📦 Bugün kesilmiş satışlar listelenir. Ödeme olmasa bile satış burada görünür.
                    Önceki günlerden gelen ödemeler → <strong>Tahsilatlar</strong> sekmesi.
                  </div>

                  {satisYukleniyor ? (
                    <div className="loading" style={{ padding: '40px 0' }}>Satışlar yükleniyor...</div>
                  ) : satisOzet ? (
                    <>
                      <div className="satis-ozet-grid">
                        <div className="satis-ozet-kart toplam">
                          <span className="satis-ozet-label">📦 Toplam Ciro</span>
                          <span className="satis-ozet-tutar">{formatPrice(satisOzet.toplamTutar)}</span>
                          <span className="satis-ozet-alt">{satisOzet.satisAdeti} satış</span>
                        </div>
                        <div className="satis-ozet-kart nakit">
                          <span className="satis-ozet-label">💵 Nakit Tahsilat</span>
                          <span className="satis-ozet-tutar">{formatPrice(satisOzet.toplamNakit)}</span>
                        </div>
                        <div className="satis-ozet-kart kart">
                          <span className="satis-ozet-label">💳 Kart Tahsilat</span>
                          <span className="satis-ozet-tutar">{formatPrice(satisOzet.toplamKart)}</span>
                        </div>
                        <div className="satis-ozet-kart havale">
                          <span className="satis-ozet-label">🏦 Havale Tahsilat</span>
                          <span className="satis-ozet-tutar">{formatPrice(satisOzet.toplamHavale)}</span>
                        </div>
                      </div>

                      {satisOzet.satislar.length > 0 ? (
                        <div className="hareket-listesi" style={{ marginTop: 16 }}>
                          <table className="hareket-tablosu">
                            <thead>
                              <tr>
                                <th>Saat</th><th>Satış Kodu</th><th>Müşteri</th>
                                <th>Nakit</th><th>Kart</th><th>Havale</th>
                                <th>Satış Tutarı</th><th>Durum</th><th>Satıcı</th>
                              </tr>
                            </thead>
                            <tbody>
                              {satisOzet.satislar.map(s => (
                                <tr key={s.id} className="hareket-satir">
                                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                    {formatSaat(s.tarih)}
                                  </td>
                                  <td><span className="tip-badge nakit">{s.satisKodu}</span></td>
                                  <td>{s.musteriIsim}</td>
                                  <td className="tutar giris">{s.nakitTutar > 0 ? formatPrice(s.nakitTutar) : '—'}</td>
                                  <td style={{ color: '#0066cc' }}>{s.kartTutar > 0 ? formatPrice(s.kartTutar) : '—'}</td>
                                  <td style={{ color: '#666' }}>{s.havaleTutar > 0 ? formatPrice(s.havaleTutar) : '—'}</td>
                                  <td style={{ fontWeight: 700 }}>{formatPrice(s.tutar)}</td>
                                  <td>
                                    <span className={`tip-badge ${s.onayDurumu ? 'nakit' : 'gider'}`}>
                                      {s.onayDurumu ? '✅ Onaylı' : '⏳ Bekliyor'}
                                    </span>
                                  </td>
                                  <td>{s.kullanici}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="empty-hareket"><p>Bugün satış bulunamadı.</p></div>
                      )}
                    </>
                  ) : (
                    <div className="empty-hareket">
                      <button onClick={loadSatislar} className="btn-ekle">Satışları Yükle</button>
                    </div>
                  )}
                </div>
              )}

              {/* ══════════════════════════════════════════════
                  TAB: TAHSİLATLAR — payment_date = bugün, sale_date < bugün
              ══════════════════════════════════════════════ */}
              {aktifTab === 'tahsilatlar' && (
                <div className="kasa-hareketler">
                  <div className="hareketler-header">
                    <h2>💰 Tahsilatlar — Önceki Günlerden Gelen Ödemeler</h2>
                    <span className="tarih-badge">{formatGun(kasaGun.gun)}</span>
                  </div>

                  <div className="kasa-bilgi-notu">
                    📅 Satış tarihi bugünden <strong>önceki</strong>, ödemesi <strong>bugün</strong> alınan kayıtlar.
                    Bu tutarlar bugünün kasa toplamlarına yansır.
                  </div>

                  {tahsilatYukleniyor ? (
                    <div className="loading" style={{ padding: '40px 0' }}>Tahsilatlar yükleniyor...</div>
                  ) : tahsilatOzet && tahsilatOzet.tahsilatlar.length > 0 ? (
                    <>
                      <div className="satis-ozet-grid">
                        <div className="satis-ozet-kart toplam">
                          <span className="satis-ozet-label">💰 Bugün Tahsil Edilen</span>
                          <span className="satis-ozet-tutar">{formatPrice(tahsilatOzet.tahsilatTutar)}</span>
                          <span className="satis-ozet-alt">{tahsilatOzet.tahsilatAdeti} ödeme</span>
                        </div>
                        <div className="satis-ozet-kart nakit">
                          <span className="satis-ozet-label">💵 Nakit</span>
                          <span className="satis-ozet-tutar">{formatPrice(tahsilatOzet.toplamNakit)}</span>
                        </div>
                        <div className="satis-ozet-kart kart">
                          <span className="satis-ozet-label">💳 Kart</span>
                          <span className="satis-ozet-tutar">{formatPrice(tahsilatOzet.toplamKart)}</span>
                        </div>
                        <div className="satis-ozet-kart havale">
                          <span className="satis-ozet-label">🏦 Havale</span>
                          <span className="satis-ozet-tutar">{formatPrice(tahsilatOzet.toplamHavale)}</span>
                        </div>
                      </div>

                      <div className="hareket-listesi" style={{ marginTop: 16 }}>
                        <table className="hareket-tablosu">
                          <thead>
                            <tr>
                              <th>Satış Tarihi</th><th>Satış Kodu</th><th>Müşteri</th>
                              <th>Bugün Nakit</th><th>Bugün Kart</th><th>Bugün Havale</th>
                              <th>Satış Toplamı</th><th>Durum</th><th>Satıcı</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tahsilatOzet.tahsilatlar.map(s => (
                              <tr key={s.id} className="hareket-satir onceki-gun-odeme">
                                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                  <span style={{ fontWeight: 600, color: 'var(--teal)' }}>
                                    {s.satisTarihi ? formatGun(s.satisTarihi) : '—'}
                                  </span>
                                  <br />
                                  <span style={{ fontSize: 10, background: 'rgba(0,153,153,0.1)', color: 'var(--teal)', padding: '2px 6px', borderRadius: 4, display: 'inline-block', marginTop: 2 }}>
                                    önceki günden
                                  </span>
                                </td>
                                <td><span className="tip-badge nakit">{s.satisKodu}</span></td>
                                <td>{s.musteriIsim}</td>
                                <td className="tutar giris">{s.nakitTutar > 0 ? formatPrice(s.nakitTutar) : '—'}</td>
                                <td style={{ color: '#0066cc' }}>{s.kartTutar > 0 ? formatPrice(s.kartTutar) : '—'}</td>
                                <td style={{ color: '#666' }}>{s.havaleTutar > 0 ? formatPrice(s.havaleTutar) : '—'}</td>
                                <td style={{ fontWeight: 700 }}>{formatPrice(s.tutar)}</td>
                                <td>
                                  <span className={`tip-badge ${s.onayDurumu ? 'nakit' : 'gider'}`}>
                                    {s.onayDurumu ? '✅ Onaylı' : '⏳ Bekliyor'}
                                  </span>
                                </td>
                                <td>{s.kullanici}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="empty-hareket">
                      <p>Bugün önceki günlerden gelen tahsilat yok.</p>
                      <small>Tüm ödemeler satış gününde yapılmış.</small>
                    </div>
                  )}
                </div>
              )}

              {/* ══════════════════════════════════════════════
                  TAB: ÇIKIŞ — Admin para alımları
              ══════════════════════════════════════════════ */}
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
                              {ADMIN_LISTESI.map(a => (
                                <option key={a.id} value={a.id}>👤 {a.ad}</option>
                              ))}
                            </select>
                          </div>
                          <div className="form-group">
                            <label>Tutar (TL) *</label>
                            <input
                              type="number" min="0.01" step="0.01"
                              value={adminTutar || ''}
                              onChange={e => setAdminTutar(parseFloat(e.target.value) || 0)}
                              placeholder="0.00" required
                            />
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

                  {/* Admin özet kartları */}
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
                        <thead>
                          <tr><th>Saat</th><th>Admin</th><th>Tutar</th><th>Not</th><th>Kaydeden</th></tr>
                        </thead>
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
            </>
          )}
        </div>

      ) : (

        /* ═══════════════ GEÇMİŞ KAYITLAR ═══════════════ */
        <div className="kasa-gecmis">
          <div className="gecmis-header-row">
            <h2>Geçmiş Kasa Kayıtları</h2>
            <div className="filtre-group">
              {([
                { key: 'tumzamanlar', label: 'Tüm Zamanlar' },
                { key: '30gun',       label: 'Son 30 Gün' },
                { key: '7gun',        label: 'Son 7 Gün' },
                { key: 'buay',        label: 'Bu Ay' },
              ] as { key: GecmisFiltre; label: string }[]).map(f => (
                <button
                  key={f.key}
                  className={`btn-filtre ${gecmisFiltre === f.key ? 'aktif' : ''}`}
                  onClick={() => setGecmisFiltre(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filtreliGecmis().length > 0 ? (
            <div className="gecmis-listesi">
              {filtreliGecmis().map(gun => (
                <div key={gun.id} className="gecmis-kart">
                  <div className="gecmis-kart-header">
                    <h3>{formatGun(gun.gun)}</h3>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {/* PDF Çıktı Al */}
                      <button
                        className="btn-pdf-mini"
                        onClick={() => handlePdfIndir(gun)}
                        disabled={pdfYukleniyor === gun.gun}
                        title="Kasa çıktısı al"
                      >
                        {pdfYukleniyor === gun.gun ? '⏳' : '🖨️ Çıktı Al'}
                      </button>
                      {/* Detay */}
                      <button className="btn-gecmis-satis" onClick={() => acGecmisDetay(gun)}>
                        🔍 Detay
                      </button>
                      <span className={`gecmis-durum ${gun.durum === 'ACIK' ? 'acik' : 'kapali'}`}>
                        {gun.durum}
                      </span>
                    </div>
                  </div>

                  {/* Kasa akış */}
                  <div className="gecmis-akis">
                    <div className="gakis-satir">
                      <span>Açılış</span>
                      <strong>{formatPrice(gun.acilisBakiyesi)}</strong>
                    </div>
                    <div className="gakis-satir giris">
                      <span>+ Nakit Satış</span>
                      <strong>{formatPrice(gun.nakitSatis || 0)}</strong>
                    </div>
                    <div className="gakis-satir cikis">
                      <span>− Gider</span>
                      <strong>{formatPrice(gun.toplamGider || 0)}</strong>
                    </div>
                    <div className="gakis-satir cikis">
                      <span>− Çıkış</span>
                      <strong>{formatPrice((gun.cikisYapilanPara || 0) + (gun.adminAlimlar || 0))}</strong>
                    </div>
                    <div className="gakis-ayirici" />
                    <div className="gakis-satir gunsonu">
                      <span>= Gün Sonu</span>
                      <strong>{formatPrice(gun.gunSonuBakiyesi || gun.acilisBakiyesi)}</strong>
                    </div>
                  </div>

                  {/* Admin özeti */}
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
          ) : (
            <div className="empty-gecmis"><p>Bu filtre için kayıt bulunamadı.</p></div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          GEÇMİŞ DETAY MODALİ (Satışlar / Tahsilatlar / Hareketler)
      ═══════════════════════════════════════════════════ */}
      {gecmisDetay && (
        <div className="modal-overlay" onClick={() => setGecmisDetay(null)}>
          <div className="modal-kart gecmis-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>📋 {formatGun(gecmisDetay.kasaGun.gun)} — Detaylar</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* Modal içinde PDF */}
                <button
                  className="btn-pdf-mini"
                  onClick={() => handlePdfIndir(gecmisDetay.kasaGun)}
                  disabled={pdfYukleniyor === gecmisDetay.kasaGun.gun}
                >
                  {pdfYukleniyor === gecmisDetay.kasaGun.gun ? '⏳' : '🖨️ Çıktı Al'}
                </button>
                <button onClick={() => setGecmisDetay(null)} className="modal-kapat">✕</button>
              </div>
            </div>

            {/* Modal özet */}
            <div className="modal-ozet-bant">
              <span>Açılış: <strong>{formatPrice(gecmisDetay.kasaGun.acilisBakiyesi)}</strong></span>
              <span>Nakit: <strong style={{ color: 'var(--green)' }}>{formatPrice(gecmisDetay.kasaGun.nakitSatis || 0)}</strong></span>
              <span>Gider: <strong style={{ color: 'var(--red)' }}>{formatPrice(gecmisDetay.kasaGun.toplamGider || 0)}</strong></span>
              <span>Çıkış: <strong style={{ color: 'var(--amber)' }}>{formatPrice((gecmisDetay.kasaGun.cikisYapilanPara || 0) + (gecmisDetay.kasaGun.adminAlimlar || 0))}</strong></span>
              <span className="gunsonu-badge">Gün Sonu: <strong>{formatPrice(gecmisDetay.kasaGun.gunSonuBakiyesi || 0)}</strong></span>
            </div>

            {/* Modal tab bar */}
            <div className="modal-tab-bar">
              {(['satislar', 'tahsilatlar', 'hareketler'] as const).map(t => (
                <button
                  key={t}
                  className={`tab-btn ${gecmisDetay.aktifTab === t ? 'aktif' : ''}`}
                  onClick={() => setGecmisDetay(prev => prev ? { ...prev, aktifTab: t } : null)}
                >
                  {t === 'satislar' ? '🛒 Satışlar' : t === 'tahsilatlar' ? '💰 Tahsilatlar' : '📋 Hareketler'}
                  <span className="tab-badge">
                    {t === 'satislar'    ? (gecmisDetay.satisOzet?.satisAdeti ?? '—') :
                     t === 'tahsilatlar' ? (gecmisDetay.tahsilatOzet?.tahsilatAdeti ?? '—') :
                     gecmisDetay.kasaGun.hareketler?.length ?? 0}
                  </span>
                </button>
              ))}
            </div>

            {detayYukleniyor && (
              <div className="loading" style={{ padding: '32px 0' }}>Yükleniyor...</div>
            )}

            {/* Modal: Satışlar */}
            {!detayYukleniyor && gecmisDetay.aktifTab === 'satislar' && (
              gecmisDetay.satisOzet?.satislar.length ? (
                <div className="hareket-listesi" style={{ marginTop: 12 }}>
                  <table className="hareket-tablosu">
                    <thead>
                      <tr>
                        <th>Saat</th><th>Satış Kodu</th><th>Müşteri</th>
                        <th>Nakit</th><th>Kart</th><th>Havale</th><th>Toplam</th><th>Durum</th><th>Satıcı</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gecmisDetay.satisOzet.satislar.map(s => (
                        <tr key={s.id} className="hareket-satir">
                          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{formatSaat(s.tarih)}</td>
                          <td><span className="tip-badge nakit">{s.satisKodu}</span></td>
                          <td>{s.musteriIsim}</td>
                          <td className="tutar giris">{s.nakitTutar > 0 ? formatPrice(s.nakitTutar) : '—'}</td>
                          <td style={{ color: '#0066cc' }}>{s.kartTutar > 0 ? formatPrice(s.kartTutar) : '—'}</td>
                          <td style={{ color: '#666' }}>{s.havaleTutar > 0 ? formatPrice(s.havaleTutar) : '—'}</td>
                          <td style={{ fontWeight: 700 }}>{formatPrice(s.tutar)}</td>
                          <td>
                            <span className={`tip-badge ${s.onayDurumu ? 'nakit' : 'gider'}`}>
                              {s.onayDurumu ? '✅ Onaylı' : '⏳ Bekliyor'}
                            </span>
                          </td>
                          <td>{s.kullanici}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-hareket"><p>Bu gün için satış bulunamadı.</p></div>
              )
            )}

            {/* Modal: Tahsilatlar */}
            {!detayYukleniyor && gecmisDetay.aktifTab === 'tahsilatlar' && (
              gecmisDetay.tahsilatOzet?.tahsilatlar.length ? (
                <div className="hareket-listesi" style={{ marginTop: 12 }}>
                  <table className="hareket-tablosu">
                    <thead>
                      <tr>
                        <th>Satış Tarihi</th><th>Satış Kodu</th><th>Müşteri</th>
                        <th>Nakit</th><th>Kart</th><th>Havale</th><th>Toplam</th><th>Satıcı</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gecmisDetay.tahsilatOzet.tahsilatlar.map(s => (
                        <tr key={s.id} className="hareket-satir onceki-gun-odeme">
                          <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--teal)' }}>
                            {s.satisTarihi ? formatGun(s.satisTarihi) : '—'}
                          </td>
                          <td><span className="tip-badge nakit">{s.satisKodu}</span></td>
                          <td>{s.musteriIsim}</td>
                          <td className="tutar giris">{s.nakitTutar > 0 ? formatPrice(s.nakitTutar) : '—'}</td>
                          <td style={{ color: '#0066cc' }}>{s.kartTutar > 0 ? formatPrice(s.kartTutar) : '—'}</td>
                          <td style={{ color: '#666' }}>{s.havaleTutar > 0 ? formatPrice(s.havaleTutar) : '—'}</td>
                          <td style={{ fontWeight: 700 }}>{formatPrice(s.nakitTutar + s.kartTutar + s.havaleTutar)}</td>
                          <td>{s.kullanici}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-hareket"><p>Bu gün için tahsilat bulunamadı.</p></div>
              )
            )}

            {/* Modal: Hareketler */}
            {!detayYukleniyor && gecmisDetay.aktifTab === 'hareketler' && (
              gecmisDetay.kasaGun.hareketler?.length ? (
                <div className="hareket-listesi" style={{ marginTop: 12 }}>
                  <table className="hareket-tablosu">
                    <thead>
                      <tr><th>Saat</th><th>Tip</th><th>Açıklama</th><th>Tutar</th><th>Kasaya Yansır</th><th>Kullanıcı</th></tr>
                    </thead>
                    <tbody>
                      {gecmisDetay.kasaGun.hareketler.map(h => {
                        const yon = kasaYonu(h.tip);
                        return (
                          <tr key={h.id} className={`hareket-satir ${getTipClass(h.tip)}`}>
                            <td>{h.saat}</td>
                            <td><span className={`tip-badge ${getTipClass(h.tip)}`}>{getTipIcon(h.tip)} {h.tip}</span></td>
                            <td>{h.aciklama}</td>
                            <td className={`tutar ${yon}`}>
                              {yon === 'giris' ? '+' : yon === 'cikis' ? '−' : ''}
                              {formatPrice(Math.abs(h.tutar))}
                            </td>
                            <td>
                              {kasayaYansiyor(h.tip)
                                ? <span className="badge-evet">✅ Evet</span>
                                : <span className="badge-hayir">❌ Hayır</span>}
                            </td>
                            <td>{h.kullanici}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-hareket"><p>Bu gün için hareket bulunamadı.</p></div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Kasa;