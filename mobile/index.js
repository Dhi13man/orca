const { AppRegistry } = require('react-native')

AppRegistry.registerHeadlessTask('OrcaWearActionDrain', () => async () => {
  const { drainWearActions } = require('./src/wear/wear-action-drain')
  await drainWearActions()
})

AppRegistry.registerHeadlessTask('OrcaWearDashboardRefresh', () => async ({ runId }) => {
  const { refreshBoundWearDashboards } = require('./src/wear/wear-background-dashboard-refresh')
  await refreshBoundWearDashboards(runId)
})

require('expo-router/entry')
