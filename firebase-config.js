import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Import the functions you need from the SDKs you need
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBKmoCAH79ovTd0HDvTfnc5BmWzah2ea6I",
  authDomain: "citas-u.firebaseapp.com",
  projectId: "citas-u",
  storageBucket: "citas-u.firebasestorage.app",
  messagingSenderId: "698299399157",
  appId: "1:698299399157:web:1fbb6f35f6985d43437ebc"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
