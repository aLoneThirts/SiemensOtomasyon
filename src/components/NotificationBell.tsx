import React, {
  useState, useEffect, useRef, useCallback, useMemo, memo
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, query, where, orderBy, onSnapshot, Timestamp,
  doc, setDoc, getDocs, writeBatch, deleteDoc, limit // 👈 limit burada import edildi
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { getSubeByKod } from '../types/sube';
import './NotificationBell.css';

// ═══════════════════════════════════════════════════════════════════════
//  TİP TANIMLARI
// ═══════════════════════════════════════════════════════════════════════

export type BildirimTuru =
  | 'YENI_SATIS'
  | 'SATIS_GUNCELLENDI'
  | 'TESLIM_YAKLASIYOR'
  | 'TESLIM_GECIKTI'
  | 'TESLIM_TAMAMLANDI'
  | 'ACIK_HESAP'
  | 'ODEME_ALINDI'
  | 'ZARARLI_SATIS'
  | 'ONAY_BEKLIYOR'
  | 'ONAYLANDI'
  | 'YUKSEK_KAR'
  | 'HEDEF_ASILDI'
  | 'STOK_UYARISI';

export type OncelikSeviyesi = 'bilgi' | 'orta' | 'yuksek' | 'kritik';
export type GorunumModu    = 'liste' | 'ozet' | 'aktivite';
export type SiralamaYonu   = 'oncelik' | 'tarih_yeni' | 'tarih_eski' | 'tur';
export type TurFilter      = BildirimTuru | 'hepsi' | 'pinli' | 'okunmamis';

export interface Bildirim {
  id: string;
  tur: BildirimTuru;
  baslik: string;
  mesaj: string;
  detay?: string;
  tarih: Date;
  satisKodu?: string;
  satisId?: string;
  satisSubeKodu?: string;
  okundu: boolean;
  oncelik: OncelikSeviyesi;
  tutar?: number;
  kaynak: 'log' | 'satis' | 'sistem';
}

interface BildirimConfig {
  icon: string;
  renk: string;
  bgRenk: string;
  acikRenk: string;
  borderRenk: string;
  etiket: string;
  oncelik: OncelikSeviyesi;
  kategori: 'Satış' | 'Lojistik' | 'Finans' | 'Yönetim' | 'Hedef' | 'Stok';
}

// ═══════════════════════════════════════════════════════════════════════
//  SABİT KONFİGÜRASYON
// ═══════════════════════════════════════════════════════════════════════

const TUR_CFG: Record<BildirimTuru, BildirimConfig> = {
  YENI_SATIS:         { icon: '🆕', renk: '#059669', bgRenk: '#ecfdf5', acikRenk: '#d1fae5', borderRenk: '#a7f3d0', etiket: 'Yeni Satış',        oncelik: 'orta',   kategori: 'Satış'    },
  SATIS_GUNCELLENDI:  { icon: '✏️', renk: '#2563eb', bgRenk: '#eff6ff', acikRenk: '#dbeafe', borderRenk: '#bfdbfe', etiket: 'Güncellendi',       oncelik: 'bilgi',  kategori: 'Satış'    },
  TESLIM_YAKLASIYOR:  { icon: '📦', renk: '#d97706', bgRenk: '#fffbeb', acikRenk: '#fef3c7', borderRenk: '#fde68a', etiket: 'Teslim Yakın',      oncelik: 'yuksek', kategori: 'Lojistik' },
  TESLIM_GECIKTI:     { icon: '🚨', renk: '#dc2626', bgRenk: '#fef2f2', acikRenk: '#fee2e2', borderRenk: '#fca5a5', etiket: 'Teslim Gecikti',    oncelik: 'kritik', kategori: 'Lojistik' },
  TESLIM_TAMAMLANDI:  { icon: '✅', renk: '#16a34a', bgRenk: '#f0fdf4', acikRenk: '#dcfce7', borderRenk: '#86efac', etiket: 'Teslim Tamam',      oncelik: 'bilgi',  kategori: 'Lojistik' },
  ACIK_HESAP:         { icon: '💳', renk: '#ea580c', bgRenk: '#fff7ed', acikRenk: '#fed7aa', borderRenk: '#fdba74', etiket: 'Açık Hesap',        oncelik: 'yuksek', kategori: 'Finans'   },
  ODEME_ALINDI:       { icon: '💰', renk: '#0891b2', bgRenk: '#ecfeff', acikRenk: '#cffafe', borderRenk: '#a5f3fc', etiket: 'Ödeme Alındı',      oncelik: 'orta',   kategori: 'Finans'   },
  ZARARLI_SATIS:      { icon: '📉', renk: '#be123c', bgRenk: '#fff1f2', acikRenk: '#fecdd3', borderRenk: '#fda4af', etiket: 'Zararlı Satış',     oncelik: 'kritik', kategori: 'Finans'   },
  ONAY_BEKLIYOR:      { icon: '⏳', renk: '#7c3aed', bgRenk: '#f5f3ff', acikRenk: '#ede9fe', borderRenk: '#c4b5fd', etiket: 'Onay Bekliyor',     oncelik: 'yuksek', kategori: 'Yönetim'  },
  ONAYLANDI:          { icon: '🎉', renk: '#0d9488', bgRenk: '#f0fdfa', acikRenk: '#ccfbf1', borderRenk: '#99f6e4', etiket: 'Onaylandı',         oncelik: 'orta',   kategori: 'Yönetim'  },
  YUKSEK_KAR:         { icon: '🏆', renk: '#b45309', bgRenk: '#fffbeb', acikRenk: '#fef3c7', borderRenk: '#fcd34d', etiket: 'Yüksek Kâr',        oncelik: 'orta',   kategori: 'Finans'   },
  HEDEF_ASILDI:       { icon: '🎯', renk: '#6d28d9', bgRenk: '#f5f3ff', acikRenk: '#ede9fe', borderRenk: '#c4b5fd', etiket: 'Hedef Aşıldı',      oncelik: 'orta',   kategori: 'Hedef'    },
  STOK_UYARISI:       { icon: '⚠️', renk: '#9a3412', bgRenk: '#fff7ed', acikRenk: '#fed7aa', borderRenk: '#fb923c', etiket: 'Stok Uyarısı',      oncelik: 'yuksek', kategori: 'Stok'     },
};

const ONCELIK_W: Record<OncelikSeviyesi, number> = { kritik: 100, yuksek: 50, orta: 10, bilgi: 1 };
const ONCELIK_RENK: Record<OncelikSeviyesi, string> = {
  kritik: '#dc2626', yuksek: '#ea580c', orta: '#3b82f6', bilgi: '#94a3b8',
};

// ═══════════════════════════════════════════════════════════════════════
//  YARDIMCI ARAÇLAR
// ═══════════════════════════════════════════════════════════════════════

const formatZaman = (date: Date): string => {
  const ms  = Date.now() - date.getTime();
  const sn  = Math.floor(ms / 1000);
  const dk  = Math.floor(ms / 60_000);
  const sa  = Math.floor(ms / 3_600_000);
  const gun = Math.floor(ms / 86_400_000);
  if (sn < 15)   return 'Şimdi';
  if (sn < 60)   return `${sn}sn önce`;
  if (dk < 60)   return `${dk}dk önce`;
  if (sa < 24)   return `${sa}sa önce`;
  if (gun === 1) return 'Dün';
  if (gun < 7)   return `${gun} gün önce`;
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
};

const formatTarihGrup = (date: Date): string => {
  const today     = new Date();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString())     return 'Bugün';
  if (date.toDateString() === yesterday.toDateString()) return 'Dün';
  const gun = date.toLocaleDateString('tr-TR', { weekday: 'long' });
  const tarih = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  return `${gun.charAt(0).toUpperCase() + gun.slice(1)}, ${tarih}`;
};

