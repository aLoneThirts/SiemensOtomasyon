import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SUBELER } from '../types/sube';
import { SubeKodu } from '../types/sube';
import { RegisterData } from '../types/user';
import './Auth.css';

const Register: React.FC = () => {
  const [formData, setFormData] = useState<RegisterData>({
    email: '',
    password: '',
    ad: '',
    soyad: '',
    subeKodu: SubeKodu.KARTAL
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== confirmPassword) {
      setError('Şifreler eşleşmiyor!');
      return;
    }

    if (formData.password.length < 6) {
      setError('Şifre en az 6 karakter olmalıdır!');
      return;
    }

    try {
      setError('');
      setLoading(true);
      await register(formData);
      navigate('/login');
    } catch (err: any) {
      setError(err.message || 'Kayıt yapılamadı!');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Siemens Otomasyon</h1>
        <h2>Kayıt Ol</h2>
        
        {error && <div className="error-message">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Şube Seçin</label>
            <select
              name="subeKodu"
              value={formData.subeKodu}
              onChange={handleChange}
              required
            >
              {SUBELER.map(sube => (
                <option key={sube.kod} value={sube.kod}>
                  {sube.ad}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Ad</label>
              <input
                type="text"
                name="ad"
                value={formData.ad}
                onChange={handleChange}
                placeholder="Adınız"
                required
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
                required
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
              required
            />
          </div>

          <div className="form-group">
            <label>Şifre</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Minimum 6 karakter"
              required
            />
          </div>

          <div className="form-group">
            <label>Şifre Tekrar</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Şifrenizi tekrar girin"
              required
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Kayıt Yapılıyor...' : 'Kayıt Ol'}
          </button>
        </form>

        <p className="auth-link">
          Zaten hesabın var mı? <a href="/login">Giriş Yap</a>
        </p>
      </div>
    </div>
  );
};

export default Register;
