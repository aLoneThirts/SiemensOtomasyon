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
import './SatisTeklif.css';

const HAVALE_BANKALARI = [
  'Ziraat Bankası', 'Halkbank', 'Vakıfbank', 'İş Bankası', 'Garanti BBVA',
  'Yapı Kredi', 'Akbank', 'QNB Finansbank', 'Denizbank', 'TEB',
  'ING Bank', 'HSBC', 'Şekerbank', 'Fibabanka', 'Alternatifbank',
];

interface YesilEtiketAdmin {
  id?: string;
  urunKodu: string;
  urunTuru?: string;
  maliyet: number;
}

interface KampanyaAdmin {
  id?: string;
  ad: string;
  aciklama: string;
  aktif: boolean;
  subeKodu: string;
  tutar?: number;
}

const SatisTeklifPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

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

  const [kampanyaListesi, setKampanyaListesi] = useState<KampanyaAdmin[]>([]);
  const [seciliKampanyaIds, setSeciliKampanyaIds] = useState<string[]>([]);

  const [yesilEtiketAdminList, setYesilEtiketAdminList] = useState<YesilEtiketAdmin[]>([]);

  // ========== ÖDEME STATE - ÇOKLU DESTEK ==========
  // Çoklu peşinat
  const [pesinatlar, setPesinatlar] = useState<{ id: string; tutar: number; aciklama: string }[]>([]);
  // Çoklu havale
  const [havaleler, setHavaleler] = useState<{ id: string; tutar: number; banka: string }[]>([]);
  // Kartlar (banka + taksit → kesinti otomatik)
  const [kartOdemeler, setKartOdemeler] = useState<KartOdeme[]>([]);
  // Kart kesinti cache: { "BankaAdı": { tek: x, t2: y, ... } }
  const [kesintiCache, setKesintiCache] = useState<Record<string, Record<string, number>>>({});

  const kesintiCacheYukle = async () => {
    try {
      const snap = await getDocs(collection(db, 'bankaKesintiler'));
      const cache: Record<string, Record<string, number>> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        cache[d.id] = {
          tek: data.tek || 0,
          t2: data.t2 || 0, t3: data.t3 || 0, t4: data.t4 || 0,
          t5: data.t5 || 0, t6: data.t6 || 0, t7: data.t7 || 0,
          t8: data.t8 || 0, t9: data.t9 || 0,
        };
      });
      setKesintiCache(cache);
    } catch (err) { console.error('Kesinti cache yüklenemedi:', err); }
  };

  const getKesintiOrani = (banka: string, taksit: number): number => {
    const bankaData = kesintiCache[banka];
    if (!bankaData) return 0;
    const key = taksit === 1 ? 'tek' : `t${taksit}`;
    return bankaData[key] || 0;
  };

  const odemeYontemi = OdemeYontemi.PESINAT; // artık kullanılmıyor ama tip uyumu için
  const [hesabaGecen, setHesabaGecen] = useState('');
  const [onayDurumu, setOnayDurumu] = useState(false);
  const [loading, setLoading] = useState(false);

  const [satisKodu, setSatisKodu] = useState('');

  // FIX 3: Satış tutarı artık editable - manuel override için
  const [manuelSatisTutari, setManuelSatisTutari] = useState<number | null>(null);
  const [satisTutariDuzenle, setSatisTutariDuzenle] = useState(false);

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

  /* ── HESAPLAMA FONKSİYONLARI ── */
  const alisToplamHesapla = (): number =>
    urunler.reduce((t, u) => t + u.adet * u.alisFiyati, 0);

  const bipToplamHesapla = (): number =>
    urunler.reduce((t, u) => t + (u.bip || 0) * u.adet, 0);

  // Satış tutarı = kullanıcının girdiği değer (hiç otomatik hesaplanmaz)
  const toplamTutarHesapla = (): number => manuelSatisTutari ?? 0;

  // Kampanya tutarı toplamı
  const kampanyaToplamiHesapla = (): number => {
    const seciliKampanyalar = kampanyaListesi.filter(k => seciliKampanyaIds.includes(k.id!));
    return seciliKampanyalar.reduce((t, k) => t + (k.tutar || 0), 0);
  };

  // Maliyet = Alış − BİP − Kampanya
  const toplamMaliyetHesapla = (): number => {
    return Math.max(0, alisToplamHesapla() - bipToplamHesapla() - kampanyaToplamiHesapla());
  };

  // Kart net hesabı (kesinti düşülmüş)
  const kartNetTutarHesapla = (kart: KartOdeme): number => {
    const oran = kart.kesintiOrani || 0;
    return kart.tutar - (kart.tutar * oran) / 100;
  };

  // Peşinat toplamı
  const pesinatToplamHesapla = (): number =>
    pesinatlar.reduce((t, p) => t + (p.tutar || 0), 0);

  // Havale toplamı
  const havaleToplamHesapla = (): number =>
    havaleler.reduce((t, h) => t + (h.tutar || 0), 0);

  // Kart BRÜT toplamı (ödeme durumu için)
  const kartBrutToplamHesapla = (): number =>
    kartOdemeler.reduce((t, k) => t + (k.tutar || 0), 0);

  const kartKesintiToplamHesapla = (): number =>
    kartOdemeler.reduce((t, k) => t + (k.tutar * (k.kesintiOrani || 0)) / 100, 0);

  const kartNetToplamHesapla = (): number =>
    kartOdemeler.reduce((t, k) => t + kartNetTutarHesapla(k), 0);

  // TOPLAM ÖDENEN = Peşinat + Havale + Kart BRÜT (kullanıcı bakış açısından)
  const toplamOdenenHesapla = (): number =>
    pesinatToplamHesapla() + havaleToplamHesapla() + kartBrutToplamHesapla();

  // HESABA GEÇEN = Peşinat + Havale + Kart NET (gerçek gelir)
  const hesabaGecenToplamHesapla = (): number =>
    pesinatToplamHesapla() + havaleToplamHesapla() + kartNetToplamHesapla();

  // Ödeme durumu: Toplam Ödenen (BRÜT) = Satış Tutarı → ÖDENDİ
  const getOdemeDurumu = (): OdemeDurumu => {
    const odenen = toplamOdenenHesapla();
    return odenen >= toplamTutarHesapla() && toplamTutarHesapla() > 0
      ? OdemeDurumu.ODENDI
      : OdemeDurumu.ACIK_HESAP;
  };

  const acikHesapHesapla = (): number => {
    const acik = toplamTutarHesapla() - toplamOdenenHesapla();
    return acik > 0 ? acik : 0;
  };

  const karZararHesapla = (): number =>
    hesabaGecenToplamHesapla() - toplamMaliyetHesapla();

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

  /* ── MARS NO ── */
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

  const handleFaturaNoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFaturaNo(value);
    setFaturaNoHata(false);
    setFatura(value.trim() !== '');
  };

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

  const handleServisNotuChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setServisNotu(value);
    setServis(value.trim() !== '');
  };

  const handleMusteriChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setMusteriBilgileri(prev => ({ ...prev, [name]: value }));
  };

  /* ── ÜRÜN CACHE ── */
  const [urunCache, setUrunCache] = useState<Record<string, { ad: string; alis: number; bip: number; urunTuru: string }>>({});
  // Dropdown arama için: hangi index'in dropdown'u açık ve sonuçlar
  const [urunAramaDropdown, setUrunAramaDropdown] = useState<{ index: number; sonuclar: string[] } | null>(null);

  const urunCacheYukle = async () => {
    try {
      // Global collection'dan çek - şubeye bağlı değil
      const snap = await getDocs(collection(db, 'urunler'));
      const cache: Record<string, { ad: string; alis: number; bip: number; urunTuru: string }> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.kod) cache[data.kod.trim()] = {
          ad: data.ad || data.urunAdi || '',
          alis: parseFloat(data.alis || data.alisFiyati || 0),
          bip: parseFloat(data.bip || 0),
          urunTuru: data.urunTuru || '',
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
    if (field === 'kod') {
      const trimmed = String(value).trim().toUpperCase();
      // Tam eşleşme - otomatik doldur
      const eslesme = urunCache[trimmed];
      if (eslesme) {
        yeniUrunler[index] = {
          ...yeniUrunler[index],
          kod: trimmed,
          ad: eslesme.urunTuru || eslesme.ad || yeniUrunler[index].ad,
          alisFiyati: eslesme.alis,
          bip: eslesme.bip,
        };
        setUrunAramaDropdown(null);
      } else if (trimmed.length >= 2) {
        // Kısmi eşleşme - dropdown listele
        const eslesenler = Object.keys(urunCache)
          .filter(k => k.toUpperCase().includes(trimmed))
          .slice(0, 10);
        setUrunAramaDropdown(eslesenler.length > 0 ? { index, sonuclar: eslesenler } : null);
      } else {
        setUrunAramaDropdown(null);
      }
    }
    setUrunler(yeniUrunler);
    if (field === 'alisFiyati' || field === 'adet') {
      setManuelSatisTutari(null);
    }
  };

  const urunSecDropdown = (index: number, kod: string) => {
    const eslesme = urunCache[kod];
    if (!eslesme) return;
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = {
      ...yeniUrunler[index],
      kod,
      ad: eslesme.urunTuru || eslesme.ad || '',
      alisFiyati: eslesme.alis,
      bip: eslesme.bip,
    };
    setUrunler(yeniUrunler);
    setUrunAramaDropdown(null);
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

  /* ── KART ── */
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
    const yeniKart = {
      ...yeniKartlar[index],
      [field]: field === 'tutar'
        ? (value === '' ? 0 : parseFloat(value) || 0)
        : field === 'taksitSayisi'
          ? parseInt(value) || 1
          : value
    };
    // Banka veya taksit değişince kesinti otomatik güncelle
    if (field === 'banka' || field === 'taksitSayisi') {
      const banka = field === 'banka' ? value : yeniKartlar[index].banka;
      const taksit = field === 'taksitSayisi' ? (parseInt(value) || 1) : yeniKartlar[index].taksitSayisi;
      yeniKart.kesintiOrani = getKesintiOrani(banka, taksit);
    }
    yeniKartlar[index] = yeniKart;
    setKartOdemeler(yeniKartlar);
  };

  /* ── PEŞİNAT (çoklu) ── */
  const pesinatEkle = () => {
    setPesinatlar(prev => [...prev, { id: Date.now().toString(), tutar: 0, aciklama: '' }]);
  };
  const pesinatSil = (id: string) => setPesinatlar(prev => prev.filter(p => p.id !== id));
  const handlePesinatChange = (id: string, field: 'tutar' | 'aciklama', value: any) => {
    setPesinatlar(prev => prev.map(p => p.id === id
      ? { ...p, [field]: field === 'tutar' ? (parseFloat(value) || 0) : value }
      : p
    ));
  };

  /* ── HAVALE (çoklu) ── */
  const havaleEkle = () => {
    setHavaleler(prev => [...prev, { id: Date.now().toString(), tutar: 0, banka: HAVALE_BANKALARI[0] }]);
  };
  const havaleSil = (id: string) => setHavaleler(prev => prev.filter(h => h.id !== id));
  const handleHavaleChange = (id: string, field: 'tutar' | 'banka', value: any) => {
    setHavaleler(prev => prev.map(h => h.id === id
      ? { ...h, [field]: field === 'tutar' ? (parseFloat(value) || 0) : value }
      : h
    ));
  };

  /* ── KAMPANYA ── */
  const kampanyaToggle = (id: string) => {
    setSeciliKampanyaIds(prev =>
      prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]
    );
  };

  const seciliKampanyalar = kampanyaListesi.filter(k => seciliKampanyaIds.includes(k.id!));

  /* ── FIREBASE: Kampanya & Yeşil Etiket çek ── */
  const kampanyalariCek = async () => {
    try {
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
      // Global collection'dan çek - şubeye bağlı değil
      const snap = await getDocs(collection(db, 'yesilEtiketler'));
      const liste = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          urunKodu: data.urunKodu || '',
          urunTuru: data.urunTuru || '',
          maliyet: parseFloat(data.maliyet || 0),
        } as YesilEtiketAdmin;
      });
      setYesilEtiketAdminList(liste.filter(e => e.urunKodu && e.maliyet > 0));
    } catch (err) {
      console.error('Yeşil etiketler çekilemedi:', err);
    }
  };

  /* ── LOG ── */
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
    kesintiCacheYukle();
  }, [currentUser]);

  /* ── SUBMIT ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!faturaNo.trim()) {
      setFaturaNoHata(true);
      alert('❌ Fatura numarası zorunludur!');
      return;
    }

    if (!manuelSatisTutari || manuelSatisTutari <= 0) {
      alert('❌ Satış tutarı girilmelidir!');
      return;
    }

    if (isMarsNoGerekli() && marsNo && !isMarsNoGecerli()) {
      setMarsNoHata(true);
      alert('❌ MARS No 2026 ile başlayan 10 haneli olmalıdır!');
      return;
    }

    setLoading(true);
    try {
      const sube = getSubeByKod(currentUser!.subeKodu);
      if (!sube) { alert('Şube bilgisi bulunamadı!'); return; }

      const kampanyaToplami = kampanyaToplamiHesapla();
      const etiketler = eslesenYesilEtiketler();

      const satisTeklifi: any = {
        satisKodu,
        subeKodu: currentUser!.subeKodu,
        musteriBilgileri,
        musteriTemsilcisi,
        musteriTemsilcisiTel,
        urunler,
        toplamTutar: manuelSatisTutari,
        kampanyaToplami,
        tarih: new Date(tarih),
        teslimatTarihi: new Date(teslimatTarihi),
        marsNo,
        magaza,
        faturaNo,
        servisNotu,
        teslimEdildiMi,
        cevap,
        kampanyalar: kampanyaListesi
          .filter(k => seciliKampanyaIds.includes(k.id!))
          .map(k => ({ id: k.id!, ad: k.ad, tutar: k.tutar || 0 })),
        yesilEtiketler: etiketler.map(e => ({
          id: Date.now().toString(),
          urunKodu: e.urunKodu,
          ad: e.urunAdi,
          alisFiyati: e.maliyet,
          tutar: e.maliyet * e.adet
        })),
        // Çoklu ödeme
        pesinatlar,
        havaleler,
        kartOdemeler,
        // Toplamlar
        pesinatToplam: pesinatToplamHesapla(),
        havaleToplam: havaleToplamHesapla(),
        kartBrutToplam: kartBrutToplamHesapla(),
        kartKesintiToplam: kartKesintiToplamHesapla(),
        kartNetToplam: kartNetToplamHesapla(),
        toplamOdenen: toplamOdenenHesapla(),
        hesabaGecenToplam: hesabaGecenToplamHesapla(),
        acikHesap: acikHesapHesapla(),
        odemeDurumu: getOdemeDurumu(),
        // Legacy uyumluluk
        pesinatTutar: pesinatToplamHesapla(),
        havaleTutar: havaleToplamHesapla(),
        fatura,
        ileriTeslim,
        servis,
        odemeYontemi: OdemeYontemi.PESINAT,
        onayDurumu,
        zarar: karZararHesapla(),
        olusturanKullanici: `${currentUser!.ad} ${currentUser!.soyad}`,
        olusturmaTarihi: new Date(),
        guncellemeTarihi: new Date()
      };

      await addDoc(collection(db, `subeler/${sube.dbPath}/satislar`), satisTeklifi);

      if (!onayDurumu) {
        for (const urun of urunler) {
          await addDoc(collection(db, `subeler/${sube.dbPath}/bekleyenUrunler`), {
            satisKodu, subeKodu: currentUser!.subeKodu,
            urunKodu: urun.kod, urunAdi: urun.ad, adet: urun.adet,
            musteriIsmi: musteriBilgileri.isim,
            siparisTarihi: new Date(),
            beklenenTeslimTarihi: teslimatTarihi ? new Date(teslimatTarihi) : new Date(),
            durum: 'BEKLEMEDE', notlar: servisNotu || '',
            guncellemeTarihi: new Date()
          });
        }
      }

      await logKaydet(satisKodu, 'YENİ_SATIS',
        `Yeni satış. Müşteri: ${musteriBilgileri.isim}, Tutar: ${manuelSatisTutari} TL, Hesaba Geçen: ${hesabaGecenToplamHesapla()} TL`);

      alert('✅ Satış teklifi başarıyla oluşturuldu!');
      navigate('/dashboard');
    } catch (error) {
      console.error(error);
      alert('❌ Bir hata oluştu!');
    } finally {
      setLoading(false);
    }
  };

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
            {/* Satış Tutarı - kullanıcı girer */}
            <div className="form-field">
              <label>Satış Tutarı *</label>
              <input
                type="number"
                min="0"
                value={manuelSatisTutari ?? ''}
                onChange={e => setManuelSatisTutari(e.target.value === '' ? null : parseFloat(e.target.value) || 0)}
                placeholder="Satış tutarını girin"
                style={{ fontWeight: 700, color: '#1d4ed8', borderColor: '#93c5fd' }}
                required
              />
              {manuelSatisTutari !== null && alisToplamHesapla() > 0 && (
                <small style={{ color: '#6b7280' }}>
                  Alış toplamı: {formatPrice(alisToplamHesapla())}
                </small>
              )}
            </div>
          </div>
        </section>

        {/* ===== NOTLAR VE ZORUNLU ALANLAR ===== */}
        <section className="form-section">
          <h3 className="section-title">Notlar ve Zorunlu Alanlar</h3>
          <div className="form-grid-4">
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
                <button type="button" onClick={fixMarsNo} className="btn-fix">✏️ Düzelt</button>
              </div>
              {marsNo && (
                <small style={{ color: isMarsNoGecerli() ? '#16a34a' : '#d97706' }}>
                  {isMarsNoGecerli()
                    ? '✅ Geçerli format'
                    : `⚠️ ${marsNo.length}/10 hane${!marsNo.startsWith('2026') ? ' · 2026 ile başlamalı' : ''}`
                  }
                </small>
              )}
              {marsNoHata && <small style={{ color: '#ef4444' }}>❌ Eksik hane var!</small>}
            </div>
            <div className="form-field">
              <label>Mağaza</label>
              <input value={magaza} onChange={e => setMagaza(e.target.value)} placeholder="Mağaza adı" />
            </div>
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
            <div className="form-field">
              <label>Servis Notu</label>
              <input value={servisNotu} onChange={handleServisNotuChange} placeholder="Not girilirse Servis Gerekli işaretlenir" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={teslimEdildiMi}
                onChange={e => { setTeslimEdildiMi(e.target.checked); if (e.target.checked) setMarsNoHata(false); }}
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
                  onBlur={() => setTimeout(() => setUrunAramaDropdown(null), 200)}
                  required
                  placeholder="Ürün kodu"
                  autoComplete="off"
                />
                {urunCache[urun.kod?.trim().toUpperCase()] && (
                  <span style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 10, background: '#dcfce7', color: '#15803d', padding: '2px 7px',
                    borderRadius: 10, fontWeight: 700, pointerEvents: 'none', whiteSpace: 'nowrap'
                  }}>✓ Eşleşti</span>
                )}
                {/* DROPDOWN: Arama sonuçları */}
                {urunAramaDropdown?.index === index && urunAramaDropdown.sonuclar.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
                    background: '#fff', border: '1px solid #d1fae5', borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto'
                  }}>
                    {urunAramaDropdown.sonuclar.map(kod => {
                      const info = urunCache[kod];
                      return (
                        <div
                          key={kod}
                          onMouseDown={() => urunSecDropdown(index, kod)}
                          style={{
                            padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f0fdf4',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            fontSize: 13
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
                          onMouseLeave={e => (e.currentTarget.style.background = '')}
                        >
                          <div>
                            <span style={{ fontWeight: 700, color: '#065f46' }}>{kod}</span>
                            {info?.urunTuru && (
                              <span style={{ marginLeft: 8, color: '#6b7280', fontSize: 11 }}>{info.urunTuru}</span>
                            )}
                          </div>
                          <span style={{ color: '#15803d', fontWeight: 600, fontSize: 12 }}>
                            ₺{info?.alis?.toLocaleString('tr-TR') || 0}
                          </span>
                        </div>
                      );
                    })}
                  </div>
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
            {manuelSatisTutari !== null
              ? `Satış Tutarı: ${formatPrice(manuelSatisTutari)}`
              : 'Satış Tutarı: Satış Bilgileri bölümünden girin'}
          </div>

          {/* Maliyet hesaplama - kampanya düşülmüş gösterim */}
          <div className="maliyet-notu">
            <div>Alış Toplam: {formatPrice(alisToplamHesapla())} | BİP Toplam: {formatPrice(bipToplamHesapla())}</div>
            {kampanyaToplamiHesapla() > 0 && (
              <div style={{ color: '#15803d' }}>
                Kampanya İndirimi: −{formatPrice(kampanyaToplamiHesapla())}
              </div>
            )}
            <div style={{ fontWeight: 700 }}>
              TOPLAM MALİYET = {formatPrice(toplamMaliyetHesapla())}
              {kampanyaToplamiHesapla() > 0 && (
                <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
                  ({formatPrice(alisToplamHesapla() - bipToplamHesapla())} − {formatPrice(kampanyaToplamiHesapla())} kampanya)
                </span>
              )}
            </div>
          </div>

          {/* Yeşil etiket - özel fiyat gösterimi */}
          {eslesenYesilEtiketler().length > 0 && (
            <div className="yesil-etiket-ozet">
              <div className="yesil-etiket-ozet-title">
                🟢 Yeşil Etiket Özel Fiyatları (Otomatik Tespit)
              </div>
              {eslesenYesilEtiketler().map((e, i) => (
                <div key={i} className="yesil-etiket-ozet-row">
                  <span>{e.urunKodu}{e.urunAdi ? ` — ${e.urunAdi}` : ''}</span>
                  <span style={{ color: '#15803d', fontWeight: 600 }}>
                    Özel Fiyat: {formatPrice(e.maliyet)} × {e.adet} adet = {formatPrice(e.maliyet * e.adet)}
                  </span>
                </div>
              ))}
              <div className="yesil-etiket-ozet-toplam">
                Toplam Yeşil Etiket Tutarı: {formatPrice(yesilEtiketToplamIndirimHesapla())}
              </div>
            </div>
          )}
        </section>

        {/* ===== KAMPANYALAR ===== */}
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
                    {(k.tutar || 0) > 0 && (
                      <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>
                        İndirim: {formatPrice(k.tutar || 0)}
                      </div>
                    )}
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
              {kampanyaToplamiHesapla() > 0 && (
                <span style={{ marginLeft: 12, color: '#15803d', fontWeight: 700 }}>
                  | Toplam İndirim: −{formatPrice(kampanyaToplamiHesapla())}
                </span>
              )}
            </div>
          )}
        </section>

        {/* ===== ÖDEME BİLGİLERİ ===== */}
        <section className="form-section">
          <h3 className="section-title">💳 Ödeme Bilgileri</h3>

          {/* PEŞİNAT (çoklu) */}
          <div className="odeme-blok">
            <div className="odeme-blok-header">
              <div className="odeme-blok-title">💵 Peşinat — Kasaya Yansır</div>
              <button type="button" onClick={pesinatEkle} className="btn-add-sm">+ Peşinat Ekle</button>
            </div>
            {pesinatlar.map(p => (
              <div key={p.id} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                <input
                  type="number" min="0" placeholder="Tutar (TL)"
                  value={p.tutar || ''}
                  onChange={e => handlePesinatChange(p.id, 'tutar', e.target.value)}
                  className="odeme-input" style={{ flex: 1 }}
                />
                <input
                  type="text" placeholder="Açıklama (opsiyonel)"
                  value={p.aciklama}
                  onChange={e => handlePesinatChange(p.id, 'aciklama', e.target.value)}
                  className="odeme-input" style={{ flex: 2 }}
                />
                <button type="button" onClick={() => pesinatSil(p.id)} className="btn-remove">Sil</button>
              </div>
            ))}
            {pesinatlar.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Peşinat eklenmedi</div>}
            {pesinatToplamHesapla() > 0 && (
              <div className="odeme-bilgi ok">✅ Peşinat Toplamı: {formatPrice(pesinatToplamHesapla())}</div>
            )}
          </div>

          {/* HAVALE (çoklu) */}
          <div className="odeme-blok">
            <div className="odeme-blok-header">
              <div className="odeme-blok-title">🏦 Havale — Kasaya Yansımaz</div>
              <button type="button" onClick={havaleEkle} className="btn-add-sm">+ Havale Ekle</button>
            </div>
            {havaleler.map(h => (
              <div key={h.id} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                <select
                  value={h.banka}
                  onChange={e => handleHavaleChange(h.id, 'banka', e.target.value)}
                  className="odeme-input" style={{ flex: 2 }}
                >
                  {HAVALE_BANKALARI.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <input
                  type="number" min="0" placeholder="Tutar (TL)"
                  value={h.tutar || ''}
                  onChange={e => handleHavaleChange(h.id, 'tutar', e.target.value)}
                  className="odeme-input" style={{ flex: 1 }}
                />
                <button type="button" onClick={() => havaleSil(h.id)} className="btn-remove">Sil</button>
              </div>
            ))}
            {havaleler.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Havale eklenmedi</div>}
            {havaleToplamHesapla() > 0 && (
              <div className="odeme-bilgi ok">✅ Havale Toplamı: {formatPrice(havaleToplamHesapla())}</div>
            )}
          </div>

          {/* KART */}
          <div className="odeme-blok">
            <div className="odeme-blok-header">
              <div className="odeme-blok-title">💳 Kart ile Ödemeler</div>
              <button type="button" onClick={kartEkle} className="btn-add-sm">+ Kart Ekle</button>
            </div>
            {kartOdemeler.map((kart, index) => {
              const kesintiOrani = kart.kesintiOrani || 0;
              const kesintiTutar = (kart.tutar * kesintiOrani) / 100;
              const netTutar = kart.tutar - kesintiTutar;
              return (
                <div key={kart.id} className="kart-row">
                  <div className="kart-fields">
                    <div className="form-field">
                      <label>Banka</label>
                      <select value={kart.banka} onChange={e => handleKartChange(index, 'banka', e.target.value)} className="odeme-input">
                        {BANKALAR.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Taksit</label>
                      <select value={kart.taksitSayisi} onChange={e => handleKartChange(index, 'taksitSayisi', e.target.value)} className="odeme-input">
                        {TAKSIT_SECENEKLERI.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Brüt Tutar (TL)</label>
                      <input type="number" min="0" value={kart.tutar || ''} onChange={e => handleKartChange(index, 'tutar', e.target.value)} className="odeme-input" />
                    </div>
                    <div className="form-field">
                      <label>Kesinti Oranı (%)</label>
                      <input
                        type="text"
                        value={kesintiOrani > 0 ? `%${kesintiOrani}` : 'Oran bulunamadı'}
                        readOnly
                        className="odeme-input"
                        style={{ background: kesintiOrani > 0 ? '#f0fdf4' : '#fff7ed', color: kesintiOrani > 0 ? '#15803d' : '#92400e', fontWeight: 600 }}
                      />
                    </div>
                    <button type="button" onClick={() => kartSil(index)} className="btn-remove" style={{ alignSelf: 'flex-end' }}>Sil</button>
                  </div>
                  {kart.tutar > 0 && (
                    <div className="kart-net-ozet">
                      Brüt: {formatPrice(kart.tutar)} | Kesinti: −{formatPrice(kesintiTutar)} ({kesintiOrani}%) | <strong>NET: {formatPrice(netTutar)}</strong>
                    </div>
                  )}
                </div>
              );
            })}
            {kartOdemeler.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Kart eklenmedi</div>}
          </div>

          {/* ÖDEME ÖZETİ */}
          <div className="odeme-ozet-grid">
            <div className="odeme-ozet-kart">
              <div className="odeme-ozet-label">💵 Peşinat</div>
              <div className="odeme-ozet-deger">{formatPrice(pesinatToplamHesapla())}</div>
              <div className="odeme-ozet-aciklama">Kasaya yansır</div>
            </div>
            <div className="odeme-ozet-kart">
              <div className="odeme-ozet-label">🏦 Havale</div>
              <div className="odeme-ozet-deger">{formatPrice(havaleToplamHesapla())}</div>
              <div className="odeme-ozet-aciklama">Hesaba geçer</div>
            </div>
            {kartOdemeler.length > 0 && (
              <div className="odeme-ozet-kart">
                <div className="odeme-ozet-label">💳 Kart Brüt</div>
                <div className="odeme-ozet-deger">{formatPrice(kartBrutToplamHesapla())}</div>
                <div className="odeme-ozet-aciklama">
                  Kesinti: −{formatPrice(kartKesintiToplamHesapla())} | NET: {formatPrice(kartNetToplamHesapla())}
                </div>
              </div>
            )}
            <div className="odeme-ozet-kart">
              <div className="odeme-ozet-label">📊 Toplam Ödenen</div>
              <div className="odeme-ozet-deger">{formatPrice(toplamOdenenHesapla())}</div>
              <div className="odeme-ozet-aciklama">Peşinat + Havale + Kart Brüt</div>
            </div>
            <div className="odeme-ozet-kart">
              <div className="odeme-ozet-label">💰 Hesaba Geçen</div>
              <div className="odeme-ozet-deger">{formatPrice(hesabaGecenToplamHesapla())}</div>
              <div className="odeme-ozet-aciklama">Peşinat + Havale + Kart NET</div>
            </div>
            <div className="odeme-ozet-kart" style={{ background: acikHesapHesapla() > 0 ? '#fff7ed' : '#f0fdf4' }}>
              <div className="odeme-ozet-label">🔓 Açık Hesap</div>
              <div className="odeme-ozet-deger" style={{ color: acikHesapHesapla() > 0 ? '#ea580c' : '#15803d' }}>
                {acikHesapHesapla() > 0 ? formatPrice(acikHesapHesapla()) : '✅ Ödendi'}
              </div>
              <div className="odeme-ozet-aciklama">
                {acikHesapHesapla() > 0
                  ? `Satış: ${formatPrice(toplamTutarHesapla())} − Ödenen: ${formatPrice(toplamOdenenHesapla())}`
                  : 'Tamamı tahsil edildi'
                }
              </div>
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
            <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 12 }}>
              (Hesaba Geçen: {formatPrice(hesabaGecenToplamHesapla())} — Maliyet: {formatPrice(toplamMaliyetHesapla())})
            </span>
          </div>
        </section>

        {/* ===== ONAY ===== */}
        {isAdmin && (
          <section className="form-section">
            <label className="checkbox-label">
              <input type="checkbox" checked={onayDurumu} onChange={e => setOnayDurumu(e.target.checked)} />
              Onaylıyorum
            </label>
          </section>
        )}

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