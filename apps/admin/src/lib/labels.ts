import { CAMPUSES, ORG_TYPES, type Campus, type OrgType } from '@usmfomo/shared/config'

export const CAMPUS_LABELS: Record<Campus, string> = {
  main: 'Main',
  engineering: 'Engineering',
  health: 'Health',
  other: 'Other',
  online: 'Online',
}

/** Organisations need a physical campus (orgs_campus_physical CHECK). */
export const ORG_CAMPUSES = CAMPUSES.filter((c): c is Exclude<Campus, 'online'> => c !== 'online')

export const TYPE_LABELS: Record<OrgType, string> = {
  club: 'Club',
  school: 'School',
}

export const TYPE_HINTS: Record<OrgType, string> = {
  club: 'Student-run: clubs, societies, Desasiswa committees, MPP',
  school: 'Academic or administrative: schools, centres, institutes, HEPA units',
}

/** Options for the club/school radio group. */
export const TYPE_OPTIONS = ORG_TYPES.map((value) => ({ value, label: TYPE_LABELS[value], hint: TYPE_HINTS[value] }))
