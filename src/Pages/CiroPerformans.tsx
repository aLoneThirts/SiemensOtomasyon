import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs, doc, setDoc, Timestamp } from 'firebase/firestore';
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

// ─── SABİTLER ────────────────────────────────────────────────
const FALLBACK_HEDEF = 1_000_000;
const RENKLER = ['#009999', '#00cccc', '#007575', '#33dddd', '#005555', '#66eeee'];
const ZAMAN_OPTIONS = [
  { value: 'gunluk',   label: 'Günlük'  },
  { value: 'haftalik', label: 'Haftalık' },
  { value: 'aylik',    label: 'Aylık'   }
] as const;

type ZamanType = typeof ZAMAN_OPTIONS[number]['value'];

// Şube renkleri
const SUBE_RENKLER: Record<string, string> = {
  KARTAL:     '#0ea5e9',
  PENDIK:     '#8b5cf6',
  SANCAKTEPE: '#f59e0b',
  BUYAKA:     '#10b981',
  SOGANLIK:   '#ef4444',
};
const getSubeRenk = (kod: string) => SUBE_RENKLER[kod] || '#009999';

// ─── YARDIMCILAR ─────────────────────────────────────────────
const isAdmin = (role: any): boolean =>
  role && String(role).toUpperCase().trim() === 'ADMIN';

/** "YYYY-MM" formatında ay anahtarı */
const ayKey = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Firestore mağaza hedef doküman ID'si: "{SUBEKOD}-{YYYY-MM}" */
const magazaDocId = (subeKod: string, ay: string) => `${subeKod}-${ay}`;

