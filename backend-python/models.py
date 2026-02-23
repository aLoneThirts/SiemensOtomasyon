# ================================================
#  models.py — Veritabanı Tabloları
#  Firebase koleksiyonlarının SQL karşılıkları
# ================================================
from sqlalchemy import (
    Column, String, Integer, Float, Boolean,
    DateTime, ForeignKey, Enum, Text, JSON
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum

# ─── Enum'lar ────────────────────────────────────────────────────────────────

class SubeKoduEnum(str, enum.Enum):
    KARTAL      = "KARTAL"
    PENDIK      = "PENDIK"
    SANCAKTEPE  = "SANCAKTEPE"
    BUYAKA_AVM  = "BUYAKA_AVM"
    MALTEPE     = "MALTEPE"

class UserRoleEnum(str, enum.Enum):
    ADMIN   = "ADMIN"
    CALISAN = "CALISAN"
    SATICI = "SATICI"

class OdemeDurumuEnum(str, enum.Enum):
    ODENDI     = "ODENDI"
    ACIK_HESAP = "ACIK_HESAP"

class OnayDurumuEnum(str, enum.Enum):
    BEKLIYOR  = "BEKLIYOR"
    ONAYLANDI = "ONAYLANDI"
    IPTAL     = "IPTAL"

class KasaHareketTipiEnum(str, enum.Enum):
    NAKIT_SATIS = "NAKIT_SATIS"
    KART        = "KART"
    HAVALE      = "HAVALE"
    GIDER       = "GIDER"
    CIKIS       = "CIKIS"
    ADMIN_ALIM  = "ADMIN_ALIM"
    DIGER       = "DIGER"

class KasaDurumEnum(str, enum.Enum):
    ACIK   = "ACIK"
    KAPALI = "KAPALI"

# ─── USERS ───────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    uid             = Column(String(128), primary_key=True)
    email           = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    ad              = Column(String(100), nullable=False)
    soyad           = Column(String(100), nullable=False)
    role            = Column(Enum(UserRoleEnum), default=UserRoleEnum.CALISAN)
    sube_kodu       = Column(Enum(SubeKoduEnum), nullable=False)
    hedef           = Column(Float, nullable=True)
    hedefler        = Column(JSON, nullable=True)   # {"2024-01": 50000, ...}
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())

# ─── SATISLAR ────────────────────────────────────────────────────────────────

class Satis(Base):
    __tablename__ = "satislar"

    id                      = Column(String(50), primary_key=True)
    satis_kodu              = Column(String(50), unique=True, nullable=False, index=True)
    sube_kodu               = Column(Enum(SubeKoduEnum), nullable=False, index=True)

    # Müşteri bilgileri
    musteri_isim            = Column(String(200), nullable=False)
    musteri_adres           = Column(Text, nullable=True)
    musteri_fatura_adres    = Column(Text, nullable=True)
    musteri_is_adres        = Column(Text, nullable=True)
    musteri_vergi_no        = Column(String(50), nullable=True)
    musteri_vk_no           = Column(String(50), nullable=True)
    musteri_vd              = Column(String(100), nullable=True)
    musteri_cep             = Column(String(20), nullable=True)

    # Satış detayları
    musteri_temsilcisi      = Column(String(200), nullable=True)
    musteri_temsilcisi_tel  = Column(String(20), nullable=True)
    musteri_temsilcisi_id   = Column(String(128), nullable=True)
    toplam_tutar            = Column(Float, default=0)
    fatura_no               = Column(String(100), nullable=True)
    servis_notu             = Column(Text, nullable=True)
    mars_no                 = Column(String(100), nullable=True)
    magaza                  = Column(String(100), nullable=True)
    cevap                   = Column(Text, nullable=True)
    zarar                   = Column(Float, default=0)

    # Ödeme
    pesinat_tutar           = Column(Float, default=0)
    havale_tutar            = Column(Float, default=0)
    nakit_odeme_tarihi      = Column(DateTime, nullable=True)
    havale_tarihi           = Column(DateTime, nullable=True)
    odeme_durumu            = Column(Enum(OdemeDurumuEnum), default=OdemeDurumuEnum.ACIK_HESAP)
    odeme_yontemi           = Column(String(50), nullable=True)

    # Ödeme özeti (JSON)
    odeme_ozeti             = Column(JSON, nullable=True)

    # Durum
    onay_durumu             = Column(Enum(OnayDurumuEnum), default=OnayDurumuEnum.BEKLIYOR)
    fatura                  = Column(Boolean, default=False)
    ileri_teslim            = Column(Boolean, default=False)
    servis                  = Column(Boolean, default=False)
    teslim_edildi_mi        = Column(Boolean, default=False)

    # İleri teslim
    ileri_teslim_tarihi     = Column(DateTime, nullable=True)
    ileri_teslim_statusu    = Column(String(50), nullable=True)
    ileri_teslim_notu       = Column(Text, nullable=True)
    satis_statusu           = Column(String(50), nullable=True)

    # İptal
    iptal_talebi            = Column(Boolean, default=False)
    iptal_durumu            = Column(String(20), nullable=True)
    iptal_tarihi            = Column(DateTime, nullable=True)

    # Tarihler
    tarih                   = Column(DateTime, nullable=True)
    teslimat_tarihi         = Column(DateTime, nullable=True)
    olusturan_kullanici     = Column(String(200), nullable=True)
    olusturma_tarihi        = Column(DateTime, server_default=func.now())
    guncelleme_tarihi       = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # İlişkiler
    urunler                 = relationship("SatisUrun", back_populates="satis", cascade="all, delete-orphan")
    kart_odemeler           = relationship("KartOdeme", back_populates="satis", cascade="all, delete-orphan")
    kampanyalar             = relationship("SatisKampanya", back_populates="satis", cascade="all, delete-orphan")

