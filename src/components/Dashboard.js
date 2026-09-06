import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { PREDEFINED_PRODUCTS } from '../constants/products';
import { Building, AlertTriangle, Send } from 'lucide-react';

export default function Dashboard() {
  const { currentUser, userData } = useAuth();
  
  const [searchResults, setSearchResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  
  // Track which items have been requested
  const [requestedItems, setRequestedItems] = useState({});

  // Refs for search inputs
  const searchProductRef = useRef();
  const searchQuantityRef = useRef();
  const sortRef = useRef();

  const handleSearch = async (e) => {
    e.preventDefault();
    setError('');
    setIsSearching(true);
    setHasSearched(true);
    setSearchResults([]);

    const product = searchProductRef.current.value;
    const reqQty = parseInt(searchQuantityRef.current.value, 10);
    const sortOption = sortRef.current.value;

    if (!product) {
      setError("Please select a product to search.");
      setIsSearching(false);
      return;
    }

    try {
      // Fetch user limits
      let userLimits = {};
      try {
        const limitsDoc = await getDoc(doc(db, 'limits', currentUser.uid));
        if (limitsDoc.exists()) {
          userLimits = limitsDoc.data().limits || {};
        }
      } catch (e) {
        console.error("Error fetching limits:", e);
      }

      // Query Firestore for matching products
      const q = query(collection(db, "products"), where("name", "==", product));
      const querySnapshot = await getDocs(q);
      
      let results = [];
      querySnapshot.forEach((document) => {
        results.push({ id: document.id, ...document.data() });
      });

      // Dynamically fetch companyName for older products that don't have it saved
      results = await Promise.all(results.map(async (item) => {
        if (!item.companyName && item.supplierId) {
          try {
            const userSnap = await getDoc(doc(db, 'users', item.supplierId));
            if (userSnap.exists()) {
              item.companyName = userSnap.data().companyName || userSnap.data().email;
            }
          } catch (err) {
            console.error("Error fetching supplier data:", err);
          }
        }
        return item;
      }));

      // Client-side Filter by Quantity and inject limit data
      if (!isNaN(reqQty) && reqQty > 0) {
        results = results.filter(item => item.quantity >= reqQty);
      }

      const limitForProduct = userLimits[product];
      
      results = results.map(item => {
        let isOverLimit = false;
        let limitDiff = 0;
        
        if (limitForProduct && item.cost > limitForProduct) {
          isOverLimit = true;
          limitDiff = item.cost - limitForProduct;
        }

        return {
          ...item,
          requestedQty: isNaN(reqQty) ? 0 : reqQty,
          totalPriceForReq: isNaN(reqQty) ? 0 : reqQty * item.cost,
          isOverLimit,
          limitDiff
        };
      });

      // Client-side Sort
      if (sortOption === "price_asc") {
        results.sort((a, b) => a.cost - b.cost);
      } else if (sortOption === "price_desc") {
        results.sort((a, b) => b.cost - a.cost);
      } else if (sortOption === "qty_desc") {
        results.sort((a, b) => b.quantity - a.quantity);
      }

      setSearchResults(results);
    } catch (err) {
      console.error(err);
      setError("Failed to search products: " + err.message);
    }
    
    setIsSearching(false);
  };

  const handleRequest = async (item) => {
    try {
      setRequestedItems(prev => ({ ...prev, [item.id]: 'loading' }));
      
      await addDoc(collection(db, 'requests'), {
        consumerId: currentUser.uid,
        consumerName: userData?.companyName || currentUser.email,
        supplierId: item.supplierId,
        productId: item.id,
        productName: item.name,
        quantityRequested: item.requestedQty,
        unitCost: item.cost,
        unit: item.unit || 'units',
        totalCost: item.totalPriceForReq,
        status: 'pending',
        createdAt: serverTimestamp()
      });

      setRequestedItems(prev => ({ ...prev, [item.id]: 'success' }));
    } catch (err) {
      console.error("Failed to send request:", err);
      setRequestedItems(prev => ({ ...prev, [item.id]: 'error' }));
      alert("Failed to send request: " + err.message);
    }
  };

  return (
    <div className="page-container">
      <div style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: '600', marginBottom: '0.5rem' }}>Dashboard</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Welcome back, <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{userData?.companyName || currentUser?.email}</span>
        </p>
      </div>

      {userData?.role === 'consumer' && (
        <div className="consumer-search-section">
          <div className="form-container" style={{ padding: '2rem', border: '1px solid var(--border-color)', marginBottom: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem', fontWeight: '500' }}>Search Suppliers</h3>
            
            <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 2, minWidth: '200px' }}>
                  <label className="form-label" htmlFor="search-product">Product</label>
                  <select id="search-product" className="form-input" ref={searchProductRef} required>
                    <option value="">What do you need?</option>
                    {PREDEFINED_PRODUCTS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group" style={{ flex: 1, minWidth: '120px' }}>
                  <label className="form-label" htmlFor="search-qty">Min. Quantity</label>
                  <input type="number" id="search-qty" className="form-input" ref={searchQuantityRef} min="1" placeholder="Any" />
                </div>

                <div className="form-group" style={{ flex: 1.5, minWidth: '150px' }}>
                  <label className="form-label" htmlFor="sort">Sort By</label>
                  <select id="sort" className="form-input" ref={sortRef}>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="qty_desc">Availability (Highest)</option>
                  </select>
                </div>
              </div>

              {error && <div className="error-message" style={{ margin: 0 }}>{error}</div>}

              <button disabled={isSearching} className="btn-primary" type="submit" style={{ alignSelf: 'flex-start', padding: '0.75rem 2rem' }}>
                {isSearching ? <span className="spinner"></span> : 'Search'}
              </button>
            </form>
          </div>

          {/* Search Results */}
          {hasSearched && (
            <div>
              <h3 style={{ marginBottom: '1.5rem', fontWeight: '500' }}>Search Results</h3>
              {isSearching ? (
                 <div style={{ padding: '3rem', display: 'flex', justifyContent: 'center' }}>
                    <span className="spinner" style={{ width: '2rem', height: '2rem' }}></span>
                 </div>
              ) : searchResults.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)' }}>
                  No suppliers found matching your criteria.
                </div>
              ) : (
                <div className="products-grid">
                  {searchResults.map(item => (
                    <div key={item.id} className="product-card">
                      <div className="product-icon-wrapper">
                        <Building size={32} />
                      </div>
                      <h4 className="product-name">{item.companyName || 'Unknown Supplier'}</h4>
                      <div className="product-details" style={{ flexDirection: 'column', gap: '0.75rem' }}>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                          <span className="stat-label">Available:</span>
                          <span className="stat-value">{item.quantity} {item.unit || 'units'}</span>
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                          <span className="stat-label">Unit Cost:</span>
                          <span className="stat-value">₹{Number(item.cost).toFixed(2)} / {item.unit === 'units' ? 'unit' : (item.unit || 'unit')}</span>
                        </div>

                        {item.isOverLimit && (
                           <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--error-color)', fontSize: '0.875rem', fontWeight: '600' }}>
                             <AlertTriangle size={16} />
                             <span>₹{item.limitDiff.toFixed(2)} over your unit limit!</span>
                           </div>
                        )}
                        
                        {item.requestedQty > 0 && (
                          <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            width: '100%', 
                            borderTop: '1px solid var(--border-color)', 
                            paddingTop: '0.75rem', 
                            marginTop: '0.25rem' 
                          }}>
                            <span className="stat-label" style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                              Est. Total ({item.requestedQty} {item.unit || 'units'}):
                            </span>
                            <span className="stat-value" style={{ color: 'var(--text-primary)' }}>
                              ₹{Number(item.totalPriceForReq).toFixed(2)}
                            </span>
                          </div>
                        )}
                        
                        {!item.isOverLimit && (
                          <div style={{ marginTop: '1rem', width: '100%' }}>
                            {item.requestedQty > 0 ? (
                              <button 
                                onClick={() => handleRequest(item)}
                                disabled={requestedItems[item.id] === 'loading' || requestedItems[item.id] === 'success'}
                                className="btn-primary" 
                                style={{ width: '100%', padding: '0.5rem', minHeight: '2.5rem' }}
                              >
                                {requestedItems[item.id] === 'loading' ? (
                                  <span className="spinner"></span>
                                ) : requestedItems[item.id] === 'success' ? (
                                  'Requested ✅'
                                ) : (
                                  <>
                                    <Send size={16} /> Send Request
                                  </>
                                )}
                              </button>
                            ) : (
                              <button disabled className="btn-primary" style={{ width: '100%', padding: '0.5rem', opacity: 0.5 }}>
                                Enter Qty to Request
                              </button>
                            )}
                          </div>
                        )}
                        
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
