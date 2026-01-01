// components/TimelineChart.tsx
// Chart component using d3 for calculations and react-native-svg for rendering
import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, LayoutChangeEvent, TouchableOpacity } from 'react-native';
import Svg, { Path, Line, G, Rect, Text as SvgText, Defs, Pattern, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '@/context/themeContext';
import { ThemedText } from '@/components/themed-text';
import { supabase } from '@/services/supabaseClient';
import * as d3Scale from 'd3-scale';
import * as d3Shape from 'd3-shape';
import * as d3Array from 'd3-array';
import * as d3Time from 'd3-time';
import * as d3TimeFormat from 'd3-time-format';

type TimelineChartProps = {
  eventType: 'Water' | 'Fertilize';
  userPlantId: string;
  height?: number;
};

type WaterEvent = {
  id: string;
  event_time: string;
  event_type: string;
  event_data?: Record<string, any>;
};

type BarData = {
  gapDays: number;
  nextWateringDate: Date;
  index: number;
  eventType?: 'water' | 'fertilize';
};

export default function TimelineChart({ eventType, userPlantId, height = 200 }: TimelineChartProps) {
  const { theme } = useTheme();
  const [chartWidth, setChartWidth] = useState(300);
  const [waterEvents, setWaterEvents] = useState<WaterEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDelay, setCurrentDelay] = useState<number | null>(null);
  const [defaultDelay, setDefaultDelay] = useState<number | null>(null); // Default delay from plants table
  const [isDefaultDelay, setIsDefaultDelay] = useState(false);
  const [editableDelay, setEditableDelay] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [nextEventHasBoth, setNextEventHasBoth] = useState(false); // Track if next event has both water and fertilize

  const onLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setChartWidth(width);
  };

  // Fetch water events and current delay
  useEffect(() => {
    if (eventType !== 'Water' || !userPlantId) {
      setWaterEvents([]);
      setCurrentDelay(null);
      setDefaultDelay(null);
      setEditableDelay(null);
      setIsDefaultDelay(false);
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch water events and fertilize events that count as watering
        const { data: waterEventsData, error: waterError } = await supabase
          .from('user_plant_timeline_events')
          .select('id, event_time, event_type, event_data')
          .eq('user_plant_id', userPlantId)
          .eq('event_type', 'water')
          .order('event_time', { ascending: true });

        if (waterError) throw waterError;

        const { data: fertilizeEventsData, error: fertError } = await supabase
          .from('user_plant_timeline_events')
          .select('id, event_time, event_type, event_data')
          .eq('user_plant_id', userPlantId)
          .eq('event_type', 'fertilize')
          .order('event_time', { ascending: true });

        if (fertError) throw fertError;

        // Combine water events and fertilize events that count as watering
        const allWateringEvents: WaterEvent[] = [
          ...(waterEventsData || []).map(e => ({ ...e, event_type: 'water' })),
          ...(fertilizeEventsData || []).filter(e => e.event_data?.is_watering === true).map(e => ({ ...e, event_type: 'fertilize' }))
        ].sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());

        setWaterEvents(allWateringEvents);

        // Fetch plant data to get current delay and default delay
        // First check user_plants.water_delay, then fall back to plants table
        const { data: userPlant, error: userPlantError } = await supabase
          .from('user_plants')
          .select('water_delay, plants_table_id')
          .eq('id', userPlantId)
          .maybeSingle();

        if (userPlantError) throw userPlantError;

        // Always fetch the default delay from plants table for outlier detection
        let defaultDelayValue: number | null = null;
        if (userPlant?.plants_table_id) {
          const { data: plantData, error: plantError } = await supabase
            .from('plants')
            .select('water_interval_days_active, water_interval_days_inactive, schedule_same_year_round, active_season_start_date, active_season_end_date')
            .eq('id', userPlant.plants_table_id)
            .maybeSingle();

          if (plantError) throw plantError;

          if (plantData) {
            const now = new Date();

            // Determine if we're in active season
            if (plantData.schedule_same_year_round) {
              defaultDelayValue = plantData.water_interval_days_active;
            } else {
              const startDate = plantData.active_season_start_date ? new Date(plantData.active_season_start_date) : null;
              const endDate = plantData.active_season_end_date ? new Date(plantData.active_season_end_date) : null;
              
              if (startDate && endDate) {
                // Check if we're in active season (handle year wrap-around)
                const isActive = 
                  (startDate <= endDate && now >= startDate && now <= endDate) ||
                  (startDate > endDate && (now >= startDate || now <= endDate));
                
                defaultDelayValue = isActive ? plantData.water_interval_days_active : plantData.water_interval_days_inactive;
              } else {
                // Default to active if dates not set
                defaultDelayValue = plantData.water_interval_days_active;
              }
            }
          }
        }
        setDefaultDelay(defaultDelayValue);

        // Check if user_plants has a water_delay set
        if (userPlant?.water_delay !== null && userPlant?.water_delay !== undefined) {
          setCurrentDelay(userPlant.water_delay);
          setEditableDelay(userPlant.water_delay);
          setIsDefaultDelay(false);
        } else {
          // Use default delay
          setCurrentDelay(defaultDelayValue);
          setEditableDelay(defaultDelayValue);
          setIsDefaultDelay(true); // Mark as default since it came from plants table
        }

        // Check for scheduled events on the next watering date
        if (allWateringEvents.length > 0 && (userPlant?.water_delay ?? defaultDelayValue) !== null) {
          const delay = userPlant?.water_delay ?? defaultDelayValue;
          const lastWatering = new Date(allWateringEvents[allWateringEvents.length - 1].event_time);
          const nextWateringDate = new Date(lastWatering);
          nextWateringDate.setDate(nextWateringDate.getDate() + (delay || 0));
          
          // Check if there are scheduled water and fertilize events on the same day
          const formatDate = d3TimeFormat.timeFormat('%Y-%m-%d');
          const nextDateStr = formatDate(nextWateringDate);
          const { data: schedules } = await supabase
            .from('user_plant_schedules')
            .select('event_type, scheduled_date')
            .eq('user_plant_id', userPlantId)
            .in('event_type', ['water', 'fertilize']);
          
          if (schedules) {
            const waterScheduled = schedules.some(s => {
              const sDate = new Date(s.scheduled_date);
              return s.event_type === 'water' && formatDate(sDate) === nextDateStr;
            });
            const fertScheduled = schedules.some(s => {
              const sDate = new Date(s.scheduled_date);
              return s.event_type === 'fertilize' && formatDate(sDate) === nextDateStr;
            });
            setNextEventHasBoth(waterScheduled && fertScheduled);
          }
        }
      } catch (err) {
        console.error('Failed to fetch chart data:', err);
        setWaterEvents([]);
        setCurrentDelay(null);
        setDefaultDelay(null);
        setEditableDelay(null);
        setIsDefaultDelay(false);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [eventType, userPlantId]);

  // Calculate gaps between waterings
  const barData = useMemo(() => {
    if (waterEvents.length < 2) return [];

    const data: BarData[] = [];
    // Start from the 2nd watering (index 1)
    for (let i = 1; i < waterEvents.length; i++) {
      const prevDate = new Date(waterEvents[i - 1].event_time);
      const currDate = new Date(waterEvents[i].event_time);
      const gapDays = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
      
      data.push({
        gapDays,
        nextWateringDate: currDate, // Label with the date of the next watering
        index: i - 1, // 0-indexed for positioning
        eventType: waterEvents[i].event_type as 'water' | 'fertilize',
      });
    }
    return data;
  }, [waterEvents]);

  // Calculate next watering bar (projected based on current delay)
  const nextWateringBar = useMemo(() => {
    if (waterEvents.length === 0 || editableDelay === null) return null;
    
    const lastWatering = new Date(waterEvents[waterEvents.length - 1].event_time);
    const now = new Date();
    const predictedDate = new Date(lastWatering);
    predictedDate.setDate(predictedDate.getDate() + editableDelay);
    
    // Calculate actual days since last watering
    const actualDaysSinceLastWatering = Math.floor((now.getTime() - lastWatering.getTime()) / (1000 * 60 * 60 * 24));
    
    // Check if prediction is in the past
    const isPredictionInPast = predictedDate < now;
    const actualGapDays = isPredictionInPast ? actualDaysSinceLastWatering : editableDelay;
    const excessDays = isPredictionInPast ? actualDaysSinceLastWatering - editableDelay : 0;
    
    return {
      gapDays: actualGapDays, // Total bar height (predicted + excess if in past)
      predictedGapDays: editableDelay, // The predicted delay portion
      excessDays, // Days beyond prediction (0 if not in past)
      nextWateringDate: isPredictionInPast ? now : predictedDate, // Show current date if prediction passed
      index: barData.length, // Add at the end
      isProjected: true,
      isPredictionInPast,
      hasBothWaterAndFertilize: nextEventHasBoth,
    };
  }, [waterEvents, editableDelay, barData.length, nextEventHasBoth]);

  // Set up d3 scales for bar chart (include projected bar if available)
  const allBars = useMemo(() => {
    const bars = [...barData];
    if (nextWateringBar) {
      bars.push(nextWateringBar as any);
    }
    return bars;
  }, [barData, nextWateringBar]);

  // Check if we should rotate labels (8+ bars including projected)
  const shouldRotateLabels = allBars.length >= 8;
  
  // Chart dimensions with padding
  // Increase bottom padding when rotating labels to accommodate rotated text
  const padding = { top: 20, right: 20, bottom: shouldRotateLabels ? 60 : 50, left: 20 };
  const maxBarWidth = Math.min(chartWidth * 0.95, 600); // Use 95% of width, max 600px
  const actualChartWidth = Math.min(chartWidth, maxBarWidth);
  const innerWidth = actualChartWidth - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const xScale = useMemo(() => {
    if (innerWidth <= 0 || allBars.length === 0) {
      return d3Scale.scaleBand()
        .domain([])
        .range([0, innerWidth])
        .padding(0.6); // More padding = thinner bars
    }
    return d3Scale.scaleBand()
      .domain(allBars.map((_, i) => i.toString()))
      .range([0, innerWidth])
      .padding(0.6); // More padding = thinner bars
  }, [innerWidth, allBars]);

  const yScale = useMemo(() => {
    if (innerHeight <= 0 || allBars.length === 0) {
      return d3Scale.scaleLinear()
        .domain([0, 10])
        .range([innerHeight, 0]);
    }
    const maxGap = d3Array.max(allBars, (d: any) => d.gapDays) || 1;
    return d3Scale.scaleLinear()
      .domain([0, maxGap])
      .range([innerHeight, 0]);
  }, [innerHeight, allBars]);

  // Format date for labels
  const formatDate = d3TimeFormat.timeFormat('%m/%d');

  // Handle increment/decrement
  const handleIncrement = () => {
    if (editableDelay !== null && editableDelay < 30) {
      const newValue = editableDelay + 1;
      setEditableDelay(newValue);
      setIsDefaultDelay(false); // Change to custom when manually adjusted
    }
  };

  const handleDecrement = () => {
    if (editableDelay !== null && editableDelay > 3) {
      const newValue = editableDelay - 1;
      setEditableDelay(newValue);
      setIsDefaultDelay(false); // Change to custom when manually adjusted
    }
  };

  // Handle save
  const handleSave = async () => {
    if (editableDelay === null || editableDelay === currentDelay) return;
    
    try {
      setSaving(true);
      const { error } = await supabase
        .from('user_plants')
        .update({ water_delay: editableDelay })
        .eq('id', userPlantId);

      if (error) throw error;
      
      // Update local state
      setCurrentDelay(editableDelay);
      setIsDefaultDelay(false);
    } catch (err) {
      console.error('Failed to save water delay:', err);
      // Revert on error
      setEditableDelay(currentDelay);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = editableDelay !== null && editableDelay !== currentDelay;

  // Determine if a bar is an outlier
  const isOutlier = useMemo(() => {
    return (index: number): boolean => {
      if (barData.length === 0) return false;
      
      const current = barData[index].gapDays;
      
      // Check if it's shorter than 4 days (low outlier)
      if (current < 4) {
        return true;
      }
      
      // Check if it's more than 4 times the default delay (from plants table, not custom)
      if (defaultDelay !== null && current > defaultDelay * 4) {
        return true;
      }
      
      // First bar: check if it's 40% longer than the next bar (the one that follows it)
      if (index === 0) {
        if (barData.length < 2) return false;
        const next = barData[index + 1].gapDays;
        const nextThreshold = next * 1.4;
        return current > nextThreshold;
      }
      
      // Last bar (not counting projected): check if it's 40% longer than the previous bar (the one that preceded it)
      if (index === barData.length - 1) {
        const prev = barData[index - 1].gapDays;
        const prevThreshold = prev * 1.4;
        return current > prevThreshold;
      }
      
      // Middle bars: check if more than 40% taller than both neighbors
      const left = barData[index - 1].gapDays;
      const right = barData[index + 1].gapDays;
      const leftThreshold = left * 1.4;
      const rightThreshold = right * 1.4;
      
      return current > leftThreshold && current > rightThreshold;
    };
  }, [barData, defaultDelay]);

  // Calculate recommended average (last 4 watering delays, excluding outliers, rounded up)
  const recommendedAvg = useMemo(() => {
    if (barData.length === 0) return null;
    const last4 = barData.slice(-4);
    // Filter out outliers from the last 4
    const nonOutlierBars = last4.filter((bar) => !isOutlier(bar.index));
    // If all are outliers, use all of them (can't exclude everything)
    const barsToUse = nonOutlierBars.length > 0 ? nonOutlierBars : last4;
    const sum = barsToUse.reduce((acc, bar) => acc + bar.gapDays, 0);
    const avg = sum / barsToUse.length;
    return {
      value: Math.ceil(avg),
      count: barsToUse.length,
    };
  }, [barData, isOutlier]);

  if (loading) {
    return (
      <View style={styles.chartWrapper}>
        <View style={styles.placeholderText}>
          <ThemedText style={{ opacity: 0.5, fontSize: 12 }}>Loading chart...</ThemedText>
        </View>
      </View>
    );
  }

  // If not Water event type, show message
  if (eventType !== 'Water') {
    return (
      <View 
        style={styles.chartWrapper}
        onLayout={onLayout}
      >
        <View style={styles.placeholderText}>
          <ThemedText style={{ opacity: 0.5, fontSize: 12 }}>
            Chart only available for Water events
          </ThemedText>
        </View>
      </View>
    );
  }

  // If there are no previous watering events (need at least 2 to calculate gaps), show message
  if (waterEvents.length < 2) {
    return (
      <View 
        style={styles.chartWrapper}
        onLayout={onLayout}
      >
        <View style={styles.placeholderText}>
          <ThemedText style={{ opacity: 0.5, fontSize: 12 }}>
            Not enough data to display chart
          </ThemedText>
        </View>
      </View>
    );
  }

  // Calculate chart offset to center it
  const chartOffset = (chartWidth - actualChartWidth) / 2;

  return (
    <View 
      style={styles.chartWrapper}
      onLayout={onLayout}
    >
      <Svg width={chartWidth} height={height} style={styles.chart}>
        <Defs>
          {/* Diagonal stripe pattern for outliers (yellow) */}
          <Pattern
            id="diagonalStripes"
            patternUnits="userSpaceOnUse"
            width="10"
            height="10"
            patternTransform="rotate(45 5 5)"
          >
            <Rect x="0" y="0" width="5" height="10" fill="#F59E0B" />
            <Rect x="5" y="0" width="5" height="10" fill="#D97706" />
          </Pattern>
          {/* Diagonal stripe pattern for projected next watering (pinkish purple) */}
          <Pattern
            id="purpleDiagonalStripes"
            patternUnits="userSpaceOnUse"
            width="10"
            height="10"
            patternTransform="rotate(45 5 5)"
          >
            <Rect x="0" y="0" width="5" height="10" fill="#C084FC" />
            <Rect x="5" y="0" width="5" height="10" fill="#A855F7" />
          </Pattern>
          {/* Diagonal stripe pattern for blue with green stripes (fertilize that counts as watering) */}
          <Pattern
            id="blueGreenDiagonalStripes"
            patternUnits="userSpaceOnUse"
            width="10"
            height="10"
            patternTransform="rotate(45 5 5)"
          >
            <Rect x="0" y="0" width="5" height="10" fill="#3B82F6" />
            <Rect x="5" y="0" width="5" height="10" fill="#10B981" />
          </Pattern>
          {/* Diagonal stripe pattern for pinkish purple with green stripes (future with both water and fertilize) */}
          <Pattern
            id="purpleGreenDiagonalStripes"
            patternUnits="userSpaceOnUse"
            width="10"
            height="10"
            patternTransform="rotate(45 5 5)"
          >
            <Rect x="0" y="0" width="5" height="10" fill="#C084FC" />
            <Rect x="5" y="0" width="5" height="10" fill="#10B981" />
          </Pattern>
          {/* Diagonal stripe pattern for yellow with green stripes (outlier fertilize that counts as watering) */}
          <Pattern
            id="yellowGreenDiagonalStripes"
            patternUnits="userSpaceOnUse"
            width="10"
            height="10"
            patternTransform="rotate(45 5 5)"
          >
            <Rect x="0" y="0" width="5" height="10" fill="#F59E0B" />
            <Rect x="5" y="0" width="5" height="10" fill="#10B981" />
          </Pattern>
          {/* Diagonal stripe pattern for red excess (past prediction) */}
          <Pattern
            id="redDiagonalStripes"
            patternUnits="userSpaceOnUse"
            width="10"
            height="10"
            patternTransform="rotate(45 5 5)"
          >
            <Rect x="0" y="0" width="5" height="10" fill="#EF4444" />
            <Rect x="5" y="0" width="5" height="10" fill="#DC2626" />
          </Pattern>
          {/* Gradient for fading grid at edges */}
          <LinearGradient id="fadeTop" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor={theme.colors.background} stopOpacity="1" />
            <Stop offset="100%" stopColor={theme.colors.background} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="fadeBottom" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor={theme.colors.background} stopOpacity="0" />
            <Stop offset="100%" stopColor={theme.colors.background} stopOpacity="1" />
          </LinearGradient>
          <LinearGradient id="fadeLeft" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor={theme.colors.background} stopOpacity="1" />
            <Stop offset="100%" stopColor={theme.colors.background} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="fadeRight" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor={theme.colors.background} stopOpacity="0" />
            <Stop offset="100%" stopColor={theme.colors.background} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <G x={chartOffset + padding.left} y={padding.top}>
          {/* Grid lines */}
          {(() => {
            if (allBars.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;
            
            const gridLines: React.ReactNode[] = [];
            const gridColor = 'rgba(127,127,127,0.18)';
            const fadeWidth = 16;
            
            // Horizontal grid lines (based on y-scale ticks)
            const maxGap = d3Array.max(allBars, (d: any) => d.gapDays) || 1;
            const tickCount = 5; // Number of horizontal grid lines
            for (let i = 0; i <= tickCount; i++) {
              const value = (maxGap / tickCount) * i;
              const y = yScale(value);
              gridLines.push(
                <Line
                  key={`h-${i}`}
                  x1={0}
                  y1={y}
                  x2={innerWidth}
                  y2={y}
                  stroke={gridColor}
                  strokeWidth={1}
                />
              );
            }
            
            // Vertical grid lines (evenly spaced)
            const verticalCount = Math.min(allBars.length + 1, 8); // Max 8 vertical lines
            for (let i = 0; i <= verticalCount; i++) {
              const x = (innerWidth / verticalCount) * i;
              gridLines.push(
                <Line
                  key={`v-${i}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={innerHeight}
                  stroke={gridColor}
                  strokeWidth={1}
                />
              );
            }
            
            return (
              <G>
                {gridLines}
                {/* Fade overlays at edges - these will fade the grid but bars render on top */}
                <Rect x={0} y={0} width={innerWidth} height={fadeWidth} fill="url(#fadeTop)" pointerEvents="none" />
                <Rect x={0} y={innerHeight - fadeWidth} width={innerWidth} height={fadeWidth} fill="url(#fadeBottom)" pointerEvents="none" />
                <Rect x={0} y={0} width={fadeWidth} height={innerHeight} fill="url(#fadeLeft)" pointerEvents="none" />
                <Rect x={innerWidth - fadeWidth} y={0} width={fadeWidth} height={innerHeight} fill="url(#fadeRight)" pointerEvents="none" />
              </G>
            );
          })()}
        </G>
        
        {/* Render bars on top of grid */}
        <G x={chartOffset + padding.left} y={padding.top}>
          {allBars.map((bar: any) => {
            const shouldRotateLabels = allBars.length >= 8;
            const barWidth = xScale.bandwidth();
            const barX = xScale(bar.index.toString()) || 0;
            const barHeight = innerHeight - yScale(bar.gapDays);
            const barY = yScale(bar.gapDays);
            const isProjected = bar.isProjected === true;
            const outlier = !isProjected && isOutlier(bar.index);
            let barColor: string;
            if (isProjected) {
              // Future bar: purple with green stripes if both water and fertilize, otherwise purple stripes
              if (bar.hasBothWaterAndFertilize) {
                barColor = 'url(#purpleGreenDiagonalStripes)';
              } else {
                barColor = 'url(#purpleDiagonalStripes)';
              }
            } else if (outlier) {
              // Outlier bars: yellow with green stripes if fertilize, otherwise just yellow stripes
              if (bar.eventType === 'fertilize') {
                barColor = 'url(#yellowGreenDiagonalStripes)'; // Yellow with green stripes for outlier fertilize
              } else {
                barColor = 'url(#diagonalStripes)'; // Yellow stripes for outlier water
              }
            } else {
              // Regular bars: light blue for water, blue with green stripes for fertilize that counts as watering
              if (bar.eventType === 'fertilize') {
                barColor = 'url(#blueGreenDiagonalStripes)';
              } else {
                barColor = '#60A5FA'; // Lighter blue for water
              }
            }
            const barCenterX = barX + barWidth / 2;

            return (
              <G key={bar.index}>
                {/* Bar */}
                {isProjected && bar.excessDays > 0 ? (
                  // Two-part bar: purple predicted (bottom) + red overdue (top)
                  <>
                    {/* Purple predicted portion - bottom part (the predicted delay) */}
                    <Rect
                      x={barX}
                      y={yScale(bar.gapDays)}
                      width={barWidth}
                      height={yScale(bar.predictedGapDays) - yScale(bar.gapDays)}
                      fill={barColor}
                    />
                    {/* Red overdue portion - top part (the days that have passed beyond prediction) */}
                    <Rect
                      x={barX}
                      y={yScale(bar.predictedGapDays)}
                      width={barWidth}
                      height={yScale(0) - yScale(bar.predictedGapDays)}
                      fill="url(#redDiagonalStripes)"
                    />
                  </>
                ) : (
                  // Single bar (normal case)
                  <Rect
                    x={barX}
                    y={barY}
                    width={barWidth}
                    height={barHeight}
                    fill={barColor}
                  />
                )}
                {/* Label - date of next watering (or current date if prediction passed) */}
                <SvgText
                  x={barCenterX}
                  y={innerHeight + (shouldRotateLabels ? 20 : 15)}
                  fontSize={10}
                  fill={theme.colors.text}
                  textAnchor="middle"
                  opacity={0.7}
                  transform={shouldRotateLabels ? `rotate(-45 ${barCenterX} ${innerHeight + (shouldRotateLabels ? 20 : 15)})` : undefined}
                >
                  {formatDate(bar.nextWateringDate)}
                </SvgText>
                {/* Gap days label on top of bar */}
                <SvgText
                  x={barCenterX}
                  y={barY - 5}
                  fontSize={10}
                  fill={theme.colors.text}
                  textAnchor="middle"
                  fontWeight="600"
                >
                  {bar.gapDays}d
                </SvgText>
              </G>
            );
          })}
        </G>
      </Svg>
      
      {/* Stats below chart */}
      <View style={styles.statsContainer}>
        <View style={styles.statItem}>
          <ThemedText style={styles.statTitle}>Current Delay</ThemedText>
          <View style={[styles.statBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
            <View style={styles.delayControlsContainer}>
              <TouchableOpacity
                onPress={handleDecrement}
                disabled={editableDelay === null || editableDelay <= 3}
                style={styles.controlButton}
              >
                <ThemedText style={[
                  styles.controlButtonText,
                  { color: theme.colors.text },
                  (editableDelay === null || editableDelay <= 3) && { opacity: 0.3 }
                ]}>−</ThemedText>
              </TouchableOpacity>
              <View style={styles.statValueContainer}>
                <ThemedText style={[styles.statValue, { color: '#10B981' }]}>
                  {editableDelay !== null ? `${editableDelay} ${editableDelay === 1 ? 'day' : 'days'}` : 'N/A'}
                </ThemedText>
                {editableDelay !== null && (
                  <ThemedText style={isDefaultDelay ? styles.defaultLabel : styles.customLabel}>
                    {isDefaultDelay ? 'default' : 'Custom'}
                  </ThemedText>
                )}
              </View>
              <TouchableOpacity
                onPress={handleIncrement}
                disabled={editableDelay === null || editableDelay >= 30}
                style={styles.controlButton}
              >
                <ThemedText style={[
                  styles.controlButtonText,
                  { color: theme.colors.text },
                  (editableDelay === null || editableDelay >= 30) && { opacity: 0.3 }
                ]}>+</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <View style={styles.statItem}>
          <ThemedText style={styles.statTitle}>Rec. Avg.</ThemedText>
          <View style={[styles.statBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
            <View style={styles.statValueContainer}>
              <ThemedText style={[styles.statValue, { color: '#10B981' }]}>
                {recommendedAvg !== null ? `${recommendedAvg.value} ${recommendedAvg.value === 1 ? 'day' : 'days'}` : 'N/A'}
              </ThemedText>
              {recommendedAvg !== null && (
                <ThemedText style={styles.defaultLabel}>
                  {recommendedAvg.count === 1 
                    ? 'One Watering' 
                    : recommendedAvg.count === 2
                    ? 'Two Waterings'
                    : recommendedAvg.count === 3
                    ? 'Three Waterings'
                    : 'Four Waterings'}
                </ThemedText>
              )}
            </View>
          </View>
        </View>
      </View>
      
      {/* Save button */}
      {hasChanges && (
        <View style={styles.saveButtonContainer}>
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={[
              styles.saveButton,
              { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
              saving && styles.saveButtonDisabled
            ]}
          >
            <ThemedText style={[styles.saveButtonText, { color: '#fff' }]}>
              {saving ? 'Saving...' : 'Save'}
            </ThemedText>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chartWrapper: {
    width: '100%',
    marginVertical: 12,
    alignItems: 'center', // Center the chart
  },
  chart: {
    width: '100%',
  },
  placeholderText: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 32,
    marginTop: 16,
    gap: 16,
  },
  statItem: {
    flex: 1,
    gap: 8,
  },
  statTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  statBadge: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValueContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  defaultLabel: {
    fontSize: 10,
    fontWeight: '600',
    opacity: 0.6,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  customLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
    color: '#3B82F6', // Blue color
  },
  delayControlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  controlButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  controlButtonText: {
    fontSize: 18,
    fontWeight: '700',
  },
  saveButtonContainer: {
    marginTop: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  saveButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});

