# ================================================
#  database.py — SQLAlchemy Bağlantısı
# ================================================
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from config import settings

engine = create_engine(
    settings.DATABASE_URL,
    echo=False,  # SQL sorgularını loglamak için True yap
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Dependency injection için
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()