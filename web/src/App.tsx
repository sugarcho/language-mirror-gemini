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

type ChatMsg = {
  role: "user" | "assistant";
  text: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE as string) || "";

// ===== Language options =====
const LANG_OPTIONS = [
  { label: "Japanese (ja)", value: "ja" },
  { label: "English (en)", value: "en" },
  { label: "Italian (it)", value: "it" },
  { label: "Korean (ko)", value: "ko" },
  { label: "Spanish (es)", value: "es" },
  { label: "French (fr)", value: "fr" },
  { label: "German (de)", value: "de" },
  { label: "Chinese (zh)", value: "zh" },
];

const STT_OPTIONS = [
  { label: "Japanese (ja-JP)", value: "ja-JP" },
  { label: "English (en-US)", value: "en-US" },
  { label: "Italian (it-IT)", value: "it-IT" },
  { label: "Korean (ko-KR)", value: "ko-KR" },
  { label: "Spanish (es-ES)", value: "es-ES" },
  { label: "French (fr-FR)", value: "fr-FR" },
  { label: "German (de-DE)", value: "de-DE" },
  { label: "Chinese (zh-TW)", value: "zh-TW" },
  { label: "Chinese (zh-CN)", value: "zh-CN" },
];

const NATIVE_OPTIONS = [
  { label: "Traditional Chinese (zh-TW)", value: "zh-TW" },
  { label: "English (en)", value: "en" },
  { label: "Japanese (ja)", value: "ja" },
  { label: "Italian (it)", value: "it" },
  { label: "Korean (ko)", value: "ko" },
  { label: "Spanish (es)", value: "es" },
  { label: "French (fr)", value: "fr" },
  { label: "German (de)", value: "de" },
];

// ===== Persona presets =====
const PERSONA_PRESETS = [
  { label: "Osaka izakaya owner (fun)", value: "Osaka izakaya owner" },
  { label: "Friendly language tutor", value: "Friendly language tutor" },
  { label: "Business meeting coach", value: "Business meeting coach" },
  { label: "Travel buddy", value: "Travel buddy" },
  { label: "Strict grammar teacher", value: "Strict grammar teacher" },
];

