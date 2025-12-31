// src/index.ts
import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { cors } from "hono/cors";

import { speechToText } from "./services/stt.js";
import { translateText } from "./services/translate.js";
import { geminiTutor } from "./services/gemini.js";
import { elevenTTS } from "./services/eleven.js";
import { toWav16kMono } from "./services/audio.js";

const app = new Hono();

app.use("*", cors({ origin: "*" }));

app.use("*", async (c, next) => {
  console.log("➡️", c.req.method, c.req.path);
  await next();
});

// global error handler
app.onError((err, c) => {
  console.error("🔥 error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      detail: err instanceof Error ? err.message : String(err),
    },
    500
  );
});

// in-memory history (hackathon OK)
type HistMsg = { role: "user" | "assistant"; text: string };
const historyStore = new Map<string, HistMsg[]>();

app.get("/health", (c) => c.json({ ok: true }));

/**
 * TEXT-only turn (quick testing)
 */
app.post("/turn_text", async (c) => {
  const req = await c.req.json();

  const schema = z.object({
    conversation_id: z.string().default("demo"),
    target_language: z.string().default("ja"),
    native_language: z.string().default("zh-TW"),
    persona: z.string().default("Osaka izakaya owner"),
    user_text: z.string().min(1),
  });

  const parsed = schema.safeParse(req);
  if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

  const { conversation_id, target_language, native_language, persona, user_text } = parsed.data;

  const projectId = process.env.GOOGLE_CLOUD_PROJECT!;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";

  const hist = historyStore.get(conversation_id) ?? [];

  const tutor = await geminiTutor({
    projectId,
    location,
    model: "gemini-2.5-flash",
    targetLanguage: target_language,
    nativeLanguage: native_language,
    persona,
    userText: user_text,
    history: hist.slice(-6),
  });

  hist.push({ role: "user", text: user_text });
  hist.push({ role: "assistant", text: tutor.assistant_reply });
  historyStore.set(conversation_id, hist);

  const audio = await elevenTTS({
    apiKey: process.env.ELEVENLABS_API_KEY!,
    voiceId: process.env.ELEVENLABS_VOICE_ID!,
    modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2",
    text: tutor.assistant_reply,
  });

  return c.json({
    conversation_id,
    corrected_user: tutor.corrected_user,
    tips_native: tutor.tips_native,
    assistant_reply: tutor.assistant_reply,
    follow_up_question: tutor.follow_up_question ?? "",
    assistant_audio_base64: audio.toString("base64"),
  });
});

/**
 * AUDIO turn:
 * Browser MediaRecorder -> webm/opus -> ffmpeg -> wav 16k mono -> Google STT -> Gemini -> ElevenLabs
 */
app.post("/turn", async (c) => {
  const body = await c.req.parseBody();

  const audioFile = body["audio"];
  if (!(audioFile instanceof File)) {
    return c.json({ error: "Missing audio file field: audio" }, 400);
  }

  const schema = z.object({
    conversation_id: z.string().default("demo"),
    stt_language: z.string().default("ja-JP"), // Google STT languageCode
    target_language: z.string().default("ja"), // tutor language hint
    native_language: z.string().default("zh-TW"),
    persona: z.string().default("Osaka izakaya owner"),
    subtitle_target: z.string().optional(), // e.g. "zh-TW"
  });

  const parsed = schema.safeParse({
    conversation_id: body["conversation_id"],
    stt_language: body["stt_language"],
    target_language: body["target_language"],
    native_language: body["native_language"],
    persona: body["persona"],
    subtitle_target: body["subtitle_target"],
  });

  if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

  const { conversation_id, stt_language, target_language, native_language, persona, subtitle_target } = parsed.data;

  // 0) Read upload bytes (guard for 0 bytes)
  const rawBytes = Buffer.from(await audioFile.arrayBuffer());
  if (!rawBytes || rawBytes.length === 0) {
    return c.json({ error: "Empty audio upload (0 bytes)" }, 400);
  }

  // 1) Convert to WAV 16k mono (LINEAR16)
  // IMPORTANT: Cloud Run stable path (no temp files)
  const wavBytes = await toWav16kMono(rawBytes, audioFile.type || "");

  if (!wavBytes || wavBytes.length === 0) {
    return c.json({ error: "Audio conversion produced empty output" }, 500);
  }

  // 2) STT
  const user_text = await speechToText({
    audioBytes: wavBytes,
    languageCode: stt_language,
    sampleRateHertz: 16000,
  });

  // 3) subtitles (optional)
  const subtitle_native = subtitle_target ? await translateText(user_text, subtitle_target) : "";

  // 4) Gemini
  const projectId = process.env.GOOGLE_CLOUD_PROJECT!;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";

  const hist = historyStore.get(conversation_id) ?? [];
  const tutor = await geminiTutor({
    projectId,
    location,
    model: "gemini-2.5-flash",
    targetLanguage: target_language,
    nativeLanguage: native_language,
    persona,
    userText: user_text,
    history: hist.slice(-6),
  });

  hist.push({ role: "user", text: user_text });
  hist.push({ role: "assistant", text: tutor.assistant_reply });
  historyStore.set(conversation_id, hist);

  // 5) ElevenLabs
  const audio = await elevenTTS({
    apiKey: process.env.ELEVENLABS_API_KEY!,
    voiceId: process.env.ELEVENLABS_VOICE_ID!,
    modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2",
    text: tutor.assistant_reply,
  });

  return c.json({
    conversation_id,
    user_text,
    subtitle_native,
    corrected_user: tutor.corrected_user,
    tips_native: tutor.tips_native,
    assistant_reply: tutor.assistant_reply,
    follow_up_question: tutor.follow_up_question ?? "",
    assistant_audio_base64: audio.toString("base64"),
  });
});

// (Optional) clear backend history for a conversation_id
app.post("/clear", async (c) => {
  const req = await c.req.json().catch(() => ({}));
  const schema = z.object({ conversation_id: z.string().default("demo") });
  const parsed = schema.safeParse(req);
  if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

  historyStore.delete(parsed.data.conversation_id);
  return c.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});

console.log(`✅ Hono server listening on http://0.0.0.0:${port}`);
