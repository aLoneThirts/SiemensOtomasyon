import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/user';
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
  const [onaylaniyor, setOnaylaniyor] = useState<string | null>(null);
  const [secilenSube, setSecilenSube] = useState<string>('TUMU');

  const isAdmin = currentUser?.role === UserRole.ADMIN;

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    fetchBekleyenler();
  }, [currentUser]);

  const fetchBekleyenler = async () => {
    setLoading(true);
    try {
      const liste: SatisTeklifFormu[] = [];
      const subelerToFetch = isAdmin
        ? SUBELER
        : SUBELER.filter(s => s.kod === currentUser!.subeKodu);

      for (const sube of subelerToFetch) {
        const snapshot = await getDocs(collection(db, `subeler/${sube.dbPath}/satislar`));
        snapshot.forEach(d => {
          const data = d.data() as SatisTeklifFormu;
          if (data.onayDurumu === false) {
            liste.push({ id: d.id, ...data, subeKodu: sube.kod });
          }
        });
      }

      liste.sort((a: any, b: any) => {
        const tA = a.olusturmaTarihi?.toDate ? a.olusturmaTarihi.toDate() : new Date(a.olusturmaTarihi || 0);
        const tB = b.olusturmaTarihi?.toDate ? b.olusturmaTarihi.toDate() : new Date(b.olusturmaTarihi || 0);
        return tB.getTime() - tA.getTime();
      });

      setBekleyenSatislar(liste);
    } catch (error) {
      console.error('Bekleyen satışlar yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOnayla = async (satis: SatisTeklifFormu) => {
    if (!isAdmin || !satis.id) return;
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube) return;

    setOnaylaniyor(satis.id);
    try {
      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), {
        onayDurumu: true,
        guncellemeTarihi: new Date()
      });
      setBekleyenSatislar(prev => prev.filter(s => s.id !== satis.id));
    } catch {
      alert('❌ Onaylama başarısız!');
    } finally {
      setOnaylaniyor(null);
    }
  };

  const toDate = (d: any): Date => d?.toDate ? d.toDate() : new Date(d || 0);

  const formatDate = (date: any) => {
    if (!date) return '-';
    try { return toDate(date).toLocaleDateString('tr-TR'); }
    catch { return '-'; }
  };

  const formatPrice = (n: number | undefined) => {
    if (!n) return '₺0';
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency', currency: 'TRY', maximumFractionDigits: 0
    }).format(n);
  };

  const getSubeAdi = (kod: string) => SUBELER.find(s => s.kod === kod)?.ad || kod;

  const filtreliSatislar = secilenSube === 'TUMU'
    ? bekleyenSatislar
    : bekleyenSatislar.filter(s => s.subeKodu === secilenSube);

  const getTeslimDurum = (satis: SatisTeklifFormu) => {
    // İleri teslim ise ileriTeslimTarihi'ni kullan, yoksa teslimatTarihi
    const tarihKaynagi = (satis as any).ileriTeslim && (satis as any).ileriTeslimTarihi
      ? (satis as any).ileriTeslimTarihi
      : satis.teslimatTarihi;
    if (!tarihKaynagi) return 'normal';
    const teslim = toDate(tarihKaynagi);
    const bugun = new Date();
    const fark = Math.ceil((teslim.getTime() - bugun.getTime()) / (1000 * 60 * 60 * 24));
    if (fark < 0) return 'gecmis';
    if (fark <= 3) return 'yakin';
    return 'normal';
  };

  const yenileBtn = (
    <button onClick={fetchBekleyenler} className="bu-btn-yenile" title="Yenile">
      <i className="fas fa-sync-alt"></i>
    </button>
  );

  return (
    <Layout pageTitle={`İleri Teslim (${filtreliSatislar.length})`} headerExtra={yenileBtn}>

      {/* FİLTRE - sadece admin */}
      {isAdmin && (
        <div className="bu-filtre-bar">
          <button
            className={`filter-btn ${secilenSube === 'TUMU' ? 'active' : ''}`}
            onClick={() => setSecilenSube('TUMU')}
          >
            Tümü ({bekleyenSatislar.length})
          </button>
          {SUBELER.map(s => (
            <button
              key={s.kod}
              className={`filter-btn ${secilenSube === s.kod ? 'active' : ''}`}
              onClick={() => setSecilenSube(s.kod)}
            >
              {s.ad} ({bekleyenSatislar.filter(x => x.subeKodu === s.kod).length})
            </button>
          ))}
        </div>
      )}

      {/* İÇERİK */}
      {loading ? (
        <div className="loading">Yükleniyor...</div>
      ) : filtreliSatislar.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <p>Bekleyen satış bulunmuyor!</p>
          <small style={{ color: '#80868b' }}>Tüm satışlar onaylandı.</small>
        </div>
      ) : (
        <div className="urun-cards">
          {filtreliSatislar.map(satis => {
            const teslimDurum = getTeslimDurum(satis);
            const kar = satis.zarar ?? 0;
            const yukleniyor = onaylaniyor === satis.id;

            // İleri teslim ise M.A. tarihini göster, değilse normal teslimat tarihi
            const ileriTeslimVar = (satis as any).ileriTeslim && (satis as any).ileriTeslimTarihi;
            const gosterilecekTeslimTarihi = ileriTeslimVar
              ? (satis as any).ileriTeslimTarihi
              : satis.teslimatTarihi;
            const teslimTarihiLabel = ileriTeslimVar ? 'M.A. Teslim Tarihi' : 'Teslim Tarihi';

            return (
              <div key={satis.id} className={`urun-card bu-satis-kart ${teslimDurum}`}>
                <div className="card-header">
                  <div>
                    <h3 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14 }}>
                      {satis.satisKodu}
                    </h3>
                    <p className="urun-kod">{getSubeAdi(satis.subeKodu)}</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {teslimDurum === 'gecmis' && <span className="durum-badge orange">⚠ TESLİM GEÇTİ</span>}
                    {teslimDurum === 'yakin' && <span className="durum-badge blue">🔔 YAKLAŞIYOR</span>}
                    {teslimDurum === 'normal' && <span className="durum-badge green">BEKLEMEDE</span>}
                    <span className="durum-badge" style={{
                      background: satis.odemeDurumu === OdemeDurumu.ODENDI ? '#f0fdf4' : '#fffbeb',
                      color: satis.odemeDurumu === OdemeDurumu.ODENDI ? '#16a34a' : '#d97706',
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
                  {/* ✅ İleri teslim varsa M.A. Teslim Tarihi, yoksa normal Teslim Tarihi */}
                  <div className="info-row">
                    <span className="label">{teslimTarihiLabel}</span>
                    <span className="value" style={{
                      fontWeight: 700,
                      color: teslimDurum === 'gecmis' ? '#dc2626' : teslimDurum === 'yakin' ? '#d97706' : undefined
                    }}>
                      {formatDate(gosterilecekTeslimTarihi)}
                      {ileriTeslimVar && (
                        <span style={{ fontSize: 10, marginLeft: 6, background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: 10, fontWeight: 600 }}>
                          İLERİ TESLİM
                        </span>
                      )}
                    </span>
                  </div>
                  {(satis as any).notlar && (
                    <div className="info-row notlar">
                      <span className="label">Not</span>
                      <span className="value">{(satis as any).notlar}</span>
                    </div>
                  )}
                  {!((satis as any).notlar) && satis.servisNotu && (
                    <div className="info-row notlar">
                      <span className="label">Not</span>
                      <span className="value">{satis.servisNotu}</span>
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

                <div className="card-actions">
                  <button
                    className="btn-durum hazir"
                    onClick={() => navigate(`/satis-detay/${satis.subeKodu}/${satis.id}`)}
                  >
                    Detay Görüntüle
                  </button>
                  {isAdmin && (
                    <button
                      className="btn-durum teslim"
                      onClick={() => handleOnayla(satis)}
                      disabled={yukleniyor}
                    >
                      {yukleniyor ? '...' : '✓ Onayla'}
                    </button>
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