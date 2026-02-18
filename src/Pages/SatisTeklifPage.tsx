import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, addDoc, query, orderBy, limit, getDocs } from 'firebase/firestore';
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
  TAKSIT_SECENEKLERI,
  OdemeDurumu,
  BekleyenUrun, 
} from '../types/satis';
import { getSubeByKod, SubeKodu } from '../types/sube';
import * as XLSX from 'xlsx';
import './SatisTeklif.css';

interface ExcelUrun {
  urun_kodu: string;
  urun_adi: string;
}

const SatisTeklifPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ========== STATE'LER ==========
  const [musteriBilgileri, setMusteriBilgileri] = useState<MusteriBilgileri>({
    isim: '', adres: '', faturaAdresi: '', isAdresi: '',
    vergiNumarasi: '', vkNo: '', vd: '', cep: ''
  });
  const [musteriTemsilcisi, setMusteriTemsilcisi] = useState('');
  const [musteriTemsilcisiTel, setMusteriTemsilcisiTel] = useState('');
  const [urunler, setUrunler] = useState<Urun[]>([
    { id: '1', kod: '', ad: '', adet: 1, alisFiyati: 0, bip: 0 }
  ]);
  const [tarih, setTarih] = useState(new Date().toISOString().split('T')[0]);
  const [teslimatTarihi, setTeslimatTarihi] = useState('');
  const [marsNo, setMarsNo] = useState('');
  const [marsNoHata, setMarsNoHata] = useState(false);
  const [magaza, setMagaza] = useState('');
  const [faturaNo, setFaturaNo] = useState('');
  const [faturaNoHata, setFaturaNoHata] = useState(false);
  const [servisNotu, setServisNotu] = useState('');
  const [teslimEdildiMi, setTeslimEdildiMi] = useState(false);
  const [cevap, setCevap] = useState('');
  const [fatura, setFatura] = useState(false);
  const [ileriTeslim, setIleriTeslim] = useState(false);
  const [servis, setServis] = useState(false);
  const [kampanyalar, setKampanyalar] = useState<Kampanya[]>([]);
  const [yesilEtiketler, setYesilEtiketler] = useState<YesilEtiket[]>([]);
  const [pesinatTutar, setPesinatTutar] = useState<number>(0);
  const [havaleTutar, setHavaleTutar] = useState<number>(0);
  const [kartOdemeler, setKartOdemeler] = useState<KartOdeme[]>([]);
  const [odemeYontemi, setOdemeYontemi] = useState<OdemeYontemi>(OdemeYontemi.PESINAT);
  const [hesabaGecen, setHesabaGecen] = useState('');
  const [onayDurumu, setOnayDurumu] = useState(false);
  const [loading, setLoading] = useState(false);
  const [excelYukleniyor, setExcelYukleniyor] = useState(false);
  const [excelUrunler, setExcelUrunler] = useState<ExcelUrun[]>([]);
  const [aramaModaliAcik, setAramaModaliAcik] = useState(false);
  const [seciliSatirIndex, setSeciliSatirIndex] = useState<number | null>(null);
  const [aramaMetni, setAramaMetni] = useState('');
  const [satisKodu, setSatisKodu] = useState('');

  // ========== YARDIMCI FONKSİYONLAR ==========

  const getSonSatisKodu = async (subeDbPath: string): Promise<string | null> => {
    try {
      const satisRef = collection(db, `subeler/${subeDbPath}/satislar`);
      const q = query(satisRef, orderBy('satisKodu', 'desc'), limit(1));
      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;
      return snapshot.docs[0].data().satisKodu as string;
    } catch {
      return null;
    }
  };

  const getSiraNumarasi = (sonKod: string | null, subePrefix: string): string => {
    if (!sonKod) return `${subePrefix}-001`;
    const parts = sonKod.split('-');
    if (parts.length !== 2) return `${subePrefix}-001`;
    const sonSayi = parseInt(parts[1], 10);
    if (isNaN(sonSayi)) return `${subePrefix}-001`;
    return `${subePrefix}-${(sonSayi + 1).toString().padStart(3, '0')}`;
  };

  const formatPrice = (price: number): string => {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency', currency: 'TRY',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(price);
  };

  // ========== HESAPLAMA FONKSİYONLARI ==========

  const alisToplamHesapla = (): number =>
    urunler.reduce((toplam, urun) => toplam + urun.adet * urun.alisFiyati, 0);

  const bipToplamHesapla = (): number =>
    urunler.reduce((toplam, urun) => toplam + (urun.bip || 0) * urun.adet, 0);

  const toplamTutarHesapla = (): number => alisToplamHesapla();

  const toplamMaliyetHesapla = (): number => alisToplamHesapla() - bipToplamHesapla();

  const hesabaGecenToplamHesapla = (): number => {
    const kartToplam = kartOdemeler.reduce((sum, kart) => sum + (kart.tutar || 0), 0);
    return (pesinatTutar || 0) + (havaleTutar || 0) + kartToplam;
  };

  // Kâr/Zarar = Hesaba Geçen - Maliyet
  const karZararHesapla = (): number =>
    hesabaGecenToplamHesapla() - toplamMaliyetHesapla();

  const getOdemeDurumu = (): OdemeDurumu => {
    const maliyet = toplamMaliyetHesapla();
    const toplamOdeme = hesabaGecenToplamHesapla();
    return toplamOdeme >= maliyet ? OdemeDurumu.ODENDI : OdemeDurumu.ACIK_HESAP;
  };

  // ========== MARS NO ==========

  const isMarsNoGecerli = (): boolean => {
    if (!marsNo) return true;
    return marsNo.length === 10 && marsNo.startsWith('2026');
  };

  const handleMarsNoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    setMarsNo(value);
    setMarsNoHata(false);
  };

  const fixMarsNo = () => {
    let val = marsNo.replace(/\D/g, '');
    if (!val.startsWith('2026')) val = '2026' + val;
    if (val.length > 10) val = val.slice(0, 10);
    setMarsNo(val);
    setMarsNoHata(val.length !== 10);
  };

  // ========== FATURA NO ==========

  const handleFaturaNoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFaturaNo(value);
    setFaturaNoHata(false);
    setFatura(value.trim() !== ''); // Otomatik tik
  };

  // ========== SERVİS NOTU ==========

  const handleServisNotuChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setServisNotu(value);
    setServis(value.trim() !== ''); // Otomatik tik
  };

  // ========== MÜŞTERİ ==========

  const handleMusteriChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setMusteriBilgileri(prev => ({ ...prev, [name]: value }));
  };

  // ========== ÜRÜNLER ==========

  const handleUrunChange = (index: number, field: keyof Urun, value: any) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = {
      ...yeniUrunler[index],
      [field]: field === 'adet' || field === 'alisFiyati' || field === 'bip'
        ? (value === '' ? 0 : parseFloat(value) || 0)
        : value
    };
    setUrunler(yeniUrunler);
  };

  const urunEkle = () => {
    setUrunler(prev => [
      ...prev,
      { id: Date.now().toString(), kod: '', ad: '', adet: 1, alisFiyati: 0, bip: 0 }
    ]);
  };

  const urunSil = (index: number) => {
    if (urunler.length > 1) {
      setUrunler(prev => prev.filter((_, i) => i !== index));
    }
  };

  // ========== KART ==========

  const kartEkle = () => {
    setKartOdemeler(prev => [
      ...prev,
      { id: Date.now().toString(), banka: BANKALAR[0], taksitSayisi: 1, tutar: 0 }
    ]);
  };

  const kartSil = (index: number) => {
    setKartOdemeler(prev => prev.filter((_, i) => i !== index));
  };

  const handleKartChange = (index: number, field: keyof KartOdeme, value: any) => {
    const yeniKartlar = [...kartOdemeler];
    yeniKartlar[index] = {
      ...yeniKartlar[index],
      [field]: field === 'tutar'
        ? (value === '' ? 0 : parseFloat(value) || 0)
        : field === 'taksitSayisi'
        ? parseInt(value) || 1
        : value
    };
    setKartOdemeler(yeniKartlar);
  };

  // ========== KAMPANYA ==========

  const kampanyaEkle = () => {
    setKampanyalar(prev => [...prev, { id: Date.now().toString(), ad: '', tutar: 0 }]);
  };

  const kampanyaSil = (index: number) => {
    setKampanyalar(prev => prev.filter((_, i) => i !== index));
  };

  const handleKampanyaChange = (index: number, field: 'ad' | 'tutar', value: any) => {
    const yeniKampanyalar = [...kampanyalar];
    yeniKampanyalar[index] = {
      ...yeniKampanyalar[index],
      [field]: field === 'tutar' ? (value === '' ? 0 : parseFloat(value) || 0) : value
    };
    setKampanyalar(yeniKampanyalar);
  };

  // ========== YEŞİL ETİKET ==========

  const yesilEtiketEkle = () => {
    setYesilEtiketler(prev => [...prev, { id: Date.now().toString(), urunKodu: '', tutar: 0 }]);
  };

  const yesilEtiketSil = (index: number) => {
    setYesilEtiketler(prev => prev.filter((_, i) => i !== index));
  };

  const handleYesilEtiketChange = (index: number, field: 'urunKodu' | 'tutar', value: any) => {
    const yeniEtiketler = [...yesilEtiketler];
    yeniEtiketler[index] = {
      ...yeniEtiketler[index],
      [field]: field === 'tutar' ? (value === '' ? 0 : parseFloat(value) || 0) : value
    };
    setYesilEtiketler(yeniEtiketler);
  };

  // ========== EXCEL ==========

  const excelYukle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setExcelYukleniyor(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      const list: ExcelUrun[] = (jsonData as any[]).map(row => ({
        urun_kodu: row['Ürün Kodu'] || row['Stok Kodu'] || row['Malzeme'] || Object.values(row)[0] || '',
        urun_adi: row['Ürün Adı'] || row['Açıklama'] || Object.values(row)[1] || '',
      })).filter(u => u.urun_kodu);
      setExcelUrunler(list);
      alert(`✅ ${list.length} ürün yüklendi!`);
    } catch {
      alert('❌ Excel yüklenirken hata oluştu!');
    } finally {
      setExcelYukleniyor(false);
      event.target.value = '';
    }
  };

  const urunSec = (urun: ExcelUrun) => {
    if (seciliSatirIndex !== null) {
      const yeniUrunler = [...urunler];
      yeniUrunler[seciliSatirIndex] = {
        ...yeniUrunler[seciliSatirIndex],
        kod: urun.urun_kodu,
        ad: urun.urun_adi,
      };
      setUrunler(yeniUrunler);
      setAramaModaliAcik(false);
      setSeciliSatirIndex(null);
      setAramaMetni('');
    }
  };

  const filtrelenmisUrunler = excelUrunler.filter(urun =>
    urun.urun_kodu.toLowerCase().includes(aramaMetni.toLowerCase()) ||
    urun.urun_adi.toLowerCase().includes(aramaMetni.toLowerCase())
  );

  // ========== LOG ==========

  const logKaydet = async (kod: string, islem: string, detay: string) => {
    const sube = getSubeByKod(currentUser!.subeKodu);
    if (!sube) return;
    const log: Omit<SatisLog, 'id'> = {
      satisKodu: kod,
      subeKodu: currentUser!.subeKodu,
      islem,
      kullanici: `${currentUser!.ad} ${currentUser!.soyad}`,
      tarih: new Date(),
      detay
    };
    await addDoc(collection(db, `subeler/${sube.dbPath}/loglar`), log);
  };

  // ========== USEEFFECT ==========

  useEffect(() => {
    if (!currentUser) {
      navigate('/login');
      return;
    }
    const generateSatisKodu = async () => {
      const sube = getSubeByKod(currentUser.subeKodu);
      if (!sube) return;
      const sonKod = await getSonSatisKodu(sube.dbPath);
      const yeniKod = getSiraNumarasi(sonKod, String(sube.satisKoduPrefix));
      setSatisKodu(yeniKod);
    };
    generateSatisKodu();
  }, [currentUser]);

  // ========== SUBMIT ==========

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!faturaNo.trim()) {
      setFaturaNoHata(true);
      alert('❌ Fatura numarası zorunludur!');
      return;
    }

    if (marsNo && !isMarsNoGecerli()) {
      setMarsNoHata(true);
      alert('❌ MARS No 2026 ile başlayan 10 haneli olmalıdır! (Örn: 2026123456)');
      return;
    }

 setLoading(true);
    try {
      const sube = getSubeByKod(currentUser!.subeKodu);
      if (!sube) { alert('Şube bilgisi bulunamadı!'); return; }

      const satisTeklifi: Omit<SatisTeklifFormu, 'id'> = {
        satisKodu,
        subeKodu: currentUser!.subeKodu,
        musteriBilgileri,
        musteriTemsilcisi,
        musteriTemsilcisiTel,
        urunler,
        toplamTutar: toplamTutarHesapla(),
        tarih: new Date(tarih),
        teslimatTarihi: new Date(teslimatTarihi),
        marsNo,
        magaza,
        faturaNo,
        servisNotu,
        teslimEdildiMi,
        cevap,
        kampanyalar,
        yesilEtiketler,
        pesinatTutar,
        havaleTutar,
        kartOdemeler,
        hesabaGecen,
        odemeDurumu: getOdemeDurumu(),
        fatura,
        ileriTeslim,
        servis,
        odemeYontemi,
        onayDurumu,
        zarar: karZararHesapla(),
        olusturanKullanici: `${currentUser!.ad} ${currentUser!.soyad}`,
        olusturmaTarihi: new Date(),
        guncellemeTarihi: new Date()
      };

      await addDoc(collection(db, `subeler/${sube.dbPath}/satislar`), satisTeklifi);

      // Onay durumu false ise (beklemede) → bekleyen ürünlere otomatik ekle
      if (!onayDurumu) {
        for (const urun of urunler) {
          const bekleyenUrun: Omit<BekleyenUrun, 'id'> = {
            satisKodu,
            subeKodu: currentUser!.subeKodu,
            urunKodu: urun.kod,
            urunAdi: urun.ad,
            adet: urun.adet,
            musteriIsmi: musteriBilgileri.isim,
            siparisTarihi: new Date(),
            beklenenTeslimTarihi: teslimatTarihi ? new Date(teslimatTarihi) : new Date(),
            durum: 'BEKLEMEDE',
            notlar: servisNotu || '',
            guncellemeTarihi: new Date()
          };
          await addDoc(collection(db, `subeler/${sube.dbPath}/bekleyenUrunler`), bekleyenUrun);
        }
      }

      await logKaydet(
        satisKodu, 'YENİ_SATIS',
        `Yeni satış teklifi. Müşteri: ${musteriBilgileri.isim}, Tutar: ${toplamTutarHesapla()} TL`
      );

      alert('✅ Satış teklifi başarıyla oluşturuldu!');
      navigate('/dashboard');
    } catch (error) {
      console.error(error);
      alert('❌ Bir hata oluştu!');
    } finally {
      setLoading(false);
    }
  };

  // ========== RENDER ==========

  return (
    <div className="satis-teklif-container">
      <div className="satis-teklif-header">
        <button onClick={() => navigate('/dashboard')} className="btn-back">← Geri</button>
        <h1>Yeni Satış Teklif Formu - {satisKodu}</h1>
      </div>

      <form onSubmit={handleSubmit} className="satis-teklif-form">

        {/* ===== MÜŞTERİ BİLGİLERİ ===== */}
        <div className="form-section">
          <h2>Müşteri Bilgileri</h2>
          <div className="form-grid">
            <div className="form-group">
              <label>İsim/Adı *</label>
              <input type="text" name="isim" value={musteriBilgileri.isim} onChange={handleMusteriChange} required />
            </div>
            <div className="form-group">
              <label>VK No</label>
              <input type="text" name="vkNo" value={musteriBilgileri.vkNo} onChange={handleMusteriChange} />
            </div>
            <div className="form-group">
              <label>Adres</label>
              <input type="text" name="adres" value={musteriBilgileri.adres} onChange={handleMusteriChange} />
            </div>
            <div className="form-group">
              <label>VD</label>
              <input type="text" name="vd" value={musteriBilgileri.vd} onChange={handleMusteriChange} />
            </div>
            <div className="form-group">
              <label>Fatura Adresi</label>
              <input type="text" name="faturaAdresi" value={musteriBilgileri.faturaAdresi} onChange={handleMusteriChange} />
            </div>
            <div className="form-group">
              <label>Cep Tel</label>
              <input type="text" name="cep" value={musteriBilgileri.cep} onChange={handleMusteriChange} />
            </div>
          </div>
        </div>

        {/* ===== SATIŞ BİLGİLERİ ===== */}
        <div className="form-section">
          <h2>Satış Bilgileri</h2>
          <div className="form-grid">
            <div className="form-group">
              <label>Müşteri Temsilcisi</label>
              <input type="text" value={musteriTemsilcisi} onChange={e => setMusteriTemsilcisi(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Müşteri Temsilcisi Tel</label>
              <input type="text" value={musteriTemsilcisiTel} onChange={e => setMusteriTemsilcisiTel(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Tarih</label>
              <input type="date" value={tarih} onChange={e => setTarih(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Teslimat Tarihi *</label>
              <input type="date" value={teslimatTarihi} onChange={e => setTeslimatTarihi(e.target.value)} required />
            </div>
          </div>
        </div>

        {/* ===== NOTLAR VE ZORUNLU ALANLAR ===== */}
        <div className="form-section">
          <h2>Notlar ve Zorunlu Alanlar</h2>
          <div className="form-grid">

            {/* MARS NO */}
            <div className="form-group">
              <label>
                MARS No
                <span style={{ color: '#999', fontWeight: 400, textTransform: 'none', marginLeft: '6px' }}>
                  (2026 ile başlayan 10 haneli)
                </span>
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={marsNo}
                  onChange={handleMarsNoChange}
                  placeholder="2026131500"
                  maxLength={10}
                  style={{
                    flex: 1,
                    borderColor: marsNoHata
                      ? '#dc2626'
                      : marsNo && !isMarsNoGecerli()
                      ? '#f59e0b'
                      : undefined
                  }}
                />
                <button type="button" onClick={fixMarsNo} className="btn-fix-mars" title="Otomatik düzelt">
                  ✏️ Düzelt
                </button>
              </div>
              {marsNo && (
                <small style={{ marginTop: '4px', color: isMarsNoGecerli() ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>
                  {isMarsNoGecerli()
                    ? '✅ Geçerli format'
                    : `⚠️ ${marsNo.length}/10 hane${!marsNo.startsWith('2026') ? ' · 2026 ile başlamalı' : ''}`
                  }
                </small>
              )}
              {marsNoHata && (
                <small style={{ color: '#dc2626', fontWeight: 600 }}>
                  ❌ Düzelttikten sonra hâlâ eksik hane var!
                </small>
              )}
            </div>

            <div className="form-group">
              <label>Mağaza</label>
              <input type="text" value={magaza} onChange={e => setMagaza(e.target.value)} placeholder="Mağaza adı" />
            </div>

            {/* FATURA NO */}
            <div className="form-group">
              <label>Fatura No *</label>
              <input
                type="text"
                value={faturaNo}
                onChange={handleFaturaNoChange}
                required
                placeholder="Fatura numarası zorunlu"
                className={faturaNoHata ? 'input-error' : ''}
              />
              {faturaNoHata && <small style={{ color: 'red' }}>Fatura numarası zorunludur!</small>}
            </div>

            {/* SERVİS NOTU - otomatik tik */}
            <div className="form-group">
              <label>Servis Notu</label>
              <input
                type="text"
                value={servisNotu}
                onChange={handleServisNotuChange}
                placeholder="Not girilirse Servis Gerekli otomatik işaretlenir"
              />
            </div>

          </div>

          <div style={{ display: 'flex', gap: '20px', marginTop: '16px', flexWrap: 'wrap' }}>
            <label className="checkbox-label">
              <input type="checkbox" checked={teslimEdildiMi} onChange={e => setTeslimEdildiMi(e.target.checked)} />
              Teslim Edildi
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={fatura} onChange={e => setFatura(e.target.checked)} />
              Fatura Kesildi
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={ileriTeslim} onChange={e => setIleriTeslim(e.target.checked)} />
              İleri Teslim
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={servis} onChange={e => setServis(e.target.checked)} />
              Servis Gerekli
            </label>
          </div>
        </div>

        {/* ===== ÜRÜNLER ===== */}
        <div className="form-section">
          <div className="section-header">
            <h2>Ürünler</h2>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={excelYukle}
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
              />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-excel" disabled={excelYukleniyor}>
                {excelYukleniyor ? '📊 Yükleniyor...' : '📊 Excel Yükle'}
              </button>
              <button type="button" onClick={urunEkle} className="btn-add">+ Ürün Ekle</button>
            </div>
          </div>

          {excelUrunler.length > 0 && (
            <div className="excel-bilgi">📦 {excelUrunler.length} ürün yüklendi</div>
          )}

          {urunler.map((urun, index) => (
            <div key={urun.id} className="urun-satir">
              <div className="urun-grid-extended">
                <div className="form-group">
                  <label>Ürün Kodu</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="text"
                      value={urun.kod}
                      onChange={e => handleUrunChange(index, 'kod', e.target.value)}
                      required
                      style={{ flex: 1 }}
                      placeholder="Ürün kodu"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (excelUrunler.length === 0) { alert('Önce Excel yükleyin!'); return; }
                        setSeciliSatirIndex(index);
                        setAramaModaliAcik(true);
                      }}
                      className="btn-search"
                      title="Excel'den seç"
                    >🔍</button>
                  </div>
                </div>
                <div className="form-group">
                  <label>Ürün Adı</label>
                  <input type="text" value={urun.ad} onChange={e => handleUrunChange(index, 'ad', e.target.value)} required placeholder="Ürün adı" />
                </div>
                <div className="form-group">
                  <label>Adet</label>
                  <input type="number" min="1" value={urun.adet} onChange={e => handleUrunChange(index, 'adet', e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Alış (TL)</label>
                  <input type="number" min="0" step="0.01" value={urun.alisFiyati} onChange={e => handleUrunChange(index, 'alisFiyati', e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>BİP (TL)</label>
                  <input type="number" min="0" step="0.01" value={urun.bip || 0} onChange={e => handleUrunChange(index, 'bip', e.target.value)} />
                </div>
              </div>
              {urunler.length > 1 && (
                <button type="button" onClick={() => urunSil(index)} className="btn-remove">Sil</button>
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
            <button type="button" onClick={kampanyaEkle} className="btn-add">+ Kampanya Ekle</button>
          </div>
          {kampanyalar.map((kampanya, index) => (
            <div key={kampanya.id} className="kampanya-satir">
              <div className="kampanya-grid">
                <div className="form-group">
                  <label>Kampanya Adı</label>
                  <input type="text" value={kampanya.ad} onChange={e => handleKampanyaChange(index, 'ad', e.target.value)} placeholder="Örn: 3 LÜ ÜRÜN KAMP" />
                </div>
                <div className="form-group">
                  <label>Tutar (TL)</label>
                  <input type="number" min="0" step="0.01" value={kampanya.tutar} onChange={e => handleKampanyaChange(index, 'tutar', e.target.value)} />
                </div>
                <button type="button" onClick={() => kampanyaSil(index)} className="btn-remove-inline">Sil</button>
              </div>
            </div>
          ))}
        </div>

        {/* ===== YEŞİL ETİKETLER ===== */}
        <div className="form-section">
          <div className="section-header">
            <h2>Yeşil Etiketler (İndirimli Eski Ürünler)</h2>
            <button type="button" onClick={yesilEtiketEkle} className="btn-add">+ Yeşil Etiket Ekle</button>
          </div>
          {yesilEtiketler.map((etiket, index) => (
            <div key={etiket.id} className="etiket-satir">
              <div className="etiket-grid">
                <div className="form-group">
                  <label>Ürün Kodu</label>
                  <input type="text" value={etiket.urunKodu} onChange={e => handleYesilEtiketChange(index, 'urunKodu', e.target.value)} placeholder="Ürün kodu" />
                </div>
                <div className="form-group">
                  <label>İndirim Tutarı (TL)</label>
                  <input type="number" min="0" step="0.01" value={etiket.tutar} onChange={e => handleYesilEtiketChange(index, 'tutar', e.target.value)} />
                </div>
                <button type="button" onClick={() => yesilEtiketSil(index)} className="btn-remove-inline">Sil</button>
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
              <input type="number" min="0" step="0.01" value={pesinatTutar} onChange={e => setPesinatTutar(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>Havale (TL)</label>
              <input type="number" min="0" step="0.01" value={havaleTutar} onChange={e => setHavaleTutar(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          {/* Kart Ödemeleri */}
          <div className="kart-odemeler-section">
            <div className="section-header">
              <h3>Kart ile Ödemeler</h3>
              <button type="button" onClick={kartEkle} className="btn-add">+ Kart Ekle</button>
            </div>
            {kartOdemeler.map((kart, index) => (
              <div key={kart.id} className="kart-satir">
                <div className="kart-grid">
                  <div className="form-group">
                    <label>Banka</label>
                    <select value={kart.banka} onChange={e => handleKartChange(index, 'banka', e.target.value)}>
                      {BANKALAR.map(banka => <option key={banka} value={banka}>{banka}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Taksit Sayısı</label>
                    <select value={kart.taksitSayisi} onChange={e => handleKartChange(index, 'taksitSayisi', e.target.value)}>
                      {TAKSIT_SECENEKLERI.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Tutar (TL)</label>
                    <input type="number" min="0" step="0.01" value={kart.tutar} onChange={e => handleKartChange(index, 'tutar', e.target.value)} />
                  </div>
                  <button type="button" onClick={() => kartSil(index)} className="btn-remove-inline">Sil</button>
                </div>
              </div>
            ))}
          </div>

          {/* Kâr/Zarar */}
          <div
            className="zarar-preview"
            style={{ color: karZararHesapla() >= 0 ? '#16a34a' : '#dc2626' }}
          >
            <strong>
              {karZararHesapla() >= 0
                ? `KÂR: ${formatPrice(karZararHesapla())}`
                : `ZARAR: ${formatPrice(Math.abs(karZararHesapla()))}`
              }
            </strong>
            <small style={{ marginLeft: '12px', fontWeight: 'normal', color: '#666' }}>
              (Hesaba Geçen: {formatPrice(hesabaGecenToplamHesapla())} — Maliyet: {formatPrice(toplamMaliyetHesapla())})
            </small>
          </div>
        </div>

        {/* ===== ONAY ===== */}
        <div className="form-section">
          <label className="checkbox-label onay-checkbox">
            <input type="checkbox" checked={onayDurumu} onChange={e => setOnayDurumu(e.target.checked)} />
            <span><strong>Onaylıyorum</strong></span>
          </label>
        </div>

        {/* ===== BUTONLAR ===== */}
        <div className="form-actions">
          <button type="button" onClick={() => navigate('/dashboard')} className="btn-cancel">İptal</button>
          <button type="submit" disabled={loading} className="btn-submit">
            {loading ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>

      </form>

      {/* ===== EXCEL MODAL ===== */}
      {aramaModaliAcik && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>📦 Excel'den Ürün Seç ({excelUrunler.length} ürün)</h3>
              <button onClick={() => { setAramaModaliAcik(false); setSeciliSatirIndex(null); setAramaMetni(''); }} className="btn-close">✕</button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                placeholder="Ürün kodu veya adı ile ara..."
                value={aramaMetni}
                onChange={e => setAramaMetni(e.target.value)}
                className="modal-search"
                autoFocus
              />
              <div className="modal-list">
                {filtrelenmisUrunler.length > 0 ? (
                  filtrelenmisUrunler.map((urun, index) => (
                    <div key={index} onClick={() => urunSec(urun)} className="modal-item">
                      <div className="modal-item-kod">{urun.urun_kodu}</div>
                      <div className="modal-item-ad">{urun.urun_adi}</div>
                    </div>
                  ))
                ) : (
                  <div className="modal-empty">
                    <div className="modal-empty-icon">🔍</div>
                    <div>{excelUrunler.length === 0 ? 'Önce Excel yükle!' : 'Ürün bulunamadı'}</div>
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