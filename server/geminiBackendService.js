import { GoogleGenAI, Type } from "@google/genai";
import { retrieveContext } from "./ragService.js";
import fs from 'fs/promises';

const getApiKey = () => {
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
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
 * Analyzes a document directly using Gemini's multimodal capabilities (File/Image).
 * Used when local text extraction fails (e.g. image-only PDFs).
 */
export const analyzeDocumentWithGemini = async (filePath, mimeType) => {
  const genAI = getClient();
  if (!genAI) throw new Error("Gemini API Key missing");

  console.log(`   [Gemini Vision] Analyzing document: ${filePath} (${mimeType})...`);
  try {
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');

    // Normalize mimeType
    let validMimeType = mimeType;
    if (mimeType === 'pdf') validMimeType = 'application/pdf';
    if (mimeType === 'audio') validMimeType = 'audio/mp3'; // Default to mp3 for generic audio

    const prompt = `
      You are an expert technical analyst.
      Analyze this document/image in extreme detail.
      
      If it contains text, summarize it.
      If it is a diagram, blueprint, or screenshot (e.g. Unity/Blender), DESCRIBE what is visually depicted.
      - What objects/structures are visible?
      - What technical concepts are implied (e.g. node graph, physics simulation, 3D model topology)?
      - Infer the learning goal from the visual context.
      
      Output a comprehensive summary in Japanese.
    `;

    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: validMimeType, data: base64 } }
        ]
      }]
    });

    console.log("   [Gemini Vision] Analysis complete.");
    return result.text || result.candidates?.[0]?.content?.parts?.[0]?.text || "分析できませんでした。";
  } catch (e) {
    console.error("   [Gemini Vision] Analysis Failed:", e);
    return "ファイルの視覚分析に失敗しました。";
  }
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
    model: "gemini-3-pro-image-preview",
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

// --- Schemas ---

const requirementsSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "Display title for the curriculum, e.g. 'Learn Python Basics (Beginner)'" },
    goal: { type: Type.STRING, description: "The core learning goal, e.g. 'Master Python basics'" },
    level: { type: Type.STRING, enum: ["beginner", "intermediate", "advanced"] },
    target_audience: { type: Type.STRING },
    constraints: { type: Type.ARRAY, items: { type: Type.STRING } },
    success_criteria: { type: Type.ARRAY, items: { type: Type.STRING } },
    materials: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          material_id: { type: Type.STRING },
          ref: { type: Type.STRING }
        }
      }
    }
  },
  required: ["summary", "goal", "level", "target_audience", "constraints", "success_criteria"]
};

const roadmapSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    overview: { type: Type.STRING },
    total_hours: { type: Type.NUMBER },
    modules: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          module_id: { type: Type.STRING },
          title: { type: Type.STRING },
          objective: { type: Type.STRING },
          estimated_hours: { type: Type.NUMBER },
          order: { type: Type.NUMBER }
        },
        required: ["module_id", "title", "objective", "estimated_hours", "order"]
      }
    }
  },
  required: ["title", "overview", "total_hours", "modules"]
};

// --- DocChapter Compatible Schema (Rich Content) ---

// Localized text for bilingual support
const localizedTextSchema = {
  type: Type.OBJECT,
  properties: {
    en: { type: Type.STRING, description: "English text" },
    jp: { type: Type.STRING, description: "Japanese text" }
  },
  required: ["en", "jp"]
};

// Rich content block types
const docBlockSchema = {
  type: Type.OBJECT,
  properties: {
    type: {
      type: Type.STRING,
      enum: ["text", "callout", "code", "list", "mermaid"],
      description: "Block type - use varied types for engaging content"
    },
    // For 'text' type
    text: localizedTextSchema,
    style: { type: Type.STRING, enum: ["normal", "lead", "quote"], description: "Text style - use 'lead' for intro paragraphs" },
    // For 'callout' type
    variant: { type: Type.STRING, enum: ["info", "warning", "tip", "success"], description: "Callout style" },
    title: localizedTextSchema,
    // For 'code' type
    code: { type: Type.STRING, description: "Code content" },
    language: { type: Type.STRING, description: "Programming language" },
    filename: { type: Type.STRING, description: "Optional filename for context" },
    // For 'list' type
    items: { type: Type.ARRAY, items: localizedTextSchema, description: "List items" },
    listStyle: { type: Type.STRING, enum: ["bullet", "number"], description: "List style" },
    // For 'mermaid' type
    chart: { type: Type.STRING, description: "Mermaid diagram syntax" },
    caption: localizedTextSchema
  },
  required: ["type"]
};

