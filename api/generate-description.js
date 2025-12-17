import OpenAI from "openai";

// Initialize OpenAI client only if API key exists
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Timeout wrapper for OpenAI calls
const withTimeout = (promise, timeoutMs) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
};

export default async function handler(req, res) {
  // Set a longer timeout for Vercel (max 60s for Pro, 10s for Hobby)
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error("[ERROR] Request timeout - no response sent");
      res.status(504).json({ error: "Request timeout" });
    }
  }, 50000); // 50 seconds to leave buffer

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

    // Validate request method
    if (req.method !== "POST") {
      console.log("[DEBUG] Method not allowed:", req.method);
      clearTimeout(timeout);
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Parse body if it's a string (Vercel sometimes doesn't auto-parse)
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
        console.log("[DEBUG] Parsed body from string");
      } catch (parseErr) {
        console.error("[ERROR] Failed to parse JSON body:", parseErr.message);
        clearTimeout(timeout);
        return res.status(400).json({ 
          error: "Invalid JSON in request body",
          details: parseErr.message 
        });
      }
    } else if (!body) {
      console.error("[ERROR] Request body is missing");
      clearTimeout(timeout);
      return res.status(400).json({ error: "Request body is required" });
    }

    // Validate Bearer token authentication
    const authHeader = req.headers["authorization"] || "";
    const expectedToken = process.env.MECHANIC_BEARER_TOKEN;
    
    console.log("[DEBUG] Auth check:", {
      hasAuthHeader: !!authHeader,
      hasExpectedToken: !!expectedToken,
    });
    
    if (!expectedToken) {
      console.error("[ERROR] MECHANIC_BEARER_TOKEN is not set");
      clearTimeout(timeout);
      return res.status(500).json({ error: "Server configuration error" });
    }
    
    const expectedAuth = `Bearer ${expectedToken}`;
    if (authHeader !== expectedAuth) {
      console.error("[ERROR] Authentication failed:", {
        received: authHeader ? "Bearer ***" : "missing",
        expected: "Bearer ***",
      });
      clearTimeout(timeout);
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log("[DEBUG] Authentication successful");

    // Check OpenAI API key is configured
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY && !!openai;
    console.log("[DEBUG] OpenAI API key check:", { configured: hasOpenAIKey });
    
    if (!hasOpenAIKey) {
      console.error("[ERROR] OPENAI_API_KEY is not set or OpenAI client not initialized");
      clearTimeout(timeout);
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    // Validate payload has minimum required fields
    const { product, structured } = body || {};
    console.log("[DEBUG] Payload validation:", {
      hasProduct: !!product,
      hasStructured: !!structured,
      productId: product?.id,
      productTitle: product?.title,
      bodyKeys: body ? Object.keys(body) : [],
    });
    
    if (!product?.id || !product?.title) {
      console.error("[ERROR] Missing required product fields:", {
        hasId: !!product?.id,
        hasTitle: !!product?.title,
      });
      clearTimeout(timeout);
      return res.status(400).json({ error: "Missing required product fields" });
    }

    // Build comprehensive prompt for OpenAI
    console.log("[DEBUG] Building prompt...");
    const prompt = [
      "You are an expert luxury resale copywriter and SEO specialist specialising in Hermès handbags.",
      "",
      "Write an SEO-optimised product description for a luxury Hermès bag product page.",
      "",
      "Requirements:",
      "- Use British English",
      "- Output in plain text",
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

    console.log("[DEBUG] Prompt built, length:", prompt.length);
    console.log("[DEBUG] Calling OpenAI API...");

    // Call OpenAI API with timeout
    const completion = await withTimeout(
      openai.chat.completions.create({
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
      }),
      45000 // 45 second timeout
    );

    console.log("[DEBUG] OpenAI API call successful:", {
      hasChoices: !!completion.choices,
      choicesLength: completion.choices?.length || 0,
      hasContent: !!completion.choices?.[0]?.message?.content,
    });

    const descriptionHtml = completion.choices[0]?.message?.content?.trim() || "";

    console.log("[DEBUG] Description HTML extracted:", {
      length: descriptionHtml.length,
      isEmpty: !descriptionHtml,
    });

    if (!descriptionHtml) {
      console.error("[ERROR] Empty AI output");
      clearTimeout(timeout);
      return res.status(500).json({ error: "Empty AI output" });
    }

    console.log("[DEBUG] Returning success response");
    clearTimeout(timeout);
    // Return the description HTML
    return res.status(200).json({ description_html: descriptionHtml });
  } catch (err) {
    // Log full error details for debugging
    console.error("[ERROR] Exception caught:", {
      message: err.message,
      name: err.name,
      status: err.status,
      statusCode: err.statusCode,
      code: err.code,
      type: err.type,
      cause: err.cause,
      stack: err.stack,
    });
    
    clearTimeout(timeout);
    
    // Only send response if headers haven't been sent
    if (res.headersSent) {
      console.error("[ERROR] Headers already sent, cannot send error response");
      return;
    }
    
    // Return appropriate error status with more detail
    if (err.status === 401 || err.statusCode === 401) {
      console.error("[ERROR] OpenAI authentication failed");
      return res.status(500).json({ 
        error: "OpenAI authentication failed - check API key",
        details: err.message,
      });
    }
    
    if (err.status === 429 || err.statusCode === 429) {
      console.error("[ERROR] OpenAI rate limit exceeded");
      return res.status(500).json({ 
        error: "OpenAI rate limit exceeded",
        details: err.message,
      });
    }
    
    if (err.message && err.message.includes("timeout")) {
      console.error("[ERROR] Request timeout");
      return res.status(504).json({ 
        error: "Request timeout",
        details: err.message,
      });
    }
    
    // Include error message in response for debugging
    return res.status(500).json({ 
      error: "Generation failed",
      details: err.message,
      code: err.code || err.name,
    });
  }
}
