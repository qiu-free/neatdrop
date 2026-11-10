export interface RuntimeCapabilities {
  runtime: 'local' | 'web-experience'
  canPickLocalDirectory: boolean
  canCopyFiles: boolean
  canWithdrawCopies: boolean
  canOrganizeInMemory: boolean
  canExportManifest: boolean
  canConfigureCloud: boolean
  canImportText: boolean
  canAggregateRoots: boolean
}

export const runtimeCapabilities: Readonly<RuntimeCapabilities> = Object.freeze({
  runtime: 'local', canPickLocalDirectory: true, canCopyFiles: true,
  canWithdrawCopies: true, canOrganizeInMemory: false, canExportManifest: false,
  canConfigureCloud: true, canImportText: false, canAggregateRoots: true,
})
export const isWebExperience = false
