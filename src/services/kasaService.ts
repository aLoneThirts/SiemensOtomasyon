import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, where, orderBy, getDoc, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { KasaGun, KasaHareket, KasaHareketTipi } from '../types/kasa';

// Mükerrer oluşturma engellemek için kilit
let kasaGunOlusturuluyor = false;

// Bugünün tarihini YYYY-MM-DD formatında al (lokal saat - UTC değil!)
export const getBugununTarihi = (): string => {
  const date = new Date();
  const yil = date.getFullYear();
  const ay  = String(date.getMonth() + 1).padStart(2, '0');
  const gun = String(date.getDate()).padStart(2, '0');
  return yil + '-' + ay + '-' + gun;
};

// Belirli bir gün için TEK kayıt bırak, mükerrerlerini sil
const tekKayitBirak = async (subeKodu: string, gunStr: string): Promise<KasaGun | null> => {
  const kasaRef = collection(db, `subeler/${subeKodu}/kasa`);
  const q = query(kasaRef, where('gun', '==', gunStr));
  const snap = await getDocs(q);
  if (snap.empty) return null;

  if (snap.docs.length > 1) {
    // En fazla hareketi olan kaydı koru, diğerlerini sil
    const sorted = snap.docs
      .map(d => ({ id: d.id, data: d.data() as KasaGun }))
      .sort((a, b) => ((b.data.hareketler?.length ?? 0) - (a.data.hareketler?.length ?? 0)));

    for (let i = 1; i < sorted.length; i++) {
      await deleteDoc(doc(db, `subeler/${subeKodu}/kasa/${sorted[i].id}`));
      console.log(`🗑️ Mükerrer silindi: ${gunStr} - ${sorted[i].id}`);
    }
    return { id: sorted[0].id, ...sorted[0].data };
  }

  return { id: snap.docs[0].id, ...snap.docs[0].data() } as KasaGun;
};

// Bugünün kasa gününü getir veya yoksa oluştur
export const getBugununKasaGunu = async (subeKodu: string, kullanici: string): Promise<KasaGun | null> => {
  try {
    const bugun = getBugununTarihi();
    const kasaRef = collection(db, `subeler/${subeKodu}/kasa`);

    // 1) Bugüne ait kasa günü var mı? Mükerrer varsa temizle
    const bugunKayit = await tekKayitBirak(subeKodu, bugun);
    if (bugunKayit) {
      return bugunKayit;
    }

    // 2) Kilit - StrictMode çift çağrımını engelle
    if (kasaGunOlusturuluyor) {
      console.log('⏳ Bekleniyor...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const tekrar = await tekKayitBirak(subeKodu, bugun);
      if (tekrar) return tekrar;
    }

    kasaGunOlusturuluyor = true;

    // 3) Son kapatılan günün bakiyesini al (en son tarihli KAPALI kayıt)
    const kapaliQ = query(
      kasaRef,
      where('durum', '==', 'KAPALI'),
      orderBy('gun', 'desc'),
      limit(10)
    );
    const kapaliSnap = await getDocs(kapaliQ);

    let acilisBakiyesi = 0;

    if (!kapaliSnap.empty) {
      // Bugünden önceki en son kapalı günü bul
      const oncekiGunler = kapaliSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as KasaGun))
        .filter(g => g.gun < bugun)
        .sort((a, b) => b.gun.localeCompare(a.gun)); // en yeni önce

      if (oncekiGunler.length > 0) {
        // Aynı gün için mükerrer varsa en yüksek bakiyeli değil,
        // en fazla hareketi olan kaydın gün sonunu al
        const sonGunStr = oncekiGunler[0].gun;
        const sonGunKayit = await tekKayitBirak(subeKodu, sonGunStr);
        acilisBakiyesi = sonGunKayit?.gunSonuBakiyesi ?? 0;
        console.log(`💰 Devir: ${sonGunStr} gün sonu ${acilisBakiyesi} TL → bugün açılış`);
      }
    } else {
      // KAPALI gün yok, açık geçmiş günlere bak
      const acikQ = query(kasaRef, where('durum', '==', 'ACIK'));
      const acikSnap = await getDocs(acikQ);
      const acikGunler = acikSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as KasaGun))
        .filter(g => g.gun < bugun)
        .sort((a, b) => b.gun.localeCompare(a.gun));

      if (acikGunler.length > 0) {
        const sonGunStr = acikGunler[0].gun;
        const sonGunKayit = await tekKayitBirak(subeKodu, sonGunStr);
        acilisBakiyesi = sonGunKayit?.gunSonuBakiyesi ?? 0;

        // Açık kalan geçmiş günleri kapat
        for (const g of acikGunler) {
          await updateDoc(doc(db, `subeler/${subeKodu}/kasa/${g.id}`), {
            durum: 'KAPALI',
            kapanisTarihi: new Date(),
          });
        }
      }
    }

    // 4) Bugün için yeni gün oluştur
    const yeniGun: Omit<KasaGun, 'id'> = {
      gun: bugun,
      subeKodu,
      acilisTarihi: new Date(),
      acilisBakiyesi,
      hareketler: [],
      durum: 'ACIK',
      toplamGelir: 0,
      toplamGider: 0,
      marketHarcamalari: 0,
      digerGiderler: 0,
      nakitSatis: 0,
      kartSatis: 0,
      havaleSatis: 0,
      cikisYapilanPara: 0,
      gunSonuBakiyesi: acilisBakiyesi,
    };

    const docRef = await addDoc(kasaRef, yeniGun);
    console.log(`✅ Yeni kasa günü: ${bugun}, Açılış: ${acilisBakiyesi} TL`);
    kasaGunOlusturuluyor = false;
    return { id: docRef.id, ...yeniGun };

  } catch (error) {
    kasaGunOlusturuluyor = false;
    console.error('Kasa günü alınamadı:', error);
    return null;
  }
};