# ─── SATIS ÜRÜNLERİ ──────────────────────────────────────────────────────────

class SatisUrun(Base):
    __tablename__ = "satis_urunler"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    satis_id     = Column(String(50), ForeignKey("satislar.id"), nullable=False, index=True)
    urun_kodu    = Column(String(100), nullable=False)
    urun_adi     = Column(String(200), nullable=False)
    adet         = Column(Integer, default=1)
    alis_fiyati  = Column(Float, default=0)
    bip          = Column(Float, nullable=True)

    satis        = relationship("Satis", back_populates="urunler")

# ─── KART ÖDEMELER ───────────────────────────────────────────────────────────

class KartOdeme(Base):
    __tablename__ = "kart_odemeler"

    id             = Column(String(50), primary_key=True)
    satis_id       = Column(String(50), ForeignKey("satislar.id"), nullable=False, index=True)
    banka          = Column(String(100), nullable=True)
    taksit_sayisi  = Column(Integer, default=1)
    tutar          = Column(Float, default=0)
    pesinat        = Column(Float, nullable=True)
    kesinti_orani  = Column(Float, nullable=True)
    tarih          = Column(DateTime, nullable=True)

    satis          = relationship("Satis", back_populates="kart_odemeler")

# ─── SATIŞ KAMPANYALARI ───────────────────────────────────────────────────────

class SatisKampanya(Base):
    __tablename__ = "satis_kampanyalar"

    id       = Column(Integer, primary_key=True, autoincrement=True)
    satis_id = Column(String(50), ForeignKey("satislar.id"), nullable=False, index=True)
    ad       = Column(String(200), nullable=True)
    tutar    = Column(Float, default=0)

    satis    = relationship("Satis", back_populates="kampanyalar")

# ─── KASA GÜNLER ──────────────────────────────────────────────────────────────

class KasaGun(Base):
    __tablename__ = "kasa_gunler"

    id                = Column(String(50), primary_key=True)  # "KARTAL_2024-01-15"
    gun               = Column(String(10), nullable=False, index=True)   # "2024-01-15"
    sube_kodu         = Column(Enum(SubeKoduEnum), nullable=False, index=True)
    durum             = Column(Enum(KasaDurumEnum), default=KasaDurumEnum.ACIK)

    acilis_bakiyesi   = Column(Float, default=0)
    gun_sonu_bakiyesi = Column(Float, default=0)

    nakit_satis       = Column(Float, default=0)
    toplam_gider      = Column(Float, default=0)
    cikis_yapilan     = Column(Float, default=0)
    admin_alimlar     = Column(Float, default=0)
    kart_satis        = Column(Float, default=0)
    havale_satis      = Column(Float, default=0)

    admin_ozet        = Column(JSON, nullable=True)   # {"Berat Bey": 500}
    acilis_yapan      = Column(String(200), nullable=True)

    olusturma_tarihi  = Column(DateTime, server_default=func.now())
    guncelleme_tarihi = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # İlişki
    hareketler        = relationship("KasaHareket", back_populates="kasa_gun", cascade="all, delete-orphan")

# ─── KASA HAREKETLER ──────────────────────────────────────────────────────────

class KasaHareket(Base):
    __tablename__ = "kasa_hareketler"

    id             = Column(String(100), primary_key=True)
    kasa_gun_id    = Column(String(50), ForeignKey("kasa_gunler.id"), nullable=False, index=True)
    sube_kodu      = Column(Enum(SubeKoduEnum), nullable=False)
    tip            = Column(Enum(KasaHareketTipiEnum), nullable=False)
    aciklama       = Column(Text, nullable=True)
    tutar          = Column(Float, default=0)
    tarih          = Column(DateTime, nullable=False)
    saat           = Column(String(5), nullable=True)
    kullanici      = Column(String(200), nullable=True)
    kullanici_id   = Column(String(128), nullable=True)
    belge_no       = Column(String(100), nullable=True)
    not_           = Column(Text, nullable=True)
    admin_id       = Column(String(50), nullable=True)
    admin_ad       = Column(String(100), nullable=True)

    kasa_gun       = relationship("KasaGun", back_populates="hareketler")

# ─── KASA İPTAL KAYITLARI ─────────────────────────────────────────────────────

class KasaIptalKayit(Base):
    __tablename__ = "kasa_iptal_kayitlari"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    satis_id            = Column(String(50), nullable=False, index=True)
    satis_kodu          = Column(String(50), nullable=False)
    musteri_isim        = Column(String(200), nullable=True)
    sube_kodu           = Column(Enum(SubeKoduEnum), nullable=False)

    nakit_tutar         = Column(Float, default=0)
    kart_tutar          = Column(Float, default=0)
    havale_tutar        = Column(Float, default=0)

    iptal_tarihi        = Column(String(10), nullable=True)   # YYYY-MM-DD
    satis_tarihi        = Column(String(10), nullable=True)
    iptal_yapan         = Column(String(200), nullable=True)
    iptal_yapan_id      = Column(String(128), nullable=True)
    aciklama            = Column(Text, nullable=True)
    iptal_iadesi        = Column(Boolean, default=True)

    # Orijinal ödeme detayı
    orijinal_nakit      = Column(Float, default=0)
    orijinal_kart       = Column(Float, default=0)
    orijinal_havale     = Column(Float, default=0)
    orijinal_toplam     = Column(Float, default=0)

    created_at          = Column(DateTime, server_default=func.now())