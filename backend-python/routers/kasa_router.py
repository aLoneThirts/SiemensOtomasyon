# ================================================
#  routers/kasa_router.py — Kasa Endpoint'leri
# ================================================
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_
from database import get_db
from datetime import datetime
from typing import Optional
import models, schemas, auth
import uuid

router = APIRouter(prefix="/kasa", tags=["Kasa"])

# ─── Yardımcı ────────────────────────────────────────────────────────────────

def hesapla_gun_sonu(gun: models.KasaGun) -> float:
    return (
        gun.acilis_bakiyesi
        + gun.nakit_satis
        - gun.toplam_gider
        - gun.cikis_yapilan
        - gun.admin_alimlar
    )

# ─── Bugünün kasasını aç veya getir ──────────────────────────────────────────

@router.get("/bugun/{sube_kodu}", response_model=schemas.KasaGunResponse)
def get_bugun_kasa(
    sube_kodu: str,
    acilis_yapan: str = Query(...),
    test_tarih: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _user: models.User = Depends(auth.get_current_user)
):
    bugun = test_tarih or datetime.now().strftime("%Y-%m-%d")
    gun_id = f"{sube_kodu}_{bugun}"

    mevcut = db.query(models.KasaGun).filter(models.KasaGun.id == gun_id).first()
    if mevcut:
        return mevcut

    # Önceki günün bakiyesini bul
    onceki = db.query(models.KasaGun).filter(
        models.KasaGun.sube_kodu == sube_kodu,
        models.KasaGun.gun < bugun
    ).order_by(models.KasaGun.gun.desc()).first()

    acilis_bakiyesi = onceki.gun_sonu_bakiyesi if onceki else 0

    yeni = models.KasaGun(
        id=gun_id,
        gun=bugun,
        sube_kodu=sube_kodu,
        durum=models.KasaDurumEnum.ACIK,
        acilis_bakiyesi=acilis_bakiyesi,
        gun_sonu_bakiyesi=acilis_bakiyesi,
        nakit_satis=0,
        toplam_gider=0,
        cikis_yapilan=0,
        admin_alimlar=0,
        kart_satis=0,
        havale_satis=0,
        admin_ozet={},
        acilis_yapan=acilis_yapan,
    )
    db.add(yeni)
    db.commit()
    db.refresh(yeni)
    return yeni

# ─── Kasa geçmişi ─────────────────────────────────────────────────────────────

@router.get("/gecmis/{sube_kodu}")
def get_kasa_gecmisi(
    sube_kodu: str,
    gun_sayisi: int = Query(90),
    db: Session = Depends(get_db),
    _user: models.User = Depends(auth.get_current_user)
):
    gunler = db.query(models.KasaGun).filter(
        models.KasaGun.sube_kodu == sube_kodu
    ).order_by(models.KasaGun.gun.desc()).limit(gun_sayisi).all()
    return gunler

# ─── Kasa hareketi ekle ───────────────────────────────────────────────────────

@router.post("/hareket/{sube_kodu}/{kasa_gun_id}")
def kasa_hareket_ekle(
    sube_kodu: str,
    kasa_gun_id: str,
    hareket: schemas.KasaHareketCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(auth.get_current_user)
):
    gun = db.query(models.KasaGun).filter(models.KasaGun.id == kasa_gun_id).first()
    if not gun:
        raise HTTPException(status_code=404, detail="Kasa günü bulunamadı")

    # Hareketi ekle
    yeni_h = models.KasaHareket(
        id=f"h_{uuid.uuid4().hex[:10]}",
        kasa_gun_id=kasa_gun_id,
        sube_kodu=sube_kodu,
        tip=hareket.tip,
        aciklama=hareket.aciklama,
        tutar=hareket.tutar,
        tarih=hareket.tarih,
        saat=hareket.tarih.strftime("%H:%M"),
        kullanici=hareket.kullanici,
        kullanici_id=hareket.kullanici_id,
        belge_no=hareket.belge_no,
        not_=hareket.not_,
        admin_id=hareket.admin_id,
        admin_ad=hareket.admin_ad,
    )
    db.add(yeni_h)

    # Kasa günü toplamlarını güncelle
    tip = hareket.tip
    if tip == schemas.KasaHareketTipi.NAKIT_SATIS or tip == schemas.KasaHareketTipi.DIGER:
        gun.nakit_satis += hareket.tutar
    elif tip == schemas.KasaHareketTipi.KART:
        gun.kart_satis += hareket.tutar
    elif tip == schemas.KasaHareketTipi.HAVALE:
        gun.havale_satis += hareket.tutar
    elif tip == schemas.KasaHareketTipi.GIDER:
        gun.toplam_gider += hareket.tutar
    elif tip == schemas.KasaHareketTipi.CIKIS:
        gun.cikis_yapilan += hareket.tutar
    elif tip == schemas.KasaHareketTipi.ADMIN_ALIM:
        gun.admin_alimlar += hareket.tutar
        if hareket.admin_ad:
            ozet = gun.admin_ozet or {}
            ozet[hareket.admin_ad] = ozet.get(hareket.admin_ad, 0) + hareket.tutar
            gun.admin_ozet = ozet

    gun.gun_sonu_bakiyesi = hesapla_gun_sonu(gun)
    db.commit()
    return {"mesaj": "Hareket eklendi", "gun_sonu_bakiyesi": gun.gun_sonu_bakiyesi}

