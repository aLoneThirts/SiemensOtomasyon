import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu } from '../types/satis';
import { getSubeByKod } from '../types/sube';
import './SatisDetay.css';

const SatisDetayPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [satis, setSatis] = useState<SatisTeklifFormu | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSatisDetay();
  }, [id]);

  const fetchSatisDetay = async () => {
    try {
      setLoading(true);
      
      // Tüm şubelerde ara
      for (const sube of getSubeByKod(currentUser!.subeKodu) ? [getSubeByKod(currentUser!.subeKodu)!] : []) {
        const satisDoc = await getDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!));
        
        if (satisDoc.exists()) {
          setSatis({ id: satisDoc.id, ...satisDoc.data() } as SatisTeklifFormu);
          break;
        }
      }
    } catch (error) {
      console.error('Satış detayı yüklenemedi:', error);
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
    return d.toLocaleDateString('tr-TR');
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div className="loading">Yükleniyor...</div>;
  }

  if (!satis) {
    return (
      <div className="not-found">
        <h2>Satış bulunamadı</h2>
        <button onClick={() => navigate('/dashboard')} className="btn-back">
          Dashboard'a Dön
        </button>
      </div>
    );
  }

  return (
    <div className="satis-detay-container">
      <div className="satis-detay-header">
        <button onClick={() => navigate('/dashboard')} className="btn-back">
          ← Geri
        </button>
        <h1>Satış Detayı</h1>
        <button onClick={handlePrint} className="btn-print">
          🖨️ Yazdır
        </button>
      </div>

      <div className="satis-detay-content">
        {/* Başlık Bilgileri */}
        <div className="detay-section">
          <div className="section-header">
            <h2>Satış Bilgileri</h2>
            <span className={`status-badge ${satis.onayDurumu ? 'approved' : 'pending'}`}>
              {satis.onayDurumu ? 'Onaylı' : 'Onay Bekliyor'}
            </span>
          </div>
          
          <div className="info-grid">
            <div className="info-item">
              <label>Satış Kodu</label>
              <strong>{satis.satisKodu}</strong>
            </div>
            <div className="info-item">
              <label>Şube</label>
              <span>{getSubeByKod(satis.subeKodu)?.ad}</span>
            </div>
            <div className="info-item">
              <label>Tarih</label>
              <span>{formatDate(satis.tarih)}</span>
            </div>
            <div className="info-item">
              <label>Teslimat Tarihi</label>
              <span>{formatDate(satis.teslimatTarihi)}</span>
            </div>
            <div className="info-item">
              <label>Müşteri Temsilcisi</label>
              <span>{satis.musteriTemsilcisi || '-'}</span>
            </div>
            <div className="info-item">
              <label>Oluşturan</label>
              <span>{satis.olusturanKullanici}</span>
            </div>
          </div>
        </div>

        {/* Müşteri Bilgileri */}
        <div className="detay-section">
          <h2>Müşteri Bilgileri</h2>
          <div className="info-grid">
            <div className="info-item">
              <label>İsim</label>
              <strong>{satis.musteriBilgileri.isim}</strong>
            </div>
            <div className="info-item">
              <label>Adres</label>
              <span>{satis.musteriBilgileri.adres}</span>
            </div>
            <div className="info-item">
              <label>Fatura Adresi</label>
              <span>{satis.musteriBilgileri.faturaAdresi || '-'}</span>
            </div>
            <div className="info-item">
              <label>İş Adresi</label>
              <span>{satis.musteriBilgileri.isAdresi || '-'}</span>
            </div>
            <div className="info-item">
              <label>Vergi Numarası</label>
              <span>{satis.musteriBilgileri.vergiNumarasi || '-'}</span>
            </div>
          </div>
        </div>

        {/* Ürünler */}
        <div className="detay-section">
          <h2>Ürünler</h2>
          <table className="urunler-table">
            <thead>
              <tr>
                <th>Ürün Kodu</th>
                <th>Ürün Adı</th>
                <th>Adet</th>
                <th>Birim Fiyat</th>
                <th>Toplam</th>
              </tr>
            </thead>
            <tbody>
              {satis.urunler.map((urun, index) => (
                <tr key={index}>
                  <td>{urun.kod}</td>
                  <td><strong>{urun.ad}</strong></td>
                  <td>{urun.adet}</td>
                  <td>{formatPrice(urun.alisFiyati)}</td>
                  <td><strong>{formatPrice(urun.adet * urun.alisFiyati)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="toplam-row">
                <td colSpan={4}>Genel Toplam</td>
                <td><strong>{formatPrice(satis.toplamTutar)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Ödeme ve Diğer Bilgiler */}
        <div className="detay-section">
          <h2>Ödeme ve Teslimat Bilgileri</h2>
          <div className="info-grid">
            <div className="info-item">
              <label>Ödeme Yöntemi</label>
              <strong>{satis.odemeYontemi}</strong>
            </div>
            <div className="info-item">
              <label>Hesaba Geçen</label>
              <span>{satis.hesabaGecen || '-'}</span>
            </div>
            <div className="info-item">
              <label>Mağaza</label>
              <span>{satis.magaza || '-'}</span>
            </div>
            <div className="info-item">
              <label>Cevap</label>
              <span>{satis.cevap || '-'}</span>
            </div>
          </div>

          <div className="checkbox-info">
            <div className="checkbox-item">
              <span className={satis.fatura ? 'checked' : ''}>
                {satis.fatura ? '✓' : '✗'} Fatura
              </span>
            </div>
            <div className="checkbox-item">
              <span className={satis.ileriTeslim ? 'checked' : ''}>
                {satis.ileriTeslim ? '✓' : '✗'} İleri Teslim
              </span>
            </div>
            <div className="checkbox-item">
              <span className={satis.servis ? 'checked' : ''}>
                {satis.servis ? '✓' : '✗'} Servis
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SatisDetayPage;