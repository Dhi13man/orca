import { z } from 'zod'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { workspaceSourceSchema } from '../../../../shared/telemetry-events'
import { sleepingAgentLaunchConfigSchema } from '../../../../shared/workspace-session-sleeping-agents'
import { RUNTIME_NAVIGATION_TARGETS } from '../../../../shared/runtime-navigation'
import { TaskSourceContextSchema } from '../../../../shared/task-source-context-schema'
import { WorkspaceLinkedItemSchema } from '../../../../shared/workspace-linked-item-schema'
import {
  OptionalBoolean,
  OptionalFiniteNumber,
  OptionalString,
  TriStateLinkedIssue
} from '../schemas'
import {
  assertLinkedWorkItemSourceContextMatch,
  AutomationWorkspaceProvenanceRequest,
  CliWorkspaceProvenanceRequest,
  OptionalTuiAgent
} from './worktree-schemas'
import {
  CustomAgentProfileSchema,
  CustomAgentProfileSnapshotSchema
} from './custom-agent-profile-schemas'
import { MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../../shared/terminal-quick-commands'

export const WorktreeCreate = z
  .object({
    repo: z
      .unknown()
      .transform((v) => (typeof v === 'string' ? v : ''))
      .pipe(z.string().min(1, 'Missing repo selector')),
    name: OptionalString,
    /** Set by clients that fell back to a generated creature name. Absent means user-typed, so the
     *  host neither skips a retired candidate nor retires the name it lands on. */
    nameWasGenerated: z.boolean().optional(),
    baseBranch: OptionalString,
    compareBaseRef: OptionalString,
    branchNameOverride: OptionalString,
    linkedIssue: TriStateLinkedIssue,
    linkedPR: TriStateLinkedIssue,
    linkedLinearIssue: z.string().optional(),
    linkedLinearIssueWorkspaceId: z.union([z.string(), z.null()]).optional(),
    linkedLinearIssueOrganizationUrlKey: z.union([z.string(), z.null()]).optional(),
    linkedGitLabMR: TriStateLinkedIssue,
    linkedGitLabIssue: TriStateLinkedIssue,
    linkedBitbucketPR: TriStateLinkedIssue,
    linkedAzureDevOpsPR: TriStateLinkedIssue,
    linkedGiteaPR: TriStateLinkedIssue,
    linkedWorkItem: WorkspaceLinkedItemSchema.nullable().optional(),
    linkedTaskSourceContext: TaskSourceContextSchema.nullable().optional(),
    comment: OptionalString,
    displayName: OptionalString,
    telemetrySource: z
      .unknown()
      .transform((value) => {
        const parsed = workspaceSourceSchema.safeParse(value)
        return parsed.success ? parsed.data : undefined
      })
      .optional(),
    workspaceStatus: OptionalString,
    manualOrder: OptionalFiniteNumber,
    sparseCheckout: z
      .object({
        directories: z.array(z.string()),
        presetId: OptionalString
      })
      .optional(),
    pushTarget: z
      .object({
        remoteName: z.string(),
        branchName: z.string(),
        remoteUrl: OptionalString
      })
      .optional(),
    runHooks: OptionalBoolean,
    activate: OptionalBoolean,
    // Why: activation on create is view intent, so it is addressed like worktree.activate.
    // Contract: a paired desktop/web caller resolves to 'caller' and therefore receives NO
    // activateWorktree event — it must reveal from this call's result, which carries setup,
    // startup and defaultTabs. Pass an explicit target to opt into an all-surface reveal.
    navigation: z.enum(RUNTIME_NAVIGATION_TARGETS).optional(),
    parentWorkspace: OptionalString,
    // Why: an app-selected parent is a manual action, not the CLI's `--parent-workspace` flag.
    // Absent keeps the CLI provenance older clients rely on.
    parentWorkspaceOrigin: z.literal('manual').optional(),
    envParentWorkspace: OptionalString,
    parentWorktree: OptionalString,
    cwdParentWorktree: OptionalString,
    noParent: OptionalBoolean,
    callerTerminalHandle: OptionalString,
    orchestrationContext: z
      .object({
        parentWorktreeId: OptionalString,
        orchestrationRunId: OptionalString,
        taskId: OptionalString,
        coordinatorHandle: OptionalString
      })
      .optional(),
    setupDecision: z
      .unknown()
      .transform((v) =>
        typeof v === 'string' && (v === 'run' || v === 'skip' || v === 'inherit') ? v : undefined
      )
      .pipe(z.union([z.enum(['run', 'skip', 'inherit']), z.undefined()]))
      .optional(),
    // Why: some clients (e.g. desktop) pass a pre-built launch command so the
    // first terminal pane launches the selected agent instead of an idle shell.
    // Clients that can't quote for the host shell send `startupAgent` instead.
    startupCommand: OptionalString,
    startupEnv: z.record(z.string(), z.string()).optional(),
    startupLaunchConfig: sleepingAgentLaunchConfigSchema,
    startupCommandDelivery: z.enum(['fast', 'shell-ready']).optional(),
    startupCustomAgentProfile: CustomAgentProfileSchema.optional(),
    startupCustomAgentProfileSnapshot: CustomAgentProfileSnapshotSchema.optional(),
    startupCustomAgentPrompt: z
      .string()
      .max(MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH)
      .refine((value) => value.trim().length > 0, {
        message: 'Custom agent prompt cannot be empty'
      })
      .optional(),
    startupCustomAgentPromptDelivery: z.enum(['auto-submit', 'draft']).optional(),
    // Why: CLI clients should not hardcode agent launch quoting because SSH
    // workspaces execute in a different shell than the client process.
    startupAgent: OptionalTuiAgent,
    startupPrompt: OptionalString,
    // Why: task-driven mobile creates need desktop parity: the host chooses
    // the same default/detected agent and drafts the linked issue/PR URL into it.
    startupDraft: OptionalString,
    createdWithAgent: z
      .unknown()
      .transform((value) => (isTuiAgent(value) ? value : undefined))
      .optional(),
    // Why: mobile retries a create interrupted by a connection migration with the
    // same key so the host dedupes instead of spawning a duplicate worktree.
    clientMutationId: z.string().min(1).max(128).optional(),
    automationProvenanceRequest: AutomationWorkspaceProvenanceRequest.optional(),
    cliProvenanceRequest: CliWorkspaceProvenanceRequest.optional()
  })
  .superRefine((params, ctx) => {
    assertLinkedWorkItemSourceContextMatch(params, ctx)
    if ((params.parentWorkspace || params.parentWorktree) && params.noParent === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose either one parent selector or --no-parent.'
      })
    }
    if (params.parentWorkspace && params.parentWorktree) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose either one parent selector or --no-parent.'
      })
    }
    if (params.startupPrompt !== undefined && params.startupAgent === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startupPrompt requires startupAgent'
      })
    }
    if (params.startupCustomAgentProfile !== undefined && params.startupCommand !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startupCommand'],
        message: 'Custom agent profile cannot be combined with a startup command'
      })
    }
    const customProfileBaseAgent =
      params.startupCustomAgentProfile?.kind === 'derived'
        ? params.startupCustomAgentProfile.baseAgent
        : undefined
    if (
      params.startupCustomAgentProfile?.kind === 'generic' &&
      (params.startupAgent !== undefined || params.createdWithAgent !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startupCustomAgentProfile'],
        message: 'Generic custom agent profiles cannot declare a built-in agent identity'
      })
    }
    if (
      customProfileBaseAgent &&
      ((params.startupAgent !== undefined && params.startupAgent !== customProfileBaseAgent) ||
        (params.createdWithAgent !== undefined &&
          params.createdWithAgent !== customProfileBaseAgent))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startupCustomAgentProfile'],
        message: 'Derived custom agent identity must match its base agent'
      })
    }
    if (
      params.startupCustomAgentPrompt !== undefined &&
      params.startupCustomAgentProfile?.kind !== 'derived'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startupCustomAgentPrompt'],
        message: 'Custom agent prompt requires a derived custom agent profile'
      })
    }
    if (
      params.startupCustomAgentPromptDelivery !== undefined &&
      params.startupCustomAgentPrompt === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startupCustomAgentPromptDelivery'],
        message: 'Custom agent prompt delivery requires a prompt'
      })
    }
  })

export const WorktreePrefetchCreateBase = z.object({
  repo: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing repo selector')),
  baseBranch: OptionalString
})
