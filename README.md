# Shopify Product Description Webhook

A serverless webhook endpoint (Node.js, Vercel) that generates luxury, SEO-optimised product descriptions using OpenAI.

## Overview

This webhook is called by a Mechanic task when Shopify products are created or updated. It generates plain text product descriptions and returns them to Mechanic, which then updates Shopify.

**Important**: This webhook does NOT write to Shopify directly. All Shopify updates happen in Mechanic using GraphQL.

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
      "bag_style": "Birkin",
      "bag_size": "30",
      "hardware": "Palladium",
      "stamp": "...",
      "condition": "Excellent",
      "receipt": ["Receipt 1", "Receipt 2"],
      "accessories": "...",
      "dimensions": [
        { "value": "30", "unit": "cm" },
        { "value": "22", "unit": "cm" },
        { "value": "16", "unit": "cm" }
      ],
      "hermes_colour": "Blue | Navy",
      "hermes_colour_code": "Bleu | ...",
      "hermes_material": "Calfskin | Togo"
    },
    "puzzle": {
      "style_size_description": "Style & Size description text...",
      "construction_description": "Construction details...",
      "material_descriptions": ["Material description 1", "Material description 2"],
      "colour_descriptions": ["Colour description 1", "Colour description 2"],
      "hardware_description": "Hardware details..."
    }
  }
}
```

### Data Structure Notes

**Specifications** (for factual accuracy and SEO):
- Core fields: `bag_style`, `bag_size` (displayed as "Xcm"), `hardware`, `stamp`, `condition`, `receipt` (array), `accessories`
- `dimensions`: Array of objects with `value` and `unit`, formatted as "value unit x value unit x ..."
- `hermes_colour`: Derived from metaobject categories (may be pipe-separated)
- `hermes_colour_code`: Colour codes (may be pipe-separated)
- `hermes_material`: Derived from metaobject categories (may be pipe-separated)

**Puzzle Description** (for narrative content):
- `style_size_description`: From size_style_description metaobject
- `construction_description`: From hermes_construction metaobject
- `material_descriptions`: Array from hermes_material metaobject list
- `colour_descriptions`: Array from hermes_colour metaobject list
- `hardware_description`: From hermes_hardware metaobject

## Response Format

```json
{
  "description": "Plain text product description..."
}
```

## Error Responses

- `405 Method Not Allowed`: Request method is not POST
- `401 Unauthorized`: Missing or incorrect Bearer token
- `400 Bad Request`: Missing required product fields (id or title)
- `500 Internal Server Error`: Generation failed or empty AI output

## Description Generation

The webhook generates descriptions with:
- British English
- Plain text only (no HTML, no markdown, no formatting codes)
- Luxury resale tone (confident, minimal, no hype)
- Structure: intro paragraph → "At a glance" bullets → SEO paragraphs
- Natural incorporation of SEO keywords (Hermès, Birkin, Kelly, sizes, colours, materials, etc.)
- Never invents missing facts

