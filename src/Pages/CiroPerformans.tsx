import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs, doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu } from '../types/satis';
import { getSubeByKod, SUBELER, SubeKodu } from '../types/sube';
import { User } from '../types/user';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import Layout from '../components/Layout';
import './CiroPerformans.css';

// ============================================================================
// CONSTANTS & TYPES
// ============================================================================
const FALLBACK_HEDEF = 1_000_000;

const ZAMAN_OPTIONS = [
  { value: 'gunluk', label: 'Günlük' },
  { value: 'haftalik', label: 'Haftalık' },
  { value: 'aylik', label: 'Aylık' },
  { value: 'yillik', label: 'Yıllık' },
] as const;

type ZamanType = typeof ZAMAN_OPTIONS[number]['value'];

// Renk paleti
const PIE_COLORS = [
  '#0d6e9c', '#2e7d5e', '#c28f2e', '#b34a5c', '#3b7b9c', 
  '#7e8b9c', '#8a6d3b', '#5e4b8c', '#d97706', '#059669'
];

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #0d6e9c, #0a4b6e)',
  'linear-gradient(135deg, #2e7d5e, #1e5e45)',
  'linear-gradient(135deg, #c28f2e, #9e721f)',
  'linear-gradient(135deg, #b34a5c, #8a3947)',
  'linear-gradient(135deg, #3b7b9c, #2c5d78)',
  'linear-gradient(135deg, #8a6d3b, #6b4e2a)',
];

const SUBE_RENKLER: Record<string, string> = {
  KARTAL: '#0d6e9c',
  PENDIK: '#2e7d5e',
  SANCAKTEPE: '#c28f2e',
  BUYAKA: '#3b7b9c',
  SOGANLIK: '#b34a5c',
};

// Yardımcı fonksiyonlar
const getSubeRenk = (kod: string): string => SUBE_RENKLER[kod] || '#7e8b9c';
const isAdmin = (role: any): boolean => role && String(role).toUpperCase().trim() === 'ADMIN';
const ayKey = (d: Date = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const magazaDocId = (subeKod: string, ay: string): string => `${subeKod}-${ay}`;

// Formatlama fonksiyonları
const formatTL = (n: number): string =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);

