import type { ContractCheckResult, RunContractSummary } from './types';

const statusIcon = (status: ContractCheckResult['status']): string => {
  switch (status) {
    case 'pass': return '[PASS]';
    case 'fail': return '[FAIL]';
    case 'skipped': return '[SKIP]';
  }
};

export const logContractResult = (result: ContractCheckResult): void => {
  const { endpoint, durationMs, httpStatus, responseStatus, errorCode, reason } = result;
  const icon = statusIcon(result.status);
  const core = `${icon} ${endpoint.method} /${endpoint.fullPath} ${durationMs}ms`;

  if (result.status === 'pass') {
    const tail = responseStatus === 'error' ? ` (error: ${errorCode ?? 'unknown'})` : '';
    console.log(`${core} http=${httpStatus ?? '-'}${tail}`);
    return;
  }

  if (result.status === 'skipped') {
    console.log(`${core} ${reason ?? ''}`);
    return;
  }

  console.log(`${core} http=${httpStatus ?? '-'} reason=${reason ?? '(none)'}`);
};

export const logContractSummary = (summary: RunContractSummary): void => {
  const { total, passed, failed, skipped } = summary;
  console.log('');
  console.log(`Contract tests: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`);

  if (failed > 0) {
    console.log('');
    console.log('Failures:');
    for (const result of summary.results) {
      if (result.status !== 'fail') continue;
      console.log(`  - /${result.endpoint.fullPath}: ${result.reason ?? '(no reason)'}`);
    }
  }
};
