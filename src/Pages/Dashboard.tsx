import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu } from '../types/satis';
import { getSubeByKod, SUBELER, SubeKodu } from '../types/sube';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [satislar, setSatislar] = useState<SatisTeklifFormu[]>([]);
  const [filtreliSatislar, setFiltreliSatislar] = useState<SatisTeklifFormu[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtre state'leri
  const [secilenSube, setSecilenSube] = useState<string>('');
  const [zararOlanlar, setZararOlanlar] = useState<string>('all');
  const [durum, setDurum] = useState<string>('all');
  const [teslimTarihi, setTeslimTarihi] = useState<string>('');
  const [acikHesap, setAcikHesap] = useState<string>('all');
  const [satisTarihi, setSatisTarihi] = useState<string>('');
  const [satisKoduAra, setSatisKoduAra] = useState<string>('');

  // Mevcut şubeler
  const [mevcutSubeler, setMevcutSubeler] = useState<string[]>([]);

  useEffect(() => {
    if (!currentUser) {
      navigate('/login');
      return;
    }
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

      const isAdmin = currentUser?.role?.toString().trim() === 'ADMIN';

      if (isAdmin) {
        for (const sube of SUBELER) {
          try {
            const satisRef = collection(db, `subeler/${sube.dbPath}/satislar`);
            const snapshot = await getDocs(satisRef);
            
            snapshot.forEach((doc) => {
              const data = doc.data();
              satisListesi.push({ 
                id: doc.id, 
                ...data,
                subeKodu: sube.kod
              } as SatisTeklifFormu);
              subeSet.add(sube.kod);
            });
          } catch (error) {
            console.error(`❌ ${sube.ad} şubesi yüklenemedi:`, error);
          }
        }
      } else {
        const sube = getSubeByKod(currentUser!.subeKodu);
        if (sube) {
          const satisRef = collection(db, `subeler/${sube.dbPath}/satislar`);
          const snapshot = await getDocs(satisRef);
          
          snapshot.forEach((doc) => {
            const data = doc.data();
            satisListesi.push({ 
              id: doc.id, 
              ...data,
              subeKodu: sube.kod
            } as SatisTeklifFormu);
            subeSet.add(sube.kod);
          });
        }
      }

      setMevcutSubeler(Array.from(subeSet));
      setSatislar(satisListesi);
    } catch (error) {
      console.error('❌ Satışlar yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  // Tarih formatlama yardımcı fonksiyonu
  const dateToString = (date: any): string => {
    if (!date) return '';
    if (date instanceof Timestamp) {
      return date.toDate().toISOString().split('T')[0];
    }
    if (date instanceof Date) {
      return date.toISOString().split('T')[0];
    }
    return '';
  };

  const filtreyiUygula = () => {
    let sonuc = [...satislar];

    // Şube filtresi
    if (secilenSube) {
      sonuc = sonuc.filter(satis => satis.subeKodu === secilenSube);
    }

    // Zarar olanlar filtresi
    if (zararOlanlar !== 'all') {
      sonuc = sonuc.filter(satis => {
        const maliyet = (satis as any).maliyetToplami || 0;
        const karZarar = satis.toplamTutar - maliyet;
        return zararOlanlar === 'zarar' ? karZarar < 0 : karZarar > 0;
      });
    }

    // Durum filtresi
    if (durum !== 'all') {
      sonuc = sonuc.filter(satis => 
        durum === 'approved' ? satis.onayDurumu : !satis.onayDurumu
      );
    }

    // Teslim tarihi filtresi
    if (teslimTarihi) {
      sonuc = sonuc.filter(satis => {
        const tarih = dateToString(satis.teslimatTarihi);
        return tarih === teslimTarihi;
      });
    }

    // Açık hesap filtresi
    if (acikHesap !== 'all') {
      sonuc = sonuc.filter(satis => {
        const acik = (satis as any).acikHesap || false;
        return acikHesap === 'acik' ? acik : !acik;
      });
    }

    // Satış tarihi filtresi
    if (satisTarihi) {
      sonuc = sonuc.filter(satis => {
        const tarih = dateToString(satis.tarih);
        return tarih === satisTarihi;
      });
    }

    // Satış kodu arama
    if (satisKoduAra) {
      sonuc = sonuc.filter(satis => 
        satis.satisKodu?.toLowerCase().includes(satisKoduAra.toLowerCase())
      );
    }

    setFiltreliSatislar(sonuc);
  };

  const filtreleriSifirla = () => {
    setSecilenSube('');
    setZararOlanlar('all');
    setDurum('all');
    setTeslimTarihi('');
    setAcikHesap('all');
    setSatisTarihi('');
    setSatisKoduAra('');
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Çıkış yapılamadı:', error);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(price);
  };

  const formatDate = (date: any) => {
    if (!date) return '';
    try {
      if (date instanceof Timestamp) {
        return date.toDate().toLocaleDateString('tr-TR');
      }
      if (date instanceof Date) {
        return date.toLocaleDateString('tr-TR');
      }
      return new Date(date).toLocaleDateString('tr-TR');
    } catch {
      return '';
    }
  };

  const isAdmin = currentUser?.role?.toString().trim() === 'ADMIN';
  const kullaniciAdi = currentUser?.ad || '';
  const kullaniciSoyadi = currentUser?.soyad || '';
  const kullaniciSube = getSubeByKod(currentUser?.subeKodu as SubeKodu)?.ad || '';

  const karZararHesapla = (satis: SatisTeklifFormu) => {
    const maliyet = (satis as any).maliyetToplami || 0;
    return satis.toplamTutar - maliyet;
  };

  const acikHesapKontrol = (satis: SatisTeklifFormu): boolean => {
    return (satis as any).acikHesap || false;
  };

  const navigateTo = (path: string) => {
    navigate(path);
  };

  return (
    <div className="dashboard-container">
      {/* SOL SIDEBAR */}
      <div className="dashboard-sidebar">
        <div className="sidebar-header">
          <h1>
            TÜFEKÇİ HOME
            <span>SİEMENS</span>
          </h1>
        </div>

        <div className="sidebar-nav">
          <button 
            onClick={() => navigateTo('/dashboard')} 
            className="sidebar-nav-item active"
          >
            <i className="fas fa-chart-line"></i>
            SATIŞLAR
          </button>
          <button 
            onClick={() => navigateTo('/satis-teklif')} 
            className="sidebar-nav-item"
          >
            <i className="fas fa-plus-circle"></i>
            YENİ SATIŞ TEKLİFİ
          </button>
          <button 
            onClick={() => navigateTo('/bekleyen-urunler')} 
            className="sidebar-nav-item"
          >
            <i className="fas fa-clock"></i>
            İLERİ TESLİM
          </button>
          <button 
            onClick={() => navigateTo('/kontrol')} 
            className="sidebar-nav-item"
          >
            <i className="fas fa-check-circle"></i>
            KONTROL ET
          </button>
          <button 
            onClick={() => navigateTo('/kasa')} 
            className="sidebar-nav-item"
          >
            <i className="fas fa-cash-register"></i>
            KASA
          </button>
          <button 
            onClick={() => navigateTo('/ciro/performans')} 
            className="sidebar-nav-item"
          >
            <i className="fas fa-tachometer-alt"></i>
            CİRO/PERFORMANS
          </button>
          {isAdmin && (
            <button 
              onClick={() => navigateTo('/admin')} 
              className="sidebar-nav-item"
            >
              <i className="fas fa-shield-alt"></i>
              ADMIN PANEL
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
            <i className="fas fa-sign-out-alt"></i>
            ÇIKIŞ
          </button>
        </div>
      </div>

      {/* SAĞ ANA İÇERİK */}
      <div className="main-content">
        <header className="main-header">
          <h2 className="page-title">Satış Listesi</h2>
        </header>

        <div className="content-wrapper">
          {/* FİLTRE CONTAİNER */}
          <div className="filtre-container">
            {/* Şube */}
            <div className="filtre-item">
              <label>ŞUBE:</label>
              <select 
                value={secilenSube} 
                onChange={(e) => setSecilenSube(e.target.value)}
                className="filtre-select"
              >
                <option value="">Tüm Şubeler ({mevcutSubeler.length})</option>
                {mevcutSubeler.map(kod => {
                  const sube = getSubeByKod(kod as SubeKodu);
                  return sube ? <option key={kod} value={kod}>{sube.ad}</option> : null;
                })}
              </select>
            </div>

            {/* Zarar Olanlar */}
            <div className="filtre-item">
              <label>ZARAR OLANLAR:</label>
              <select 
                value={zararOlanlar} 
                onChange={(e) => setZararOlanlar(e.target.value)}
                className="filtre-select"
              >
                <option value="all">Tümü</option>
                <option value="zarar">Sadece Zararlı</option>
                <option value="kar">Sadece Karlı</option>
              </select>
            </div>

            {/* Durum */}
            <div className="filtre-item">
              <label>DURUM:</label>
              <select 
                value={durum} 
                onChange={(e) => setDurum(e.target.value)}
                className="filtre-select"
              >
                <option value="all">Tümü</option>
                <option value="approved">Onaylı</option>
                <option value="pending">Beklemede</option>
              </select>
            </div>

            {/* Teslim Tarihi */}
            <div className="filtre-item">
              <label>TESLİM TARİHİ:</label>
              <input 
                type="date" 
                value={teslimTarihi}
                onChange={(e) => setTeslimTarihi(e.target.value)}
                className="filtre-input" 
              />
            </div>

            {/* Açık Hesap */}
            <div className="filtre-item">
              <label>AÇIK HESAP:</label>
              <select 
                value={acikHesap}
                onChange={(e) => setAcikHesap(e.target.value)}
                className="filtre-select"
              >
                <option value="all">Tümü</option>
                <option value="acik">Açık Hesaplar</option>
                <option value="kapali">Kapalı Hesaplar</option>
              </select>
            </div>

            {/* Satış Tarihi */}
            <div className="filtre-item">
              <label>SATIŞ TARİHİ:</label>
              <input 
                type="date" 
                value={satisTarihi}
                onChange={(e) => setSatisTarihi(e.target.value)}
                className="filtre-input" 
              />
            </div>

            {/* Satış Kodu - Geniş */}
            <div className="filtre-item wide">
              <label>SATIŞ KODU:</label>
              <div className="search-container">
                <input 
                  type="text" 
                  placeholder="Satış kodu ara..." 
                  value={satisKoduAra}
                  onChange={(e) => setSatisKoduAra(e.target.value)}
                  className="search-input"
                />
                <button className="search-btn">
                  <i className="fas fa-search"></i> ARA
                </button>
              </div>
            </div>

            {/* Filtreleri Sıfırla Butonu */}
            <div className="filtre-item">
              <label>&nbsp;</label>
              <button onClick={filtreleriSifirla} className="btn-sifirla">
                FİLTRELERİ SIFIRLA
              </button>
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
                  {filtreliSatislar.map((satis: SatisTeklifFormu) => {
                    const karZarar = karZararHesapla(satis);
                    const acikHesapDurum = acikHesapKontrol(satis);
                    return (
                      <tr key={satis.id}>
                        <td><strong>{satis.satisKodu}</strong></td>
                        <td>{getSubeByKod(satis.subeKodu)?.ad}</td>
                        <td>{satis.musteriBilgileri?.isim || '-'}</td>
                        <td><strong>{formatPrice(satis.toplamTutar)}</strong></td>
                        <td>
                          <span className={`kar-zarar-badge ${karZarar >= 0 ? 'kar' : 'zarar'}`}>
                            {karZarar >= 0 ? '+' : '-'}{formatPrice(Math.abs(karZarar))}
                          </span>
                        </td>
                        <td>{formatDate(satis.tarih)}</td>
                        <td>{formatDate(satis.teslimatTarihi)}</td>
                        <td>
                          <span className={`status-badge ${satis.onayDurumu ? 'approved' : 'pending'}`}>
                            {satis.onayDurumu ? 'ONAYLI' : 'BEKLEMEDE'}
                          </span>
                        </td>
                        <td>
                          <span className={`status-badge ${acikHesapDurum ? 'acik-hesap' : 'odendi'}`}>
                            {acikHesapDurum ? 'AÇIK HESAP' : 'ÖDENDİ'}
                          </span>
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