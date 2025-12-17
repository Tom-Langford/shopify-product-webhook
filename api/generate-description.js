import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Simple auth: Mechanic sends Authorization: Bearer <token>
  const auth = req.headers["authorization"] || "";
  const expected = `Bearer ${process.env.MECHANIC_BEARER_TOKEN || ""}`;
  if (!process.env.MECHANIC_BEARER_TOKEN || auth !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { product, structured } = req.body || {};
    if (!product?.id || !product?.title) {
      return res.status(400).json({ error: "Missing required product fields" });
    }

    // You can tune this prompt later; this is a safe, SEO-friendly v1.
    const prompt = [
      "You are an expert luxury resale copywriter and SEO specialist.",
      "Write an SEO-optimised product description for a luxury bag PDP.",
      "",
      "Rules:",
      "- British English",
      "- Do not invent facts; if unknown, omit",
      "- Confident luxury tone (no hype, , no em dashes no exclamation marks)",
      "- Output valid HTML only (no markdown, no code fences)",

      "",
      "Product input (JSON):",
      JSON.stringify({ product, structured }, null, 2),
    ].join("\n");

    const ai = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const descriptionHtml =
      ai.output
        ?.flatMap((o) => o.content || [])
        ?.filter((c) => c.type === "output_text")
        ?.map((c) => c.text)
        ?.join("\n")
        ?.trim() || "";

    if (!descriptionHtml) return res.status(500).json({ error: "Empty AI output" });

    return res.status(200).json({ description_html: descriptionHtml });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Generation failed" });
  }
}