// Kasa hareketi ekle
export const kasaHareketEkle = async (
  subeKodu: string,
  kasaGunId: string,
  hareket: Omit<KasaHareket, 'id' | 'saat'>,
  kullanici: string,
  kullaniciId: string
): Promise<boolean> => {
  try {
    const kasaGunRef = doc(db, `subeler/${subeKodu}/kasa/${kasaGunId}`);
    const kasaGunDoc = await getDoc(kasaGunRef);

    if (!kasaGunDoc.exists()) {
      console.error('Kasa günü bulunamadı');
      return false;
    }

    const kasaGunData = kasaGunDoc.data() as KasaGun;

    const now = new Date();
    const saat = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const yeniHareket: KasaHareket = {
      ...hareket,
      id: Date.now().toString(),
      saat,
      kullanici,
      kullaniciId,
      subeKodu
    };

    const yeniHareketler = [...(kasaGunData.hareketler || []), yeniHareket];

    let toplamGelir       = kasaGunData.toplamGelir || 0;
    let toplamGider       = kasaGunData.toplamGider || 0;
    let marketHarcamalari = kasaGunData.marketHarcamalari || 0;
    let digerGiderler     = kasaGunData.digerGiderler || 0;
    let nakitSatis        = kasaGunData.nakitSatis || 0;
    let kartSatis         = kasaGunData.kartSatis || 0;
    let havaleSatis       = kasaGunData.havaleSatis || 0;
    let cikisYapilanPara  = kasaGunData.cikisYapilanPara || 0;

    const tutar = Math.abs(hareket.tutar);

    switch (hareket.tip) {
      case KasaHareketTipi.NAKIT_SATIS:
        nakitSatis  += tutar;
        toplamGelir += tutar;
        break;
      case KasaHareketTipi.KART:
        kartSatis += tutar;
        break;
      case KasaHareketTipi.HAVALE:
        havaleSatis += tutar;
        break;
      case KasaHareketTipi.GIDER:
        toplamGider += tutar;
        break;
      case KasaHareketTipi.CIKIS:
        cikisYapilanPara += tutar;
        toplamGider      += tutar;
        break;
      case KasaHareketTipi.DIGER:
        toplamGider   += tutar;
        digerGiderler += tutar;
        break;
    }

    const gunSonuBakiyesi = (kasaGunData.acilisBakiyesi || 0) + nakitSatis - toplamGider;

    await updateDoc(kasaGunRef, {
      hareketler: yeniHareketler,
      toplamGelir,
      toplamGider,
      marketHarcamalari,
      digerGiderler,
      nakitSatis,
      kartSatis,
      havaleSatis,
      cikisYapilanPara,
      gunSonuBakiyesi,
    });

    return true;
  } catch (error) {
    console.error('Kasa hareketi eklenemedi:', error);
    return false;
  }
};

// Geçmiş kasa günlerini getir
export const getKasaGecmisi = async (subeKodu: string, limitGun: number = 30): Promise<KasaGun[]> => {
  try {
    const kasaRef = collection(db, `subeler/${subeKodu}/kasa`);
    const q = query(kasaRef, orderBy('gun', 'desc'), limit(limitGun));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as KasaGun));
  } catch (error) {
    console.error('Kasa geçmişi alınamadı:', error);
    return [];
  }
};