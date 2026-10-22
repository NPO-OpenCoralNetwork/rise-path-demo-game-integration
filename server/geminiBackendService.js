/**
 * Image generation with Gemini (POST /api/v2/image, server/routes/content.js).
 *
 * Off unless GEMINI_ALLOWED is exactly "true" (server/llm/models.config.js isGeminiAllowed): the
 * Gemini API terms do not allow services that people under 18 use. Without it no client is made,
 * even when GEMINI_API_KEY is set, and the route answers 503 with error_type
 * IMAGE_GENERATION_UNAVAILABLE without charging the daily cap.
 */
import { GoogleGenAI } from "@google/genai";
import { MODEL_IDS, isGeminiAllowed } from "./llm/models.config.js";

/** error_type of the /image answer when this deployment does not generate images. */
export const IMAGE_GENERATION_UNAVAILABLE = "image_generation_unavailable";

/** Server keys only (never a VITE_* variable, which the browser bundle could carry). */
const getApiKey = () => (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();

/** Tests: a fake client with models.generateContent (still only used when Gemini is allowed), or null. */
let clientForTests = null;
export const setImageClientForTests = (client) => {
  clientForTests = client;
};

/** True when an image call can be made: Gemini is allowed and a key (or a test client) is set. */
export const isImageGenerationAvailable = () => isGeminiAllowed(process.env) && Boolean(clientForTests || getApiKey());

const getClient = () => {
  if (!isGeminiAllowed(process.env)) return null;
  if (clientForTests) return clientForTests;
  const key = getApiKey();
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
};

/**
 * Generates an image with the Gemini image model (MODEL_IDS.gemini.image).
 * Returns base64 image data + mime type.
 */
export const generateImageWithGemini = async ({
  prompt,
  aspectRatio = "16:9",
  imageSize = "1K",
} = {}) => {
  const genAI = getClient();
  // Thrown before any call: the image route answers 503 IMAGE_GENERATION_UNAVAILABLE and gives
  // the daily cap unit back for this code.
  if (!genAI) throw Object.assign(new Error("Gemini image generation is not available"), { code: "GEMINI_NOT_CONFIGURED" });
  if (!prompt) throw new Error("Prompt is required");

  console.log(`[Gemini Image] request: ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`);
  console.log(`[Gemini Image] config: aspectRatio=${aspectRatio} imageSize=${imageSize}`);

  const response = await genAI.models.generateContent({
    model: MODEL_IDS.gemini.image,
    contents: prompt,
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio,
        imageSize,
      },
    },
  });

  const parts = response?.candidates?.[0]?.content?.parts || [];
  const partTypes = parts.map((part) => (part.inlineData ? 'image' : part.text ? 'text' : 'unknown'));
  console.log(`[Gemini Image] response parts: ${partTypes.join(', ') || 'none'}`);
  const imagePart = parts.find((part) => part.inlineData?.data);
  if (!imagePart) throw new Error("No image returned");

  return {
    data: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
    text: parts.find((part) => part.text)?.text || "",
  };
};