const formatKisa = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}₺${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}₺${(abs / 1_000).toFixed(0)}K`;
  return `${sign}₺${abs}`;
};

// ============================================================================
// BİLEŞENLER
// ============================================================================

// ----------------------------------------------------------------------------
// Custom Tooltip
// ----------------------------------------------------------------------------
const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="cp-tooltip">
      <p className="cp-tooltip-label">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="cp-tooltip-row" style={{ color: p.color }}>
          {p.name}: {formatTL(p.value)}
        </p>
      ))}
    </div>
  );
};

// ----------------------------------------------------------------------------
// KPI Kartı (5'li Grid için)
// ----------------------------------------------------------------------------
const KpiCard: React.FC<{
  icon: string;
  label: string;
  value: string;
  sub?: string;
  trend?: number;
  color: string;
}> = ({ icon, label, value, sub, trend, color }) => (
  <div className="cp-kpi-card">
    <div className="cp-kpi-icon" style={{ background: `${color}15`, color }}>
      {icon}
    </div>
    <div className="cp-kpi-content">
      <div className="cp-kpi-label">{label}</div>
      <div className="cp-kpi-value">{value}</div>
      {sub && <div className="cp-kpi-sub">{sub}</div>}
      {trend !== undefined && (
        <div className={`cp-kpi-trend ${trend >= 0 ? 'positive' : 'negative'}`}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%
        </div>
      )}
    </div>
  </div>
);

// ----------------------------------------------------------------------------
// Satıcı Pie Chart
// ----------------------------------------------------------------------------
// ─── SATICI PERFORMANS PIE CHART (DÜZELTİLDİ) ──────────────────────────────
const SaticiPieChart: React.FC<{ data: any[] }> = ({ data }) => {
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [activeItem, setActiveItem] = useState<any>(null);
  
  const onPieEnter = (_: any, index: number): void => {
    setActiveIndex(index);
    setActiveItem(data[index]);
  };
  
  const onPieLeave = (): void => {
    setActiveIndex(-1);
    setActiveItem(null);
  };
  
  if (data.length === 0) {
    return <div className="cp-empty-state">Satıcı verisi bulunamadı</div>;
  }
  
  const toplamCiro: number = data.reduce((sum, item) => sum + item.value, 0);
  
  // Aktif item yoksa toplam göster, varsa o satıcının bilgilerini göster
  const displayName = activeItem ? activeItem.name : 'Toplam Ciro';
  const displayValue = activeItem ? activeItem.value : toplamCiro;
  const displaySub = activeItem 
    ? `${activeItem.satisSayisi} satış` 
    : `${data.length} satıcı`;
  
  return (
    <div className="cp-pie-container">
      <ResponsiveContainer width="100%" height={320}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={90}
            outerRadius={130}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={2}
            stroke="#ffffff"
            onMouseEnter={onPieEnter}
            onMouseLeave={onPieLeave}
          >
            {data.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={entry.renk || PIE_COLORS[index % PIE_COLORS.length]}
                opacity={activeIndex === -1 || activeIndex === index ? 1 : 0.7}
              />
            ))}
          </Pie>
          <Tooltip 
            formatter={(value: any, name: any, props: any) => {
              // Tooltip'te de isim ve para göster
              return [`${formatTL(value)}`, props.payload.name];
            }}
            contentStyle={{
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      
      {/* Merkezde - Hoverda satıcı adı ve parası, normalde toplam */}
      <div className="cp-pie-center">
        <div className="cp-pie-center-label">{displayName}</div>
        <div className="cp-pie-center-value">{formatKisa(displayValue)}</div>
        <div className="cp-pie-center-sub">{displaySub}</div>
      </div>
      
      {/* Legend */}
      <div className="cp-pie-legend">
        {data.slice(0, 5).map((item, i) => (
          <div 
            key={i} 
            className={`cp-legend-item ${activeIndex === i ? 'active' : ''}`}
            onMouseEnter={() => {
              setActiveIndex(i);
              setActiveItem(item);
            }}
            onMouseLeave={() => {
              setActiveIndex(-1);
              setActiveItem(null);
            }}
          >
            <span className="cp-legend-dot" style={{ background: item.renk || PIE_COLORS[i] }} />
            <span className="cp-legend-label">{item.name}</span>
            <span className="cp-legend-value">{formatKisa(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
// ----------------------------------------------------------------------------
// Hedef Item
// ----------------------------------------------------------------------------
const HedefItem: React.FC<{
  kod: string;
  ad: string;
  renk: string;
  ciro: number;
  hedef: number;
  yuzde: number;
  isAdmin: boolean;
  duzenle: string | null;
  onDuzenle: (k: string) => void;
  girdi: string;
  onGirdi: (v: string) => void;
  onKaydet: (k: string) => void;
  onIptal: () => void;
  kaydediliyor: boolean;
}> = ({ kod, ad, renk, ciro, hedef, yuzde, isAdmin, duzenle, onDuzenle, girdi, onGirdi, onKaydet, onIptal, kaydediliyor }) => {
  const editing = duzenle === kod;
  
  return (
    <div className="cp-hedef-item">
      <div className="cp-hedef-top">
        <div className="cp-hedef-left">
          <div className="cp-hedef-renk" style={{ background: renk }} />
          <span className="cp-hedef-ad">{ad.replace(' Şubesi', '')}</span>
        </div>
        <div className="cp-hedef-right">
          <span className="cp-hedef-ciro" style={{ color: renk }}>{formatKisa(ciro)}</span>
          <span className="cp-hedef-sep">/</span>
          {editing ? (
            <div className="cp-hedef-edit">
              <input
                type="number"
                value={girdi}
                onChange={e => onGirdi(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') onKaydet(kod);
                  if (e.key === 'Escape') onIptal();
                }}
                className="cp-hedef-input"
                placeholder="Hedef TL"
                autoFocus
              />
              <button className="cp-hedef-save" onClick={() => onKaydet(kod)} disabled={kaydediliyor}>✓</button>
              <button className="cp-hedef-cancel" onClick={onIptal}>✕</button>
            </div>
          ) : (
            <button
              className={`cp-hedef-btn ${hedef > 0 ? 'dolu' : 'bos'}`}
              onClick={() => {
                if (!isAdmin) return;
                onDuzenle(kod);
                onGirdi(hedef > 0 ? String(hedef) : '');
              }}
              style={{ cursor: isAdmin ? 'pointer' : 'default' }}
            >
              {hedef > 0 ? formatKisa(hedef) : (isAdmin ? '+ Hedef Gir' : '—')}
              {isAdmin && hedef > 0 && <span className="cp-edit-icon">✎</span>}
            </button>
          )}
        </div>
      </div>
      <div className="cp-hedef-progress">
        <div
          className="cp-hedef-fill"
          style={{
            width: `${yuzde}%`,
            background: `linear-gradient(90deg, ${renk}80, ${renk})`,
          }}
        />
      </div>
      {hedef > 0 && (
        <div className="cp-hedef-yuzde">
          %{yuzde.toFixed(0)} tamamlandı
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Satıcı Satırı (Liste için)
// ----------------------------------------------------------------------------
const SaticiRow: React.FC<{ satici: any; rank: number }> = ({ satici, rank }) => {
  const initials = satici.ad.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const rankEmoji = ['🥇', '🥈', '🥉'];
  
  return (
    <div className={`cp-satici-row ${rank === 0 ? 'cp-satici-row--top' : ''}`}>
      <div className="cp-satici-rank">
        {rank < 3 ? (
          <span className="cp-rank-emoji">{rankEmoji[rank]}</span>
        ) : (
          <span className="cp-rank-sayi">#{rank + 1}</span>
        )}
      </div>
      
      <div className="cp-satici-avatar" style={{ background: AVATAR_GRADIENTS[rank % AVATAR_GRADIENTS.length] }}>
        {initials}
      </div>
      
      <div className="cp-satici-info">
        <div className="cp-satici-ad">{satici.ad}</div>
        <div className="cp-satici-sube">{satici.subeAd}</div>
      </div>
      
      <div className="cp-satici-stats">
        <div className="cp-satici-stat">
          <span className="cp-stat-label">Ciro</span>
          <span className="cp-stat-value">{formatKisa(satici.ciro)}</span>
        </div>
        <div className="cp-satici-stat">
          <span className="cp-stat-label">Kâr</span>
          <span className={`cp-stat-value ${satici.kar >= 0 ? 'pozitif' : 'negatif'}`}>
            {satici.kar >= 0 ? '▲' : '▼'} {formatKisa(Math.abs(satici.kar))}
          </span>
        </div>
        <div className="cp-satici-stat">
          <span className="cp-stat-label">Satış</span>
          <span className="cp-stat-value">{satici.satisSayisi}</span>
        </div>
      </div>
      
      <div className="cp-satici-hedef">
        <div className="cp-hedef-bar">
          <div
            className="cp-hedef-bar-fill"
            style={{
              width: `${satici.yuzde}%`,
              background: `linear-gradient(90deg, #0d6e9c, #3b7b9c)`,
            }}
          />
        </div>
        <div className="cp-hedef-oran">{satici.yuzde.toFixed(0)}%</div>
      </div>
      
      <div className="cp-satici-yildiz">
        <div className="cp-yildizlar">
          {[...Array(5)].map((_, i) => (
            <span key={i} className={`cp-yildiz ${i < Math.floor(satici.yildiz / 2) ? 'dolu' : ''}`}>★</span>
          ))}
        </div>
        <span className="cp-yildiz-puan">{satici.yildiz}/10</span>
      </div>
    </div>
  );
};

