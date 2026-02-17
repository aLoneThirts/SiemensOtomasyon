import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { KasaGun, KasaHareket, KasaHareketTipi } from '../types/kasa';
import { getBugununKasaGunu, kasaHareketEkle, getKasaGecmisi } from '../services/kasaService';
import './Kasa.css';

const Kasa: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  
  const [kasaGun, setKasaGun] = useState<KasaGun | null>(null);
  const [loading, setLoading] = useState(true);
  const [gecmis, setGecmis] = useState<KasaGun[]>([]);
  const [gecmisGorunuyor, setGecmisGorunuyor] = useState(false);
  
  // Yeni hareket formu
  const [yeniHareketAciklama, setYeniHareketAciklama] = useState('');
  const [yeniHareketTutar, setYeniHareketTutar] = useState<number>(0);
  const [yeniHareketTip, setYeniHareketTip] = useState<KasaHareketTipi>(KasaHareketTipi.MARKET);
  const [yeniHareketBelgeNo, setYeniHareketBelgeNo] = useState('');
  const [yeniHareketNot, setYeniHareketNot] = useState('');
  const [formHata, setFormHata] = useState('');
  const [eklemeModu, setEklemeModu] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      navigate('/login');
      return;
    }
    loadKasa();
  }, [currentUser]);

  const loadKasa = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    try {
      const gun = await getBugununKasaGunu(currentUser.subeKodu, `${currentUser.ad} ${currentUser.soyad}`);
      setKasaGun(gun);
      
      const gecmisData = await getKasaGecmisi(currentUser.subeKodu, 30);
      setGecmis(gecmisData.filter(g => g.gun !== gun?.gun));
    } catch (error) {
      console.error('Kasa yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleHareketEkle = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentUser || !kasaGun?.id) {
      console.log('Hata: currentUser veya kasaGun yok', { currentUser, kasaGun });
      setFormHata('Kullanıcı veya kasa günü bulunamadı!');
      return;
    }
    
    if (!yeniHareketAciklama.trim()) {
      setFormHata('Açıklama giriniz!');
      return;
    }
    
    if (yeniHareketTutar <= 0) {
      setFormHata('Tutar 0\'dan büyük olmalı!');
      return;
    }
    
    setFormHata('');
    
    try {
      const basarili = await kasaHareketEkle(
        currentUser.subeKodu,
        kasaGun.id,
        {
          aciklama: yeniHareketAciklama,
          tutar: yeniHareketTutar,
          tip: yeniHareketTip,
          belgeNo: yeniHareketBelgeNo || undefined,
          not: yeniHareketNot || undefined,
          tarih: new Date(),
          kullanici: `${currentUser.ad} ${currentUser.soyad}`,
          kullaniciId: currentUser.uid || '',
          subeKodu: currentUser.subeKodu
        },
        `${currentUser.ad} ${currentUser.soyad}`,
        currentUser.uid || ''
      );
      
      if (basarili) {
        setYeniHareketAciklama('');
        setYeniHareketTutar(0);
        setYeniHareketBelgeNo('');
        setYeniHareketNot('');
        setEklemeModu(false);
        await loadKasa();
        alert('✅ İşlem başarıyla eklendi!');
      } else {
        setFormHata('İşlem başarısız!');
      }
    } catch (error) {
      console.error('Hata detayı:', error);
      setFormHata('İşlem başarısız: ' + (error as Error).message);
    }
  };

  const formatPrice = (price: number): string => {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2
    }).format(price);
  };

  const formatGun = (gun: string): string => {
    const [yil, ay, gunStr] = gun.split('-');
    return `${gunStr}.${ay}.${yil}`;
  };

  const getTipIcon = (tip: KasaHareketTipi): string => {
    switch(tip) {
      case KasaHareketTipi.GELIR: return '💰';
      case KasaHareketTipi.GIDER: return '💸';
      case KasaHareketTipi.MARKET: return '🛒';
      case KasaHareketTipi.DIGER: return '📝';
      default: return '•';
    }
  };

  const getTipClass = (tip: KasaHareketTipi): string => {
    switch(tip) {
      case KasaHareketTipi.GELIR: return 'gelir';
      case KasaHareketTipi.GIDER: return 'gider';
      case KasaHareketTipi.MARKET: return 'market';
      case KasaHareketTipi.DIGER: return 'diger';
      default: return '';
    }
  };

  if (loading) {
    return (
      <div className="kasa-container">
        <div className="loading">Kasa yükleniyor...</div>
      </div>
    );
  }

  return (
    <div className="kasa-container">
      <div className="kasa-header">
        <div className="kasa-header-left">
          <button onClick={() => navigate('/dashboard')} className="btn-back">
            ← Geri
          </button>
          <h1>Kasa Yönetimi</h1>
        </div>
        <div className="kasa-header-right">
          <button 
            onClick={() => setGecmisGorunuyor(!gecmisGorunuyor)}
            className="btn-gecmis"
          >
            {gecmisGorunuyor ? '🔍 Günlük Kasa' : '📅 Geçmiş Kayıtlar'}
          </button>
        </div>
      </div>

      {!gecmisGorunuyor ? (
        /* GÜNLÜK KASA GÖRÜNÜMÜ */
        <div className="kasa-gunluk">
          {kasaGun && (
            <>
              <div className="kasa-bilgi-karti">
                <div className="kasa-tarih">
                  <span className="tarih-label">Tarih:</span>
                  <span className="tarih-value">{formatGun(kasaGun.gun)}</span>
                </div>
                <div className="kasa-bakiye-grid">
                  <div className="bakiye-kutu">
                    <span className="bakiye-label">Açılış Bakiyesi</span>
                    <span className="bakiye-value">{formatPrice(kasaGun.acilisBakiyesi)}</span>
                  </div>
                  <div className="bakiye-kutu gelir">
                    <span className="bakiye-label">Toplam Gelir</span>
                    <span className="bakiye-value">{formatPrice(kasaGun.toplamGelir)}</span>
                  </div>
                  <div className="bakiye-kutu gider">
                    <span className="bakiye-label">Toplam Gider</span>
                    <span className="bakiye-value">{formatPrice(kasaGun.toplamGider)}</span>
                  </div>
                  <div className="bakiye-kutu market">
                    <span className="bakiye-label">Market Harcamaları</span>
                    <span className="bakiye-value">{formatPrice(kasaGun.marketHarcamalari)}</span>
                  </div>
                  <div className="bakiye-kutu gunsonu">
                    <span className="bakiye-label">Gün Sonu Bakiyesi</span>
                    <span className="bakiye-value">{formatPrice(kasaGun.gunSonuBakiyesi || kasaGun.acilisBakiyesi)}</span>
                  </div>
                </div>
              </div>

              <div className="kasa-hareketler">
                <div className="hareketler-header">
                  <h2>Gün İçi Hareketler</h2>
                  <button 
                    onClick={() => setEklemeModu(!eklemeModu)}
                    className="btn-ekle"
                  >
                    {eklemeModu ? '✕ İptal' : '+ Yeni Hareket'}
                  </button>
                </div>

                {eklemeModu && (
                  <div className="hareket-ekle-form">
                    <h3>Yeni Hareket Ekle</h3>
                    <form onSubmit={handleHareketEkle}>
                      <div className="form-row">
                        <div className="form-group">
                          <label>İşlem Tipi *</label>
                          <select
                            value={yeniHareketTip}
                            onChange={(e) => setYeniHareketTip(e.target.value as KasaHareketTipi)}
                            className="form-select"
                          >
                            <option value={KasaHareketTipi.GELIR}>💰 Gelir</option>
                            <option value={KasaHareketTipi.GIDER}>💸 Gider</option>
                            <option value={KasaHareketTipi.MARKET}>🛒 Market Alışverişi</option>
                            <option value={KasaHareketTipi.DIGER}>📝 Diğer Gider</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Tutar (TL) *</label>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={yeniHareketTutar || ''}
                            onChange={(e) => setYeniHareketTutar(parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            required
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label>Açıklama *</label>
                        <input
                          type="text"
                          value={yeniHareketAciklama}
                          onChange={(e) => setYeniHareketAciklama(e.target.value)}
                          placeholder="Ne için?"
                          required
                        />
                      </div>

                      <div className="form-row">
                        <div className="form-group">
                          <label>Belge No (Fiş/Fatura)</label>
                          <input
                            type="text"
                            value={yeniHareketBelgeNo}
                            onChange={(e) => setYeniHareketBelgeNo(e.target.value)}
                            placeholder="Opsiyonel"
                          />
                        </div>

                        <div className="form-group">
                          <label>Not</label>
                          <input
                            type="text"
                            value={yeniHareketNot}
                            onChange={(e) => setYeniHareketNot(e.target.value)}
                            placeholder="Ek not"
                          />
                        </div>
                      </div>

                      {formHata && (
                        <div className="form-hata">{formHata}</div>
                      )}

                      <div className="form-actions">
                        <button type="button" onClick={() => setEklemeModu(false)} className="btn-iptal">
                          İptal
                        </button>
                        <button type="submit" className="btn-kaydet">
                          Kaydet
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {kasaGun.hareketler && kasaGun.hareketler.length > 0 ? (
                  <div className="hareket-listesi">
                    <table className="hareket-tablosu">
                      <thead>
                        <tr>
                          <th>Saat</th>
                          <th>Tip</th>
                          <th>Açıklama</th>
                          <th>Belge No</th>
                          <th>Tutar</th>
                          <th>Kullanıcı</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kasaGun.hareketler.map((hareket) => (
                          <tr key={hareket.id} className={`hareket-satir ${getTipClass(hareket.tip)}`}>
                            <td>{hareket.saat}</td>
                            <td>
                              <span className="tip-badge">
                                {getTipIcon(hareket.tip)} {hareket.tip}
                              </span>
                            </td>
                            <td>{hareket.aciklama}</td>
                            <td>{hareket.belgeNo || '—'}</td>
                            <td className={`tutar ${hareket.tip === KasaHareketTipi.GELIR ? 'gelir' : 'gider'}`}>
                              {hareket.tip === KasaHareketTipi.GELIR ? '+' : '-'}{formatPrice(Math.abs(hareket.tutar))}
                            </td>
                            <td>{hareket.kullanici}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-hareket">
                    <p>Bugün henüz hareket yok.</p>
                    <small>Yeni hareket eklemek için butona tıklayın.</small>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        /* GEÇMİŞ KASA KAYITLARI */
        <div className="kasa-gecmis">
          <h2>Geçmiş Kasa Kayıtları (Son 30 Gün)</h2>
          
          {gecmis.length > 0 ? (
            <div className="gecmis-listesi">
              {gecmis.map((gun) => (
                <div key={gun.id} className="gecmis-kart">
                  <div className="gecmis-kart-header">
                    <h3>{formatGun(gun.gun)}</h3>
                    <span className={`gecmis-durum ${gun.durum === 'ACIK' ? 'acik' : 'kapali'}`}>
                      {gun.durum}
                    </span>
                  </div>
                  
                  <div className="gecmis-kart-ozet">
                    <div className="ozet-item">
                      <span>Açılış:</span>
                      <strong>{formatPrice(gun.acilisBakiyesi)}</strong>
                    </div>
                    <div className="ozet-item gelir">
                      <span>Gelir:</span>
                      <strong>{formatPrice(gun.toplamGelir)}</strong>
                    </div>
                    <div className="ozet-item gider">
                      <span>Gider:</span>
                      <strong>{formatPrice(gun.toplamGider)}</strong>
                    </div>
                    <div className="ozet-item market">
                      <span>Market:</span>
                      <strong>{formatPrice(gun.marketHarcamalari)}</strong>
                    </div>
                    <div className="ozet-item gunsonu">
                      <span>Gün Sonu:</span>
                      <strong>{formatPrice(gun.gunSonuBakiyesi || gun.acilisBakiyesi)}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-gecmis">
              <p>Henüz geçmiş kayıt bulunmuyor.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Kasa;