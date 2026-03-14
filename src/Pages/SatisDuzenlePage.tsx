import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, Urun, KartOdeme, BANKALAR, TAKSIT_SECENEKLERI } from '../types/satis';
import { getSubeByKod } from '../types/sube';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import { writeSatisAuditLog } from '../services/satisLogService';
import './SatisDuzenle.css';
import { kasaTahsilatEkle, kasaIadeEkle } from '../services/kasaService'; // iptal/iade akışları için hâlâ gerekli
import { kasaIptalKaydiOlustur } from '../services/kasaIptalService';
// ✅ v11: DUZELTME tipi — farklı gün düzenlemeler için
import { kasaOdemeDiffYaz, satistenOdemeSnapshot } from '../services/kasaOdemeDiffService';

interface KampanyaAdmin { id?: string; ad: string; aciklama: string; aktif: boolean; subeKodu: string; tutar?: number; }
interface YesilEtiketAdmin { id?: string; urunKodu: string; urunTuru?: string; maliyet: number; aciklama?: string; }
interface MarsGirisi { marsNo: string; teslimatTarihi: string; etiket: string; }

const MAX_MARS = 4;
const HAVALE_BANKALARI = ['Ziraat Bankası','Halkbank','Vakıfbank','İş Bankası','Garanti BBVA','Yapı Kredi','Akbank','QNB Finansbank','Denizbank','TEB','ING Bank','HSBC','Şekerbank','Fibabanka','Alternatifbank'];

const FATURA_NO_REGEX = /^(\d{1,4}|Kesilmedi)$/;
const normalizeFaturaNo = (val: string): string => { if (val.toLowerCase() === 'kesilmedi') return 'Kesilmedi'; return val; };
const isFaturaNoGecerli = (val: string): boolean => !val || FATURA_NO_REGEX.test(val);
const MARS_NO_REGEX = /^\d{10}$/;
const isMarsNoGecerli = (val: string): boolean => !val || MARS_NO_REGEX.test(val);

// ✅ v10: bugunStr timezone-safe (Europe/Istanbul)
const bugunStr = (): string => {
  const n = new Date();
  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(n);
  const y = parts.find(p => p.type === 'year')?.value  ?? '';
  const m = parts.find(p => p.type === 'month')?.value ?? '';
  const g = parts.find(p => p.type === 'day')?.value   ?? '';
  return `${y}-${m}-${g}`;
};

type PesinatItem = { id: string; tutar: number; aciklama: string; gun?: string };
type HavaleItem  = { id: string; tutar: number; banka: string; gun?: string };
type KartItem    = KartOdeme & { gun?: string };

