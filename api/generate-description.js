import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  // Validate request method
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Validate Bearer token authentication
  const authHeader = req.headers["authorization"] || "";
  const expectedToken = process.env.MECHANIC_BEARER_TOKEN;
  
  if (!expectedToken) {
    return res.status(500).json({ error: "Server configuration error" });
  }
  
  const expectedAuth = `Bearer ${expectedToken}`;
  if (authHeader !== expectedAuth) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Validate payload has minimum required fields
    const { product, structured } = req.body || {};
    if (!product?.id || !product?.title) {
      return res.status(400).json({ error: "Missing required product fields" });
    }

    // Build comprehensive prompt for OpenAI
    const prompt = [
      "You are an expert luxury resale copywriter and SEO specialist specialising in Hermès handbags.",
      "",
      "Write an SEO-optimised product description for a luxury Hermès bag product page.",
      "",
      "Requirements:",
      "- Use British English",
      "- Output valid HTML only (no markdown, no code fences, no ```)",
      "- Luxury resale tone: confident, minimal, no hype, no exclamation marks, no em dashes",
      "- Never invent missing facts - if a field is unknown or missing, omit it entirely",
      "- Structure the description as follows:",
      "  1. A short introductory paragraph (2-3 sentences)",
      "  2. An 'At a glance' section with a bulleted list (<ul><li>) of key features",
      "  3. A few short paragraphs incorporating relevant SEO phrases naturally",
      "",
      "SEO keywords to incorporate naturally (where relevant):",
      "- Hermès, Birkin, Kelly, bag style names",
      "- Size (e.g., '25cm', '30cm', '35cm')",
      "- Colour names and codes",
      "- Material (calfskin, goatskin, etc.)",
      "- Condition",
      "- Hardware details",
      "- Construction details",
      "",
      "The product data includes:",
      "- Core product fields (id, title, vendor, handle)",
      "- Puzzle Description fields: Style & Size, Construction, Material, Colour, Hardware",
      "- Specifications: bag_style, bag_size, Hermès Colour, Hermès Material, hardware, dimensions, stamp, condition, receipt, accessories",
      "",
      "Product data (JSON):",
      JSON.stringify({ product, structured }, null, 2),
      "",
      "Generate the description HTML now:",
    ].join("\n");

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert luxury resale copywriter. Always output valid HTML only, never markdown.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const descriptionHtml = completion.choices[0]?.message?.content?.trim() || "";

    if (!descriptionHtml) {
      return res.status(500).json({ error: "Empty AI output" });
    }

    // Return the description HTML
    return res.status(200).json({ description_html: descriptionHtml });
  } catch (err) {
    console.error("Error generating description:", err);
    
    // Return appropriate error status
    if (err.status === 401 || err.status === 403) {
      return res.status(500).json({ error: "OpenAI authentication failed" });
    }
    
    return res.status(500).json({ error: "Generation failed" });
  }
}
