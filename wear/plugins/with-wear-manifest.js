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

    return configWithManifest
  })
}
