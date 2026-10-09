// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// KYC fingerprints use the Web Crypto API; give the test environment Node's implementation
// (Browser-like test environment only; the emulator tests run in Node, which has both already.)
if (typeof window !== 'undefined') {
  if (!window.crypto || !window.crypto.subtle) {
    Object.defineProperty(window, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  }
  if (typeof window.TextEncoder === 'undefined') {
    window.TextEncoder = require('util').TextEncoder;
  }
}
