# ================================================
#  migrate_firebase.py — Firebase → SQL Server
#  TÜM KOLEKSİYONLAR
# ================================================
import firebase_admin
from firebase_admin import credentials, firestore
import sys, os, uuid
from datetime import datetime

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database import SessionLocal, engine
from models import Base, User, Satis, SatisUrun, KartOdeme, KasaGun, KasaHareket
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, JSON, Text
from sqlalchemy.sql import func
from database import Base as DbBase

# ─── Ek tablolar ─────────────────────────────────────────────────────────────

class BankaKesinti(DbBase):
    __tablename__ = "banka_kesintiler"
    __table_args__ = {'extend_existing': True}
    id             = Column(String(100), primary_key=True)
    banka          = Column(String(100))
    taksitler      = Column(JSON)
    guncelleme_tarihi = Column(DateTime)

class Kampanya(DbBase):
    __tablename__ = "kampanyalar"
    __table_args__ = {'extend_existing': True}
    id             = Column(String(100), primary_key=True)
    ad             = Column(String(200))
    tutar          = Column(Float, default=0)
    aciklama       = Column(Text, nullable=True)
    aktif          = Column(Boolean, default=True)
    created_at     = Column(DateTime, server_default=func.now())

class Urun(DbBase):
    __tablename__ = "urunler"
    __table_args__ = {'extend_existing': True}
    id             = Column(String(100), primary_key=True)
    kod            = Column(String(100))
    ad             = Column(String(200))
    alis_fiyati    = Column(Float, default=0)
    bip            = Column(Float, nullable=True)
    aktif          = Column(Boolean, default=True)
    created_at     = Column(DateTime, server_default=func.now())

class YesilEtiket(DbBase):
    __tablename__ = "yesil_etiketler"
    __table_args__ = {'extend_existing': True}
    id             = Column(String(100), primary_key=True)
    urun_kodu      = Column(String(100))
    ad             = Column(String(200))
    alis_fiyati    = Column(Float, default=0)
    tutar          = Column(Float, default=0)
    created_at     = Column(DateTime, server_default=func.now())

class MagazaHedef(DbBase):
    __tablename__ = "magaza_hedefler"
    __table_args__ = {'extend_existing': True}
    id             = Column(String(100), primary_key=True)
    sube_kodu      = Column(String(50))
    ay             = Column(String(10))
    hedef          = Column(Float, default=0)
    created_at     = Column(DateTime, server_default=func.now())

class KullaniciBildirim(DbBase):
    __tablename__ = "kullanici_bildirimler"
    __table_args__ = {'extend_existing': True}
    id             = Column(String(100), primary_key=True)
    kullanici_id   = Column(String(128))
    mesaj          = Column(Text)
    okundu         = Column(Boolean, default=False)
    created_at     = Column(DateTime, server_default=func.now())

class Sube(DbBase):
    __tablename__ = "sube_bilgileri"
    __table_args__ = {'extend_existing': True}
    id             = Column(String(100), primary_key=True)
    kod            = Column(String(50))
    ad             = Column(String(200))
    adres          = Column(Text, nullable=True)
    aktif          = Column(Boolean, default=True)

# ─── Firebase Bağlantısı ─────────────────────────────────────────────────────

cred = credentials.Certificate("firebase-key.json")
firebase_admin.initialize_app(cred, {"projectId": "siemensotomasyon-a4039"})
fb = firestore.client()

# ─── Yardımcılar ─────────────────────────────────────────────────────────────

def to_date(val):
    if val is None: return None
    if hasattr(val, 'todate'): return val.todate()
    if hasattr(val, '_seconds'): return datetime.fromtimestamp(val._seconds)
    if isinstance(val, datetime): return val
    try: return datetime.fromisoformat(str(val))
    except: return None

def safe_str(val, default=''):
    if val is None: return default
    return str(val).strip()

def safe_float(val, default=0.0):
    try: return float(val or 0)
    except: return default

# ─── Tabloları oluştur ────────────────────────────────────────────────────────

