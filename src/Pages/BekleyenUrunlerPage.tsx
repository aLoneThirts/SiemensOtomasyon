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

  // Admin: 'TUMU' veya şube kodu. Normal kullanıcı: kendi şubesi (değişmez)
  const [secilenSube, setSecilenSube] = useState<string>('TUMU');

  // Modal state
  const [modalAcik, setModalAcik] = useState(false);
  const [seciliSatis, setSeciliSatis] = useState<SatisTeklifFormu | null>(null);

  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

  // Normal kullanıcı için şube sabit — admin değiştirebilir
  const aktifSubeFiltre = isAdmin ? secilenSube : (currentUser?.subeKodu ?? 'TUMU');

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    fetchIleriTeslimler();
  }, [currentUser]);

  const fetchIleriTeslimler = async () => {
    setLoading(true);
    try {
      const liste: SatisTeklifFormu[] = [];

      // Admin → tüm şubeler; normal kullanıcı → sadece kendi şubesi
      const kullanicıAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';
      const subelerToFetch = kullanicıAdmin
        ? SUBELER
        : SUBELER.filter(s => s.kod === currentUser!.subeKodu);

      for (const sube of subelerToFetch) {
        const snapshot = await getDocs(collection(db, `subeler/${sube.dbPath}/satislar`));
        snapshot.forEach(d => {
          const data = d.data() as SatisTeklifFormu;

          // İptal veya tamamlanmışları atla
          const status = (data as any).satisStatusu;
          if (status === 'TESLIM_EDILDI' || status === 'ILERI_TESLIM_IPTAL') return;

          // SADECE onayı bekleyenler
          if (data.onayDurumu !== false) return;

          // SADECE M.A. teslim tarihi girilmişse
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

  // ── Filtrelenmiş liste (admin dropdown + normal kullanıcı sabit) ──────────
  const filtreliSatislar = aktifSubeFiltre === 'TUMU'
    ? bekleyenSatislar
    : bekleyenSatislar.filter(s => s.subeKodu === aktifSubeFiltre);

  // ── Modal ─────────────────────────────────────────────────────────────────
  const onayModalAc = (satis: SatisTeklifFormu) => {
    setSeciliSatis(satis);
    setModalAcik(true);
  };

  // ── Onayla ───────────────────────────────────────────────────────────────
  const handleOnayla = async () => {
    if (!isAdmin || !seciliSatis) { setModalAcik(false); setSeciliSatis(null); return; }
    const satis = seciliSatis;
    if (!satis.id || !satis.subeKodu) { alert('❌ Satış veya şube bilgisi eksik!'); setModalAcik(false); setSeciliSatis(null); return; }
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube?.dbPath) { alert('❌ Şube bulunamadı!'); setModalAcik(false); setSeciliSatis(null); return; }

    const satisId: string = satis.id;
    setIslemYapiliyor(satisId);
    setModalAcik(false);
    try {
      await updateDoc(doc(db, 'subeler', sube.dbPath, 'satislar', satisId), {
        onayDurumu: true,
        satisStatusu: 'ONAYLANDI',
        guncellemeTarihi: new Date()
      });
      setBekleyenSatislar(prev => prev.filter(s => s.id !== satisId));
      alert('✅ Satış onaylandı!');
    } catch { alert('❌ Onaylama başarısız!'); }
    finally { setIslemYapiliyor(null); setSeciliSatis(null); }
  };

  // ── İleri Teslimden Çıkar ─────────────────────────────────────────────────
  const handleIleriTeslimdenCikar = async (satis: SatisTeklifFormu) => {
    if (!isAdmin || !satis.id || !satis.subeKodu) return;
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube?.dbPath) { alert('❌ Şube bulunamadı!'); return; }
    if (!window.confirm(`"${satis.satisKodu}" ileri teslim listesinden çıkarılsın mı?`)) return;

    const satisId: string = satis.id;
    setIslemYapiliyor(satisId);
    try {
      await updateDoc(doc(db, 'subeler', sube.dbPath, 'satislar', satisId), {
        satisStatusu: 'ILERI_TESLIM_IPTAL',
        ileriTeslimTarihi: null,
        guncellemeTarihi: new Date()
      });
      setBekleyenSatislar(prev => prev.filter(s => s.id !== satisId));
    } catch { alert('❌ İşlem başarısız!'); }
    finally { setIslemYapiliyor(null); }
  };

  // ── Teslim Edildi ─────────────────────────────────────────────────────────
  const handleTeslimEdildi = async (satis: SatisTeklifFormu) => {
    if (!isAdmin || !satis.id || !satis.subeKodu) return;
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube?.dbPath) { alert('❌ Şube bulunamadı!'); return; }

    const satisId: string = satis.id;
    setIslemYapiliyor(satisId);
    try {
      await updateDoc(doc(db, 'subeler', sube.dbPath, 'satislar', satisId), {
        satisStatusu: 'TESLIM_EDILDI',
        teslimEdildiMi: true,
        guncellemeTarihi: new Date()
      });
      setBekleyenSatislar(prev => prev.filter(s => s.id !== satisId));
    } catch { alert('❌ İşlem başarısız!'); }
    finally { setIslemYapiliyor(null); }
  };

  // ── Yardımcılar ───────────────────────────────────────────────────────────
  const toDate = (d: any): Date => d?.toDate ? d.toDate() : new Date(d || 0);

  const formatDate = (date: any) => {
    if (!date) return '-';
    try { return toDate(date).toLocaleDateString('tr-TR'); }
    catch { return '-'; }
  };

  const formatPrice = (n: number | undefined) => {
    if (!n) return '₺0';
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
  };

  const getSubeAdi = (kod: string) => SUBELER.find(s => s.kod === kod)?.ad || kod;

  const getTeslimDurum = (satis: SatisTeklifFormu) => {
    const tarih = (satis as any).ileriTeslimTarihi;
    if (!tarih) return 'normal';
    const fark = Math.ceil((toDate(tarih).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (fark < 0) return 'gecmis';
    if (fark <= 7) return 'yakin';
    return 'normal';
  };

  // Şube sayaçları (admin için dropdown badge'leri)
  const subeSayac = (kod: string) =>
    kod === 'TUMU'
      ? bekleyenSatislar.length
      : bekleyenSatislar.filter(s => s.subeKodu === kod).length;

  const yenileBtn = (
    <button onClick={fetchIleriTeslimler} className="bu-btn-yenile" title="Yenile">
      <i className="fas fa-sync-alt"></i>
    </button>
  );

  return (
    <Layout pageTitle={`İleri Teslim (${filtreliSatislar.length})`} headerExtra={yenileBtn}>

      {/* ── ŞUBe FİLTRE BARI — sadece admin ─────────────────────────────── */}
      {isAdmin && (
        <div className="bu-filtre-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0 8px', flexWrap: 'wrap' }}>

          {/* Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#5f6368', whiteSpace: 'nowrap' }}>
              🏪 Şube:
            </label>
            <select
              value={secilenSube}
              onChange={e => setSecilenSube(e.target.value)}
              style={{
                fontSize: 13, fontWeight: 600, padding: '6px 12px',
                border: '1.5px solid #e0e0e0', borderRadius: 8,
                background: '#fff', color: '#1a1a1a', cursor: 'pointer',
                minWidth: 180,
              }}
            >
              <option value="TUMU">Tüm Şubeler ({subeSayac('TUMU')})</option>
              {SUBELER.map(s => (
                <option key={s.kod} value={s.kod}>
                  {s.ad} ({subeSayac(s.kod)})
                </option>
              ))}
            </select>
          </div>

          {/* Özet sayaçlar */}
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

      {/* ── ONAY MODAL ────────────────────────────────────────────────────── */}
      {modalAcik && (
        <div className="modal-overlay" onClick={() => setModalAcik(false)}>
          <div className="modal-container" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>İşlemi Onayla</h3>
              <button className="modal-close" onClick={() => setModalAcik(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>İşlemi gerçekleştirmek istediğinize emin misiniz?</p>
              {seciliSatis && (
                <div style={{ background: '#f8f9fa', padding: 12, borderRadius: 8, marginTop: 8, fontSize: 13 }}>
                  <div><strong>Satış Kodu:</strong> {seciliSatis.satisKodu}</div>
                  <div><strong>Müşteri:</strong> {seciliSatis.musteriBilgileri?.isim || '-'}</div>
                  <div><strong>Şube:</strong> {getSubeAdi(seciliSatis.subeKodu)}</div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="modal-btn modal-btn-hayir" onClick={() => setModalAcik(false)}>Hayır</button>
              <button className="modal-btn modal-btn-evet" onClick={handleOnayla}>Evet</button>
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
          <p>
            {aktifSubeFiltre === 'TUMU'
              ? 'İleri teslim bekleyen satış bulunmuyor!'
              : `${getSubeAdi(aktifSubeFiltre)} şubesinde ileri teslim yok.`}
          </p>
          <small style={{ color: '#80868b' }}>Tüm ileri teslimler tamamlandı.</small>
        </div>
      ) : (
        <div className="urun-cards">
          {filtreliSatislar.map(satis => {
            const teslimDurum = getTeslimDurum(satis);
            const kar = satis.zarar ?? 0;
            const yukleniyor = islemYapiliyor === satis.id;

            return (
              <div key={satis.id} className={`urun-card bu-satis-kart ${teslimDurum}`}>
                <div className="card-header">
                  <div>
                    <h3 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14 }}>
                      {satis.satisKodu}
                    </h3>
                    {/* Şube adı — admin "Tümü" seçince hangi şube olduğu belli olsun */}
                    <p className="urun-kod" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {getSubeAdi(satis.subeKodu)}
                      {isAdmin && aktifSubeFiltre === 'TUMU' && (
                        <span style={{
                          fontSize: 9, padding: '1px 7px', borderRadius: 10,
                          background: '#e8f4fd', color: '#1565c0',
                          fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase'
                        }}>
                          {satis.subeKodu}
                        </span>
                      )}
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {teslimDurum === 'gecmis' && <span className="durum-badge orange">⚠ TESLİM GEÇTİ</span>}
                    {teslimDurum === 'yakin'  && <span className="durum-badge blue">🔔 YAKLAŞIYOR</span>}
                    {teslimDurum === 'normal' && <span className="durum-badge green">İLERİ TESLİM</span>}
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
                  <div className="info-row">
                    <span className="label">Müşteri</span>
                    <span className="value">{satis.musteriBilgileri?.isim || '-'}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Toplam Tutar</span>
                    <span className="value" style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }}>
                      {formatPrice(satis.toplamTutar)}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="label">Kâr / Zarar</span>
                    <span className="value" style={{ color: kar >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                      {kar >= 0 ? '+' : ''}{formatPrice(kar)}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="label">Satış Tarihi</span>
                    <span className="value">{formatDate(satis.tarih)}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Normal Teslim</span>
                    <span className="value">{formatDate(satis.teslimatTarihi)}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">M.A. Teslim Tarihi</span>
                    <span className="value" style={{
                      fontWeight: 700,
                      color: teslimDurum === 'gecmis' ? '#dc2626' : teslimDurum === 'yakin' ? '#d97706' : '#1d4ed8'
                    }}>
                      {formatDate((satis as any).ileriTeslimTarihi)}
                      <span style={{
                        fontSize: 9, marginLeft: 6,
                        background: '#dbeafe', color: '#1d4ed8',
                        padding: '1px 6px', borderRadius: 10, fontWeight: 600
                      }}>
                        M.A.
                      </span>
                    </span>
                  </div>
                  {((satis as any).notlar || satis.servisNotu) && (
                    <div className="info-row notlar">
                      <span className="label">Not</span>
                      <span className="value">{(satis as any).notlar || satis.servisNotu}</span>
                    </div>
                  )}

                  {satis.urunler && satis.urunler.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e8eaed' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#80868b', textTransform: 'uppercase', marginBottom: 6 }}>
                        Ürünler ({satis.urunler.length})
                      </div>
                      {satis.urunler.map((urun, i) => (
                        <div key={i} style={{
                          display: 'flex', justifyContent: 'space-between',
                          fontSize: 12, padding: '4px 0',
                          borderBottom: i < satis.urunler.length - 1 ? '1px solid #f1f3f4' : 'none',
                          color: '#3c4043'
                        }}>
                          <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#009999' }}>{urun.kod}</span>
                          <span style={{ flex: 1, padding: '0 8px' }}>{urun.ad}</span>
                          <span style={{ fontWeight: 600 }}>{urun.adet} adet</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* BUTONLAR */}
                <div className="card-actions" style={{
                  display: 'flex', justifyContent: 'flex-end', gap: 8,
                  marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16
                }}>
                  <button
                    className="btn-durum hazir"
                    onClick={() => navigate(`/satis-detay/${satis.subeKodu}/${satis.id}`)}
                    disabled={yukleniyor}
                  >
                    Detay
                  </button>
                  {isAdmin && (
                    <>
                      <button className="btn-durum teslim" onClick={() => handleTeslimEdildi(satis)} disabled={yukleniyor}>
                        {yukleniyor ? '...' : '✓ Teslim Edildi'}
                      </button>
                      <button className="btn-durum onayla" onClick={() => onayModalAc(satis)} disabled={yukleniyor}>
                        {yukleniyor ? '...' : '✓ Onayla'}
                      </button>
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
    </Layout>
  );
};

export default BekleyenUrunlerPage;