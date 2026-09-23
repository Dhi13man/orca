import { registerRootComponent } from 'expo'
import { requireNativeModule } from 'expo-modules-core'
import React from 'react'
import { AppRegistry, Text } from 'react-native'

const probe = requireNativeModule('CompanionProbe')

AppRegistry.registerHeadlessTask('OrcaCompanionPing', () => async ({ requestId, sourceNodeId }) => {
  console.info(`OrcaSpikeJS HEADLESS_ENTER requestId=${requestId} source=${sourceNodeId}`)
  await probe.reply(sourceNodeId, requestId)
  console.info(`OrcaSpikeJS HEADLESS_COMPLETE requestId=${requestId}`)
})

function App() {
  return React.createElement(Text, null, 'Orca companion Headless JS probe')
}

registerRootComponent(App)
