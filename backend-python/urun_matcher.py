
import re
from difflib import SequenceMatcher
from typing import List, Dict, Any

class UrunMatcher:
    def __init__(self):
        self.urun_kodlari = []
        self.esleme_gecmisi = []
    
    def kod_benzerlik_orani(self, kod1: str, kod2: str) -> float:
        """İki ürün kodunun benzerlik oranını hesaplar (0-1 arası)"""
        return SequenceMatcher(None, kod1, kod2).ratio()
    
    def ayni_grubu_bul(self, urun_kodu: str, tum_kodlar: List[str]) -> List[str]:
        """Aynı grupdaki ürünleri bulur (S23 ile başlayanlar gibi)"""
        if len(urun_kodu) < 3:
            return []
        
        baslangic = urun_kodu[:3].upper()
        ayni_grup = []
        
        for kod in tum_kodlar:
            if kod.upper().startswith(baslangic):
                ayni_grup.append(kod)
        
        return ayni_grup
    
    def kod_analizi(self, urun_kodu: str) -> Dict[str, Any]:
        """Ürün kodunun detaylı analizini yapar"""
        if not urun_kodu:
            return {}
        
        urun_kodu = str(urun_kodu)
        
        analiz = {
            'orijinal_kod': urun_kodu,
            'uzunluk': len(urun_kodu),
            'buyuk_harf': urun_kodu.upper(),
            'kucuk_harf': urun_kodu.lower(),
            'baslangic': urun_kodu[:3] if len(urun_kodu) >= 3 else '',
            'bitis': urun_kodu[-3:] if len(urun_kodu) >= 3 else '',
            'sayisal_mi': urun_kodu.isnumeric(),
            'alfabetik_mi': urun_kodu.isalpha(),
            'alfanumerik': any(c.isalpha() for c in urun_kodu) and any(c.isdigit() for c in urun_kodu),
            'ozel_karakter_var_mi': any(not c.isalnum() for c in urun_kodu)
        }
        
        # Desen bulma (Örn: S23-001 -> harfler=S, sayilar=23, ek=-001)
        pattern = re.match(r'([A-Za-z]+)(\d+)(.*)', urun_kodu)
        if pattern:
            analiz['harfler'] = pattern.group(1)
            analiz['sayilar'] = pattern.group(2)
            analiz['ek'] = pattern.group(3)
        
        # Tire, slash gibi ayırıcıları bul
        ayiricilar = re.findall(r'[^A-Za-z0-9]', urun_kodu)
        if ayiricilar:
            analiz['ayiricilar'] = list(set(ayiricilar))
        
        return analiz
    
    def toplu_esleme(self, urun_kodlari: List[str]) -> Dict[str, List[str]]:
        """Tüm ürün kodlarını başlangıçlarına göre gruplar"""
        gruplar = {}
        
        for kod in urun_kodlari:
            if len(kod) >= 3:
                baslangic = kod[:3].upper()
                if baslangic not in gruplar:
                    gruplar[baslangic] = []
                gruplar[baslangic].append(kod)
        
        # Her grubu sırala
        for baslangic in gruplar:
            gruplar[baslangic] = sorted(gruplar[baslangic])
        
        return gruplar
    
    def eslesme_oner(self, urun_kodu: str, tum_kodlar: List[str], esik=0.7) -> List[Dict]:
        """Benzer ürün kodları için öneriler yapar"""
        oneriler = []
        
        for kod in tum_kodlar:
            if kod != urun_kodu:
                benzerlik = self.kod_benzerlik_orani(urun_kodu, kod)
                if benzerlik >= esik:
                    oneriler.append({
                        'kod': kod,
                        'benzerlik': round(benzerlik, 2)
                    })
        
        # Benzerlik oranına göre sırala
        oneriler.sort(key=lambda x: x['benzerlik'], reverse=True)
        return oneriler[:10]  # En iyi 10 öneri
    
    def esleme_yap(self, urun_kodu: str, fiyat: float, miktar: int) -> Dict[str, Any]:
        """Ürün koduna göre eşleme yapar ve kaydeder"""
        esleme = {
            'zaman': str(len(self.esleme_gecmisi) + 1),
            'urun_kodu': urun_kodu,
            'fiyat': fiyat,
            'miktar': miktar,
            'baslangic': urun_kodu[:3] if len(urun_kodu) >= 3 else '',
            'analiz': self.kod_analizi(urun_kodu)
        }
        
        self.esleme_gecmisi.append(esleme)
        return esleme
    
    def en_cok_eslesen_baslangiclar(self, limit=5) -> List[Dict]:
        """En çok eşleme yapılan başlangıçları listeler"""
        baslangic_sayilari = {}
        
        for esleme in self.esleme_gecmisi:
            baslangic = esleme['baslangic']
            if baslangic:
                baslangic_sayilari[baslangic] = baslangic_sayilari.get(baslangic, 0) + 1
        
        sonuc = [
            {'baslangic': b, 'sayi': s} 
            for b, s in baslangic_sayilari.items()
        ]
        sonuc.sort(key=lambda x: x['sayi'], reverse=True)
        
        return sonuc[:limit]