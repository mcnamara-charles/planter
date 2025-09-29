import { Image } from 'expo-image';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useDashboard } from '@/hooks/useDashboard';
import { useNavigation } from '@react-navigation/native';

export default function HomeScreen() {
  const { theme } = useTheme();
  const { sickPlantsCount, plants, loading, error } = useDashboard();
  const nav = useNavigation();

  // Dashboard data with real sick plants count
  const dashboardData = {
    sickPlants: sickPlantsCount,
    toDoTasks: 7, // TODO: Implement real data
    locations: 5, // TODO: Implement real data
    recentActivity: 12, // TODO: Implement real data
  };

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
        {/* Card 1: Sick Plants */}
        <TouchableOpacity 
          style={[styles.dashboardCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
          activeOpacity={0.7}
          onPress={() => (nav as any).navigate('SickPlants')}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <IconSymbol name="exclamationmark.triangle" size={24} color="#ef4444" />
              <IconSymbol name="chevron.right" size={16} color={theme.colors.mutedText} />
            </View>
            <ThemedText style={styles.cardNumber}>{dashboardData.sickPlants}</ThemedText>
            <ThemedText style={styles.cardLabel}>Sick Plants</ThemedText>
          </View>
        </TouchableOpacity>

        {/* Card 2: To Do */}
        <TouchableOpacity 
          style={[styles.dashboardCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
          activeOpacity={0.7}
          onPress={() => (nav as any).navigate('ToDo')}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <IconSymbol name="checklist" size={24} color="#3b82f6" />
              <IconSymbol name="chevron.right" size={16} color={theme.colors.mutedText} />
            </View>
            <ThemedText style={styles.cardNumber}>{dashboardData.toDoTasks}</ThemedText>
            <ThemedText style={styles.cardLabel}>To Do</ThemedText>
          </View>
        </TouchableOpacity>

        {/* Card 3: Locations */}
        <TouchableOpacity 
          style={[styles.dashboardCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
          activeOpacity={0.7}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <IconSymbol name="location" size={24} color="#10b981" />
              <IconSymbol name="chevron.right" size={16} color={theme.colors.mutedText} />
            </View>
            <ThemedText style={styles.cardNumber}>{dashboardData.locations}</ThemedText>
            <ThemedText style={styles.cardLabel}>Locations</ThemedText>
          </View>
        </TouchableOpacity>

        {/* Card 4: Recent Activity */}
        <TouchableOpacity 
          style={[styles.dashboardCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
          activeOpacity={0.7}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <IconSymbol name="clock" size={24} color="#8b5cf6" />
              <IconSymbol name="chevron.right" size={16} color={theme.colors.mutedText} />
            </View>
            <ThemedText style={styles.cardNumber}>{dashboardData.recentActivity}</ThemedText>
            <ThemedText style={styles.cardLabel}>Recent Activity</ThemedText>
          </View>
        </TouchableOpacity>
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


