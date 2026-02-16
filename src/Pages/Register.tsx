import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SUBELER } from '../types/sube';
import './Auth.css';

const Register: React.FC = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    ad: '',
    soyad: '',
    subeKodu: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.email || !formData.password || !formData.ad || !formData.soyad || !formData.subeKodu) {
      setError('Lütfen tüm alanları doldurun');
      return;
    }

    if (formData.password.length < 6) {
      setError('Şifre en az 6 karakter olmalıdır');
      return;
    }

    try {
      setError('');
      setLoading(true);
      await register({
        email: formData.email,
        password: formData.password,
        ad: formData.ad,
        soyad: formData.soyad,
        subeKodu: formData.subeKodu as any
      });
      navigate('/dashboard');
    } catch (error: any) {
      setError(error.message || 'Kayıt başarısız oldu');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="auth-container">
      <div className="auth-left">
        {/* LOGO RESMİ */}
        <div className="brand-logo">
          <img src="/tufekci-logo.jpeg" alt="Tüfekçi Home" />
          <div className="brand-text">
            <h2>TÜFEKÇİ HOME</h2>
            <p>SIEMENS</p>
          </div>
        </div>

        <div className="auth-welcome">
          <h1>Takımınıza Katılın</h1>
          <p>Profesyonel iş takip sistemimizle satış süreçlerinizi optimize edin ve verimliliğinizi artırın.</p>
        </div>
      </div>
      
      <div className="auth-right">
        <div className="auth-card">
          <h1>Kayıt Ol</h1>
          <h2>Yeni hesap oluşturun</h2>
          
          {error && <div className="error-message">{error}</div>}
          
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Ad</label>
                <input
                  type="text"
                  name="ad"
                  value={formData.ad}
                  onChange={handleChange}
                  placeholder="Adınız"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Soyad</label>
                <input
                  type="text"
                  name="soyad"
                  value={formData.soyad}
                  onChange={handleChange}
                  placeholder="Soyadınız"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="form-group">
              <label>E-posta</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="ornek@email.com"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Şifre</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="En az 6 karakter"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Şube</label>
              <select
                name="subeKodu"
                value={formData.subeKodu}
                onChange={handleChange}
                disabled={loading}
              >
                <option value="">Şube Seçiniz</option>
                {SUBELER.map(sube => (
                  <option key={sube.kod} value={sube.kod}>
                    {sube.ad}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Kayıt Yapılıyor...' : 'Kayıt Ol'}
            </button>
          </form>

          <div className="auth-link">
            Zaten hesabınız var mı? <Link to="/login">Giriş Yap</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;