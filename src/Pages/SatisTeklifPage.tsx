import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  collection, addDoc, query, orderBy, limit, getDocs, runTransaction
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  SatisTeklifFormu, MusteriBilgileri, Urun, KartOdeme, Kampanya,
  YesilEtiket, OdemeYontemi, SatisLog, BANKALAR, TAKSIT_SECENEKLERI,
  OdemeDurumu, BekleyenUrun,
} from '../types/satis';
import { getSubeByKod, SUBELER, MAGAZA_SUBELER, ONLINE_SUBELER, TICARI_SUBELER, SubeKodu } from '../types/sube';
import './SatisTeklif.css';
import { kasaTahsilatEkle } from '../services/kasaService';

interface Kullanici { id: string; ad: string; soyad: string; email: string; role: string; subeKodu: string; displayName?: string; }
const HAVALE_BANKALARI = ['Ziraat Bankası', 'Halkbank', 'Vakıfbank', 'İş Bankası', 'Garanti BBVA', 'Yapı Kredi', 'Akbank', 'QNB Finansbank', 'Denizbank', 'TEB', 'ING Bank', 'HSBC', 'Şekerbank', 'Fibabanka', 'Alternatifbank'];
interface YesilEtiketAdmin { id?: string; urunKodu: string; urunTuru?: string; maliyet: number; }
interface KampanyaAdmin { id?: string; ad: string; aciklama: string; aktif: boolean; subeKodu: string; tutar?: number; }

const STORAGE_KEY = 'satisTeklif_draft';

const bugunStr = (): string => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; };

const FATURA_NO_REGEX = /^(\d{1,4}|Kesilmedi)$/;
const normalizeFaturaNo = (val: string): string => { if (val.toLowerCase() === 'kesilmedi') return 'Kesilmedi'; return val; };
const isFaturaNoGecerli = (val: string): boolean => FATURA_NO_REGEX.test(val);

const MARS_NO_REGEX = /^\d{10}$/;
const isMarsNoGecerli = (val: string): boolean => !val || MARS_NO_REGEX.test(val);

const saveDraft = (data: any) => {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
};
const clearDraft = () => {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
};

const getInitial = <T,>(key: string, fallback: T): T => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const draft = JSON.parse(raw);
    return (draft[key] !== undefined && draft[key] !== null) ? draft[key] : fallback;
  } catch { return fallback; }
};

const SatisTeklifPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const isAdmin = currentUser?.role?.toString().trim().toUpperCase().includes('ADMIN') ?? false;

  const [kullanicilar, setKullanicilar] = useState<Kullanici[]>([]);

  const [adminSeciliSube, setAdminSeciliSube] = useState<string>(() =>
    getInitial('adminSeciliSube', isAdmin ? (currentUser?.subeKodu || SUBELER[0]?.kod || '') : '')
  );

  const [musteriBilgileri, setMusteriBilgileri] = useState<MusteriBilgileri>(() =>
    getInitial('musteriBilgileri', { isim: '', adres: '', faturaAdresi: '', isAdresi: '', vergiNumarasi: '', vkNo: '', vd: '', cep: '', unvan: '' })
  );
  const [musteriTemsilcisiId, setMusteriTemsilcisiId] = useState<string>(() => getInitial('musteriTemsilcisiId', ''));
  const [musteriTemsilcisiTel, setMusteriTemsilcisiTel] = useState<string>(() => getInitial('musteriTemsilcisiTel', ''));
  const [urunler, setUrunler] = useState<Urun[]>(() =>
    getInitial('urunler', [{ id: '1', kod: '', ad: '', adet: 1, alisFiyati: 0, bip: 0 }])
  );
  const [tarih, setTarih] = useState<string>(() => getInitial('tarih', new Date().toISOString().split('T')[0]));
  const [teslimatTarihi, setTeslimatTarihi] = useState<string>(() => getInitial('teslimatTarihi', ''));
  const [marsNo, setMarsNo] = useState<string>(() => getInitial('marsNo', ''));
  const [marsNoHata, setMarsNoHata] = useState(false);
  const [magaza, setMagaza] = useState<string>(() => getInitial('magaza', ''));
  const [faturaNo, setFaturaNo] = useState<string>(() => getInitial('faturaNo', ''));
  const [faturaNoHata, setFaturaNoHata] = useState(false);
  const [faturaNoHataMesaj, setFaturaNoHataMesaj] = useState('');
  const [servisNotu, setServisNotu] = useState<string>(() => getInitial('servisNotu', ''));
  const [teslimEdildiMi, setTeslimEdildiMi] = useState<boolean>(() => getInitial('teslimEdildiMi', false));
  const [cevap, setCevap] = useState<string>(() => getInitial('cevap', ''));
  const [fatura, setFatura] = useState<boolean>(() => getInitial('fatura', false));
  const [ileriTeslim, setIleriTeslim] = useState<boolean>(() => getInitial('ileriTeslim', false));
  const [ileriTeslimTarihi, setIleriTeslimTarihi] = useState<string>(() => getInitial('ileriTeslimTarihi', ''));
  const [servis, setServis] = useState<boolean>(() => getInitial('servis', false));
  const [notlar, setNotlar] = useState<string>(() => getInitial('notlar', ''));
  const [seciliKampanyaIds, setSeciliKampanyaIds] = useState<string[]>(() => getInitial('seciliKampanyaIds', []));
  const [pesinatlar, setPesinatlar] = useState<{ id: string; tutar: number; aciklama: string }[]>(() => getInitial('pesinatlar', []));
  const [havaleler, setHavaleler] = useState<{ id: string; tutar: number; banka: string }[]>(() => getInitial('havaleler', []));
  const [kartOdemeler, setKartOdemeler] = useState<KartOdeme[]>(() => getInitial('kartOdemeler', []));
  const [manuelSatisTutari, setManuelSatisTutari] = useState<number | null>(() => getInitial('manuelSatisTutari', null));
  const [onayDurumu, setOnayDurumu] = useState<boolean>(() => getInitial('onayDurumu', false));

  const [kampanyaListesi, setKampanyaListesi] = useState<KampanyaAdmin[]>([]);
  const [yesilEtiketAdminList, setYesilEtiketAdminList] = useState<YesilEtiketAdmin[]>([]);
  const [kesintiCache, setKesintiCache] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(false);
  const [satisKodu, setSatisKodu] = useState('');
  const [urunCache, setUrunCache] = useState<Record<string, { ad: string; alis: number; bip: number; urunTuru: string }>>({});
  const [urunAramaDropdown, setUrunAramaDropdown] = useState<{ index: number; sonuclar: string[] } | null>(null);

  const draftVarMi = !!sessionStorage.getItem(STORAGE_KEY);
  const aktifSubeKodu = isAdmin ? adminSeciliSube : (currentUser?.subeKodu || '');

  useEffect(() => {
    saveDraft({
      musteriBilgileri, musteriTemsilcisiId, musteriTemsilcisiTel,
      urunler, tarih, teslimatTarihi, marsNo, magaza, faturaNo,
      servisNotu, teslimEdildiMi, cevap, fatura, ileriTeslim,
      ileriTeslimTarihi, servis, notlar, seciliKampanyaIds,
      pesinatlar, havaleler, kartOdemeler, manuelSatisTutari, onayDurumu,
      adminSeciliSube,
    });
  }, [
    musteriBilgileri, musteriTemsilcisiId, musteriTemsilcisiTel,
    urunler, tarih, teslimatTarihi, marsNo, magaza, faturaNo,
    servisNotu, teslimEdildiMi, cevap, fatura, ileriTeslim,
    ileriTeslimTarihi, servis, notlar, seciliKampanyaIds,
    pesinatlar, havaleler, kartOdemeler, manuelSatisTutari, onayDurumu,
    adminSeciliSube,
  ]);

  const kullanicilariCek = async () => {
    try {
      const kullanicilarSnapshot = await getDocs(collection(db, 'users'));
      const tumKullanicilar = kullanicilarSnapshot.docs.map(d => {
        const data = d.data();
        return { id: d.id, ad: data.ad || '', soyad: data.soyad || '', email: data.email || '', role: data.role || '', subeKodu: data.subeKodu || '' } as Kullanici;
      });
      const adminler = tumKullanicilar.filter(k => k.role?.toString().trim().toUpperCase() === 'ADMIN');
      const subeSatıcıları = tumKullanicilar.filter(k => k.subeKodu === currentUser?.subeKodu && k.role?.toString().trim().toUpperCase() !== 'ADMIN');
      const birlesikKullanicilar = [...adminler, ...subeSatıcıları];
      const formattedKullanicilar = birlesikKullanicilar.map(k => ({ ...k, displayName: `${k.ad} ${k.soyad}${k.role === 'ADMIN' ? ' (Admin)' : ''}` }));
      formattedKullanicilar.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
      setKullanicilar(formattedKullanicilar);
      const draftTemsilci = getInitial('musteriTemsilcisiId', '');
      if (!draftTemsilci && currentUser?.uid) setMusteriTemsilcisiId(currentUser.uid);
    } catch (err) { console.error('❌ Kullanıcılar çekilemedi:', err); }
  };

  const kesintiCacheYukle = async () => {
    try {
      const snap = await getDocs(collection(db, 'bankaKesintiler'));
      const cache: Record<string, Record<number, number>> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.taksitler) { const taksitMap: Record<number, number> = {}; Object.entries(data.taksitler).forEach(([key, val]) => { taksitMap[Number(key)] = Number(val); }); cache[d.id] = taksitMap; }
      });
      setKesintiCache(cache);
    } catch (err) { console.error('Kesinti cache yüklenemedi:', err); }
  };

  const getKesintiOrani = (banka: string, taksit: number): number => {
    if (kesintiCache[banka]?.[taksit]) return kesintiCache[banka][taksit];
    const normalize = (s: string) => s.toLowerCase().replace(/i̇/g, 'i').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/\s+/g, '').trim();
    const normalBanka = normalize(banka);
    const eslesen = Object.keys(kesintiCache).find(k => normalize(k).includes(normalBanka) || normalBanka.includes(normalize(k)));
    if (eslesen) return kesintiCache[eslesen][taksit] || 0;
    return 0;
  };

  const atomikSatisKoduUret = async (subeDbPath: string, subePrefix: string): Promise<string> => {
    const counterRef = doc(db, `subeler/${subeDbPath}/counters`, 'satisCounter');
    const yeniKod = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      let newNumber = 1;
      if (counterDoc.exists()) { newNumber = (counterDoc.data().currentNumber || 0) + 1; }
      transaction.set(counterRef, { currentNumber: newNumber, lastUpdated: new Date() });
      return `${subePrefix}-${newNumber.toString().padStart(3, '0')}`;
    });
    return yeniKod;
  };

  const formatPrice = (price: number): string => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);

  const alisToplamHesapla = (): number => urunler.reduce((t, u) => t + u.adet * u.alisFiyati, 0);
  const bipToplamHesapla = (): number => urunler.reduce((t, u) => t + (u.bip || 0) * u.adet, 0);
  const toplamTutarHesapla = (): number => manuelSatisTutari ?? 0;
  const kampanyaToplamiHesapla = (): number => { const secili = kampanyaListesi.filter(k => seciliKampanyaIds.includes(k.id!)); return secili.reduce((t, k) => t + (k.tutar || 0), 0); };

  const eslesenYesilEtiketler = (): { urunKodu: string; urunAdi: string; maliyet: number; adet: number }[] => {
    const result: { urunKodu: string; urunAdi: string; maliyet: number; adet: number }[] = [];
    for (const urun of urunler) {
      const eslesen = yesilEtiketAdminList.find(y => y.urunKodu.trim().toLowerCase() === urun.kod.trim().toLowerCase());
      if (eslesen) result.push({ urunKodu: urun.kod, urunAdi: urun.ad, maliyet: eslesen.maliyet, adet: urun.adet });
    }
    return result;
  };

  const yesilEtiketAlaniMaliyetHesapla = (): number => {
    const etiketler = eslesenYesilEtiketler();
    if (etiketler.length === 0) return 0;
    const yesilEtiketliKodlar = new Set(etiketler.map(e => e.urunKodu.trim().toLowerCase()));
    const yesilEtiketliToplam = etiketler.reduce((t, e) => t + e.maliyet * e.adet, 0);
    const normalUrunlerToplam = urunler
      .filter(u => !yesilEtiketliKodlar.has(u.kod.trim().toLowerCase()))
      .reduce((t, u) => t + (u.alisFiyati - (u.bip || 0)) * u.adet, 0);
    const kampanya = kampanyaToplamiHesapla();
    return Math.max(0, yesilEtiketliToplam + normalUrunlerToplam - kampanya);
  };

  const toplamMaliyetHesapla = (): number => {
    return Math.max(0, alisToplamHesapla() - bipToplamHesapla() - kampanyaToplamiHesapla());
  };

  const kartNetTutarHesapla = (kart: KartOdeme): number => kart.tutar - (kart.tutar * (kart.kesintiOrani || 0)) / 100;
  const pesinatToplamHesapla = (): number => pesinatlar.reduce((t, p) => t + (p.tutar || 0), 0);
  const havaleToplamHesapla = (): number => havaleler.reduce((t, h) => t + (h.tutar || 0), 0);
  const kartBrutToplamHesapla = (): number => kartOdemeler.reduce((t, k) => t + (k.tutar || 0), 0);
  const kartKesintiToplamHesapla = (): number => kartOdemeler.reduce((t, k) => t + (k.tutar * (k.kesintiOrani || 0)) / 100, 0);
  const kartNetToplamHesapla = (): number => kartOdemeler.reduce((t, k) => t + kartNetTutarHesapla(k), 0);
  const toplamOdenenHesapla = (): number => pesinatToplamHesapla() + havaleToplamHesapla() + kartBrutToplamHesapla();
  const hesabaGecenToplamHesapla = (): number => pesinatToplamHesapla() + havaleToplamHesapla() + kartNetToplamHesapla();
  const getOdemeDurumu = (): OdemeDurumu => { const odenen = toplamOdenenHesapla(); return odenen >= toplamTutarHesapla() && toplamTutarHesapla() > 0 ? OdemeDurumu.ODENDI : OdemeDurumu.ACIK_HESAP; };
  const acikHesapHesapla = (): number => { const acik = toplamTutarHesapla() - toplamOdenenHesapla(); return acik > 0 ? acik : 0; };
  const karZararHesapla = (): number => hesabaGecenToplamHesapla() - toplamMaliyetHesapla();

  const isTeslimatTarihiGecerli = (): boolean => { if (!teslimatTarihi) return true; return teslimatTarihi >= tarih; };

  const handleMarsNoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sadeceSayi = e.target.value.replace(/\D/g, '');
    setMarsNo(sadeceSayi);
    setMarsNoHata(false);
  };

  const handleFaturaNoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeFaturaNo(e.target.value);
    setFaturaNo(normalized);
    setFaturaNoHata(false);
    setFaturaNoHataMesaj('');
    setFatura(normalized.trim() !== '' && normalized !== 'Kesilmedi');
  };

  const handleFaturaNoBlur = () => {
    if (faturaNo && !isFaturaNoGecerli(faturaNo)) {
      setFaturaNoHata(true);
      setFaturaNoHataMesaj("Fatura No yalnızca 1-4 haneli rakam veya 'Kesilmedi' olabilir.");
    }
  };

  const handleMusteriChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setMusteriBilgileri(prev => ({ ...prev, [name]: value }));
  };

  const urunCacheYukle = async () => {
    try {
      const snap = await getDocs(collection(db, 'urunler'));
      const cache: Record<string, { ad: string; alis: number; bip: number; urunTuru: string }> = {};
      snap.docs.forEach(d => { const data = d.data(); if (data.kod) cache[data.kod.trim()] = { ad: data.ad || data.urunAdi || '', alis: parseFloat(data.alis || data.alisFiyati || 0), bip: parseFloat(data.bip || 0), urunTuru: data.urunTuru || '' }; });
      setUrunCache(cache);
    } catch (err) { console.error('Ürün cache yüklenemedi:', err); }
  };

  const handleUrunChange = (index: number, field: keyof Urun, value: any) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = { ...yeniUrunler[index], [field]: field === 'adet' || field === 'alisFiyati' || field === 'bip' ? (value === '' ? 0 : parseFloat(value) || 0) : value };
    if (field === 'kod') {
      const trimmed = String(value).trim().toUpperCase();
      const eslesme = urunCache[trimmed];
      if (eslesme) { yeniUrunler[index] = { ...yeniUrunler[index], kod: trimmed, ad: eslesme.urunTuru || eslesme.ad || yeniUrunler[index].ad, alisFiyati: eslesme.alis, bip: eslesme.bip }; setUrunAramaDropdown(null); }
      else if (trimmed.length >= 2) { const eslesenler = Object.keys(urunCache).filter(k => k.toUpperCase().includes(trimmed)).slice(0, 10); setUrunAramaDropdown(eslesenler.length > 0 ? { index, sonuclar: eslesenler } : null); }
      else { setUrunAramaDropdown(null); }
    }
    setUrunler(yeniUrunler);
    if (field === 'alisFiyati' || field === 'adet') setManuelSatisTutari(null);
  };

  // ✅ YENİ: Ürün bazlı teslim checkbox handler
  const handleUrunDeliveredChange = (index: number, checked: boolean) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = { ...yeniUrunler[index], delivered: checked } as any;
    setUrunler(yeniUrunler);
  };

  const urunSecDropdown = (index: number, kod: string) => {
    const eslesme = urunCache[kod];
    if (!eslesme) return;
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = { ...yeniUrunler[index], kod, ad: eslesme.urunTuru || eslesme.ad || '', alisFiyati: eslesme.alis, bip: eslesme.bip };
    setUrunler(yeniUrunler);
    setUrunAramaDropdown(null);
  };

  const urunEkle = () => setUrunler(prev => [...prev, { id: Date.now().toString(), kod: '', ad: '', adet: 1, alisFiyati: 0, bip: 0 }]);
  const urunSil = (index: number) => { if (urunler.length > 1) setUrunler(prev => prev.filter((_, i) => i !== index)); };
  const kartEkle = () => setKartOdemeler(prev => [...prev, { id: Date.now().toString(), banka: BANKALAR[0], taksitSayisi: 1, tutar: 0, kesintiOrani: 0 }]);
  const kartSil = (index: number) => setKartOdemeler(prev => prev.filter((_, i) => i !== index));
  const handleKartChange = (index: number, field: keyof KartOdeme, value: any) => {
    const yeniKartlar = [...kartOdemeler];
    const yeniKart = { ...yeniKartlar[index], [field]: field === 'tutar' ? (value === '' ? 0 : parseFloat(value) || 0) : field === 'taksitSayisi' ? parseInt(value) || 1 : value };
    if (field === 'banka' || field === 'taksitSayisi') { const banka = field === 'banka' ? value : yeniKartlar[index].banka; const taksit = field === 'taksitSayisi' ? (parseInt(value) || 1) : yeniKartlar[index].taksitSayisi; yeniKart.kesintiOrani = getKesintiOrani(banka, taksit); }
    yeniKartlar[index] = yeniKart;
    setKartOdemeler(yeniKartlar);
  };

  const pesinatEkle = () => setPesinatlar(prev => [...prev, { id: Date.now().toString(), tutar: 0, aciklama: '' }]);
  const pesinatSil = (id: string) => setPesinatlar(prev => prev.filter(p => p.id !== id));
  const handlePesinatChange = (id: string, field: 'tutar' | 'aciklama', value: any) => { setPesinatlar(prev => prev.map(p => p.id === id ? { ...p, [field]: field === 'tutar' ? (parseFloat(value) || 0) : value } : p)); };
  const havaleEkle = () => setHavaleler(prev => [...prev, { id: Date.now().toString(), tutar: 0, banka: HAVALE_BANKALARI[0] }]);
  const havaleSil = (id: string) => setHavaleler(prev => prev.filter(h => h.id !== id));
  const handleHavaleChange = (id: string, field: 'tutar' | 'banka', value: any) => { setHavaleler(prev => prev.map(h => h.id === id ? { ...h, [field]: field === 'tutar' ? (parseFloat(value) || 0) : value } : h)); };

  const kampanyaToggle = (id: string) => setSeciliKampanyaIds(prev => prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]);
  const seciliKampanyalar = kampanyaListesi.filter(k => seciliKampanyaIds.includes(k.id!));

  const kampanyalariCek = async () => {
    try {
      const snap = await getDocs(collection(db, 'kampanyalar'));
      const liste = snap.docs.map(d => ({ id: d.id, ...d.data() } as KampanyaAdmin)).filter(k => k.aktif && (k.subeKodu === 'GENEL' || k.subeKodu === aktifSubeKodu));
      setKampanyaListesi(liste);
    } catch (err) { console.error('Kampanyalar çekilemedi:', err); }
  };

  const yesilEtiketleriCek = async () => {
    try {
      const snap = await getDocs(collection(db, 'yesilEtiketler'));
      const liste = snap.docs.map(d => { const data = d.data(); return { id: d.id, urunKodu: data.urunKodu || '', urunTuru: data.urunTuru || '', maliyet: parseFloat(data.maliyet || 0) } as YesilEtiketAdmin; });
      setYesilEtiketAdminList(liste.filter(e => e.urunKodu && e.maliyet > 0));
    } catch (err) { console.error('Yeşil etiketler çekilemedi:', err); }
  };

  const logKaydet = async (kod: string, islem: string, detay: string, subeKodu: string) => {
    const sube = getSubeByKod(subeKodu as SubeKodu);
    if (!sube) return;
    await addDoc(collection(db, `subeler/${sube.dbPath}/loglar`), { satisKodu: kod, subeKodu, islem, kullanici: `${currentUser!.ad} ${currentUser!.soyad}`, tarih: new Date(), detay });
  };

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    kampanyalariCek();
    yesilEtiketleriCek();
    urunCacheYukle();
    kesintiCacheYukle();
    kullanicilariCek();
  }, [currentUser]);

  const formuSifirla = () => {
    if (!window.confirm('Formdaki tüm bilgiler silinecek. Emin misiniz?')) return;
    clearDraft();
    setMusteriBilgileri({ isim: '', adres: '', faturaAdresi: '', isAdresi: '', vergiNumarasi: '', vkNo: '', vd: '', cep: '', unvan: '' });
    setMusteriTemsilcisiId(currentUser?.uid || '');
    setMusteriTemsilcisiTel('');
    setUrunler([{ id: '1', kod: '', ad: '', adet: 1, alisFiyati: 0, bip: 0 }]);
    setTarih(new Date().toISOString().split('T')[0]);
    setTeslimatTarihi(''); setMarsNo(''); setMagaza(''); setFaturaNo('');
    setServisNotu(''); setTeslimEdildiMi(false); setCevap(''); setFatura(false);
    setIleriTeslim(false); setIleriTeslimTarihi(''); setServis(false); setNotlar('');
    setSeciliKampanyaIds([]); setPesinatlar([]); setHavaleler([]); setKartOdemeler([]);
    setManuelSatisTutari(null); setOnayDurumu(false); setMarsNoHata(false);
    setFaturaNoHata(false); setFaturaNoHataMesaj('');
    if (isAdmin) setAdminSeciliSube(currentUser?.subeKodu || SUBELER[0]?.kod || '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!faturaNo.trim()) { setFaturaNoHata(true); setFaturaNoHataMesaj('Fatura numarası zorunludur!'); alert('❌ Fatura numarası zorunludur!'); return; }
    if (!isFaturaNoGecerli(faturaNo)) {
      setFaturaNoHata(true);
      setFaturaNoHataMesaj("Fatura No yalnızca 1-4 haneli rakam veya 'Kesilmedi' olabilir.");
      alert("❌ Fatura No yalnızca 1-4 haneli rakam veya 'Kesilmedi' olabilir.");
      return;
    }
    if (!manuelSatisTutari || manuelSatisTutari <= 0) { alert('❌ Satış tutarı girilmelidir!'); return; }
    if (ileriTeslim && !ileriTeslimTarihi) { alert('❌ İleri teslim seçildiğinde müşteriyle anlaşılan teslim tarihi zorunludur!'); return; }
    if (marsNo && !isMarsNoGecerli(marsNo)) {
      setMarsNoHata(true);
      alert(`❌ Mars No geçersiz!\n10 haneli sayı olmalıdır.\nGirilen: ${marsNo} (${marsNo.length} hane)`);
      return;
    }
    if (!musteriTemsilcisiId) { alert('❌ Müşteri temsilcisi seçilmelidir!'); return; }
    if (teslimatTarihi && !isTeslimatTarihiGecerli()) { alert('❌ Teslimat tarihi, satış tarihinden önce olamaz.'); return; }
    if (marsNo?.trim() && !teslimatTarihi) { alert('❌ Mars No girildiğinde teslimat tarihi zorunludur.'); return; }
    if (teslimatTarihi && !marsNo?.trim()) { alert('❌ Teslimat tarihi girildiğinde Mars No zorunludur.'); return; }

    if (isAdmin && !aktifSubeKodu) { alert('❌ Lütfen satışın yapıldığı şubeyi seçin!'); return; }

    const _odenen = toplamOdenenHesapla();
    const _tutar  = manuelSatisTutari ?? 0;
    if (_odenen > _tutar) {
      alert(`❌ Toplam ödeme (${formatPrice(_odenen)}) satış tutarını (${formatPrice(_tutar)}) aşıyor!`);
      return;
    }

    setLoading(true);
    try {
      const subeKoduKullan = aktifSubeKodu;
      const sube = getSubeByKod(subeKoduKullan as SubeKodu);
      if (!sube) { alert('Şube bilgisi bulunamadı!'); setLoading(false); return; }

      const yeniSatisKodu = await atomikSatisKoduUret(sube.dbPath, String(sube.satisKoduPrefix));
      setSatisKodu(yeniSatisKodu);

      const seciliTemsilci = kullanicilar.find(k => k.id === musteriTemsilcisiId);
      const etiketler = eslesenYesilEtiketler();

      const satisTeklifi: any = {
        satisKodu: yeniSatisKodu,
        subeKodu: subeKoduKullan,
        musteriBilgileri: { ...musteriBilgileri, unvan: (musteriBilgileri as any).unvan || '' },
        musteriTemsilcisiId,
        musteriTemsilcisiAd: seciliTemsilci ? `${seciliTemsilci.ad} ${seciliTemsilci.soyad}` : '',
        musteriTemsilcisiTel,
        musteriTemsilcisi: seciliTemsilci ? `${seciliTemsilci.ad} ${seciliTemsilci.soyad}` : '',
        // ✅ YENİ: delivered field'ı ...u spread ile otomatik kaydedilir
        urunler: urunler.map(u => ({
          ...u,
          alisFiyatSnapshot: u.alisFiyati,
          bipSnapshot: u.bip || 0,
          greenPriceSnapshot: (() => { const ye = yesilEtiketAdminList.find(y => y.urunKodu.trim().toLowerCase() === u.kod.trim().toLowerCase()); return ye ? ye.maliyet : null; })(),
          snapshotTarihi: new Date().toISOString(),
        })),
        toplamTutar: manuelSatisTutari,
        kampanyaToplami: kampanyaToplamiHesapla(),
        tarih: new Date(tarih),
        teslimatTarihi: teslimatTarihi ? new Date(teslimatTarihi) : null,
        marsNo, magaza, faturaNo, servisNotu, teslimEdildiMi, cevap,
        notlar: notlar.trim() || null,
        kampanyalar: seciliKampanyalar.map(k => ({ id: k.id!, ad: k.ad, tutar: k.tutar || 0 })),
        yesilEtiketler: etiketler.map(e => ({ id: Date.now().toString(), urunKodu: e.urunKodu, ad: e.urunAdi, alisFiyati: e.maliyet, tutar: e.maliyet * e.adet })),
        pesinatlar, havaleler,
        kartOdemeler: kartOdemeler.map(k => ({ ...k, commissionRateSnapshot: k.kesintiOrani || 0, commissionAmountSnapshot: (k.tutar * (k.kesintiOrani || 0)) / 100, netAmountSnapshot: k.tutar - (k.tutar * (k.kesintiOrani || 0)) / 100, snapshotTarihi: new Date().toISOString() })),
        pesinatToplam: pesinatToplamHesapla(), havaleToplam: havaleToplamHesapla(),
        kartBrutToplam: kartBrutToplamHesapla(), kartKesintiToplam: kartKesintiToplamHesapla(),
        kartNetToplam: kartNetToplamHesapla(), toplamOdenen: toplamOdenenHesapla(),
        hesabaGecenToplam: hesabaGecenToplamHesapla(), acikHesap: acikHesapHesapla(),
        odemeDurumu: getOdemeDurumu(),
        pesinatTutar: pesinatToplamHesapla(), havaleTutar: havaleToplamHesapla(),
        fatura, ileriTeslim,
        ileriTeslimTarihi: ileriTeslim && ileriTeslimTarihi ? new Date(ileriTeslimTarihi) : null,
        ileriTeslimOnay: false, servis,
        odemeYontemi: OdemeYontemi.PESINAT,
        onayDurumu,
        zarar: karZararHesapla(),
        olusturanKullanici: `${currentUser!.ad} ${currentUser!.soyad}`,
        olusturmaTarihi: new Date(), guncellemeTarihi: new Date(),
        assignedUserId: musteriTemsilcisiId, assignedUserRole: seciliTemsilci?.role || ''
      };

      const satisDocRef = await addDoc(collection(db, `subeler/${sube.dbPath}/satislar`), satisTeklifi);

      const nakitTutar  = pesinatToplamHesapla();
      const havaleTutar = havaleToplamHesapla();
      const kartTutar   = kartBrutToplamHesapla();

      if (sube.tip === 'magaza' && (nakitTutar > 0 || havaleTutar > 0 || kartTutar > 0)) {
        const ilkKart   = kartOdemeler.find(k => k.tutar > 0);
        const ilkHavale = havaleler.find(h => h.tutar > 0);
        const gun = bugunStr();
        await kasaTahsilatEkle({ subeKodu: subeKoduKullan, gun, satisId: satisDocRef.id, satisKodu: yeniSatisKodu, musteriIsim: musteriBilgileri.isim || '—', nakitTutar, kartTutar, havaleTutar, yapan: `${currentUser!.ad} ${currentUser!.soyad}`, yapanId: currentUser!.uid || '', aciklama: `Yeni satış — ${yeniSatisKodu}`, satisTarihi: gun, kartBanka: ilkKart?.banka ?? undefined, havaleBanka: ilkHavale?.banka ?? undefined });
      }

      if (!onayDurumu) {
        for (const urun of urunler) {
          await addDoc(collection(db, `subeler/${sube.dbPath}/bekleyenUrunler`), { satisKodu: yeniSatisKodu, subeKodu: subeKoduKullan, urunKodu: urun.kod, urunAdi: urun.ad, adet: urun.adet, musteriIsmi: musteriBilgileri.isim, siparisTarihi: new Date(), beklenenTeslimTarihi: teslimatTarihi ? new Date(teslimatTarihi) : new Date(), durum: 'BEKLEMEDE', notlar: servisNotu || '', guncellemeTarihi: new Date() });
        }
      }

      await logKaydet(yeniSatisKodu, 'YENİ_SATIS', `Yeni satış. Müşteri: ${musteriBilgileri.isim}, Tutar: ${manuelSatisTutari} TL`, subeKoduKullan);
      clearDraft();
      alert(`✅ Satış başarıyla oluşturuldu!\n\nSatış Kodu: ${yeniSatisKodu}`);
      navigate('/dashboard');
    } catch (error) {
      console.error(error);
      alert('❌ Bir hata oluştu! Lütfen tekrar deneyin.');
    } finally { setLoading(false); }
  };

  const seciliTemsilciAdi = () => { const temsilci = kullanicilar.find(k => k.id === musteriTemsilcisiId); return temsilci ? temsilci.displayName || `${temsilci.ad} ${temsilci.soyad}` : ''; };

  const subePrefix = (() => {
    const sube = getSubeByKod(aktifSubeKodu as SubeKodu);
    return sube ? String(sube.satisKoduPrefix) : '';
  })();

  const subeButon = (sube: any, renk: string) => (
    <button
      key={sube.kod}
      type="button"
      onClick={() => setAdminSeciliSube(sube.kod)}
      style={{
        padding: '8px 18px',
        borderRadius: 30,
        border: '2px solid',
        borderColor: adminSeciliSube === sube.kod ? renk : '#e5e7eb',
        background: adminSeciliSube === sube.kod ? renk : 'white',
        color: adminSeciliSube === sube.kod ? 'white' : '#374151',
        fontWeight: 600,
        fontSize: 13,
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      {sube.ad.replace(' Şubesi', '')}
    </button>
  );

  return (
    <div className="satis-form-container">
      <div className="satis-form-header">
        <button onClick={() => navigate('/dashboard')} className="btn-back">← Geri</button>
        {draftVarMi && (
          <div className="draft-bilgi">
            <span>📝 Kaydedilmemiş değişiklikler mevcut</span>
            <button type="button" onClick={formuSifirla} className="btn-draft-sifirla">🗑️ Formu Temizle</button>
          </div>
        )}
      </div>
      <h2 className="form-title">
        Yeni Satış Teklif Formu — {satisKodu || <span style={{ color: '#6b7280', fontStyle: 'italic', fontSize: '0.85em' }}>{subePrefix ? `${subePrefix}-***` : 'Otomatik atanacak'}</span>}
      </h2>

      <form onSubmit={handleSubmit}>

        {currentUser && isAdmin && (
          <section className="form-section" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
            <h3 className="section-title">🏪 Satış Şubesi</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>Bu satışın yapıldığı şubeyi seçin:</span>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>🏬 Mağazalar</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {MAGAZA_SUBELER.map(sube => subeButon(sube, '#d97706'))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>🌐 Online Kanallar</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ONLINE_SUBELER.map(sube => subeButon(sube, '#7c3aed'))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>🏢 Ticari</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {TICARI_SUBELER.map(sube => subeButon(sube, '#059669'))}
                </div>
              </div>
              {aktifSubeKodu && (
                <span style={{ fontSize: 12, color: '#d97706', fontWeight: 600, padding: '4px 12px', background: '#fef3c7', borderRadius: 20, alignSelf: 'flex-start' }}>
                  ✓ Seçili: {getSubeByKod(aktifSubeKodu as SubeKodu)?.ad || aktifSubeKodu}
                </span>
              )}
            </div>
          </section>
        )}

        <section className="form-section">
          <h3 className="section-title">Müşteri Bilgileri</h3>
          <div className="form-grid-4">
            <div className="form-field"><label>İsim/Adı *</label><input name="isim" value={musteriBilgileri.isim} onChange={handleMusteriChange} required /></div>
            <div className="form-field"><label>Ünvan</label><input name="unvan" value={(musteriBilgileri as any).unvan || ''} onChange={handleMusteriChange} placeholder="Şirket ünvanı" /></div>
            <div className="form-field"><label>VK No</label><input name="vkNo" value={musteriBilgileri.vkNo} onChange={handleMusteriChange} /></div>
            <div className="form-field"><label>Adres</label><input name="adres" value={musteriBilgileri.adres} onChange={handleMusteriChange} /></div>
            <div className="form-field"><label>VD</label><input name="vd" value={musteriBilgileri.vd} onChange={handleMusteriChange} /></div>
            <div className="form-field"><label>Fatura Adresi</label><input name="faturaAdresi" value={musteriBilgileri.faturaAdresi} onChange={handleMusteriChange} /></div>
            <div className="form-field"><label>Cep Tel</label><input name="cep" value={musteriBilgileri.cep} onChange={handleMusteriChange} /></div>
          </div>
          <small style={{ color: '#9ca3af', fontSize: 11, marginTop: 4, display: 'block' }}>💡 Teslim alacak kişi bilgisi "İsim" alanına yazılabilir.</small>
        </section>

        <section className="form-section">
          <h3 className="section-title">Satış Bilgileri</h3>
          <div className="form-grid-4">
            <div className="form-field">
              <label>Müşteri Temsilcisi *</label>
              <select value={musteriTemsilcisiId} onChange={e => setMusteriTemsilcisiId(e.target.value)} required style={{ padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, width: '100%', backgroundColor: '#fff' }}>
                <option value="">Temsilci Seçin</option>
                {kullanicilar.map(k => <option key={k.id} value={k.id}>{k.displayName || `${k.ad} ${k.soyad}`}</option>)}
              </select>
              {musteriTemsilcisiId && <small style={{ color: '#6b7280', marginTop: 4, display: 'block' }}>Seçilen: {seciliTemsilciAdi()}</small>}
            </div>
            <div className="form-field">
              <label>Teslimat Tarihi</label>
              <input type="date" value={teslimatTarihi} min={tarih} onChange={e => setTeslimatTarihi(e.target.value)} style={{ borderColor: teslimatTarihi && !isTeslimatTarihiGecerli() ? '#ef4444' : undefined }} />
              {teslimatTarihi && !isTeslimatTarihiGecerli() && <small style={{ color: '#ef4444' }}>Teslimat tarihi, satış tarihinden önce olamaz.</small>}
              {marsNo?.trim() && !teslimatTarihi && <small style={{ color: '#d97706' }}>⚠️ Mars No girildiğinde teslimat tarihi zorunludur.</small>}
              {teslimatTarihi && !marsNo?.trim() && <small style={{ color: '#d97706' }}>⚠️ Teslimat tarihi girildiğinde Mars No zorunludur.</small>}
            </div>
            <div className="form-field">
              <label>Satış Tutarı *</label>
              <input type="number" min="0" value={manuelSatisTutari ?? ''} onChange={e => setManuelSatisTutari(e.target.value === '' ? null : parseFloat(e.target.value) || 0)} placeholder="Satış tutarını girin" style={{ fontWeight: 700, color: '#1d4ed8', borderColor: '#93c5fd' }} required />
            </div>
          </div>
        </section>

        <section className="form-section">
          <h3 className="section-title">Notlar ve Zorunlu Alanlar</h3>
          <div className="form-grid-4">
            <div className="form-field">
              <label>MARS No</label>
              <input value={marsNo} onChange={handleMarsNoChange} placeholder="10 haneli sayı" maxLength={10} style={{ borderColor: marsNoHata ? '#ef4444' : (marsNo && isMarsNoGecerli(marsNo) ? '#16a34a' : undefined) }} />
              {marsNo && <small style={{ color: isMarsNoGecerli(marsNo) ? '#16a34a' : '#ef4444' }}>{isMarsNoGecerli(marsNo) ? '✅ Geçerli Mars No' : `⚠️ ${marsNo.length}/10 hane — 10 haneli sayı gerekli`}</small>}
              <small style={{ color: '#9ca3af', fontSize: 11 }}>10 haneli sayı</small>
            </div>
            <div className="form-field"><label>Mağaza Teslimat</label><input value={magaza} onChange={e => setMagaza(e.target.value)} placeholder="Mağaza adı" /></div>
            <div className="form-field">
              <label>Fatura No *</label>
              <input value={faturaNo} onChange={handleFaturaNoChange} onBlur={handleFaturaNoBlur} placeholder="1-4 haneli rakam veya Kesilmedi" style={{ borderColor: faturaNoHata ? '#ef4444' : undefined }} required />
              {faturaNoHata && <small style={{ color: '#ef4444' }}>{faturaNoHataMesaj}</small>}
              {!faturaNoHata && faturaNo && isFaturaNoGecerli(faturaNo) && <small style={{ color: '#16a34a' }}>✅ Geçerli format</small>}
              <small style={{ color: '#9ca3af', fontSize: 11 }}>1-4 haneli rakam (ör: 1, 01, 001, 0001) veya "Kesilmedi"</small>
            </div>
            <div className="form-field">
              <label>Servis Notu</label>
              <input value={servisNotu} onChange={e => { setServisNotu(e.target.value); setServis(e.target.value.trim() !== ''); }} />
            </div>
          </div>
          <div className="form-field" style={{ marginTop: 12 }}>
            <label>📝 Notlar</label>
            <textarea value={notlar} onChange={e => setNotlar(e.target.value)} placeholder="Satışa ait notları buraya girin..." rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            <label className="checkbox-label"><input type="checkbox" checked={teslimEdildiMi} onChange={e => { setTeslimEdildiMi(e.target.checked); if (e.target.checked) setMarsNoHata(false); }} />Teslim Edildi</label>
            <label className="checkbox-label"><input type="checkbox" checked={fatura} onChange={e => setFatura(e.target.checked)} />Fatura Kesildi</label>
            <label className="checkbox-label"><input type="checkbox" checked={ileriTeslim} onChange={e => { setIleriTeslim(e.target.checked); if (!e.target.checked) setIleriTeslimTarihi(''); }} />İleri Teslim</label>
            <label className="checkbox-label"><input type="checkbox" checked={servis} onChange={e => setServis(e.target.checked)} />Servis</label>
          </div>
          {ileriTeslim && (
            <div className="form-field" style={{ marginTop: 12, maxWidth: 320, padding: '12px 16px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
              <label style={{ fontWeight: 600, color: '#1e40af' }}>📅 M.A. Teslim Tarihi (Zorunlu) *</label>
              <input type="date" value={ileriTeslimTarihi} onChange={e => setIleriTeslimTarihi(e.target.value)} required={ileriTeslim} style={{ marginTop: 6, width: '100%', borderColor: '#93c5fd' }} />
              <small style={{ color: '#3b82f6', marginTop: 4, display: 'block' }}>Müşteriyle anlaşılan teslim tarihi</small>
            </div>
          )}
        </section>

        <section className="form-section">
          <div className="section-header">
            <h3 className="section-title">Ürünler</h3>
            <button type="button" onClick={urunEkle} className="btn-add">+ Ürün Ekle</button>
          </div>
          {/* ✅ YENİ: Teslim Edildi sütunu eklendi */}
          <div className="urun-table-header">
            <span>Ürün Kodu</span><span>Ürün Adı</span><span>Adet</span><span>Alış (TL)</span><span>BİP (TL)</span>
            <span style={{ textAlign: 'center' }}>Teslim Edildi</span>
            <span></span>
          </div>
          {urunler.map((urun, index) => (
            <div key={urun.id} className="urun-row">
              <div style={{ position: 'relative' }}>
                <input value={urun.kod} onChange={e => handleUrunChange(index, 'kod', e.target.value)} onBlur={() => setTimeout(() => setUrunAramaDropdown(null), 200)} required placeholder="Ürün kodu" autoComplete="off" />
                {urunCache[urun.kod?.trim().toUpperCase()] && <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, background: '#dcfce7', color: '#15803d', padding: '2px 7px', borderRadius: 10, fontWeight: 700, pointerEvents: 'none' }}>✓</span>}
                {urunAramaDropdown?.index === index && urunAramaDropdown.sonuclar.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999, background: '#fff', border: '1px solid #d1fae5', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto' }}>
                    {urunAramaDropdown.sonuclar.map(kod => { const info = urunCache[kod]; return <div key={kod} onMouseDown={() => urunSecDropdown(index, kod)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f0fdf4', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ fontWeight: 700, color: '#065f46' }}>{kod}</span><span style={{ color: '#15803d', fontWeight: 600, fontSize: 12 }}>₺{info?.alis?.toLocaleString('tr-TR') || 0}</span></div>; })}
                  </div>
                )}
              </div>
              <input value={urun.ad} onChange={e => handleUrunChange(index, 'ad', e.target.value)} required placeholder="Ürün adı" />
              <input type="number" min="1" value={urun.adet} onChange={e => handleUrunChange(index, 'adet', e.target.value)} required />
              <input type="number" min="0" value={urun.alisFiyati || ''} onChange={e => handleUrunChange(index, 'alisFiyati', e.target.value)} required />
              <input type="number" min="0" value={urun.bip || ''} onChange={e => handleUrunChange(index, 'bip', e.target.value)} />
              {/* ✅ YENİ: Ürün bazlı teslim checkbox */}
              <label style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 4, fontSize: 11, color: '#374151', cursor: 'pointer', minWidth: 64,
              }}>
                <input
                  type="checkbox"
                  checked={(urun as any).delivered === true}
                  onChange={e => handleUrunDeliveredChange(index, e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#16a34a' }}
                />
                ✓
              </label>
              {urunler.length > 1 && <button type="button" onClick={() => urunSil(index)} className="btn-remove">Sil</button>}
            </div>
          ))}
          <div className="genel-toplam">{manuelSatisTutari !== null ? `Satış Tutarı: ${formatPrice(manuelSatisTutari)}` : 'Satış Tutarı: Satış Bilgileri bölümünden girin'}</div>
          <div className="maliyet-notu">
            <div>Alış Toplam: {formatPrice(alisToplamHesapla())} | BİP Toplam: {formatPrice(bipToplamHesapla())}</div>
            {kampanyaToplamiHesapla() > 0 && <div style={{ color: '#15803d' }}>Kampanya: −{formatPrice(kampanyaToplamiHesapla())}</div>}
            {eslesenYesilEtiketler().length > 0 && (
              <div style={{ color: '#15803d' }}>Yeşil Etiket Maliyeti: {formatPrice(yesilEtiketAlaniMaliyetHesapla())}</div>
            )}
            <div style={{ fontWeight: 700 }}>TOPLAM MALİYET = {formatPrice(toplamMaliyetHesapla())}</div>
          </div>
        </section>

        <section className="form-section">
          <h3 className="section-title">Kampanyalar</h3>
          {kampanyaListesi.length === 0 ? <div className="empty-state">Aktif kampanya bulunamadı.</div> : (
            <div className="kampanya-secim-grid">
              {kampanyaListesi.map(k => (
                <label key={k.id} className={`kampanya-secim-item ${seciliKampanyaIds.includes(k.id!) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={seciliKampanyaIds.includes(k.id!)} onChange={() => kampanyaToggle(k.id!)} style={{ marginRight: 8 }} />
                  <div>
                    <div className="kampanya-ad">{k.ad}</div>
                    {k.aciklama && <div className="kampanya-aciklama">{k.aciklama}</div>}
                    {(k.tutar || 0) > 0 && <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>İndirim: {formatPrice(k.tutar || 0)}</div>}
                  </div>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="form-section">
          <h3 className="section-title">💳 Ödeme Bilgileri</h3>
          <div className="odeme-blok">
            <div className="odeme-blok-header"><div className="odeme-blok-title">💵 Peşinat</div><button type="button" onClick={pesinatEkle} className="btn-add-sm">+ Peşinat Ekle</button></div>
            {pesinatlar.map(p => (
              <div key={p.id} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                <input type="number" min="0" placeholder="Tutar (TL)" value={p.tutar || ''} onChange={e => handlePesinatChange(p.id, 'tutar', e.target.value)} className="odeme-input" style={{ flex: 1 }} />
                <input type="text" placeholder="Açıklama" value={p.aciklama} onChange={e => handlePesinatChange(p.id, 'aciklama', e.target.value)} className="odeme-input" style={{ flex: 2 }} />
                <button type="button" onClick={() => pesinatSil(p.id)} className="btn-remove">Sil</button>
              </div>
            ))}
            {pesinatlar.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Peşinat eklenmedi</div>}
            {pesinatToplamHesapla() > 0 && <div className="odeme-bilgi ok">✅ Peşinat: {formatPrice(pesinatToplamHesapla())}</div>}
          </div>

          <div className="odeme-blok">
            <div className="odeme-blok-header"><div className="odeme-blok-title">🏦 Havale</div><button type="button" onClick={havaleEkle} className="btn-add-sm">+ Havale Ekle</button></div>
            {havaleler.map(h => (
              <div key={h.id} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                <select value={h.banka} onChange={e => handleHavaleChange(h.id, 'banka', e.target.value)} className="odeme-input" style={{ flex: 2 }}>{HAVALE_BANKALARI.map(b => <option key={b} value={b}>{b}</option>)}</select>
                <input type="number" min="0" placeholder="Tutar" value={h.tutar || ''} onChange={e => handleHavaleChange(h.id, 'tutar', e.target.value)} className="odeme-input" style={{ flex: 1 }} />
                <button type="button" onClick={() => havaleSil(h.id)} className="btn-remove">Sil</button>
              </div>
            ))}
            {havaleler.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Havale eklenmedi</div>}
            {havaleToplamHesapla() > 0 && <div className="odeme-bilgi ok">✅ Havale: {formatPrice(havaleToplamHesapla())}</div>}
          </div>

          <div className="odeme-blok">
            <div className="odeme-blok-header"><div className="odeme-blok-title">💳 Kart Ödemeleri</div><button type="button" onClick={kartEkle} className="btn-add-sm">+ Kart Ekle</button></div>
            {kartOdemeler.map((kart, index) => {
              const kesintiOrani = kart.kesintiOrani || 0;
              const net = kart.tutar - (kart.tutar * kesintiOrani) / 100;
              return (
                <div key={kart.id} className="kart-row">
                  <div className="kart-fields">
                    <div className="form-field"><label>Banka</label><select value={kart.banka} onChange={e => handleKartChange(index, 'banka', e.target.value)} className="odeme-input">{BANKALAR.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
                    <div className="form-field"><label>Taksit</label><select value={kart.taksitSayisi} onChange={e => handleKartChange(index, 'taksitSayisi', e.target.value)} className="odeme-input">{TAKSIT_SECENEKLERI.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
                    <div className="form-field"><label>Brüt Tutar</label><input type="number" min="0" value={kart.tutar || ''} onChange={e => handleKartChange(index, 'tutar', e.target.value)} className="odeme-input" /></div>
                    <div className="form-field"><label>Kesinti</label><input type="text" value={kesintiOrani > 0 ? `%${kesintiOrani}` : 'Bulunamadı'} readOnly className="odeme-input" style={{ background: kesintiOrani > 0 ? '#f0fdf4' : '#fff7ed', color: kesintiOrani > 0 ? '#15803d' : '#92400e', fontWeight: 600 }} /></div>
                    <button type="button" onClick={() => kartSil(index)} className="btn-remove" style={{ alignSelf: 'flex-end' }}>Sil</button>
                  </div>
                  {kart.tutar > 0 && <div className="kart-net-ozet">Brüt: {formatPrice(kart.tutar)} → <strong>NET: {formatPrice(net)}</strong></div>}
                </div>
              );
            })}
            {kartOdemeler.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Kart eklenmedi</div>}
          </div>

          <div className="odeme-ozet-grid">
            <div className="odeme-ozet-kart"><div className="odeme-ozet-label">💵 Peşinat</div><div className="odeme-ozet-deger">{formatPrice(pesinatToplamHesapla())}</div></div>
            <div className="odeme-ozet-kart"><div className="odeme-ozet-label">🏦 Havale</div><div className="odeme-ozet-deger">{formatPrice(havaleToplamHesapla())}</div></div>
            {kartOdemeler.length > 0 && <div className="odeme-ozet-kart"><div className="odeme-ozet-label">💳 Kart Brüt</div><div className="odeme-ozet-deger">{formatPrice(kartBrutToplamHesapla())}</div><div style={{ fontSize: 11, color: '#6b7280' }}>NET: {formatPrice(kartNetToplamHesapla())}</div></div>}
            <div className="odeme-ozet-kart"><div className="odeme-ozet-label">📊 Toplam Ödenen</div><div className="odeme-ozet-deger">{formatPrice(toplamOdenenHesapla())}</div></div>
            <div className="odeme-ozet-kart" style={{ background: acikHesapHesapla() > 0 ? '#fff7ed' : '#f0fdf4' }}>
              <div className="odeme-ozet-label">🔓 Açık Hesap</div>
              <div className="odeme-ozet-deger" style={{ color: acikHesapHesapla() > 0 ? '#ea580c' : '#15803d' }}>{acikHesapHesapla() > 0 ? formatPrice(acikHesapHesapla()) : '✅ Ödendi'}</div>
            </div>
          </div>

          {(() => {
            const odenen = toplamOdenenHesapla();
            const tutar  = manuelSatisTutari ?? 0;
            const fark   = odenen - tutar;
            if (tutar > 0 && fark > 0) return <div style={{ margin: '8px 0', padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '2px solid #dc2626', color: '#dc2626', fontWeight: 700, fontSize: 13 }}>🚫 Toplam ödeme ({formatPrice(odenen)}) satış tutarını ({formatPrice(tutar)}) <strong>{formatPrice(fark)}</strong> aşıyor!</div>;
            if (tutar > 0 && odenen > 0 && fark === 0) return <div style={{ margin: '8px 0', padding: '8px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', color: '#15803d', fontWeight: 600, fontSize: 13 }}>✅ Ödeme tam — satış tutarı karşılandı.</div>;
            return null;
          })()}

          <div className="kar-zararbar" style={{ background: karZararHesapla() >= 0 ? '#dcfce7' : '#fee2e2', color: karZararHesapla() >= 0 ? '#15803d' : '#dc2626' }}>
            {karZararHesapla() >= 0 ? `📈 KÂR: ${formatPrice(karZararHesapla())}` : `📉 ZARAR: ${formatPrice(Math.abs(karZararHesapla()))}`}
          </div>
        </section>

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
          <button type="submit" className="btn-submit" disabled={loading || toplamOdenenHesapla() > (manuelSatisTutari ?? 0)}>
            {loading ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SatisTeklifPage;