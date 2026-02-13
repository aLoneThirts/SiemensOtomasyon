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

      console.log('Kullanıcı rolü:', currentUser?.role);
      console.log('Kullanıcı şubesi:', currentUser?.subeKodu);

      if (currentUser?.role === UserRole.ADMIN) {
        // ADMIN - TÜM ŞUBELERİN SATIŞLARINI GETİR
        console.log('Admin tüm şubeleri getiriyor...');
        
        for (const sube of SUBELER) {
          try {
            console.log(`${sube.ad} şubesi getiriliyor... Path: subeler/${sube.dbPath}/satislar`);
            const satisRef = collection(db, `subeler/${sube.dbPath}/satislar`);
            const snapshot = await getDocs(satisRef);
            
            console.log(`${sube.ad}: ${snapshot.size} satış bulundu`);
            
            snapshot.forEach((doc) => {
              const satisData = doc.data();
              satisListesi.push({ 
                id: doc.id, 
                ...satisData,
                subeKodu: sube.kod
              } as SatisTeklifFormu);
            });
          } catch (error) {
            console.error(`${sube.ad} şubesi yüklenirken hata:`, error);
          }
        }
      } else {
        // CALISAN - SADECE KENDİ ŞUBESİ
        console.log('Çalışan kendi şubesini getiriyor...');
        const sube = getSubeByKod(currentUser!.subeKodu);
        
        if (sube) {
          try {
            console.log(`${sube.ad} şubesi getiriliyor... Path: subeler/${sube.dbPath}/satislar`);
            const satisRef = collection(db, `subeler/${sube.dbPath}/satislar`);
            const snapshot = await getDocs(satisRef);
            
            console.log(`${sube.ad}: ${snapshot.size} satış bulundu`);
            
            snapshot.forEach((doc) => {
              satisListesi.push({ 
                id: doc.id, 
                ...doc.data() 
              } as SatisTeklifFormu);
            });
          } catch (error) {
            console.error('Satışlar yüklenirken hata:', error);
          }
        }
      }

      console.log('TÜM SATIŞLAR:', satisListesi.map(s => ({
        id: s.id,
        sube: s.subeKodu,
        kod: s.satisKodu
      })));

      const siraliSatislar = [...satisListesi].sort((a: any, b: any) => {
        const getDate = (tarih: any): Date => {
          if (!tarih) return new Date(0);
          if (tarih && typeof tarih === 'object' && 'toDate' in tarih) {
            return tarih.toDate();
          }
          if (tarih instanceof Date) {
            return tarih;
          }
          return new Date(tarih);
        };
        
        const dateA = getDate(a.tarih);
        const dateB = getDate(b.tarih);
        return dateB.getTime() - dateA.getTime();
      });

      console.log('Toplam satış sayısı:', siraliSatislar.length);
      setSatislar(siraliSatislar);
      
    } catch (error) {
      console.error('Ana hata:', error);
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
    try {
      if (date && typeof date === 'object' && 'toDate' in date) {
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

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>İş Takip Sistemi</h1>
          <div className="user-info">
            <div className="user-details">
              <span className="user-name">
                {currentUser?.ad} {currentUser?.soyad}
              </span>
              <div className="user-badges">
                {/* DÜZELTİLDİ: Admin/User ayrımı */}
                <span className={`role-badge ${currentUser?.role === UserRole.ADMIN ? 'role-admin' : 'role-user'}`}>
                  {currentUser?.role === UserRole.ADMIN ? 'Admin' : 'User'}
                </span>
                <span className="sube-badge">
                  {currentUser?.role === UserRole.ADMIN 
                    ? 'Tüm Şubeler' 
                    : `${getSubeByKod(currentUser!.subeKodu)?.ad} Şubesi`}
                </span>
              </div>
            </div>
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
                {satislar.map((satis) => (
                  <tr key={satis.id}>
                    <td><strong>{satis.satisKodu}</strong></td>
                    <td>
                      {satis.subeKodu ? 
                        getSubeByKod(satis.subeKodu)?.ad : 
                        getSubeByKod(currentUser!.subeKodu)?.ad}
                    </td>
                    <td>{satis.musteriBilgileri?.isim || 'Belirtilmemiş'}</td>
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
                        onClick={() => {
                          const subeKodu = satis.subeKodu || currentUser!.subeKodu;
                          navigate(`/satis-detay/${subeKodu}/${satis.id}`);
                        }}
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