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
      "Data structure:",
      "",
      "SPECIFICATIONS (for factual accuracy and SEO):",
      "- bag_style: The bag style name",
      "- bag_size: Size in cm (display as 'Xcm')",
      "- hardware: Hardware type",
      "- stamp: Stamp information",
      "- condition: Condition of the bag",
      "- receipt: List of receipt items (may be joined with ' | ')",
      "- accessories: Accessories included",
      "- dimensions: List of dimension objects with value and unit (format: 'value unit x value unit x ...')",
      "- hermes_colour: Derived from metaobject categories (blue, pink_purple, red, orange_yellow, green, black_grey, brown, natural_white) and colour_code",
      "- hermes_material: Derived from metaobject categories (calfskin, goatskin, buffalo, exotic_skins, canvas, other)",
      "",
      "PUZZLE DESCRIPTION (for narrative content):",
      "- style_size_description: Style & Size description (from size_style_description metaobject)",
      "- construction_description: Construction details (from hermes_construction metaobject)",
      "- material_descriptions: List of material descriptions (from hermes_material metaobject list)",
      "- colour_descriptions: List of colour descriptions (from hermes_colour metaobject list)",
      "- hardware_description: Hardware description (from hermes_hardware metaobject)",
      "",
      "SEO keywords to incorporate naturally (where relevant):",
      "- Hermès, Birkin, Kelly, and other bag style names",
      "- Size with 'cm' suffix (e.g., '25cm', '30cm', '35cm')",
      "- Hermès colour names and colour codes",
      "- Material types (calfskin, goatskin, buffalo, exotic skins, canvas, etc.)",
      "- Condition (pre-owned, excellent, very good, etc.)",
      "- Hardware details (palladium, gold, etc.)",
      "- Construction details",
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
