import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { useTrackerData } from './hooks/useTrackerData'
import { BowelLoggerPage } from './pages/BowelLoggerPage'
import { CalendarPage } from './pages/CalendarPage'
import { HomePage } from './pages/HomePage'
import { IngredientSearchPage } from './pages/IngredientSearchPage'
import { MealLoggerPage } from './pages/MealLoggerPage'
import { StatsPage } from './pages/StatsPage'
import './App.css'

function App() {
  const {
    ingredients,
    foodLogs,
    symptomLogs,
    isLoading,
    loadError,
    stats,
    reload,
    addIngredient,
  } = useTrackerData()

  return (
    <AppShell stats={stats} loadError={loadError}>
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
  )
}

export default App
