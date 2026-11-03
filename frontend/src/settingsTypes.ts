export type SettingSource = 'environment' | 'saved' | 'default' | 'endpoint_mismatch' | 'none'
export type ModelField = 'endpoint' | 'text_model' | 'vision_model' | 'max_requests_per_batch'
export type KeyAction = 'keep' | 'replace' | 'remove'

export interface ModelConfig {
  endpoint: string
  text_model: string
  vision_model: string
  max_requests_per_batch: number
  configured: boolean
  key_source: SettingSource
  key_locked: boolean
  config_version: string
  settings_error?: string | null
  endpoint_source: SettingSource
  endpoint_locked: boolean
  text_model_source: SettingSource
  text_model_locked: boolean
  vision_model_source: SettingSource
  vision_model_locked: boolean
  max_requests_per_batch_source: SettingSource
  max_requests_per_batch_locked: boolean
}

export interface ModelConfigPayload {
  endpoint: string
  text_model: string
  vision_model: string
  max_requests_per_batch: number
  key_action: 'keep' | 'replace'
  api_key?: string
}

export interface ModelConfigTestPayload extends Omit<ModelConfigPayload, 'api_key'> {
  confirmed: true
  api_key?: string
}

export interface ModelConfigTestResult {
  ok: true
}
