// App.tsx
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

const API_BASE = `${window.location.protocol}//${window.location.hostname}:3000`;

export default function App() {
  // common params
  const [conversationId, setConversationId] = useState("demo1");
  const [persona, setPersona] = useState("Osaka izakaya owner");
  const [targetLanguage, setTargetLanguage] = useState("ja");
  const [nativeLanguage, setNativeLanguage] = useState("zh-TW");
  const [sttLanguage, setSttLanguage] = useState("ja-JP");
  const [subtitleTarget, setSubtitleTarget] = useState("zh-TW"); // AR subtitles target

  // text mode
  const [userText, setUserText] = useState("");

  // output
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<TurnTextResponse | null>(null);
  const [resultAudio, setResultAudio] = useState<TurnAudioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // audio playback
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // recorder state
  const [recState, setRecState] = useState<"idle" | "recording" | "stopped">("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const canRecord = useMemo(() => typeof MediaRecorder !== "undefined", []);

  useEffect(() => {
    // cleanup audio on unmount
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  function playBase64Mp3(base64: string) {
    if (!base64) return;
    const url = "data:audio/mp3;base64," + base64;
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = url;
    audioRef.current.play().catch(() => {});
  }

  async function submitText() {
    setLoading(true);
    setError(null);
    setResultAudio(null);
    setResultText(null);

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
      playBase64Mp3(data.assistant_audio_base64);
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
        // stop mic track
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

    try {
      const fd = new FormData();
      // IMPORTANT: name "audio" must match backend parseBody field
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
      playBase64Mp3(data.assistant_audio_base64);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 860 }}>
      <h1 style={{ margin: 0 }}>🗣️ Language Mirror (JA Tutor)</h1>
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
              <input style={{ width: "100%" }} value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)} />
            </div>
            <div>
              <label>Native language</label>
              <input style={{ width: "100%" }} value={nativeLanguage} onChange={(e) => setNativeLanguage(e.target.value)} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <div>
              <label>STT language</label>
              <input style={{ width: "100%" }} value={sttLanguage} onChange={(e) => setSttLanguage(e.target.value)} />
              <small style={{ opacity: 0.7 }}>e.g. ja-JP, en-US</small>
            </div>
            <div>
              <label>Subtitle target</label>
              <input style={{ width: "100%" }} value={subtitleTarget} onChange={(e) => setSubtitleTarget(e.target.value)} />
              <small style={{ opacity: 0.7 }}>e.g. zh-TW (AR subtitles)</small>
            </div>
          </div>
        </div>

        <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Text mode</h3>
          <textarea
            rows={4}
            style={{ width: "100%", fontSize: 16 }}
            placeholder="Enter a Japanese sentence, e.g. 昨日 私は 買い物 行きました"
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
              🚀 Send to /turn
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

      {(resultText || resultAudio) && (
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
              <h4>🪄 Subtitles (native)</h4>
              <p>{resultAudio.subtitle_native}</p>
            </>
          )}

          <h4>✍️ corrected_user</h4>
          <p>{(resultText ?? resultAudio)!.corrected_user}</p>

          <h4>📘 tips_native</h4>
          <p>{(resultText ?? resultAudio)!.tips_native}</p>

          <h4>🤖 assistant_reply</h4>
          <p>{(resultText ?? resultAudio)!.assistant_reply}</p>

          <h4>👉 follow_up_question</h4>
          <p>{(resultText ?? resultAudio)!.follow_up_question}</p>

          <p style={{ opacity: 0.7, marginTop: 12 }}>
            🔊 Audio will autoplay; you can replay by submitting again.
          </p>
        </div>
      )}
    </div>
  );
}
