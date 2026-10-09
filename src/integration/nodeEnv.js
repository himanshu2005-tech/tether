// Jest's Node environment (v27) doesn't expose Node's built-in fetch, which the Firebase SDK
// needs. This passes the real one through, without adding a fetch polyfill package.
/* eslint-env node */
const NodeEnvironment = require('jest-environment-node');
const outer = global; // the real Node global, which has fetch

class NodeWithFetch extends NodeEnvironment {
  async setup() {
    await super.setup();
    for (const name of ['fetch', 'Headers', 'Request', 'Response', 'FormData', 'AbortController', 'TextEncoder', 'TextDecoder', 'ReadableStream', 'crypto']) {
      if (outer[name] && !this.global[name]) this.global[name] = outer[name];
    }
  }
}

module.exports = NodeWithFetch;
