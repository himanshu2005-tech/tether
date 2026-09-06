import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
