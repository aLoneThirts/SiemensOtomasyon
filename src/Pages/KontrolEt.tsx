import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu } from '../types/satis';
import { getSubeByKod, SUBELER } from '../types/sube';
import Layout from '../components/Layout';
import './KontrolEt.css';

const SAYFA_BOYUTU = 10;

const KontrolEt: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [satislar, setSatislar] = useState<SatisTeklifFormu[]>([]);
  const [loading, setLoading] = useState(true);
  const [guncellemeyorum, setGuncellemeyorum] = useState<string | null>(null);
  const [sonOnaylananAcik, setSonOnaylananAcik] = useState(true);
  const [bekleyenAcik, setBekleyenAcik] = useState(true);
  const [bekleyenSayfa, setBekleyenSayfa] = useState(1);

  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    fetchSatislar();
  }, [currentUser]);

  const fetchSatislar = async () => {
    try {
      setLoading(true);
      const liste: SatisTeklifFormu[] = [];

      if (isAdmin) {
        for (const sube of SUBELER) {
          try {
            const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/satislar`));
            snap.forEach(d => liste.push({ id: d.id, ...d.data(), subeKodu: sube.kod } as SatisTeklifFormu));
          } catch (err) { console.error(`${sube.ad} yüklenemedi:`, err); }
        }
      } else {
        const sube = getSubeByKod(currentUser!.subeKodu);
        if (sube) {
          const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/satislar`));
          snap.forEach(d => liste.push({ id: d.id, ...d.data(), subeKodu: sube.kod } as SatisTeklifFormu));
        }
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

  const bekleyenTumu = satislar.filter(s => s.onayDurumu === false);
  const toplamSayfa = Math.ceil(bekleyenTumu.length / SAYFA_BOYUTU);
  const bekleyenSayfadakiler = bekleyenTumu.slice((bekleyenSayfa - 1) * SAYFA_BOYUTU, bekleyenSayfa * SAYFA_BOYUTU);
  const sonOnaylananlar = satislar.filter(s => s.onayDurumu === true).slice(0, 10);

  const onayToggle = async (satis: SatisTeklifFormu) => {
    if (!isAdmin || !satis.id) return;
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube) return;
    setGuncellemeyorum(satis.id);
    try {
      const yeniDurum = !satis.onayDurumu;
      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), {
        onayDurumu: yeniDurum,
        guncellemeTarihi: new Date()
      });
      setSatislar(prev => prev.map(s => s.id === satis.id ? { ...s, onayDurumu: yeniDurum } : s));
      setBekleyenSayfa(1);
    } catch {
      alert('❌ Güncelleme başarısız!');
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

  const SatisTablosu = ({ liste, tip }: { liste: SatisTeklifFormu[], tip: 'bekleyen' | 'onaylandi' }) => (
    <div className="kontrol-tablo-wrapper">
      <table className="kontrol-tablo">
        <thead>
          <tr>
            <th>SATIŞ KODU</th><th>ŞUBE</th><th>MÜŞTERİ</th><th>TUTAR</th>
            <th>KAR/ZARAR</th><th>SATIŞ TARİHİ</th><th>TESLİMAT</th><th>DURUM</th><th>İŞLEMLER</th>
          </tr>
        </thead>
        <tbody>
          {liste.map(satis => {
            const kar = satis.zarar ?? 0;
            const yukleniyor = guncellemeyorum === satis.id;
            return (
              <tr key={satis.id} className={tip === 'bekleyen' ? 'satir-bekleyen' : 'satir-onaylandi'}>
                <td><strong className="satis-kodu">{satis.satisKodu}</strong></td>
                <td>{getSubeByKod(satis.subeKodu)?.ad || '-'}</td>
                <td>{satis.musteriBilgileri?.isim || '-'}</td>
                <td><strong>{formatPrice(satis.toplamTutar)}</strong></td>
                <td><span className={`kz-badge ${kar >= 0 ? 'kar' : 'zarar'}`}>{kar >= 0 ? '+' : ''}{formatPrice(kar)}</span></td>
                <td>{formatDate(satis.tarih)}</td>
                <td>{formatDate((satis as any).yeniTeslimatTarihi || satis.teslimatTarihi)}</td>
                <td>
                  {isAdmin ? (
                    <button className={`onay-btn ${satis.onayDurumu ? 'onayli' : 'bekleyen'}`} onClick={() => onayToggle(satis)} disabled={yukleniyor}>
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
                    <button className="btn-goster" onClick={() => navigate(`/satis-detay/${satis.subeKodu}/${satis.id}`)} title="Görüntüle">👁️</button>
                    <button className="btn-duzenle" onClick={() => navigate(`/satis-duzenle/${satis.subeKodu}/${satis.id}`)} title="Düzenle">✏️</button>
                  </div>
                </td>
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
    </Layout>
  );
};

export default KontrolEt;