# ─── Satışların kasa özetini getir ───────────────────────────────────────────

@router.get("/satislar/{sube_kodu}")
def get_kasa_satislar(
    sube_kodu: str,
    gun: str = Query(..., description="YYYY-MM-DD"),
    filtre: str = Query("bugun", description="bugun|tahsilatlar"),
    db: Session = Depends(get_db),
    _user: models.User = Depends(auth.get_current_user)
):
    gun_baslangic = datetime.strptime(gun + " 00:00:00", "%Y-%m-%d %H:%M:%S")
    gun_bitis = datetime.strptime(gun + " 23:59:59", "%Y-%m-%d %H:%M:%S")

    satislar = db.query(models.Satis).filter(
        models.Satis.sube_kodu == sube_kodu,
        models.Satis.onay_durumu != models.OnayDurumuEnum.IPTAL
    ).all()

    sonuc = {
        "toplam_tutar": 0, "satis_adeti": 0,
        "toplam_nakit": 0, "toplam_kart": 0, "toplam_havale": 0,
        "tahsilat_tutar": 0, "satislar": []
    }

    for s in satislar:
        ot = s.olusturma_tarihi
        bu_gunun_satisi = ot and gun_baslangic <= ot <= gun_bitis

        nakit = s.pesinat_tutar or 0
        havale = s.havale_tutar or 0
        nakit_tarih = s.nakit_odeme_tarihi or s.olusturma_tarihi
        havale_tarih = s.havale_tarihi or s.olusturma_tarihi

        nakit_bu_gun = nakit_tarih and gun_baslangic <= nakit_tarih <= gun_bitis
        havale_bu_gun = havale_tarih and gun_baslangic <= havale_tarih <= gun_bitis

        kart_toplam = sum(
            k.tutar for k in s.kart_odemeler
            if k.tarih and gun_baslangic <= k.tarih <= gun_bitis
        )

        if filtre == "tahsilatlar":
            # Önceki günden gelen tahsilatlar
            if not bu_gunun_satisi and (nakit_bu_gun or havale_bu_gun or kart_toplam > 0):
                if nakit_bu_gun: sonuc["toplam_nakit"] += nakit
                if havale_bu_gun: sonuc["toplam_havale"] += havale
                if kart_toplam > 0: sonuc["toplam_kart"] += kart_toplam
                sonuc["tahsilat_tutar"] += (nakit if nakit_bu_gun else 0) + (havale if havale_bu_gun else 0) + kart_toplam
                sonuc["satis_adeti"] += 1
                sonuc["satislar"].append({
                    "id": s.id, "satis_kodu": s.satis_kodu,
                    "musteri_isim": s.musteri_isim, "tutar": s.toplam_tutar,
                    "nakit_tutar": nakit if nakit_bu_gun else 0,
                    "kart_tutar": kart_toplam, "havale_tutar": havale if havale_bu_gun else 0,
                    "onceki_gun_odemesi": True,
                })
        else:
            # Bu günün satışları
            if bu_gunun_satisi:
                sonuc["toplam_tutar"] += s.toplam_tutar or 0
                if nakit_bu_gun: sonuc["toplam_nakit"] += nakit
                if havale_bu_gun: sonuc["toplam_havale"] += havale
                if kart_toplam > 0: sonuc["toplam_kart"] += kart_toplam
                sonuc["tahsilat_tutar"] += (nakit if nakit_bu_gun else 0) + (havale if havale_bu_gun else 0) + kart_toplam
                sonuc["satis_adeti"] += 1
                sonuc["satislar"].append({
                    "id": s.id, "satis_kodu": s.satis_kodu,
                    "musteri_isim": s.musteri_isim, "tutar": s.toplam_tutar,
                    "nakit_tutar": nakit if nakit_bu_gun else 0,
                    "kart_tutar": kart_toplam, "havale_tutar": havale if havale_bu_gun else 0,
                    "onceki_gun_odemesi": False,
                })

    return sonuc