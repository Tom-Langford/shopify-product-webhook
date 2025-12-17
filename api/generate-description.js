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

// Small helper: safe HTML escape for editor’s note if you decide to inject it yourself later.
// (We currently instruct the model to output HTML, so we don’t escape here.)
const stripCodeFences = (s) =>
  (s || "").replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();

export default async function handler(req, res) {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error("[ERROR] Request timeout - no response sent");
      res.status(504).json({ error: "Request timeout" });
    }
  }, 50000);

  try {
    console.log("[DEBUG] Request received:", {
      method: req.method,
      hasBody: !!req.body,
      bodyType: typeof req.body,
      headers: {
        authorization: req.headers["authorization"] ? "Bearer ***" : "missing",
        contentType: req.headers["content-type"],
      },
    });

    if (req.method !== "POST") {
      clearTimeout(timeout);
      return res.status(405).json({ error: "Method not allowed" });
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
        console.log("[DEBUG] Parsed body from string");
      } catch (parseErr) {
        clearTimeout(timeout);
        return res.status(400).json({
          error: "Invalid JSON in request body",
          details: parseErr.message,
        });
      }
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

    const expectedAuth = `Bearer ${expectedToken}`;
    if (authHeader !== expectedAuth) {
      clearTimeout(timeout);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const hasOpenAIKey = !!process.env.OPENAI_API_KEY && !!openai;
    if (!hasOpenAIKey) {
      clearTimeout(timeout);
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const { product, structured } = body || {};
    if (!product?.id || !product?.title) {
      clearTimeout(timeout);
      return res.status(400).json({ error: "Missing required product fields" });
    }

    // Optional editor note support (future-proof)
    // You can pass this later from Mechanic if description is short.
    const editorNote =
      structured?.editor_note ||
      product?.editor_note ||
      ""; // keep blank if not provided

    // Build a “contract” prompt that forces dry catalogue style
    const prompt = [
      "You are generating the MAIN product description field for a luxury resale Shopify store for knowledgable customers who know what they are looking for.",
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
      "FAILURE MODES TO AVOID (DO NOT DO THESE):",
      "- Generic marketing language or sales tone.",
      "- Subjective adjectives such as: luxury, iconic, elegant, stylish, casual, versatile, premium, timeless.",
      "- Sentence starters like 'This handbag', 'This bag', 'This item', or 'It is'.",
      "- Demonstrative or filler phrases such as 'features', 'adds', 'making it suitable for'.",
      "- Inferred lifestyle or usage (e.g. casual, everyday, evening).",
      "- Repeating the same facts in multiple ways.",
      "- Repeating dimensions outside the final paragraph.",
      "- Sentence fragments or two-part opening sentences.",
      "",
      "OUTPUT RULES (MUST FOLLOW EXACTLY):",
      "- Output VALID PLAIN TEXT only. No HTML, no markdown, no bullet points, no code blocks.",
      "- Use British English.",
      "- No exclamation marks. No em dashes.",
      "- Do not invent facts. If data is missing, omit it entirely.",
      "- Keep length between 100 and 180 words unless an Editor’s Note is present.",
      "- Dimensions may appear ONLY in the final paragraph and nowhere else.",
      "",
      "STRUCTURE (MUST FOLLOW EXACTLY):",
      "1) First paragraph:",
      "   - ONE complete sentence only.",
      "   - Must include the FULL product title VERBATIM once (exact characters).",
      "   - Use the product name as the grammatical subject.",
      "   - No filler, no adjectives beyond material, colour, size, hardware.",
      "   - The first paragraph must NOT contain construction, interior, condition, or material characteristics beyond basic identification.",
      "",
      "2) Second paragraph:",
      "   - Size and construction only.",
      "   - Describe structure and interior details factually if provided.",
      "",
      "3) Third paragraph:",
      "   - Material and colour characteristics only.",
      "   - Use supplied descriptions as the factual source.",
      "   - No inferred benefits or usage claims.",
      "",
      "4) Final paragraph:",
      "   - Condition, stamp, receipt, accessories.",
      "   - Dimensions (formatted exactly as: '25cm x 20cm x 13cm' if provided).",
      "   - Include colour code if available.",
      "",
      "EDITOR’S NOTE LOGIC:",
      "- If an Editor’s Note is provided, output it verbatim as the FIRST paragraph.",
      "- Do not rewrite or summarise it.",
      "- Then continue with paragraphs 2–4 only.",
      "",
      "DATA PROVIDED:",
      "- product.title contains the high-intent search phrase.",
      "- structured.specifications contains factual values (bag_style, bag_size_cm, hermes_colour, hermes_colour_code, hermes_material, hardware, dimensions, stamp, condition, receipt, accessories).",
      "- structured.puzzle_description contains curated factual descriptions for style/size, construction, material, colour, and hardware.",
      "",
      "INPUT JSON:",
      JSON.stringify({ product, structured }, null, 2),
      "",
      "Write the description now. Follow every rule exactly.",
  JSON.stringify({ product, structured }, null, 2),
  "",
  "Now write the description in plain text, following the rules exactly:",
      JSON.stringify(
        {
          product,
          structured,
          editor_note: editorNote || undefined,
        },
        null,
        2
      ),
      "",
      "Now produce the plain text description.",
    ].join("\n");

    console.log("[DEBUG] Calling OpenAI API...");

    const completion = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a commerce SEO catalogue writer for a luxury resale store. Output valid HTML only. Be concise, factual, and avoid hype/filler.",
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
    const descriptionHtml = stripCodeFences(raw);

    if (!descriptionHtml) {
      clearTimeout(timeout);
      return res.status(500).json({ error: "Empty AI output" });
    }

    // Very light sanity checks (keeps the model honest)
    // Must contain at least one <p> tag
    if (!descriptionHtml.includes("<p>")) {
      console.warn("[WARN] Output did not include <p> tags; returning anyway.");
    }

    clearTimeout(timeout);
    return res.status(200).json({ description_html: descriptionHtml });
  } catch (err) {
    console.error("[ERROR] Exception caught:", {
      message: err.message,
      name: err.name,
      status: err.status,
      statusCode: err.statusCode,
      code: err.code,
      type: err.type,
      stack: err.stack,
    });

    clearTimeout(timeout);

    if (res.headersSent) return;

    if (err.message && err.message.includes("timeout")) {
      return res.status(504).json({ error: "Request timeout", details: err.message });
    }

    return res.status(500).json({
      error: "Generation failed",
      details: err.message,
      code: err.code || err.name,
    });
  }
}