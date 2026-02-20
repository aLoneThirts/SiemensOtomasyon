import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, addDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, Kampanya, Urun, KartOdeme, YesilEtiket, BANKALAR, TAKSIT_SECENEKLERI } from '../types/satis';
import { getSubeByKod } from '../types/sube';
import Layout from '../components/Layout';
import './SatisDuzenle.css';

// ── Admin panelden çekilen tipler ───────────────────────────────────────────
interface KampanyaAdmin {
  id?: string;
  ad: string;
  aciklama: string;
  aktif: boolean;
  subeKodu: string;
}
interface YesilEtiketAdmin {
  id?: string;
  urunKodu: string;
  urunTuru?: string;
  maliyet: number;     // YEŞİL ETİKET kolonu = satış fiyatı
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
  const [pesinatTutar, setPesinatTutar] = useState<number>(0);
  const [havaleTutar, setHavaleTutar] = useState<number>(0);
  const [havaleBanka, setHavaleBanka] = useState(HAVALE_BANKALARI[0]);
  const [kartOdemeler, setKartOdemeler] = useState<KartOdeme[]>([]);
  const [faturaNo, setFaturaNo] = useState('');
  const [servisNotu, setServisNotu] = useState('');
  const [marsListesi, setMarsListesi] = useState<MarsGirisi[]>([]);

  // ── Firebase'den çekilen veriler ──────────────────────────────────────────
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

  // ── Firebase yükleme ──────────────────────────────────────────────────────
  const urunCacheYukle = async () => {
    try {
      const sube = getSubeByKod(subeKodu as any);
      if (!sube) return;
      const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/urunler`));
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
      const sube = getSubeByKod(subeKodu as any);
      if (!sube) return;
      const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/yesilEtiketler`));
      // maliyet = Excel'deki "YEŞİL ETİKET" kolonu
      const liste = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          urunKodu: data.urunKodu || '',
          urunTuru: data.urunTuru || '',
          maliyet: parseFloat(data.maliyet || data['YEŞİL ETİKET'] || data.yesilEtiket || 0),
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
        setPesinatTutar(data.pesinatTutar || 0);
        setHavaleTutar(data.havaleTutar || 0);
        setKartOdemeler(data.kartOdemeler || []);
        setFaturaNo(data.faturaNo || '');
        setServisNotu(data.servisNotu || '');

