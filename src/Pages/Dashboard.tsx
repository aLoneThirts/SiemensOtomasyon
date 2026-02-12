import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/user';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
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
          const q = query(
            collection(db, `subeler/${sube.dbPath}/satislar`),
            orderBy('olusturmaTarihi', 'desc')
          );
          const snapshot = await getDocs(q);
          snapshot.forEach(doc => {
            satisListesi.push({ id: doc.id, ...doc.data() } as SatisTeklifFormu);
          });
        }
      } else {
        // Çalışan sadece kendi şubesinin satışlarını görebilir
        const sube = getSubeByKod(currentUser!.subeKodu);
        if (sube) {
          const q = query(
            collection(db, `subeler/${sube.dbPath}/satislar`),
            orderBy('olusturmaTarihi', 'desc')
          );
          const snapshot = await getDocs(q);
          snapshot.forEach(doc => {
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
          <h1>Siemens Otomasyon</h1>
          <div className="user-info">
            <span className="user-name">
              {currentUser?.ad} {currentUser?.soyad}
              {currentUser?.role === UserRole.ADMIN && <span className="admin-badge">Admin</span>}
            </span>
            <span className="user-sube">{getSubeByKod(currentUser!.subeKodu)?.ad}</span>
            <button onClick={handleLogout} className="btn-logout">Çıkış</button>
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
          <button onClick={fetchSatislar} className="btn-refresh">Yenile</button>
        </div>

        {loading ? (
          <div className="loading">Yükleniyor...</div>
        ) : satislar.length === 0 ? (
          <div className="empty-state">
            <p>Henüz satış kaydı bulunmuyor.</p>
            <button onClick={() => navigate('/satis-teklif')} className="btn-primary">
              İlk Satış Teklifini Oluştur
            </button>
          </div>
        ) : (
          <div className="sales-table-container">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>Satış Kodu</th>
                  <th>Şube</th>
                  <th>Müşteri</th>
                  <th>Toplam Tutar</th>
                  <th>Tarih</th>
                  <th>Teslimat</th>
                  <th>Durum</th>
                  <th>İşlemler</th>
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
                        {satis.onayDurumu ? 'Onaylı' : 'Beklemede'}
                      </span>
                    </td>
                    <td>
                      <button 
                        onClick={() => navigate(`/satis-detay/${satis.id}`)}
                        className="btn-view"
                      >
                        Görüntüle
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
