import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  limit,
  getDocs,
  DocumentData
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { getSubeByKod } from '../types/sube';
import './NotificationBell.css';

// Tipler
type BildirimTuru =
  | 'YENI_SATIS'
  | 'SATIS_GUNCELLENDI'
  | 'TESLIM_YAKLASIYOR'
  | 'TESLIM_GECIKTI'
  | 'TESLIM_TAMAMLANDI'
  | 'ACIK_HESAP'
  | 'ODEME_ALINDI'
  | 'ZARARLI_SATIS'
  | 'ONAY_BEKLIYOR'
  | 'ONAYLANDI'
  | 'YUKSEK_KAR';

type Oncelik = 'bilgi' | 'orta' | 'yuksek' | 'kritik';

interface Bildirim {
  id: string;
  tur: BildirimTuru;
  baslik: string;
  mesaj: string;
  detay?: string;
  tarih: Date;
  satisKodu?: string;
  satisId?: string;
  satisSubeKodu?: string;
  okundu: boolean;
  oncelik: Oncelik;
  tutar?: number;
  kaynak: 'log' | 'satis' | 'sistem';
}

// Konfigürasyon
const TUR_CFG: Record<BildirimTuru, { icon: string; renk: string; bgRenk: string; etiket: string; oncelik: Oncelik }> = {
  YENI_SATIS:         { icon: '🆕', renk: '#059669', bgRenk: '#e6f5e6', etiket: 'Yeni Satış', oncelik: 'orta' },
  SATIS_GUNCELLENDI:  { icon: '✏️', renk: '#2563eb', bgRenk: '#e6edfa', etiket: 'Güncelleme', oncelik: 'bilgi' },
  TESLIM_YAKLASIYOR:  { icon: '📦', renk: '#d97706', bgRenk: '#fff0e0', etiket: 'Teslim Yakın', oncelik: 'yuksek' },
  TESLIM_GECIKTI:     { icon: '🚨', renk: '#dc2626', bgRenk: '#ffe6e6', etiket: 'Teslim Gecikti', oncelik: 'kritik' },
  TESLIM_TAMAMLANDI:  { icon: '✅', renk: '#16a34a', bgRenk: '#e6f5e6', etiket: 'Teslim Tamam', oncelik: 'bilgi' },
  ACIK_HESAP:         { icon: '💳', renk: '#ea580c', bgRenk: '#fff0e0', etiket: 'Açık Hesap', oncelik: 'yuksek' },
  ODEME_ALINDI:       { icon: '💰', renk: '#0891b2', bgRenk: '#e6f5fa', etiket: 'Ödeme Alındı', oncelik: 'orta' },
  ZARARLI_SATIS:      { icon: '📉', renk: '#be123c', bgRenk: '#ffe6f0', etiket: 'Zararlı Satış', oncelik: 'kritik' },
  ONAY_BEKLIYOR:      { icon: '⏳', renk: '#7c3aed', bgRenk: '#f0e6ff', etiket: 'Onay Bekliyor', oncelik: 'yuksek' },
  ONAYLANDI:          { icon: '🎉', renk: '#0d9488', bgRenk: '#e6f5f5', etiket: 'Onaylandı', oncelik: 'orta' },
  YUKSEK_KAR:         { icon: '🏆', renk: '#b45309', bgRenk: '#fff0e0', etiket: 'Yüksek Kar', oncelik: 'orta' },
};

const ONCELIK_SIRA: Record<Oncelik, number> = {
  kritik: 4,
  yuksek: 3,
  orta: 2,
  bilgi: 1
};