export default function App() {
  // ===== Settings =====
  const [conversationId, setConversationId] = useState("demo1");

  // persona: preset + optional custom override
  const [personaPreset, setPersonaPreset] = useState(PERSONA_PRESETS[0].value);
  const [personaCustom, setPersonaCustom] = useState("");
  const persona = personaCustom.trim() ? personaCustom.trim() : personaPreset;

  const [targetLanguage, setTargetLanguage] = useState("ja");
  const [nativeLanguage, setNativeLanguage] = useState("zh-TW");
  const [sttLanguage, setSttLanguage] = useState("ja-JP");
  const [subtitleTarget, setSubtitleTarget] = useState("zh-TW");

  // ===== Text mode =====
  const [userText, setUserText] = useState("");

  // ===== Output / state =====
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<TurnTextResponse | null>(null);
  const [resultAudio, setResultAudio] = useState<TurnAudioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ===== Conversation transcript =====
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // ===== Audio playback =====
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [lastAssistantAudioBase64, setLastAssistantAudioBase64] = useState<string>("");

  // ===== Recorder state =====
  const [recState, setRecState] = useState<"idle" | "recording" | "stopped">("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const canRecord = useMemo(() => typeof MediaRecorder !== "undefined", []);

  useEffect(() => {
    if (!API_BASE) {
      console.error("Missing VITE_API_BASE. Set it in Vercel Environment Variables.");
      setError("Missing VITE_API_BASE. Please set it in Vercel env vars.");
    }
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  useEffect(() => {
    return () => {
      try {
        audioElRef.current?.pause();
      } catch {}
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  function ensureAudioEl() {
    if (!audioElRef.current) audioElRef.current = new Audio();
    return audioElRef.current;
  }

  function playBase64Mp3(base64: string) {
    if (!base64) return;
    const audio = ensureAudioEl();
    const url = "data:audio/mp3;base64," + base64;
    audio.src = url;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  function replayLast() {
    if (!lastAssistantAudioBase64) return;
    playBase64Mp3(lastAssistantAudioBase64);
  }

  function addMsg(role: ChatMsg["role"], text: string) {
    setChat((prev) => [...prev, { role, text }]);
  }

  // ===== API calls =====
  async function submitText() {
    setLoading(true);
    setError(null);
    setResultAudio(null);
    setResultText(null);

    const text = userText.trim();
    if (!text) {
      setLoading(false);
      return;
    }

    try {
      addMsg("user", text);

      const res = await fetch(`${API_BASE}/turn_text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          target_language: targetLanguage,
          native_language: nativeLanguage,
          persona,
          user_text: text,
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as TurnTextResponse;

      setResultText(data);
      addMsg("assistant", data.assistant_reply);

      setLastAssistantAudioBase64(data.assistant_audio_base64 || "");
      playBase64Mp3(data.assistant_audio_base64);
      setUserText("");
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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

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
        streamRef.current = null;
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

    try {
      const fd = new FormData();
      fd.append("audio", recordedBlob, "recording.webm");
      fd.append("conversation_id", conversationId);
      fd.append("stt_language", sttLanguage);
      fd.append("target_language", targetLanguage);
      fd.append("native_language", nativeLanguage);
      fd.append("persona", persona);
      fd.append("subtitle_target", subtitleTarget);

      const res = await fetch(`${API_BASE}/turn`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as TurnAudioResponse;

      setResultAudio(data);
      addMsg("user", data.user_text);
      addMsg("assistant", data.assistant_reply);

      setLastAssistantAudioBase64(data.assistant_audio_base64 || "");
      playBase64Mp3(data.assistant_audio_base64);

      setRecordedBlob(null);
      setRecState("idle");
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function clearChat() {
    setChat([]);
    setResultText(null);
    setResultAudio(null);
    setError(null);
    setLastAssistantAudioBase64("");

    // Optional: also clear backend memory for this conversation id
    if (API_BASE) {
      try {
        await fetch(`${API_BASE}/clear`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: conversationId }),
        });
      } catch {
        // ignore
      }
    }
  }

  const latest = resultText ?? resultAudio;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ margin: 0 }}>🗣️ Language Mirror (Tutor)</h1>
      <p style={{ opacity: 0.8, marginTop: 8 }}>
        Voice-first tutor: Google STT → Gemini (Vertex AI) → ElevenLabs (TTS) + subtitles
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16, marginTop: 16 }}>
        {/* Settings */}
        <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Settings</h3>

          <label>Conversation ID</label>
          <input style={{ width: "100%" }} value={conversationId} onChange={(e) => setConversationId(e.target.value)} />

          {/* Persona: preset + custom override */}
          <label style={{ display: "block", marginTop: 8 }}>Persona</label>
          <select style={{ width: "100%" }} value={personaPreset} onChange={(e) => setPersonaPreset(e.target.value)}>
            {PERSONA_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            style={{ width: "100%", marginTop: 6 }}
            placeholder="(optional) custom persona overrides dropdown..."
            value={personaCustom}
            onChange={(e) => setPersonaCustom(e.target.value)}
          />
          <small style={{ opacity: 0.7 }}>
            Active persona: <b>{persona}</b>
          </small>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            <div>
              <label>Target language</label>
              <select style={{ width: "100%" }} value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
                {LANG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <small style={{ opacity: 0.7 }}>Tutor speaks this language.</small>
            </div>

            <div>
              <label>Native language</label>
              <select style={{ width: "100%" }} value={nativeLanguage} onChange={(e) => setNativeLanguage(e.target.value)}>
                {NATIVE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <small style={{ opacity: 0.7 }}>Tips/explanations language.</small>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            <div>
              <label>STT language</label>
              <select style={{ width: "100%" }} value={sttLanguage} onChange={(e) => setSttLanguage(e.target.value)}>
                {STT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <small style={{ opacity: 0.7 }}>Google Speech-to-Text languageCode.</small>
            </div>

            <div>
              <label>Subtitle target</label>
              <select style={{ width: "100%" }} value={subtitleTarget} onChange={(e) => setSubtitleTarget(e.target.value)}>
                {NATIVE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <small style={{ opacity: 0.7 }}>Subtitle translation language.</small>
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={replayLast} disabled={!lastAssistantAudioBase64} style={{ padding: "8px 12px" }}>
              🔊 Replay
            </button>
            <button onClick={clearChat} style={{ padding: "8px 12px" }}>
              🧹 Clear chat
            </button>
          </div>

          <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
            API: {API_BASE || "(missing VITE_API_BASE)"}
          </div>
        </div>

        {/* Interaction */}
        <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Text mode</h3>
          <textarea
            rows={3}
            style={{ width: "100%", fontSize: 16 }}
            placeholder="Enter a sentence (in target language)"
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={submitText}
              disabled={loading || !userText.trim() || !API_BASE}
              style={{ marginTop: 0, padding: "8px 16px", fontSize: 16 }}
            >
              {loading ? "Processing..." : "Submit text"}
            </button>
          </div>

          <hr style={{ margin: "16px 0" }} />

          <h3 style={{ marginTop: 0 }}>Voice mode</h3>
          {!canRecord && <div style={{ color: "salmon" }}>MediaRecorder not supported in this browser.</div>}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={startRecording} disabled={loading || recState === "recording" || !API_BASE} style={{ padding: "8px 16px" }}>
              🎙 Start
            </button>

            <button onClick={stopRecording} disabled={loading || recState !== "recording"} style={{ padding: "8px 16px" }}>
              ⏹ Stop
            </button>

            <button onClick={submitRecording} disabled={loading || !recordedBlob || !API_BASE} style={{ padding: "8px 16px" }}>
              🚀 Send
            </button>

            <span style={{ opacity: 0.8 }}>
              {recState === "recording" ? "Recording..." : recordedBlob ? "Recorded ✔" : "Idle"}
            </span>
          </div>

          {recordedBlob && <audio controls style={{ marginTop: 10, width: "100%" }} src={URL.createObjectURL(recordedBlob)} />}

          {latest && (
            <div style={{ marginTop: 14, border: "1px solid #2a2a2a", borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: "0 0 10px 0" }}>Latest turn</h3>

              {resultAudio?.user_text && (
                <>
                  <div style={{ fontWeight: 700 }}>🧾 STT user_text</div>
                  <div style={{ marginBottom: 10 }}>{resultAudio.user_text}</div>
                </>
              )}

              {resultAudio?.subtitle_native && (
                <>
                  <div style={{ fontWeight: 700 }}>🪄 Subtitles (native)</div>
                  <div style={{ marginBottom: 10 }}>{resultAudio.subtitle_native}</div>
                </>
              )}

              <div style={{ fontWeight: 700 }}>✍️ corrected_user</div>
              <div style={{ marginBottom: 10 }}>{latest.corrected_user}</div>

              <div style={{ fontWeight: 700 }}>📘 tips_native</div>
              <div style={{ marginBottom: 10, whiteSpace: "pre-wrap" }}>{latest.tips_native}</div>

              <div style={{ fontWeight: 700 }}>🤖 assistant_reply</div>
              <div style={{ marginBottom: 10 }}>{latest.assistant_reply}</div>

              <div style={{ fontWeight: 700 }}>👉 follow_up_question</div>
              <div>{latest.follow_up_question}</div>
            </div>
          )}

          {error && <pre style={{ color: "salmon", marginTop: 12, whiteSpace: "pre-wrap" }}>{error}</pre>}
        </div>
      </div>

      {/* Transcript */}
      <div style={{ marginTop: 16, border: "1px solid #333", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Conversation</h2>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Tip: demo 時連續講 3 輪很像 voice agent</div>
        </div>

        <div style={{ marginTop: 10, maxHeight: 320, overflow: "auto", paddingRight: 6 }}>
          {chat.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No messages yet. Try Voice mode and send a turn.</div>
          ) : (
            chat.map((m, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: 10,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid #2a2a2a",
                  background: m.role === "assistant" ? "rgba(255,255,255,0.03)" : "transparent",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{m.role === "user" ? "🧑 You" : "🤖 Tutor"}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>
    </div>
  );
}
