# ================================================
#  routers/auth_router.py — Auth Endpoint'leri
# ================================================
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models, schemas, auth
import uuid

router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/login", response_model=schemas.TokenResponse)
def login(data: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == data.email).first()
    if not user or not auth.verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Email veya şifre hatalı")
    
    token = auth.create_token({"sub": user.uid})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }

@router.post("/register", response_model=schemas.UserResponse)
def register(
    data: schemas.UserCreate,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin)
):
    if db.query(models.User).filter(models.User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Bu email zaten kayıtlı")
    
    user = models.User(
        uid=str(uuid.uuid4()),
        email=data.email,
        hashed_password=auth.hash_password(data.password),
        ad=data.ad,
        soyad=data.soyad,
        role=data.role,
        sube_kodu=data.sube_kodu,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@router.get("/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user

@router.get("/users", response_model=list[schemas.UserResponse])
def get_users(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin)
):
    return db.query(models.User).all()