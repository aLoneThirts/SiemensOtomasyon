import pandas as pd
import os
import re
from typing import Dict, List, Any

class ExcelProfessor:
    def __init__(self, dosya_yolu: str):
        self.dosya_yolu = dosya_yolu
        self.df = self._excel_oku()
        self._normalize_columns()
        
    def _excel_oku(self) -> pd.DataFrame:
        """Excel dosyasını okur, hata durumunda boş DataFrame döner"""
        try:
            return pd.read_excel(self.dosya_yolu)
        except Exception as e:
            print(f"❌ Excel okuma hatası: {e}")
            return pd.DataFrame()
    
    def _normalize_columns(self):
        """Sütun isimlerini normalize eder"""
        if self.df.empty:
            return
            
        kolon_esleme = {
            'Ürün Kodu': 'urun_kodu',
            'Urun Kodu': 'urun_kodu',
            'ÜrünKodu': 'urun_kodu',
            'UrunKodu': 'urun_kodu',
            'product_code': 'urun_kodu',
            'Product Code': 'urun_kodu',
            'Ürün Adı': 'urun_adi',
            'Urun Adi': 'urun_adi',
            'ÜrünAdı': 'urun_adi',
            'UrunAdi': 'urun_adi',
            'Ürün Ad': 'urun_adi',
            'Urun Ad': 'urun_adi',
            'Fiyat': 'fiyat',
            'Price': 'fiyat',
            'Miktar': 'miktar',
            'Quantity': 'miktar',
            'Stok': 'stok',
            'Stock': 'stok',
            'Kategori': 'kategori',
            'Category': 'kategori',
            'Marka': 'marka',
            'Brand': 'marka'
        }
        
        self.df = self.df.rename(columns=kolon_esleme)
    
    def urun_kodlarini_grupla(self) -> Dict[str, List[str]]:
        """Ürün kodlarını başlangıç harflerine göre gruplar"""
        gruplar = {}
        
        if self.df.empty:
            return gruplar
        
        for index, row in self.df.iterrows():
            urun_kodu = self._get_urun_kodu(row)
            
            if urun_kodu and urun_kodu != 'nan' and len(str(urun_kodu)) >= 3:
                baslangic = str(urun_kodu)[:3].upper()
                if baslangic not in gruplar:
                    gruplar[baslangic] = []
                gruplar[baslangic].append(str(urun_kodu))
        
        return gruplar
    
    def _get_urun_kodu(self, row) -> str:
        """Satırdan ürün kodunu bulur"""
        for kolon in ['urun_kodu', 'Ürün Kodu', 'product_code']:
            if kolon in self.df.columns and pd.notna(row.get(kolon)):
                return str(row.get(kolon, ''))
        return ''
    
    def baslangica_gore_filtrele(self, baslangic: str) -> List[Dict]:
        """Başlangıç harflerine göre ürünleri filtreler"""
        if self.df.empty:
            return []
        
        pattern = f"^{baslangic.upper()}"
        
        urun_kolon = None
        for kolon in ['urun_kodu', 'Ürün Kodu', 'product_code']:
            if kolon in self.df.columns:
                urun_kolon = kolon
                break
        
        if urun_kolon:
            mask = self.df[urun_kolon].astype(str).str.contains(
                pattern, na=False, case=False, regex=True
            )
            filtrelenmis = self.df[mask]
            return filtrelenmis.to_dict('records')
        
        return []
    
    def urun_analizi_yap(self) -> Dict[str, Any]:
        """Ürünlerin detaylı analizini yapar"""
        gruplar = self.urun_kodlarini_grupla()
        
        analiz = {
            'toplam_urun': len(self.df),
            'toplam_grup': len(gruplar),
            'benzersiz_baslangic': list(gruplar.keys()),
            'gruplar': {},
            'istatistikler': {}
        }
        
        # Grup istatistikleri
        for baslangic, kodlar in gruplar.items():
            analiz['gruplar'][baslangic] = {
                'sayi': len(kodlar),
                'ornekler': kodlar[:3],
                'yuzde': round((len(kodlar) / len(self.df)) * 100, 2) if len(self.df) > 0 else 0
            }
        
        # Sayısal istatistikler
        if 'fiyat' in self.df.columns:
            analiz['istatistikler']['fiyat'] = {
                'min': float(self.df['fiyat'].min()) if not pd.isna(self.df['fiyat'].min()) else 0,
                'max': float(self.df['fiyat'].max()) if not pd.isna(self.df['fiyat'].max()) else 0,
                'ortalama': float(self.df['fiyat'].mean()) if not pd.isna(self.df['fiyat'].mean()) else 0
            }
        
        if 'miktar' in self.df.columns:
            analiz['istatistikler']['miktar'] = {
                'toplam': int(self.df['miktar'].sum()) if not pd.isna(self.df['miktar'].sum()) else 0,
                'ortalama': float(self.df['miktar'].mean()) if not pd.isna(self.df['miktar'].mean()) else 0
            }
        
        return analiz
    
    def excel_ozeti(self) -> Dict[str, Any]:
        """Excel'in genel özetini çıkarır"""
        if self.df.empty:
            return {
                'dosya': self.dosya_yolu,
                'hata': 'Dosya okunamadı veya boş'
            }
        
        return {
            'dosya': os.path.basename(self.dosya_yolu),
            'satir_sayisi': len(self.df),
            'sutun_sayisi': len(self.df.columns),
            'sutunlar': list(self.df.columns),
            'bos_huceler': int(self.df.isnull().sum().sum()),
            'veri_tipleri': {col: str(dtype) for col, dtype in self.df.dtypes.items()},
            'bellek_kullanimi': f"{self.df.memory_usage(deep=True).sum() / 1024:.2f} KB"
        }
    
    def excel_kaydet(self, cikti_yolu: str) -> bool:
        """İşlenmiş DataFrame'i Excel olarak kaydeder"""
        try:
            self.df.to_excel(cikti_yolu, index=False)
            return True
        except Exception as e:
            print(f"❌ Excel kaydetme hatası: {e}")
            return False