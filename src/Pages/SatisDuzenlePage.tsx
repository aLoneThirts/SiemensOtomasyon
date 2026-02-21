import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, addDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, Kampanya, Urun, KartOdeme, YesilEtiket, BANKALAR, TAKSIT_SECENEKLERI } from '../types/satis';
import { getSubeByKod } from '../types/sube';
import Layout from '../components/Layout';
import './SatisDuzenle.css';

interface KampanyaAdmin {
  id?: string;
  ad: string;
  aciklama: string;
  aktif: boolean;
  subeKodu: string;
  tutar?: number;
}
interface YesilEtiketAdmin {
  id?: string;
  urunKodu: string;
  urunTuru?: string;
  maliyet: number;
  aciklama?: string;
}

interface MarsGirisi {
  marsNo: string;
  teslimatTarihi: string;
  etiket: string;
}

const MAX_MARS = 4;

const HAVALE_BANKALARI = [
  'Ziraat Bankası','Halkbank','Vakıfbank','İş Bankası','Garanti BBVA',
  'Yapı Kredi','Akbank','QNB Finansbank','Denizbank','TEB',
  'ING Bank','HSBC','Şekerbank','Fibabanka','Alternatifbank',
];

const SatisDuzenlePage: React.FC = () => {
  const { subeKodu, id } = useParams<{ subeKodu: string; id: string }>();
  const navigate = useNavigate();
  const [satis, setSatis] = useState<SatisTeklifFormu | null>(null);
  const [loading, setLoading] = useState(true);

  const [urunler, setUrunler] = useState<Urun[]>([]);
  // Çoklu ödeme
  const [pesinatlar, setPesinatlar] = useState<{ id: string; tutar: number; aciklama: string }[]>([]);
  const [havaleler, setHavaleler] = useState<{ id: string; tutar: number; banka: string }[]>([]);
  const [kartOdemeler, setKartOdemeler] = useState<KartOdeme[]>([]);
  const [kesintiCache, setKesintiCache] = useState<Record<string, Record<string, number>>>({});
  const [manuelSatisTutari, setManuelSatisTutari] = useState<number | null>(null);

  const [faturaNo, setFaturaNo] = useState('');
  const [servisNotu, setServisNotu] = useState('');
  const [marsListesi, setMarsListesi] = useState<MarsGirisi[]>([]);

  const [urunCache, setUrunCache] = useState<Record<string, { ad: string; alis: number; bip: number }>>({});
  const [kampanyaAdminListesi, setKampanyaAdminListesi] = useState<KampanyaAdmin[]>([]);
  const [seciliKampanyaIds, setSeciliKampanyaIds] = useState<string[]>([]);
  const [yesilEtiketAdminList, setYesilEtiketAdminList] = useState<YesilEtiketAdmin[]>([]);

  const etiketAd = (index: number) => {
    const labels = ['Orijinal', '2. Sipariş', '3. Sipariş', '4. Sipariş'];
    return labels[index] || `${index + 1}. Sipariş`;
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);

  /* ── Firebase yükleme ── */
  const kesintiCacheYukle = async () => {
    try {
      const snap = await getDocs(collection(db, 'bankaKesintiler'));
      const cache: Record<string, Record<string, number>> = {};
      snap.docs.forEach(d => {
        cache[d.id] = {
          tek: d.data().tek || 0, t2: d.data().t2 || 0, t3: d.data().t3 || 0,
          t4: d.data().t4 || 0, t5: d.data().t5 || 0, t6: d.data().t6 || 0,
          t7: d.data().t7 || 0, t8: d.data().t8 || 0, t9: d.data().t9 || 0,
        };
      });
      setKesintiCache(cache);
    } catch (err) { console.error('Kesinti cache:', err); }
  };

  const getKesintiOrani = (banka: string, taksit: number): number => {
    const key = taksit === 1 ? 'tek' : `t${taksit}`;
    return kesintiCache[banka]?.[key] || 0;
  };
  const urunCacheYukle = async () => {
    try {
      // Global collection - şubeye bağlı değil
      const snap = await getDocs(collection(db, 'urunler'));
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
    } catch (err) { console.error('Ürün cache:', err); }
  };

  const kampanyalariCek = async () => {
    try {
      const snap = await getDocs(collection(db, 'kampanyalar'));
      const liste = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as KampanyaAdmin))
        .filter(k => k.aktif && (k.subeKodu === 'GENEL' || k.subeKodu === subeKodu));
      setKampanyaAdminListesi(liste);
    } catch (err) { console.error('Kampanyalar:', err); }
  };

  const yesilEtiketleriCek = async () => {
    try {
      // Global collection - şubeye bağlı değil
      const snap = await getDocs(collection(db, 'yesilEtiketler'));
      const liste = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          urunKodu: data.urunKodu || '',
          urunTuru: data.urunTuru || '',
          maliyet: parseFloat(data.maliyet || 0),
        } as YesilEtiketAdmin;
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
        // Çoklu ödeme yükle (yeni format)
        const loadedPesinatlar: any[] = (data as any).pesinatlar || [];
        const loadedHavaleler: any[] = (data as any).havaleler || [];
        setPesinatlar(loadedPesinatlar.length > 0 ? loadedPesinatlar : (data.pesinatTutar ? [{ id: '1', tutar: data.pesinatTutar, aciklama: '' }] : []));
        setHavaleler(loadedHavaleler.length > 0 ? loadedHavaleler : (data.havaleTutar ? [{ id: '1', tutar: data.havaleTutar, banka: (data as any).havaleBanka || HAVALE_BANKALARI[0] }] : []));
        setKartOdemeler(data.kartOdemeler || []);
        setFaturaNo(data.faturaNo || '');
        setServisNotu(data.servisNotu || '');

        if (data.kampanyalar) {
          setSeciliKampanyaIds(data.kampanyalar.map((k: any) => k.id).filter(Boolean));
        }

        const toDateStr = (d: any) => {
          if (!d) return '';
          try {
            const date = typeof d === 'object' && 'toDate' in d ? d.toDate() : new Date(d);
            return date.toISOString().split('T')[0];
          } catch { return ''; }
        };

        if (data.marsGirisleri && Array.isArray(data.marsGirisleri) && data.marsGirisleri.length > 0) {
          setMarsListesi(data.marsGirisleri);
        } else {
          const liste: MarsGirisi[] = [{
            marsNo: data.marsNo || '',
            teslimatTarihi: toDateStr(data.teslimatTarihi),
            etiket: 'Orijinal'
          }];
          if (data.yeniMarsNo || data.yeniTeslimatTarihi) {
            liste.push({
              marsNo: data.yeniMarsNo || '',
              teslimatTarihi: toDateStr(data.yeniTeslimatTarihi),
              etiket: '2. Sipariş'
            });
          }
          setMarsListesi(liste);
        }
      }
    } catch (error) {
      console.error('Satış detayı yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSatisDetay();
    urunCacheYukle();
    kampanyalariCek();
    yesilEtiketleriCek();
    kesintiCacheYukle();
  }, [id]);

  /* ── Ürün işlemleri ── */
  const handleUrunChange = (index: number, field: keyof Urun, value: any) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = {
      ...yeniUrunler[index],
      [field]: field === 'adet' || field === 'alisFiyati' || field === 'bip'
        ? parseFloat(value) || 0 : value
    };
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
    if (field === 'alisFiyati' || field === 'adet') {
      setManuelSatisTutari(null);
    }
  };

  const urunEkle = () => setUrunler(prev => [...prev, { id: Date.now().toString(), kod: '', ad: '', adet: 1, alisFiyati: 0, bip: 0 }]);
  const urunSil = (index: number) => { if (urunler.length > 1) setUrunler(prev => prev.filter((_, i) => i !== index)); };

  /* ── Kampanya ── */
  const kampanyaToggle = (id: string) => {
    setSeciliKampanyaIds(prev => prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]);
  };
  const seciliKampanyalar = kampanyaAdminListesi.filter(k => seciliKampanyaIds.includes(k.id!));

  /* ── Yeşil etiket otomatik eşleşme ── */
  const eslesenYesilEtiketler = () => {
    const result: { urunKodu: string; urunAdi: string; maliyet: number; adet: number }[] = [];
    for (const urun of urunler) {
      const eslesen = yesilEtiketAdminList.find(
        y => y.urunKodu.trim().toLowerCase() === urun.kod.trim().toLowerCase()
      );
      if (eslesen) result.push({ urunKodu: urun.kod, urunAdi: urun.ad, maliyet: eslesen.maliyet, adet: urun.adet });
    }
    return result;
  };

  const yesilEtiketToplamIndirim = () =>
    eslesenYesilEtiketler().reduce((t, e) => t + e.maliyet * e.adet, 0);

  /* ── Kart ── */
  const kartEkle = () => setKartOdemeler(prev => [...prev, { id: Date.now().toString(), banka: BANKALAR[0], taksitSayisi: 1, tutar: 0, kesintiOrani: 0 }]);
  const kartSil = (index: number) => setKartOdemeler(prev => prev.filter((_, i) => i !== index));
  const handleKartChange = (index: number, field: keyof KartOdeme, value: any) => {
    const yeniKartlar = [...kartOdemeler];
    const yeniKart = {
      ...yeniKartlar[index],
      [field]: field === 'tutar' ? (parseFloat(value) || 0) : field === 'taksitSayisi' ? (parseInt(value) || 1) : value
    };
    if (field === 'banka' || field === 'taksitSayisi') {
      const banka = field === 'banka' ? value : yeniKartlar[index].banka;
      const taksit = field === 'taksitSayisi' ? (parseInt(value) || 1) : yeniKartlar[index].taksitSayisi;
      yeniKart.kesintiOrani = getKesintiOrani(banka, taksit);
    }
    yeniKartlar[index] = yeniKart;
    setKartOdemeler(yeniKartlar);
  };

  /* ── Peşinat (çoklu) ── */
  const pesinatEkle = () => setPesinatlar(prev => [...prev, { id: Date.now().toString(), tutar: 0, aciklama: '' }]);
  const pesinatSil = (id: string) => setPesinatlar(prev => prev.filter(p => p.id !== id));
  const handlePesinatChange = (id: string, field: 'tutar' | 'aciklama', value: any) => {
    setPesinatlar(prev => prev.map(p => p.id === id ? { ...p, [field]: field === 'tutar' ? (parseFloat(value) || 0) : value } : p));
  };

  /* ── Havale (çoklu) ── */
  const havaleEkle = () => setHavaleler(prev => [...prev, { id: Date.now().toString(), tutar: 0, banka: HAVALE_BANKALARI[0] }]);
  const havaleSil = (id: string) => setHavaleler(prev => prev.filter(h => h.id !== id));
  const handleHavaleChange = (id: string, field: 'tutar' | 'banka', value: any) => {
    setHavaleler(prev => prev.map(h => h.id === id ? { ...h, [field]: field === 'tutar' ? (parseFloat(value) || 0) : value } : h));
  };

  /* ── Mars ── */
  const marsEkle = () => {
    if (marsListesi.length >= MAX_MARS) return;
    setMarsListesi(prev => [...prev, { marsNo: '', teslimatTarihi: '', etiket: etiketAd(prev.length) }]);
  };
  const marsSil = (index: number) => { if (index === 0) return; setMarsListesi(prev => prev.filter((_, i) => i !== index)); };
  const marsGuncelle = (index: number, field: 'marsNo' | 'teslimatTarihi', value: string) => {
    setMarsListesi(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  /* ── Hesaplamalar ── */
  const alisToplamı = () => urunler.reduce((s, u) => s + u.alisFiyati * u.adet, 0);
  const bipToplamı = () => urunler.reduce((s, u) => s + (u.bip || 0) * u.adet, 0);
  const toplamTutar = () => manuelSatisTutari ?? 0;
  const kampanyaToplamiHesapla = () => seciliKampanyalar.reduce((t, k) => t + (k.tutar || 0), 0);
  const toplamMaliyet = () => Math.max(0, alisToplamı() - bipToplamı() - kampanyaToplamiHesapla());
  const pesinatToplam = () => pesinatlar.reduce((t, p) => t + (p.tutar || 0), 0);
  const havaleToplam = () => havaleler.reduce((t, h) => t + (h.tutar || 0), 0);
  const kartBrutToplam = () => kartOdemeler.reduce((t, k) => t + (k.tutar || 0), 0);
  const kartKesintiToplam = () => kartOdemeler.reduce((t, k) => t + (k.tutar * (k.kesintiOrani || 0)) / 100, 0);
  const kartNetToplam = () => kartBrutToplam() - kartKesintiToplam();
  const toplamOdenen = () => pesinatToplam() + havaleToplam() + kartBrutToplam(); // Brüt
  const hesabaGecenToplam = () => pesinatToplam() + havaleToplam() + kartNetToplam(); // NET
  const acikHesap = () => { const a = toplamTutar() - toplamOdenen(); return a > 0 ? a : 0; };
  const karZarar = () => hesabaGecenToplam() - toplamMaliyet();

  /* ── Submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sube = getSubeByKod(subeKodu as any);
      if (!sube || !satis) return;

      const orijinal = marsListesi[0];
      const sonGiris = [...marsListesi].reverse().find(m => m.marsNo || m.teslimatTarihi) || orijinal;
      const etiketler = eslesenYesilEtiketler();

      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!), {
        urunler,
        kampanyalar: seciliKampanyalar.map(k => ({ id: k.id!, ad: k.ad, tutar: k.tutar || 0 })),
        kampanyaToplami: kampanyaToplamiHesapla(),
        yesilEtiketler: etiketler.map(e => ({
          id: Date.now().toString(), urunKodu: e.urunKodu,
          ad: e.urunAdi, alisFiyati: e.maliyet, tutar: e.maliyet * e.adet
        })),
        // Çoklu ödeme
        pesinatlar, havaleler, kartOdemeler,
        // Toplamlar
        pesinatToplam: pesinatToplam(), havaleToplam: havaleToplam(),
        kartBrutToplam: kartBrutToplam(), kartKesintiToplam: kartKesintiToplam(),
        kartNetToplam: kartNetToplam(), toplamOdenen: toplamOdenen(),
        hesabaGecenToplam: hesabaGecenToplam(), acikHesap: acikHesap(),
        odemeDurumu: acikHesap() > 0 ? 'ACIK_HESAP' : 'ODENDI',
        // Legacy
        pesinatTutar: pesinatToplam(), havaleTutar: havaleToplam(),
        marsNo: orijinal.marsNo, faturaNo, servisNotu,
        toplamTutar: toplamTutar(), zarar: karZarar(),
        teslimatTarihi: orijinal.teslimatTarihi ? new Date(orijinal.teslimatTarihi) : null,
        yeniMarsNo: marsListesi.length > 1 ? sonGiris.marsNo : null,
        yeniTeslimatTarihi: marsListesi.length > 1 && sonGiris.teslimatTarihi ? new Date(sonGiris.teslimatTarihi) : null,
        marsGirisleri: marsListesi,
        guncellemeTarihi: new Date()
      });

      alert('✅ Satış başarıyla güncellendi!');
      navigate('/dashboard');
    } catch (error) {
      console.error('Güncelleme hatası:', error);
      alert('❌ Bir hata oluştu!');
    }
  };

  if (loading) return <Layout pageTitle="Satış Düzenle"><div className="duzenle-loading">Yükleniyor...</div></Layout>;
  if (!satis) return (
    <Layout pageTitle="Satış Düzenle">
      <div className="duzenle-not-found">
        <h2>Satış Bulunamadı</h2>
        <button onClick={() => navigate('/dashboard')} className="duzenle-btn-back">Dashboard'a Dön</button>
      </div>
    </Layout>
  );

  const marsEklenebilir = marsListesi.length < MAX_MARS;

  return (
    <Layout pageTitle={`Düzenle: ${satis.satisKodu}`}>
      <form onSubmit={handleSubmit} className="duzenle-form">

        {/* ===== ÜRÜNLER ===== */}
        <div className="duzenle-section">
          <div className="duzenle-section-header">
            <h2 className="duzenle-section-title">Ürünler</h2>
            <button type="button" onClick={urunEkle} className="duzenle-btn-add">+ Ürün Ekle</button>
          </div>

          <div className="duzenle-urun-header">
            <span>Ürün Kodu</span><span>Ürün Adı</span>
            <span>Adet</span><span>Alış (TL)</span><span>BİP (TL)</span><span></span>
          </div>

          {urunler.map((urun, index) => (
            <div key={urun.id} className="duzenle-urun-row">
              <div className="duzenle-urun-kod-wrap">
                <input
                  type="text"
                  value={urun.kod}
                  onChange={e => handleUrunChange(index, 'kod', e.target.value)}
                  placeholder="Ürün kodu"
                  className="duzenle-input mono"
                />
                {urunCache[urun.kod?.trim()] && (
                  <span className="urun-found-badge">✓ Eşleşti</span>
                )}
              </div>
              <input type="text" value={urun.ad} onChange={e => handleUrunChange(index, 'ad', e.target.value)} placeholder="Ürün adı" className="duzenle-input" />
              <input type="number" value={urun.adet} onChange={e => handleUrunChange(index, 'adet', e.target.value)} className="duzenle-input" min="1" />
              <input type="number" value={urun.alisFiyati || ''} onChange={e => handleUrunChange(index, 'alisFiyati', e.target.value)} placeholder="0" className="duzenle-input mono" />
              <input type="number" value={urun.bip || ''} onChange={e => handleUrunChange(index, 'bip', e.target.value)} placeholder="0" className="duzenle-input mono" />
              {urunler.length > 1 && (
                <button type="button" onClick={() => urunSil(index)} className="duzenle-btn-remove">Sil</button>
              )}
            </div>
          ))}

          {/* Satış Tutarı - direkt giriş */}
          <div className="duzenle-toplam-bar" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>Satış Tutarı *</span>
            <input
              type="number" min="0"
              value={manuelSatisTutari ?? ''}
              onChange={e => setManuelSatisTutari(e.target.value === '' ? null : parseFloat(e.target.value) || 0)}
              placeholder="Satış tutarını girin"
              style={{ fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 6, padding: '4px 10px', width: 180 }}
            />
            {manuelSatisTutari !== null && alisToplamı() > 0 && (
              <span style={{ fontSize: 12, color: '#6b7280' }}>Alış toplamı: {formatPrice(alisToplamı())}</span>
            )}
          </div>

          {/* Maliyet satırı */}
          <div className="duzenle-maliyet-notu">
            <div>Alış: {formatPrice(alisToplamı())} − BİP: {formatPrice(bipToplamı())}</div>
            {kampanyaToplamiHesapla() > 0 && (
              <div style={{ color: '#15803d' }}>Kampanya: −{formatPrice(kampanyaToplamiHesapla())}</div>
            )}
            <div style={{ fontWeight: 700 }}>TOPLAM MALİYET = {formatPrice(toplamMaliyet())}</div>
          </div>

          {/* Yeşil etiket - sadece otomatik, kullanıcı ekleyemez */}
          {eslesenYesilEtiketler().length > 0 && (
            <div className="duzenle-yesil-ozet">
              <div className="duzenle-yesil-ozet-title">🟢 Yeşil Etiket İndirimleri (Otomatik Tespit)</div>
              {eslesenYesilEtiketler().map((e, i) => (
                <div key={i} className="duzenle-yesil-ozet-row">
                  <span>{e.urunKodu} — {e.urunAdi}</span>
                  <span>−{formatPrice(e.maliyet * e.adet)} ({e.adet} × {formatPrice(e.maliyet)})</span>
                </div>
              ))}
              <div className="duzenle-yesil-ozet-toplam">Toplam İndirim: −{formatPrice(yesilEtiketToplamIndirim())}</div>
            </div>
          )}
        </div>

        {/* ===== KAMPANYALAR ===== */}
        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Kampanyalar</h2>
          {kampanyaAdminListesi.length === 0 ? (
            <div className="duzenle-empty-state">Aktif kampanya bulunamadı.</div>
          ) : (
            <div className="duzenle-kampanya-grid">
              {kampanyaAdminListesi.map(k => (
                <label
                  key={k.id}
                  className={`duzenle-kampanya-item ${seciliKampanyaIds.includes(k.id!) ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={seciliKampanyaIds.includes(k.id!)}
                    onChange={() => kampanyaToggle(k.id!)}
                  />
                  <div>
                    <div className="duzenle-kampanya-ad">{k.ad}</div>
                    {k.aciklama && <div className="duzenle-kampanya-aciklama">{k.aciklama}</div>}
                    {(k.tutar || 0) > 0 && (
                      <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600, marginTop: 2 }}>
                        İndirim: {formatPrice(k.tutar || 0)}
                      </div>
                    )}
                    <span className="duzenle-kampanya-pill">
                      {k.subeKodu === 'GENEL' ? '🌐 Genel' : `📍 ${k.subeKodu}`}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          )}
          {seciliKampanyalar.length > 0 && (
            <div className="duzenle-secili-ozet">
              ✅ Seçili: {seciliKampanyalar.map(k => k.ad).join(', ')}
              {kampanyaToplamiHesapla() > 0 && (
                <span style={{ marginLeft: 12, color: '#15803d', fontWeight: 700 }}>
                  | Toplam İndirim: −{formatPrice(kampanyaToplamiHesapla())}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ===== ÖDEME ===== */}
        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Ödeme Bilgileri</h2>

          {/* Peşinat çoklu */}
          <div className="duzenle-odeme-blok">
            <div className="duzenle-odeme-blok-header">
              <div className="duzenle-odeme-blok-title">💵 Peşinat (Kasaya Yansır)</div>
              <button type="button" onClick={pesinatEkle} className="duzenle-btn-sm">+ Peşinat Ekle</button>
            </div>
            {pesinatlar.map(p => (
              <div key={p.id} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input type="number" min="0" placeholder="Tutar" value={p.tutar || ''} onChange={e => handlePesinatChange(p.id, 'tutar', e.target.value)} className="duzenle-input mono" style={{ flex: 1 }} />
                <input type="text" placeholder="Açıklama" value={p.aciklama} onChange={e => handlePesinatChange(p.id, 'aciklama', e.target.value)} className="duzenle-input" style={{ flex: 2 }} />
                <button type="button" onClick={() => pesinatSil(p.id)} className="duzenle-btn-remove">Sil</button>
              </div>
            ))}
            {pesinatlar.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Peşinat yok</div>}
            {pesinatToplam() > 0 && <div className="duzenle-odeme-bilgi ok">✅ Toplam: {formatPrice(pesinatToplam())}</div>}
          </div>

          {/* Havale çoklu */}
          <div className="duzenle-odeme-blok" style={{ marginTop: 12 }}>
            <div className="duzenle-odeme-blok-header">
              <div className="duzenle-odeme-blok-title">🏦 Havale (Hesaba Geçer)</div>
              <button type="button" onClick={havaleEkle} className="duzenle-btn-sm">+ Havale Ekle</button>
            </div>
            {havaleler.map(h => (
              <div key={h.id} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={h.banka} onChange={e => handleHavaleChange(h.id, 'banka', e.target.value)} className="duzenle-input" style={{ flex: 2 }}>
                  {HAVALE_BANKALARI.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <input type="number" min="0" placeholder="Tutar" value={h.tutar || ''} onChange={e => handleHavaleChange(h.id, 'tutar', e.target.value)} className="duzenle-input mono" style={{ flex: 1 }} />
                <button type="button" onClick={() => havaleSil(h.id)} className="duzenle-btn-remove">Sil</button>
              </div>
            ))}
            {havaleler.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Havale yok</div>}
            {havaleToplam() > 0 && <div className="duzenle-odeme-bilgi ok">✅ Toplam: {formatPrice(havaleToplam())}</div>}
          </div>

          {/* Kart */}
          <div className="duzenle-odeme-blok" style={{ marginTop: 14 }}>
            <div className="duzenle-odeme-blok-header">
              <div className="duzenle-odeme-blok-title">💳 Kart Ödemeleri</div>
              <button type="button" onClick={kartEkle} className="duzenle-btn-sm">+ Kart Ekle</button>
            </div>
            {kartOdemeler.map((kart, index) => {
              const kesintiOrani = kart.kesintiOrani || 0;
              const kesintiTutar = (kart.tutar * kesintiOrani) / 100;
              const net = kart.tutar - kesintiTutar;
              return (
                <div key={kart.id} className="duzenle-kart-row">
                  <div className="duzenle-kart-fields">
                    <div>
                      <label className="duzenle-label">Banka</label>
                      <select value={kart.banka} onChange={e => handleKartChange(index, 'banka', e.target.value)} className="duzenle-input">
                        {BANKALAR.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="duzenle-label">Taksit</label>
                      <select value={kart.taksitSayisi} onChange={e => handleKartChange(index, 'taksitSayisi', e.target.value)} className="duzenle-input">
                        {TAKSIT_SECENEKLERI.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="duzenle-label">Brüt Tutar</label>
                      <input type="number" min="0" value={kart.tutar || ''} onChange={e => handleKartChange(index, 'tutar', e.target.value)} className="duzenle-input mono" />
                    </div>
                    <div>
                      <label className="duzenle-label">Kesinti (Otomatik)</label>
                      <input type="text" readOnly value={kesintiOrani > 0 ? `%${kesintiOrani}` : 'Bulunamadı'}
                        className="duzenle-input mono"
                        style={{ background: kesintiOrani > 0 ? '#f0fdf4' : '#fff7ed', color: kesintiOrani > 0 ? '#15803d' : '#92400e', fontWeight: 600 }} />
                    </div>
                    <button type="button" onClick={() => kartSil(index)} className="duzenle-btn-remove">Sil</button>
                  </div>
                  {kart.tutar > 0 && (
                    <div className="duzenle-kart-net">
                      Brüt: {formatPrice(kart.tutar)} | Kesinti: −{formatPrice(kesintiTutar)} | <strong>NET: {formatPrice(net)}</strong>
                    </div>
                  )}
                </div>
              );
            })}
            {kartOdemeler.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Kart yok</div>}
          </div>

          {/* Ödeme özeti */}
          <div className="duzenle-ozet-grid" style={{ marginTop: 16 }}>
            <div className="duzenle-ozet-kart">
              <div className="duzenle-ozet-label">💵 Peşinat</div>
              <div className="duzenle-ozet-deger">{formatPrice(pesinatToplam())}</div>
            </div>
            <div className="duzenle-ozet-kart">
              <div className="duzenle-ozet-label">🏦 Havale</div>
              <div className="duzenle-ozet-deger">{formatPrice(havaleToplam())}</div>
            </div>
            {kartOdemeler.length > 0 && (
              <div className="duzenle-ozet-kart">
                <div className="duzenle-ozet-label">💳 Kart Brüt</div>
                <div className="duzenle-ozet-deger">{formatPrice(kartBrutToplam())}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>NET: {formatPrice(kartNetToplam())}</div>
              </div>
            )}
            <div className="duzenle-ozet-kart">
              <div className="duzenle-ozet-label">📊 Toplam Ödenen</div>
              <div className="duzenle-ozet-deger">{formatPrice(toplamOdenen())}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Hesaba Geçen: {formatPrice(hesabaGecenToplam())}</div>
            </div>
            <div className="duzenle-ozet-kart" style={{ background: acikHesap() > 0 ? '#fff7ed' : '#f0fdf4' }}>
              <div className="duzenle-ozet-label">🔓 Açık Hesap</div>
              <div className="duzenle-ozet-deger" style={{ color: acikHesap() > 0 ? '#ea580c' : '#15803d' }}>
                {acikHesap() > 0 ? formatPrice(acikHesap()) : '✅ Ödendi'}
              </div>
            </div>
          </div>

          <div className="duzenle-kar-bar" style={{ background: karZarar() >= 0 ? '#dcfce7' : '#fee2e2', color: karZarar() >= 0 ? '#15803d' : '#dc2626' }}>
            {karZarar() >= 0 ? `📈 KÂR: ${formatPrice(karZarar())}` : `📉 ZARAR: ${formatPrice(Math.abs(karZarar()))}`}
            <span style={{ fontSize: 12, marginLeft: 12, opacity: 0.8 }}>
              (Hesaba Geçen: {formatPrice(hesabaGecenToplam())} — Maliyet: {formatPrice(toplamMaliyet())})
            </span>
          </div>
        </div>

        {/* ===== NOTLAR ===== */}
        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Notlar</h2>
          <div className="duzenle-notlar-grid">
            <div>
              <label className="duzenle-label">Fatura No</label>
              <input type="text" value={faturaNo} onChange={e => setFaturaNo(e.target.value)} className="duzenle-input" />
            </div>
            <div>
              <label className="duzenle-label">Servis Notu</label>
              <input type="text" value={servisNotu} onChange={e => setServisNotu(e.target.value)} className="duzenle-input" />
            </div>
          </div>
        </div>

        {/* ===== MARS NO / TESLİMAT TARİHİ ===== */}
        <div className="duzenle-section">
          <div className="duzenle-mars-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 className="duzenle-section-title" style={{ margin: 0 }}>Mars No / Teslimat Tarihi</h2>
              <span className="duzenle-mars-sayac">{marsListesi.length} / {MAX_MARS}</span>
            </div>
            {marsEklenebilir
              ? <button type="button" onClick={marsEkle} className="duzenle-btn-add">+ Yeni Sipariş No</button>
              : <span className="duzenle-mars-limit">🔒 Maks. 4 giriş</span>
            }
          </div>

          <div className="duzenle-mars-timeline">
            {marsListesi.map((giris, index) => (
              <div key={index} className={`duzenle-mars-card ${index === 0 ? 'orijinal' : 'yeni'}`}>
                <div className="duzenle-mars-sol">
                  <div className={`duzenle-mars-nokta ${index === 0 ? 'nokta-teal' : 'nokta-blue'}`}>
                    {index === 0 ? '🏠' : '🔄'}
                  </div>
                  {index < marsListesi.length - 1 && <div className="duzenle-mars-cizgi" />}
                </div>
                <div className="duzenle-mars-icerik">
                  <div className="duzenle-mars-baslik">
                    <span className={`duzenle-mars-etiket ${index === 0 ? 'etiket-teal' : 'etiket-blue'}`}>{giris.etiket}</span>
                    {index > 0 && (
                      <button type="button" onClick={() => marsSil(index)} className="duzenle-mars-sil">✕</button>
                    )}
                  </div>
                  <div className="duzenle-mars-inputs">
                    <div>
                      <label className="duzenle-label">Mars No</label>
                      <input type="text" value={giris.marsNo} onChange={e => marsGuncelle(index, 'marsNo', e.target.value)} placeholder={index === 0 ? 'Orijinal mars no...' : 'Yeni sipariş no...'} className={`duzenle-input ${index > 0 ? 'input-blue' : ''}`} />
                    </div>
                    <div>
                      <label className="duzenle-label">Teslimat Tarihi</label>
                      <input type="date" value={giris.teslimatTarihi} onChange={e => marsGuncelle(index, 'teslimatTarihi', e.target.value)} className={`duzenle-input ${index > 0 ? 'input-blue' : ''}`} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ===== ACTIONS ===== */}
        <div className="duzenle-actions">
          <button type="button" onClick={() => navigate('/dashboard')} className="duzenle-btn-cancel">İptal</button>
          <button type="submit" className="duzenle-btn-submit">Güncelle</button>
        </div>

      </form>
    </Layout>
  );
};

export default SatisDuzenlePage;