import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, addDoc, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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

  // Kart NET tutarı = Brüt Tutar - (Brüt Tutar * Kesinti %)
  const kartNetTutarHesapla = (kart: KartOdeme): number => {
    const kesinti = kart.kesintiOrani || 0;
    return kart.tutar - (kart.tutar * kesinti) / 100;
  };

  // Kasaya Yansır = Sadece Peşin
  const kasayaYansiranHesapla = (): number => pesinatTutar || 0;

  // Hesaba Geçen = Peşin + Havale + Kart NET toplamı
  const hesabaGecenToplamHesapla = (): number => {
    const kartNetToplam = kartOdemeler.reduce((sum, kart) => sum + kartNetTutarHesapla(kart), 0);
    return (pesinatTutar || 0) + (havaleTutar || 0) + kartNetToplam;
  };

  // Kart Brüt Toplam
  const kartBrutToplamHesapla = (): number =>
    kartOdemeler.reduce((sum, kart) => sum + (kart.tutar || 0), 0);

  // Kart Kesinti Toplam
  const kartKesintiToplamHesapla = (): number =>
    kartOdemeler.reduce((sum, kart) => {
      const kesinti = kart.kesintiOrani || 0;
      return sum + (kart.tutar * kesinti) / 100;
    }, 0);

  // Açık Hesap = Satış Tutarı - Hesaba Geçen
  const acikHesapHesapla = (): number => {
    const acik = toplamTutarHesapla() - hesabaGecenToplamHesapla();
    return acik > 0 ? acik : 0;
  };

  // Kâr/Zarar = Hesaba Geçen - Maliyet
  const karZararHesapla = (): number =>
    hesabaGecenToplamHesapla() - toplamMaliyetHesapla();

  const getOdemeDurumu = (): OdemeDurumu => {
    return acikHesapHesapla() > 0 ? OdemeDurumu.ACIK_HESAP : OdemeDurumu.ODENDI;
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
    setFatura(value.trim() !== '');
  };

  // ========== SatisKodu ==========
  const satisKoduOlustur = async (): Promise<string> => {
    const sube = getSubeByKod(currentUser!.subeKodu);
    if (!sube) return '';

    try {
      const counterRef = doc(db, `subeler/${sube.dbPath}/counters`, 'satisCounter');
      const counterDoc = await getDoc(counterRef);

      let newNumber = 1;
      if (counterDoc.exists()) {
        const data = counterDoc.data();
        newNumber = (data.currentNumber || 0) + 1;
      }

      await setDoc(counterRef, {
        currentNumber: newNumber,
        lastUpdated: new Date()
      });

      return newNumber.toString().padStart(3, '0');
    } catch (error) {
      console.error('Satış kodu oluşturulamadı:', error);
      return Date.now().toString().slice(-3);
    }
  };

  // ========== SERVİS NOTU ==========

  const handleServisNotuChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setServisNotu(value);
    setServis(value.trim() !== '');
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
      { id: Date.now().toString(), banka: BANKALAR[0], taksitSayisi: 1, tutar: 0, kesintiOrani: 0 }
    ]);
  };

  const kartSil = (index: number) => {
    setKartOdemeler(prev => prev.filter((_, i) => i !== index));
  };

  const handleKartChange = (index: number, field: keyof KartOdeme, value: any) => {
    const yeniKartlar = [...kartOdemeler];
    yeniKartlar[index] = {
      ...yeniKartlar[index],
      [field]: field === 'tutar' || field === 'kesintiOrani'
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
    setYesilEtiketler(prev => [
      ...prev,
      { id: Date.now().toString(), urunKodu: '', ad: '', alisFiyati: 0, tutar: 0 }
    ]);
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

      // Ödeme özeti hesapla
      const kasayaYansiran = kasayaYansiranHesapla();
      const kartNetToplam = kartOdemeler.reduce((sum, kart) => sum + kartNetTutarHesapla(kart), 0);
      const kartBrutToplam = kartBrutToplamHesapla();
      const kartKesintiToplam = kartKesintiToplamHesapla();
      const hesabaGecenToplam = hesabaGecenToplamHesapla();
      const acikHesap = acikHesapHesapla();

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
        // 📌 YENİ ÖDEME SİSTEMİ ALANLARI
        odemeOzeti: {
          kasayaYansiran,           // Sadece peşin
          kartBrutToplam,           // Kart brüt toplamı
          kartKesintiToplam,        // Kart kesintisi toplamı
          kartNetToplam,            // Kart NET (kesinti sonrası)
          hesabaGecenToplam,        // Peşin + Havale + Kart NET
          acikHesap,                // Satış Tutarı - Hesaba Geçen
          odemeDurumuDetay: acikHesap > 0 ? 'AÇIK_HESAP' : 'ÖDENDİ'
        },
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
        `Yeni satış teklifi. Müşteri: ${musteriBilgileri.isim}, Tutar: ${toplamTutarHesapla()} TL, Hesaba Geçen: ${hesabaGecenToplam} TL, Açık Hesap: ${acikHesap} TL`
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

            {/* SERVİS NOTU */}
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
          <h2>💳 Ödeme Bilgileri</h2>

          {/* Ödeme Türleri Tablosu */}
          <div className="odeme-tablo" style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '13px'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Ödeme Türü</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px' }}>Kasaya Yansır?</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px' }}>Hesaba Geçer?</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '5px 8px', fontWeight: 600 }}>Peşin</td>
                  <td style={{ textAlign: 'center', padding: '5px 8px' }}>✅ Evet</td>
                  <td style={{ textAlign: 'center', padding: '5px 8px' }}>✅ Evet</td>
                </tr>
                <tr style={{ background: '#f1f5f9' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 600 }}>Havale</td>
                  <td style={{ textAlign: 'center', padding: '5px 8px' }}>❌ Hayır</td>
                  <td style={{ textAlign: 'center', padding: '5px 8px' }}>✅ Evet</td>
                </tr>
                <tr>
                  <td style={{ padding: '5px 8px', fontWeight: 600 }}>Kart</td>
                  <td style={{ textAlign: 'center', padding: '5px 8px' }}>❌ Hayır</td>
                  <td style={{ textAlign: 'center', padding: '5px 8px' }}>✅ Kesinti sonrası</td>
                </tr>
                <tr style={{ background: '#f1f5f9' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 600 }}>Açık Hesap</td>
                  <td style={{ textAlign: 'center', padding: '5px 8px' }}>❌ Hayır</td>
                  <td style={{ textAlign: 'center', padding: '5px 8px' }}>❌ Ödenince geçer</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="form-grid">
            {/* PEŞİNAT */}
            <div className="form-group">
              <label>💵 Peşinat (TL) — Kasaya Yansır</label>
              <input
                type="number" min="0" step="0.01"
                value={pesinatTutar}
                onChange={e => setPesinatTutar(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
              />
              {pesinatTutar > 0 && (
                <small style={{ color: '#16a34a', fontWeight: 600 }}>
                  ✅ Kasaya Yansır: {formatPrice(pesinatTutar)}
                </small>
              )}
            </div>

            {/* HAVALE */}
            <div className="form-group">
              <label>🏦 Havale (TL) — Kasaya Yansımaz</label>
              <input
                type="number" min="0" step="0.01"
                value={havaleTutar}
                onChange={e => setHavaleTutar(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
              />
              {havaleTutar > 0 && (
                <small style={{ color: '#2563eb', fontWeight: 600 }}>
                  ✅ Hesaba Geçer: {formatPrice(havaleTutar)}
                </small>
              )}
            </div>
          </div>

          {/* Kart Ödemeleri */}
          <div className="kart-odemeler-section">
            <div className="section-header">
              <h3>💳 Kart ile Ödemeler — Kesinti Sonrası Hesaba Geçer</h3>
              <button type="button" onClick={kartEkle} className="btn-add">+ Kart Ekle</button>
            </div>
            {kartOdemeler.map((kart, index) => {
              const netTutar = kartNetTutarHesapla(kart);
              const kesintiTutar = kart.tutar - netTutar;
              return (
                <div key={kart.id} style={{
                  background: '#f0f9ff',
                  border: '1.5px solid #bae6fd',
                  borderRadius: '8px',
                  padding: '20px',
                  marginBottom: '12px'
                }}>
                  {/* 4 alan + Sil — hepsi tam genişlikte */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1.5fr 1.5fr auto',
                    gap: '16px',
                    alignItems: 'end',
                    width: '100%'
                  }}>
                    {/* BANKA */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#80868b' }}>Banka</label>
                      <select
                        value={kart.banka}
                        onChange={e => handleKartChange(index, 'banka', e.target.value)}
                        style={{ padding: '10px 14px', border: '1.5px solid #dadce0', borderRadius: '4px', fontSize: '14px', width: '100%', background: 'white' }}
                      >
                        {BANKALAR.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>

                    {/* TAKSİT */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#80868b' }}>Taksit</label>
                      <select
                        value={kart.taksitSayisi}
                        onChange={e => handleKartChange(index, 'taksitSayisi', e.target.value)}
                        style={{ padding: '10px 14px', border: '1.5px solid #dadce0', borderRadius: '4px', fontSize: '14px', width: '100%', background: 'white' }}
                      >
                        {TAKSIT_SECENEKLERI.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>

                    {/* BRÜT TUTAR */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#80868b' }}>Brüt Tutar (TL)</label>
                      <input
                        type="number" min="0" step="0.01"
                        value={kart.tutar}
                        onChange={e => handleKartChange(index, 'tutar', e.target.value)}
                        style={{ padding: '10px 14px', border: '1.5px solid #dadce0', borderRadius: '4px', fontSize: '14px', width: '100%' }}
                      />
                    </div>

                    {/* KESİNTİ ORANI */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#80868b' }}>Kesinti Oranı (%)</label>
                      <input
                        type="number" min="0" max="100" step="0.01"
                        value={kart.kesintiOrani || 0}
                        placeholder="Örn: 1.5"
                        onChange={e => handleKartChange(index, 'kesintiOrani', e.target.value)}
                        style={{ padding: '10px 14px', border: '1.5px solid #dadce0', borderRadius: '4px', fontSize: '14px', width: '100%' }}
                      />
                    </div>

                    {/* SİL */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', color: 'transparent' }}>-</label>
                      <button
                        type="button"
                        onClick={() => kartSil(index)}
                        style={{
                          padding: '10px 18px',
                          background: 'white',
                          color: '#dc2626',
                          border: '1.5px solid #dc2626',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          letterSpacing: '0.5px'
                        }}
                      >Sil</button>
                    </div>
                  </div>

                  {/* NET özet */}
                  {kart.tutar > 0 && (
                    <div style={{
                      display: 'flex', gap: '24px', flexWrap: 'wrap',
                      marginTop: '12px', padding: '10px 14px',
                      background: '#eff6ff', border: '1px solid #bfdbfe',
                      borderRadius: '6px', fontSize: '13px'
                    }}>
                      <span>Brüt: <strong>{formatPrice(kart.tutar)}</strong></span>
                      <span style={{ color: '#dc2626' }}>Kesinti: <strong>−{formatPrice(kesintiTutar)}</strong></span>
                      <span style={{ color: '#16a34a' }}>NET (Hesaba Geçer): <strong>{formatPrice(netTutar)}</strong></span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ÖDEME ÖZETİ */}
          <div style={{
            marginTop: '24px',
            background: '#f0fdf4',
            border: '2px solid #86efac',
            borderRadius: '12px',
            padding: '16px 20px'
          }}>
            <h3 style={{ margin: '0 0 14px 0', color: '#15803d', fontSize: '15px' }}>📊 Ödeme Özeti</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
              
              {/* Kasaya Yansıyan */}
              <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 14px', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>💵 Kasaya Yansıyan</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#15803d' }}>{formatPrice(kasayaYansiranHesapla())}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>Sadece peşin</div>
              </div>

              {/* Hesaba Geçen */}
              <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 14px', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>🏦 Hesaba Geçen Toplam</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#1d4ed8' }}>{formatPrice(hesabaGecenToplamHesapla())}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                  Peşin + Havale + Kart NET
                </div>
              </div>

              {/* Kart Kesinti */}
              {kartOdemeler.length > 0 && (
                <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 14px', border: '1px solid #fecaca' }}>
                  <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>✂️ Toplam Kart Kesintisi</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#dc2626' }}>-{formatPrice(kartKesintiToplamHesapla())}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                    Brüt: {formatPrice(kartBrutToplamHesapla())} → NET: {formatPrice(kartBrutToplamHesapla() - kartKesintiToplamHesapla())}
                  </div>
                </div>
              )}

              {/* Açık Hesap */}
              <div style={{
                background: acikHesapHesapla() > 0 ? '#fff7ed' : '#fff',
                borderRadius: '8px', padding: '10px 14px',
                border: `1px solid ${acikHesapHesapla() > 0 ? '#fed7aa' : '#bbf7d0'}`
              }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>🔓 Açık Hesap</div>
                <div style={{
                  fontSize: '18px', fontWeight: 700,
                  color: acikHesapHesapla() > 0 ? '#ea580c' : '#15803d'
                }}>
                  {acikHesapHesapla() > 0 ? formatPrice(acikHesapHesapla()) : '✅ Ödendi'}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                  Satış Tutarı - Hesaba Geçen
                </div>
              </div>
            </div>

            {/* Kâr/Zarar */}
            <div
              className="zarar-preview"
              style={{
                marginTop: '14px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: karZararHesapla() >= 0 ? '#dcfce7' : '#fee2e2',
                color: karZararHesapla() >= 0 ? '#15803d' : '#dc2626'
              }}
            >
              <strong style={{ fontSize: '15px' }}>
                {karZararHesapla() >= 0
                  ? `📈 KÂR: ${formatPrice(karZararHesapla())}`
                  : `📉 ZARAR: ${formatPrice(Math.abs(karZararHesapla()))}`
                }
              </strong>
              <small style={{ marginLeft: '14px', fontWeight: 'normal', color: '#666', fontSize: '12px' }}>
                (Hesaba Geçen: {formatPrice(hesabaGecenToplamHesapla())} — Maliyet: {formatPrice(toplamMaliyetHesapla())})
              </small>
            </div>
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