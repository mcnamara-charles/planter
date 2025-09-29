import React, { useCallback, useRef } from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Pressable, StyleSheet, Alert, Platform, BackHandler, ToastAndroid } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRoute, getFocusedRouteNameFromRoute } from '@react-navigation/native';

import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import HomeScreen from '@/src/screens/HomeScreen';
import PlantsScreen from '@/src/screens/PlantsScreen';
import AccountScreen from '@/src/screens/AccountScreen';
import ProfileScreen from '@/src/screens/ProfileScreen';
import DiscoverScreen from '@/src/screens/DiscoverScreen';
import SignInScreen from '@/src/screens/SignInScreen';
import SignUpScreen from '@/src/screens/SignUpScreen';
import VerifyEmailScreen from '@/src/screens/VerifyEmailScreen';
import AddPlantScreen from '@/src/screens/AddPlantScreen';
import CameraScreen from '@/src/screens/CameraScreen';
import CameraPreviewScreen from '@/src/screens/CameraPreviewScreen';
import PlantDetailScreen from '../../src/screens/PlantDetailScreen';
import PlantIdentificationResultScreen from '../../src/screens/PlantIdentificationResultScreen';
import EditProfileScreen from '@/src/screens/EditProfileScreen';
import AddObserveScreen from '@/src/screens/ObserveScreen';
import ViewObservationScreen from '@/src/screens/ViewObservationScreen';
import SickPlantsScreen from '@/src/screens/SickPlantsScreen';
import ToDoScreen from '@/src/screens/ToDoScreen';
import InspectionScreen from '@/src/screens/InspectionScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function CenterIdentifyButton({ onPress }: { onPress: () => void }) {
  // Standalone so it renders even when Identify tab is “focused”
  return (
    <View pointerEvents="box-none" style={styles.centerWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Identify a plant"
        style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.96 : 1 }] }]}
        hitSlop={12}
      >
        <LinearGradient
          colors={['#5BE49B', '#00B37E', '#007A5B']} // tasteful green gradient
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.centerButton}
        >
          <View style={styles.centerButtonInner}>
            <IconSymbol name="camera.fill" size={26} color="#ffffff" />
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

function MainTabs({ navigation }: any) {
  const { theme } = useTheme();

  // Figure out which tab inside this Tab.Navigator is focused
  const route = useRoute();
  const focusedTab = getFocusedRouteNameFromRoute(route) ?? 'Home';
  const lastBackTs = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;

      const onBackPress = () => {
        
        if (focusedTab !== 'Home') {
          return false; // don't intercept
        }
        // We're on Home: require double press to exit
        const now = Date.now();
        if (now - lastBackTs.current < 1500) {
          // Allow default behavior (exit)
          return false;
        }

        lastBackTs.current = now;
        ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT);
        return true; // we handled the first press
      };

      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [focusedTab])
  );

  return (
    <Tab.Navigator
      initialRouteName="Home"
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.mutedText,
        tabBarStyle: [
          {
            backgroundColor: theme.colors.card,
            borderTopColor: theme.colors.border,
            height: 64,
          },
          // Extra bottom padding on Android for the floating button overlap
          Platform.select({ android: { paddingBottom: 4 } }) as any,
        ],
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen as any}
        options={{
          tabBarIcon: ({ color, size }) => (
            <IconSymbol name="house.fill" color={color} size={size} />
          ),
        }}
      />

      <Tab.Screen
        name="Discover"
        component={DiscoverScreen as any}
        options={{
          tabBarIcon: ({ color, size }) => (
            <IconSymbol name="photo" color={color} size={size} />
          ),
        }}
      />

      {/* Center “Identify” action — mocked */}
          <Tab.Screen
        name="Identify"
        component={View as any} // no screen yet, just a placeholder
        options={{
          tabBarLabel: '',
          tabBarIcon: () => null, // we render our own button
          tabBarButton: () => (
            <CenterIdentifyButton onPress={() => navigation.navigate('Camera')} />
          ),
        }}
        listeners={() => ({
          tabPress: (e) => {
            // prevent default tab navigation since we mock it
            e.preventDefault();
          },
        })}
      />

      <Tab.Screen
        name="MyPlants"
        component={PlantsScreen as any}
        options={{
          title: 'My Plants',
          tabBarIcon: ({ color, size }) => (
            <IconSymbol name="leaf" color={color} size={size} />
          ),
        }}
      />

      <Tab.Screen
        name="Account"
        component={AccountScreen as any}
        options={{
          tabBarIcon: ({ color, size }) => (
            <IconSymbol name="person.circle" color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { themeName, theme } = useTheme();
  const { user, loading } = useAuth();

  const navTheme = themeName === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...navTheme,
    colors: {
      ...navTheme.colors,
      background: theme.colors.background,
      card: theme.colors.card,
      text: theme.colors.text,
      border: theme.colors.border,
      primary: theme.colors.primary,
    },
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;

  return (
    <NavigationContainer theme={navigationTheme as any}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <>
            <Stack.Screen name="SignIn" component={SignInScreen as any} />
            <Stack.Screen name="SignUp" component={SignUpScreen as any} />
            <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen as any} />
          </>
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen name="Camera" component={CameraScreen as any} />
            <Stack.Screen name="CameraPreview" component={CameraPreviewScreen as any} />
            <Stack.Screen name="PlantIdentificationResult" component={PlantIdentificationResultScreen as any} />
            <Stack.Screen name="AddPlant" component={AddPlantScreen as any} />
            <Stack.Screen name="PlantDetail" component={PlantDetailScreen as any} />
            <Stack.Screen name="Profile" component={ProfileScreen as any} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen as any} />
            <Stack.Screen name="Observe" component={AddObserveScreen as any} />
            <Stack.Screen name="ViewObservation" component={ViewObservationScreen as any} />
            <Stack.Screen name="SickPlants" component={SickPlantsScreen as any} />
            <Stack.Screen name="ToDo" component={ToDoScreen as any} />
            <Stack.Screen name="Inspection" component={InspectionScreen as any} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  centerWrap: {
    position: 'absolute',
    top: -24,             // lift above the tab bar
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  centerButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  centerButtonInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
