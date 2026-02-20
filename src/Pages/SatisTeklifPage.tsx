import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  collection, addDoc, query, orderBy, limit, getDocs
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  SatisTeklifFormu, MusteriBilgileri, Urun, KartOdeme, Kampanya,
  YesilEtiket, OdemeYontemi, SatisLog, BANKALAR, TAKSIT_SECENEKLERI,
  OdemeDurumu, BekleyenUrun,
} from '../types/satis';
import { getSubeByKod, SubeKodu } from '../types/sube';
import * as XLSX from 'xlsx';
import './SatisTeklif.css';

// ── Havale bankaları ─────────────────────────────────────────────────────────
const HAVALE_BANKALARI = [
  'Ziraat Bankası',
  'Halkbank',
  'Vakıfbank',
  'İş Bankası',
  'Garanti BBVA',
  'Yapı Kredi',
  'Akbank',
  'QNB Finansbank',
  'Denizbank',
  'TEB',
  'ING Bank',
  'HSBC',
  'Şekerbank',
  'Fibabanka',
  'Alternatifbank',
];

// ── Admin panelden çekilecek yeşil etiket tipi ───────────────────────────────
interface YesilEtiketAdmin {
  id?: string;
  urunKodu: string;
  urunTuru?: string;
  maliyet: number;
}

// ── Admin panelden çekilecek kampanya tipi ───────────────────────────────────
interface KampanyaAdmin {
  id?: string;
  ad: string;
  aciklama: string;
  aktif: boolean;
  subeKodu: string;
}

const SatisTeklifPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

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

  // Kampanyalar – admin panelden çekilir, kullanıcı seçer
  const [kampanyaListesi, setKampanyaListesi] = useState<KampanyaAdmin[]>([]);
  const [seciliKampanyaIds, setSeciliKampanyaIds] = useState<string[]>([]);

  // Yeşil etiketler – admin panelden çekilir, ürün koduna göre otomatik eşleşir
  const [yesilEtiketAdminList, setYesilEtiketAdminList] = useState<YesilEtiketAdmin[]>([]);

  const [pesinatTutar, setPesinatTutar] = useState(0);
  const [havaleTutar, setHavaleTutar] = useState(0);
  const [havaleBanka, setHavaleBanka] = useState(HAVALE_BANKALARI[0]);
  const [kartOdemeler, setKartOdemeler] = useState<KartOdeme[]>([]);
  const [odemeYontemi, setOdemeYontemi] = useState<OdemeYontemi>(OdemeYontemi.PESINAT);
  const [hesabaGecen, setHesabaGecen] = useState('');
  const [onayDurumu, setOnayDurumu] = useState(false);
  const [loading, setLoading] = useState(false);

  const [satisKodu, setSatisKodu] = useState('');

  // ========== YARDIMCI FONKSİYONLAR ==========
  const getSonSatisKodu = async (subeDbPath: string): Promise<string | null> => {
    try {
      const satisRef = collection(db, `subeler/${subeDbPath}/satislar`);
      const q = query(satisRef, orderBy('satisKodu', 'desc'), limit(1));
      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;
      return snapshot.docs[0].data().satisKodu as string;
    } catch { return null; }
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
    urunler.reduce((t, u) => t + u.adet * u.alisFiyati, 0);

  const bipToplamHesapla = (): number =>
    urunler.reduce((t, u) => t + (u.bip || 0) * u.adet, 0);

  const toplamTutarHesapla = (): number => alisToplamHesapla();

  const toplamMaliyetHesapla = (): number =>
    alisToplamHesapla() - bipToplamHesapla();

  // Yeşil etiket toplam indirimi – ürün koduna göre otomatik eşleşir
  const yesilEtiketToplamIndirimHesapla = (): number => {
    let toplam = 0;
    for (const urun of urunler) {
      const eslesen = yesilEtiketAdminList.find(
        y => y.urunKodu.trim().toLowerCase() === urun.kod.trim().toLowerCase()
      );
      if (eslesen) toplam += eslesen.maliyet * urun.adet;
    }
    return toplam;
  };

  // Eşleşen yeşil etiketleri listele (gösterim için)
  const eslesenYesilEtiketler = (): { urunKodu: string; urunAdi: string; maliyet: number; adet: number }[] => {
    const result: { urunKodu: string; urunAdi: string; maliyet: number; adet: number }[] = [];
    for (const urun of urunler) {
      const eslesen = yesilEtiketAdminList.find(
        y => y.urunKodu.trim().toLowerCase() === urun.kod.trim().toLowerCase()
      );
      if (eslesen) {
        result.push({ urunKodu: urun.kod, urunAdi: urun.ad, maliyet: eslesen.maliyet, adet: urun.adet });
      }
    }
    return result;
  };

  const kartNetTutarHesapla = (kart: KartOdeme): number => {
    const kesinti = kart.kesintiOrani || 0;
    return kart.tutar - (kart.tutar * kesinti) / 100;
  };

  const kasayaYansiranHesapla = (): number => pesinatTutar || 0;

  const hesabaGecenToplamHesapla = (): number => {
    const kartNetToplam = kartOdemeler.reduce((sum, k) => sum + kartNetTutarHesapla(k), 0);
    return (pesinatTutar || 0) + (havaleTutar || 0) + kartNetToplam;
  };

  const kartBrutToplamHesapla = (): number =>
    kartOdemeler.reduce((sum, k) => sum + (k.tutar || 0), 0);

  const kartKesintiToplamHesapla = (): number =>
    kartOdemeler.reduce((sum, k) => {
      const kesinti = k.kesintiOrani || 0;
      return sum + (k.tutar * kesinti) / 100;
    }, 0);

  const acikHesapHesapla = (): number => {
    const acik = toplamTutarHesapla() - hesabaGecenToplamHesapla();
    return acik > 0 ? acik : 0;
  };

  const karZararHesapla = (): number =>
    hesabaGecenToplamHesapla() - toplamMaliyetHesapla();

  const getOdemeDurumu = (): OdemeDurumu =>
    acikHesapHesapla() > 0 ? OdemeDurumu.ACIK_HESAP : OdemeDurumu.ODENDI;

  // ========== MARS NO ==========
  // Mağazadan teslim edildi ise MARS No zorunlu değil
  const isMarsNoGerekli = (): boolean => !teslimEdildiMi;

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
      await setDoc(counterRef, { currentNumber: newNumber, lastUpdated: new Date() });
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
  // Firebase ürün listesi cache (kod → {ad, alis, bip})
  const [urunCache, setUrunCache] = useState<Record<string, { ad: string; alis: number; bip: number }>>({});

  const urunCacheYukle = async () => {
    try {
      const sube = getSubeByKod(currentUser!.subeKodu);
      if (!sube) return;
      const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/urunler`));
      const cache: Record<string, { ad: string; alis: number; bip: number }> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.kod) cache[data.kod.trim()] = {
          ad: data.ad || data.urunAdi || '',
          alis: parseFloat(data.alis || data.alisFiyati || 0),
          bip: parseFloat(data.bip || 0),
        };
      });
      setUrunCache(cache);
    } catch (err) {
      console.error('Ürün cache yüklenemedi:', err);
    }
  };

  const handleUrunChange = (index: number, field: keyof Urun, value: any) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = {
      ...yeniUrunler[index],
      [field]: field === 'adet' || field === 'alisFiyati' || field === 'bip'
        ? (value === '' ? 0 : parseFloat(value) || 0)
        : value
    };
    // Ürün kodu girilince cache'den otomatik doldur
    if (field === 'kod') {
      const trimmed = String(value).trim();
      const eslesme = urunCache[trimmed];
      if (eslesme) {
        yeniUrunler[index] = {
          ...yeniUrunler[index],
          kod: trimmed,
          ad: eslesme.ad || yeniUrunler[index].ad,
          alisFiyati: eslesme.alis,
          bip: eslesme.bip,
        };
      }
    }
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

  // ========== KAMPANYA SEÇİMİ ==========
  const kampanyaToggle = (id: string) => {
    setSeciliKampanyaIds(prev =>
      prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]
    );
  };

  const seciliKampanyalar = kampanyaListesi.filter(k => seciliKampanyaIds.includes(k.id!));

  // ========== FIREBASE: Kampanya & Yeşil Etiket çek ==========
  const kampanyalariCek = async () => {
    try {
      const sube = getSubeByKod(currentUser!.subeKodu);
      if (!sube) return;
      const snap = await getDocs(collection(db, 'kampanyalar'));
      const liste = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as KampanyaAdmin))
        .filter(k => k.aktif && (k.subeKodu === 'GENEL' || k.subeKodu === currentUser!.subeKodu));
      setKampanyaListesi(liste);
    } catch (err) {
      console.error('Kampanyalar çekilemedi:', err);
    }
  };

  const yesilEtiketleriCek = async () => {
    try {
      const sube = getSubeByKod(currentUser!.subeKodu);
      if (!sube) return;
      const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/yesilEtiketler`));
      // Firebase'de maliyet alanı = Excel'deki "YEŞİL ETİKET" kolonu
      const liste = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          urunKodu: data.urunKodu || '',
          urunTuru: data.urunTuru || '',
          maliyet: parseFloat(data.maliyet || data['YEŞİL ETİKET'] || data.yesilEtiket || 0),
        } as YesilEtiketAdmin;
      });
      setYesilEtiketAdminList(liste.filter(e => e.urunKodu && e.maliyet > 0));
    } catch (err) {
      console.error('Yeşil etiketler çekilemedi:', err);
    }
  };

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
    if (!currentUser) { navigate('/login'); return; }
    const generateSatisKodu = async () => {
      const sube = getSubeByKod(currentUser.subeKodu);
      if (!sube) return;
      const sonKod = await getSonSatisKodu(sube.dbPath);
      const yeniKod = getSiraNumarasi(sonKod, String(sube.satisKoduPrefix));
      setSatisKodu(yeniKod);
    };
    generateSatisKodu();
    kampanyalariCek();
    yesilEtiketleriCek();
    urunCacheYukle();
  }, [currentUser]);

  // ========== SUBMIT ==========
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!faturaNo.trim()) {
      setFaturaNoHata(true);
      alert('❌ Fatura numarası zorunludur!');
      return;
    }

    // MARS No: teslim edildi ise zorunlu değil
    if (isMarsNoGerekli() && marsNo && !isMarsNoGecerli()) {
      setMarsNoHata(true);
      alert('❌ MARS No 2026 ile başlayan 10 haneli olmalıdır! (Örn: 2026123456)');
      return;
    }

    setLoading(true);
    try {
      const sube = getSubeByKod(currentUser!.subeKodu);
      if (!sube) { alert('Şube bilgisi bulunamadı!'); return; }

      const kasayaYansiran = kasayaYansiranHesapla();
      const kartNetToplam = kartOdemeler.reduce((sum, k) => sum + kartNetTutarHesapla(k), 0);
      const kartBrutToplam = kartBrutToplamHesapla();
      const kartKesintiToplam = kartKesintiToplamHesapla();
      const hesabaGecenToplam = hesabaGecenToplamHesapla();
      const acikHesap = acikHesapHesapla();

      const etiketler = eslesenYesilEtiketler();

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
        kampanyalar: seciliKampanyalar.map(k => ({ id: k.id!, ad: k.ad, tutar: 0 })),
        yesilEtiketler: etiketler.map(e => ({
          id: Date.now().toString(),
          urunKodu: e.urunKodu,
          ad: e.urunAdi,
          alisFiyati: e.maliyet,
          tutar: e.maliyet * e.adet
        })),
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
        odemeOzeti: {
          kasayaYansiran,
          kartBrutToplam,
          kartKesintiToplam,
          kartNetToplam,
          hesabaGecenToplam,
          acikHesap,
          odemeDurumuDetay: acikHesap > 0 ? 'AÇIK_HESAP' : 'ÖDENDİ'
        },
        olusturanKullanici: `${currentUser!.ad} ${currentUser!.soyad}`,
        olusturmaTarihi: new Date(),
        guncellemeTarihi: new Date()
      };

      await addDoc(collection(db, `subeler/${sube.dbPath}/satislar`), satisTeklifi);

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
        satisKodu,
        'YENİ_SATIS',
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
    <div className="satis-form-container">
      <div className="satis-form-header">
        <button onClick={() => navigate('/dashboard')} className="btn-back">← Geri</button>
      </div>
      <h2 className="form-title">Yeni Satış Teklif Formu — {satisKodu}</h2>

      <form onSubmit={handleSubmit}>

        {/* ===== MÜŞTERİ BİLGİLERİ ===== */}
        <section className="form-section">
          <h3 className="section-title">Müşteri Bilgileri</h3>
          <div className="form-grid-4">
            <div className="form-field">
              <label>İsim/Adı *</label>
              <input name="isim" value={musteriBilgileri.isim} onChange={handleMusteriChange} required />
            </div>
            <div className="form-field">
              <label>VK No</label>
              <input name="vkNo" value={musteriBilgileri.vkNo} onChange={handleMusteriChange} />
            </div>
            <div className="form-field">
              <label>Adres</label>
              <input name="adres" value={musteriBilgileri.adres} onChange={handleMusteriChange} />
            </div>
            <div className="form-field">
              <label>VD</label>
              <input name="vd" value={musteriBilgileri.vd} onChange={handleMusteriChange} />
            </div>
            <div className="form-field">
              <label>Fatura Adresi</label>
              <input name="faturaAdresi" value={musteriBilgileri.faturaAdresi} onChange={handleMusteriChange} />
            </div>
            <div className="form-field">
              <label>Cep Tel</label>
              <input name="cep" value={musteriBilgileri.cep} onChange={handleMusteriChange} />
            </div>
          </div>
        </section>

        {/* ===== SATIŞ BİLGİLERİ ===== */}
        <section className="form-section">
          <h3 className="section-title">Satış Bilgileri</h3>
          <div className="form-grid-4">
            <div className="form-field">
              <label>Müşteri Temsilcisi</label>
              <input value={musteriTemsilcisi} onChange={e => setMusteriTemsilcisi(e.target.value)} />
            </div>
            <div className="form-field">
              <label>Teslimat Tarihi *</label>
              <input type="date" value={teslimatTarihi} onChange={e => setTeslimatTarihi(e.target.value)} required />
            </div>
            {/* 1 — Satış Tutarı (salt okunur, ürünlerden otomatik hesaplanır) */}
            <div className="form-field">
              <label>Satış Tutarı</label>
              <input
                type="text"
                value={formatPrice(toplamTutarHesapla())}
                readOnly
                style={{ background: '#f0fdf4', fontWeight: 700, color: '#15803d' }}
              />
            </div>
          </div>
        </section>

        {/* ===== NOTLAR VE ZORUNLU ALANLAR ===== */}
        <section className="form-section">
          <h3 className="section-title">Notlar ve Zorunlu Alanlar</h3>
          <div className="form-grid-4">
            {/* MARS NO */}
            <div className="form-field">
              <label>
                MARS No (2026 ile başlayan 10 haneli)
                {teslimEdildiMi && (
                  <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: 6 }}>
                    (Mağazadan teslim – zorunlu değil)
                  </span>
                )}
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={marsNo}
                  onChange={handleMarsNoChange}
                  placeholder="2026XXXXXXXX"
                  maxLength={10}
                  style={{ flex: 1, borderColor: marsNoHata ? '#ef4444' : undefined }}
                />
                <button type="button" onClick={fixMarsNo} className="btn-fix">
                  ✏️ Düzelt
                </button>
              </div>
              {marsNo && (
                <small style={{ color: isMarsNoGecerli() ? '#16a34a' : '#d97706' }}>
                  {isMarsNoGecerli()
                    ? '✅ Geçerli format'
                    : `⚠️ ${marsNo.length}/10 hane${!marsNo.startsWith('2026') ? ' · 2026 ile başlamalı' : ''}`
                  }
                </small>
              )}
              {marsNoHata && <small style={{ color: '#ef4444' }}>❌ Düzelttikten sonra hâlâ eksik hane var!</small>}
            </div>

            {/* MAĞAZA */}
            <div className="form-field">
              <label>Mağaza</label>
              <input value={magaza} onChange={e => setMagaza(e.target.value)} placeholder="Mağaza adı" />
            </div>

            {/* FATURA NO */}
            <div className="form-field">
              <label>Fatura No *</label>
              <input
                value={faturaNo}
                onChange={handleFaturaNoChange}
                style={{ borderColor: faturaNoHata ? '#ef4444' : undefined }}
                required
              />
              {faturaNoHata && <small style={{ color: '#ef4444' }}>Fatura numarası zorunludur!</small>}
            </div>

            {/* SERVİS NOTU */}
            <div className="form-field">
              <label>Servis Notu</label>
              <input value={servisNotu} onChange={handleServisNotuChange} placeholder="Not girilirse Servis Gerekli otomatik işaretlenir" />
            </div>
          </div>

          {/* Checkboxlar */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            {/* 2 — "Teslim Edildi" = mağazadan teslim → MARS No zorunluluğu kalkar */}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={teslimEdildiMi}
                onChange={e => {
                  setTeslimEdildiMi(e.target.checked);
                  if (e.target.checked) {
                    // Mağazadan teslim edildiğinde marsNo hatasını sıfırla
                    setMarsNoHata(false);
                  }
                }}
              />
              Teslim Edildi <span style={{ fontSize: 11, color: '#6b7280' }}>(mağazadan)</span>
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
        </section>

        {/* ===== ÜRÜNLER ===== */}
        {/* 3 — Excel Yükle kaldırıldı */}
        <section className="form-section">
          <div className="section-header">
            <h3 className="section-title">Ürünler</h3>
            <button type="button" onClick={urunEkle} className="btn-add">+ Ürün Ekle</button>
          </div>

          <div className="urun-table-header">
            <span>Ürün Kodu</span>
            <span>Ürün Adı</span>
            <span>Adet</span>
            <span>Alış (TL)</span>
            <span>BİP (TL)</span>
            <span></span>
          </div>

          {urunler.map((urun, index) => (
            <div key={urun.id} className="urun-row">
              <div style={{ position: 'relative' }}>
                <input
                  value={urun.kod}
                  onChange={e => handleUrunChange(index, 'kod', e.target.value)}
                  required
                  placeholder="Ürün kodu"
                />
                {urunCache[urun.kod?.trim()] && (
                  <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, background: '#dcfce7', color: '#15803d', padding: '2px 7px', borderRadius: 10, fontWeight: 700, pointerEvents: 'none', whiteSpace: 'nowrap' }}>✓ Eşleşti</span>
                )}
              </div>
              <input
                value={urun.ad}
                onChange={e => handleUrunChange(index, 'ad', e.target.value)}
                required
                placeholder="Ürün adı"
              />
              <input
                type="number" min="1"
                value={urun.adet}
                onChange={e => handleUrunChange(index, 'adet', e.target.value)}
                required
              />
              <input
                type="number" min="0"
                value={urun.alisFiyati || ''}
                onChange={e => handleUrunChange(index, 'alisFiyati', e.target.value)}
                required
              />
              <input
                type="number" min="0"
                value={urun.bip || ''}
                onChange={e => handleUrunChange(index, 'bip', e.target.value)}
              />
              {urunler.length > 1 && (
                <button type="button" onClick={() => urunSil(index)} className="btn-remove">Sil</button>
              )}
            </div>
          ))}

          <div className="genel-toplam">
            Genel Toplam: {formatPrice(toplamTutarHesapla())}
          </div>
          <div className="maliyet-notu">
            NOT: TOPLAM MALİYET = ALIŞ TOPLAM - BİP TOPLAM = {formatPrice(toplamMaliyetHesapla())}
          </div>

          {/* Yeşil etiket eşleşmeleri otomatik göster */}
          {eslesenYesilEtiketler().length > 0 && (
            <div className="yesil-etiket-ozet">
              <div className="yesil-etiket-ozet-title">
                🟢 Yeşil Etiket İndirimleri (Otomatik Tespit)
              </div>
              {eslesenYesilEtiketler().map((e, i) => (
                <div key={i} className="yesil-etiket-ozet-row">
                  <span>{e.urunKodu} — {e.urunAdi}</span>
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>
                    −{formatPrice(e.maliyet * e.adet)} ({e.adet} adet × {formatPrice(e.maliyet)})
                  </span>
                </div>
              ))}
              <div className="yesil-etiket-ozet-toplam">
                Toplam İndirim: −{formatPrice(yesilEtiketToplamIndirimHesapla())}
              </div>
            </div>
          )}
        </section>

        {/* ===== KAMPANYALAR ===== */}
        {/* 4 — Admin panelden çekilir, kullanıcı seçer */}
        <section className="form-section">
          <h3 className="section-title">Kampanyalar</h3>
          {kampanyaListesi.length === 0 ? (
            <div className="empty-state">
              <span>Aktif kampanya bulunamadı.</span>
            </div>
          ) : (
            <div className="kampanya-secim-grid">
              {kampanyaListesi.map(k => (
                <label
                  key={k.id}
                  className={`kampanya-secim-item ${seciliKampanyaIds.includes(k.id!) ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={seciliKampanyaIds.includes(k.id!)}
                    onChange={() => kampanyaToggle(k.id!)}
                    style={{ marginRight: 8 }}
                  />
                  <div>
                    <div className="kampanya-ad">{k.ad}</div>
                    {k.aciklama && <div className="kampanya-aciklama">{k.aciklama}</div>}
                    <div className="kampanya-sube-pill">
                      {k.subeKodu === 'GENEL' ? '🌐 Genel' : `📍 ${k.subeKodu}`}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
          {seciliKampanyalar.length > 0 && (
            <div className="secili-kampanya-ozet">
              ✅ Seçili: {seciliKampanyalar.map(k => k.ad).join(', ')}
            </div>
          )}
        </section>

        {/* ===== ÖDEME BİLGİLERİ ===== */}
        {/* 6 — Tablo kaldırıldı, fonksiyonlar çalışmaya devam ediyor */}
        <section className="form-section">
          <h3 className="section-title">💳 Ödeme Bilgileri</h3>

          {/* PEŞİNAT */}
          <div className="odeme-blok">
            <div className="odeme-blok-title">💵 Peşinat (TL) — Kasaya Yansır</div>
            <input
              type="number" min="0"
              value={pesinatTutar || ''}
              onChange={e => setPesinatTutar(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
              className="odeme-input"
            />
            {pesinatTutar > 0 && (
              <div className="odeme-bilgi ok">✅ Kasaya Yansır: {formatPrice(pesinatTutar)}</div>
            )}
          </div>

          {/* HAVALE */}
          {/* 7 — Havaleye banka seçimi eklendi */}
          <div className="odeme-blok">
            <div className="odeme-blok-title">🏦 Havale (TL) — Kasaya Yansımaz</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '0 0 220px' }}>
                <label style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'block' }}>Banka</label>
                <select
                  value={havaleBanka}
                  onChange={e => setHavaleBanka(e.target.value)}
                  className="odeme-input"
                >
                  {HAVALE_BANKALARI.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'block' }}>Tutar (TL)</label>
                <input
                  type="number" min="0"
                  value={havaleTutar || ''}
                  onChange={e => setHavaleTutar(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                  className="odeme-input"
                />
              </div>
            </div>
            {havaleTutar > 0 && (
              <div className="odeme-bilgi ok">
                ✅ Hesaba Geçer: {formatPrice(havaleTutar)} ({havaleBanka})
              </div>
            )}
          </div>

          {/* KART */}
          <div className="odeme-blok">
            <div className="odeme-blok-header">
              <div className="odeme-blok-title">💳 Kart ile Ödemeler — Kesinti Sonrası Hesaba Geçer</div>
              <button type="button" onClick={kartEkle} className="btn-add-sm">+ Kart Ekle</button>
            </div>

            {kartOdemeler.map((kart, index) => {
              const netTutar = kartNetTutarHesapla(kart);
              const kesintiTutar = kart.tutar - netTutar;
              return (
                <div key={kart.id} className="kart-row">
                  <div className="kart-fields">
                    <div className="form-field">
                      <label>Banka</label>
                      <select
                        value={kart.banka}
                        onChange={e => handleKartChange(index, 'banka', e.target.value)}
                        className="odeme-input"
                      >
                        {BANKALAR.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Taksit</label>
                      <select
                        value={kart.taksitSayisi}
                        onChange={e => handleKartChange(index, 'taksitSayisi', e.target.value)}
                        className="odeme-input"
                      >
                        {TAKSIT_SECENEKLERI.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Brüt Tutar (TL)</label>
                      <input
                        type="number" min="0"
                        value={kart.tutar || ''}
                        onChange={e => handleKartChange(index, 'tutar', e.target.value)}
                        className="odeme-input"
                      />
                    </div>
                    <div className="form-field">
                      <label>Kesinti Oranı (%)</label>
                      <input
                        type="number" min="0" max="100" step="0.01"
                        value={kart.kesintiOrani || ''}
                        onChange={e => handleKartChange(index, 'kesintiOrani', e.target.value)}
                        className="odeme-input"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => kartSil(index)}
                      className="btn-remove"
                      style={{ alignSelf: 'flex-end' }}
                    >
                      Sil
                    </button>
                  </div>
                  {kart.tutar > 0 && (
                    <div className="kart-net-ozet">
                      Brüt: {formatPrice(kart.tutar)} &nbsp;|&nbsp;
                      Kesinti: −{formatPrice(kesintiTutar)} &nbsp;|&nbsp;
                      <strong>NET (Hesaba Geçer): {formatPrice(netTutar)}</strong>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ÖDEME ÖZETİ */}
          <div className="odeme-ozet-grid">
            <div className="odeme-ozet-kart">
              <div className="odeme-ozet-label">💵 Kasaya Yansıyan</div>
              <div className="odeme-ozet-deger">{formatPrice(kasayaYansiranHesapla())}</div>
              <div className="odeme-ozet-aciklama">Sadece peşin</div>
            </div>
            <div className="odeme-ozet-kart">
              <div className="odeme-ozet-label">🏦 Hesaba Geçen Toplam</div>
              <div className="odeme-ozet-deger">{formatPrice(hesabaGecenToplamHesapla())}</div>
              <div className="odeme-ozet-aciklama">Peşin + Havale + Kart NET</div>
            </div>
            {kartOdemeler.length > 0 && (
              <div className="odeme-ozet-kart">
                <div className="odeme-ozet-label">✂️ Toplam Kart Kesintisi</div>
                <div className="odeme-ozet-deger" style={{ color: '#dc2626' }}>
                  −{formatPrice(kartKesintiToplamHesapla())}
                </div>
                <div className="odeme-ozet-aciklama">
                  Brüt: {formatPrice(kartBrutToplamHesapla())} → NET: {formatPrice(kartBrutToplamHesapla() - kartKesintiToplamHesapla())}
                </div>
              </div>
            )}
            <div
              className="odeme-ozet-kart"
              style={{ background: acikHesapHesapla() > 0 ? '#fff7ed' : '#f0fdf4' }}
            >
              <div className="odeme-ozet-label">🔓 Açık Hesap</div>
              <div
                className="odeme-ozet-deger"
                style={{ color: acikHesapHesapla() > 0 ? '#ea580c' : '#15803d' }}
              >
                {acikHesapHesapla() > 0 ? formatPrice(acikHesapHesapla()) : '✅ Ödendi'}
              </div>
              <div className="odeme-ozet-aciklama">Satış Tutarı - Hesaba Geçen</div>
            </div>
          </div>

          <div
            className="kar-zararbar"
            style={{ background: karZararHesapla() >= 0 ? '#dcfce7' : '#fee2e2', color: karZararHesapla() >= 0 ? '#15803d' : '#dc2626' }}
          >
            {karZararHesapla() >= 0
              ? `📈 KÂR: ${formatPrice(karZararHesapla())}`
              : `📉 ZARAR: ${formatPrice(Math.abs(karZararHesapla()))}`
            }
            &nbsp;(Hesaba Geçen: {formatPrice(hesabaGecenToplamHesapla())} — Maliyet: {formatPrice(toplamMaliyetHesapla())})
          </div>
        </section>

        {/* ===== ONAY ===== */}
        {/* 8 — Sadece admin görür */}
        {isAdmin && (
          <section className="form-section">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={onayDurumu}
                onChange={e => setOnayDurumu(e.target.checked)}
              />
              Onaylıyorum
            </label>
          </section>
        )}

        {/* ===== BUTONLAR ===== */}
        <div className="form-actions">
          <button type="button" onClick={() => navigate('/dashboard')} className="btn-cancel">İptal</button>
          <button type="submit" className="btn-submit" disabled={loading}>
            {loading ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>

      </form>
    </div>
  );
};

export default SatisTeklifPage;