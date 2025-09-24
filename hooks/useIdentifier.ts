// hooks/useIdentifier.ts
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { PLANT_API_KEY } from '@env';

type IdentifyOptions = {
  organs?: Array<'leaf' | 'flower' | 'fruit' | 'bark' | 'habit'>;
};

export type IdentifyResult = {
  scientificName: string;
  commonNames: string[];
  score: number; // 0..1
  raw?: any;     // raw API response (optional, useful for debugging)
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

async function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: any;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
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

  const identify = useCallback(
    async (imageUri: string, opts: IdentifyOptions = {}) => {
      if (!PLANT_API_KEY) throw new Error('Missing PLANT_API_KEY in env');

      setLoading(true);
      setError(null);
      setData(null);
      setCandidatesTop3([]);

      const endpoint = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(
        PLANT_API_KEY
      )}`;

      const organs = opts.organs?.length ? opts.organs : ['leaf'];

      const form = new FormData();
      form.append('organs', organs.join(','));
      form.append('images', {
        uri: imageUri,
        name: filenameFromUri(imageUri),
        type: 'image/jpeg',
      } as unknown as Blob);

      const attempt = async () => {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: Platform.OS === 'web' ? { Accept: 'application/json' } : undefined,
          body: form as any,
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json?.error || `Identify failed (${resp.status})`);
        return json;
      };

      try {
        let json: any;
        try {
          json = await withTimeout(attempt(), 30000, 'identify');
        } catch {
          await new Promise((r) => setTimeout(r, 400));
          json = await withTimeout(attempt(), 30000, 'identify(retry)');
        }

        const results = (Array.isArray(json?.results) ? json.results : [])
          .slice()
          .sort((a: any, b: any) => (b?.score ?? 0) - (a?.score ?? 0));

        if (!results.length) throw new Error('No species found for this photo.');

        // Map to our shape
        const mapped: IdentifyResult[] = results.slice(0, 3).map((r: any) => {
          const scientificName =
            r?.species?.scientificNameWithoutAuthor ||
            r?.species?.scientificName ||
            r?.species?.genus?.scientificName ||
            'Unknown species';
          const commonNames: string[] = Array.isArray(r?.species?.commonNames) ? r.species.commonNames : [];
          const score = typeof r?.score === 'number' ? r.score : 0;
          return { scientificName, commonNames, score };
        });

        // Keep UI contract: top-1 in `data`
        setData(mapped[0] || null);
        // Expose top-3
        setCandidatesTop3(mapped);

        // Return top-3 to the caller as well
        return mapped;
      } catch (err: any) {
        const msg = err?.message || 'Identification failed';
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { loading, data, candidatesTop3, error, identify };
}
