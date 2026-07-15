import fs from 'node:fs'
import pngjs from 'pngjs'

const { PNG } = pngjs
const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: node remove-green.mjs input.png output.png')
const source = PNG.sync.read(fs.readFileSync(input))
let minX = source.width, minY = source.height, maxX = 0, maxY = 0
for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) {
  const index = (y * source.width + x) * 4
  const r = source.data[index], g = source.data[index + 1], b = source.data[index + 2]
  const greenDominance = g - Math.max(r, b)
  const alpha = greenDominance >= 70 ? 0 : greenDominance <= 20 ? 255 : Math.round(255 * (70 - greenDominance) / 50)
  source.data[index + 3] = alpha
  if (alpha > 8) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
}
const padding = 10
minX = Math.max(0, minX - padding); minY = Math.max(0, minY - padding)
maxX = Math.min(source.width - 1, maxX + padding); maxY = Math.min(source.height - 1, maxY + padding)
const result = new PNG({ width: maxX - minX + 1, height: maxY - minY + 1 })
PNG.bitblt(source, result, minX, minY, result.width, result.height, 0, 0)
fs.writeFileSync(output, PNG.sync.write(result))
