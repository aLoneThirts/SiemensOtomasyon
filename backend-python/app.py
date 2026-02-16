from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import shutil
import os
from typing import List
from excel_professor import ExcelProfessor
from urun_matcher import UrunMatcher
import uvicorn

app = FastAPI(
    title="Siemens Excel API", 
    description="Excel dosyalarını işleyen ve ürün kodlarını eşleştiren API",
    version="1.0.0"
)

# CORS ayarları
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Upload klasörü oluştur
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Global değişkenler
son_yuklenen_dosya = None
urun_esleme_gecmisi = []

@app.get("/")
def root():
    """Ana endpoint - API durumunu gösterir"""
    return {
        "success": True,
        "message": "🚀 Siemens Excel API çalışıyor",
        "version": "1.0.0",
        "durum": "Aktif",
        "endpoints": {
            "GET /health": "Sağlık kontrolü",
            "POST /excel/yukle": "Excel dosyası yükle",
            "GET /urun/gruplar": "Ürün gruplarını listele",
            "GET /urun/analiz/{baslangic}": "Belirli bir grubun analizi",
            "POST /urun/eslestir/{baslangic}": "Ürünleri eşleştir ve fiyat ekle"
        }
    }

@app.get("/health")
def health():
    """API sağlık kontrolü"""
    return {
        "status": "healthy",
        "timestamp": str(os.path.getmtime(__file__)) if os.path.exists(__file__) else None
    }

@app.post("/excel/yukle")
async def excel_yukle(file: UploadFile = File(...)):
    """Excel dosyası yükler ve analiz eder"""
    global son_yuklenen_dosya
    
    try:
        # Dosya uzantısı kontrolü
        if not file.filename.endswith(('.xlsx', '.xls')):
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Sadece Excel dosyaları yüklenebilir (.xlsx, .xls)"
                }
            )
        
        # Dosyayı kaydet
        dosya_yolu = f"{UPLOAD_DIR}/{file.filename}"
        with open(dosya_yolu, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        son_yuklenen_dosya = dosya_yolu
        
        # Excel'i analiz et
        professor = ExcelProfessor(dosya_yolu)
        analiz = professor.urun_analizi_yap()
        ozet = professor.excel_ozeti()
        
        return {
            "success": True,
            "dosya": file.filename,
            "analiz": analiz,
            "ozet": ozet,
            "mesaj": f"✅ {analiz['toplam_urun']} ürün, {analiz['toplam_grup']} grup bulundu"
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "mesaj": "❌ Excel yüklenirken hata oluştu"
            }
        )

@app.get("/urun/gruplar")
def urun_gruplari():
    """Son yüklenen excel'deki ürün gruplarını listeler"""
    global son_yuklenen_dosya
    
    try:
        if not son_yuklenen_dosya or not os.path.exists(son_yuklenen_dosya):
            # Son yüklenen dosya yoksa uploads klasöründeki son dosyayı bul
            if not os.path.exists(UPLOAD_DIR):
                return {
                    "success": True,
                    "mesaj": "Henüz excel yüklenmemiş",
                    "gruplar": {}
                }
            
            dosyalar = os.listdir(UPLOAD_DIR)
            if not dosyalar:
                return {
                    "success": True,
                    "mesaj": "Henüz excel yüklenmemiş",
                    "gruplar": {}
                }
            
            son_yuklenen_dosya = f"{UPLOAD_DIR}/{dosyalar[-1]}"
        
        professor = ExcelProfessor(son_yuklenen_dosya)
        gruplar = professor.urun_kodlarini_grupla()
        analiz = professor.urun_analizi_yap()
        
        return {
            "success": True,
            "mesaj": f"{len(gruplar)} grup bulundu",
            "gruplar": gruplar,
            "analiz": analiz,
            "dosya": os.path.basename(son_yuklenen_dosya)
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "gruplar": {}
        }

@app.get("/urun/analiz/{baslangic}")
def urun_analizi(baslangic: str):
    """Belirli bir başlangıç grubunun detaylı analizini yapar"""
    global son_yuklenen_dosya
    
    try:
        if not son_yuklenen_dosya or not os.path.exists(son_yuklenen_dosya):
            return {
                "success": False,
                "mesaj": "Önce bir excel dosyası yükleyin"
            }
        
        professor = ExcelProfessor(son_yuklenen_dosya)
        urunler = professor.baslangica_gore_filtrele(baslangic)
        
        matcher = UrunMatcher()
        analiz = []
        
        for urun in urunler:
            urun_kodu = urun.get('urun_kodu', '')
            if urun_kodu:
                kod_analizi = matcher.kod_analizi(urun_kodu)
                analiz.append({
                    "urun": urun,
                    "analiz": kod_analizi
                })
        
        return {
            "success": True,
            "baslangic": baslangic,
            "toplam_urun": len(urunler),
            "urunler": urunler,
            "detayli_analiz": analiz
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

@app.post("/urun/eslestir/{baslangic}")
async def urun_eslestir(
    baslangic: str, 
    fiyat: float, 
    miktar: int, 
    aciklama: str = ""
):
    """Belirli bir grupdaki tüm ürünlere toplu fiyat ekler"""
    global son_yuklenen_dosya, urun_esleme_gecmisi
    
    try:
        if not son_yuklenen_dosya or not os.path.exists(son_yuklenen_dosya):
            return {
                "success": False,
                "mesaj": "Önce bir excel dosyası yükleyin"
            }
        
        professor = ExcelProfessor(son_yuklenen_dosya)
        urunler = professor.baslangica_gore_filtrele(baslangic)
        
        # Eşleme geçmişine ekle
        esleme_kaydi = {
            "zaman": str(os.path.getmtime(son_yuklenen_dosya)),
            "baslangic": baslangic,
            "fiyat": fiyat,
            "miktar": miktar,
            "aciklama": aciklama,
            "urun_sayisi": len(urunler),
            "dosya": os.path.basename(son_yuklenen_dosya)
        }
        urun_esleme_gecmisi.append(esleme_kaydi)
        
        # Firestore'a kaydetme işlemi burada yapılacak
        # (şimdilik simülasyon)
        
        return {
            "success": True,
            "mesaj": f"✅ {len(urunler)} ürün {baslangic}* grubuna {fiyat} TL fiyat eklendi",
            "urun_sayisi": len(urunler),
            "baslangic": baslangic,
            "fiyat": fiyat,
            "miktar": miktar,
            "aciklama": aciklama,
            "urun_ornekleri": urunler[:5] if urunler else [],
            "esleme_kaydi": esleme_kaydi
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

@app.get("/urun/gecmis")
def esleme_gecmisi():
    """Yapılan tüm eşleme işlemlerinin geçmişini gösterir"""
    return {
        "success": True,
        "toplam_islem": len(urun_esleme_gecmisi),
        "gecmis": urun_esleme_gecmisi[-20:]  # Son 20 işlem
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)