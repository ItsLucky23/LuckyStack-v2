import fs from 'fs';
import { inferHttpMethod } from '../../utils/httpApiUtils';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export const extractHttpMethod = (filePath: string, apiName: string): HttpMethod => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const methodMatch = content.match(/export\s+const\s+httpMethod\s*(?::[^=]+)?=\s*['"]([^'"]+)['"]/);
    if (methodMatch) {
      const method = methodMatch[1].toUpperCase() as HttpMethod;
      if (['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
        return method;
      }
    }

    return inferHttpMethod(apiName);
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting httpMethod from ${filePath}:`, error);
    return inferHttpMethod(apiName);
  }
};

export const extractRateLimit = (filePath: string): number | false | undefined => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    const rateLimitMatch = content.match(/export\s+const\s+rateLimit\s*(?::[^=]+)?=\s*([^;]+);/);
    if (rateLimitMatch) {
      const value = rateLimitMatch[1].trim();
      if (value === 'false') return false;
      const num = parseInt(value, 10);
      if (!isNaN(num)) return num;
    }

    return undefined;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting rateLimit from ${filePath}:`, error);
    return undefined;
  }
};

export const extractAuth = (filePath: string): { login: boolean; additional?: Record<string, unknown>[] } => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Match the full auth export block — greedy enough to capture multiline additional arrays
    const authMatch = content.match(/export\s+const\s+auth\s*:\s*AuthProps\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!authMatch) return { login: true };

    const authBlock = authMatch[1];
    const loginMatch = authBlock.match(/login\s*:\s*(true|false)/);
    const login = loginMatch ? loginMatch[1] === 'true' : true;

    // Extract the additional array if present
    const additionalMatch = authBlock.match(/additional\s*:\s*\[([\s\S]*?)\]/);
    if (!additionalMatch) return { login };

    const itemsRaw = additionalMatch[1];
    const additional: Record<string, unknown>[] = [];

    // Split individual objects naively by looking for { ... } blocks
    const itemMatches = itemsRaw.matchAll(/\{([^}]*)\}/g);
    for (const itemMatch of itemMatches) {
      const item: Record<string, unknown> = {};
      const body = itemMatch[1];

      const keyMatch = body.match(/key\s*:\s*['"]([^'"]+)['"]/);
      if (!keyMatch) continue;
      item.key = keyMatch[1];

      const valueMatch = body.match(/value\s*:\s*([^,}]+)/);
      if (valueMatch) {
        const raw = valueMatch[1].trim();
        if (raw === 'true') item.value = true;
        else if (raw === 'false') item.value = false;
        else if (!isNaN(Number(raw))) item.value = Number(raw);
        else item.value = raw.replace(/['"]/g, '');
      }

      const typeMatch = body.match(/type\s*:\s*['"]([^'"]+)['"]/);
      if (typeMatch) item.type = typeMatch[1];

      const nullishMatch = body.match(/nullish\s*:\s*(true|false)/);
      if (nullishMatch) item.nullish = nullishMatch[1] === 'true';

      const mustBeFalsyMatch = body.match(/mustBeFalsy\s*:\s*(true|false)/);
      if (mustBeFalsyMatch) item.mustBeFalsy = mustBeFalsyMatch[1] === 'true';

      additional.push(item);
    }

    return additional.length > 0 ? { login, additional } : { login };
  } catch {
  }

  return { login: true };
};
