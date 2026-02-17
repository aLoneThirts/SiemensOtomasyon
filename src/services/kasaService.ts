import { collection, doc, getDocs, addDoc, updateDoc, query, where, orderBy, getDoc, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { KasaGun, KasaHareket, KasaHareketTipi } from '../types/kasa';

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
      // Var olanı döndür
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() } as KasaGun;
    } else {
      // Dünün kasa gününü bul (varsa)
      const dun = new Date();
      dun.setDate(dun.getDate() - 1);
      const dunStr = dun.toISOString().split('T')[0];
      
      const dunQ = query(kasaRef, where('gun', '==', dunStr));
      const dunSnapshot = await getDocs(dunQ);
      
      let acilisBakiyesi = 0;
      if (!dunSnapshot.empty) {
        const dunDoc = dunSnapshot.docs[0];
        const dunData = dunDoc.data() as KasaGun;
        acilisBakiyesi = dunData.gunSonuBakiyesi || 0;
        
        // Dünün gününü kapat
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
        toplamGelir: 0,
        toplamGider: 0,
        marketHarcamalari: 0,
        digerGiderler: 0
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
    console.log('Hareket ekleniyor:', { subeKodu, kasaGunId, hareket });
    
    const kasaGunRef = doc(db, `subeler/${subeKodu}/kasa/${kasaGunId}`);
    const kasaGunDoc = await getDoc(kasaGunRef);
    
    if (!kasaGunDoc.exists()) {
      console.error('Kasa günü bulunamadı');
      return false;
    }
    
    const kasaGunData = kasaGunDoc.data() as KasaGun;
    
    // Saati ekle
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
    
    // Yeni hareketleri ekle
    const yeniHareketler = [...(kasaGunData.hareketler || []), yeniHareket];
    
    // Toplamları güncelle
    let toplamGelir = kasaGunData.toplamGelir || 0;
    let toplamGider = kasaGunData.toplamGider || 0;
    let marketHarcamalari = kasaGunData.marketHarcamalari || 0;
    let digerGiderler = kasaGunData.digerGiderler || 0;
    
    if (hareket.tip === KasaHareketTipi.GELIR) {
      toplamGelir += Math.abs(hareket.tutar);
    } else if (hareket.tip === KasaHareketTipi.MARKET) {
      toplamGider += Math.abs(hareket.tutar);
      marketHarcamalari += Math.abs(hareket.tutar);
    } else {
      toplamGider += Math.abs(hareket.tutar);
      if (hareket.tip === KasaHareketTipi.DIGER) {
        digerGiderler += Math.abs(hareket.tutar);
      }
    }
    
    const gunSonuBakiyesi = (kasaGunData.acilisBakiyesi || 0) + toplamGelir - toplamGider;
    
    await updateDoc(kasaGunRef, {
      hareketler: yeniHareketler,
      toplamGelir,
      toplamGider,
      marketHarcamalari,
      digerGiderler,
      gunSonuBakiyesi
    });
    
    console.log('Hareket başarıyla eklendi');
    return true;
  } catch (error) {
    console.error('Kasa hareketi eklenemedi:', error);
    return false;
  }
};

// Geçmiş kasa günlerini getir - TEK FONKSİYON
export const getKasaGecmisi = async (subeKodu: string, limitGun: number = 30): Promise<KasaGun[]> => {
  try {
    const kasaRef = collection(db, `subeler/${subeKodu}/kasa`);
    const q = query(kasaRef, orderBy('gun', 'desc'), limit(limitGun));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KasaGun));
  } catch (error) {
    console.error('Kasa geçmişi alınamadı:', error);
    return [];
  }
};