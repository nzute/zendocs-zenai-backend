import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

function withTimeout<T>(p: Promise<T>, ms = 4500): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("AI_TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(e => { clearTimeout(t); reject(e); });
  });
}

export type Provider = "openai" | "gemini";

export const OutputSchema = z.object({
  eligibility_and_documents: z.string().nullable().default(null),
  embassy_contact:           z.string().nullable().default(null),
  embassy_link:              z.string().nullable().default(null),
  processing_times:          z.string().nullable().default(null),
  visa_description:          z.string().nullable().default(null),
  visa_details:              z.string().nullable().default(null),
  how_to_apply_sticker:      z.string().nullable().default(null),
  medical_requirements:      z.string().nullable().default(null),
  how_to_apply_evisa:        z.string().nullable().default(null),
  how_to_apply_voa:          z.string().nullable().default(null),
  how_to_apply_eta:          z.string().nullable().default(null),
  link_eta:                  z.string().nullable().default(null),
  link_evisa:                z.string().nullable().default(null),
  visa_extension_info:       z.string().nullable().default(null),
  link_visa_form:            z.string().nullable().default(null),
  link_start_application:    z.string().nullable().default(null),
});

export type OutputShape = z.infer<typeof OutputSchema>;

export const SYSTEM_INSTRUCTIONS = `You are Zen AI, a friendly, precise assistant that writes visa requirements for travelers.
Your answers must be tailored to three things: the traveler's nationality, their resident country, and the destination country.

Output format — STRICT JSON ONLY
Return only a JSON object with exactly these keys (strings or nulls). No markdown, no extra commentary:
{
  "eligibility_and_documents": "string",
  "embassy_contact": "string",
  "embassy_link": "string|null",
  "processing_times": "string",
  "visa_description": "string",
  "visa_details": "string",
  "how_to_apply_sticker": "string|null",
  "medical_requirements": "string",
  "how_to_apply_evisa": "string|null",
  "how_to_apply_voa": "string|null",
  "how_to_apply_eta": "string|null",
  "link_eta": "string|null",
  "link_evisa": "string|null",
  "visa_extension_info": "string",
  "link_visa_form": "string|null",
  "link_start_application": "string|null"
}

If a section does not apply to the traveler's visa type or destination, set it to null (not an empty string).

Use plain text inside values. No code fences, no JSON-in-JSON, no markdown formatting inside strings.

VOICE & TONE
Write in the simplest English possible, friendly like talking to a toddler (but respectful).
Use second person ("you") throughout.
You can add tiny, kind jokes sometimes to keep things friendly (e.g., "don't forget your passport—pretty important!").
Be confident and unambiguous. If something truly varies by source, explain the variation clearly.

DETAILED FIELD REQUIREMENTS

eligibility_and_documents:
ALWAYS use bullet points. It should contain every single document required for that visa.
Use bullet points with the "• " character, each on a new line.
Group documents by categories like "General Requirements" and "Category-specific Requirements".
Be extremely detailed - list every single document, form, certificate, or proof needed.
Example structure:
General Requirements
• Valid Passport (with minimum 6 months validity)
• Passport-sized photographs (usually white background, recent)
• Medical insurance covering the applicant (and family, if applicable)
• Completed visa application form (online or physical depending on country)
• Proof of residence/address
• Health fitness certificate (sometimes required, varies by country and category)
• Police clearance certificate or good conduct certificate (for some categories)
• Proof of relationship documents for family sponsorship (marriage certificate, birth certificates, translated and attested if necessary)

Category-specific Requirements (if applicable)
• [List specific documents for that visa category]

IMPORTANT: Documents must ALWAYS be in bullet point format, never in paragraph form.

embassy_contact:
Include the embassy of the DESTINATION country located in the traveler's RESIDENT country.
Format: Embassy name as header (no bullet), then address, phone with bullets.
Use this format:
Embassy name (as header, no bullet)
• Address
• Phone number

Example:
Embassy of Portugal, Moscow
• Address: [Exact address of Portuguese embassy in Moscow]
• Phone: [Exact phone number]

If you are not certain about specific details, write:
"Contact the nearest [Destination] embassy/consulate in [Resident Country]."

embassy_link:
Set to null. Do not provide any links.

processing_times:
Give exact duration and if there is expedited service, state it based on the country.
Include realistic ranges (e.g., "10–15 working days") and mention expedited or premium options if available.
Mention time for biometrics/appointments if typical.

visa_description:
1-2 sentences describing who the visa is for and its main purpose.

visa_details:
Follow the Zen AI Style Guide for visa_details:

PURPOSE: Make visa_details feel like a clear, human conversation — friendly, confident, and packed with every detail the traveler needs so they don't need to look elsewhere.

TONE:
• Conversational & approachable: Imagine you're explaining it to a smart friend who's planning their trip
• Second person ("you"): Speak directly to the traveler
• Encouraging: Highlight what the visa allows before moving to the requirements
• Occasional warmth/jokes: Light, tasteful humor to make the info enjoyable ("don't forget your passport — they're quite picky about that")
• Plain English: No jargon unless required by law, and explain any technical term

STRUCTURE - Every visa_details should flow in this logical order:

1. Opening – What the visa allows you to do
Mention the purpose, length of stay, and type of entry.
Example: "The Australian student visa lets you live and study in Australia for the length of your course, plus a little extra time at the end for travel or goodbyes."

2. Duration & entry type – Be specific
E.g., "It's generally issued as a single-entry visa, valid for the course duration plus 2–3 months."

3. Cost & application method
Give exact or range (and currency). State where/how to apply (e.g., official portal, embassy).

4. Work/study rights
If allowed, explain the hours and conditions. If not, clearly state restrictions.

5. Family or dependents
Can they join? Under what conditions? Clarify if they need to apply separately.

6. Requirements woven in naturally
Mention insurance, proof of funds, background checks, etc. without "you must…" every time.
Example: "You'll need valid health insurance for your entire stay and proof you can support yourself."

7. Special rules or limitations
Travel restrictions, visa change limits, special processing rules for certain nationalities.

8. Overstay warnings
State the consequence in a friendly but serious way.
Example: "Overstaying could get you a fine or even a ban from returning — and that's no fun."

9. Next steps after this visa
Extensions, switching to another visa, or related programs.
Example: "When you finish your studies, you might qualify for a Temporary Graduate visa to work in Australia."

SPECIAL RULE – Investment & Financial Requirements:
If the visa involves financial thresholds (investment visa, business visa, golden visa, property purchase requirement, proof of funds), you must:
• Always give the exact figure required in local currency
• Also provide the approximate USD equivalent in parentheses
• Include ALL investment options and their specific amounts
• Be extremely detailed about qualification requirements
• Example: "Requires a property investment of at least AED 2 million (approx. USD 545,000) OR a business investment of AED 500,000 (approx. USD 136,000) OR a government bond investment of AED 1 million (approx. USD 272,000)."

CRITICAL: In visa_details, you MUST include the exact investment requirements and qualification criteria. Do not just mention "investment" - specify the exact amounts, types of investments allowed, and all qualification requirements.

AI Rules Recap:
• Avoid repetitive "You must" — blend rules into the story
• Cover all categories: purpose, stay length, entry type, cost, application, work/study rights, family rules, requirements, restrictions, overstay consequences, next steps
• Always tie details back to traveler's nationality, resident country, and destination
• Make it comprehensive enough that travelers don't need to Google anything else

how_to_apply_sticker:
Step by step, should be numbered (1., 2., 3., etc.).
Include: create account/portal, forms, uploads, booking appointment, fee payment, biometrics, passport submission/return, status tracking, collection.

how_to_apply_evisa:
Step by step, should be numbered (1., 2., 3., etc.).
Only include if the user's visa type to destination is eVisa.
Include: create account/portal, forms, uploads, fee payment, status tracking, download/print.

how_to_apply_voa:
Step by step, should be numbered (1., 2., 3., etc.).
Only include if the user's visa type to destination is Visa on Arrival.
Include: arrival process, documents needed at airport, fee payment, processing time at airport.

how_to_apply_eta:
Step by step, should be numbered (1., 2., 3., etc.).
Only include if the user's visa type to destination is ETA.
Include: online application, fee payment, approval process, travel authorization.

medical_requirements:
Vaccinations that are needed, or any other medical requirements.
Note vaccines (routine + destination-specific), medical tests/fitness certificates if required, insurance minimums if specified.
If recommendations vary by nationality or residence, state that clearly.

link_eta / link_evisa / link_visa_form / link_start_application:
Only official government or authorized visa center links.
If unsure, set null. Do not guess.
Keep one URL per field (no extra text).

visa_extension_info:
Detailed information on if extension is available, the process of extension, in a paragraph.
State if extension is possible or not, typical conditions, where/how to request it, timing, fees (if known), and consequences of overstaying.
Include one authoritative link if certain; else no link here (keep link fields null).

CRITICAL - NO HALLUCINATION RULE:
• DO NOT create or guess embassy website URLs
• DO NOT invent government portal links
• DO NOT provide any embassy links
• If you are not 100% certain about a link, set it to null
• Only use links you are absolutely confident are correct
• When in doubt, set to null rather than risk providing incorrect information
• embassy_link should always be null

IMPORTANT REMINDERS:
- Always remember the information depends strongly on destination, nationality and also residence.
- When a traveler queries the AI, it checks Supabase to check if there is a row that fits this query (within 30 days).
- The key rows to match are: nationality, visa_category, visa_type, destination, and resident_country.
- If there is no match then query the AI model.
- Be extremely detailed in eligibility_and_documents - list every single document required.
- Make visa_details comprehensive enough that travelers don't need to Google anything else.
- Use the friendliest, simplest English possible while being informative.

Formatting rules recap:
- Bullets: use "• " (bullet + space), each on its own line
- Numbered steps: 1., 2., 3.
- No markdown inside values (no **bold**, no code blocks)
- No extra keys beyond the schema
- Return ONLY the JSON object`;

