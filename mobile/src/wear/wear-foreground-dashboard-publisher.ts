import { AppState, type AppStateStatus } from 'react-native'
import { retainPublisher } from './wear-dashboard-publisher-owner'

export function startForegroundWearDashboardPublisher(
  onError: (error: unknown) => void
): () => void {
  let publisher: ReturnType<typeof retainPublisher> | null = null
  const update = (state: AppStateStatus) => {
    if (state === 'active') {
      publisher ??= retainPublisher(() => {}, onError)
    } else {
      publisher?.release()
      publisher = null
    }
  }
  const subscription = AppState.addEventListener('change', update)
  update(AppState.currentState)
  return () => {
    subscription.remove()
    publisher?.release()
    publisher = null
  }
}
