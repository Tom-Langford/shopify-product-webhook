# Shopify Product Description Webhook

A serverless webhook endpoint (Node.js, Vercel) that generates SEO-optimised, catalogue-style product descriptions using OpenAI.

## Overview

This webhook is called by a Mechanic task when Shopify products are created or updated. It generates HTML product descriptions optimised for SEO, Google Merchant feeds, Meta/Facebook listings, and Shopify Collective. The descriptions are returned to Mechanic, which then updates Shopify.

**Important**: This webhook does NOT write to Shopify directly. All Shopify updates happen in Mechanic using GraphQL.

**Description Purpose**: The generated description is NOT the primary on-page UX content. Detailed specifications are shown elsewhere in a structured table, and curated narrative content is shown using modular puzzle descriptions. This description exists primarily for external platforms and search engines, so it must stand alone when read outside the website.

## Setup

1. **Connect Vercel to your Git repository** (if not already connected):
   - Go to your Vercel dashboard
   - Import your Git repository
   - Vercel will automatically detect the `api/` folder structure

2. **Set environment variables in Vercel**:
   - In your Vercel project settings → Environment Variables
   - Add `OPENAI_API_KEY`: Your OpenAI API key
   - Add `MECHANIC_BEARER_TOKEN`: The bearer token for authenticating Mechanic requests

3. **Deploy**:
   - **Option A (Recommended)**: Just push to Git - Vercel will auto-deploy:
     ```bash
     git push
     ```
   - **Option B**: Manual deploy:
     ```bash
     npm install
     vercel deploy
     ```

## Endpoint

- **Path**: `/api/generate-description`
- **Method**: `POST`
- **Authentication**: `Authorization: Bearer <MECHANIC_BEARER_TOKEN>`

## Request Format

```json
{
  "product": {
    "id": "gid://shopify/Product/123",
    "title": "Hermès Birkin 30",
    "vendor": "Hermès",
    "handle": "hermes-birkin-30"
  },
  "structured": {
    "specifications": {
      "bag_style": "Hermès Birkin",
      "bag_size_cm": 25,
      "hermes_colour": "Bleu Navy",
      "hermes_colour_code": "7U",
      "hermes_material": "Togo",
      "hardware": "Palladium",
      "dimensions": [
        { "value": 25.0, "unit": "cm" },
        { "value": 20.0, "unit": "cm" },
        { "value": 13.0, "unit": "cm" }
      ],
      "stamp": "W",
      "condition": "Brand new",
      "receipt": ["Yes"],
      "accessories": "All accessories included"
    },
    "puzzle_description": {
      "style_size_description": "Style & Size description text...",
      "construction_description": "Construction details...",
      "material_descriptions": ["Material description 1", "Material description 2"],
      "colour_descriptions": ["Colour description 1", "Colour description 2"],
      "hardware_description": "Hardware details..."
    },
    "editor_note": "Optional editor's note (if provided, will be output verbatim as first paragraph)"
  }
}
```

### Data Structure Notes

**Specifications** (for factual accuracy and SEO):
- Core fields: `bag_style`, `bag_size_cm` (numeric), `hardware`, `stamp`, `condition`, `receipt` (array), `accessories`
- `dimensions`: Array of objects with `value` (numeric) and `unit`, formatted as "value unit x value unit x ..." in output
- `hermes_colour`: Derived from metaobject categories (may be pipe-separated)
- `hermes_colour_code`: Colour codes (may be pipe-separated)
- `hermes_material`: Derived from metaobject categories (may be pipe-separated)

**Puzzle Description** (for narrative content):
- `style_size_description`: From size_style_description metaobject
- `construction_description`: From hermes_construction metaobject
- `material_descriptions`: Array from hermes_material metaobject list
- `colour_descriptions`: Array from hermes_colour metaobject list
- `hardware_description`: From hermes_hardware metaobject

**Editor's Note** (optional):
- `editor_note`: If provided in `structured.editor_note` or `product.editor_note`, it will be output verbatim as the first paragraph
- The description will then continue with the standard structure (paragraphs 2-4)

## Response Format

```json
{
  "description_html": "<p>Product description in valid HTML format...</p>"
}
```

The response contains valid HTML with paragraph tags (`<p>`). The description is structured as follows:
1. **First paragraph**: One complete sentence including the full product title verbatim
2. **Second paragraph**: Size and construction details
3. **Third paragraph**: Material and colour characteristics
4. **Final paragraph**: Condition, stamp, receipt, accessories, dimensions (formatted as "25cm x 20cm x 13cm"), and colour code

If an editor's note is provided, it appears as the first paragraph verbatim, followed by paragraphs 2-4.

## Error Responses

- `405 Method Not Allowed`: Request method is not POST
- `401 Unauthorized`: Missing or incorrect Bearer token
- `400 Bad Request`: Missing required product fields (id or title)
- `500 Internal Server Error`: Generation failed or empty AI output

## Description Generation

The webhook generates catalogue-style descriptions optimised for SEO and external platforms. Key characteristics:

**Output Format:**
- Valid HTML with paragraph tags (`<p>`)
- British English
- Length: 100-180 words (unless editor's note is present)
- No markdown, no code blocks, no bullet points

**Writing Style:**
- Factual, catalogue-style copy (not marketing copy)
- Avoids generic marketing language and subjective adjectives (luxury, iconic, elegant, stylish, etc.)
- Avoids sentence starters like "This handbag", "This bag", "This item", or "It is"
- Avoids demonstrative phrases like "features", "adds", "making it suitable for"
- No inferred lifestyle or usage claims
- No exclamation marks or em dashes
- Never invents missing facts

**Structure (4 paragraphs):**
1. **First paragraph**: One complete sentence with full product title verbatim, using product name as grammatical subject
2. **Second paragraph**: Size and construction only (structure and interior details if provided)
3. **Third paragraph**: Material and colour characteristics only (uses supplied puzzle descriptions as factual source)
4. **Final paragraph**: Condition, stamp, receipt, accessories, dimensions (formatted as "25cm x 20cm x 13cm"), and colour code

**Editor's Note Support:**
- If `editor_note` is provided in the request, it's output verbatim as the first paragraph
- Standard paragraphs 2-4 follow after the editor's note

**SEO Optimisation:**
- Naturally incorporates high-intent search phrases from product title
- Includes relevant keywords: Hermès, Birkin, Kelly, sizes (with "cm" suffix), colour names/codes, materials, condition, hardware
- Optimised for Google Merchant feeds, Meta/Facebook listings, and Shopify Collective

