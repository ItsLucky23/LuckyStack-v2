export interface PreCronRunPayload {
  jobName: string;
  /** The tick this run was scheduled for (ms epoch, includes jitter). */
  scheduledFor: number;
}

export interface PostCronRunPayload extends PreCronRunPayload {
  durationMs: number;
  /** `null` on success; for `perTenant` jobs the FIRST tenant failure. */
  error: Error | null;
}

declare module '@luckystack/core' {
  interface HookPayloads {
    /**
     * Fired before every job run — VETO seam: return a stop signal to skip
     * this run (maintenance windows, per-environment suppression).
     */
    preCronRun: PreCronRunPayload;
    /** Fired after every job run with duration + outcome. */
    postCronRun: PostCronRunPayload;
  }
}