print("📦 SQL tabloları oluşturuluyor...")
Base.metadata.create_all(bind=engine)
DbBase.metadata.create_all(bind=engine)
db = SessionLocal()

# ─── 1. USERS ────────────────────────────────────────────────────────────────

print("\n👤 Users migre ediliyor...")
user_count = 0
for doc in fb.collection('users').stream():
    data = doc.to_dict()
    if db.query(User).filter(User.uid == doc.id).first():
        print(f"  ⏭️  Zaten var: {data.get('email', doc.id)}")
        continue
    try:
        db.add(User(
            uid=doc.id,
            email=safe_str(data.get('email'), f'{doc.id}@unknown.com'),
            hashed_password='$2b$12$placeholder',
            ad=safe_str(data.get('ad'), 'Bilinmiyor'),
            soyad=safe_str(data.get('soyad'), ''),
            role=safe_str(data.get('role'), 'CALISAN'),
            sube_kodu=safe_str(data.get('subeKodu'), 'KARTAL'),
            hedef=safe_float(data.get('hedef')),
            hedefler=data.get('hedefler'),
            created_at=to_date(data.get('createdAt')),
        ))
        user_count += 1
        print(f"  ✅ {data.get('email', doc.id)}")
    except Exception as e:
        print(f"  ❌ {doc.id}: {e}")
db.commit()
print(f"✅ {user_count} user")

# ─── 2. BANKA KESİNTİLER ─────────────────────────────────────────────────────

print("\n🏦 Banka kesintiler migre ediliyor...")
banka_count = 0
for doc in fb.collection('bankaKesintiler').stream():
    data = doc.to_dict()
    if db.query(BankaKesinti).filter(BankaKesinti.id == doc.id).first():
        continue
    try:
        db.add(BankaKesinti(
            id=doc.id,
            banka=safe_str(data.get('banka')),
            taksitler=data.get('taksitler'),
            guncelleme_tarihi=to_date(data.get('guncellemeTarihi')),
        ))
        banka_count += 1
        print(f"  ✅ {data.get('banka', doc.id)}")
    except Exception as e:
        print(f"  ❌ {doc.id}: {e}")
db.commit()
print(f"✅ {banka_count} banka kesinti")

# ─── 3. KAMPANYALAR ──────────────────────────────────────────────────────────

print("\n🎁 Kampanyalar migre ediliyor...")
kampanya_count = 0
for doc in fb.collection('kampanyalar').stream():
    data = doc.to_dict()
    if db.query(Kampanya).filter(Kampanya.id == doc.id).first():
        continue
    try:
        db.add(Kampanya(
            id=doc.id,
            ad=safe_str(data.get('ad')),
            tutar=safe_float(data.get('tutar')),
            aciklama=safe_str(data.get('aciklama')),
            aktif=bool(data.get('aktif', True)),
        ))
        kampanya_count += 1
        print(f"  ✅ {data.get('ad', doc.id)}")
    except Exception as e:
        print(f"  ❌ {doc.id}: {e}")
db.commit()
print(f"✅ {kampanya_count} kampanya")

# ─── 4. ÜRÜNLER ──────────────────────────────────────────────────────────────

print("\n📦 Ürünler migre ediliyor...")
urun_count = 0
for doc in fb.collection('urunler').stream():
    data = doc.to_dict()
    if db.query(Urun).filter(Urun.id == doc.id).first():
        continue
    try:
        db.add(Urun(
            id=doc.id,
            kod=safe_str(data.get('kod')),
            ad=safe_str(data.get('ad')),
            alis_fiyati=safe_float(data.get('alisFiyati')),
            bip=safe_float(data.get('bip')) if data.get('bip') else None,
            aktif=bool(data.get('aktif', True)),
        ))
        urun_count += 1
        print(f"  ✅ {data.get('ad', doc.id)}")
    except Exception as e:
        print(f"  ❌ {doc.id}: {e}")
db.commit()
print(f"✅ {urun_count} ürün")

