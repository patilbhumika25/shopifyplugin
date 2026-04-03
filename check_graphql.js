import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES ? process.env.SCOPES.split(',') : ['read_products'],
  hostName: 'shopifyplugin.onrender.com',
  hostScheme: 'https',
  apiVersion: ApiVersion.January25,
  isEmbeddedApp: true,
});

async function run() {
  const sessions = JSON.parse(fs.readFileSync('sessions.json', 'utf8'));
  const sessionData = Object.values(sessions).find(s => s.shop === process.env.SHOP || s.shop === 'bogo-offers.myshopify.com');
  
  if (!sessionData) {
    console.log('No session found. Please reinstall the app.');
    return;
  }
  
  const client = new shopify.clients.Graphql({ session: sessionData });
  
  try {
    const response = await client.request(`
      query {
        shopifyFunctions(first: 25) {
          nodes { id title apiType app { handle } }
        }
        discountNodes(first: 10) {
          nodes {
            id
            discount {
              ... on DiscountAutomaticApp { title status }
            }
          }
        }
      }
    `);
    console.log(JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.error('GraphQL Error:', err.message);
  }
}

run();