// Section with multiple content blocks
const docSectionSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING, description: "Unique section ID like '1-1', '1-2'" },
    title: localizedTextSchema,
    content: {
      type: Type.ARRAY,
      items: docBlockSchema,
      description: "Array of content blocks - include 4-6 varied blocks per section"
    }
  },
  required: ["id", "title", "content"]
};

// Quiz question schema
const quizQuestionSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    text: localizedTextSchema,
    options: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          text: localizedTextSchema
        },
        required: ["id", "text"]
      }
    },
    correctAnswer: { type: Type.STRING, description: "ID of correct option" },
    explanation: localizedTextSchema
  },
  required: ["id", "text", "options", "correctAnswer"]
};

// Lesson schema (DocChapter compatible)
const lessonSchema = {
  type: Type.OBJECT,
  properties: {
    lesson_id: { type: Type.STRING, description: "Unique ID like 'm1-l1'" },
    title: localizedTextSchema,
    subtitle: localizedTextSchema,
    reading_time: localizedTextSchema,
    estimated_min: { type: Type.NUMBER, description: "Estimated reading time in minutes" },
    sections: {
      type: Type.ARRAY,
      items: docSectionSchema,
      description: "2-4 sections per lesson, each with rich content"
    },
    quiz: {
      type: Type.OBJECT,
      properties: {
        title: localizedTextSchema,
        questions: { type: Type.ARRAY, items: quizQuestionSchema }
      }
    }
  },
  required: ["lesson_id", "title", "subtitle", "reading_time", "estimated_min", "sections"]
};

// Module schema
const moduleSchema = {
  type: Type.OBJECT,
  properties: {
    module_id: { type: Type.STRING },
    title: localizedTextSchema,
    objective: localizedTextSchema,
    estimated_hours: { type: Type.NUMBER },
    lessons: { type: Type.ARRAY, items: lessonSchema }
  },
  required: ["module_id", "title", "objective", "estimated_hours", "lessons"]
};

// Full curriculum schema
const curriculumSchema = {
  type: Type.OBJECT,
  properties: {
    title: localizedTextSchema,
    description: localizedTextSchema,
    ui_template_id: { type: Type.STRING, enum: ["doc_chapter"] },
    modules: { type: Type.ARRAY, items: moduleSchema }
  },
  required: ["title", "description", "modules"]
};


// --- Generators ---

/**
 * Generate Requirements Draft from user message and optional history.
 */
export const generateRequirements = async (message, attachments = [], userId) => {
  const genAI = getClient();
  if (!genAI) throw new Error("Gemini API Key missing");

  console.log("   [Gemini API] Starting Requirements generation...");
  let context = "";
  if (userId) {
    try {
      const docs = await retrieveContext(message, 3, userId);
      if (docs.length > 0) {
        console.log(`   [Gemini API] Retrieved ${docs.length} RAG docs for requirements.`);
        context = `\nReference Materials:\n${docs.map(d => `- ${d}`).join('\n')}\n`;
      }
    } catch (e) {
      console.warn("   [Gemini API] RAG retrieval skipped/failed:", e.message);
    }
  }

  const prompt = `
    User Request: "${message}"
    Attachments: ${JSON.stringify(attachments)}
    ${context}
    
    Generate a JSON object defining the curriculum requirements.
  `;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      systemInstruction: `
        You are an expert Learning Concierge. 
        Your goal is to analyze the user's request and extract structured learning requirements.
        - Identify the topic, goal, and difficulty level.
        - If the request is vague, infer the most likely intent (e.g. "learn python" -> "Python Basics").
        - Set concrete constraints and success criteria.
      `,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: requirementsSchema
      }
    });

    console.log("   [Gemini API] Requirements generation finished.");
    const text = result.text || result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error("Gemini full response:", JSON.stringify(result, null, 2));
      throw new Error("No text in Gemini response");
    }

    return JSON.parse(text);
  } catch (err) {
    console.error("   [Gemini API] Requirements generation failed:", err);
    throw err;
  }
};

/**
 * Generate Roadmap Draft from approved requirements.
 */
export const generateRoadmap = async (requirements) => {
  const genAI = getClient();
  if (!genAI) throw new Error("Gemini API Key missing");

  console.log("   [Gemini API] Starting Roadmap generation...");
  const prompt = `
    Based on these requirements: ${JSON.stringify(requirements)}
    
    Generate a JSON object defining the roadmap with 3 to 5 modules.
    Focus on a logical learning path from basics to advanced.
  `;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      systemInstruction: `
        You are a Curriculum Architect.
        Create a high-level roadmap based on the provided requirements.
        - Output MUST be valid JSON matching the schema.
        - Assign estimated hours for each module.
        - Ensure a logical progression (Foundations -> Practice -> Application).
      `,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: roadmapSchema
      }
    });

    console.log("   [Gemini API] Roadmap generation finished.");
    const text = result.text || result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("No text in Gemini response (roadmap)");

    return JSON.parse(text);
  } catch (err) {
    console.error("   [Gemini API] Error during Roadmap generation:", err);
    throw err;
  }
};

