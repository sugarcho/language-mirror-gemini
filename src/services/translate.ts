// src/services/translate.ts
import { TranslationServiceClient } from "@google-cloud/translate";

const client = new TranslationServiceClient();

export async function translateText(text: string, target: string) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
  if (!projectId) throw new Error("Missing GOOGLE_CLOUD_PROJECT");

  // v3: parent format
  const parent = `projects/${projectId}/locations/${location}`;

  const request = {
    parent,
    contents: [text],
    mimeType: "text/plain",
    targetLanguageCode: target,
  };

  const [response] = await client.translateText(request as any);
  const out = response.translations?.[0]?.translatedText ?? "";
  return out;
}
