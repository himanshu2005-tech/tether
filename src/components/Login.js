import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';

export default function Login() {
  const emailRef = useRef();
  const passwordRef = useRef();
  const { login } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      setError('');
      setLoading(true);
      await login(emailRef.current.value, passwordRef.current.value);
      navigate('/');
    } catch (err) {
      setError('Failed to log in: ' + err.message);
    }

    setLoading(false);
  }

  return (
    <div className="auth-card">
      <div className="auth-header">
        <h2 className="auth-title">Welcome back</h2>
        <p className="auth-subtitle">Sign in to continue.</p>
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="form-group">
          <label className="form-label" htmlFor="email">Email</label>
          <input 
            type="email" 
            id="email"
            className="form-input" 
            ref={emailRef} 
            required 
            placeholder="you@example.com"
          />
        </div>
        
        <div className="form-group">
          <div className="row-between">
            <label className="form-label" htmlFor="password">Password</label>
            <Link to="/forgot-password" className="small-link">Forgot Password?</Link>
          </div>
          <input 
            type="password" 
            id="password"
            className="form-input" 
            ref={passwordRef} 
            required 
            placeholder="••••••••"
          />
        </div>
        
        <button disabled={loading} className="btn-primary" type="submit">
          {loading ? <span className="spinner"></span> : 'Sign in'}
        </button>
      </form>
      
      <div className="auth-footer">
        Don't have an account? <Link to="/register">Sign Up</Link>
      </div>
    </div>
  );
}
