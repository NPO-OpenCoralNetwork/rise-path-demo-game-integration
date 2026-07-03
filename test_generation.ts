
import { generateCourse } from './services/geminiService.ts';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
  console.log("🚀 Testing Curriculum Generation...");
  const topic = "Pythonで量子回路を作ってみよう";
  const profile = { 
    openness: 80, 
    conscientiousness: 70, 
    extraversion: 40, 
    agreeableness: 60, 
    neuroticism: 30 
  };
  
  try {
    const course = await generateCourse(topic, 'gemini-2.5-flash', profile);
    console.log("✅ Generation Success!");
    console.log("--- Course Overview ---");
    console.log("Title: " + course.title);
    console.log("Preferred Template: " + course.preferredTemplate);
    console.log("--- Chapter 1 Blocks ---");
    console.log(JSON.stringify(course.chapters[0].blocks, null, 2));
    console.log("--- Chapter 1 Slides (Adapted) ---");
    console.log(JSON.stringify(course.chapters[0].slides, null, 2));
  } catch (e) {
    console.error("❌ Generation Failed:", e);
  }
}

test();
