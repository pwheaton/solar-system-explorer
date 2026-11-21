// Smoke tests: load the real app in a browser and use it like a person would.
// They catch what the physics unit tests can't: crashes, console errors,
// broken controls and anything that only fails once it's on screen.

import { expect, test, type Page } from '@playwright/test'

/** Fail the test on any console error or uncaught exception. */
function watchForErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

const dockDate = (page: Page) => page.locator('[class*="dockDate"]')
/** A body's button in the controls panel's Bodies list (labelled "Mars, 1.5 AU"). */
const bodyButton = (page: Page, name: string) =>
  page.getByRole('complementary', { name: 'Simulation controls' }).getByRole('button', { name: new RegExp(`^${name}(,|$)`) })

test('loads, runs physics in the worker, and the clock ticks', async ({ page }) => {
  const errors = watchForErrors(page)
  await page.goto('/?perf=1')
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.locator('[class*="perf"]')).toContainText('physics on worker')
  const first = await dockDate(page).textContent()
  await expect.poll(async () => dockDate(page).textContent(), { timeout: 10_000 }).not.toBe(first)
  await expect(page.getByText(/Asteroid Belt: 2,500/)).toBeVisible()
  expect(errors).toEqual([])
})

test('the main-thread fallback works too', async ({ page }) => {
  const errors = watchForErrors(page)
  await page.goto('/?perf=1&worker=0')
  await expect(page.locator('[class*="perf"]')).toContainText('physics on main thread')
  const first = await dockDate(page).textContent()
  await expect.poll(async () => dockDate(page).textContent(), { timeout: 10_000 }).not.toBe(first)
  expect(errors).toEqual([])
})

test('scenarios load from the keyboard and from a link', async ({ page }) => {
  const errors = watchForErrors(page)
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  await page.keyboard.press('2')
  await expect(notice(page)).toContainText('Rogue star flyby')
  await expect(bodyButton(page, 'Rogue Star')).toBeVisible()
  await expect(page).toHaveURL(/s=flyby/)

  await page.goto('/?s=binary&follow=Jupiter')
  await expect(bodyButton(page, 'Companion')).toBeVisible()
  await expect(page.locator('[class*="brandSub"]')).toContainText('following Jupiter')
  expect(errors).toEqual([])
})

test('selecting a planet opens its card with live numbers', async ({ page }) => {
  const errors = watchForErrors(page)
  await page.goto('/')
  await bodyButton(page, 'Mars').click()
  const card = page.getByRole('article', { name: 'Mars details' })
  await expect(card).toBeVisible()
  const stat = card.locator('[class*="statValue"]').first()
  const before = await stat.textContent()
  await expect.poll(async () => stat.textContent(), { timeout: 10_000 }).not.toBe(before)
  await card.getByRole('button', { name: /Follow Mars/ }).click()
  await expect(page).toHaveURL(/follow=Mars/)
  expect(errors).toEqual([])
})

test('launch mode throws a planet', async ({ page }) => {
  const errors = watchForErrors(page)
  await page.goto('/')
  await page.keyboard.press('l')
  const bar = page.getByRole('toolbar', { name: 'Launch' })
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('0/30')
  const box = (await page.locator('canvas').boundingBox())!
  const x = box.x + box.width * 0.3, y = box.y + box.height * 0.4
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 40, y - 50, { steps: 5 })
  await page.mouse.up()
  await expect(bar).toContainText('1/30')
  await expect(bodyButton(page, 'Planet 1')).toBeVisible()
  expect(errors).toEqual([])
})

test('a chaos scenario runs through collisions and rewinds without errors', async ({ page }) => {
  const errors = watchForErrors(page)
  // Jupiter ignites: by year ~13 bodies start falling into the Sun.
  await page.goto('/?s=ignite&speed=20')
  const log = page.locator('section', { hasText: 'Event log' })
  await expect(log).toContainText(/fell into the Sun|merged into|hit /, { timeout: 45_000 })
  await page.keyboard.press('b')
  await expect(page.locator('[class*="dockStatus"]')).toHaveText('Rewinding')
  await page.waitForTimeout(1500)
  await page.keyboard.press('Space')
  await expect(page.locator('[class*="dockStatus"]')).toHaveText('Paused')
  expect(errors).toEqual([])
})

test('shortcuts panel opens with ?', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Shift+Slash')
  await expect(page.getByRole('complementary', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#shortcuts-panel')).toHaveAttribute('data-open', 'false')
})

test('link preview image renders', async ({ request }) => {
  const res = await request.get('/api/og?s=flyby&d=2026-11-21&seed=42')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('image/png')
  expect((await res.body()).length).toBeGreaterThan(50_000)
})
