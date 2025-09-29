import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/services/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { type Plant } from '@/types/plant';

type JoinedPhotoRow = { id: string; bucket: string; object_path: string };

// The row shape we expect from the joined query
type UserPlantJoined = {
  id: string;
  plants_table_id: string | null;
  nickname: string | null;
  acquired_at: string | null;
  acquired_from: string | null;
  location: string | null;
  default_plant_photo_id: string | null;
  plants: {
    id: string;
    plant_name: string | null;
    plant_scientific_name: string | null;
  } | null;
  // Supabase returns arrays for joined relations unless it can guarantee 1:1
  photo: JoinedPhotoRow[] | null;
};

export function useDashboard() {
  const { user } = useAuth();
  const [sickPlantsCount, setSickPlantsCount] = useState(0);
  const [plantsNeedingInspectionCount, setPlantsNeedingInspectionCount] = useState(0);
  const [plantsNeedingInspection, setPlantsNeedingInspection] = useState<Plant[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch most recent observe events for each plant and count sick ones
  const fetchSickPlantsCount = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      // Get all user plants
      const { data: userPlants, error: plantsError } = await supabase
        .from('user_plants')
        .select('id')
        .eq('owner_id', user.id);
      
      if (plantsError) throw plantsError;
      
      if (!userPlants || userPlants.length === 0) {
        setSickPlantsCount(0);
        return;
      }
      
      const plantIds = userPlants.map(p => p.id);
      
      // Get the most recent observe event for each plant
      const { data: recentObserveEvents, error: eventsError } = await supabase
        .from('user_plant_timeline_events')
        .select('user_plant_id, event_data')
        .eq('event_type', 'observe')
        .in('user_plant_id', plantIds)
        .order('event_time', { ascending: false });
      
      if (eventsError) throw eventsError;
      
      // Group by plant_id and get the most recent for each
      const mostRecentByPlant = new Map();
      recentObserveEvents?.forEach(event => {
        if (!mostRecentByPlant.has(event.user_plant_id)) {
          mostRecentByPlant.set(event.user_plant_id, event);
        }
      });
      
      // Count plants with is_healthy: false
      let sickCount = 0;
      mostRecentByPlant.forEach(event => {
        const healthData = event.event_data?.health;
        if (healthData && healthData.is_healthy === false) {
          sickCount++;
        }
      });
      
      setSickPlantsCount(sickCount);
      
    } catch (error) {
      console.error('Error fetching sick plants count:', error);
      setSickPlantsCount(0);
    }
  }, [user?.id]);

  // Fetch plants that need inspection (no observe events or none in the past week)
  const fetchPlantsNeedingInspection = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      // Get all user plants
      const { data: userPlants, error: plantsError } = await supabase
        .from('user_plants')
        .select('id, plants_table_id, nickname, default_plant_photo_id')
        .eq('owner_id', user.id);
      
      if (plantsError) throw plantsError;
      
      if (!userPlants || userPlants.length === 0) {
        setPlantsNeedingInspectionCount(0);
        setPlantsNeedingInspection([]);
        return;
      }
      
      const plantIds = userPlants.map(p => p.id);
      
      // Get all observe events for these plants
      const { data: observeEvents, error: eventsError } = await supabase
        .from('user_plant_timeline_events')
        .select('user_plant_id, event_time')
        .eq('event_type', 'observe')
        .in('user_plant_id', plantIds)
        .order('event_time', { ascending: false });
      
      if (eventsError) throw eventsError;
      
      // Calculate one week ago (ignoring time, just date)
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      oneWeekAgo.setHours(0, 0, 0, 0); // Start of day
      
      // Group by plant_id and get the most recent event for each
      const mostRecentByPlant = new Map();
      observeEvents?.forEach(event => {
        if (!mostRecentByPlant.has(event.user_plant_id)) {
          mostRecentByPlant.set(event.user_plant_id, event);
        }
      });
      
      // Find plants that need inspection (no events or events older than a week)
      const plantsNeedingInspectionIds: string[] = [];
      userPlants.forEach(plant => {
        const mostRecentEvent = mostRecentByPlant.get(plant.id);
        if (!mostRecentEvent || new Date(mostRecentEvent.event_time) < oneWeekAgo) {
          plantsNeedingInspectionIds.push(plant.id);
        }
      });
      
      setPlantsNeedingInspectionCount(plantsNeedingInspectionIds.length);
      
      if (plantsNeedingInspectionIds.length === 0) {
        setPlantsNeedingInspection([]);
        return;
      }
      
      // Get plant details for plants needing inspection
      const inspectionUserPlants = userPlants.filter(p => plantsNeedingInspectionIds.includes(p.id));
      
      const inspectionPlantIds = Array.from(new Set(inspectionUserPlants
        .map((p: any) => p.plants_table_id)
        .filter((v: any) => v !== null && v !== undefined)));

      const rawPhotoVals = inspectionUserPlants
        .map((p: any) => p.default_plant_photo_id)
        .filter((v: any) => v !== null && v !== undefined);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const inspectionPhotoIds = Array.from(new Set(rawPhotoVals.filter((v: any) => typeof v === 'string' && uuidRegex.test(v))));
      const inspectionPhotoPaths = Array.from(new Set(rawPhotoVals.filter((v: any) => typeof v === 'string' && !uuidRegex.test(v))));

      let plantsById: Record<string, any> = {};
      if (inspectionPlantIds.length > 0) {
        const { data: plantRows, error: pErr } = await supabase
          .from('plants')
          .select('id, plant_name, plant_scientific_name')
          .in('id', inspectionPlantIds);
        if (pErr) throw pErr;
        plantsById = Object.fromEntries(
          (plantRows ?? []).map((p: any) => [String(p.id), p])
        );
      }

      let photoById: Record<string, string> = {};
      if (inspectionPhotoIds.length > 0) {
        const { data: photoRows, error: phErr } = await supabase
          .from('user_plant_photos')
          .select('id, bucket, object_path')
          .in('id', inspectionPhotoIds);
        if (phErr) throw phErr;

        for (const pr of photoRows ?? []) {
          try {
            const { data: signed, error: sErr } = await supabase.storage
              .from(pr.bucket || 'plant-photos')
              .createSignedUrl(pr.object_path, 60 * 60, {
                transform: { width: 512, quality: 80, resize: 'contain' },
              });
            if (!sErr && signed?.signedUrl) {
              photoById[String(pr.id)] = signed.signedUrl;
            }
          } catch {}
        }
      }

      let photoByPath: Record<string, string> = {};
      if (inspectionPhotoPaths.length > 0) {
        for (const pth of inspectionPhotoPaths) {
          try {
            const { data: signed, error: sErr } = await supabase.storage
              .from('plant-photos')
              .createSignedUrl(String(pth), 60 * 60, {
                transform: { width: 512, quality: 80, resize: 'contain' },
              });
            if (!sErr && signed?.signedUrl) {
              photoByPath[String(pth)] = signed.signedUrl;
            }
          } catch {}
        }
      }

      const mapped: Plant[] = inspectionUserPlants.map((row: any) => {
        const ref = plantsById[String(row.plants_table_id)] ?? {};
        const displayName = row.nickname || ref.plant_name || 'Unnamed Plant';
        const sci = ref.plant_scientific_name || '';
        let photo = '';
        if (row.default_plant_photo_id) {
          const key = String(row.default_plant_photo_id);
          photo = photoById[key] ?? photoByPath[key] ?? '';
        }
        return {
          id: String(row.id),
          name: displayName,
          scientificName: sci,
          imageUri: photo,
        };
      });

      setPlantsNeedingInspection(mapped);
      
    } catch (error) {
      console.error('Error fetching plants needing inspection:', error);
      setPlantsNeedingInspectionCount(0);
      setPlantsNeedingInspection([]);
    }
  }, [user?.id]);

  // Fetch all plants for PlantGallery component
  const fetchPlants = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const { data: userPlants, error: upErr } = await supabase
        .from('user_plants')
        .select('id, plants_table_id, nickname, default_plant_photo_id')
        .eq('owner_id', user.id);
      
      if (upErr) throw upErr;

      const plantIds = Array.from(new Set((userPlants ?? [])
        .map((p: any) => p.plants_table_id)
        .filter((v: any) => v !== null && v !== undefined)));

      const rawPhotoVals = (userPlants ?? [])
        .map((p: any) => p.default_plant_photo_id)
        .filter((v: any) => v !== null && v !== undefined);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const photoIds = Array.from(new Set(rawPhotoVals.filter((v: any) => typeof v === 'string' && uuidRegex.test(v))));
      const photoPaths = Array.from(new Set(rawPhotoVals.filter((v: any) => typeof v === 'string' && !uuidRegex.test(v))));

      let plantsById: Record<string, any> = {};
      if (plantIds.length > 0) {
        const { data: plantRows, error: pErr } = await supabase
          .from('plants')
          .select('id, plant_name, plant_scientific_name')
          .in('id', plantIds);
        if (pErr) throw pErr;
        plantsById = Object.fromEntries(
          (plantRows ?? []).map((p: any) => [String(p.id), p])
        );
      }

      let photoById: Record<string, string> = {};
      if (photoIds.length > 0) {
        const { data: photoRows, error: phErr } = await supabase
          .from('user_plant_photos')
          .select('id, bucket, object_path')
          .in('id', photoIds);
        if (phErr) throw phErr;

        for (const pr of photoRows ?? []) {
          try {
            const { data: signed, error: sErr } = await supabase.storage
              .from(pr.bucket || 'plant-photos')
              .createSignedUrl(pr.object_path, 60 * 60, {
                transform: { width: 512, quality: 80, resize: 'contain' },
              });
            if (!sErr && signed?.signedUrl) {
              photoById[String(pr.id)] = signed.signedUrl;
            }
          } catch {}
        }
      }

      let photoByPath: Record<string, string> = {};
      if (photoPaths.length > 0) {
        for (const pth of photoPaths) {
          try {
            const { data: signed, error: sErr } = await supabase.storage
              .from('plant-photos')
              .createSignedUrl(String(pth), 60 * 60, {
                transform: { width: 512, quality: 80, resize: 'contain' },
              });
            if (!sErr && signed?.signedUrl) {
              photoByPath[String(pth)] = signed.signedUrl;
            }
          } catch {}
        }
      }

      const mapped: Plant[] = (userPlants ?? []).map((row: any) => {
        const ref = plantsById[String(row.plants_table_id)] ?? {};
        const displayName = row.nickname || ref.plant_name || 'Unnamed Plant';
        const sci = ref.plant_scientific_name || '';
        let photo = '';
        if (row.default_plant_photo_id) {
          const key = String(row.default_plant_photo_id);
          photo = photoById[key] ?? photoByPath[key] ?? '';
        }
        return {
          id: String(row.id),
          name: displayName,
          scientificName: sci,
          imageUri: photo,
        };
      });

      setPlants(mapped);
      
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load plants');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Fetch all dashboard data
  const fetchDashboardData = useCallback(async () => {
    await Promise.all([
      fetchSickPlantsCount(),
      fetchPlantsNeedingInspection(),
      fetchPlants()
    ]);
  }, [fetchSickPlantsCount, fetchPlantsNeedingInspection, fetchPlants]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return {
    sickPlantsCount,
    plantsNeedingInspectionCount,
    plantsNeedingInspection,
    plants,
    loading,
    error,
    refetch: fetchDashboardData,
    refetchSickPlants: fetchSickPlantsCount,
    refetchPlantsNeedingInspection: fetchPlantsNeedingInspection,
    refetchPlants: fetchPlants,
  };
}
