/**
 * Writes dist-electron/builtin-keys.json from env so packaged apps can ship optional shared keys
 * without relying on the end user's process environment.
 * Run after `tsc -p tsconfig.electron.json`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(__dirname, '../dist-electron/builtin-keys.json')
const data = {
  deepseek: (process.env.VELORA_BUILTIN_DEEPSEEK_KEY ?? '').trim(),
  gemini: (process.env.VELORA_BUILTIN_GEMINI_KEY ?? '').trim(),
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(data, null, 0), 'utf-8')
process.stderr.write(
  `[velora] ${out} (deepseek: ${data.deepseek ? 'set' : 'empty'}, gemini: ${data.gemini ? 'set' : 'empty'})\n`,
)
