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
  } catch (e) {
    console.error("mirrorVisaStatus failed:", e);
  }
}

export async function mirrorVisaPayload(
  docId: string,
  data: Record<string, any>
) {
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
  } catch (e) {
    console.error("mirrorVisaPayload failed:", e);
  }
}
