import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/user';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu } from '../types/satis';
import { getSubeByKod, SUBELER } from '../types/sube';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [satislar, setSatislar] = useState<SatisTeklifFormu[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      navigate('/login');
      return;
    }

    fetchSatislar();
  }, [currentUser]);

  const fetchSatislar = async () => {
    try {
      setLoading(true);
      const satisListesi: SatisTeklifFormu[] = [];

      if (currentUser?.role === UserRole.ADMIN) {
        // Admin tüm şubelerin satışlarını görebilir
        for (const sube of SUBELER) {
          try {
            const satisRef = collection(db, `subeler/${sube.dbPath}/satislar`);
            const snapshot = await getDocs(satisRef);
            
            snapshot.forEach((doc: any) => {
              satisListesi.push({ id: doc.id, ...doc.data() } as SatisTeklifFormu);
            });
          } catch (error) {
            console.error(`${sube.ad} şubesi yüklenemedi:`, error);
          }
        }
      } else {
        // Çalışan sadece kendi şubesinin satışlarını görebilir
        const sube = getSubeByKod(currentUser!.subeKodu);
        if (sube) {
          const satisRef = collection(db, `subeler/${sube.dbPath}/satislar`);
          const snapshot = await getDocs(satisRef);
          
          snapshot.forEach((doc: any) => {
            satisListesi.push({ id: doc.id, ...doc.data() } as SatisTeklifFormu);
          });
        }
      }

      setSatislar(satisListesi);
    } catch (error) {
      console.error('Satışlar yüklenemedi:', error);
    } finally {
      setLoading(false);
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

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-content">
<<<<<<< Updated upstream
          <h1>SIEMENS OTOMASYON</h1>
=======
          <h1>İş Takip Sistemi</h1>
>>>>>>> Stashed changes
          <div className="user-info">
            <div className="user-details">
              <div className="user-name">{currentUser?.ad} {currentUser?.soyad}</div>
              <div className="user-meta">
                <span className="user-sube">{getSubeByKod(currentUser!.subeKodu)?.ad}</span>
                <span className="user-role">
                  ({currentUser?.role === UserRole.ADMIN ? 'Admin' : 'Çalışan'})
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
          Bekleyen Ürünler
        </button>
        {currentUser?.role === UserRole.ADMIN && (
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

        {loading ? (
          <div className="loading">Yükleniyor...</div>
        ) : satislar.length === 0 ? (
          <div className="empty-state">
            <p>Henüz satış kaydı bulunmuyor.</p>
            <button onClick={() => navigate('/satis-teklif')} className="btn-primary">
              İLK SATIŞ TEKLİFİNİ OLUŞTUR
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
                {satislar.map(satis => (
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