const admin = require("firebase-admin");
const crypto = require('crypto');

// Validate Firebase configuration format
function validateFirebaseConfig() {
  const config = {
    projectId: process.env.GOOGLE_PROJECT_ID,
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY,
    databaseURL: process.env.FIREBASE_DB_URL
  };
  
  // Validate project ID format
  if (config.projectId && !/^[a-z0-9-]+$/.test(config.projectId)) {
    throw new Error('Invalid project ID format');
  }
  
  // Validate email format
  if (config.clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.clientEmail)) {
    throw new Error('Invalid client email format');
  }
  
  // Validate database URL format
  if (config.databaseURL && !config.databaseURL.startsWith('https://')) {
    throw new Error('Database URL must use HTTPS');
  }
  
  return config;
}

// Check if all required Firebase environment variables are present
const requiredEnvVars = ['GOOGLE_PROJECT_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'FIREBASE_DB_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('Missing Firebase environment variables:', missingVars.join(', '));
  console.log('Firebase functionality will be disabled. Please set the following environment variables:');
  missingVars.forEach(varName => console.log(`- ${varName}`));
  
  // Export a mock database object to prevent crashes
  module.exports = {
    ref: () => ({
      set: () => Promise.resolve(),
      once: () => Promise.resolve({ val: () => null }),
      remove: () => Promise.resolve(),
      update: () => Promise.resolve()
    })
  };
} else {
  try {
    // Validate configuration before initializing
    const config = validateFirebaseConfig();
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey.replace(/\\n/g, '\n'),
      }),
      databaseURL: config.databaseURL,
    });

    const db = admin.database();
    console.log('✅ Firebase initialized successfully');
    
    // Create secure database wrapper with validation
    const secureDb = {
      ref: (path) => {
        // Validate database paths to prevent injection
        if (typeof path !== 'string' || /[#$\[\].\/]/.test(path.replace(/\//g, ''))) {
          throw new Error('Invalid database path');
        }
        return db.ref(path);
      }
    };
    
    module.exports = secureDb;
  } catch (error) {
    console.error('Failed to initialize Firebase:', error.message);
    
    // Export a mock database object to prevent crashes
    module.exports = {
      ref: () => ({
        set: () => Promise.resolve(),
        once: () => Promise.resolve({ val: () => null }),
        remove: () => Promise.resolve(),
        update: () => Promise.resolve()
      })
    };
  }
}
