# Shopify Product Description Webhook

A serverless webhook endpoint (Node.js, Vercel) that generates luxury, SEO-optimised product descriptions using OpenAI.

## Overview

This webhook is called by a Mechanic task when Shopify products are created or updated. It generates HTML product descriptions and returns them to Mechanic, which then updates Shopify.

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
    "puzzle": {
      "style_size": "...",
      "construction": "...",
      "material": ["..."],
      "colour": ["..."],
      "hardware": "..."
    },
    "specifications": {
      "bag_style": "...",
      "bag_size": "...",
      "hermes_colour": "...",
      "hermes_material": "...",
      "hardware": "...",
      "dimensions": ["..."],
      "stamp": "...",
      "condition": "...",
      "receipt": ["..."],
      "accessories": "..."
    }
  }
}
```

## Response Format

```json
{
  "description_html": "<p>...</p>"
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
- Valid HTML only (no markdown)
- Luxury resale tone (confident, minimal, no hype)
- Structure: intro paragraph → "At a glance" bullets → SEO paragraphs
- Natural incorporation of SEO keywords (Hermès, Birkin, Kelly, sizes, colours, materials, etc.)
- Never invents missing facts

