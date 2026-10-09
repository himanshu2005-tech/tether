import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import IndustryPicker from './IndustryPicker';

export default function Register() {
  const emailRef = useRef();
  const passwordRef = useRef();
  const passwordConfirmRef = useRef();
  const companyNameRef = useRef();
  const descriptionRef = useRef();
  const nameRef = useRef();
  
  const { signup } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState('consumer'); // default role
  const [industries, setIndustries] = useState([]);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();

    if (passwordRef.current.value !== passwordConfirmRef.current.value) {
      return setError('Passwords do not match');
    }
    if (role === 'supplier' && industries.length === 0) {
      return setError('Pick at least one industry you supply, so we can show you the right tenders.');
    }

    try {
      setError('');
      setLoading(true);
      
      const joining = role === 'team';
      const roleData = {
        role: joining ? 'consumer' : role,
        companyName: joining ? '' : companyNameRef.current.value,
        description: joining ? '' : descriptionRef.current.value,
        displayName: nameRef.current.value.trim(),
        ...(joining ? { joining: true } : {}),
        ...(role === 'supplier' ? { industries } : {})
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
        <p className="auth-subtitle">Set up your company in a minute.</p>
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
          >
            <option value="consumer">Buyer: I post tenders and pay invoices</option>
            <option value="supplier">Supplier: I bid on tenders and send invoices</option>
            <option value="team">Team member: my company admin invited me</option>
          </select>
        </div>

        {role === 'supplier' && (
          <div className="form-group">
            <label className="form-label">Your play area</label>
            <p className="form-help">Choose the industries you supply. You'll only see tenders for products in these industries. You can change this later in Profile.</p>
            <IndustryPicker value={industries} onChange={setIndustries} />
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="displayName">Your name</label>
          <input type="text" id="displayName" className="form-input" ref={nameRef} required placeholder="Priya Sharma" />
        </div>

        {role === 'team' && (
          <p className="form-help">Use the exact email address your admin invited. You'll join their company with the role they chose, so there's no company name to fill in.</p>
        )}

        {role !== 'team' && <>
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
        </>}

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
          {loading ? <span className="spinner"></span> : 'Create account'}
        </button>
      </form>
      
      <div className="auth-footer">
        Already have an account? <Link to="/login">Log In</Link>
      </div>
    </div>
  );
}