const formatPara = (n: number) =>
  new Intl.NumberFormat('tr-TR', {
    style: 'currency', currency: 'TRY', maximumFractionDigits: 0,
  }).format(n);

const grupla = (list: Bildirim[]): [string, Bildirim[]][] => {
  const m = new Map<string, Bildirim[]>();
  list.forEach(b => {
    const k = formatTarihGrup(b.tarih);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(b);
  });
  // Set'i diziye çevirmek için Array.from kullanıyoruz (downlevelIteration hatası çözümü)
  return Array.from(m.entries());
};

const sortList = (
  list: Bildirim[],
  mod: SiralamaYonu,
  pins: Set<string>,
): Bildirim[] =>
  [...list].sort((a, b) => {
    // Pin her zaman üstte - Set.has ile kontrol
    const aPinli = pins.has(a.id) ? 1 : 0;
    const bPinli = pins.has(b.id) ? 1 : 0;
    if (aPinli !== bPinli) return bPinli - aPinli;
    
    switch (mod) {
      case 'oncelik':
        return (
          ONCELIK_W[b.oncelik] - ONCELIK_W[a.oncelik] ||
          b.tarih.getTime() - a.tarih.getTime()
        );
      case 'tarih_yeni':  return b.tarih.getTime() - a.tarih.getTime();
      case 'tarih_eski':  return a.tarih.getTime() - b.tarih.getTime();
      case 'tur':         return a.tur.localeCompare(b.tur);
      default:            return 0;
    }
  });

// ═══════════════════════════════════════════════════════════════════════
//  ALT BİLEŞENLER — MEMO ile optimize
// ═══════════════════════════════════════════════════════════════════════

const OncelikStar = memo(({ seviye }: { seviye: OncelikSeviyesi }) => (
  <span
    className={`nb-oncelik-yildiz nb-oncelik-yildiz--${seviye}`}
    title={`Öncelik: ${seviye}`}
    style={{ color: ONCELIK_RENK[seviye] }}
  >
    {seviye === 'kritik' ? '●●●' : seviye === 'yuksek' ? '●●○' : seviye === 'orta' ? '●○○' : '○○○'}
  </span>
));

interface BildirimItemProps {
  b: Bildirim;
  okundu: boolean;
  pinli: boolean;
  secili: boolean;
  secimModu: boolean;
  onTikla: (b: Bildirim) => void;
  onPinToggle: (id: string) => void;
  onOkunduYap: (id: string) => void;
}

