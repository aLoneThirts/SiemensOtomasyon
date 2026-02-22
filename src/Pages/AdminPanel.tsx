import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  collection, getDocs, doc, updateDoc, addDoc, setDoc, deleteDoc, Timestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { secondaryAuth } from '../firebase/config';
import { SUBELER, getSubeByKod, SubeKodu } from '../types/sube';
import * as XLSX from 'xlsx';
import './AdminPanel.css';

// ─── YARDIMCI ────────────────────────────────────────────────
const ayKey = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const magazaDocId = (subeKod: string, ay: string): string => `${subeKod}-${ay}`;

// ─── TIPLER ───────────────────────────────────────────────────
interface BankaKesinti {
  banka: string;
  taksitler: Record<number, number>;
}
interface Satici {
  id?: string;
  ad: string; soyad: string; email: string;
  subeKodu: string; aktif: boolean;
  hedefler?: Record<string, number>;
  hedef?: number;
  role?: string;
}
interface KampanyaAdmin {
  id?: string;
  ad: string; aciklama: string; aktif: boolean; subeKodu: string;
  tutar?: number;
}
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
  | 'yesil-etiket'
  | 'email-guncelle';  // ← YENİ

const AdminPanel: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const isAdminUser = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';

  useEffect(() => {
    if (!currentUser) { navigate('/login'); return; }
    if (!isAdminUser) { navigate('/'); }
  }, [currentUser, navigate, isAdminUser]);

  const buAy = ayKey();

  const [aktifModul,  setAktifModul]  = useState<Modul>('excel-fiyat');
  const [mesaj,       setMesaj]       = useState<{ tip: 'ok' | 'hata'; text: string } | null>(null);
  const [yukleniyor,  setYukleniyor]  = useState(false);
  const [ilerleme,    setIlerleme]    = useState('');

  const mesajGoster = (tip: 'ok' | 'hata', text: string) => {
    setMesaj({ tip, text });
    setTimeout(() => setMesaj(null), 5000);
  };

  const aySecenekleri = useMemo<string[]>(() => {
    const aylar: string[] = [];
    const now = new Date();
    for (let i = -2; i <= 1; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      aylar.push(ayKey(d));
    }
    return aylar;
  }, []);

  /* ══════════════════════════════════════════════════════════
     1) EXCEL FİYAT
  ══════════════════════════════════════════════════════════ */
  const fiyatFileRef = useRef<HTMLInputElement>(null);
  const [fiyatOnizleme,  setFiyatOnizleme]  = useState<{ kod: string; tur: string; alis: number; bip: number }[]>([]);
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
    let toplamGuncellenen = 0, toplamEklenen = 0;
    const BATCH_SIZE = 450;
    try {
      setIlerleme('Mevcut ürünler okunuyor...');
      const snap = await getDocs(collection(db, 'urunler'));
      const mevcutMap: Record<string, string> = {};
      snap.docs.forEach(d => { const kod = d.data().kod; if (kod) mevcutMap[kod.trim()] = d.id; });
      setIlerleme(`${fiyatOnizleme.length} ürün yazılıyor...`);
      for (let i = 0; i < fiyatOnizleme.length; i += BATCH_SIZE) {
        const chunk = fiyatOnizleme.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const mevcutId = mevcutMap[row.kod.trim()];
          if (mevcutId) {
            batch.update(doc(db, 'urunler', mevcutId), { alis: row.alis, bip: row.bip, urunTuru: row.tur, guncellemeTarihi: Timestamp.now() });
            toplamGuncellenen++;
          } else {
            const newRef = doc(collection(db, 'urunler'));
            batch.set(newRef, { kod: row.kod, urunTuru: row.tur, alis: row.alis, bip: row.bip, olusturmaTarihi: Timestamp.now(), guncellemeTarihi: Timestamp.now() });
            toplamEklenen++;
          }
        }
        await batch.commit();
        setIlerleme(`Yazılıyor... ${Math.min(i + BATCH_SIZE, fiyatOnizleme.length)}/${fiyatOnizleme.length}`);
      }
      setIlerleme('');
      mesajGoster('ok', `✅ ${toplamGuncellenen} ürün güncellendi, ${toplamEklenen} yeni ürün eklendi!`);
      setFiyatOnizleme([]); setFiyatOnizlemde(false);
      if (fiyatFileRef.current) fiyatFileRef.current.value = '';
    } catch (err: any) {
      setIlerleme('');
      mesajGoster('hata', `❌ Hata: ${err.message}`);
    } finally { setYukleniyor(false); }
  };

  /* ══════════════════════════════════════════════════════════
     2) BANKA KESİNTİ
  ══════════════════════════════════════════════════════════ */
  const kesintiFileRef = useRef<HTMLInputElement>(null);
  const [kesintiOnizleme,  setKesintiOnizleme]  = useState<BankaKesinti[]>([]);
  const [kesintiYuklendi,  setKesintiYuklendi]  = useState(false);

  const handleKesintiExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target!.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws);
        if (rows.length === 0) { mesajGoster('hata', '❌ Excel dosyası boş!'); return; }
        const anahtarlar = Object.keys(rows[0]);
        const normalize = (s: string) =>
          s.toLowerCase()
            .replace(/i̇/g, 'i').replace(/ı/g, 'i').replace(/ğ/g, 'g')
            .replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o')
            .replace(/ç/g, 'c').replace(/\s+/g, ' ').trim();
        const baslikEsleme: Record<string, string> = {};
        anahtarlar.forEach(k => {
          const norm = normalize(k);
          if (norm.includes('banka')) baslikEsleme['Banka Adı'] = k;
          if (norm.includes('taksit')) baslikEsleme['Taksit Sayısı'] = k;
          if (norm.includes('komisyon') || norm.includes('oran')) baslikEsleme['Komisyon Oranı (%)'] = k;
        });
        const beklenenBasliklar = ['Banka Adı', 'Taksit Sayısı', 'Komisyon Oranı (%)'];
        const eksikBaslik = beklenenBasliklar.find(b => !baslikEsleme[b]);
        if (eksikBaslik) {
          mesajGoster('hata', `❌ Eksik sütun: "${eksikBaslik}" — Başlıklar şu şekilde olmalı: ${beklenenBasliklar.join(' | ')}`);
          if (kesintiFileRef.current) kesintiFileRef.current.value = '';
          return;
        }
        const hatalar: string[] = [];
        const tekiSatirlar = new Set<string>();
        const bankaMap: Record<string, Record<number, number>> = {};
        rows.forEach((r, i) => {
          const satirNo = i + 2;
          const bankaAdi = String(r[baslikEsleme['Banka Adı']] || '').trim();
          const taksitSayisi = r[baslikEsleme['Taksit Sayısı']];
          const komisyon = r[baslikEsleme['Komisyon Oranı (%)']];
          if (!bankaAdi) { hatalar.push(`Satır ${satirNo}: Banka adı boş olamaz.`); return; }
          const taksitNum = Number(taksitSayisi);
          if (isNaN(taksitNum) || !Number.isInteger(taksitNum) || taksitNum <= 0) {
            hatalar.push(`Satır ${satirNo}: Taksit sayısı pozitif tam sayı olmalı (mevcut: "${taksitSayisi}").`); return;
          }
          const komisyonStr = String(komisyon || '').replace('%', '').replace(',', '.').trim();
          const komisyonNum = parseFloat(komisyonStr);
          if (isNaN(komisyonNum) || komisyonNum < 0) {
            hatalar.push(`Satır ${satirNo}: Komisyon oranı geçerli sayı olmalı, negatif olamaz (mevcut: "${komisyon}").`); return;
          }
          const tekKey = `${bankaAdi}__${taksitNum}`;
          if (tekiSatirlar.has(tekKey)) { hatalar.push(`Satır ${satirNo}: "${bankaAdi}" + ${taksitNum} taksit kombinasyonu tekrar ediyor.`); return; }
          tekiSatirlar.add(tekKey);
          if (!bankaMap[bankaAdi]) bankaMap[bankaAdi] = {};
          bankaMap[bankaAdi][taksitNum] = komisyonNum;
        });
        if (hatalar.length > 0) {
          mesajGoster('hata', `❌ ${hatalar.length} hata bulundu:\n${hatalar.slice(0, 3).join('\n')}${hatalar.length > 3 ? `\n...ve ${hatalar.length - 3} hata daha` : ''}`);
          if (kesintiFileRef.current) kesintiFileRef.current.value = '';
          return;
        }
        const parsed: BankaKesinti[] = Object.entries(bankaMap).map(([banka, taksitler]) => ({ banka, taksitler }));
        setKesintiOnizleme(parsed);
        setKesintiYuklendi(true);
      } catch (err: any) {
        mesajGoster('hata', `❌ Dosya okunamadı: ${err.message}`);
        if (kesintiFileRef.current) kesintiFileRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const kesintiKaydet = async () => {
    setYukleniyor(true);
    try {
      const mevcutSnap = await getDocs(collection(db, 'bankaKesintiler'));
      if (mevcutSnap.docs.length > 0) {
        const silBatch = writeBatch(db);
        mevcutSnap.docs.forEach(d => silBatch.delete(d.ref));
        await silBatch.commit();
      }
      const yazBatch = writeBatch(db);
      for (const k of kesintiOnizleme) {
        yazBatch.set(doc(db, 'bankaKesintiler', k.banka), { banka: k.banka, taksitler: k.taksitler, guncellemeTarihi: Timestamp.now() });
      }
      await yazBatch.commit();
      mesajGoster('ok', `✅ Banka kesinti oranları başarıyla güncellendi. (${kesintiOnizleme.length} banka)`);
      setKesintiOnizleme([]); setKesintiYuklendi(false);
      if (kesintiFileRef.current) kesintiFileRef.current.value = '';
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  /* ══════════════════════════════════════════════════════════
     3) SATICI EKLE
  ══════════════════════════════════════════════════════════ */
  const [yeniSatici, setYeniSatici] = useState<Satici & { sifre: string }>({
    ad: '', soyad: '', email: '', subeKodu: SUBELER[0].kod, aktif: true, sifre: ''
  });
  const [sifreGoster,        setSifreGoster]        = useState(false);
  const [tumSaticilar,       setTumSaticilar]       = useState<Satici[]>([]);
  const [tumSaticilarYuklendi, setTumSaticilarYuklendi] = useState(false);
  const [saticiSilOnay,      setSaticiSilOnay]      = useState<string | null>(null);

  const tumSaticilarGetir = async () => {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const liste = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Satici))
        .filter(u => u.role?.toString().toUpperCase() !== 'ADMIN')
        .sort((a, b) => (a.subeKodu || '').localeCompare(b.subeKodu || '') || (a.ad || '').localeCompare(b.ad || ''));
      setTumSaticilar(liste);
      setTumSaticilarYuklendi(true);
    } catch (err) { console.error('Satıcılar çekilemedi:', err); }
  };

  useEffect(() => {
    if (aktifModul === 'satici-ekle') tumSaticilarGetir();
  }, [aktifModul]);

  const saticiEkle = async () => {
    if (!yeniSatici.ad || !yeniSatici.email) { mesajGoster('hata', '❌ Ad ve email zorunlu!'); return; }
    if (!yeniSatici.sifre || yeniSatici.sifre.length < 6) { mesajGoster('hata', '❌ Şifre en az 6 karakter!'); return; }
    setYukleniyor(true);
    try {
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, yeniSatici.email, yeniSatici.sifre);
      const uid = userCred.user.uid;
      await secondaryAuth.signOut();
      await setDoc(doc(db, 'users', uid), {
        ad: yeniSatici.ad, soyad: yeniSatici.soyad, email: yeniSatici.email,
        subeKodu: yeniSatici.subeKodu, role: 'SATICI', aktif: true,
        hedefler: {}, olusturmaTarihi: Timestamp.now(),
      });
      mesajGoster('ok', `✅ ${yeniSatici.ad} ${yeniSatici.soyad} eklendi!`);
      setYeniSatici({ ad: '', soyad: '', email: '', subeKodu: SUBELER[0].kod, aktif: true, sifre: '' });
      tumSaticilarGetir();
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') mesajGoster('hata', '❌ Bu e-posta zaten kayıtlı!');
      else if (err.code === 'auth/invalid-email')   mesajGoster('hata', '❌ Geçersiz e-posta!');
      else if (err.code === 'auth/weak-password')   mesajGoster('hata', '❌ Şifre çok zayıf!');
      else mesajGoster('hata', `❌ Hata: ${err.message}`);
    } finally { setYukleniyor(false); }
  };

  const saticiSilFirestore = async (saticiId: string) => {
    try {
      await setDoc(doc(db, 'users', saticiId), { aktif: false }, { merge: true });
      mesajGoster('ok', '✅ Satıcı deaktif edildi');
      setSaticiSilOnay(null);
      tumSaticilarGetir();
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  /* ══════════════════════════════════════════════════════════
     4) SATICI DİSABLE
  ══════════════════════════════════════════════════════════ */
  const [disableSube,    setDisableSube]    = useState<string>(SUBELER[0].kod);
  const [saticiListesi,  setSaticiListesi]  = useState<Satici[]>([]);
  const [saticiYuklendi, setSaticiYuklendi] = useState(false);

  const saticiListeGetir = async () => {
    setYukleniyor(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const liste = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Satici))
        .filter(u => u.subeKodu === disableSube && u.role?.toString().toUpperCase() !== 'ADMIN');
      setSaticiListesi(liste);
      setSaticiYuklendi(true);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  const saticiAktifToggle = async (satici: Satici) => {
    if (!satici.id) return;
    try {
      await updateDoc(doc(db, 'users', satici.id), { aktif: !satici.aktif });
      setSaticiListesi(prev => prev.map(s => s.id === satici.id ? { ...s, aktif: !s.aktif } : s));
      mesajGoster('ok', `✅ ${satici.ad} ${satici.aktif ? 'deaktif' : 'aktif'} edildi`);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  /* ══════════════════════════════════════════════════════════
     5) SATICI HEDEF
  ══════════════════════════════════════════════════════════ */
  const [hedefSube,       setHedefSube]       = useState<string>(SUBELER[0].kod);
  const [hedefAy,         setHedefAy]         = useState<string>(buAy);
  const [hedefSaticilar,  setHedefSaticilar]  = useState<Satici[]>([]);
  const [hedefYuklendi,   setHedefYuklendi]   = useState(false);

  const hedefSaticiGetir = async () => {
    setYukleniyor(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const liste = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Satici))
        .filter(u => u.subeKodu === hedefSube && u.role?.toString().toUpperCase() !== 'ADMIN');
      setHedefSaticilar(liste);
      setHedefYuklendi(true);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  const getSaticiHedef = (s: Satici): number =>
    s.hedefler?.[hedefAy] ?? s.hedef ?? 0;

  const saticiHedefKaydet = async (satici: Satici, yeniHedef: number) => {
    if (!satici.id) return;
    try {
      await setDoc(doc(db, 'users', satici.id), { hedefler: { [hedefAy]: yeniHedef } }, { merge: true });
      setHedefSaticilar(prev =>
        prev.map(s => s.id === satici.id ? { ...s, hedefler: { ...s.hedefler, [hedefAy]: yeniHedef } } : s)
      );
      mesajGoster('ok', `✅ ${satici.ad} — ${hedefAy} hedefi kaydedildi`);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  /* ══════════════════════════════════════════════════════════
     6) MAĞAZA HEDEF
  ══════════════════════════════════════════════════════════ */
  const [magazaAy,            setMagazaAy]            = useState<string>(buAy);
  const [magazaHedefler,      setMagazaHedefler]      = useState<Record<string, number>>(
    Object.fromEntries(SUBELER.map(s => [s.kod, 0]))
  );
  const [magazaHedefYuklendi, setMagazaHedefYuklendi] = useState(false);

  const magazaHedefGetir = async () => {
    setYukleniyor(true);
    try {
      const snap = await getDocs(collection(db, 'magazaHedefler'));
      const data: Record<string, number> = {};
      snap.forEach(d => { data[d.id] = d.data().hedef || 0; });
      const aylikData: Record<string, number> = {};
      SUBELER.forEach(s => { const docId = magazaDocId(s.kod, magazaAy); aylikData[s.kod] = data[docId] ?? 0; });
      setMagazaHedefler(aylikData);
      setMagazaHedefYuklendi(true);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  useEffect(() => {
    setMagazaHedefYuklendi(false);
    setMagazaHedefler(Object.fromEntries(SUBELER.map(s => [s.kod, 0])));
  }, [magazaAy]);

  const magazaHedefKaydet = async (subeKod: string) => {
    try {
      const docId = magazaDocId(subeKod, magazaAy);
      await setDoc(doc(db, 'magazaHedefler', docId), { hedef: magazaHedefler[subeKod] || 0, subeKod, ay: magazaAy, guncellemeTarihi: Timestamp.now() });
      mesajGoster('ok', `✅ ${getSubeByKod(subeKod as SubeKodu)?.ad} — ${magazaAy} hedefi kaydedildi`);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  const tumMagazaHedefKaydet = async () => {
    setYukleniyor(true);
    try {
      for (const sube of SUBELER) {
        const docId = magazaDocId(sube.kod, magazaAy);
        await setDoc(doc(db, 'magazaHedefler', docId), { hedef: magazaHedefler[sube.kod] || 0, subeKod: sube.kod, ay: magazaAy, guncellemeTarihi: Timestamp.now() });
      }
      mesajGoster('ok', `✅ ${magazaAy} için tüm mağaza hedefleri kaydedildi!`);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  /* ══════════════════════════════════════════════════════════
     7) KAMPANYA
  ══════════════════════════════════════════════════════════ */
  const [kampanyaSube,    setKampanyaSube]    = useState<string>('GENEL');
  const [kampanyalar,     setKampanyalar]     = useState<KampanyaAdmin[]>([]);
  const [kampanyaYuklendi, setKampanyaYuklendi] = useState(false);
  const [yeniKampanya,    setYeniKampanya]    = useState<KampanyaAdmin>({ ad: '', aciklama: '', aktif: true, subeKodu: 'GENEL', tutar: 0 });

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
      setYeniKampanya({ ad: '', aciklama: '', aktif: true, subeKodu: 'GENEL', tutar: 0 });
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

  /* ══════════════════════════════════════════════════════════
     8) YEŞİL ETİKET
  ══════════════════════════════════════════════════════════ */
  const yesilEtiketFileRef = useRef<HTMLInputElement>(null);
  const [yesilEtiketSube,      setYesilEtiketSube]      = useState<string>(SUBELER[0].kod);
  const [yesilEtiketler,       setYesilEtiketler]       = useState<YesilEtiketAdmin[]>([]);
  const [yesilEtiketYuklendi,  setYesilEtiketYuklendi]  = useState(false);
  const [yesilEtiketOnizleme,  setYesilEtiketOnizleme]  = useState<YesilEtiketAdmin[]>([]);
  const [yesilEtiketOnizlemde, setYesilEtiketOnizlemde] = useState(false);
  const [yeniYesilEtiket,      setYeniYesilEtiket]      = useState<YesilEtiketAdmin>({ urunKodu: '', maliyet: 0, aciklama: '', subeKodu: SUBELER[0].kod });

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
        maliyet: parseFloat(r['YEŞİL ETİKET'] || r['Yeşil Etiket'] || r['yesilEtiket'] || r['Maliyet'] || r['maliyet'] || 0),
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
    const BATCH_SIZE = 450;
    try {
      setIlerleme('Mevcut yeşil etiketler okunuyor...');
      const mevcutSnap = await getDocs(collection(db, 'yesilEtiketler'));
      const mevcutMap: Record<string, string> = {};
      mevcutSnap.docs.forEach(d => { const kod = d.data().urunKodu; if (kod) mevcutMap[kod.trim().toLowerCase()] = d.id; });
      let guncellenen = 0, eklenen = 0;
      setIlerleme(`${yesilEtiketOnizleme.length} yeşil etiket yazılıyor...`);
      for (let i = 0; i < yesilEtiketOnizleme.length; i += BATCH_SIZE) {
        const chunk = yesilEtiketOnizleme.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);
        for (const etiket of chunk) {
          const key = etiket.urunKodu.trim().toLowerCase();
          const mevcutId = mevcutMap[key];
          const veri = { urunKodu: etiket.urunKodu, urunTuru: etiket.urunTuru || '', maliyet: etiket.maliyet, aciklama: etiket.aciklama || '', guncellemeTarihi: Timestamp.now() };
          if (mevcutId) { batch.update(doc(db, 'yesilEtiketler', mevcutId), veri); guncellenen++; }
          else { const newRef = doc(collection(db, 'yesilEtiketler')); batch.set(newRef, { ...veri, olusturmaTarihi: Timestamp.now() }); eklenen++; }
        }
        await batch.commit();
        setIlerleme(`Yazılıyor... ${Math.min(i + BATCH_SIZE, yesilEtiketOnizleme.length)}/${yesilEtiketOnizleme.length}`);
      }
      setIlerleme('');
      mesajGoster('ok', `✅ ${guncellenen} güncellendi, ${eklenen} yeni eklendi!`);
      setYesilEtiketOnizleme([]); setYesilEtiketOnizlemde(false);
      if (yesilEtiketFileRef.current) yesilEtiketFileRef.current.value = '';
      yesilEtiketListeGetir();
    } catch (err: any) { setIlerleme(''); mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  const yesilEtiketListeGetir = async () => {
    setYukleniyor(true);
    try {
      const snap = await getDocs(collection(db, 'yesilEtiketler'));
      setYesilEtiketler(snap.docs.map(d => ({ id: d.id, ...d.data() } as YesilEtiketAdmin)));
      setYesilEtiketYuklendi(true);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  const yesilEtiketManuelEkle = async () => {
    if (!yeniYesilEtiket.urunKodu || !yeniYesilEtiket.maliyet) { mesajGoster('hata', '❌ Ürün kodu ve maliyet zorunlu!'); return; }
    setYukleniyor(true);
    try {
      const mevcutSnap = await getDocs(collection(db, 'yesilEtiketler'));
      const mevcutDoc = mevcutSnap.docs.find(d => d.data().urunKodu?.trim().toLowerCase() === yeniYesilEtiket.urunKodu.trim().toLowerCase());
      const veri = { urunKodu: yeniYesilEtiket.urunKodu.trim(), maliyet: yeniYesilEtiket.maliyet, aciklama: yeniYesilEtiket.aciklama || '', guncellemeTarihi: Timestamp.now() };
      if (mevcutDoc) { await updateDoc(doc(db, 'yesilEtiketler', mevcutDoc.id), veri); mesajGoster('ok', `✅ "${yeniYesilEtiket.urunKodu}" güncellendi!`); }
      else { await addDoc(collection(db, 'yesilEtiketler'), { ...veri, olusturmaTarihi: Timestamp.now() }); mesajGoster('ok', `✅ "${yeniYesilEtiket.urunKodu}" eklendi!`); }
      setYeniYesilEtiket({ urunKodu: '', maliyet: 0, aciklama: '', subeKodu: SUBELER[0].kod });
      if (yesilEtiketYuklendi) yesilEtiketListeGetir();
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  const yesilEtiketSilFn = async (id: string) => {
    if (!window.confirm('Yeşil etiketi silmek istiyor musunuz?')) return;
    try {
      await deleteDoc(doc(db, `yesilEtiketler/${id}`));
      setYesilEtiketler(prev => prev.filter(e => e.id !== id));
      mesajGoster('ok', '✅ Yeşil etiket silindi');
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
  };

  /* ══════════════════════════════════════════════════════════
     9) EMAIL GÜNCELLE ← YENİ MODÜL
     
     Firebase Auth email'i sadece Admin SDK ile değiştirilebilir.
     Biz Firestore'daki email alanını güncelleyip kullanıcıya
     yeni email + şifre ile tekrar kayıt yaptıracağız.
     
     ÇÖZÜM AKIŞI:
     1) Mevcut kullanıcıyı deaktif et (aktif: false)
     2) Yeni email ile secondaryAuth'tan yeni hesap oluştur
     3) Firestore'da yeni UID ile aynı veriyi yaz
     4) Eski dokümanı sil
  ══════════════════════════════════════════════════════════ */
  const [emailSaticilar,     setEmailSaticilar]     = useState<Satici[]>([]);
  const [emailSaticiYuklendi, setEmailSaticiYuklendi] = useState(false);
  const [emailGuncelleSatici, setEmailGuncelleSatici] = useState<Satici | null>(null);
  const [yeniEmail,           setYeniEmail]           = useState('');
  const [yeniSifre,           setYeniSifre]           = useState('');
  const [emailSifreGoster,    setEmailSifreGoster]    = useState(false);

  const emailSaticilarGetir = async () => {
    setYukleniyor(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const liste = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Satici))
        .filter(u => u.role?.toString().toUpperCase() !== 'ADMIN')
        .sort((a, b) => (a.subeKodu || '').localeCompare(b.subeKodu || '') || (a.ad || '').localeCompare(b.ad || ''));
      setEmailSaticilar(liste);
      setEmailSaticiYuklendi(true);
    } catch (err: any) { mesajGoster('hata', `❌ Hata: ${err.message}`); }
    finally { setYukleniyor(false); }
  };

  useEffect(() => {
    if (aktifModul === 'email-guncelle') emailSaticilarGetir();
  }, [aktifModul]);

  const emailGuncelle = async () => {
    if (!emailGuncelleSatici) return;
    if (!yeniEmail || !yeniEmail.includes('@')) { mesajGoster('hata', '❌ Geçerli bir email girin!'); return; }
    if (!yeniSifre || yeniSifre.length < 6) { mesajGoster('hata', '❌ Yeni şifre en az 6 karakter olmalı!'); return; }

    if (!window.confirm(`"${emailGuncelleSatici.ad} ${emailGuncelleSatici.soyad}" kullanıcısının emaili "${yeniEmail}" olarak güncellenecek. Devam edilsin mi?`)) return;

    setYukleniyor(true);
    try {
      // 1) Yeni email ile Firebase Auth'a yeni hesap oluştur
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, yeniEmail, yeniSifre);
      const yeniUid = userCred.user.uid;
      await secondaryAuth.signOut();

      // 2) Eski Firestore verisini al
      const eskiSnap = await getDocs(collection(db, 'users'));
      const eskiDoc = eskiSnap.docs.find(d => d.id === emailGuncelleSatici.id);
      const eskiVeri = eskiDoc?.data() || {};

      // 3) Yeni UID ile Firestore'a yaz (email güncellenerek)
      await setDoc(doc(db, 'users', yeniUid), {
        ...eskiVeri,
        email: yeniEmail,
        guncellemeTarihi: Timestamp.now(),
      });

      // 4) Eski Firestore dokümanını sil
      if (emailGuncelleSatici.id) {
        await deleteDoc(doc(db, 'users', emailGuncelleSatici.id));
      }

      mesajGoster('ok', `✅ ${emailGuncelleSatici.ad} ${emailGuncelleSatici.soyad} için email güncellendi! Yeni email: ${yeniEmail}`);
      setEmailGuncelleSatici(null);
      setYeniEmail('');
      setYeniSifre('');
      emailSaticilarGetir();
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') mesajGoster('hata', '❌ Bu email zaten başka bir hesapta kullanılıyor!');
      else if (err.code === 'auth/invalid-email')   mesajGoster('hata', '❌ Geçersiz email formatı!');
      else mesajGoster('hata', `❌ Hata: ${err.message}`);
    } finally { setYukleniyor(false); }
  };

  /* ══════════════════════════════════════════════════════════
     MENÜ & YARDIMCILAR
  ══════════════════════════════════════════════════════════ */
  const menuler: { id: Modul; label: string; icon: string; desc: string }[] = [
    { id: 'excel-fiyat',    label: 'Excel Fiyat',    icon: 'fa-file-excel',  desc: 'Toplu fiyat güncelle'   },
    { id: 'banka-kesinti',  label: 'Banka Kesinti',  icon: 'fa-university',  desc: 'Kesinti oranları'       },
    { id: 'satici-ekle',    label: 'Satıcı Ekle',    icon: 'fa-user-plus',   desc: 'Yeni satıcı ekle'      },
    { id: 'satici-disable', label: 'Satıcı Disable', icon: 'fa-user-slash',  desc: 'Aktif / Deaktif'       },
    { id: 'satici-hedef',   label: 'Satıcı Hedef',   icon: 'fa-bullseye',    desc: 'Aylık kişisel hedef'   },
    { id: 'magaza-hedef',   label: 'Mağaza Hedef',   icon: 'fa-store',       desc: 'Aylık şube hedefleri'  },
    { id: 'kampanya',       label: 'Kampanya',        icon: 'fa-tags',        desc: 'Kampanya yönet'        },
    { id: 'yesil-etiket',  label: 'Yeşil Etiket',   icon: 'fa-tag',         desc: 'İndirimli eski ürünler' },
    { id: 'email-guncelle', label: 'Email Güncelle', icon: 'fa-envelope',    desc: 'Kullanıcı email değiştir' },
  ];

  const resetModulStates = () => {
    setSaticiYuklendi(false); setHedefYuklendi(false);
    setMagazaHedefYuklendi(false); setKampanyaYuklendi(false);
    setKesintiYuklendi(false); setSaticiListesi([]); setHedefSaticilar([]);
    setYesilEtiketYuklendi(false); setYesilEtiketler([]);
    setYesilEtiketOnizlemde(false); setYesilEtiketOnizleme([]);
    setFiyatOnizlemde(false); setFiyatOnizleme([]);
    setTumSaticilarYuklendi(false); setTumSaticilar([]);
    setEmailSaticiYuklendi(false); setEmailSaticilar([]);
    setEmailGuncelleSatici(null); setYeniEmail(''); setYeniSifre('');
  };

  const aktifMenu = menuler.find(m => m.id === aktifModul);

  const subeRenk = (subeKodu: string): string => {
    const renkler: Record<string, string> = {
      'KARTAL': '#0ea5e9', 'PENDIK': '#8b5cf6', 'SANCAKTEPE': '#f59e0b',
      'BUYAKA': '#10b981', 'SOGANLIK': '#ef4444'
    };
    return renkler[subeKodu] || '#009999';
  };

  const AySecici = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {label && <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{label}</span>}
      <select value={value} onChange={e => onChange(e.target.value)} style={{ border: '1.5px solid #009999', borderRadius: 8, padding: '5px 10px', fontSize: 13, fontFamily: 'monospace', color: '#0f1f2e', background: '#f0fafa', fontWeight: 700, cursor: 'pointer' }}>
        {aySecenekleri.map(ay => (
          <option key={ay} value={ay}>{ay} {ay === buAy ? '← Bu Ay' : ''}</option>
        ))}
      </select>
    </div>
  );

  /* ══════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════ */
  return (
    <div className="ap-layout">

      {/* SOL SİDEBAR */}
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
            <button key={m.id} className={`ap-nav-item ${aktifModul === m.id ? 'active' : ''}`} onClick={() => { setAktifModul(m.id); resetModulStates(); }}>
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

      {/* SAĞ ALAN */}
      <div className="ap-main">
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
                    <span>Excel yüklendiğinde <strong>tüm şubelerdeki</strong> eşleşen ürünler güncellenir, eşleşmeyenler eklenir.</span>
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
                      <div className="ap-table-label"><i className="fas fa-eye" /> Önizleme — {fiyatOnizleme.length} ürün bulundu</div>
                      <div className="ap-table-scroll">
                        <table className="ap-table">
                          <thead><tr><th>Ürün Kodu</th><th>Ürün Türü</th><th>Alış (TL)</th><th>BİP (TL)</th></tr></thead>
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
                        {yukleniyor ? (ilerleme || 'Güncelleniyor...') : `${fiyatOnizleme.length} Ürünü Tüm Şubelere İşle`}
                      </button>
                    </>
                  )}
                  {yukleniyor && <div className="ap-loading"><i className="fas fa-spinner fa-spin" />{ilerleme || 'Güncelleniyor...'}</div>}
                </div>
              </div>
              <div className="ap-panel ap-panel--teal-soft">
                <div className="ap-panel-header"><i className="fas fa-info-circle" /><h3>Beklenen Format</h3></div>
                <div className="ap-panel-body">
                  <div className="ap-format-preview">
                    <div className="ap-format-header"><span>ÜRÜN KODU</span><span>ÜRÜN TÜRÜ</span><span>ALIŞ</span><span>BİP</span></div>
                    <div className="ap-format-row"><span>WM12N180TR</span><span>ÇAMAŞIR MAK.</span><span>31</span><span>10</span></div>
                    <div className="ap-format-row"><span>WG42A1X2TR</span><span>ÇAMAŞIR MAK.</span><span>31</span><span>10</span></div>
                    <div className="ap-format-row"><span>KG36NXWDF</span><span>BUZDOLABI</span><span>45</span><span>15</span></div>
                  </div>
                  <ul className="ap-tips">
                    <li><i className="fas fa-check" /> Sütun başlıkları: <strong>ÜRÜN KODU, ÜRÜN TÜRÜ, ALIŞ, BİP</strong></li>
                    <li><i className="fas fa-check" /> Alış ve BİP değerleri TL cinsinden</li>
                    <li><i className="fas fa-check" /> Tüm şubelerdeki eşleşen ürünler güncellenir</li>
                    <li><i className="fas fa-check" /> Eşleşmeyen ürünler yeni kayıt olarak eklenir</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ══ 2) BANKA KESİNTİ ══ */}
          {aktifModul === 'banka-kesinti' && (
            <div className="ap-two-col">
              <div className="ap-panel">
                <div className="ap-panel-header"><i className="fas fa-university" /><h3>Banka Kesinti Oranları Yükle</h3></div>
                <div className="ap-panel-body">
                  <div className="ap-field">
                    <label>Excel Dosyası (.xlsx)</label>
                    <div className="ap-file-zone">
                      <i className="fas fa-university" />
                      <span>Kesinti oranları dosyasını seç</span>
                      <input ref={kesintiFileRef} type="file" accept=".xlsx,.xls" onChange={handleKesintiExcel} disabled={yukleniyor} />
                    </div>
                  </div>
                  {kesintiYuklendi && kesintiOnizleme.length > 0 && (
                    <>
                      <div className="ap-table-label">
                        <i className="fas fa-eye" /> Önizleme — {kesintiOnizleme.length} banka,{' '}
                        {kesintiOnizleme.reduce((acc, k) => acc + Object.keys(k.taksitler).length, 0)} taksit kombinasyonu
                      </div>
                      <div className="ap-table-scroll">
                        <table className="ap-table">
                          <thead><tr><th>Banka</th><th>Taksit Kırılımları</th></tr></thead>
                          <tbody>
                            {kesintiOnizleme.map(k => (
                              <tr key={k.banka}>
                                <td><strong>{k.banka}</strong></td>
                                <td>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {Object.entries(k.taksitler).sort(([a], [b]) => Number(a) - Number(b)).map(([taksit, oran]) => (
                                      <span key={taksit} style={{ background: '#f0fafa', border: '1px solid #009999', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace', color: '#0f1f2e', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                        {taksit}T: %{oran}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button className="ap-btn-primary" onClick={kesintiKaydet} disabled={yukleniyor}>
                        <i className="fas fa-save" />
                        {yukleniyor ? 'Kaydediliyor...' : `${kesintiOnizleme.length} Bankayı Firebase'e Kaydet`}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="ap-panel ap-panel--teal-soft">
                <div className="ap-panel-header"><i className="fas fa-info-circle" /><h3>Beklenen Format</h3></div>
                <div className="ap-panel-body">
                  <div className="ap-format-preview">
                    <div className="ap-format-header"><span>Banka Adı</span><span>Taksit Sayısı</span><span>Komisyon Oranı (%)</span></div>
                    <div className="ap-format-row"><span>Ziraat</span><span>1</span><span>1.2</span></div>
                    <div className="ap-format-row"><span>Ziraat</span><span>3</span><span>2.1</span></div>
                    <div className="ap-format-row"><span>Ziraat</span><span>6</span><span>3.4</span></div>
                    <div className="ap-format-row"><span>Garanti</span><span>1</span><span>1.5</span></div>
                    <div className="ap-format-row"><span>Garanti</span><span>6</span><span>3.8</span></div>
                  </div>
                  <ul className="ap-tips">
                    <li><i className="fas fa-check" /> Başlıklar birebir: <strong>Banka Adı | Taksit Sayısı | Komisyon Oranı (%)</strong></li>
                    <li><i className="fas fa-check" /> Her satır bir banka + taksit kombinasyonu</li>
                    <li><i className="fas fa-check" /> Komisyon ondalık destekler (örn: 2.5, 3.75)</li>
                    <li><i className="fas fa-check" /> Aynı banka + taksit kombinasyonu tekrar edemez</li>
                    <li><i className="fas fa-check" /> Yükleme sonrası eski tüm oranlar silinir, yenileri yazılır</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ══ 3) SATICI EKLE ══ */}
          {aktifModul === 'satici-ekle' && (
            <div className="ap-two-col">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="ap-panel">
                  <div className="ap-panel-header"><i className="fas fa-user-plus" /><h3>Yeni Satıcı Ekle</h3></div>
                  <div className="ap-panel-body">
                    <div className="ap-two-field">
                      <div className="ap-field"><label>Ad *</label><input type="text" placeholder="Ahmet" value={yeniSatici.ad} onChange={e => setYeniSatici(p => ({ ...p, ad: e.target.value }))} /></div>
                      <div className="ap-field"><label>Soyad</label><input type="text" placeholder="Yılmaz" value={yeniSatici.soyad} onChange={e => setYeniSatici(p => ({ ...p, soyad: e.target.value }))} /></div>
                    </div>
                    <div className="ap-field"><label>E-posta *</label><input type="email" placeholder="ahmet@tufekci.com" value={yeniSatici.email} onChange={e => setYeniSatici(p => ({ ...p, email: e.target.value }))} /></div>
                    <div className="ap-field">
                      <label>Şifre * (min. 6 karakter)</label>
                      <div style={{ position: 'relative' }}>
                        <input type={sifreGoster ? 'text' : 'password'} placeholder="••••••••" value={yeniSatici.sifre} onChange={e => setYeniSatici(p => ({ ...p, sifre: e.target.value }))} style={{ paddingRight: 44 }} />
                        <button type="button" onClick={() => setSifreGoster(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14 }}>
                          <i className={`fas ${sifreGoster ? 'fa-eye-slash' : 'fa-eye'}`} />
                        </button>
                      </div>
                      {yeniSatici.sifre && yeniSatici.sifre.length < 6 && <small style={{ color: '#ef4444' }}>⚠️ Şifre en az 6 karakter olmalı</small>}
                      {yeniSatici.sifre && yeniSatici.sifre.length >= 6 && <small style={{ color: '#16a34a' }}>✅ Şifre geçerli</small>}
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
                      <li><i className="fas fa-check" /> Satıcı Firebase Auth + Firestore'a kaydedilir</li>
                      <li><i className="fas fa-check" /> Hedefler aylık bazda "Satıcı Hedef" modülünden girilir</li>
                      <li><i className="fas fa-check" /> Her ay başında yeni hedef girilmezse önceki ay devam eder</li>
                      <li><i className="fas fa-check" /> Satıcı yalnızca kendi şubesini görebilir</li>
                    </ul>
                  </div>
                </div>
              </div>
              <div className="ap-panel">
                <div className="ap-panel-header">
                  <i className="fas fa-users" /><h3>Kayıtlı Satıcılar</h3>
                  <div className="ap-panel-actions">
                    <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '4px 10px', borderRadius: 20 }}>{tumSaticilar.length} satıcı</span>
                    <button className="ap-btn-secondary" onClick={tumSaticilarGetir} disabled={yukleniyor}><i className="fas fa-sync" /> Yenile</button>
                  </div>
                </div>
                <div className="ap-panel-body">
                  {!tumSaticilarYuklendi ? (
                    <div className="ap-empty"><i className="fas fa-spinner fa-spin" style={{ fontSize: 24, color: '#009999' }} /><p>Yükleniyor...</p></div>
                  ) : tumSaticilar.length === 0 ? (
                    <div className="ap-empty"><i className="fas fa-users" style={{ fontSize: 32, color: '#d1d5db' }} /><p>Henüz satıcı eklenmemiş</p></div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {tumSaticilar.map(s => (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: s.aktif === false ? '#fef2f2' : '#f8fafc', border: `1px solid ${s.aktif === false ? '#fecaca' : '#e2e8f0'}`, borderRadius: 10, padding: '10px 14px', opacity: s.aktif === false ? 0.75 : 1 }}>
                          <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: subeRenk(s.subeKodu), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                            {s.ad?.charAt(0)}{s.soyad?.charAt(0)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{s.ad} {s.soyad}</div>
                            <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.email}</div>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: subeRenk(s.subeKodu) + '20', color: subeRenk(s.subeKodu), whiteSpace: 'nowrap' }}>
                            {getSubeByKod(s.subeKodu as SubeKodu)?.ad || s.subeKodu}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: s.aktif === false ? '#fee2e2' : '#dcfce7', color: s.aktif === false ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' }}>
                            {s.aktif === false ? '⛔ Deaktif' : '✅ Aktif'}
                          </span>
                          {saticiSilOnay === s.id ? (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => saticiSilFirestore(s.id!)} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Evet, Deaktif Et</button>
                              <button onClick={() => setSaticiSilOnay(null)} style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>İptal</button>
                            </div>
                          ) : (
                            <button onClick={() => setSaticiSilOnay(s.id!)} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: '#9ca3af', fontSize: 12 }} title="Deaktif Et">
                              <i className="fas fa-ban" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
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
                  <i className="fas fa-bullseye" /><h3>Satıcı Aylık Hedef</h3>
                  <div className="ap-panel-actions">
                    <AySecici value={hedefAy} onChange={(v: string) => { setHedefAy(v); setHedefYuklendi(false); setHedefSaticilar([]); }} label="Ay:" />
                    <select value={hedefSube} onChange={e => { setHedefSube(e.target.value); setHedefYuklendi(false); setHedefSaticilar([]); }}>
                      {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
                    </select>
                    <button className="ap-btn-secondary" onClick={hedefSaticiGetir} disabled={yukleniyor}>
                      <i className="fas fa-search" /> {yukleniyor ? 'Yükleniyor...' : 'Getir'}
                    </button>
                  </div>
                </div>
                <div style={{ padding: '10px 20px', background: hedefAy === buAy ? '#f0fdf4' : '#fffbeb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{hedefAy === buAy ? '📅' : '📆'}</span>
                  <span style={{ fontSize: 12, color: hedefAy === buAy ? '#16a34a' : '#b45309', fontWeight: 600 }}>
                    {hedefAy === buAy ? `Bu ay (${hedefAy}) için hedef giriyorsunuz — mevcut dönem` : `${hedefAy} için hedef giriyorsunuz — geçmiş/gelecek ay`}
                  </span>
                </div>
                <div className="ap-panel-body">
                  {!hedefYuklendi
                    ? <div className="ap-empty"><i className="fas fa-bullseye" /><p>Şube ve ay seçip "Getir" butonuna basın</p></div>
                    : hedefSaticilar.length === 0
                    ? <div className="ap-empty"><p>Bu şubede satıcı bulunamadı</p></div>
                    : <div className="ap-hedef-list">
                        {hedefSaticilar.map((s, i) => {
                          const mevcutHedef = getSaticiHedef(s);
                          return (
                            <div key={s.id} className="ap-hedef-row">
                              <div className="ap-avatar sm">{s.ad?.charAt(0)}{s.soyad?.charAt(0)}</div>
                              <div className="ap-user-details" style={{ flex: 1 }}>
                                <div className="ap-user-full-name">{s.ad} {s.soyad}</div>
                                <div className="ap-user-email">{s.email}</div>
                              </div>
                              {mevcutHedef > 0 && (
                                <span style={{ fontSize: 11, color: '#009999', fontWeight: 700, fontFamily: 'monospace', background: '#f0fafa', padding: '3px 8px', borderRadius: 8, whiteSpace: 'nowrap' }}>
                                  Mevcut: ₺{mevcutHedef.toLocaleString('tr-TR')}
                                </span>
                              )}
                              <div className="ap-currency-wrap">
                                <span className="ap-currency-symbol">₺</span>
                                <input type="number" min="0" step="1000" placeholder="Aylık Hedef" defaultValue={mevcutHedef || ''} key={`${s.id}-${hedefAy}`}
                                  onBlur={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setHedefSaticilar(prev => prev.map((x, j) => j === i ? { ...x, hedefler: { ...x.hedefler, [hedefAy]: val } } : x));
                                  }}
                                />
                              </div>
                              <button className="ap-btn-save" onClick={() => saticiHedefKaydet(s, getSaticiHedef(s))}>
                                <i className="fas fa-save" /> Kaydet
                              </button>
                            </div>
                          );
                        })}
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
                    <AySecici value={magazaAy} onChange={(v: string) => setMagazaAy(v)} label="Ay:" />
                    {!magazaHedefYuklendi
                      ? <button className="ap-btn-secondary" onClick={magazaHedefGetir} disabled={yukleniyor}><i className="fas fa-download" /> {yukleniyor ? 'Yükleniyor...' : 'Hedefleri Getir'}</button>
                      : <button className="ap-btn-primary" onClick={tumMagazaHedefKaydet} disabled={yukleniyor}><i className="fas fa-save" /> {yukleniyor ? 'Kaydediliyor...' : 'Tümünü Kaydet'}</button>
                    }
                  </div>
                </div>
                <div style={{ padding: '10px 20px', background: magazaAy === buAy ? '#f0fdf4' : '#fffbeb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{magazaAy === buAy ? '📅' : '📆'}</span>
                  <span style={{ fontSize: 12, color: magazaAy === buAy ? '#16a34a' : '#b45309', fontWeight: 600 }}>
                    {magazaAy === buAy ? `Bu ay (${magazaAy}) için hedef giriyorsunuz — mevcut dönem` : `${magazaAy} için hedef giriyorsunuz — geçmiş/gelecek ay`}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>
                    Firestore: <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 4 }}>magazaHedefler/{'{SUBE}'}-{magazaAy}</code>
                  </span>
                </div>
                <div className="ap-panel-body">
                  {!magazaHedefYuklendi
                    ? <div className="ap-empty"><i className="fas fa-store" /><p>"Hedefleri Getir" butonuna basın</p></div>
                    : <div className="ap-hedef-list">
                        {SUBELER.map(sube => (
                          <div key={sube.kod} className="ap-hedef-row">
                            <div style={{ width: 4, height: 40, borderRadius: 3, background: subeRenk(sube.kod), flexShrink: 0 }} />
                            <div className="ap-store-icon-wrap"><i className="fas fa-store" /></div>
                            <div className="ap-user-details" style={{ flex: 1 }}>
                              <div className="ap-user-full-name">{sube.ad}</div>
                              <div className="ap-user-email" style={{ fontFamily: 'monospace' }}>{magazaDocId(sube.kod, magazaAy)}</div>
                            </div>
                            {magazaHedefler[sube.kod] > 0 && (
                              <span style={{ fontSize: 11, color: '#009999', fontWeight: 700, fontFamily: 'monospace', background: '#f0fafa', padding: '3px 8px', borderRadius: 8, whiteSpace: 'nowrap' }}>
                                Mevcut: ₺{magazaHedefler[sube.kod].toLocaleString('tr-TR')}
                              </span>
                            )}
                            <div className="ap-currency-wrap">
                              <span className="ap-currency-symbol">₺</span>
                              <input type="number" min="0" step="10000" placeholder="Aylık Hedef" value={magazaHedefler[sube.kod] || ''} onChange={e => setMagazaHedefler(prev => ({ ...prev, [sube.kod]: parseFloat(e.target.value) || 0 }))} />
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
                  <div className="ap-field"><label>Kampanya Adı *</label><input type="text" placeholder="Yaz Kampanyası 2025" value={yeniKampanya.ad} onChange={e => setYeniKampanya(p => ({ ...p, ad: e.target.value }))} /></div>
                  <div className="ap-field">
                    <label>Şube</label>
                    <select value={kampanyaSube} onChange={e => setKampanyaSube(e.target.value)}>
                      <option value="GENEL">Genel (Tüm Şubeler)</option>
                      {SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}
                    </select>
                  </div>
                  <div className="ap-field"><label>Açıklama</label><input type="text" placeholder="Kampanya açıklaması..." value={yeniKampanya.aciklama} onChange={e => setYeniKampanya(p => ({ ...p, aciklama: e.target.value }))} /></div>
                  <div className="ap-field">
                    <label>Kampanya Tutarı (TL) *</label>
                    <input type="number" min="0" placeholder="Örn: 3900" value={yeniKampanya.tutar || ''} onChange={e => setYeniKampanya(p => ({ ...p, tutar: parseFloat(e.target.value) || 0 }))} />
                    <small style={{ color: '#6b7280', marginTop: 4, display: 'block' }}>Bu tutar toplam maliyetten düşülür</small>
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
                    <button className="ap-btn-secondary" onClick={kampanyaGetir} disabled={yukleniyor}><i className="fas fa-sync" /> Yükle</button>
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
                              {k.tutar && k.tutar > 0 && <div className="ap-kampanya-desc" style={{ color: '#15803d', fontWeight: 600 }}>İndirim: ₺{k.tutar.toLocaleString('tr-TR')}</div>}
                            </div>
                            <span className={`ap-pill ${k.aktif ? 'green' : 'gray'}`}>{k.aktif ? 'Aktif' : 'Pasif'}</span>
                            <button className={`ap-toggle-btn sm ${k.aktif ? 'off' : 'on'}`} onClick={() => kampanyaToggle(k)}>{k.aktif ? 'Durdur' : 'Aktif Et'}</button>
                            <button className="ap-delete-btn" onClick={() => kampanyaSil(k.id!)}><i className="fas fa-trash" /></button>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="ap-panel">
                  <div className="ap-panel-header"><i className="fas fa-file-excel" /><h3>Excel ile Toplu Yükle</h3></div>
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
                        <input ref={yesilEtiketFileRef} type="file" accept=".xlsx,.xls" onChange={handleYesilEtiketExcel} />
                      </div>
                    </div>
                    {yesilEtiketOnizlemde && yesilEtiketOnizleme.length > 0 && (
                      <>
                        <div className="ap-table-label"><i className="fas fa-eye" /> Önizleme — {yesilEtiketOnizleme.length} ürün bulundu</div>
                        <div className="ap-table-scroll">
                          <table className="ap-table">
                            <thead><tr><th>Ürün Kodu</th><th>Yeşil Etiket Fiyatı (TL)</th><th>Açıklama</th></tr></thead>
                            <tbody>
                              {yesilEtiketOnizleme.map((e, i) => (
                                <tr key={i}>
                                  <td><strong>{e.urunKodu}</strong></td>
                                  <td style={{ color: '#16a34a', fontWeight: 600 }}>₺{e.maliyet.toLocaleString('tr-TR')}</td>
                                  <td>{e.aciklama || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <button className="ap-btn-primary" onClick={yesilEtiketExcelKaydet} disabled={yukleniyor}>
                          <i className="fas fa-save" /> {yukleniyor ? (ilerleme || 'Kaydediliyor...') : `${yesilEtiketOnizleme.length} Yeşil Etiketi Kaydet`}
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
                          <li><i className="fas fa-check" /> YEŞİL ETİKET = satış fiyatı (TL)</li>
                          <li><i className="fas fa-check" /> Aynı ürün kodu varsa güncellenir, yoksa yeni eklenir</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="ap-panel">
                  <div className="ap-panel-header"><i className="fas fa-plus-circle" /><h3>Manuel Ekle / Güncelle</h3></div>
                  <div className="ap-panel-body">
                    <div className="ap-two-field">
                      <div className="ap-field"><label>Ürün Kodu *</label><input type="text" placeholder="WS75-0CA15-0AG5" value={yeniYesilEtiket.urunKodu} onChange={e => setYeniYesilEtiket(p => ({ ...p, urunKodu: e.target.value }))} /></div>
                      <div className="ap-field"><label>Yeşil Etiket Fiyatı (TL) *</label><input type="number" min="0" placeholder="1500" value={yeniYesilEtiket.maliyet || ''} onChange={e => setYeniYesilEtiket(p => ({ ...p, maliyet: parseFloat(e.target.value) || 0 }))} /></div>
                    </div>
                    <div className="ap-field"><label>Açıklama</label><input type="text" placeholder="Eski model, demo ürün vb." value={yeniYesilEtiket.aciklama || ''} onChange={e => setYeniYesilEtiket(p => ({ ...p, aciklama: e.target.value }))} /></div>
                    <button className="ap-btn-primary" onClick={yesilEtiketManuelEkle} disabled={yukleniyor}>
                      <i className="fas fa-plus" /> {yukleniyor ? 'Kaydediliyor...' : 'Kaydet / Güncelle'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="ap-panel">
                <div className="ap-panel-header">
                  <i className="fas fa-list" /><h3>Mevcut Yeşil Etiketler</h3>
                  <div className="ap-panel-actions">
                    <button className="ap-btn-secondary" onClick={yesilEtiketListeGetir} disabled={yukleniyor}>
                      <i className="fas fa-sync" /> {yukleniyor ? 'Yükleniyor...' : 'Yükle'}
                    </button>
                  </div>
                </div>
                <div className="ap-panel-body">
                  {!yesilEtiketYuklendi
                    ? <div className="ap-empty"><i className="fas fa-tag" style={{ color: '#16a34a', fontSize: 32, marginBottom: 8 }} /><p>"Yükle" butonuna basın</p></div>
                    : yesilEtiketler.length === 0
                    ? <div className="ap-empty"><p>Yeşil etiket bulunamadı</p></div>
                    : <div className="ap-kampanya-list">
                        {yesilEtiketler.map(e => (
                          <div key={e.id} className="ap-kampanya-item">
                            <div style={{ flex: 1 }}>
                              <div className="ap-kampanya-name" style={{ color: '#16a34a' }}>🟢 {e.urunKodu}</div>
                              {e.aciklama && <div className="ap-kampanya-desc">{e.aciklama}</div>}
                            </div>
                            <span className="ap-pill green">₺{(e.maliyet || 0).toLocaleString('tr-TR')}</span>
                            <button className="ap-delete-btn" onClick={() => yesilEtiketSilFn(e.id!)}><i className="fas fa-trash" /></button>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              </div>
            </div>
          )}

          {/* ══ 9) EMAIL GÜNCELLE ══ */}
          {aktifModul === 'email-guncelle' && (
            <div className="ap-two-col">
              <div className="ap-panel">
                <div className="ap-panel-header"><i className="fas fa-envelope" /><h3>Kullanıcı Email Güncelle</h3></div>
                <div className="ap-panel-body">

                  {/* Uyarı banner */}
                  <div className="ap-info-banner" style={{ background: '#fffbeb', borderColor: '#fbbf24' }}>
                    <i className="fas fa-exclamation-triangle" style={{ color: '#d97706' }} />
                    <span style={{ color: '#92400e' }}>
                      Bu işlem kullanıcının Firebase Auth hesabını yeniden oluşturur.
                      <strong> Kullanıcı bir sonraki girişinde yeni email ve yeni şifreyi kullanmalıdır.</strong>
                    </span>
                  </div>

                  {!emailGuncelleSatici ? (
                    <>
                      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                        Email'ini güncellemek istediğiniz kullanıcıyı sağdan seçin.
                      </p>
                    </>
                  ) : (
                    <>
                      {/* Seçili kullanıcı kartı */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f0fafa', border: '2px solid #009999', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                        <div style={{ width: 40, height: 40, borderRadius: '50%', background: subeRenk(emailGuncelleSatici.subeKodu), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700 }}>
                          {emailGuncelleSatici.ad?.charAt(0)}{emailGuncelleSatici.soyad?.charAt(0)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, color: '#0f1f2e' }}>{emailGuncelleSatici.ad} {emailGuncelleSatici.soyad}</div>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>Mevcut email: <strong>{emailGuncelleSatici.email}</strong></div>
                        </div>
                        <button onClick={() => { setEmailGuncelleSatici(null); setYeniEmail(''); setYeniSifre(''); }} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: '#6b7280', fontSize: 12 }}>
                          <i className="fas fa-times" /> Değiştir
                        </button>
                      </div>

                      <div className="ap-field">
                        <label>Yeni E-posta *</label>
                        <input
                          type="email"
                          placeholder="yenimail@example.com"
                          value={yeniEmail}
                          onChange={e => setYeniEmail(e.target.value.trim())}
                        />
                        {yeniEmail && !yeniEmail.includes('@') && <small style={{ color: '#ef4444' }}>⚠️ Geçerli bir email girin</small>}
                        {yeniEmail && yeniEmail.includes('@') && <small style={{ color: '#16a34a' }}>✅ Email geçerli</small>}
                      </div>

                      <div className="ap-field">
                        <label>Yeni Şifre * (min. 6 karakter)</label>
                        <div style={{ position: 'relative' }}>
                          <input
                            type={emailSifreGoster ? 'text' : 'password'}
                            placeholder="••••••••"
                            value={yeniSifre}
                            onChange={e => setYeniSifre(e.target.value)}
                            style={{ paddingRight: 44 }}
                          />
                          <button type="button" onClick={() => setEmailSifreGoster(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14 }}>
                            <i className={`fas ${emailSifreGoster ? 'fa-eye-slash' : 'fa-eye'}`} />
                          </button>
                        </div>
                        {yeniSifre && yeniSifre.length < 6 && <small style={{ color: '#ef4444' }}>⚠️ Şifre en az 6 karakter olmalı</small>}
                        {yeniSifre && yeniSifre.length >= 6 && <small style={{ color: '#16a34a' }}>✅ Şifre geçerli</small>}
                      </div>

                      <button className="ap-btn-primary" onClick={emailGuncelle} disabled={yukleniyor || !yeniEmail.includes('@') || yeniSifre.length < 6}>
                        <i className="fas fa-save" />
                        {yukleniyor ? 'Güncelleniyor...' : 'Email & Şifreyi Güncelle'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Sağ: Kullanıcı listesi */}
              <div className="ap-panel">
                <div className="ap-panel-header">
                  <i className="fas fa-users" /><h3>Kullanıcılar</h3>
                  <div className="ap-panel-actions">
                    <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '4px 10px', borderRadius: 20 }}>{emailSaticilar.length} kullanıcı</span>
                    <button className="ap-btn-secondary" onClick={emailSaticilarGetir} disabled={yukleniyor}><i className="fas fa-sync" /> Yenile</button>
                  </div>
                </div>
                <div className="ap-panel-body">
                  {!emailSaticiYuklendi ? (
                    <div className="ap-empty"><i className="fas fa-spinner fa-spin" style={{ fontSize: 24, color: '#009999' }} /><p>Yükleniyor...</p></div>
                  ) : emailSaticilar.length === 0 ? (
                    <div className="ap-empty"><p>Kullanıcı bulunamadı</p></div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {emailSaticilar.map(s => (
                        <div key={s.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          background: emailGuncelleSatici?.id === s.id ? '#f0fafa' : '#f8fafc',
                          border: `1px solid ${emailGuncelleSatici?.id === s.id ? '#009999' : '#e2e8f0'}`,
                          borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                          onClick={() => { setEmailGuncelleSatici(s); setYeniEmail(''); setYeniSifre(''); }}
                        >
                          <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: subeRenk(s.subeKodu), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>
                            {s.ad?.charAt(0)}{s.soyad?.charAt(0)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{s.ad} {s.soyad}</div>
                            <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.email}</div>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: subeRenk(s.subeKodu) + '20', color: subeRenk(s.subeKodu), whiteSpace: 'nowrap' }}>
                            {getSubeByKod(s.subeKodu as SubeKodu)?.ad || s.subeKodu}
                          </span>
                          {emailGuncelleSatici?.id === s.id && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: '#f0fafa', color: '#009999', whiteSpace: 'nowrap' }}>
                              ✓ Seçili
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
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