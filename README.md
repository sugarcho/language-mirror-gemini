# Language Mirror — Voice-First AI Language Tutor

An immersive, voice-driven language learning app that combines **Google Cloud AI**, **Vertex AI (Gemini)**, and **ElevenLabs** to create natural, conversational practice sessions.

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://language-mirror-gemini.vercel.app/)
[![API Status](https://img.shields.io/badge/API-online-blue)](https://language-mirror-api-99706145314.us-central1.run.app/health)

## 🎯 What It Does

Language Mirror lets users **speak naturally** in their target language and instantly receive:

- 📝 **Real-time transcription** (Google Cloud Speech-to-Text)
- ✏️ **Corrections & explanations** in your native language
- 🎭 **Persona-based roleplay responses** (Gemini on Vertex AI)
- 🔊 **Natural voice replies** (ElevenLabs TTS)
- 🌐 **Optional translated subtitles** (Google Cloud Translate)

**Example Flow:**
```
You say: "昨日 私は 買い物 行きました"
         ↓
App transcribes → Corrects → Explains → Responds in character
         ↓
"おお、昨日買い物行ったんやね！ええ也見見つかったんか？" (with audio)
```

---

## 🏗️ Architecture

```
┌─────────────────┐
│  Browser (React) │
│  - Records audio │
│  - Plays replies │
└────────┬────────┘
         │ webm/opus audio
         ↓
┌─────────────────────────────────┐
│  Backend (Node + Hono)           │
│  1. Convert → wav (ffmpeg)      │
│  2. STT → text                  │
│  3. Translate → subtitle        │
│  4. Gemini → corrections/reply  │
│  5. ElevenLabs → audio          │
└─────────────────────────────────┘
         │
         ↓
    JSON + mp3 audio
```

### Tech Stack

| Component | Technology |
|-----------|-----------|
| **Frontend** | React + Vite |
| **Backend** | Node.js + Hono (Cloud Run) |
| **Speech-to-Text** | Google Cloud Speech-to-Text |
| **AI Tutor** | Gemini 2.5 Flash (Vertex AI) |
| **Text-to-Speech** | ElevenLabs |
| **Translation** | Google Cloud Translate |
| **Hosting** | Google Cloud Run + Vercel |

---

## ✨ Features

- ✅ **Voice Mode** — Speak directly to the tutor via `/turn`
- ✅ **Text Mode** — Quick testing via `/turn_text`
- ✅ **Persona-Based Roleplay** — Practice with different characters (e.g., "Osaka izakaya owner")
- ✅ **Native Language Tips** — Get explanations in your language
- ✅ **Conversation History** — Maintains context per `conversation_id`
- ✅ **Real-Time Subtitles** — Optional translation for clarity

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+**
- **Google Cloud Project** with enabled APIs:
  - Vertex AI
  - Speech-to-Text
  - Translate (optional)
- **ElevenLabs API Key** ([Get one here](https://elevenlabs.io))
- **ffmpeg** (for audio conversion)

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/language-mirror-gemini.git
cd language-mirror-gemini
npm install
```

### 2. Configure Environment

Create `.env` in the project root:

```bash
# Google Cloud
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1

# ElevenLabs
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_VOICE_ID=your-voice-id
ELEVENLABS_MODEL_ID=eleven_multilingual_v2

# Server
PORT=3000
```

### 3. Run Backend

```bash
npm run dev
```

**Test health endpoint:**
```bash
curl http://127.0.0.1:3000/health
```

### 4. Run Frontend

```bash
cd web
npm install
npm run dev -- --host
```

**Configure API endpoint** in `web/.env`:
```bash
# Local development
VITE_API_BASE=http://127.0.0.1:3000

# Production
VITE_API_BASE=https://language-mirror-api-99706145314.us-central1.run.app
```

---

## 📡 API Reference

### `POST /turn_text`
Text-only mode (no audio input)

**Request:**
```json
{
  "conversation_id": "demo1",
  "target_language": "ja",
  "native_language": "zh-TW",
  "persona": "Osaka izakaya owner",
  "user_text": "昨日買い物に行きました"
}
```

**Response:**
```json
{
  "conversation_id": "demo1",
  "corrected_user": "昨日、買い物に行ったんやね。",
  "tips_native": "助詞「に」表示動作的方向...",
  "assistant_reply": "おお、昨日買い物行ったんやね！",
  "follow_up_question": "何買ったん？",
  "assistant_audio_base64": "SUQz..."
}
```

### `POST /turn`
Voice mode with audio input

**Request:** `multipart/form-data`
```
audio: <webm file>
conversation_id: "demo1"
stt_language: "ja-JP"
target_language: "ja"
native_language: "zh-TW"
persona: "Osaka izakaya owner"
subtitle_target: "native" (optional)
```

**Response:** Same as `/turn_text` plus:
```json
{
  "user_text": "昨日買い物に行きました",
  "subtitle_native": "昨天我去購物了",
  ...
}
```

---

## 🌐 Deployment

### Backend (Google Cloud Run)

```bash
gcloud run deploy language-mirror-api \
  --source . \
  --allow-unauthenticated \
  --region us-central1 \
  --set-env-vars GOOGLE_CLOUD_PROJECT=your-project-id,ELEVENLABS_API_KEY=your-key
```

### Frontend (Vercel)

1. Import your GitHub repo in Vercel
2. Set **Root Directory** = `web`
3. Add environment variable:
   ```
   VITE_API_BASE=https://language-mirror-api-99706145314.us-central1.run.app
   ```
4. Deploy 🚀

---

## 📁 Project Structure

```
language-mirror-gemini/
├── src/
│   ├── index.ts              # Main server (Hono)
│   └── services/
│       ├── gemini.ts         # Vertex AI integration
│       ├── eleven.ts         # ElevenLabs TTS
│       ├── speech.ts         # Google STT
│       └── translate.ts      # Google Translate
├── web/                      # Frontend (React + Vite)
│   ├── src/
│   │   ├── App.tsx
│   │   └── components/
│   └── package.json
├── Dockerfile                # Cloud Run container
├── package.json
└── .env.example
```

---

## 🎓 Use Cases

- **Language Learning** — Practice conversation with AI tutors
- **Pronunciation Practice** — Get instant feedback on your speech
- **Roleplay Scenarios** — Practice real-world situations (ordering food, shopping, etc.)
- **Grammar Correction** — Learn from mistakes with native-language explanations

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🙏 Acknowledgments

- **Google Cloud** for Speech-to-Text, Vertex AI, and Translate APIs
- **ElevenLabs** for high-quality multilingual TTS
- **Anthropic** for inspiration from conversational AI patterns

---

## 📞 Support

- **Live Demo**: [language-mirror-gemini.vercel.app](https://language-mirror-gemini.vercel.app/)
- **Issues**: [GitHub Issues](https://github.com/yourusername/language-mirror-gemini/issues)
- **API Health**: [Check Status](https://language-mirror-api-99706145314.us-central1.run.app/health)

---

**Built with ❤️ for language learners worldwide**