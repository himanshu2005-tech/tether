import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';

export default function Register() {
  const emailRef = useRef();
  const passwordRef = useRef();
  const passwordConfirmRef = useRef();
  const companyNameRef = useRef();
  const descriptionRef = useRef();
  
  const { signup } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState('consumer'); // default role
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();

    if (passwordRef.current.value !== passwordConfirmRef.current.value) {
      return setError('Passwords do not match');
    }

    try {
      setError('');
      setLoading(true);
      
      const roleData = {
        role: role,
        companyName: companyNameRef.current.value,
        description: descriptionRef.current.value
      };

      await signup(emailRef.current.value, passwordRef.current.value, roleData);
      navigate('/');
    } catch (err) {
      setError('Failed to create an account: ' + err.message);
    }

    setLoading(false);
  }

  return (
    <div className="auth-card">
      <div className="auth-header">
        <h2 className="auth-title">Create Account</h2>
        <p className="auth-subtitle">Join us to start tethering</p>
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="form-group">
          <label className="form-label" htmlFor="role">Account Type</label>
          <select 
            id="role" 
            className="form-input" 
            value={role} 
            onChange={(e) => setRole(e.target.value)}
            style={{ appearance: 'none', cursor: 'pointer' }}
          >
            <option value="consumer">Consumer</option>
            <option value="supplier">Supplier</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="companyName">Company Name</label>
          <input 
            type="text" 
            id="companyName"
            className="form-input" 
            ref={companyNameRef} 
            required 
            placeholder="Acme Corp"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="description">Description</label>
          <input 
            type="text" 
            id="description"
            className="form-input" 
            ref={descriptionRef} 
            required 
            placeholder="What does your company do?"
          />
        </div>

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
          <label className="form-label" htmlFor="password">Password</label>
          <input 
            type="password" 
            id="password"
            className="form-input" 
            ref={passwordRef} 
            required 
            placeholder="••••••••"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="password-confirm">Confirm Password</label>
          <input 
            type="password" 
            id="password-confirm"
            className="form-input" 
            ref={passwordConfirmRef} 
            required 
            placeholder="••••••••"
          />
        </div>
        
        <button disabled={loading} className="btn-primary" type="submit">
          {loading ? <span className="spinner"></span> : 'Sign Up'}
        </button>
      </form>
      
      <div className="auth-footer">
        Already have an account? <Link to="/login">Log In</Link>
      </div>
    </div>
  );
}
