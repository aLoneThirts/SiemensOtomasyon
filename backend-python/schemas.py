# ================================================
#  schemas.py — Pydantic Modelleri (Request/Response)
# ================================================
from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

# ─── Enum'lar ────────────────────────────────────────────────────────────────

class SubeKodu(str, Enum):
    KARTAL     = "KARTAL"
    PENDIK     = "PENDIK"
    SANCAKTEPE = "SANCAKTEPE"
    BUYAKA_AVM = "BUYAKA_AVM"
    MALTEPE    = "MALTEPE"

class UserRole(str, Enum):
    ADMIN   = "ADMIN"
    CALISAN = "CALISAN"

class OdemeDurumu(str, Enum):
    ODENDI     = "ODENDI"
    ACIK_HESAP = "ACIK_HESAP"

class KasaHareketTipi(str, Enum):
    NAKIT_SATIS = "NAKIT_SATIS"
    KART        = "KART"
    HAVALE      = "HAVALE"
    GIDER       = "GIDER"
    CIKIS       = "CIKIS"
    ADMIN_ALIM  = "ADMIN_ALIM"
    DIGER       = "DIGER"

# ─── AUTH ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    ad: str
    soyad: str
    role: UserRole = UserRole.CALISAN
    sube_kodu: SubeKodu

class UserResponse(BaseModel):
    uid: str
    email: str
    ad: str
    soyad: str
    role: UserRole
    sube_kodu: SubeKodu
    hedef: Optional[float] = None
    hedefler: Optional[Dict[str, float]] = None

    class Config:
        from_attributes = True

# ─── SATIŞ ───────────────────────────────────────────────────────────────────

class UrunSchema(BaseModel):
    urun_kodu: str
    urun_adi: str
    adet: int = 1
    alis_fiyati: float = 0
    bip: Optional[float] = None

class KartOdemeSchema(BaseModel):
    id: str
    banka: Optional[str] = None
    taksit_sayisi: int = 1
    tutar: float = 0
    pesinat: Optional[float] = None
    kesinti_orani: Optional[float] = None
    tarih: Optional[datetime] = None

class SatisCreate(BaseModel):
    satis_kodu: str
    sube_kodu: SubeKodu
    musteri_isim: str
    musteri_adres: Optional[str] = None
    musteri_cep: Optional[str] = None
    musteri_vergi_no: Optional[str] = None
    musteri_vk_no: Optional[str] = None
    musteri_vd: Optional[str] = None
    musteri_temsilcisi: Optional[str] = None
    musteri_temsilcisi_id: Optional[str] = None
    toplam_tutar: float = 0
    pesinat_tutar: float = 0
    havale_tutar: float = 0
    odeme_durumu: OdemeDurumu = OdemeDurumu.ACIK_HESAP
    odeme_yontemi: Optional[str] = None
    odeme_ozeti: Optional[Dict[str, Any]] = None
    fatura_no: Optional[str] = None
    servis_notu: Optional[str] = None
    fatura: bool = False
    ileri_teslim: bool = False
    servis: bool = False
    tarih: Optional[datetime] = None
    teslimat_tarihi: Optional[datetime] = None
    nakit_odeme_tarihi: Optional[datetime] = None
    havale_tarihi: Optional[datetime] = None
    olusturan_kullanici: Optional[str] = None
    urunler: List[UrunSchema] = []
    kart_odemeler: List[KartOdemeSchema] = []

class SatisResponse(SatisCreate):
    id: str
    onay_durumu: str
    olusturma_tarihi: Optional[datetime] = None
    guncelleme_tarihi: Optional[datetime] = None

    class Config:
        from_attributes = True

# ─── KASA ────────────────────────────────────────────────────────────────────

class KasaHareketCreate(BaseModel):
    tip: KasaHareketTipi
    aciklama: str
    tutar: float
    tarih: datetime
    kullanici: str
    kullanici_id: str
    belge_no: Optional[str] = None
    not_: Optional[str] = None
    admin_id: Optional[str] = None
    admin_ad: Optional[str] = None

class KasaGunResponse(BaseModel):
    id: str
    gun: str
    sube_kodu: str
    durum: str
    acilis_bakiyesi: float
    gun_sonu_bakiyesi: float
    nakit_satis: float
    toplam_gider: float
    cikis_yapilan: float
    admin_alimlar: float
    kart_satis: float
    havale_satis: float
    admin_ozet: Optional[Dict[str, float]] = None
    acilis_yapan: Optional[str] = None
    olusturma_tarihi: Optional[datetime] = None

    class Config:
        from_attributes = True

# ─── İPTAL ───────────────────────────────────────────────────────────────────

class IptalKayitCreate(BaseModel):
    satis_id: str
    satis_kodu: str
    musteri_isim: Optional[str] = None
    sube_kodu: SubeKodu
    nakit_tutar: float = 0
    kart_tutar: float = 0
    havale_tutar: float = 0
    iptal_tarihi: Optional[str] = None
    satis_tarihi: Optional[str] = None
    iptal_yapan: str
    iptal_yapan_id: str
    aciklama: Optional[str] = None
    orijinal_nakit: float = 0
    orijinal_kart: float = 0
    orijinal_havale: float = 0
    orijinal_toplam: float = 0