import OpenAI from "openai";
import { CONFIG } from "./config";
import { recordCost } from "./costs";
import type { Tool, ToolCall } from "./types";

let client: OpenAI | null = null;

export function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function getClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  client = new OpenAI({
    apiKey,
    timeout: CONFIG.LLM.REQUEST_TIMEOUT_MS,
  });

  return client;
}

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
  tool_call_id?: string;
}

export interface LLMCallOptions {
  systemPrompt: string;
  userMessage: string;
  tools?: Tool[];
  jsonMode?: boolean;
  temperature?: number;
  model?: string;
  stream?: boolean; // Enable streaming for long operations
  stage?: string; // For cost tracking
}

export interface LLMCallResult {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: string;
}

let callStats = { total: 0, failed: 0 };

function modelSupportsTemperature(model: string): boolean {
  // Models that DON'T support custom temperature
  const noTempModels = ["gpt-4o", "gpt-4-mini"];
  
  // Check if model matches any of the no-temperature models
  for (const noTempModel of noTempModels) {
    if (model.toLowerCase().includes(noTempModel)) {
      return false;
    }
  }
  
  // All other models (gpt-4-turbo, gpt-5.2, gpt-5-mini, o3, o4) support temperature
  return true;
}

/**
 * Select the appropriate model based on task complexity
 * 2026 Models: gpt-5.2 (latest), gpt-5-mini (fast), o3 (reasoning), gpt-5.2-pro (complex)
 */
export function selectModel(
  taskType: "fast" | "standard" | "advanced" | "reasoning" | "pro" = "standard"
): string {
  switch (taskType) {
    case "fast":
      return CONFIG.LLM.MODEL_FAST; // gpt-5-mini - economical, fast
    case "advanced":
      return CONFIG.LLM.MODEL_ADVANCED; // gpt-5.2 - best quality
    case "reasoning":
      return CONFIG.LLM.MODEL_REASONING; // o3 - highest reasoning
    case "pro":
      return CONFIG.LLM.MODEL_PRO || CONFIG.LLM.MODEL_ADVANCED; // gpt-5.2-pro - extended compute
    case "standard":
    default:
      return CONFIG.LLM.MODEL_STANDARD; // gpt-5.2 - general purpose
  }
}

/**
 * Call OpenAI with optional tool definitions
 */
export async function callLLM(options: LLMCallOptions): Promise<LLMCallResult> {
  const {
    systemPrompt,
    userMessage,
    tools,
    jsonMode = false,
    temperature = CONFIG.LLM.TEMPERATURE_ANALYTICAL,
    model = CONFIG.LLM.MODEL_STANDARD,
    stage = "unknown",
  } = options;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const useTemperature = modelSupportsTemperature(model);

  const openai = getClient();

  for (let attempt = 1; attempt <= CONFIG.LLM.RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        temperature: useTemperature ? temperature : undefined,
        tools: tools ? tools.map((t) => ({ type: "function" as const, function: t.function })) : undefined,
        response_format: jsonMode ? { type: "json_object" } : undefined,
      });

      callStats.total++;

      // Track cost
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      recordCost(stage, model, inputTokens, outputTokens);

      const message = response.choices[0].message;

      const toolCalls = message.tool_calls
        ? message.tool_calls.map((tc: OpenAI.ChatCompletionMessageToolCall) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }))
        : undefined;

      return {
        content: message.content || "",
        toolCalls,
        finishReason: response.choices[0].finish_reason || "stop",
      };
    } catch (error: any) {
      const status = Number(error?.status ?? error?.statusCode ?? 0);

      if (status >= 400 && status < 500 && status !== 429) {
        callStats.failed++;
        throw error;
      }

      if (error?.status === 429 && attempt < CONFIG.LLM.RETRY_ATTEMPTS) {
        // Silent rate limit retry
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (attempt === CONFIG.LLM.RETRY_ATTEMPTS) {
        callStats.failed++;
        throw error;
      }
      
      // Silent retry - wait a bit before next attempt
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error("LLM call failed after all retries");
}

/**
 * Parse JSON from LLM response (with fallback)
 */
export function parseJSON<T>(text: string): T {
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (match) {
      return JSON.parse(match[1]);
    }

    // Try to find JSON object
    const objStart = text.indexOf("{");
    const objEnd = text.lastIndexOf("}");
    if (objStart !== -1 && objEnd > objStart) {
      return JSON.parse(text.substring(objStart, objEnd + 1));
    }

    throw new Error("Could not parse JSON from response");
  }
}

/**
 * Get statistics about LLM calls
 */
export function getCallStats() {
  return callStats;
}
