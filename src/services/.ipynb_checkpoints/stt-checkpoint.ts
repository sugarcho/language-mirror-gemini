import { SpeechClient } from "@google-cloud/speech";

const client = new SpeechClient();

export async function speechToText(params: {
  audioBytes: Buffer;
  languageCode: string;       // e.g. "ja-JP", "it-IT"
  sampleRateHertz?: number;   // e.g. 16000
}): Promise<string> {
  const { audioBytes, languageCode, sampleRateHertz = 16000 } = params;

  const [resp] = await client.recognize({
    config: {
      encoding: "LINEAR16",
      sampleRateHertz,
      languageCode,
    },
    audio: { content: audioBytes.toString("base64") },
  });

  return (resp.results ?? [])
    .map(r => r.alternatives?.[0]?.transcript ?? "")
    .join(" ")
    .trim();
}
