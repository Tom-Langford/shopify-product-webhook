import OpenAI from "openai";

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const withTimeout = (promise, timeoutMs) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
};

// Remove accidental code fences if present
const stripCodeFences = (s) =>
  (s || "").replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();

/**
 * FIX ONLY THE FIRST SENTENCE.
 * Remove illegal copular phrases like:
 * "is a handbag from Hermès"
 * without introducing ANY new wording.
 */
function fixFirstSentenceOnly(text) {
  if (!text) return text;

  const sentences = text.split(/(?<=[.!?])\s+/);
  if (!sentences.length) return text;

  sentences[0] = sentences[0]
    .replace(/\s+is\s+(a|an)\s+(handbag|bag|item)\s+from\s+Hermès\b/i, "")
    .replace(/\s+\./, ".")
    .trim();

  return sentences.join(" ");
}

export default async function handler(req, res) {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error("[ERROR] Request timeout - no response sent");
      res.status(504).json({ error: "Request timeout" });
    }
  }, 50000);

  try {
    if (req.method !== "POST") {
      clearTimeout(timeout);
      return res.status(405).json({ error: "Method not allowed" });
    }

    let body = req.body;
    if (typeof body === "string") {
      body = JSON.parse(body);
    } else if (!body) {
      clearTimeout(timeout);
      return res.status(400).json({ error: "Request body is required" });
    }

    const authHeader = req.headers["authorization"] || "";
    const expectedToken = process.env.MECHANIC_BEARER_TOKEN;

    if (!expectedToken) {
      clearTimeout(timeout);
      return res.status(500).json({ error: "Server configuration error" });
    }

    if (authHeader !== `Bearer ${expectedToken}`) {
      clearTimeout(timeout);
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!process.env.OPENAI_API_KEY || !openai) {
      clearTimeout(timeout);
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const { product, structured } = body || {};
    if (!product?.id || !product?.title) {
      clearTimeout(timeout);
      return res.status(400).json({ error: "Missing required product fields" });
    }

    const editorNote =
      structured?.editor_note ||
      product?.editor_note ||
      "";

    const prompt = [
      "You are generating the MAIN product description field for a luxury resale Shopify store for knowldgable customers who know what they are looking for.",
      "",
      "IMPORTANT JOB CONTEXT:",
      "- This description is NOT the primary on-page UX content.",
      "- Detailed specifications are shown elsewhere in a structured table.",
      "- Curated narrative content is shown elsewhere using modular puzzle descriptions.",
      "- This description exists primarily for SEO, Google Merchant feeds, Meta/Facebook listings, and Shopify Collective.",
      "",
      "Therefore:",
      "- The description must stand alone when read outside the website.",
      "- The goal is factual clarity and search relevance, not brand storytelling.",
      "- The output must read like catalogue copy, not marketing copy.",
      "",
      "FAILURE MODES TO AVOID:",
      "- Generic marketing language or sales tone.",
      "- Subjective adjectives such as luxury, iconic, elegant, stylish, casual, versatile, premium, timeless.",
      "- Sentence starters like 'This handbag', 'This bag', 'This item', or 'It is'.",
      "- Demonstrative or filler phrases such as 'features', 'adds', 'making it suitable for'.",
      "- Inferred lifestyle or usage.",
      "- Repeating the same facts in multiple ways.",
      "- Repeating dimensions outside the final paragraph.",
      "",
      "OUTPUT RULES:",
      "- Output VALID PLAIN TEXT only.",
      "- Use British English.",
      "- No exclamation marks. No em dashes.",
      "- Do not invent facts.",
      "- Dimensions may appear ONLY in the final paragraph.",
      "",
      "STRUCTURE:",
      "1) First paragraph: ONE complete sentence including the full product title verbatim.",
      "2) Second paragraph: size and construction only.",
      "3) Third paragraph: material and colour characteristics only.",
      "4) Final paragraph: condition, stamp, receipt, accessories, dimensions, colour code.",
      "",
      "INPUT JSON:",
      JSON.stringify({ product, structured, editor_note: editorNote || undefined }, null, 2),
      "",
      "Write the description now.",
    ].join("\n");

    const completion = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a commerce SEO catalogue writer for a luxury resale store. Be concise, factual, and avoid hype.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        presence_penalty: 0,
        frequency_penalty: 0,
      }),
      45000
    );

    const raw = completion.choices?.[0]?.message?.content || "";
    let descriptionText = stripCodeFences(raw);

    // 🔧 ONLY fix the first sentence
    descriptionText = fixFirstSentenceOnly(descriptionText);

    if (!descriptionText) {
      clearTimeout(timeout);
      return res.status(500).json({ error: "Empty AI output" });
    }

    clearTimeout(timeout);
    return res.status(200).json({ description_html: descriptionText });
  } catch (err) {
    clearTimeout(timeout);
    if (res.headersSent) return;

    if (err.message && err.message.includes("timeout")) {
      return res.status(504).json({ error: "Request timeout", details: err.message });
    }

    return res.status(500).json({
      error: "Generation failed",
      details: err.message,
    });
  }
}