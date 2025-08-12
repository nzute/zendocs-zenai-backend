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
    console.log(`🔥 Firebase Status Update: ${duration}ms (${status})`);
  } catch (e) {
    const duration = Date.now() - startTime;
    console.error(`🔥 Firebase Status Update FAILED: ${duration}ms (${status})`, e);
  }
}

export async function mirrorVisaPayload(
  docId: string,
  data: Record<string, any>
) {
  const startTime = Date.now();
  try {
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
    console.log(`🔥 Firebase Full Payload: ${duration}ms`);
  } catch (e) {
    const duration = Date.now() - startTime;
    console.error(`🔥 Firebase Full Payload FAILED: ${duration}ms`, e);
  }
}
