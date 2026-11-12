export interface PersonalRule {
  id: string
  name: string
  keywords: string[]
  extensions: string[]
  category: string
  subcategory: string | null
  enabled: boolean
  created: string
}

export interface PersonalRulesListing {
  revision: number | null
  rules: PersonalRule[]
  available: boolean
}

export interface PersonalRuleDraft {
  name: string
  keywords: string[]
  extensions: string[]
  category: string
  subcategory: string | null
}

export interface PersonalRuleMatch {
  file_id: string
  name: string
  keywords: string[]
}

export interface PersonalRulePreview {
  token: string
  revision: number
  rule: Omit<PersonalRule, 'id' | 'created' | 'enabled'> & Partial<Pick<PersonalRule, 'id' | 'created' | 'enabled'>>
  matched: PersonalRuleMatch[]
  evaluated: number
  excluded: number
  total: number
}
