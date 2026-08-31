import { z } from 'zod'
import {
  normalizeCustomAgentProfile,
  normalizeCustomAgentProfileSnapshot,
  type CustomAgentProfile,
  type CustomAgentProfileSnapshot
} from '../../../../shared/custom-agent-profile'

export const CustomAgentProfileSnapshotSchema = z.preprocess(
  (raw) => normalizeCustomAgentProfileSnapshot(raw) ?? raw,
  z.custom<CustomAgentProfileSnapshot>(
    (value) => normalizeCustomAgentProfileSnapshot(value) !== null,
    'Invalid custom agent profile snapshot'
  )
)

export const CustomAgentProfileSchema = z.preprocess(
  (raw) => normalizeCustomAgentProfile(raw) ?? raw,
  z.custom<CustomAgentProfile>(
    (value) => normalizeCustomAgentProfile(value) !== null,
    'Invalid custom agent profile'
  )
)
