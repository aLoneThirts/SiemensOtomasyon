import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, OdemeDurumu } from '../types/satis';
import { getSubeByKod, SUBELER, SubeKodu } from '../types/sube';
import { UserRole } from '../types/user';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [satislar, setSatislar] = useState<SatisTeklifFormu[]>([]);
  const [filtreliSatislar, setFiltreliSatislar] = useState<SatisTeklifFormu[]>([]);
  const [loading, setLoading] = useState(true);
  const [guncellemeyorum, setGuncellemeyorum] = useState<string | null>(null);

  // Filtre state'leri
  const [secilenSube, setSecilenSube] = useState<string>('');
  const [zararOlanlar, setZararOlanlar] = useState<string>('all');
  const [durum, setDurum] = useState<string>('all');
  const [teslimTarihi, setTeslimTarihi] = useState<string>('');
  const [acikHesap, setAcikHesap] = useState<string>('all');
  const [satisTarihi, setSatisTarihi] = useState<string>('');
  const [satisKoduAra, setSatisKoduAra] = useState<string>('');
  const [mevcutSubeler, setMevcutSubeler] = useState<string[]>([]);

  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';
  const kullaniciAdi = currentUser?.ad || '';
  const kullaniciSoyadi = currentUser?.soyad || '';
  const kullaniciSube = getSubeByKod(currentUser?.subeKodu as SubeKodu)?.ad || '';

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    fetchSatislar();
  }, [currentUser]);

  useEffect(() => {
    filtreyiUygula();
  }, [satislar, secilenSube, zararOlanlar, durum, teslimTarihi, acikHesap, satisTarihi, satisKoduAra]);

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
          } catch (err) {
            console.error(`${sube.ad} yüklenemedi:`, err);
          }
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

      // En yeni tarihten başlayarak sırala
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

    if (satisKoduAra) sonuc = sonuc.filter(s => s.satisKodu?.toLowerCase().includes(satisKoduAra.toLowerCase()));

    setFiltreliSatislar(sonuc);
  };

  const filtreleriSifirla = () => {
    setSecilenSube(''); setZararOlanlar('all'); setDurum('all');
    setTeslimTarihi(''); setAcikHesap('all'); setSatisTarihi(''); setSatisKoduAra('');
  };

  // ===== ADMIN: ONAY TOGGLE =====
  const onayDurumuToggle = async (satis: SatisTeklifFormu) => {
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
    } catch { alert('❌ Güncelleme başarısız!'); }
    finally { setGuncellemeyorum(null); }
  };

  // ===== ADMIN: ÖDEME TOGGLE =====
  const odemeDurumuToggle = async (satis: SatisTeklifFormu) => {
    if (!isAdmin || !satis.id) return;
    const sube = getSubeByKod(satis.subeKodu);
    if (!sube) return;
    setGuncellemeyorum(satis.id + '_odeme');
    try {
      const yeniDurum = satis.odemeDurumu === OdemeDurumu.ODENDI ? OdemeDurumu.ACIK_HESAP : OdemeDurumu.ODENDI;
      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), {
        odemeDurumu: yeniDurum,
        guncellemeTarihi: new Date()
      });
      setSatislar(prev => prev.map(s => s.id === satis.id ? { ...s, odemeDurumu: yeniDurum } : s));
    } catch { alert('❌ Güncelleme başarısız!'); }
    finally { setGuncellemeyorum(null); }
  };

  const handleLogout = async () => {
    try { await logout(); navigate('/login'); }
    catch (error) { console.error('Çıkış yapılamadı:', error); }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency', currency: 'TRY',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(price);
  };

  const formatDate = (date: any) => {
    if (!date) return '';
    try {
      if (date instanceof Timestamp) return date.toDate().toLocaleDateString('tr-TR');
      if (date instanceof Date) return date.toLocaleDateString('tr-TR');
      return new Date(date).toLocaleDateString('tr-TR');
    } catch { return ''; }
  };

  return (
    <div className="dashboard-container">
      {/* SOL SIDEBAR */}
      <div className="dashboard-sidebar">
        <div className="sidebar-header">
          <h1>TÜFEKÇİ HOME<span>SİEMENS</span></h1>
        </div>

        <div className="sidebar-nav">
          <button onClick={() => navigate('/dashboard')} className="sidebar-nav-item active">
            <i className="fas fa-chart-line"></i> SATIŞLAR
          </button>
          <button onClick={() => navigate('/satis-teklif')} className="sidebar-nav-item">
            <i className="fas fa-plus-circle"></i> YENİ SATIŞ TEKLİFİ
          </button>
          <button onClick={() => navigate('/bekleyen-urunler')} className="sidebar-nav-item">
            <i className="fas fa-clock"></i> İLERİ TESLİM
          </button>
          <button onClick={() => navigate('/kontrol')} className="sidebar-nav-item">
            <i className="fas fa-check-circle"></i> KONTROL ET
          </button>
          <button onClick={() => navigate('/kasa')} className="sidebar-nav-item">
            <i className="fas fa-cash-register"></i> KASA
          </button>
          <button onClick={() => navigate('/ciro/performans')} className="sidebar-nav-item">
            <i className="fas fa-tachometer-alt"></i> CİRO/PERFORMANS
          </button>
          {isAdmin && (
            <button onClick={() => navigate('/admin')} className="sidebar-nav-item">
              <i className="fas fa-shield-alt"></i> ADMIN PANEL
            </button>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-icon">
              {kullaniciAdi.charAt(0)}{kullaniciSoyadi.charAt(0)}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{kullaniciAdi} {kullaniciSoyadi}</div>
              <div className="sidebar-user-role">
                <span>{isAdmin ? 'Admin' : 'Çalışan'}</span>
                <span className="sidebar-user-sube">{kullaniciSube}</span>
              </div>
            </div>
          </div>
          <button onClick={handleLogout} className="sidebar-logout">
            <i className="fas fa-sign-out-alt"></i> ÇIKIŞ
          </button>
        </div>
      </div>

      {/* SAĞ ANA İÇERİK */}
      <div className="main-content">
        <header className="main-header">
          <h2 className="page-title">Satış Listesi</h2>
        </header>

        <div className="content-wrapper">
          {/* FİLTRELER */}
          <div className="filtre-container">
            <div className="filtre-item">
              <label>ŞUBE:</label>
              <select value={secilenSube} onChange={e => setSecilenSube(e.target.value)} className="filtre-select">
                <option value="">Tüm Şubeler ({mevcutSubeler.length})</option>
                {mevcutSubeler.map(kod => {
                  const sube = getSubeByKod(kod as SubeKodu);
                  return sube ? <option key={kod} value={kod}>{sube.ad}</option> : null;
                })}
              </select>
            </div>

            <div className="filtre-item">
              <label>ZARAR OLANLAR:</label>
              <select value={zararOlanlar} onChange={e => setZararOlanlar(e.target.value)} className="filtre-select">
                <option value="all">Tümü</option>
                <option value="zarar">Sadece Zararlı</option>
                <option value="kar">Sadece Karlı</option>
              </select>
            </div>

            <div className="filtre-item">
              <label>DURUM:</label>
              <select value={durum} onChange={e => setDurum(e.target.value)} className="filtre-select">
                <option value="all">Tümü</option>
                <option value="approved">Onaylı</option>
                <option value="pending">Beklemede</option>
              </select>
            </div>

            <div className="filtre-item">
              <label>TESLİM TARİHİ:</label>
              <input type="date" value={teslimTarihi} onChange={e => setTeslimTarihi(e.target.value)} className="filtre-input" />
            </div>

            <div className="filtre-item">
              <label>AÇIK HESAP:</label>
              <select value={acikHesap} onChange={e => setAcikHesap(e.target.value)} className="filtre-select">
                <option value="all">Tümü</option>
                <option value="acik">Açık Hesaplar</option>
                <option value="kapali">Kapalı Hesaplar</option>
              </select>
            </div>

            <div className="filtre-item">
              <label>SATIŞ TARİHİ:</label>
              <input type="date" value={satisTarihi} onChange={e => setSatisTarihi(e.target.value)} className="filtre-input" />
            </div>

            <div className="filtre-item wide">
              <label>SATIŞ KODU:</label>
              <div className="search-container">
                <input
                  type="text"
                  placeholder="Satış kodu ara..."
                  value={satisKoduAra}
                  onChange={e => setSatisKoduAra(e.target.value)}
                  className="search-input"
                />
                <button className="search-btn">
                  <i className="fas fa-search"></i> ARA
                </button>
              </div>
            </div>

            <div className="filtre-item">
              <label>&nbsp;</label>
              <button onClick={filtreleriSifirla} className="btn-sifirla">FİLTRELERİ SIFIRLA</button>
            </div>
          </div>

          {/* SONUÇ BİLGİSİ */}
          <div className="sonuc-bilgi">
            <p>Toplam <strong>{filtreliSatislar.length}</strong> satış bulundu</p>
          </div>

          {/* TABLO */}
          {loading ? (
            <div className="loading">Yükleniyor...</div>
          ) : filtreliSatislar.length === 0 ? (
            <div className="empty-state">
              <p>Filtreye uygun satış kaydı bulunmuyor.</p>
              <button onClick={() => navigate('/satis-teklif')} className="btn-primary">
                YENİ SATIŞ TEKLİFİ OLUŞTUR
              </button>
            </div>
          ) : (
            <div className="sales-table-container">
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>SATIŞ KODU</th>
                    <th>ŞUBE</th>
                    <th>MÜŞTERİ</th>
                    <th>TOPLAM TUTAR</th>
                    <th>KAR/ZARAR</th>
                    <th>TARİH</th>
                    <th>TESLİMAT</th>
                    <th>DURUM</th>
                    <th>ÖDEME</th>
                    <th>İŞLEMLER</th>
                  </tr>
                </thead>
                <tbody>
                  {filtreliSatislar.map(satis => {
                    const kar = satis.zarar ?? 0;
                    const isOnaylandi = satis.onayDurumu === true;
                    const isOdendi = satis.odemeDurumu === OdemeDurumu.ODENDI;
                    const onayYukleniyor = guncellemeyorum === satis.id;
                    const odemeYukleniyor = guncellemeyorum === satis.id + '_odeme';

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
                        <td>{formatDate(satis.teslimatTarihi)}</td>

                        {/* DURUM - Admin tıklayabilir */}
                        <td>
                          {isAdmin ? (
                            <button
                              className={`status-badge clickable ${isOnaylandi ? 'approved' : 'pending'}`}
                              onClick={() => onayDurumuToggle(satis)}
                              disabled={onayYukleniyor}
                              title="Tıklayarak değiştir"
                            >
                              {onayYukleniyor ? '...' : isOnaylandi ? 'ONAYLI' : 'BEKLEMEDE'}
                            </button>
                          ) : (
                            <span className={`status-badge ${isOnaylandi ? 'approved' : 'pending'}`}>
                              {isOnaylandi ? 'ONAYLI' : 'BEKLEMEDE'}
                            </span>
                          )}
                        </td>

                        {/* ÖDEME - Admin tıklayabilir */}
                        <td>
                          {isAdmin ? (
                            <button
                              className={`status-badge clickable ${isOdendi ? 'odendi' : 'acik-hesap'}`}
                              onClick={() => odemeDurumuToggle(satis)}
                              disabled={odemeYukleniyor}
                              title="Tıklayarak değiştir"
                            >
                              {odemeYukleniyor ? '...' : isOdendi ? 'ÖDENDİ' : 'AÇIK HESAP'}
                            </button>
                          ) : (
                            <span className={`status-badge ${isOdendi ? 'odendi' : 'acik-hesap'}`}>
                              {isOdendi ? 'ÖDENDİ' : 'AÇIK HESAP'}
                            </span>
                          )}
                        </td>

                        <td>
                          <button
                            onClick={() => navigate(`/satis-detay/${satis.subeKodu}/${satis.id}`)}
                            className="btn-view"
                          >
                            GÖRÜNTÜLE
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;