import { getFirestore } from "./firebase";

export async function mirrorVisaStatus(
  docId: string,
  status: "pending" | "processing" | "refreshing" | "ready" | "error",
  base: {
    resident_country: string;
    nationality: string;
    destination: string;
    visa_category: string;
    visa_type: string;
  }
) {
  const startTime = Date.now();
  try {
    console.log(`🔥 Attempting Firebase status update for: ${docId} (${status})`);
    const db = getFirestore();
    await db.collection("visa_cache").doc(docId).set(
      {
        ...base,
        status,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );
    const duration = Date.now() - startTime;
    console.log(`🔥 Firebase Status Update SUCCESS: ${duration}ms (${status}) for ${docId}`);
  } catch (e) {
    const duration = Date.now() - startTime;
    console.error(`🔥 Firebase Status Update FAILED: ${duration}ms (${status}) for ${docId}`, e);
    console.error("🔥 Firebase error details:", {
      error: e,
      docId,
      status,
      base,
      hasFirebaseCredentials: !!process.env.FIREBASE_SERVICE_ACCOUNT || (!!process.env.FIREBASE_PROJECT_ID && !!process.env.FIREBASE_CLIENT_EMAIL && !!process.env.FIREBASE_PRIVATE_KEY)
    });
  }
}

export async function mirrorVisaPayload(
  docId: string,
  data: Record<string, any>
) {
  const startTime = Date.now();
  try {
    console.log(`🔥 Attempting Firebase full payload update for: ${docId}`);
    const db = getFirestore();
    await db.collection("visa_cache").doc(docId).set(
      {
        ...data,
        status: "ready",
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );
    const duration = Date.now() - startTime;
    console.log(`🔥 Firebase Full Payload SUCCESS: ${duration}ms for ${docId}`);
  } catch (e) {
    const duration = Date.now() - startTime;
    console.error(`🔥 Firebase Full Payload FAILED: ${duration}ms for ${docId}`, e);
    console.error("🔥 Firebase error details:", {
      error: e,
      docId,
      hasFirebaseCredentials: !!process.env.FIREBASE_SERVICE_ACCOUNT || (!!process.env.FIREBASE_PROJECT_ID && !!process.env.FIREBASE_CLIENT_EMAIL && !!process.env.FIREBASE_PRIVATE_KEY)
    });
  }
}
