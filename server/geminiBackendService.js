import { GoogleGenAI } from "@google/genai";
import { MODEL_IDS } from "./llm/models.config.js";

const getApiKey = () => {
  // Server key only: VITE_* variables are meant for the browser bundle.
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn("GEMINI_API_KEY is not set in environment variables.");
    return "";
  }
  return key;
};

const getClient = () => {
  const key = getApiKey();
  if (!key) return null;
  // Initialize for Gemini API (not Vertex AI for now, assuming API key usage)
  const genAI = new GoogleGenAI({ apiKey: key });
  return genAI;
};

/**
 * Generates an image using Gemini 3 Pro Image Preview.
 * Returns base64 image data + mime type.
 */
export const generateImageWithGemini = async ({
  prompt,
  aspectRatio = "16:9",
  imageSize = "1K",
} = {}) => {
  const genAI = getClient();
  if (!genAI) throw new Error("Gemini API Key missing");
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
