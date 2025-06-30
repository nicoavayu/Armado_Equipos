// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBymFeN1HjEmodWumo2rkl0rYHZMJAcWE8",
  authDomain: "armandoequipos-98155.firebaseapp.com",
  projectId: "armandoequipos-98155",
  storageBucket: "armandoequipos-98155.appspot.com", // <--- ESTE!
  messagingSenderId: "850698611227",
  appId: "1:850698611227:web:fa0754b439397ec0b2e6be"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const storage = getStorage(app);
