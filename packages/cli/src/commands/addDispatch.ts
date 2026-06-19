//? Single source of truth for "run the add handler for a registry kind". Shared by
//? the single-feature `add <feature>` path (index.ts), the manage diff apply, and
//? the reconfigure toggles (transitions.ts) — so a new FeatureKind is wired in ONE
//? place and the exhaustiveness check guarantees every kind is handled everywhere.

import { type ConsumerProject, type Result } from '../lib/project';
import type { RegistryEntry } from '../registry';
import { addLogin } from './addLogin';
import { addPresence, type AddOptions } from './addPresence';
import { addDocsUi } from './addDocsUi';
import { addErrorTracking } from './addErrorTracking';
import { addSecretManager } from './addSecretManager';
import { addRouter } from './addRouter';
import { addAiDocs } from './addAiDocs';
import { addBackendOnly } from './addBackendOnly';

export const runAddByKind = (project: ConsumerProject, entry: RegistryEntry, options: AddOptions): Result<void> => {
  switch (entry.kind) {
    case 'login': {
      return addLogin(project, options);
    }
    case 'presence': {
      return addPresence(project, options);
    }
    case 'docs-ui': {
      return addDocsUi(project, options, entry.note ?? '');
    }
    case 'error-tracking': {
      return addErrorTracking(project, options);
    }
    case 'secret-manager': {
      return addSecretManager(project, options);
    }
    case 'router': {
      return addRouter(project, options);
    }
    case 'ai-docs': {
      return addAiDocs(project, options);
    }
    case 'backend': {
      return addBackendOnly(project, entry.pkg, options, entry.note ?? '');
    }
    default: {
      const _exhaustive: never = entry.kind;
      throw new Error(`Unhandled feature kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
