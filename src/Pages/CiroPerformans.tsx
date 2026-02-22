import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu } from '../types/satis';
import { getSubeByKod, SUBELER, SubeKodu } from '../types/sube';
import { User } from '../types/user';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import Layout from '../components/Layout';
import './CiroPerformans.css';

// Constants
const HEDEF = 1_000_000;
const RENKLER = ['#009999', '#00cccc', '#007575', '#33dddd', '#005555', '#66eeee'];
const ZAMAN_OPTIONS = [
  { value: 'gunluk', label: 'Günlük' },
  { value: 'haftalik', label: 'Haftalık' },
  { value: 'aylik', label: 'Aylık' }
] as const;

// Types
type ZamanType = typeof ZAMAN_OPTIONS[number]['value'];

// Admin kontrolü - tek satırda halleder
const isAdmin = (role: any): boolean => 
  role && String(role).toUpperCase().trim() === 'ADMIN';

const CiroPerformansPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // State
  const [satislar, setSatislar] = useState<SatisTeklifFormu[]>([]);
  const [saticilar, setSaticilar] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [zaman, setZaman] = useState<ZamanType>('aylik');
  const [seciliSube, setSeciliSube] = useState<SubeKodu | 'tumu'>('tumu');

  // Hesaplanan değerler
  const userIsAdmin = useMemo(() => isAdmin(currentUser?.role), [currentUser]);
  const simdi = useMemo(() => new Date(), []);

  // Aktif şube - admin için seçime göre, normal için kendi şubesi
  const aktifSube = useMemo((): SubeKodu | null => {
    if (!userIsAdmin) return (currentUser?.subeKodu as SubeKodu) ?? null;
    return seciliSube === 'tumu' ? null : seciliSube;
  }, [userIsAdmin, seciliSube, currentUser]);

  // Veri çekme
  useEffect(() => {
    if (!currentUser) {
      navigate('/login');
      return;
    }
    
  const fetchData = async () => {
  setLoading(true);
  try {
    const satisPromises = SUBELER.map(sube => 
      getDocs(collection(db, `subeler/${sube.dbPath}/satislar`))
        .then(snap => snap.docs.map(d => {
          const data = d.data();
          
          // HANGİ SATIŞTA SORUN VAR GÖRMEK İÇİN:
          if (!data.tarih) {
            console.warn('⚠️ tarih yok:', d.id, data);
          }
          
          return {
            id: d.id,
            ...data,
            subeKodu: sube.kod
          } as SatisTeklifFormu;
        }))
        .catch(err => {
          console.warn(`${sube.ad} şubesi hata:`, err);
          return [];
        })
    );

        const [satisResults, usersSnap] = await Promise.all([
          Promise.all(satisPromises),
          getDocs(collection(db, 'users'))
        ]);

        // Satışları birleştir
        setSatislar(satisResults.flat());

        // Satıcıları filtrele (adminler hariç)
        setSaticilar(
          usersSnap.docs
            .map(d => ({ ...d.data(), uid: d.id } as User))
            .filter(u => !isAdmin(u.role))
        );

        console.log(`📊 ${satisResults.flat().length} satış, ${usersSnap.docs.length} kullanıcı yüklendi`);
      } catch (error) {
        console.error('Veri çekme hatası:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentUser, navigate]);

  // Tarih dönüştürücü
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

  // Zaman filtresi
const zamanFiltreliSatislar = useMemo(() => {
  const now = new Date();
  return satislar.filter(s => {
    if (!s.tarih) return false; // ← BU SATIRI EKLE
    const t = toDate(s.tarih);
    if (isNaN(t.getTime())) return false; // ← BU SATIRI DA EKLE
    switch (zaman) {
      case 'gunluk':
        return t.toDateString() === now.toDateString();
      case 'haftalik': {
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        return t >= weekAgo;
      }
      case 'aylik':
        return t.getMonth() === now.getMonth() &&
               t.getFullYear() === now.getFullYear();
      default:
        return true;
    }
  });
}, [satislar, zaman, toDate]);

  // Şube filtresi
  const filtreliSatislar = useMemo(() => 
    aktifSube 
      ? zamanFiltreliSatislar.filter(s => s.subeKodu === aktifSube)
      : zamanFiltreliSatislar,
  [zamanFiltreliSatislar, aktifSube]);

  // Satıcı filtresi
  const filtreliSaticilar = useMemo(() => 
    aktifSube
      ? saticilar.filter(u => u.subeKodu === aktifSube)
      : saticilar,
  [saticilar, aktifSube]);

  // KPI hesaplamaları
  const kpi = useMemo(() => {
    const ciro = filtreliSatislar.reduce((s, x) => s + (x.toplamTutar || 0), 0);
    const kar = filtreliSatislar.reduce((s, x) => s + (x.zarar ?? 0), 0);
    const adet = filtreliSatislar.length;
    
    return {
      ciro,
      kar,
      adet,
      ortalamaKar: adet > 0 ? kar / adet : 0
    };
  }, [filtreliSatislar]);

  // Pasta verisi
  const pastaVerisi = useMemo(() => {
    if (!aktifSube) {
      // Şube bazlı
      return SUBELER
        .map(s => ({
          name: s.ad,
          value: zamanFiltreliSatislar
            .filter(x => x.subeKodu === s.kod)
            .reduce((a, x) => a + (x.toplamTutar || 0), 0)
        }))
        .filter(s => s.value > 0);
    } else {
      // Satıcı bazlı
      return filtreliSaticilar
        .map(s => {
          const ad = `${s.ad} ${s.soyad}`;
          return {
            name: ad,
            value: filtreliSatislar
              .filter(x => 
              x.musteriTemsilcisiId === s.uid || 
              x.musteriTemsilcisiAd === ad ||
              x.olusturanKullanici === ad
            )
              .reduce((a, x) => a + (x.toplamTutar || 0), 0)
          };
        })
        .filter(s => s.value > 0);
    }
  }, [aktifSube, zamanFiltreliSatislar, filtreliSatislar, filtreliSaticilar]);

  // Bar grafik verisi
const barVerisi = useMemo(() => {
  const gunSayisi = new Date(simdi.getFullYear(), simdi.getMonth() + 1, 0).getDate();
  
  return Array.from({ length: gunSayisi }, (_, i) => {
    const gun = i + 1;
    const gunSatislari = satislar.filter(s => {
      if (!s.tarih) return false; // ← KORUMA
      try {
        const t = toDate(s.tarih);
        if (isNaN(t.getTime())) return false; // ← KORUMA
        if (aktifSube && s.subeKodu !== aktifSube) return false;
        return t.getDate() === gun &&
               t.getMonth() === simdi.getMonth() &&
               t.getFullYear() === simdi.getFullYear();
      } catch {
        return false; // ← KORUMA
      }
    });

    return {
      gun: `${gun}`,
      ciro: gunSatislari.reduce((a, s) => a + (s.toplamTutar || 0), 0),
      kar: gunSatislari.reduce((a, s) => a + (s.zarar ?? 0), 0)
    };
  });
}, [satislar, aktifSube, simdi, toDate]);

  // Satıcı performansı
  const performans = useMemo(() => 
    filtreliSaticilar
      .map(s => {
        const ad = `${s.ad} ${s.soyad}`;
        const satislar = filtreliSatislar.filter(x => 
        x.musteriTemsilcisiId === s.uid || 
        x.musteriTemsilcisiAd === ad ||
        x.olusturanKullanici === ad  // geriye uyumluluk için eski satışlar
      );
        const ciro = satislar.reduce((a, x) => a + (x.toplamTutar || 0), 0);
        const kar = satislar.reduce((a, x) => a + (x.zarar ?? 0), 0);
        const yuzde = Math.min((ciro / HEDEF) * 100, 100);
        
        return {
          ad,
          subeAd: getSubeByKod(s.subeKodu as SubeKodu)?.ad || '',
          ciro,
          kar,
          satisSayisi: satislar.length,
          yuzde,
          yildiz: Math.min(Math.round((ciro / HEDEF) * 10), 10)
        };
      })
      .sort((a, b) => b.ciro - a.ciro),
  [filtreliSaticilar, filtreliSatislar]);

  // Formatlayıcılar
  const formatTL = useCallback((n: number) => 
    new Intl.NumberFormat('tr-TR', { 
      style: 'currency', 
      currency: 'TRY', 
      maximumFractionDigits: 0 
    }).format(n), []);

  const formatKisa = useCallback((n: number) => {
    if (n >= 1_000_000) return `₺${(n/1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `₺${(n/1_000).toFixed(0)}K`;
    return `₺${n}`;
  }, []);

  // Loading
  if (loading) {
    return (
      <Layout pageTitle="Ciro & Performans">
        <div className="cp-loading">
          <div className="cp-loading-spinner" />
          <span>Veriler yükleniyor...</span>
        </div>
      </Layout>
    );
  }

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
      {/* Admin Şube Filtresi */}
      {userIsAdmin && (
        <div className="cp-sube-filtre">
          <button
            className={`cp-pill ${seciliSube === 'tumu' ? 'aktif' : ''}`}
            onClick={() => setSeciliSube('tumu')}
          >
            🌍 Tümü (Genel)
          </button>
          {SUBELER.map(s => (
            <button
              key={s.kod}
              className={`cp-pill ${seciliSube === s.kod ? 'aktif' : ''}`}
              onClick={() => setSeciliSube(s.kod)}
            >
              {s.ad}
            </button>
          ))}
        </div>
      )}

      {/* KPI Kartları */}
      <div className="cp-ozet-grid">
        <div className="cp-ozet-kart">
          <div className="cp-ozet-ikon">💰</div>
          <div>
            <div className="cp-ozet-label">Toplam Ciro</div>
            <div className="cp-ozet-deger">{formatTL(kpi.ciro)}</div>
          </div>
        </div>
        <div className={`cp-ozet-kart ${kpi.kar >= 0 ? 'kar' : 'zarar'}`}>
          <div className="cp-ozet-ikon">{kpi.kar >= 0 ? '📈' : '📉'}</div>
          <div>
            <div className="cp-ozet-label">Toplam Kâr/Zarar</div>
            <div className="cp-ozet-deger">{formatTL(kpi.kar)}</div>
          </div>
        </div>
        <div className="cp-ozet-kart">
          <div className="cp-ozet-ikon">🧾</div>
          <div>
            <div className="cp-ozet-label">Satış Sayısı</div>
            <div className="cp-ozet-deger">{kpi.adet}</div>
          </div>
        </div>
        <div className={`cp-ozet-kart ${kpi.ortalamaKar >= 0 ? 'kar' : 'zarar'}`}>
          <div className="cp-ozet-ikon">⚡</div>
          <div>
            <div className="cp-ozet-label">Ortalama Kâr</div>
            <div className="cp-ozet-deger">{formatTL(kpi.ortalamaKar)}</div>
          </div>
        </div>
      </div>

      {/* Grafikler */}
      <div className="cp-grafik-grid">
        {/* Pasta Grafik */}
        <div className="cp-kart">
          <div className="cp-kart-baslik">
            <h2>{!aktifSube ? 'Şube Ciro Dağılımı' : 'Satıcı Dağılımı'}</h2>
            <span>{zaman === 'gunluk' ? 'Bugün' : zaman === 'haftalik' ? 'Bu Hafta' : 'Bu Ay'}</span>
          </div>
          {pastaVerisi.length === 0 ? (
            <div className="cp-bos">📊 Veri yok</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pastaVerisi}
                  cx="50%" cy="50%"
                  innerRadius={68} outerRadius={108}
                  paddingAngle={3} dataKey="value"
                >
                  {pastaVerisi.map((_, i) => (
                    <Cell key={i} fill={RENKLER[i % RENKLER.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => formatTL(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Bar Grafik */}
        <div className="cp-kart">
          <div className="cp-kart-baslik">
            <h2>Günlük Satışlar</h2>
            <span>
              {simdi.toLocaleString('tr-TR', { month: 'long' })}
              {aktifSube && ` · ${getSubeByKod(aktifSube)?.ad}`}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barVerisi}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="gun" tick={{ fontSize: 10 }} interval={2} />
              <YAxis tickFormatter={formatKisa} tick={{ fontSize: 10 }} />
              <Tooltip 
                formatter={(v: any) => formatTL(v)}
                labelFormatter={l => `${l}. Gün`}
              />
              <Bar dataKey="ciro" fill="#009999" radius={[3,3,0,0]} maxBarSize={20} />
              <Bar dataKey="kar" fill="#33dddd" radius={[3,3,0,0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Satıcı Performansı */}
      <div className="cp-kart">
        <div className="cp-kart-baslik">
          <h2>🏆 Satıcı Performansı</h2>
          <span>Hedef: {formatTL(HEDEF)}</span>
        </div>
        
        {performans.length === 0 ? (
          <div className="cp-bos">👥 Satıcı bulunamadı</div>
        ) : (
          <div className="cp-satici-listesi">
            {performans.map((s, i) => (
              <div key={i} className="cp-satici-satir">
                <div className="cp-satici-sol">
                  <div className="cp-satici-avatar">
                    {s.ad.split(' ').map(n => n[0]).join('').slice(0,2)}
                  </div>
                  <div>
                    <div className="cp-satici-ad">{s.ad}</div>
                    <div className="cp-satici-sube">{s.subeAd}</div>
                  </div>
                </div>
                
                <div className="cp-satici-orta">
                  <div className="cp-progress-labels">
                    <span>₺0</span>
                    <span className="cp-progress-current">{formatKisa(s.ciro)}</span>
                    <span>{formatKisa(HEDEF)}</span>
                  </div>
                  <div className="cp-progress-track">
                    <div className="cp-progress-fill" style={{ width: `${s.yuzde}%` }}>
                      {s.yuzde > 8 && <span className="cp-progress-yuzde">%{s.yuzde.toFixed(0)}</span>}
                    </div>
                  </div>
                  <div className="cp-satici-stats">
                    <span>📦 {s.satisSayisi} satış</span>
                    <span className={s.kar >= 0 ? 'kar' : 'zarar'}>
                      {s.kar >= 0 ? '📈' : '📉'} {formatKisa(Math.abs(s.kar))} {s.kar >= 0 ? 'kâr' : 'zarar'}
                    </span>
                  </div>
                </div>

                <div className="cp-satici-sag">
                  <div className="cp-yildizlar">
                    {[...Array(10)].map((_, j) => (
                      <span key={j} className={`cp-yildiz ${j < s.yildiz ? 'dolu' : 'bos'}`}>★</span>
                    ))}
                  </div>
                  <span className="cp-yildiz-skor">{s.yildiz}/10</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default CiroPerformansPage;