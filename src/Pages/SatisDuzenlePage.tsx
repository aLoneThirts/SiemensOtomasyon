import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, addDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, Kampanya, Urun, KartOdeme, YesilEtiket, BANKALAR, TAKSIT_SECENEKLERI } from '../types/satis';
import { getSubeByKod } from '../types/sube';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import { writeSatisAuditLog } from '../services/satisLogService';
import './SatisDuzenle.css';
import { kasaTahsilatEkle, kasaIadeEkle } from '../services/kasaService';

interface KampanyaAdmin { id?: string; ad: string; aciklama: string; aktif: boolean; subeKodu: string; tutar?: number; }
interface YesilEtiketAdmin { id?: string; urunKodu: string; urunTuru?: string; maliyet: number; aciklama?: string; }
interface MarsGirisi { marsNo: string; teslimatTarihi: string; etiket: string; }

const MAX_MARS = 4;
const HAVALE_BANKALARI = ['Ziraat Bankası','Halkbank','Vakıfbank','İş Bankası','Garanti BBVA','Yapı Kredi','Akbank','QNB Finansbank','Denizbank','TEB','ING Bank','HSBC','Şekerbank','Fibabanka','Alternatifbank'];

// ✅ Fatura No validasyon
const FATURA_NO_REGEX = /^(\d{4}|Kesilmedi)$/;
const normalizeFaturaNo = (val: string): string => { if (val.toLowerCase() === 'kesilmedi') return 'Kesilmedi'; return val; };
const isFaturaNoGecerli = (val: string): boolean => !val || FATURA_NO_REGEX.test(val);

// ✅ P1-1 FIX: Mars No validasyon — tam 10 hane, güncel yıl ile başlar
const CURRENT_YEAR = new Date().getFullYear().toString();
const MARS_NO_REGEX = new RegExp(`^${CURRENT_YEAR}\\d{6}$`);
const isMarsNoGecerli = (val: string): boolean => !val || MARS_NO_REGEX.test(val);

const bugunStr = (): string => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
};