// ─── COMPONENT ───────────────────────────────────────────────
const CiroPerformansPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // ── State
  const [satislar,    setSatislar]    = useState<SatisTeklifFormu[]>([]);
  const [saticilar,   setSaticilar]   = useState<User[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [zaman,       setZaman]       = useState<ZamanType>('aylik');
  const [seciliSube,  setSeciliSube]  = useState<SubeKodu | 'tumu'>('tumu');

  // Mağaza hedefleri: { "KARTAL-2025-02": 500000, ... }
  const [magazaHedefler,    setMagazaHedefler]    = useState<Record<string, number>>({});
  const [hedefDuzenle,      setHedefDuzenle]      = useState<string | null>(null);
  const [hedefGirdi,        setHedefGirdi]        = useState('');
  const [hedefKaydediliyor, setHedefKaydediliyor] = useState(false);

  // ── Türetilmiş sabitler
  const userIsAdmin = useMemo(() => isAdmin(currentUser?.role), [currentUser]);
  const simdi       = useMemo(() => new Date(), []);
  const buAy        = useMemo(() => ayKey(simdi), [simdi]);

  const aktifSube = useMemo((): SubeKodu | null => {
    if (!userIsAdmin) return (currentUser?.subeKodu as SubeKodu) ?? null;
    return seciliSube === 'tumu' ? null : seciliSube;
  }, [userIsAdmin, seciliSube, currentUser]);

  // ── Veri çekme
  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }

    const fetchData = async () => {
      setLoading(true);
      try {
        // 1) Satışlar (tüm şubeler)
        const satisPromises = SUBELER.map(sube =>
          getDocs(collection(db, `subeler/${sube.dbPath}/satislar`))
            .then(snap => snap.docs.map(d => ({
              id: d.id,
              ...d.data(),
              subeKodu: sube.kod
            } as SatisTeklifFormu)))
            .catch(() => [] as SatisTeklifFormu[])
        );

        // 2) Kullanıcılar + Mağaza hedefleri paralel
        const [satisResults, usersSnap, magazaHedefSnap] = await Promise.all([
          Promise.all(satisPromises),
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'magazaHedefler')),
        ]);

        setSatislar(satisResults.flat());

        // Satıcılar (admin olmayanlar) — hedefler map'i de yükle
        const users = usersSnap.docs.map(d => {
          const data = d.data();
          return {
            uid: d.id,
            ...data,
            // hedefler map'ini ve hedef alanını güvenli bir şekilde ata
            hedefler: data.hedefler || {},
            hedef: data.hedef || 0
          } as User;
        });
        
        setSaticilar(users.filter(u => !isAdmin(u.role)));

        // Mağaza hedefleri: { "KARTAL-2025-02": 500000 }
        const mh: Record<string, number> = {};
        magazaHedefSnap.forEach(d => {
          // Yeni format: doc id = "SUBEKOD-YYYY-MM", field: hedef
          // Eski format fallback: doc id = "SUBEKOD", field: hedef
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

  // ── Tarih dönüştürücü
  const toDate = useCallback((d: any): Date => {
    try {
      if (!d) return new Date(0);
      if (typeof d.toDate === 'function') return d.toDate();
      if (d?.seconds) return new Date(d.seconds * 1000);
      return new Date(d);
    } catch { return new Date(0); }
  }, []);

  // ── Zaman filtreli satışlar
  const zamanFiltreliSatislar = useMemo(() => {
    const now = new Date();
    return satislar.filter(s => {
      if (!s.tarih) return false;
      const t = toDate(s.tarih);
      if (isNaN(t.getTime())) return false;
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
        default: return true;
      }
    });
  }, [satislar, zaman, toDate]);

  const filtreliSatislar = useMemo(() =>
    aktifSube
      ? zamanFiltreliSatislar.filter(s => s.subeKodu === aktifSube)
      : zamanFiltreliSatislar,
  [zamanFiltreliSatislar, aktifSube]);

  const filtreliSaticilar = useMemo(() =>
    aktifSube
      ? saticilar.filter(u => u.subeKodu === aktifSube)
      : saticilar,
  [saticilar, aktifSube]);

  // ── KPI
  const kpi = useMemo(() => {
    const ciro = filtreliSatislar.reduce((s, x) => s + (x.toplamTutar || 0), 0);
    const kar  = filtreliSatislar.reduce((s, x) => s + (x.zarar ?? 0), 0);
    const adet = filtreliSatislar.length;
    return { ciro, kar, adet, ortalamaKar: adet > 0 ? kar / adet : 0 };
  }, [filtreliSatislar]);

  // ── Pasta verisi
  const pastaVerisi = useMemo(() => {
    if (!aktifSube) {
      return SUBELER
        .map(s => ({
          name: s.ad,
          value: zamanFiltreliSatislar
            .filter(x => x.subeKodu === s.kod)
            .reduce((a, x) => a + (x.toplamTutar || 0), 0)
        }))
        .filter(s => s.value > 0);
    }
    return filtreliSaticilar
      .map(s => {
        const ad = `${s.ad} ${s.soyad}`;
        return {
          name: ad,
          value: filtreliSatislar
            .filter(x =>
              x.musteriTemsilcisiId === s.uid ||
              x.musteriTemsilcisiAd  === ad    ||
              x.olusturanKullanici   === ad
            )
            .reduce((a, x) => a + (x.toplamTutar || 0), 0)
        };
      })
      .filter(s => s.value > 0);
  }, [aktifSube, zamanFiltreliSatislar, filtreliSatislar, filtreliSaticilar]);

  // ── Bar grafik
  const barVerisi = useMemo(() => {
    const gunSayisi = new Date(simdi.getFullYear(), simdi.getMonth() + 1, 0).getDate();
    return Array.from({ length: gunSayisi }, (_, i) => {
      const gun = i + 1;
      const gunSatislari = satislar.filter(s => {
        if (!s.tarih) return false;
        try {
          const t = toDate(s.tarih);
          if (isNaN(t.getTime())) return false;
          if (aktifSube && s.subeKodu !== aktifSube) return false;
          return t.getDate() === gun &&
                 t.getMonth() === simdi.getMonth() &&
                 t.getFullYear() === simdi.getFullYear();
        } catch { return false; }
      });
      return {
        gun: `${gun}`,
        ciro: gunSatislari.reduce((a, s) => a + (s.toplamTutar || 0), 0),
        kar:  gunSatislari.reduce((a, s) => a + (s.zarar ?? 0), 0),
      };
    });
  }, [satislar, aktifSube, simdi, toDate]);

  // ── Satıcı performansı
  // Her satıcının bu ayki hedefini `u.hedefler["YYYY-MM"]` map'inden okuyoruz.
  // Yoksa fallback olarak `u.hedef` (eski format) ya da FALLBACK_HEDEF kullanıyoruz.
  const performans = useMemo(() =>
    filtreliSaticilar
      .map(s => {
        const ad = `${s.ad} ${s.soyad}`;
        const satislarFiltre = filtreliSatislar.filter(x =>
          x.musteriTemsilcisiId === s.uid ||
          x.musteriTemsilcisiAd  === ad   ||
          x.olusturanKullanici   === ad
        );
        const ciro = satislarFiltre.reduce((a, x) => a + (x.toplamTutar || 0), 0);
        const kar  = satislarFiltre.reduce((a, x) => a + (x.zarar ?? 0), 0);

        // Aylık hedef: yeni format (map) → eski format (scalar) → fallback
        const hedef: number = (() => {
          // s.hedefler varsa ve bu aya ait bir hedef varsa onu kullan
          if (s.hedefler && typeof s.hedefler === 'object' && s.hedefler[buAy] > 0) {
            return s.hedefler[buAy];
          }
          // yoksa eski format hedef alanını kontrol et
          if (s.hedef && s.hedef > 0) {
            return s.hedef;
          }
          // hiçbiri yoksa fallback kullan
          return FALLBACK_HEDEF;
        })();

        const yuzde = Math.min((ciro / hedef) * 100, 100);
        const yildiz = Math.min(Math.round((ciro / hedef) * 10), 10);

        return {
          ad,
          uid: s.uid,
          subeAd: getSubeByKod(s.subeKodu as SubeKodu)?.ad || '',
          ciro,
          kar,
          hedef,
          satisSayisi: satislarFiltre.length,
          yuzde,
          yildiz,
        };
      })
      .sort((a, b) => b.ciro - a.ciro),
  [filtreliSaticilar, filtreliSatislar, buAy]);

  // ── Mağaza performansı
  // Bu ayki hedef key'i: "KARTAL-2025-02"
  const magazaPerformans = useMemo(() =>
    SUBELER
      .filter(sube => aktifSube ? sube.kod === aktifSube : true)
      .map(sube => {
        const subeSatislar = zamanFiltreliSatislar.filter(s => s.subeKodu === sube.kod);
        const ciro  = subeSatislar.reduce((a, s) => a + (s.toplamTutar || 0), 0);
        const docId = magazaDocId(sube.kod, buAy);
        // Yeni format önce, yoksa eski format (sadece subeKod key'li)
        const hedef = magazaHedefler[docId] || magazaHedefler[sube.kod] || 0;
        const yuzde = hedef > 0 ? Math.min((ciro / hedef) * 100, 100) : 0;
        return { kod: sube.kod, ad: sube.ad, ciro, hedef, yuzde, renk: getSubeRenk(sube.kod) };
      }),
  [zamanFiltreliSatislar, magazaHedefler, aktifSube, buAy]);

  // ── Mağaza hedef kaydet (yeni aylık format)
  const hedefKaydet = async (subeKod: string) => {
    const yeniHedef = parseFloat(hedefGirdi) || 0;
    setHedefKaydediliyor(true);
    try {
      const docId = magazaDocId(subeKod, buAy);
      await setDoc(doc(db, 'magazaHedefler', docId), {
        hedef: yeniHedef,
        subeKod,
        ay: buAy,
        guncellemeTarihi: Timestamp.now(),
      });
      setMagazaHedefler(prev => ({ ...prev, [docId]: yeniHedef }));
      setHedefDuzenle(null);
      setHedefGirdi('');
    } catch (err) {
      console.error('Hedef kaydetme hatası:', err);
    } finally {
      setHedefKaydediliyor(false);
    }
  };

  // ── Formatlayıcılar
  const formatTL = useCallback((n: number) =>
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n),
  []);

  const formatKisa = useCallback((n: number) => {
    if (n >= 1_000_000) return `₺${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `₺${(n / 1_000).toFixed(0)}K`;
    return `₺${n}`;
  }, []);

  // ── Loading
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

  // ── Render
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
              onClick={() => setSeciliSube(s.kod as SubeKodu)}
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

        {/* Sol: Pasta + Mağaza Hedefleri */}
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
                <Pie data={pastaVerisi} cx="50%" cy="50%" innerRadius={68} outerRadius={108} paddingAngle={3} dataKey="value">
                  {pastaVerisi.map((_, i) => <Cell key={i} fill={RENKLER[i % RENKLER.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => formatTL(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}

          {/* ── MAĞAZA HEDEFLERİ ── */}
          <div className="cp-magaza-hedef-bolum">
            <div className="cp-magaza-hedef-baslik">
              <span className="cp-magaza-hedef-baslik-text">🏪 Mağaza Hedefleri</span>
              <span className="cp-magaza-hedef-donem">{buAy}</span>
            </div>

            <div className="cp-magaza-hedef-liste">
              {magazaPerformans.map(m => (
                <div key={m.kod} className="cp-magaza-hedef-satir">

                  <div className="cp-magaza-hedef-sol">
                    <div className="cp-magaza-renk-bant" style={{ background: m.renk }} />
                    <div className="cp-magaza-hedef-ad">{m.ad}</div>
                  </div>

                  <div className="cp-magaza-hedef-orta">
                    <div className="cp-magaza-progress-labels">
                      <span className="cp-magaza-ciro">{formatKisa(m.ciro)}</span>

                      {hedefDuzenle === m.kod ? (
                        <div className="cp-magaza-hedef-input-wrap">
                          <span className="cp-currency">₺</span>
                          <input
                            type="number"
                            className="cp-magaza-hedef-input"
                            value={hedefGirdi}
                            onChange={e => setHedefGirdi(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter')  hedefKaydet(m.kod);
                              if (e.key === 'Escape') { setHedefDuzenle(null); setHedefGirdi(''); }
                            }}
                            autoFocus
                            placeholder="Hedef"
                          />
                          <button className="cp-magaza-hedef-kaydet" onClick={() => hedefKaydet(m.kod)} disabled={hedefKaydediliyor}>✓</button>
                          <button className="cp-magaza-hedef-iptal"  onClick={() => { setHedefDuzenle(null); setHedefGirdi(''); }}>✕</button>
                        </div>
                      ) : (
                        <button
                          className="cp-magaza-hedef-goster"
                          onClick={() => {
                            if (!userIsAdmin) return;
                            setHedefDuzenle(m.kod);
                            setHedefGirdi(m.hedef > 0 ? String(m.hedef) : '');
                          }}
                          style={{ cursor: userIsAdmin ? 'pointer' : 'default' }}
                          title={userIsAdmin ? 'Hedefi düzenle' : ''}
                        >
                          {m.hedef > 0 ? formatKisa(m.hedef) : (userIsAdmin ? '+ Hedef Gir' : '—')}
                          {userIsAdmin && m.hedef > 0 && <span className="cp-edit-icon">✏️</span>}
                        </button>
                      )}
                    </div>

                    <div className="cp-magaza-track">
                      <div
                        className="cp-magaza-fill"
                        style={{
                          width: `${m.yuzde}%`,
                          background: m.hedef === 0
                            ? '#e8f0f0'
                            : `linear-gradient(90deg, ${m.renk}bb, ${m.renk})`,
                        }}
                      >
                        {m.yuzde > 10 && <span className="cp-magaza-yuzde">%{m.yuzde.toFixed(0)}</span>}
                      </div>
                    </div>
                  </div>

                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sağ: Bar Grafik */}
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
              <Tooltip formatter={(v: any) => formatTL(v)} labelFormatter={l => `${l}. Gün`} />
              <Bar dataKey="ciro" fill="#009999" radius={[3,3,0,0]} maxBarSize={20} />
              <Bar dataKey="kar"  fill="#33dddd" radius={[3,3,0,0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Satıcı Performansı */}
      <div className="cp-kart">
        <div className="cp-kart-baslik">
          <h2>🏆 Satıcı Performansı</h2>
          <span className="cp-ay-badge">📅 {buAy}</span>
        </div>

        {performans.length === 0 ? (
          <div className="cp-bos">👥 Satıcı bulunamadı</div>
        ) : (
          <div className="cp-satici-listesi">
            {performans.map((s, i) => (
              <div key={i} className="cp-satici-satir">

                <div className="cp-satici-sol">
                  <div className="cp-satici-avatar">
                    {s.ad.split(' ').map(n => n[0]).join('').slice(0, 2)}
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
                    <span>{formatKisa(s.hedef)}</span>
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
                    <span className="cp-satici-hedef-badge">🎯 Hedef: {formatKisa(s.hedef)}</span>
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