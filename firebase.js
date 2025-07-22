const admin = require("firebase-admin");

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
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.GOOGLE_PROJECT_ID,
        clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
        privateKey: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.FIREBASE_DB_URL,
    });

    const db = admin.database();
    console.log('✅ Firebase initialized successfully');
    module.exports = db;
  } catch (error) {
    console.error('Failed to initialize Firebase: Connection error');
    
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
