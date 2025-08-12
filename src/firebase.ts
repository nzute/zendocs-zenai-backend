// src/firebase.ts
import {
  initializeApp,
  cert,
  getApps,
  getApp,
  App,
  ServiceAccount,
} from "firebase-admin/app";
import { getFirestore as _getFirestore } from "firebase-admin/firestore";

/**
 * Build Firebase credentials from either:
 *  - FIREBASE_SERVICE_ACCOUNT (full JSON string), or
 *  - FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */
function buildServiceAccount(): ServiceAccount {
  console.log("🔍 Checking Firebase credentials...");
  
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().length > 0) {
    console.log("✅ Found FIREBASE_SERVICE_ACCOUNT");
    try {
      const parsed = JSON.parse(raw);
      // Convert escaped \n to real newlines for the private key
      if (typeof parsed.private_key === "string") {
        parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
      }
      // Narrow to ServiceAccount shape
      const sa: ServiceAccount = {
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      };
      console.log(`✅ Firebase project: ${sa.projectId}`);
      return sa;
    } catch (e) {
      console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:", e);
      throw e;
    }
  }

  console.log("🔍 Checking individual Firebase env vars...");
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  console.log("Firebase env vars:", {
    FIREBASE_PROJECT_ID: !!projectId,
    FIREBASE_CLIENT_EMAIL: !!clientEmail,
    FIREBASE_PRIVATE_KEY: !!privateKey,
  });

  if (!projectId || !clientEmail || !privateKey) {
    const error = "Missing Firebase credentials. Provide FIREBASE_SERVICE_ACCOUNT (full JSON) OR FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.";
    console.error("❌", error);
    throw new Error(error);
  }

  console.log(`✅ Firebase project: ${projectId}`);
  return { projectId, clientEmail, privateKey };
}

function getOrInitApp(): App {
  if (getApps().length > 0) return getApp();
  const sa = buildServiceAccount();
  return initializeApp({ credential: cert(sa) });
}

export function getFirestore() {
  const app = getOrInitApp();
  return _getFirestore(app);
}
