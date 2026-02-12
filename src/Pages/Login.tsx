import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SUBELER } from '../types/sube';
import { SubeKodu } from '../types/sube';
import './Auth.css';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [subeKodu, setSubeKodu] = useState<SubeKodu>(SubeKodu.KARTAL);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setError('');
      setLoading(true);
      await login(email, password, subeKodu);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Giriş yapılamadı!');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Siemens Otomasyon</h1>
        <h2>Giriş Yap</h2>
        
        {error && <div className="error-message">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Şube Seçin</label>
            <select
              value={subeKodu}
              onChange={(e) => setSubeKodu(e.target.value as SubeKodu)}
              required
            >
              {SUBELER.map(sube => (
                <option key={sube.kod} value={sube.kod}>
                  {sube.ad}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>E-posta</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ornek@email.com"
              required
            />
          </div>

          <div className="form-group">
            <label>Şifre</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              required
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>

        <p className="auth-link">
          Hesabın yok mu? <a href="/register">Kayıt Ol</a>
        </p>
      </div>
    </div>
  );
};

export default Login;
