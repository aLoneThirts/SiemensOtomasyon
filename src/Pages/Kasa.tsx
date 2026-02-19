import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { KasaGun, KasaHareket, KasaHareketTipi, kasayaYansiyor, kasaYonu } from '../types/kasa';
import { getBugununKasaGunu, kasaHareketEkle, getKasaGecmisi } from '../services/kasaService';
import './Kasa.css';

type FiltreTip = 'tumzamanlar' | '7gun' | '30gun' | 'buay';

const Kasa: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [kasaGun, setKasaGun]                     = useState<KasaGun | null>(null);
  const [loading, setLoading]                     = useState(true);
  const [gecmis, setGecmis]                       = useState<KasaGun[]>([]);
  const [gecmisGorunuyor, setGecmisGorunuyor]     = useState(false);
  const [filtre, setFiltre]                       = useState<FiltreTip>('tumzamanlar');

  // Form state
  const [yeniHareketAciklama, setYeniHareketAciklama] = useState('');
  const [yeniHareketTutar, setYeniHareketTutar]       = useState<number>(0);
  const [yeniHareketTip, setYeniHareketTip]           = useState<KasaHareketTipi>(KasaHareketTipi.NAKIT_SATIS);
  const [yeniHareketBelgeNo, setYeniHareketBelgeNo]   = useState('');
  const [yeniHareketNot, setYeniHareketNot]           = useState('');
  const [formHata, setFormHata]                       = useState('');
  const [eklemeModu, setEklemeModu]                   = useState(false);

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    loadKasa();
  }, [currentUser]);

  const loadKasa = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const gun = await getBugununKasaGunu(currentUser.subeKodu, `${currentUser.ad} ${currentUser.soyad}`);
      setKasaGun(gun);
      const gecmisData = await getKasaGecmisi(currentUser.subeKodu, 365);
      setGecmis(gecmisData.filter(g => g.gun !== gun?.gun));
    } catch (error) {
      console.error('Kasa yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const filtreliGecmis = (): KasaGun[] => {
    if (filtre === 'tumzamanlar') return gecmis;
    const bugun = new Date(); bugun.setHours(0,0,0,0);
    return gecmis.filter(g => {
      const [y, m, d] = g.gun.split('-').map(Number);
      const tarih = new Date(y, m - 1, d);
      if (filtre === '7gun')  { const s = new Date(bugun); s.setDate(s.getDate()-7); return tarih >= s; }
      if (filtre === '30gun') { const s = new Date(bugun); s.setDate(s.getDate()-30); return tarih >= s; }
      if (filtre === 'buay')  return tarih.getMonth() === bugun.getMonth() && tarih.getFullYear() === bugun.getFullYear();
      return true;
    });
  };

  const handleHareketEkle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !kasaGun?.id) { setFormHata('Kullanıcı veya kasa günü bulunamadı!'); return; }
    if (!yeniHareketAciklama.trim())  { setFormHata('Açıklama giriniz!'); return; }
    if (yeniHareketTutar <= 0)        { setFormHata("Tutar 0'dan büyük olmalı!"); return; }
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
          subeKodu: currentUser.subeKodu,
        },
        `${currentUser.ad} ${currentUser.soyad}`,
        currentUser.uid || ''
      );

      if (basarili) {
        setYeniHareketAciklama(''); setYeniHareketTutar(0);
        setYeniHareketBelgeNo(''); setYeniHareketNot('');
        setYeniHareketTip(KasaHareketTipi.NAKIT_SATIS);
        setEklemeModu(false);
        await loadKasa();
        alert('✅ İşlem başarıyla eklendi!');
      } else {
        setFormHata('İşlem başarısız!');
      }
    } catch (error) {
      setFormHata('Hata: ' + (error as Error).message);
    }
  };

  const formatPrice = (price: number): string =>
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(price);

  const formatGun = (gun: string): string => {
    const [yil, ay, gunStr] = gun.split('-');
    return `${gunStr}.${ay}.${yil}`;
  };

  const getTipIcon = (tip: KasaHareketTipi): string => ({
    [KasaHareketTipi.NAKIT_SATIS]: '💵',
    [KasaHareketTipi.KART]:        '💳',
    [KasaHareketTipi.HAVALE]:      '🏦',
    [KasaHareketTipi.GIDER]:       '💸',
    [KasaHareketTipi.CIKIS]:       '📤',
    [KasaHareketTipi.DIGER]:       '📝',
  }[tip] ?? '•');

  const getTipClass = (tip: KasaHareketTipi): string => ({
    [KasaHareketTipi.NAKIT_SATIS]: 'nakit',
    [KasaHareketTipi.KART]:        'kart',
    [KasaHareketTipi.HAVALE]:      'havale',
    [KasaHareketTipi.GIDER]:       'gider',
    [KasaHareketTipi.CIKIS]:       'cikis',
    [KasaHareketTipi.DIGER]:       'diger',
  }[tip] ?? '');

  if (loading) {
    return <div className="kasa-container"><div className="loading">Kasa yükleniyor...</div></div>;
  }

  return (
    <div className="kasa-container">

      {/* HEADER */}
      <div className="kasa-header">
        <div className="kasa-header-left">
          <button onClick={() => navigate('/dashboard')} className="btn-back">← Geri</button>
          <h1>Kasa Yönetimi</h1>
        </div>
        <div className="kasa-header-right">
          <button onClick={() => setGecmisGorunuyor(!gecmisGorunuyor)} className="btn-gecmis">
            {gecmisGorunuyor ? '🔍 Günlük Kasa' : '📅 Geçmiş Kayıtlar'}
          </button>
        </div>
      </div>

      {!gecmisGorunuyor ? (

        /* GÜNLÜK KASA */
        <div className="kasa-gunluk">
          {!kasaGun ? (
            <div className="empty-hareket">
              <p>⚠️ Kasa yüklenemedi.</p>
              <button onClick={loadKasa} className="btn-ekle" style={{marginTop:16}}>🔄 Tekrar Dene</button>
            </div>
          ) : (
            <>
              {/* ÖZET KART */}
              <div className="kasa-bilgi-karti">
                <div className="kasa-tarih">
                  <span className="tarih-label">Tarih:</span>
                  <span className="tarih-value">{formatGun(kasaGun.gun)}</span>
                </div>

                {/* HESAP AKIŞ GÖSTERİMİ */}
                <div className="kasa-akis">
                  <div className="akis-satir">
                    <span className="akis-icon">🏦</span>
                    <span className="akis-label">Açılış Bakiyesi</span>
                    <span className="akis-tutar">{formatPrice(kasaGun.acilisBakiyesi)}</span>
                  </div>
                  <div className="akis-satir">
                    <span className="akis-icon">💵</span>
                    <span className="akis-label">+ Nakit Satış</span>
                    <span className="akis-tutar giris">{formatPrice(kasaGun.nakitSatis || 0)}</span>
                  </div>
                  <div className="akis-satir">
                    <span className="akis-icon">💸</span>
                    <span className="akis-label">− Gider</span>
                    <span className="akis-tutar cikis">{formatPrice(kasaGun.toplamGider || 0)}</span>
                  </div>
                  <div className="akis-ayirici" />
                  <div className="akis-satir gunsonu-satir">
                    <span className="akis-icon">✅</span>
                    <span className="akis-label">= Gün Sonu Bakiyesi</span>
                    <span className="akis-tutar gunsonu">{formatPrice(kasaGun.gunSonuBakiyesi || 0)}</span>
                  </div>
                  <div className="akis-not">ertesi gün açılış: <strong>{formatPrice(kasaGun.gunSonuBakiyesi || 0)}</strong></div>
                </div>

                {/* KASAYA YANSIMAYAN - bilgi amaçlı */}
                <div className="kasa-yansimaz">
                  <span className="yansimaz-baslik">📊 Kayıt Amaçlı (Kasaya Yansımaz)</span>
                  <div className="yansimaz-grid">
                    <div className="yansimaz-item">
                      <span>💳 Kart</span>
                      <strong>{formatPrice(kasaGun.kartSatis || 0)}</strong>
                    </div>
                    <div className="yansimaz-item">
                      <span>🏦 Havale</span>
                      <strong>{formatPrice(kasaGun.havaleSatis || 0)}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* HAREKETLER */}
              <div className="kasa-hareketler">
                <div className="hareketler-header">
                  <h2>Gün İçi Hareketler</h2>
                  <button onClick={() => setEklemeModu(!eklemeModu)} className="btn-ekle">
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
                            onChange={e => setYeniHareketTip(e.target.value as KasaHareketTipi)}
                            className="form-select"
                          >
                            <option value={KasaHareketTipi.NAKIT_SATIS}>💵 Nakit Satış</option>
                            <option value={KasaHareketTipi.GIDER}>💸 Gider</option>
                            <option value={KasaHareketTipi.CIKIS}>📤 Çıkış Yapılan Para</option>
                            <option value={KasaHareketTipi.DIGER}>📝 Diğer</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Tutar (TL) *</label>
                          <input
                            type="number" min="0.01" step="0.01"
                            value={yeniHareketTutar || ''}
                            onChange={e => setYeniHareketTutar(parseFloat(e.target.value) || 0)}
                            placeholder="0.00" required
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label>Açıklama *</label>
                        <input
                          type="text" value={yeniHareketAciklama}
                          onChange={e => setYeniHareketAciklama(e.target.value)}
                          placeholder="Ne için?" required
                        />
                      </div>

                      <div className="form-row">
                        <div className="form-group">
                          <label>Belge No (Fiş/Fatura)</label>
                          <input type="text" value={yeniHareketBelgeNo}
                            onChange={e => setYeniHareketBelgeNo(e.target.value)} placeholder="Opsiyonel" />
                        </div>
                        <div className="form-group">
                          <label>Not</label>
                          <input type="text" value={yeniHareketNot}
                            onChange={e => setYeniHareketNot(e.target.value)} placeholder="Ek not" />
                        </div>
                      </div>

                      {formHata && <div className="form-hata">{formHata}</div>}

                      <div className="form-actions">
                        <button type="button" onClick={() => setEklemeModu(false)} className="btn-iptal">İptal</button>
                        <button type="submit" className="btn-kaydet">Kaydet</button>
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
                          <th>Kasaya Yansır</th>
                          <th>Kullanıcı</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kasaGun.hareketler.map(hareket => {
                          const yon = kasaYonu(hareket.tip);
                          return (
                            <tr key={hareket.id} className={`hareket-satir ${getTipClass(hareket.tip)}`}>
                              <td>{hareket.saat}</td>
                              <td>
                                <span className={`tip-badge ${getTipClass(hareket.tip)}`}>
                                  {getTipIcon(hareket.tip)} {hareket.tip}
                                </span>
                              </td>
                              <td>{hareket.aciklama}</td>
                              <td>{hareket.belgeNo || '—'}</td>
                              <td className={`tutar ${yon}`}>
                                {yon === 'giris' ? '+' : yon === 'cikis' ? '−' : ''}
                                {formatPrice(Math.abs(hareket.tutar))}
                              </td>
                              <td>
                                {kasayaYansiyor(hareket.tip)
                                  ? <span className="badge-evet">✅ Evet</span>
                                  : <span className="badge-hayir">❌ Hayır</span>}
                              </td>
                              <td>{hareket.kullanici}</td>
                            </tr>
                          );
                        })}
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

        /* GEÇMİŞ KAYITLAR */
        <div className="kasa-gecmis">
          <div className="gecmis-header-row">
            <h2>Geçmiş Kasa Kayıtları</h2>
            <div className="filtre-group">
              {([
                { key: 'tumzamanlar', label: 'Tüm Zamanlar' },
                { key: '30gun',       label: 'Son 30 Gün' },
                { key: '7gun',        label: 'Son 7 Gün' },
                { key: 'buay',        label: 'Bu Ay' },
              ] as { key: FiltreTip; label: string }[]).map(f => (
                <button key={f.key}
                  className={`btn-filtre ${filtre === f.key ? 'aktif' : ''}`}
                  onClick={() => setFiltre(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filtreliGecmis().length > 0 ? (
            <div className="gecmis-listesi">
              {filtreliGecmis().map(gun => (
                <div key={gun.id} className="gecmis-kart">
                  <div className="gecmis-kart-header">
                    <h3>{formatGun(gun.gun)}</h3>
                    <span className={`gecmis-durum ${gun.durum === 'ACIK' ? 'acik' : 'kapali'}`}>
                      {gun.durum}
                    </span>
                  </div>

                  <div className="gecmis-akis">
                    <div className="gakis-satir">
                      <span>Açılış</span><strong>{formatPrice(gun.acilisBakiyesi)}</strong>
                    </div>
                    <div className="gakis-satir giris">
                      <span>+ Nakit Satış</span><strong>{formatPrice(gun.nakitSatis || 0)}</strong>
                    </div>
                    <div className="gakis-satir cikis">
                      <span>− Gider</span><strong>{formatPrice(gun.toplamGider || 0)}</strong>
                    </div>
                    <div className="gakis-ayirici" />
                    <div className="gakis-satir gunsonu">
                      <span>= Gün Sonu</span><strong>{formatPrice(gun.gunSonuBakiyesi || gun.acilisBakiyesi)}</strong>
                    </div>
                  </div>

                  <div className="gecmis-yansimaz">
                    <span>💳 Kart: {formatPrice(gun.kartSatis || 0)}</span>
                    <span>🏦 Havale: {formatPrice(gun.havaleSatis || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-gecmis">
              <p>Bu filtre için kayıt bulunamadı.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Kasa;