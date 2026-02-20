import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  collection, getDocs, doc, updateDoc, addDoc, setDoc, deleteDoc, Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { SUBELER, getSubeByKod, SubeKodu } from '../types/sube';
import * as XLSX from 'xlsx';
import './AdminPanel.css';

interface BankaKesinti {
  banka: string;
  tek: number;
  t2: number; t3: number; t4: number; t5: number;
  t6: number; t7: number; t8: number; t9: number;
}
interface Satici {
  id?: string;
  ad: string; soyad: string; email: string;
  subeKodu: string; aktif: boolean; hedef?: number;
}
interface KampanyaAdmin {
  id?: string;
  ad: string; aciklama: string; aktif: boolean; subeKodu: string;
}
// 5 — Yeşil Etiket admin tipi
interface YesilEtiketAdmin {
  id?: string;
  urunKodu: string;
  urunTuru?: string;
  maliyet: number;
  aciklama?: string;
  subeKodu: string;
}

type Modul =
  | 'excel-fiyat'
  | 'banka-kesinti'
  | 'satici-ekle'
  | 'satici-disable'
  | 'satici-hedef'
  | 'magaza-hedef'
  | 'kampanya'
  | 'yesil-etiket'; // YENİ

const AdminPanel: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

  React.useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    if (!isAdmin) { navigate('/'); }
  }, [currentUser]);

  const [aktifModul, setAktifModul] = useState<Modul>('excel-fiyat');
  const [mesaj, setMesaj] = useState<{ tip: 'ok' | 'hata'; text: string } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const mesajGoster = (tip: 'ok' | 'hata', text: string) => {
    setMesaj({ tip, text });
    setTimeout(() => setMesaj(null), 4000);
  };

  /* ── EXCEL FİYAT ── */
  const fiyatFileRef = useRef<HTMLInputElement>(null);
  const [fiyatOnizleme, setFiyatOnizleme] = useState<{ kod: string; tur: string; alis: number; bip: number }[]>([]);
  const [fiyatOnizlemde, setFiyatOnizlemde] = useState(false);

  const handleFiyatExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target!.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      const parsed = rows.map(r => ({
        kod:  String(r['ÜRÜN KODU'] || r['Ürün Kodu'] || r['urunKodu'] || r['kod'] || '').trim(),
        tur:  String(r['ÜRÜN TÜRÜ'] || r['Ürün Türü'] || r['tur'] || '').trim(),
        alis: parseFloat(r['ALIŞ'] || r['Aliş'] || r['alis'] || r['fiyat'] || 0),
        bip:  parseFloat(r['BİP']  || r['Bip']  || r['bip']  || 0),
      })).filter(r => r.kod && (r.alis > 0 || r.bip > 0));
      setFiyatOnizleme(parsed);
      setFiyatOnizlemde(true);
    };
    reader.readAsBinaryString(file);
  };

  const fiyatKaydet = async () => {
    setYukleniyor(true);
    let toplamGuncellenen = 0;
    try {
      for (const sube of SUBELER) {
        const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/urunler`));
        for (const row of fiyatOnizleme) {
          const urun = snap.docs.find(d => d.data().kod === row.kod);
          if (urun) {
            await updateDoc(doc(db, `subeler/${sube.dbPath}/urunler`, urun.id), {
              alis: row.alis,
              bip: row.bip,
              urunTuru: row.tur,
              guncellemeTarihi: Timestamp.now()
            });
            toplamGuncellenen++;
          }
        }
      }
      mesajGoster('ok', `✅ ${toplamGuncellenen} ürün tüm şubelerde güncellendi!`);
      setFiyatOnizleme([]);
      setFiyatOnizlemde(false);
      if (fiyatFileRef.current) fiyatFileRef.current.value = '';
    } catch (err: any) {
      mesajGoster('hata', `❌ Hata: ${err.message}`);
    } finally {
      setYukleniyor(false);
    }
  };

  /* ── BANKA KESİNTİ ── */
  const kesintiFileRef = useRef<HTMLInputElement>(null);
  const [kesintiOnizleme, setKesintiOnizleme] = useState<BankaKesinti[]>([]);
  const [kesintiYuklendi, setKesintiYuklendi] = useState(false);

  const handleKesintiExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target!.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      const parsed: BankaKesinti[] = rows.map(r => ({
        banka: r['Banka'] || r['banka'] || '',
        tek: parseFloat(r['Tek'] || r['tek'] || 0),
        t2: parseFloat(r['2 Taksit'] || r['t2'] || 0), t3: parseFloat(r['3 Taksit'] || r['t3'] || 0),
        t4: parseFloat(r['4 Taksit'] || r['t4'] || 0), t5: parseFloat(r['5 Taksit'] || r['t5'] || 0),
        t6: parseFloat(r['6 Taksit'] || r['t6'] || 0), t7: parseFloat(r['7 Taksit'] || r['t7'] || 0),
        t8: parseFloat(r['8 Taksit'] || r['t8'] || 0), t9: parseFloat(r['9 Taksit'] || r['t9'] || 0),
      })).filter(r => r.banka);
      setKesintiOnizleme(parsed); setKesintiYuklendi(true);
    };
    reader.readAsBinaryString(file);
  };

  const kesintiKaydet = async () => {
    setYukleniyor(true);
    try {
      for (const k of kesintiOnizleme) await setDoc(doc(db, `bankaKesintiler/${k.banka}`), k);
      mesajGoster('ok', `✅ ${kesintiOnizleme.length} banka kaydedildi!`);
      setKesintiOnizleme([]); setKesintiYuklendi(false);
      if (kesintiFileRef.current) kesintiFileRef.current.value = '';
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  /* ── SATICI EKLE ── */
  const [yeniSatici, setYeniSatici] = useState<Satici>({ ad: '', soyad: '', email: '', subeKodu: SUBELER[0].kod, aktif: true });

  const saticiEkle = async () => {
    if (!yeniSatici.ad || !yeniSatici.email) { mesajGoster('hata', '❌ Ad ve email zorunlu!'); return; }
    setYukleniyor(true);
    try {
      const sube = getSubeByKod(yeniSatici.subeKodu as SubeKodu);
      if (!sube) throw new Error('Şube bulunamadı');
      await addDoc(collection(db, `subeler/${sube.dbPath}/saticilar`), { ...yeniSatici, olusturmaTarihi: Timestamp.now() });
      mesajGoster('ok', `✅ ${yeniSatici.ad} ${yeniSatici.soyad} eklendi!`);
      setYeniSatici({ ad: '', soyad: '', email: '', subeKodu: SUBELER[0].kod, aktif: true });
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  /* ── SATICI DİSABLE ── */
  const [disableSube, setDisableSube] = useState<string>(SUBELER[0].kod);
  const [saticiListesi, setSaticiListesi] = useState<Satici[]>([]);
  const [saticiYuklendi, setSaticiYuklendi] = useState(false);

  const saticiListeGetir = async () => {
    setYukleniyor(true);
    try {
      const sube = getSubeByKod(disableSube as SubeKodu); if (!sube) return;
      const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/saticilar`));
      setSaticiListesi(snap.docs.map(d => ({ id: d.id, ...d.data() } as Satici)));
      setSaticiYuklendi(true);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  const saticiAktifToggle = async (satici: Satici) => {
    const sube = getSubeByKod(disableSube as SubeKodu);
    if (!sube || !satici.id) return;
    try {
      await updateDoc(doc(db, `subeler/${sube.dbPath}/saticilar`, satici.id), { aktif: !satici.aktif });
      setSaticiListesi(prev => prev.map(s => s.id === satici.id ? { ...s, aktif: !s.aktif } : s));
      mesajGoster('ok', `✅ ${satici.ad} ${satici.aktif ? 'deaktif' : 'aktif'} edildi`);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  /* ── SATICI HEDEF ── */
  const [hedefSube, setHedefSube] = useState<string>(SUBELER[0].kod);
  const [hedefSaticilar, setHedefSaticilar] = useState<Satici[]>([]);
  const [hedefYuklendi, setHedefYuklendi] = useState(false);

  const hedefSaticiGetir = async () => {
    setYukleniyor(true);
    try {
      const sube = getSubeByKod(hedefSube as SubeKodu); if (!sube) return;
      const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/saticilar`));
      setHedefSaticilar(snap.docs.map(d => ({ id: d.id, ...d.data() } as Satici)));
      setHedefYuklendi(true);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  const saticiHedefKaydet = async (satici: Satici) => {
    const sube = getSubeByKod(hedefSube as SubeKodu);
    if (!sube || !satici.id) return;
    try {
      await updateDoc(doc(db, `subeler/${sube.dbPath}/saticilar`, satici.id), { hedef: satici.hedef || 0 });
      mesajGoster('ok', `✅ ${satici.ad} hedefi kaydedildi`);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  /* ── MAĞAZA HEDEF ── */
  const [magazaHedefler, setMagazaHedefler] = useState<Record<string, number>>(Object.fromEntries(SUBELER.map(s => [s.kod, 0])));
  const [magazaHedefYuklendi, setMagazaHedefYuklendi] = useState(false);

  const magazaHedefGetir = async () => {
    setYukleniyor(true);
    try {
      const snap = await getDocs(collection(db, 'magazaHedefler'));
      const data: Record<string, number> = {};
      snap.forEach(d => { data[d.id] = d.data().hedef || 0; });
      setMagazaHedefler(prev => ({ ...prev, ...data }));
      setMagazaHedefYuklendi(true);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  const magazaHedefKaydet = async (subeKod: string) => {
    try {
      await setDoc(doc(db, `magazaHedefler/${subeKod}`), { hedef: magazaHedefler[subeKod] || 0, guncellemeTarihi: Timestamp.now() });
      mesajGoster('ok', `✅ ${getSubeByKod(subeKod as SubeKodu)?.ad} hedefi kaydedildi`);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  const tumMagazaHedefKaydet = async () => {
    setYukleniyor(true);
    try {
      for (const sube of SUBELER) await setDoc(doc(db, `magazaHedefler/${sube.kod}`), { hedef: magazaHedefler[sube.kod] || 0, guncellemeTarihi: Timestamp.now() });
      mesajGoster('ok', '✅ Tüm mağaza hedefleri kaydedildi!');
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  /* ── KAMPANYA ── */
  const [kampanyaSube, setKampanyaSube] = useState('GENEL');
  const [kampanyalar, setKampanyalar] = useState<KampanyaAdmin[]>([]);
  const [kampanyaYuklendi, setKampanyaYuklendi] = useState(false);
  const [yeniKampanya, setYeniKampanya] = useState<KampanyaAdmin>({ ad: '', aciklama: '', aktif: true, subeKodu: 'GENEL' });

  const kampanyaGetir = async () => {
    setYukleniyor(true);
    try {
      const snap = await getDocs(collection(db, 'kampanyalar'));
      const liste = snap.docs.map(d => ({ id: d.id, ...d.data() } as KampanyaAdmin));
      setKampanyalar(liste.filter(k => kampanyaSube === 'GENEL' ? k.subeKodu === 'GENEL' : k.subeKodu === kampanyaSube));
      setKampanyaYuklendi(true);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  const kampanyaEkle = async () => {
    if (!yeniKampanya.ad) { mesajGoster('hata', '❌ Kampanya adı zorunlu!'); return; }
    setYukleniyor(true);
    try {
      await addDoc(collection(db, 'kampanyalar'), { ...yeniKampanya, subeKodu: kampanyaSube, olusturmaTarihi: Timestamp.now() });
      mesajGoster('ok', `✅ "${yeniKampanya.ad}" eklendi!`);
      setYeniKampanya({ ad: '', aciklama: '', aktif: true, subeKodu: 'GENEL' });
      kampanyaGetir();
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  const kampanyaSil = async (id: string) => {
    if (!window.confirm('Kampanyayı silmek istiyor musunuz?')) return;
    try {
      await deleteDoc(doc(db, `kampanyalar/${id}`));
      setKampanyalar(prev => prev.filter(k => k.id !== id));
      mesajGoster('ok', '✅ Kampanya silindi');
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  const kampanyaToggle = async (k: KampanyaAdmin) => {
    if (!k.id) return;
    try {
      await updateDoc(doc(db, `kampanyalar/${k.id}`), { aktif: !k.aktif });
      setKampanyalar(prev => prev.map(c => c.id === k.id ? { ...c, aktif: !c.aktif } : c));
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  /* ── YEŞİL ETİKET ── */
  const yesilEtiketFileRef = useRef<HTMLInputElement>(null);
  const [yesilEtiketSube, setYesilEtiketSube] = useState<string>(SUBELER[0].kod);
  const [yesilEtiketler, setYesilEtiketler] = useState<YesilEtiketAdmin[]>([]);
  const [yesilEtiketYuklendi, setYesilEtiketYuklendi] = useState(false);
  const [yesilEtiketOnizleme, setYesilEtiketOnizleme] = useState<YesilEtiketAdmin[]>([]);
  const [yesilEtiketOnizlemde, setYesilEtiketOnizlemde] = useState(false);
  // Manuel ekleme formu
  const [yeniYesilEtiket, setYeniYesilEtiket] = useState<YesilEtiketAdmin>({
    urunKodu: '', maliyet: 0, aciklama: '', subeKodu: SUBELER[0].kod
  });

  // Excel'den yeşil etiket yükle
  const handleYesilEtiketExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target!.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      const parsed: YesilEtiketAdmin[] = rows.map(r => ({
        urunKodu: String(r['ÜRÜN KODU'] || r['Ürün Kodu'] || r['urunKodu'] || r['kod'] || '').trim(),
        urunTuru: String(r['ÜRÜN TÜRÜ'] || r['Ürün Türü'] || r['tur'] || '').trim(),
        maliyet: parseFloat(r['YEŞİL ETİKET'] || r['Yeşil Etiket'] || r['Maliyet'] || r['maliyet'] || r['İndirim'] || 0),
        aciklama: r['Açıklama'] || r['aciklama'] || '',
        subeKodu: yesilEtiketSube,
      })).filter(r => r.urunKodu && r.maliyet > 0);
      setYesilEtiketOnizleme(parsed);
      setYesilEtiketOnizlemde(true);
    };
    reader.readAsBinaryString(file);
  };

  const yesilEtiketExcelKaydet = async () => {
    setYukleniyor(true);
    try {
      const sube = getSubeByKod(yesilEtiketSube as SubeKodu);
      if (!sube) throw new Error('Şube bulunamadı');
      for (const etiket of yesilEtiketOnizleme) {
        await addDoc(collection(db, `subeler/${sube.dbPath}/yesilEtiketler`), {
          ...etiket,
          olusturmaTarihi: Timestamp.now()
        });
      }
      mesajGoster('ok', `✅ ${yesilEtiketOnizleme.length} yeşil etiket kaydedildi!`);
      setYesilEtiketOnizleme([]);
      setYesilEtiketOnizlemde(false);
      if (yesilEtiketFileRef.current) yesilEtiketFileRef.current.value = '';
      yesilEtiketListeGetir();
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  // Mevcut yeşil etiketleri getir
  const yesilEtiketListeGetir = async () => {
    setYukleniyor(true);
    try {
      const sube = getSubeByKod(yesilEtiketSube as SubeKodu); if (!sube) return;
      const snap = await getDocs(collection(db, `subeler/${sube.dbPath}/yesilEtiketler`));
      setYesilEtiketler(snap.docs.map(d => ({ id: d.id, ...d.data() } as YesilEtiketAdmin)));
      setYesilEtiketYuklendi(true);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  // Manuel yeşil etiket ekle
  const yesilEtiketManuelEkle = async () => {
    if (!yeniYesilEtiket.urunKodu || !yeniYesilEtiket.maliyet) {
      mesajGoster('hata', '❌ Ürün kodu ve maliyet zorunlu!'); return;
    }
    setYukleniyor(true);
    try {
      const sube = getSubeByKod(yeniYesilEtiket.subeKodu as SubeKodu);
      if (!sube) throw new Error('Şube bulunamadı');
      await addDoc(collection(db, `subeler/${sube.dbPath}/yesilEtiketler`), {
        ...yeniYesilEtiket,
        olusturmaTarihi: Timestamp.now()
      });
      mesajGoster('ok', `✅ "${yeniYesilEtiket.urunKodu}" yeşil etiket eklendi!`);
      setYeniYesilEtiket({ urunKodu: '', maliyet: 0, aciklama: '', subeKodu: SUBELER[0].kod });
      if (yesilEtiketYuklendi) yesilEtiketListeGetir();
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  // Yeşil etiket sil
  const yesilEtiketSilFn = async (id: string) => {
    if (!window.confirm('Yeşil etiketi silmek istiyor musunuz?')) return;
    const sube = getSubeByKod(yesilEtiketSube as SubeKodu); if (!sube) return;
    try {
      await deleteDoc(doc(db, `subeler/${sube.dbPath}/yesilEtiketler/${id}`));
      setYesilEtiketler(prev => prev.filter(e => e.id !== id));
      mesajGoster('ok', '✅ Yeşil etiket silindi');
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  /* ── MENU ── */
  const menuler: { id: Modul; label: string; icon: string; desc: string }[] = [
    { id: 'excel-fiyat',    label: 'Excel Fiyat',      icon: 'fa-file-excel',  desc: 'Toplu fiyat güncelle' },
    { id: 'banka-kesinti',  label: 'Banka Kesinti',    icon: 'fa-university',  desc: 'Kesinti oranları' },
    { id: 'satici-ekle',    label: 'Satıcı Ekle',      icon: 'fa-user-plus',   desc: 'Yeni satıcı ekle' },
    { id: 'satici-disable', label: 'Satıcı Disable',   icon: 'fa-user-slash',  desc: 'Aktif / Deaktif' },
    { id: 'satici-hedef',   label: 'Satıcı Hedef',     icon: 'fa-bullseye',    desc: 'Kişisel hedef gir' },
    { id: 'magaza-hedef',   label: 'Mağaza Hedef',     icon: 'fa-store',       desc: 'Şube hedefleri' },
    { id: 'kampanya',       label: 'Kampanya',          icon: 'fa-tags',        desc: 'Kampanya yönet' },
    { id: 'yesil-etiket',   label: 'Yeşil Etiket',     icon: 'fa-tag',         desc: 'İndirimli eski ürünler' }, // YENİ
  ];

  const resetModulStates = () => {
    setSaticiYuklendi(false); setHedefYuklendi(false);
    setMagazaHedefYuklendi(false); setKampanyaYuklendi(false);
    setKesintiYuklendi(false); setSaticiListesi([]); setHedefSaticilar([]);
    setYesilEtiketYuklendi(false); setYesilEtiketler([]);
    setYesilEtiketOnizlemde(false); setYesilEtiketOnizleme([]);
    setFiyatOnizlemde(false); setFiyatOnizleme([]);
  };

  const aktifMenu = menuler.find(m => m.id === aktifModul);

  return (
    <div className="ap-layout">

      {/* ── SOL SİDEBAR ── */}
      <aside className="ap-sidebar">
        <div className="ap-sidebar-top">
          <button className="ap-back-btn" onClick={() => navigate('/dashboard')}>
            <i className="fas fa-arrow-left" /> Geri
          </button>
          <div className="ap-sidebar-brand">
            <i className="fas fa-shield-alt" />
            <div>
              <div className="ap-brand-title">ADMIN PANEL</div>
              <div className="ap-brand-sub">Tüfekçi Home</div>
            </div>
          </div>
        </div>

        <nav className="ap-nav">
          <div className="ap-nav-section-label">YÖNETİM ALANLARI</div>
          {menuler.map(m => (
            <button
              key={m.id}
              className={`ap-nav-item ${aktifModul === m.id ? 'active' : ''}`}
              onClick={() => { setAktifModul(m.id); resetModulStates(); }}
            >
              <div className="ap-nav-icon"><i className={`fas ${m.icon}`} /></div>
              <div className="ap-nav-text">
                <span className="ap-nav-item-label">{m.label}</span>
                <span className="ap-nav-item-desc">{m.desc}</span>
              </div>
            </button>
          ))}
        </nav>

        <div className="ap-sidebar-footer">
          <div className="ap-user-info">
            <div className="ap-user-avatar">{currentUser?.ad?.charAt(0)}{currentUser?.soyad?.charAt(0)}</div>
            <div>
              <div className="ap-user-name">{currentUser?.ad} {currentUser?.soyad}</div>
              <div className="ap-user-role">Administrator</div>
            </div>
          </div>
          <button className="ap-logout-btn" onClick={logout}><i className="fas fa-sign-out-alt" /></button>
        </div>
      </aside>

      {/* ── SAĞ ALAN ── */}
      <div className="ap-main">

        {/* HEADER */}
        <header className="ap-main-header">
          <div>
            <div className="ap-breadcrumb">Admin Panel / {aktifMenu?.label}</div>
            <h1 className="ap-page-title">
              <i className={`fas ${aktifMenu?.icon}`} />
              {aktifMenu?.label}
            </h1>
          </div>
          {mesaj && <div className={`ap-toast ap-toast--${mesaj.tip}`}>{mesaj.text}</div>}
        </header>

        <div className="ap-content">

          {/* ══ 1) EXCEL FİYAT ══ */}
          {aktifModul === 'excel-fiyat' && (
            <div className="ap-two-col">
              <div className="ap-panel">
                <div className="ap-panel-header"><i className="fas fa-upload" /><h3>Dosya Yükle</h3></div>
                <div className="ap-panel-body">
                  <div className="ap-info-banner">
                    <i className="fas fa-info-circle" />
                    <span>Excel yüklendiğinde <strong>tüm şubelerdeki</strong> eşleşen ürünler otomatik güncellenir.</span>
                  </div>
                  <div className="ap-field">
                    <label>Excel Dosyası (.xlsx)</label>
                    <div className="ap-file-zone">
                      <i className="fas fa-file-excel" />
                      <span>Dosya seç veya sürükle bırak</span>
                      <input ref={fiyatFileRef} type="file" accept=".xlsx,.xls" onChange={handleFiyatExcel} disabled={yukleniyor} />
                    </div>
                  </div>

                  {fiyatOnizlemde && fiyatOnizleme.length > 0 && (
                    <>
                      <div className="ap-table-label">
                        <i className="fas fa-eye" /> Önizleme — {fiyatOnizleme.length} ürün bulundu
                      </div>
                      <div className="ap-table-scroll">
                        <table className="ap-table">
                          <thead>
                            <tr>
                              <th>Ürün Kodu</th>
                              <th>Ürün Türü</th>
                              <th>Alış (TL)</th>
                              <th>BİP (TL)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fiyatOnizleme.map((r, i) => (
                              <tr key={i}>
                                <td><strong style={{ fontFamily: 'monospace' }}>{r.kod}</strong></td>
                                <td>{r.tur || '—'}</td>
                                <td>₺{r.alis.toLocaleString('tr-TR')}</td>
                                <td>₺{r.bip.toLocaleString('tr-TR')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button className="ap-btn-primary" onClick={fiyatKaydet} disabled={yukleniyor}>
                        <i className="fas fa-save" />
                        {yukleniyor
                          ? 'Güncelleniyor...'
                          : `${fiyatOnizleme.length} Ürünü Tüm Şubelere İşle`}
                      </button>
                    </>
                  )}

                  {yukleniyor && (
                    <div className="ap-loading">
                      <i className="fas fa-spinner fa-spin" /> Tüm şubeler güncelleniyor...
                    </div>
                  )}
                </div>
              </div>

              <div className="ap-panel ap-panel--teal-soft">
                <div className="ap-panel-header"><i className="fas fa-info-circle" /><h3>Beklenen Format</h3></div>
                <div className="ap-panel-body">
                  <div className="ap-format-preview">
                    <div className="ap-format-header">
                      <span>ÜRÜN KODU</span>
                      <span>ÜRÜN TÜRÜ</span>
                      <span>ALIŞ</span>
                      <span>BİP</span>
                    </div>
                    <div className="ap-format-row">
                      <span>WM12N180TR</span><span>ÇAMAŞIR MAK.</span><span>31</span><span>10</span>
                    </div>
                    <div className="ap-format-row">
                      <span>WG42A1X2TR</span><span>ÇAMAŞIR MAK.</span><span>31</span><span>10</span>
                    </div>
                    <div className="ap-format-row">
                      <span>KG36NXWDF</span><span>BUZDOLABI</span><span>45</span><span>15</span>
                    </div>
                  </div>
                  <ul className="ap-tips">
                    <li><i className="fas fa-check" /> Sütun başlıkları: <strong>ÜRÜN KODU, ÜRÜN TÜRÜ, ALIŞ, BİP</strong></li>
                    <li><i className="fas fa-check" /> Alış ve BİP değerleri TL cinsinden</li>
                    <li><i className="fas fa-check" /> Tüm şubelerdeki eşleşen ürünler güncellenir</li>
                    <li><i className="fas fa-check" /> Eşleşmeyen ürünler atlanır</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ══ 2) BANKA KESİNTİ ══ */}
          {aktifModul === 'banka-kesinti' && (
            <div className="ap-one-col">
              <div className="ap-panel">
                <div className="ap-panel-header"><i className="fas fa-university" /><h3>Banka Kesinti Oranları Yükle</h3></div>
                <div className="ap-panel-body">
                  <div className="ap-field" style={{ maxWidth: 420 }}>
                    <label>Excel Dosyası (.xlsx)</label>
                    <div className="ap-file-zone">
                      <i className="fas fa-university" />
                      <span>Kesinti oranları dosyasını seç</span>
                      <input ref={kesintiFileRef} type="file" accept=".xlsx,.xls" onChange={handleKesintiExcel} />
                    </div>
                  </div>

                  {kesintiYuklendi && kesintiOnizleme.length > 0 && (
                    <>
                      <div className="ap-table-label"><i className="fas fa-eye" /> Önizleme — {kesintiOnizleme.length} banka bulundu</div>
                      <div className="ap-table-scroll">
                        <table className="ap-table">
                          <thead>
                            <tr><th>Banka</th><th>Tek</th><th>2T</th><th>3T</th><th>4T</th><th>5T</th><th>6T</th><th>7T</th><th>8T</th><th>9T</th></tr>
                          </thead>
                          <tbody>
                            {kesintiOnizleme.map(k => (
                              <tr key={k.banka}>
                                <td><strong>{k.banka}</strong></td>
                                <td>%{k.tek}</td><td>%{k.t2}</td><td>%{k.t3}</td><td>%{k.t4}</td><td>%{k.t5}</td>
                                <td>%{k.t6}</td><td>%{k.t7}</td><td>%{k.t8}</td><td>%{k.t9}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button className="ap-btn-primary" onClick={kesintiKaydet} disabled={yukleniyor}>
                        <i className="fas fa-save" /> {yukleniyor ? 'Kaydediliyor...' : `${kesintiOnizleme.length} Bankayı Firebase'e Kaydet`}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══ 3) SATICI EKLE ══ */}
          {aktifModul === 'satici-ekle' && (
            <div className="ap-two-col">
              <div className="ap-panel">
                <div className="ap-panel-header"><i className="fas fa-user-plus" /><h3>Satıcı Bilgileri</h3></div>
                <div className="ap-panel-body">
                  <div className="ap-two-field">
                    <div className="ap-field">
                      <label>Ad *</label>
                      <input type="text" placeholder="Ahmet" value={yeniSatici.ad}
                        onChange={e => setYeniSatici(p => ({ ...p, ad: e.target.value }))} />
                    </div>
                    <div className="ap-field">
                      <label>Soyad</label>
                      <input type="text" placeholder="Yılmaz" value={yeniSatici.soyad}
                        onChange={e => setYeniSatici(p => ({ ...p, soyad: e.target.value }))} />
                    </div>
                  </div>
                  <div className="ap-field">
                    <label>E-posta *</label>
                    <input type="email" placeholder="ahmet@siemens.com" value={yeniSatici.email}
                      onChange={e => setYeniSatici(p => ({ ...p, email: e.target.value }))} />
                  </div>
                  <div className="ap-field">
                    <label>Şube *</label>
                    <select value={yeniSatici.subeKodu} onChange={e => setYeniSatici(p => ({ ...p, subeKodu: e.target.value }))}>
                      {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
                    </select>
                  </div>
                  <button className="ap-btn-primary" onClick={saticiEkle} disabled={yukleniyor}>
                    <i className="fas fa-user-plus" /> {yukleniyor ? 'Ekleniyor...' : 'Satıcıyı Ekle'}
                  </button>
                </div>
              </div>
              <div className="ap-panel ap-panel--teal-soft">
                <div className="ap-panel-header"><i className="fas fa-info-circle" /><h3>Bilgi</h3></div>
                <div className="ap-panel-body">
                  <ul className="ap-tips">
                    <li><i className="fas fa-check" /> Satıcı eklendikten sonra şifresi admin tarafından atanır</li>
                    <li><i className="fas fa-check" /> E-posta adresi benzersiz olmalıdır</li>
                    <li><i className="fas fa-check" /> Satıcı yalnızca kendi şubesini görebilir</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ══ 4) SATICI DİSABLE ══ */}
          {aktifModul === 'satici-disable' && (
            <div className="ap-one-col">
              <div className="ap-panel">
                <div className="ap-panel-header">
                  <i className="fas fa-user-slash" /><h3>Satıcı Aktif / Deaktif</h3>
                  <div className="ap-panel-actions">
                    <select value={disableSube} onChange={e => { setDisableSube(e.target.value); setSaticiYuklendi(false); setSaticiListesi([]); }}>
                      {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
                    </select>
                    <button className="ap-btn-secondary" onClick={saticiListeGetir} disabled={yukleniyor}>
                      <i className="fas fa-search" /> {yukleniyor ? 'Yükleniyor...' : 'Getir'}
                    </button>
                  </div>
                </div>
                <div className="ap-panel-body">
                  {!saticiYuklendi
                    ? <div className="ap-empty"><i className="fas fa-users" /><p>Şube seçip "Getir" butonuna basın</p></div>
                    : saticiListesi.length === 0
                    ? <div className="ap-empty"><p>Bu şubede satıcı bulunamadı</p></div>
                    : <div className="ap-user-grid">
                        {saticiListesi.map(s => (
                          <div key={s.id} className={`ap-user-card ${!s.aktif ? 'deaktif' : ''}`}>
                            <div className="ap-avatar">{s.ad?.charAt(0)}{s.soyad?.charAt(0)}</div>
                            <div className="ap-user-details">
                              <div className="ap-user-full-name">{s.ad} {s.soyad}</div>
                              <div className="ap-user-email">{s.email}</div>
                            </div>
                            <div className="ap-user-status">
                              <span className={`ap-dot ${s.aktif ? 'green' : 'red'}`} />
                              <span>{s.aktif ? 'Aktif' : 'Deaktif'}</span>
                            </div>
                            <button className={`ap-toggle-btn ${s.aktif ? 'off' : 'on'}`} onClick={() => saticiAktifToggle(s)}>
                              {s.aktif ? <><i className="fas fa-ban" /> Kapat</> : <><i className="fas fa-check" /> Aç</>}
                            </button>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              </div>
            </div>
          )}

          {/* ══ 5) SATICI HEDEF ══ */}
          {aktifModul === 'satici-hedef' && (
            <div className="ap-one-col">
              <div className="ap-panel">
                <div className="ap-panel-header">
                  <i className="fas fa-bullseye" /><h3>Satıcı Hedef Belirleme</h3>
                  <div className="ap-panel-actions">
                    <select value={hedefSube} onChange={e => { setHedefSube(e.target.value); setHedefYuklendi(false); setHedefSaticilar([]); }}>
                      {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
                    </select>
                    <button className="ap-btn-secondary" onClick={hedefSaticiGetir} disabled={yukleniyor}>
                      <i className="fas fa-search" /> {yukleniyor ? 'Yükleniyor...' : 'Getir'}
                    </button>
                  </div>
                </div>
                <div className="ap-panel-body">
                  {!hedefYuklendi
                    ? <div className="ap-empty"><i className="fas fa-bullseye" /><p>Şube seçip "Getir" butonuna basın</p></div>
                    : hedefSaticilar.length === 0
                    ? <div className="ap-empty"><p>Bu şubede satıcı bulunamadı</p></div>
                    : <div className="ap-hedef-list">
                        {hedefSaticilar.map((s, i) => (
                          <div key={s.id} className="ap-hedef-row">
                            <div className="ap-avatar sm">{s.ad?.charAt(0)}{s.soyad?.charAt(0)}</div>
                            <div className="ap-user-details" style={{ flex: 1 }}>
                              <div className="ap-user-full-name">{s.ad} {s.soyad}</div>
                              <div className="ap-user-email">{s.email}</div>
                            </div>
                            <div className="ap-currency-wrap">
                              <span className="ap-currency-symbol">₺</span>
                              <input
                                type="number" min="0" step="1000" placeholder="Aylık Hedef"
                                value={s.hedef || ''}
                                onChange={e => setHedefSaticilar(prev => prev.map((x, j) => j === i ? { ...x, hedef: parseFloat(e.target.value) || 0 } : x))}
                              />
                            </div>
                            <button className="ap-btn-save" onClick={() => saticiHedefKaydet(s)}>
                              <i className="fas fa-save" /> Kaydet
                            </button>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              </div>
            </div>
          )}

          {/* ══ 6) MAĞAZA HEDEF ══ */}
          {aktifModul === 'magaza-hedef' && (
            <div className="ap-one-col">
              <div className="ap-panel">
                <div className="ap-panel-header">
                  <i className="fas fa-store" /><h3>Mağaza Aylık Hedefleri</h3>
                  <div className="ap-panel-actions">
                    {!magazaHedefYuklendi
                      ? <button className="ap-btn-secondary" onClick={magazaHedefGetir} disabled={yukleniyor}>
                          <i className="fas fa-download" /> {yukleniyor ? 'Yükleniyor...' : 'Mevcut Hedefleri Getir'}
                        </button>
                      : <button className="ap-btn-primary" onClick={tumMagazaHedefKaydet} disabled={yukleniyor}>
                          <i className="fas fa-save" /> {yukleniyor ? 'Kaydediliyor...' : 'Tümünü Kaydet'}
                        </button>
                    }
                  </div>
                </div>
                <div className="ap-panel-body">
                  {!magazaHedefYuklendi
                    ? <div className="ap-empty"><i className="fas fa-store" /><p>"Mevcut Hedefleri Getir" butonuna basın</p></div>
                    : <div className="ap-hedef-list">
                        {SUBELER.map(sube => (
                          <div key={sube.kod} className="ap-hedef-row">
                            <div className="ap-store-icon-wrap"><i className="fas fa-store" /></div>
                            <div className="ap-user-details" style={{ flex: 1 }}>
                              <div className="ap-user-full-name">{sube.ad}</div>
                              <div className="ap-user-email">{sube.kod}</div>
                            </div>
                            <div className="ap-currency-wrap">
                              <span className="ap-currency-symbol">₺</span>
                              <input
                                type="number" min="0" step="10000" placeholder="Aylık Hedef"
                                value={magazaHedefler[sube.kod] || ''}
                                onChange={e => setMagazaHedefler(prev => ({ ...prev, [sube.kod]: parseFloat(e.target.value) || 0 }))}
                              />
                            </div>
                            <button className="ap-btn-save" onClick={() => magazaHedefKaydet(sube.kod)}>
                              <i className="fas fa-save" /> Kaydet
                            </button>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              </div>
            </div>
          )}

          {/* ══ 7) KAMPANYA ══ */}
          {aktifModul === 'kampanya' && (
            <div className="ap-two-col">
              <div className="ap-panel">
                <div className="ap-panel-header"><i className="fas fa-plus-circle" /><h3>Yeni Kampanya Ekle</h3></div>
                <div className="ap-panel-body">
                  <div className="ap-field">
                    <label>Kampanya Adı *</label>
                    <input type="text" placeholder="Yaz Kampanyası 2025" value={yeniKampanya.ad}
                      onChange={e => setYeniKampanya(p => ({ ...p, ad: e.target.value }))} />
                  </div>
                  <div className="ap-field">
                    <label>Şube</label>
                    <select value={kampanyaSube} onChange={e => setKampanyaSube(e.target.value)}>
                      <option value="GENEL">Genel (Tüm Şubeler)</option>
                      {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
                    </select>
                  </div>
                  <div className="ap-field">
                    <label>Açıklama</label>
                    <input type="text" placeholder="Kampanya açıklaması..." value={yeniKampanya.aciklama}
                      onChange={e => setYeniKampanya(p => ({ ...p, aciklama: e.target.value }))} />
                  </div>
                  <button className="ap-btn-primary" onClick={kampanyaEkle} disabled={yukleniyor}>
                    <i className="fas fa-plus" /> {yukleniyor ? 'Ekleniyor...' : 'Kampanya Ekle'}
                  </button>
                </div>
              </div>

              <div className="ap-panel">
                <div className="ap-panel-header">
                  <i className="fas fa-list" /><h3>Mevcut Kampanyalar</h3>
                  <div className="ap-panel-actions">
                    <select value={kampanyaSube} onChange={e => setKampanyaSube(e.target.value)}>
                      <option value="GENEL">Genel</option>
                      {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
                    </select>
                    <button className="ap-btn-secondary" onClick={kampanyaGetir} disabled={yukleniyor}>
                      <i className="fas fa-sync" /> Yükle
                    </button>
                  </div>
                </div>
                <div className="ap-panel-body">
                  {!kampanyaYuklendi
                    ? <div className="ap-empty"><i className="fas fa-tags" /><p>"Yükle" butonuna basın</p></div>
                    : kampanyalar.length === 0
                    ? <div className="ap-empty"><p>Kampanya bulunamadı</p></div>
                    : <div className="ap-kampanya-list">
                        {kampanyalar.map(k => (
                          <div key={k.id} className={`ap-kampanya-item ${!k.aktif ? 'pasif' : ''}`}>
                            <div style={{ flex: 1 }}>
                              <div className="ap-kampanya-name">{k.ad}</div>
                              {k.aciklama && <div className="ap-kampanya-desc">{k.aciklama}</div>}
                            </div>
                            <span className={`ap-pill ${k.aktif ? 'green' : 'gray'}`}>{k.aktif ? 'Aktif' : 'Pasif'}</span>
                            <button className={`ap-toggle-btn sm ${k.aktif ? 'off' : 'on'}`} onClick={() => kampanyaToggle(k)}>
                              {k.aktif ? 'Durdur' : 'Aktif Et'}
                            </button>
                            <button className="ap-delete-btn" onClick={() => kampanyaSil(k.id!)}>
                              <i className="fas fa-trash" />
                            </button>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              </div>
            </div>
          )}

          {/* ══ 8) YEŞİL ETİKET ══ */}
          {aktifModul === 'yesil-etiket' && (
            <div className="ap-two-col">

              {/* SOL: Excel Yükle + Manuel Ekle */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Excel Yükle */}
                <div className="ap-panel">
                  <div className="ap-panel-header">
                    <i className="fas fa-file-excel" /><h3>Excel ile Toplu Yükle</h3>
                  </div>
                  <div className="ap-panel-body">
                    <div className="ap-field">
                      <label>Şube</label>
                      <select value={yesilEtiketSube} onChange={e => { setYesilEtiketSube(e.target.value); setYesilEtiketYuklendi(false); setYesilEtiketler([]); }}>
                        {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
                      </select>
                    </div>
                    <div className="ap-field">
                      <label>Excel Dosyası (.xlsx)</label>
                      <div className="ap-file-zone">
                        <i className="fas fa-tag" style={{ color: '#16a34a' }} />
                        <span>Yeşil etiket dosyasını seç</span>
                        <input
                          ref={yesilEtiketFileRef}
                          type="file"
                          accept=".xlsx,.xls"
                          onChange={handleYesilEtiketExcel}
                        />
                      </div>
                    </div>

                    {yesilEtiketOnizlemde && yesilEtiketOnizleme.length > 0 && (
                      <>
                        <div className="ap-table-label">
                          <i className="fas fa-eye" /> Önizleme — {yesilEtiketOnizleme.length} ürün bulundu
                        </div>
                        <div className="ap-table-scroll">
                          <table className="ap-table">
                            <thead>
                              <tr><th>Ürün Kodu</th><th>Maliyet (TL)</th><th>Açıklama</th></tr>
                            </thead>
                            <tbody>
                              {yesilEtiketOnizleme.map((e, i) => (
                                <tr key={i}>
                                  <td><strong>{e.urunKodu}</strong></td>
                                  <td>₺{e.maliyet.toLocaleString('tr-TR')}</td>
                                  <td>{e.aciklama || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <button className="ap-btn-primary" onClick={yesilEtiketExcelKaydet} disabled={yukleniyor}>
                          <i className="fas fa-save" /> {yukleniyor ? 'Kaydediliyor...' : `${yesilEtiketOnizleme.length} Yeşil Etiketi Kaydet`}
                        </button>
                      </>
                    )}

                    <div className="ap-panel ap-panel--teal-soft" style={{ marginTop: 12 }}>
                      <div className="ap-panel-header"><i className="fas fa-info-circle" /><h3>Beklenen Format</h3></div>
                      <div className="ap-panel-body">
                        <div className="ap-format-preview">
                          <div className="ap-format-header"><span>ÜRÜN KODU</span><span>ÜRÜN TÜRÜ</span><span>YEŞİL ETİKET</span></div>
                          <div className="ap-format-row"><span>WG52A202TR</span><span>ÇAMAŞIR MAK.</span><span>23999</span></div>
                          <div className="ap-format-row"><span>WM12N180TR</span><span>ÇAMAŞIR MAK.</span><span>18500</span></div>
                        </div>
                        <ul className="ap-tips">
                          <li><i className="fas fa-check" /> Sütunlar: <strong>ÜRÜN KODU, ÜRÜN TÜRÜ, YEŞİL ETİKET</strong></li>
                          <li><i className="fas fa-check" /> Ürün kodu satış formundakiyle birebir eşleşmeli</li>
                          <li><i className="fas fa-check" /> YEŞİL ETİKET = satış fiyatı (TL)</li>
                          <li><i className="fas fa-check" /> Eşleşen ürünlerde indirim otomatik uygulanır</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Manuel Ekle */}
                <div className="ap-panel">
                  <div className="ap-panel-header">
                    <i className="fas fa-plus-circle" /><h3>Manuel Ekle</h3>
                  </div>
                  <div className="ap-panel-body">
                    <div className="ap-two-field">
                      <div className="ap-field">
                        <label>Ürün Kodu *</label>
                        <input
                          type="text"
                          placeholder="WS75-0CA15-0AG5"
                          value={yeniYesilEtiket.urunKodu}
                          onChange={e => setYeniYesilEtiket(p => ({ ...p, urunKodu: e.target.value }))}
                        />
                      </div>
                      <div className="ap-field">
                        <label>Maliyet (TL) *</label>
                        <input
                          type="number" min="0"
                          placeholder="1500"
                          value={yeniYesilEtiket.maliyet || ''}
                          onChange={e => setYeniYesilEtiket(p => ({ ...p, maliyet: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                    </div>
                    <div className="ap-field">
                      <label>Açıklama</label>
                      <input
                        type="text"
                        placeholder="Eski model, demo ürün vb."
                        value={yeniYesilEtiket.aciklama || ''}
                        onChange={e => setYeniYesilEtiket(p => ({ ...p, aciklama: e.target.value }))}
                      />
                    </div>
                    <div className="ap-field">
                      <label>Şube</label>
                      <select
                        value={yeniYesilEtiket.subeKodu}
                        onChange={e => setYeniYesilEtiket(p => ({ ...p, subeKodu: e.target.value }))}
                      >
                        {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
                      </select>
                    </div>
                    <button className="ap-btn-primary" onClick={yesilEtiketManuelEkle} disabled={yukleniyor}>
                      <i className="fas fa-plus" /> {yukleniyor ? 'Ekleniyor...' : 'Yeşil Etiket Ekle'}
                    </button>
                  </div>
                </div>
              </div>

              {/* SAĞ: Mevcut Yeşil Etiketler */}
              <div className="ap-panel">
                <div className="ap-panel-header">
                  <i className="fas fa-list" /><h3>Mevcut Yeşil Etiketler</h3>
                  <div className="ap-panel-actions">
                    <select value={yesilEtiketSube} onChange={e => { setYesilEtiketSube(e.target.value); setYesilEtiketYuklendi(false); setYesilEtiketler([]); }}>
                      {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
                    </select>
                    <button className="ap-btn-secondary" onClick={yesilEtiketListeGetir} disabled={yukleniyor}>
                      <i className="fas fa-sync" /> {yukleniyor ? 'Yükleniyor...' : 'Yükle'}
                    </button>
                  </div>
                </div>
                <div className="ap-panel-body">
                  {!yesilEtiketYuklendi
                    ? <div className="ap-empty">
                        <i className="fas fa-tag" style={{ color: '#16a34a', fontSize: 32, marginBottom: 8 }} />
                        <p>Şube seçip "Yükle" butonuna basın</p>
                      </div>
                    : yesilEtiketler.length === 0
                    ? <div className="ap-empty"><p>Bu şubede yeşil etiket bulunamadı</p></div>
                    : <div className="ap-kampanya-list">
                        {yesilEtiketler.map(e => (
                          <div key={e.id} className="ap-kampanya-item">
                            <div style={{ flex: 1 }}>
                              <div className="ap-kampanya-name" style={{ color: '#16a34a' }}>
                                🟢 {e.urunKodu}
                              </div>
                              {e.aciklama && <div className="ap-kampanya-desc">{e.aciklama}</div>}
                            </div>
                            <span className="ap-pill green">
                              ₺{(e.maliyet || 0).toLocaleString('tr-TR')}
                            </span>
                            <button className="ap-delete-btn" onClick={() => yesilEtiketSilFn(e.id!)}>
                              <i className="fas fa-trash" />
                            </button>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default AdminPanel;