const SatisDuzenlePage: React.FC = () => {
  const { subeKodu, id } = useParams<{ subeKodu: string; id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

  const [satis, setSatis] = useState<SatisTeklifFormu | null>(null);
  const [loading, setLoading] = useState(true);

  const [urunler, setUrunler] = useState<Urun[]>([]);
  const [pesinatlar, setPesinatlar] = useState<{ id: string; tutar: number; aciklama: string }[]>([]);
  const [havaleler, setHavaleler] = useState<{ id: string; tutar: number; banka: string }[]>([]);
  const [kartOdemeler, setKartOdemeler] = useState<KartOdeme[]>([]);
  const [kesintiCache, setKesintiCache] = useState<Record<string, Record<string, number>>>({});
  const [manuelSatisTutari, setManuelSatisTutari] = useState<number | null>(null);

  const [orijinalPesinatlar, setOrijinalPesinatlar] = useState<{ id: string; tutar: number; aciklama: string }[]>([]);
  const [orijinalHavaleler, setOrijinalHavaleler] = useState<{ id: string; tutar: number; banka: string }[]>([]);
  const [orijinalKartOdemeler, setOrijinalKartOdemeler] = useState<KartOdeme[]>([]);

  const [faturaNo, setFaturaNo] = useState('');
  const [faturaNoHata, setFaturaNoHata] = useState(false);
  const [faturaNoHataMesaj, setFaturaNoHataMesaj] = useState('');
  const [servisNotu, setServisNotu] = useState('');
  const [marsListesi, setMarsListesi] = useState<MarsGirisi[]>([]);
  const [notlar, setNotlar] = useState('');
  const [satisTarihi, setSatisTarihi] = useState('');

  // ✅ 2.1 Teslim Edildi state — düzenle ekranına eklendi
  const [teslimEdildiMi, setTeslimEdildiMi] = useState(false);

  // ✅ 2.2 Müşteri bilgileri state'leri — düzenlenebilir
  const [musteriIsim, setMusteriIsim] = useState('');
  const [musteriUnvan, setMusteriUnvan] = useState('');
  const [musteriVkNo, setMusteriVkNo] = useState('');
  const [musteriVd, setMusteriVd] = useState('');
  const [musteriAdres, setMusteriAdres] = useState('');
  const [musteriFaturaAdresi, setMusteriFaturaAdresi] = useState('');
  const [musteriCep, setMusteriCep] = useState('');
  // "Teslim Alacak Kişi" alanı KALDIRILDI — isim alanına yazılması yeterli

  const [urunCache, setUrunCache] = useState<Record<string, { ad: string; alis: number; bip: number }>>({});
  const [kampanyaAdminListesi, setKampanyaAdminListesi] = useState<KampanyaAdmin[]>([]);
  const [seciliKampanyaIds, setSeciliKampanyaIds] = useState<string[]>([]);
  const [yesilEtiketAdminList, setYesilEtiketAdminList] = useState<YesilEtiketAdmin[]>([]);

  const [iptalPopup, setIptalPopup] = useState(false);
  const [iptaldenCikarPopup, setIptaldenCikarPopup] = useState(false);
  const [iptalIslemYapiliyor, setIptalIslemYapiliyor] = useState(false);
  const [iptaldenCikarStatusu, setIptaldenCikarStatusu] = useState<'BEKLEMEDE' | 'ONAYLI'>('BEKLEMEDE');
  const [iadePopup, setIadePopup] = useState(false);

  // Mars No hata state'leri
  const [marsNoHatalar, setMarsNoHatalar] = useState<Record<number, string>>({});

  const isIptal = (satis as any)?.satisDurumu === 'IPTAL';
  const iptalTalebiVar = !isIptal && (satis as any)?.iptalTalebi === true;
  const iadeDurumu: string | undefined = (satis as any)?.iadeDurumu;

  const onayliKilitli = !isAdmin && satis?.onayDurumu === true && !isIptal;
  const alanlarKilitli = (isIptal || onayliKilitli) && !isAdmin;

  const etiketAd = (index: number) => ['Orijinal', '2. Sipariş', '3. Sipariş', '4. Sipariş'][index] || `${index + 1}. Sipariş`;
  const formatPrice = (price: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);

  const normalizeBanka = (s: string): string =>
    s.toLowerCase().replace(/i̇/g, 'i').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/\s+/g, '').trim();

  const kesintiCacheYukle = async () => {
    try {
      const snap = await getDocs(collection(db, 'bankaKesintiler'));
      const cache: Record<string, Record<number, number>> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        const taksitMap: Record<number, number> = {};
        if (data.taksitler) {
          Object.entries(data.taksitler).forEach(([key, val]) => { taksitMap[Number(key)] = Number(val); });
        } else {
          if (data.tek) taksitMap[1] = data.tek;
          if (data.t2)  taksitMap[2] = data.t2;
          if (data.t3)  taksitMap[3] = data.t3;
          if (data.t4)  taksitMap[4] = data.t4;
          if (data.t5)  taksitMap[5] = data.t5;
          if (data.t6)  taksitMap[6] = data.t6;
          if (data.t7)  taksitMap[7] = data.t7;
          if (data.t8)  taksitMap[8] = data.t8;
          if (data.t9)  taksitMap[9] = data.t9;
        }
        cache[d.id] = taksitMap;
      });
      setKesintiCache(cache as any);
    } catch (err) { console.error('Kesinti cache:', err); }
  };

  const getKesintiOrani = (banka: string, taksit: number): number => {
    const cache = kesintiCache as Record<string, Record<number, number>>;
    if (cache[banka]?.[taksit] !== undefined) return cache[banka][taksit];
    const normalBanka = normalizeBanka(banka);
    const eslesen = Object.keys(cache).find(k => normalizeBanka(k) === normalBanka || normalizeBanka(k).includes(normalBanka) || normalBanka.includes(normalizeBanka(k)));
    if (eslesen) return cache[eslesen][taksit] ?? 0;
    return 0;
  };

  const urunCacheYukle = async () => {
    try {
      const snap = await getDocs(collection(db, 'urunler'));
      const cache: Record<string, { ad: string; alis: number; bip: number }> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.kod) cache[data.kod.trim()] = { ad: data.ad || data.urunAdi || '', alis: parseFloat(data.alis || data.alisFiyati || 0), bip: parseFloat(data.bip || 0) };
      });
      setUrunCache(cache);
    } catch (err) { console.error('Ürün cache:', err); }
  };

  const kampanyalariCek = async () => {
    try {
      const snap = await getDocs(collection(db, 'kampanyalar'));
      const liste = snap.docs.map(d => ({ id: d.id, ...d.data() } as KampanyaAdmin)).filter(k => k.aktif && (k.subeKodu === 'GENEL' || k.subeKodu === subeKodu));
      setKampanyaAdminListesi(liste);
    } catch (err) { console.error('Kampanyalar:', err); }
  };

  const yesilEtiketleriCek = async () => {
    try {
      const snap = await getDocs(collection(db, 'yesilEtiketler'));
      const liste = snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, urunKodu: data.urunKodu || '', urunTuru: data.urunTuru || '', maliyet: parseFloat(data.maliyet || 0) } as YesilEtiketAdmin;
      }).filter(e => e.urunKodu && e.maliyet > 0);
      setYesilEtiketAdminList(liste);
    } catch (err) { console.error('Yeşil etiketler:', err); }
  };

  const fetchSatisDetay = async () => {
    try {
      setLoading(true);
      const sube = getSubeByKod(subeKodu as any);
      if (!sube) return;
      const satisDoc = await getDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!));
      if (satisDoc.exists()) {
        const data = { id: satisDoc.id, ...satisDoc.data() } as SatisTeklifFormu;
        setSatis(data);
        setUrunler(data.urunler || []);
        setManuelSatisTutari((data as any).toplamTutar || null);

        const loadedPesinatlar: any[] = (data as any).pesinatlar || [];
        const loadedHavaleler: any[] = (data as any).havaleler || [];
        const loadedKartlar: KartOdeme[] = data.kartOdemeler || [];

        const pList = loadedPesinatlar.length > 0 ? loadedPesinatlar : (data.pesinatTutar ? [{ id: '1', tutar: data.pesinatTutar, aciklama: '' }] : []);
        const hList = loadedHavaleler.length > 0 ? loadedHavaleler : (data.havaleTutar ? [{ id: '1', tutar: data.havaleTutar, banka: (data as any).havaleBanka || HAVALE_BANKALARI[0] }] : []);

        setPesinatlar(pList);
        setHavaleler(hList);
        setKartOdemeler(loadedKartlar);
        setOrijinalPesinatlar(JSON.parse(JSON.stringify(pList)));
        setOrijinalHavaleler(JSON.parse(JSON.stringify(hList)));
        setOrijinalKartOdemeler(JSON.parse(JSON.stringify(loadedKartlar)));

        setFaturaNo(data.faturaNo || '');
        setServisNotu(data.servisNotu || '');
        setNotlar((data as any).notlar || '');

        // ✅ 2.1 Teslim Edildi yükle
        setTeslimEdildiMi((data as any).teslimEdildiMi === true);

        // ✅ 2.2 Müşteri bilgilerini yükle
        const mb = data.musteriBilgileri as any;
        setMusteriIsim(mb?.isim || '');
        setMusteriUnvan(mb?.unvan || '');
        setMusteriVkNo(mb?.vkNo || '');
        setMusteriVd(mb?.vd || '');
        setMusteriAdres(mb?.adres || '');
        setMusteriFaturaAdresi(mb?.faturaAdresi || '');
        setMusteriCep(mb?.cep || '');

        if (data.kampanyalar) setSeciliKampanyaIds(data.kampanyalar.map((k: any) => k.id).filter(Boolean));

        const toDateStr = (d: any) => {
          if (!d) return '';
          try { const date = typeof d === 'object' && 'toDate' in d ? d.toDate() : new Date(d); return date.toISOString().split('T')[0]; } catch { return ''; }
        };
        const satisT = toDateStr((data as any).tarih || (data as any).olusturmaTarihi);
        setSatisTarihi(satisT);

        if (data.marsGirisleri && Array.isArray(data.marsGirisleri) && data.marsGirisleri.length > 0) {
          setMarsListesi(data.marsGirisleri);
        } else {
          const liste: MarsGirisi[] = [{ marsNo: data.marsNo || '', teslimatTarihi: toDateStr(data.teslimatTarihi), etiket: 'Orijinal' }];
          if (data.yeniMarsNo || data.yeniTeslimatTarihi) {
            liste.push({ marsNo: data.yeniMarsNo || '', teslimatTarihi: toDateStr(data.yeniTeslimatTarihi), etiket: '2. Sipariş' });
          }
          setMarsListesi(liste);
        }
      }
    } catch (error) { console.error('Satış detayı yüklenemedi:', error); } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchSatisDetay();
    urunCacheYukle();
    kampanyalariCek();
    yesilEtiketleriCek();
    kesintiCacheYukle();
  }, [id]);

  const handleUrunChange = (index: number, field: keyof Urun, value: any) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = { ...yeniUrunler[index], [field]: field === 'adet' || field === 'alisFiyati' || field === 'bip' ? parseFloat(value) || 0 : value };
    if (field === 'kod') {
      const trimmed = String(value).trim();
      const eslesme = urunCache[trimmed];
      if (eslesme) yeniUrunler[index] = { ...yeniUrunler[index], kod: trimmed, ad: eslesme.ad || yeniUrunler[index].ad, alisFiyati: eslesme.alis, bip: eslesme.bip };
    }
    setUrunler(yeniUrunler);
    if (field === 'alisFiyati' || field === 'adet') setManuelSatisTutari(null);
  };

  const urunEkle = () => setUrunler(prev => [...prev, { id: Date.now().toString(), kod: '', ad: '', adet: 1, alisFiyati: 0, bip: 0 }]);
  const urunSil = (index: number) => { if (urunler.length > 1) setUrunler(prev => prev.filter((_, i) => i !== index)); };

  const kampanyaToggle = (kampanyaId: string) => setSeciliKampanyaIds(prev => prev.includes(kampanyaId) ? prev.filter(k => k !== kampanyaId) : [...prev, kampanyaId]);
  const seciliKampanyalar = kampanyaAdminListesi.filter(k => seciliKampanyaIds.includes(k.id!));

  const eslesenYesilEtiketler = () => {
    const result: { urunKodu: string; urunAdi: string; maliyet: number; adet: number }[] = [];
    for (const urun of urunler) {
      const eslesen = yesilEtiketAdminList.find(y => y.urunKodu.trim().toLowerCase() === urun.kod.trim().toLowerCase());
      if (eslesen) result.push({ urunKodu: urun.kod, urunAdi: urun.ad, maliyet: eslesen.maliyet, adet: urun.adet });
    }
    return result;
  };

  const yesilEtiketToplamIndirim = () => eslesenYesilEtiketler().reduce((t, e) => t + e.maliyet * e.adet, 0);

  const kartEkle = () => setKartOdemeler(prev => [...prev, { id: Date.now().toString(), banka: BANKALAR[0], taksitSayisi: 1, tutar: 0, kesintiOrani: 0 }]);
  const kartSil = (index: number) => setKartOdemeler(prev => prev.filter((_, i) => i !== index));
  const handleKartChange = (index: number, field: keyof KartOdeme, value: any) => {
    const yeniKartlar = [...kartOdemeler];
    const yeniKart = { ...yeniKartlar[index], [field]: field === 'tutar' ? (parseFloat(value) || 0) : field === 'taksitSayisi' ? (parseInt(value) || 1) : value };
    if (field === 'banka' || field === 'taksitSayisi') {
      const banka = field === 'banka' ? value : yeniKartlar[index].banka;
      const taksit = field === 'taksitSayisi' ? (parseInt(value) || 1) : yeniKartlar[index].taksitSayisi;
      yeniKart.kesintiOrani = getKesintiOrani(banka, taksit);
    }
    yeniKartlar[index] = yeniKart;
    setKartOdemeler(yeniKartlar);
  };

  const pesinatEkle = () => setPesinatlar(prev => [...prev, { id: Date.now().toString(), tutar: 0, aciklama: '' }]);
  const pesinatSil = (pesinatId: string) => setPesinatlar(prev => prev.filter(p => p.id !== pesinatId));
  const handlePesinatChange = (pesinatId: string, field: 'tutar' | 'aciklama', value: any) => {
    setPesinatlar(prev => prev.map(p => p.id === pesinatId ? { ...p, [field]: field === 'tutar' ? (parseFloat(value) || 0) : value } : p));
  };

  const havaleEkle = () => setHavaleler(prev => [...prev, { id: Date.now().toString(), tutar: 0, banka: HAVALE_BANKALARI[0] }]);
  const havaleSil = (havaleId: string) => setHavaleler(prev => prev.filter(h => h.id !== havaleId));
  const handleHavaleChange = (havaleId: string, field: 'tutar' | 'banka', value: any) => {
    setHavaleler(prev => prev.map(h => h.id === havaleId ? { ...h, [field]: field === 'tutar' ? (parseFloat(value) || 0) : value } : h));
  };

  const marsEkle = () => {
    if (marsListesi.length >= MAX_MARS) return;
    setMarsListesi(prev => [...prev, { marsNo: '', teslimatTarihi: '', etiket: etiketAd(prev.length) }]);
  };
  const marsSil = (index: number) => { if (index === 0) return; setMarsListesi(prev => prev.filter((_, i) => i !== index)); };
  const marsGuncelle = (index: number, field: 'marsNo' | 'teslimatTarihi', value: string) => {
    if (field === 'marsNo') {
      // Sadece rakam kabul et
      const sadeceSayi = value.replace(/\D/g, '');
      setMarsListesi(prev => prev.map((item, i) => i === index ? { ...item, marsNo: sadeceSayi } : item));
      // Anlık validasyon
      if (sadeceSayi && !isMarsNoGecerli(sadeceSayi)) {
        setMarsNoHatalar(prev => ({ ...prev, [index]: `Mars No:  ile başlayan 10 haneli sayı olmalıdır. (${sadeceSayi.length}/10)` }));
      } else {
        setMarsNoHatalar(prev => { const copy = { ...prev }; delete copy[index]; return copy; });
      }
    } else {
      setMarsListesi(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
    }
  };

  const handleFaturaNoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeFaturaNo(e.target.value);
    setFaturaNo(normalized);
    setFaturaNoHata(false);
    setFaturaNoHataMesaj('');
  };

  const handleFaturaNoBlur = () => {
    if (faturaNo && !isFaturaNoGecerli(faturaNo)) {
      setFaturaNoHata(true);
      setFaturaNoHataMesaj("Fatura No yalnızca 4 haneli rakam veya 'Kesilmedi' olabilir.");
    }
  };

  const isTeslimatTarihiGecerli = (tarih: string): boolean => {
    if (!tarih || !satisTarihi) return true;
    return tarih >= satisTarihi;
  };

  const alisToplamı = () => urunler.reduce((s, u) => s + u.alisFiyati * u.adet, 0);
  const bipToplamı = () => urunler.reduce((s, u) => s + (u.bip || 0) * u.adet, 0);
  const toplamTutar = () => manuelSatisTutari ?? 0;
  const kampanyaToplamiHesapla = () => seciliKampanyalar.reduce((t, k) => t + (k.tutar || 0), 0);

  const toplamMaliyet = () => {
    const normalMaliyet = Math.max(0, alisToplamı() - bipToplamı() - kampanyaToplamiHesapla());
    const etiketler = eslesenYesilEtiketler();
    if (etiketler.length === 0) return normalMaliyet;
    let yesilEtiketliAlis = 0;
    for (const e of etiketler) {
      const urun = urunler.find(u => u.kod.trim().toLowerCase() === e.urunKodu.trim().toLowerCase());
      if (urun) yesilEtiketliAlis += urun.alisFiyati * urun.adet;
    }
    return Math.max(0, normalMaliyet - yesilEtiketliAlis + yesilEtiketToplamIndirim());
  };

  const pesinatToplam = () => pesinatlar.reduce((t, p) => t + (p.tutar || 0), 0);
  const havaleToplam = () => havaleler.reduce((t, h) => t + (h.tutar || 0), 0);
  const kartBrutToplam = () => kartOdemeler.reduce((t, k) => t + (k.tutar || 0), 0);
  const kartKesintiToplam = () => kartOdemeler.reduce((t, k) => t + (k.tutar * (k.kesintiOrani || 0)) / 100, 0);
  const kartNetToplam = () => kartBrutToplam() - kartKesintiToplam();
  const toplamOdenen = () => pesinatToplam() + havaleToplam() + kartBrutToplam();
  const hesabaGecenToplam = () => pesinatToplam() + havaleToplam() + kartNetToplam();
  const acikHesap = () => { const a = toplamTutar() - toplamOdenen(); return a > 0 ? a : 0; };
  const karZarar = () => hesabaGecenToplam() - toplamMaliyet();

  const odemeDeğisiklikleriniKasayaYansit = async () => {
    if (!satis || !subeKodu || !currentUser) return;
    const musteriIsimVal = (satis as any).musteriBilgileri?.isim ?? '—';
    const satisKodu = satis.satisKodu ?? id ?? '';
    const satisId = satis.id ?? id ?? '';
    const gun = bugunStr();
    const yapan = `${currentUser.ad} ${currentUser.soyad}`;
    const yapanId = currentUser.uid || '';

    const eskiNakit = orijinalPesinatlar.reduce((t, p) => t + (p.tutar || 0), 0);
    const yeniNakit = pesinatToplam();
    const nakitFark = yeniNakit - eskiNakit;

    const eskiHavale = orijinalHavaleler.reduce((t, h) => t + (h.tutar || 0), 0);
    const yeniHavale = havaleToplam();
    const havaleFark = yeniHavale - eskiHavale;

    const eskiKart = orijinalKartOdemeler.reduce((t, k) => t + (k.tutar || 0), 0);
    const yeniKart = kartBrutToplam();
    const kartFark = yeniKart - eskiKart;

    if (nakitFark === 0 && havaleFark === 0 && kartFark === 0) return;

    const kasaNakit  = Math.max(0, nakitFark);
    const kasaHavale = Math.max(0, havaleFark);
    const kasaKart   = Math.max(0, kartFark);

    if (kasaNakit > 0 || kasaHavale > 0 || kasaKart > 0) {
      const satisTarihiRaw = (satis as any).olusturmaTarihi ?? (satis as any).tarih;
      const satisTarihiStr = satisTarihiRaw ? (() => { try { const d = typeof satisTarihiRaw.toDate === 'function' ? satisTarihiRaw.toDate() : new Date(satisTarihiRaw); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; } catch { return undefined; } })() : undefined;
      const ilkKart   = kartOdemeler.find(k => k.tutar > 0);
      const ilkHavale = havaleler.find(h => h.tutar > 0);
      await kasaTahsilatEkle({ subeKodu, gun, satisId, satisKodu, musteriIsim: musteriIsimVal, nakitTutar: kasaNakit, kartTutar: kasaKart, havaleTutar: kasaHavale, yapan, yapanId, aciklama: 'Satış güncelleme — ödeme eklendi', satisTarihi: satisTarihiStr, kartBanka: ilkKart?.banka ?? undefined, havaleBanka: ilkHavale?.banka ?? undefined });
    }

    const iadeNakit  = nakitFark  < 0 ? Math.abs(nakitFark)  : 0;
    const iadeHavale = havaleFark < 0 ? Math.abs(havaleFark) : 0;
    const iadeKart   = kartFark   < 0 ? Math.abs(kartFark)   : 0;

    if (iadeNakit > 0 || iadeHavale > 0 || iadeKart > 0) {
      await kasaIadeEkle({ subeKodu, gun, satisId, satisKodu, musteriIsim: musteriIsimVal, nakitTutar: iadeNakit, kartTutar: iadeKart, havaleTutar: iadeHavale, yapan, yapanId, iadeSebebi: 'Satış düzenleme — ödeme azaltıldı' });
    }
  };

  const satisiIptalEt = async () => {
    if (!satis?.id) return;
    const sube = getSubeByKod(subeKodu as any);
    if (!sube) return;
    setIptalIslemYapiliyor(true);

    if (!isAdmin) {
      try {
        await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), { iptalTalebi: true, iptalTalepTarihi: new Date(), guncellemeTarihi: new Date() });
        setSatis(prev => prev ? { ...prev, iptalTalebi: true } as any : prev);
        setIptalPopup(false);
        alert('✅ İptal talebiniz gönderildi. Admin onayı bekleniyor.');
      } catch { alert('❌ İptal talebi gönderilemedi!'); }
      finally { setIptalIslemYapiliyor(false); }
      return;
    }

    try {
      const toplamOdenenTutar = pesinatToplam() + havaleToplam() + kartBrutToplam();
      const yeniIadeDurumu = toplamOdenenTutar > 0 ? 'IADE_GEREKIYOR' : undefined;
      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), { satisDurumu: 'IPTAL', onayDurumu: false, iptalTarihi: new Date(), guncellemeTarihi: new Date(), ...(yeniIadeDurumu ? { iadeDurumu: yeniIadeDurumu } : {}) });
      setSatis(prev => prev ? { ...prev, satisDurumu: 'IPTAL', iadeDurumu: yeniIadeDurumu } as any : prev);
      setIptalPopup(false);
      if (yeniIadeDurumu) {
        alert(`✅ Satış iptal edildi.\n⚠️ ${formatPrice(toplamOdenenTutar)} tutarında ödeme var — İade Gerekiyor olarak işaretlendi.`);
      } else {
        alert('✅ Satış iptal edildi.');
      }
    } catch { alert('❌ İptal işlemi başarısız!'); }
    finally { setIptalIslemYapiliyor(false); }
  };

  const iadeOnayla = async () => {
    if (!satis?.id || !subeKodu || !currentUser) return;
    const sube = getSubeByKod(subeKodu as any);
    if (!sube) return;
    setIptalIslemYapiliyor(true);
    try {
      const musteriIsimVal = (satis as any).musteriBilgileri?.isim ?? '—';
      const satisKodu = satis.satisKodu ?? id ?? '';
      const satisId = satis.id!;
      const gun = bugunStr();
      const yapan = `${currentUser.ad} ${currentUser.soyad}`;
      const yapanId = currentUser.uid || '';
      const nakitTutar  = pesinatToplam();
      const havaleTutar = havaleToplam();
      const kartTutar   = kartBrutToplam();
      await kasaIadeEkle({ subeKodu, gun, satisId, satisKodu, musteriIsim: musteriIsimVal, nakitTutar, kartTutar, havaleTutar, yapan, yapanId, iadeSebebi: 'Satış iptali iadesi' });
      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), { iadeDurumu: 'IADE_ODENDI', iadeOnayTarihi: new Date(), iadeOnaylayan: yapan, guncellemeTarihi: new Date() });
      setSatis(prev => prev ? { ...prev, iadeDurumu: 'IADE_ODENDI' } as any : prev);
      setIadePopup(false);
      const toplam = nakitTutar + havaleTutar + kartTutar;
      alert(`✅ İade onaylandı!\n💵 ${formatPrice(toplam)} bugünün kasasından düşüldü.`);
    } catch (err) { alert('❌ İade işlemi başarısız: ' + (err as Error).message); }
    finally { setIptalIslemYapiliyor(false); }
  };

  const satisiIptaldenCikar = async () => {
    if (!satis?.id) return;
    const sube = getSubeByKod(subeKodu as any);
    if (!sube) return;
    setIptalIslemYapiliyor(true);
    try {
      const yeniOnay = iptaldenCikarStatusu === 'ONAYLI';
      const mevcutIadeDurumu: string | undefined = (satis as any).iadeDurumu;
      const nakitTutar = pesinatToplam();
      const havaleTutar = havaleToplam();
      const kartTutar = kartBrutToplam();
      const toplamOdenenVal = nakitTutar + havaleTutar + kartTutar;

      if (mevcutIadeDurumu === 'IADE_ODENDI' && toplamOdenenVal > 0 && currentUser && subeKodu) {
        await kasaTahsilatEkle({ subeKodu, gun: bugunStr(), satisId: satis.id!, satisKodu: satis.satisKodu ?? id ?? '', musteriIsim: (satis as any).musteriBilgileri?.isim ?? '—', nakitTutar, kartTutar, havaleTutar, yapan: `${currentUser.ad} ${currentUser.soyad}`, yapanId: currentUser.uid || '', aciklama: 'İptalden çıkarma — iade geri alındı', satisTarihi: undefined });
      }

      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, satis.id), { satisDurumu: iptaldenCikarStatusu, onayDurumu: yeniOnay, iptalTarihi: null, iadeDurumu: null, guncellemeTarihi: new Date() });
      setSatis(prev => prev ? { ...prev, satisDurumu: iptaldenCikarStatusu, onayDurumu: yeniOnay, iadeDurumu: null } as any : prev);
      setIptaldenCikarPopup(false);

      if (mevcutIadeDurumu === 'IADE_ODENDI' && toplamOdenenVal > 0) {
        alert(`✅ Satış "${iptaldenCikarStatusu === 'ONAYLI' ? 'Onaylı' : 'Beklemede'}" statüsüne alındı.\n💵 ${formatPrice(toplamOdenenVal)} bugünün kasasına geri eklendi.`);
      } else {
        alert(`✅ Satış "${iptaldenCikarStatusu === 'ONAYLI' ? 'Onaylı' : 'Beklemede'}" statüsüne alındı.`);
      }
    } catch (err) { alert('❌ İşlem başarısız: ' + (err as Error).message); }
    finally { setIptalIslemYapiliyor(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (onayliKilitli) { alert('❌ Onaylı satışları düzenleme yetkiniz yok.'); return; }
    if (isIptal && !isAdmin) { alert('❌ İptal edilmiş satışı düzenleyemezsiniz.'); return; }

    // Fatura No format kontrolü
    if (faturaNo && !isFaturaNoGecerli(faturaNo)) {
      setFaturaNoHata(true);
      setFaturaNoHataMesaj("Fatura No yalnızca 4 haneli rakam veya 'Kesilmedi' olabilir.");
      alert("❌ Fatura No yalnızca 4 haneli rakam veya 'Kesilmedi' olabilir.");
      return;
    }

    // ✅ #3 Mars No validasyon — tüm girişler kontrol edilir
    for (let i = 0; i < marsListesi.length; i++) {
      const giris = marsListesi[i];
      if (giris.marsNo && !isMarsNoGecerli(giris.marsNo)) {
        alert(`❌ ${etiketAd(i)} Mars No geçersiz!\nGüncel yıl ile başlayan 10 haneli sayı olmalıdır.\nGirilen: ${giris.marsNo}`);
        return;
      }
    }

    // Teslimat tarihi >= satış tarihi
    for (let i = 0; i < marsListesi.length; i++) {
      const giris = marsListesi[i];
      if (giris.teslimatTarihi && !isTeslimatTarihiGecerli(giris.teslimatTarihi)) {
        alert(`❌ Teslimat tarihi, satış tarihinden önce olamaz. (${etiketAd(i)})`);
        return;
      }
    }

    // Teslimat tarihi doluysa Mars No zorunlu
    const orijinalGiris = marsListesi[0];
    if (orijinalGiris?.teslimatTarihi && !orijinalGiris?.marsNo?.trim()) {
      alert('❌ Teslimat tarihi girildiğinde Mars numarası zorunludur.');
      return;
    }

    const _odenen = toplamOdenen();
    const _tutar  = toplamTutar();
    if (_odenen > _tutar && _tutar > 0) {
      alert(`❌ Toplam ödeme (${formatPrice(_odenen)}) satış tutarını (${formatPrice(_tutar)}) aşıyor!`);
      return;
    }

    try {
      const sube = getSubeByKod(subeKodu as any);
      if (!sube || !satis) return;

      if (!isAdmin) {
        const freshDoc = await getDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!));
        if (freshDoc.exists()) {
          const freshData = freshDoc.data();
          if (freshData.onayDurumu === true && freshData.satisDurumu !== 'IPTAL') {
            alert('❌ Bu satış az önce admin tarafından onaylandı.');
            navigate('/dashboard');
            return;
          }
        }
      }

      await odemeDeğisiklikleriniKasayaYansit();

      const orijinal = marsListesi[0];
      const sonGiris = [...marsListesi].reverse().find(m => m.marsNo || m.teslimatTarihi) || orijinal;
      const etiketler = eslesenYesilEtiketler();

      const oldSnap = await getDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!));
      const oldData = oldSnap.exists() ? oldSnap.data() : {};

      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!), {
        // ✅ 2.2 Güncellenmiş müşteri bilgileri
        musteriBilgileri: {
          ...((satis as any).musteriBilgileri || {}),
          isim: musteriIsim,
          unvan: musteriUnvan,
          vkNo: musteriVkNo,
          vd: musteriVd,
          adres: musteriAdres,
          faturaAdresi: musteriFaturaAdresi,
          cep: musteriCep,
        },
        // teslimatAlacakKisi KALDIRILDI — isim alanına yazılır
        urunler: urunler.map(u => ({
          ...u,
          alisFiyatSnapshot: (u as any).alisFiyatSnapshot ?? u.alisFiyati,
          bipSnapshot: (u as any).bipSnapshot ?? (u.bip || 0),
          greenPriceSnapshot: (u as any).greenPriceSnapshot ?? null,
          snapshotTarihi: (u as any).snapshotTarihi || new Date().toISOString(),
        })),
        kampanyalar: seciliKampanyalar.map(k => ({ id: k.id!, ad: k.ad, tutar: k.tutar || 0 })),
        kampanyaToplami: kampanyaToplamiHesapla(),
        yesilEtiketler: etiketler.map(e => ({ id: Date.now().toString(), urunKodu: e.urunKodu, ad: e.urunAdi, alisFiyati: e.maliyet, tutar: e.maliyet * e.adet })),
        pesinatlar, havaleler,
        kartOdemeler: kartOdemeler.map(k => ({
          ...k,
          commissionRateSnapshot: k.kesintiOrani || 0,
          commissionAmountSnapshot: (k.tutar * (k.kesintiOrani || 0)) / 100,
          netAmountSnapshot: k.tutar - (k.tutar * (k.kesintiOrani || 0)) / 100,
          snapshotTarihi: (k as any).snapshotTarihi || new Date().toISOString(),
        })),
        pesinatToplam: pesinatToplam(), havaleToplam: havaleToplam(),
        kartBrutToplam: kartBrutToplam(), kartKesintiToplam: kartKesintiToplam(),
        kartNetToplam: kartNetToplam(), toplamOdenen: toplamOdenen(),
        hesabaGecenToplam: hesabaGecenToplam(), acikHesap: acikHesap(),
        odemeDurumu: acikHesap() > 0 ? 'ACIK_HESAP' : 'ODENDI',
        pesinatTutar: pesinatToplam(), havaleTutar: havaleToplam(),
        marsNo: orijinal.marsNo, faturaNo, servisNotu,
        notlar: notlar.trim() || null,
        // ✅ 2.1 Teslim Edildi kaydediliyor
        teslimEdildiMi,
        toplamTutar: toplamTutar(), zarar: karZarar(),
        teslimatTarihi: orijinal.teslimatTarihi ? new Date(orijinal.teslimatTarihi) : null,
        yeniMarsNo: marsListesi.length > 1 ? sonGiris.marsNo : null,
        yeniTeslimatTarihi: marsListesi.length > 1 && sonGiris.teslimatTarihi ? new Date(sonGiris.teslimatTarihi) : null,
        marsGirisleri: marsListesi,
        guncellemeTarihi: new Date()
      });

      try {
        const newSnap = await getDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!));
        const newData = newSnap.exists() ? newSnap.data() : {};
        await writeSatisAuditLog({ saleId: id!, satisKodu: satis.satisKodu || '', dbPath: sube.dbPath, branchId: subeKodu || '', branchName: sube.ad, oldData, newData, userId: currentUser?.uid || '', userName: `${currentUser?.ad || ''} ${currentUser?.soyad || ''}`.trim() });
      } catch (logErr) { console.error('Audit log yazılamadı:', logErr); }

      alert('✅ Satış başarıyla güncellendi!');
      navigate('/dashboard');
    } catch (error) {
      console.error('Güncelleme hatası:', error);
      alert('❌ Bir hata oluştu!');
    }
  };

  if (loading) return <Layout pageTitle="Satış Düzenle"><div className="duzenle-loading">Yükleniyor...</div></Layout>;
  if (!satis) return <Layout pageTitle="Satış Düzenle"><div className="duzenle-not-found"><h2>Satış Bulunamadı</h2><button onClick={() => navigate('/dashboard')} className="duzenle-btn-back">Dashboard'a Dön</button></div></Layout>;

  const marsEklenebilir = marsListesi.length < MAX_MARS;

  const iadeBadgeStyle = (durum: string) => {
    if (durum === 'IADE_ODENDI')    return { background: '#dcfce7', color: '#16a34a', border: '1px solid #86efac' };
    if (durum === 'IADE_ONAYLANDI') return { background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' };
    if (durum === 'IADE_BEKLIYOR')  return { background: '#fef9c3', color: '#92400e', border: '1px solid #fde68a' };
    return { background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5' };
  };

  const iadeBadgeMetin = (durum: string) => ({
    'IADE_GEREKIYOR': '⚠️ İade Gerekiyor', 'IADE_BEKLIYOR': '🔄 İade Bekliyor',
    'IADE_ONAYLANDI': '✅ İade Onaylandı', 'IADE_ODENDI': '💚 İade Ödendi',
  }[durum] ?? durum);

  return (
    <Layout pageTitle={`Düzenle: ${satis.satisKodu}`}>

      {/* ══════ İPTAL POPUP ══════ */}
      {iptalPopup && (
        <div className="duzenle-popup-overlay">
          <div className="duzenle-popup">
            <div className="duzenle-popup-ikon">{isAdmin ? '🚫' : '📨'}</div>
            <h3 className="duzenle-popup-baslik">{isAdmin ? 'Satışı İptal Et' : 'İptal Talebi Gönder'}</h3>
            <p className="duzenle-popup-mesaj">
              <strong>{satis.satisKodu}</strong> kodlu satış için {isAdmin ? 'iptal işlemi yapılsın mı?' : 'admin onayına iptal talebi gönderilsin mi?'}
              <br />
              {isAdmin && pesinatToplam() + havaleToplam() + kartBrutToplam() > 0 && (
                <span style={{ color: '#dc2626', fontWeight: 600 }}>⚠️ {formatPrice(pesinatToplam() + havaleToplam() + kartBrutToplam())} tahsilat var. İptal sonrası iade gerekecek.</span>
              )}
              <br /><span className="duzenle-popup-alt-not">{isAdmin ? 'Satış silinmeyecek, listede görünmeye devam edecek.' : 'Talebiniz admin tarafından onaylandığında satış iptal edilecek.'}</span>
            </p>
            <div className="duzenle-popup-butonlar">
              <button className="duzenle-popup-hayir" onClick={() => setIptalPopup(false)} disabled={iptalIslemYapiliyor}>Hayır</button>
              <button className="duzenle-popup-evet duzenle-popup-evet--iptal" onClick={satisiIptalEt} disabled={iptalIslemYapiliyor}>
                {iptalIslemYapiliyor ? 'İşleniyor...' : isAdmin ? 'Evet, İptal Et' : 'Evet, Talep Gönder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ İADE ONAYLA POPUP ══════ */}
      {iadePopup && (
        <div className="duzenle-popup-overlay">
          <div className="duzenle-popup">
            <div className="duzenle-popup-ikon">💰</div>
            <h3 className="duzenle-popup-baslik">İadeyi Onayla</h3>
            <p className="duzenle-popup-mesaj">
              <strong>{satis.satisKodu}</strong> — müşteriye iade yapıldı mı?
              <br /><span style={{ fontWeight: 700, color: '#dc2626', fontSize: 18 }}>{formatPrice(pesinatToplam() + havaleToplam() + kartBrutToplam())}</span>
              <br /><span className="duzenle-popup-alt-not">Bu tutar <strong>bugünün ({bugunStr()}) kasasından</strong> düşülecek.</span>
            </p>
            <div className="duzenle-popup-butonlar">
              <button className="duzenle-popup-hayir" onClick={() => setIadePopup(false)} disabled={iptalIslemYapiliyor}>Vazgeç</button>
              <button className="duzenle-popup-evet" style={{ background: '#16a34a' }} onClick={iadeOnayla} disabled={iptalIslemYapiliyor}>
                {iptalIslemYapiliyor ? 'İşleniyor...' : '✅ Evet, İade Yapıldı'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ İPTALDEN ÇIKAR POPUP ══════ */}
      {iptaldenCikarPopup && (
        <div className="duzenle-popup-overlay">
          <div className="duzenle-popup">
            <div className="duzenle-popup-ikon">♻️</div>
            <h3 className="duzenle-popup-baslik">İptalden Çıkar</h3>
            <p className="duzenle-popup-mesaj"><strong>{satis.satisKodu}</strong> kodlu satışı iptalden çıkarmak istediğinizden emin misiniz?</p>
            <div className="duzenle-popup-statu-sec">
              <p className="duzenle-popup-statu-baslik">Yeni Statü Seçin:</p>
              <div className="duzenle-popup-statu-secenekler">
                <label className={`duzenle-popup-statu-btn ${iptaldenCikarStatusu === 'BEKLEMEDE' ? 'secili' : ''}`}>
                  <input type="radio" name="statu" value="BEKLEMEDE" checked={iptaldenCikarStatusu === 'BEKLEMEDE'} onChange={() => setIptaldenCikarStatusu('BEKLEMEDE')} />⏳ Beklemede
                </label>
                <label className={`duzenle-popup-statu-btn ${iptaldenCikarStatusu === 'ONAYLI' ? 'secili' : ''}`}>
                  <input type="radio" name="statu" value="ONAYLI" checked={iptaldenCikarStatusu === 'ONAYLI'} onChange={() => setIptaldenCikarStatusu('ONAYLI')} />✅ Onaylı
                </label>
              </div>
            </div>
            <div className="duzenle-popup-butonlar">
              <button className="duzenle-popup-hayir" onClick={() => setIptaldenCikarPopup(false)} disabled={iptalIslemYapiliyor}>Hayır</button>
              <button className="duzenle-popup-evet duzenle-popup-evet--cikar" onClick={satisiIptaldenCikar} disabled={iptalIslemYapiliyor}>
                {iptalIslemYapiliyor ? 'İşleniyor...' : 'Evet, İptalden Çıkar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isIptal && (
        <div className="duzenle-iptal-banner">
          🚫 Bu satış <strong>İPTAL</strong> statüsündedir.{!isAdmin && ' Düzenleme yapılamaz.'}
          {iadeDurumu && <span style={{ marginLeft: 16, padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 700, ...iadeBadgeStyle(iadeDurumu) }}>{iadeBadgeMetin(iadeDurumu)}</span>}
          {isAdmin && iadeDurumu && iadeDurumu !== 'IADE_ODENDI' && (
            <button type="button" onClick={() => setIadePopup(true)} style={{ marginLeft: 16, padding: '6px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>💰 İadeyi Onayla</button>
          )}
        </div>
      )}

      {onayliKilitli && (
        <div style={{ padding: '14px 18px', marginBottom: 16, borderRadius: 12, background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', border: '2px solid #93c5fd', color: '#1e40af', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontWeight: 600, fontSize: 14 }}>
          <span style={{ fontSize: 20 }}>🔒</span>
          <span>Bu satış <strong>onaylanmış</strong> — düzenleme yetkiniz yok.</span>
          <span style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 20, background: '#dbeafe', border: '1px solid #93c5fd', fontSize: 12, fontWeight: 700, color: '#1d4ed8', whiteSpace: 'nowrap' }}>İptal talebi gönderebilirsiniz ↓</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="duzenle-form">

        {/* ✅ 2.2 MÜŞTERİ BİLGİLERİ — Düzenlenebilir */}
        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Müşteri Bilgileri</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            <div>
              <label className="duzenle-label">İsim / Ad Soyad *</label>
              <input type="text" value={musteriIsim} onChange={e => setMusteriIsim(e.target.value)} placeholder="Müşteri adı soyadı" className="duzenle-input" disabled={alanlarKilitli} required />
            </div>
            <div>
              <label className="duzenle-label">Ünvan</label>
              <input type="text" value={musteriUnvan} onChange={e => setMusteriUnvan(e.target.value)} placeholder="Şirket ünvanı" className="duzenle-input" disabled={alanlarKilitli} />
            </div>
            <div>
              <label className="duzenle-label">Vergi Kimlik No</label>
              <input type="text" value={musteriVkNo} onChange={e => setMusteriVkNo(e.target.value)} placeholder="VK No" className="duzenle-input" disabled={alanlarKilitli} />
            </div>
            <div>
              <label className="duzenle-label">Vergi Dairesi</label>
              <input type="text" value={musteriVd} onChange={e => setMusteriVd(e.target.value)} placeholder="Vergi dairesi" className="duzenle-input" disabled={alanlarKilitli} />
            </div>
            <div>
              <label className="duzenle-label">Adres</label>
              <input type="text" value={musteriAdres} onChange={e => setMusteriAdres(e.target.value)} placeholder="Teslimat adresi" className="duzenle-input" disabled={alanlarKilitli} />
            </div>
            <div>
              <label className="duzenle-label">Fatura Adresi</label>
              <input type="text" value={musteriFaturaAdresi} onChange={e => setMusteriFaturaAdresi(e.target.value)} placeholder="Fatura adresi" className="duzenle-input" disabled={alanlarKilitli} />
            </div>
            <div>
              <label className="duzenle-label">Cep Telefonu</label>
              <input type="text" value={musteriCep} onChange={e => setMusteriCep(e.target.value)} placeholder="Cep tel." className="duzenle-input" disabled={alanlarKilitli} />
            </div>
          </div>
          <small style={{ color: '#9ca3af', fontSize: 11, marginTop: 6, display: 'block' }}>
            💡 Teslim alacak kişi bilgisi "İsim" alanına yazılabilir.
          </small>
        </div>

        {/* ÜRÜNLER */}
        <div className="duzenle-section">
          <div className="duzenle-section-header">
            <h2 className="duzenle-section-title">Ürünler</h2>
            {!alanlarKilitli && <button type="button" onClick={urunEkle} className="duzenle-btn-add">+ Ürün Ekle</button>}
          </div>
          <div className="duzenle-urun-header">
            <span>Ürün Kodu</span><span>Ürün Adı</span><span>Adet</span><span>Alış (TL)</span><span>BİP (TL)</span><span></span>
          </div>
          {urunler.map((urun, index) => (
            <div key={urun.id} className="duzenle-urun-row">
              <div className="duzenle-urun-kod-wrap">
                <input type="text" value={urun.kod} onChange={e => handleUrunChange(index, 'kod', e.target.value)} placeholder="Ürün kodu" className="duzenle-input mono" disabled={alanlarKilitli} />
                {urunCache[urun.kod?.trim()] && <span className="urun-found-badge">✓ Eşleşti</span>}
              </div>
              <input type="text" value={urun.ad} onChange={e => handleUrunChange(index, 'ad', e.target.value)} placeholder="Ürün adı" className="duzenle-input" disabled={alanlarKilitli} />
              <input type="number" value={urun.adet} onChange={e => handleUrunChange(index, 'adet', e.target.value)} className="duzenle-input" min="1" disabled={alanlarKilitli} />
              <input type="number" value={urun.alisFiyati || ''} onChange={e => handleUrunChange(index, 'alisFiyati', e.target.value)} placeholder="0" className="duzenle-input mono" disabled={alanlarKilitli} />
              <input type="number" value={urun.bip || ''} onChange={e => handleUrunChange(index, 'bip', e.target.value)} placeholder="0" className="duzenle-input mono" disabled={alanlarKilitli} />
              {urunler.length > 1 && !alanlarKilitli && <button type="button" onClick={() => urunSil(index)} className="duzenle-btn-remove">Sil</button>}
            </div>
          ))}
          <div className="duzenle-toplam-bar" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>Satış Tutarı *</span>
            <input type="number" min="0" value={manuelSatisTutari ?? ''} onChange={e => setManuelSatisTutari(e.target.value === '' ? null : parseFloat(e.target.value) || 0)} placeholder="Satış tutarını girin" disabled={alanlarKilitli} style={{ fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 6, padding: '4px 10px', width: 180 }} />
          </div>
          <div className="duzenle-maliyet-notu">
            <div>Alış: {formatPrice(alisToplamı())} − BİP: {formatPrice(bipToplamı())}</div>
            {kampanyaToplamiHesapla() > 0 && <div style={{ color: '#15803d' }}>Kampanya: −{formatPrice(kampanyaToplamiHesapla())}</div>}
            {yesilEtiketToplamIndirim() > 0 && <div style={{ color: '#15803d' }}>Yeşil Etiket: +{formatPrice(yesilEtiketToplamIndirim())}</div>}
            <div style={{ fontWeight: 700 }}>TOPLAM MALİYET = {formatPrice(toplamMaliyet())}</div>
          </div>
        </div>

        {/* KAMPANYALAR */}
        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Kampanyalar</h2>
          {kampanyaAdminListesi.length === 0 ? (
            <div className="duzenle-empty-state">Aktif kampanya bulunamadı.</div>
          ) : (
            <div className="duzenle-kampanya-grid">
              {kampanyaAdminListesi.map(k => (
                <label key={k.id} className={`duzenle-kampanya-item ${seciliKampanyaIds.includes(k.id!) ? 'selected' : ''}`} style={alanlarKilitli ? { pointerEvents: 'none', opacity: 0.6 } : {}}>
                  <input type="checkbox" checked={seciliKampanyaIds.includes(k.id!)} onChange={() => kampanyaToggle(k.id!)} disabled={alanlarKilitli} />
                  <div>
                    <div className="duzenle-kampanya-ad">{k.ad}</div>
                    {k.aciklama && <div className="duzenle-kampanya-aciklama">{k.aciklama}</div>}
                    {(k.tutar || 0) > 0 && <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>İndirim: {formatPrice(k.tutar || 0)}</div>}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* ÖDEME */}
        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Ödeme Bilgileri</h2>
          <div className="duzenle-odeme-blok">
            <div className="duzenle-odeme-blok-header">
              <div className="duzenle-odeme-blok-title">💵 Peşinat</div>
              {!alanlarKilitli && <button type="button" onClick={pesinatEkle} className="duzenle-btn-sm">+ Peşinat Ekle</button>}
            </div>
            {pesinatlar.map(p => (
              <div key={p.id} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input type="number" min="0" placeholder="Tutar" value={p.tutar || ''} onChange={e => handlePesinatChange(p.id, 'tutar', e.target.value)} className="duzenle-input mono" style={{ flex: 1 }} disabled={alanlarKilitli} />
                <input type="text" placeholder="Açıklama" value={p.aciklama} onChange={e => handlePesinatChange(p.id, 'aciklama', e.target.value)} className="duzenle-input" style={{ flex: 2 }} disabled={alanlarKilitli} />
                {!alanlarKilitli && <button type="button" onClick={() => pesinatSil(p.id)} className="duzenle-btn-remove">Sil</button>}
              </div>
            ))}
            {pesinatlar.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Peşinat yok</div>}
            {pesinatToplam() > 0 && <div className="duzenle-odeme-bilgi ok">✅ Toplam: {formatPrice(pesinatToplam())}</div>}
          </div>

          <div className="duzenle-odeme-blok" style={{ marginTop: 12 }}>
            <div className="duzenle-odeme-blok-header">
              <div className="duzenle-odeme-blok-title">🏦 Havale</div>
              {!alanlarKilitli && <button type="button" onClick={havaleEkle} className="duzenle-btn-sm">+ Havale Ekle</button>}
            </div>
            {havaleler.map(h => (
              <div key={h.id} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={h.banka} onChange={e => handleHavaleChange(h.id, 'banka', e.target.value)} className="duzenle-input" style={{ flex: 2 }} disabled={alanlarKilitli}>
                  {HAVALE_BANKALARI.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <input type="number" min="0" placeholder="Tutar" value={h.tutar || ''} onChange={e => handleHavaleChange(h.id, 'tutar', e.target.value)} className="duzenle-input mono" style={{ flex: 1 }} disabled={alanlarKilitli} />
                {!alanlarKilitli && <button type="button" onClick={() => havaleSil(h.id)} className="duzenle-btn-remove">Sil</button>}
              </div>
            ))}
            {havaleler.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Havale yok</div>}
            {havaleToplam() > 0 && <div className="duzenle-odeme-bilgi ok">✅ Toplam: {formatPrice(havaleToplam())}</div>}
          </div>

          <div className="duzenle-odeme-blok" style={{ marginTop: 14 }}>
            <div className="duzenle-odeme-blok-header">
              <div className="duzenle-odeme-blok-title">💳 Kart Ödemeleri</div>
              {!alanlarKilitli && <button type="button" onClick={kartEkle} className="duzenle-btn-sm">+ Kart Ekle</button>}
            </div>
            {kartOdemeler.map((kart, index) => {
              const kesintiOrani = kart.kesintiOrani || 0;
              const net = kart.tutar - (kart.tutar * kesintiOrani) / 100;
              return (
                <div key={kart.id} className="duzenle-kart-row">
                  <div className="duzenle-kart-fields">
                    <div><label className="duzenle-label">Banka</label><select value={kart.banka} onChange={e => handleKartChange(index, 'banka', e.target.value)} className="duzenle-input" disabled={alanlarKilitli}>{BANKALAR.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
                    <div><label className="duzenle-label">Taksit</label><select value={kart.taksitSayisi} onChange={e => handleKartChange(index, 'taksitSayisi', e.target.value)} className="duzenle-input" disabled={alanlarKilitli}>{TAKSIT_SECENEKLERI.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
                    <div><label className="duzenle-label">Brüt Tutar</label><input type="number" min="0" value={kart.tutar || ''} onChange={e => handleKartChange(index, 'tutar', e.target.value)} className="duzenle-input mono" disabled={alanlarKilitli} /></div>
                    <div><label className="duzenle-label">Kesinti</label><input type="text" readOnly value={kesintiOrani > 0 ? `%${kesintiOrani}` : 'Bulunamadı'} className="duzenle-input mono" style={{ background: kesintiOrani > 0 ? '#f0fdf4' : '#fff7ed', color: kesintiOrani > 0 ? '#15803d' : '#92400e', fontWeight: 600 }} /></div>
                    {!alanlarKilitli && <button type="button" onClick={() => kartSil(index)} className="duzenle-btn-remove">Sil</button>}
                  </div>
                  {kart.tutar > 0 && <div className="duzenle-kart-net">Brüt: {formatPrice(kart.tutar)} → <strong>NET: {formatPrice(net)}</strong></div>}
                </div>
              );
            })}
            {kartOdemeler.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Kart yok</div>}
          </div>

          <div className="duzenle-kar-bar" style={{ background: karZarar() >= 0 ? '#dcfce7' : '#fee2e2', color: karZarar() >= 0 ? '#15803d' : '#dc2626' }}>
            {karZarar() >= 0 ? `📈 KÂR: ${formatPrice(karZarar())}` : `📉 ZARAR: ${formatPrice(Math.abs(karZarar()))}`}
            <span style={{ fontSize: 12, marginLeft: 12, opacity: 0.8 }}>(Hesaba Geçen: {formatPrice(hesabaGecenToplam())} — Maliyet: {formatPrice(toplamMaliyet())})</span>
          </div>

          {(() => {
            const odenen = toplamOdenen();
            const tutar  = toplamTutar();
            const fark   = odenen - tutar;
            if (tutar > 0 && fark > 0) {
              return <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '2px solid #dc2626', color: '#dc2626', fontWeight: 700, fontSize: 13 }}>🚫 Toplam ödeme ({formatPrice(odenen)}) satış tutarını ({formatPrice(tutar)}) <strong>{formatPrice(fark)}</strong> aşıyor!</div>;
            }
            if (tutar > 0 && odenen > 0 && fark === 0) {
              return <div style={{ marginTop: 8, padding: '8px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', color: '#15803d', fontWeight: 600, fontSize: 13 }}>✅ Ödeme tam — satış tutarı karşılandı.</div>;
            }
            return null;
          })()}
        </div>

        {/* NOTLAR */}
        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Notlar</h2>
          <div className="duzenle-notlar-grid">
            <div>
              <label className="duzenle-label">Fatura No</label>
              <input type="text" value={faturaNo} onChange={handleFaturaNoChange} onBlur={handleFaturaNoBlur} placeholder="0001 veya Kesilmedi" className="duzenle-input" disabled={alanlarKilitli} style={{ borderColor: faturaNoHata ? '#ef4444' : undefined }} />
              {faturaNoHata && <small style={{ color: '#ef4444' }}>{faturaNoHataMesaj}</small>}
              {!faturaNoHata && faturaNo && isFaturaNoGecerli(faturaNo) && <small style={{ color: '#16a34a' }}>✅ Geçerli</small>}
              <small style={{ color: '#9ca3af', fontSize: 11 }}>4 haneli rakam veya "Kesilmedi"</small>
            </div>
            <div>
              <label className="duzenle-label">Servis Notu</label>
              <input type="text" value={servisNotu} onChange={e => setServisNotu(e.target.value)} className="duzenle-input" disabled={alanlarKilitli} />
            </div>

            {/* ✅ 2.1 TESLİM EDİLDİ — Notlar bölümünde, sarı badge ile */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="duzenle-label">Teslim Edildi</label>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: alanlarKilitli ? 'not-allowed' : 'pointer', opacity: alanlarKilitli ? 0.6 : 1 }}>
                  <input type="radio" name="teslimEdildi" value="evet" checked={teslimEdildiMi === true} onChange={() => !alanlarKilitli && setTeslimEdildiMi(true)} disabled={alanlarKilitli} />
                  <span style={teslimEdildiMi ? {
                    background: '#fef08a', color: '#854d0e', fontWeight: 700,
                    padding: '4px 14px', borderRadius: 20,
                    border: '1.5px solid #fde047', fontSize: 13,
                  } : { fontSize: 13 }}>
                    {teslimEdildiMi ? '✅ Teslim Edildi: Evet' : 'Evet'}
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: alanlarKilitli ? 'not-allowed' : 'pointer', opacity: alanlarKilitli ? 0.6 : 1 }}>
                  <input type="radio" name="teslimEdildi" value="hayir" checked={teslimEdildiMi === false} onChange={() => !alanlarKilitli && setTeslimEdildiMi(false)} disabled={alanlarKilitli} />
                  <span style={{ fontSize: 13 }}>Hayır</span>
                </label>
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label className="duzenle-label">📝 Notlar</label>
              <textarea value={notlar} onChange={e => setNotlar(e.target.value)} placeholder="Satışa ait notları buraya girin..." rows={3} disabled={alanlarKilitli}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
          </div>
        </div>

        {/* MARS NO / TESLİMAT TARİHİ */}
        <div className="duzenle-section">
          <div className="duzenle-mars-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 className="duzenle-section-title" style={{ margin: 0 }}>Mars No / Teslimat Tarihi</h2>
              <span className="duzenle-mars-sayac">{marsListesi.length} / {MAX_MARS}</span>
            </div>
            {marsEklenebilir && !alanlarKilitli
              ? <button type="button" onClick={marsEkle} className="duzenle-btn-add">+ Yeni Sipariş No</button>
              : !marsEklenebilir ? <span className="duzenle-mars-limit">🔒 Maks. 4 giriş</span> : null
            }
          </div>
          <div className="duzenle-mars-timeline">
            {marsListesi.map((giris, index) => (
              <div key={index} className={`duzenle-mars-card ${index === 0 ? 'orijinal' : 'yeni'}`}>
                <div className="duzenle-mars-sol">
                  <div className={`duzenle-mars-nokta ${index === 0 ? 'nokta-teal' : 'nokta-blue'}`}>{index === 0 ? '🏠' : '🔄'}</div>
                  {index < marsListesi.length - 1 && <div className="duzenle-mars-cizgi" />}
                </div>
                <div className="duzenle-mars-icerik">
                  <div className="duzenle-mars-baslik">
                    <span className={`duzenle-mars-etiket ${index === 0 ? 'etiket-teal' : 'etiket-blue'}`}>{giris.etiket}</span>
                    {index > 0 && !alanlarKilitli && <button type="button" onClick={() => marsSil(index)} className="duzenle-mars-sil">✕</button>}
                  </div>
                  <div className="duzenle-mars-inputs">
                    <div>
                      <label className="duzenle-label">Mars No</label>
                      <input
                        type="text"
                        value={giris.marsNo}
                        onChange={e => marsGuncelle(index, 'marsNo', e.target.value)}
                        placeholder={`${CURRENT_YEAR}XXXXXX`}
                        maxLength={10}
                        className={`duzenle-input ${index > 0 ? 'input-blue' : ''}`}
                        disabled={alanlarKilitli}
                        style={{ borderColor: marsNoHatalar[index] ? '#ef4444' : (giris.marsNo && isMarsNoGecerli(giris.marsNo) ? '#16a34a' : undefined) }}
                      />
                      {/* ✅ #3 Mars No anlık validasyon */}
                      {marsNoHatalar[index] && (
                        <small style={{ color: '#ef4444', display: 'block' }}>{marsNoHatalar[index]}</small>
                      )}
                      {giris.marsNo && isMarsNoGecerli(giris.marsNo) && !marsNoHatalar[index] && (
                        <small style={{ color: '#16a34a', display: 'block' }}>✅ Geçerli ({giris.marsNo.length}/10)</small>
                      )}
                      {giris.marsNo && !marsNoHatalar[index] && !isMarsNoGecerli(giris.marsNo) && (
                        <small style={{ color: '#d97706', display: 'block' }}>⚠️ {giris.marsNo.length}/10 — ${CURRENT_YEAR} ile başlayan 10 hane gerekli</small>
                      )}
                      <small style={{ color: '#9ca3af', fontSize: 11 }}>Güncel yıl ile başlayan 10 haneli sayı</small>
                    </div>
                    <div>
                      <label className="duzenle-label">Teslimat Tarihi</label>
                      <input
                        type="date"
                        value={giris.teslimatTarihi}
                        min={satisTarihi || undefined}
                        onChange={e => marsGuncelle(index, 'teslimatTarihi', e.target.value)}
                        className={`duzenle-input ${index > 0 ? 'input-blue' : ''}`}
                        disabled={alanlarKilitli}
                        style={{ borderColor: giris.teslimatTarihi && !isTeslimatTarihiGecerli(giris.teslimatTarihi) ? '#ef4444' : undefined }}
                      />
                      {giris.teslimatTarihi && !isTeslimatTarihiGecerli(giris.teslimatTarihi) && (
                        <small style={{ color: '#ef4444', display: 'block' }}>Teslimat tarihi, satış tarihinden önce olamaz.</small>
                      )}
                      {index === 0 && giris.teslimatTarihi && !giris.marsNo?.trim() && (
                        <small style={{ color: '#d97706', display: 'block' }}>⚠️ Teslimat tarihi girildiğinde Mars No zorunludur.</small>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* İPTAL / İPTALDEN ÇIKAR */}
          <div className="duzenle-iptal-buton-alani">
            {isIptal ? (
              isAdmin && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" className="duzenle-btn-iptalden-cikar" onClick={() => setIptaldenCikarPopup(true)}>♻️ İptalden Çıkar</button>
                  {iadeDurumu && iadeDurumu !== 'IADE_ODENDI' && (
                    <button type="button" onClick={() => setIadePopup(true)} style={{ padding: '8px 18px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>💰 İadeyi Onayla</button>
                  )}
                </div>
              )
            ) : iptalTalebiVar ? (
              <span className="duzenle-iptal-talep-badge">📨 İptal talebi gönderildi — Admin onayı bekleniyor</span>
            ) : (
              <button type="button" className="duzenle-btn-iptal-et" onClick={() => setIptalPopup(true)}>
                {isAdmin ? '🚫 Bu Satışı İptal Et' : '📨 İptal Talebi Gönder'}
              </button>
            )}
          </div>
        </div>

        {/* ACTIONS */}
        <div className="duzenle-actions">
          <button type="button" onClick={() => navigate('/dashboard')} className="duzenle-btn-cancel">İptal</button>
          {!alanlarKilitli && (
            <button type="submit" className="duzenle-btn-submit" disabled={toplamOdenen() > toplamTutar() && toplamTutar() > 0}>
              Güncelle
            </button>
          )}
        </div>
      </form>
    </Layout>
  );
};

export default SatisDuzenlePage;