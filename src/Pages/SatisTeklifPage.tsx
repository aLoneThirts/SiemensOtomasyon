import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { 
  SatisTeklifFormu, 
  MusteriBilgileri, 
  Urun, 
  KartOdeme, 
  Kampanya, 
  YesilEtiket,
  OdemeYontemi, 
  SatisLog,
  BANKALAR,
  TAKSIT_SECENEKLERI
} from '../types/satis';
import { getSubeByKod } from '../types/sube';
import './SatisTeklif.css';

const SatisTeklifPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // ========== STATE TANIMLAMALARI ==========
  
  // Müşteri Bilgileri
  const [musteriBilgileri, setMusteriBilgileri] = useState<MusteriBilgileri>({
    isim: '',
    adres: '',
    faturaAdresi: '',
    isAdresi: '',
    vergiNumarasi: '',
    vkNo: '',
    vd: '',
    cep: ''
  });

  const [musteriTemsilcisi, setMusteriTemsilcisi] = useState('');
  const [musteriTemsilcisiTel, setMusteriTemsilcisiTel] = useState('');

  // Ürünler
  const [urunler, setUrunler] = useState<Urun[]>([
    { id: '1', kod: '', ad: '', adet: 1, alisFiyati: 0, bip: 0 }
  ]);

  // Tarihler
  const [tarih, setTarih] = useState(new Date().toISOString().split('T')[0]);
  const [teslimatTarihi, setTeslimatTarihi] = useState('');

  // Notlar
  const [marsNo, setMarsNo] = useState('');
  const [magaza, setMagaza] = useState('');
  const [faturaNo, setFaturaNo] = useState('');
  const [servisNotu, setServisNotu] = useState('');
  const [teslimEdildiMi, setTeslimEdildiMi] = useState(false);
  const [cevap, setCevap] = useState('');

  // Kampanyalar ve Yeşil Etiketler
  const [kampanyalar, setKampanyalar] = useState<Kampanya[]>([]);
  const [yesilEtiketler, setYesilEtiketler] = useState<YesilEtiket[]>([]);

  // Ödeme
  const [pesinatTutar, setPesinatTutar] = useState<number>(0);
  const [havaleTutar, setHavaleTutar] = useState<number>(0);
  const [kartOdemeler, setKartOdemeler] = useState<KartOdeme[]>([]);

  const [fatura, setFatura] = useState(false);
  const [ileriTeslim, setIleriTeslim] = useState(false);
  const [servis, setServis] = useState(false);

  const [odemeYontemi, setOdemeYontemi] = useState<OdemeYontemi>(OdemeYontemi.PESINAT);
  const [hesabaGecen, setHesabaGecen] = useState('');
  const [onayDurumu, setOnayDurumu] = useState(false);

  const [loading, setLoading] = useState(false);

  // ========== HANDLER FONKSİYONLARI ==========

  // Müşteri Bilgileri Handler
  const handleMusteriChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setMusteriBilgileri(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Ürün Handler
  const handleUrunChange = (index: number, field: keyof Urun, value: any) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = {
      ...yeniUrunler[index],
      [field]: field === 'adet' || field === 'alisFiyati' || field === 'bip' 
        ? parseFloat(value) || 0 
        : value
    };
    setUrunler(yeniUrunler);
  };

  const urunEkle = () => {
    setUrunler(prev => [
      ...prev,
      { 
        id: Date.now().toString(), 
        kod: '', 
        ad: '', 
        adet: 1, 
        alisFiyati: 0, 
        bip: 0 
      }
    ]);
  };

  const urunSil = (index: number) => {
    if (urunler.length > 1) {
      setUrunler(prev => prev.filter((_, i) => i !== index));
    }
  };

  // Kart Ödeme Handler
  const kartEkle = () => {
    setKartOdemeler(prev => [
      ...prev,
      { 
        id: Date.now().toString(), 
        banka: BANKALAR[0], 
        taksitSayisi: 1, 
        tutar: 0, 
        pesinat: 0 
      }
    ]);
  };

  const kartSil = (index: number) => {
    setKartOdemeler(prev => prev.filter((_, i) => i !== index));
  };

  const handleKartChange = (index: number, field: keyof KartOdeme, value: any) => {
    const yeniKartlar = [...kartOdemeler];
    yeniKartlar[index] = {
      ...yeniKartlar[index],
      [field]: field === 'tutar' || field === 'pesinat' || field === 'taksitSayisi'
        ? parseFloat(value) || 0
        : value
    };
    setKartOdemeler(yeniKartlar);
  };

  // Kampanya Handler
  const kampanyaEkle = () => {
    setKampanyalar(prev => [
      ...prev,
      { id: Date.now().toString(), ad: '', tutar: 0 }
    ]);
  };

  const kampanyaSil = (index: number) => {
    setKampanyalar(prev => prev.filter((_, i) => i !== index));
  };

  const handleKampanyaChange = (index: number, field: 'ad' | 'tutar', value: any) => {
    const yeniKampanyalar = [...kampanyalar];
    yeniKampanyalar[index] = {
      ...yeniKampanyalar[index],
      [field]: field === 'tutar' ? parseFloat(value) || 0 : value
    };
    setKampanyalar(yeniKampanyalar);
  };

  // Yeşil Etiket Handler
  const yesilEtiketEkle = () => {
    setYesilEtiketler(prev => [
      ...prev,
      { id: Date.now().toString(), urunKodu: '', tutar: 0 }
    ]);
  };

  const yesilEtiketSil = (index: number) => {
    setYesilEtiketler(prev => prev.filter((_, i) => i !== index));
  };

  const handleYesilEtiketChange = (index: number, field: 'urunKodu' | 'tutar', value: any) => {
    const yeniEtiketler = [...yesilEtiketler];
    yeniEtiketler[index] = {
      ...yeniEtiketler[index],
      [field]: field === 'tutar' ? parseFloat(value) || 0 : value
    };
    setYesilEtiketler(yeniEtiketler);
  };

  // ========== YARDIMCI FONKSİYONLAR ==========

  const toplamTutarHesapla = (): number => {
    return urunler.reduce((toplam, urun) => {
      return toplam + (urun.adet * urun.alisFiyati);
    }, 0);
  };

  const alisToplamHesapla = (): number => {
    return urunler.reduce((toplam, urun) => {
      return toplam + (urun.adet * urun.alisFiyati);
    }, 0);
  };

  const bipToplamHesapla = (): number => {
    return urunler.reduce((toplam, urun) => {
      return toplam + ((urun.bip || 0) * urun.adet);
    }, 0);
  };

  const toplamMaliyetHesapla = (): number => {
    return alisToplamHesapla() - bipToplamHesapla();
  };

  const zararHesapla = (): number => {
    const maliyet = toplamMaliyetHesapla();
    const hesabaGecenSayi = hesabaGecen ? 
      parseFloat(hesabaGecen.replace(/\./g, '').replace('₺', '')) || 0 : 0;
    return maliyet - hesabaGecenSayi;
  };

  const satisKoduOlustur = async (): Promise<string> => {
    const sube = getSubeByKod(currentUser!.subeKodu);
    if (!sube) return '';

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

  const formatPrice = (price: number): string => {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price);
  };

  // ========== SUBMIT HANDLER ==========

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
    const zarar = zararHesapla();

    // Satış teklifi objesini oluştur
    const satisTeklifi: Omit<SatisTeklifFormu, 'id'> = {
      // Temel Bilgiler
      satisKodu,
      subeKodu: currentUser!.subeKodu,
      
      // Müşteri Bilgileri
      musteriBilgileri,
      musteriTemsilcisi,
      musteriTemsilcisiTel,
      
      // Ürünler ve Tutarlar
      urunler,
      toplamTutar,
      
      // Tarihler
      tarih: new Date(tarih),
      teslimatTarihi: new Date(teslimatTarihi),
      
      // Notlar
      marsNo,
      magaza,
      faturaNo,
      servisNotu,
      teslimEdildiMi,
      cevap,
      
      // Kampanyalar ve İndirimler
      kampanyalar,
      yesilEtiketler,
      
      // Ödeme Bilgileri
      pesinatTutar,
      havaleTutar,
      kartOdemeler,
      hesabaGecen,
      
      // Seçenekler
      fatura,
      ileriTeslim,
      servis,
      odemeYontemi,
      onayDurumu,
      
      // Sistem Bilgileri
      olusturanKullanici: `${currentUser!.ad} ${currentUser!.soyad}`,
      olusturmaTarihi: new Date(),
      guncellemeTarihi: new Date()
    };

    // Firestore'a kaydet - zarar ayrı bir alan olarak ekle
    await addDoc(collection(db, `subeler/${sube.dbPath}/satislar`), {
      ...satisTeklifi,
      zarar // Bu şekilde eklenince tip hatası vermez
    });

    // Log kaydet
    await logKaydet(
      satisKodu,
      'YENİ_SATIS',
      `Yeni satış teklifi oluşturuldu. Müşteri: ${musteriBilgileri.isim}, Tutar: ${formatPrice(toplamTutar)}, Zarar: ${formatPrice(zarar)}`
    );

    alert('Satış teklifi başarıyla oluşturuldu!');
    navigate('/dashboard');
    
  } catch (error) {
    console.error('Satış teklifi oluşturulamadı:', error);
    alert('Bir hata oluştu! Lütfen tekrar deneyin.');
  } finally {
    setLoading(false);
  }
};

  // ========== RENDER ==========

  return (
    <div className="satis-teklif-container">
      <div className="satis-teklif-header">
        <button onClick={() => navigate('/dashboard')} className="btn-back">
          ← Geri
        </button>
        <h1>Yeni Satış Teklif Formu</h1>
      </div>

      <form onSubmit={handleSubmit} className="satis-teklif-form">
        
        {/* ===== MÜŞTERİ BİLGİLERİ ===== */}
        <div className="form-section">
          <h2>Müşteri Bilgileri</h2>
          <div className="form-grid">
            <div className="form-group">
              <label>İsim/Adı *</label>
              <input
                type="text"
                name="isim"
                value={musteriBilgileri.isim}
                onChange={handleMusteriChange}
                required
              />
            </div>

            <div className="form-group">
              <label>VK No</label>
              <input
                type="text"
                name="vkNo"
                value={musteriBilgileri.vkNo}
                onChange={handleMusteriChange}
              />
            </div>

            <div className="form-group">
              <label>VD</label>
              <input
                type="text"
                name="vd"
                value={musteriBilgileri.vd}
                onChange={handleMusteriChange}
              />
            </div>

            <div className="form-group">
              <label>Cep</label>
              <input
                type="text"
                name="cep"
                value={musteriBilgileri.cep}
                onChange={handleMusteriChange}
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

        {/* ===== SATIŞ BİLGİLERİ ===== */}
        <div className="form-section">
          <h2>Satış Bilgileri</h2>
          <div className="form-grid">
            <div className="form-group">
              <label>Müşteri Temsilcisi</label>
              <input
                type="text"
                value={musteriTemsilcisi}
                onChange={(e) => setMusteriTemsilcisi(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Müşteri Temsilcisi Tel</label>
              <input
                type="text"
                value={musteriTemsilcisiTel}
                onChange={(e) => setMusteriTemsilcisiTel(e.target.value)}
              />
            </div>

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
          </div>
        </div>

        {/* ===== NOTLAR ===== */}
        <div className="form-section">
          <h2>Notlar</h2>
          <div className="form-grid">
            <div className="form-group">
              <label>MARS No (NOT)</label>
              <input
                type="text"
                value={marsNo}
                onChange={(e) => setMarsNo(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>MAĞAZA (NOT)</label>
              <input
                type="text"
                value={magaza}
                onChange={(e) => setMagaza(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>FATURA No (NOT)</label>
              <input
                type="text"
                value={faturaNo}
                onChange={(e) => setFaturaNo(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>SERVİS (NOT)</label>
              <input
                type="text"
                value={servisNotu}
                onChange={(e) => setServisNotu(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={teslimEdildiMi}
                  onChange={(e) => setTeslimEdildiMi(e.target.checked)}
                />
                <span>Teslim Edildi Mi?</span>
              </label>
            </div>

            <div className="form-group">
              <label>Cevap</label>
              <input
                type="text"
                value={cevap}
                onChange={(e) => setCevap(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* ===== ÜRÜNLER ===== */}
        <div className="form-section">
          <div className="section-header">
            <h2>Ürünler (15-20 satır yer var)</h2>
            <button type="button" onClick={urunEkle} className="btn-add">
              + Ürün Ekle
            </button>
          </div>

          {urunler.map((urun, index) => (
            <div key={urun.id} className="urun-satir">
              <div className="urun-grid-extended">
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
                    onChange={(e) => handleUrunChange(index, 'adet', e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Alış (TL)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={urun.alisFiyati}
                    onChange={(e) => handleUrunChange(index, 'alisFiyati', e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>BİP (TL)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={urun.bip || 0}
                    onChange={(e) => handleUrunChange(index, 'bip', e.target.value)}
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

          <div className="info-text">
            <p><strong>NOT:</strong> TOPLAM MALİYET = ALIŞ TOPLAM - BİP TOPLAM = {formatPrice(toplamMaliyetHesapla())}</p>
          </div>
        </div>

        {/* ===== KAMPANYALAR ===== */}
        <div className="form-section">
          <div className="section-header">
            <h2>Kampanyalar</h2>
            <button type="button" onClick={kampanyaEkle} className="btn-add">
              + Kampanya Ekle
            </button>
          </div>

          {kampanyalar.map((kampanya, index) => (
            <div key={kampanya.id} className="kampanya-satir">
              <div className="kampanya-grid">
                <div className="form-group">
                  <label>Kampanya Adı</label>
                  <input
                    type="text"
                    value={kampanya.ad}
                    onChange={(e) => handleKampanyaChange(index, 'ad', e.target.value)}
                    placeholder="Örn: 3 LÜ ÜRÜN KAMP"
                  />
                </div>

                <div className="form-group">
                  <label>Tutar (TL)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={kampanya.tutar}
                    onChange={(e) => handleKampanyaChange(index, 'tutar', e.target.value)}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => kampanyaSil(index)}
                  className="btn-remove-inline"
                >
                  Sil
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ===== YEŞİL ETİKETLER ===== */}
        <div className="form-section">
          <div className="section-header">
            <h2>Yeşil Etiketler (İndirimli Eski Ürünler)</h2>
            <button type="button" onClick={yesilEtiketEkle} className="btn-add">
              + Yeşil Etiket Ekle
            </button>
          </div>

          {yesilEtiketler.map((etiket, index) => (
            <div key={etiket.id} className="etiket-satir">
              <div className="etiket-grid">
                <div className="form-group">
                  <label>Ürün Kodu</label>
                  <input
                    type="text"
                    value={etiket.urunKodu}
                    onChange={(e) => handleYesilEtiketChange(index, 'urunKodu', e.target.value)}
                    placeholder="Ürün kodu"
                  />
                </div>

                <div className="form-group">
                  <label>İndirim Tutarı (TL)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={etiket.tutar}
                    onChange={(e) => handleYesilEtiketChange(index, 'tutar', e.target.value)}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => yesilEtiketSil(index)}
                  className="btn-remove-inline"
                >
                  Sil
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ===== ÖDEME BİLGİLERİ ===== */}
        <div className="form-section">
          <h2>Ödeme Bilgileri</h2>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Peşinat (TL)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={pesinatTutar}
                onChange={(e) => setPesinatTutar(parseFloat(e.target.value) || 0)}
              />
            </div>

            <div className="form-group">
              <label>Havale (TL)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={havaleTutar}
                onChange={(e) => setHavaleTutar(parseFloat(e.target.value) || 0)}
              />
            </div>

            <div className="form-group">
              <label>Hesaba Geçen</label>
              <input
                type="text"
                value={hesabaGecen}
                onChange={(e) => setHesabaGecen(e.target.value)}
                placeholder="Örn: 20.450₺"
              />
            </div>
          </div>

          {/* Kart Ödemeleri */}
          <div className="kart-odemeler-section">
            <div className="section-header">
              <h3>Kart ile Ödemeler</h3>
              <button type="button" onClick={kartEkle} className="btn-add">
                + Kart Ekle
              </button>
            </div>

            {kartOdemeler.map((kart, index) => (
              <div key={kart.id} className="kart-satir">
                <div className="kart-grid">
                  <div className="form-group">
                    <label>Banka</label>
                    <select
                      value={kart.banka}
                      onChange={(e) => handleKartChange(index, 'banka', e.target.value)}
                    >
                      {BANKALAR.map((banka) => (
                        <option key={banka} value={banka}>
                          {banka}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Taksit Sayısı</label>
                    <select
                      value={kart.taksitSayisi}
                      onChange={(e) => handleKartChange(index, 'taksitSayisi', e.target.value)}
                    >
                      {TAKSIT_SECENEKLERI.map((taksit) => (
                        <option key={taksit.value} value={taksit.value}>
                          {taksit.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Tutar (TL)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={kart.tutar}
                      onChange={(e) => handleKartChange(index, 'tutar', e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Peşinat (TL)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={kart.pesinat || 0}
                      onChange={(e) => handleKartChange(index, 'pesinat', e.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => kartSil(index)}
                    className="btn-remove-inline"
                  >
                    Sil
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Zarar Bilgisi - Canlı Hesaplama */}
          <div className="zarar-preview">
            <strong>ZARAR: {formatPrice(zararHesapla())}</strong>
          </div>
        </div>

        {/* ===== SEÇENEKLER ===== */}
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

        {/* ===== ONAY ===== */}
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

        {/* ===== SUBMIT BUTONLARI ===== */}
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