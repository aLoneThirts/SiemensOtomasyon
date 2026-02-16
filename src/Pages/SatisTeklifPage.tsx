import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, MusteriBilgileri, Urun, OdemeYontemi, SatisLog } from '../types/satis';
import { getSubeByKod } from '../types/sube';
import * as XLSX from 'xlsx';
import './SatisTeklif.css';

interface ExcelUrun {
  urun_kodu: string;
  urun_adi: string;
  fiyat: number;
}

const SatisTeklifPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [excelYukleniyor, setExcelYukleniyor] = useState(false);
  
  // GERÇEK EXCEL ÜRÜNLERİ BURADA TUTULACAK
  const [excelUrunler, setExcelUrunler] = useState<ExcelUrun[]>([]);
  const [aramaModaliAcik, setAramaModaliAcik] = useState(false);
  const [seciliSatirIndex, setSeciliSatirIndex] = useState<number | null>(null);
  const [aramaMetni, setAramaMetni] = useState('');

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

  // GERÇEK EXCEL YÜKLEME FONKSİYONU
  const excelYukle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setExcelYukleniyor(true);
    
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      
      console.log("Excel'den gelen ham data:", jsonData);
      
      // Excel'deki sütun isimlerini bul
      const ilkSatir = jsonData[0] as any;
      console.log("İlk satır:", ilkSatir);
      
      // Ürünleri formatla - SÜTUN İSİMLERİNİ KENDİ EXCEL'İNE GÖRE DÜZENLE
      const urunlerList: ExcelUrun[] = jsonData.map((row: any) => {
        // BURAYI KENDİ EXCEL'İNE GÖRE DÜZENLE!
        // Örnek: 
        return {
          urun_kodu: row['Ürün Kodu'] || row['Stok Kodu'] || row['Malzeme'] || Object.values(row)[0] || '',
          urun_adi: row['Ürün Adı'] || row['Açıklama'] || Object.values(row)[1] || '',
          fiyat: parseFloat(row['Fiyat'] || row['Birim Fiyat'] || Object.values(row)[2] || 0)
        };
      }).filter(u => u.urun_kodu); // Boş olanları filtrele
      
      console.log("Formatlanmış ürünler:", urunlerList);
      
      setExcelUrunler(urunlerList);
      alert(`✅ ${urunlerList.length} ürün yüklendi!`);
      
    } catch (error) {
      console.error('Excel yükleme hatası:', error);
      alert('❌ Excel yüklenirken hata oluştu!');
    } finally {
      setExcelYukleniyor(false);
      event.target.value = '';
    }
  };

  // Ürün seçme fonksiyonu
  const urunSec = (urun: ExcelUrun) => {
    if (seciliSatirIndex !== null) {
      const yeniUrunler = [...urunler];
      yeniUrunler[seciliSatirIndex] = {
        ...yeniUrunler[seciliSatirIndex],
        kod: urun.urun_kodu,
        ad: urun.urun_adi,
        alisFiyati: urun.fiyat
      };
      setUrunler(yeniUrunler);
      setAramaModaliAcik(false);
      setSeciliSatirIndex(null);
      setAramaMetni('');
    }
  };

  // Filtrelenmiş ürünler
  const filtrelenmisUrunler = excelUrunler.filter(urun =>
    urun.urun_kodu.toLowerCase().includes(aramaMetni.toLowerCase()) ||
    urun.urun_adi.toLowerCase().includes(aramaMetni.toLowerCase())
  );

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY'
    }).format(price);
  };

  const satisKoduOlustur = async () => {
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

      await addDoc(collection(db, `subeler/${sube.dbPath}/satislar`), satisTeklifi);
      await logKaydet(satisKodu, 'YENİ_SATIS', `Yeni satış teklifi oluşturuldu. Müşteri: ${musteriBilgileri.isim}, Tutar: ${toplamTutar} TL`);

      alert('Satış teklifi başarıyla oluşturuldu!');
      navigate('/dashboard');
    } catch (error) {
      console.error('Satış teklifi oluşturulamadı:', error);
      alert('Bir hata oluştu!');
    } finally {
      setLoading(false);
    }
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
            <div style={{ display: 'flex', gap: '10px' }}>
              {/* Excel Yükle Butonu */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={excelYukle}
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-excel"
                disabled={excelYukleniyor}
              >
                {excelYukleniyor ? '📊 Yükleniyor...' : '📊 Excel Yükle'}
              </button>
              
              {/* Ürün Ekle Butonu */}
              <button type="button" onClick={urunEkle} className="btn-add">
                + Ürün Ekle
              </button>
            </div>
          </div>

          {/* Excel'den yüklenen ürün sayısı gösterge */}
          {excelUrunler.length > 0 && (
            <div style={{
              background: '#e8f5e9',
              padding: '8px 15px',
              borderRadius: '4px',
              marginBottom: '15px',
              color: '#2e7d32',
              fontSize: '14px',
              fontWeight: '600'
            }}>
              📦 {excelUrunler.length} ürün yüklendi
            </div>
          )}

          {urunler.map((urun, index) => (
            <div key={urun.id} className="urun-satir">
              <div className="urun-grid">
                <div className="form-group">
                  <label>Ürün Kodu</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="text"
                      value={urun.kod}
                      onChange={(e) => handleUrunChange(index, 'kod', e.target.value)}
                      required
                      style={{ flex: 1 }}
                      placeholder="Ürün kodu"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (excelUrunler.length === 0) {
                          alert('Önce Excel yükleyin!');
                          return;
                        }
                        setSeciliSatirIndex(index);
                        setAramaModaliAcik(true);
                      }}
                      style={{
                        padding: '0 15px',
                        background: excelUrunler.length > 0 ? '#10b981' : '#9ca3af',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: excelUrunler.length > 0 ? 'pointer' : 'not-allowed',
                        fontSize: '16px'
                      }}
                    >
                      🔍
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label>Ürün Adı</label>
                  <input
                    type="text"
                    value={urun.ad}
                    onChange={(e) => handleUrunChange(index, 'ad', e.target.value)}
                    required
                    placeholder="Ürün adı"
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

      {/* EXCEL ÜRÜN ARAMA MODALI - GERÇEK ÜRÜNLER BURADA */}
      {aramaModaliAcik && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            width: '700px',
            maxWidth: '95%',
            maxHeight: '80vh',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
          }}>
            <div style={{
              padding: '20px',
              background: '#10b981',
              color: 'white',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0 }}>📦 Excel'den Ürün Seç ({excelUrunler.length} ürün)</h3>
              <button 
                onClick={() => {
                  setAramaModaliAcik(false);
                  setSeciliSatirIndex(null);
                  setAramaMetni('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'white',
                  fontSize: '24px',
                  cursor: 'pointer'
                }}
              >
                ✕
              </button>
            </div>
            
            <div style={{ padding: '20px' }}>
              <input
                type="text"
                placeholder="Ürün kodu veya adı ile ara..."
                value={aramaMetni}
                onChange={(e) => setAramaMetni(e.target.value)}
                style={{
                  width: '100%',
                  padding: '15px',
                  border: '2px solid #10b981',
                  borderRadius: '8px',
                  marginBottom: '20px',
                  fontSize: '16px'
                }}
                autoFocus
              />
              
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {filtrelenmisUrunler.length > 0 ? (
                  filtrelenmisUrunler.map((urun, index) => (
                    <div
                      key={index}
                      onClick={() => urunSec(urun)}
                      style={{
                        padding: '15px',
                        border: '1px solid #e0e0e0',
                        borderRadius: '8px',
                        marginBottom: '10px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        background: '#f9f9f9'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#e8f5e9';
                        e.currentTarget.style.borderColor = '#10b981';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#f9f9f9';
                        e.currentTarget.style.borderColor = '#e0e0e0';
                      }}
                    >
                      <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#10b981' }}>
                        {urun.urun_kodu}
                      </div>
                      <div style={{ fontSize: '14px', color: '#333', margin: '5px 0' }}>
                        {urun.urun_adi}
                      </div>
                      <div style={{ fontSize: '15px', fontWeight: '600', color: '#059669' }}>
                        {urun.fiyat.toLocaleString('tr-TR')} TL
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                    {excelUrunler.length === 0 ? (
                      <>
                        <div style={{ fontSize: '48px', marginBottom: '20px' }}>📭</div>
                        <div style={{ fontSize: '18px' }}>Hiç ürün yok!</div>
                        <div style={{ fontSize: '14px', marginTop: '10px' }}>Önce Excel yükle butonuna tıkla</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔍</div>
                        <div style={{ fontSize: '18px' }}>Ürün bulunamadı</div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SatisTeklifPage;