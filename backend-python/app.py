from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
import openpyxl
import os
import shutil
import uuid
import logging
from typing import List, Dict
import uvicorn

app = FastAPI(title="Siemens Excel API")

# P0-3 FIX: CORS whitelist - production domain'leri buraya ekle
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    # "https://nexledger.tufekci.com",  # Production domain eklenince ac
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

# Nginx reverse proxy arkadasinda gercek IP tespiti icin
# Production'da allowed_hosts'a kendi domain'ini ekle
# app.add_middleware(
#     TrustedHostMiddleware,
#     allowed_hosts=["nexledger.tufekci.com", "localhost"]
# )

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Urun veritabani
urunler: List[Dict] = []


@app.get("/")
def root():
    return {
        "success": True,
        "message": "Siemens Excel API Calisiyor",
        "python_version": "3.14+",
        "durum": "Aktif"
    }


@app.post("/excel/yukle")
async def excel_yukle(file: UploadFile = File(...)):
    global urunler
    urunler = []

    # P0-4a: Dosya tipi kontrolu
    allowed_extensions = (".xlsx", ".xls")
    original_name = file.filename or ""
    if not original_name.lower().endswith(allowed_extensions):
        raise HTTPException(
            status_code=400,
            detail="Sadece Excel dosyalari (.xlsx, .xls) kabul edilir."
        )

    try:
        # P0-4b: UUID dosya adi - path traversal onlemi
        safe_filename = f"{uuid.uuid4().hex}.xlsx"
        dosya_yolu = os.path.join(UPLOAD_DIR, safe_filename)
        with open(dosya_yolu, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Excel'i oku
        wb = openpyxl.load_workbook(dosya_yolu, data_only=True)
        sheet = wb.active

        # Basliklari bul
        basliklar = []
        for row in sheet.iter_rows(min_row=1, max_row=1, values_only=True):
            basliklar = [str(cell).lower() if cell else "" for cell in row]
            break

        # Sutun index'lerini bul
        urun_kodu_idx = -1
        urun_adi_idx = -1
        fiyat_idx = -1

        for i, baslik in enumerate(basliklar):
            if any(k in baslik for k in ["urun kodu", "product", "kod"]):
                urun_kodu_idx = i
            elif any(k in baslik for k in ["urun adi", "ad", "name"]):
                urun_adi_idx = i
            elif any(k in baslik for k in ["fiyat", "price", "tutar"]):
                fiyat_idx = i

        # Urunleri oku
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
                    except (ValueError, TypeError):
                        pass

                urunler.append(urun)

        wb.close()

        return {
            "success": True,
            "toplam_urun": len(urunler),
            "mesaj": f"{len(urunler)} urun yuklendi"
        }

    except HTTPException:
        raise
    except Exception as e:
        # P0-5: Genel hata mesaji - stack trace'i gizle
        logging.error(f"Excel yukleme hatasi: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "Excel dosyasi islenirken bir hata olustu. Dosya formatini kontrol edin."
            }
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
            if len(gruplar[baslangic]) < 5:
                gruplar[baslangic].append(kod)

    return {
        "success": True,
        "toplam_grup": len(gruplar),
        "gruplar": gruplar
    }


if __name__ == "__main__":
    print("Siemens Excel API Baslatiliyor - http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)