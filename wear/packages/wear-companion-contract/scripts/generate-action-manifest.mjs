import { readFileSync, writeFileSync } from 'node:fs'

const source = new URL('../action-manifest.json', import.meta.url)
const target = new URL('../src/action-manifest.ts', import.meta.url)
const manifest = JSON.parse(readFileSync(source, 'utf8'))
const output = `// Generated from action-manifest.json; run pnpm generate.\nexport const actionManifest = ${JSON.stringify(manifest, null, 2)} as const\n`

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== output) {
    throw new Error('Generated action manifest is stale')
  }
} else {
  writeFileSync(target, output)
}