const SatisDuzenlePage: React.FC = () => {
  const { subeKodu: subeKoduParam, id } = useParams<{ subeKodu: string; id: string }>();
  const subeKodu = subeKoduParam ?? '';
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

  const [satis, setSatis] = useState<SatisTeklifFormu | null>(null);
  const [loading, setLoading] = useState(true);
  const [urunler, setUrunler] = useState<Urun[]>([]);
  const [pesinatlar, setPesinatlar] = useState<PesinatItem[]>([]);
  const [havaleler, setHavaleler]   = useState<HavaleItem[]>([]);
  const [kartOdemeler, setKartOdemeler] = useState<KartItem[]>([]);
  const [kesintiCache, setKesintiCache] = useState<Record<string, Record<string, number>>>({});
  const [manuelSatisTutari, setManuelSatisTutari] = useState<number | null>(null);
  const [orijinalPesinatlar, setOrijinalPesinatlar] = useState<PesinatItem[]>([]);
  const [orijinalHavaleler, setOrijinalHavaleler]   = useState<HavaleItem[]>([]);
  const [orijinalKartOdemeler, setOrijinalKartOdemeler] = useState<KartItem[]>([]);
  const [orijinalFirestoreData, setOrijinalFirestoreData] = useState<any>(null);

  const [faturaNo, setFaturaNo] = useState('');
  const [faturaNoHata, setFaturaNoHata] = useState(false);
  const [faturaNoHataMesaj, setFaturaNoHataMesaj] = useState('');
  const [servisNotu, setServisNotu] = useState('');
  const [magaza, setMagaza] = useState('');
  const [marsListesi, setMarsListesi] = useState<MarsGirisi[]>([]);
  const [notlar, setNotlar] = useState('');
  const [satisTarihi, setSatisTarihi] = useState('');
  const [teslimEdildiMi, setTeslimEdildiMi] = useState(false);
  const [musteriIsim, setMusteriIsim] = useState('');
  const [musteriUnvan, setMusteriUnvan] = useState('');
  const [musteriVkNo, setMusteriVkNo] = useState('');
  const [musteriVd, setMusteriVd] = useState('');
  const [musteriAdres, setMusteriAdres] = useState('');
  const [musteriFaturaAdresi, setMusteriFaturaAdresi] = useState('');
  const [musteriCep, setMusteriCep] = useState('');
  const [urunCache, setUrunCache] = useState<Record<string, { ad: string; alis: number; bip: number }>>({});
  const [urunAramaDropdown, setUrunAramaDropdown] = useState<{ index: number; sonuclar: string[] } | null>(null);
  const [kampanyaAdminListesi, setKampanyaAdminListesi] = useState<KampanyaAdmin[]>([]);
  const [seciliKampanyaIds, setSeciliKampanyaIds] = useState<string[]>([]);
  const [yesilEtiketAdminList, setYesilEtiketAdminList] = useState<YesilEtiketAdmin[]>([]);
  const [iptalPopup, setIptalPopup] = useState(false);
  const [iptaldenCikarPopup, setIptaldenCikarPopup] = useState(false);
  const [iptalIslemYapiliyor, setIptalIslemYapiliyor] = useState(false);
  const [iptaldenCikarStatusu, setIptaldenCikarStatusu] = useState<'BEKLEMEDE' | 'ONAYLI'>('BEKLEMEDE');
  const [iadePopup, setIadePopup] = useState(false);
  const [marsNoHatalar, setMarsNoHatalar] = useState<Record<number, string>>({});

  const isIptal = (satis as any)?.satisDurumu === 'IPTAL';
  const iptalTalebiVar = !isIptal && (satis as any)?.iptalTalebi === true;
  const iadeDurumu: string | undefined = (satis as any)?.iadeDurumu;
  const onayliKilitli = !isAdmin && satis?.onayDurumu === true && !isIptal;
  const alanlarKilitli = (isIptal || onayliKilitli) && !isAdmin;

  const etiketAd = (index: number) => ['Orijinal', '2. Sipariş', '3. Sipariş', '4. Sipariş'][index] || `${index + 1}. Sipariş`;
  const formatPrice = (price: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);
  const normalizeBanka = (s: string): string => s.toLowerCase().replace(/i̇/g,'i').replace(/ı/g,'i').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s').replace(/ö/g,'o').replace(/ç/g,'c').replace(/\s+/g,'').trim();

  // ── VERİ YÜKLEME ──────────────────────────────────────────────────────────

  const kesintiCacheYukle = async () => {
    try {
      const snap = await getDocs(collection(db, 'bankaKesintiler'));
      const cache: Record<string, Record<number, number>> = {};
      snap.docs.forEach(d => {
        const data = d.data(); const taksitMap: Record<number, number> = {};
        if (data.taksitler) { Object.entries(data.taksitler).forEach(([key, val]) => { taksitMap[Number(key)] = Number(val); }); }
        else { [1,2,3,4,5,6,7,8,9].forEach(n => { const k = n===1?'tek':`t${n}`; if(data[k]) taksitMap[n]=data[k]; }); }
        cache[d.id] = taksitMap;
      });
      setKesintiCache(cache as any);
    } catch (err) { console.error('Kesinti cache:', err); }
  };

  const getKesintiOrani = (banka: string, taksit: number): number => {
    const cache = kesintiCache as Record<string, Record<number, number>>;
    if (cache[banka]?.[taksit] !== undefined) return cache[banka][taksit];
    const nb = normalizeBanka(banka);
    const eslesen = Object.keys(cache).find(k => normalizeBanka(k) === nb || normalizeBanka(k).includes(nb) || nb.includes(normalizeBanka(k)));
    return eslesen ? cache[eslesen][taksit] ?? 0 : 0;
  };

  const urunCacheYukle = async () => {
    try {
      const snap = await getDocs(collection(db, 'urunler'));
      const cache: Record<string, { ad: string; alis: number; bip: number }> = {};
      snap.docs.forEach(d => { const data = d.data(); if (data.kod) cache[data.kod.trim()] = { ad: data.ad || data.urunAdi || '', alis: parseFloat(data.alis || data.alisFiyati || 0), bip: parseFloat(data.bip || 0) }; });
      setUrunCache(cache);
    } catch (err) { console.error('Ürün cache:', err); }
  };

  const kampanyalariCek = async () => {
    try {
      const snap = await getDocs(collection(db, 'kampanyalar'));
      setKampanyaAdminListesi(snap.docs.map(d => ({ id: d.id, ...d.data() } as KampanyaAdmin)).filter(k => k.aktif && (k.subeKodu === 'GENEL' || k.subeKodu === subeKodu)));
    } catch (err) { console.error('Kampanyalar:', err); }
  };

  const yesilEtiketleriCek = async () => {
    try {
      const snap = await getDocs(collection(db, 'yesilEtiketler'));
      setYesilEtiketAdminList(snap.docs.map(d => { const data = d.data(); return { id: d.id, urunKodu: data.urunKodu || '', urunTuru: data.urunTuru || '', maliyet: parseFloat(data.maliyet || 0) } as YesilEtiketAdmin; }).filter(e => e.urunKodu && e.maliyet > 0));
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
        setOrijinalFirestoreData(satisDoc.data());
        setUrunler(data.urunler || []);
        setManuelSatisTutari((data as any).toplamTutar || null);

        const toDateStrLocal = (d: any): string => {
          if (!d) return bugunStr();
          try { const date = typeof d === 'object' && 'toDate' in d ? d.toDate() : new Date(d); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
          catch { return bugunStr(); }
        };
        const satisTarihiFallback = toDateStrLocal((data as any).olusturmaTarihi ?? (data as any).tarih);

        const loadedP: any[] = (data as any).pesinatlar || [];
        const loadedH: any[] = (data as any).havaleler  || [];
        const loadedK: KartOdeme[] = data.kartOdemeler || [];

        const pList: PesinatItem[] = loadedP.length > 0
          ? loadedP.map((p: any) => ({ ...p, gun: p.gun ?? satisTarihiFallback }))
          : (data.pesinatTutar ? [{ id: '1', tutar: data.pesinatTutar, aciklama: '', gun: satisTarihiFallback }] : []);

        const hList: HavaleItem[] = loadedH.length > 0
          ? loadedH.map((h: any) => ({ ...h, gun: h.gun ?? satisTarihiFallback }))
          : (data.havaleTutar ? [{ id: '1', tutar: data.havaleTutar, banka: (data as any).havaleBanka || HAVALE_BANKALARI[0], gun: satisTarihiFallback }] : []);

        const kList: KartItem[] = loadedK.map((k: any) => ({ ...k, gun: k.gun ?? satisTarihiFallback }));

        setPesinatlar(pList); setHavaleler(hList); setKartOdemeler(kList);
        setOrijinalPesinatlar(JSON.parse(JSON.stringify(pList)));
        setOrijinalHavaleler(JSON.parse(JSON.stringify(hList)));
        setOrijinalKartOdemeler(JSON.parse(JSON.stringify(kList)));

        setFaturaNo(data.faturaNo || ''); setServisNotu(data.servisNotu || '');
        setMagaza((data as any).magaza || ''); setNotlar((data as any).notlar || '');
        setTeslimEdildiMi((data as any).teslimEdildiMi === true);

        const mb = data.musteriBilgileri as any;
        setMusteriIsim(mb?.isim || ''); setMusteriUnvan(mb?.unvan || ''); setMusteriVkNo(mb?.vkNo || '');
        setMusteriVd(mb?.vd || ''); setMusteriAdres(mb?.adres || ''); setMusteriFaturaAdresi(mb?.faturaAdresi || ''); setMusteriCep(mb?.cep || '');
        if (data.kampanyalar) setSeciliKampanyaIds(data.kampanyalar.map((k: any) => k.id).filter(Boolean));

        const toDateStr = (d: any) => { if (!d) return ''; try { const date = typeof d === 'object' && 'toDate' in d ? d.toDate() : new Date(d); return date.toISOString().split('T')[0]; } catch { return ''; } };
        setSatisTarihi(toDateStr((data as any).tarih || (data as any).olusturmaTarihi));

        if (data.marsGirisleri && Array.isArray(data.marsGirisleri) && data.marsGirisleri.length > 0) {
          setMarsListesi(data.marsGirisleri);
        } else {
          const liste: MarsGirisi[] = [{ marsNo: data.marsNo || '', teslimatTarihi: toDateStr(data.teslimatTarihi), etiket: 'Orijinal' }];
          if (data.yeniMarsNo || data.yeniTeslimatTarihi) liste.push({ marsNo: data.yeniMarsNo || '', teslimatTarihi: toDateStr(data.yeniTeslimatTarihi), etiket: '2. Sipariş' });
          setMarsListesi(liste);
        }
      }
    } catch (error) { console.error('Satış detayı yüklenemedi:', error); } finally { setLoading(false); }
  };

  useEffect(() => { fetchSatisDetay(); urunCacheYukle(); kampanyalariCek(); yesilEtiketleriCek(); kesintiCacheYukle(); }, [id]);

  // ── HANDLERS ───────────────────────────────────────────────────────────────

  const urunSecDropdown = (index: number, kod: string) => {
    const eslesme = urunCache[kod]; if (!eslesme) return;
    const y = [...urunler]; y[index] = { ...y[index], kod, ad: eslesme.ad || '', alisFiyati: eslesme.alis, bip: eslesme.bip };
    setUrunler(y); setUrunAramaDropdown(null);
  };

  const handleUrunChange = (index: number, field: keyof Urun, value: any) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = { ...yeniUrunler[index], [field]: field==='adet'||field==='alisFiyati'||field==='bip' ? parseFloat(value)||0 : value };
    if (field === 'kod') {
      const trimmed = String(value).trim().toUpperCase();
      const eslesme = urunCache[trimmed];
      if (eslesme) { yeniUrunler[index] = { ...yeniUrunler[index], kod: trimmed, ad: eslesme.ad || yeniUrunler[index].ad, alisFiyati: eslesme.alis, bip: eslesme.bip }; setUrunAramaDropdown(null); }
      else if (trimmed.length >= 2) { const b = Object.keys(urunCache).filter(k=>k.toUpperCase().includes(trimmed)).slice(0,10); setUrunAramaDropdown(b.length>0?{index,sonuclar:b}:null); }
      else setUrunAramaDropdown(null);
    }
    setUrunler(yeniUrunler);
    if (field==='alisFiyati'||field==='adet') setManuelSatisTutari(null);
  };

  const handleUrunDeliveredChange = (index: number, checked: boolean) => {
    if (alanlarKilitli) return;
    const y = [...urunler]; y[index] = { ...y[index], delivered: checked } as any; setUrunler(y);
  };

  const urunEkle = () => setUrunler(prev => [...prev, { id: Date.now().toString(), kod: '', ad: '', adet: 1, alisFiyati: 0, bip: 0 }]);
  const urunSil = (index: number) => { if (urunler.length > 1) setUrunler(prev => prev.filter((_,i)=>i!==index)); };
  const kampanyaToggle = (kampanyaId: string) => setSeciliKampanyaIds(prev => prev.includes(kampanyaId) ? prev.filter(k=>k!==kampanyaId) : [...prev,kampanyaId]);
  const seciliKampanyalar = kampanyaAdminListesi.filter(k => seciliKampanyaIds.includes(k.id!));
  const eslesenYesilEtiketler = () => { const r: any[]=[]; for(const u of urunler){const e=yesilEtiketAdminList.find(y=>y.urunKodu.trim().toLowerCase()===u.kod.trim().toLowerCase());if(e)r.push({urunKodu:u.kod,urunAdi:u.ad,maliyet:e.maliyet,adet:u.adet});}return r; };
  const yesilEtiketToplamIndirim = () => eslesenYesilEtiketler().reduce((t:number,e:any)=>t+e.maliyet*e.adet,0);

  const kartEkle = () => setKartOdemeler(prev => [...prev, { id: Date.now().toString(), banka: BANKALAR[0], taksitSayisi: 1, tutar: 0, kesintiOrani: 0, gun: bugunStr() } as KartItem]);
  const kartSil = (index: number) => setKartOdemeler(prev => prev.filter((_,i)=>i!==index));
  const handleKartChange = (index: number, field: keyof KartOdeme, value: any) => {
    const y = [...kartOdemeler];
    const k = { ...y[index], [field]: field==='tutar'?(parseFloat(value)||0):field==='taksitSayisi'?(parseInt(value)||1):value };
    if (field==='banka'||field==='taksitSayisi') { const b=field==='banka'?value:y[index].banka; const t=field==='taksitSayisi'?(parseInt(value)||1):y[index].taksitSayisi; k.kesintiOrani=getKesintiOrani(b,t); }
    y[index]=k; setKartOdemeler(y);
  };

  const pesinatEkle = () => setPesinatlar(prev => [...prev, { id: Date.now().toString(), tutar: 0, aciklama: '', gun: bugunStr() }]);
  const pesinatSil = (pesinatId: string) => setPesinatlar(prev => prev.filter(p=>p.id!==pesinatId));
  const handlePesinatChange = (pesinatId: string, field: 'tutar'|'aciklama', value: any) => setPesinatlar(prev => prev.map(p=>p.id===pesinatId?{...p,[field]:field==='tutar'?(parseFloat(value)||0):value}:p));

  const havaleEkle = () => setHavaleler(prev => [...prev, { id: Date.now().toString(), tutar: 0, banka: HAVALE_BANKALARI[0], gun: bugunStr() }]);
  const havaleSil = (havaleId: string) => setHavaleler(prev => prev.filter(h=>h.id!==havaleId));
  const handleHavaleChange = (havaleId: string, field: 'tutar'|'banka', value: any) => setHavaleler(prev => prev.map(h=>h.id===havaleId?{...h,[field]:field==='tutar'?(parseFloat(value)||0):value}:h));

  const marsEkle = () => { if(marsListesi.length>=MAX_MARS)return; setMarsListesi(prev=>[...prev,{marsNo:'',teslimatTarihi:'',etiket:etiketAd(prev.length)}]); };
  const marsSil = (index: number) => { if(index===0)return; setMarsListesi(prev=>prev.filter((_,i)=>i!==index)); };
  const marsGuncelle = (index: number, field: 'marsNo'|'teslimatTarihi', value: string) => {
    if (field==='marsNo') {
      const s=value.replace(/\D/g,'');
      setMarsListesi(prev=>prev.map((item,i)=>i===index?{...item,marsNo:s}:item));
      if(s&&!isMarsNoGecerli(s)) setMarsNoHatalar(prev=>({...prev,[index]:`Mars No 10 haneli sayı olmalıdır. (${s.length}/10)`}));
      else setMarsNoHatalar(prev=>{const c={...prev};delete c[index];return c;});
    } else setMarsListesi(prev=>prev.map((item,i)=>i===index?{...item,[field]:value}:item));
  };

  const handleFaturaNoChange = (e: React.ChangeEvent<HTMLInputElement>) => { setFaturaNo(normalizeFaturaNo(e.target.value)); setFaturaNoHata(false); setFaturaNoHataMesaj(''); };
  const handleFaturaNoBlur = () => { if(faturaNo&&!isFaturaNoGecerli(faturaNo)){setFaturaNoHata(true);setFaturaNoHataMesaj("Fatura No yalnızca 1-4 haneli rakam veya 'Kesilmedi' olabilir.");} };
  const isTeslimatTarihiGecerli = (tarih: string) => !tarih||!satisTarihi||tarih>=satisTarihi;

  // ── HESAPLAMALAR ───────────────────────────────────────────────────────────

  const alisToplamı = () => urunler.reduce((s,u)=>s+u.alisFiyati*u.adet,0);
  const bipToplamı = () => urunler.reduce((s,u)=>s+(u.bip||0)*u.adet,0);
  const toplamTutar = () => manuelSatisTutari??0;
  const kampanyaToplamiHesapla = () => seciliKampanyalar.reduce((t,k)=>t+(k.tutar||0),0);
  const toplamMaliyet = () => Math.max(0,urunler.reduce((t,u)=>t+(u.alisFiyati-(u.bip||0))*u.adet,0)-kampanyaToplamiHesapla());
  const pesinatToplam = () => pesinatlar.reduce((t,p)=>t+(p.tutar||0),0);
  const haveleToplam = () => havaleler.reduce((t,h)=>t+(h.tutar||0),0);
  const kartBrutToplam = () => kartOdemeler.reduce((t,k)=>t+(k.tutar||0),0);
  const kartKesintiToplam = () => kartOdemeler.reduce((t,k)=>t+(k.tutar*(k.kesintiOrani||0))/100,0);
  const kartNetToplam = () => kartBrutToplam()-kartKesintiToplam();
  const toplamOdenen = () => pesinatToplam()+haveleToplam()+kartBrutToplam();
  const hesabaGecenToplam = () => pesinatToplam()+haveleToplam()+kartNetToplam();
  const acikHesap = () => { const a=toplamTutar()-toplamOdenen(); return a>0?a:0; };
  const karZarar = () => hesabaGecenToplam()-toplamMaliyet();

  // ══════════════════════════════════════════════════════════════════════════
  //  odemeDeğisiklikleriniKasayaYansit — v11
  //
  //  KURAL:
  //  - Aynı gün → kasaya HİÇBİR ŞEY yazılmaz. Satış dokümanı zaten
  //    güncelleniyor, kasa o günün satışından zaten doğru hesaplıyor.
  //  - Farklı gün → kasaOdemeDiffYaz (DUZELTME tipi, turuncu badge)
  // ══════════════════════════════════════════════════════════════════════════
  const odemeDeğisiklikleriniKasayaYansit = async () => {
    if (!satis || !subeKodu || !currentUser) return;

    const bugun          = bugunStr();
    const yapan          = `${currentUser.ad} ${currentUser.soyad}`;
    const yapanId        = currentUser.uid || '';
    const musteriIsimVal = (satis as any).musteriBilgileri?.isim ?? '—';
    const satisKoduVal   = satis.satisKodu ?? id ?? '';
    const satisIdVal     = satis.id ?? id ?? '';

    const satisTarihiRaw = (satis as any).olusturmaTarihi ?? (satis as any).tarih;
    const satisTarihiStr: string = satisTarihiRaw
      ? (() => { try { const d = typeof satisTarihiRaw.toDate==='function' ? satisTarihiRaw.toDate() : new Date(satisTarihiRaw); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; } catch { return bugun; } })()
      : bugun;

    // ── AYNI GÜN: kasaya hiçbir şey yazma ────────────────────────────────
    // Satış dokümanı güncelleniyor, recalcNakitSatis zaten doğru hesaplıyor.
    if (satisTarihiStr === bugun) {
      return;
    }

    // ── FARKLI GÜN: DUZELTME tipi (kasaOdemeDiffYaz) ─────────────────────
    const eskiOdeme = satistenOdemeSnapshot(orijinalFirestoreData ?? {});
    const yeniOdeme = {
      nakitTutar:  pesinatToplam(),
      kartTutar:   kartBrutToplam(),
      havaleTutar: haveleToplam(),
      kartOdemeler: kartOdemeler.map(k => ({ tutar: k.tutar, banka: k.banka })),
      havaleler:    havaleler.map(h => ({ tutar: h.tutar, banka: h.banka })),
    };

    await kasaOdemeDiffYaz({
      subeKodu,
      satisId:     satisIdVal,
      satisKodu:   satisKoduVal,
      musteriIsim: musteriIsimVal,
      satisTarihi: satisTarihiStr,
      eskiOdeme,
      yeniOdeme,
      yapan,
      yapanId,
    });
  };

  // ── İPTAL / İADE ──────────────────────────────────────────────────────────

  const satisiIptalEt = async () => {
    if(!satis?.id)return; const sube=getSubeByKod(subeKodu as any); if(!sube)return;
    setIptalIslemYapiliyor(true);
    if(!isAdmin){
      try{await updateDoc(doc(db,`subeler/${sube.dbPath}/satislar`,satis.id),{iptalTalebi:true,iptalTalepTarihi:new Date(),guncellemeTarihi:new Date()});setSatis(prev=>prev?{...prev,iptalTalebi:true}as any:prev);setIptalPopup(false);alert('✅ İptal talebiniz gönderildi.');}
      catch{alert('❌ İptal talebi gönderilemedi!');}finally{setIptalIslemYapiliyor(false);}return;
    }
    try{
      const top=pesinatToplam()+haveleToplam()+kartBrutToplam();const yID=top>0?'IADE_GEREKIYOR':undefined;
      await updateDoc(doc(db,`subeler/${sube.dbPath}/satislar`,satis.id),{satisDurumu:'IPTAL',onayDurumu:false,iptalTarihi:new Date(),guncellemeTarihi:new Date(),...(yID?{iadeDurumu:yID}:{})});
      setSatis(prev=>prev?{...prev,satisDurumu:'IPTAL',iadeDurumu:yID}as any:prev);setIptalPopup(false);
      alert(yID?`✅ Satış iptal edildi.\n⚠️ ${formatPrice(top)} tutarında ödeme var.`:'✅ Satış iptal edildi.');
    }catch{alert('❌ İptal işlemi başarısız!');}finally{setIptalIslemYapiliyor(false);}
  };

  const iadeOnayla = async () => {
    if(!satis?.id||!currentUser)return; const sube=getSubeByKod(subeKodu as any); if(!sube)return;
    setIptalIslemYapiliyor(true);
    try{
      const yapan=`${currentUser.ad} ${currentUser.soyad}`;const yapanId=currentUser.uid||'';
      await kasaIadeEkle({subeKodu,gun:bugunStr(),satisId:satis.id!,satisKodu:satis.satisKodu??'',musteriIsim:(satis as any).musteriBilgileri?.isim??'—',nakitTutar:pesinatToplam(),kartTutar:kartBrutToplam(),havaleTutar:haveleToplam(),yapan,yapanId,iadeSebebi:'Satış iptali iadesi'});
      await kasaIptalKaydiOlustur({satis:{...satis,id:satis.id}as any,subeKodu,iptalYapan:yapan,iptalYapanId:yapanId});
      await updateDoc(doc(db,`subeler/${sube.dbPath}/satislar`,satis.id),{iadeDurumu:'IADE_ODENDI',iadeOnayTarihi:new Date(),iadeOnaylayan:yapan,guncellemeTarihi:new Date()});
      setSatis(prev=>prev?{...prev,iadeDurumu:'IADE_ODENDI'}as any:prev);setIadePopup(false);
      alert(`✅ İade onaylandı!\n💵 ${formatPrice(pesinatToplam()+haveleToplam()+kartBrutToplam())} kasadan düşüldü.`);
    }catch(err){alert('❌ İade işlemi başarısız: '+(err as Error).message);}finally{setIptalIslemYapiliyor(false);}
  };

  // ✅ v10 FIX: satisTarihi: undefined → bugunStr()
  // Eski hali çift sayım yapıyordu (recalcNakitSatis koruması devreye giremiyordu)
  const satisiIptaldenCikar = async () => {
    if(!satis?.id)return; const sube=getSubeByKod(subeKodu as any); if(!sube)return;
    setIptalIslemYapiliyor(true);
    try{
      const yeniOnay=iptaldenCikarStatusu==='ONAYLI';
      const mevcut=(satis as any).iadeDurumu;
      const top=pesinatToplam()+haveleToplam()+kartBrutToplam();
      if(mevcut==='IADE_ODENDI'&&top>0&&currentUser){
        await kasaTahsilatEkle({
          subeKodu,
          gun: bugunStr(),
          satisId: satis.id!,
          satisKodu: satis.satisKodu??'',
          musteriIsim: (satis as any).musteriBilgileri?.isim??'—',
          nakitTutar: pesinatToplam(),
          kartTutar: kartBrutToplam(),
          havaleTutar: haveleToplam(),
          yapan: `${currentUser.ad} ${currentUser.soyad}`,
          yapanId: currentUser.uid||'',
          aciklama: 'İptalden çıkarma — iade geri alındı',
          // ✅ FIX: undefined yerine bugunStr() — çift sayım koruması için
          satisTarihi: bugunStr(),
        });
      }
      await updateDoc(doc(db,`subeler/${sube.dbPath}/satislar`,satis.id),{
        satisDurumu: iptaldenCikarStatusu,
        onayDurumu: yeniOnay,
        iptalTarihi: null,
        iadeDurumu: null,
        guncellemeTarihi: new Date(),
      });
      setSatis(prev=>prev?{...prev,satisDurumu:iptaldenCikarStatusu,onayDurumu:yeniOnay,iadeDurumu:null}as any:prev);
      setIptaldenCikarPopup(false);
      alert(`✅ Satış "${iptaldenCikarStatusu==='ONAYLI'?'Onaylı':'Beklemede'}" statüsüne alındı.`);
    }catch(err){
      alert('❌ İşlem başarısız: '+(err as Error).message);
    }finally{
      setIptalIslemYapiliyor(false);
    }
  };

  // ── SUBMIT ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(onayliKilitli){alert('❌ Onaylı satışları düzenleme yetkiniz yok.');return;}
    if(isIptal&&!isAdmin){alert('❌ İptal edilmiş satışı düzenleyemezsiniz.');return;}
    if(faturaNo&&!isFaturaNoGecerli(faturaNo)){setFaturaNoHata(true);setFaturaNoHataMesaj("Fatura No yalnızca 1-4 haneli rakam veya 'Kesilmedi' olabilir.");alert("❌ Geçersiz fatura no.");return;}
    for(let i=0;i<marsListesi.length;i++){
      if(marsListesi[i].marsNo&&!isMarsNoGecerli(marsListesi[i].marsNo)){alert(`❌ ${etiketAd(i)} Mars No geçersiz!`);return;}
      if(marsListesi[i].teslimatTarihi&&!isTeslimatTarihiGecerli(marsListesi[i].teslimatTarihi)){alert(`❌ Teslimat tarihi satış tarihinden önce olamaz. (${etiketAd(i)})`);return;}
    }
    const og=marsListesi[0];
    if(og?.marsNo?.trim()&&!og?.teslimatTarihi){alert('❌ Mars No girildiğinde teslimat tarihi zorunludur.');return;}
    if(og?.teslimatTarihi&&!og?.marsNo?.trim()){alert('❌ Teslimat tarihi girildiğinde Mars No zorunludur.');return;}
    if(toplamOdenen()>toplamTutar()&&toplamTutar()>0){alert(`❌ Toplam ödeme satış tutarını aşıyor!`);return;}

    try{
      const sube=getSubeByKod(subeKodu as any);if(!sube||!satis)return;
      if(!isAdmin){
        const fresh=await getDoc(doc(db,`subeler/${sube.dbPath}/satislar`,id!));
        if(fresh.exists()&&fresh.data().onayDurumu===true&&fresh.data().satisDurumu!=='IPTAL'){alert('❌ Bu satış az önce admin tarafından onaylandı.');navigate('/dashboard');return;}
      }

      await odemeDeğisiklikleriniKasayaYansit();

      const orijinal=marsListesi[0];
      const sonGiris=[...marsListesi].reverse().find(m=>m.marsNo||m.teslimatTarihi)||orijinal;
      const etiketler=eslesenYesilEtiketler();
      const oldSnap=await getDoc(doc(db,`subeler/${sube.dbPath}/satislar`,id!));
      const oldData=oldSnap.exists()?oldSnap.data():{};

      await updateDoc(doc(db,`subeler/${sube.dbPath}/satislar`,id!),{
        musteriBilgileri:{...((satis as any).musteriBilgileri||{}),isim:musteriIsim,unvan:musteriUnvan,vkNo:musteriVkNo,vd:musteriVd,adres:musteriAdres,faturaAdresi:musteriFaturaAdresi,cep:musteriCep},
        urunler:urunler.map(u=>({...u,alisFiyatSnapshot:(u as any).alisFiyatSnapshot??u.alisFiyati,bipSnapshot:(u as any).bipSnapshot??(u.bip||0),greenPriceSnapshot:(u as any).greenPriceSnapshot??null,snapshotTarihi:(u as any).snapshotTarihi||new Date().toISOString()})),
        kampanyalar:seciliKampanyalar.map(k=>({id:k.id!,ad:k.ad,tutar:k.tutar||0})),kampanyaToplami:kampanyaToplamiHesapla(),
        yesilEtiketler:etiketler.map((e:any)=>({id:Date.now().toString(),urunKodu:e.urunKodu,ad:e.urunAdi,alisFiyati:e.maliyet,tutar:e.maliyet*e.adet})),
        pesinatlar,havaleler,
        kartOdemeler:kartOdemeler.map(k=>({...k,commissionRateSnapshot:k.kesintiOrani||0,commissionAmountSnapshot:(k.tutar*(k.kesintiOrani||0))/100,netAmountSnapshot:k.tutar-(k.tutar*(k.kesintiOrani||0))/100,snapshotTarihi:(k as any).snapshotTarihi||new Date().toISOString()})),
        pesinatToplam:pesinatToplam(),havaleToplam:haveleToplam(),kartBrutToplam:kartBrutToplam(),kartKesintiToplam:kartKesintiToplam(),kartNetToplam:kartNetToplam(),toplamOdenen:toplamOdenen(),hesabaGecenToplam:hesabaGecenToplam(),acikHesap:acikHesap(),odemeDurumu:acikHesap()>0?'ACIK_HESAP':'ODENDI',
        pesinatTutar:pesinatToplam(),havaleTutar:haveleToplam(),
        marsNo:orijinal.marsNo,faturaNo,servisNotu,magaza:magaza.trim()||null,notlar:notlar.trim()||null,teslimEdildiMi,
        toplamTutar:toplamTutar(),zarar:karZarar(),
        teslimatTarihi:orijinal.teslimatTarihi?new Date(orijinal.teslimatTarihi):null,
        yeniMarsNo:marsListesi.length>1?sonGiris.marsNo:null,
        yeniTeslimatTarihi:marsListesi.length>1&&sonGiris.teslimatTarihi?new Date(sonGiris.teslimatTarihi):null,
        marsGirisleri:marsListesi,guncellemeTarihi:new Date()
      });

      try{const newSnap=await getDoc(doc(db,`subeler/${sube.dbPath}/satislar`,id!));const newData=newSnap.exists()?newSnap.data():{};await writeSatisAuditLog({saleId:id!,satisKodu:satis.satisKodu||'',dbPath:sube.dbPath,branchId:subeKodu||'',branchName:sube.ad,oldData,newData,userId:currentUser?.uid||'',userName:`${currentUser?.ad||''} ${currentUser?.soyad||''}`.trim()});}
      catch(logErr){console.error('Audit log yazılamadı:',logErr);}

      alert('✅ Satış başarıyla güncellendi!');
      navigate('/dashboard');
    }catch(error){console.error('Güncelleme hatası:',error);alert('❌ Bir hata oluştu!');}
  };

  // ── BADGE ─────────────────────────────────────────────────────────────────
  const iadeBadgeStyle = (durum: string) => {
    if(durum==='IADE_ODENDI') return{background:'#dcfce7',color:'#16a34a',border:'1px solid #86efac'};
    if(durum==='IADE_ONAYLANDI') return{background:'#dbeafe',color:'#1d4ed8',border:'1px solid #93c5fd'};
    if(durum==='IADE_BEKLIYOR') return{background:'#fef9c3',color:'#92400e',border:'1px solid #fde68a'};
    return{background:'#fee2e2',color:'#dc2626',border:'1px solid #fca5a5'};
  };
  const iadeBadgeMetin = (durum: string) => ({'IADE_GEREKIYOR':'⚠️ İade Gerekiyor','IADE_BEKLIYOR':'🔄 İade Bekliyor','IADE_ONAYLANDI':'✅ İade Onaylandı','IADE_ODENDI':'💚 İade Ödendi'}[durum]??durum);

  if (loading) return <Layout pageTitle="Satış Düzenle"><div className="duzenle-loading">Yükleniyor...</div></Layout>;
  if (!satis) return <Layout pageTitle="Satış Düzenle"><div className="duzenle-not-found"><h2>Satış Bulunamadı</h2><button onClick={()=>navigate('/dashboard')} className="duzenle-btn-back">Dashboard'a Dön</button></div></Layout>;

  const marsEklenebilir = marsListesi.length < MAX_MARS;

  return (
    <Layout pageTitle={`Düzenle: ${satis.satisKodu}`}>

      {iptalPopup && (
        <div className="duzenle-popup-overlay">
          <div className="duzenle-popup">
            <div className="duzenle-popup-ikon">{isAdmin?'🚫':'📨'}</div>
            <h3 className="duzenle-popup-baslik">{isAdmin?'Satışı İptal Et':'İptal Talebi Gönder'}</h3>
            <p className="duzenle-popup-mesaj">
              <strong>{satis.satisKodu}</strong> kodlu satış için {isAdmin?'iptal işlemi yapılsın mı?':'admin onayına iptal talebi gönderilsin mi?'}
              <br />{isAdmin&&pesinatToplam()+haveleToplam()+kartBrutToplam()>0&&(<span style={{color:'#dc2626',fontWeight:600}}>⚠️ {formatPrice(pesinatToplam()+haveleToplam()+kartBrutToplam())} tahsilat var.</span>)}
              <br /><span className="duzenle-popup-alt-not">{isAdmin?'Satış silinmeyecek, listede görünmeye devam edecek.':'Talebiniz admin tarafından onaylandığında satış iptal edilecek.'}</span>
            </p>
            <div className="duzenle-popup-butonlar">
              <button className="duzenle-popup-hayir" onClick={()=>setIptalPopup(false)} disabled={iptalIslemYapiliyor}>Hayır</button>
              <button className="duzenle-popup-evet duzenle-popup-evet--iptal" onClick={satisiIptalEt} disabled={iptalIslemYapiliyor}>{iptalIslemYapiliyor?'İşleniyor...':isAdmin?'Evet, İptal Et':'Evet, Talep Gönder'}</button>
            </div>
          </div>
        </div>
      )}

      {iadePopup && (
        <div className="duzenle-popup-overlay">
          <div className="duzenle-popup">
            <div className="duzenle-popup-ikon">💰</div>
            <h3 className="duzenle-popup-baslik">İadeyi Onayla</h3>
            <p className="duzenle-popup-mesaj">
              <strong>{satis.satisKodu}</strong> — müşteriye iade yapıldı mı?
              <br /><span style={{fontWeight:700,color:'#dc2626',fontSize:18}}>{formatPrice(pesinatToplam()+haveleToplam()+kartBrutToplam())}</span>
              <br /><span className="duzenle-popup-alt-not">Bu tutar <strong>bugünün ({bugunStr()}) kasasından</strong> düşülecek.</span>
            </p>
            <div className="duzenle-popup-butonlar">
              <button className="duzenle-popup-hayir" onClick={()=>setIadePopup(false)} disabled={iptalIslemYapiliyor}>Vazgeç</button>
              <button className="duzenle-popup-evet" style={{background:'#16a34a'}} onClick={iadeOnayla} disabled={iptalIslemYapiliyor}>{iptalIslemYapiliyor?'İşleniyor...':'✅ Evet, İade Yapıldı'}</button>
            </div>
          </div>
        </div>
      )}

      {iptaldenCikarPopup && (
        <div className="duzenle-popup-overlay">
          <div className="duzenle-popup">
            <div className="duzenle-popup-ikon">♻️</div>
            <h3 className="duzenle-popup-baslik">İptalden Çıkar</h3>
            <p className="duzenle-popup-mesaj"><strong>{satis.satisKodu}</strong> kodlu satışı iptalden çıkarmak istediğinizden emin misiniz?</p>
            <div className="duzenle-popup-statu-sec">
              <p className="duzenle-popup-statu-baslik">Yeni Statü Seçin:</p>
              <div className="duzenle-popup-statu-secenekler">
                <label className={`duzenle-popup-statu-btn ${iptaldenCikarStatusu==='BEKLEMEDE'?'secili':''}`}><input type="radio" name="statu" value="BEKLEMEDE" checked={iptaldenCikarStatusu==='BEKLEMEDE'} onChange={()=>setIptaldenCikarStatusu('BEKLEMEDE')} />⏳ Beklemede</label>
                <label className={`duzenle-popup-statu-btn ${iptaldenCikarStatusu==='ONAYLI'?'secili':''}`}><input type="radio" name="statu" value="ONAYLI" checked={iptaldenCikarStatusu==='ONAYLI'} onChange={()=>setIptaldenCikarStatusu('ONAYLI')} />✅ Onaylı</label>
              </div>
            </div>
            <div className="duzenle-popup-butonlar">
              <button className="duzenle-popup-hayir" onClick={()=>setIptaldenCikarPopup(false)} disabled={iptalIslemYapiliyor}>Hayır</button>
              <button className="duzenle-popup-evet duzenle-popup-evet--cikar" onClick={satisiIptaldenCikar} disabled={iptalIslemYapiliyor}>{iptalIslemYapiliyor?'İşleniyor...':'Evet, İptalden Çıkar'}</button>
            </div>
          </div>
        </div>
      )}

      {isIptal && (
        <div className="duzenle-iptal-banner">
          🚫 Bu satış <strong>İPTAL</strong> statüsündedir.{!isAdmin&&' Düzenleme yapılamaz.'}
          {iadeDurumu&&<span style={{marginLeft:16,padding:'3px 10px',borderRadius:6,fontSize:13,fontWeight:700,...iadeBadgeStyle(iadeDurumu)}}>{iadeBadgeMetin(iadeDurumu)}</span>}
          {isAdmin&&iadeDurumu&&iadeDurumu!=='IADE_ODENDI'&&(<button type="button" onClick={()=>setIadePopup(true)} style={{marginLeft:16,padding:'6px 16px',background:'#16a34a',color:'#fff',border:'none',borderRadius:6,fontWeight:700,fontSize:13,cursor:'pointer'}}>💰 İadeyi Onayla</button>)}
        </div>
      )}
      {onayliKilitli && (
        <div style={{padding:'14px 18px',marginBottom:16,borderRadius:12,background:'linear-gradient(135deg,#eff6ff,#dbeafe)',border:'2px solid #93c5fd',color:'#1e40af',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',fontWeight:600,fontSize:14}}>
          <span style={{fontSize:20}}>🔒</span>
          <span>Bu satış <strong>onaylanmış</strong> — düzenleme yetkiniz yok.</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="duzenle-form">

        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Müşteri Bilgileri</h2>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))',gap:12}}>
            <div><label className="duzenle-label">İsim / Ad Soyad *</label><input type="text" value={musteriIsim} onChange={e=>setMusteriIsim(e.target.value)} placeholder="Müşteri adı soyadı" className="duzenle-input" disabled={alanlarKilitli} required /></div>
            <div><label className="duzenle-label">Ünvan</label><input type="text" value={musteriUnvan} onChange={e=>setMusteriUnvan(e.target.value)} placeholder="Şirket ünvanı" className="duzenle-input" disabled={alanlarKilitli} /></div>
            <div><label className="duzenle-label">Vergi Kimlik No</label><input type="text" value={musteriVkNo} onChange={e=>setMusteriVkNo(e.target.value)} placeholder="VK No" className="duzenle-input" disabled={alanlarKilitli} /></div>
            <div><label className="duzenle-label">Vergi Dairesi</label><input type="text" value={musteriVd} onChange={e=>setMusteriVd(e.target.value)} placeholder="Vergi dairesi" className="duzenle-input" disabled={alanlarKilitli} /></div>
            <div><label className="duzenle-label">Adres</label><input type="text" value={musteriAdres} onChange={e=>setMusteriAdres(e.target.value)} placeholder="Teslimat adresi" className="duzenle-input" disabled={alanlarKilitli} /></div>
            <div><label className="duzenle-label">Fatura Adresi</label><input type="text" value={musteriFaturaAdresi} onChange={e=>setMusteriFaturaAdresi(e.target.value)} placeholder="Fatura adresi" className="duzenle-input" disabled={alanlarKilitli} /></div>
            <div><label className="duzenle-label">Cep Telefonu</label><input type="text" value={musteriCep} onChange={e=>setMusteriCep(e.target.value)} placeholder="Cep tel." className="duzenle-input" disabled={alanlarKilitli} /></div>
          </div>
        </div>

        <div className="duzenle-section">
          <div className="duzenle-section-header">
            <h2 className="duzenle-section-title">Ürünler</h2>
            {!alanlarKilitli&&<button type="button" onClick={urunEkle} className="duzenle-btn-add">+ Ürün Ekle</button>}
          </div>
          <div className="duzenle-urun-header">
            <span>Ürün Kodu</span><span>Ürün Adı</span><span>Adet</span><span>Alış (TL)</span><span>BİP (TL)</span><span style={{textAlign:'center'}}>Teslim</span><span></span>
          </div>
          {urunler.map((urun, index) => (
            <div key={urun.id} className="duzenle-urun-row">
              <div className="duzenle-urun-kod-wrap" style={{position:'relative'}}>
                <input type="text" value={urun.kod} onChange={e=>handleUrunChange(index,'kod',e.target.value)} onBlur={()=>setTimeout(()=>setUrunAramaDropdown(null),200)} placeholder="Ürün kodu" className="duzenle-input mono" disabled={alanlarKilitli} autoComplete="off" />
                {urunCache[urun.kod?.trim().toUpperCase()]&&<span className="urun-found-badge">✓ Eşleşti</span>}
                {urunAramaDropdown?.index===index&&urunAramaDropdown.sonuclar.length>0&&(
                  <div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:999,background:'#fff',border:'1px solid #d1fae5',borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,0.12)',maxHeight:220,overflowY:'auto'}}>
                    {urunAramaDropdown.sonuclar.map(kod=>{const info=urunCache[kod];return(<div key={kod} onMouseDown={()=>urunSecDropdown(index,kod)} style={{padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid #f0fdf4',display:'flex',justifyContent:'space-between',fontSize:13}}><span style={{fontWeight:700,color:'#065f46'}}>{kod}</span><span style={{color:'#15803d',fontWeight:600,fontSize:12}}>₺{info?.alis?.toLocaleString('tr-TR')||0}</span></div>);})}
                  </div>
                )}
              </div>
              <input type="text" value={urun.ad} onChange={e=>handleUrunChange(index,'ad',e.target.value)} placeholder="Ürün adı" className="duzenle-input" disabled={alanlarKilitli} />
              <input type="number" value={urun.adet} onChange={e=>handleUrunChange(index,'adet',e.target.value)} className="duzenle-input" min="1" disabled={alanlarKilitli} />
              <input type="number" value={urun.alisFiyati||''} onChange={e=>handleUrunChange(index,'alisFiyati',e.target.value)} placeholder="0" className="duzenle-input mono" disabled={alanlarKilitli} />
              <input type="number" value={urun.bip||''} onChange={e=>handleUrunChange(index,'bip',e.target.value)} placeholder="0" className="duzenle-input mono" disabled={alanlarKilitli} />
              <label style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,fontSize:11,color:'#374151',cursor:alanlarKilitli?'not-allowed':'pointer',minWidth:48,opacity:alanlarKilitli?0.6:1}}>
                <input type="checkbox" checked={(urun as any).delivered===true} onChange={e=>handleUrunDeliveredChange(index,e.target.checked)} disabled={alanlarKilitli} style={{width:16,height:16,accentColor:'#16a34a'}} />✓
              </label>
              {urunler.length>1&&!alanlarKilitli&&<button type="button" onClick={()=>urunSil(index)} className="duzenle-btn-remove">Sil</button>}
            </div>
          ))}
          <div className="duzenle-toplam-bar" style={{display:'flex',alignItems:'center',gap:12}}>
            <span>Satış Tutarı *</span>
            <input type="number" min="0" value={manuelSatisTutari??''} onChange={e=>setManuelSatisTutari(e.target.value===''?null:parseFloat(e.target.value)||0)} placeholder="Satış tutarını girin" disabled={alanlarKilitli} style={{fontWeight:700,color:'#1d4ed8',background:'#eff6ff',border:'1px solid #93c5fd',borderRadius:6,padding:'4px 10px',width:180}} />
          </div>
          <div className="duzenle-maliyet-notu">
            <div>Alış: {formatPrice(alisToplamı())} − BİP: {formatPrice(bipToplamı())}</div>
            {kampanyaToplamiHesapla()>0&&<div style={{color:'#15803d'}}>Kampanya: −{formatPrice(kampanyaToplamiHesapla())}</div>}
            {yesilEtiketToplamIndirim()>0&&<div style={{color:'#15803d'}}>Yeşil Etiket: +{formatPrice(yesilEtiketToplamIndirim())}</div>}
            <div style={{fontWeight:700}}>TOPLAM MALİYET = {formatPrice(toplamMaliyet())}</div>
          </div>
        </div>

        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Kampanyalar</h2>
          {kampanyaAdminListesi.length===0?(<div className="duzenle-empty-state">Aktif kampanya bulunamadı.</div>):(
            <div className="duzenle-kampanya-grid">
              {kampanyaAdminListesi.map(k=>(
                <label key={k.id} className={`duzenle-kampanya-item ${seciliKampanyaIds.includes(k.id!)?'selected':''}`} style={alanlarKilitli?{pointerEvents:'none',opacity:0.6}:{}}>
                  <input type="checkbox" checked={seciliKampanyaIds.includes(k.id!)} onChange={()=>kampanyaToggle(k.id!)} disabled={alanlarKilitli} />
                  <div><div className="duzenle-kampanya-ad">{k.ad}</div>{k.aciklama&&<div className="duzenle-kampanya-aciklama">{k.aciklama}</div>}{(k.tutar||0)>0&&<div style={{fontSize:12,color:'#15803d',fontWeight:600}}>İndirim: {formatPrice(k.tutar||0)}</div>}</div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Ödeme Bilgileri</h2>
          <div className="duzenle-odeme-blok">
            <div className="duzenle-odeme-blok-header"><div className="duzenle-odeme-blok-title">💵 Peşinat</div>{!alanlarKilitli&&<button type="button" onClick={pesinatEkle} className="duzenle-btn-sm">+ Peşinat Ekle</button>}</div>
            {pesinatlar.map(p=>(<div key={p.id} style={{display:'flex',gap:8,marginBottom:8}}>
              <input type="number" min="0" placeholder="Tutar" value={p.tutar||''} onChange={e=>handlePesinatChange(p.id,'tutar',e.target.value)} className="duzenle-input mono" style={{flex:1}} disabled={alanlarKilitli} />
              <input type="text" placeholder="Açıklama" value={p.aciklama} onChange={e=>handlePesinatChange(p.id,'aciklama',e.target.value)} className="duzenle-input" style={{flex:2}} disabled={alanlarKilitli} />
              {!alanlarKilitli&&<button type="button" onClick={()=>pesinatSil(p.id)} className="duzenle-btn-remove">Sil</button>}
            </div>))}
            {pesinatlar.length===0&&<div style={{color:'#9ca3af',fontSize:13}}>Peşinat yok</div>}
            {pesinatToplam()>0&&<div className="duzenle-odeme-bilgi ok">✅ Toplam: {formatPrice(pesinatToplam())}</div>}
          </div>

          <div className="duzenle-odeme-blok" style={{marginTop:12}}>
            <div className="duzenle-odeme-blok-header"><div className="duzenle-odeme-blok-title">🏦 Havale</div>{!alanlarKilitli&&<button type="button" onClick={havaleEkle} className="duzenle-btn-sm">+ Havale Ekle</button>}</div>
            {havaleler.map(h=>(<div key={h.id} style={{display:'flex',gap:8,marginBottom:8}}>
              <select value={h.banka} onChange={e=>handleHavaleChange(h.id,'banka',e.target.value)} className="duzenle-input" style={{flex:2}} disabled={alanlarKilitli}>{HAVALE_BANKALARI.map(b=><option key={b} value={b}>{b}</option>)}</select>
              <input type="number" min="0" placeholder="Tutar" value={h.tutar||''} onChange={e=>handleHavaleChange(h.id,'tutar',e.target.value)} className="duzenle-input mono" style={{flex:1}} disabled={alanlarKilitli} />
              {!alanlarKilitli&&<button type="button" onClick={()=>havaleSil(h.id)} className="duzenle-btn-remove">Sil</button>}
            </div>))}
            {havaleler.length===0&&<div style={{color:'#9ca3af',fontSize:13}}>Havale yok</div>}
            {haveleToplam()>0&&<div className="duzenle-odeme-bilgi ok">✅ Toplam: {formatPrice(haveleToplam())}</div>}
          </div>

          <div className="duzenle-odeme-blok" style={{marginTop:14}}>
            <div className="duzenle-odeme-blok-header"><div className="duzenle-odeme-blok-title">💳 Kart Ödemeleri</div>{!alanlarKilitli&&<button type="button" onClick={kartEkle} className="duzenle-btn-sm">+ Kart Ekle</button>}</div>
            {kartOdemeler.map((kart, index) => {
              const kesintiOrani = kart.kesintiOrani || 0;
              const net = kart.tutar-(kart.tutar*kesintiOrani)/100;
              return (
                <div key={kart.id} className="duzenle-kart-row">
                  <div className="duzenle-kart-fields">
                    <div><label className="duzenle-label">Banka</label><select value={kart.banka} onChange={e=>handleKartChange(index,'banka',e.target.value)} className="duzenle-input" disabled={alanlarKilitli}>{BANKALAR.map(b=><option key={b} value={b}>{b}</option>)}</select></div>
                    <div><label className="duzenle-label">Taksit</label><select value={kart.taksitSayisi} onChange={e=>handleKartChange(index,'taksitSayisi',e.target.value)} className="duzenle-input" disabled={alanlarKilitli}>{TAKSIT_SECENEKLERI.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
                    <div><label className="duzenle-label">Brüt Tutar</label><input type="number" min="0" value={kart.tutar||''} onChange={e=>handleKartChange(index,'tutar',e.target.value)} className="duzenle-input mono" disabled={alanlarKilitli} /></div>
                    <div><label className="duzenle-label">Kesinti</label><input type="text" readOnly value={kesintiOrani>0?`%${kesintiOrani}`:'Bulunamadı'} className="duzenle-input mono" style={{background:kesintiOrani>0?'#f0fdf4':'#fff7ed',color:kesintiOrani>0?'#15803d':'#92400e',fontWeight:600}} /></div>
                    {!alanlarKilitli&&<button type="button" onClick={()=>kartSil(index)} className="duzenle-btn-remove">Sil</button>}
                  </div>
                  {kart.tutar>0&&<div className="duzenle-kart-net">Brüt: {formatPrice(kart.tutar)} → <strong>NET: {formatPrice(net)}</strong></div>}
                </div>
              );
            })}
            {kartOdemeler.length===0&&<div style={{color:'#9ca3af',fontSize:13}}>Kart yok</div>}
          </div>

          <div className="duzenle-kar-bar" style={{background:karZarar()>=0?'#dcfce7':'#fee2e2',color:karZarar()>=0?'#15803d':'#dc2626'}}>
            {karZarar()>=0?`📈 KÂR: ${formatPrice(karZarar())}`:`📉 ZARAR: ${formatPrice(Math.abs(karZarar()))}`}
            <span style={{fontSize:12,marginLeft:12,opacity:0.8}}>(Hesaba Geçen: {formatPrice(hesabaGecenToplam())} — Maliyet: {formatPrice(toplamMaliyet())})</span>
          </div>
          {(()=>{const o=toplamOdenen(),t=toplamTutar(),f=o-t;if(t>0&&f>0)return<div style={{marginTop:8,padding:'10px 14px',borderRadius:8,background:'#fef2f2',border:'2px solid #dc2626',color:'#dc2626',fontWeight:700,fontSize:13}}>🚫 Toplam ödeme ({formatPrice(o)}) satış tutarını ({formatPrice(t)}) <strong>{formatPrice(f)}</strong> aşıyor!</div>;if(t>0&&o>0&&f===0)return<div style={{marginTop:8,padding:'8px 14px',borderRadius:8,background:'#f0fdf4',border:'1px solid #86efac',color:'#15803d',fontWeight:600,fontSize:13}}>✅ Ödeme tam — satış tutarı karşılandı.</div>;return null;})()}
        </div>

        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Notlar</h2>
          <div className="duzenle-notlar-grid">
            <div>
              <label className="duzenle-label">Fatura No</label>
              <input type="text" value={faturaNo} onChange={handleFaturaNoChange} onBlur={handleFaturaNoBlur} placeholder="0001 veya Kesilmedi" className="duzenle-input" disabled={alanlarKilitli} style={{borderColor:faturaNoHata?'#ef4444':undefined}} />
              {faturaNoHata&&<small style={{color:'#ef4444'}}>{faturaNoHataMesaj}</small>}
              {!faturaNoHata&&faturaNo&&isFaturaNoGecerli(faturaNo)&&<small style={{color:'#16a34a'}}>✅ Geçerli</small>}
            </div>
            <div><label className="duzenle-label">Mağaza Teslimat</label><input type="text" value={magaza} onChange={e=>setMagaza(e.target.value)} placeholder="Mağaza adı" className="duzenle-input" disabled={alanlarKilitli} /></div>
            <div><label className="duzenle-label">Servis Notu</label><input type="text" value={servisNotu} onChange={e=>setServisNotu(e.target.value)} className="duzenle-input" disabled={alanlarKilitli} /></div>
            <div style={{gridColumn:'1 / -1'}}>
              <label className="duzenle-label">Teslim Edildi</label>
              <div style={{display:'flex',gap:12,alignItems:'center',marginTop:4}}>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:alanlarKilitli?'not-allowed':'pointer',opacity:alanlarKilitli?0.6:1}}>
                  <input type="radio" name="teslimEdildi" value="evet" checked={teslimEdildiMi===true} onChange={()=>!alanlarKilitli&&setTeslimEdildiMi(true)} disabled={alanlarKilitli} />
                  <span style={teslimEdildiMi?{background:'#fef08a',color:'#854d0e',fontWeight:700,padding:'4px 14px',borderRadius:20,border:'1.5px solid #fde047',fontSize:13}:{fontSize:13}}>{teslimEdildiMi?'✅ Teslim Edildi: Evet':'Evet'}</span>
                </label>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:alanlarKilitli?'not-allowed':'pointer',opacity:alanlarKilitli?0.6:1}}>
                  <input type="radio" name="teslimEdildi" value="hayir" checked={teslimEdildiMi===false} onChange={()=>!alanlarKilitli&&setTeslimEdildiMi(false)} disabled={alanlarKilitli} />
                  <span style={{fontSize:13}}>Hayır</span>
                </label>
              </div>
            </div>
            <div style={{gridColumn:'1 / -1'}}>
              <label className="duzenle-label">📝 Notlar</label>
              <textarea value={notlar} onChange={e=>setNotlar(e.target.value)} placeholder="Satışa ait notları buraya girin..." rows={3} disabled={alanlarKilitli} style={{width:'100%',padding:'8px 12px',border:'1px solid #d1d5db',borderRadius:6,fontSize:14,resize:'vertical',fontFamily:'inherit'}} />
            </div>
          </div>
        </div>

        <div className="duzenle-section">
          <div className="duzenle-mars-header">
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <h2 className="duzenle-section-title" style={{margin:0}}>Mars No / Teslimat Tarihi</h2>
              <span className="duzenle-mars-sayac">{marsListesi.length} / {MAX_MARS}</span>
            </div>
            {marsEklenebilir&&!alanlarKilitli?<button type="button" onClick={marsEkle} className="duzenle-btn-add">+ Yeni Sipariş No</button>:!marsEklenebilir?<span className="duzenle-mars-limit">🔒 Maks. 4 giriş</span>:null}
          </div>
          <div className="duzenle-mars-timeline">
            {marsListesi.map((giris,index)=>(
              <div key={index} className={`duzenle-mars-card ${index===0?'orijinal':'yeni'}`}>
                <div className="duzenle-mars-sol">
                  <div className={`duzenle-mars-nokta ${index===0?'nokta-teal':'nokta-blue'}`}>{index===0?'🏠':'🔄'}</div>
                  {index<marsListesi.length-1&&<div className="duzenle-mars-cizgi" />}
                </div>
                <div className="duzenle-mars-icerik">
                  <div className="duzenle-mars-baslik">
                    <span className={`duzenle-mars-etiket ${index===0?'etiket-teal':'etiket-blue'}`}>{giris.etiket}</span>
                    {index>0&&!alanlarKilitli&&<button type="button" onClick={()=>marsSil(index)} className="duzenle-mars-sil">✕</button>}
                  </div>
                  <div className="duzenle-mars-inputs">
                    <div>
                      <label className="duzenle-label">Mars No</label>
                      <input type="text" value={giris.marsNo} onChange={e=>marsGuncelle(index,'marsNo',e.target.value)} placeholder="10 haneli sayı" maxLength={10} className={`duzenle-input ${index>0?'input-blue':''}`} disabled={alanlarKilitli} style={{borderColor:marsNoHatalar[index]?'#ef4444':(giris.marsNo&&isMarsNoGecerli(giris.marsNo)?'#16a34a':undefined)}} />
                      {marsNoHatalar[index]&&<small style={{color:'#ef4444',display:'block'}}>{marsNoHatalar[index]}</small>}
                      {giris.marsNo&&isMarsNoGecerli(giris.marsNo)&&!marsNoHatalar[index]&&<small style={{color:'#16a34a',display:'block'}}>✅ Geçerli ({giris.marsNo.length}/10)</small>}
                    </div>
                    <div>
                      <label className="duzenle-label">Teslimat Tarihi</label>
                      <input type="date" value={giris.teslimatTarihi} min={satisTarihi||undefined} onChange={e=>marsGuncelle(index,'teslimatTarihi',e.target.value)} className={`duzenle-input ${index>0?'input-blue':''}`} disabled={alanlarKilitli} style={{borderColor:giris.teslimatTarihi&&!isTeslimatTarihiGecerli(giris.teslimatTarihi)?'#ef4444':undefined}} />
                      {giris.teslimatTarihi&&!isTeslimatTarihiGecerli(giris.teslimatTarihi)&&<small style={{color:'#ef4444',display:'block'}}>Teslimat tarihi, satış tarihinden önce olamaz.</small>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="duzenle-iptal-buton-alani">
            {isIptal?(isAdmin&&(<div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}><button type="button" className="duzenle-btn-iptalden-cikar" onClick={()=>setIptaldenCikarPopup(true)}>♻️ İptalden Çıkar</button>{iadeDurumu&&iadeDurumu!=='IADE_ODENDI'&&(<button type="button" onClick={()=>setIadePopup(true)} style={{padding:'8px 18px',background:'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer'}}>💰 İadeyi Onayla</button>)}</div>)):iptalTalebiVar?(<span className="duzenle-iptal-talep-badge">📨 İptal talebi gönderildi — Admin onayı bekleniyor</span>):(<button type="button" className="duzenle-btn-iptal-et" onClick={()=>setIptalPopup(true)}>{isAdmin?'🚫 Bu Satışı İptal Et':'📨 İptal Talebi Gönder'}</button>)}
          </div>
        </div>

        <div className="duzenle-actions">
          <button type="button" onClick={()=>navigate('/dashboard')} className="duzenle-btn-cancel">İptal</button>
          {!alanlarKilitli&&(<button type="submit" className="duzenle-btn-submit" disabled={toplamOdenen()>toplamTutar()&&toplamTutar()>0}>Güncelle</button>)}
        </div>
      </form>
    </Layout>
  );
};

export default SatisDuzenlePage;