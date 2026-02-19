import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { getSubeByKod } from '../types/sube';
import './NotificationBell.css';

// ========== TİPLER ==========

type BildirimTuru =
  | 'YENI_SATIS'
  | 'SATIS_GUNCELLENDI'
  | 'TESLIM_YAKLASIYOR'
  | 'ACIK_HESAP'
  | 'ZARАРLI_SATIS'
  | 'ONAY_BEKLIYOR';

interface Bildirim {
  id: string;
  tur: BildirimTuru;
  baslik: string;
  mesaj: string;
  tarih: Date;
  satisKodu?: string;
  satisId?: string;      // Firebase doc ID — navigate için
  satisSubeKodu?: string; // Şube kodu — navigate için
  okundu: boolean;
}

// ========== YARDIMCI ==========

const turIcon: Record<BildirimTuru, string> = {
  YENI_SATIS: '🆕',
  SATIS_GUNCELLENDI: '✏️',
  TESLIM_YAKLASIYOR: '📦',
  ACIK_HESAP: '⚠️',
  ZARАРLI_SATIS: '📉',
  ONAY_BEKLIYOR: '🕐',
};

const turRenk: Record<BildirimTuru, string> = {
  YENI_SATIS: '#16a34a',
  SATIS_GUNCELLENDI: '#2563eb',
  TESLIM_YAKLASIYOR: '#d97706',
  ACIK_HESAP: '#ea580c',
  ZARАРLI_SATIS: '#dc2626',
  ONAY_BEKLIYOR: '#7c3aed',
};

const formatRelativeTime = (date: Date): string => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  if (hours < 24) return `${hours} saat önce`;
  return `${days} gün önce`;
};

// ========== COMPONENT ==========

