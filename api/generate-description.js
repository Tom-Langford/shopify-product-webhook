import OpenAI from "openai";

/* ----------------------------------------
   OpenAI setup
---------------------------------------- */

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const withTimeout = (promise, timeoutMs) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);

const stripCodeFences = (s) =>
  (s || "").replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();

/* ----------------------------------------
   Opening sentence repair (KEY FIX)
---------------------------------------- */

function fixOpeningSentence(text, product, structured) {
  if (!text) return text;

  const sentences = text.split(/(?<=[.!?])\s+/);
  if (!sentences.length) return text;

  const first = sentences[0];

  // Patterns we do NOT allow
  const forbiddenStart =
    /^(this\s+(handbag|bag|item)\b|.+\s+is\s+(a|an)\b)/i;

  if (!forbiddenStart.test(first)) {
    return text; // Opening sentence is acceptable
  }

  const title = product?.title?.trim();
  if (!title) return text;

  const specs = structured?.specifications || {};
  const parts = [];

  if (specs.hermes_material) {
    parts.push(`crafted from ${specs.hermes_material}`);
  }

  if (specs.hermes_colour) {
    parts.push(`in ${specs.hermes_colour}`);
  }

  if (specs.hardware) {
    parts.push(`with ${specs.hardware} hardware`);
  }

  const suffix = parts.length ? ` ${parts.join(" ")}` : "";
  const rewrittenFirst = `${title}${suffix}.`;

  sentences[0] = rewrittenFirst;
  return sentences.join(" ");
}

/* ----------------------------------------
   Main handler
---------------------------------------- */

export default async function handler(req, res) {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
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
    }

    const authHeader = req.headers["authorization"] || "";
    const expectedToken = process.env.MECHANIC_BEARER_TOKEN;

    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      clearTimeout(timeout);
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!openai) {
      clearTimeout(timeout);
      return res.status(500).json({ error: "OpenAI not configured" });
    }

    const { product, structured } = body || {};
    if (!product?.id || !product?.title) {
      clearTimeout(timeout);
      return res.status(400).json({ error: "Missing product data" });
    }

    const editorNote =
      structured?.editor_note ||
      product?.editor_note ||
      "";

    /* ----------------------------------------
       Prompt (unchanged behaviourally)
    ---------------------------------------- */

    const prompt = [
      "You are generating the MAIN product description field for a luxury resale Shopify store for knowledgeable customers.",
      "",
      "IMPORTANT CONTEXT:",
      "- This description is primarily for SEO and external commerce feeds.",
      "- Specifications and modular descriptions exist elsewhere.",
      "",
      "Rules:",
      "- Output PLAIN TEXT only.",
      "- British English.",
      "- No hype or marketing language.",
      "- No subjective adjectives (luxury, iconic, elegant, stylish, timeless).",
      "- No lifestyle inference.",
      "- No bullet points.",
      "- Do not invent facts.",
      "- Length 100–180 words unless Editor’s Note is present.",
      "",
      "STRUCTURE:",
      "1) Opening sentence: one sentence, include product title verbatim.",
      "2) Size and construction.",
      "3) Material and colour.",
      "4) Condition, inclusions, dimensions, colour code.",
      "",
      "Editor’s Note:",
      "- If provided, use it verbatim as paragraph one.",
      "",
      "INPUT JSON:",
      JSON.stringify(
        { product, structured, editorNote: editorNote || undefined },
        null,
        2
      ),
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
              "You are a commerce SEO catalogue writer. Be factual, concise, and neutral.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
      45000
    );

    let output = stripCodeFences(
      completion.choices?.[0]?.message?.content || ""
    );

    if (!output) {
      clearTimeout(timeout);
      return res.status(500).json({ error: "Empty AI output" });
    }

    // 🔒 Apply opening sentence repair
    output = fixOpeningSentence(output, product, structured);

    clearTimeout(timeout);
    return res.status(200).json({ description_html: output });
  } catch (err) {
    clearTimeout(timeout);
    return res.status(500).json({
      error: "Generation failed",
      details: err.message,
    });
  }
}