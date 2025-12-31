// web/src/App.tsx
import { useEffect, useMemo, useRef, useState } from "react";

type TurnTextResponse = {
  conversation_id: string;
  corrected_user: string;
  tips_native: string;
  assistant_reply: string;
  follow_up_question: string;
  assistant_audio_base64: string;
};

type TurnAudioResponse = TurnTextResponse & {
  user_text: string;
  subtitle_native: string;
};

// API base auto follows the page hostname (works for VM / LAN access)
const API_BASE = import.meta.env.VITE_API_BASE as string;

if (!API_BASE) {
  console.error("Missing VITE_API_BASE. Set it in Vercel Environment Variables.");
}

// UI options
const TARGET_LANG_OPTIONS: Array<{ code: string; label: string; defaultStt: string }> = [
  { code: "ja", label: "Japanese (ja)", defaultStt: "ja-JP" },
  { code: "en", label: "English (en)", defaultStt: "en-US" },
  { code: "it", label: "Italian (it)", defaultStt: "it-IT" },
  { code: "ko", label: "Korean (ko)", defaultStt: "ko-KR" },
  { code: "zh", label: "Chinese (zh)", defaultStt: "cmn-Hans-CN" },
  { code: "fr", label: "French (fr)", defaultStt: "fr-FR" },
  { code: "de", label: "German (de)", defaultStt: "de-DE" },
  { code: "es", label: "Spanish (es)", defaultStt: "es-ES" },
];

const NATIVE_LANG_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "zh-TW", label: "繁體中文 (zh-TW)" },
  { code: "zh-CN", label: "简体中文 (zh-CN)" },
  { code: "en", label: "English (en)" },
  { code: "it", label: "Italiano (it)" },
  { code: "ja", label: "日本語 (ja)" },
  { code: "ko", label: "한국어 (ko)" },
  { code: "fr", label: "Français (fr)" },
  { code: "de", label: "Deutsch (de)" },
  { code: "es", label: "Español (es)" },
];

// Common STT language codes for Google STT
const STT_LANG_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "ja-JP", label: "Japanese (ja-JP)" },
  { code: "en-US", label: "English (en-US)" },
  { code: "en-GB", label: "English UK (en-GB)" },
  { code: "it-IT", label: "Italian (it-IT)" },
  { code: "ko-KR", label: "Korean (ko-KR)" },
  { code: "cmn-Hant-TW", label: "Chinese TW (cmn-Hant-TW)" },
  { code: "cmn-Hans-CN", label: "Chinese CN (cmn-Hans-CN)" },
  { code: "fr-FR", label: "French (fr-FR)" },
  { code: "de-DE", label: "German (de-DE)" },
  { code: "es-ES", label: "Spanish (es-ES)" },
];

