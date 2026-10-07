import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { PREDEFINED_PRODUCTS } from '../constants/products';
import { Building, AlertTriangle, Send, Sparkles, Search as SearchIcon } from 'lucide-react';

const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;
const MODEL = 'qwen/qwen3.8-27b';

// Helper to handle Groq 429 rate limits
const fetchWithRetry = async (url, options, maxRetries = 4) => {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    // Exponential backoff with jitter
    const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
    console.warn(`Groq 429 Rate Limit hit. Retrying in ${Math.round(delay)}ms...`);
    await new Promise(r => setTimeout(r, delay));
  }
  return await fetch(url, options);
};

export default function Dashboard() {
  const { currentUser, userData } = useAuth();
  
  const [searchResults, setSearchResults] = useState([]);
  const [searchMode, setSearchMode] = useState('ai'); // 'ai' or 'keyword'
  const [suggestions, setSuggestions] = useState({});
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  
  // Track which items have been requested
  const [requestedItems, setRequestedItems] = useState({});

  // Refs for search inputs
  const searchQueryRef = useRef();

  const handleSearch = async (e) => {
    e.preventDefault();
    const rawQuery = searchQueryRef.current?.value?.trim();
    if (!rawQuery) return;

    setError('');
    setIsSearching(true);
    setHasSearched(true);
    setSearchResults([]);

    try {
      let parsed = { product_name: rawQuery };
      let reqQty = null;
      let maxPrice = null;
      let sortOption = 'price_asc';

      if (searchMode === 'ai') {
        // 0. Fetch all unique product names from DB to help LLM match custom products exactly
        let availableProducts = [...PREDEFINED_PRODUCTS];
        try {
          const prodSnap = await getDocs(collection(db, 'products'));
          prodSnap.forEach(d => {
            if (d.data().name) availableProducts.push(d.data().name);
          });
          availableProducts = [...new Set(availableProducts)];
        } catch (err) {
          console.warn("Could not fetch available products for LLM context", err);
        }

        // 1. Call Groq to parse semantic intent
        const prompt = `You are a search intent parser for a B2B warehouse platform.
Extract the intent from the user's query into a strict JSON object.
Extract the exact product name the user is looking for. 
IMPORTANT: You MUST match the product name EXACTLY to one of these currently available products if it is similar: ${availableProducts.join(', ')}
JSON format: { "product_name": "Extracted Exact Name or null", "min_quantity": number or null, "max_price": number or null, "sort_by": "price_asc" | "price_desc" | "qty_desc" }
Only output the raw JSON object, no markdown blocks, no text.
User query: "${rawQuery}"`;

        const aiRes = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
          })
        });

        if (!aiRes.ok) throw new Error("AI parsing failed: " + aiRes.status);
        const data = await aiRes.json();
        
        try {
          const text = data.choices[0].message.content.trim().replace(/```json/g, '').replace(/```/g, '');
          parsed = JSON.parse(text);
        } catch (err) {
          throw new Error("Could not understand the query. Please try phrasing it differently.");
        }

        if (!parsed.product_name) {
          throw new Error("Could not detect a product to search for in your query.");
        }
        
        reqQty = parsed.min_quantity;
        maxPrice = parsed.max_price;
        sortOption = parsed.sort_by || 'price_asc';
      }

      const product = parsed.product_name;

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
      let results = [];
      if (searchMode === 'ai') {
        const q = query(collection(db, "products"), where("name", "==", product));
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((document) => {
          results.push({ id: document.id, ...document.data() });
        });
      } else {
        const querySnapshot = await getDocs(collection(db, "products"));
        querySnapshot.forEach((document) => {
          const data = document.data();
          if (data.name && data.name.toLowerCase().includes(rawQuery.toLowerCase())) {
            results.push({ id: document.id, ...data });
          }
        });
      }

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

      // Client-side Filter by Quantity and Max Price, inject limit data
      if (!isNaN(reqQty) && reqQty > 0) {
        results = results.filter(item => item.quantity >= reqQty);
      }
      if (!isNaN(maxPrice) && maxPrice > 0) {
        results = results.filter(item => item.cost <= maxPrice);
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
          requestedQty: (isNaN(reqQty) || reqQty === null) ? 0 : reqQty,
          totalPriceForReq: (isNaN(reqQty) || reqQty === null) ? 0 : reqQty * item.cost,
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
      generateAiSuggestions(results, parsed);
    } catch (err) {
      console.error(err);
      setError("Failed to search products: " + err.message);
    }
    
    setIsSearching(false);
  };

  const generateAiSuggestions = async (results, parsed) => {
    if (results.length === 0) return;
    try {
      // 1. Fetch historical ratings this user has given
      const ratingsSnap = await getDocs(query(collection(db, 'ratings'), where('consumerId', '==', currentUser.uid)));
      const ratings = [];
      ratingsSnap.forEach(d => ratings.push(d.data()));
      
      const supplierContext = results.map(r => {
        const theirRatings = ratings.filter(x => x.supplierId === r.supplierId);
        const avg = theirRatings.length > 0 ? (theirRatings.reduce((s, x) => s + x.rating, 0) / theirRatings.length).toFixed(1) : 'None';
        return `Supplier: ${r.companyName} | ID: ${r.supplierId} | Past Ratings from this user: ${avg} stars (out of ${theirRatings.length} orders) | Cost: ${r.cost}`;
      }).join('\n');

      const prompt = `You are an AI assistant helping a buyer choose a supplier.
Here are the suppliers found for their search:
${supplierContext}

User's search intent: ${JSON.stringify(parsed)}

Generate a very short, 1-sentence personalized recommendation/warning for EACH supplier based on their price and the user's past ratings with them (if any).
Output JSON format: { "suggestions": { "SUPPLIER_ID_1": "1 sentence text", "SUPPLIER_ID_2": "1 sentence text" } }
Only output the raw JSON object, no markdown.`;

      const aiRes = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        })
      });

      if (!aiRes.ok) throw new Error("AI suggestion failed");
      const data = await aiRes.json();
      const text = data.choices[0].message.content.trim().replace(/```json/g, '').replace(/```/g, '');
      const json = JSON.parse(text);
      setSuggestions(json.suggestions || {});
    } catch (err) {
      console.error("Failed to generate AI suggestions", err);
    }
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
        <h2 style={{ fontSize: '2.5rem', fontWeight: '700', marginBottom: '0.5rem' }}>Dashboard</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Welcome back, <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{userData?.companyName || currentUser?.email}</span>
        </p>
      </div>

      {userData?.role === 'consumer' && (
        <div className="consumer-search-section">
          <div className="form-container" style={{ padding: '2rem', border: '1px solid var(--border-color)', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontWeight: '500', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                {searchMode === 'ai' ? <Sparkles size={20} color="var(--text-primary)" /> : <SearchIcon size={20} />} 
                {searchMode === 'ai' ? 'AI Smart Search' : 'Keyword Search'}
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem', backgroundColor: 'var(--bg-color)', padding: '0.25rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                <button 
                  type="button"
                  onClick={() => setSearchMode('keyword')} 
                  style={{ padding: '0.25rem 0.75rem', borderRadius: '0.25rem', fontSize: '0.75rem', border: 'none', background: searchMode === 'keyword' ? 'var(--text-primary)' : 'transparent', color: searchMode === 'keyword' ? 'var(--bg-color)' : 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  Keyword
                </button>
                <button 
                  type="button"
                  onClick={() => setSearchMode('ai')} 
                  style={{ padding: '0.25rem 0.75rem', borderRadius: '0.25rem', fontSize: '0.75rem', border: 'none', background: searchMode === 'ai' ? 'var(--text-primary)' : 'transparent', color: searchMode === 'ai' ? 'var(--bg-color)' : 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  AI Smart
                </button>
              </div>
            </div>
            
            <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 1, minWidth: '200px' }}>
                  <label className="form-label" htmlFor="semantic-search">
                    {searchMode === 'ai' ? 'Describe what you need' : 'Search by product name'}
                  </label>
                  <input 
                    type="text" 
                    id="semantic-search" 
                    className="form-input" 
                    ref={searchQueryRef} 
                    placeholder={searchMode === 'ai' ? "e.g., I need 50 laptops under ₹50,000, sort by cheapest" : "e.g., Laptops"} 
                    required 
                  />
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

                        {suggestions[item.supplierId] && (
                          <div style={{ backgroundColor: 'rgba(234, 179, 8, 0.1)', padding: '0.625rem', borderRadius: '0.375rem', marginTop: '0.5rem', border: '1px solid rgba(234, 179, 8, 0.3)', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                            <Sparkles size={16} color="#ca8a04" style={{ marginTop: '0.05rem', flexShrink: 0 }} />
                            <span style={{ fontSize: '0.775rem', color: '#a16207', lineHeight: '1.4', fontWeight: '500' }}>{suggestions[item.supplierId]}</span>
                          </div>
                        )}
                        
                        {!item.isOverLimit && (
                          <div style={{ marginTop: '1rem', width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Req Qty:</label>
                              <input 
                                type="number" 
                                min="1" 
                                max={item.quantity}
                                value={item.requestedQty || ''}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  setSearchResults(prev => prev.map(p => p.id === item.id ? { 
                                    ...p, 
                                    requestedQty: isNaN(val) ? 0 : val, 
                                    totalPriceForReq: isNaN(val) ? 0 : val * p.cost 
                                  } : p));
                                }}
                                className="form-input"
                                style={{ flex: 1, padding: '0.4rem', fontSize: '0.875rem' }}
                                placeholder="Quantity..."
                              />
                            </div>
                            <button 
                              onClick={() => handleRequest(item)}
                              disabled={!item.requestedQty || item.requestedQty <= 0 || requestedItems[item.id] === 'loading' || requestedItems[item.id] === 'success'}
                              className="btn-primary" 
                              style={{ width: '100%', padding: '0.5rem', minHeight: '2.5rem' }}
                            >
                              {requestedItems[item.id] === 'loading' ? (
                                <span className="spinner"></span>
                              ) : requestedItems[item.id] === 'success' ? (
                                'Requested ✅'
                              ) : (
                                <>
                                  <Send size={16} /> {item.requestedQty > 0 ? 'Send Request' : 'Enter Qty'}
                                </>
                              )}
                            </button>
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
