import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

type CachedImage = {
  uri: string;
  cachedAt: number; // timestamp
  plantUpdatedAt: string | null; // updated_at from user_plants table
};

type PlantImageCache = {
  [plantId: string]: CachedImage;
};

type PlantImageCacheContextType = {
  getCachedImage: (plantId: string, plantUpdatedAt: string | null, generateUri: () => Promise<string>) => Promise<string>;
  clearCache: () => void;
  invalidatePlant: (plantId: string) => void;
};

const PlantImageCacheContext = createContext<PlantImageCacheContextType | undefined>(undefined);

export function PlantImageCacheProvider({ children }: { children: React.ReactNode }) {
  const [cache, setCache] = useState<PlantImageCache>({});
  const loadingRef = useRef<Set<string>>(new Set()); // Track plants currently loading

  const getCachedImage = useCallback(
    async (
      plantId: string,
      plantUpdatedAt: string | null,
      generateUri: () => Promise<string>
    ): Promise<string> => {
      const cached = cache[plantId];

      // Check if we should use cached image
      if (cached) {
        // If plant hasn't been updated since cache, use cached image
        if (!plantUpdatedAt || !cached.plantUpdatedAt) {
          // If we don't have updated_at info, use cache (first load scenario)
          return cached.uri;
        }

        // Compare timestamps
        const cacheTime = new Date(cached.plantUpdatedAt).getTime();
        const plantUpdateTime = new Date(plantUpdatedAt).getTime();

        if (plantUpdateTime <= cacheTime) {
          // Plant hasn't been updated, use cached image
          return cached.uri;
        }
      }

      // Need to fetch new image
      // Prevent duplicate requests
      if (loadingRef.current.has(plantId)) {
        // Wait a bit and check cache again (another request might have finished)
        await new Promise(resolve => setTimeout(resolve, 100));
        const updatedCache = cache[plantId];
        if (updatedCache) {
          return updatedCache.uri;
        }
      }

      loadingRef.current.add(plantId);

      try {
        const uri = await generateUri();
        setCache((prev) => ({
          ...prev,
          [plantId]: {
            uri,
            cachedAt: Date.now(),
            plantUpdatedAt,
          },
        }));
        return uri;
      } finally {
        loadingRef.current.delete(plantId);
      }
    },
    [cache]
  );

  const clearCache = useCallback(() => {
    setCache({});
  }, []);

  const invalidatePlant = useCallback((plantId: string) => {
    setCache((prev) => {
      const next = { ...prev };
      delete next[plantId];
      return next;
    });
  }, []);

  return (
    <PlantImageCacheContext.Provider value={{ getCachedImage, clearCache, invalidatePlant }}>
      {children}
    </PlantImageCacheContext.Provider>
  );
}

export function usePlantImageCache() {
  const context = useContext(PlantImageCacheContext);
  if (!context) {
    throw new Error('usePlantImageCache must be used within PlantImageCacheProvider');
  }
  return context;
}

