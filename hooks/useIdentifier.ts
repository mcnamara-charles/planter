// hooks/useIdentifier.ts
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { PLANT_API_KEY } from '@env';

type IdentifyOptions = {
  organs?: Array<'leaf' | 'flower' | 'fruit' | 'bark' | 'habit'>;
  timeoutMsPerAttempt?: number;      // NEW: override per-attempt timeout (default 20s)
  maxAttempts?: number;              // NEW: override attempts (default 3)
};

export type IdentifyResult = {
  scientificName: string;
  commonNames: string[];
  score: number; // 0..1
  raw?: any;     // raw API response (optional, useful for debugging)
};

type NetworkAttemptLog = {
  attempt: number;
  label: string;
  url: string;
  status?: number;
  ok?: boolean;
  durationMs: number;
  contentType?: string | null;
  headers: Record<string, string>;
  bodyPreview?: string;
  error?: string;
  cfId?: string | null; // x-amz-cf-id or cf-ray if present
};

function filenameFromUri(uri: string) {
  try {
    const clean = uri.split('?')[0];
    const last = clean.split('/').pop() || 'photo.jpg';
    return last.includes('.') ? last : `${last}.jpg`;
  } catch {
    return 'photo.jpg';
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function headersToObject(h: Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  // @ts-ignore – RN fetch Headers is iterable in modern RN
  for (const [k, v] of h.entries?.() ?? []) out[k.toLowerCase()] = String(v);
  return out;
}

function preview(text: string, n = 400) {
  if (!text) return '';
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

function shouldRetry(status?: number, err?: unknown) {
  if (err && !status) return true; // network error / aborted / DNS, etc.
  if (!status) return false;
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

/**
 * Pl@ntNet identifier hook
 * - UI compatibility: `data` continues to hold ONLY the top-1 result.
 * - Advanced usage: `candidatesTop3` holds the top 3, and `identify()` returns them.
 */
export function useIdentifier() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<IdentifyResult | null>(null);            // top-1 for UI
  const [candidatesTop3, setCandidatesTop3] = useState<IdentifyResult[]>([]); // top-3 for advanced use
  const [error, setError] = useState<string | null>(null);
  const [networkLog, setNetworkLog] = useState<NetworkAttemptLog[]>([]);
  const isMounted = useRef(true);

  // track mount to avoid setState on unmounted component
  // (safe in React Native – no strict mode double-invoke problem for effects here)
  // call this in your component root if you want; for the hook we keep it simple:
  // eslint-disable-next-line react-hooks/exhaustive-deps
  isMounted.current = true;

  const identify = useCallback(
    async (imageUri: string, opts: IdentifyOptions = {}) => {
      if (!PLANT_API_KEY) throw new Error('Missing PLANT_API_KEY in env');

      const endpoint = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(PLANT_API_KEY)}`;
      const organs = (opts.organs?.length ? opts.organs : ['leaf']).slice(0);

      const timeoutMs = Math.max(2000, opts.timeoutMsPerAttempt ?? 20000); // default 20s per attempt
      const maxAttempts = Math.min(5, Math.max(1, opts.maxAttempts ?? 3)); // default 3 attempts

      setLoading(true);
      setError(null);
      setData(null);
      setCandidatesTop3([]);
      setNetworkLog([]);

      // Build FormData fresh each attempt (some platforms lock streams after send)
      const buildForm = () => {
        const form = new FormData();
        // Many APIs expect repeated `organs` params. Use multi-append for maximal compatibility.
        organs.forEach((o) => form.append('organs', o));
        form.append('images', {
          uri: imageUri,
          name: filenameFromUri(imageUri),
          type: 'image/jpeg',
        } as unknown as Blob);
        return form;
      };

      const attemptOnce = async (attempt: number) => {
        const controller = new AbortController();
        const t0 = Date.now();
        let status: number | undefined;
        let ok = false;
        let text = '';
        let json: any = null;
        let ct: string | null | undefined = undefined;
        let headersObj: Record<string, string> = {};
        let cfId: string | null = null;
        let errMsg: string | undefined;

        const kill = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: Platform.OS === 'web' ? { Accept: 'application/json' } : undefined,
            body: buildForm() as any,
            signal: controller.signal,
          });

          status = resp.status;
          ok = resp.ok;
          ct = resp.headers.get('content-type');
          headersObj = headersToObject(resp.headers);
          cfId = headersObj['x-amz-cf-id'] || headersObj['cf-ray'] || null;

          // Only parse as JSON when the header says it's JSON.
          if (ct && ct.includes('application/json')) {
            json = await resp.json();
          } else {
            text = await resp.text(); // HTML error page or plain text
          }

          if (!ok) {
            const serverMessage =
              (json && (json.error || json.message)) ||
              (text && preview(text)) ||
              `Request failed (${status})`;

            throw new Error(serverMessage);
          }

          return {
            status,
            ok,
            ct,
            headersObj,
            cfId,
            json,
            text,
            durationMs: Date.now() - t0,
          };
        } catch (e: any) {
          errMsg = e?.name === 'AbortError'
            ? `Timed out after ${timeoutMs}ms`
            : (e?.message || String(e));
          return {
            status,
            ok,
            ct,
            headersObj,
            cfId,
            json,
            text,
            durationMs: Date.now() - t0,
            error: errMsg,
          };
        } finally {
          clearTimeout(kill);
        }
      };

      // exponential backoff with jitter (ms)
      const baseDelays = [0, 500, 1500, 3000]; // we’ll cap by maxAttempts
      let lastError: string | null = null;
      let lastNonOk: ReturnType<typeof attemptOnce> | null = null;

      for (let i = 1; i <= maxAttempts; i++) {
        const res = await attemptOnce(i);

        // push an attempt log (limit to last 10 to avoid growth)
        setNetworkLog((prev) => {
          const next: NetworkAttemptLog[] = [
            ...prev,
            {
              attempt: i,
              label: `try-${i}`,
              url: endpoint,
              status: res.status,
              ok: res.ok,
              durationMs: res.durationMs,
              contentType: res.ct ?? undefined,
              headers: res.headersObj || {},
              bodyPreview: res.text ? preview(res.text) : undefined,
              error: res.error,
              cfId: res.cfId,
            },
          ];
          return next.slice(-10);
        });

        if (res.ok && res.json) {
          // success path
          const results = (Array.isArray(res.json?.results) ? res.json.results : [])
            .slice()
            .sort((a: any, b: any) => (b?.score ?? 0) - (a?.score ?? 0));

          if (!results.length) {
            lastError = 'No species found for this photo.';
            lastNonOk = res as any;
            // do not retry for empty result: break early
            break;
          }

          const mapped: IdentifyResult[] = results.slice(0, 3).map((r: any) => {
            const scientificName =
              r?.species?.scientificNameWithoutAuthor ||
              r?.species?.scientificName ||
              r?.species?.genus?.scientificName ||
              'Unknown species';
            const commonNames: string[] = Array.isArray(r?.species?.commonNames) ? r.species.commonNames : [];
            const score = typeof r?.score === 'number' ? r.score : 0;
            return { scientificName, commonNames, score, raw: __DEV__ ? r : undefined };
          });

          if (isMounted.current) {
            setData(mapped[0] || null);
            setCandidatesTop3(mapped);
          }
          return mapped; // ← return top-3 to caller
        }

        // not ok → decide whether to retry
        lastError =
          res.error ||
          (res.text?.trim().startsWith('<') ? 'Upstream HTML error page received (likely CDN/CloudFront)' : null) ||
          `Request failed${res.status ? ` (${res.status})` : ''}`;
        lastNonOk = res as any;

        if (i < maxAttempts && shouldRetry(res.status, res.error)) {
          const base = baseDelays[Math.min(i, baseDelays.length - 1)];
          const jitter = Math.floor(Math.random() * 250);
          await sleep(base + jitter);
          continue;
        }
        break; // no more retries
      }

      // If we’re here, we did not return successfully.
      const cfHint = (lastNonOk as any)?.cfId ? ` [cf-id: ${(lastNonOk as any).cfId}]` : '';
      const friendly =
        ((lastNonOk as any)?.text?.trim().startsWith('<') && 'Service is temporarily unavailable (CDN/CloudFront).') ||
        lastError ||
        'Identification failed';

      const finalMessage = `${friendly}${cfHint}`;
      if (isMounted.current) setError(finalMessage);
      setLoading(false);
      throw new Error(finalMessage);
    },
    []
  );

  return { loading, data, candidatesTop3, error, identify, networkLog };
}
