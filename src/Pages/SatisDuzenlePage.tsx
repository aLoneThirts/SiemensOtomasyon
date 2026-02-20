import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, addDoc, collection } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, Kampanya, Urun, KartOdeme, YesilEtiket, BANKALAR, TAKSIT_SECENEKLERI } from '../types/satis';
import { getSubeByKod } from '../types/sube';
import Layout from '../components/Layout';
import './SatisDuzenle.css';

const SatisDuzenlePage: React.FC = () => {
  const { subeKodu, id } = useParams<{ subeKodu: string; id: string }>();
  const navigate = useNavigate();
  const [satis, setSatis] = useState<SatisTeklifFormu | null>(null);
  const [loading, setLoading] = useState(true);

  const [urunler, setUrunler] = useState<Urun[]>([]);
  const [kampanyalar, setKampanyalar] = useState<Kampanya[]>([]);
  const [yesilEtiketler, setYesilEtiketler] = useState<YesilEtiket[]>([]);
  const [pesinatTutar, setPesinatTutar] = useState<number>(0);
  const [havaleTutar, setHavaleTutar] = useState<number>(0);
  const [kartOdemeler, setKartOdemeler] = useState<KartOdeme[]>([]);
  const [marsNo, setMarsNo] = useState('');
  const [faturaNo, setFaturaNo] = useState('');
  const [teslimatTarihi, setTeslimatTarihi] = useState('');
  const [servisNotu, setServisNotu] = useState('');

  useEffect(() => {
    fetchSatisDetay();
  }, [id]);

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
        setKampanyalar(data.kampanyalar || []);
        setYesilEtiketler(data.yesilEtiketler || []);
        setPesinatTutar(data.pesinatTutar || 0);
        setHavaleTutar(data.havaleTutar || 0);
        setKartOdemeler(data.kartOdemeler || []);
        setMarsNo(data.marsNo || '');
        setFaturaNo(data.faturaNo || '');
        setTeslimatTarihi(data.teslimatTarihi ?
          (typeof data.teslimatTarihi === 'object' && 'toDate' in data.teslimatTarihi
            ? (data.teslimatTarihi as any).toDate()
            : new Date(data.teslimatTarihi)
          ).toISOString().split('T')[0] : '');
        setServisNotu(data.servisNotu || '');
      }
    } catch (error) {
      console.error('Satış detayı yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const hesaplaToplamlar = () => {
    const urunToplamAlis = urunler.reduce((sum, u) => sum + (u.alisFiyati * u.adet), 0);
    const urunToplamBip = urunler.reduce((sum, u) => sum + ((u.bip || 0) * u.adet), 0);
    const kampanyaToplamTutar = kampanyalar.reduce((sum, k) => sum + k.tutar, 0);
    const yesilToplamTutar = yesilEtiketler.reduce((sum, y) => sum + y.tutar, 0);
    const genelToplam = urunToplamAlis + yesilToplamTutar + kampanyaToplamTutar;
    const zarar = genelToplam - urunToplamAlis - urunToplamBip;
    return { toplamTutar: genelToplam, zarar };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sube = getSubeByKod(subeKodu as any);
      if (!sube || !satis) return;

      if (marsNo !== satis.marsNo || faturaNo !== satis.faturaNo || servisNotu !== satis.servisNotu) {
        const gecmisRef = collection(db, `subeler/${sube.dbPath}/satislar/${id}/gecmis`);
        await addDoc(gecmisRef, {
          marsNo: satis.marsNo || '', faturaNo: satis.faturaNo || '',
          teslimatTarihi: satis.teslimatTarihi || null, servisNotu: satis.servisNotu || '',
          guncellemeTarihi: new Date(), degisiklikTuru: 'Notlar Güncellendi'
        });
      }

      const { toplamTutar, zarar } = hesaplaToplamlar();
      const satisRef = doc(db, `subeler/${sube.dbPath}/satislar`, id!);
      await updateDoc(satisRef, {
        urunler, kampanyalar, yesilEtiketler,
        pesinatTutar, havaleTutar, kartOdemeler,
        marsNo, faturaNo, servisNotu, toplamTutar, zarar,
        teslimatTarihi: teslimatTarihi ? new Date(teslimatTarihi) : null,
        guncellemeTarihi: new Date()
      });

      alert('✅ Satış başarıyla güncellendi!');
      navigate('/dashboard');
    } catch (error) {
      console.error('Güncelleme hatası:', error);
      alert('❌ Bir hata oluştu!');
    }
  };

  const handleUrunChange = (index: number, field: keyof Urun, value: any) => {
    const yeniUrunler = [...urunler];
    yeniUrunler[index] = {
      ...yeniUrunler[index],
      [field]: field === 'adet' || field === 'alisFiyati' || field === 'bip'
        ? parseFloat(value) || 0 : value
    };
    setUrunler(yeniUrunler);
  };

  const kampanyaEkle = () => setKampanyalar(prev => [...prev, { id: Date.now().toString(), ad: '', tutar: 0 }]);
  const kampanyaSil = (index: number) => setKampanyalar(prev => prev.filter((_, i) => i !== index));
  const handleKampanyaChange = (index: number, field: 'ad' | 'tutar', value: any) => {
    const yeniKampanyalar = [...kampanyalar];
    yeniKampanyalar[index] = { ...yeniKampanyalar[index], [field]: field === 'tutar' ? parseFloat(value) || 0 : value };
    setKampanyalar(yeniKampanyalar);
  };

  const yesilEtiketEkle = () => setYesilEtiketler(prev => [...prev, { id: Date.now().toString(), urunKodu: '', ad: '', alisFiyati: 0, tutar: 0 }]);
  const yesilEtiketSil = (index: number) => setYesilEtiketler(prev => prev.filter((_, i) => i !== index));
  const handleYesilEtiketChange = (index: number, field: keyof YesilEtiket, value: any) => {
    const yeniEtiketler = [...yesilEtiketler];
    yeniEtiketler[index] = { ...yeniEtiketler[index], [field]: field === 'tutar' ? parseFloat(value) || 0 : value };
    setYesilEtiketler(yeniEtiketler);
  };

  const kartEkle = () => setKartOdemeler(prev => [...prev, { id: Date.now().toString(), banka: BANKALAR[0], taksitSayisi: 1, tutar: 0, pesinat: 0 }]);
  const kartSil = (index: number) => setKartOdemeler(prev => prev.filter((_, i) => i !== index));
  const handleKartChange = (index: number, field: keyof KartOdeme, value: any) => {
    const yeniKartlar = [...kartOdemeler];
    yeniKartlar[index] = {
      ...yeniKartlar[index],
      [field]: field === 'tutar' || field === 'pesinat' || field === 'taksitSayisi' ? parseFloat(value) || 0 : value
    };
    setKartOdemeler(yeniKartlar);
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);

  if (loading) {
    return (
      <Layout pageTitle="Satış Düzenle">
        <div className="loading">Yükleniyor...</div>
      </Layout>
    );
  }

  if (!satis) {
    return (
      <Layout pageTitle="Satış Düzenle">
        <div className="not-found">
          <h2>Satış Bulunamadı</h2>
          <button onClick={() => navigate('/dashboard')} className="btn-back">Dashboard'a Dön</button>
        </div>
      </Layout>
    );
  }

  const { toplamTutar, zarar } = hesaplaToplamlar();

  return (
    <Layout pageTitle={`Düzenle: ${satis.satisKodu}`}>
      <form onSubmit={handleSubmit} className="duzenle-form">

        {/* ÜRÜNLER */}
        <div className="form-section">
          <h2>Ürünler</h2>
          {urunler.map((urun, index) => (
            <div key={urun.id} className="urun-satir">
              <div className="urun-grid">
                <div className="form-group">
                  <label>Ürün Kodu</label>
                  <input type="text" value={urun.kod} onChange={e => handleUrunChange(index, 'kod', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Ürün Adı</label>
                  <input type="text" value={urun.ad} onChange={e => handleUrunChange(index, 'ad', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Adet</label>
                  <input type="number" value={urun.adet} onChange={e => handleUrunChange(index, 'adet', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Alış</label>
                  <input type="number" value={urun.alisFiyati} onChange={e => handleUrunChange(index, 'alisFiyati', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>BİP</label>
                  <input type="number" value={urun.bip || 0} onChange={e => handleUrunChange(index, 'bip', e.target.value)} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* KAMPANYALAR */}
        <div className="form-section">
          <div className="section-header">
            <h2>Kampanyalar</h2>
            <button type="button" onClick={kampanyaEkle} className="btn-add">+ Kampanya Ekle</button>
          </div>
          {kampanyalar.map((kampanya, index) => (
            <div key={kampanya.id} className="kampanya-satir">
              <div className="form-group">
                <label>Kampanya Adı</label>
                <input type="text" value={kampanya.ad} onChange={e => handleKampanyaChange(index, 'ad', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Tutar</label>
                <input type="number" value={kampanya.tutar} onChange={e => handleKampanyaChange(index, 'tutar', e.target.value)} />
              </div>
              <button type="button" onClick={() => kampanyaSil(index)} className="btn-remove">Sil</button>
            </div>
          ))}
        </div>

        {/* YEŞİL ETİKETLER */}
        <div className="form-section">
          <div className="section-header">
            <h2>Yeşil Etiketler</h2>
            <button type="button" onClick={yesilEtiketEkle} className="btn-add">+ Yeşil Etiket Ekle</button>
          </div>
          {yesilEtiketler.map((etiket, index) => (
            <div key={etiket.id} className="kampanya-satir">
              <div className="form-group">
                <label>Ürün Kodu</label>
                <input type="text" value={etiket.urunKodu} onChange={e => handleYesilEtiketChange(index, 'urunKodu', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Tutar</label>
                <input type="number" value={etiket.tutar} onChange={e => handleYesilEtiketChange(index, 'tutar', e.target.value)} />
              </div>
              <button type="button" onClick={() => yesilEtiketSil(index)} className="btn-remove">Sil</button>
            </div>
          ))}
        </div>

        {/* ÖDEME */}
        <div className="form-section">
          <h2>Ödeme Bilgileri</h2>
          <div className="form-grid">
            <div className="form-group">
              <label>Peşinat</label>
              <input type="number" value={pesinatTutar} onChange={e => setPesinatTutar(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label>Havale</label>
              <input type="number" value={havaleTutar} onChange={e => setHavaleTutar(parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div className="section-header" style={{ marginTop: 16 }}>
            <h3>Kart Ödemeleri</h3>
            <button type="button" onClick={kartEkle} className="btn-add">+ Kart Ekle</button>
          </div>
          {kartOdemeler.map((kart, index) => (
            <div key={kart.id} className="kart-satir">
              <div className="form-group">
                <label>Banka</label>
                <select value={kart.banka} onChange={e => handleKartChange(index, 'banka', e.target.value)}>
                  {BANKALAR.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Taksit</label>
                <select value={kart.taksitSayisi} onChange={e => handleKartChange(index, 'taksitSayisi', e.target.value)}>
                  {TAKSIT_SECENEKLERI.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Tutar</label>
                <input type="number" value={kart.tutar} onChange={e => handleKartChange(index, 'tutar', e.target.value)} />
              </div>
              <button type="button" onClick={() => kartSil(index)} className="btn-remove">Sil</button>
            </div>
          ))}
        </div>

        {/* NOTLAR */}
        <div className="form-section">
          <h2>Notlar</h2>
          <div className="form-grid">
            <div className="form-group">
              <label>MARS No</label>
              <input type="text" value={marsNo} onChange={e => setMarsNo(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Fatura No</label>
              <input type="text" value={faturaNo} onChange={e => setFaturaNo(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Teslimat Tarihi</label>
              <input type="date" value={teslimatTarihi} onChange={e => setTeslimatTarihi(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Servis Notu</label>
              <input type="text" value={servisNotu} onChange={e => setServisNotu(e.target.value)} />
            </div>
          </div>
        </div>

        {/* TOPLAM ÖNİZLEME */}
        <div className="form-section">
          <div className="toplam-preview">
            <h3>Genel Toplam: {formatPrice(toplamTutar)}</h3>
          </div>
          <div className={`zarar-preview ${zarar >= 0 ? 'kar' : 'zarar'}`}>
            <strong>Kar/Zarar:</strong> {formatPrice(zarar)}
          </div>
        </div>

        <div className="form-actions">
          <button type="button" onClick={() => navigate('/dashboard')} className="btn-cancel">İptal</button>
          <button type="submit" className="btn-submit">Güncelle</button>
        </div>
      </form>
    </Layout>
  );
};

export default SatisDuzenlePage;