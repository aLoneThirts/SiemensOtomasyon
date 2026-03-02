import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      setError('Lütfen tüm alanları doldurun');
      return;
    }

    try {
      setError('');
      setLoading(true);
      await login(email, password);
      navigate('/dashboard');
    } catch (error: any) {
      console.error('Login error:', error);
      
      if (error.code === 'auth/user-not-found') {
        setError('Bu email adresiyle kayıtlı kullanıcı bulunamadı.');
      } else if (error.code === 'auth/wrong-password') {
        setError('Şifre hatalı.');
      } else if (error.code === 'auth/invalid-email') {
        setError('Geçersiz email adresi.');
      } else if (error.code === 'auth/too-many-requests') {
        setError('Çok fazla başarısız giriş denemesi. Lütfen daha sonra tekrar deneyin.');
      } else if (error.code === 'auth/invalid-credential') {
        setError('Email veya şifre hatalı.');
      } else {
        setError(error.message || 'Giriş başarısız. Email veya şifre hatalı.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-left">
        {/* TÜFEKÇİ HOME LOGO */}
        <div className="brand-logo">
          <img src="/tufekci-logo.jpeg" alt="Tüfekçi Home" />
          <div className="brand-text">
            <h2>TÜFEKÇİ HOME</h2>
            <p>SIEMENS</p>
          </div>
        </div>

        {/* HOŞGELDİN YAZISI */}
        <div className="auth-welcome">
          <h1>Hoş Geldiniz</h1>
          <p>Satış takip ve yönetim sisteminize giriş yaparak işlemlerinizi kolayca yönetin.</p>
        </div>

        {/* NEXLEDGER — Powered by Badge */}
        <div className="nexledger-badge">
          <img src="/nexledger-logo.png" alt="NexLedger" />
          <div className="nexledger-badge-text">
            <span className="powered">POWERED BY</span>
            <span className="nexledger-name">NEXLEDGER</span>
          </div>
        </div>
      </div>
      
      <div className="auth-right">
        <div className="auth-card">
          <h1>Giriş Yap</h1>
          <h2>Hesabınıza erişmek için giriş yapın</h2>
          
          {error && <div className="error-message">{error}</div>}
          
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">E-posta</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@email.com"
                disabled={loading}
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Şifre</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
                autoComplete="current-password"
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
            </button>
          </form>

          {/* NEXLEDGER FOOTER */}
          <div className="nexledger-footer">
            <img src="/nexledger-logo.png" alt="NexLedger" />
            <span>NEXLEDGER</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;