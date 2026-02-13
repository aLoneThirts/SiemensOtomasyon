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
      setError('Giriş başarısız. Email veya şifre hatalı.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-left">
        <svg className="siemens-logo" viewBox="0 0 200 40" xmlns="http://www.w3.org/2000/svg">
          <text x="10" y="30" fontFamily="Arial, sans-serif" fontSize="32" fontWeight="bold" fill="white">
            SIEMENS
          </text>
        </svg>
        <div className="auth-welcome">
          <h1>İş Takip Sistemine Hoş Geldiniz</h1>
          <p>Satış süreçlerinizi kolayca yönetin, müşteri bilgilerinizi takip edin ve işletmenizi dijitalleştirin.</p>
        </div>
      </div>
      
      <div className="auth-right">
        <div className="auth-card">
          <h1>Giriş Yap</h1>
          <h2>Hesabınıza erişmek için giriş yapın</h2>
          
          {error && <div className="error-message">{error}</div>}
          
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>E-posta</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@email.com"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Şifre</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
            </button>
          </form>

          <div className="auth-link">
            Hesabınız yok mu? <Link to="/register">Kayıt Ol</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;