// ============================================================================
// ANA BİLEŞEN
// ============================================================================
const CiroPerformansPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // State'ler
  const [satislar, setSatislar] = useState<SatisTeklifFormu[]>([]);
  const [saticilar, setSaticilar] = useState<User[]>([]);
  // ⚠️ urunler ve stoklar state'leri korunuyor - kasa stok sistemiyle bağlantılı
  const [urunler, setUrunler] = useState<any[]>([]);
  const [stoklar, setStoklar] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [zaman, setZaman] = useState<ZamanType>('aylik');
  const [seciliSube, setSeciliSube] = useState<SubeKodu | 'tumu'>('tumu');
  
  // Hedef state'leri
  const [magazaHedefler, setMagazaHedefler] = useState<Record<string, number>>({});
  const [hedefDuzenle, setHedefDuzenle] = useState<string | null>(null);
  const [hedefGirdi, setHedefGirdi] = useState<string>('');
  const [hedefKaydediliyor, setHedefKaydediliyor] = useState<boolean>(false);

  // Hesaplanan değerler
  const userIsAdmin: boolean = useMemo(() => isAdmin(currentUser?.role), [currentUser]);
  const simdi: Date = useMemo(() => new Date(), []);
  const buAy: string = useMemo(() => ayKey(simdi), [simdi]);

  const aktifSube: SubeKodu | null = useMemo((): SubeKodu | null => {
    if (!userIsAdmin) return (currentUser?.subeKodu as SubeKodu) ?? null;
    return seciliSube === 'tumu' ? null : seciliSube as SubeKodu;
  }, [userIsAdmin, seciliSube, currentUser]);

  // Hoş geldin mesajı
  const userName: string = currentUser ? `${currentUser.ad || 'Berat'} ${currentUser.soyad || ''}` : 'Berat';
  const today: string = new Date().toLocaleDateString('tr-TR', { 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric',
    weekday: 'long'
  });

  // ==========================================================================
  // VERİ ÇEKME (⚠️ Tüm fetch'ler korunuyor - kasa stok sistemi bağlantısı)
  // ==========================================================================
  useEffect(() => {
    if (!currentUser) {
      navigate('/login');
      return;
    }
    
    const fetchData = async (): Promise<void> => {
      setLoading(true);
      try {
        // Tüm şubelerden satışları çek
        const satisPromises = SUBELER.map(sube =>
          getDocs(collection(db, `subeler/${sube.dbPath}/satislar`))
            .then(snap => snap.docs.map(d => ({ 
              id: d.id, 
              ...d.data(), 
              subeKodu: sube.kod,
              tarih: d.data().tarih?.toDate?.() || new Date()
            } as SatisTeklifFormu)))
            .catch(() => [] as SatisTeklifFormu[])
        );
        
        // ⚠️ Ürünleri çek - kasa stok sistemiyle bağlantılı, korunuyor
        const urunPromises = SUBELER.map(sube =>
          getDocs(collection(db, `subeler/${sube.dbPath}/urunler`))
            .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data(), subeKodu: sube.kod })))
            .catch(() => [])
        );
        
        // ⚠️ Stokları çek - kasa stok sistemiyle bağlantılı, korunuyor
        const stokPromises = SUBELER.map(sube =>
          getDocs(collection(db, `subeler/${sube.dbPath}/stoklar`))
            .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data(), subeKodu: sube.kod })))
            .catch(() => [])
        );
        
        const [satisResults, usersSnap, magazaSnap, urunResults, stokResults] = await Promise.all([
          Promise.all(satisPromises),
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'magazaHedefler')),
          Promise.all(urunPromises),
          Promise.all(stokPromises),
        ]);
        
        setSatislar(satisResults.flat());
        setUrunler(urunResults.flat());
        setStoklar(stokResults.flat());
        
        // Kullanıcıları çek
        const users = usersSnap.docs.map(d => {
          const data = d.data();
          return { 
            uid: d.id, 
            ...data, 
            hedefler: data.hedefler || {}, 
            hedef: data.hedef || 0 
          } as User;
        });
        setSaticilar(users.filter(u => !isAdmin(u.role)));
        
        // Mağaza hedeflerini çek
        const mh: Record<string, number> = {};
        magazaSnap.forEach(d => {
          mh[d.id] = d.data().hedef || 0;
        });
        setMagazaHedefler(mh);
        
      } catch (err) {
        console.error('Veri çekme hatası:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [currentUser, navigate]);

  // ==========================================================================
  // YARDIMCI FONKSİYONLAR
  // ==========================================================================
  const toDate = useCallback((d: any): Date => {
    try {
      if (!d) return new Date(0);
      if (typeof d.toDate === 'function') return d.toDate();
      if (d?.seconds) return new Date(d.seconds * 1000);
      return new Date(d);
    } catch {
      return new Date(0);
    }
  }, []);

  // ==========================================================================
  // FİLTRELENMİŞ VERİLER
  // ==========================================================================
  const zamanFiltreliSatislar = useMemo((): SatisTeklifFormu[] => {
    const now = new Date();
    return satislar.filter(s => {
      if (!s.tarih) return false;
      const t = toDate(s.tarih);
      if (isNaN(t.getTime())) return false;
      
      switch (zaman) {
        case 'gunluk':
          return t.toDateString() === now.toDateString();
        case 'haftalik': {
          const haftaOnce = new Date(now);
          haftaOnce.setDate(now.getDate() - 7);
          return t >= haftaOnce;
        }
        case 'aylik':
          return t.getMonth() === now.getMonth() && t.getFullYear() === now.getFullYear();
        case 'yillik':
          return t.getFullYear() === now.getFullYear();
        default:
          return true;
      }
    });
  }, [satislar, zaman, toDate]);

  const filtreliSatislar: SatisTeklifFormu[] = useMemo(
    () => (aktifSube ? zamanFiltreliSatislar.filter(s => s.subeKodu === aktifSube) : zamanFiltreliSatislar),
    [zamanFiltreliSatislar, aktifSube]
  );

  const filtreliSaticilar: User[] = useMemo(
    () => (aktifSube ? saticilar.filter(u => u.subeKodu === aktifSube) : saticilar),
    [saticilar, aktifSube]
  );

  // ==========================================================================
  // KPI HESAPLAMALARI (5'li - Ürün Çeşidi ve Azalan Stok kartları kaldırıldı)
  // ==========================================================================
  const kpiList = useMemo((): any[] => {
    const ciro: number = filtreliSatislar.reduce((toplam, satis) => toplam + (satis.toplamTutar || 0), 0);
    const kar: number = filtreliSatislar.reduce((toplam, satis) => toplam + (satis.zarar ?? 0), 0);
    const adet: number = filtreliSatislar.length;
    
    // Geçen dönem karşılaştırması
    const oncekiDonemSatislar = satislar.filter(s => {
      const t = toDate(s.tarih);
      const now = new Date();
      if (zaman === 'aylik') {
        return t.getMonth() === now.getMonth() - 1 && t.getFullYear() === now.getFullYear();
      }
      return false;
    });
    const oncekiCiro: number = oncekiDonemSatislar.reduce((toplam, s) => toplam + (s.toplamTutar || 0), 0);
    const ciroDegisim: number = oncekiCiro > 0 ? ((ciro - oncekiCiro) / oncekiCiro) * 100 : 0;
    
    // Ortalama satış tutarı
    const ortalamaSatis: number = adet > 0 ? ciro / adet : 0;
    
    // Karlılık oranı
    const karMarji: number = ciro > 0 ? (kar / ciro) * 100 : 0;
    
    // Aktif satıcı sayısı
    const aktifSaticiSayisi: number = filtreliSaticilar.length;
    
    // Bugünkü satış
    const bugunSatis: number = satislar.filter(s => {
      const t = toDate(s.tarih);
      return t.toDateString() === new Date().toDateString();
    }).length;
    
    return [
      {
        icon: '💰',
        label: 'Toplam Ciro',
        value: formatTL(ciro),
        sub: `${adet} satış`,
        trend: ciroDegisim,
        color: '#0d6e9c'
      },
      {
        icon: kar >= 0 ? '📈' : '📉',
        label: 'Net Kâr/Zarar',
        value: formatTL(kar),
        sub: `%${karMarji.toFixed(1)} marj`,
        color: kar >= 0 ? '#2e7d5e' : '#b34a5c'
      },
      {
        icon: '🛒',
        label: 'Ortalama Satış',
        value: formatTL(ortalamaSatis),
        sub: 'işlem başına',
        color: '#c28f2e'
      },
      {
        icon: '👥',
        label: 'Aktif Satıcı',
        value: aktifSaticiSayisi.toString(),
        sub: 'kişi',
        color: '#3b7b9c'
      },
      {
        icon: '📅',
        label: 'Bugünkü Satış',
        value: bugunSatis.toString(),
        sub: 'işlem',
        color: '#5e4b8c'
      }
    ];
  }, [filtreliSatislar, satislar, filtreliSaticilar, zaman, toDate]);

  // ==========================================================================
  // SATICI PIE VERİSİ
  // ==========================================================================
// ─── SATICI PIE VERİSİ (DÜZELTİLDİ) ────────────────────────────────────────
const saticiPieData = useMemo((): any[] => {
  return filtreliSaticilar
    .map(satici => {
      const ad: string = `${satici.ad} ${satici.soyad}`;
      const satislari: SatisTeklifFormu[] = filtreliSatislar.filter(s => 
        s.musteriTemsilcisiId === satici.uid || 
        s.musteriTemsilcisiAd === ad || 
        s.olusturanKullanici === ad
      );
      
      const ciro: number = satislari.reduce((toplam, s) => toplam + (s.toplamTutar || 0), 0);
      const kar: number = satislari.reduce((toplam, s) => toplam + (s.zarar ?? 0), 0);
      
      return {
        name: satici.ad,  // Sadece isim
        fullName: ad,      // Tam ad
        value: ciro,
        renk: PIE_COLORS[filtreliSaticilar.indexOf(satici) % PIE_COLORS.length],
        satisSayisi: satislari.length,
        kar: kar
      };
    })
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value);
}, [filtreliSaticilar, filtreliSatislar]);

  // ==========================================================================
  // ÜRÜN ANALİZİ (TÜM ŞUBELER) - ⚠️ Korunuyor, kasa stok bağlantısı
  // ==========================================================================
// Ürün analizi - TL değerleri yüksek göster
const urunAnalizi = useMemo((): { enCokSatanlar: any[]; azalanStoklar: any[] } => {
  // En çok satan ürünler
  const urunSatis: Record<string, { 
    ad: string; 
    adet: number; 
    ciro: number;
    sube: string;
    urunKodu: string;
  }> = {};
  
  filtreliSatislar.forEach(satis => {
    if (satis.urunler && Array.isArray(satis.urunler)) {
      satis.urunler.forEach((urun: any) => {
        const kod: string = urun.urunKodu || urun.kod || 'bilinmeyen';
        const urunAdi: string = urun.urunAdi || urun.ad || urun.isim || urun.urunKodu || urun.kod || 'Ürün';
        const birimFiyat: number = urun.fiyat || urun.birimFiyat || 0;
        const adet: number = urun.adet || 1;
        
        if (!urunSatis[kod]) {
          urunSatis[kod] = { 
            ad: urunAdi, 
            adet: 0, 
            ciro: 0,
            sube: satis.subeKodu || '',
            urunKodu: kod
          };
        }
        urunSatis[kod].adet += adet;
        urunSatis[kod].ciro += birimFiyat * adet;
      });
    }
  });
    
  const enCokSatanlar = Object.values(urunSatis)
    .filter(item => item.adet > 0)
    .sort((a, b) => b.ciro - a.ciro)
    .slice(0, 5)
    .map((item, index) => ({
      ...item,
      sira: index + 1,
      subeAd: getSubeByKod(item.sube as SubeKodu)?.ad?.replace(' Şubesi', '') || item.sube,
      // TL formatını önceden hesapla
      ciroTL: formatTL(item.ciro),
      ciroKisa: formatKisa(item.ciro)
    }));
      console.log('🔥 En çok satanlar:', enCokSatanlar);
    // TÜM ŞUBELERDEKİ AZALAN STOKLAR
     const azalanStoklar: any[] = [];
  
  SUBELER.forEach(sube => {
    const subeStoklari = stoklar.filter(s => s.subeKodu === sube.kod);
    
    subeStoklari.forEach(stok => {
      const adet: number = stok.adet || 0;
      const kritikSeviye: number = stok.kritikSeviye || 10;
      
      if (adet < kritikSeviye) {
        azalanStoklar.push({
          sube: sube.ad.replace(' Şubesi', ''),
          subeKod: sube.kod,
          urunKodu: stok.urunKodu || stok.id,
          urunAdi: stok.urunAdi || stok.urunKodu || 'Ürün',
          adet: adet,
          kritikSeviye: kritikSeviye,
          renk: SUBE_RENKLER[sube.kod] || '#64748b'
        });
      }
    });
  });
  
  azalanStoklar.sort((a, b) => a.adet - b.adet);
  
  return { enCokSatanlar, azalanStoklar };
}, [filtreliSatislar, stoklar]);
  // ==========================================================================
  // GÜNLÜK SATIŞ VERİSİ
  // ==========================================================================
  const gunlukSatisVerisi = useMemo((): any[] => {
    const gunSayisi: number = new Date(simdi.getFullYear(), simdi.getMonth() + 1, 0).getDate();
    
    return Array.from({ length: gunSayisi }, (_, i) => {
      const gun: number = i + 1;
      const gunSatislari = satislar.filter(s => {
        if (!s.tarih) return false;
        try {
          const t = toDate(s.tarih);
          if (isNaN(t.getTime())) return false;
          if (aktifSube && s.subeKodu !== aktifSube) return false;
          return t.getDate() === gun && t.getMonth() === simdi.getMonth() && t.getFullYear() === simdi.getFullYear();
        } catch {
          return false;
        }
      });
      
      return {
        gun: `${gun}`,
        ciro: gunSatislari.reduce((toplam, s) => toplam + (s.toplamTutar || 0), 0),
        kar: gunSatislari.reduce((toplam, s) => toplam + (s.zarar ?? 0), 0),
        adet: gunSatislari.length,
      };
    });
  }, [satislar, aktifSube, simdi, toDate]);

  // ==========================================================================
  // SATICI PERFORMANS LİSTESİ
  // ==========================================================================
  const saticiPerformans = useMemo((): any[] => {
    return filtreliSaticilar
      .map(s => {
        const ad: string = `${s.ad} ${s.soyad}`;
        const satislari = filtreliSatislar.filter(x =>
          x.musteriTemsilcisiId === s.uid || 
          x.musteriTemsilcisiAd === ad || 
          x.olusturanKullanici === ad
        );
        
        const ciro: number = satislari.reduce((toplam, x) => toplam + (x.toplamTutar || 0), 0);
        const kar: number = satislari.reduce((toplam, x) => toplam + (x.zarar ?? 0), 0);
        const satisSayisi: number = satislari.length;
        
        // Hedef hesaplama
        const hedeflerMap = s.hedefler as Record<string, number> | undefined;
        const hedefAy = hedeflerMap?.[buAy];
        const hedefEski = s.hedef as number | undefined;
        const hedef: number = hedefAy && hedefAy > 0 ? hedefAy : (hedefEski && hedefEski > 0 ? hedefEski : FALLBACK_HEDEF);
        
        const yuzde: number = Math.min((ciro / hedef) * 100, 100);
        const yildiz: number = Math.min(Math.round((ciro / hedef) * 10), 10);
        
        return {
          ad,
          uid: s.uid,
          subeAd: getSubeByKod(s.subeKodu as SubeKodu)?.ad || '',
          ciro,
          kar,
          hedef,
          satisSayisi,
          yuzde,
          yildiz,
        };
      })
      .sort((a, b) => b.ciro - a.ciro);
  }, [filtreliSaticilar, filtreliSatislar, buAy]);

  // ==========================================================================
  // MAĞAZA HEDEFLERİ
  // ==========================================================================
  const magazaHedefListesi = useMemo((): any[] => {
    return SUBELER
      .filter(sube => (aktifSube ? sube.kod === aktifSube : true))
      .map(sube => {
        const subeSatislar = zamanFiltreliSatislar.filter(s => s.subeKodu === sube.kod);
        const ciro: number = subeSatislar.reduce((toplam, s) => toplam + (s.toplamTutar || 0), 0);
        const docId: string = magazaDocId(sube.kod, buAy);
        const hedef: number = magazaHedefler[docId] || magazaHedefler[sube.kod] || 0;
        const yuzde: number = hedef > 0 ? Math.min((ciro / hedef) * 100, 100) : 0;
        
        return {
          kod: sube.kod,
          ad: sube.ad,
          ciro,
          hedef,
          yuzde,
          renk: getSubeRenk(sube.kod),
        };
      });
  }, [zamanFiltreliSatislar, magazaHedefler, aktifSube, buAy]);

  // ==========================================================================
  // HEDEF KAYDET
  // ==========================================================================
  const hedefKaydet = async (subeKod: string): Promise<void> => {
    const yeniHedef: number = parseFloat(hedefGirdi) || 0;
    if (yeniHedef <= 0) {
      alert('Lütfen geçerli bir hedef girin!');
      return;
    }
    
    setHedefKaydediliyor(true);
    try {
      const docId: string = magazaDocId(subeKod, buAy);
      await setDoc(doc(db, 'magazaHedefler', docId), {
        hedef: yeniHedef,
        subeKod,
        ay: buAy,
        guncellemeTarihi: Timestamp.now(),
        guncelleyen: currentUser?.uid || '',
      });
      
      setMagazaHedefler(prev => ({ ...prev, [docId]: yeniHedef }));
      setHedefDuzenle(null);
      setHedefGirdi('');
    } catch (err) {
      console.error('Hedef kaydedilemedi:', err);
      alert('Hedef kaydedilirken hata oluştu!');
    } finally {
      setHedefKaydediliyor(false);
    }
  };

  const zamanLabel: string = 
    zaman === 'gunluk' ? 'Bugün' : 
    zaman === 'haftalik' ? 'Bu Hafta' : 
    zaman === 'aylik' ? 'Bu Ay' : 'Bu Yıl';

  // ==========================================================================
  // LOADING
  // ==========================================================================
  if (loading) {
    return (
      <Layout pageTitle="Ciro & Performans">
        <div className="cp-loading">
          <div className="cp-spinner" />
          <span>Veriler yükleniyor...</span>
        </div>
      </Layout>
    );
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================
  return (
    <Layout
      pageTitle="Ciro & Performans"
      headerExtra={
        <div className="cp-zaman-toggle">
          {ZAMAN_OPTIONS.map(z => (
            <button
              key={z.value}
              className={`cp-toggle-btn ${zaman === z.value ? 'active' : ''}`}
              onClick={() => setZaman(z.value)}
            >
              {z.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="cp-root">
        
        {/* 1. HOŞ GELDİN KARTI */}
        <div className="cp-welcome-card">
          <div className="cp-welcome-left">
            <div className="cp-welcome-avatar">
              <span>👋</span>
            </div>
            <div className="cp-welcome-text">
              <h1>Hoş geldin, {userName}!</h1>
              <p>
                <span>{today}</span>
                <span className="cp-welcome-badge">Aktif Oturum</span>
              </p>
            </div>
          </div>
          <div className="cp-welcome-date">
            <span>📅 {simdi.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>

        {/* 2. ŞUBE FİLTRESİ (Admin için) */}
        {userIsAdmin && (
          <div className="cp-sube-filtre">
            <span className="cp-sube-label">Şube:</span>
            <button
              className={`cp-sube-btn ${seciliSube === 'tumu' ? 'active' : ''}`}
              onClick={() => setSeciliSube('tumu')}
            >
              Tümü
            </button>
            {SUBELER.map(sube => (
              <button
                key={sube.kod}
                className={`cp-sube-btn ${seciliSube === sube.kod ? 'active' : ''}`}
                onClick={() => setSeciliSube(sube.kod as SubeKodu)}
                style={seciliSube === sube.kod ? { background: getSubeRenk(sube.kod) } : {}}
              >
                {sube.ad.replace(' Şubesi', '')}
              </button>
            ))}
          </div>
        )}

        {/* 3. 5'Lİ KPI GRID (Ürün Çeşidi ve Azalan Stok kaldırıldı) */}
        <div className="cp-kpi-5grid">
          {kpiList.map((kpi, index) => (
            <KpiCard
              key={index}
              icon={kpi.icon}
              label={kpi.label}
              value={kpi.value}
              sub={kpi.sub}
              trend={kpi.trend}
              color={kpi.color}
            />
          ))}
        </div>

        {/* 4. SATICI PERFORMANS PIE CHART */}
        <div className="cp-satici-pie-section">
          <div className="cp-section-header">
            <h2>
              <span className="cp-section-icon">🥧</span>
              Satıcı Performans Dağılımı
            </h2>
            <span className="cp-section-badge">{zamanLabel}</span>
          </div>
          <SaticiPieChart data={saticiPieData} />
        </div>

        {/* 5. 4'LÜ ALT GRID */}
        <div className="cp-bottom-4grid">

          
          {/* GÜNLÜK SATIŞ GRAFİĞİ */}
          <div className="cp-card">
            <div className="cp-card-header">
              <h3>
                <span className="cp-card-icon">📊</span>
                Günlük Satış
              </h3>
              <span className="cp-card-badge">
                {simdi.toLocaleString('tr-TR', { month: 'long' })}
              </span>
            </div>
            <div className="cp-card-content">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={gunlukSatisVerisi.slice(-7)} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis 
                    dataKey="gun" 
                    tick={{ fontSize: 9, fill: '#64748b' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                    tickLine={false}
                  />
                  <YAxis 
                    tickFormatter={formatKisa}
                    tick={{ fontSize: 9, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="ciro" fill="#0d6e9c" radius={[4, 4, 0, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          
         
          
          {/* MAĞAZA HEDEFLERİ (Özet) */}
          <div className="cp-card">
            <div className="cp-card-header">
              <h3>
                <span className="cp-card-icon">🎯</span>
                Hedefler
              </h3>
              <span className="cp-card-badge">{buAy}</span>
            </div>
            <div className="cp-card-content">
              <div className="cp-hedef-ozet">
                {magazaHedefListesi.slice(0, 3).map(hedef => (
                  <div key={hedef.kod} className="cp-hedef-ozet-item">
                    <div className="cp-hedef-ozet-left">
                      <span className="cp-hedef-ozet-renk" style={{ background: hedef.renk }} />
                      <span className="cp-hedef-ozet-ad">{hedef.ad.replace(' Şubesi', '')}</span>
                    </div>
                    <div className="cp-hedef-ozet-right">
                      <span className="cp-hedef-ozet-oran">%{hedef.yuzde.toFixed(0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 6. SATICI PERFORMANS LİSTESİ */}
        <div className="cp-card cp-satici-liste-karti">
          <div className="cp-card-header">
            <h3>
              <span className="cp-card-icon">👥</span>
              Satıcı Performans Sıralaması
            </h3>
            <span className="cp-card-badge">{zamanLabel}</span>
          </div>
          <div className="cp-card-content">
            {saticiPerformans.length === 0 ? (
              <div className="cp-empty-state">Satıcı bulunamadı</div>
            ) : (
              <div className="cp-satici-listesi">
                {saticiPerformans.map((s, index) => (
                  <SaticiRow key={s.uid} satici={s} rank={index} />
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </Layout>
  );
};

export default CiroPerformansPage;