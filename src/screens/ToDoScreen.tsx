import { Image } from 'expo-image';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useNavigation } from '@react-navigation/native';
import { useDashboard } from '@/hooks/useDashboard';

export default function ToDoScreen() {
  const { theme } = useTheme();
  const nav = useNavigation();
  const { plantsNeedingInspectionCount } = useDashboard();

  // TODO: Implement real data fetching for other task types
  const todoData = {
    needsInspected: plantsNeedingInspectionCount, // Plants that haven't been observed recently
    needsWatered: 5,   // Plants that need watering
    needsFertilized: 2, // Plants that need fertilizing
    needsPruned: 1,    // Plants that need pruning
  };

  const DashboardCard = ({ 
    icon, 
    title, 
    count, 
    onPress 
  }: { 
    icon: string; 
    title: string; 
    count: number; 
    onPress: () => void; 
  }) => (
    <TouchableOpacity 
      style={[styles.dashboardCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <IconSymbol name={icon} size={24} color={theme.colors.primary} />
          <IconSymbol name="chevron.right" size={16} color={theme.colors.mutedText} />
        </View>
        <ThemedText style={styles.cardNumber}>{count}</ThemedText>
        <ThemedText style={styles.cardLabel}>{title}</ThemedText>
      </View>
    </TouchableOpacity>
  );

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#E5F4EF', dark: '#12231F' }}
      headerImage={
        <Image
          source={require('../../assets/images/plants-header.jpg')}
          contentFit="cover"
          transition={200}
          style={styles.reactLogo}
        />
      }>
      <View style={styles.dashboardGrid}>
        {/* Card 1: Needs Inspected */}
        <DashboardCard
          icon="exclamationmark.triangle"
          title="Needs Inspected"
          count={todoData.needsInspected}
          onPress={() => (nav as any).navigate('Inspection')}
        />

        {/* Card 2: Needs Watered */}
        <DashboardCard
          icon="drop"
          title="Needs Watered"
          count={todoData.needsWatered}
          onPress={() => {
            // TODO: Navigate to plants that need watering
            console.log('Navigate to needs watered plants');
          }}
        />

        {/* Card 3: Needs Fertilized */}
        <DashboardCard
          icon="leaf"
          title="Needs Fertilized"
          count={todoData.needsFertilized}
          onPress={() => {
            // TODO: Navigate to plants that need fertilizing
            console.log('Navigate to needs fertilized plants');
          }}
        />

        {/* Card 4: Needs Pruned */}
        <DashboardCard
          icon="scissors"
          title="Needs Pruned"
          count={todoData.needsPruned}
          onPress={() => {
            // TODO: Navigate to plants that need pruning
            console.log('Navigate to needs pruned plants');
          }}
        />
      </View>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  dashboardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 16,
    paddingBottom: 16,
  },
  dashboardCard: {
    width: '47%', // 2x2 grid with gap
    aspectRatio: 1.2,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardNumber: {
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 36,
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.8,
  },
  reactLogo: {
    width: '100%',
    height: '100%',
  },
});
