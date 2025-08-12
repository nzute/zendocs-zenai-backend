import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK with environment variables
function initializeFirebase() {
  // Check if Firebase is already initialized
  if (admin.apps.length > 0) {
    return admin.apps[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  // Validate required environment variables
  if (!projectId || !clientEmail || !privateKey) {
    console.error('Firebase environment variables missing:', {
      FIREBASE_PROJECT_ID: !!projectId,
      FIREBASE_CLIENT_EMAIL: !!clientEmail,
      FIREBASE_PRIVATE_KEY: !!privateKey,
    });
    throw new Error('Firebase environment variables are required');
  }

  // Format the private key for Railway environment variables
  // Replace \n with actual line breaks
  const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

  const serviceAccount = {
    type: 'service_account',
    project_id: projectId,
    private_key_id: '459b4f5e2659b024c618e69e1b9d2e4418daa047', // This could also be an env var if needed
    private_key: formattedPrivateKey,
    client_email: clientEmail,
    client_id: '103008232083177222788', // This could also be an env var if needed
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(clientEmail)}`,
    universe_domain: 'googleapis.com'
  };

  try {
    const app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: projectId,
    });

    console.log('Firebase Admin SDK initialized successfully');
    return app;
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
    throw error;
  }
}

// Initialize Firebase and export the app
const firebaseApp = initializeFirebase();

// Export commonly used Firebase services
export const auth = admin.auth(firebaseApp);
export const firestore = admin.firestore(firebaseApp);
export const storage = admin.storage(firebaseApp);

// Export the app instance for custom usage
export { firebaseApp };
export default firebaseApp;
