import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, Kampanya, YesilEtiket, KartOdeme } from '../types/satis';
import { getSubeByKod } from '../types/sube';
import Layout from '../components/Layout';
import './SatisDetay.css';

const SatisDetayPage: React.FC = () => {
  const { subeKodu, id } = useParams<{ subeKodu: string; id: string }>();
  const navigate = useNavigate();
  const [satis, setSatis] = useState<SatisTeklifFormu | null>(null);
  const [loading, setLoading] = useState(true);

  // Düzenleme state'leri
  const [duzenlemeAcik, setDuzenlemeAcik] = useState(false);
  const [yeniMarsNo, setYeniMarsNo] = useState('');
  const [yeniTeslimatTarihi, setYeniTeslimatTarihi] = useState('');
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    fetchSatisDetay();
  }, [id]);

  const fetchSatisDetay = async () => {
    try {
      setLoading(true);
      const sube = getSubeByKod(subeKodu as any);
      if (!sube) { console.error('Şube bulunamadı:', subeKodu); return; }
      const satisDoc = await getDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!));
      if (satisDoc.exists()) {
        const data = { id: satisDoc.id, ...satisDoc.data() } as SatisTeklifFormu;
        setSatis(data);
        setYeniMarsNo(data.yeniMarsNo || '');
        setYeniTeslimatTarihi(data.yeniTeslimatTarihi ? formatDateForInput(data.yeniTeslimatTarihi) : '');
      }
    } catch (error) {
      console.error('Satış detayı yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number | undefined | null) => {
    if (price === undefined || price === null) return '0₺';
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price) + '₺';
  };

  const formatDate = (date: any) => {
    if (!date) return '-';
    try {
      const d = date.toDate ? date.toDate() : new Date(date);
      return d.toLocaleDateString('tr-TR');
    } catch { return '-'; }
  };

  const formatDateForInput = (date: any) => {
    if (!date) return '';
    try {
      const d = date.toDate ? date.toDate() : new Date(date);
      return d.toISOString().split('T')[0];
    } catch { return ''; }
  };

  const toplamMaliyetHesapla = () => {
    if (!satis?.urunler) return 0;
    const alisToplam = satis.urunler.reduce((sum, urun) => sum + (urun.adet * urun.alisFiyati), 0);
    const bipToplam = satis.urunler.reduce((sum, urun) => sum + ((urun.bip || 0) * urun.adet), 0);
    return alisToplam - bipToplam;
  };

  const yesilEtiketToplamHesapla = () =>
    satis?.yesilEtiketler?.reduce((sum, etiket) => sum + etiket.tutar, 0) || 0;

  const kaydet = async () => {
    if (!satis) return;
    try {
      setKaydediliyor(true);
      const sube = getSubeByKod(subeKodu as any);
      if (!sube) return;

      await updateDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!), {
        yeniMarsNo: yeniMarsNo || null,
        yeniTeslimatTarihi: yeniTeslimatTarihi ? new Date(yeniTeslimatTarihi) : null,
      });

      setSatis(prev => prev ? {
        ...prev,
        yeniMarsNo: yeniMarsNo || undefined,
        yeniTeslimatTarihi: yeniTeslimatTarihi ? new Date(yeniTeslimatTarihi) : undefined,
      } : prev);

      setDuzenlemeAcik(false);
      alert('Kaydedildi!');
    } catch (error) {
      console.error('Kaydetme hatası:', error);
      alert('Kaydetme sırasında hata oluştu!');
    } finally {
      setKaydediliyor(false);
    }
  };

  const printBtn = (
    <button onClick={() => window.print()} className="btn-print no-print">
      <i className="fas fa-print"></i> Yazdır
    </button>
  );

  if (loading) {
    return (
      <Layout pageTitle="Satış Detayı">
        <div className="loading">Yükleniyor...</div>
      </Layout>
    );
  }

  if (!satis) {
    return (
      <Layout pageTitle="Satış Detayı">
        <div className="not-found">
          <h2>Satış bulunamadı</h2>
          <button onClick={() => navigate('/dashboard')} className="btn-back">Dashboard'a Dön</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout pageTitle={`Satış: ${satis.satisKodu}`} headerExtra={printBtn}>
      <div className="detay-icerik">

        {/* BAŞLIK */}
        <div className="baslik-bolumu">
          <div className="firma-adi">Siemens Otomasyon</div>
          <div className="sayfa-basligi">SATIŞ DETAYI</div>
        </div>

        {/* 1. YEŞİL ÇERÇEVE */}
        <div className="yesil-cerceve">
          <div className="ust-satir">
            <div className="sutun">
              <div className="etiket">SATIŞ KODU</div>
              <div className="deger">{satis.satisKodu}</div>
            </div>
            <div className="sutun orta-sutun">
              <div className="etiket">SATIŞ BİLGİLERİ</div>
              <div className="bilgi">MÜŞTERİ TEMSİLCİSİ: {satis.musteriTemsilcisi}</div>
              {satis.musteriTemsilcisiTel && <div className="bilgi">TEL: {satis.musteriTemsilcisiTel}</div>}
            </div>
            <div className="sutun">
              <div className="etiket">TARİH</div>
              <div className="deger">{formatDate(satis.tarih)}</div>
            </div>
          </div>

          <div className="alt-satir">
            <div className="sol-kolon">
              <div className="baslik-alt">MÜŞTERİ BİLGİLERİ</div>
              <div className="satir-item">ÖNVAN: {satis.musteriBilgileri?.isim}</div>
              <div className="satir-item">V.K NO: {satis.musteriBilgileri?.vkNo || '-'}</div>
              <div className="satir-item">V.D: {satis.musteriBilgileri?.vd || '-'}</div>
              <div className="satir-item">CEP: {satis.musteriBilgileri?.cep || '-'}</div>
              <div className="satir-item">ADRES: {satis.musteriBilgileri?.adres}</div>
            </div>
            <div className="sag-kolon">

              {/* MARS NO: ESKİ - YENİ */}
              <div className="satir-item">
                MARS NO: {satis.marsNo || '-'}
                {satis.yeniMarsNo && (
                  <span className="yeni-deger-inline"> - YENİ: {satis.yeniMarsNo}</span>
                )}
              </div>

              <div className="satir-item">MAĞAZA: {satis.magaza || '-'}</div>
              <div className="satir-item">FATURA NO: {satis.faturaNo || '-'}</div>
              <div className="satir-item">SERVİS: {satis.servisNotu || '-'}</div>
              <div className="satir-item">TESLİM EDİLDİ Mİ?: {satis.teslimEdildiMi ? 'EVET' : 'HAYIR'}</div>

              {/* TESLİMAT TARİHİ: ESKİ - YENİ */}
              <div className="satir-item">
                TESLİMAT TARİHİ: {formatDate(satis.teslimatTarihi)}
                {satis.yeniTeslimatTarihi && (
                  <span className="yeni-deger-inline"> - YENİ: {formatDate(satis.yeniTeslimatTarihi)}</span>
                )}
              </div>

            </div>
          </div>
        </div>

        {/* DÜZENLEME BUTONU */}
        <div className="no-print" style={{ marginBottom: '12px' }}>
          <button
            className="btn-duzenle"
            onClick={() => setDuzenlemeAcik(!duzenlemeAcik)}
          >
            <i className="fas fa-edit"></i>{' '}
            {duzenlemeAcik ? 'Düzenlemeyi Kapat' : 'Mars No / Teslimat Tarihi Düzenle'}
          </button>
        </div>

        {/* DÜZENLEME PANELİ */}
        {duzenlemeAcik && (
          <div className="no-print duzenle-panel">
            <h4>Yeni Bilgileri Gir</h4>
            <div className="duzenle-form">
              <div className="form-grup">
                <label>Yeni Mars No</label>
                <input
                  type="text"
                  value={yeniMarsNo}
                  onChange={e => setYeniMarsNo(e.target.value)}
                  placeholder="Yeni mars no girin..."
                />
              </div>
              <div className="form-grup">
                <label>Yeni Teslimat Tarihi</label>
                <input
                  type="date"
                  value={yeniTeslimatTarihi}
                  onChange={e => setYeniTeslimatTarihi(e.target.value)}
                />
              </div>
              <button className="btn-kaydet" onClick={kaydet} disabled={kaydediliyor}>
                {kaydediliyor ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        )}

        {/* 2. ÜRÜNLER + KAMPANYALAR */}
        <div className="ana-bolum">
          <div className="kirmizi-cerceve urun-bolumu">
            <table className="urun-tablo">
              <thead>
                <tr>
                  <th>ORİN KODU</th><th>ADET</th><th>ALIŞ</th><th>BİP</th>
                </tr>
              </thead>
              <tbody>
                {satis.urunler && satis.urunler.length > 0 ? (
                  satis.urunler.map((urun, index) => (
                    <tr key={index}>
                      <td>{urun.kod}</td>
                      <td>{urun.adet}</td>
                      <td>{formatPrice(urun.alisFiyati)}</td>
                      <td>{urun.bip ? formatPrice(urun.bip) : '-'}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={4}>Ürün bulunamadı</td></tr>
                )}
                {Array.from({ length: Math.max(0, 15 - (satis.urunler?.length || 0)) }).map((_, i) => (
                  <tr key={`bos-${i}`} className="bos-satir">
                    <td>&nbsp;</td><td></td><td></td><td></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="toplam-alan">TOPLAM MALİYET: {formatPrice(toplamMaliyetHesapla())}</div>
          </div>

          <div className="yan-panel">
            <div className="sari-kutu">
              <div className="kutu-baslik">KAMPANYALAR</div>
              {satis.kampanyalar && satis.kampanyalar.length > 0 ? (
                satis.kampanyalar.map((kampanya: Kampanya, i: number) => (
                  <div key={i} className="kutu-satir">{kampanya.ad}: {formatPrice(kampanya.tutar)}</div>
                ))
              ) : (
                <div className="kutu-satir">Kampanya bulunamadı</div>
              )}
            </div>

            <div className="yesil-kutu">
              <div className="kutu-baslik">YEŞİL ETİKETLER</div>
              {satis.yesilEtiketler && satis.yesilEtiketler.length > 0 ? (
                <>
                  <table className="etiket-tablo">
                    <thead>
                      <tr><th>ÜRÜN KODU</th><th>TUTAR</th></tr>
                    </thead>
                    <tbody>
                      {satis.yesilEtiketler.map((etiket: YesilEtiket, i: number) => (
                        <tr key={i}><td>{etiket.urunKodu}</td><td>{formatPrice(etiket.tutar)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="etiket-toplam">TOPLAM: {formatPrice(yesilEtiketToplamHesapla())}</div>
                </>
              ) : (
                <div className="kutu-satir">Yeşil etiket bulunamadı</div>
              )}
            </div>
          </div>
        </div>

        {/* 3. ÖDEME BİLGİLERİ */}
        <div className="kirmizi-cerceve odeme-bolumu">
          <div className="kutu-baslik">ÖDEME BİLGİLERİ</div>
          {satis.pesinatTutar ? <div className="odeme-satir">PEŞİN: {formatPrice(satis.pesinatTutar)}</div> : null}
          {satis.havaleTutar ? <div className="odeme-satir">HAVALE: {formatPrice(satis.havaleTutar)}</div> : null}
          {satis.kartOdemeler && satis.kartOdemeler.length > 0 && (
            satis.kartOdemeler.map((kart: KartOdeme, index: number) => (
              <div key={index} className="odeme-satir">
                KART: ({kart.banka}) / ({kart.taksitSayisi === 1 ? 'TEK' : `${kart.taksitSayisi} TAKSİT`}) / ({formatPrice(kart.tutar)})
                {kart.pesinat ? ` / (PEŞİNAT: ${formatPrice(kart.pesinat)})` : ''}
              </div>
            ))
          )}
          {satis.hesabaGecen && <div className="hesaba-alan">HESABA GEÇEN: {satis.hesabaGecen}</div>}
        </div>

        {/* 4. ONAY */}
        <div className="mavi-cerceve">
          <div className="onay-metin">ONAY: {satis.onayDurumu ? 'ONAYLANDI' : 'ONAY BEKLİYOR'}</div>
          <div className="imza-metin">İMZA: __________________</div>
        </div>

        <div className="alt-bilgi">
          <div>localhost</div>
          <div>1/1</div>
        </div>
      </div>
    </Layout>
  );
};

export default SatisDetayPage;