const NotificationBell: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [bildirimler, setBildirimler] = useState<Bildirim[]>([]);
  const [acik, setAcik] = useState(false);
  const [okunmuslar, setOkunmuslar] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  // Panel dışına tıklayınca kapat
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setAcik(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Firebase'den son 1 hafta logları dinle
  useEffect(() => {
    if (!currentUser) return;

    const sube = getSubeByKod(currentUser.subeKodu);
    if (!sube) return;

    const birHaftaOnce = new Date();
    birHaftaOnce.setDate(birHaftaOnce.getDate() - 7);

    const logRef = collection(db, `subeler/${sube.dbPath}/loglar`);
    const q = query(
      logRef,
      where('tarih', '>=', Timestamp.fromDate(birHaftaOnce)),
      orderBy('tarih', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logBildirimler: Bildirim[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        const islem: string = data.islem || '';
        const tarih: Date = data.tarih?.toDate?.() ?? new Date();

        let tur: BildirimTuru = 'YENI_SATIS';
        let baslik = '';
        let mesaj = data.detay || '';

        if (islem === 'YENİ_SATIS') {
          tur = 'YENI_SATIS';
          baslik = 'Yeni Satış Eklendi';
        } else if (islem === 'GUNCELLEME') {
          tur = 'SATIS_GUNCELLENDI';
          baslik = 'Satış Güncellendi';
        } else if (islem === 'ONAY_BEKLENIYOR') {
          tur = 'ONAY_BEKLIYOR';
          baslik = 'Onay Bekliyor';
        } else {
          baslik = islem;
        }

        return {
          id: doc.id,
          tur,
          baslik,
          mesaj,
          tarih,
          satisKodu: data.satisKodu,
          satisId: data.satisId || undefined,
          satisSubeKodu: data.subeKodu || currentUser?.subeKodu,
          okundu: false,
        };
      });

      // Firebase loglarına ek olarak satışlardan oluşturulan özel bildirimler
      setBildirimler((prev) => {
        // Özel bildirimleri koru (teslim yaklaşıyor, açık hesap, zarar gibi)
        const ozelBildirimler = prev.filter((b) =>
          ['TESLIM_YAKLASIYOR', 'ACIK_HESAP', 'ZARАРLI_SATIS'].includes(b.tur)
        );
        return [...logBildirimler, ...ozelBildirimler];
      });
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Satışlardan özel bildirimler oluştur (teslim tarihi, açık hesap, zarar)
  useEffect(() => {
    if (!currentUser) return;

    const sube = getSubeByKod(currentUser.subeKodu);
    if (!sube) return;

    const birHaftaOnce = new Date();
    birHaftaOnce.setDate(birHaftaOnce.getDate() - 7);

    const satisRef = collection(db, `subeler/${sube.dbPath}/satislar`);
    const q = query(
      satisRef,
      where('olusturmaTarihi', '>=', Timestamp.fromDate(birHaftaOnce)),
      orderBy('olusturmaTarihi', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ozelBildirimler: Bildirim[] = [];
      const simdi = new Date();
      const ucGunSonra = new Date();
      ucGunSonra.setDate(ucGunSonra.getDate() + 3);

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const satisKodu: string = data.satisKodu || doc.id;
        const musteriIsim: string = data.musteriBilgileri?.isim || 'Müşteri';
        const olusturmaTarihi: Date = data.olusturmaTarihi?.toDate?.() ?? new Date();
        const satisId = doc.id;
        const satisSubeKodu = data.subeKodu || sube.kod;

        // 📦 Teslim tarihi yaklaşıyor (3 gün içinde, henüz teslim edilmemiş)
        if (data.teslimatTarihi) {
          const teslimatTarihi: Date = data.teslimatTarihi?.toDate?.() ?? new Date();
          if (
            !data.teslimEdildiMi &&
            teslimatTarihi >= simdi &&
            teslimatTarihi <= ucGunSonra
          ) {
            const kalanGun = Math.ceil(
              (teslimatTarihi.getTime() - simdi.getTime()) / 86400000
            );
            ozelBildirimler.push({
              id: `teslim-${doc.id}`,
              tur: 'TESLIM_YAKLASIYOR',
              baslik: 'Teslim Tarihi Yaklaşıyor!',
              mesaj: `${satisKodu} — ${musteriIsim} — ${kalanGun === 0 ? 'Bugün!' : `${kalanGun} gün kaldı`}`,
              tarih: olusturmaTarihi,
              satisKodu,
              satisId,
              satisSubeKodu,
              okundu: false,
            });
          }
        }

        // ⚠️ Açık hesap var
        if (data.odemeDurumu === 'AÇIK HESAP') {
          const acikTutar = data.odemeOzeti?.acikHesap ?? 0;
          ozelBildirimler.push({
            id: `acik-${doc.id}`,
            tur: 'ACIK_HESAP',
            baslik: 'Açık Hesap Mevcut',
            mesaj: `${satisKodu} — ${musteriIsim}${acikTutar > 0 ? ` — ${acikTutar.toLocaleString('tr-TR')} ₺ ödenmedi` : ''}`,
            tarih: olusturmaTarihi,
            satisKodu,
            satisId,
            satisSubeKodu,
            okundu: false,
          });
        }

        // 📉 Zararlı satış
        if (data.zarar !== undefined && data.zarar < 0) {
          ozelBildirimler.push({
            id: `zarar-${doc.id}`,
            tur: 'ZARАРLI_SATIS',
            baslik: 'Zararlı Satış!',
            mesaj: `${satisKodu} — ${musteriIsim} — ${Math.abs(data.zarar).toLocaleString('tr-TR')} ₺ zarar`,
            tarih: olusturmaTarihi,
            satisKodu,
            satisId,
            satisSubeKodu,
            okundu: false,
          });
        }

        // 🕐 Onay bekliyor
        if (data.onayDurumu === false) {
          ozelBildirimler.push({
            id: `onay-${doc.id}`,
            tur: 'ONAY_BEKLIYOR',
            baslik: 'Onay Bekliyor',
            mesaj: `${satisKodu} — ${musteriIsim} onay bekliyor`,
            tarih: olusturmaTarihi,
            satisKodu,
            satisId,
            satisSubeKodu,
            okundu: false,
          });
        }
      });

      setBildirimler((prev) => {
        const logBildirimler = prev.filter(
          (b) => !['TESLIM_YAKLASIYOR', 'ACIK_HESAP', 'ZARАРЛИ_SATIS', 'ONAY_BEKLIYOR'].includes(b.tur)
        );
        const tumBildirimler = [...logBildirimler, ...ozelBildirimler];
        // Tarihe göre sırala
        return tumBildirimler.sort((a, b) => b.tarih.getTime() - a.tarih.getTime());
      });
    });

    return () => unsubscribe();
  }, [currentUser]);

  const okunmamisSayi = bildirimler.filter((b) => !okunmuslar.has(b.id)).length;

  const handleBildirimTikla = (b: Bildirim) => {
    // Okundu işaretle
    setOkunmuslar(prev => { const s = new Set(prev); s.add(b.id); return s; });
    setAcik(false);

    // satisId varsa detay sayfasına git
    if (b.satisId && b.satisSubeKodu) {
      navigate(`/satis-detay/${b.satisSubeKodu}/${b.satisId}`);
    } else if (b.satisId) {
      // subeKodu yoksa sadece id ile dene
      navigate(`/satis-detay/${currentUser?.subeKodu}/${b.satisId}`);
    }
  };

  const handleZilTikla = () => {
    setAcik((prev) => !prev);
    if (!acik) {
      // Paneli açınca hepsini okundu say
      setTimeout(() => {
        setOkunmuslar(new Set(bildirimler.map((b) => b.id)));
      }, 1500);
    }
  };

  const gruplaraBol = (): Record<string, Bildirim[]> => {
    const gruplar: Record<string, Bildirim[]> = {};
    bildirimler.forEach((b) => {
      const gun = b.tarih.toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'long',
        weekday: 'long',
      });
      if (!gruplar[gun]) gruplar[gun] = [];
      gruplar[gun].push(b);
    });
    return gruplar;
  };

  return (
    <div className="nb-wrapper" ref={panelRef}>
      {/* ZİL BUTONU */}
      <button
        className={`nb-zil ${okunmamisSayi > 0 ? 'nb-zil--aktif' : ''}`}
        onClick={handleZilTikla}
        title="Bildirimler"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {okunmamisSayi > 0 && (
          <span className="nb-badge">{okunmamisSayi > 99 ? '99+' : okunmamisSayi}</span>
        )}
      </button>

      {/* BİLDİRİM PANELİ */}
      {acik && (
        <div className="nb-panel">
          <div className="nb-panel-header">
            <span className="nb-panel-baslik">🔔 Bildirimler</span>
            <span className="nb-panel-alt">Son 7 gün · {bildirimler.length} bildirim</span>
          </div>

          {bildirimler.length === 0 ? (
            <div className="nb-bos">
              <div className="nb-bos-icon">🔕</div>
              <div>Bildirim yok</div>
            </div>
          ) : (
            <div className="nb-liste">
              {Object.entries(gruplaraBol()).map(([gun, gunBildirimler]) => (
                <div key={gun}>
                  <div className="nb-gun-baslik">{gun}</div>
                  {gunBildirimler.map((b) => (
                    <div
                      key={b.id}
                      className={`nb-item ${!okunmuslar.has(b.id) ? 'nb-item--yeni' : ''} ${b.satisId ? 'nb-item--tiklanabilir' : ''}`}
                      onClick={() => handleBildirimTikla(b)}
                    >
                      <div
                        className="nb-item-icon"
                        style={{ background: turRenk[b.tur] + '20', color: turRenk[b.tur] }}
                      >
                        {turIcon[b.tur]}
                      </div>
                      <div className="nb-item-icerik">
                        <div className="nb-item-baslik">{b.baslik}</div>
                        <div className="nb-item-mesaj">{b.mesaj}</div>
                        <div className="nb-item-zaman">{formatRelativeTime(b.tarih)}</div>
                      </div>
                      {!okunmuslar.has(b.id) && <div className="nb-item-nokta" />}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;