/**
 * Generate Full Curriculum from approved requirements and roadmap.
 * Produces rich DocChapter format content with bilingual support.
 */
export const generateCurriculum = async (requirements, roadmap, options = {}, userId) => {
  const genAI = getClient();
  if (!genAI) throw new Error("Gemini API Key missing");

  console.log("   [Gemini API] Starting Rich Curriculum generation...");
  let context = "";
  if (userId) {
    try {
      const docs = await retrieveContext(requirements.goal || "curriculum", 5, userId);
      if (docs.length > 0) {
        console.log(`   [Gemini API] Retrieved ${docs.length} RAG docs for curriculum.`);
        context = `\nReference Materials:\n${docs.map(d => `- ${d}`).join('\n')}\n`;
      }
    } catch (e) {
      console.warn("   [Gemini API] RAG retrieval skipped:", e.message);
    }
  }

  // Enhanced prompt with detailed structure
  const prompt = `
## TASK: Generate a Complete Educational Curriculum

### INPUT DATA
**Requirements:**
${JSON.stringify(requirements, null, 2)}

**Roadmap:**
${JSON.stringify(roadmap, null, 2)}

${context ? `**Reference Materials:**\n${context}` : ''}

### CRITICAL OUTPUT REQUIREMENTS

Generate a JSON curriculum following these STRICT rules:

#### STRUCTURE REQUIREMENTS:
- Each module: 1-2 lessons (MAX 2!)
- Each lesson: 2-3 sections
- Each section: 4-6 content blocks (Target 4-5)
- Total blocks per lesson: 12-18 blocks

#### MANDATORY BLOCK DISTRIBUTION PER LESSON:
1. **Text blocks**: At least 2 - Opening paragraphs (Keep concise!)
2. **Mermaid diagrams**: At least 1 - Visual representations
3. **Code blocks**: At least 1 - Practical examples
4. **Callout blocks**: At least 2 - Tips/Warnings
5. **List blocks**: At least 1 - Key points

#### CALLOUT BLOCK RULES (CRITICAL!):
Every callout block MUST contain:
- "type": "callout"
- "variant": one of ["tip", "warning", "info", "success"]
- "title": {"en": "...", "jp": "..."} - REQUIRED!
- "text": {"en": "...", "jp": "..."} - REQUIRED!

Example of CORRECT callout:
{
  "type": "callout",
  "variant": "tip",
  "title": {"en": "Pro Tip", "jp": "プロのコツ"},
  "text": {"en": "Validate input.", "jp": "入力を検証しましょう。"}
}

#### LIST BLOCK RULES:
Every list block MUST contain:
- "type": "list"
- "items": array of {"en": "...", "jp": "..."} - REQUIRED!
- "listStyle": "bullet" or "number"

Focus on making the content GENUINELY EDUCATIONAL but CONCISE.
Quality over quantity.
  `;

  console.log(`   [Gemini API] Prompt Length: ${prompt.length} characters.`);


  // Comprehensive system instruction for rich content generation
  const systemInstruction = `
You are 'Rise Path Writer' - an ELITE Educational Content Architect.

## YOUR MISSION
Create PREMIUM educational content that transforms complex topics into engaging, memorable learning experiences. Your content should make learners feel excited and confident.

## YOUR WRITING PHILOSOPHY

### 1. The Hook Principle
Every section starts with an engaging hook:
- A thought-provoking question: "What if you could build a complete app in just 10 lines of code?"
- A relatable analogy: "Think of an API like a waiter in a restaurant..."
- A surprising fact: "Did you know that Python processes billions of transactions daily?"

### 2. The Visual Learning Principle
Humans are visual learners. For EVERY key concept:
- Create a Mermaid diagram showing relationships
- Use flowcharts for processes
- Use sequence diagrams for interactions
- Use class diagrams for structures

### 3. The Practical Mastery Principle
Theory without practice is forgettable:
- Every concept needs a runnable code example
- Include comments explaining each line
- Show both the basic and advanced usage

### 4. The Safety Net Principle
Help learners avoid common mistakes:
- Add "warning" callouts for pitfalls
- Add "tip" callouts for best practices
- Add "success" callouts for key achievements

## BLOCK TYPE SPECIFICATIONS

### Text Block (Essential for narrative flow)
{
  "type": "text",
  "text": {"en": "...", "jp": "..."},
  "style": "lead" // Use for opening paragraphs or "normal" for body text
}

### Mermaid Diagram (Essential for visualization)
Use proper escaping: newlines as "\\n" in the chart string
{
  "type": "mermaid",
  "chart": "graph TD\\n  A[Start] --> B{Decision}\\n  B -->|Yes| C[Action 1]\\n  B -->|No| D[Action 2]",
  "caption": {"en": "Caption here", "jp": "キャプションここ"}
}

### Callout Block (Essential for emphasis) - MUST HAVE TITLE AND TEXT!
{
  "type": "callout",
  "variant": "tip|warning|info|success",
  "title": {"en": "Title Here", "jp": "タイトルここ"},
  "text": {"en": "Explanation here", "jp": "説明ここ"}
}

### Code Block (Essential for practice)
{
  "type": "code",
  "language": "python|javascript|typescript|bash",
  "filename": "example.py",
  "code": "# Code with helpful comments\\nprint('Hello, World!')"
}

### List Block (Essential for key points) - MUST HAVE ITEMS!
{
  "type": "list",
  "items": [
    {"en": "First point", "jp": "最初のポイント"},
    {"en": "Second point", "jp": "2番目のポイント"},
    {"en": "Third point", "jp": "3番目のポイント"}
  ],
  "listStyle": "bullet"
}

## SECTION TEMPLATE (Follow this pattern!)

Each section MUST include these blocks in order:
1. **Hook** (text, style:"lead") - Engaging opening
2. **Visual Overview** (mermaid) - Big picture diagram
3. **Core Concepts** (text + list) - Key ideas explained
4. **Practical Example** (code) - Runnable demonstration  
5. **Pro Tips** (callout, variant:"tip") - Best practices
6. **Common Mistakes** (callout, variant:"warning") - What to avoid
7. **Summary** (callout, variant:"success") - What they learned

## QUIZ DESIGN

Each lesson should have 2-3 quiz questions:
- Question format: {"en": "...", "jp": "..."}
- 4 options with clear distinctions
- Explanation for the correct answer
- Mix conceptual (understanding) and practical (application) questions

## CRITICAL VALIDATION RULES

Before outputting, verify:
✓ Every callout has both title and text (NEVER empty!)
✓ Every list has items array with at least 3 items
✓ Every section has at least 5 content blocks
✓ Every lesson has at least 2 mermaid diagrams
✓ Every lesson has at least 3 callout blocks
✓ All text is bilingual (en + jp)
✓ lesson_id format: "m{module}-l{lesson}"
✓ section_id format: "{lesson_id}-s{section}"

## OUTPUT QUALITY STANDARD

Your content should be:
- **Deep**: Not surface-level summaries, but genuine insights
- **Practical**: Every concept has working code examples
- **Visual**: Diagrams make abstract concepts concrete
- **Memorable**: Analogies and stories stick in memory
- **Safe**: Warnings prevent common mistakes

Create content that learners will LOVE and recommend to others!
`;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      systemInstruction: systemInstruction,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: curriculumSchema,
        maxOutputTokens: 65536  // Increase token limit for complex curricula
      }
    });

    console.log("   [Gemini API] Rich Curriculum generation finished.");
    const resText = result.text || result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resText) {
      console.error("   [Gemini API] No text in response. Full result:", JSON.stringify(result, null, 2));
      throw new Error("No text in Gemini response (curriculum)");
    }

    // Try to parse JSON with better error handling
    let data;
    try {
      data = JSON.parse(resText);
    } catch (parseErr) {
      console.error("   [Gemini API] JSON parse error. Raw response (start):", resText.substring(0, 1000));
      console.error("   [Gemini API] Raw response (end):", resText.substring(Math.max(0, resText.length - 1000)));
      throw new Error(`Failed to parse curriculum JSON: ${parseErr.message}`);
    }

    // Post-processing
    data.ui_template_id = "doc_chapter";
    if (options.curriculumId) data.curriculum_id = options.curriculumId;
    if (options.version) data.version = options.version;

    // Log stats for debugging
    const moduleCount = data.modules?.length || 0;
    const lessonCount = data.modules?.reduce((sum, m) => sum + (m.lessons?.length || 0), 0) || 0;
    console.log(`   [Gemini API] Generated: ${moduleCount} modules, ${lessonCount} lessons`);

    return data;
  } catch (err) {
    console.error("   [Gemini API] Curriculum generation failed:", err);
    throw err;
  }
};
