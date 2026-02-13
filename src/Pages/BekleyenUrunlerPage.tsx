import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/user';
import { collection, query, getDocs, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { BekleyenUrun } from '../types/satis';
import { getSubeByKod, SUBELER } from '../types/sube';
import './BekleyenUrunler.css';

const BekleyenUrunlerPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [bekleyenUrunler, setBekleyenUrunler] = useState<BekleyenUrun[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'HEPSI' | 'BEKLEMEDE' | 'HAZIR' | 'TESLIM_EDILDI'>('HEPSI');
  const [showForm, setShowForm] = useState(false);

  const [yeniUrun, setYeniUrun] = useState({
    satisKodu: '',
    urunKodu: '',
    urunAdi: '',
    adet: 1,
    musteriIsmi: '',
    beklenenTeslimTarihi: '',
    notlar: ''
  });

  useEffect(() => {
    fetchBekleyenUrunler();
  }, [currentUser]);

  const fetchBekleyenUrunler = async () => {
    try {
      setLoading(true);
      const urunListesi: BekleyenUrun[] = [];

      if (currentUser?.role === UserRole.ADMIN) {
        // Admin tüm şubelerin bekleyen ürünlerini görebilir
        for (const sube of SUBELER) {
          const q = query(collection(db, `subeler/${sube.dbPath}/bekleyenUrunler`));
          const snapshot = await getDocs(q);
          snapshot.forEach(doc => {
            urunListesi.push({ id: doc.id, ...doc.data() } as BekleyenUrun);
          });
        }
      } else {
        // Çalışan sadece kendi şubesinin bekleyen ürünlerini görebilir
        const sube = getSubeByKod(currentUser!.subeKodu);
        if (sube) {
          const q = query(collection(db, `subeler/${sube.dbPath}/bekleyenUrunler`));
          const snapshot = await getDocs(q);
          snapshot.forEach(doc => {
            urunListesi.push({ id: doc.id, ...doc.data() } as BekleyenUrun);
          });
        }
      }

      // Tarihe göre sırala (en yeni en üstte)
// Tarihe göre sırala (en yeni en üstte)
urunListesi.sort((a, b) => {
  const dateA = a.siparisTarihi instanceof Date ? a.siparisTarihi : (a.siparisTarihi as any).toDate();
  const dateB = b.siparisTarihi instanceof Date ? b.siparisTarihi : (b.siparisTarihi as any).toDate();
  return dateB.getTime() - dateA.getTime();
});
      setBekleyenUrunler(urunListesi);
    } catch (error) {
      console.error('Bekleyen ürünler yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleYeniUrunEkle = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const sube = getSubeByKod(currentUser!.subeKodu);
      if (!sube) {
        alert('Şube bilgisi bulunamadı!');
        return;
      }

      const bekleyenUrun: Omit<BekleyenUrun, 'id'> = {
        satisKodu: yeniUrun.satisKodu,
        subeKodu: currentUser!.subeKodu,
        urunKodu: yeniUrun.urunKodu,
        urunAdi: yeniUrun.urunAdi,
        adet: yeniUrun.adet,
        musteriIsmi: yeniUrun.musteriIsmi,
        siparisTarihi: new Date(),
        beklenenTeslimTarihi: new Date(yeniUrun.beklenenTeslimTarihi),
        durum: 'BEKLEMEDE',
        notlar: yeniUrun.notlar,
        guncellemeTarihi: new Date()
      };

      await addDoc(collection(db, `subeler/${sube.dbPath}/bekleyenUrunler`), bekleyenUrun);

      // Formu sıfırla
      setYeniUrun({
        satisKodu: '',
        urunKodu: '',
        urunAdi: '',
        adet: 1,
        musteriIsmi: '',
        beklenenTeslimTarihi: '',
        notlar: ''
      });

      setShowForm(false);
      await fetchBekleyenUrunler();
      alert('Bekleyen ürün eklendi!');
    } catch (error) {
      console.error('Ürün eklenemedi:', error);
      alert('Bir hata oluştu!');
    }
  };

  const handleDurumGuncelle = async (urunId: string, subeKodu: string, yeniDurum: 'BEKLEMEDE' | 'HAZIR' | 'TESLIM_EDILDI') => {
    try {
      const sube = getSubeByKod(subeKodu as any);
      if (!sube) return;

      const urunRef = doc(db, `subeler/${sube.dbPath}/bekleyenUrunler`, urunId);
      await updateDoc(urunRef, {
        durum: yeniDurum,
        guncellemeTarihi: new Date()
      });

      await fetchBekleyenUrunler();
      alert('Durum güncellendi!');
    } catch (error) {
      console.error('Durum güncellenemedi:', error);
      alert('Bir hata oluştu!');
    }
  };

  const formatDate = (date: any) => {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('tr-TR');
  };

  const getDurumRenk = (durum: string) => {
    switch (durum) {
      case 'BEKLEMEDE':
        return 'orange';
      case 'HAZIR':
        return 'blue';
      case 'TESLIM_EDILDI':
        return 'green';
      default:
        return 'gray';
    }
  };

  const filtrelenmisUrunler = bekleyenUrunler.filter(urun => {
    if (filter === 'HEPSI') return true;
    return urun.durum === filter;
  });

  return (
    <div className="bekleyen-urunler-container">
      <div className="bekleyen-urunler-header">
        <button onClick={() => navigate('/dashboard')} className="btn-back">
          ← Geri
        </button>
        <h1>Bekleyen Ürünler Takip Sistemi</h1>
      </div>

      <div className="bekleyen-urunler-content">
        <div className="content-header">
          <div className="filter-buttons">
            <button
              onClick={() => setFilter('HEPSI')}
              className={`filter-btn ${filter === 'HEPSI' ? 'active' : ''}`}
            >
              Hepsi ({bekleyenUrunler.length})
            </button>
            <button
              onClick={() => setFilter('BEKLEMEDE')}
              className={`filter-btn ${filter === 'BEKLEMEDE' ? 'active' : ''}`}
            >
              Beklemede ({bekleyenUrunler.filter(u => u.durum === 'BEKLEMEDE').length})
            </button>
            <button
              onClick={() => setFilter('HAZIR')}
              className={`filter-btn ${filter === 'HAZIR' ? 'active' : ''}`}
            >
              Hazır ({bekleyenUrunler.filter(u => u.durum === 'HAZIR').length})
            </button>
            <button
              onClick={() => setFilter('TESLIM_EDILDI')}
              className={`filter-btn ${filter === 'TESLIM_EDILDI' ? 'active' : ''}`}
            >
              Teslim Edildi ({bekleyenUrunler.filter(u => u.durum === 'TESLIM_EDILDI').length})
            </button>
          </div>
        </div>

        {showForm && (
          <div className="yeni-urun-form">
            <h3>Yeni Bekleyen Ürün Ekle</h3>
            <form onSubmit={handleYeniUrunEkle}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Satış Kodu *</label>
                  <input
                    type="text"
                    value={yeniUrun.satisKodu}
                    onChange={(e) => setYeniUrun({ ...yeniUrun, satisKodu: e.target.value })}
                    placeholder="Örn: 1010-0001"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Ürün Kodu *</label>
                  <input
                    type="text"
                    value={yeniUrun.urunKodu}
                    onChange={(e) => setYeniUrun({ ...yeniUrun, urunKodu: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Ürün Adı *</label>
                  <input
                    type="text"
                    value={yeniUrun.urunAdi}
                    onChange={(e) => setYeniUrun({ ...yeniUrun, urunAdi: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Adet *</label>
                  <input
                    type="number"
                    min="1"
                    value={yeniUrun.adet}
                    onChange={(e) => setYeniUrun({ ...yeniUrun, adet: parseInt(e.target.value) })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Müşteri İsmi *</label>
                  <input
                    type="text"
                    value={yeniUrun.musteriIsmi}
                    onChange={(e) => setYeniUrun({ ...yeniUrun, musteriIsmi: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Beklenen Teslim Tarihi *</label>
                  <input
                    type="date"
                    value={yeniUrun.beklenenTeslimTarihi}
                    onChange={(e) => setYeniUrun({ ...yeniUrun, beklenenTeslimTarihi: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group full-width">
                  <label>Notlar</label>
                  <input
                    type="text"
                    value={yeniUrun.notlar}
                    onChange={(e) => setYeniUrun({ ...yeniUrun, notlar: e.target.value })}
                    placeholder="Ek bilgiler, özel notlar..."
                  />
                </div>
              </div>

              <div className="form-actions">
                <button type="button" onClick={() => setShowForm(false)} className="btn-cancel">
                  İptal
                </button>
                <button type="submit" className="btn-submit">
                  Ekle
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="loading">Yükleniyor...</div>
        ) : filtrelenmisUrunler.length === 0 ? (
          <div className="empty-state">
            <p>
              {filter === 'HEPSI' ? 'Henüz bekleyen ürün bulunmuyor.' : `${filter} durumunda ürün bulunmuyor.`}
            </p>
          </div>
        ) : (
          <div className="urun-cards">
            {filtrelenmisUrunler.map(urun => (
              <div key={urun.id} className="urun-card">
                <div className="card-header">
                  <div>
                    <h3>{urun.urunAdi}</h3>
                    <p className="urun-kod">Kod: {urun.urunKodu}</p>
                  </div>
                  <span className={`durum-badge ${getDurumRenk(urun.durum)}`}>
                    {urun.durum === 'BEKLEMEDE' ? 'Beklemede' : 
                     urun.durum === 'HAZIR' ? 'Hazır' : 'Teslim Edildi'}
                  </span>
                </div>

                <div className="card-body">
                  <div className="info-row">
                    <span className="label">Satış Kodu:</span>
                    <span className="value">{urun.satisKodu}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Şube:</span>
                    <span className="value">{getSubeByKod(urun.subeKodu)?.ad}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Müşteri:</span>
                    <span className="value">{urun.musteriIsmi}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Adet:</span>
                    <span className="value"><strong>{urun.adet}</strong></span>
                  </div>
                  <div className="info-row">
                    <span className="label">Sipariş Tarihi:</span>
                    <span className="value">{formatDate(urun.siparisTarihi)}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Beklenen Teslim:</span>
                    <span className="value"><strong>{formatDate(urun.beklenenTeslimTarihi)}</strong></span>
                  </div>
                  {urun.notlar && (
                    <div className="info-row notlar">
                      <span className="label">Notlar:</span>
                      <span className="value">{urun.notlar}</span>
                    </div>
                  )}
                </div>

                <div className="card-actions">
                  {urun.durum === 'BEKLEMEDE' && (
                    <button
                      onClick={() => handleDurumGuncelle(urun.id, urun.subeKodu, 'HAZIR')}
                      className="btn-durum hazir"
                    >
                      Hazır Olarak İşaretle
                    </button>
                  )}
                  {urun.durum === 'HAZIR' && (
                    <button
                      onClick={() => handleDurumGuncelle(urun.id, urun.subeKodu, 'TESLIM_EDILDI')}
                      className="btn-durum teslim"
                    >
                      Teslim Edildi
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default BekleyenUrunlerPage;
