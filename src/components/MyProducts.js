import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { PREDEFINED_PRODUCTS } from '../constants/products';

export default function MyProducts() {
  const { currentUser, userData } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  const productRef = useRef();
  const quantityRef = useRef();
  const unitRef = useRef();
  const costRef = useRef();

  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const fetchProducts = async () => {
    if (!currentUser) return;
    try {
      const q = query(collection(db, "products"), where("supplierId", "==", currentUser.uid));
      const querySnapshot = await getDocs(q);
      const fetchedProducts = [];
      querySnapshot.forEach((doc) => {
        fetchedProducts.push({ id: doc.id, ...doc.data() });
      });
      setProducts(fetchedProducts);
    } catch (err) {
      console.error("Error fetching products:", err);
    }
    setLoading(false);
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    const productName = productRef.current.value;
    const quantity = parseInt(quantityRef.current.value, 10);
    const unit = unitRef.current.value;
    const cost = parseFloat(costRef.current.value);

    if (!productName || !unit || isNaN(quantity) || isNaN(cost)) {
      setError('Please fill out all fields correctly.');
      setIsSubmitting(false);
      return;
    }

    try {
      await addDoc(collection(db, 'products'), {
        supplierId: currentUser.uid,
        companyName: userData?.companyName || currentUser.email,
        name: productName,
        quantity: quantity,
        unit: unit,
        cost: cost,
        createdAt: serverTimestamp()
      });
      
      // Refresh list and close form
      await fetchProducts();
      setShowAddForm(false);
    } catch (err) {
      setError('Failed to add product: ' + err.message);
    }
    
    setIsSubmitting(false);
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: '600' }}>My Products</h2>
        <button className="btn-primary" onClick={() => setShowAddForm(!showAddForm)} style={{ marginTop: 0 }}>
          {showAddForm ? 'Cancel' : '+ Add Product'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {showAddForm && (
        <div className="form-container" style={{ padding: '2rem', border: '1px solid var(--border-color)', marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem', fontWeight: '500' }}>Add New Product</h3>
          <form onSubmit={handleAddProduct} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            <div className="form-group">
              <label className="form-label" htmlFor="product">Product</label>
              <select id="product" className="form-input" ref={productRef} required>
                <option value="">Select a product...</option>
                {PREDEFINED_PRODUCTS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" htmlFor="quantity">Total Quantity</label>
                <input type="number" id="quantity" className="form-input" ref={quantityRef} required min="1" placeholder="100" />
              </div>

              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" htmlFor="unit">Unit</label>
                <select id="unit" className="form-input" ref={unitRef} required>
                  <option value="units">Units</option>
                  <option value="kg">kg</option>
                  <option value="tons">Tons</option>
                  <option value="liters">Liters</option>
                  <option value="meters">Meters</option>
                  <option value="boxes">Boxes</option>
                </select>
              </div>
              
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" htmlFor="cost">Cost (per 1 unit)</label>
                <input type="number" id="cost" className="form-input" ref={costRef} required min="0.01" step="0.01" placeholder="50.00" />
              </div>
            </div>

            <button disabled={isSubmitting} className="btn-primary" type="submit">
              {isSubmitting ? <span className="spinner"></span> : 'Save Product'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <span className="spinner" style={{ width: '2rem', height: '2rem' }}></span>
        </div>
      ) : products.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)' }}>
          You have no products listed yet.
        </div>
      ) : (
        <div className="products-grid">
          {products.map(product => {
            const Icon = getProductIcon(product.name);
            return (
              <div key={product.id} className="product-card">
                <div className="product-icon-wrapper">
                  <Icon size={32} />
                </div>
                <h4 className="product-name">{product.name}</h4>
                <div className="product-details">
                  <div className="product-stat">
                    <span className="stat-label">Qty</span>
                    <span className="stat-value">{product.quantity} {product.unit || 'units'}</span>
                  </div>
                  <div className="product-stat">
                    <span className="stat-label">Cost</span>
                    <span className="stat-value">₹{Number(product.cost).toFixed(2)} / {product.unit === 'units' ? 'unit' : (product.unit || 'unit')}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Helper to assign icons to predefined products
function getProductIcon(name) {
  const n = name.toLowerCase();
  
  if (n.includes('iron') || n.includes('steel') || n.includes('copper') || n.includes('aluminum')) {
    return require('lucide-react').Database; // Representing raw materials/metals
  }
  if (n.includes('computer') || n.includes('laptop')) {
    return require('lucide-react').Monitor;
  }
  if (n.includes('chip') || n.includes('gpu') || n.includes('motherboard') || n.includes('wafer')) {
    return require('lucide-react').Cpu;
  }
  if (n.includes('batter')) {
    return require('lucide-react').Battery;
  }
  if (n.includes('box') || n.includes('pallet') || n.includes('wrap')) {
    return require('lucide-react').Box;
  }
  if (n.includes('motor') || n.includes('pump') || n.includes('compressor') || n.includes('belt')) {
    return require('lucide-react').Settings; // Machinery
  }
  if (n.includes('cable') || n.includes('display')) {
    return require('lucide-react').Plug;
  }
  
  return require('lucide-react').Package; // Fallback
}
