export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatCompletion(
  messages: LLMMessage[],
  options?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  const res = await fetch(`${process.env.NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || "deepseek-ai/deepseek-v3.2",
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.max_tokens ?? 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

export async function chatCompletionJSON<T>(
  messages: LLMMessage[],
  options?: { temperature?: number; max_tokens?: number }
): Promise<T> {
  const raw = await chatCompletion(messages, options);
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}
