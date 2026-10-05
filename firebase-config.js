// firebase-config.js
const firebaseConfig = {
  apiKey: "AIzaSyBXbsESZDjaOcQsGVKkGAVcvFmz5_6Z0Vs",
  authDomain: "arduinohubfinal.firebaseapp.com",
  projectId: "arduinohubfinal",
  storageBucket: "arduinohubfinal.firebasestorage.app",
  messagingSenderId: "199660735301",
  appId: "1:199660735301:web:3779bc1c1c42855d618c2c",
  measurementId: "G-8NBRWQYJ3S"
};

// Initialize Firebase
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}