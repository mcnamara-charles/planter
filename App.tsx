import { StatusBar } from 'expo-status-bar'
import { AuthProvider } from '@/context/AuthContext'
import * as Linking from 'expo-linking'
import { useEffect } from 'react'
import { supabase } from './services/supabaseClient'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Platform } from 'react-native'
import { ThemeProvider, useTheme } from '@/context/themeContext'
import * as NavigationBar from 'expo-navigation-bar'
import RootNavigator from '@/components/navigation/RootNavigator'

function ThemedApp() {
  const { themeName, theme } = useTheme()

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync('#000000')
      NavigationBar.setButtonStyleAsync('light')
      NavigationBar.setPositionAsync('relative')
    }

    const handleDeepLink = async ({ url }: { url: string }) => {
      if (!url.includes('code=')) return
      const { data, error } = await supabase.auth.exchangeCodeForSession(url)
      if (error) console.error('Session exchange failed:', error.message)
    }

    const subscription = Linking.addEventListener('url', handleDeepLink)

    Linking.getInitialURL().then((initialUrl) => {
      if (initialUrl?.includes('code=')) {
        handleDeepLink({ url: initialUrl })
      }
    })

    return () => subscription.remove()
  }, [])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }}>
      <StatusBar
        style={themeName === 'dark' ? 'light' : 'dark'}
        backgroundColor={theme.colors.background}
      />
      <RootNavigator />
    </SafeAreaView>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
          <ThemedApp />
      </ThemeProvider>
    </AuthProvider>
  )
}
