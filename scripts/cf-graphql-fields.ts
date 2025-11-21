#!/usr/bin/env tsx

const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

type SettingsResponse = {
  viewer?: {
    accounts?: Array<{
      settings?: {
        rumWebVitalsEventsAdaptiveGroups?: { availableFields?: string[] };
        rumPerformanceEventsAdaptiveGroups?: { availableFields?: string[] };
      };
    }>;
  };
};

const args = process.argv.slice(2);
const argMap = new Map<string, string>();
for (const arg of args) {
  const [key, value] = arg.split('=');
  if (key && value) {
    argMap.set(key.replace(/^--?/, ''), value);
  }
}

const accountId = process.env.CF_ACCOUNT_ID ?? argMap.get('account') ?? argMap.get('accountId');
const token = process.env.CF_API_TOKEN ?? argMap.get('token');

if (!accountId || !token) {
  console.error('Usage: CF_ACCOUNT_ID=xxx CF_API_TOKEN=xxx tsx scripts/cf-graphql-fields.ts');
  console.error('You can also pass --account=<id> --token=<api_token>');
  process.exit(1);
}

async function fetchAvailableFields() {
  const query = `
    query GetAvailableFields($accountId: String!) {
      viewer {
        accounts(filter: { accountTag: $accountId }) {
          settings {
            rumWebVitalsEventsAdaptiveGroups {
              availableFields
            }
            rumPerformanceEventsAdaptiveGroups {
              availableFields
            }
          }
        }
      }
    }
  `;

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables: { accountId } }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphQL request failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as { data?: SettingsResponse; errors?: unknown };
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }

  const settings =
    json.data?.viewer?.accounts?.[0]?.settings ??
    ({ rumWebVitalsEventsAdaptiveGroups: null, rumPerformanceEventsAdaptiveGroups: null } as const);

  console.log('rumWebVitalsEventsAdaptiveGroups.availableFields:');
  console.log(
    settings.rumWebVitalsEventsAdaptiveGroups?.availableFields?.join('\n') ??
      '  <not available>'
  );
  console.log('\nrumPerformanceEventsAdaptiveGroups.availableFields:');
  console.log(
    settings.rumPerformanceEventsAdaptiveGroups?.availableFields?.join('\n') ??
      '  <not available>'
  );
}

fetchAvailableFields().catch((error) => {
  console.error('[cf-graphql-fields] Failed to fetch available fields:', error);
  process.exit(1);
});
