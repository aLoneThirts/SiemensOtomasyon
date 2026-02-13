// AdminPanel.tsx (GÜNCELLENMİŞ VERSİYON)
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

  const [tumSatislar, setTumSatislar] = useState<SatisTeklifFormu[]>([]);
  const [subeIstatistikleri, setSubeIstatistikleri] = useState<any[]>([]);
  const [sonLoglar, setSonLoglar] = useState<SatisLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSube, setSelectedSube] = useState<string>('tumu');

  useEffect(() => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN) {
      navigate('/dashboard');
      return;
    }

    fetchAdminData();
  }, [currentUser]);

 // AdminPanel.tsx - fetchAdminData fonksiyonunu güncelle
// AdminPanel.tsx - fetchAdminData fonksiyonunu güncelle
const fetchAdminData = async () => {
  try {
    setLoading(true);
    let toplamSatis = 0;
    let toplamTutar = 0;
    let bekleyenUrunler = 0;
    let onayBekleyenSatislar = 0;
    const subeStats: any[] = [];
    const tumLoglar: SatisLog[] = [];
    const tumSatislarListesi: SatisTeklifFormu[] = [];

    for (const sube of SUBELER) {
      try {
        // Satışları çek
        const satisQuery = query(collection(db, `subeler/${sube.dbPath}/satislar`));
        const satisSnapshot = await getDocs(satisQuery);
        
        let subeSatisSayisi = 0;
        let subeToplam = 0;
        let subeOnayBekleyen = 0;

        satisSnapshot.forEach((doc: any) => {
          const satis = { id: doc.id, ...doc.data() } as SatisTeklifFormu;
          tumSatislarListesi.push(satis);
          
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
        let subeBekleyen = 0; // Burada tanımlıyoruz
        try {
          const bekleyenQuery = query(collection(db, `subeler/${sube.dbPath}/bekleyenUrunler`));
          const bekleyenSnapshot = await getDocs(bekleyenQuery);
          
          bekleyenSnapshot.forEach((doc: any) => {
            const urun = doc.data() as BekleyenUrun;
            if (urun.durum !== 'TESLIM_EDILDI') {
              bekleyenUrunler++;
              subeBekleyen++;
            }
          });
        } catch (error) {
          console.warn(`${sube.ad} - Bekleyen ürünler yüklenemedi:`, error);
        }

        // Logları çek
        try {
          const logQuery = query(collection(db, `subeler/${sube.dbPath}/loglar`));
          const logSnapshot = await getDocs(logQuery);
          
          logSnapshot.forEach((doc: any) => {
            tumLoglar.push({ id: doc.id, ...doc.data() } as SatisLog);
          });
        } catch (error) {
          console.warn(`${sube.ad} - Loglar yüklenemedi:`, error);
        }

        subeStats.push({
          sube: sube.ad,
          subeKodu: sube.kod,
          satisSayisi: subeSatisSayisi,
          toplamTutar: subeToplam,
          bekleyenUrunler: subeBekleyen, // Artık tanımlı
          onayBekleyen: subeOnayBekleyen
        });

      } catch (error) {
        console.error(`${sube.ad} şubesi verileri yüklenemedi:`, error);
        // Hata alsak bile diğer şubelere devam et
        subeStats.push({
          sube: sube.ad,
          subeKodu: sube.kod,
          satisSayisi: 0,
          toplamTutar: 0,
          bekleyenUrunler: 0,
          onayBekleyen: 0,
          hata: true
        });
      }
    }

    // Tarihe göre sırala (en yeni en üstte)
    const siraliSatislar = tumSatislarListesi.sort((a, b) => {
      const dateA = a.tarih instanceof Date ? a.tarih : (a.tarih as any)?.toDate?.() || new Date(0);
      const dateB = b.tarih instanceof Date ? b.tarih : (b.tarih as any)?.toDate?.() || new Date(0);
      return dateB.getTime() - dateA.getTime();
    });

    setTumSatislar(siraliSatislar);
    setIstatistikler({
      toplamSatis,
      toplamTutar,
      bekleyenUrunler,
      onayBekleyenSatislar
    });

    setSubeIstatistikleri(subeStats);

    // En son 20 logu göster
    const siraliLoglar = tumLoglar.sort((a, b) => {
      const dateA = a.tarih instanceof Date ? a.tarih : (a.tarih as any)?.toDate?.() || new Date(0);
      const dateB = b.tarih instanceof Date ? b.tarih : (b.tarih as any)?.toDate?.() || new Date(0);
      return dateB.getTime() - dateA.getTime();
    }).slice(0, 20);

    setSonLoglar(siraliLoglar);
  } catch (error) {
    console.error('Admin verileri yüklenemedi:', error);
    alert('Veriler yüklenirken bir hata oluştu. Lütfen sayfayı yenileyin.');
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

  const formatShortDate = (date: any) => {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('tr-TR');
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Çıkış yapılamadı:', error);
    }
  };

  const filteredSatislar = selectedSube === 'tumu' 
    ? tumSatislar 
    : tumSatislar.filter(satis => satis.subeKodu === selectedSube);

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

        {/* Tüm Satışlar Tablosu */}
        <div className="section">
          <div className="section-header">
            <h2>Tüm Şubeler - Satış Listesi</h2>
            <div className="filter-section">
              <select 
                value={selectedSube} 
                onChange={(e) => setSelectedSube(e.target.value)}
                className="filter-select"
              >
                <option value="tumu">Tüm Şubeler</option>
                {SUBELER.map(sube => (
                  <option key={sube.kod} value={sube.kod}>
                    {sube.ad}
                  </option>
                ))}
              </select>
              <button onClick={fetchAdminData} className="btn-refresh">Yenile</button>
            </div>
          </div>

          {filteredSatislar.length === 0 ? (
            <div className="empty-state">
              <p>Gösterilecek satış bulunmuyor.</p>
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
                  {filteredSatislar.map(satis => (
                    <tr key={satis.id}>
                      <td><strong>{satis.satisKodu}</strong></td>
                      <td>{getSubeByKod(satis.subeKodu)?.ad}</td>
                      <td>{satis.musteriBilgileri?.isim || 'Belirtilmemiş'}</td>
                      <td><strong>{formatPrice(satis.toplamTutar)}</strong></td>
                      <td>{formatShortDate(satis.tarih)}</td>
                      <td>{formatShortDate(satis.teslimatTarihi)}</td>
                      <td>
                        <span className={`status-badge ${satis.onayDurumu ? 'approved' : 'pending'}`}>
                          {satis.onayDurumu ? 'Onaylı' : 'Beklemede'}
                        </span>
                      </td>
                      <td>
                        <button 
                          onClick={() => navigate(`/satis-detay/${satis.subeKodu}/${satis.id}`)}
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