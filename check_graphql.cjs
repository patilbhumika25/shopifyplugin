const fs = require('fs');

async function checkStore() {
  const sessions = JSON.parse(fs.readFileSync('sessions.json', 'utf8'));
  const session = sessions['offline_bogo-offers.myshopify.com'];
  if (!session || !session.accessToken) {
    console.error('No session found');
    return;
  }

  const token = session.accessToken;
  const shop = session.shop;

  const query = `
    query {
      shopifyFunctions(first: 10) {
        nodes {
          id
          title
          app { handle }
        }
      }
      discountNodes(first: 10) {
        nodes {
          id
          discount {
            ... on DiscountAutomaticApp {
              title
              status
            }
          }
        }
      }
    }
  `;

  try {
    console.log(`Fetching from ${shop}...`);
    const resp = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token
      },
      body: JSON.stringify({ query })
    });
    
    if (!resp.ok) {
      console.error('Fetch error:', resp.status, await resp.text());
      return;
    }
    const data = await resp.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
  }
}

checkStore();
