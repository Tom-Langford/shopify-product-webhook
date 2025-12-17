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
      "You write product descriptions for luxury resale that are designed to maximise SEO and perform well in commerce feeds (Google Merchant, Meta, Shopify Collective).",
      "",
      "Your job is NOT to sound poetic or salesy. Your job is to be clear, factual, and commercially useful.",
      "",
      "Output rules (must follow):",
      "- Output VALID HTML only (no markdown, no code fences).",
      "- Use British English.",
      "- No hype and no filler. Avoid phrases like: 'discover', 'elegance', 'iconic', 'coveted', 'timeless', 'adds to the allure', 'remarkable', 'true representation of luxury'.",
      "- No exclamation marks. No em dashes.",
      "- Do not invent facts. If a field is missing/unknown, omit it.",
      "- Keep it concise: aim for 120–220 words unless the Editor’s Note is long.",
      "",
      "Structure (must follow):",
      "1) First paragraph: restate the FULL product identity naturally, including style + size + colour + material + hardware, using the product title if it contains these.",
      "2) Second paragraph: size/use + construction (if provided).",
      "3) Third paragraph: material + colour characteristics (only if provided; use the supplied descriptions as the factual source).",
      "4) Final paragraph: condition + stamp + what’s included (receipt/accessories) + dimensions (formatted as '25cm x 20cm x 13cm' if provided).",
      "",
      "Editor’s Note logic:",
      "- If an Editor’s Note is provided, use it verbatim as the FIRST paragraph (<p>...</p>) without rewriting it.",
      "- Then continue with the structure above (paragraphs 2–4).",
      "",
      "Data provided:",
      "- product.title contains the exact high-intent phrase we want reinforced in body copy.",
      "- structured.specifications contains factual values (bag_style, bag_size_cm, hermes_colour, hermes_colour_code, hermes_material, hardware, dimensions, stamp, condition, receipt, accessories).",
      "- structured.puzzle_description contains curated, human-written descriptions for style/size, construction, material, colour, hardware.",
      "",
      "Here is the input JSON:",
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
      "Now produce the HTML description.",
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