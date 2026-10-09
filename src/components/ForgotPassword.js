import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const emailRef = useRef();
  const { resetPassword } = useAuth();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      setMessage('');
      setError('');
      setLoading(true);
      await resetPassword(emailRef.current.value);
      setMessage('Check your inbox for further instructions');
    } catch (err) {
      setError('Failed to reset password: ' + err.message);
    }

    setLoading(false);
  }

  return (
    <div className="auth-card">
      <div className="auth-header">
        <h2 className="auth-title">Password Reset</h2>
        <p className="auth-subtitle">Enter your email to receive a reset link</p>
      </div>
      
      {error && <div className="error-message">{error}</div>}
      {message && <div className="success-message">{message}</div>}
      
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
        
        <button disabled={loading} className="btn-primary" type="submit">
          {loading ? <span className="spinner"></span> : 'Reset Password'}
        </button>
      </form>
      
      <div className="auth-footer">
        Remembered your password? <Link to="/login">Log In</Link>
      </div>
    </div>
  );
}
