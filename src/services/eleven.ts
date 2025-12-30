// eleven.ts
export async function elevenTTS(params: {
  apiKey: string;
  voiceId: string;
  modelId: string;
  text: string;
}): Promise<Buffer> {
  const { apiKey, voiceId, modelId, text } = params;

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.4, similarity_boost: 0.8 },
    }),
  });

  if (!resp.ok) {
    throw new Error(`ElevenLabs error ${resp.status}: ${await resp.text()}`);
  }

  return Buffer.from(await resp.arrayBuffer());
}
