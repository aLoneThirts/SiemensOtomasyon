# ================================================
#  routers/satis_router.py — Satış Endpoint'leri
# ================================================
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_
from database import get_db
from datetime import datetime, date
from typing import Optional
import models, schemas, auth
import uuid

router = APIRouter(prefix="/satislar", tags=["Satışlar"])

@router.get("")
def get_satislar(
    sube_kodu: str = Query(...),
    baslangic: Optional[str] = Query(None),  # "YYYY-MM-DD"
    bitis: Optional[str] = Query(None),
    odeme_durumu: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _user: models.User = Depends(auth.get_current_user)
):
    q = db.query(models.Satis).filter(models.Satis.sube_kodu == sube_kodu)
    
    if baslangic:
        q = q.filter(models.Satis.olusturma_tarihi >= datetime.strptime(baslangic, "%Y-%m-%d"))
    if bitis:
        q = q.filter(models.Satis.olusturma_tarihi <= datetime.strptime(bitis + " 23:59:59", "%Y-%m-%d %H:%M:%S"))
    if odeme_durumu:
        q = q.filter(models.Satis.odeme_durumu == odeme_durumu)
    
    satislar = q.order_by(models.Satis.olusturma_tarihi.desc()).all()
    return satislar

@router.get("/{satis_id}")
def get_satis(
    satis_id: str,
    db: Session = Depends(get_db),
    _user: models.User = Depends(auth.get_current_user)
):
    satis = db.query(models.Satis).filter(models.Satis.id == satis_id).first()
    if not satis:
        raise HTTPException(status_code=404, detail="Satış bulunamadı")
    return satis

@router.post("")
def create_satis(
    data: schemas.SatisCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(auth.get_current_user)
):
    satis_id = str(uuid.uuid4())
    
    satis = models.Satis(
        id=satis_id,
        satis_kodu=data.satis_kodu,
        sube_kodu=data.sube_kodu,
        musteri_isim=data.musteri_isim,
        musteri_adres=data.musteri_adres,
        musteri_cep=data.musteri_cep,
        musteri_vergi_no=data.musteri_vergi_no,
        musteri_vk_no=data.musteri_vk_no,
        musteri_vd=data.musteri_vd,
        musteri_temsilcisi=data.musteri_temsilcisi,
        musteri_temsilcisi_id=data.musteri_temsilcisi_id,
        toplam_tutar=data.toplam_tutar,
        pesinat_tutar=data.pesinat_tutar,
        havale_tutar=data.havale_tutar,
        odeme_durumu=data.odeme_durumu,
        odeme_yontemi=data.odeme_yontemi,
        odeme_ozeti=data.odeme_ozeti,
        fatura_no=data.fatura_no,
        servis_notu=data.servis_notu,
        fatura=data.fatura,
        ileri_teslim=data.ileri_teslim,
        servis=data.servis,
        tarih=data.tarih,
        teslimat_tarihi=data.teslimat_tarihi,
        nakit_odeme_tarihi=data.nakit_odeme_tarihi,
        havale_tarihi=data.havale_tarihi,
        olusturan_kullanici=data.olusturan_kullanici,
    )
    db.add(satis)

    # Ürünler
    for u in data.urunler:
        db.add(models.SatisUrun(
            satis_id=satis_id,
            urun_kodu=u.urun_kodu,
            urun_adi=u.urun_adi,
            adet=u.adet,
            alis_fiyati=u.alis_fiyati,
            bip=u.bip,
        ))

    # Kart ödemeler
    for k in data.kart_odemeler:
        db.add(models.KartOdeme(
            id=k.id or str(uuid.uuid4()),
            satis_id=satis_id,
            banka=k.banka,
            taksit_sayisi=k.taksit_sayisi,
            tutar=k.tutar,
            pesinat=k.pesinat,
            kesinti_orani=k.kesinti_orani,
            tarih=k.tarih,
        ))

    db.commit()
    db.refresh(satis)
    return satis

@router.put("/{satis_id}/iptal")
def satis_iptal(
    satis_id: str,
    iptal_yapan: str,
    iptal_yapan_id: str,
    db: Session = Depends(get_db),
    _user: models.User = Depends(auth.get_current_user)
):
    satis = db.query(models.Satis).filter(models.Satis.id == satis_id).first()
    if not satis:
        raise HTTPException(status_code=404, detail="Satış bulunamadı")
    
    satis.onay_durumu = models.OnayDurumuEnum.IPTAL
    satis.iptal_durumu = "iptal"
    satis.iptal_tarihi = datetime.now()

    # Kasa iptal kaydı oluştur
    nakit = satis.pesinat_tutar or 0
    havale = satis.havale_tutar or 0
    kart = sum(k.tutar for k in satis.kart_odemeler)

    if nakit + havale + kart > 0:
        db.add(models.KasaIptalKayit(
            satis_id=satis_id,
            satis_kodu=satis.satis_kodu,
            musteri_isim=satis.musteri_isim,
            sube_kodu=satis.sube_kodu,
            nakit_tutar=-nakit if nakit > 0 else 0,
            kart_tutar=-kart if kart > 0 else 0,
            havale_tutar=-havale if havale > 0 else 0,
            iptal_tarihi=datetime.now().strftime("%Y-%m-%d"),
            satis_tarihi=satis.olusturma_tarihi.strftime("%Y-%m-%d") if satis.olusturma_tarihi else None,
            iptal_yapan=iptal_yapan,
            iptal_yapan_id=iptal_yapan_id,
            aciklama=f"Satış iptali iadesi — {satis.satis_kodu}",
            orijinal_nakit=nakit,
            orijinal_kart=kart,
            orijinal_havale=havale,
            orijinal_toplam=nakit + havale + kart,
        ))

    db.commit()
    return {"mesaj": "Satış iptal edildi"}

@router.get("/son-kod/{sube_kodu}")
def get_son_satis_kodu(
    sube_kodu: str,
    db: Session = Depends(get_db),
    _user: models.User = Depends(auth.get_current_user)
):
    son = db.query(models.Satis).filter(
        models.Satis.sube_kodu == sube_kodu
    ).order_by(models.Satis.satis_kodu.desc()).first()
    
    return {"son_kod": son.satis_kodu if son else None}