const NotificationBell: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  
  // State
  const [acik, setAcik] = useState(false);
  const [bildirimler, setBildirimler] = useState<Bildirim[]>([]);
  const [okunmuslar, setOkunmuslar] = useState<Set<string>>(new Set());
  const [pinliler, setPinliler] = useState<Set<string>>(new Set());
  const [yukleniyor, setYukleniyor] = useState(true);
  const [arama, setArama] = useState('');
  const [filtreTur, setFiltreTur] = useState<BildirimTuru | 'hepsi' | 'okunmamis' | 'pinli'>('hepsi');
  const [sallaniyor, setSallaniyor] = useState(false);

  // Scroll kontrolü
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);

  const checkScroll = useCallback(() => {
    if (filterRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = filterRef.current;
      setShowLeftScroll(scrollLeft > 0);
      setShowRightScroll(scrollLeft < scrollWidth - clientWidth - 5);
    }
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [checkScroll, acik]);

  const scroll = (direction: 'left' | 'right') => {
    if (filterRef.current) {
      const scrollAmount = 200;
      filterRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
      setTimeout(checkScroll, 300);
    }
  };

  // Panel dışı tıklama
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setAcik(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Kullanıcı bildirim durumlarını yükle (okundu & pin)
  useEffect(() => {
    if (!currentUser?.uid) return;

    const loadUserData = async () => {
      try {
        // Okundu bilgilerini yükle
        const okunduRef = collection(db, `kullaniciBildirimler/${currentUser.uid}/okundu`);
        const okunduSnap = await getDocs(okunduRef);
        setOkunmuslar(new Set(okunduSnap.docs.map((doc: DocumentData) => doc.id)));

        // Pin bilgilerini yükle
        const pinRef = collection(db, `kullaniciBildirimler/${currentUser.uid}/pinler`);
        const pinSnap = await getDocs(pinRef);
        setPinliler(new Set(pinSnap.docs.map((doc: DocumentData) => doc.id)));
      } catch (error) {
        console.error('Bildirim durumları yüklenemedi:', error);
      }
    };

    loadUserData();
  }, [currentUser?.uid]);

  // Log bildirimlerini dinle
  useEffect(() => {
    if (!currentUser) return;

    const sube = getSubeByKod(currentUser.subeKodu);
    if (!sube) return;

    const birHaftaOnce = new Date();
    birHaftaOnce.setDate(birHaftaOnce.getDate() - 7);

    const q = query(
      collection(db, `subeler/${sube.dbPath}/loglar`),
      where('tarih', '>=', Timestamp.fromDate(birHaftaOnce)),
      orderBy('tarih', 'desc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logBildirimler: Bildirim[] = snapshot.docs.map(doc => {
        const data = doc.data();
        let tur: BildirimTuru = 'YENI_SATIS';
        
        if (data.islem === 'YENİ_SATIS') tur = 'YENI_SATIS';
        else if (data.islem === 'GUNCELLEME') tur = 'SATIS_GUNCELLENDI';
        else if (data.islem === 'ONAY_BEKLENIYOR') tur = 'ONAY_BEKLIYOR';
        else if (data.islem === 'ONAYLANDI') tur = 'ONAYLANDI';
        else if (data.islem === 'TESLIM') tur = 'TESLIM_TAMAMLANDI';
        
        return {
          id: doc.id,
          tur,
          baslik: TUR_CFG[tur].etiket,
          mesaj: data.detay || 'İşlem gerçekleştirildi',
          tarih: data.tarih?.toDate() || new Date(),
          satisKodu: data.satisKodu,
          satisId: data.satisId,
          satisSubeKodu: data.subeKodu || sube.kod,
          okundu: false,
          oncelik: TUR_CFG[tur].oncelik,
          kaynak: 'log'
        };
      });

      setBildirimler(prev => {
        const diger = prev.filter(b => b.kaynak !== 'log');
        return [...logBildirimler, ...diger];
      });
      setYukleniyor(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Satış bildirimlerini dinle
  useEffect(() => {
    if (!currentUser) return;

    const sube = getSubeByKod(currentUser.subeKodu);
    if (!sube) return;

    const ucGunOnce = new Date();
    ucGunOnce.setDate(ucGunOnce.getDate() - 3);

    const q = query(
      collection(db, `subeler/${sube.dbPath}/satislar`),
      where('olusturmaTarihi', '>=', Timestamp.fromDate(ucGunOnce)),
      orderBy('olusturmaTarihi', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const satisBildirimler: Bildirim[] = [];
      const now = Date.now();

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const satisKodu = data.satisKodu || doc.id;
        const musteri = data.musteriBilgileri?.isim || 'Müşteri';
        const tarih = data.olusturmaTarihi?.toDate() || new Date();

        // Teslim kontrolü
        if (data.teslimatTarihi && !data.teslimEdildiMi) {
          const teslimTarih = data.teslimatTarihi?.toDate();
          if (teslimTarih) {
            const fark = teslimTarih.getTime() - now;
            const gunKaldi = Math.ceil(fark / (1000 * 60 * 60 * 24));

            if (fark < 0) {
              satisBildirimler.push({
                id: `gecikme-${doc.id}`,
                tur: 'TESLIM_GECIKTI',
                baslik: '⚠️ TESLİM GECİKTİ',
                mesaj: `${satisKodu} - ${musteri}`,
                detay: `${Math.abs(gunKaldi)} gün gecikti`,
                tarih: new Date(),
                satisKodu,
                satisId: doc.id,
                satisSubeKodu: data.subeKodu || sube.kod,
                okundu: false,
                oncelik: 'kritik',
                kaynak: 'satis'
              });
            } else if (gunKaldi <= 3) {
              satisBildirimler.push({
                id: `yaklasan-${doc.id}`,
                tur: 'TESLIM_YAKLASIYOR',
                baslik: gunKaldi === 0 ? '📦 BUGÜN TESLİM' : '📦 TESLİM YAKLAŞIYOR',
                mesaj: `${satisKodu} - ${musteri}`,
                detay: gunKaldi === 0 ? 'Son gün!' : `${gunKaldi} gün kaldı`,
                tarih: new Date(),
                satisKodu,
                satisId: doc.id,
                satisSubeKodu: data.subeKodu || sube.kod,
                okundu: false,
                oncelik: gunKaldi === 0 ? 'kritik' : 'yuksek',
                kaynak: 'satis'
              });
            }
          }
        }

        // Açık hesap kontrolü
        if (data.odemeDurumu === 'AÇIK HESAP' && data.acikHesap > 0) {
          satisBildirimler.push({
            id: `acik-${doc.id}`,
            tur: 'ACIK_HESAP',
            baslik: '💳 AÇIK HESAP',
            mesaj: `${satisKodu} - ${musteri}`,
            detay: `${data.acikHesap?.toLocaleString('tr-TR')} TL tahsilat bekliyor`,
            tarih: new Date(),
            satisKodu,
            satisId: doc.id,
            satisSubeKodu: data.subeKodu || sube.kod,
            okundu: false,
            oncelik: 'yuksek',
            tutar: data.acikHesap,
            kaynak: 'satis'
          });
        }

        // Zararlı satış kontrolü
        if (data.zarar < 0) {
          satisBildirimler.push({
            id: `zarar-${doc.id}`,
            tur: 'ZARARLI_SATIS',
            baslik: '📉 ZARARLI SATIŞ',
            mesaj: `${satisKodu} - ${musteri}`,
            detay: `${Math.abs(data.zarar)?.toLocaleString('tr-TR')} TL zarar`,
            tarih: new Date(),
            satisKodu,
            satisId: doc.id,
            satisSubeKodu: data.subeKodu || sube.kod,
            okundu: false,
            oncelik: 'kritik',
            tutar: data.zarar,
            kaynak: 'satis'
          });
        }

        // Yüksek kar kontrolü
        if (data.zarar >= 10000) {
          satisBildirimler.push({
            id: `kar-${doc.id}`,
            tur: 'YUKSEK_KAR',
            baslik: '🏆 YÜKSEK KAR',
            mesaj: `${satisKodu} - ${musteri}`,
            detay: `${data.zarar?.toLocaleString('tr-TR')} TL kar`,
            tarih: new Date(),
            satisKodu,
            satisId: doc.id,
            satisSubeKodu: data.subeKodu || sube.kod,
            okundu: false,
            oncelik: 'orta',
            tutar: data.zarar,
            kaynak: 'satis'
          });
        }
      });

      setBildirimler(prev => {
        const loglar = prev.filter(b => b.kaynak === 'log');
        return [...loglar, ...satisBildirimler];
      });
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Okundu yap
  const okunduYap = useCallback(async (id: string) => {
    if (!currentUser?.uid) return;

    // State'i güncelle (optimistik update)
    setOkunmuslar(prev => new Set(prev).add(id));

    try {
      const ref = doc(db, `kullaniciBildirimler/${currentUser.uid}/okundu/${id}`);
      await setDoc(ref, { timestamp: Timestamp.now() });
    } catch (error) {
      console.error('Okundu yapılamadı:', error);
      // Hata olursa state'i geri al
      setOkunmuslar(prev => {
        const yeni = new Set(prev);
        yeni.delete(id);
        return yeni;
      });
    }
  }, [currentUser?.uid]);

  // Toplu okundu yap
  const topluOkunduYap = useCallback(async (ids: string[]) => {
    if (!currentUser?.uid || ids.length === 0) return;

    // State'i güncelle
    setOkunmuslar(prev => {
      const yeni = new Set(prev);
      ids.forEach(id => yeni.add(id));
      return yeni;
    });

    try {
      const batch = writeBatch(db);
      ids.forEach(id => {
        const ref = doc(db, `kullaniciBildirimler/${currentUser.uid}/okundu/${id}`);
        batch.set(ref, { timestamp: Timestamp.now() });
      });
      await batch.commit();
    } catch (error) {
      console.error('Toplu okundu yapılamadı:', error);
      // Hata olursa state'i geri al
      setOkunmuslar(prev => {
        const yeni = new Set(prev);
        ids.forEach(id => yeni.delete(id));
        return yeni;
      });
    }
  }, [currentUser?.uid]);

  // Tümünü okundu yap
  const tumunuOku = useCallback(() => {
    const okunmamisIds = bildirimler
      .filter(b => !okunmuslar.has(b.id))
      .map(b => b.id);
    
    if (okunmamisIds.length > 0) {
      topluOkunduYap(okunmamisIds);
    }
  }, [bildirimler, okunmuslar, topluOkunduYap]);

  // Pin değiştir
  const pinDegistir = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!currentUser?.uid) return;

    const yeniPinli = !pinliler.has(id);

    // State'i güncelle
    setPinliler(prev => {
      const yeni = new Set(prev);
      if (yeniPinli) {
        yeni.add(id);
      } else {
        yeni.delete(id);
      }
      return yeni;
    });

    try {
      const ref = doc(db, `kullaniciBildirimler/${currentUser.uid}/pinler/${id}`);
      if (yeniPinli) {
        await setDoc(ref, { timestamp: Timestamp.now() });
      } else {
        await deleteDoc(ref);
      }
    } catch (error) {
      console.error('Pin değiştirilemedi:', error);
      // Hata olursa state'i geri al
      setPinliler(prev => {
        const yeni = new Set(prev);
        if (!yeniPinli) {
          yeni.add(id);
        } else {
          yeni.delete(id);
        }
        return yeni;
      });
    }
  }, [currentUser?.uid, pinliler]);

  // Bildirime tıkla
  const handleBildirimTikla = useCallback((bildirim: Bildirim) => {
    // Okundu yap
    if (!okunmuslar.has(bildirim.id)) {
      okunduYap(bildirim.id);
    }

    // Satış detayına git
    if (bildirim.satisId && bildirim.satisSubeKodu) {
      setAcik(false);
      navigate(`/satis-detay/${bildirim.satisSubeKodu}/${bildirim.satisId}`);
    }
  }, [okunmuslar, okunduYap, navigate]);

  // Zaman formatı
  const formatZaman = useCallback((tarih: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - tarih.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Şimdi';
    if (diffMin < 60) return `${diffMin} dk`;
    if (diffHour < 24) return `${diffHour} sa`;
    if (diffDay === 1) return 'Dün';
    if (diffDay < 7) return `${diffDay} gün`;
    return tarih.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  }, []);

  // Tarih grubu
  const tarihGrubu = useCallback((tarih: Date) => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    if (tarih.toDateString() === now.toDateString()) return 'Bugün';
    if (tarih.toDateString() === yesterday.toDateString()) return 'Dün';
    return tarih.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  }, []);

  // Filtrelenmiş ve sıralanmış bildirimler
  const filtrelenmisBildirimler = useMemo(() => {
    let sonuc = [...bildirimler];

    // Filtre uygula
    if (filtreTur === 'okunmamis') {
      sonuc = sonuc.filter(b => !okunmuslar.has(b.id));
    } else if (filtreTur === 'pinli') {
      sonuc = sonuc.filter(b => pinliler.has(b.id));
    } else if (filtreTur !== 'hepsi') {
      sonuc = sonuc.filter(b => b.tur === filtreTur);
    }

    // Arama uygula
    if (arama.trim()) {
      const aramaLower = arama.toLowerCase();
      sonuc = sonuc.filter(b => 
        b.baslik.toLowerCase().includes(aramaLower) ||
        b.mesaj.toLowerCase().includes(aramaLower) ||
        (b.satisKodu && b.satisKodu.toLowerCase().includes(aramaLower))
      );
    }

    // Sırala: Önce pinliler, sonra kritik, sonra tarih
    return sonuc.sort((a, b) => {
      // Pinliler önce
      const aPinli = pinliler.has(a.id);
      const bPinli = pinliler.has(b.id);
      if (aPinli && !bPinli) return -1;
      if (!aPinli && bPinli) return 1;

      // Sonra öncelik
      const oncelikFark = ONCELIK_SIRA[b.oncelik] - ONCELIK_SIRA[a.oncelik];
      if (oncelikFark !== 0) return oncelikFark;

      // Sonra tarih (yeni önce)
      return b.tarih.getTime() - a.tarih.getTime();
    });
  }, [bildirimler, okunmuslar, pinliler, filtreTur, arama]);

  // Gruplanmış bildirimler
  const gruplanmis = useMemo(() => {
    const gruplar: Record<string, Bildirim[]> = {};
    
    filtrelenmisBildirimler.forEach(b => {
      const grup = tarihGrubu(b.tarih);
      if (!gruplar[grup]) gruplar[grup] = [];
      gruplar[grup].push(b);
    });

    // Grupları sırala
    const sira: Record<string, number> = { Bugün: 0, Dün: 1 };
    return Object.entries(gruplar).sort(([a], [b]) => {
      if (sira[a] !== undefined && sira[b] !== undefined) return sira[a] - sira[b];
      if (sira[a] !== undefined) return -1;
      if (sira[b] !== undefined) return 1;
      return a.localeCompare(b);
    });
  }, [filtrelenmisBildirimler, tarihGrubu]);

  // İstatistikler
  const istatistikler = useMemo(() => {
    const okunmamis = bildirimler.filter(b => !okunmuslar.has(b.id));
    return {
      toplam: bildirimler.length,
      okunmamis: okunmamis.length,
      kritik: okunmamis.filter(b => b.oncelik === 'kritik').length,
      pinli: pinliler.size
    };
  }, [bildirimler, okunmuslar, pinliler]);

  // Yeni bildirim animasyonu
  useEffect(() => {
    if (istatistikler.okunmamis > 0 && !acik) {
      setSallaniyor(true);
      const timer = setTimeout(() => setSallaniyor(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [istatistikler.okunmamis, acik]);

  // Mevcut türler
  const mevcutTurler = useMemo(() => {
    const turSayilari: Record<string, number> = {};
    bildirimler.forEach(b => {
      turSayilari[b.tur] = (turSayilari[b.tur] || 0) + 1;
    });
    return Object.entries(turSayilari) as [BildirimTuru, number][];
  }, [bildirimler]);

  return (
    <div className="nb-wrapper" ref={panelRef}>
      {/* Zil Butonu */}
      <button
        className={`nb-zil ${istatistikler.okunmamis > 0 ? 'nb-zil--aktif' : ''} ${sallaniyor ? 'nb-zil--sallaniyor' : ''}`}
        onClick={() => setAcik(!acik)}
        aria-label={`Bildirimler, ${istatistikler.okunmamis} okunmamış`}
      >
        <svg className="nb-zil-svg" viewBox="0 0 24 24">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        
        {istatistikler.kritik > 0 ? (
          <span className="nb-badge nb-badge--kritik">{istatistikler.kritik}</span>
        ) : istatistikler.okunmamis > 0 ? (
          <span className="nb-badge">{istatistikler.okunmamis > 99 ? '99+' : istatistikler.okunmamis}</span>
        ) : null}
      </button>

      {/* Panel */}
      {acik && (
        <div className="nb-panel">
          {/* Header */}
          <div className="nb-header">
            <div className="nb-header-ust">
              <div className="nb-header-baslik">
                <h3>Bildirimler</h3>
                <span className="nb-header-badge">{istatistikler.toplam}</span>
                {istatistikler.kritik > 0 && (
                  <span className="nb-header-badge kritik">{istatistikler.kritik} kritik</span>
                )}
              </div>
              <div className="nb-header-actions">
                {istatistikler.okunmamis > 0 && (
                  <button className="nb-tumunu-oku" onClick={tumunuOku}>
                    Tümünü Oku
                  </button>
                )}
                <button className="nb-kapat" onClick={() => setAcik(false)}>
                  ✕
                </button>
              </div>
            </div>

            {/* Arama */}
            <div className="nb-arama">
              <span className="nb-arama-icon">🔍</span>
              <input
                type="search"
                placeholder="Satış kodu, müşteri ara..."
                value={arama}
                onChange={(e) => setArama(e.target.value)}
              />
              {arama && (
                <button className="nb-arama-temizle" onClick={() => setArama('')}>
                  ✕
                </button>
              )}
            </div>

            {/* Filtreler - Yatay kaydırmalı */}
            <div style={{ position: 'relative' }}>
              {showLeftScroll && (
                <button 
                  onClick={() => scroll('left')}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '24px',
                    height: '24px',
                    borderRadius: '12px',
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    zIndex: 2,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ‹
                </button>
              )}
              <div className="nb-filtreler" ref={filterRef} onScroll={checkScroll}>
                <button
                  className={`nb-filtre ${filtreTur === 'hepsi' ? 'nb-filtre--aktif' : ''}`}
                  onClick={() => setFiltreTur('hepsi')}
                >
                  Hepsi <span>{bildirimler.length}</span>
                </button>
                <button
                  className={`nb-filtre ${filtreTur === 'okunmamis' ? 'nb-filtre--aktif' : ''}`}
                  onClick={() => setFiltreTur('okunmamis')}
                >
                  Okunmamış <span>{istatistikler.okunmamis}</span>
                </button>
                <button
                  className={`nb-filtre ${filtreTur === 'pinli' ? 'nb-filtre--aktif' : ''}`}
                  onClick={() => setFiltreTur('pinli')}
                >
                  📌 Pinli <span>{istatistikler.pinli}</span>
                </button>
                {mevcutTurler.map(([tur, sayi]) => {
                  const cfg = TUR_CFG[tur];
                  return (
                    <button
                      key={tur}
                      className={`nb-filtre ${filtreTur === tur ? 'nb-filtre--aktif' : ''}`}
                      onClick={() => setFiltreTur(filtreTur === tur ? 'hepsi' : tur)}
                      style={filtreTur === tur ? { background: cfg.renk, borderColor: cfg.renk } : {}}
                    >
                      {cfg.icon} {cfg.etiket} <span>{sayi}</span>
                    </button>
                  );
                })}
              </div>
              {showRightScroll && (
                <button 
                  onClick={() => scroll('right')}
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '24px',
                    height: '24px',
                    borderRadius: '12px',
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    zIndex: 2,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ›
                </button>
              )}
            </div>
          </div>

          {/* Liste */}
          <div className="nb-liste">
            {yukleniyor ? (
              <div className="nb-bos">
                <div className="nb-bos-ikon nb-loading">⏳</div>
                <div className="nb-bos-baslik">Yükleniyor...</div>
              </div>
            ) : filtrelenmisBildirimler.length === 0 ? (
              <div className="nb-bos">
                <div className="nb-bos-ikon">{arama ? '🔍' : '📭'}</div>
                <div className="nb-bos-baslik">
                  {arama ? 'Sonuç bulunamadı' : 'Bildirim yok'}
                </div>
                <div className="nb-bos-aciklama">
                  {arama ? `"${arama}" için bildirim bulunamadı` : 'Her şey yolunda görünüyor'}
                </div>
              </div>
            ) : (
              gruplanmis.map(([grupAdi, bildirimler]) => (
                <div key={grupAdi} className="nb-grup">
                  <div className="nb-grup-baslik">
                    {grupAdi} <span>{bildirimler.length}</span>
                  </div>
                  {bildirimler.map(bildirim => {
                    const cfg = TUR_CFG[bildirim.tur];
                    const okundu = okunmuslar.has(bildirim.id);
                    const pinli = pinliler.has(bildirim.id);

                    return (
                      <div
                        key={bildirim.id}
                        className={`nb-item ${okundu ? 'nb-item--okundu' : 'nb-item--yeni'} ${
                          bildirim.oncelik === 'kritik' ? 'nb-item--kritik' : ''
                        }`}
                        onClick={() => handleBildirimTikla(bildirim)}
                      >
                        <div className="nb-item-ikon" style={{ background: cfg.bgRenk }}>
                          {cfg.icon}
                        </div>
                        <div className="nb-item-ic">
                          <div className="nb-item-ust">
                            <span className="nb-item-baslik">
                              {pinli && <span className="nb-item-pin">📌</span>}
                              {bildirim.baslik}
                            </span>
                            <span className="nb-item-zaman">
                              {formatZaman(bildirim.tarih)}
                            </span>
                          </div>
                          <div className="nb-item-mesaj">{bildirim.mesaj}</div>
                          <div className="nb-item-alt">
                            <span className="nb-item-chip nb-item-chip--tur">
                              {cfg.etiket}
                            </span>
                            {bildirim.oncelik === 'kritik' && !okundu && (
                              <span className="nb-item-chip nb-item-chip--kritik">
                                KRİTİK
                              </span>
                            )}
                            {bildirim.tutar !== undefined && (
                              <span className={`nb-item-tutar ${bildirim.tutar < 0 ? 'negatif' : ''}`}>
                                {bildirim.tutar > 0 ? '+' : ''}
                                {bildirim.tutar.toLocaleString('tr-TR')} TL
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="nb-item-actions">
                          <button
                            className={`nb-item-action ${pinli ? 'nb-item-action--pin' : ''}`}
                            onClick={(e) => pinDegistir(bildirim.id, e)}
                            title={pinli ? 'Pini kaldır' : 'Pinle'}
                          >
                            {pinli ? '📌' : '📍'}
                          </button>
                          {!okundu && (
                            <button
                              className="nb-item-action"
                              onClick={(e) => {
                                e.stopPropagation();
                                okunduYap(bildirim.id);
                              }}
                              title="Okundu işaretle"
                            >
                              ✓
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="nb-footer">
            <div className="nb-footer-sol">
              <span>{filtrelenmisBildirimler.length} / {bildirimler.length} bildirim</span>
              {filtreTur !== 'hepsi' && (
                <button className="nb-footer-temizle" onClick={() => setFiltreTur('hepsi')}>
                  Filtreyi temizle
                </button>
              )}
            </div>
            <span>Son 7 gün</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;