# ─── 5. YEŞİL ETİKETLER ──────────────────────────────────────────────────────

print("\n🏷️  Yeşil etiketler migre ediliyor...")
etiket_count = 0
for doc in fb.collection('yesilEtiketler').stream():
    data = doc.to_dict()
    if db.query(YesilEtiket).filter(YesilEtiket.id == doc.id).first():
        continue
    try:
        db.add(YesilEtiket(
            id=doc.id,
            urun_kodu=safe_str(data.get('urunKodu')),
            ad=safe_str(data.get('ad')),
            alis_fiyati=safe_float(data.get('alisFiyati')),
            tutar=safe_float(data.get('tutar')),
        ))
        etiket_count += 1
        print(f"  ✅ {data.get('ad', doc.id)}")
    except Exception as e:
        print(f"  ❌ {doc.id}: {e}")
db.commit()
print(f"✅ {etiket_count} yeşil etiket")

# ─── 6. MAGAZA HEDEFLER ──────────────────────────────────────────────────────

print("\n🎯 Mağaza hedefler migre ediliyor...")
hedef_count = 0
for doc in fb.collection('magazaHedefler').stream():
    data = doc.to_dict()
    if db.query(MagazaHedef).filter(MagazaHedef.id == doc.id).first():
        continue
    try:
        db.add(MagazaHedef(
            id=doc.id,
            sube_kodu=safe_str(data.get('subeKodu')),
            ay=safe_str(data.get('ay')),
            hedef=safe_float(data.get('hedef')),
        ))
        hedef_count += 1
        print(f"  ✅ {data.get('subeKodu', doc.id)} - {data.get('ay', '')}")
    except Exception as e:
        print(f"  ❌ {doc.id}: {e}")
db.commit()
print(f"✅ {hedef_count} mağaza hedef")

# ─── 7. KULLANİCI BİLDİRİMLER ────────────────────────────────────────────────

print("\n🔔 Kullanıcı bildirimler migre ediliyor...")
bildirim_count = 0
for doc in fb.collection('kullaniciBildirimler').stream():
    data = doc.to_dict()
    if db.query(KullaniciBildirim).filter(KullaniciBildirim.id == doc.id).first():
        continue
    try:
        db.add(KullaniciBildirim(
            id=doc.id,
            kullanici_id=safe_str(data.get('kullaniciId')),
            mesaj=safe_str(data.get('mesaj')),
            okundu=bool(data.get('okundu', False)),
            created_at=to_date(data.get('createdAt')),
        ))
        bildirim_count += 1
        print(f"  ✅ {doc.id}")
    except Exception as e:
        print(f"  ❌ {doc.id}: {e}")
db.commit()
print(f"✅ {bildirim_count} bildirim")

# ─── 8. SUBELER ──────────────────────────────────────────────────────────────

print("\n🏪 Şubeler migre ediliyor...")
sube_count = 0
for doc in fb.collection('subeler').stream():
    data = doc.to_dict()
    if db.query(Sube).filter(Sube.id == doc.id).first():
        continue
    try:
        db.add(Sube(
            id=doc.id,
            kod=safe_str(data.get('kod')),
            ad=safe_str(data.get('ad')),
            adres=safe_str(data.get('adres')),
            aktif=bool(data.get('aktif', True)),
        ))
        sube_count += 1
        print(f"  ✅ {data.get('ad', doc.id)}")
    except Exception as e:
        print(f"  ❌ {doc.id}: {e}")
db.commit()
print(f"✅ {sube_count} şube")

# ─── 9. SATIŞLAR ─────────────────────────────────────────────────────────────

print("\n🛒 Satışlar migre ediliyor...")
satis_count = 0
SUBELER = ['kartal', 'pendik', 'sancaktepe', 'buyaka', 'soğanlık']

