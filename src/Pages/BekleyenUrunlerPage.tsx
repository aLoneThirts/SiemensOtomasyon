import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, OdemeDurumu } from '../types/satis';
import { getSubeByKod, SUBELER } from '../types/sube';
import Layout from '../components/Layout';
import './BekleyenUrunler.css';

const BekleyenUrunlerPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [bekleyenSatislar, setBekleyenSatislar] = useState<SatisTeklifFormu[]>([]);
  const [loading, setLoading] = useState(true);
  const [islemYapiliyor, setIslemYapiliyor] = useState<string | null>(null);

  const [secilenSube, setSecilenSube] = useState<string>('TUMU');

  // Satış tarihi filtresi
  const [tarihFiltreBas, setTarihFiltreBas] = useState<string>('');
  const [tarihFiltreSon, setTarihFiltreSon] = useState<string>('');

  // Sayfalama
  const [aktifSayfa, setAktifSayfa] = useState<number>(1);
  const SAYFA_BOYUTU = 12;

  // Onay modal
  const [onayModalAcik, setOnayModalAcik] = useState(false);
  const [seciliSatis, setSeciliSatis] = useState<SatisTeklifFormu | null>(null);

  // Teslim edildi confirm modal
  const [teslimModalAcik, setTeslimModalAcik] = useState(false);
  const [teslimSeciliSatis, setTeslimSeciliSatis] = useState<SatisTeklifFormu | null>(null);

  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';
  const aktifSubeFiltre = isAdmin ? secilenSube : (currentUser?.subeKodu ?? 'TUMU');

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    fetchIleriTeslimler();
  }, [currentUser]);

  // ─────────────────────────────────────────────────────────────────────────
  // 1.1 İLERİ TESLİME GİRME ŞARTI:
  //   - musteriyleAnlasilanTeslimTarihi (ileriTeslimTarihi) dolu olacak
  //   - Satış iptal değil olacak
  //   - Başka şart YOK (onay durumu, ödeme durumu önemli değil)
  // ─────────────────────────────────────────────────────────────────────────
  const fetchIleriTeslimler = async () => {
    setLoading(true);
    try {
      const liste: SatisTeklifFormu[] = [];
      const kullanicıAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';
      const subelerToFetch = kullanicıAdmin
        ? SUBELER
        : SUBELER.filter(s => s.kod === currentUser!.subeKodu);

      for (const sube of subelerToFetch) {
        const snapshot = await getDocs(collection(db, `subeler/${sube.dbPath}/satislar`));
        snapshot.forEach(d => {
          const data = d.data() as SatisTeklifFormu;

          // ❌ İptal edilmişleri at
          const satisDurumu = (data as any).satisDurumu;
          if (satisDurumu === 'IPTAL') return;

          // ✅ ileriTeslimTarihi (musteriyleAnlasilanTeslimTarihi) dolu olmalı — başka şart yok
          if (!(data as any).ileriTeslimTarihi) return;

          liste.push({ id: d.id, ...data, subeKodu: sube.kod } as any);
        });
      }

      // En yakın M.A. teslim tarihi önce
      liste.sort((a: any, b: any) => {
        const toD = (v: any) => v?.toDate ? v.toDate() : new Date(v || 0);
        return toD(a.ileriTeslimTarihi).getTime() - toD(b.ileriTeslimTarihi).getTime();
      });

      setBekleyenSatislar(liste);
    } catch (error) {
      console.error('İleri teslimler yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const toDate = (d: any): Date => d?.toDate ? d.toDate() : new Date(d || 0);

  const filtreliSatislar = bekleyenSatislar
    .filter(s => aktifSubeFiltre === 'TUMU' || s.subeKodu === aktifSubeFiltre)
    .filter(s => {
      if (!tarihFiltreBas && !tarihFiltreSon) return true;
      const satisTarihi = s.tarih ? toDate(s.tarih).toISOString().slice(0, 10) : '';
      if (tarihFiltreBas && satisTarihi < tarihFiltreBas) return false;
      if (tarihFiltreSon && satisTarihi > tarihFiltreSon) return false;
      return true;
    });

  const toplamSayfa = Math.ceil(filtreliSatislar.length / SAYFA_BOYUTU);
  const sayfaliSatislar = filtreliSatislar.slice((aktifSayfa - 1) * SAYFA_BOYUTU, aktifSayfa * SAYFA_BOYUTU);

  // Filtre değişince sayfa 1'e dön
  const resetSayfa = () => setAktifSayfa(1);

  // ─────────────────────────────────────────────────────────────────────────
  // 1.5 ONAYLA — sadece ileriTeslimOnay = false ise görünür
  //   Admin onayladığında: ileriTeslimOnay = true, onay butonu kaybolur
  //   onayDurumu (genel satış onayı) ile KARIŞMAMALI — ayrı field
  // ─────────────────────────────────────────────────────────────────────────
  const onayModalAc = (satis: SatisTeklifFormu) => {
    setSeciliSatis(satis);
    setOnayModalAcik(true);
  };

  const handleIleriTeslimOnayla = async () => {
    if (!isAdmin || !seciliSatis) { setOnayModalAcik(false); setSeciliSatis(null); return; }
    const satis = seciliSatis;
    if (!satis.id || !satis.subeKodu) { alert('❌ Satış veya şube bilgisi eksik!'); setOnayModalAcik(false); setSeciliSatis(null); return; }
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube?.dbPath) { alert('❌ Şube bulunamadı!'); setOnayModalAcik(false); setSeciliSatis(null); return; }

    const satisId: string = satis.id;
    setIslemYapiliyor(satisId);
    setOnayModalAcik(false);
    try {
      // ✅ ileriTeslimOnay ayrı field — genel onayDurumu'na dokunulmuyor
      await updateDoc(doc(db, 'subeler', sube.dbPath, 'satislar', satisId), {
        ileriTeslimOnay: true,
        guncellemeTarihi: new Date()
      });
      // Listeden kaldırma: onaylananlar hâlâ listede kalır (1.2'ye göre sadece iptal düşürür)
      // Sadece local state güncelle
      setBekleyenSatislar(prev => prev.map(s =>
        s.id === satisId ? { ...s, ileriTeslimOnay: true } as any : s
      ));
      alert('✅ İleri teslim onaylandı!');
    } catch { alert('❌ Onaylama başarısız!'); }
    finally { setIslemYapiliyor(null); setSeciliSatis(null); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 1.6 TESLİM EDİLDİ — sadece admin, confirm zorunlu
  //   Backend: role kontrolü (admin değilse işlem yapılmaz)
  // ─────────────────────────────────────────────────────────────────────────
  const teslimModalAc = (satis: SatisTeklifFormu) => {
    setTeslimSeciliSatis(satis);
    setTeslimModalAcik(true);
  };

  const handleTeslimEdildiOnayla = async () => {
    const satis = teslimSeciliSatis;
    if (!satis || !satis.id || !satis.subeKodu) { setTeslimModalAcik(false); setTeslimSeciliSatis(null); return; }
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube?.dbPath) { alert('❌ Şube bulunamadı!'); setTeslimModalAcik(false); setTeslimSeciliSatis(null); return; }

    const satisId: string = satis.id;
    setIslemYapiliyor(satisId);
    setTeslimModalAcik(false);
    try {
      await updateDoc(doc(db, 'subeler', sube.dbPath, 'satislar', satisId), {
        teslimEdildiMi: true,
        guncellemeTarihi: new Date()
      });
      // Teslim edildi → listeden çıkmaz (sadece iptal çıkarır), local state güncelle
      setBekleyenSatislar(prev => prev.map(s =>
        s.id === satisId ? { ...s, teslimEdildiMi: true } as any : s
      ));
      alert('✅ Teslim edildi olarak işaretlendi!');
    } catch { alert('❌ İşlem başarısız!'); }
    finally { setIslemYapiliyor(null); setTeslimSeciliSatis(null); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Listeden Çıkar — sadece admin, iptal ile aynı sonuç (listeden düşer)
  // ─────────────────────────────────────────────────────────────────────────
  const handleIleriTeslimdenCikar = async (satis: SatisTeklifFormu) => {
    if (!isAdmin || !satis.id || !satis.subeKodu) return;
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube?.dbPath) { alert('❌ Şube bulunamadı!'); return; }
    if (!window.confirm(`"${satis.satisKodu}" ileri teslim listesinden çıkarılsın mı?\n\nBu işlem ileriTeslimTarihi'ni temizleyecektir.`)) return;

    const satisId: string = satis.id;
    setIslemYapiliyor(satisId);
    try {
      await updateDoc(doc(db, 'subeler', sube.dbPath, 'satislar', satisId), {
        ileriTeslimTarihi: null,
        ileriTeslim: false,
        ileriTeslimOnay: false,
        guncellemeTarihi: new Date()
      });
      // ileriTeslimTarihi null → listeden düşer
      setBekleyenSatislar(prev => prev.filter(s => s.id !== satisId));
    } catch { alert('❌ İşlem başarısız!'); }
    finally { setIslemYapiliyor(null); }
  };

  // ── Yardımcılar ───────────────────────────────────────────────────────────
  const formatDate = (date: any) => { if (!date) return '-'; try { return toDate(date).toLocaleDateString('tr-TR'); } catch { return '-'; } };
  const formatPrice = (n: number | undefined) => { if (!n) return '₺0'; return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n); };
  const getSubeAdi = (kod: string) => SUBELER.find(s => s.kod === kod)?.ad || kod;

  const getTeslimDurum = (satis: SatisTeklifFormu) => {
    const tarih = (satis as any).ileriTeslimTarihi;
    if (!tarih) return 'normal';
    const fark = Math.ceil((toDate(tarih).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (fark < 0) return 'gecmis';
    if (fark <= 7) return 'yakin';
    return 'normal';
  };

  const subeSayac = (kod: string) => kod === 'TUMU' ? bekleyenSatislar.length : bekleyenSatislar.filter(s => s.subeKodu === kod).length;

  const yenileBtn = (
    <button onClick={fetchIleriTeslimler} className="bu-btn-yenile" title="Yenile">
      <i className="fas fa-sync-alt"></i>
    </button>
  );

  return (
    <Layout pageTitle={`İleri Teslim (${filtreliSatislar.length})`} headerExtra={yenileBtn}>

      {/* ── ŞUBE FİLTRE BARI — sadece admin ──────────────────────────────── */}
      {isAdmin && (
        <div className="bu-filtre-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0 8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#5f6368', whiteSpace: 'nowrap' }}>🏪 Şube:</label>
            <select value={secilenSube} onChange={e => { setSecilenSube(e.target.value); resetSayfa(); }}
              style={{ fontSize: 13, fontWeight: 600, padding: '6px 12px', border: '1.5px solid #e0e0e0', borderRadius: 8, background: '#fff', color: '#1a1a1a', cursor: 'pointer', minWidth: 180 }}>
              <option value="TUMU">Tüm Şubeler ({subeSayac('TUMU')})</option>
              {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad} ({subeSayac(s.kod)})</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {bekleyenSatislar.filter(s => getTeslimDurum(s) === 'gecmis').length > 0 && (
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: '#fee2e2', color: '#dc2626', fontWeight: 700 }}>
                ⚠ {bekleyenSatislar.filter(s => getTeslimDurum(s) === 'gecmis').length} gecikmiş
              </span>
            )}
            {bekleyenSatislar.filter(s => getTeslimDurum(s) === 'yakin').length > 0 && (
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: '#fffbeb', color: '#d97706', fontWeight: 700 }}>
                🔔 {bekleyenSatislar.filter(s => getTeslimDurum(s) === 'yakin').length} yaklaşıyor
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── SATIŞ TARİHİ FİLTRESİ — tüm kullanıcılar ─────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#5f6368', whiteSpace: 'nowrap' }}>📅 Satış Tarihi:</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="date"
            value={tarihFiltreBas}
            onChange={e => { setTarihFiltreBas(e.target.value); resetSayfa(); }}
            style={{ fontSize: 13, padding: '5px 10px', border: '1.5px solid #e0e0e0', borderRadius: 8, background: '#fff', color: '#1a1a1a' }}
          />
          <span style={{ fontSize: 12, color: '#888' }}>—</span>
          <input
            type="date"
            value={tarihFiltreSon}
            onChange={e => { setTarihFiltreSon(e.target.value); resetSayfa(); }}
            style={{ fontSize: 13, padding: '5px 10px', border: '1.5px solid #e0e0e0', borderRadius: 8, background: '#fff', color: '#1a1a1a' }}
          />
          {(tarihFiltreBas || tarihFiltreSon) && (
            <button
              onClick={() => { setTarihFiltreBas(''); setTarihFiltreSon(''); resetSayfa(); }}
              style={{ fontSize: 12, padding: '5px 10px', border: '1.5px solid #e0e0e0', borderRadius: 8, background: '#f5f5f5', color: '#555', cursor: 'pointer' }}
            >✕ Temizle</button>
          )}
        </div>
      </div>

      {/* ── ONAYLA MODAL ──────────────────────────────────────────────────── */}
      {onayModalAcik && (
        <div className="modal-overlay" onClick={() => setOnayModalAcik(false)}>
          <div className="modal-container" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>İleri Teslimi Onayla</h3>
              <button className="modal-close" onClick={() => setOnayModalAcik(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>Bu satışın ileri teslimini onaylamak istediğinize emin misiniz?</p>
              {seciliSatis && (
                <div style={{ background: '#f8f9fa', padding: 12, borderRadius: 8, marginTop: 8, fontSize: 13 }}>
                  <div><strong>Satış Kodu:</strong> {seciliSatis.satisKodu}</div>
                  <div><strong>Müşteri:</strong> {seciliSatis.musteriBilgileri?.isim || '-'}</div>
                  <div><strong>Şube:</strong> {getSubeAdi(seciliSatis.subeKodu)}</div>
                  <div style={{ marginTop: 6, padding: '6px 10px', background: '#eff6ff', borderRadius: 6, color: '#1e40af', fontSize: 12, fontWeight: 600 }}>
                    ℹ️ Bu işlem yalnızca ileri teslim onayıdır. Genel satış onayı etkilenmez.
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="modal-btn modal-btn-hayir" onClick={() => setOnayModalAcik(false)}>Hayır</button>
              <button className="modal-btn modal-btn-evet" onClick={handleIleriTeslimOnayla}>Evet, Onayla</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TESLİM EDİLDİ CONFIRM MODAL ──────────────────────────────────── */}
      {teslimModalAcik && (
        <div className="modal-overlay" onClick={() => setTeslimModalAcik(false)}>
          <div className="modal-container" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Teslim Edildi Onayı</h3>
              <button className="modal-close" onClick={() => setTeslimModalAcik(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontWeight: 600, fontSize: 15 }}>Teslim edildi olarak işaretlemek istediğinizden emin misiniz?</p>
              {teslimSeciliSatis && (
                <div style={{ background: '#fffbeb', padding: 12, borderRadius: 8, marginTop: 8, fontSize: 13, border: '1px solid #fde68a' }}>
                  <div><strong>Satış Kodu:</strong> {teslimSeciliSatis.satisKodu}</div>
                  <div><strong>Müşteri:</strong> {teslimSeciliSatis.musteriBilgileri?.isim || '-'}</div>
                  <div><strong>M.A. Teslim:</strong> {formatDate((teslimSeciliSatis as any).ileriTeslimTarihi)}</div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="modal-btn modal-btn-hayir" onClick={() => { setTeslimModalAcik(false); setTeslimSeciliSatis(null); }}>Hayır, Vazgeç</button>
              <button className="modal-btn modal-btn-evet" style={{ background: '#d97706' }} onClick={handleTeslimEdildiOnayla}>✓ Evet, Teslim Edildi</button>
            </div>
          </div>
        </div>
      )}

      {/* ── İÇERİK ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="loading">Yükleniyor...</div>
      ) : filtreliSatislar.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <p>{aktifSubeFiltre === 'TUMU' ? 'İleri teslim bekleyen satış bulunmuyor!' : `${getSubeAdi(aktifSubeFiltre)} şubesinde ileri teslim yok.`}</p>
          <small style={{ color: '#80868b' }}>Tüm ileri teslimler tamamlandı.</small>
        </div>
      ) : (
        <div className="urun-cards">
          {sayfaliSatislar.map(satis => {
            const teslimDurum = getTeslimDurum(satis);
            const kar = satis.zarar ?? 0;
            const yukleniyor = islemYapiliyor === satis.id;
            // 1.5: ileriTeslimOnay field'ı — genel onayDurumu değil
            const ileriTeslimOnaylandi = (satis as any).ileriTeslimOnay === true;
            const teslimEdildi = (satis as any).teslimEdildiMi === true;

            return (
              <div key={satis.id} className={`urun-card bu-satis-kart ${teslimDurum}`}>
                <div className="card-header">
                  <div>
                    <h3 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14 }}>{satis.satisKodu}</h3>
                    <p className="urun-kod" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {getSubeAdi(satis.subeKodu)}
                      {isAdmin && aktifSubeFiltre === 'TUMU' && (
                        <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 10, background: '#e8f4fd', color: '#1565c0', fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                          {satis.subeKodu}
                        </span>
                      )}
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {teslimDurum === 'gecmis' && <span className="durum-badge orange">⚠ TESLİM GEÇTİ</span>}
                    {teslimDurum === 'yakin'  && <span className="durum-badge blue">🔔 YAKLAŞIYOR</span>}
                    {teslimDurum === 'normal' && <span className="durum-badge green">İLERİ TESLİM</span>}

                    {/* İleri teslim onay badge — genel onaydan ayrı */}
                    {ileriTeslimOnaylandi ? (
                      <span className="durum-badge" style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>✅ İT. ONAYLANDI</span>
                    ) : (
                      <span className="durum-badge" style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>⏳ İT. ONAY BEKLİYOR</span>
                    )}

                    {/* Teslim edildi badge */}
                    {teslimEdildi && (
                      <span className="durum-badge" style={{ background: '#fef08a', color: '#854d0e', border: '1px solid #fde047', fontWeight: 700 }}>📦 TESLİM EDİLDİ</span>
                    )}

                    <span className="durum-badge" style={{
                      background: satis.odemeDurumu === OdemeDurumu.ODENDI ? '#f0fdf4' : '#fffbeb',
                      color:      satis.odemeDurumu === OdemeDurumu.ODENDI ? '#16a34a' : '#d97706',
                      border: `1px solid ${satis.odemeDurumu === OdemeDurumu.ODENDI ? '#bbf7d0' : '#fde68a'}`
                    }}>
                      {satis.odemeDurumu === OdemeDurumu.ODENDI ? 'ÖDENDİ' : 'AÇIK HESAP'}
                    </span>
                  </div>
                </div>

                <div className="card-body">
                  <div className="info-row"><span className="label">Müşteri</span><span className="value">{satis.musteriBilgileri?.isim || '-'}</span></div>
                  <div className="info-row">
                    <span className="label">Toplam Tutar</span>
                    <span className="value" style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }}>{formatPrice(satis.toplamTutar)}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Kâr / Zarar</span>
                    <span className="value" style={{ color: kar >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{kar >= 0 ? '+' : ''}{formatPrice(kar)}</span>
                  </div>
                  <div className="info-row"><span className="label">Satış Tarihi</span><span className="value">{formatDate(satis.tarih)}</span></div>
                  <div className="info-row"><span className="label">Normal Teslim</span><span className="value">{formatDate(satis.teslimatTarihi)}</span></div>
                  <div className="info-row">
                    <span className="label">M.A. Teslim Tarihi</span>
                    <span className="value" style={{ fontWeight: 700, color: teslimDurum === 'gecmis' ? '#dc2626' : teslimDurum === 'yakin' ? '#d97706' : '#1d4ed8' }}>
                      {formatDate((satis as any).ileriTeslimTarihi)}
                      <span style={{ fontSize: 9, marginLeft: 6, background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: 10, fontWeight: 600 }}>M.A.</span>
                    </span>
                  </div>
                  {((satis as any).notlar || satis.servisNotu) && (
                    <div className="info-row notlar"><span className="label">Not</span><span className="value">{(satis as any).notlar || satis.servisNotu}</span></div>
                  )}
                  {satis.urunler && satis.urunler.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e8eaed' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#80868b', textTransform: 'uppercase', marginBottom: 6 }}>Ürünler ({satis.urunler.length})</div>
                      {satis.urunler.map((urun, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: i < satis.urunler.length - 1 ? '1px solid #f1f3f4' : 'none', color: '#3c4043' }}>
                          <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#009999' }}>{urun.kod}</span>
                          <span style={{ flex: 1, padding: '0 8px' }}>{urun.ad}</span>
                          <span style={{ fontWeight: 600 }}>{urun.adet} adet</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── BUTONLAR ──────────────────────────────────────────────────────── */}
                {/* Detay + Teslim Edildi: herkes | Onayla + Listeden Çıkar: sadece admin */}
                <div className="card-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
                  {/* Detay: herkes */}
                  <button className="btn-durum hazir" onClick={() => navigate(`/satis-detay/${satis.subeKodu}/${satis.id}`)} disabled={yukleniyor}>
                    Detay
                  </button>

                  {/* Teslim Edildi: tüm kullanıcılar (normal user dahil), confirm modal ile */}
                  {!teslimEdildi && (
                    <button className="btn-durum teslim" onClick={() => teslimModalAc(satis)} disabled={yukleniyor}>
                      {yukleniyor ? '...' : '📦 Teslim Edildi'}
                    </button>
                  )}

                  {/* Admin-only butonlar */}
                  {isAdmin && (
                    <>
                      {/* Onayla: sadece ileriTeslimOnay=false ise göster */}
                      {!ileriTeslimOnaylandi && (
                        <button className="btn-durum onayla" onClick={() => onayModalAc(satis)} disabled={yukleniyor}>
                          {yukleniyor ? '...' : '✓ İT. Onayla'}
                        </button>
                      )}
                      <button className="btn-durum cikar" onClick={() => handleIleriTeslimdenCikar(satis)} disabled={yukleniyor}>
                        {yukleniyor ? '...' : '✕ Listeden Çıkar'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SAYFALAMA ────────────────────────────────────────────────── */}
      {toplamSayfa > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '20px 0 8px' }}>
          <button
            onClick={() => setAktifSayfa(p => Math.max(1, p - 1))}
            disabled={aktifSayfa === 1}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1.5px solid #e0e0e0', background: aktifSayfa === 1 ? '#f5f5f5' : '#fff', color: aktifSayfa === 1 ? '#bbb' : '#333', cursor: aktifSayfa === 1 ? 'default' : 'pointer', fontWeight: 600, fontSize: 13 }}
          >‹ Önceki</button>

          {Array.from({ length: toplamSayfa }, (_, i) => i + 1).map(sayfa => (
            <button
              key={sayfa}
              onClick={() => setAktifSayfa(sayfa)}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid', borderColor: aktifSayfa === sayfa ? '#1a73e8' : '#e0e0e0', background: aktifSayfa === sayfa ? '#1a73e8' : '#fff', color: aktifSayfa === sayfa ? '#fff' : '#333', cursor: 'pointer', fontWeight: 700, fontSize: 13, minWidth: 36 }}
            >{sayfa}</button>
          ))}

          <button
            onClick={() => setAktifSayfa(p => Math.min(toplamSayfa, p + 1))}
            disabled={aktifSayfa === toplamSayfa}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1.5px solid #e0e0e0', background: aktifSayfa === toplamSayfa ? '#f5f5f5' : '#fff', color: aktifSayfa === toplamSayfa ? '#bbb' : '#333', cursor: aktifSayfa === toplamSayfa ? 'default' : 'pointer', fontWeight: 600, fontSize: 13 }}
          >Sonraki ›</button>

          <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>
            {(aktifSayfa - 1) * SAYFA_BOYUTU + 1}–{Math.min(aktifSayfa * SAYFA_BOYUTU, filtreliSatislar.length)} / {filtreliSatislar.length} kayıt
          </span>
        </div>
      )}
    </Layout>
  );
};

export default BekleyenUrunlerPage;