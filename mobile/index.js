const { AppRegistry } = require('react-native')

AppRegistry.registerHeadlessTask('OrcaWearActionDrain', () => async () => {
  const { drainWearActions } = require('./src/wear/wear-action-drain')
  await drainWearActions()
})

require('expo-router/entry')
