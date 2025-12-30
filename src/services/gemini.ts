// src/services/gemini.ts
import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

type TutorOut = {
  corrected_user: string;
  tips_native: string;
  assistant_reply: string;
  follow_up_question?: string;
};

function systemPrompt() {
  return `You are Language Mirror, an immersive language tutor.

Return ONLY a valid JSON object that matches the schema.
No markdown fences. No extra text.

IMPORTANT:
- Every value must be a JSON string.
- Do NOT include raw newlines inside strings. Use \\n instead.
- Do NOT include unescaped double quotes inside strings.`;
}

// Extract the first JSON object by brace matching (handles nested braces safely)
function extractFirstJSONObject(s: string): string {
  const text = s.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const start = text.indexOf("{");
  if (start < 0) return text;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    } else {
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }

  // If we never closed, return best effort substring (will error with useful raw)
  return text.slice(start);
}

export async function geminiTutor(params: {
  projectId: string;
  location: string;
  model: string; // e.g. "gemini-2.5-flash"
  targetLanguage: string; // "ja" / "it"
  nativeLanguage: string; // "zh-TW"
  persona: string;
  userText: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}): Promise<TutorOut> {
  const {
    projectId,
    location,
    model,
    targetLanguage,
    nativeLanguage,
    persona,
    userText,
    history = [],
  } = params;

  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const contents = [
    // keep as user-message for simplicity/compatibility with REST
    { role: "user", parts: [{ text: systemPrompt() }] },
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    {
      role: "user",
      parts: [
        {
          text: `TARGET language: ${targetLanguage}
NATIVE language: ${nativeLanguage}
Persona: ${persona}
User said: ${userText}`,
        },
      ],
    },
  ];

  const generationConfig = {
    temperature: 0.4,
    maxOutputTokens: 2048,
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        corrected_user: { type: "string" },
        tips_native: { type: "string" },
        assistant_reply: { type: "string" },
        follow_up_question: { type: "string" },
      },
      required: ["corrected_user", "tips_native", "assistant_reply", "follow_up_question"]
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contents, generationConfig }),
  });

  if (!resp.ok) {
    throw new Error(`Gemini error ${resp.status}: ${await resp.text()}`);
  }

  const data: any = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];

  // 1) BEST: responseMimeType=application/json sometimes yields JSON directly per-part
  for (const p of parts) {
    if (p && typeof p === "object") {
      const t = (p as any).text;
      if (typeof t === "string" && t.trim().startsWith("{")) {
        try {
          return JSON.parse(t) as TutorOut;
        } catch {
          // fall through
        }
      }

      for (const k of ["json", "data", "structuredData"] as const) {
        const v = (p as any)[k];

        if (v && typeof v === "object") {
          return v as TutorOut;
        }

        if (typeof v === "string" && v.trim().startsWith("{")) {
          try {
            return JSON.parse(v) as TutorOut;
          } catch {
            // fall through
          }
        }
      }
    }
  }

  // 2) FALLBACK: Merge all text parts, then extract the first JSON object
  const raw = parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .join("");

  const jsonStr = extractFirstJSONObject(raw);

  // 3) TRY parse; if fail, recover fields to keep demo running
  try {
    return JSON.parse(jsonStr) as TutorOut;
  } catch (e: any) {
    const pick = (key: keyof TutorOut) => {
      const m = jsonStr.match(
        new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(,|\\})`)
      );
      return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n") : "";
    };

    const recovered: TutorOut = {
      corrected_user: pick("corrected_user") || "",
      tips_native: pick("tips_native") || "",
      assistant_reply: pick("assistant_reply") || "",
      follow_up_question: pick("follow_up_question") || "",
    };

    // only throw if all required fields are empty
    if (!recovered.corrected_user && !recovered.tips_native && !recovered.assistant_reply) {
      const snippet = (jsonStr || raw).slice(0, 800);
      throw new Error(`JSON parse failed: ${e?.message ?? e}. Raw snippet: ${snippet}`);
    }

    return recovered;
  }
}