for sube_path in SUBELER:
    print(f"\n  📍 Şube: {sube_path}")
    try:
        satislar = list(fb.collection(f'subeler/{sube_path}/satislar').stream())
    except:
        print(f"  ⚠️  Atlandı")
        continue

    for doc in satislar:
        data = doc.to_dict()
        if db.query(Satis).filter(Satis.id == doc.id).first():
            print(f"    ⏭️  Zaten var: {data.get('satisKodu', doc.id)}")
            continue
        try:
            musteri = data.get('musteriBilgileri', {}) or {}
            onay = data.get('onayDurumu')
            if onay == True or onay == 'ONAYLANDI': onay_str = 'ONAYLANDI'
            elif onay == 'iptal' or onay == False: onay_str = 'IPTAL'
            else: onay_str = 'BEKLIYOR'

            satis = Satis(
                id=doc.id,
                satis_kodu=safe_str(data.get('satisKodu'), doc.id),
                sube_kodu=safe_str(data.get('subeKodu'), sube_path.upper()),
                musteri_isim=safe_str(musteri.get('isim') or data.get('musteriIsim'), 'Bilinmiyor'),
                musteri_adres=safe_str(musteri.get('adres')),
                musteri_cep=safe_str(musteri.get('cep')),
                musteri_vergi_no=safe_str(musteri.get('vergiNumarasi')),
                musteri_vk_no=safe_str(musteri.get('vkNo')),
                musteri_vd=safe_str(musteri.get('vd')),
                musteri_temsilcisi=safe_str(data.get('musteriTemsilcisi')),
                musteri_temsilcisi_id=safe_str(data.get('musteriTemsilcisiId')),
                toplam_tutar=safe_float(data.get('toplamTutar')),
                pesinat_tutar=safe_float(data.get('pesinatTutar')),
                havale_tutar=safe_float(data.get('havaleTutar')),
                odeme_durumu=safe_str(data.get('odemeDurumu'), 'ACIK_HESAP').replace('ÖDENDİ','ODENDI').replace('AÇIK HESAP','ACIK_HESAP'),
                odeme_yontemi=safe_str(data.get('odemeYontemi')),
                odeme_ozeti=data.get('odemeOzeti'),
                fatura_no=safe_str(data.get('faturaNo')),
                servis_notu=safe_str(data.get('servisNotu')),
                mars_no=safe_str(data.get('marsNo')),
                fatura=bool(data.get('fatura', False)),
                ileri_teslim=bool(data.get('ileriTeslim', False)),
                servis=bool(data.get('servis', False)),
                teslim_edildi_mi=bool(data.get('teslimEdildiMi', False)),
                onay_durumu=onay_str,
                tarih=to_date(data.get('tarih')),
                teslimat_tarihi=to_date(data.get('teslimatTarihi')),
                nakit_odeme_tarihi=to_date(data.get('nakitOdemeTarihi')),
                havale_tarihi=to_date(data.get('havaleTarihi')),
                ileri_teslim_tarihi=to_date(data.get('ileriTeslimTarihi')),
                ileri_teslim_statusu=safe_str(data.get('ileriTeslimStatusu')),
                ileri_teslim_notu=safe_str(data.get('ileriTeslimNotu')),
                satis_statusu=safe_str(data.get('satisStatusu')),
                iptal_talebi=bool(data.get('iptalTalebi', False)),
                iptal_durumu=safe_str(data.get('iptalDurumu')),
                iptal_tarihi=to_date(data.get('iptalTarihi')),
                olusturan_kullanici=safe_str(data.get('olusturanKullanici')),
                olusturma_tarihi=to_date(data.get('olusturmaTarihi')),
                guncelleme_tarihi=to_date(data.get('guncellemeTarihi')),
            )
            db.add(satis)

            for u in (data.get('urunler') or []):
                db.add(SatisUrun(
                    satis_id=doc.id,
                    urun_kodu=safe_str(u.get('kod') or u.get('urunKodu')),
                    urun_adi=safe_str(u.get('ad') or u.get('urunAdi')),
                    adet=int(u.get('adet') or 1),
                    alis_fiyati=safe_float(u.get('alisFiyati')),
                    bip=safe_float(u.get('bip')) if u.get('bip') else None,
                ))

            for k in (data.get('kartOdemeler') or []):
                db.add(KartOdeme(
                    id=safe_str(k.get('id'), str(uuid.uuid4())),
                    satis_id=doc.id,
                    banka=safe_str(k.get('banka')),
                    taksit_sayisi=int(k.get('taksitSayisi') or 1),
                    tutar=safe_float(k.get('tutar')),
                    pesinat=safe_float(k.get('pesinat')) if k.get('pesinat') else None,
                    kesinti_orani=safe_float(k.get('kesintiOrani')) if k.get('kesintiOrani') else None,
                    tarih=to_date(k.get('tarih')),
                ))

            db.commit()
            satis_count += 1
            print(f"    ✅ {data.get('satisKodu', doc.id)}")
        except Exception as e:
            db.rollback()
            print(f"    ❌ {doc.id}: {e}")

