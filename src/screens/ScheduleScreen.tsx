import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from 'react';
import {
  StyleSheet,
  View,
  Modal,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import { useRebuildAllWaterSchedules } from '@/hooks/scheduling/useRebuildAllWaterSchedules';
import { delayScheduleByDays } from '@/services/supabaseSchedules';
import { useUpdateWaterSchedule, useUpdateFertilizeSchedule } from '@/hooks/scheduling/useUpdateWaterSchedule';
import SkeletonTile from '@/components/SkeletonTile';
import { IconSymbol } from '@/components/ui/icon-symbol';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import WaterModal from '@/components/WaterModal';
import FertilizeModal from '@/components/FertilizeModal';
import CareModal from '@/components/CareModal';
import LineageIndicator from '@/components/LineageIndicator';

type ScheduleItem = {
  id: string;
  userPlantId: string;
  eventType: string;
  nextRunAt: string;
  plantNickname: string;
  plantName: string;
  locationId: string | null;
  locationName: string;
  lineage?: string | null;
  lightType?: 'grow_light' | 'sunlight' | null;
  systemType?: 'normal' | 'reservoir' | null;
  waterDelay?: number | null;
  plantsTableId?: string | null;
};

type CombinedSchedule = {
  userPlantId: string;
  plantNickname: string;
  plantName: string;
  locationId: string | null;
  locationName: string;
  lineage?: string | null;
  lightType?: 'grow_light' | 'sunlight' | null;
  systemType?: 'normal' | 'reservoir' | null;
  schedules: Record<string, ScheduleItem>;
  earliestNextRunAt: number;
  waterDelay?: number | null;
  isDefaultDelay?: boolean;
  plantsTableId?: string | null;
};

type DelayModalState = {
  visible: boolean;
  schedules: ScheduleItem[];
  selectedEventTypes: Set<string>;
  mode: 'single' | 'multi';
  targetUserPlantIds: string[];
};

type PhotoMeta = { key: string; bucket: string; path: string; userPlantId: string };

/** Exact shape we expect back from the Supabase join */
type ScheduleQueryRow = {
  id: string;
  user_plant_id: string;
  event_type: string;
  next_run_at: string;
  user_plants: {
    id: string;
    nickname: string | null;
    default_plant_photo_id: string | null;
    plants_table_id: string | null;
    system_type: string | null;
    water_delay: number | null;
    lineage: string | null;
    light_type: string | null;
    plants: { plant_name: string | null } | null;
    location: { id: string; name: string | null } | null;
  };
};

const DEBUG_SCHEDULES = true;

function logDebug(...args: any[]) {
  if (DEBUG_SCHEDULES) console.log('[ScheduleDebug]', ...args);
}

const SELECTION_BAR_HEIGHT = 64;
const SELECTION_CHECK_COLOR = '#22C55E';

type EventSummary = {
  eventType: string;
  label: string;
  dateText: string;
  isToday: boolean;
  isTomorrow: boolean;
  backgroundColor: string;
  textColor: string;
  pillBackground: string;
  pillBorderColor: string;
  pillTextColor: string;
  combinedText: string;
  schedule: ScheduleItem | null;
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Memoized card                                                             */
/* ────────────────────────────────────────────────────────────────────────── */
const CombinedScheduleCard = memo(function CombinedScheduleCard({
  plantNickname,
  plantName,
  imageUrl,
  cardColor,
  borderColor,
  textColor,
  isExpanded,
  isSelected,
  onPress,
  onLongPress,
  onInfoPress,
  onDelayPressPlant,
  eventSummaries,
  onCarePress,
  lineage,
  lightType,
  systemType,
  combined,
}: {
  plantNickname: string;
  plantName: string;
  lineage?: string | null;
  lightType?: 'grow_light' | 'sunlight' | null;
  systemType?: 'normal' | 'reservoir' | null;
  imageUrl: string | undefined;
  cardColor: string;
  borderColor: string;
  textColor: string;
  isExpanded: boolean;
  isSelected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onInfoPress: () => void;
  onDelayPressPlant: () => void;
  eventSummaries: EventSummary[];
  onCarePress: (schedule: ScheduleItem, isWatering?: boolean, systemType?: 'normal' | 'reservoir' | null) => void;
  combined: CombinedSchedule;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
  }, [imageUrl]);

  const imageSource = useMemo(
    () => (imageUrl ? { uri: imageUrl } : undefined),
    [imageUrl]
  );

  return (
    <View style={[
      styles.cardWrapper,
      { backgroundColor: cardColor, borderColor, borderRadius: 12 }
    ]}>
      <Pressable
        style={[
          styles.scheduleCard,
          isExpanded && styles.scheduleCardExpanded
        ]}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={250}
      >
        <View style={styles.imageContainer}>
          {imageUrl === undefined ? (
            <SkeletonTile style={styles.imageSkeleton} rounded={8} />
          ) : imageUrl === '' ? (
            <View
              style={[styles.imagePlaceholder, { backgroundColor: borderColor }]}
            >
              <ThemedText style={styles.imagePlaceholderText}>🌱</ThemedText>
            </View>
          ) : (
            <>
              {!imageLoaded && (
                <SkeletonTile style={styles.imageSkeleton} rounded={8} />
              )}
              <Image
                source={imageSource}
                recyclingKey={plantNickname || plantName}
                cachePolicy="disk"
                style={styles.plantImage}
                contentFit="cover"
                transition={150}
                onLoadEnd={() => setImageLoaded(true)}
              />
            </>
          )}
          {isSelected && (
            <View style={styles.selectionOverlay} pointerEvents="none">
              <IconSymbol
                name="checkmark.circle"
                size={32}
                color={SELECTION_CHECK_COLOR}
              />
            </View>
          )}
        </View>

        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {(lineage || lightType === 'grow_light' || systemType === 'reservoir') && (
                <LineageIndicator lineage={lineage} lightType={lightType} systemType={systemType} textSize={10} iconSize={10} />
              )}
              <ThemedText style={styles.plantName}>
                {plantNickname || plantName}
              </ThemedText>
            </View>
          </View>
          
          {/* Water Delay Display */}
          {combined.waterDelay !== null && combined.waterDelay !== undefined && (
            <View style={styles.delayIndicator}>
              <View style={[
                styles.delayBadge,
                { 
                  backgroundColor: combined.isDefaultDelay 
                    ? 'rgba(107, 114, 128, 0.12)' 
                    : 'rgba(59, 130, 246, 0.12)',
                  borderColor: combined.isDefaultDelay 
                    ? 'rgba(107, 114, 128, 0.3)' 
                    : 'rgba(59, 130, 246, 0.3)',
                }
              ]}>
                <IconSymbol
                  name="clock"
                  size={12}
                  color={combined.isDefaultDelay ? '#6B7280' : '#3B82F6'}
                />
                <ThemedText style={[
                  styles.delayText,
                  { color: combined.isDefaultDelay ? '#6B7280' : '#3B82F6' }
                ]}>
                  {combined.waterDelay} {combined.waterDelay === 1 ? 'day' : 'days'}
                </ThemedText>
                <ThemedText style={[
                  styles.delayLabel,
                  { color: combined.isDefaultDelay ? '#9CA3AF' : '#60A5FA' }
                ]}>
                  {combined.isDefaultDelay ? 'Default' : 'Custom'}
                </ThemedText>
              </View>
            </View>
          )}
          
          <View style={styles.eventSummaryList}>
            {eventSummaries.map((summary: EventSummary) => {
              const {
                eventType,
                label,
                dateText,
                combinedText,
                pillBackground,
                pillBorderColor,
                pillTextColor,
                isToday,
                isTomorrow,
              } =
                summary;
              
              // Determine icon based on event type
            let iconName: string;
            let displayLabel: string;
            if (eventType === 'water_fertilize') {
              iconName = 'leaf.fill';
              displayLabel = 'Fertilize & Water';
            } else if (eventType === 'water') {
              iconName = 'drop.fill';
              displayLabel = label;
            } else if (eventType === 'pest_treat') {
              iconName = 'exclamationmark.triangle.fill';
              displayLabel = 'Treat';
            } else {
              iconName = 'leaf.fill';
              displayLabel = label;
            }
              
              // Determine urgency indicator color
              const urgencyColor = isToday
                ? '#10B981' // Green for today
                : isTomorrow
                ? '#F59E0B' // Orange for tomorrow
                : '#6B7280'; // Gray for later
              
              return (
                <View key={eventType} style={styles.eventSummaryRow}>
                  {/* Urgency indicator dot */}
                  <View
                    style={[
                      styles.urgencyDot,
                      { backgroundColor: urgencyColor },
                    ]}
                  />
                  
                  {/* Event icon */}
                  <View
                    style={[
                      styles.eventIconContainer,
                      { backgroundColor: pillBackground },
                    ]}
                  >
                    <IconSymbol
                      name={iconName as any}
                      size={14}
                      color={pillTextColor}
                    />
                  </View>
                  
                  {/* Event label and date */}
                  <View style={styles.eventTextContainer}>
                    <ThemedText
                      style={[
                        styles.eventLabel,
                        { color: pillTextColor },
                        (isToday || isTomorrow) && styles.eventLabelBold,
                      ]}
                    >
                      {displayLabel}
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.eventDate,
                        { color: pillTextColor },
                        { opacity: 0.8 },
                      ]}
                    >
                      {dateText}
                    </ThemedText>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </Pressable>

      {isExpanded && (
        <View style={styles.actionBar}>
          <Pressable
            style={styles.actionButton}
            onPress={onInfoPress}
          >
            <IconSymbol name="info.circle" size={24} color={textColor} />
            <ThemedText style={styles.actionButtonText}>Info</ThemedText>
          </Pressable>

          <Pressable
            style={styles.actionButton}
            onPress={onDelayPressPlant}
          >
            <IconSymbol name="clock" size={24} color={textColor} />
            <ThemedText style={styles.actionButtonText}>Delay</ThemedText>
          </Pressable>

          {eventSummaries.map((summary: EventSummary) => {
            const { eventType, label, schedule } = summary;
            if (!schedule) return null;
            if (eventType === 'pest_treat') return null;
            
            // Handle combined water_fertilize event
            if (eventType === 'water_fertilize') {
              // For combined events, only open fertilize modal with isWatering=true
              // Note: Combined events shouldn't happen for reservoir plants, but handle it anyway
              const fertSched = combined.schedules['fertilize'];
              return (
                <Pressable
                  key={eventType}
                  style={styles.actionButton}
                  onPress={() => {
                    // Only open fertilize modal with isWatering=true
                    if (fertSched) {
                      onCarePress(fertSched, true, systemType);
                    }
                  }}
                >
                  <IconSymbol
                    name="leaf.fill"
                    size={24}
                    color={textColor}
                  />
                  <ThemedText style={styles.actionButtonText}>
                    {label}
                  </ThemedText>
                </Pressable>
              );
            }
            
            return (
              <Pressable
                key={eventType}
                style={styles.actionButton}
                onPress={() => onCarePress(schedule, false, systemType)}
              >
                <IconSymbol
                  name={
                    eventType === 'water'
                      ? 'drop.fill'
                      : eventType === 'pest_treat'
                      ? 'pest'
                      : 'leaf.fill'
                  }
                  size={24}
                  color={textColor}
                />
                <ThemedText style={styles.actionButtonText}>
                  {systemType === 'reservoir' && eventType === 'fertilize' ? 'Care' : label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
});

export default function ScheduleScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const nav = useNavigation();
  const { rebuild, loading: rebuilding, doneCount, total, uniquePlantsCount, completedPlantsCount, currentPhase } =
    useRebuildAllWaterSchedules();
  const { updateOne: updateWaterSchedule } = useUpdateWaterSchedule();
  const { updateOne: updateFertilizeSchedule } = useUpdateFertilizeSchedule();

  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const defaultDelaysRef = useRef<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rebuildModalVisible, setRebuildModalVisible] = useState(false);
  const [openLocations, setOpenLocations] = useState<Record<string, boolean>>(
    {}
  );
  const [openFutureSections, setOpenFutureSections] = useState<Record<string, boolean>>(
    {} // Closed by default
  );
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [delayModal, setDelayModal] = useState<DelayModalState>({
    visible: false,
    schedules: [],
    selectedEventTypes: new Set<string>(),
    mode: 'single',
    targetUserPlantIds: [],
  });
  const [delayDays, setDelayDays] = useState(1);
  const [waterModalOpen, setWaterModalOpen] = useState(false);
  const [fertilizeModalOpen, setFertilizeModalOpen] = useState(false);
  const [careModalOpen, setCareModalOpen] = useState(false);
  const [fertilizeModalIsWatering, setFertilizeModalIsWatering] = useState(false);
  const [selectedUserPlantIds, setSelectedUserPlantIds] = useState<string[]>([]);
  const [selectedEventType, setSelectedEventType] = useState<
    'water' | 'fertilize' | ''
  >('');
  const [delayingSchedule, setDelayingSchedule] = useState(false);

  // userPlantId -> signed URL (or '' when no photo). undefined = not requested (offscreen)
  const [imageCache, setImageCache] = useState<Record<string, string>>({});
  // photoIdOrPath -> signed URL
  const signedUrlCacheRef = useRef<Record<string, string>>({});
  // userPlantId -> photoId/path (null means "explicitly no photo"; undefined means "not resolved yet")
  const photoKeyByUserPlantRef = useRef<
    Record<string, string | null | undefined>
  >({});
  // only start loading images when meta is ready
  const metaReadyRef = useRef(false);

  const currentUserId = useRef<string | undefined>(undefined);
  const hasRebuildRun = useRef(false);


  /* Single definitions */
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const tomorrow = useMemo(() => {
    const n = new Date(today);
    n.setDate(n.getDate() + 1);
    return n;
  }, [today]);

  const dayAfterTomorrow = useMemo(() => {
    const n = new Date(today);
    n.setDate(n.getDate() + 2);
    return n;
  }, [today]);

  // ────────────────────────────────────────────────────────────────────────────
  // Data fetch (no images here)
  // ────────────────────────────────────────────────────────────────────────────
  const fetchSchedules = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      metaReadyRef.current = false;
  
      // 0) Get all user_plant ids for the user (ground truth of "your plants")
      // Exclude deceased plants
      const { data: upRows, count: upCount, error: upErr } = await supabase
        .from('user_plants')
        .select('id', { count: 'exact' })
        .eq('owner_id', user.id)
        .is('deceased_at', null) // Exclude deceased plants
        .order('created_at', { ascending: true })
        .range(0, 9999);
  
      if (upErr) throw upErr;
      const userPlantIds = (upRows ?? []).map(r => r.id);
      logDebug('user_plants:', { upCount, resolved: userPlantIds.length });
  
      // 1A) Original approach: filter by schedules.owner_id
      const q1 = supabase
        .from('user_plant_schedules')
        .select(`
          id,
          user_plant_id,
          event_type,
          next_run_at,
          user_plants!inner (
            id,
            nickname,
            default_plant_photo_id,
            plants_table_id,
            system_type,
            lineage,
            light_type,
            water_delay,
            deceased_at,
            plants:plants_table_id ( plant_name ),
            location:location_id ( id, name )
          )
        `, { count: 'exact' })
        .eq('owner_id', user.id)
        .order('next_run_at', { ascending: true })
        .range(0, 9999);
  
      // 1B) Join-based filter: filter by user_plants.owner_id
      const q2 = supabase
        .from('user_plant_schedules')
        .select(`
          id,
          user_plant_id,
          event_type,
          next_run_at,
          user_plants!inner (
            id,
            nickname,
            default_plant_photo_id,
            plants_table_id,
            system_type,
            lineage,
            light_type,
            water_delay,
            deceased_at,
            plants:plants_table_id ( plant_name ),
            location:location_id ( id, name )
          )
        `, { count: 'exact' })
        .eq('user_plants.owner_id', user.id) // <— key difference
        .is('user_plants.deceased_at', null) // Exclude deceased plants
        .order('next_run_at', { ascending: true })
        .range(0, 9999);
  
      // 1C) ID-based filter: schedules where user_plant_id IN (your plants)
      // Note: userPlantIds already excludes deceased plants from the initial query
      const q3 = userPlantIds.length
        ? supabase
            .from('user_plant_schedules')
            .select(`
              id,
              user_plant_id,
              event_type,
              next_run_at,
              user_plants!inner (
                id,
                nickname,
                default_plant_photo_id,
                plants_table_id,
                plants:plants_table_id ( plant_name ),
                location:location_id ( id, name )
              )
            `, { count: 'exact' })
            .in('user_plant_id', userPlantIds)
            .order('next_run_at', { ascending: true })
            .range(0, 9999)
        : null;
  
      const [r1, r2, r3] = await Promise.all([q1, q2, q3 ?? Promise.resolve({ data: null, count: 0, error: null })] as const);
  
      const { data: rowsOwner, count: cntOwner, error: errOwner } = r1;
      const { data: rowsJoin,  count: cntJoin,  error: errJoin  } = r2;
      const { data: rowsIn,    count: cntIn,    error: errIn    } = r3 as any;
  
      if (errOwner || errJoin || errIn) {
        logDebug('errors', { errOwner, errJoin, errIn });
        throw (errOwner || errJoin || errIn)!;
      }
  
      // Choose which dataset drives the UI (for now use the JOIN filter; flip if needed)
      // Filter out any schedules for deceased plants (post-filter in case Supabase join filter doesn't work)
      const rows = (rowsJoin ?? []).filter((row: any) => {
        // If user_plants is an array (Supabase sometimes returns arrays for joins), check first element
        const userPlant = Array.isArray(row.user_plants) ? row.user_plants[0] : row.user_plants;
        return userPlant?.deceased_at === null || userPlant?.deceased_at === undefined;
      }) as any as ScheduleQueryRow[];
  
      // ——— Deep debug metrics ———
      const summarize = (label: string, arr: ScheduleQueryRow[] | null | undefined) => {
        const list = (arr ?? []) as ScheduleQueryRow[];
        const n = list.length;
  
        const byType: Record<string, number> = {};
        let nullDates = 0;
        let minDate: string | null = null;
        let maxDate: string | null = null;
  
        for (const r of list) {
          byType[r.event_type] = (byType[r.event_type] ?? 0) + 1;
          if (!r.next_run_at) nullDates++;
          else {
            if (!minDate || r.next_run_at < minDate) minDate = r.next_run_at;
            if (!maxDate || r.next_run_at > maxDate) maxDate = r.next_run_at;
          }
        }
  
        const upids = new Set(list.map(r => r.user_plant_id));
        const missingFromUP = userPlantIds.filter(id => !upids.has(id));
        // show at most a few
        const sampleMissing = missingFromUP.slice(0, 10);
  
        logDebug(`${label} summary`, {
          count: n,
          countHeader: (label === 'OWNER') ? cntOwner : (label === 'JOIN') ? cntJoin : cntIn,
          byType,
          nullDates,
          minDate,
          maxDate,
          distinctUserPlants: upids.size,
          sampleMissingUserPlantIds: sampleMissing,
        });
      };
  
      summarize('OWNER', rowsOwner as any);
      summarize('JOIN',  rowsJoin  as any);
      summarize('IN',    rowsIn    as any);
  
      // Map rows -> UI items, filtering out water schedules for reservoir plants
      const mapped: ScheduleItem[] = rows
        .filter((row) => {
          // Filter out water schedules for reservoir plants
          const systemType = row.user_plants?.system_type;
          if (systemType === 'reservoir' && row.event_type === 'water') {
            return false;
          }
          return true;
        })
        .map((row) => ({
          id: row.id,
          userPlantId: row.user_plants?.id ?? row.user_plant_id,
          eventType: row.event_type,
          nextRunAt: row.next_run_at,
          plantNickname: row.user_plants?.nickname || '',
          plantName: row.user_plants?.plants?.plant_name || 'Unknown Plant',
          locationId: row.user_plants?.location?.id ?? null,
          locationName: row.user_plants?.location?.name?.trim() || 'No Location',
          lineage: row.user_plants?.lineage || null,
          lightType: row.user_plants?.light_type || null,
          systemType: row.user_plants?.system_type || null,
          waterDelay: row.user_plants?.water_delay ?? null,
          plantsTableId: row.user_plants?.plants_table_id ?? null,
        }));
  
      // Build photo lookup cache meta and system_type lookup
      const pk: Record<string, string | null> = {};
      const systemTypeMap: Record<string, string | null> = {};
      for (const row of rows) {
        const upid = row.user_plants?.id ?? row.user_plant_id;
        pk[upid] = row.user_plants?.default_plant_photo_id ?? null;
        systemTypeMap[upid] = row.user_plants?.system_type ?? null;
      }
      photoKeyByUserPlantRef.current = pk;
      // Store system_type map for use in combined schedules
      (photoKeyByUserPlantRef as any).systemTypeMap = systemTypeMap;
      metaReadyRef.current = true;

      // Extra log: final UI list
      logDebug('UI mapped schedules', { count: mapped.length });

      // Fetch default delays for plants that don't have custom water_delay
      const plantsNeedingDefaults = new Set<string>();
      const plantsTableIdMap: Record<string, string> = {};
      for (const item of mapped) {
        if (item.waterDelay === null && item.plantsTableId) {
          plantsNeedingDefaults.add(item.plantsTableId);
          plantsTableIdMap[item.userPlantId] = item.plantsTableId;
        }
      }
      
      // Fetch default delays in batch
      const defaultDelaysMap: Record<string, number | null> = {};
      if (plantsNeedingDefaults.size > 0) {
        const { data: plantsData } = await supabase
          .from('plants')
          .select('id, water_interval_days_active, water_interval_days_inactive, schedule_same_year_round, active_season_start_date, active_season_end_date')
          .in('id', Array.from(plantsNeedingDefaults));
        
        if (plantsData) {
          const now = new Date();
          for (const plant of plantsData) {
            let delay: number | null = null;
            if (plant.schedule_same_year_round) {
              delay = plant.water_interval_days_active;
            } else {
              const startDate = plant.active_season_start_date ? new Date(plant.active_season_start_date) : null;
              const endDate = plant.active_season_end_date ? new Date(plant.active_season_end_date) : null;
              
              if (startDate && endDate) {
                const isActive = 
                  (startDate <= endDate && now >= startDate && now <= endDate) ||
                  (startDate > endDate && (now >= startDate || now <= endDate));
                delay = isActive ? plant.water_interval_days_active : plant.water_interval_days_inactive;
              } else {
                delay = plant.water_interval_days_active;
              }
            }
            defaultDelaysMap[plant.id] = delay;
          }
        }
      }
      
      // Store in ref for use in useMemo
      defaultDelaysRef.current = defaultDelaysMap;
      (defaultDelaysRef as any).plantsTableIdMap = plantsTableIdMap;

      setSchedules(mapped);
    } catch (err) {
      console.error('Failed to fetch schedules:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);
  

  // ────────────────────────────────────────────────────────────────────────────
  // Lazy image loader - load all images after render
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!metaReadyRef.current || schedules.length === 0) return;

    const loadAllImages = async () => {
      const needMetaLookup: string[] = [];
      const signTargets: PhotoMeta[] = [];
      const immediateUpdates: Record<string, string> = {};

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      for (const schedule of schedules) {
        const upid = schedule.userPlantId;
        if (imageCache[upid] !== undefined) continue;

        const key = photoKeyByUserPlantRef.current[upid];
        if (key === null) {
          immediateUpdates[upid] = '';
          continue;
        }
        if (key === undefined) continue;

        const cached = signedUrlCacheRef.current[key];
        if (cached !== undefined) {
          immediateUpdates[upid] = cached;
          continue;
        }

        needMetaLookup.push(upid);
      }

      if (Object.keys(immediateUpdates).length > 0) {
        setImageCache((prev) => ({ ...prev, ...immediateUpdates }));
      }

      if (needMetaLookup.length === 0) return;

      const uuidIds: string[] = [];
      const legacyPaths: PhotoMeta[] = [];

      for (const upid of needMetaLookup) {
        const key = photoKeyByUserPlantRef.current[upid]!;
        if (uuidRegex.test(key)) uuidIds.push(key);
        else legacyPaths.push({ key, bucket: 'plant-photos', path: key, userPlantId: upid });
      }

      if (uuidIds.length > 0) {
        const { data: photoRows, error } = await supabase
          .from('user_plant_photos')
          .select('id, bucket, object_path')
          .in('id', uuidIds);

        if (!error && photoRows) {
          const byId: Record<string, { bucket: string; object_path: string }> = {};
          for (const r of photoRows) {
            byId[r.id] = { bucket: r.bucket || 'plant-photos', object_path: r.object_path };
          }
          for (const upid of needMetaLookup) {
            const key = photoKeyByUserPlantRef.current[upid]!;
            const meta = byId[key];
            if (meta?.object_path) {
              signTargets.push({ key, bucket: meta.bucket, path: meta.object_path, userPlantId: upid });
            } else {
              signedUrlCacheRef.current[key] = '';
              immediateUpdates[upid] = '';
            }
          }
        }
      }

      signTargets.push(...legacyPaths);

      if (Object.keys(immediateUpdates).length > 0) {
        setImageCache((prev) => ({ ...prev, ...immediateUpdates }));
      }

      if (signTargets.length === 0) return;

      const batchedUpdates: Record<string, string> = {};
      try {
        const byBucket = new Map<string, PhotoMeta[]>();
        signTargets.forEach((pm) => {
          const group = byBucket.get(pm.bucket) ?? [];
          group.push(pm);
          byBucket.set(pm.bucket, group);
        });

        for (const [bucket, items] of byBucket) {
          const storageAny = supabase.storage.from(bucket) as any;
          if (typeof storageAny.createSignedUrls === 'function') {
            const { data: signedList, error: batchErr } = await storageAny.createSignedUrls(
              items.map((i: PhotoMeta) => i.path),
              3600
            );

            if (!batchErr && Array.isArray(signedList) && signedList.length === items.length) {
              signedList.forEach((entry: any, idx: number) => {
                const pm = items[idx];
                const url: string | undefined = entry?.signedUrl || undefined;
                if (url) {
                  signedUrlCacheRef.current[pm.key] = url;
                  batchedUpdates[pm.userPlantId] = url;
                }
              });
              continue;
            }
          }

          for (const pm of items) {
            try {
              const { data: signed, error: perErr } = await supabase.storage
                .from(bucket)
                .createSignedUrl(pm.path, 3600);
              const url = signed?.signedUrl;
              if (!perErr && url) {
                signedUrlCacheRef.current[pm.key] = url;
                batchedUpdates[pm.userPlantId] = url;
              }
            } catch {}
          }
        }
      } catch {}

      if (Object.keys(batchedUpdates).length > 0) {
        setImageCache((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const [k, v] of Object.entries(batchedUpdates)) {
            if (next[k] !== v) {
              next[k] = v;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    };

    loadAllImages();
  }, [metaReadyRef.current, schedules, imageCache]);

  // TESTING FLAG: Set to true to force rebuild on every screen focus (matches FORCE_REBUILD_ALL in useRebuildAllWaterSchedules)
  const FORCE_REBUILD_ON_FOCUS = false;

  // Rebuild once per user session, then fetch
  useEffect(() => {
    if (currentUserId.current !== user?.id) {
      hasRebuildRun.current = false;
      currentUserId.current = user?.id;
      setImageCache({});
      signedUrlCacheRef.current = {};
      photoKeyByUserPlantRef.current = {};
      metaReadyRef.current = false;
    }
    // If FORCE_REBUILD_ON_FOCUS is enabled, always reset the flag to allow rebuild
    if (FORCE_REBUILD_ON_FOCUS) {
      hasRebuildRun.current = false;
    }
    if (hasRebuildRun.current || !user?.id) return;

    hasRebuildRun.current = true;
    (async () => {
      setRebuildModalVisible(true);
      try {
        await rebuild();
        await fetchSchedules();
      } catch (err) {
        console.error('Rebuild failed:', err);
        await fetchSchedules();
      } finally {
        setRebuildModalVisible(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Check for plant updates when screen comes into focus and rebuild if needed
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) {
        // Clear selection when screen loses focus
        return () => {
          setSelectedCardIds({});
        };
      }

      // If FORCE_REBUILD_ON_FOCUS is enabled, always trigger rebuild
      if (FORCE_REBUILD_ON_FOCUS) {
        (async () => {
          hasRebuildRun.current = false; // Reset flag to allow rebuild
          setRebuildModalVisible(true);
          try {
            // eslint-disable-next-line no-console
            console.log('[ScheduleScreen] FORCE_REBUILD_ON_FOCUS enabled - triggering rebuild');
            await rebuild();
            await fetchSchedules();
          } catch (err) {
            console.error('Rebuild failed:', err);
            await fetchSchedules();
          } finally {
            setRebuildModalVisible(false);
          }
        })();
        return () => {
          setSelectedCardIds({});
        };
      }

      // Normal mode: Only rebuild if it has run before (on subsequent focuses)
      if (!hasRebuildRun.current) {
        // Clear selection when screen loses focus
        return () => {
          setSelectedCardIds({});
        };
      }

      (async () => {
        try {
          const { fetchUserPlantIdsNeedingRebuild } = await import('@/services/supabaseSchedules');
          const [waterNeedRebuild, fertNeedRebuild] = await Promise.all([
            fetchUserPlantIdsNeedingRebuild('water'),
            fetchUserPlantIdsNeedingRebuild('fertilize'),
          ]);

          if (waterNeedRebuild.length > 0 || fertNeedRebuild.length > 0) {
            // Plants have been updated, rebuild schedules
            hasRebuildRun.current = false; // Reset flag to allow rebuild
            setRebuildModalVisible(true);
            try {
              await rebuild();
              await fetchSchedules();
            } catch (err) {
              console.error('Rebuild failed:', err);
              await fetchSchedules();
            } finally {
              setRebuildModalVisible(false);
            }
          } else {
            // Just refresh the schedule list in case something changed
            await fetchSchedules();
          }
        } catch (err) {
          console.error('Error checking for plant updates:', err);
          // Still refresh schedules even if check failed
          await fetchSchedules();
        }
      })();

      // Clear selection when screen loses focus
      return () => {
        setSelectedCardIds({});
      };
    }, [user?.id, rebuild, fetchSchedules])
  );

  const onRefresh = useCallback(async () => {
    if (!user?.id) {
      setRefreshing(false);
      return;
    }

    setRefreshing(true);
    // Full reset so we re-sign everything on purpose
    setImageCache({});
    signedUrlCacheRef.current = {}; // clear cached failures too
    photoKeyByUserPlantRef.current = {};
    metaReadyRef.current = false;

    try {
      // Check if rebuild is needed (only check for timeline changes, not overdue items)
      // Overdue items are handled by the normal rebuild process, not on every refresh
      const { fetchUserPlantIdsNeedingRebuild, fetchUserPlantIdsNeedingPestScheduleUpdate } = await import('@/services/supabaseSchedules');
      const [
        waterNeedRebuild,
        fertNeedRebuild,
        pestNeedUpdate,
      ] = await Promise.all([
        fetchUserPlantIdsNeedingRebuild('water'),
        fetchUserPlantIdsNeedingRebuild('fertilize'),
        fetchUserPlantIdsNeedingPestScheduleUpdate(),
      ]);

      const needsRebuild = 
        waterNeedRebuild.length > 0 ||
        fertNeedRebuild.length > 0 ||
        pestNeedUpdate.length > 0;

      if (needsRebuild) {
        // Show rebuild modal and rebuild (skip overdue items during refresh)
        // Only rebuild plants with actual timeline changes
        setRebuildModalVisible(true);
        try {
          await rebuild(true); // Pass true to skip overdue items
        } catch (err) {
          console.error('Rebuild failed during refresh:', err);
        } finally {
          setRebuildModalVisible(false);
        }
      }

      // Always fetch schedules after rebuild check/rebuild
      await fetchSchedules();
    } catch (err) {
      console.error('Error during refresh:', err);
      // Still try to fetch schedules even if rebuild check failed
      await fetchSchedules();
    } finally {
      setRefreshing(false);
    }
  }, [user?.id, rebuild, fetchSchedules]);

  const toggleLocation = useCallback((section: string) => {
    setOpenLocations((prev) => ({
      ...prev,
      [section]: !(prev[section] ?? false),
    }));
  }, []);

  const toggleFutureSection = useCallback((sectionId: string) => {
    setOpenFutureSections((prev) => ({
      ...prev,
      [sectionId]: !(prev[sectionId] ?? false),
    }));
  }, []);

  const toggleCard = useCallback((cardId: string) => {
    setExpandedCardId((prev) => (prev === cardId ? null : cardId));
  }, []);

  const [selectedCardIds, setSelectedCardIds] = useState<Record<string, boolean>>(
    {}
  );

  const selectedCardIdList = useMemo(
    () => Object.keys(selectedCardIds),
    [selectedCardIds]
  );

  const selectionMode = selectedCardIdList.length > 0;
  const selectionCount = selectedCardIdList.length;

  const toggleSelectionForCard = useCallback((cardId: string) => {
    setSelectedCardIds((prev) => {
      const next = { ...prev };
      if (next[cardId]) {
        delete next[cardId];
      } else {
        next[cardId] = true;
      }
      return next;
    });
  }, []);

  const handleCardPress = useCallback(
    (cardId: string) => {
      if (selectionMode) {
        toggleSelectionForCard(cardId);
        return;
      }
      toggleCard(cardId);
    },
    [selectionMode, toggleCard, toggleSelectionForCard]
  );

  const handleCardLongPress = useCallback(
    (cardId: string) => {
      toggleSelectionForCard(cardId);
      setExpandedCardId((prev) => (prev === cardId ? null : prev));
    },
    [toggleSelectionForCard]
  );

  const clearSelection = useCallback(() => {
    setSelectedCardIds({});
  }, []);

  const handleInfoPress = useCallback((userPlantId: string) => {
    (nav as any).navigate('PlantDetail', { id: userPlantId });
  }, [nav]);

  const openDelayModal = useCallback(
    ({
      schedulesToDelay,
      defaultSchedule,
      targetUserPlantIds,
      mode,
    }: {
      schedulesToDelay: ScheduleItem[];
      defaultSchedule?: ScheduleItem | null;
      targetUserPlantIds: string[];
      mode: 'single' | 'multi';
    }) => {
      if (!schedulesToDelay.length) return;

      const initialSchedule = defaultSchedule ?? schedulesToDelay[0] ?? null;
      setDelayDays(1); // Reset to default
      setDelayModal({
        visible: true,
        schedules: schedulesToDelay,
        selectedEventTypes: new Set<string>([
          initialSchedule?.eventType ?? schedulesToDelay[0]?.eventType ?? 'water',
        ]),
        mode,
        targetUserPlantIds,
      });
    },
    []
  );

  const handleDelayPressPlant = useCallback(
    (combined: CombinedSchedule) => {
      const scheduleList = Object.values(combined.schedules);
      if (scheduleList.length === 0) return;

      const sortedList = [...scheduleList].sort(
        (a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime()
      );

      openDelayModal({
        schedulesToDelay: sortedList,
        defaultSchedule: sortedList[0],
        targetUserPlantIds: [combined.userPlantId],
        mode: 'single',
      });
    },
    [openDelayModal]
  );

  const handleBulkDelay = useCallback(() => {
    if (!selectedCardIdList.length) return;
    const targetSet = new Set(selectedCardIdList);
    const schedulesToDelay = schedules.filter((schedule) =>
      targetSet.has(schedule.userPlantId)
    );
    if (!schedulesToDelay.length) return;

    openDelayModal({
      schedulesToDelay,
      defaultSchedule: schedulesToDelay[0],
      targetUserPlantIds: selectedCardIdList,
      mode: 'multi',
    });
  }, [selectedCardIdList, schedules, openDelayModal]);

  const handleBulkWater = useCallback(() => {
    if (!selectedCardIdList.length) return;
    setSelectedUserPlantIds(selectedCardIdList);
    setSelectedEventType('water');
    setWaterModalOpen(true);
  }, [selectedCardIdList]);

  const handleBulkFertilize = useCallback(() => {
    if (!selectedCardIdList.length) return;
    setSelectedUserPlantIds(selectedCardIdList);
    setSelectedEventType('fertilize');
    setFertilizeModalOpen(true);
  }, [selectedCardIdList]);

  const closeDelayModal = useCallback(() => {
    setDelayModal({
      visible: false,
      schedules: [],
      selectedEventTypes: new Set<string>(),
      mode: 'single',
      targetUserPlantIds: [],
    });
  }, []);

  const toggleDelayEventType = useCallback((eventType: string) => {
    setDelayModal((prev) => {
      const next = new Set(prev.selectedEventTypes);
      if (next.has(eventType)) {
        next.delete(eventType);
      } else {
        next.add(eventType);
      }
      if (next.size === 0) {
        next.add(eventType);
      }
      return { ...prev, selectedEventTypes: next };
    });
  }, []);

  const incrementDelayDays = useCallback(() => {
    setDelayDays((prev) => Math.min(prev + 1, 30));
  }, []);

  const decrementDelayDays = useCallback(() => {
    setDelayDays((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleCompletePress = useCallback((schedule: ScheduleItem, isWatering?: boolean, systemType?: 'normal' | 'reservoir' | null) => {
    // For reservoir plants with fertilize events, use CareModal instead
    if (schedule.eventType === 'fertilize' && systemType === 'reservoir') {
      setSelectedUserPlantIds([schedule.userPlantId]);
      setCareModalOpen(true);
      setExpandedCardId(null);
      return;
    }

    setSelectedUserPlantIds([schedule.userPlantId]);
    setSelectedEventType(schedule.eventType as 'water' | 'fertilize');
    if (schedule.eventType === 'water') {
      setWaterModalOpen(true);
    } else if (schedule.eventType === 'fertilize') {
      setFertilizeModalIsWatering(isWatering ?? false);
      setFertilizeModalOpen(true);
    }
    setExpandedCardId(null); // Close the expanded card
  }, []);

  const handleModalSaved = useCallback(async () => {
    if (selectedUserPlantIds.length === 0 || !selectedEventType) {
      await fetchSchedules();
      return;
    }

    try {
      if (selectedEventType === 'water') {
        await Promise.all(
          selectedUserPlantIds.map((id) => updateWaterSchedule(id))
        );
      } else if (selectedEventType === 'fertilize') {
        await Promise.all(
          selectedUserPlantIds.map((id) => updateFertilizeSchedule(id))
        );
      }
    } catch (err) {
      console.error('Failed to update schedule:', err);
    } finally {
      await fetchSchedules();
      setSelectedUserPlantIds([]);
      setSelectedEventType('');
      clearSelection();
    }
  }, [
    selectedUserPlantIds,
    selectedEventType,
    updateWaterSchedule,
    updateFertilizeSchedule,
    fetchSchedules,
    clearSelection,
  ]);

  const selectedDelaySchedules = useMemo(() => {
    if (delayModal.selectedEventTypes.size === 0) return [];
    const targetSet =
      delayModal.targetUserPlantIds.length > 0
        ? new Set(delayModal.targetUserPlantIds)
        : null;
    return delayModal.schedules.filter((schedule) => {
      if (!delayModal.selectedEventTypes.has(schedule.eventType)) return false;
      if (targetSet && !targetSet.has(schedule.userPlantId)) return false;
      return true;
    });
  }, [delayModal]);

  const primaryDelaySchedule = selectedDelaySchedules[0] ?? null;
  const selectedDelayPlantCount = useMemo(() => {
    const set = new Set(selectedDelaySchedules.map((s) => s.userPlantId));
    return set.size;
  }, [selectedDelaySchedules]);

  const delayEventOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const schedule of delayModal.schedules) {
      if (!seen.has(schedule.eventType)) {
        seen.add(schedule.eventType);
        options.push(schedule.eventType);
      }
    }
    return options;
  }, [delayModal.schedules]);

  const delayEventLabels = useMemo(
    () =>
      Array.from(delayModal.selectedEventTypes).map((eventType) =>
        eventType === 'water'
          ? 'watering'
          : eventType === 'fertilize'
          ? 'fertilizing'
          : eventType
      ),
    [delayModal.selectedEventTypes]
  );

  const delayActionLabel = useMemo(() => {
    if (delayEventLabels.length === 0) return 'selected care';
    if (delayEventLabels.length === 1) return delayEventLabels[0];
    if (delayEventLabels.length === 2)
      return `${delayEventLabels[0]} & ${delayEventLabels[1]}`;
    const last = delayEventLabels[delayEventLabels.length - 1];
    const rest = delayEventLabels.slice(0, -1).join(', ');
    return `${rest}, & ${last}`;
  }, [delayEventLabels]);

  const delayTargetLabel = useMemo(() => {
    if (selectedDelaySchedules.length === 0) return 'selected plants';
    if (delayModal.mode === 'multi' && selectedDelayPlantCount > 1) {
      return `${selectedDelayPlantCount} plants`;
    }
    return (
      primaryDelaySchedule?.plantNickname ||
      primaryDelaySchedule?.plantName ||
      'this plant'
    );
  }, [
    selectedDelaySchedules.length,
    delayModal.mode,
    selectedDelayPlantCount,
    primaryDelaySchedule?.plantNickname,
    primaryDelaySchedule?.plantName,
  ]);

  const handleConfirmDelay = useCallback(async () => {
    if (delayModal.selectedEventTypes.size === 0) return;
    let targets: ScheduleItem[] = [];

    if (delayModal.mode === 'multi') {
      const targetSet = new Set(delayModal.targetUserPlantIds);
      targets = schedules.filter(
        (schedule) =>
          targetSet.has(schedule.userPlantId) &&
          delayModal.selectedEventTypes.has(schedule.eventType)
      );
    } else {
      targets = delayModal.schedules.filter((schedule) =>
        delayModal.selectedEventTypes.has(schedule.eventType)
      );
    }

    if (!targets.length) return;

    setDelayingSchedule(true);
    try {
      await Promise.all(
        targets.map((schedule) => delayScheduleByDays(schedule.id, delayDays))
      );
      closeDelayModal();
      await fetchSchedules();
      clearSelection();
    } catch (err) {
      console.error('Failed to delay schedule:', err);
    } finally {
      setDelayingSchedule(false);
    }
  }, [
    delayModal,
    schedules,
    delayDays,
    fetchSchedules,
    closeDelayModal,
    clearSelection,
  ]);

  /* Grouping by task type and time */
  const eventConfig = useMemo(
    () => [
      { type: 'water', label: 'Water' },
      { type: 'fertilize', label: 'Fertilize' },
      { type: 'pest_treat', label: 'Treat' },
    ],
    []
  );

  const isDueToday = useCallback(
    (dateString: string) => {
      const d = new Date(dateString);
      return d >= today && d < tomorrow;
    },
    [today, tomorrow]
  );

  const isDueTomorrow = useCallback(
    (dateString: string) => {
      const d = new Date(dateString);
      return d >= tomorrow && d < dayAfterTomorrow;
    },
    [tomorrow]
  );

  const getRelativeDueText = useCallback(
    (dateString: string) => {
      const dueDate = new Date(dateString);
      const dueMidnight = new Date(dueDate);
      dueMidnight.setHours(0, 0, 0, 0);
      const todayMidnight = new Date(today);
      const diffMs = dueMidnight.getTime() - todayMidnight.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Tomorrow';
      if (diffDays > 1) return `in ${diffDays} days`;
      if (diffDays === -1) return 'Yesterday';

      const abs = Math.abs(diffDays);
      const unit = abs === 1 ? 'day' : 'days';
      return `${abs} ${unit} ago`;
    },
    [today]
  );

  const compareCombinedSchedules = useCallback(
    (a: CombinedSchedule, b: CombinedSchedule) => {
      const dateDiff = a.earliestNextRunAt - b.earliestNextRunAt;
      if (dateDiff !== 0) return dateDiff;

      const nameA = (a.plantNickname || a.plantName || '').toLowerCase();
      const nameB = (b.plantNickname || b.plantName || '').toLowerCase();
      if (nameA && nameB) {
        const nameDiff = nameA.localeCompare(nameB);
        if (nameDiff !== 0) return nameDiff;
      }

      return 0;
    },
    []
  );

  /* Strict discriminated union */
  type Row =
    | {
        kind: 'section';
        id: string;
        label: string;
        todayCount: number;
        isOpen: boolean;
      }
    | {
        kind: 'future-section';
        id: string;
        locationId: string;
        isOpen: boolean;
      }
    | {
        kind: 'combined-item';
        id: string;
        combined: CombinedSchedule;
        eventSummaries: EventSummary[];
      }
    | { kind: 'empty'; id: string; message: string };

  const rows: Row[] = useMemo(() => {
    if (schedules.length === 0) {
      return [
        {
          kind: 'empty',
          id: 'no-schedules',
          message: 'No upcoming care tasks.',
        },
      ];
    }

    const buckets = new Map<
      string,
      {
        label: string;
        items: Map<string, CombinedSchedule>;
        todayCount: number;
      }
    >();

    for (const schedule of schedules) {
      const key = schedule.locationId ?? 'no-location';
      const bucket =
        buckets.get(key) ??
        (() => {
          const created = {
            label: schedule.locationName,
            items: new Map<string, CombinedSchedule>(),
            todayCount: 0,
          };
          buckets.set(key, created);
          return created;
        })();

      const plantId = schedule.userPlantId;
      const combined =
        bucket.items.get(plantId) ??
        (() => {
          const created: CombinedSchedule = {
            userPlantId: plantId,
            plantNickname: schedule.plantNickname,
            plantName: schedule.plantName,
            locationId: schedule.locationId,
            locationName: schedule.locationName,
            lineage: schedule.lineage,
            lightType: schedule.lightType,
            systemType: schedule.systemType,
            schedules: {},
            earliestNextRunAt: Number.POSITIVE_INFINITY,
            waterDelay: schedule.waterDelay ?? null,
            plantsTableId: schedule.plantsTableId ?? null,
            isDefaultDelay: schedule.waterDelay === null || schedule.waterDelay === undefined,
          };
          bucket.items.set(plantId, created);
          return created;
        })();

      combined.schedules[schedule.eventType] = schedule;
      const ts = new Date(schedule.nextRunAt).getTime();
      if (Number.isFinite(ts) && ts < combined.earliestNextRunAt) {
        combined.earliestNextRunAt = ts;
      }
    }

    // After processing all schedules, count today's events
    // For clustered events (water + fertilize on same day), count as 1
    for (const [key, bucket] of buckets.entries()) {
      for (const [plantId, combined] of bucket.items.entries()) {
        const waterSchedule = combined.schedules['water'];
        const fertSchedule = combined.schedules['fertilize'];
        const isReservoir = combined.systemType === 'reservoir';

        // Check if water and fertilize are on the same day (clustered)
        let isClustered = false;
        if (waterSchedule && fertSchedule && !isReservoir) {
          const waterDate = new Date(waterSchedule.nextRunAt);
          const fertDate = new Date(fertSchedule.nextRunAt);
          waterDate.setHours(0, 0, 0, 0);
          fertDate.setHours(0, 0, 0, 0);
          isClustered = waterDate.getTime() === fertDate.getTime();
        }

        if (isClustered && waterSchedule) {
          // Clustered event: count once if either is due today
          if (isDueToday(waterSchedule.nextRunAt)) {
            bucket.todayCount += 1;
          }
        } else {
          // Non-clustered: count each event separately
          if (waterSchedule && isDueToday(waterSchedule.nextRunAt)) {
            bucket.todayCount += 1;
          }
          if (fertSchedule && isDueToday(fertSchedule.nextRunAt)) {
            bucket.todayCount += 1;
          }
        }
      }
    }

    // Sort sections: ones with active tasks first (alphabetically), then ones without (alphabetically)
    const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => {
      const aHasActive = a[1].todayCount > 0;
      const bHasActive = b[1].todayCount > 0;
      
      // If one has active tasks and the other doesn't, prioritize the one with active tasks
      if (aHasActive && !bHasActive) return -1;
      if (!aHasActive && bHasActive) return 1;
      
      // Otherwise, sort alphabetically
      return a[1].label.localeCompare(b[1].label, undefined, { sensitivity: 'base' });
    });

    const out: Row[] = [];
    for (const [key, bucket] of sortedBuckets) {
      const isOpen = openLocations[key] ?? false;
      out.push({
        kind: 'section',
        id: key,
        label: bucket.label,
        todayCount: bucket.todayCount,
        isOpen,
      });

      if (!isOpen) continue;

      const combinedList = Array.from(bucket.items.values()).sort(
        compareCombinedSchedules
      );

      // Get default delays from ref (fetched in fetchSchedules)
      const defaultDelaysMap = defaultDelaysRef.current || {};
      const plantsTableIdMap = (defaultDelaysRef as any).plantsTableIdMap || {};

      // Separate plants into today and future
      const todayItems: Array<{ combined: CombinedSchedule; eventSummaries: EventSummary[] }> = [];
      const futureItems: Array<{ combined: CombinedSchedule; eventSummaries: EventSummary[] }> = [];

      combinedList.forEach((combined) => {
        // Get system_type for this plant to filter water schedules for reservoir plants
        const systemTypeMap = (photoKeyByUserPlantRef as any).systemTypeMap || {};
        const systemType = systemTypeMap[combined.userPlantId];
        
        // Set default delay if needed
        if (combined.waterDelay === null && combined.plantsTableId) {
          const defaultDelay = defaultDelaysMap[combined.plantsTableId];
          if (defaultDelay !== undefined) {
            combined.waterDelay = defaultDelay;
            combined.isDefaultDelay = true;
          }
        }
        
        // First, get all schedules and check if water and fertilize are on the same day
        const waterSchedule = combined.schedules['water'];
        const fertSchedule = combined.schedules['fertilize'];
        
        // Check if they're on the same day (for clustering)
        let areOnSameDay = false;
        if (waterSchedule && fertSchedule && systemType !== 'reservoir') {
          const waterDate = new Date(waterSchedule.nextRunAt);
          const fertDate = new Date(fertSchedule.nextRunAt);
          // Check if same day (ignoring time)
          waterDate.setHours(0, 0, 0, 0);
          fertDate.setHours(0, 0, 0, 0);
          areOnSameDay = waterDate.getTime() === fertDate.getTime();
        }

        // Check if the next watering will also be a fertilizing (for clustering rule 4)
        // This means: if water and fertilize are on the same day, and the next water after that
        // will also have fertilize on the same day, we can cluster
        let shouldCluster = false;
        if (areOnSameDay && waterSchedule && fertSchedule && systemType !== 'reservoir') {
          // For now, if they're on the same day, we cluster them
          // Rule 4: "only if the next watering will also be a fertilizing"
          // We'll cluster if they're on the same day - the user can adjust if needed
          shouldCluster = true;
        }

        const eventSummaries: EventSummary[] = eventConfig
          .filter(({ type }) => {
            // Filter out water schedules for reservoir plants
            if (type === 'water' && systemType === 'reservoir') {
              return false;
            }
            // If we're clustering, skip individual water/fertilize and add combined
            if (shouldCluster && (type === 'water' || type === 'fertilize')) {
              return false;
            }
            return true;
          })
          .map(({ type, label }) => {
          const schedule = combined.schedules[type];

          if (!schedule) {
            if (type === 'pest_treat') return null;
            return {
              eventType: type,
              label,
              dateText: 'No schedule',
              isToday: false,
              isTomorrow: false,
              backgroundColor: '#4B5563',
              textColor: '#F9FAFB',
              pillBackground: '#1F2937',
              pillBorderColor: '#4B5563',
              pillTextColor: '#F9FAFB',
              combinedText: `${label} unavailable`,
              schedule: null,
            };
          }

          const dueToday = isDueToday(schedule.nextRunAt);
          const dueTomorrow = isDueTomorrow(schedule.nextRunAt);
          const relativeText = getRelativeDueText(schedule.nextRunAt);

          const backgroundColor = dueToday
            ? '#047857'
            : dueTomorrow
            ? '#92400E'
            : '#374151';

          const textColor = '#F9FAFB';

          const pillBackground = dueToday
            ? 'rgba(6, 95, 70, 0.18)'
            : dueTomorrow
            ? 'rgba(180, 83, 9, 0.18)'
            : 'rgba(79, 70, 229, 0.12)';

          const pillBorderColor = dueToday
            ? '#047857'
            : dueTomorrow
            ? '#B45309'
            : '#4B5563';

          const pillTextColor = '#F9FAFB';

          const combinedText = `${label} ${relativeText}`;

          return {
            eventType: type,
            label,
            dateText: relativeText,
            isToday: dueToday,
            isTomorrow: dueTomorrow,
            backgroundColor,
            textColor,
            pillBackground,
            pillBorderColor,
            pillTextColor,
            combinedText,
            schedule,
          };
        })
        .filter((e): e is EventSummary => !!e);

        // If we should cluster, add a combined event
        if (shouldCluster && waterSchedule && fertSchedule) {
          const dueToday = isDueToday(waterSchedule.nextRunAt);
          const dueTomorrow = isDueTomorrow(waterSchedule.nextRunAt);
          const relativeText = getRelativeDueText(waterSchedule.nextRunAt);

          const backgroundColor = dueToday
            ? '#047857'
            : dueTomorrow
            ? '#92400E'
            : '#374151';

          const textColor = '#F9FAFB';

          const pillBackground = dueToday
            ? 'rgba(6, 95, 70, 0.18)'
            : dueTomorrow
            ? 'rgba(180, 83, 9, 0.18)'
            : 'rgba(79, 70, 229, 0.12)';

          const pillBorderColor = dueToday
            ? '#047857'
            : dueTomorrow
            ? '#B45309'
            : '#4B5563';

          const pillTextColor = '#F9FAFB';

          // Use the water schedule as the primary schedule for the combined event
          eventSummaries.unshift({
            eventType: 'water_fertilize',
            label: 'F & W', // Button label is shortened
            dateText: relativeText,
            isToday: dueToday,
            isTomorrow: dueTomorrow,
            backgroundColor,
            textColor,
            pillBackground,
            pillBorderColor,
            pillTextColor,
            combinedText: `Fertilize & Water ${relativeText}`, // Chip text is full
            schedule: waterSchedule, // Use water schedule as primary
          });
        }

        // Check if this plant has any items due today
        const hasItemsDueToday = eventSummaries.some(summary => summary.isToday);
        
        if (hasItemsDueToday) {
          todayItems.push({ combined, eventSummaries });
        } else {
          futureItems.push({ combined, eventSummaries });
        }
      });

      // Add today items first
      todayItems.forEach(({ combined, eventSummaries }) => {
        out.push({
          kind: 'combined-item',
          id: combined.userPlantId,
          combined,
          eventSummaries,
        });
      });

      // Add Future section only if there are BOTH today items AND future items
      // If there are only future items (no today items), show them directly without a Future section
      if (futureItems.length > 0) {
        if (todayItems.length > 0) {
          // Both today and future items exist - add Future section
          const futureSectionId = `${key}-future`;
          const isFutureOpen = openFutureSections[futureSectionId] ?? false;
          out.push({
            kind: 'future-section',
            id: futureSectionId,
            locationId: key,
            isOpen: isFutureOpen,
          });

          // Add future items if section is open
          if (isFutureOpen) {
            futureItems.forEach(({ combined, eventSummaries }) => {
              out.push({
                kind: 'combined-item',
                id: combined.userPlantId,
                combined,
                eventSummaries,
              });
            });
          }
        } else {
          // Only future items - show them directly without a Future section
          futureItems.forEach(({ combined, eventSummaries }) => {
            out.push({
              kind: 'combined-item',
              id: combined.userPlantId,
              combined,
              eventSummaries,
            });
          });
        }
      }
    }

    return out;
  }, [
    schedules,
    openLocations,
    openFutureSections,
    isDueToday,
    isDueTomorrow,
    compareCombinedSchedules,
    eventConfig,
    getRelativeDueText,
  ]);

  return (
    <>
      {selectionMode && (
        <View
          style={[
            styles.selectionToolbar,
            { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
          ]}
        >
          <View>
            <ThemedText style={styles.selectionToolbarText}>
              {selectionCount} selected
            </ThemedText>
            <Pressable onPress={clearSelection} hitSlop={12}>
              <ThemedText style={styles.selectionToolbarClear}>Clear</ThemedText>
            </Pressable>
          </View>
          <View style={styles.selectionToolbarActions}>
            <Pressable
              style={[
                styles.selectionToolbarButton,
              ]}
              onPress={handleBulkDelay}
            >
              <IconSymbol name="clock" size={20} color={theme.colors.text} />
              <ThemedText style={styles.selectionToolbarButtonLabel}>Delay</ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.selectionToolbarButton,
              ]}
              onPress={handleBulkWater}
            >
              <IconSymbol name="drop.fill" size={20} color={theme.colors.text} />
              <ThemedText style={styles.selectionToolbarButtonLabel}>Water</ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.selectionToolbarButton,
              ]}
              onPress={handleBulkFertilize}
            >
              <IconSymbol name="leaf.fill" size={20} color={theme.colors.text} />
              <ThemedText style={styles.selectionToolbarButtonLabel}>Fertilize</ThemedText>
            </Pressable>
          </View>
        </View>
      )}
      <ParallaxScrollView
        headerBackgroundColor={{ light: '#E5F4EF', dark: '#12231F' }}
        headerImage={
          <Image
            source={require('../../assets/images/plants-header.jpg')}
            contentFit="cover"
            transition={200}
            style={styles.headerImage}
          />
        }
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <View style={[styles.content, selectionMode && { paddingTop: 8 }]}>
            {rows.map((item) => {
              if (item.kind === 'section') {
                const hasUrgentItems = item.todayCount > 0;
                return (
                  <View key={item.id} style={styles.sectionWrapper}>
                    <Pressable
                      style={[
                        styles.sectionHeader,
                        { 
                          backgroundColor: theme.colors.card,
                          borderColor: hasUrgentItems ? '#10B981' : theme.colors.border,
                        }
                      ]}
                      onPress={() => toggleLocation(item.id)}
                      android_ripple={{ color: theme.colors.primary + '20' }}
                    >
                      <View style={styles.sectionHeaderContent}>
                        <View style={styles.sectionHeaderLeft}>
                          {/* Location icon with subtle background */}
                          <View style={[
                            styles.sectionIconContainer,
                            { backgroundColor: theme.colors.primary + '15' }
                          ]}>
                            <IconSymbol
                              name="location"
                              size={18}
                              color={hasUrgentItems ? '#10B981' : theme.colors.primary}
                            />
                          </View>
                          
                          {/* Section title with better typography */}
                          <View style={styles.sectionTitleContainer}>
                            <ThemedText style={[
                              styles.sectionTitle,
                              hasUrgentItems && styles.sectionTitleUrgent
                            ]}>
                              {item.label}
                            </ThemedText>
                            {item.todayCount > 0 && (
                              <View style={styles.urgentIndicator}>
                                <ThemedText style={styles.urgentIndicatorText}>
                                  {item.todayCount} {item.todayCount === 1 ? 'task' : 'tasks'} due today
                                </ThemedText>
                              </View>
                            )}
                          </View>
                        </View>
                        
                        {/* Enhanced chevron with better visual feedback */}
                        <View style={[
                          styles.sectionChevronContainer,
                          item.isOpen && styles.sectionChevronContainerOpen
                        ]}>
                          <IconSymbol
                            name={item.isOpen ? 'chevron.up' : 'chevron.down'}
                            size={18}
                            color={hasUrgentItems ? '#10B981' : theme.colors.mutedText}
                          />
                        </View>
                      </View>
                    </Pressable>
                    
                    {/* Subtle divider line when open */}
                    {item.isOpen && (
                      <View style={[styles.sectionDivider, { backgroundColor: theme.colors.border }]} />
                    )}
                  </View>
                );
              }

              if (item.kind === 'empty') {
                return (
                  <ThemedText key={item.id} style={styles.emptyText}>
                    {item.message}
                  </ThemedText>
                );
              }

              if (item.kind === 'future-section') {
                return (
                  <Pressable
                    key={item.id}
                    style={styles.futureSectionHeader}
                    onPress={() => toggleFutureSection(item.id)}
                  >
                    <ThemedText style={styles.futureSectionHeaderText}>Future</ThemedText>
                    <IconSymbol
                      name={item.isOpen ? 'chevron.up' : 'chevron.right'}
                      size={16}
                      color={theme.colors.mutedText}
                    />
                  </Pressable>
                );
              }

              if (item.kind === 'combined-item') {
                const combined = item.combined;
                const cardId = combined.userPlantId;
                const isSelected = !!selectedCardIds[cardId];

                return (
                  <CombinedScheduleCard
                    key={item.id}
                    plantNickname={combined.plantNickname}
                    plantName={combined.plantName}
                    imageUrl={imageCache[combined.userPlantId]}
                    cardColor={theme.colors.card}
                    borderColor={theme.colors.border as string}
                    textColor={theme.colors.text}
                    isExpanded={expandedCardId === cardId}
                    combined={combined}
                    isSelected={isSelected}
                    onPress={() => handleCardPress(cardId)}
                    onLongPress={() => handleCardLongPress(cardId)}
                    onInfoPress={() => handleInfoPress(combined.userPlantId)}
                    onDelayPressPlant={() => handleDelayPressPlant(combined)}
                    eventSummaries={item.eventSummaries}
                    onCarePress={handleCompletePress}
                    lineage={combined.lineage}
                    lightType={combined.lightType}
                    systemType={combined.systemType}
                  />
                );
              }

              return null;
            })}
          </View>
        )}
      </ParallaxScrollView>

      <Modal visible={rebuildModalVisible || rebuilding} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
            ]}
          >
            <ActivityIndicator color={theme.colors.text as any} size="large" />
            <ThemedText style={styles.modalTitle}>Rebuilding Schedules</ThemedText>
            {currentPhase ? (
              <ThemedText style={styles.modalSubtitle}>
                {currentPhase}
              </ThemedText>
            ) : (
              <ThemedText style={styles.modalSubtitle}>
                Processing schedules...
              </ThemedText>
            )}
            {uniquePlantsCount > 0 && (
              <ThemedText style={[styles.modalSubtitle, { fontSize: 12, opacity: 0.6, marginTop: 8 }]}>
                {uniquePlantsCount} {uniquePlantsCount === 1 ? 'plant' : 'plants'} total
              </ThemedText>
            )}
          </View>
        </View>
      </Modal>

      {/* Delay Modal */}
      <Modal visible={delayModal.visible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.delayModalCard,
              { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
            ]}
          >
            {delayEventOptions.length > 0 && (
              <View style={styles.delayEventSwitcher}>
                {delayEventOptions.map((eventType) => {
                  const isSelected =
                    delayModal.selectedEventTypes?.has(eventType) ?? false;
                  const optionLabel =
                    eventType === 'water'
                      ? 'Water'
                      : eventType === 'fertilize'
                      ? 'Fertilize'
                      : eventType;
                  return (
                    <Pressable
                      key={eventType}
                      style={[
                        styles.delayEventOption,
                        isSelected && styles.delayEventOptionActive,
                        { borderColor: theme.colors.border },
                      ]}
                      onPress={() => toggleDelayEventType(eventType)}
                    >
                      <ThemedText
                        style={[
                          styles.delayEventOptionText,
                          isSelected && styles.delayEventOptionTextActive,
                        ]}
                      >
                        {optionLabel}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <ThemedText style={styles.modalTitle}>
              Delay{' '}
              {delayActionLabel} for{'\n'}
              {delayTargetLabel}?
            </ThemedText>
            
            {/* Number Picker */}
            <View style={styles.numberPickerContainer}>
              <Pressable
                style={[styles.pickerButton, { borderColor: theme.colors.border }]}
                onPress={decrementDelayDays}
              >
                <ThemedText style={styles.pickerButtonText}>−</ThemedText>
              </Pressable>
              
              <View style={styles.pickerValue}>
                <ThemedText style={styles.pickerNumber}>{delayDays}</ThemedText>
                <ThemedText style={styles.pickerLabel}>{delayDays === 1 ? 'day' : 'days'}</ThemedText>
              </View>
              
              <Pressable
                style={[styles.pickerButton, { borderColor: theme.colors.border }]}
                onPress={incrementDelayDays}
              >
                <ThemedText style={styles.pickerButtonText}>+</ThemedText>
              </Pressable>
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalActionButton, styles.cancelButton, { borderColor: theme.colors.border }]}
                onPress={closeDelayModal}
              >
                <ThemedText style={styles.modalActionButtonText}>Cancel</ThemedText>
              </Pressable>
              
              <Pressable
                style={[
                  styles.modalActionButton,
                  styles.confirmButton,
                  { backgroundColor: delayingSchedule ? '#9CA3AF' : '#10B981' }
                ]}
                onPress={handleConfirmDelay}
                disabled={delayingSchedule}
              >
                {delayingSchedule ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <ThemedText style={[styles.modalActionButtonText, { color: '#fff' }]}>Delay</ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Water Modal */}
      <WaterModal
        open={waterModalOpen}
        onClose={() => {
          setWaterModalOpen(false);
        }}
        userPlantIds={selectedUserPlantIds}
        onSaved={handleModalSaved}
      />

      {/* Fertilize Modal */}
      <FertilizeModal
        open={fertilizeModalOpen}
        onClose={() => {
          setFertilizeModalOpen(false);
          setFertilizeModalIsWatering(false);
        }}
        userPlantIds={selectedUserPlantIds}
        defaultIsWatering={fertilizeModalIsWatering}
        onSaved={handleModalSaved}
      />

      {/* Care Modal */}
      <CareModal
        open={careModalOpen}
        onClose={() => {
          setCareModalOpen(false);
        }}
        userPlantIds={selectedUserPlantIds}
        onSaved={handleModalSaved}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerImage: { width: '100%', height: '100%' },
  content: { paddingTop: 8 },
  loadingContainer: { paddingVertical: 40, alignItems: 'center' },
  sectionWrapper: {
    marginTop: 8,
  },
  sectionHeader: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  sectionHeaderContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  sectionIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitleContainer: {
    flex: 1,
    gap: 4,
  },
  sectionTitle: { 
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sectionTitleUrgent: {
    color: '#10B981',
  },
  urgentIndicator: {
    marginTop: 2,
  },
  urgentIndicatorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#10B981',
    opacity: 0.9,
  },
  sectionChevronContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  sectionChevronContainerOpen: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  futureSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  futureSectionHeaderText: {
    fontSize: 15,
    fontWeight: '600',
    opacity: 0.8,
  },
  subsectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
    opacity: 0.9,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    minWidth: 24,
    alignItems: 'center',
  },
  countBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    opacity: 0.6,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
  },
  cardWrapper: {
    marginBottom: 8,
    marginHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  scheduleCard: {
    flexDirection: 'row',
    padding: 12,
    gap: 12,
    alignItems: 'center',
  },
  scheduleCardExpanded: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  actionButton: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.8,
  },
  imageContainer: {
    width: 65,
    height: 65,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  plantImage: { width: '100%', height: '100%' },
  imageSkeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholderText: { fontSize: 24 },
  selectionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  selectionToolbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 20,
  },
  selectionToolbarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  selectionToolbarClear: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3B82F6',
    marginTop: 4,
  },
  selectionToolbarActions: {
    flexDirection: 'row',
    gap: 8,
  },
  selectionToolbarButton: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 0,
    width: 88,
  },
  selectionToolbarButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.8,
    textAlign: 'center',
  },
  cardContent: { flex: 1, justifyContent: 'center' },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 0,
  },
  plantName: { fontSize: 16, fontWeight: '700', flex: 1 },
  delayIndicator: {
    marginTop: 8,
    marginBottom: 4,
  },
  delayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  delayText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  delayLabel: {
    fontSize: 8,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  eventChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  scheduleTime: {
    fontSize: 14,
    opacity: 0.7,
    lineHeight: 18,
  },
  scheduleTimeToday: {
    color: '#10B981',
    fontWeight: '700',
  },
  eventSummaryList: {
    marginTop: 8,
    gap: 6,
  },
  eventSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  urgencyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  eventIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  eventTextContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  eventLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventLabelBold: {
    fontWeight: '700',
  },
  eventDate: {
    fontSize: 12,
    fontWeight: '500',
  },
  duePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  duePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    minWidth: 280,
    paddingVertical: 24,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  modalSubtitle: { fontSize: 14, opacity: 0.7, marginTop: 8, textAlign: 'center' },
  progressBarContainer: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 16,
  },
  progressBarFill: { height: '100%', borderRadius: 4 },
  progressText: { fontSize: 14, fontWeight: '600', marginTop: 8, opacity: 0.8 },
  delayModalCard: {
    minWidth: 320,
    maxWidth: 400,
    marginHorizontal: 24,
    paddingVertical: 24,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  delayEventSwitcher: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  delayEventOption: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  delayEventOptionActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  delayEventOptionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  delayEventOptionTextActive: {
    color: '#10B981',
  },
  numberPickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 24,
    marginBottom: 24,
  },
  pickerButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerButtonText: {
    fontSize: 28,
    fontWeight: '700',
  },
  pickerValue: {
    alignItems: 'center',
    minWidth: 100,
  },
  pickerNumber: {
    paddingTop: 10,
    lineHeight: 48,
    fontSize: 48,
    fontWeight: '800',
  },
  pickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.7,
    marginTop: 4,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalActionButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 2,
  },
  confirmButton: {
    // backgroundColor set inline
  },
  modalActionButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
