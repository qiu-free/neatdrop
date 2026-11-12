import { runtimeCapabilities } from './runtimeCapabilities'
import { experienceCapabilities } from './experience/capabilities'

it('separates disk operations from browser organization without pretending the browser can copy files', () => {
  expect(runtimeCapabilities.runtime).toBe('local')
  expect(runtimeCapabilities.canCopyFiles).toBe(true)
  expect(experienceCapabilities.runtime).toBe('web-experience')
  expect(experienceCapabilities.canCopyFiles).toBe(false)
  expect(experienceCapabilities.canOrganizeInMemory).toBe(true)
  expect(experienceCapabilities.canPickLocalDirectory).toBe(false)
  expect(experienceCapabilities.canConfigureCloud).toBe(false)
  expect(Object.isFrozen(experienceCapabilities)).toBe(true)
})