const BildirimItem = memo(({
  b, okundu, pinli, secili, secimModu, onTikla, onPinToggle, onOkunduYap,
}: BildirimItemProps) => {
  const [hov, setHov] = useState(false);
  const cfg = TUR_CFG[b.tur];

  return (
    <div
      className={[
        'nb-item',
        `nb-item--${b.oncelik}`,
        okundu  ? 'nb-item--okundu'  : 'nb-item--yeni',
        b.satisId ? 'nb-item--link'  : '',
        secili  ? 'nb-item--secili'  : '',
        pinli   ? 'nb-item--pinli'   : '',
      ].filter(Boolean).join(' ')}
      onClick={() => onTikla(b)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      role={b.satisId ? 'button' : undefined}
      aria-pressed={secili}
    >
      {/* Sol öncelik şeridi */}
      <div
        className="nb-item-serit"
        style={{ background: okundu ? '#e2e8f0' : ONCELIK_RENK[b.oncelik] }}
      />

      {/* Seçim checkbox */}
      {secimModu && (
        <div
          className={`nb-item-cb ${secili ? 'nb-item-cb--on' : ''}`}
          style={secili ? { background: cfg.renk, borderColor: cfg.renk } : {}}
        >
          {secili && '✓'}
        </div>
      )}

      {/* İkon kutusu */}
      <div
        className="nb-item-ikon"
        style={{ background: okundu ? '#f1f5f9' : cfg.bgRenk }}
      >
        <span className="nb-item-emoji">{cfg.icon}</span>
        {!okundu && (
          <div className="nb-item-nokta" style={{ background: cfg.renk }} />
        )}
      </div>

      {/* İçerik */}
      <div className="nb-item-ic">
        {/* Satır 1: başlık + zaman */}
        <div className="nb-item-r1">
          <span className={`nb-item-baslik ${!okundu ? 'nb-item-baslik--yeni' : ''}`}>
            {pinli && <span className="nb-item-pin-ikon">📌 </span>}
            {b.baslik}
          </span>
          <span className="nb-item-zaman" title={b.tarih.toLocaleString('tr-TR')}>
            {formatZaman(b.tarih)}
          </span>
        </div>

        {/* Mesaj */}
        <div className="nb-item-mesaj">{b.mesaj}</div>

        {/* Detay satırı */}
        {b.detay && <div className="nb-item-detay">{b.detay}</div>}

        {/* Etiket satırı */}
        <div className="nb-item-r3">
          {b.satisKodu && (
            <span className="nb-item-skod">#{b.satisKodu}</span>
          )}
          <span
            className="nb-item-tur-chip"
            style={{
              background: okundu ? '#f1f5f9' : cfg.acikRenk,
              color:      okundu ? '#94a3b8' : cfg.renk,
              borderColor: okundu ? '#e2e8f0' : cfg.borderRenk,
            }}
          >
            {cfg.etiket}
          </span>
          {b.oncelik === 'kritik' && !okundu && (
            <span className="nb-item-kritik-tag">KRİTİK</span>
          )}
          {b.tutar !== undefined && (
            <span
              className="nb-item-tutar"
              style={{ color: b.tutar < 0 ? '#be123c' : '#059669' }}
            >
              {b.tutar < 0 ? '−' : '+'}{formatPara(Math.abs(b.tutar))}
            </span>
          )}
          <OncelikStar seviye={b.oncelik} />
          {b.satisId && !secimModu && (
            <span className="nb-item-git-link">Detaya git →</span>
          )}
        </div>
      </div>

      {/* Hover eylem butonları */}
      {hov && !secimModu && (
        <div
          className="nb-item-eylemler"
          onClick={e => e.stopPropagation()}
        >
          <button
            className={`nb-eylem ${pinli ? 'nb-eylem--pinli' : ''}`}
            title={pinli ? 'Sabiti kaldır' : 'Sabitle'}
            onClick={() => onPinToggle(b.id)}
          >
            {pinli ? '📌' : '📍'}
          </button>
          {!okundu && (
            <button
              className="nb-eylem nb-eylem--oku"
              title="Okundu yap"
              onClick={() => onOkunduYap(b.id)}
            >
              ✓
            </button>
          )}
        </div>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════
//  ANA COMPONENT — NotificationBell
// ═══════════════════════════════════════════════════════════════════════

const NotificationBell: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate        = useNavigate();
  const panelRef        = useRef<HTMLDivElement>(null);
  const listeRef        = useRef<HTMLDivElement>(null);
  const aramaRef        = useRef<HTMLInputElement>(null);

  // ── Temel state
  const [bildirimler,   setBildirimler]   = useState<Bildirim[]>([]);
  const [acik,          setAcik]          = useState(false);
  const [okunmuslar,    setOkunmuslar]    = useState<Set<string>>(new Set());
  const [pinliler,      setPinliler]      = useState<Set<string>>(new Set());

  // ── UI state
  const [aramaMetni,    setAramaMetni]    = useState('');
  const [turFilter,     setTurFilter]     = useState<TurFilter>('hepsi');
  const [gorunum,       setGorunum]       = useState<GorunumModu>('liste');
  const [siralama,      setSiralama]      = useState<SiralamaYonu>('oncelik');
  const [seciliIdler,   setSeciliIdler]   = useState<Set<string>>(new Set());
  const [secimModu,     setSecimModu]     = useState(false);

  // ── Animasyon state
  const [zilSallaniyor, setZilSallaniyor] = useState(false);
  const [yeniFlash,     setYeniFlash]     = useState(false);
  const [yeniSayac,     setYeniSayac]     = useState(0);

  // ── Ref takibi
  const oncekiOkunmamis = useRef(0);
  const autoMarkTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─────────────────────────────────────────────────────────────────────
  //  PANEL DIŞI TIKLAMA
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setAcik(false);
        setSecimModu(false);
        setSeciliIdler(new Set());
      }
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  //  PANEL AÇILINCA ARAMA ODAKLAN
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (acik) setTimeout(() => aramaRef.current?.focus(), 180);
  }, [acik]);

  // ─────────────────────────────────────────────────────────────────────
  //  FIRESTORE: Okundu + Pin yükle
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser?.uid) return;
    const uid = currentUser.uid;
    Promise.all([
      getDocs(collection(db, `kullaniciBildirimler/${uid}/okundu`)),
      getDocs(collection(db, `kullaniciBildirimler/${uid}/pinler`)),
    ]).then(([okuSnap, pinSnap]) => {
      setOkunmuslar(new Set(okuSnap.docs.map(d => d.id)));
      setPinliler(new Set(pinSnap.docs.filter(d => !d.data().silindi).map(d => d.id)));
    }).catch(() => {});
  }, [currentUser?.uid]);

  // ─────────────────────────────────────────────────────────────────────
  //  ZİL ANİMASYONU — yeni okunmamış gelince tetikle
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const okunsuz = bildirimler.filter(b => !okunmuslar.has(b.id)).length;
    if (okunsuz > oncekiOkunmamis.current) {
      const fark = okunsuz - oncekiOkunmamis.current;
      setYeniSayac(fark);
      setZilSallaniyor(true);
      setYeniFlash(true);
      setTimeout(() => setZilSallaniyor(false), 850);
      setTimeout(() => setYeniFlash(false), 4000);
      setTimeout(() => setYeniSayac(0), 4000);
    }
    oncekiOkunmamis.current = okunsuz;
  }, [bildirimler, okunmuslar]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────
  //  FIRESTORE: Log bildirimler (realtime)
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const sube = getSubeByKod(currentUser.subeKodu);
    if (!sube) return;

    const birHaftaOnce = new Date();
    birHaftaOnce.setDate(birHaftaOnce.getDate() - 7);

    const unsub = onSnapshot(
      query(
        collection(db, `subeler/${sube.dbPath}/loglar`),
        where('tarih', '>=', Timestamp.fromDate(birHaftaOnce)),
        orderBy('tarih', 'desc'),
        limit(60) // 👈 limit artık import edildi
      ),
      { includeMetadataChanges: false },
      snap => {
        const loglar: Bildirim[] = snap.docs.map(d => {
          const data  = d.data();
          const islem = String(data.islem ?? '');
          const tarih = (data.tarih?.toDate?.() as Date) ?? new Date();
          let tur: BildirimTuru = 'YENI_SATIS';
          if (islem === 'YENİ_SATIS')          tur = 'YENI_SATIS';
          else if (islem === 'GUNCELLEME')      tur = 'SATIS_GUNCELLENDI';
          else if (islem === 'ONAY_BEKLENIYOR') tur = 'ONAY_BEKLIYOR';
          else if (islem === 'ONAYLANDI')       tur = 'ONAYLANDI';
          else if (islem === 'TESLIM')          tur = 'TESLIM_TAMAMLANDI';
          else if (islem === 'ODEME')           tur = 'ODEME_ALINDI';
          return {
            id: d.id, tur, baslik: TUR_CFG[tur].etiket,
            mesaj: data.detay ?? '',
            tarih, satisKodu: data.satisKodu,
            satisId: data.satisId, satisSubeKodu: data.subeKodu ?? currentUser.subeKodu,
            okundu: false, oncelik: TUR_CFG[tur].oncelik, kaynak: 'log' as const,
          };
        });
        setBildirimler(prev => {
          const diger = prev.filter(b => b.kaynak !== 'log');
          return sortList([...loglar, ...diger], 'oncelik', pinliler);
        });
      }
    );
    return unsub;
  }, [currentUser, pinliler]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────
  //  FIRESTORE: Satış bildirimler (realtime)
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const sube = getSubeByKod(currentUser.subeKodu);
    if (!sube) return;

    const ucGunOnce = new Date();
    ucGunOnce.setDate(ucGunOnce.getDate() - 3);

    const unsub = onSnapshot(
      query(
        collection(db, `subeler/${sube.dbPath}/satislar`),
        where('olusturmaTarihi', '>=', Timestamp.fromDate(ucGunOnce)),
        orderBy('olusturmaTarihi', 'desc'),
        limit(35) // 👈 limit artık import edildi
      ),
      { includeMetadataChanges: false },
      snap => {
        const ozel: Bildirim[] = [];
        const now    = Date.now();
        const gun3   = now + 3 * 86_400_000;

        snap.docs.forEach(d => {
          const data  = d.data();
          const skod  = data.satisKodu ?? d.id;
          const mus   = data.musteriBilgileri?.isim ?? 'Müşteri';
          const tarih = (data.olusturmaTarihi?.toDate?.() as Date) ?? new Date();
          const sId   = d.id;
          const sSube = data.subeKodu ?? sube.kod;
          const base  = { tarih, satisKodu: skod, satisId: sId, satisSubeKodu: sSube, okundu: false, kaynak: 'satis' as const };

          // Teslim kontrolü
          if (data.teslimatTarihi && !data.teslimEdildiMi) {
            const tMs = ((data.teslimatTarihi?.toDate?.() as Date) ?? new Date()).getTime();
            if (tMs < now) {
              const g = Math.floor((now - tMs) / 86_400_000);
              ozel.push({ ...base, id: `gecik-${d.id}`, tur: 'TESLIM_GECIKTI', oncelik: 'kritik',
                baslik: 'Teslim Gecikti!',
                mesaj: `${skod} — ${mus}`,
                detay: `${g} gün gecikti — acil işlem gerekiyor`,
              });
            } else if (tMs <= gun3) {
              const kG = Math.ceil((tMs - now) / 86_400_000);
              ozel.push({ ...base, id: `teslim-${d.id}`, tur: 'TESLIM_YAKLASIYOR', oncelik: 'yuksek',
                baslik: kG === 0 ? 'Bugün Teslim!' : 'Teslim Yaklaşıyor',
                mesaj: `${skod} — ${mus}`,
                detay: kG === 0 ? 'Son gün!' : `${kG} gün kaldı`,
              });
            }
          }

          // Açık hesap
          if (data.odemeDurumu === 'AÇIK HESAP') {
            const t = data.acikHesap ?? 0;
            ozel.push({ ...base, id: `acik-${d.id}`, tur: 'ACIK_HESAP', oncelik: 'yuksek',
              baslik: 'Açık Hesap', mesaj: `${skod} — ${mus}`,
              detay: t > 0 ? `${formatPara(t)} tahsilat bekliyor` : undefined,
              tutar: t,
            });
          }

          // Zararlı satış
          if (data.zarar !== undefined && data.zarar < 0) {
            ozel.push({ ...base, id: `zarar-${d.id}`, tur: 'ZARARLI_SATIS', oncelik: 'kritik',
              baslik: 'Zararlı Satış', mesaj: `${skod} — ${mus}`,
              detay: `${formatPara(Math.abs(data.zarar))} zarar kaydedildi`,
              tutar: data.zarar,
            });
          }

          // Onay bekliyor
          if (data.onayDurumu === false) {
            ozel.push({ ...base, id: `onay-${d.id}`, tur: 'ONAY_BEKLIYOR', oncelik: 'yuksek',
              baslik: 'Onay Bekliyor', mesaj: `${skod} — ${mus}`,
              detay: 'Yönetici onayı gerekiyor',
            });
          }

          // Yüksek kâr (≥10.000 ₺)
          if (data.zarar !== undefined && data.zarar >= 10_000) {
            ozel.push({ ...base, id: `kar-${d.id}`, tur: 'YUKSEK_KAR', oncelik: 'orta',
              baslik: 'Yüksek Kârlı Satış 🎉', mesaj: `${skod} — ${mus}`,
              detay: `${formatPara(data.zarar)} kâr elde edildi`,
              tutar: data.zarar,
            });
          }
        });

        setBildirimler(prev => {
          const diger = prev.filter(b => b.kaynak !== 'satis');
          return sortList([...diger, ...ozel], 'oncelik', pinliler);
        });
      }
    );
    return unsub;
  }, [currentUser, pinliler]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────
  //  TÜREMİŞ VERİ (useMemo)
  // ─────────────────────────────────────────────────────────────────────
  const gosterilecek = useMemo(() => {
    let liste = bildirimler;

    // Tür/özel filtreler
    if (turFilter === 'pinli')      liste = liste.filter(b => pinliler.has(b.id));
    else if (turFilter === 'okunmamis') liste = liste.filter(b => !okunmuslar.has(b.id));
    else if (turFilter !== 'hepsi') liste = liste.filter(b => b.tur === turFilter as BildirimTuru);

    // Arama
    if (aramaMetni.trim()) {
      const q = aramaMetni.toLowerCase().trim();
      liste = liste.filter(b =>
        b.baslik.toLowerCase().includes(q) ||
        b.mesaj.toLowerCase().includes(q)  ||
        (b.detay ?? '').toLowerCase().includes(q) ||
        (b.satisKodu ?? '').toLowerCase().includes(q),
      );
    }

    return sortList(liste, siralama, pinliler);
  }, [bildirimler, turFilter, aramaMetni, siralama, pinliler, okunmuslar]);

  const stats = useMemo(() => {
    const okunsuz  = bildirimler.filter(b => !okunmuslar.has(b.id));
    const kritikler = okunsuz.filter(b => b.oncelik === 'kritik');
    const yuksekler = okunsuz.filter(b => b.oncelik === 'yuksek');
    const bugunler  = bildirimler.filter(b => b.tarih.toDateString() === new Date().toDateString());
    const turDag = bildirimler.reduce((acc, b) => {
      acc[b.tur] = (acc[b.tur] ?? 0) + 1; return acc;
    }, {} as Record<string, number>);

    return {
      toplam:    bildirimler.length,
      okunmamis: okunsuz.length,
      kritik:    kritikler.length,
      yuksek:    yuksekler.length,
      pinli:     pinliler.size,
      bugun:     bugunler.length,
      turDag:    Object.entries(turDag).sort(([,a],[,b]) => b - a),
    };
  }, [bildirimler, okunmuslar, pinliler]);

  const mevcutTurler = useMemo(
    () => Array.from(new Set(bildirimler.map(b => b.tur))) as BildirimTuru[],
    [bildirimler],
  );

  // ─────────────────────────────────────────────────────────────────────
  //  FIRESTORE YAZMA YARDIMCILARI
  // ─────────────────────────────────────────────────────────────────────
  const okunduYaz = useCallback(async (ids: string[]) => {
    if (!currentUser?.uid || ids.length === 0) return;
    const batch = writeBatch(db);
    ids.forEach(id =>
      batch.set(doc(db, `kullaniciBildirimler/${currentUser.uid}/okundu/${id}`),
        { ts: Timestamp.now() })
    );
    await batch.commit().catch(console.error);
  }, [currentUser?.uid]);

  const pinToggle = useCallback(async (id: string) => {
    if (!currentUser?.uid) return;
    const next = new Set(pinliler);
    const ref  = doc(db, `kullaniciBildirimler/${currentUser.uid}/pinler/${id}`);
    if (next.has(id)) {
      next.delete(id);
      await setDoc(ref, { silindi: true }).catch(() => {});
    } else {
      next.add(id);
      await setDoc(ref, { ts: Timestamp.now() }).catch(() => {});
    }
    setPinliler(next);
  }, [currentUser?.uid, pinliler]);

  const okunduYap = useCallback((id: string) => {
    const s = new Set(okunmuslar);
    s.add(id);
    setOkunmuslar(s);
    okunduYaz([id]);
  }, [okunmuslar, okunduYaz]);

  const tumunuOku = useCallback(() => {
    const ids = bildirimler.filter(b => !okunmuslar.has(b.id)).map(b => b.id);
    // Set'i diziye çevirmek için spread operatörü yerine Array.from kullanıyoruz
    const yeniOkunmuslar = new Set(bildirimler.map(b => b.id));
    setOkunmuslar(yeniOkunmuslar);
    okunduYaz(ids);
  }, [bildirimler, okunmuslar, okunduYaz]);

  const seciliOku = useCallback(() => {
    // Set'i diziye çevirmek için Array.from kullanıyoruz
    const ids = Array.from(seciliIdler);
    const s   = new Set(okunmuslar);
    ids.forEach(id => s.add(id));
    setOkunmuslar(s);
    okunduYaz(ids);
    setSeciliIdler(new Set());
    setSecimModu(false);
  }, [seciliIdler, okunmuslar, okunduYaz]);

  // ─────────────────────────────────────────────────────────────────────
  //  UI HANDLERS
  // ─────────────────────────────────────────────────────────────────────
  const handleTikla = useCallback((b: Bildirim) => {
    if (secimModu) {
      const s = new Set(seciliIdler);
      if (s.has(b.id)) {
        s.delete(b.id);
      } else {
        s.add(b.id);
      }
      setSeciliIdler(s);
      return;
    }
    okunduYap(b.id);
    setAcik(false);
    if (b.satisId) {
      navigate(`/satis-detay/${b.satisSubeKodu ?? currentUser?.subeKodu}/${b.satisId}`);
    }
  }, [secimModu, seciliIdler, okunduYap, navigate, currentUser?.subeKodu]);

  const handleZil = useCallback(() => {
    setAcik(prev => {
      if (!prev) {
        // Açılınca 2.5sn sonra hepsini okundu say
        autoMarkTimer.current && clearTimeout(autoMarkTimer.current);
        autoMarkTimer.current = setTimeout(() => {
          setBildirimler(cur => {
            const ids = cur.filter(b => !okunmuslar.has(b.id)).map(b => b.id);
            if (ids.length) {
              const yeniOkunmuslar = new Set(cur.map(b => b.id));
              setOkunmuslar(yeniOkunmuslar);
              okunduYaz(ids);
            }
            return cur;
          });
        }, 2500);
      } else {
        autoMarkTimer.current && clearTimeout(autoMarkTimer.current);
      }
      return !prev;
    });
    setAramaMetni('');
    setTurFilter('hepsi');
    setSecimModu(false);
    setSeciliIdler(new Set());
  }, [okunmuslar, okunduYaz]);

  useEffect(() => () => {
    autoMarkTimer.current && clearTimeout(autoMarkTimer.current);
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  //  ÖZET KART bileşeni (inline)
  // ─────────────────────────────────────────────────────────────────────
  const OzetKart = useCallback(({ tur, sayi }: { tur: BildirimTuru; sayi: number }) => {
    const cfg    = TUR_CFG[tur];
    const okunsz = bildirimler.filter(b => b.tur === tur && !okunmuslar.has(b.id)).length;
    return (
      <div
        className="nb-ozet-kart"
        style={{ background: cfg.bgRenk, borderColor: cfg.borderRenk }}
        onClick={() => { setTurFilter(tur); setGorunum('liste'); }}
        role="button"
      >
        <span className="nb-ozet-kart-ikon">{cfg.icon}</span>
        <div className="nb-ozet-kart-ic">
          <span className="nb-ozet-kart-etiket" style={{ color: cfg.renk }}>{cfg.etiket}</span>
          <span className="nb-ozet-kart-sayi">{sayi} bildirim</span>
        </div>
        {okunsz > 0 && (
          <span className="nb-ozet-kart-badge" style={{ background: cfg.renk }}>{okunsz} yeni</span>
        )}
        <span className="nb-ozet-kart-ok" style={{ color: cfg.renk }}>›</span>
      </div>
    );
  }, [bildirimler, okunmuslar]);

  // ─────────────────────────────────────────────────────────────────────
  //  AKTİVİTE GÖRÜNÜM (zaman çizelgesi)
  // ─────────────────────────────────────────────────────────────────────
  const AktiviteGorunum = useCallback(() => {
    const son20 = bildirimler.slice(0, 20);
    return (
      <div className="nb-aktivite">
        <div className="nb-aktivite-baslik">Son Aktiviteler</div>
        {son20.map((b, i) => {
          const cfg = TUR_CFG[b.tur];
          return (
            <div key={b.id} className="nb-akt-item" onClick={() => handleTikla(b)}>
              <div className="nb-akt-sol">
                <div className="nb-akt-ikon" style={{ background: cfg.bgRenk, color: cfg.renk }}>
                  {cfg.icon}
                </div>
                {i < son20.length - 1 && <div className="nb-akt-cizgi" />}
              </div>
              <div className="nb-akt-ic">
                <div className="nb-akt-baslik" style={{ color: okunmuslar.has(b.id) ? '#94a3b8' : '#0f172a' }}>
                  {b.baslik}
                </div>
                <div className="nb-akt-mesaj">{b.mesaj}</div>
                <div className="nb-akt-zaman">{formatZaman(b.tarih)}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }, [bildirimler, okunmuslar, handleTikla]);

  // ═══════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="nb-wrapper" ref={panelRef}>

      {/* ══════════════════════════════════════════
          ZİL BUTONU
      ══════════════════════════════════════════ */}
      <button
        className={[
          'nb-zil',
          stats.okunmamis > 0     ? 'nb-zil--aktif'      : '',
          zilSallaniyor           ? 'nb-zil--sallaniyor'  : '',
          yeniFlash               ? 'nb-zil--flash'       : '',
        ].filter(Boolean).join(' ')}
        onClick={handleZil}
        aria-label={`Bildirimler, ${stats.okunmamis} okunmamış`}
        aria-expanded={acik}
      >
        <svg className="nb-zil-svg" width="20" height="20" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {stats.kritik > 0 && (
          <span className="nb-badge nb-badge--kritik">{stats.kritik}</span>
        )}
        {stats.kritik === 0 && stats.okunmamis > 0 && (
          <span className="nb-badge">{stats.okunmamis > 99 ? '99+' : stats.okunmamis}</span>
        )}
        {yeniFlash && (
          <>
            <span className="nb-ripple" />
            <span className="nb-yeni-pop">+{yeniSayac}</span>
          </>
        )}
      </button>

      {/* ══════════════════════════════════════════
          BİLDİRİM PANELİ
      ══════════════════════════════════════════ */}
      {acik && (
        <div className="nb-panel" role="dialog" aria-modal="true" aria-label="Bildirimler paneli">

          {/* ── HEADER ── */}
          <header className="nb-header">

            {/* 1. satır — başlık + eylemler */}
            <div className="nb-hdr-r1">
              <div className="nb-hdr-sol">
                <h2 className="nb-hdr-baslik">
                  <span className="nb-hdr-ikon">🔔</span>
                  Bildirimler
                </h2>
                <div className="nb-hdr-chips">
                  {stats.okunmamis > 0 && (
                    <span className="nb-hc nb-hc--mavi">{stats.okunmamis} yeni</span>
                  )}
                  {stats.kritik > 0 && (
                    <span className="nb-hc nb-hc--kirmizi">🚨 {stats.kritik} kritik</span>
                  )}
                  {stats.pinli > 0 && (
                    <span className="nb-hc nb-hc--altin">📌 {stats.pinli}</span>
                  )}
                </div>
              </div>

              <div className="nb-hdr-sag">
                {/* Çoklu seçim */}
                <button
                  className={`nb-hbtn ${secimModu ? 'nb-hbtn--on' : ''}`}
                  title="Çoklu seçim modu"
                  onClick={() => { setSecimModu(p => !p); setSeciliIdler(new Set()); }}
                >
                  ☑
                </button>
                {/* Görünüm değiştir */}
                <button
                  className="nb-hbtn"
                  title="Görünümü değiştir"
                  onClick={() => setGorunum(p =>
                    p === 'liste' ? 'ozet' : p === 'ozet' ? 'aktivite' : 'liste'
                  )}
                >
                  {gorunum === 'liste' ? '⊞' : gorunum === 'ozet' ? '📊' : '☰'}
                </button>
                {stats.okunmamis > 0 && (
                  <button className="nb-tumoku" onClick={tumunuOku}>Tümünü oku</button>
                )}
                <button className="nb-kapat" onClick={() => setAcik(false)} aria-label="Kapat">✕</button>
              </div>
            </div>

            {/* 2. satır — istatistik şeridi */}
            <div className="nb-istat-serit">
              {[
                { label: 'Toplam', val: stats.toplam,    cls: '' },
                { label: 'Bugün',  val: stats.bugun,     cls: 'nb-iv--mavi' },
                { label: 'Yüksek', val: stats.yuksek,    cls: 'nb-iv--turuncu' },
                { label: 'Kritik', val: stats.kritik,    cls: 'nb-iv--kirmizi' },
                { label: 'Pinli',  val: stats.pinli,     cls: 'nb-iv--altin' },
              ].map((item, i, arr) => (
                <React.Fragment key={item.label}>
                  <div className="nb-istat-kol">
                    <span className={`nb-iv ${item.cls}`}>{item.val}</span>
                    <span className="nb-il">{item.label}</span>
                  </div>
                  {i < arr.length - 1 && <div className="nb-istat-divider" />}
                </React.Fragment>
              ))}
            </div>

            {/* 3. satır — arama */}
            <div className="nb-arama-wrap">
              <span className="nb-arama-lup" aria-hidden="true">🔍</span>
              <input
                ref={aramaRef}
                className="nb-arama"
                type="search"
                placeholder="Satış kodu, müşteri adı, bildirim içeriği..."
                value={aramaMetni}
                onChange={e => setAramaMetni(e.target.value)}
                aria-label="Bildirim ara"
              />
              {aramaMetni && (
                <button className="nb-arama-x" onClick={() => setAramaMetni('')} aria-label="Aramayı temizle">✕</button>
              )}
            </div>

            {/* 4. satır — filtreler + sıralama */}
            <div className="nb-toolbar">
              <div className="nb-filtreler" role="tablist">
                {/* Özel filtreler */}
                {(['hepsi', 'okunmamis', 'pinli'] as TurFilter[]).map(f => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={turFilter === f}
                    className={`nb-fchip ${turFilter === f ? 'nb-fchip--aktif' : ''}`}
                    onClick={() => setTurFilter(p => p === f ? 'hepsi' : f)}
                  >
                    {f === 'hepsi' ? 'Hepsi' : f === 'okunmamis' ? '🔴 Okunmamış' : '📌 Pinli'}
                    <span className="nb-fchip-n">
                      {f === 'hepsi'      ? bildirimler.length
                      : f === 'okunmamis' ? stats.okunmamis
                      : stats.pinli}
                    </span>
                  </button>
                ))}
                {/* Tür chipleri */}
                {mevcutTurler.map(tur => {
                  const cfg    = TUR_CFG[tur as BildirimTuru];
                  const sayi   = bildirimler.filter(b => b.tur === tur).length;
                  const okunsz = bildirimler.filter(b => b.tur === tur && !okunmuslar.has(b.id)).length;
                  const aktif  = turFilter === tur;
                  return (
                    <button
                      key={tur}
                      role="tab"
                      aria-selected={aktif}
                      className={`nb-fchip nb-fchip--tur ${aktif ? 'nb-fchip--secili' : ''}`}
                      style={aktif ? { background: cfg.renk, borderColor: cfg.renk, color: '#fff' } : {}}
                      onClick={() => setTurFilter(p => p === tur ? 'hepsi' : tur)}
                      title={cfg.etiket}
                    >
                      <span>{cfg.icon}</span>
                      <span className="nb-fchip-n" style={aktif ? { background: 'rgba(255,255,255,0.25)' } : {}}>
                        {sayi}
                      </span>
                      {okunsz > 0 && !aktif && (
                        <span className="nb-fchip-dot" style={{ background: cfg.renk }} />
                      )}
                    </button>
                  );
                })}
              </div>

              <select
                className="nb-siralama"
                value={siralama}
                onChange={e => setSiralama(e.target.value as SiralamaYonu)}
                aria-label="Sıralama"
              >
                <option value="oncelik">⬆ Öncelik</option>
                <option value="tarih_yeni">🕐 En Yeni</option>
                <option value="tarih_eski">🕓 En Eski</option>
                <option value="tur">A→Z Tür</option>
              </select>
            </div>

            {/* 5. satır — çoklu seçim araç çubuğu */}
            {secimModu && (
              <div className="nb-secim-bar" role="toolbar">
                <span className="nb-secim-info">
                  {seciliIdler.size > 0
                    ? `${seciliIdler.size} bildirim seçildi`
                    : 'Bildirim seçin'}
                </span>
                <button className="nb-secim-btn"
                  onClick={() => {
                    // Set'e dönüştürürken Array.from kullanıyoruz
                    const yeniSecili = new Set(gosterilecek.map(b => b.id));
                    setSeciliIdler(yeniSecili);
                  }}>
                  Tümünü Seç
                </button>
                <button className="nb-secim-btn"
                  onClick={() => setSeciliIdler(new Set())}>
                  Temizle
                </button>
                {seciliIdler.size > 0 && (
                  <button className="nb-secim-btn nb-secim-btn--prime" onClick={seciliOku}>
                    ✓ Okundu ({seciliIdler.size})
                  </button>
                )}
              </div>
            )}
          </header>

          {/* ── KRİTİK UYARI ŞERİDİ ── */}
          {stats.kritik > 0 && !aramaMetni && turFilter === 'hepsi' && gorunum === 'liste' && (
            <div className="nb-kritik-serit" role="alert">
              <span className="nb-kritik-serit-ikon">🚨</span>
              <span className="nb-kritik-serit-yazi">
                <strong>{stats.kritik}</strong> kritik bildirim acil müdahale gerektiriyor
              </span>
              <button
                className="nb-kritik-serit-btn"
                onClick={() => setTurFilter('TESLIM_GECIKTI')}
              >
                Filtrele →
              </button>
            </div>
          )}

          {/* ══════════════════ ÖZET GÖRÜNÜM ══════════════════ */}
          {gorunum === 'ozet' && (
            <div className="nb-ozet-wrap">
              <div className="nb-ozet-hdr">
                <span className="nb-ozet-hdr-yazi">Tür Dağılımı</span>
                <button className="nb-ozet-geri" onClick={() => setGorunum('liste')}>← Listeye Dön</button>
              </div>
              <div className="nb-ozet-grid">
                {stats.turDag.map(([tur, sayi]) => (
                  <OzetKart key={tur} tur={tur as BildirimTuru} sayi={sayi} />
                ))}
              </div>
            </div>
          )}

          {/* ══════════════════ AKTİVİTE GÖRÜNÜM ══════════════════ */}
          {gorunum === 'aktivite' && <AktiviteGorunum />}

          {/* ══════════════════ LİSTE GÖRÜNÜM ══════════════════ */}
          {gorunum === 'liste' && (
            <div className="nb-liste" ref={listeRef} role="list">
              {gosterilecek.length === 0 ? (
                <div className="nb-bos" role="status">
                  <div className="nb-bos-ikon">{aramaMetni ? '🔍' : '🎉'}</div>
                  <div className="nb-bos-baslik">
                    {aramaMetni ? 'Sonuç bulunamadı' : 'Hepsi temiz!'}
                  </div>
                  <div className="nb-bos-alt">
                    {aramaMetni
                      ? `"${aramaMetni}" için eşleşme bulunamadı`
                      : 'Tüm bildirimler okundu — harika iş 🎉'}
                  </div>
                  {aramaMetni && (
                    <button className="nb-bos-temizle" onClick={() => setAramaMetni('')}>
                      Aramayı Temizle
                    </button>
                  )}
                </div>
              ) : (
                grupla(gosterilecek).map(([gun, gunBildirimler], gi) => (
                  <div key={gun} className="nb-gun-grup" role="group" aria-label={gun}>
                    <div className="nb-gun-baslik" role="separator">
                      <div className="nb-gun-cizgi" />
                      <span className="nb-gun-yazi">{gun}</span>
                      <span className="nb-gun-badge">{gunBildirimler.length}</span>
                      <div className="nb-gun-cizgi" />
                    </div>
                    {gunBildirimler.map((b, idx) => (
                      <BildirimItem
                        key={b.id}
                        b={b}
                        okundu={okunmuslar.has(b.id)}
                        pinli={pinliler.has(b.id)}
                        secili={seciliIdler.has(b.id)}
                        secimModu={secimModu}
                        onTikla={handleTikla}
                        onPinToggle={pinToggle}
                        onOkunduYap={okunduYap}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── FOOTER ── */}
          <footer className="nb-footer">
            <div className="nb-footer-sol">
              <span className="nb-footer-sayi">
                {gosterilecek.length} / {bildirimler.length} bildirim
              </span>
              {turFilter !== 'hepsi' && (
                <button className="nb-footer-filter-temizle" onClick={() => setTurFilter('hepsi')}>
                  ✕ {turFilter === 'okunmamis' ? 'Okunmamış' : turFilter === 'pinli' ? 'Pinli' : TUR_CFG[turFilter as BildirimTuru]?.etiket}
                </button>
              )}
            </div>
            <div className="nb-footer-sag">
              <button
                className="nb-footer-gorunum"
                onClick={() => setGorunum(p => p === 'liste' ? 'ozet' : p === 'ozet' ? 'aktivite' : 'liste')}
                title="Görünümü değiştir"
              >
                {gorunum === 'liste' ? '⊞ Özet' : gorunum === 'ozet' ? '📊 Aktivite' : '☰ Liste'}
              </button>
              <span className="nb-footer-son7">Son 7 gün</span>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;