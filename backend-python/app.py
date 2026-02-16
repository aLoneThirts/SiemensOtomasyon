from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import openpyxl
import os
import shutil
from typing import List, Dict
import uvicorn

app = FastAPI(title="Siemens Excel API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Ürün veritabanı
urunler: List[Dict] = []

@app.get("/")
def root():
    return {
        "success": True,
        "message": "Siemens Excel API Çalışıyor",
        "python_version": "3.14+",
        "durum": "Aktif"
    }

@app.post("/excel/yukle")
async def excel_yukle(file: UploadFile = File(...)):
    global urunler
    urunler = []
    
    try:
        # Dosyayı kaydet
        dosya_yolu = os.path.join(UPLOAD_DIR, file.filename)
        with open(dosya_yolu, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Excel'i oku
        wb = openpyxl.load_workbook(dosya_yolu, data_only=True)
        sheet = wb.active
        
        # Başlıkları bul
        basliklar = []
        for row in sheet.iter_rows(min_row=1, max_row=1, values_only=True):
            basliklar = [str(cell).lower() if cell else "" for cell in row]
            break
        
        # Sütun index'lerini bul
        urun_kodu_idx = -1
        urun_adi_idx = -1
        fiyat_idx = -1
        
        for i, baslik in enumerate(basliklar):
            if any(k in baslik for k in ["ürün kodu", "urun kodu", "product", "kod"]):
                urun_kodu_idx = i
            elif any(k in baslik for k in ["ürün adı", "urun adi", "ad", "name"]):
                urun_adi_idx = i
            elif any(k in baslik for k in ["fiyat", "price", "tutar"]):
                fiyat_idx = i
        
        # Ürünleri oku
        for row in sheet.iter_rows(min_row=2, values_only=True):
            if urun_kodu_idx >= 0 and row[urun_kodu_idx]:
                urun = {
                    "urun_kodu": str(row[urun_kodu_idx]).strip(),
                    "urun_adi": "",
                    "fiyat": 0
                }
                
                if urun_adi_idx >= 0 and row[urun_adi_idx]:
                    urun["urun_adi"] = str(row[urun_adi_idx]).strip()
                
                if fiyat_idx >= 0 and row[fiyat_idx]:
                    try:
                        urun["fiyat"] = float(row[fiyat_idx])
                    except:
                        pass
                
                urunler.append(urun)
        
        wb.close()
        
        return {
            "success": True,
            "toplam_urun": len(urunler),
            "mesaj": f"{len(urunler)} ürün yüklendi"
        }
        
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)}
        )

@app.get("/urun/ara/{aranan}")
async def urun_ara(aranan: str):
    if len(aranan) < 2:
        return {"sonuclar": []}
    
    sonuclar = []
    aranan = aranan.lower()
    
    for urun in urunler:
        if aranan in urun["urun_kodu"].lower():
            sonuclar.append(urun)
            if len(sonuclar) >= 20:
                break
    
    return {
        "success": True,
        "sonuclar": sonuclar,
        "toplam": len(sonuclar)
    }

@app.get("/urun/gruplar")
async def urun_gruplari():
    gruplar = {}
    
    for urun in urunler:
        kod = urun.get("urun_kodu", "")
        if kod and len(kod) >= 3:
            baslangic = kod[:3].upper()
            if baslangic not in gruplar:
                gruplar[baslangic] = []
            if len(gruplar[baslangic]) < 5:  # İlk 5 örnek
                gruplar[baslangic].append(kod)
    
    return {
        "success": True,
        "toplam_grup": len(gruplar),
        "gruplar": gruplar
    }

if __name__ == "__main__":
    print("""
    ╔══════════════════════════════════╗
    ║  Siemens Excel API Başlatılıyor  ║
    ║  Python 3.14+ Uyumlu             ║
    ║  http://localhost:8000           ║
    ╚══════════════════════════════════╝
    """)
    uvicorn.run(app, host="0.0.0.0", port=8000)