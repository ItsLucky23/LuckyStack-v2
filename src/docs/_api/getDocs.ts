import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import fs from 'fs';
import path from 'path';

export const rateLimit: number | false = 10; // Rate limit for this docs endpoint itself

export const auth: AuthProps = {
  login: false, // Publicly accessible documentation
  additional: []
};

export interface ApiParams {
  data: {};
  user: SessionLayout;
  functions: Functions;
}

// Interfaces for our documentation structure
interface ApiDoc {
  page: string;
  name: string;
  method: string;
  description?: string;
  input: string;
  output: string;
  auth: any;
  // rateLimit: number | false | undefined;
  rateLimit: number | boolean | undefined; //? should never contain the value true but just in case we have a mismatch in te code we support the type
  path: string;
}

interface SyncDoc {
  page: string;
  name: string;
  clientInput: string;
  serverOutput: string;
  clientOutput: string;
  path: string;
}

interface DocsResult {
  apis: Record<string, ApiDoc[]>;
  syncs: Record<string, SyncDoc[]>;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const rootDir = process.cwd();
  const apiTypesPath = path.join(rootDir, 'src', '_sockets', 'apiTypes.generated.ts');

  if (!fs.existsSync(apiTypesPath)) {
    return { status: 'error', message: 'apiTypes.generated.ts not found' };
  }

  const apiTypesContent = fs.readFileSync(apiTypesPath, 'utf-8');
  
  const docs: DocsResult = {
    apis: {},
    syncs: {}
  };

  // 1. Extract API definitions
  // Look for sections in ApiTypeMap
  const apiMapMatch = apiTypesContent.match(/export interface ApiTypeMap \{([\s\S]*?)\n\}/);
  if (apiMapMatch) {
    const apiMapBody = apiMapMatch[1];
    
    // Split by page (e.g. 'examples': { ... })
    const pageRegex = /'([^']+)':\s*\{([\s\S]*?)\n\s\s\};/g;
    let pageMatch;

    while ((pageMatch = pageRegex.exec(apiMapBody)) !== null) {
      const pageName = pageMatch[1];
      const pageBody = pageMatch[2];
      
      docs.apis[pageName] = [];

      // Extract APIs within the page
      const apiRegex = /'([^']+)':\s*\{([\s\S]*?)\n\s\s\s\s\};/g;
      let apiMatch;

      while ((apiMatch = apiRegex.exec(pageBody)) !== null) {
        const apiName = apiMatch[1];
        const apiBody = apiMatch[2];

        // Extract types
        const inputMatch = apiBody.match(/input:\s*(\{[\s\S]*?\});/);
        const outputMatch = apiBody.match(/output:\s*(\{[\s\S]*?\});/);
        const methodMatch = apiBody.match(/method:\s*'([^']+)';/);

        // Read the actual API file for auth and rateLimit
        const apiFilePath = path.join(rootDir, 'src', pageName, '_api', `${apiName}.ts`);
        let authConfig = null;
        let rateLimitConfig = undefined;

        if (fs.existsSync(apiFilePath)) {
          const apiFileContent = fs.readFileSync(apiFilePath, 'utf-8');
          
          // Simple regex to extract auth and rateLimit - in a real compiler we'd use AST
          // This is a "best effort" runtime extraction
          const authMatch = apiFileContent.match(/export const auth: AuthProps = (\{[\s\S]*?\});/);
          if (authMatch) {
            try {
              // Dangerous eval-like parsing, but strictly for JSON-like structures in this controlled env
              // Replacing strictly JSON incompatible syntax if necessary, but assuming simple objects
               // For safety, we just pass the string string for the frontend to display or try to parse loosely
               // Let's just pass the string representation for now, or try to parse keys
               authConfig = authMatch[1]; 
            } catch (e) {}
          }

          const rateLimitMatch = apiFileContent.match(/export const rateLimit: number \| false = ([\d\w]+|false);/);
          if (rateLimitMatch) {
             const val = rateLimitMatch[1];
             rateLimitConfig = val === 'false' ? false : parseInt(val);
          }
        }

        docs.apis[pageName].push({
          page: pageName,
          name: apiName,
          method: methodMatch ? methodMatch[1] : 'POST',
          input: inputMatch ? inputMatch[1] : '{}',
          output: outputMatch ? outputMatch[1] : '{}',
          auth: authConfig,
          rateLimit: rateLimitConfig,
          path: `api/${pageName}/${apiName}`
        });
      }
    }
  }

  // 2. Extract Sync definitions
  const syncMapMatch = apiTypesContent.match(/export interface SyncTypeMap \{([\s\S]*?)\n\}/);
  if (syncMapMatch) {
    const syncMapBody = syncMapMatch[1];
    
    const pageRegex = /'([^']+)':\s*\{([\s\S]*?)\n\s\s\};/g;
    let pageMatch;

    while ((pageMatch = pageRegex.exec(syncMapBody)) !== null) {
      const pageName = pageMatch[1];
      const pageBody = pageMatch[2];
      
      docs.syncs[pageName] = [];

      const syncRegex = /'([^']+)':\s*\{([\s\S]*?)\n\s\s\s\s\};/g;
      let syncMatch;

      while ((syncMatch = syncRegex.exec(pageBody)) !== null) {
        const syncName = syncMatch[1];
        const syncBody = syncMatch[2];

        const clientInputMatch = syncBody.match(/clientInput:\s*(\{[\s\S]*?\});/);
        const serverOutputMatch = syncBody.match(/serverOutput:\s*(\{[\s\S]*?\});/);
        const clientOutputMatch = syncBody.match(/clientOutput:\s*(\{[\s\S]*?\});/);

        docs.syncs[pageName].push({
          page: pageName,
          name: syncName,
          clientInput: clientInputMatch ? clientInputMatch[1] : '{}',
          serverOutput: serverOutputMatch ? serverOutputMatch[1] : '{}',
          clientOutput: clientOutputMatch ? clientOutputMatch[1] : '{}',
          path: `sync/${pageName}/${syncName}`
        });
      }
    }
  }

  return {
    status: 'success',
    result: docs
  };
};
