import { afterAll, beforeAll, describe } from 'vitest';
import { registerCatalogAndRuntimeContracts } from './website/catalog-and-runtime.contracts.js';
import { registerContentContracts } from './website/content.contracts.js';
import { registerGeneratedOutputContracts } from './website/generated-output.contracts.js';
import { registerPublicationSafeguardsContracts } from './website/publication-safeguards.contracts.js';
import { cleanupWebsiteFixture, setupWebsiteFixture } from './website/support.js';

beforeAll(setupWebsiteFixture, 60_000);

afterAll(cleanupWebsiteFixture);

describe('Starlight website', () => {
  registerGeneratedOutputContracts();
  registerContentContracts();
  registerCatalogAndRuntimeContracts();
  registerPublicationSafeguardsContracts();
});
