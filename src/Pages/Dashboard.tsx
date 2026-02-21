import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs, doc, updateDoc, Timestamp } from 'firebase/firestore';
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

  const [secilenSube, setSecilenSube] = useState<string>('');
  const [zararOlanlar, setZararOlanlar] = useState<string>('all');
  const [durum, setDurum] = useState<string>('all');
  const [teslimTarihi, setTeslimTarihi] = useState<string>('');
  const [acikHesap, setAcikHesap] = useState<string>('all');
  const [satisTarihi, setSatisTarihi] = useState<string>('');
  const [aramaMetni, setAramaMetni] = useState<string>('');
  const [mevcutSubeler, setMevcutSubeler] = useState<string[]>([]);

  const [bugunAcik, setBugunAcik] = useState(true);
  const [yarinAcik, setYarinAcik] = useState(true);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;

  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    fetchSatislar();
  }, [currentUser]);

  useEffect(() => { filtreyiUygula(); }, [satislar, secilenSube, zararOlanlar, durum, teslimTarihi, acikHesap, satisTarihi, aramaMetni]);
  useEffect(() => { setCurrentPage(1); }, [secilenSube, zararOlanlar, durum, teslimTarihi, acikHesap, satisTarihi, aramaMetni]);

  const fetchSatislar = async () => {
    try {
      setLoading(true);
      const satisListesi: SatisTeklifFormu[] = [];
      const subeSet = new Set<string>();

      if (isAdmin) {
        for (const sube of SUBELER) {
          try {
            const snapshot = await getDocs(collection(db, `subeler/${sube.dbPath}/satislar`));
            snapshot.forEach(d => {
              satisListesi.push({ id: d.id, ...d.data(), subeKodu: sube.kod } as SatisTeklifFormu);
              subeSet.add(sube.kod);
            });
          } catch (err) { console.error(`${sube.ad} yüklenemedi:`, err); }
        }
      } else {
        const sube = getSubeByKod(currentUser!.subeKodu);
        if (sube) {
          const snapshot = await getDocs(collection(db, `subeler/${sube.dbPath}/satislar`));
          snapshot.forEach(d => {
            satisListesi.push({ id: d.id, ...d.data(), subeKodu: sube.kod } as SatisTeklifFormu);
            subeSet.add(sube.kod);
          });
        }
      }

      satisListesi.sort((a: any, b: any) => {
        const tarihA = a.olusturmaTarihi?.toDate ? a.olusturmaTarihi.toDate() : new Date(a.olusturmaTarihi || 0);
        const tarihB = b.olusturmaTarihi?.toDate ? b.olusturmaTarihi.toDate() : new Date(b.olusturmaTarihi || 0);
        return tarihB.getTime() - tarihA.getTime();
      });

      setMevcutSubeler(Array.from(subeSet));
      setSatislar(satisListesi);
    } catch (error) {
      console.error('Satışlar yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const dateToString = (date: any): string => {
    if (!date) return '';
    if (date instanceof Timestamp) return date.toDate().toISOString().split('T')[0];
    if (date instanceof Date) return date.toISOString().split('T')[0];
    return '';
  };

  const filtreyiUygula = () => {
    let sonuc = [...satislar];
    if (secilenSube) sonuc = sonuc.filter(s => s.subeKodu === secilenSube);
    if (zararOlanlar === 'zarar') sonuc = sonuc.filter(s => (s.zarar ?? 0) < 0);
    else if (zararOlanlar === 'kar') sonuc = sonuc.filter(s => (s.zarar ?? 0) >= 0);
    if (durum === 'approved') sonuc = sonuc.filter(s => s.onayDurumu === true);
    else if (durum === 'pending') sonuc = sonuc.filter(s => s.onayDurumu === false);
    if (teslimTarihi) sonuc = sonuc.filter(s => dateToString(s.teslimatTarihi) === teslimTarihi);
    if (acikHesap === 'acik') sonuc = sonuc.filter(s => s.odemeDurumu === OdemeDurumu.ACIK_HESAP);
    else if (acikHesap === 'kapali') sonuc = sonuc.filter(s => s.odemeDurumu === OdemeDurumu.ODENDI);
    if (satisTarihi) sonuc = sonuc.filter(s => dateToString(s.tarih) === satisTarihi);
    if (aramaMetni) {
      const aranan = aramaMetni.toLowerCase();
      sonuc = sonuc.filter(s =>
        s.satisKodu?.toLowerCase().includes(aranan) ||
        s.musteriBilgileri?.isim?.toLowerCase().includes(aranan)
      );
    }
    setFiltreliSatislar(sonuc);
  };

  const filtreleriSifirla = () => {
    setSecilenSube(''); setZararOlanlar('all'); setDurum('all');
    setTeslimTarihi(''); setAcikHesap('all'); setSatisTarihi(''); setAramaMetni('');
  };

  const ozetVeriler = React.useMemo(() => {
    const toplamCiro = satislar.reduce((acc, s) => acc + (s.toplamTutar || 0), 0);
    const acikHesaplar = satislar.filter(s => s.odemeDurumu === OdemeDurumu.ACIK_HESAP).length;
    const bekleyenOnaylar = satislar.filter(s => s.onayDurumu === false).length;
    const zararEdenler = satislar.filter(s => (s.zarar ?? 0) < 0).length;
    const toplamKar = satislar.reduce((acc, s) => acc + (s.zarar ?? 0), 0);
    return { toplamCiro, acikHesaplar, bekleyenOnaylar, zararEdenler, toplamKar };
  }, [satislar]);

  const alarmVeriler = React.useMemo(() => {
    const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
    const yarin = new Date(bugun); yarin.setDate(yarin.getDate() + 1);
    const toDate = (d: any): Date => {
      if (!d) return new Date(0);
      if (d instanceof Timestamp) return d.toDate();
      if (d instanceof Date) return d;
      return new Date(d);
    };
    const bugunSatislar = satislar.filter(s => {
      const tarih = s.yeniTeslimatTarihi || s.teslimatTarihi;
      const t = toDate(tarih); t.setHours(0, 0, 0, 0);
      return t.getTime() === bugun.getTime() && s.teslimEdildiMi !== true;
    });
    const yarinSatislar = satislar.filter(s => {
      const tarih = s.yeniTeslimatTarihi || s.teslimatTarihi;
      const t = toDate(tarih); t.setHours(0, 0, 0, 0);
      return t.getTime() === yarin.getTime() && s.teslimEdildiMi !== true;
    });
    return { bugunSatislar, yarinSatislar };
  }, [satislar]);

  const excelExport = () => {
    const data = filtreliSatislar.map(s => ({
      'Satış Kodu': s.satisKodu,
      'Şube': getSubeByKod(s.subeKodu)?.ad || '',
      'Müşteri': s.musteriBilgileri?.isim || '',
      'Toplam Tutar': s.toplamTutar,
      'Kar/Zarar': s.zarar ?? 0,
      'Satış Tarihi': formatDate(s.tarih),
      'Teslimat Tarihi': formatDate(s.teslimatTarihi),
      'Durum': s.onayDurumu ? 'Onaylı' : 'Beklemede',
      'Ödeme': s.odemeDurumu,
      'Fatura No': s.faturaNo || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Satışlar');
    ws['!cols'] = [{ wch: 15 }, { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 15 }];
    const bugun = new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
    XLSX.writeFile(wb, `Satislar_${bugun}.xlsx`);
  };

  const totalPages = Math.ceil(filtreliSatislar.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentSatislar = filtreliSatislar.slice(startIndex, startIndex + itemsPerPage);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderPagination = () => {
    if (totalPages <= 1) return null;
    const pages: React.ReactNode[] = [];
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage + 1 < maxVisible) startPage = Math.max(1, endPage - maxVisible + 1);

    pages.push(<button key="prev" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="pagination-btn pagination-arrow">← Önceki</button>);
    if (startPage > 1) {
      pages.push(<button key={1} onClick={() => goToPage(1)} className="pagination-btn">1</button>);
      if (startPage > 2) pages.push(<span key="dots1" className="pagination-dots">...</span>);
    }
    for (let i = startPage; i <= endPage; i++) {
      pages.push(<button key={i} onClick={() => goToPage(i)} className={`pagination-btn ${currentPage === i ? 'active' : ''}`}>{i}</button>);
    }
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) pages.push(<span key="dots2" className="pagination-dots">...</span>);
      pages.push(<button key={totalPages} onClick={() => goToPage(totalPages)} className="pagination-btn">{totalPages}</button>);
    }
    pages.push(<button key="next" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="pagination-btn pagination-arrow">Sonraki →</button>);
    return <div className="pagination-container">{pages}</div>;
  };

  const onayDurumuToggle = async (satis: SatisTeklifFormu) => {
    if (!isAdmin || !satis.id) return;
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube) return;
    setGuncellemeyorum(satis.id);
    try {
      const yeniDurum = !satis.onayDurumu;
      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), { onayDurumu: yeniDurum, guncellemeTarihi: new Date() });
      setSatislar(prev => prev.map(s => s.id === satis.id ? { ...s, onayDurumu: yeniDurum } : s));
    } catch { alert('❌ Güncelleme başarısız!'); }
    finally { setGuncellemeyorum(null); }
  };

  const odemeDurumunuHesapla = (satis: SatisTeklifFormu): boolean => {
    const toplamTutar = (satis as any).toplamTutar || 0;
    if (toplamTutar <= 0) return false;
    const toplamOdenen = (satis as any).toplamOdenen ||
      ((satis as any).pesinatTutar || 0) +
      ((satis as any).havaleTutar || 0) +
      ((satis.kartOdemeler || []).reduce((s: number, k: any) => s + (k.tutar || 0), 0));
    return toplamOdenen >= toplamTutar;
  };

  const formatPrice = (price: number) => new Intl.NumberFormat('tr-TR', {
    style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(price);

  const formatDate = (date: any) => {
    if (!date) return '';
    try {
      if (date instanceof Timestamp) return date.toDate().toLocaleDateString('tr-TR');
      if (date instanceof Date) return date.toLocaleDateString('tr-TR');
      return new Date(date).toLocaleDateString('tr-TR');
    } catch { return ''; }
  };

  const excelBtn = (
    <button onClick={excelExport} className="dash-btn-excel">
      <i className="fas fa-file-excel"></i> Excel
    </button>
  );

  return (
    <Layout pageTitle="Satış Listesi" headerExtra={excelBtn}>
      {/* TESLİM ALARM BANNER */}
      {!loading && (
        <>
          {alarmVeriler.bugunSatislar.length > 0 && (
            <div className="alarm-banner bugun">
              <div className="alarm-baslik" onClick={() => setBugunAcik(p => !p)}>
                <div className="alarm-baslik-sol">
                  <i className="fas fa-exclamation-circle"></i>
                  <strong>Bugün Teslim Edilmesi Gerekenler</strong>
                  <span className="alarm-badge">{alarmVeriler.bugunSatislar.length} satış</span>
                </div>
                <i className={`fas fa-chevron-down alarm-toggle-icon ${bugunAcik ? 'acik' : ''}`}></i>
              </div>
              {bugunAcik && (
                <div className="alarm-liste">
                  {alarmVeriler.bugunSatislar.map(s => (
                    <div key={s.id} className="alarm-satir">
                      <div className="alarm-satir-sol">
                        <span className="alarm-satis-kodu">{s.satisKodu}</span>
                        <span className="alarm-musteri">{s.musteriBilgileri?.isim || '-'}</span>
                        <span className="alarm-sube">{getSubeByKod(s.subeKodu)?.ad}</span>
                      </div>
                      <div className="alarm-satir-sag">
                        <span className="alarm-tutar">{formatPrice(s.toplamTutar)}</span>
                        <button className="alarm-detay-btn" onClick={() => navigate(`/satis-detay/${s.subeKodu}/${s.id}`)}>Görüntüle</button>
                      </div>
                    </div>
                  ))}w
                </div>
              )}
            </div>
          )}
          {alarmVeriler.yarinSatislar.length > 0 && (
            <div className="alarm-banner yarin">
              <div className="alarm-baslik" onClick={() => setYarinAcik(p => !p)}>
                <div className="alarm-baslik-sol">
                  <i className="fas fa-clock"></i>
                  <strong>Yarın Teslim Edilmesi Gerekenler</strong>
                  <span className="alarm-badge">{alarmVeriler.yarinSatislar.length} satış</span>
                </div>
                <i className={`fas fa-chevron-down alarm-toggle-icon ${yarinAcik ? 'acik' : ''}`}></i>
              </div>
              {yarinAcik && (
                <div className="alarm-liste">
                  {alarmVeriler.yarinSatislar.map(s => (
                    <div key={s.id} className="alarm-satir">
                      <div className="alarm-satir-sol">
                        <span className="alarm-satis-kodu">{s.satisKodu}</span>
                        <span className="alarm-musteri">{s.musteriBilgileri?.isim || '-'}</span>
                        <span className="alarm-sube">{getSubeByKod(s.subeKodu)?.ad}</span>
                      </div>
                      <div className="alarm-satir-sag">
                        <span className="alarm-tutar">{formatPrice(s.toplamTutar)}</span>
                        <button className="alarm-detay-btn" onClick={() => navigate(`/satis-detay/${s.subeKodu}/${s.id}`)}>Görüntüle</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ÖZET KARTLAR */}
      {!loading && (
        <div className="ozet-kartlar">
          <div className="ozet-kart ozet-ciro">
            <div className="ozet-kart-ikon"><i className="fas fa-lira-sign"></i></div>
            <div className="ozet-kart-bilgi">
              <span className="ozet-kart-baslik">TOPLAM CİRO</span>
              <span className="ozet-kart-deger">{formatPrice(ozetVeriler.toplamCiro)}</span>
            </div>
          </div>
          <div className="ozet-kart ozet-kar">
            <div className="ozet-kart-ikon"><i className="fas fa-chart-line"></i></div>
            <div className="ozet-kart-bilgi">
              <span className="ozet-kart-baslik">NET KAR</span>
              <span className={`ozet-kart-deger ${ozetVeriler.toplamKar < 0 ? 'negatif' : ''}`}>
                {ozetVeriler.toplamKar >= 0 ? '+' : ''}{formatPrice(ozetVeriler.toplamKar)}
              </span>
            </div>
          </div>
          <div className="ozet-kart ozet-acik">
            <div className="ozet-kart-ikon"><i className="fas fa-file-invoice-dollar"></i></div>
            <div className="ozet-kart-bilgi">
              <span className="ozet-kart-baslik">AÇIK HESAP</span>
              <span className="ozet-kart-deger">{ozetVeriler.acikHesaplar} satış</span>
            </div>
          </div>
          <div className="ozet-kart ozet-bekleyen">
            <div className="ozet-kart-ikon"><i className="fas fa-hourglass-half"></i></div>
            <div className="ozet-kart-bilgi">
              <span className="ozet-kart-baslik">BEKLEYEN ONAY</span>
              <span className="ozet-kart-deger">{ozetVeriler.bekleyenOnaylar} satış</span>
            </div>
          </div>
          <div className="ozet-kart ozet-zarar">
            <div className="ozet-kart-ikon"><i className="fas fa-exclamation-triangle"></i></div>
            <div className="ozet-kart-bilgi">
              <span className="ozet-kart-baslik">ZARAR EDEN</span>
              <span className="ozet-kart-deger">{ozetVeriler.zararEdenler} satış</span>
            </div>
          </div>
        </div>
      )}

      {/* FİLTRELER */}
      <div className="filtre-container">
        <div className="filtre-item">
          <label>ŞUBE</label>
          <select value={secilenSube} onChange={e => setSecilenSube(e.target.value)} className="filtre-select">
            <option value="">Tüm Şubeler ({mevcutSubeler.length})</option>
            {mevcutSubeler.map(kod => {
              const sube = getSubeByKod(kod as SubeKodu);
              return sube ? <option key={kod} value={kod}>{sube.ad}</option> : null;
            })}
          </select>
        </div>
        <div className="filtre-item">
          <label>KAR/ZARAR</label>
          <select value={zararOlanlar} onChange={e => setZararOlanlar(e.target.value)} className="filtre-select">
            <option value="all">Tümü</option>
            <option value="zarar">Sadece Zararlı</option>
            <option value="kar">Sadece Karlı</option>
          </select>
        </div>
        <div className="filtre-item">
          <label>DURUM</label>
          <select value={durum} onChange={e => setDurum(e.target.value)} className="filtre-select">
            <option value="all">Tümü</option>
            <option value="approved">Onaylı</option>
            <option value="pending">Beklemede</option>
          </select>
        </div>
        <div className="filtre-item">
          <label>TESLİM TARİHİ</label>
          <input type="date" value={teslimTarihi} onChange={e => setTeslimTarihi(e.target.value)} className="filtre-input" />
        </div>
        <div className="filtre-item">
          <label>AÇIK HESAP</label>
          <select value={acikHesap} onChange={e => setAcikHesap(e.target.value)} className="filtre-select">
            <option value="all">Tümü</option>
            <option value="acik">Açık Hesaplar</option>
            <option value="kapali">Kapalı Hesaplar</option>
          </select>
        </div>
        <div className="filtre-item">
          <label>SATIŞ TARİHİ</label>
          <input type="date" value={satisTarihi} onChange={e => setSatisTarihi(e.target.value)} className="filtre-input" />
        </div>
        <div className="filtre-item filtre-item--wide">
          <label>SATIŞ KODU / MÜŞTERİ</label>
          <div className="search-container">
            <input type="text" placeholder="Satış kodu veya müşteri adı..." value={aramaMetni} onChange={e => setAramaMetni(e.target.value)} className="search-input" />
            <button className="search-btn" onClick={filtreyiUygula}><i className="fas fa-search"></i></button>
          </div>
        </div>
        <div className="filtre-item filtre-item--actions">
          <label>&nbsp;</label>
          <button onClick={filtreleriSifirla} className="btn-sifirla"><i className="fas fa-undo"></i> Sıfırla</button>
        </div>
      </div>

      {/* SONUÇ BİLGİSİ */}
      <div className="sonuc-bilgi">
        <p>Toplam <strong>{filtreliSatislar.length}</strong> satış{totalPages > 1 && <span> · Sayfa {currentPage}/{totalPages}</span>}</p>
      </div>

      {/* TABLO */}
      {loading ? (
        <div className="loading">Yükleniyor...</div>
      ) : filtreliSatislar.length === 0 ? (
        <div className="empty-state">
          <p>Filtreye uygun satış kaydı bulunmuyor.</p>
          <button onClick={() => navigate('/satis-teklif')} className="btn-primary">YENİ SATIŞ TEKLİFİ OLUŞTUR</button>
        </div>
      ) : (
        <>
          <div className="sales-table-container">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>SATIŞ KODU</th>
                  <th>ŞUBE</th>
                  <th>MÜŞTERİ</th>
                  <th>TUTAR</th>
                  <th>KAR/ZARAR</th>
                  <th>TARİH</th>
                  <th>TESLİMAT</th>
                  <th>DURUM</th>
                  <th>ÖDEME</th>
                  <th>İŞLEMLER</th>
                </tr>
              </thead>
              <tbody>
                {currentSatislar.map(satis => {
                  const kar = satis.zarar ?? 0;
                  const isOnaylandi = satis.onayDurumu === true;
                  const isOdendi = odemeDurumunuHesapla(satis);
                  const onayYukleniyor = guncellemeyorum === satis.id;

                  return (
                    <tr key={satis.id}>
                      <td><strong>{satis.satisKodu}</strong></td>
                      <td>{getSubeByKod(satis.subeKodu)?.ad}</td>
                      <td>{satis.musteriBilgileri?.isim || '-'}</td>
                      <td><strong>{formatPrice(satis.toplamTutar)}</strong></td>
                      <td>
                        <span className={`kar-zarar-badge ${kar >= 0 ? 'kar' : 'zarar'}`}>
                          {kar >= 0 ? '+' : ''}{formatPrice(kar)}
                        </span>
                      </td>
                      <td>{formatDate(satis.tarih)}</td>
                      <td>
                        {satis.yeniTeslimatTarihi
                          ? formatDate(satis.yeniTeslimatTarihi)
                          : formatDate(satis.teslimatTarihi)
                        }
                      </td>
                      <td>
                        {isAdmin ? (
                          <button
                            className={`status-badge clickable ${isOnaylandi ? 'approved' : 'pending'}`}
                            onClick={() => onayDurumuToggle(satis)}
                            disabled={onayYukleniyor}
                          >
                            {onayYukleniyor ? '...' : isOnaylandi ? 'ONAYLI' : 'BEKLEMEDE'}
                          </button>
                        ) : (
                          <span className={`status-badge ${isOnaylandi ? 'approved' : 'pending'}`}>
                            {isOnaylandi ? 'ONAYLI' : 'BEKLEMEDE'}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`status-badge ${isOdendi ? 'odendi' : 'acik-hesap'}`}>
                          {isOdendi ? 'ÖDENDİ' : 'AÇIK HESAP'}
                        </span>
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button
                            onClick={() => navigate(`/satis-detay/${satis.subeKodu}/${satis.id}`)}
                            className="btn-view"
                            title="Detay Görüntüle"
                          >
                            👁️
                          </button>
                          <button
                            onClick={() => navigate(`/satis-duzenle/${satis.subeKodu}/${satis.id}`)}
                            className="btn-edit"
                            title="Düzenle"
                          >
                            ✏️
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {renderPagination()}
        </>
      )}
    </Layout>
  );
};

export default Dashboard;