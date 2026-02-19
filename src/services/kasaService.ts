import { collection, doc, getDocs, addDoc, updateDoc, query, where, orderBy, getDoc, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { KasaGun, KasaHareket, KasaHareketTipi, kasayaYansiyor } from '../types/kasa';

// Bugünün tarihini YYYY-MM-DD formatında al
export const getBugununTarihi = (): string => {
  const date = new Date();
  return date.toISOString().split('T')[0];
};

// Bugünün kasa gününü getir veya yoksa oluştur
export const getBugununKasaGunu = async (subeKodu: string, kullanici: string): Promise<KasaGun | null> => {
  try {
    const bugun = getBugununTarihi();
    const kasaRef = collection(db, `subeler/${subeKodu}/kasa`);

    // Bugüne ait kasa günü var mı?
    const q = query(kasaRef, where('gun', '==', bugun));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const docSnap = snapshot.docs[0];
      return { id: docSnap.id, ...docSnap.data() } as KasaGun;
    } else {
      // Dünün kasa gününü bul
      const dun = new Date();
      dun.setDate(dun.getDate() - 1);
      const dunStr = dun.toISOString().split('T')[0];

      const dunQ = query(kasaRef, where('gun', '==', dunStr));
      const dunSnapshot = await getDocs(dunQ);

      let acilisBakiyesi = 0;
      if (!dunSnapshot.empty) {
        const dunDoc = dunSnapshot.docs[0];
        const dunData = dunDoc.data() as KasaGun;
        // Dünün gün sonu → bugün açılış
        acilisBakiyesi = dunData.gunSonuBakiyesi || 0;

        await updateDoc(doc(db, `subeler/${subeKodu}/kasa/${dunDoc.id}`), {
          durum: 'KAPALI',
          kapanisTarihi: new Date()
        });
      }

      // Yeni gün oluştur
      const yeniGun: Omit<KasaGun, 'id'> = {
        gun: bugun,
        subeKodu,
        acilisTarihi: new Date(),
        acilisBakiyesi,
        hareketler: [],
        durum: 'ACIK',
        // Orijinal alanlar
        toplamGelir: 0,
        toplamGider: 0,
        marketHarcamalari: 0,
        digerGiderler: 0,
        // Yeni alanlar
        nakitSatis: 0,
        kartSatis: 0,
        havaleSatis: 0,
        cikisYapilanPara: 0,
        gunSonuBakiyesi: acilisBakiyesi,
      };

      const docRef = await addDoc(kasaRef, yeniGun);
      return { id: docRef.id, ...yeniGun };
    }
  } catch (error) {
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

    // Saat ekle
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

    // Mevcut toplamlar
    let toplamGelir        = kasaGunData.toplamGelir || 0;
    let toplamGider        = kasaGunData.toplamGider || 0;
    let marketHarcamalari  = kasaGunData.marketHarcamalari || 0;
    let digerGiderler      = kasaGunData.digerGiderler || 0;
    let nakitSatis         = kasaGunData.nakitSatis || 0;
    let kartSatis          = kasaGunData.kartSatis || 0;
    let havaleSatis        = kasaGunData.havaleSatis || 0;
    let cikisYapilanPara   = kasaGunData.cikisYapilanPara || 0;

    const tutar = Math.abs(hareket.tutar);

    switch (hareket.tip) {
      case KasaHareketTipi.NAKIT_SATIS:
        // Kasaya GİRER
        nakitSatis  += tutar;
        toplamGelir += tutar;
        break;

      case KasaHareketTipi.KART:
        // Kasaya YANSIMAZ - sadece kayıt
        kartSatis += tutar;
        break;

      case KasaHareketTipi.HAVALE:
        // Kasaya YANSIMAZ - sadece kayıt
        havaleSatis += tutar;
        break;

      case KasaHareketTipi.GIDER:
        toplamGider += tutar;
        break;

      case KasaHareketTipi.CIKIS:
        // ÇIKIŞ YAPILAN PARA - kasadan çıkar
        cikisYapilanPara += tutar;
        toplamGider      += tutar;
        break;

      case KasaHareketTipi.DIGER:
        toplamGider  += tutar;
        digerGiderler+= tutar;
        break;
    }

    // Gün sonu = Açılış + NakitSatış - Gider - Çıkış - Diğer
    // (toplamGider zaten Gider+Çıkış+Diğer içeriyor)
    const gunSonuBakiyesi =
      (kasaGunData.acilisBakiyesi || 0) + nakitSatis - toplamGider;

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

// Geçmiş kasa günlerini getir - orijinal ile aynı
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