export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { product_id } = req.body;
  if (!product_id) {
    return res.status(400).json({ error: 'Missing product_id' });
  }

  const SHOPIFY_API_TOKEN = process.env.SHOPIFY_API_TOKEN;
  const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

  const headers = {
    'X-Shopify-Access-Token': SHOPIFY_API_TOKEN,
    'Content-Type': 'application/json',
  };

  const log = (msg, data) => console.log(`[product ${product_id}] ${msg}`, data || '');

  // Utility to fetch from Shopify
  const shopifyFetch = async (url, method = 'GET', body = null) => {
    const result = await fetch(`https://${SHOPIFY_STORE_DOMAIN}${url}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });
    if (!result.ok) {
      const errText = await result.text();
      throw new Error(`${method} ${url} failed: ${errText}`);
    }
    return result.json();
  };

  try {
    // 1. Fetch Product
    const product = await shopifyFetch(`/admin/api/2023-07/products/${product_id}.json`);
    const prod = product.product;
    log('Fetched product:', prod.title);

    // 2. Fetch Product Metafields
    const { metafields } = await shopifyFetch(`/admin/api/2023-07/products/${product_id}/metafields.json`);
    const getMetafield = (namespace, key) => {
      const mf = metafields.find(m => m.namespace === namespace && m.key === key);
      return mf ? mf.value : null;
    };

    const getMetaobjectHandleList = (field) => {
      if (!field) return [];
      return Array.isArray(field) ? field : String(field).split(',').map(s => s.trim()).filter(Boolean);
    };

    // 3. Fetch Hermès Colour metaobjects
    const hermesColours = getMetaobjectHandleList(getMetafield('custom', 'hermes_colour'));
    const hermesMaterials = getMetaobjectHandleList(getMetafield('custom', 'hermes_material'));
    const fetchMetaobject = async (handle, type) => {
      const { metaobjects } = await shopifyFetch(`/admin/api/2023-07/metaobjects.json?type=${type}&handle=${handle}`);
      return metaobjects[0];
    };

    const categoryOrder = ['blue', 'pink_purple', 'red', 'orange_yellow', 'green', 'black_grey', 'brown', 'natural_white'];

    // Extract values from first Hermès Colour
    let firstColour = null;
    let colourCategory = null;
    let colourCode = null;

    if (hermesColours.length > 0) {
      const colourMeta = await fetchMetaobject(hermesColours[0], 'hermes_colour');
      for (const key of categoryOrder) {
        if (colourMeta?.fields?.[key]?.value) {
          firstColour = colourMeta.fields[key].value;
          colourCategory = key.replace('_', ' & ').replace(/\b\w/g, l => l.toUpperCase());
          break;
        }
      }
      colourCode = colourMeta?.fields?.colour_code?.value || null;
    }

    // Extract values from first Hermès Material
    let material = null;
    let materialCategory = null;
    if (hermesMaterials.length > 0) {
      const matMeta = await fetchMetaobject(hermesMaterials[0], 'hermes_material');
      for (const key of ['calfskin', 'goatskin', 'buffalo', 'exotic_skins', 'canvas', 'other']) {
        if (matMeta?.fields?.[key]?.value) {
          material = matMeta.fields[key].value;
          materialCategory = key.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
          break;
        }
      }
    }

    // Google: Condition
    const condition = getMetafield('custom', 'condition') === 'Brand New' ? 'new' : 'used';

    // Google: Vintage Tag
    const isVintage = prod.tags.includes('#Vintage');

    // Google: Hardware
    const hardware = getMetafield('custom', 'hardware');
    const hardwareLabel = hardware ? `${hardware} Hardware` : '';

    // Sort Rank calculation (simplified fallback)
    const bagSize = parseInt(getMetafield('custom', 'bag_size')) || 0;
    const inStock = prod.variants?.some(v => v.inventory_quantity > 0);
    const sortRank =
      (inStock ? 0 : 1) * 1e9 +
      (100 - bagSize) * 1e6 +
      (colourCategory ? colourCategory.charCodeAt(0) : 90) * 1e4 +
      (colourCode ? colourCode.charCodeAt(0) : 90) * 100 +
      prod.title.charCodeAt(0);

    // Build metafield updates
    const metafieldUpdates = [
      {
        namespace: 'custom',
        key: 'sort_rank',
        type: 'number_integer',
        value: sortRank.toString(),
      },
      {
        namespace: 'custom',
        key: 'colour_category',
        type: 'single_line_text_field',
        value: colourCategory || '',
      },
      {
        namespace: 'custom',
        key: 'material_category',
        type: 'single_line_text_field',
        value: materialCategory || '',
      },
      {
        namespace: 'mm-google-shopping',
        key: 'condition',
        type: 'single_line_text_field',
        value: condition,
      },
      {
        namespace: 'mm-google-shopping',
        key: 'age_group',
        type: 'single_line_text_field',
        value: 'adult',
      },
      {
        namespace: 'mm-google-shopping',
        key: 'gender',
        type: 'single_line_text_field',
        value: 'unisex',
      },
      {
        namespace: 'mm-google-shopping',
        key: 'custom_label_0',
        type: 'single_line_text_field',
        value: colourCode || '',
      },
      {
        namespace: 'mm-google-shopping',
        key: 'custom_label_1',
        type: 'single_line_text_field',
        value: colourCategory || '',
      },
      {
        namespace: 'mm-google-shopping',
        key: 'custom_label_2',
        type: 'single_line_text_field',
        value: hardwareLabel,
      },
      {
        namespace: 'mm-google-shopping',
        key: 'custom_label_3',
        type: 'single_line_text_field',
        value: materialCategory || '',
      },
      {
        namespace: 'mm-google-shopping',
        key: 'custom_label_4',
        type: 'single_line_text_field',
        value: isVintage ? 'Vintage' : '',
      },
      {
        namespace: 'mm-google-shopping',
        key: 'color',
        type: 'single_line_text_field',
        value: firstColour || '',
      },
      {
        namespace: 'mm-google-shopping',
        key: 'material',
        type: 'single_line_text_field',
        value: material || '',
      },
    ];

    // Update metafields in Shopify
    for (const field of metafieldUpdates) {
      if (!field.value) continue;
      await shopifyFetch(`/admin/api/2023-07/products/${product_id}/metafields.json`, 'POST', { metafield: field });
      log(`Updated metafield ${field.namespace}.${field.key}:`, field.value);
    }

    return res.status(200).json({ message: 'Product updated', product_id });
  } catch (err) {
    console.error('Error updating product:', err);
    return res.status(500).json({ error: err.message });
  }
}
