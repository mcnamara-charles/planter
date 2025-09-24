import React from 'react';
import { View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import GridPanel from './GridPanel';
import { ButtonPill } from './Buttons';
import PotBlueprintViz from '@/components/PotBlueprintViz';

function Pill({ label }: { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ borderWidth: 1 / 2, borderColor: theme.colors.border, backgroundColor: theme.colors.card, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 }}>
      <ThemedText style={{ fontWeight: '600', fontSize: 12 }}>{label}</ThemedText>
    </View>
  );
}

export default function EnvironmentSection({
  plantLocation,
  potType,
  potHeightIn,
  potDiameterIn,
  drainageSystem,
  soilMix,
  soilDescription,
  onAddPotDetails,
  onRepot,
  onMove,
  SoilMixSlot, // pass a node that renders the viz or CTA
}: {
  plantLocation?: string;
  potType?: string | null;
  potHeightIn?: number | null;
  potDiameterIn?: number | null;
  drainageSystem?: string | null;
  soilMix?: Record<string, number> | null;
  soilDescription?: string | null;
  onAddPotDetails: () => void;
  onRepot: () => void;
  onMove: () => void;
  SoilMixSlot: React.ReactNode;
}) {
  const { theme } = useTheme();
  
  return (
    <View style={{ gap: 18 }}>
      {/* Location */}
      <View style={{ gap: 8 }}>
        <ThemedText style={{ fontWeight: '800' }}>Location</ThemedText>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <ThemedText style={{ opacity: 0.85 }}>{plantLocation || 'Not set'}</ThemedText>
          <ButtonPill label="Move" variant="outline" color="primary" onPress={onMove} />
        </View>
      </View>

      {/* Potting */}
      <View style={{ gap: 8 }}>
        <ThemedText style={{ fontWeight: '800' }}>Potting</ThemedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: 8 }}>
          {!!potType && <Pill label={potType} />}
          {!!drainageSystem && <Pill label={`Drainage: ${drainageSystem}`} />}
        </View>
        {!!(potHeightIn || potDiameterIn) && (
          <View style={{ marginTop: 8 }}>
            <PotBlueprintViz heightIn={potHeightIn || 0} diameterIn={potDiameterIn || 0} potType={potType ?? null} drainageSystem={drainageSystem ?? null} />
          </View>
        )}
        {potType || potHeightIn || potDiameterIn || drainageSystem ? (
          <View style={{ marginTop: 8 }}>
            <ButtonPill label="Repot" onPress={onRepot} />
          </View>
        ) : (
          <GridPanel center padding={40}>
            <View style={{ alignItems: 'center' }}>
              <ButtonPill label="Add Pot Details" variant="solid" color="primary" onPress={onAddPotDetails}/>
            </View>
          </GridPanel>
        )}
      </View>

      {/* Soil */}
      <View style={{ gap: 8 }}>
        <ThemedText style={{ fontWeight: '800' }}>Soil mix</ThemedText>
        {!!soilDescription && (
          <ThemedText style={{ color: theme.colors.mutedText, marginBottom: 8 }}>
            {soilDescription}
          </ThemedText>
        )}
        <GridPanel center padding={40}>{SoilMixSlot}</GridPanel>
      </View>
    </View>
  );
}
