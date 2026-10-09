import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

// TODO: Replace the following with your app's Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyDQelNPQW3wYnYbpmSPc6-SDw-gliIv4v4",
  authDomain: "tether-40505.firebaseapp.com",
  projectId: "tether-40505",
  storageBucket: "tether-40505.firebasestorage.app",
  messagingSenderId: "473115353088",
  appId: "1:473115353088:web:a0c1f53c131426515278e5",
  measurementId: "G-DYDS9TJ75X"
};

// Initialize Firebase
// With the emulators, use a "demo-" project so nothing can reach production by accident
const useEmulators = process.env.REACT_APP_USE_EMULATORS === 'true';
const app = initializeApp(useEmulators ? { ...firebaseConfig, projectId: 'demo-tether' } : firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);
export const db = getFirestore(app);

// Local development and testing against the Firebase emulators (never touches production data):
// set REACT_APP_USE_EMULATORS=true and run `npm run emulators`
if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
export default app;
