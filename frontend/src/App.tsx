import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { SetupRequiredModal } from './components/SetupRequiredModal'
import { pb } from './lib/pocketbase'
import { useTrackerData } from './hooks/useTrackerData'
import { BowelLoggerPage } from './pages/BowelLoggerPage'
import { CalendarPage } from './pages/CalendarPage'
import { HomePage } from './pages/HomePage'
import { IngredientSearchPage } from './pages/IngredientSearchPage'
import { MealLoggerPage } from './pages/MealLoggerPage'
import { StatsPage } from './pages/StatsPage'
import './App.css'
import { useCallback, useEffect, useState } from 'react'
import { seedFodmapLibrary } from './lib/seedFodmapLibrary'

function App() {
  const navigate = useNavigate()
  const [hasRegisteredAdmin, setHasRegisteredAdmin] = useState<boolean | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const isSetupRequired = hasRegisteredAdmin === false
  const isSetupLocked = hasRegisteredAdmin !== true

  const checkForRegisteredAdmin = useCallback(async () => {
    setHasRegisteredAdmin(null)
    setSetupError(null)

    try {
      const result = await pb.send<{ hasRegisteredAdmin: boolean }>('/api/gutmost/setup-status', { method: 'GET' })
      setHasRegisteredAdmin(result.hasRegisteredAdmin)
      if (result.hasRegisteredAdmin) {
        try {
          await seedFodmapLibrary()
        } catch (error) {
          console.error(error)
          setSetupError('The FODMAP library could not be loaded. Click check again to retry. \nReason: '+ error + '\nPlease contact developer for support.')
        }
      }
    } catch (error) {
      console.error(error)
      setHasRegisteredAdmin(false)
      setSetupError('PocketBase setup status could not be checked. Start the local backend and try again.')
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void checkForRegisteredAdmin()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [checkForRegisteredAdmin])

  useEffect(() => {
    if (isSetupLocked) navigate('/', { replace: true })
  }, [isSetupLocked, navigate])

  const {
    ingredients,
    foodLogs,
    symptomLogs,
    isLoading,
    loadError,
    stats,
    reload,
    addIngredient,
  } = useTrackerData(hasRegisteredAdmin === true)

  return (
    <>
      <AppShell stats={stats} loadError={loadError} backendUrl={pb.baseURL} registrationRequired={isSetupLocked}>
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              ingredients={ingredients}
              foodLogs={foodLogs}
              symptomLogs={symptomLogs}
              loading={isLoading}
              onRefresh={reload}
            />
          }
        />
        <Route
          path="/stats"
          element={
            <StatsPage
              ingredients={ingredients}
              foodLogs={foodLogs}
              symptomLogs={symptomLogs}
              loading={isLoading}
              onRefresh={reload}
            />
          }
        />
        <Route
          path="/ingredients"
          element={
            <IngredientSearchPage
              ingredients={ingredients}
              foodLogs={foodLogs}
              symptomLogs={symptomLogs}
              loading={isLoading}
              onRefresh={reload}
            />
          }
        />
        <Route path="/dashboard" element={<Navigate to="/stats" replace />} />
        <Route
          path="/meals"
          element={
            <MealLoggerPage
              ingredients={ingredients}
              foodLogs={foodLogs}
              loadingIngredients={isLoading}
              onIngredientCreated={addIngredient}
              onSaved={reload}
            />
          }
        />
        <Route path="/bowel" element={<BowelLoggerPage symptomLogs={symptomLogs} onSaved={reload} />} />
        <Route
          path="/calendar"
          element={
            <CalendarPage
              foodLogs={foodLogs}
              symptomLogs={symptomLogs}
              ingredients={ingredients}
              loading={isLoading}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </AppShell>
      {isSetupRequired || setupError ? (
        <SetupRequiredModal
          backendUrl={pb.baseURL}
          error={setupError}
          isChecking={hasRegisteredAdmin === null}
          onCheckAgain={() => void checkForRegisteredAdmin()}
        />
      ) : null}
    </>
  )
}

export default App
