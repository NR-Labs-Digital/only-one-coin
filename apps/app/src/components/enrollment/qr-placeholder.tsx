/** Modules per side. 25 is the density a real Yape QR reads at. */
const GRID = 25

/**
 * A QR-shaped placeholder. It is **not a payment code** and nothing scans it.
 *
 * The mockup needs the shape because the shape is the instruction: somebody
 * looking at this step has to see at a glance that they can open Yape and scan,
 * and a blank rectangle labelled "QR" does not teach that. What it must never
 * do is look like a working code for a real account — so the modules are
 * generated from a fixed seed rather than encoding anything, and the badge
 * under it says out loud that it is an example.
 *
 * The real one is an image the Asociación uploads in the backoffice, the same
 * way the account number is data and not code.
 *
 * Deterministic on purpose: `Math.random()` here would paint a different square
 * on the server and on the client and blow up hydration.
 */
function modules(): boolean[][] {
  // xorshift — a small, stable PRNG, so this square is identical every render.
  let seed = 0x9e3779b9
  const next = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 0xffffffff
  }
  const grid: boolean[][] = []
  for (let y = 0; y < GRID; y++) {
    const row: boolean[] = []
    for (let x = 0; x < GRID; x++) row.push(next() > 0.52)
    grid.push(row)
  }
  // Clear the three finder corners so the real ones can be drawn on top.
  const corners: [number, number][] = [
    [0, 0],
    [GRID - 7, 0],
    [0, GRID - 7],
  ]
  for (const [cx, cy] of corners) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const gy = cy + y
        const gx = cx + x
        if (grid[gy]?.[gx] !== undefined) grid[gy][gx] = false
      }
    }
  }
  return grid
}

const GRID_DATA = modules()

function Finder({ x, y }: { x: number; y: number }) {
  return (
    <>
      <rect x={x} y={y} width={7} height={7} fill="#13224b" />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="#ffffff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="#13224b" />
    </>
  )
}

export function QrPlaceholder({ label }: { label: string }) {
  return (
    <figure className="m-0 flex flex-col items-center gap-2">
      <svg
        viewBox={`-1 -1 ${GRID + 2} ${GRID + 2}`}
        role="img"
        aria-label={label}
        className="h-40 w-40 rounded-xl bg-white p-1 ring-1 ring-line"
      >
        <rect
          x={-1}
          y={-1}
          width={GRID + 2}
          height={GRID + 2}
          fill="#ffffff"
        />
        {GRID_DATA.map((row, y) =>
          row.map((on, x) =>
            on ? (
              <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#13224b" />
            ) : null,
          ),
        )}
        <Finder x={0} y={0} />
        <Finder x={GRID - 7} y={0} />
        <Finder x={0} y={GRID - 7} />
      </svg>
      <figcaption className="rounded-full bg-brand-yellow/20 px-2.5 py-1 text-[0.6875rem] font-semibold text-brand-yellow-deep">
        {label}
      </figcaption>
    </figure>
  )
}
