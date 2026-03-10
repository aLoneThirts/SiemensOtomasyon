import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs, doc, updateDoc, getDoc, Timestamp, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu } from '../types/satis';
import { getSubeByKod, SUBELER } from '../types/sube';
import Layout from '../components/Layout';
import SatisDetayIcerik from '../components/SatisDetayIcerik';
import SatisDuzenleIcerik from '../components/SatisDuzenleIcerik';
import './KontrolEt.css';
import './SatisDetay.css';

const SAYFA_BOYUTU = 10;
type DrawerMod = 'goruntule' | 'duzenle';

const KontrolEt: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [satislar, setSatislar] = useState<SatisTeklifFormu[]>([]);
  const [loading, setLoading] = useState(true);
  const [guncellemeyorum, setGuncellemeyorum] = useState<string | null>(null);
  const [sonOnaylananAcik, setSonOnaylananAcik] = useState(true);
  const [bekleyenAcik, setBekleyenAcik] = useState(true);
  const [iptalAcik, setIptalAcik] = useState(true);
  const [bekleyenSayfa, setBekleyenSayfa] = useState(1);

  const [filtreSube, setFiltreSube] = useState('');
  const [filtreKod, setFiltreKod] = useState('');

  const [drawerSatis, setDrawerSatis] = useState<SatisTeklifFormu | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerAcik, setDrawerAcik] = useState(false);
  const [drawerMod, setDrawerMod] = useState<DrawerMod>('goruntule');

  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    fetchSatislar();
  }, [currentUser]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') drawerKapat();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (drawerAcik) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [drawerAcik]);

  const drawerKapat = () => {
    setDrawerAcik(false);
    setTimeout(() => {
      setDrawerSatis(null);
      setDrawerMod('goruntule');
    }, 300);
  };

  const drawerAc = async (satis: SatisTeklifFormu, mod: DrawerMod = 'goruntule') => {
    setDrawerMod(mod);
    if (drawerSatis?.id === satis.id) {
      setDrawerAcik(true);
      return;
    }
    setDrawerLoading(true);
    setDrawerAcik(true);
    setDrawerSatis(satis);
    try {
      const sube = getSubeByKod(satis.subeKodu);
      if (sube && satis.id) {
        const satisDoc = await getDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id));
        if (satisDoc.exists()) {
          setDrawerSatis({ id: satisDoc.id, ...satisDoc.data(), subeKodu: satis.subeKodu } as SatisTeklifFormu);
        }
      }
    } catch (err) {
      console.error('Drawer detay yüklenemedi:', err);
    } finally {
      setDrawerLoading(false);
    }
  };

  const detayUrl = (satis: SatisTeklifFormu) => `/satis-detay/${satis.subeKodu}/${satis.id}`;
  const duzenleUrl = (satis: SatisTeklifFormu) => `/satis-duzenle/${satis.subeKodu}/${satis.id}`;

  const fetchSatislar = async () => {
    try {
      setLoading(true);
      const liste: SatisTeklifFormu[] = [];
      const doksan = new Date();
      doksan.setDate(doksan.getDate() - 90);
      doksan.setHours(0, 0, 0, 0);
      const doksanTimestamp = Timestamp.fromDate(doksan);

      const fetchSube = async (sube: typeof SUBELER[0]) => {
        try {
          const q = query(
            collection(db, `subeler/${sube.dbPath}/satislar`),
            where('olusturmaTarihi', '>=', doksanTimestamp),
            orderBy('olusturmaTarihi', 'desc')
          );
          const snap = await getDocs(q);
          snap.forEach(d => liste.push({ id: d.id, ...d.data(), subeKodu: sube.kod } as SatisTeklifFormu));
        } catch (err) { console.error(`${sube.ad} yüklenemedi:`, err); }
      };

      if (isAdmin) {
        await Promise.all(SUBELER.map(fetchSube));
      } else {
        const sube = getSubeByKod(currentUser!.subeKodu);
        if (sube) await fetchSube(sube);
      }

      liste.sort((a: any, b: any) => {
        const tA = a.olusturmaTarihi?.toDate ? a.olusturmaTarihi.toDate() : new Date(a.olusturmaTarihi || 0);
        const tB = b.olusturmaTarihi?.toDate ? b.olusturmaTarihi.toDate() : new Date(b.olusturmaTarihi || 0);
        return tB.getTime() - tA.getTime();
      });

      setSatislar(liste);
    } catch (err) {
      console.error('Satışlar yüklenemedi:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtrele = (liste: SatisTeklifFormu[]) =>
    liste.filter(s => {
      const subeUygun = !filtreSube || s.subeKodu === filtreSube;
      const kodUygun = !filtreKod || s.satisKodu?.toLowerCase().includes(filtreKod.toLowerCase());
      return subeUygun && kodUygun;
    });

  const bekleyenTumu = filtrele(
    satislar.filter(s => s.onayDurumu === false && !(s as any).iptalTalebi && (s as any).satisDurumu !== 'IPTAL')
  );
  const toplamSayfa = Math.ceil(bekleyenTumu.length / SAYFA_BOYUTU);
  const bekleyenSayfadakiler = bekleyenTumu.slice((bekleyenSayfa - 1) * SAYFA_BOYUTU, bekleyenSayfa * SAYFA_BOYUTU);
  const sonOnaylananlar = filtrele(
    satislar.filter(s => s.onayDurumu === true && (s as any).satisDurumu !== 'IPTAL')
  ).slice(0, 10);
  const iptalTalepleri = filtrele(
    satislar.filter(s => (s as any).iptalTalebi === true && (s as any).satisDurumu !== 'IPTAL')
  );

  const onayToggle = async (satis: SatisTeklifFormu) => {
    if (!isAdmin) { alert('Bu işlem için admin yetkisi gereklidir.'); return; }
    if (!satis.id) return;
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube) return;
    setGuncellemeyorum(satis.id);
    try {
      const yeniDurum = !satis.onayDurumu;
      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), {
        onayDurumu: yeniDurum,
        satisDurumu: yeniDurum ? 'ONAYLI' : 'BEKLEMEDE',
        guncellemeTarihi: new Date()
      });
      setSatislar(prev => prev.map(s =>
        s.id === satis.id ? { ...s, onayDurumu: yeniDurum, satisDurumu: yeniDurum ? 'ONAYLI' : 'BEKLEMEDE' } as any : s
      ));
      setBekleyenSayfa(1);
      alert('✅ Durum güncellendi!');
    } catch {
      alert('❌ Güncelleme başarısız!');
    } finally {
      setGuncellemeyorum(null);
    }
  };

  const iptaliOnayla = async (satis: SatisTeklifFormu) => {
    if (!isAdmin || !satis.id) return;
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube) return;
    setGuncellemeyorum(satis.id);
    try {
      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), {
        satisDurumu: 'IPTAL', onayDurumu: false, iptalTalebi: false,
        iptalOnayTarihi: new Date(), guncellemeTarihi: new Date()
      });
      setSatislar(prev => prev.map(s =>
        s.id === satis.id ? { ...s, satisDurumu: 'IPTAL', iptalTalebi: false } as any : s
      ));
    } catch {
      alert('❌ İptal işlemi başarısız!');
    } finally {
      setGuncellemeyorum(null);
    }
  };

  const iptalReddet = async (satis: SatisTeklifFormu) => {
    if (!isAdmin || !satis.id) return;
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube) return;
    setGuncellemeyorum(satis.id);
    try {
      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), {
        iptalTalebi: false, guncellemeTarihi: new Date()
      });
      setSatislar(prev => prev.map(s =>
        s.id === satis.id ? { ...s, iptalTalebi: false } as any : s
      ));
    } catch {
      alert('❌ İşlem başarısız!');
    } finally {
      setGuncellemeyorum(null);
    }
  };

  const formatPrice = (price: number) => new Intl.NumberFormat('tr-TR', {
    style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(price);

  const formatDate = (date: any) => {
    if (!date) return '-';
    try {
      if (date instanceof Timestamp) return date.toDate().toLocaleDateString('tr-TR');
      if (date instanceof Date) return date.toLocaleDateString('tr-TR');
      return new Date(date).toLocaleDateString('tr-TR');
    } catch { return '-'; }
  };

  const renderPagination = () => {
    if (toplamSayfa <= 1) return null;
    const pages = [];
    for (let i = 1; i <= toplamSayfa; i++) {
      pages.push(
        <button key={i} className={`kontrol-pag-btn ${bekleyenSayfa === i ? 'aktif' : ''}`} onClick={() => setBekleyenSayfa(i)}>{i}</button>
      );
    }
    return (
      <div className="kontrol-pagination">
        <button className="kontrol-pag-btn" onClick={() => setBekleyenSayfa(p => Math.max(1, p - 1))} disabled={bekleyenSayfa === 1}>← Önceki</button>
        {pages}
        <button className="kontrol-pag-btn" onClick={() => setBekleyenSayfa(p => Math.min(toplamSayfa, p + 1))} disabled={bekleyenSayfa === toplamSayfa}>Sonraki →</button>
        <span className="kontrol-pag-bilgi">{bekleyenTumu.length} satışın {(bekleyenSayfa - 1) * SAYFA_BOYUTU + 1}–{Math.min(bekleyenSayfa * SAYFA_BOYUTU, bekleyenTumu.length)} arası</span>
      </div>
    );
  };

  const SatisTablosu = ({ liste, tip }: { liste: SatisTeklifFormu[], tip: 'bekleyen' | 'onaylandi' | 'iptal' }) => (
    <div className="kontrol-tablo-wrapper">
      <table className="kontrol-tablo">
        <thead>
          <tr>
            <th>SATIŞ KODU</th><th>ŞUBE</th><th>MÜŞTERİ</th><th>TUTAR</th>
            <th>KAR/ZARAR</th><th>SATIŞ TARİHİ</th><th>TESLİMAT</th><th>DURUM</th><th>İŞLEMLER</th>
            {tip === 'iptal' && <th>İPTAL ONAYI</th>}
          </tr>
        </thead>
        <tbody>
          {liste.map(satis => {
            const kar = satis.zarar ?? 0;
            const yukleniyor = guncellemeyorum === satis.id;
            return (
              <tr key={satis.id} className={
                tip === 'bekleyen' ? 'satir-bekleyen' :
                tip === 'iptal' ? 'satir-iptal' :
                'satir-onaylandi'
              }>
                <td><strong className="satis-kodu">{satis.satisKodu}</strong></td>
                <td>{getSubeByKod(satis.subeKodu)?.ad || '-'}</td>
                <td>{satis.musteriBilgileri?.isim || '-'}</td>
                <td><strong>{formatPrice(satis.toplamTutar)}</strong></td>
                <td><span className={`kz-badge ${kar >= 0 ? 'kar' : 'zarar'}`}>{kar >= 0 ? '+' : ''}{formatPrice(kar)}</span></td>
                <td>{formatDate(satis.tarih)}</td>
                <td>{formatDate((satis as any).yeniTeslimatTarihi || satis.teslimatTarihi)}</td>
                <td>
                  {tip === 'iptal' ? (
                    <span className="onay-badge iptal-badge">🚫 İPTAL TALEBİ</span>
                  ) : (tip === 'bekleyen' || tip === 'onaylandi') ? (
                    <button
                      className={`onay-btn ${satis.onayDurumu ? 'onayli' : 'bekleyen'}`}
                      onClick={() => onayToggle(satis)}
                      disabled={yukleniyor}
                    >
                      {yukleniyor ? '...' : satis.onayDurumu ? '✅ ONAYLI' : '⏳ BEKLEMEDE'}
                    </button>
                  ) : (
                    <span className={`onay-badge ${satis.onayDurumu ? 'onayli' : 'bekleyen'}`}>
                      {satis.onayDurumu ? '✅ ONAYLI' : '⏳ BEKLEMEDE'}
                    </span>
                  )}
                </td>
                <td>
                  <div className="islem-btns">
                    {/* Görüntüle: sol tık → drawer goruntule, ctrl/cmd → yeni sekme */}
                    <a
                      href={detayUrl(satis)}
                      className="btn-goster"
                      title="Görüntüle"
                      onClick={e => {
                        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
                        e.preventDefault();
                        drawerAc(satis, 'goruntule');
                      }}
                    >
                      👁️
                    </a>
                    {/* Düzenle: sol tık → drawer duzenle, ctrl/cmd → yeni sekme */}
                    <a
                      href={duzenleUrl(satis)}
                      className="btn-duzenle"
                      title="Düzenle"
                      onClick={e => {
                        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
                        e.preventDefault();
                        drawerAc(satis, 'duzenle');
                      }}
                    >
                      ✏️
                    </a>
                  </div>
                </td>
                {tip === 'iptal' && (
                  <td>
                    {isAdmin ? (
                      <div className="islem-btns">
                        <button className="btn-iptal-evet" onClick={() => iptaliOnayla(satis)} disabled={yukleniyor}>
                          {yukleniyor ? '...' : '✅ Evet'}
                        </button>
                        <button className="btn-iptal-hayir" onClick={() => iptalReddet(satis)} disabled={yukleniyor}>
                          ❌ Hayır
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: '#6b7280', fontSize: 12 }}>Admin onayı bekleniyor</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <Layout pageTitle="Kontrol Et">
      {loading ? (
        <div className="kontrol-loading">Yükleniyor...</div>
      ) : (
        <>
          {/* FİLTRELER */}
          <div className="kontrol-filtre-bar">
            <div className="kontrol-filtre-item">
              <label>ŞUBE</label>
              <select value={filtreSube} onChange={e => { setFiltreSube(e.target.value); setBekleyenSayfa(1); }} className="kontrol-filtre-select">
                <option value="">Tüm Şubeler</option>
                {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
              </select>
            </div>
            <div className="kontrol-filtre-item">
              <label>SATIŞ KODU</label>
              <input
                type="text"
                placeholder="Satış kodu ara..."
                value={filtreKod}
                onChange={e => { setFiltreKod(e.target.value); setBekleyenSayfa(1); }}
                className="kontrol-filtre-input"
              />
            </div>
            {(filtreSube || filtreKod) && (
              <button className="kontrol-filtre-sifirla" onClick={() => { setFiltreSube(''); setFiltreKod(''); setBekleyenSayfa(1); }}>
                ✕ Temizle
              </button>
            )}
          </div>

          {/* İPTAL TALEPLERİ */}
          <div className="kontrol-bolum iptal-bolum" style={{ marginBottom: 20 }}>
            <div className="kontrol-bolum-baslik" onClick={() => setIptalAcik(p => !p)}>
              <div className="kontrol-baslik-sol">
                <span className="kontrol-baslik-ikon">🚫</span>
                <h2>İptal Talepleri</h2>
                <span className="kontrol-sayac iptal-sayac">{iptalTalepleri.length}</span>
              </div>
              <span className={`kontrol-chevron ${iptalAcik ? 'acik' : ''}`}>▼</span>
            </div>
            {iptalAcik && (
              iptalTalepleri.length === 0 ? (
                <div className="kontrol-bos"><span>✅</span><p>İptal talebi bulunmuyor.</p></div>
              ) : (
                <SatisTablosu liste={iptalTalepleri} tip="iptal" />
              )
            )}
          </div>

          {/* BEKLEYEN ONAYLAR */}
          <div className="kontrol-bolum bekleyen-bolum">
            <div className="kontrol-bolum-baslik" onClick={() => setBekleyenAcik(p => !p)}>
              <div className="kontrol-baslik-sol">
                <span className="kontrol-baslik-ikon">⏳</span>
                <h2>Onay Bekleyen Satışlar</h2>
                <span className="kontrol-sayac bekleyen-sayac">{bekleyenTumu.length}</span>
              </div>
              <span className={`kontrol-chevron ${bekleyenAcik ? 'acik' : ''}`}>▼</span>
            </div>
            {bekleyenAcik && (
              bekleyenTumu.length === 0 ? (
                <div className="kontrol-bos"><span>🎉</span><p>Onay bekleyen satış yok!</p></div>
              ) : (
                <>
                  <SatisTablosu liste={bekleyenSayfadakiler} tip="bekleyen" />
                  {renderPagination()}
                </>
              )
            )}
          </div>

          {/* SON ONAYLANANLAR */}
          <div className="kontrol-bolum onaylandi-bolum" style={{ marginTop: 20 }}>
            <div className="kontrol-bolum-baslik" onClick={() => setSonOnaylananAcik(p => !p)}>
              <div className="kontrol-baslik-sol">
                <span className="kontrol-baslik-ikon">✅</span>
                <h2>Son Onaylanan Satışlar</h2>
                <span className="kontrol-sayac onaylandi-sayac">{sonOnaylananlar.length}</span>
              </div>
              <span className={`kontrol-chevron ${sonOnaylananAcik ? 'acik' : ''}`}>▼</span>
            </div>
            {sonOnaylananAcik && (
              sonOnaylananlar.length === 0 ? (
                <div className="kontrol-bos"><span>📋</span><p>Henüz onaylanmış satış yok.</p></div>
              ) : (
                <SatisTablosu liste={sonOnaylananlar} tip="onaylandi" />
              )
            )}
          </div>
        </>
      )}

      {/* DRAWER OVERLAY */}
      {(drawerAcik || drawerSatis) && (
        <div className={`kontrol-drawer-overlay ${drawerAcik ? 'acik' : ''}`} onClick={drawerKapat} />
      )}

      {/* DRAWER PANEL */}
      <div className={`kontrol-drawer ${drawerAcik ? 'acik' : ''}`}>
        <div className="kontrol-drawer-header">
          {/* Sol: Satış kodu + Tab grubu */}
          <div className="kontrol-drawer-header-sol">
            <div className="kontrol-drawer-baslik">
              {drawerSatis?.satisKodu || 'Satış Detayı'}
            </div>
            {drawerSatis && (
              <div className="kontrol-drawer-tab-grup">
                <button
                  className={`kontrol-drawer-tab ${drawerMod === 'goruntule' ? 'aktif' : ''}`}
                  onClick={() => setDrawerMod('goruntule')}
                >
                  👁️ Görüntüle
                </button>
                <button
                  className={`kontrol-drawer-tab ${drawerMod === 'duzenle' ? 'aktif' : ''}`}
                  onClick={() => setDrawerMod('duzenle')}
                >
                  ✏️ Düzenle
                </button>
              </div>
            )}
          </div>

          {/* Sağ: Tam Sayfa + Kapat */}
          <div className="kontrol-drawer-aksiyonlar">
            {drawerSatis && (
              <a
                href={drawerMod === 'duzenle' ? duzenleUrl(drawerSatis) : detayUrl(drawerSatis)}
                className="kontrol-drawer-tam-sayfa"
                target="_blank"
                rel="noopener noreferrer"
                title="Tam sayfada aç"
              >
                ↗ Tam Sayfa
              </a>
            )}
            <button className="kontrol-drawer-kapat" onClick={drawerKapat} title="Kapat">✕</button>
          </div>
        </div>

        <div className="kontrol-drawer-icerik">
          {drawerLoading ? (
            <div className="kontrol-drawer-yukleniyor">Yükleniyor...</div>
          ) : drawerSatis ? (
            drawerMod === 'goruntule' ? (
              <SatisDetayIcerik satis={drawerSatis} drawerMode={true} />
            ) : (
              <SatisDuzenleIcerik
                subeKodu={drawerSatis.subeKodu}
                satisId={drawerSatis.id!}
                drawerMode={true}
                onKaydet={() => {
                  fetchSatislar();
                  setDrawerMod('goruntule');
                }}
                onIptal={() => setDrawerMod('goruntule')}
              />
            )
          ) : null}
        </div>
      </div>
    </Layout>
  );
};

export default KontrolEt;