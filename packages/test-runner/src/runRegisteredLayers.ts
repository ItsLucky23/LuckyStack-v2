//? Runs every layer registered via `registerTestLayer` against every endpoint
//? in the given `apiMethodMap`, fans each result to the registered reporter
//? (`onResult` / `onSummary`), and — when the reporter declares a `webhookUrl`
//? — POSTs the JSON-serialised summary to it.
//?
//? Built-in sweep layers (contract/auth/rate-limit/fuzz) are NOT run here and
//? `runAllTests` does NOT call this function automatically. The extension registry
//? is a coordination surface for consumer test harnesses: read the layers with
//? `listTestLayers()`, then call `runRegisteredLayers({ apiMethodMap, authToken })`
//? from your own aggregator after the built-in sweeps finish. See
//? docs/extension-hooks.md for the full lifecycle and examples.

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { walkEndpoints } from './walkEndpoints';
import { listTestLayers, getTestReporter } from './extensionRegistry';
import { shouldSkip } from './testLayerHelpers';
import type { TestResult, TestSummary } from './extensionRegistry';
import type { ApiMethodMap } from './types';

export interface RunRegisteredLayersInput {
  apiMethodMap: ApiMethodMap;
  /** Session/bearer token forwarded to each layer's `run({ authToken })`. */
  authToken?: string;
  /**
   * Endpoints to skip — matched against `<page>/<name>` (version-agnostic) and
   * `<page>/<name>/<version>`, same convention as the built-in sweeps.
   */
  skip?: string[];
}

//? Whether a webhook URL targets a loopback host (localhost / 127.0.0.0/8 / ::1).
//? Plaintext http to a non-loopback target leaks the route inventory (+ bearer)
//? over the wire, so we warn — but never block, since the URL is consumer-self-
//? registered.
const isLoopbackHost = (host: string): boolean =>
  host === 'localhost'
  || host === '::1'
  || host === '[::1]'
  || /^127\.\d+\.\d+\.\d+$/.test(host);

//? POST the summary to the reporter's webhook, if one is configured. Best-effort
//? — a webhook failure must never fail the test run.
const postWebhook = async (summary: TestSummary): Promise<void> => {
  const reporter = getTestReporter();
  const webhookUrl = reporter?.webhookUrl;
  if (!reporter || !webhookUrl) return;
  //? Warn (don't block) when forwarding the summary — which carries endpoint
  //? paths, error codes and reporter metadata verbatim — plaintext to a
  //? non-loopback host. Mirrors the plaintext-target caution the other network
  //? helpers carry.
  const [, parsedUrl] = tryCatchSync(() => new URL(webhookUrl));
  if (parsedUrl?.protocol === 'http:' && !isLoopbackHost(parsedUrl.hostname)) {
    console.warn(
      `[test-runner] reporter.webhookUrl is plaintext http to a non-loopback host (${parsedUrl.hostname}); `
      + 'the summary (endpoint paths, error codes, metadata) and any bearer token are sent unencrypted.',
    );
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (reporter.webhookAuth?.type === 'bearer') headers.Authorization = `Bearer ${reporter.webhookAuth.token}`;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => { controller.abort(); }, 10_000);
  await tryCatch(() => fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(summary),
    signal: controller.signal,
  }));
  clearTimeout(timeoutHandle);
};

export const runRegisteredLayers = async (input: RunRegisteredLayersInput): Promise<TestSummary> => {
  const layers = listTestLayers();
  const endpoints = walkEndpoints(input.apiMethodMap);
  const reporter = getTestReporter();
  const skip = input.skip ?? [];
  const results: TestResult[] = [];

  for (const layer of layers) {
    for (const endpoint of endpoints) {
      if (shouldSkip(endpoint, skip)) continue;
      const started = Date.now();
      const [runError, layerResult] = await tryCatch(async () =>
        layer.run({ endpoint: endpoint.fullPath, method: endpoint.method, authToken: input.authToken }));
      const durationMs = Date.now() - started;

      const result: TestResult = runError || !layerResult
        ? {
            layer: layer.name,
            endpoint: endpoint.fullPath,
            passed: false,
            message: runError?.message ?? 'layer returned no result',
            durationMs,
          }
        : {
            layer: layer.name,
            endpoint: endpoint.fullPath,
            passed: layerResult.passed,
            message: layerResult.message,
            durationMs,
            metadata: layerResult.metadata,
          };

      results.push(result);
      await tryCatch(async () => reporter?.onResult?.(result));
    }
  }

  const summary: TestSummary = {
    totalLayers: layers.length,
    totalEndpoints: endpoints.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
  };

  await tryCatch(async () => reporter?.onSummary?.(summary));
  await postWebhook(summary);

  return summary;
};
