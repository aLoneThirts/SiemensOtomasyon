import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/user';
import { collection, getDocs } from 'firebase/firestore';
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
  const [baslangicTarihi, setBaslangicTarihi] = useState<string>('');
  const [bitisTarihi, setBitisTarihi] = useState<string>('');

  // Mevcut şubeler ve tarih aralıkları
  const [mevcutSubeler, setMevcutSubeler] = useState<string[]>([]);
  const [enEskiTarih, setEnEskiTarih] = useState<string>('');
  const [enYeniTarih, setEnYeniTarih] = useState<string>('');

  useEffect(() => {
    if (!currentUser) {
      navigate('/login');
      return;
    }

    fetchSatislar();
  }, [currentUser]);

  useEffect(() => {
    filtreyiUygula();
  }, [satislar, secilenSube, baslangicTarihi, bitisTarihi]);

  const fetchSatislar = async () => {
  try {
    setLoading(true);
    const satisListesi: SatisTeklifFormu[] = [];
    const subeSet = new Set<string>();
    let minTarih: Date | undefined;
    let maxTarih: Date | undefined;

    const isAdmin = currentUser?.role?.toString().trim() === 'ADMIN';

    if (isAdmin) {
      for (const sube of SUBELER) {
        try {
          const satisRef = collection(db, `subeler/${sube.dbPath}/satislar`);
          const snapshot = await getDocs(satisRef);
          
          snapshot.forEach((doc: any) => {
            const data = doc.data();
            satisListesi.push({ 
              id: doc.id, 
              ...data,
              subeKodu: sube.kod
            } as SatisTeklifFormu);

            subeSet.add(sube.kod);

            const tarih = data.tarih?.toDate ? data.tarih.toDate() : new Date(data.tarih);
            
            // TİP KONTROLÜ İLE
            if (minTarih === undefined) {
              minTarih = tarih;
            } else if (tarih < minTarih) {
              minTarih = tarih;
            }
            
            if (maxTarih === undefined) {
              maxTarih = tarih;
            } else if (tarih > maxTarih) {
              maxTarih = tarih;
            }
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
        
        snapshot.forEach((doc: any) => {
          const data = doc.data();
          satisListesi.push({ 
            id: doc.id, 
            ...data,
            subeKodu: sube.kod
          } as SatisTeklifFormu);

          subeSet.add(sube.kod);

          const tarih = data.tarih?.toDate ? data.tarih.toDate() : new Date(data.tarih);
          
          // TİP KONTROLÜ İLE
          if (minTarih === undefined) {
            minTarih = tarih;
          } else if (tarih < minTarih) {
            minTarih = tarih;
          }
          
          if (maxTarih === undefined) {
            maxTarih = tarih;
          } else if (tarih > maxTarih) {
            maxTarih = tarih;
          }
        });
      }
    }

    setMevcutSubeler(Array.from(subeSet));

    // TİP KONTROLÜ İLE
    if (minTarih !== undefined && maxTarih !== undefined) {
      setEnEskiTarih(minTarih.toISOString().split('T')[0]);
      setEnYeniTarih(maxTarih.toISOString().split('T')[0]);
      
      const birAyOnce = new Date(maxTarih);
      birAyOnce.setMonth(birAyOnce.getMonth() - 1);
      setBaslangicTarihi(birAyOnce.toISOString().split('T')[0]);
      setBitisTarihi(maxTarih.toISOString().split('T')[0]);
    }

    setSatislar(satisListesi);
  } catch (error) {
    console.error('❌ Satışlar yüklenemedi:', error);
  } finally {
    setLoading(false);
  }
};

  const filtreyiUygula = () => {
    let sonuc = [...satislar];

    if (secilenSube) {
      sonuc = sonuc.filter(satis => satis.subeKodu === secilenSube);
    }

    if (baslangicTarihi && bitisTarihi) {
      sonuc = sonuc.filter(satis => {
        let satisTarihi: Date;
        if (satis.tarih && typeof satis.tarih === 'object' && 'toDate' in satis.tarih) {
          satisTarihi = (satis.tarih as any).toDate();
        } else {
          satisTarihi = new Date(satis.tarih);
        }
        
        const baslangic = new Date(baslangicTarihi);
        const bitis = new Date(bitisTarihi);
        
        return satisTarihi >= baslangic && satisTarihi <= bitis;
      });
    }

    setFiltreliSatislar(sonuc);
  };

  const filtreleriSifirla = () => {
    setSecilenSube('');
    if (enYeniTarih) {
      const maxDate = new Date(enYeniTarih);
      const birAyOnce = new Date(maxDate);
      birAyOnce.setMonth(birAyOnce.getMonth() - 1);
      setBaslangicTarihi(birAyOnce.toISOString().split('T')[0]);
      setBitisTarihi(enYeniTarih);
    }
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
      currency: 'TRY'
    }).format(price);
  };

  const formatDate = (date: any) => {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('tr-TR');
  };

  const isAdmin = currentUser?.role?.toString().trim() === 'ADMIN';

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>TÜFEKÇİ HOME SİEMENS</h1>
          <div className="user-info">
            <div className="user-details">
              <div className="user-name">{currentUser?.ad} {currentUser?.soyad}</div>
              <div className="user-meta">
                <span className="user-sube">{getSubeByKod(currentUser!.subeKodu)?.ad}</span>
                <span className="user-role">
                  ({isAdmin ? 'Admin' : 'Çalışan'})
                </span>
              </div>
            </div>
            <button onClick={handleLogout} className="btn-logout">ÇIKIŞ</button>
          </div>
        </div>
      </header>

      <nav className="dashboard-nav">
        <button onClick={() => navigate('/dashboard')} className="nav-btn active">
          Satışlar
        </button>
        <button onClick={() => navigate('/satis-teklif')} className="nav-btn">
          Yeni Satış Teklifi
        </button>
        <button onClick={() => navigate('/bekleyen-urunler')} className="nav-btn">
          İleri Teslim
        </button>
          <button onClick={() => navigate('/bekleyen-urunler')} className="nav-btn">
          Kontrol Et
        </button>
         <button onClick={() => navigate('../pages/Kasa')} className="nav-btn">
         KASA
        </button>
           <button onClick={() => navigate('/ciro/performans')} className="nav-btn">
         Ciro/Performans
        </button>
        {isAdmin && (
          <button onClick={() => navigate('/admin')} className="nav-btn">
            Admin Panel
          </button>
        )}
      </nav>

      <div className="dashboard-content">
        <div className="content-header">
          <h2>Satış Listesi</h2>
          <button onClick={fetchSatislar} className="btn-refresh">YENİLE</button>
        </div>

        <div className="filtre-container">
          <div className="filtre-grup">
            <label>Şube:</label>
            <select 
              value={secilenSube} 
              onChange={(e) => setSecilenSube(e.target.value)}
              className="filtre-select"
            >
              <option value="">Tüm Şubeler ({mevcutSubeler.length})</option>
              {mevcutSubeler.map(kod => {
                const sube = getSubeByKod(kod as SubeKodu);
                return sube ? (
                  <option key={kod} value={kod}>
                    {sube.ad}
                  </option>
                ) : null;
              })}
            </select>
          </div>

          <div className="filtre-grup">
            <label>Zarar Olanları Göster</label>
            <select 
              value={secilenSube} 
              onChange={(e) => setSecilenSube(e.target.value)}
              className="filtre-select"
            >
              <option value="">Tüm Şubeler ({mevcutSubeler.length})</option>
              {mevcutSubeler.map(kod => {
                const sube = getSubeByKod(kod as SubeKodu);
                return sube ? (
                  <option key={kod} value={kod}>
                    {sube.ad}
                  </option>
                ) : null;
              })}
            </select>
          </div>

          <div className="filtre-grup">
            <label>Durum :</label>
            <select 
              value={secilenSube} 
              onChange={(e) => setSecilenSube(e.target.value)}
              className="filtre-select"
            >
              <option value="">Tüm Şubeler ({mevcutSubeler.length})</option>
              {mevcutSubeler.map(kod => {
                const sube = getSubeByKod(kod as SubeKodu);
                return sube ? (
                  <option key={kod} value={kod}>
                    {sube.ad}
                  </option>
                ) : null;
              })}
            </select>
          </div>

              <div className="filtre-grup">
            <label>Teslim Tarihi</label>
            <select 
              value={secilenSube} 
              onChange={(e) => setSecilenSube(e.target.value)}
              className="filtre-select"
            >
              <option value="">Tüm Şubeler ({mevcutSubeler.length})</option>
              {mevcutSubeler.map(kod => {
                const sube = getSubeByKod(kod as SubeKodu);
                return sube ? (
                  <option key={kod} value={kod}>
                    {sube.ad}
                  </option>
                ) : null;
              })}
            </select>
          </div>

            <div className="filtre-grup">
            <label>Açık Hesap</label>
            <select 
              value={secilenSube} 
              onChange={(e) => setSecilenSube(e.target.value)}
              className="filtre-select"
            >
              <option value="">Tüm Şubeler ({mevcutSubeler.length})</option>
              {mevcutSubeler.map(kod => {
                const sube = getSubeByKod(kod as SubeKodu);
                return sube ? (
                  <option key={kod} value={kod}>
                    {sube.ad}
                  </option>
                ) : null;
              })}
            </select>
          </div>
       

            <div className="filtre-grup">
            <label>Satış Tarihi</label>
            <select 
              value={secilenSube} 
              onChange={(e) => setSecilenSube(e.target.value)}
              className="filtre-select"
            >
              <option value="">Tüm Şubeler ({mevcutSubeler.length})</option>
              {mevcutSubeler.map(kod => {
                const sube = getSubeByKod(kod as SubeKodu);
                return sube ? (
                  <option key={kod} value={kod}>
                    {sube.ad}
                  </option>
                ) : null;
              })}
            </select>
          </div>

             <div className="searchbar">
            <label>Satış Kodu:</label>
            <select 
              value={secilenSube} 
              onChange={(e) => setSecilenSube(e.target.value)}
              className="searchbar"
            >
              <option value="">Tüm Şubeler ({mevcutSubeler.length})</option>
              {mevcutSubeler.map(kod => {
                const sube = getSubeByKod(kod as SubeKodu);
                return sube ? (
                  <option key={kod} value={kod}>
                    {sube.ad}
                  </option>
                ) : null;
              })}
            </select>
          </div>
       
       

       
       
      

          <button onClick={filtreleriSifirla} className="btn-sifirla">
            Filtreleri Sıfırla
          </button>
        </div>

        <div className="sonuc-bilgi">
          <p>Toplam <strong>{filtreliSatislar.length}</strong> satış bulundu</p>
        </div>

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
                  <th>TARİH</th>
                  <th>TESLİMAT</th>
                  <th>DURUM</th>
                  <th>İŞLEMLER</th>
                </tr>
              </thead>
              <tbody>
                {filtreliSatislar.map((satis: SatisTeklifFormu) => (
                  <tr key={satis.id}>
                    <td><strong>{satis.satisKodu}</strong></td>
                    <td>{getSubeByKod(satis.subeKodu)?.ad}</td>
                    <td>{satis.musteriBilgileri.isim}</td>
                    <td><strong>{formatPrice(satis.toplamTutar)}</strong></td>
                    <td>{formatDate(satis.tarih)}</td>
                    <td>{formatDate(satis.teslimatTarihi)}</td>
                    <td>
                      <span className={`status-badge ${satis.onayDurumu ? 'approved' : 'pending'}`}>
                        {satis.onayDurumu ? 'ONAYLI' : 'BEKLEMEDE'}
                      </span>
                        <span className={`status-badge ${satis.onayDurumu ? 'approved' : 'pending'}`}>
                        {satis.onayDurumu ? 'A.H' : 'Ödendi'}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;