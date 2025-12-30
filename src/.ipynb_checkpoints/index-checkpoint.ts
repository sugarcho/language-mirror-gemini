// src/index.ts
import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { cors } from "hono/cors";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { speechToText } from "./services/stt.js";
import { translateText } from "./services/translate.js";
import { geminiTutor } from "./services/gemini.js";
import { elevenTTS } from "./services/eleven.js";

async function webmToWav16kMono(webmBuffer: Buffer): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-"));
  const inPath = path.join(tmpDir, "in.webm");
  const outPath = path.join(tmpDir, "out.wav");

  await fs.writeFile(inPath, webmBuffer);

  await new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-ac",
      "1", // mono
      "-ar",
      "16000", // 16k
      "-f",
      "wav",
      outPath,
    ]);

    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed code=${code}\n${err}`));
    });
  });

  const wav = await fs.readFile(outPath);
  await fs.rm(tmpDir, { recursive: true, force: true });
  return wav;
}

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
    { error: "Internal Server Error", detail: err instanceof Error ? err.message : String(err) },
    500
  );
});

// in-memory history (hackathon OK)
const historyStore = new Map<string, Array<{ role: "user" | "assistant"; text: string }>>();

app.get("/health", (c) => c.json({ ok: true }));

// TEXT-only turn (for quick testing)
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

// AUDIO turn: WEBM/OPUS (browser) -> ffmpeg wav16k -> STT -> Gemini -> ElevenLabs
app.post("/turn", async (c) => {
  const body = await c.req.parseBody();

  const audioFile = body["audio"];
  if (!(audioFile instanceof File)) {
    return c.json({ error: "Missing audio file field: audio" }, 400);
  }

  const schema = z.object({
    conversation_id: z.string().default("demo"),
    stt_language: z.string().default("ja-JP"), // STT language code
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

  // 1) STT: browser webm/opus -> wav(16k mono) -> Google STT (LINEAR16 16k)
  const webmBytes = Buffer.from(await audioFile.arrayBuffer());
  const wavBytes = await webmToWav16kMono(webmBytes);

  const user_text = await speechToText({
    audioBytes: wavBytes,
    languageCode: stt_language,
    sampleRateHertz: 16000,
  });

  // 2) subtitles (optional)
  const subtitle_native = subtitle_target ? await translateText(user_text, subtitle_target) : "";

  // 3) Gemini
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

  // 4) ElevenLabs
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

const port = Number(process.env.PORT ?? 3000);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});

console.log(`✅ Hono server listening on http://0.0.0.0:${port}`);