print(f"\n✅ {satis_count} satış")

# ─── 10. KASA GÜNLER ─────────────────────────────────────────────────────────

print("\n💰 Kasa günleri migre ediliyor...")
kasa_count = 0
TIP_MAP = {'NAKİT SATIŞ':'NAKIT_SATIS','GİDER':'GIDER','ÇIKIŞ':'CIKIS','ADMİN ALIM':'ADMIN_ALIM','DİĞER':'DIGER'}

for sube_kodu in ['KARTAL','PENDIK','SANCAKTEPE','BUYAKA_AVM','MALTEPE']:
    try:
        gunler = list(fb.collection(f'kasalar/{sube_kodu}/gunler').stream())
    except:
        continue
    for doc in gunler:
        data = doc.to_dict()
        gun_id = f"{sube_kodu}_{doc.id}"
        if db.query(KasaGun).filter(KasaGun.id == gun_id).first():
            continue
        try:
            db.add(KasaGun(
                id=gun_id, gun=doc.id, sube_kodu=sube_kodu,
                durum=safe_str(data.get('durum'), 'KAPALI'),
                acilis_bakiyesi=safe_float(data.get('acilisBakiyesi')),
                gun_sonu_bakiyesi=safe_float(data.get('gunSonuBakiyesi')),
                nakit_satis=safe_float(data.get('nakitSatis')),
                toplam_gider=safe_float(data.get('toplamGider')),
                cikis_yapilan=safe_float(data.get('cikisYapilanPara')),
                admin_alimlar=safe_float(data.get('adminAlimlar')),
                kart_satis=safe_float(data.get('kartSatis')),
                havale_satis=safe_float(data.get('havaleSatis')),
                admin_ozet=data.get('adminOzet', {}),
                acilis_yapan=safe_str(data.get('acilisYapan')),
                olusturma_tarihi=to_date(data.get('olusturmaTarihi')),
                guncelleme_tarihi=to_date(data.get('guncellemeTarihi')),
            ))
            for h in (data.get('hareketler') or []):
                tip = safe_str(h.get('tip'), 'DIGER')
                db.add(KasaHareket(
                    id=safe_str(h.get('id'), str(uuid.uuid4())),
                    kasa_gun_id=gun_id, sube_kodu=sube_kodu,
                    tip=TIP_MAP.get(tip, tip),
                    aciklama=safe_str(h.get('aciklama')),
                    tutar=safe_float(h.get('tutar')),
                    tarih=to_date(h.get('tarih')) or datetime.now(),
                    saat=safe_str(h.get('saat')),
                    kullanici=safe_str(h.get('kullanici')),
                    kullanici_id=safe_str(h.get('kullaniciId')),
                    admin_id=safe_str(h.get('adminId')),
                    admin_ad=safe_str(h.get('adminAd')),
                ))
            db.commit()
            kasa_count += 1
            print(f"  ✅ {sube_kodu} - {doc.id}")
        except Exception as e:
            db.rollback()
            print(f"  ❌ {doc.id}: {e}")

print(f"✅ {kasa_count} kasa günü")

db.close()
print("\n" + "="*50)
print("🎉 MİGRASYON TAMAMLANDI!")
print("="*50)