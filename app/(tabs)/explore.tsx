import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import FavoritePlantCard from '@/components/favorite-plant-card';
import { MOCK_PLANTS } from '@/constants/mock-plants';

export default function PlantsScreen() {
  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#E5F4EF', dark: '#12231F' }}
      headerImage={
        <Image
          source={require('@/assets/images/plants-header.jpg')}
          contentFit="cover"
          transition={200}
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Plants</ThemedText>
      </ThemedView>
      <View style={styles.grid}>
        {MOCK_PLANTS.map((item) => (
          <View key={item.id} style={styles.cardContainer}>
            <FavoritePlantCard plant={item} onPress={() => {}} />
          </View>
        ))}
      </View>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  grid: {
    paddingTop: 4,
    paddingBottom: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  cardContainer: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  headerImage: {
    ...StyleSheet.absoluteFillObject,
  },
});
