import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
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

  useEffect(() => { fetchSatisDetay(); }, [id]);

  const fetchSatisDetay = async () => {
    try {
      setLoading(true);
      const sube = getSubeByKod(subeKodu as any);
      if (!sube) { console.error('Şube bulunamadı:', subeKodu); return; }
      const satisDoc = await getDoc(doc(db, `subeler/${sube.dbPath}/satislar`, id!));
      if (satisDoc.exists()) {
        const data = { id: satisDoc.id, ...satisDoc.data() } as SatisTeklifFormu;
        setSatis(data);
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

  // ========== HESAPLAMA FONKSİYONLARI ==========

  const kampanyaToplamiHesapla = () => {
    if (!satis) return 0;
    if ((satis as any).kampanyaToplami !== undefined) return (satis as any).kampanyaToplami || 0;
    if (!satis.kampanyalar) return 0;
    return satis.kampanyalar.reduce((sum: number, k: any) => sum + (k.tutar || 0), 0);
  };

  const urunAlis = (u: any): number => u.alisFiyatSnapshot ?? u.alisFiyati ?? 0;
  const urunBip  = (u: any): number => u.bipSnapshot    ?? u.bip         ?? 0;

  const alisToplamHesapla = () => {
    if (!satis?.urunler) return 0;
    return satis.urunler.reduce((sum, u) => sum + (u.adet * urunAlis(u)), 0);
  };

  const bipToplamHesapla = () => {
    if (!satis?.urunler) return 0;
    return satis.urunler.reduce((sum, u) => sum + (urunBip(u) * u.adet), 0);
  };

  const yesilEtiketToplamHesapla = () =>
    satis?.yesilEtiketler?.reduce((sum, e) => sum + (e.tutar || 0), 0) || 0;

  // ✅ FIX: Yeşil etiketli ürünlerin BİP'i maliyet hesabına dahil edilmez
  const toplamMaliyetHesapla = () => {
    if (!satis) return 0;
    const yesilEtiketler: YesilEtiket[] = satis.yesilEtiketler || [];
    if (yesilEtiketler.length === 0) {
      return Math.max(0, alisToplamHesapla() - bipToplamHesapla() - kampanyaToplamiHesapla());
    }
    const yesilKodlar = new Set(
      yesilEtiketler.map(e => (e.urunKodu || '').trim().toLowerCase())
    );
    const normalAlis = (satis.urunler || [])
      .filter(u => !yesilKodlar.has((u.kod || '').trim().toLowerCase()))
      .reduce((s: number, u: any) => s + urunAlis(u) * u.adet, 0);
    const normalBip = (satis.urunler || [])
      .filter(u => !yesilKodlar.has((u.kod || '').trim().toLowerCase()))
      .reduce((s: number, u: any) => s + urunBip(u) * u.adet, 0);
    const yesilOzel = yesilEtiketler.reduce((s, e) => s + (e.tutar || 0), 0);
    return Math.max(0, (normalAlis - normalBip) + yesilOzel - kampanyaToplamiHesapla());
  };

  const yesilEtiketKontrolMaliyeti = () => {
    if (!satis) return 0;
    const yesilEtiketler: YesilEtiket[] = satis.yesilEtiketler || [];
    if (yesilEtiketler.length === 0) return 0;
    const yesilKodlar = new Set(
      yesilEtiketler.map(e => (e.urunKodu || '').trim().toLowerCase())
    );
    const normalAlis = (satis.urunler || [])
      .filter(u => !yesilKodlar.has((u.kod || '').trim().toLowerCase()))
      .reduce((s: number, u: any) => s + urunAlis(u) * u.adet, 0);
    // ✅ FIX: Sadece normal ürünlerin BİP'i düşülür, yeşil etiketli ürünün BİP'i dahil edilmez
    const normalBip = (satis.urunler || [])
      .filter(u => !yesilKodlar.has((u.kod || '').trim().toLowerCase()))
      .reduce((s: number, u: any) => s + urunBip(u) * u.adet, 0);
    const yesilOzel = yesilEtiketler.reduce((s, e) => s + (e.tutar || 0), 0);
    return Math.max(0, yesilOzel + normalAlis - normalBip - kampanyaToplamiHesapla());
  };

  const satisTutariHesapla = () => {
    if (!satis) return 0;
    return (satis as any).toplamTutar || 0;
  };

  const pesinatToplamHesapla = () => {
    if (!satis) return 0;
    const pesinatlar: any[] = (satis as any).pesinatlar || [];
    if (pesinatlar.length > 0) return pesinatlar.reduce((s: number, p: any) => s + (p.tutar || 0), 0);
    return (satis as any).pesinatToplam || satis.pesinatTutar || 0;
  };

  const havaleToplamHesapla = () => {
    if (!satis) return 0;
    const havaleler: any[] = (satis as any).havaleler || [];
    if (havaleler.length > 0) return havaleler.reduce((s: number, h: any) => s + (h.tutar || 0), 0);
    return (satis as any).havaleToplam || satis.havaleTutar || 0;
  };

  const kartBrutToplamHesapla = () => {
    if (!satis) return 0;
    if ((satis as any).kartBrutToplam !== undefined) return (satis as any).kartBrutToplam;
    return (satis.kartOdemeler || []).reduce((s, k) => s + (k.tutar || 0), 0);
  };

  const kartKesintiToplamHesapla = () => {
    if (!satis) return 0;
    if ((satis as any).kartKesintiToplam !== undefined) return (satis as any).kartKesintiToplam;
    return (satis.kartOdemeler || []).reduce((s, k) => s + (k.tutar * (k.kesintiOrani || 0)) / 100, 0);
  };

  const kartNetToplamHesapla = () => kartBrutToplamHesapla() - kartKesintiToplamHesapla();

  const toplamOdenenHesapla = () => {
    if (!satis) return 0;
    if ((satis as any).toplamOdenen !== undefined) return (satis as any).toplamOdenen;
    return pesinatToplamHesapla() + havaleToplamHesapla() + kartBrutToplamHesapla();
  };

  const hesabaGecenToplamHesapla = () => {
    if (!satis) return 0;
    if ((satis as any).hesabaGecenToplam !== undefined) return (satis as any).hesabaGecenToplam;
    return pesinatToplamHesapla() + havaleToplamHesapla() + kartNetToplamHesapla();
  };

  const karZararHesapla = () => hesabaGecenToplamHesapla() - toplamMaliyetHesapla();

  const acikHesapHesapla = () => {
    const acik = satisTutariHesapla() - toplamOdenenHesapla();
    return acik > 0 ? acik : 0;
  };

  // ✅ #6 Ünvan + Teslim Alan Kişi birleşik gösterimi
  const unvanVeTeslimatGoster = () => {
    const unvan = (satis as any)?.musteriBilgileri?.unvan || '';
    return unvan || null;
  };

  const printBtn = (
    <button onClick={() => window.print()} className="btn-print no-print">
      <i className="fas fa-print"></i> Yazdır
    </button>
  );

  if (loading) {
    return <Layout pageTitle="Satış Detayı"><div className="loading">Yükleniyor...</div></Layout>;
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

  // ✅ Yardımcı değişkenler
  const unvanGosterim = unvanVeTeslimatGoster();
  const faturaAdresi = satis?.musteriBilgileri?.faturaAdresi || '';
  const teslimatAdresi = satis?.musteriBilgileri?.adres || '';
  const teslimEdildi = satis.teslimEdildiMi;

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
              {(satis as any).ileriTeslim && (satis as any).ileriTeslimTarihi && (
                <div className="bilgi" style={{ marginTop: 4, color: '#0369a1', fontWeight: 600 }}>
                  M.A. TESLİM TARİHİ: {formatDate((satis as any).ileriTeslimTarihi)}
                </div>
              )}
            </div>
            <div className="sutun">
              <div className="etiket">TARİH</div>
              <div className="deger">{formatDate(satis.tarih)}</div>
            </div>
          </div>

          <div className="alt-satir">
            <div className="sol-kolon">
              <div className="baslik-alt">MÜŞTERİ BİLGİLERİ</div>
              <div className="satir-item">ÜNVAN: {satis.musteriBilgileri?.isim}</div>
              {/* ✅ #4/#6 Ünvan + Teslim alan kişi */}
              {unvanGosterim && (
                <div className="satir-item" style={{ color: '#0369a1', fontWeight: 600 }}>
                  ŞİRKET ÜNVANI: {unvanGosterim}
                </div>
              )}
              <div className="satir-item">V.K NO: {satis.musteriBilgileri?.vkNo || '-'}</div>
              <div className="satir-item">V.D: {satis.musteriBilgileri?.vd || '-'}</div>
              <div className="satir-item">CEP: {satis.musteriBilgileri?.cep || '-'}</div>

              {/* ✅ #7 Adresler ayrı gösterim */}
              {faturaAdresi ? (
                <>
                  <div className="satir-item">FATURA ADRESİ: {faturaAdresi}</div>
                  {teslimatAdresi && teslimatAdresi !== faturaAdresi && (
                    <div className="satir-item">TESLİMAT ADRESİ: {teslimatAdresi}</div>
                  )}
                </>
              ) : (
                <div className="satir-item">ADRES: {satis.musteriBilgileri?.adres || '-'}</div>
              )}
            </div>
            <div className="sag-kolon">
              {(() => {
                const marsGirisleri: any[] = (satis as any).marsGirisleri;
                let tumMarslar: { marsNo: string; tarih: any }[] = [];
                if (marsGirisleri && marsGirisleri.length > 0) {
                  tumMarslar = marsGirisleri.filter((g: any) => g.marsNo).map((g: any) => ({ marsNo: g.marsNo, tarih: g.teslimatTarihi }));
                } else {
                  if (satis.marsNo) tumMarslar.push({ marsNo: satis.marsNo, tarih: satis.teslimatTarihi });
                  if ((satis as any).yeniMarsNo) tumMarslar.push({ marsNo: (satis as any).yeniMarsNo, tarih: (satis as any).yeniTeslimatTarihi });
                }
                const marsNoStr = tumMarslar.length > 0 ? tumMarslar.map(m => m.marsNo).join(' - ') : '-';
                const tarihStr = tumMarslar.length > 0 ? tumMarslar.map(m => m.tarih ? formatDate(m.tarih) : '-').join(' - ') : '-';
                return (
                  <>
                    <div className="satir-item">MARS NO: {marsNoStr}</div>
                    <div className="satir-item">TESLİMAT TARİHİ: {tarihStr}</div>
                  </>
                );
              })()}
              <div className="satir-item">MAĞAZA: {satis.magaza || '-'}</div>
              <div className="satir-item">FATURA NO: {satis.faturaNo || '-'}</div>
              <div className="satir-item">SERVİS: {satis.servisNotu || '-'}</div>

              {/* ✅ #5 Teslim Edildi renk gösterimi: Evet = sarı zemin */}
              <div className="satir-item" style={teslimEdildi ? {
                background: '#fef08a',
                color: '#854d0e',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 6,
                display: 'inline-block',
                marginTop: 2,
              } : {}}>
                TESLİM EDİLDİ Mİ?: {teslimEdildi ? '✅ EVET' : 'HAYIR'}
              </div>
            </div>
          </div>
        </div>

        {/* 2. ÜRÜNLER + KAMPANYALAR */}
        <div className="ana-bolum">
          <div className="kirmizi-cerceve urun-bolumu">
            <table className="urun-tablo">
              <thead>
                <tr>
                  <th>ÜRÜN KODU</th><th>ADET</th><th>ALIŞ</th><th>BİP</th>
                </tr>
              </thead>
              <tbody>
                {satis.urunler && satis.urunler.length > 0 ? (
                  satis.urunler.map((urun: any, index) => (
                    <tr key={index}>
                      <td>{urun.kod}</td>
                      <td>{urun.adet}</td>
                      <td>
                        {formatPrice(urunAlis(urun))}
                        {urun.alisFiyatSnapshot !== undefined && urun.alisFiyatSnapshot !== urun.alisFiyati && (
                          <span style={{ fontSize: 9, color: '#9ca3af', marginLeft: 4 }}>📷</span>
                        )}
                      </td>
                      <td>{urunBip(urun) ? formatPrice(urunBip(urun)) : '-'}</td>
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

            <div className="toplam-alan" style={{ borderTop: '2px solid #e5e7eb', marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>SATIŞ TUTARI:</span>
                <strong style={{ color: '#15803d', fontSize: 16 }}>{formatPrice(satisTutariHesapla())}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#6b7280' }}>
                <span>Alış − BİP:</span>
                <span>{formatPrice(alisToplamHesapla())} − {formatPrice(bipToplamHesapla())}</span>
              </div>
              {kampanyaToplamiHesapla() > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#15803d' }}>
                  <span>Kampanya:</span>
                  <span>−{formatPrice(kampanyaToplamiHesapla())}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontWeight: 700, borderTop: '1px solid #e5e7eb', marginTop: 4 }}>
                <span>TOPLAM MALİYET:</span>
                <span>{formatPrice(toplamMaliyetHesapla())}</span>
              </div>
            </div>

            <div style={{
              margin: '8px 0', padding: '8px 12px', borderRadius: 6, fontWeight: 700,
              background: karZararHesapla() >= 0 ? '#dcfce7' : '#fee2e2',
              color: karZararHesapla() >= 0 ? '#15803d' : '#dc2626'
            }}>
              {karZararHesapla() >= 0
                ? `📈 KÂR: ${formatPrice(karZararHesapla())}`
                : `📉 ZARAR: ${formatPrice(Math.abs(karZararHesapla()))}`
              }
              <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.8 }}>
                (Hesaba Geçen: {formatPrice(hesabaGecenToplamHesapla())} — Maliyet: {formatPrice(toplamMaliyetHesapla())})
              </span>
            </div>

            {acikHesapHesapla() > 0 && (
              <div style={{ padding: '6px 12px', background: '#fff7ed', borderRadius: 6, color: '#ea580c', fontWeight: 600 }}>
                🔓 AÇIK HESAP: {formatPrice(acikHesapHesapla())}
              </div>
            )}
          </div>

          <div className="yan-panel">
            <div className="sari-kutu">
              <div className="kutu-baslik">KAMPANYALAR</div>
              {satis.kampanyalar && satis.kampanyalar.length > 0 ? (
                satis.kampanyalar.map((kampanya: Kampanya, i: number) => (
                  <div key={i} className="kutu-satir">
                    {kampanya.ad}
                    {(kampanya.tutar || 0) > 0 && (
                      <span style={{ color: '#15803d', fontWeight: 600, marginLeft: 8 }}>
                        −{formatPrice(kampanya.tutar || 0)}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="kutu-satir">Kampanya bulunamadı</div>
              )}
              {kampanyaToplamiHesapla() > 0 && (
                <div className="kutu-satir" style={{ fontWeight: 700, color: '#15803d', borderTop: '1px solid #fef08a', marginTop: 4, paddingTop: 4 }}>
                  Toplam İndirim: −{formatPrice(kampanyaToplamiHesapla())}
                </div>
              )}
            </div>

            <div className="yesil-kutu">
              <div className="kutu-baslik">YEŞİL ETİKETLER</div>
              {satis.yesilEtiketler && satis.yesilEtiketler.length > 0 ? (
                <>
                  <table className="etiket-tablo">
                    <thead>
                      <tr><th>ÜRÜN KODU</th><th>ÖZEL FİYAT</th></tr>
                    </thead>
                    <tbody>
                      {satis.yesilEtiketler.map((etiket: YesilEtiket, i: number) => (
                        <tr key={i}><td>{etiket.urunKodu}</td><td>{formatPrice(etiket.tutar)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {(() => {
                    const yesilKodlar2 = new Set(
                      satis.yesilEtiketler!.map(e => (e.urunKodu || '').trim().toLowerCase())
                    );
                    const normalAlis2 = (satis.urunler || [])
                      .filter(u => !yesilKodlar2.has((u.kod || '').trim().toLowerCase()))
                      .reduce((s: number, u: any) => s + urunAlis(u) * u.adet, 0);
                    // ✅ FIX: Sadece normal ürünlerin BİP'i
                    const normalBip2 = (satis.urunler || [])
                      .filter(u => !yesilKodlar2.has((u.kod || '').trim().toLowerCase()))
                      .reduce((s: number, u: any) => s + urunBip(u) * u.adet, 0);
                    const yesilOzel2 = satis.yesilEtiketler!.reduce((s, e) => s + (e.tutar || 0), 0);
                    const kontrolMaliyet = Math.max(0, yesilOzel2 + normalAlis2 - normalBip2 - kampanyaToplamiHesapla());

                    return (
                      <div className="etiket-toplam">
                        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 400 }}>
                          ℹ️ Bilgi amaçlı — Kâr/zarar hesabını etkilemez
                        </div>
                        YEŞİL ETİKET MALİYETİ: {formatPrice(kontrolMaliyet)}
                        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 400, marginTop: 4, lineHeight: 1.5 }}>
                          Yeşil özel: {formatPrice(yesilOzel2)}
                          {normalAlis2 > 0 && <> + Normal alış: {formatPrice(normalAlis2)}</>}
                          {normalBip2 > 0 && <> − BİP: {formatPrice(normalBip2)}</>}
                          {kampanyaToplamiHesapla() > 0 && <> − Kampanya: {formatPrice(kampanyaToplamiHesapla())}</>}
                        </div>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="kutu-satir">Yeşil etiket yok</div>
              )}
            </div>
          </div>
        </div>

        {/* 3. ÖDEME BİLGİLERİ */}
        <div className="kirmizi-cerceve odeme-bolumu">
          <div className="kutu-baslik">ÖDEME BİLGİLERİ</div>

          {(() => {
            const pesinatlar: any[] = (satis as any).pesinatlar || [];
            if (pesinatlar.length > 0) {
              return pesinatlar.map((p: any, i: number) => (
                <div key={i} className="odeme-satir">
                  💵 PEŞİNAT: {formatPrice(p.tutar)}{p.aciklama ? ` (${p.aciklama})` : ''}
                </div>
              ));
            } else if (satis.pesinatTutar) {
              return <div className="odeme-satir">💵 PEŞİNAT: {formatPrice(satis.pesinatTutar)}</div>;
            }
            return null;
          })()}

          {(() => {
            const havaleler: any[] = (satis as any).havaleler || [];
            if (havaleler.length > 0) {
              return havaleler.map((h: any, i: number) => (
                <div key={i} className="odeme-satir">🏦 HAVALE: {formatPrice(h.tutar)} ({h.banka})</div>
              ));
            } else if (satis.havaleTutar) {
              return (
                <div className="odeme-satir">
                  🏦 HAVALE: {formatPrice(satis.havaleTutar)}
                  {(satis as any).havaleBanka ? ` (${(satis as any).havaleBanka})` : ''}
                </div>
              );
            }
            return null;
          })()}

          {satis.kartOdemeler && satis.kartOdemeler.length > 0 && (
            satis.kartOdemeler.map((kart: KartOdeme, index: number) => {
              const kesintiOrani = kart.kesintiOrani || 0;
              const net = kart.tutar - (kart.tutar * kesintiOrani) / 100;
              return (
                <div key={index} className="odeme-satir">
                  💳 KART: {kart.banka} / {kart.taksitSayisi === 1 ? 'Tek' : `${kart.taksitSayisi} Taksit`} /
                  Brüt: {formatPrice(kart.tutar)} → NET: {formatPrice(net)}
                  {kesintiOrani > 0 && ` (%${kesintiOrani} kesinti)`}
                </div>
              );
            })
          )}

          <div className="hesaba-alan" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Toplam Ödenen (Brüt):</span>
              <strong>{formatPrice(toplamOdenenHesapla())}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Hesaba Geçen (NET):</span>
              <strong>{formatPrice(hesabaGecenToplamHesapla())}</strong>
            </div>
            {acikHesapHesapla() > 0
              ? <div style={{ color: '#ea580c', fontWeight: 700, marginTop: 4 }}>🔓 AÇIK HESAP: {formatPrice(acikHesapHesapla())}</div>
              : <div style={{ color: '#15803d', fontWeight: 700, marginTop: 4 }}>✅ TAM ÖDENDİ</div>
            }
          </div>
        </div>

        {/* Notlar + Onay */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
          <div className="mavi-cerceve" style={{ flex: 1, minHeight: 80 }}>
            <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: 1, color: '#1e40af', marginBottom: 8, textTransform: 'uppercase' }}>
              📝 NOTLAR
            </div>
            {(satis as any).notlar ? (
              <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {(satis as any).notlar}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>Not girilmemiş</div>
            )}
          </div>

          <div className="mavi-cerceve" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="onay-metin" style={{ fontSize: 13 }}>ONAY: {satis.onayDurumu ? 'ONAYLANDI' : 'ONAY BEKLİYOR'}</div>
            <div className="imza-metin" style={{ fontSize: 12 }}>İMZA: __________________</div>
          </div>
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