# ================================================
#  config.py — Uygulama Ayarları
# ================================================
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # SQL Server bağlantısı
    # Örnek: "mssql+pyodbc://kullanici:sifre@localhost/SiemensOtomasyon?driver=ODBC+Driver+17+for+SQL+Server"
    DATABASE_URL: str = "mssql+pyodbc://sa:sifren@localhost/SiemensOtomasyon?driver=ODBC+Driver+17+for+SQL+Server"
    
    # JWT ayarları
    SECRET_KEY: str = "siemens-super-secret-key-degistir"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 saat

    class Config:
        env_file = ".env"

settings = Settings()