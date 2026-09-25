import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  RELAY_WEAR_SQLITE_ABIS,
  relayWearSqliteFilename
} from '../../src/shared/relay-artifacts.ts'

const VERSION = '11.10.0'
const ARCHIVE_SHA256 = {
  v108: {
    'darwin-arm64': '31bf763ca042a7c0fa9d77715a85200d836ef511c9c8494651a59b21a18e671e',
    'darwin-x64': '4972e047d44fbda3839014815aee104cb6efb30b399dcca2b7d32abb1af4eafa',
    'linux-arm64': '753169e053f15785ae8a1944ef116a37992e86fd663dbdf40872bf6bddc53aa9',
    'linux-x64': '3ae3d8e8f46f46f6655f3f5b9a11be89bbed3ea2559a8b005d01da0875aacd74',
    'win32-x64': 'ea9ed33cccc3052a0937182efbeab2e7095f2123328f97d98eb96509a7714d94'
  },
  v115: {
    'darwin-arm64': 'a6229cbf859eb769e70d43602903448a5a5331f7bb048f67ae127662a8be4f20',
    'darwin-x64': '5384ff68463defa42ad50c53a01fa561dc16fea098997704b1560ffd4748ddc1',
    'linux-arm64': '073de1825b75cfbbb07551cc371b08633dfb373edc4ae10c4333ff11e7e3b29a',
    'linux-x64': 'a16b1df74f095e47b6404b4af1c237d2aca75f431d8f4d1f498419263632ed03',
    'win32-x64': '090c06c7e3b003e5cf99cbd280b62d13a5fc9a80f7a5836f1ea3485e3cf85890'
  },
  v127: {
    'darwin-arm64': '63241aadcd63e71febe5aff617f2dbac7ad461896241f479b11ec746d805bb7a',
    'darwin-x64': '0ae1a474d577ff3b68ed7988deaee814253e90b3052837657cbbd68194bf58a7',
    'linux-arm64': '7bdf1d50d7ba21f91a4d3c31da7b1acc1c10d7ef51dd887a6e07d851a75388da',
    'linux-x64': 'ea6a09d12d43cca31782ab0e09ecf442b8e2a49f5a02b219f5f117a6601ed306',
    'win32-x64': '94bdd2d44203759a4e1b76f4f7e91750cfeca4190e9fe356b05c1f73599124e9'
  }
}

function addonFromArchive(archive) {
  const tar = gunzipSync(archive)
  const header = tar.subarray(0, 512)
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
  const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim()
  const size = Number.parseInt(sizeText, 8)
  if (
    name !== 'build/Release/better_sqlite3.node' ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    512 + size > tar.length
  ) {
    throw new Error('Unexpected Wear SQLite prebuild archive')
  }
  return tar.subarray(512, 512 + size)
}

export async function stageWearSqliteRelayAddon(platform, root, outDir) {
  if (platform === 'win32-arm64') return false
  for (const abi of RELAY_WEAR_SQLITE_ABIS) {
    const expectedHash = ARCHIVE_SHA256[abi][platform]
    if (!expectedHash) {
      throw new Error(`No Wear SQLite prebuild for ${platform}`)
    }
    await stageArchive(abi, platform, expectedHash, root, outDir)
  }
  return true
}

async function stageArchive(abi, platform, expectedHash, root, outDir) {
  const name = `better-sqlite3-v${VERSION}-node-${abi}-${platform}.tar.gz`
  const cacheDir = join(root, '.build', 'wear-sqlite-prebuilds')
  const cached = join(cacheDir, name)
  let archive
  if (existsSync(cached)) {
    archive = readFileSync(cached)
  } else {
    const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${VERSION}/${name}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Wear SQLite prebuild download failed: ${response.status}`)
    archive = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(archive).digest('hex') !== expectedHash) {
    throw new Error(`Wear SQLite prebuild hash mismatch: ${platform}`)
  }
  if (!existsSync(cached)) {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(cached, archive)
  }
  writeFileSync(join(outDir, relayWearSqliteFilename(abi)), addonFromArchive(archive))
}