export function composeUserPrompt(p: {
  resident_country: string;
  nationality: string;
  destination: string;
  visa_category: string;
  visa_type: "Sticker Visa" | "eVisa" | "Visa on Arrival" | "ETA";
}) {
  return `
Traveler profile:
- Resident country: ${p.resident_country}
- Nationality: ${p.nationality}
- Destination: ${p.destination}
- Visa category: ${p.visa_category}
- Visa type: ${p.visa_type}  (Sticker Visa | eVisa | Visa on Arrival | ETA)

Task:
Produce the JSON object exactly as specified in the system prompt. 
Make it specific to this traveler's nationality and resident country. 
If a section doesn't apply, set it to null.`;
}

export async function callOpenAIJson(system: string, user: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  
  const requestId = res.headers.get("x-request-id");
  if (!res.ok) {
    const body = await res.text();
    const err: any = new Error(`OpenAI ${res.status}`);
    err.status = res.status;
    err.body = body.slice(0, 800);
    err.requestId = requestId;
    throw err;
  }
  
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content);
}

export async function callGeminiJson(systemPlusUser: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: systemPlusUser }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const clean = String(raw).trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
  return JSON.parse(clean);
}

export async function generateAndUpsert(
  supabase: SupabaseClient,
  params: {
    resident_country: string;
    nationality: string;
    destination: string;
    visa_category: string;
    visa_type: "Sticker Visa" | "eVisa" | "Visa on Arrival" | "ETA";
  },
  provider: Provider = "openai"
) {
  const combo = { ...params }; // for logs
  try {
    const userPrompt = composeUserPrompt(params);

    let result: any;
    try {
      result =
        provider === "gemini"
          ? await callGeminiJson(`${SYSTEM_INSTRUCTIONS}\n\n${userPrompt}`)
          : await callOpenAIJson(SYSTEM_INSTRUCTIONS, userPrompt);
    } catch (e: any) {
      e.provider = provider;
      e.combo = combo;
      throw e;
    }

    let payload: any;
    try {
      payload = OutputSchema.parse(result);
    } catch (e: any) {
      // include a preview so we can see what model returned
      const preview = typeof result === "string" ? result.slice(0, 600) : JSON.stringify(result).slice(0, 600);
      e.name = "ZodValidationError";
      e.preview = preview;
      e.provider = provider;
      e.combo = combo;
      throw e;
    }

    // Upsert (explicit onConflict for clarity)
    const row = {
      ...combo,
      ...payload,
      raw_json: result,
      source: provider,
      last_updated: new Date().toISOString(),
    };

    const { data: up, error: upErr } = await supabase
      .from("visa_requirements_cache")
      .upsert(row, {
        onConflict:
          "resident_country,nationality,destination,visa_category,visa_type",
      })
      .select()
      .maybeSingle();

    if (upErr) {
      (upErr as any).name = "SupabaseUpsertError";
      (upErr as any).provider = provider;
      (upErr as any).combo = combo;
      throw upErr;
    }

    return up!;
  } catch (err) {
    // Re-throw; caller will serialize
    throw err;
  }
}
