import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, MusteriBilgileri, Urun, OdemeYontemi, SatisLog } from '../types/satis';
import { getSubeByKod } from '../types/sube';
import './SatisTeklif.css';

const SatisTeklifPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [musteriBilgileri, setMusteriBilgileri] = useState<MusteriBilgileri>({
    isim: '',
    adres: '',
    faturaAdresi: '',
    isAdresi: '',
    vergiNumarasi: ''
  });

  const [urunler, setUrunler] = useState<Urun[]>([
    { id: '1', kod: '', ad: '', adet: 1, alisFiyati: 0 }
  ]);

  const [tarih, setTarih] = useState(new Date().toISOString().split('T')[0]);
  const [teslimatTarihi, setTeslimatTarihi] = useState('');
  const [musteriTemsilcisi, setMusteriTemsilcisi] = useState('');
  const [cevap, setCevap] = useState('');
  const [magaza, setMagaza] = useState('');

  const [fatura, setFatura] = useState(false);
  const [ileriTeslim, setIleriTeslim] = useState(false);
  const [servis, setServis] = useState(false);

  const [odemeYontemi, setOdemeYontemi] = useState<OdemeYontemi>(OdemeYontemi.PESINAT);
  const [hesabaGecen, setHesabaGecen] = useState('');
  const [onayDurumu, setOnayDurumu] = useState(false);

  const [loading, setLoading] = useState(false);

  const handleMusteriChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMusteriBilgileri({
      ...musteriBilgileri,
      [e.target.name]: e.target.value
    });
  };

  const handleUrunChange = (index: number, field: keyof Urun, value: any) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = {
      ...yeniUrunler[index],
      [field]: value
    };
    setUrunler(yeniUrunler);
  };

  const urunEkle = () => {
    setUrunler([
      ...urunler,
      { id: Date.now().toString(), kod: '', ad: '', adet: 1, alisFiyati: 0 }
    ]);
  };

  const urunSil = (index: number) => {
    if (urunler.length > 1) {
      setUrunler(urunler.filter((_, i) => i !== index));
    }
  };

  const toplamTutarHesapla = () => {
    return urunler.reduce((toplam, urun) => {
      return toplam + (urun.adet * urun.alisFiyati);
    }, 0);
  };

  const satisKoduOlustur = async () => {
    const sube = getSubeByKod(currentUser!.subeKodu);
    if (!sube) return '';

    // Son satış numarasını al ve bir artır
    const tarihStr = new Date().getTime();
    const satisNo = tarihStr.toString().slice(-4);
    return `${sube.satisKoduPrefix}-${satisNo}`;
  };

  const logKaydet = async (satisKodu: string, islem: string, detay: string) => {
    const sube = getSubeByKod(currentUser!.subeKodu);
    if (!sube) return;

    const log: Omit<SatisLog, 'id'> = {
      satisKodu,
      subeKodu: currentUser!.subeKodu,
      islem,
      kullanici: `${currentUser!.ad} ${currentUser!.soyad}`,
      tarih: new Date(),
      detay
    };

    await addDoc(collection(db, `subeler/${sube.dbPath}/loglar`), log);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const sube = getSubeByKod(currentUser!.subeKodu);
      if (!sube) {
        alert('Şube bilgisi bulunamadı!');
        return;
      }

      const satisKodu = await satisKoduOlustur();
      const toplamTutar = toplamTutarHesapla();

      const satisTeklifi: Omit<SatisTeklifFormu, 'id'> = {
        satisKodu,
        subeKodu: currentUser!.subeKodu,
        musteriBilgileri,
        urunler,
        toplamTutar,
        tarih: new Date(tarih),
        teslimatTarihi: new Date(teslimatTarihi),
        musteriTemsilcisi,
        cevap,
        magaza,
        fatura,
        ileriTeslim,
        servis,
        odemeYontemi,
        hesabaGecen,
        onayDurumu,
        olusturanKullanici: `${currentUser!.ad} ${currentUser!.soyad}`,
        olusturmaTarihi: new Date(),
        guncellemeTarihi: new Date()
      };

      // Satış teklifini kaydet
      await addDoc(collection(db, `subeler/${sube.dbPath}/satislar`), satisTeklifi);

      // Log kaydet
      await logKaydet(
        satisKodu,
        'YENİ_SATIS',
        `Yeni satış teklifi oluşturuldu. Müşteri: ${musteriBilgileri.isim}, Tutar: ${toplamTutar} TL`
      );

      alert('Satış teklifi başarıyla oluşturuldu!');
      navigate('/dashboard');
    } catch (error) {
      console.error('Satış teklifi oluşturulamadı:', error);
      alert('Bir hata oluştu!');
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

  return (
    <div className="satis-teklif-container">
      <div className="satis-teklif-header">
        <button onClick={() => navigate('/dashboard')} className="btn-back">
          ← Geri
        </button>
        <h1>Yeni Satış Teklif Formu</h1>
      </div>

      <form onSubmit={handleSubmit} className="satis-teklif-form">
        {/* Müşteri Bilgileri */}
        <div className="form-section">
          <h2>Müşteri Bilgileri</h2>
          <div className="form-grid">
            <div className="form-group">
              <label>İsim *</label>
              <input
                type="text"
                name="isim"
                value={musteriBilgileri.isim}
                onChange={handleMusteriChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Adres *</label>
              <input
                type="text"
                name="adres"
                value={musteriBilgileri.adres}
                onChange={handleMusteriChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Fatura Adresi</label>
              <input
                type="text"
                name="faturaAdresi"
                value={musteriBilgileri.faturaAdresi}
                onChange={handleMusteriChange}
              />
            </div>

            <div className="form-group">
              <label>İş Adresi</label>
              <input
                type="text"
                name="isAdresi"
                value={musteriBilgileri.isAdresi}
                onChange={handleMusteriChange}
              />
            </div>

            <div className="form-group">
              <label>Vergi Numarası</label>
              <input
                type="text"
                name="vergiNumarasi"
                value={musteriBilgileri.vergiNumarasi}
                onChange={handleMusteriChange}
              />
            </div>
          </div>
        </div>

        {/* Ürünler */}
        <div className="form-section">
          <div className="section-header">
            <h2>Ürünler</h2>
            <button type="button" onClick={urunEkle} className="btn-add">
              + Ürün Ekle
            </button>
          </div>

          {urunler.map((urun, index) => (
            <div key={urun.id} className="urun-satir">
              <div className="urun-grid">
                <div className="form-group">
                  <label>Ürün Kodu</label>
                  <input
                    type="text"
                    value={urun.kod}
                    onChange={(e) => handleUrunChange(index, 'kod', e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Ürün Adı</label>
                  <input
                    type="text"
                    value={urun.ad}
                    onChange={(e) => handleUrunChange(index, 'ad', e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Adet</label>
                  <input
                    type="number"
                    min="1"
                    value={urun.adet}
                    onChange={(e) => handleUrunChange(index, 'adet', parseInt(e.target.value))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Alış Fiyatı (TL)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={urun.alisFiyati}
                    onChange={(e) => handleUrunChange(index, 'alisFiyati', parseFloat(e.target.value))}
                    required
                  />
                </div>

                <div className="form-group urun-toplam">
                  <label>Toplam</label>
                  <div className="toplam-fiyat">
                    {formatPrice(urun.adet * urun.alisFiyati)}
                  </div>
                </div>
              </div>

              {urunler.length > 1 && (
                <button
                  type="button"
                  onClick={() => urunSil(index)}
                  className="btn-remove"
                >
                  Sil
                </button>
              )}
            </div>
          ))}

          <div className="genel-toplam">
            <strong>Genel Toplam:</strong>
            <span className="toplam-tutar">{formatPrice(toplamTutarHesapla())}</span>
          </div>
        </div>

        {/* Tarihler ve Diğer Bilgiler */}
        <div className="form-section">
          <h2>Tarihler ve Bilgiler</h2>
          <div className="form-grid">
            <div className="form-group">
              <label>Tarih *</label>
              <input
                type="date"
                value={tarih}
                onChange={(e) => setTarih(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Teslimat Tarihi *</label>
              <input
                type="date"
                value={teslimatTarihi}
                onChange={(e) => setTeslimatTarihi(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Müşteri Temsilcisi</label>
              <input
                type="text"
                value={musteriTemsilcisi}
                onChange={(e) => setMusteriTemsilcisi(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Cevap</label>
              <input
                type="text"
                value={cevap}
                onChange={(e) => setCevap(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Mağaza</label>
              <input
                type="text"
                value={magaza}
                onChange={(e) => setMagaza(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Seçenekler */}
        <div className="form-section">
          <h2>Seçenekler</h2>
          <div className="checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={fatura}
                onChange={(e) => setFatura(e.target.checked)}
              />
              <span>Fatura</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={ileriTeslim}
                onChange={(e) => setIleriTeslim(e.target.checked)}
              />
              <span>İleri Teslim</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={servis}
                onChange={(e) => setServis(e.target.checked)}
              />
              <span>Servis</span>
            </label>
          </div>
        </div>

        {/* Ödeme Bilgileri */}
        <div className="form-section">
          <h2>Ödeme Bilgileri</h2>
          <div className="form-grid">
            <div className="form-group">
              <label>Ödeme Yöntemi *</label>
              <select
                value={odemeYontemi}
                onChange={(e) => setOdemeYontemi(e.target.value as OdemeYontemi)}
                required
              >
                <option value={OdemeYontemi.PESINAT}>Peşinat</option>
                <option value={OdemeYontemi.KREDI_KARTI}>Kredi Kartı</option>
                <option value={OdemeYontemi.HAVALE}>Havale</option>
                <option value={OdemeYontemi.ACIK_HESAP}>Açık Hesap</option>
                <option value={OdemeYontemi.CEK_SENET}>Çek/Senet</option>
              </select>
            </div>

            <div className="form-group">
              <label>Hesaba Geçen</label>
              <input
                type="text"
                value={hesabaGecen}
                onChange={(e) => setHesabaGecen(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Onay */}
        <div className="form-section">
          <label className="checkbox-label onay-checkbox">
            <input
              type="checkbox"
              checked={onayDurumu}
              onChange={(e) => setOnayDurumu(e.target.checked)}
            />
            <span><strong>Onaylıyorum</strong></span>
          </label>
        </div>

        {/* Submit Butonları */}
        <div className="form-actions">
          <button type="button" onClick={() => navigate('/dashboard')} className="btn-cancel">
            İptal
          </button>
          <button type="submit" disabled={loading} className="btn-submit">
            {loading ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SatisTeklifPage;
