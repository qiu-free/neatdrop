import type { RuntimeCapabilities } from '../runtimeCapabilities'

export const experienceCapabilities: Readonly<RuntimeCapabilities> = Object.freeze({
  runtime: 'web-experience', canPickLocalDirectory: false, canCopyFiles: false,
  canWithdrawCopies: false, canOrganizeInMemory: true, canExportManifest: true,
  canConfigureCloud: false, canImportText: true, canAggregateRoots: false,
})
export const runtimeCapabilities = experienceCapabilities
export const isWebExperience = true