export default function App() {
  // common params
  const [conversationId, setConversationId] = useState("demo1");
  const [persona, setPersona] = useState("Osaka izakaya owner");

  const [targetLanguage, setTargetLanguage] = useState("ja");
  const [nativeLanguage, setNativeLanguage] = useState("en");
  const [sttLanguage, setSttLanguage] = useState("ja-JP");
  const [subtitleTarget, setSubtitleTarget] = useState("en"); // subtitles target language

  // text mode
  const [userText, setUserText] = useState("");

  // output
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<TurnTextResponse | null>(null);
  const [resultAudio, setResultAudio] = useState<TurnAudioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // assistant audio player (replayable)
  const [assistantAudioUrl, setAssistantAudioUrl] = useState<string>("");
  const assistantAudioElRef = useRef<HTMLAudioElement | null>(null);

  // recorder state
  const [recState, setRecState] = useState<"idle" | "recording" | "stopped">("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const canRecord = useMemo(() => typeof MediaRecorder !== "undefined", []);

  // When target language changes, auto-set a reasonable STT default (user can still override)
  useEffect(() => {
    const opt = TARGET_LANG_OPTIONS.find((o) => o.code === targetLanguage);
    if (opt) setSttLanguage(opt.defaultStt);
  }, [targetLanguage]);

  // Try autoplay when a new assistant audio URL arrives (keeps controls so user can replay)
  useEffect(() => {
    if (!assistantAudioUrl) return;
    const el = assistantAudioElRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {
      // If autoplay is blocked, user can press play on controls
    });
  }, [assistantAudioUrl]);

  function setBase64Mp3ToPlayer(base64: string) {
    if (!base64) return;
    const url = "data:audio/mp3;base64," + base64;
    setAssistantAudioUrl(url);
  }

  async function submitText() {
    setLoading(true);
    setError(null);
    setResultAudio(null);
    setResultText(null);
    setAssistantAudioUrl("");

    try {
      const res = await fetch(`${API_BASE}/turn_text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          target_language: targetLanguage,
          native_language: nativeLanguage,
          persona,
          user_text: userText,
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as TurnTextResponse;

      setResultText(data);
      setBase64Mp3ToPlayer(data.assistant_audio_base64);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function startRecording() {
    setError(null);
    setResultAudio(null);
    setResultText(null);
    setRecordedBlob(null);
    setAssistantAudioUrl("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : undefined,
      });

      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setRecordedBlob(blob);
        setRecState("stopped");
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = mr;
      mr.start();
      setRecState("recording");
    } catch (e: any) {
      setError("Mic permission denied or recorder not supported: " + (e?.message ?? e));
    }
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") mr.stop();
  }

  async function submitRecording() {
    if (!recordedBlob) return;

    setLoading(true);
    setError(null);
    setResultAudio(null);
    setResultText(null);
    setAssistantAudioUrl("");

    try {
      const fd = new FormData();
      fd.append("audio", recordedBlob, "recording.webm");
      fd.append("conversation_id", conversationId);
      fd.append("stt_language", sttLanguage);
      fd.append("target_language", targetLanguage);
      fd.append("native_language", nativeLanguage);
      fd.append("persona", persona);
      fd.append("subtitle_target", subtitleTarget); // can be ""

      const res = await fetch(`${API_BASE}/turn`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as TurnAudioResponse;

      setResultAudio(data);
      setBase64Mp3ToPlayer(data.assistant_audio_base64);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const activeResult = resultText ?? resultAudio;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 960 }}>
      <h1 style={{ margin: 0 }}>🗣️ Language Mirror (Tutor)</h1>
      <p style={{ opacity: 0.8, marginTop: 8 }}>
        Text + Voice demo: STT (Google) → Gemini (Vertex AI) → ElevenLabs (TTS) + subtitles
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Settings</h3>

          <label>Conversation ID</label>
          <input style={{ width: "100%" }} value={conversationId} onChange={(e) => setConversationId(e.target.value)} />

          <label style={{ display: "block", marginTop: 8 }}>Persona</label>
          <input style={{ width: "100%" }} value={persona} onChange={(e) => setPersona(e.target.value)} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <div>
              <label>Target language</label>
              <select
                style={{ width: "100%" }}
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
              >
                {TARGET_LANG_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
              <small style={{ opacity: 0.7 }}>Tutor speaks this language.</small>
            </div>

            <div>
              <label>Native language</label>
              <select
                style={{ width: "100%" }}
                value={nativeLanguage}
                onChange={(e) => setNativeLanguage(e.target.value)}
              >
                {NATIVE_LANG_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
              <small style={{ opacity: 0.7 }}>Tips/explanations language.</small>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <div>
              <label>STT language</label>
              <select style={{ width: "100%" }} value={sttLanguage} onChange={(e) => setSttLanguage(e.target.value)}>
                {STT_LANG_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
              <small style={{ opacity: 0.7 }}>Google Speech-to-Text languageCode.</small>
            </div>

            <div>
              <label>Subtitle target</label>
              <select
                style={{ width: "100%" }}
                value={subtitleTarget}
                onChange={(e) => setSubtitleTarget(e.target.value)}
              >
                {NATIVE_LANG_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
              <small style={{ opacity: 0.7 }}>Subtitle translation language.</small>
            </div>
          </div>
        </div>

        <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Text mode</h3>
          <textarea
            rows={4}
            style={{ width: "100%", fontSize: 16 }}
            placeholder="Enter a sentence (in target language)"
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
          />
          <button
            onClick={submitText}
            disabled={loading || !userText.trim()}
            style={{ marginTop: 10, padding: "8px 16px", fontSize: 16 }}
          >
            {loading ? "Processing..." : "Submit text"}
          </button>

          <hr style={{ margin: "16px 0" }} />

          <h3 style={{ marginTop: 0 }}>Voice mode</h3>
          {!canRecord && <div style={{ color: "red" }}>MediaRecorder not supported in this browser.</div>}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={startRecording}
              disabled={loading || recState === "recording"}
              style={{ padding: "8px 16px" }}
            >
              🎙 Start
            </button>
            <button
              onClick={stopRecording}
              disabled={loading || recState !== "recording"}
              style={{ padding: "8px 16px" }}
            >
              ⏹ Stop
            </button>
            <button
              onClick={submitRecording}
              disabled={loading || !recordedBlob}
              style={{ padding: "8px 16px" }}
            >
              🚀 Send to teach
            </button>
            <span style={{ opacity: 0.8 }}>
              {recState === "recording" ? "Recording..." : recordedBlob ? "Recorded ✔" : "Idle"}
            </span>
          </div>

          {recordedBlob && (
            <audio controls style={{ marginTop: 10, width: "100%" }} src={URL.createObjectURL(recordedBlob)} />
          )}
        </div>
      </div>

      {error && (
        <pre style={{ color: "salmon", marginTop: 16, whiteSpace: "pre-wrap" }}>{error}</pre>
      )}

      {activeResult && (
        <div style={{ marginTop: 18, border: "1px solid #333", borderRadius: 12, padding: 12 }}>
          <h2 style={{ marginTop: 0 }}>Result</h2>

          {resultAudio?.user_text && (
            <>
              <h4>🧾 STT user_text</h4>
              <p>{resultAudio.user_text}</p>
            </>
          )}

          {resultAudio?.subtitle_native && (
            <>
              <h4>🪄 Subtitles</h4>
              <p>{resultAudio.subtitle_native}</p>
            </>
          )}

          <h4>✍️ corrected_user</h4>
          <p>{activeResult.corrected_user}</p>

          <h4>📘 tips_native</h4>
          <p style={{ whiteSpace: "pre-wrap" }}>{activeResult.tips_native}</p>

          <h4>🤖 assistant_reply</h4>
          <p>{activeResult.assistant_reply}</p>

          <h4>👉 follow_up_question</h4>
          <p>{activeResult.follow_up_question}</p>

          {assistantAudioUrl && (
            <div style={{ marginTop: 12 }}>
              <h4>🔊 Assistant audio (replayable)</h4>
              <audio
                ref={assistantAudioElRef}
                controls
                style={{ width: "100%" }}
                src={assistantAudioUrl}
              />
              <small style={{ opacity: 0.7 }}>
                If autoplay is blocked, press play manually.
              </small>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
