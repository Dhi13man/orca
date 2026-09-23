const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withWearManifest(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest
    const features = manifest['uses-feature'] ?? []
    manifest['uses-feature'] = [
      ...features.filter(
        (feature) =>
          feature.$?.['android:name'] !== 'android.hardware.type.watch' &&
          feature.$?.['android:name'] !== 'android.hardware.touchscreen'
      ),
      {
        $: {
          'android:name': 'android.hardware.type.watch',
          'android:required': 'true'
        }
      },
      {
        $: {
          'android:name': 'android.hardware.touchscreen',
          'android:required': 'false'
        }
      }
    ]

    const application = manifest.application?.[0]
    if (!application) {
      throw new Error('Generated Android manifest has no application')
    }
    const metadata = application['meta-data'] ?? []
    application['meta-data'] = [
      ...metadata.filter(
        (entry) => entry.$?.['android:name'] !== 'com.google.android.wearable.standalone'
      ),
      {
        $: {
          'android:name': 'com.google.android.wearable.standalone',
          'android:value': 'true'
        }
      }
    ]
    return configWithManifest
  })
}
