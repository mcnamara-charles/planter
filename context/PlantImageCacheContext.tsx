import React, { createContext, useContext, useCallback, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

type CachedImageMetadata = {
  localUri: string; // file:// path to local image
  plantUpdatedAt: string | null; // updated_at from user_plants table
  photoId: string | null; // default_plant_photo_id - used to version the cache
  cachedAt: number; // timestamp when cached
};

const CACHE_DIR = `${FileSystem.cacheDirectory}plant-images/`;
const METADATA_KEY = '@plant_image_cache_metadata';

type PlantImageCacheContextType = {
  getCachedImage: (plantId: string, plantUpdatedAt: string | null, photoId: string | null, generateUri: () => Promise<string>) => Promise<string>;
  clearCache: () => Promise<void>;
  invalidatePlant: (plantId: string) => Promise<void>;
};

const PlantImageCacheContext = createContext<PlantImageCacheContextType | undefined>(undefined);

// Ensure cache directory exists
async function ensureCacheDir() {
  const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

// Load metadata from AsyncStorage
async function loadMetadata(): Promise<Record<string, CachedImageMetadata>> {
  try {
    const json = await AsyncStorage.getItem(METADATA_KEY);
    return json ? JSON.parse(json) : {};
  } catch (error) {
    console.error('[PlantImageCache] Error loading metadata:', error);
    return {};
  }
}

// Save metadata to AsyncStorage
async function saveMetadata(metadata: Record<string, CachedImageMetadata>): Promise<void> {
  try {
    await AsyncStorage.setItem(METADATA_KEY, JSON.stringify(metadata));
  } catch (error) {
    console.error('[PlantImageCache] Error saving metadata:', error);
  }
}

export function PlantImageCacheProvider({ children }: { children: React.ReactNode }) {
  const loadingRef = useRef<Set<string>>(new Set()); // Track plants currently loading
  const metadataRef = useRef<Record<string, CachedImageMetadata>>({});
  const initializedRef = useRef(false);

  // Initialize: load metadata and ensure cache directory exists
  React.useEffect(() => {
    (async () => {
      if (!initializedRef.current) {
        await ensureCacheDir();
        metadataRef.current = await loadMetadata();
        initializedRef.current = true;
      }
    })();
  }, []);

  const getCachedImage = useCallback(
    async (
      plantId: string,
      plantUpdatedAt: string | null,
      photoId: string | null,
      generateUri: () => Promise<string>
    ): Promise<string> => {
      // Ensure initialized
      if (!initializedRef.current) {
        await ensureCacheDir();
        metadataRef.current = await loadMetadata();
        initializedRef.current = true;
      }

      // Use versioned cache key: plantId + photoId (or 'none' if no photo)
      // This ensures that when the photo changes, we get a new cache entry
      const cacheKey = photoId ? `${plantId}-${photoId}` : `${plantId}-none`;
      const cached = metadataRef.current[cacheKey];

      // Check if we should use cached image
      if (cached) {
        // Check if local file exists
        const fileInfo = await FileSystem.getInfoAsync(cached.localUri);
        if (fileInfo.exists) {
          // Check if photo ID matches (version check)
          if (cached.photoId === photoId) {
            // If plant hasn't been updated since cache, use cached image
            if (!plantUpdatedAt || !cached.plantUpdatedAt) {
              // If we don't have updated_at info, use cache (first load scenario)
              return cached.localUri;
            }

            // Compare timestamps
            const cacheTime = new Date(cached.plantUpdatedAt).getTime();
            const plantUpdateTime = new Date(plantUpdatedAt).getTime();

            if (plantUpdateTime <= cacheTime) {
              // Plant hasn't been updated, use cached image
              return cached.localUri;
            }
          }
          // Photo ID changed or plant was updated - need to fetch new image
        }
        // File doesn't exist or photo changed, remove from metadata
        delete metadataRef.current[cacheKey];
        await saveMetadata(metadataRef.current);
      }

      // Need to fetch new image
      // Prevent duplicate requests
      if (loadingRef.current.has(cacheKey)) {
        // Wait a bit and check cache again (another request might have finished)
        await new Promise(resolve => setTimeout(resolve, 100));
        const updatedCache = metadataRef.current[cacheKey];
        if (updatedCache && updatedCache.photoId === photoId) {
          const fileInfo = await FileSystem.getInfoAsync(updatedCache.localUri);
          if (fileInfo.exists) {
            return updatedCache.localUri;
          }
        }
      }

      loadingRef.current.add(cacheKey);

      try {
        // Generate the signed URL
        const remoteUri = await generateUri();
        
        if (!remoteUri) {
          // No image available
          return '';
        }

        // Download image to local storage with versioned filename
        const localFileName = photoId ? `${plantId}-${photoId}.jpg` : `${plantId}-none.jpg`;
        const localUri = `${CACHE_DIR}${localFileName}`;

        // Download the image
        const downloadResult = await FileSystem.downloadAsync(remoteUri, localUri);
        
        if (downloadResult.status === 200) {
          // Save metadata with versioned key
          metadataRef.current[cacheKey] = {
            localUri: downloadResult.uri,
            plantUpdatedAt,
            photoId,
            cachedAt: Date.now(),
          };
          await saveMetadata(metadataRef.current);
          return downloadResult.uri;
        } else {
          console.error('[PlantImageCache] Download failed:', downloadResult.status);
          return remoteUri; // Fallback to remote URI
        }
      } catch (error) {
        console.error('[PlantImageCache] Error fetching/caching image:', error);
        // Fallback: try to generate URI again and return it directly
        try {
          return await generateUri();
        } catch {
          return '';
        }
      } finally {
        loadingRef.current.delete(cacheKey);
      }
    },
    []
  );

  const clearCache = useCallback(async () => {
    try {
      // Clear metadata
      metadataRef.current = {};
      await AsyncStorage.removeItem(METADATA_KEY);
      
      // Clear files
      const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
      await Promise.all(
        files.map(file => FileSystem.deleteAsync(`${CACHE_DIR}${file}`, { idempotent: true }))
      );
    } catch (error) {
      console.error('[PlantImageCache] Error clearing cache:', error);
    }
  }, []);

  const invalidatePlant = useCallback(async (plantId: string) => {
    try {
      const cached = metadataRef.current[plantId];
      if (cached) {
        // Delete local file
        await FileSystem.deleteAsync(cached.localUri, { idempotent: true });
        // Remove from metadata
        delete metadataRef.current[plantId];
        await saveMetadata(metadataRef.current);
      }
    } catch (error) {
      console.error('[PlantImageCache] Error invalidating plant:', error);
    }
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
