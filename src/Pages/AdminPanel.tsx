import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/user';
import { collection, query, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, BekleyenUrun, SatisLog } from '../types/satis';
import { SUBELER, getSubeByKod } from '../types/sube';
import './AdminPanel.css';

const AdminPanel: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();

  const [istatistikler, setIstatistikler] = useState({
    toplamSatis: 0,
    toplamTutar: 0,
    bekleyenUrunler: 0,
    onayBekleyenSatislar: 0
  });

  const [subeIstatistikleri, setSubeIstatistikleri] = useState<any[]>([]);
  const [sonLoglar, setSonLoglar] = useState<SatisLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) {
      navigate('/dashboard');
      return;
    }

    fetchAdminData();
  }, [currentUser]);

  const fetchAdminData = async () => {
    try {
      setLoading(true);
      let toplamSatis = 0;
      let toplamTutar = 0;
      let bekleyenUrunler = 0;
      let onayBekleyenSatislar = 0;
      const subeStats: any[] = [];
      const tumLoglar: SatisLog[] = [];

      for (const sube of SUBELER) {
        // Satışları çek
        const satisQuery = query(collection(db, `subeler/${sube.dbPath}/satislar`));
        const satisSnapshot = await getDocs(satisQuery);
        
        let subeSatisSayisi = 0;
        let subeToplam = 0;
        let subeOnayBekleyen = 0;

        satisSnapshot.forEach(doc => {
          const satis = doc.data() as SatisTeklifFormu;
          toplamSatis++;
          subeSatisSayisi++;
          toplamTutar += satis.toplamTutar;
          subeToplam += satis.toplamTutar;
          if (!satis.onayDurumu) {
            onayBekleyenSatislar++;
            subeOnayBekleyen++;
          }
        });

        // Bekleyen ürünleri çek
        const bekleyenQuery = query(collection(db, `subeler/${sube.dbPath}/bekleyenUrunler`));
        const bekleyenSnapshot = await getDocs(bekleyenQuery);
        let subeBekleyen = 0;
        
        bekleyenSnapshot.forEach(doc => {
          const urun = doc.data() as BekleyenUrun;
          if (urun.durum !== 'TESLIM_EDILDI') {
            bekleyenUrunler++;
            subeBekleyen++;
          }
        });

        // Logları çek
        const logQuery = query(collection(db, `subeler/${sube.dbPath}/loglar`));
        const logSnapshot = await getDocs(logQuery);
        
        logSnapshot.forEach(doc => {
          tumLoglar.push({ id: doc.id, ...doc.data() } as SatisLog);
        });

        subeStats.push({
          sube: sube.ad,
          satisSayisi: subeSatisSayisi,
          toplamTutar: subeToplam,
          bekleyenUrunler: subeBekleyen,
          onayBekleyen: subeOnayBekleyen
        });
      }

      setIstatistikler({
        toplamSatis,
        toplamTutar,
        bekleyenUrunler,
        onayBekleyenSatislar
      });

      setSubeIstatistikleri(subeStats);

      // En son 20 logu göster
      const siraliLoglar = tumLoglar.sort((a, b) => {
        const dateA = a.tarih instanceof Date ? a.tarih : (a.tarih as any).toDate();
        const dateB = b.tarih instanceof Date ? b.tarih : (b.tarih as any).toDate();
        return dateB.getTime() - dateA.getTime();
      }).slice(0, 20);

      setSonLoglar(siraliLoglar);
    } catch (error) {
      console.error('Admin verileri yüklenemedi:', error);
    } finally {
      setLoading(false);
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
    return d.toLocaleString('tr-TR');
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Çıkış yapılamadı:', error);
    }
  };

  if (loading) {
    return <div className="loading">Yükleniyor...</div>;
  }

  return (
    <div className="admin-panel-container">
      <header className="admin-header">
        <div className="header-content">
          <h1>🔧 Admin Paneli</h1>
          <div className="user-info">
            <span className="user-name">
              {currentUser?.ad} {currentUser?.soyad}
              <span className="admin-badge">Admin</span>
            </span>
            <button onClick={handleLogout} className="btn-logout">Çıkış</button>
          </div>
        </div>
      </header>

      <nav className="admin-nav">
        <button onClick={() => navigate('/dashboard')} className="nav-btn">
          Satışlar
        </button>
        <button onClick={() => navigate('/bekleyen-urunler')} className="nav-btn">
          Bekleyen Ürünler
        </button>
        <button onClick={() => navigate('/admin')} className="nav-btn active">
          Admin Panel
        </button>
      </nav>

      <div className="admin-content">
        {/* Genel İstatistikler */}
        <div className="stats-grid">
          <div className="stat-card purple">
            <div className="stat-icon">📊</div>
            <div className="stat-info">
              <h3>Toplam Satış</h3>
              <p className="stat-value">{istatistikler.toplamSatis}</p>
            </div>
          </div>

          <div className="stat-card green">
            <div className="stat-icon">💰</div>
            <div className="stat-info">
              <h3>Toplam Tutar</h3>
              <p className="stat-value">{formatPrice(istatistikler.toplamTutar)}</p>
            </div>
          </div>

          <div className="stat-card orange">
            <div className="stat-icon">📦</div>
            <div className="stat-info">
              <h3>Bekleyen Ürünler</h3>
              <p className="stat-value">{istatistikler.bekleyenUrunler}</p>
            </div>
          </div>

          <div className="stat-card blue">
            <div className="stat-icon">⏳</div>
            <div className="stat-info">
              <h3>Onay Bekleyen</h3>
              <p className="stat-value">{istatistikler.onayBekleyenSatislar}</p>
            </div>
          </div>
        </div>

        {/* Şube İstatistikleri */}
        <div className="section">
          <h2>Şube Bazlı İstatistikler</h2>
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Şube</th>
                  <th>Satış Sayısı</th>
                  <th>Toplam Tutar</th>
                  <th>Bekleyen Ürünler</th>
                  <th>Onay Bekleyen</th>
                </tr>
              </thead>
              <tbody>
                {subeIstatistikleri.map((stat, index) => (
                  <tr key={index}>
                    <td><strong>{stat.sube}</strong></td>
                    <td>{stat.satisSayisi}</td>
                    <td><strong>{formatPrice(stat.toplamTutar)}</strong></td>
                    <td>{stat.bekleyenUrunler}</td>
                    <td>{stat.onayBekleyen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Son İşlemler (Loglar) */}
        <div className="section">
          <h2>Son İşlemler</h2>
          <div className="log-container">
            {sonLoglar.map(log => (
              <div key={log.id} className="log-item">
                <div className="log-header">
                  <span className="log-badge">{log.islem}</span>
                  <span className="log-time">{formatDate(log.tarih)}</span>
                </div>
                <div className="log-body">
                  <p><strong>{getSubeByKod(log.subeKodu)?.ad}</strong> - {log.satisKodu}</p>
                  <p className="log-detail">{log.detay}</p>
                  <p className="log-user">👤 {log.kullanici}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;