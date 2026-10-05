import type { OrgType } from '@usmfomo/shared/config'

// Element ids shared by the Clubs | Schools tabs and their panels.
export const tabId = (prefix: string, type: OrgType) => `${prefix}-tab-${type}`
export const panelId = (prefix: string, type: OrgType) => `${prefix}-panel-${type}`
