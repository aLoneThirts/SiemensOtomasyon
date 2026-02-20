import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu } from '../types/satis';
import { getSubeByKod, SUBELER, SubeKodu } from '../types/sube';
import { UserRole, User } from '../types/user';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import Layout from '../components/Layout';
import './CiroPerformans.css';

const HEDEF = 1_000_000;
const RENKLER = ['#009999', '#00cccc', '#007575', '#33dddd', '#005555', '#66eeee'];

const CiroPerformansPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [satislar, setSatislar] = useState<SatisTeklifFormu[]>([]);
  const [saticilar, setSaticilar] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [zaman, setZaman] = useState<'gunluk' | 'haftalik' | 'aylik'>('aylik');

  const isAdmin = currentUser?.role === UserRole.ADMIN;

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    fetchData();
  }, [currentUser]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const tumSatislar: SatisTeklifFormu[] = [];
      const subelerToFetch = isAdmin
        ? SUBELER
        : SUBELER.filter(s => s.kod === currentUser!.subeKodu);

      for (const sube of subelerToFetch) {
        const snapshot = await getDocs(collection(db, `subeler/${sube.dbPath}/satislar`));
        snapshot.forEach(d => {
          tumSatislar.push({ id: d.id, ...d.data(), subeKodu: sube.kod } as SatisTeklifFormu);
        });
      }
      setSatislar(tumSatislar);

      const usersSnapshot = await getDocs(collection(db, 'users'));
      const saticiListesi: User[] = [];
      usersSnapshot.forEach(d => {
        const data = d.data() as User;
        if (data.role !== UserRole.ADMIN) {
          saticiListesi.push({ ...data, uid: d.id });
        }
      });
      setSaticilar(saticiListesi);
    } catch (error) {
      console.error('Veri çekilemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const toDate = (d: any): Date => d?.toDate ? d.toDate() : new Date(d);

  const filtreliSatislar = satislar.filter(s => {
    const tarih = toDate(s.tarih);
    const simdi = new Date();
    if (zaman === 'gunluk') return tarih.toDateString() === simdi.toDateString();
    if (zaman === 'haftalik') {
      const haftaOnce = new Date(simdi);
      haftaOnce.setDate(simdi.getDate() - 7);
      return tarih >= haftaOnce;
    }
    return tarih.getMonth() === simdi.getMonth() && tarih.getFullYear() === simdi.getFullYear();
  });

  const pastaVerisi = SUBELER.map(sube => {
    const subeSatislar = filtreliSatislar.filter(s => s.subeKodu === sube.kod);
    const toplam = subeSatislar.reduce((sum, s) => sum + (s.toplamTutar || 0), 0);
    return { name: sube.ad, value: toplam };
  }).filter(s => s.value > 0);

  const simdi = new Date();
  const buAyinGunleri = new Date(simdi.getFullYear(), simdi.getMonth() + 1, 0).getDate();

  const barVerisi = Array.from({ length: buAyinGunleri }, (_, i) => {
    const gun = i + 1;
    const gunSatislari = satislar.filter(s => {
      const t = toDate(s.tarih);
      return t.getDate() === gun && t.getMonth() === simdi.getMonth() && t.getFullYear() === simdi.getFullYear();
    });
    return {
      gun: `${gun}`,
      ciro: gunSatislari.reduce((sum, s) => sum + (s.toplamTutar || 0), 0),
      kar: gunSatislari.reduce((sum, s) => sum + (s.zarar ?? 0), 0),
    };
  });

  const saticiPerformansi = saticilar.map(satici => {
    const ad = `${satici.ad} ${satici.soyad}`;
    const saticiSatislari = satislar.filter(s => s.olusturanKullanici === ad);
    const toplamCiro = saticiSatislari.reduce((sum, s) => sum + (s.toplamTutar || 0), 0);
    const toplamKar = saticiSatislari.reduce((sum, s) => sum + (s.zarar ?? 0), 0);
    const yuzde = Math.min((toplamCiro / HEDEF) * 100, 100);
    const satisSayisi = saticiSatislari.length;
    const yildiz = Math.min(Math.round((toplamCiro / HEDEF) * 10), 10);
    const sube = getSubeByKod(satici.subeKodu);
    return { ad, toplamCiro, toplamKar, yuzde, satisSayisi, yildiz, subeAd: sube?.ad || '' };
  }).sort((a, b) => b.toplamCiro - a.toplamCiro);

  const toplamCiro = filtreliSatislar.reduce((sum, s) => sum + (s.toplamTutar || 0), 0);
  const toplamKar = filtreliSatislar.reduce((sum, s) => sum + (s.zarar ?? 0), 0);
  const satisSayisi = filtreliSatislar.length;
  const ortalamaKar = satisSayisi > 0 ? toplamKar / satisSayisi : 0;

  const formatPrice = (n: number) =>
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);

  const formatPriceShort = (n: number) => {
    if (n >= 1_000_000) return `₺${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `₺${(n / 1_000).toFixed(0)}K`;
    return `₺${n}`;
  };

  const zamanToggle = (
    <div className="cp-zaman-toggle">
      {(['gunluk', 'haftalik', 'aylik'] as const).map(z => (
        <button
          key={z}
          className={`cp-toggle-btn ${zaman === z ? 'active' : ''}`}
          onClick={() => setZaman(z)}
        >
          {z === 'gunluk' ? 'Günlük' : z === 'haftalik' ? 'Haftalık' : 'Aylık'}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <Layout pageTitle="Ciro & Performans">
        <div className="cp-loading">
          <div className="cp-loading-spinner"></div>
          <span>Veriler yükleniyor...</span>
        </div>
      </Layout>
    );
  }

  return (
    <Layout pageTitle="Ciro & Performans" headerExtra={zamanToggle}>

      {/* ÖZET KARTLAR */}
      <div className="cp-ozet-grid">
        <div className="cp-ozet-kart">
          <div className="cp-ozet-ikon">💰</div>
          <div className="cp-ozet-bilgi">
            <span className="cp-ozet-label">Toplam Ciro</span>
            <span className="cp-ozet-deger">{formatPrice(toplamCiro)}</span>
          </div>
        </div>
        <div className={`cp-ozet-kart ${toplamKar >= 0 ? 'kar' : 'zarar'}`}>
          <div className="cp-ozet-ikon">{toplamKar >= 0 ? '📈' : '📉'}</div>
          <div className="cp-ozet-bilgi">
            <span className="cp-ozet-label">Toplam Kâr/Zarar</span>
            <span className="cp-ozet-deger">{formatPrice(toplamKar)}</span>
          </div>
        </div>
        <div className="cp-ozet-kart">
          <div className="cp-ozet-ikon">🧾</div>
          <div className="cp-ozet-bilgi">
            <span className="cp-ozet-label">Satış Sayısı</span>
            <span className="cp-ozet-deger">{satisSayisi}</span>
          </div>
        </div>
        <div className={`cp-ozet-kart ${ortalamaKar >= 0 ? 'kar' : 'zarar'}`}>
          <div className="cp-ozet-ikon">⚡</div>
          <div className="cp-ozet-bilgi">
            <span className="cp-ozet-label">Ortalama Kâr</span>
            <span className="cp-ozet-deger">{formatPrice(ortalamaKar)}</span>
          </div>
        </div>
      </div>

      {/* GRAFİKLER */}
      <div className="cp-grafik-grid">
        <div className="cp-kart cp-pasta">
          <div className="cp-kart-baslik">
            <h2>Şube Ciro Dağılımı</h2>
            <span className="cp-alt-baslik">{zaman === 'gunluk' ? 'Bugün' : zaman === 'haftalik' ? 'Bu Hafta' : 'Bu Ay'}</span>
          </div>
          {pastaVerisi.length === 0 ? (
            <div className="cp-bos">Bu dönemde satış bulunmuyor</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pastaVerisi} cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={3} dataKey="value">
                  {pastaVerisi.map((_, index) => (
                    <Cell key={index} fill={RENKLER[index % RENKLER.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: any) => formatPrice(val)} />
                <Legend formatter={(val) => <span style={{ fontSize: 12 }}>{val}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="cp-kart cp-bar">
          <div className="cp-kart-baslik">
            <h2>Bu Ay Günlük Satışlar</h2>
            <span className="cp-alt-baslik">{simdi.toLocaleString('tr-TR', { month: 'long', year: 'numeric' })}</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barVerisi} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" vertical={false} />
              <XAxis dataKey="gun" tick={{ fontSize: 10, fill: '#80868b' }} tickLine={false} axisLine={false} interval={2} />
              <YAxis tick={{ fontSize: 10, fill: '#80868b' }} tickLine={false} axisLine={false} tickFormatter={formatPriceShort} />
              <Tooltip
                formatter={(val: any, name: string | undefined) => [formatPrice(val), name === 'ciro' ? 'Ciro' : 'Kâr/Zarar']}
                labelFormatter={(l) => `${l}. Gün`}
                contentStyle={{ borderRadius: 8, border: '1px solid #e8eaed', fontSize: 12 }}
              />
              <Bar dataKey="ciro" fill="#009999" radius={[3, 3, 0, 0]} maxBarSize={20} />
              <Bar dataKey="kar" fill="#33dddd" radius={[3, 3, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SATICI PERFORMANS */}
      <div className="cp-kart cp-saticilar">
        <div className="cp-kart-baslik">
          <h2>Satıcı Performansı</h2>
          <span className="cp-alt-baslik">Hedef: {formatPrice(HEDEF)}</span>
        </div>
        {saticiPerformansi.length === 0 ? (
          <div className="cp-bos">Satıcı bulunamadı</div>
        ) : (
          <div className="cp-satici-listesi">
            {saticiPerformansi.map((satici, index) => (
              <div key={index} className="cp-satici-satir">
                <div className="cp-satici-sol">
                  <div className="cp-satici-avatar">
                    {satici.ad.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="cp-satici-bilgi">
                    <span className="cp-satici-ad">{satici.ad}</span>
                    <span className="cp-satici-sube">{satici.subeAd}</span>
                  </div>
                </div>
                <div className="cp-satici-orta">
                  <div className="cp-progress-wrapper">
                    <div className="cp-progress-labels">
                      <span>₺0</span>
                      <span className="cp-progress-current">{formatPriceShort(satici.toplamCiro)}</span>
                      <span>Hedef {formatPriceShort(HEDEF)}</span>
                    </div>
                    <div className="cp-progress-track">
                      <div className="cp-progress-fill" style={{ width: `${satici.yuzde}%` }}>
                        {satici.yuzde > 8 && <span className="cp-progress-yuzde">%{satici.yuzde.toFixed(0)}</span>}
                      </div>
                    </div>
                    <div className="cp-satici-stats">
                      <span>{satici.satisSayisi} satış</span>
                      <span className={satici.toplamKar >= 0 ? 'kar' : 'zarar'}>
                        {satici.toplamKar >= 0 ? '+' : ''}{formatPriceShort(satici.toplamKar)} kâr
                      </span>
                    </div>
                  </div>
                </div>
                <div className="cp-satici-sag">
                  <div className="cp-yildizlar">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <span key={i} className={`cp-yildiz ${i < satici.yildiz ? 'dolu' : 'bos'}`}>★</span>
                    ))}
                  </div>
                  <span className="cp-yildiz-skor">{satici.yildiz}/10</span>
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