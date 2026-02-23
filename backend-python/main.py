# ================================================
#  main.py — FastAPI Ana Uygulama
# ================================================
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from routers import auth_router, satis_router, kasa_router

# Tabloları oluştur (ilk çalıştırmada)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="SiemensOtomasyon API",
    description="Tüfekçi Home Satış Yönetim Sistemi",
    version="2.0.0"
)

# CORS — React'ın bağlanabilmesi için
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # VPS'e geçince eklenecek
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Router'ları bağla
app.include_router(auth_router.router)
app.include_router(satis_router.router)
app.include_router(kasa_router.router)

@app.get("/")
def root():
    return {"mesaj": "SiemensOtomasyon API çalışıyor", "versiyon": "2.0.0"}

@app.get("/health")
def health():
    return {"durum": "OK"}