        // Kaydedilmiş kampanya ID'lerini seç
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
  }, [id]);

  // ── Ürün cache otofill ────────────────────────────────────────────────────
  const handleUrunChange = (index: number, field: keyof Urun, value: any) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = {
      ...yeniUrunler[index],
      [field]: field === 'adet' || field === 'alisFiyati' || field === 'bip'
        ? parseFloat(value) || 0 : value
    };
    // Kod değişince cache'den otofill
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
  };

  const urunEkle = () => setUrunler(prev => [...prev, { id: Date.now().toString(), kod: '', ad: '', adet: 1, alisFiyati: 0, bip: 0 }]);
  const urunSil = (index: number) => { if (urunler.length > 1) setUrunler(prev => prev.filter((_, i) => i !== index)); };

  // ── Kampanya toggle ───────────────────────────────────────────────────────
  const kampanyaToggle = (id: string) => {
    setSeciliKampanyaIds(prev => prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]);
  };
  const seciliKampanyalar = kampanyaAdminListesi.filter(k => seciliKampanyaIds.includes(k.id!));

  // ── Yeşil etiket otomatik eşleşme ────────────────────────────────────────
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

  // ── Kart ─────────────────────────────────────────────────────────────────
  const kartEkle = () => setKartOdemeler(prev => [...prev, { id: Date.now().toString(), banka: BANKALAR[0], taksitSayisi: 1, tutar: 0, kesintiOrani: 0 }]);
  const kartSil = (index: number) => setKartOdemeler(prev => prev.filter((_, i) => i !== index));
  const handleKartChange = (index: number, field: keyof KartOdeme, value: any) => {
    const yeniKartlar = [...kartOdemeler];
    yeniKartlar[index] = {
      ...yeniKartlar[index],
      [field]: field === 'tutar' || field === 'kesintiOrani' || field === 'taksitSayisi'
        ? parseFloat(value) || 0 : value
    };
    setKartOdemeler(yeniKartlar);
  };

  // ── Mars ──────────────────────────────────────────────────────────────────
  const marsEkle = () => {
    if (marsListesi.length >= MAX_MARS) return;
    setMarsListesi(prev => [...prev, { marsNo: '', teslimatTarihi: '', etiket: etiketAd(prev.length) }]);
  };
  const marsSil = (index: number) => { if (index === 0) return; setMarsListesi(prev => prev.filter((_, i) => i !== index)); };
  const marsGuncelle = (index: number, field: 'marsNo' | 'teslimatTarihi', value: string) => {
    setMarsListesi(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  // ── Hesaplamalar ──────────────────────────────────────────────────────────
  const alisToplamı = () => urunler.reduce((s, u) => s + u.alisFiyati * u.adet, 0);
  const bipToplamı = () => urunler.reduce((s, u) => s + (u.bip || 0) * u.adet, 0);
  const toplamMaliyet = () => alisToplamı() - bipToplamı();
  const kartNetTutar = (k: KartOdeme) => k.tutar - (k.tutar * (k.kesintiOrani || 0)) / 100;
  const hesabaGecenToplam = () => (pesinatTutar || 0) + (havaleTutar || 0) + kartOdemeler.reduce((s, k) => s + kartNetTutar(k), 0);
  const acikHesap = () => { const a = alisToplamı() - hesabaGecenToplam(); return a > 0 ? a : 0; };
  const karZarar = () => hesabaGecenToplam() - toplamMaliyet();

  // ── Submit ────────────────────────────────────────────────────────────────
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
        kampanyalar: seciliKampanyalar.map(k => ({ id: k.id!, ad: k.ad, tutar: 0 })),
        yesilEtiketler: etiketler.map(e => ({
          id: Date.now().toString(),
          urunKodu: e.urunKodu,
          ad: e.urunAdi,
          alisFiyati: e.maliyet,
          tutar: e.maliyet * e.adet
        })),
        pesinatTutar, havaleTutar, havaleBanka, kartOdemeler,
        marsNo: orijinal.marsNo,
        faturaNo, servisNotu,
        toplamTutar: alisToplamı(),
        zarar: karZarar(),
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

          <div className="duzenle-toplam-bar">
            <span>Alış Toplam</span>
            <span className="duzenle-toplam-tutar">{formatPrice(alisToplamı())}</span>
          </div>
          <div className="duzenle-maliyet-notu">
            TOPLAM MALİYET (Alış − BİP) = {formatPrice(toplamMaliyet())}
          </div>

          {/* Yeşil etiket özeti */}
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
                    <span className="duzenle-kampanya-pill">
                      {k.subeKodu === 'GENEL' ? '🌐 Genel' : `📍 ${k.subeKodu}`}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          )}
          {seciliKampanyalar.length > 0 && (
            <div className="duzenle-secili-ozet">✅ Seçili: {seciliKampanyalar.map(k => k.ad).join(', ')}</div>
          )}
        </div>

        {/* ===== ÖDEME ===== */}
        <div className="duzenle-section">
          <h2 className="duzenle-section-title">Ödeme Bilgileri</h2>

          <div className="duzenle-odeme-grid">
            <div className="duzenle-odeme-blok">
              <div className="duzenle-odeme-blok-title">💵 Peşinat (Kasaya Yansır)</div>
              <input type="number" min="0" value={pesinatTutar || ''} onChange={e => setPesinatTutar(parseFloat(e.target.value) || 0)} className="duzenle-input mono" placeholder="0" />
              {pesinatTutar > 0 && <div className="duzenle-odeme-bilgi ok">✅ {formatPrice(pesinatTutar)}</div>}
            </div>

            <div className="duzenle-odeme-blok">
              <div className="duzenle-odeme-blok-title">🏦 Havale (Hesaba Geçer)</div>
              <select value={havaleBanka} onChange={e => setHavaleBanka(e.target.value)} className="duzenle-input" style={{ marginBottom: 8 }}>
                {HAVALE_BANKALARI.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <input type="number" min="0" value={havaleTutar || ''} onChange={e => setHavaleTutar(parseFloat(e.target.value) || 0)} className="duzenle-input mono" placeholder="0" />
              {havaleTutar > 0 && <div className="duzenle-odeme-bilgi ok">✅ {formatPrice(havaleTutar)} ({havaleBanka})</div>}
            </div>
          </div>

          {/* Kart */}
          <div className="duzenle-odeme-blok" style={{ marginTop: 14 }}>
            <div className="duzenle-odeme-blok-header">
              <div className="duzenle-odeme-blok-title">💳 Kart Ödemeleri</div>
              <button type="button" onClick={kartEkle} className="duzenle-btn-sm">+ Kart Ekle</button>
            </div>
            {kartOdemeler.map((kart, index) => {
              const net = kartNetTutar(kart);
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
                      <label className="duzenle-label">Kesinti %</label>
                      <input type="number" min="0" max="100" step="0.01" value={kart.kesintiOrani || ''} onChange={e => handleKartChange(index, 'kesintiOrani', e.target.value)} className="duzenle-input mono" />
                    </div>
                    <button type="button" onClick={() => kartSil(index)} className="duzenle-btn-remove">Sil</button>
                  </div>
                  {kart.tutar > 0 && (
                    <div className="duzenle-kart-net">
                      Brüt: {formatPrice(kart.tutar)} | Kesinti: −{formatPrice(kart.tutar - net)} | <strong>NET: {formatPrice(net)}</strong>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Ödeme özeti */}
          <div className="duzenle-ozet-grid">
            <div className="duzenle-ozet-kart">
              <div className="duzenle-ozet-label">💵 Kasaya Yansıyan</div>
              <div className="duzenle-ozet-deger">{formatPrice(pesinatTutar || 0)}</div>
            </div>
            <div className="duzenle-ozet-kart">
              <div className="duzenle-ozet-label">🏦 Hesaba Geçen</div>
              <div className="duzenle-ozet-deger">{formatPrice(hesabaGecenToplam())}</div>
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