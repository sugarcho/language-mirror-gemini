# Language Mirror (Tutor) — Voice-first AI Language Tutor

A voice-driven language tutor that lets users speak naturally and receive:
- Speech-to-text (Google Cloud Speech-to-Text)
- Corrections + coaching + role-play replies (Gemini on Vertex AI)
- Natural voice responses (ElevenLabs TTS)
- Optional translated subtitles (Google Cloud Translate)

**Live demo (Frontend):** https://language-mirror-gemini.vercel.app/  
**API (Backend):** https://language-mirror-api-99706145314.us-central1.run.app

---

## What it does

Language Mirror is **voice-first**: users speak, and the app responds with:
- A transcript (STT)
- A corrected version of the user’s sentence
- Tips/explanations in the user’s native language
- An in-character assistant reply (persona-based roleplay)
- Spoken audio reply (ElevenLabs)

---

## Architecture

Browser (React/Vite)
- Records audio (webm/opus)
- Sends to API `/turn` (multipart form)
- Displays: transcript, subtitles, corrections, tips, assistant reply
- Plays ElevenLabs audio (mp3)

Backend (Node + Hono on Google Cloud Run)
1. Convert webm/opus → wav 16k mono (ffmpeg)
2. Google Cloud Speech-to-Text → `user_text`
3. (Optional) Google Cloud Translate → `subtitle_native`
4. Gemini (Vertex AI) → JSON: `corrected_user`, `tips_native`, `assistant_reply`, `follow_up_question`
5. ElevenLabs TTS → `assistant_audio_base64`

---

## Features

- ✅ Text mode (fast iteration) via `/turn_text`
- ✅ Voice mode (speech input) via `/turn`
- ✅ Persona / role-play style tutoring (e.g. Osaka izakaya owner)
- ✅ Native-language explanations + optional subtitles
- ✅ Conversation history per `conversation_id`

---

## Repo structure

.
├── src/ # backend (Hono + services)
├── web/ # frontend (Vite + React)
└── Dockerfile # Cloud Run container

yaml
Copy code

---

## Local development

### Prerequisites
- Node.js 18+ (recommended)
- Google Cloud project with:
  - Vertex AI enabled
  - Speech-to-Text enabled
  - Translate enabled (optional)
- ElevenLabs API key + voice id
- ffmpeg installed locally (optional; required in Cloud Run container)

### Backend env vars

Create a `.env` in repo root:

GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
GOOGLE_CLOUD_LOCATION=us-central1

ELEVENLABS_API_KEY=YOUR_ELEVENLABS_KEY
ELEVENLABS_VOICE_ID=YOUR_VOICE_ID
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
PORT=3000

perl
Copy code

### Run backend locally

```bash
npm install
npm run dev
Health check:

bash
Copy code
curl http://127.0.0.1:3000/health
Run frontend locally
bash
Copy code
cd web
npm install
npm run dev -- --host
Set the frontend API base:

Local: use port-forwarding to http://127.0.0.1:3000

Hosted: set VITE_API_BASE to your Cloud Run URL

Deployment
Backend (Cloud Run)
bash
Copy code
gcloud run deploy language-mirror-api \
  --source . \
  --allow-unauthenticated \
  --region us-central1
Verify:

bash
Copy code
curl https://language-mirror-api-99706145314.us-central1.run.app/health
Frontend (Vercel)
Import this GitHub repo in Vercel

Set Root Directory = web

Add env var:

VITE_API_BASE = https://language-mirror-api-99706145314.us-central1.run.app

Deploy

API
POST /turn_text
JSON body:

json
Copy code
{
  "conversation_id":"demo1",
  "target_language":"ja",
  "native_language":"zh-TW",
  "persona":"Osaka izakaya owner",
  "user_text":"昨日買い物に行きました"
}
POST /turn
multipart/form-data:

audio: webm file (MediaRecorder output)

conversation_id, stt_language, target_language, native_language, persona, subtitle_target

Returns:

user_text, subtitle_native

corrected_user, tips_native

assistant_reply, follow_up_question

assistant_audio_base64 (mp3)

License
MIT (see LICENSE)
