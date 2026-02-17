import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SubeKodu } from '../types/sube';

interface SonSatis {
  satisKodu: string;
  subeKodu: SubeKodu;
}

// Son satış kodunu bul
export const getSonSatisKodu = async (subeKodu: SubeKodu, subeDbPath: string): Promise<string | null> => {
  try {
    const satisRef = collection(db, `subeler/${subeDbPath}/satislar`);
    const q = query(satisRef, orderBy('satisKodu', 'desc'), limit(1));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return null;
    }
    
    return snapshot.docs[0].data().satisKodu;
  } catch (error) {
    console.error('Son satış kodu alınamadı:', error);
    return null;
  }
};

// Sıradaki satış kodunu oluştur
export const getSiraNumarasi = (sonKod: string | null, subePrefix: string): string => {
  if (!sonKod) {
    return `${subePrefix}-001`;
  }
  
  // Son koddaki sayıyı bul (örnek: 1010-045 -> 45)
  const parts = sonKod.split('-');
  if (parts.length !== 2) {
    return `${subePrefix}-001`;
  }
  
  const sonSayi = parseInt(parts[1], 10);
  if (isNaN(sonSayi)) {
    return `${subePrefix}-001`;
  }
  
  // Yeni sayı = son sayı + 1
  const yeniSayi = sonSayi + 1;
  
  // 3 haneli formata çevir (001, 002, ..., 999)
  return `${subePrefix}-${yeniSayi.toString().padStart(3, '0')}`;
};

// Yeni satış kodu oluştur
export const yeniSatisKoduOlustur = async (subeKodu: SubeKodu, subeDbPath: string, subePrefix: string): Promise<string> => {
  const sonKod = await getSonSatisKodu(subeKodu, subeDbPath);
  return getSiraNumarasi(sonKod, subePrefix);
};