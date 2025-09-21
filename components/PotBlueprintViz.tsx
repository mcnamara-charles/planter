import React from 'react'
import { View, StyleSheet } from 'react-native'
import { ThemedText } from '@/components/themed-text'
import { useTheme } from '@/context/themeContext'
import { Svg, Rect as SvgRect, Path as SvgPath } from 'react-native-svg'

type Props = {
  /** Pot height in inches (front view label uses inches) */
  heightIn: number
  /** Top-view diameter in inches (label uses inches) */
  diameterIn: number
  potType?: string | null
  drainageSystem?: string | null
}

export default function PotBlueprintViz({ heightIn, diameterIn, potType, drainageSystem }: Props) {
  const { theme } = useTheme()

  const dimHeightText = `${heightIn.toFixed(1)} in`
  const dimDiameterText = `${diameterIn.toFixed(1)} in`

  return (
    <View style={[styles.root]}>
      {/* Front view (only if height provided) */}
      {heightIn > 0 && (
        <View style={[styles.panel, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
          <ThemedText style={styles.panelLabel}>Front</ThemedText>
          <View style={styles.panelInner}>
            <GridMesh />

            {/* Row: label (left) + exact-height line + gap + pot (right) */}
            <View style={styles.row}>
              <View style={{ flex: 1 }} />

              {/* Label to the LEFT of the dimension line */}
              <ThemedText style={styles.dimLabelLeft}>{dimHeightText}</ThemedText>

              {/* Dimension line exactly the same height as the pot graphic */}
              <View style={[styles.dimVerticalRule, { borderColor: theme.colors.text, height: POT_TARGET }]} />

              <View style={{ width: 8 }} />

              {/* Pot outline scaled to POT_TARGET height (now truly fills 5 grid squares) */}
              <PotFrontOutline color={theme.colors.text as string} />
            </View>
          </View>
        </View>
      )}

      {/* Top view (only if diameter provided) */}
      {diameterIn > 0 && (
        <View style={[styles.panel, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
          <ThemedText style={styles.panelLabel}>Top</ThemedText>
          <View style={styles.panelInner}>
            <GridMesh />

            {/* Row: label (left) + exact-diameter line + gap + circle (right) */}
            <View style={styles.row}>
              <View style={{ flex: 1 }} />

              {/* Label to the LEFT of the vertical diameter line */}
              <ThemedText style={styles.dimLabelLeft}>{dimDiameterText}</ThemedText>

              {/* Vertical diameter line exactly the circle's diameter */}
              <View style={[styles.dimVerticalRule, { borderColor: theme.colors.text, height: POT_TARGET }]} />

              <View style={{ width: 8 }} />

              {/* Top circle sized to POT_TARGET (same visual height as pot) */}
              <View style={[styles.topCircle, { borderColor: theme.colors.text }]} />
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

function GridMesh() {
  const { theme } = useTheme()
  const gridColor = theme.colors.text ? 'rgba(127,127,127,0.28)' : 'rgba(127,127,127,0.28)'
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* vertical lines */}
      <View style={styles.meshColWrap}>
        {Array.from({ length: 7 }).map((_, i) => (
          <View key={`v-${i}`} style={[styles.meshCol, { backgroundColor: gridColor }]} />
        ))}
      </View>
      {/* horizontal lines */}
      <View style={styles.meshRowWrap}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={`h-${i}`} style={[styles.meshRow, { backgroundColor: gridColor }]} />
        ))}
      </View>
    </View>
  )
}

/** Blueprint-style front pot outline set to exactly POT_TARGET high by tightening the viewBox */
function PotFrontOutline({ color }: { color: string }) {
  return (
    <View style={{ width: POT_TARGET, height: POT_TARGET, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
      <Svg
        width={POT_TARGET}
        height={POT_TARGET}
        // Tight viewBox matches the pot’s drawing bounds (x:30→170, y:30→170), so it fills the full height.
        viewBox="30 30 140 140"
        preserveAspectRatio="xMidYMid meet"
        accessibilityRole="image"
      >
        {/* Rim (top lip) */}
        <SvgRect
          x={30}
          y={30}
          width={140}
          height={20}
          rx={4}
          fill="none"
          stroke={color}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {/* Body (tapered trapezoid) */}
        <SvgPath
          d="M42 50 L158 50 L132 170 L68 170 Z"
          fill="none"
          stroke={color}
          strokeWidth={1}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
    </View>
  )
}

const PANEL_W = 170
const PANEL_H = 160
const POT_TARGET = 84 // 5 grid squares tall (same as the top circle's diameter)

const styles = StyleSheet.create({
  root: { flexDirection: 'row', gap: 6, justifyContent: 'center' },

  panel: {
    width: PANEL_W,
    height: PANEL_H,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  panelLabel: { fontWeight: '700', fontSize: 12, opacity: 0.75, paddingHorizontal: 8, paddingTop: 6 },
  panelInner: { flex: 1, margin: 12, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  metaRow: { paddingHorizontal: 8, paddingBottom: 8, flexDirection: 'row', gap: 12, justifyContent: 'center' },
  meta: { fontSize: 11, opacity: 0.8 },

  // Mesh
  meshColWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around' },
  meshCol: { width: 1 },
  meshRowWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'space-around' },
  meshRow: { height: 1 },

  // Shared row layout
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Dimension visuals
  dimVerticalRule: { width: 0, borderLeftWidth: 1 },
  dimLabelLeft: { marginRight: 6, fontSize: 11, fontWeight: '700', opacity: 0.8 },

  // Top view circle (exactly POT_TARGET tall)
  topCircle: { width: POT_TARGET, height: POT_TARGET, borderRadius: POT_TARGET / 2, borderWidth: 1, backgroundColor: 'transparent' },
})
