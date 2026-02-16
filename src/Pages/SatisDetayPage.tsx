import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SatisTeklifFormu, Kampanya, YesilEtiket, KartOdeme } from '../types/satis';
import { getSubeByKod } from '../types/sube';
import './SatisDetay.css';

const SatisDetayPage: React.FC = () => {
  const { subeKodu, id } = useParams<{ subeKodu: string; id: string }>();
  const navigate = useNavigate();
  const [satis, setSatis] = useState<SatisTeklifFormu | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSatisDetay();
  }, [id]);

  const fetchSatisDetay = async () => {
    try {
      setLoading(true);
      
      const sube = getSubeByKod(subeKodu as any);
      if (!sube) {
        console.error('Şube bulunamadı:', subeKodu);
        return;
      }

      const satisDoc = await getDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!));
      
      if (satisDoc.exists()) {
        setSatis({ id: satisDoc.id, ...satisDoc.data() } as SatisTeklifFormu);
      } else {
        console.error('Satış bulunamadı!');
      }
    } catch (error) {
      console.error('Satış detayı yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number | undefined | null) => {
    if (price === undefined || price === null) return '0₺';
    return new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price) + '₺';
  };

  const formatDate = (date: any) => {
    if (!date) return '-';
    try {
      const d = date.toDate ? date.toDate() : new Date(date);
      return d.toLocaleDateString('tr-TR');
    } catch {
      return '-';
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const toplamMaliyetHesapla = () => {
    if (!satis?.urunler) return 0;
    const alisToplam = satis.urunler.reduce((sum, urun) => sum + (urun.adet * urun.alisFiyati), 0);
    const bipToplam = satis.urunler.reduce((sum, urun) => sum + ((urun.bip || 0) * urun.adet), 0);
    return alisToplam - bipToplam;
  };

  const yesilEtiketToplamHesapla = () => {
    return satis?.yesilEtiketler?.reduce((sum, etiket) => sum + etiket.tutar, 0) || 0;
  };

  if (loading) {
    return <div className="loading">Yükleniyor...</div>;
  }

  if (!satis) {
    return (
      <div className="not-found">
        <h2>Satış bulunamadı</h2>
        <button onClick={() => navigate('/dashboard')} className="btn-back">
          Dashboard'a Dön
        </button>
      </div>
    );
  }

  return (
    <div className="detay-container">
      
      {/* HEADER */}
      <div className="detay-header no-print">
        <button onClick={() => navigate('/dashboard')} className="btn-back">
          ← Geri
        </button>
        <h1>Satış Detayı</h1>
        <button onClick={handlePrint} className="btn-print">
          🖨️ Yazdır
        </button>
      </div>

      {/* İÇERİK */}
      <div className="detay-icerik">
        
        {/* BAŞLIK */}
        <div className="baslik-bolumu">
          <div className="firma-adi">Siemens Otomasyon</div>
          <div className="sayfa-basligi">SATIŞ DETAYI</div>
        </div>

        {/* 1. YEŞİL ÇERÇEVE */}
        <div className="yesil-cerceve">
          
          {/* Üst Satır - 3 Sütun */}
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

          {/* Alt Satır - Müşteri Bilgileri (YAN YANA) */}
          <div className="alt-satir">
            {/* SOL - Müşteri Bilgileri */}
            <div className="sol-kolon">
              <div className="baslik-alt">MÜŞTERİ BİLGİLERİ</div>
              <div className="satir-item">ÖNVAN: {satis.musteriBilgileri?.isim}</div>
              <div className="satir-item">V.K NO: {satis.musteriBilgileri?.vkNo || '-'}</div>
              <div className="satir-item">V.D: {satis.musteriBilgileri?.vd || '-'}</div>
              <div className="satir-item">CEP: {satis.musteriBilgileri?.cep || '-'}</div>
              <div className="satir-item">ADRES: {satis.musteriBilgileri?.adres}</div>
            </div>
            
            {/* SAĞ - Diğer Bilgiler */}
            <div className="sag-kolon">
              <div className="satir-item">MARS NO: {satis.marsNo || '-'}</div>
              <div className="satir-item">MAĞAZA: {satis.magaza || '-'}</div>
              <div className="satir-item">FATURA NO: {satis.faturaNo || '-'}</div>
              <div className="satir-item">SERVİS: {satis.servisNotu || '-'}</div>
              <div className="satir-item">TESLİM EDİLDİ Mİ?: {satis.teslimEdildiMi ? 'EVET' : 'HAYIR'}</div>
              <div className="satir-item">TESLİMAT TARİHİ: {formatDate(satis.teslimatTarihi)}</div>
            </div>
          </div>
        </div>

        {/* 2. ANA BÖLÜM - ÜRÜNLER + KAMPANYALAR */}
        <div className="ana-bolum">
          
          {/* SOL - Kırmızı Çerçeve (Ürünler) */}
          <div className="kirmizi-cerceve urun-bolumu">
            <table className="urun-tablo">
              <thead>
                <tr>
                  <th>ORİN KODU</th>
                  <th>ADET</th>
                  <th>ALIŞ</th>
                  <th>BİP</th>
                </tr>
              </thead>
              <tbody>
                {/* Ürünler - Formdan gelenler */}
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
                  <tr>
                    <td colSpan={4}>Ürün bulunamadı</td>
                  </tr>
                )}
                
                {/* BOŞ SATIRLAR - 15-20 adet yer olsun */}
                {Array.from({ length: Math.max(0, 15 - (satis.urunler?.length || 0)) }).map((_, i) => (
                  <tr key={`bos-${i}`} className="bos-satir">
                    <td>(15-20 adet yer olsun)</td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            <div className="toplam-alan">
              TOPLAM MALİYET: {formatPrice(toplamMaliyetHesapla())}
            </div>
          </div>

          {/* SAĞ - Kampanyalar + Yeşil Etiketler */}
          <div className="yan-panel">
            
            {/* Kampanyalar - Sarı Kutu */}
            <div className="sari-kutu">
              <div className="kutu-baslik">KAMPANYALAR</div>
              {satis.kampanyalar && satis.kampanyalar.length > 0 ? (
                satis.kampanyalar.map((kampanya: Kampanya, i: number) => (
                  <div key={i} className="kutu-satir">
                    {kampanya.ad}: {formatPrice(kampanya.tutar)}
                  </div>
                ))
              ) : (
                <div className="kutu-satir">Kampanya bulunamadı</div>
              )}
            </div>

            {/* Yeşil Etiketler - Yeşil Kutu */}
            <div className="yesil-kutu">
              <div className="kutu-baslik">YEŞİL ETİKETLER</div>
              {satis.yesilEtiketler && satis.yesilEtiketler.length > 0 ? (
                <>
                  <table className="etiket-tablo">
                    <thead>
                      <tr>
                        <th>ÜRÜN KODU</th>
                        <th>TUTAR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {satis.yesilEtiketler.map((etiket: YesilEtiket, i: number) => (
                        <tr key={i}>
                          <td>{etiket.urunKodu}</td>
                          <td>{formatPrice(etiket.tutar)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="etiket-toplam">
                    TOPLAM: {formatPrice(yesilEtiketToplamHesapla())}
                  </div>
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
          
          {/* Peşinat */}
          {satis.pesinatTutar ? (
            <div className="odeme-satir">PEŞİN: {formatPrice(satis.pesinatTutar)}</div>
          ) : null}
          
          {/* Havale */}
          {satis.havaleTutar ? (
            <div className="odeme-satir">HAVALE: {formatPrice(satis.havaleTutar)}</div>
          ) : null}
          
          {/* Kart Ödemeleri */}
          {satis.kartOdemeler && satis.kartOdemeler.length > 0 ? (
            satis.kartOdemeler.map((kart: KartOdeme, index: number) => (
              <div key={index} className="odeme-satir">
                KART: ({kart.banka}) / ({kart.taksitSayisi === 1 ? 'TEK' : `${kart.taksitSayisi} TAKSİT`}) / ({formatPrice(kart.tutar)}) 
                {kart.pesinat ? ` / (PEŞİNAT: ${formatPrice(kart.pesinat)})` : ''}
              </div>
            ))
          ) : null}

          {/* Hesaba Geçen */}
          {satis.hesabaGecen && (
            <div className="hesaba-alan">
              HESABA GEÇEN: {satis.hesabaGecen}
            </div>
          )}
        </div>

        {/* 4. ONAY - Mavi Çerçeve */}
        <div className="mavi-cerceve">
          <div className="onay-metin">
            ONAY: {satis.onayDurumu ? 'ONAYLANDI' : 'ONAY BEKLİYOR'}
          </div>
          <div className="imza-metin">
            İMZA: __________________
          </div>
        </div>

        {/* FOOTER */}
        <div className="alt-bilgi">
          <div>localhost</div>
          <div>1/1</div>
        </div>

      </div>
    </div>
  );
};

export default SatisDetayPage;